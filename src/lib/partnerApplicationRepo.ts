/* The only module that reads or writes a seller application.
   Rules live in partnerApplication.ts so they can be tested without a network.

   Everything here goes through a `security definer` function rather than a
   table. That is not a style choice: an applicant is anonymous, and RLS decides
   what a request may see from what the request carries — an anonymous one
   carries nothing to check a reference and access code against. So the tables
   are shut to everybody but the operator, and the four functions check the pair
   before they answer. `20260803000000` asserts both halves of that.

   Every call therefore carries the credentials. There is no session to hold
   them in, which is the whole point: the applicant has no account yet. */

import { supabase } from './supabase'
import type {
  Application, ApplicationKind, Answers, Check, Credentials, DeskApplication,
  DocumentKind, FieldSpec, StartDraft, UploadedDocument,
} from './partnerApplication'
import { normaliseCode, validateDocument, documentPath } from './partnerApplication'

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string }

/* Postgres raises these as sentences already — `start_application` and friends
   are written so their exceptions can be shown to an applicant unchanged. What
   this strips is the plumbing PostgREST wraps around them. */
function friendly(message: string): string {
  const m = /(?:^|\n)([A-Z][^\n]*\.)\s*$/.exec(message)
  return (m?.[1] ?? message).replace(/^ERROR:\s*/, '').trim()
}

/**
 * The questions the desk asks, for one kind of applicant. Readable signed out —
 * the form is public.
 *
 * Filtered rather than fetched whole and split in the caller: a screen that
 * received both sets and picked one would be a second place the kind is
 * decided, and the one nobody looked at would be the one that drifted.
 */
export async function loadFields(kind: ApplicationKind = 'seller'): Promise<FieldSpec[]> {
  const { data } = await supabase
    .from('application_fields').select('*').eq('kind_of', kind).order('sort_order')
  return (data ?? []) as FieldSpec[]
}

/** The markets a company can be registered in, for the country picker. */
export async function loadMarkets(): Promise<{ code: string; name: string }[]> {
  const { data } = await supabase.from('markets').select('code, name').order('sort_order')
  return (data ?? []) as { code: string; name: string }[]
}

export async function startApplication(draft: StartDraft): Promise<Result<Credentials>> {
  const { data, error } = await supabase.rpc('start_application', {
    p_email: draft.email, p_phone: draft.phone, p_company: draft.company,
    p_contact_name: draft.contact_name, p_country: draft.country, p_kind: draft.kind,
    p_kind_of: draft.kind_of,
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  /* The function returns a table, so one row rather than a scalar. An empty
     result is not "no application" — it is a function that did not do what it
     says, and returning credentials nobody can use would be worse than saying
     so. */
  const row = (data as Credentials[] | null)?.[0]
  if (!row?.reference || !row.access_code) {
    return { ok: false, reason: 'The application was not started. Nothing has been saved — try again.' }
  }
  return { ok: true, value: row }
}

export async function resumeApplication(
  reference: string, code: string,
): Promise<Result<{ application: Application; answers: Answers }>> {
  const p_ref = reference.trim().toUpperCase()
  const p_code = normaliseCode(code)

  const { data, error } = await supabase.rpc('resume_application', { p_ref, p_code })
  if (error) return { ok: false, reason: friendly(error.message) }
  const app = (data as Application[] | null)?.[0]
  if (!app) return { ok: false, reason: 'No open application matches that reference and access code.' }

  const { data: rows, error: answerError } = await supabase
    .rpc('answers_for_application', { p_ref, p_code })
  if (answerError) return { ok: false, reason: friendly(answerError.message) }

  const answers: Answers = {}
  for (const r of (rows ?? []) as { field_id: string; value: string }[]) {
    answers[r.field_id] = r.value
  }
  return { ok: true, value: { application: app, answers } }
}

/**
 * One answer, saved as they go.
 *
 * Per answer rather than per step, because the thing this feature exists for is
 * that somebody can close the tab. A save that only fires on Next loses the
 * gate they were part-way through, which is the gate they will be part-way
 * through when the phone rings.
 */
export async function saveAnswer(
  { reference, code, field, value, reached }: {
    reference: string; code: string; field: string; value: string; reached?: number
  },
): Promise<Check> {
  const { error } = await supabase.rpc('save_application_answer', {
    p_ref: reference.trim().toUpperCase(),
    p_code: normaliseCode(code),
    p_field: field,
    p_value: value,
    p_reached: reached ?? null,
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true }
}

export async function submitApplication(reference: string, code: string): Promise<Check> {
  const { error } = await supabase.rpc('submit_application', {
    p_ref: reference.trim().toUpperCase(),
    p_code: normaliseCode(code),
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true }
}

/* ---------------------------------------------------------------- documents -- */

/* The bucket the marketplace's other documents already live in, so an accepted
   application's pack is opened by `openEvidence` with no second code path. */
const BUCKET = 'evidence'

/** What the desk asks for, for one kind of applicant. Public, like the form. */
export async function loadDocumentKinds(kind: ApplicationKind = 'seller'): Promise<DocumentKind[]> {
  const { data } = await supabase
    .from('application_document_kinds').select('*').eq('kind_of', kind).order('sort_order')
  return (data ?? []) as DocumentKind[]
}

export async function loadApplicationDocuments(
  reference: string, code: string,
): Promise<UploadedDocument[]> {
  const { data } = await supabase.rpc('documents_for_application', {
    p_ref: reference.trim().toUpperCase(), p_code: normaliseCode(code),
  })
  return ((data ?? []) as UploadedDocument[]).map(d => ({ ...d, bytes: Number(d.bytes) }))
}

/**
 * Put a document up against one of the kinds the desk asks for.
 *
 * Bytes first, row second, deliberately. A row pointing at an object that never
 * arrived is a document the desk believes it has and cannot open; an object
 * with no row is invisible and harmless. If the row fails the object is removed
 * again rather than left to fill the bucket.
 *
 * `record_application_document` returns the path of whatever it replaced — one
 * document per kind — so the object behind the old one goes too. Two
 * certificates of incorporation is a question nobody should have to answer.
 */
export async function uploadApplicationDocument(
  { reference, code, kind, file }: {
    reference: string; code: string; kind: string; file: File
  },
): Promise<Check> {
  const check = validateDocument(file)
  if (!check.ok) return check

  const ref = reference.trim().toUpperCase()
  const c = normaliseCode(code)
  const path = documentPath(ref, c, kind, file.name)

  const up = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream', upsert: false,
  })
  if (up.error) {
    /* Storage refuses an anonymous write by policy, and the message it gives is
       about rows rather than about the applicant's situation. */
    return {
      ok: false,
      reason: /policy|denied|unauthor/i.test(up.error.message)
        ? 'That upload was refused. Check the reference and access code are the ones this application was started with.'
        : friendly(up.error.message),
    }
  }

  const { data, error } = await supabase.rpc('record_application_document', {
    p_ref: ref, p_code: c, p_kind: kind,
    p_name: file.name, p_mime: file.type || 'application/octet-stream',
    p_bytes: file.size, p_path: path,
  })
  if (error) {
    await supabase.storage.from(BUCKET).remove([path])
    return { ok: false, reason: friendly(error.message) }
  }
  const replaced = typeof data === 'string' ? data : ''
  if (replaced && replaced !== path) await supabase.storage.from(BUCKET).remove([replaced])
  return { ok: true }
}

/** Take one back off. The row goes first here — the reverse of uploading, and
    for the same reason: a row whose object is already gone is the broken half. */
export async function removeApplicationDocument(
  reference: string, code: string, kind: string,
): Promise<Check> {
  const { data, error } = await supabase.rpc('remove_application_document', {
    p_ref: reference.trim().toUpperCase(), p_code: normaliseCode(code), p_kind: kind,
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  const path = typeof data === 'string' ? data : ''
  if (path) await supabase.storage.from(BUCKET).remove([path])
  return { ok: true }
}

/* ----------------------------------------------------------------- the desk -- */

/**
 * Everything that has come in, for the onboarding desk.
 *
 * Straight off the tables rather than through a function: the operator policy
 * already scopes these, and an applicant's access code is the thing that has no
 * RLS answer, not the desk's read. The columns are named rather than `*` so the
 * access code cannot arrive on a screen by being added to the table later.
 */
export async function loadDeskApplications(): Promise<{
  applications: DeskApplication[]
  answers: Record<string, Answers>
  documents: Record<string, UploadedDocument[]>
  loadError?: string
}> {
  const [apps, rows, docs] = await Promise.all([
    supabase.from('applications')
      .select('id, email, phone, company, contact_name, country, kind, kind_of, state, reached, started, last_saved, submitted_on, partner_id, account_id')
      .order('started', { ascending: false }),
    supabase.from('application_answers').select('application_id, field_id, value'),
    supabase.from('application_documents')
      .select('id, application_id, kind_id, name, mime, bytes, path, uploaded_at'),
  ])

  const answers: Record<string, Answers> = {}
  for (const r of (rows.data ?? []) as { application_id: string; field_id: string; value: string }[]) {
    ;(answers[r.application_id] ??= {})[r.field_id] = r.value
  }
  const documents: Record<string, UploadedDocument[]> = {}
  for (const d of (docs.data ?? []) as (UploadedDocument & { application_id: string })[]) {
    /* PostgREST hands a bigint back as a string, and a size that is a string
       formats as "NaN MB" wherever it is shown. */
    ;(documents[d.application_id] ??= []).push({ ...d, bytes: Number(d.bytes) })
  }

  const failed = apps.error ?? rows.error ?? docs.error
  return {
    applications: (apps.data ?? []) as DeskApplication[],
    answers,
    documents,
    ...(failed ? { loadError: `The application queue did not load (${failed.message}).` } : {}),
  }
}

/**
 * Accepting one, which is where a partner record comes from.
 *
 * Eight tables in one `security definer` function rather than eight writes from
 * here. The desk-created path next to this one does three of them from the
 * browser and reports "the partner was created but its gates were not", which
 * is a true sentence about a partner nobody can now progress.
 */
export async function acceptApplication(
  reference: string, note: string,
): Promise<Result<{ partner_id: string }>> {
  const { data, error } = await supabase.rpc('accept_application', {
    p_ref: reference.trim().toUpperCase(),
    p_note: note.trim() || null,
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  if (typeof data !== 'string' || !data) {
    return { ok: false, reason: 'The application was not accepted, and no partner was created.' }
  }
  return { ok: true, value: { partner_id: data } }
}

export async function withdrawApplication(reference: string, note: string): Promise<Check> {
  const { error } = await supabase.rpc('withdraw_application', {
    p_ref: reference.trim().toUpperCase(),
    p_note: note,
  })
  if (error) return { ok: false, reason: friendly(error.message) }
  return { ok: true }
}
