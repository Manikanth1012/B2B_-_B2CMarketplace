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
  Application, Answers, Check, Credentials, DeskApplication, FieldSpec, StartDraft,
} from './partnerApplication'
import { normaliseCode } from './partnerApplication'

export type Result<T> = { ok: true; value: T } | { ok: false; reason: string }

/* Postgres raises these as sentences already — `start_application` and friends
   are written so their exceptions can be shown to an applicant unchanged. What
   this strips is the plumbing PostgREST wraps around them. */
function friendly(message: string): string {
  const m = /(?:^|\n)([A-Z][^\n]*\.)\s*$/.exec(message)
  return (m?.[1] ?? message).replace(/^ERROR:\s*/, '').trim()
}

/** The questions the desk asks. Readable signed out — the form is public. */
export async function loadFields(): Promise<FieldSpec[]> {
  const { data } = await supabase
    .from('partner_application_fields').select('*').order('sort_order')
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
    .rpc('application_answers', { p_ref, p_code })
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
  loadError?: string
}> {
  const [apps, rows] = await Promise.all([
    supabase.from('partner_applications')
      .select('id, email, phone, company, contact_name, country, kind, state, reached, started, last_saved, submitted_on, partner_id')
      .order('started', { ascending: false }),
    supabase.from('partner_application_answers').select('application_id, field_id, value'),
  ])

  const answers: Record<string, Answers> = {}
  for (const r of (rows.data ?? []) as { application_id: string; field_id: string; value: string }[]) {
    ;(answers[r.application_id] ??= {})[r.field_id] = r.value
  }
  const failed = apps.error ?? rows.error
  return {
    applications: (apps.data ?? []) as DeskApplication[],
    answers,
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
