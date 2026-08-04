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
  kind: string
}

export type Check = { ok: true } | { ok: false; reason: string }

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

/* ------------------------------------------------------------ the form -- */

export interface GateStep {
  gate_id: string
  fields: FieldSpec[]
  required: number
  answered: number
  /* Every required question on this gate has an answer. An optional one left
     blank does not hold the gate — it was optional. */
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
export function stepsOf(fields: readonly FieldSpec[], answers: Answers): GateStep[] {
  const order: string[] = []
  const byGate = new Map<string, FieldSpec[]>()
  for (const f of [...fields].sort((a, b) => a.sort_order - b.sort_order)) {
    if (!byGate.has(f.gate_id)) { byGate.set(f.gate_id, []); order.push(f.gate_id) }
    byGate.get(f.gate_id)!.push(f)
  }
  return order.map(gate_id => {
    const list = byGate.get(gate_id)!
    const required = list.filter(f => f.required)
    const got = required.filter(f => answered(answers[f.id]))
    return {
      gate_id, fields: list,
      required: required.length,
      answered: got.length,
      done: required.length === got.length,
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

export function canSubmit(fields: readonly FieldSpec[], answers: Answers): Check {
  /* An empty field list means the form did not load. Reporting "complete" would
     be the worst of both — it is the one state where nothing outstanding does
     not mean everything answered. */
  if (fields.length === 0) {
    return { ok: false, reason: 'The application form has not loaded, so there is nothing to submit yet.' }
  }
  const left = outstanding(fields, answers)
  if (left.length === 0) return { ok: true }
  return {
    ok: false,
    reason: left.length === 1
      ? `One question is still outstanding: ${left[0].label}`
      : `${left.length} questions are still outstanding, starting with: ${left[0].label}`,
  }
}

/** How far through, counted in required questions rather than in gates — seven
    steps of wildly different sizes make a gate count a misleading number. */
export function progress(fields: readonly FieldSpec[], answers: Answers): {
  required: number; answered: number; pct: number
} {
  const required = fields.filter(f => f.required)
  const got = required.filter(f => answered(answers[f.id])).length
  return {
    required: required.length,
    answered: got,
    pct: required.length === 0 ? 0 : Math.round((got / required.length) * 100),
  }
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
  reached: number
  started: string
  last_saved: string
  submitted_on: string | null
  partner_id: string | null
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
  const left = outstanding(fields, answers)
  if (left.length > 0) {
    return {
      ok: false,
      reason: left.length === 1
        ? `${app.id} was sent before "${left[0].label}" was on the form. Ask for it before accepting.`
        : `${app.id} is missing ${left.length} answers the form now requires, starting with "${left[0].label}".`,
    }
  }
  return { ok: true }
}

/** What the applicant said, gate by gate, for the desk to read in the order it
    assesses them. Questions with no answer are kept and marked, because a
    blank on an optional question is itself worth seeing. */
export function answerSheet(fields: readonly FieldSpec[], answers: Answers): {
  gate_id: string
  rows: { field: FieldSpec; value: string | null }[]
}[] {
  return stepsOf(fields, answers).map(s => ({
    gate_id: s.gate_id,
    rows: s.fields.map(f => ({
      field: f,
      value: answered(answers[f.id]) ? answers[f.id] : null,
    })),
  }))
}
