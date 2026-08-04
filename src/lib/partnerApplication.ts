/* Applying to sell, before there is anything to sign in to.
   No React and no Supabase, so the rules can be tested without a network.

   The seven gates already exist and already work — but every one of them is
   scoped to a partner that exists, and an applicant is by definition somebody
   who is not one yet. This is the step before: what the desk asks, what still
   has to be answered, and whether the thing can be handed over.

   Two rules run through the whole file.

   The questions are data. `FieldSpec` rows come from
   `partner_application_fields`, so nothing here has a list of questions written
   into it. A question added to that table appears on the form, counts towards
   the progress, and blocks submission, all without a line changing here — and
   more to the point, it cannot appear in one of those three and not the others.

   Blank is not answered. An answer trimmed to nothing is absent, everywhere,
   in the same way. The alternative is a form that reports itself complete
   because somebody pressed space in a required box. */

export type FieldKind =
  | 'text' | 'longtext' | 'email' | 'phone' | 'number'
  | 'choice' | 'multichoice' | 'boolean' | 'date'

export interface FieldSpec {
  id: string
  kind_of: ApplicationKind
  gate_id: string
  label: string
  hint: string | null
  kind: FieldKind
  /* Comma-separated in the table, because a choice list is a list of labels and
     a Postgres array here buys nothing a split does not. Null for every kind
     that is not a choice, which the migration asserts. */
  options: string | null
  required: boolean
  sort_order: number
}

export interface Application {
  reference: string
  email: string
  phone: string
  company: string
  contact_name: string
  country: string
  kind: string
  state: 'draft' | 'submitted' | 'accepted' | 'withdrawn'
  kind_of: ApplicationKind
  reached: number
  started: string
  last_saved: string
  submitted_on: string | null
}

/** What an applicant types before they have a reference. */
export interface StartDraft {
  email: string
  phone: string
  company: string
  contact_name: string
  country: string
  /* The seller's trade or the company's industry — not the same thing as
     `kind_of`, which is whether this is a seller or a business applying. */
  kind: string
  kind_of: ApplicationKind
}

export type Check = { ok: true } | { ok: false; reason: string }

/**
 * What somebody is applying to become.
 *
 * A seller becomes a partner with seven gates; a business becomes an account
 * with a credit limit and a six-step ladder. Everything up to the moment of
 * acceptance is the same for both, which is why one set of tables and one set
 * of screens serve them — the kind decides which questions and which documents
 * are asked for, and nothing else until the desk says yes.
 */
export type ApplicationKind = 'seller' | 'business'

/** The credentials the applicant is given back, and has to keep. */
export interface Credentials {
  reference: string
  access_code: string
}

/* ------------------------------------------------------------- answers -- */

export type Answers = Record<string, string>

/** Whether a value counts as given. The single definition, so "answered" means
    the same thing to the progress bar, the submit button and the database. */
export function answered(value: string | undefined | null): boolean {
  return (value ?? '').trim() !== ''
}

export function optionsOf(field: Pick<FieldSpec, 'options'>): string[] {
  return (field.options ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

/* A multichoice answer is stored as one string so it fits the same column as
   every other answer. Joined and split in one place rather than at each call
   site, because two call sites is two separators. */
export const MULTI_SEP = ', '

export function splitMulti(value: string | undefined | null): string[] {
  return (value ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

export function joinMulti(values: readonly string[]): string {
  return values.map(s => s.trim()).filter(Boolean).join(MULTI_SEP)
}

export function toggleMulti(value: string | undefined | null, option: string): string {
  const now = splitMulti(value)
  return joinMulti(now.includes(option) ? now.filter(o => o !== option) : [...now, option])
}

/* ----------------------------------------------------------- documents -- */

/**
 * A document the desk asks for, filed under the gate that reads it.
 *
 * The gates that matter are decisions *on* paperwork — "Registration,
 * beneficial ownership over 25%, sanctions and PEP screening" is not a text
 * box, it is a file somebody reads. Every seller already on the marketplace has
 * a shelf of these on `onboarding_documents`; these are what become them.
 */
export interface DocumentKind {
  id: string
  kind_of: ApplicationKind
  gate_id: string
  label: string
  note: string | null
  required: boolean
  sort_order: number
}

/** One the applicant has actually uploaded. */
export interface UploadedDocument {
  id: string
  kind_id: string
  name: string
  mime: string
  bytes: number
  path: string
  uploaded_at: string
}

/* Deliberately narrower than the ticket attachment list: a scanned certificate
   is a PDF or a photograph of one, and a spreadsheet is not a certificate of
   incorporation. Nothing executable, and nothing the desk would have to open in
   an application it does not have. */
export const DOC_TYPES: { mime: string; ext: string[]; label: string }[] = [
  { mime: 'application/pdf', ext: ['.pdf'], label: 'PDF' },
  { mime: 'image/jpeg', ext: ['.jpg', '.jpeg'], label: 'JPEG' },
  { mime: 'image/png', ext: ['.png'], label: 'PNG' },
  { mime: 'image/heic', ext: ['.heic'], label: 'HEIC' },
]

export const DOC_MAX_BYTES = 15 * 1024 * 1024

export const DOC_ACCEPT = DOC_TYPES.flatMap(t => [t.mime, ...t.ext]).join(',')

export function docTypesLabel(): string {
  const names = DOC_TYPES.map(t => t.label)
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`
}

export function sizeOf(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Whether this file can go up.
 *
 * Extension as well as MIME, because a browser reports an empty type for plenty
 * of ordinary files — a PDF dragged from some file managers arrives as `''`,
 * and refusing it would refuse the single most common document on the list.
 */
export function validateDocument(file: { name: string; type: string; size: number }): Check {
  const name = file.name || 'That file'
  if (file.size === 0) {
    return { ok: false, reason: `${name} is empty. Check it saved before uploading it.` }
  }
  if (file.size > DOC_MAX_BYTES) {
    return {
      ok: false,
      reason: `${name} is ${sizeOf(file.size)} — the limit is ${sizeOf(DOC_MAX_BYTES)}. A scan at 300dpi is usually well under it; try exporting the PDF again rather than photographing every page.`,
    }
  }
  const lower = file.name.toLowerCase()
  const ok = DOC_TYPES.some(t =>
    (file.type && file.type === t.mime) || t.ext.some(e => lower.endsWith(e)))
  if (!ok) {
    return { ok: false, reason: `${name} is not a ${docTypesLabel()}. Scan or export it as one of those.` }
  }
  return { ok: true }
}

/** Lowercase, no spaces, nothing that changes meaning in a URL. The directory
    part goes first so `../../etc/passwd` becomes `passwd` rather than nonsense
    — the same reasoning, and the same shape, as `safeName` in `attachments.ts`. */
export function safeDocName(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename
  const dot = base.lastIndexOf('.')
  const hasExt = dot > 0
  const stem = (hasExt ? base.slice(0, dot) : base)
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
  const ext = (hasExt ? base.slice(dot) : '').toLowerCase().replace(/[^a-z0-9.]/g, '')
  return `${stem || 'document'}${ext}`
}

/**
 * Where the bytes go.
 *
 * The access code is in the path because storage decides what an anonymous
 * request may write from the path alone — there is no session to check it
 * against. `application_upload_open` is the policy that reads these two
 * segments back, so the shape here and the shape there are one fact.
 */
export function documentPath(reference: string, code: string, kindId: string, filename: string): string {
  return `${reference}/${code}/${kindId}-${Date.now()}-${safeDocName(filename)}`
}

/** The checklist for one gate, with what has come in against it. */
export function documentsFor(
  gateId: string, kinds: readonly DocumentKind[], have: readonly UploadedDocument[],
): { kind: DocumentKind; file: UploadedDocument | null }[] {
  return kinds
    .filter(k => k.gate_id === gateId)
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(kind => ({ kind, file: have.find(d => d.kind_id === kind.id) ?? null }))
}

/** Required documents with nothing against them, in the order they are asked. */
export function documentsOutstanding(
  kinds: readonly DocumentKind[], have: readonly UploadedDocument[],
): DocumentKind[] {
  const got = new Set(have.map(d => d.kind_id))
  return [...kinds].filter(k => k.required && !got.has(k.id))
    .sort((a, b) => a.sort_order - b.sort_order)
}

/* ------------------------------------------------------------ the form -- */

export interface GateStep {
  gate_id: string
  fields: FieldSpec[]
  /* What this gate asks for on paper, with whatever has come in against it. */
  documents: { kind: DocumentKind; file: UploadedDocument | null }[]
  /* Questions and documents both, because both hold the gate. Counting only
     the questions is what let a gate read "done" with no certificate of
     incorporation against it. */
  required: number
  answered: number
  /* Every required question answered and every required document uploaded. An
     optional one left blank does not hold the gate — it was optional. */
  done: boolean
}

/**
 * The form, grouped into the gates it will be read under, in the order the desk
 * reads them.
 *
 * Gates with no questions are dropped rather than rendered empty. The migration
 * asserts that no gate is in that state, so this is the belt to that braces —
 * but a screen that renders a step with nothing on it is a step an applicant
 * clicks Next on twice and reports as broken.
 */
export function stepsOf(
  fields: readonly FieldSpec[], answers: Answers,
  kinds: readonly DocumentKind[] = [], have: readonly UploadedDocument[] = [],
): GateStep[] {
  const order: string[] = []
  const byGate = new Map<string, FieldSpec[]>()
  for (const f of [...fields].sort((a, b) => a.sort_order - b.sort_order)) {
    if (!byGate.has(f.gate_id)) { byGate.set(f.gate_id, []); order.push(f.gate_id) }
    byGate.get(f.gate_id)!.push(f)
  }
  /* A gate can ask only for documents and no questions. It would otherwise be
     dropped from the form entirely, and the applicant would never be asked. */
  for (const k of [...kinds].sort((a, b) => a.sort_order - b.sort_order)) {
    if (!byGate.has(k.gate_id)) { byGate.set(k.gate_id, []); order.push(k.gate_id) }
  }

  return order.map(gate_id => {
    const list = byGate.get(gate_id)!
    const docs = documentsFor(gate_id, kinds, have)
    const requiredFields = list.filter(f => f.required)
    const gotFields = requiredFields.filter(f => answered(answers[f.id]))
    const requiredDocs = docs.filter(d => d.kind.required)
    const gotDocs = requiredDocs.filter(d => d.file !== null)
    return {
      gate_id, fields: list, documents: docs,
      required: requiredFields.length + requiredDocs.length,
      answered: gotFields.length + gotDocs.length,
      done: requiredFields.length === gotFields.length && requiredDocs.length === gotDocs.length,
    }
  })
}

/** What is still outstanding, in the order it is asked. The sentence the desk's
    own `submit_application` raises, computed here so the applicant sees it
    before they press the button rather than as an error afterwards. */
export function outstanding(fields: readonly FieldSpec[], answers: Answers): FieldSpec[] {
  return [...fields]
    .filter(f => f.required && !answered(answers[f.id]))
    .sort((a, b) => a.sort_order - b.sort_order)
}

/**
 * Whether the whole thing can go to the desk.
 *
 * Questions and documents together, in one answer. `submit_application` checks
 * both in one list for the same reason: an applicant told about the questions,
 * who fixes them and is then told about the documents, has been made to go
 * round twice.
 */
export function canSubmit(
  fields: readonly FieldSpec[], answers: Answers,
  kinds: readonly DocumentKind[] = [], have: readonly UploadedDocument[] = [],
): Check {
  /* An empty field list means the form did not load. Reporting "complete" would
     be the worst of both — it is the one state where nothing outstanding does
     not mean everything answered. */
  if (fields.length === 0) {
    return { ok: false, reason: 'The application form has not loaded, so there is nothing to submit yet.' }
  }
  const left: string[] = [
    ...outstanding(fields, answers).map(f => f.label),
    ...documentsOutstanding(kinds, have).map(k => k.label),
  ]
  if (left.length === 0) return { ok: true }
  return {
    ok: false,
    reason: left.length === 1
      ? `One thing is still outstanding: ${left[0]}`
      : `${left.length} things are still outstanding, starting with: ${left[0]}`,
  }
}

/** How far through, counted in required questions and documents rather than in
    gates — seven steps of wildly different sizes make a gate count a misleading
    number, and a gate whose only ask is a certificate would not count at all. */
export function progress(
  fields: readonly FieldSpec[], answers: Answers,
  kinds: readonly DocumentKind[] = [], have: readonly UploadedDocument[] = [],
): { required: number; answered: number; pct: number } {
  const requiredFields = fields.filter(f => f.required)
  const gotFields = requiredFields.filter(f => answered(answers[f.id])).length
  const requiredDocs = kinds.filter(k => k.required)
  const gotDocs = requiredDocs.filter(k => have.some(d => d.kind_id === k.id)).length

  const required = requiredFields.length + requiredDocs.length
  const got = gotFields + gotDocs
  return { required, answered: got, pct: required === 0 ? 0 : Math.round((got / required) * 100) }
}

/**
 * Where to land somebody coming back.
 *
 * The first gate with something still outstanding, not the furthest they
 * reached — somebody who skipped past question three and filled in gate five
 * wants to be put back in front of question three. Falls back to the last step
 * when everything is answered, which is where the submit button is.
 */
export function resumeAt(steps: readonly GateStep[]): number {
  const i = steps.findIndex(s => !s.done)
  return i === -1 ? Math.max(0, steps.length - 1) : i
}

/* -------------------------------------------------------------- starting -- */

/* Deliberately loose. An address this rejects is an applicant turned away by a
   regex, and the only thing that actually proves an address works is sending
   something to it. This catches the typo, not the exotic. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
/* Digits, with the punctuation people write numbers with. Length rather than
   shape, because "+91 80 4000 0000", "(020) 7946 0958" and "+254-20-1234567"
   are all real and no single pattern covers them. */
const PHONE_DIGITS = 7

export function validateStart(draft: StartDraft, markets: readonly { code: string }[]): Check {
  if (!draft.company.trim()) {
    return { ok: false, reason: 'Give the registered company name — the one on the certificate of incorporation.' }
  }
  if (!draft.contact_name.trim()) {
    return { ok: false, reason: 'Give a named contact. An application with nobody on it cannot be progressed.' }
  }
  if (!EMAIL.test(draft.email.trim())) {
    return { ok: false, reason: 'That does not look like an email address, and it is how the desk comes back to you.' }
  }
  if ((draft.phone.match(/\d/g) ?? []).length < PHONE_DIGITS) {
    return { ok: false, reason: 'Give a contact number the desk can call. KYC is a phone call, not an email thread.' }
  }
  if (!draft.country.trim()) {
    return { ok: false, reason: 'Say where the company is registered.' }
  }
  /* Checked against the markets that exist rather than a list here. The
     database refuses the same thing one layer down; this is so the applicant is
     told in a sentence instead of a Postgres error. */
  if (markets.length > 0 && !markets.some(m => m.code === draft.country)) {
    return { ok: false, reason: 'The marketplace does not operate there yet. Pick one of the markets listed.' }
  }
  if (!draft.kind.trim()) {
    return { ok: false, reason: 'Say what kind of seller you are — it decides which evidence the KYC gate asks for.' }
  }
  return { ok: true }
}

/** Whether something an applicant typed could be a reference at all, so the
    resume form can say "that is not a reference" rather than sending a
    guaranteed miss to the database. */
export function looksLikeReference(s: string): boolean {
  return /^APP-\d{4}-\d{4}$/.test(s.trim().toUpperCase())
}

/* The alphabet the database generates from — `new_access_code`. Repeated here
   only to be checked against, never to generate from: a second generator would
   be a second answer to what a code looks like. */
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 12

/**
 * What somebody typed, as the database stores it.
 *
 * Case and the spaces or hyphens people break a twelve-character string with,
 * and nothing else. There is no confusable-character mapping here on purpose:
 * the alphabet already excludes 0 and O, 1 and I and L, so a typed `0` has no
 * character it could have been meant as. Mapping it to something would be
 * inventing an answer, and the honest response to an unreadable code is to say
 * it does not match.
 */
export function normaliseCode(s: string): string {
  return s.trim().toUpperCase().replace(/[\s-]/g, '')
}

/** Whether it could be a code at all, so the resume form can say so rather than
    sending a guaranteed miss. */
export function looksLikeCode(s: string): boolean {
  const c = normaliseCode(s)
  return c.length === CODE_LENGTH && [...c].every(ch => CODE_ALPHABET.includes(ch))
}

/* ---------------------------------------------------------------- the desk -- */

/**
 * An application as the onboarding desk sees it.
 *
 * The applicant's own view (`Application`) comes back from a function that
 * checks their access code and deliberately does not include it. This one comes
 * from the table, which only the operator can read — and still does not carry
 * the code, because the desk has no use for it and a screen that displays a
 * credential is a screen somebody photographs.
 */
export interface DeskApplication {
  id: string
  email: string
  phone: string
  company: string
  contact_name: string
  country: string
  kind: string
  state: 'draft' | 'submitted' | 'accepted' | 'withdrawn'
  kind_of: ApplicationKind
  reached: number
  started: string
  last_saved: string
  submitted_on: string | null
  /* One or the other, never both — an accepted application becomes a partner
     or an account, and the migration asserts no row carries two. */
  partner_id: string | null
  account_id: string | null
}

/**
 * The queue, in the order a desk works it.
 *
 * Three lists rather than one sorted list. Submitted applications are somebody
 * else's turn to act and drafts are not — showing them together produces a
 * queue where most rows are things nobody is waiting on, which is how a desk
 * learns to ignore its own queue.
 */
export function deskQueue(apps: readonly DeskApplication[]): {
  waiting: DeskApplication[]
  drafts: DeskApplication[]
  decided: DeskApplication[]
} {
  const by = (k: keyof DeskApplication) =>
    (a: DeskApplication, b: DeskApplication) => String(a[k] ?? '').localeCompare(String(b[k] ?? ''))
  return {
    /* Oldest first: a queue is only useful in the order people have been
       waiting in. */
    waiting: apps.filter(a => a.state === 'submitted').sort(by('submitted_on')),
    drafts: apps.filter(a => a.state === 'draft').sort(by('last_saved')).reverse(),
    decided: apps.filter(a => a.state === 'accepted' || a.state === 'withdrawn')
      .sort(by('last_saved')).reverse(),
  }
}

/** Whole days since it was submitted, or null for one that has not been. */
export function waitingDays(app: DeskApplication, now: Date = new Date()): number | null {
  if (!app.submitted_on) return null
  const then = new Date(app.submitted_on)
  if (Number.isNaN(then.getTime())) return null
  return Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000))
}

/**
 * Whether the desk can accept this one, and if not, why not.
 *
 * The completeness half is checked again rather than trusted from the state,
 * because the desk can add a question to the form after somebody submitted —
 * and then a submitted application really is missing an answer. The database
 * refuses the same thing; this is so the button is disabled with a sentence
 * next to it rather than enabled and failing.
 */
export function canAccept(
  app: DeskApplication, fields: readonly FieldSpec[], answers: Answers,
  kinds: readonly DocumentKind[] = [], have: readonly UploadedDocument[] = [],
): Check {
  if (app.state === 'accepted') {
    return { ok: false, reason: `${app.id} is already partner ${app.partner_id}.` }
  }
  if (app.state === 'withdrawn') {
    return { ok: false, reason: `${app.id} was withdrawn. The applicant starts a new one.` }
  }
  if (app.state !== 'submitted') {
    return { ok: false, reason: `${app.id} is still being filled in. There is nothing to accept until it is sent.` }
  }
  const left: string[] = [
    ...outstanding(fields, answers).map(f => f.label),
    ...documentsOutstanding(kinds, have).map(k => k.label),
  ]
  if (left.length > 0) {
    return {
      ok: false,
      reason: left.length === 1
        ? `${app.id} was sent before "${left[0]}" was asked for. Ask for it before accepting.`
        : `${app.id} is missing ${left.length} things the form now requires, starting with "${left[0]}".`,
    }
  }
  return { ok: true }
}

/** What the applicant said, gate by gate, for the desk to read in the order it
    assesses them. Questions with no answer are kept and marked, because a
    blank on an optional question is itself worth seeing. */
export function answerSheet(
  fields: readonly FieldSpec[], answers: Answers,
  kinds: readonly DocumentKind[] = [], have: readonly UploadedDocument[] = [],
): {
  gate_id: string
  rows: { field: FieldSpec; value: string | null }[]
  /* What was uploaded against this gate, and what was asked for and is not
     there. A reviewer needs both — the second is the reason to send it back. */
  documents: { kind: DocumentKind; file: UploadedDocument | null }[]
}[] {
  return stepsOf(fields, answers, kinds, have).map(s => ({
    gate_id: s.gate_id,
    rows: s.fields.map(f => ({
      field: f,
      value: answered(answers[f.id]) ? answers[f.id] : null,
    })),
    documents: s.documents,
  }))
}

/* ------------------------------------------------------- the desk's rail -- */

export type StageTone = 'cleared' | 'current' | 'failed' | 'pending'

export interface ApplicationStage {
  id: string
  name: string
  tone: StageTone
  /* What actually happened at this stage, or what is waited on. Never a
     restatement of the name. */
  note: string
}

/**
 * An application's journey, in the same four tones the onboarding gates use.
 *
 * The desk already reads a rail for a seller who has been accepted — seven
 * gates, cleared or current or not reached. Before acceptance it had a list and
 * a form dump, so the same reader had to hold two different pictures of one
 * pipeline. These are the stages an application passes through, shaped so the
 * two can be drawn by the same eye.
 *
 * Four rather than one per question: a rail with twenty tiles is a progress bar
 * with extra steps, and the desk's question is only ever which of these four
 * places somebody is stuck in.
 */
/* `submitted_on` is a timestamp, and a tile is not the place for
   "2026-08-02T18:59:31.483347+00:00". Formatted here rather than at the tile so
   the note reads the same wherever it is shown. */
function asDay(value: string | null): string | null {
  if (!value) return null
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function applicationStages(
  app: Pick<DeskApplication, 'state' | 'submitted_on' | 'partner_id'>,
  filled: { answered: number; required: number },
  waiting: number | null,
): ApplicationStage[] {
  const done = filled.required > 0 && filled.answered >= filled.required
  const sent = app.state === 'submitted' || app.state === 'accepted'
  const decided = app.state === 'accepted' || app.state === 'withdrawn'

  return [
    {
      id: 'started',
      name: 'Started',
      tone: 'cleared',
      note: 'The applicant opened the form and has a reference',
    },
    {
      id: 'filled',
      name: 'Filled in',
      tone: sent || done ? 'cleared' : app.state === 'withdrawn' ? 'pending' : 'current',
      note: sent || done
        ? `All ${filled.required} answered`
        : `${filled.answered} of ${filled.required} answered`,
    },
    {
      id: 'sent',
      name: 'Submitted',
      tone: sent ? 'cleared' : 'pending',
      note: sent ? (asDay(app.submitted_on) ?? 'Sent') : 'Not sent yet',
    },
    {
      id: 'decided',
      name: 'Decided',
      tone: app.state === 'accepted' ? 'cleared'
        : app.state === 'withdrawn' ? 'failed'
        : sent ? 'current' : 'pending',
      note: app.state === 'accepted' ? `Accepted — now ${app.partner_id ?? 'a seller'}`
        : app.state === 'withdrawn' ? 'Closed without becoming a seller'
        : sent ? (waiting === null ? 'With the desk' : waiting === 0 ? 'With the desk since today' : `With the desk ${waiting}d`)
        : 'Nothing to decide yet',
    },
  ].map(st => st) as ApplicationStage[]
}

/** The line above the rail, in the shape the gate rail uses. */
export function stageSummary(stages: readonly ApplicationStage[]): { cleared: number; total: number; says: string } {
  const cleared = stages.filter(s => s.tone === 'cleared').length
  const failed = stages.find(s => s.tone === 'failed')
  const current = stages.find(s => s.tone === 'current')
  return {
    cleared,
    total: stages.length,
    says: failed ? `Stopped at ${failed.name}. ${failed.note}.`
      : current ? `Waiting on ${current.name.toLowerCase()} — ${current.note.toLowerCase()}.`
      : 'Through every stage.',
  }
}
