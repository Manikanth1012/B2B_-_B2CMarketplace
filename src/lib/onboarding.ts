/* The onboarding gate machine.
   Pure by design: no React, no Supabase, no I/O. Both the operator console and
   the partner console import this, which is what makes the rule one rule rather
   than two implementations that happen to agree today. */

/* `failed` is a real outcome, not a variant of pending: failing KYC stops the
   application where it stands. It is not a rejection of the company — they may
   reapply with corrected documents, which opens a new application rather than
   reopening this gate. Without it a stopped application looks identical to one
   nobody has got to yet. */
export type GateStatus = 'cleared' | 'current' | 'pending' | 'failed'

export interface Gate {
  id: string
  name: string
  order: number
  owner: string
  targetDays: number
  dualControl: boolean
  waivable: boolean
  what: string
}

export interface TechCheck {
  id: 'registered' | 'auth' | 'tested' | 'sandbox'
  label: string
  why: string
}

export interface Endpoint {
  id: string
  partner_id: string
  name: string
  url: string
  method: string
  auth: string
  enabled: boolean
  events: string[]
}

export interface TestCall {
  id: string
  endpoint_id: string
  status: 'sent' | 'acknowledged' | 'failed'
  called_at: string
}

export interface SandboxRun {
  id: string
  partner_id: string
  state: 'not_started' | 'running' | 'passed' | 'failed'
  ran_at: string | null
}

export interface TechStatus {
  checks: { registered: boolean; auth: boolean; tested: boolean; sandbox: boolean }
  missing: string[]
  noAuth: Endpoint[]
  untested: Endpoint[]
}

/* Gate names match the rows in onboarding_gates.

   The targets sum to exactly the five working days the marketplace publishes as
   its onboarding SLA. The gates that are a decision on evidence already
   supplied clear the same day; only the ones that need somebody to go and do
   work carry a day of their own. A ladder summing to more than the published
   SLA is a promise the process cannot keep, so the migration asserts the sum.

   `what` is what the gate is for, in the seller's words — shown beside the gate
   rather than only its name, because "Bank & tax" does not tell an applicant
   what they are being asked for. */
export const GATES: Gate[] = [
  { id: 'apply',   name: 'Application',          order: 1, owner: 'Marketplace onboarding desk', targetDays: 0, dualControl: false, waivable: true,
    what: 'Company details, the marketplaces you want to sell in, and expected monthly volume.' },
  { id: 'kyc',     name: 'KYC & due diligence',  order: 2, owner: 'Risk and compliance',         targetDays: 2, dualControl: true,  waivable: false,
    what: 'Registration, beneficial ownership over 25%, sanctions and PEP screening.' },
  { id: 'agree',   name: 'Agreements',           order: 3, owner: 'Legal',                       targetDays: 1, dualControl: true,  waivable: false,
    what: 'Marketplace terms, the data processing agreement and the commission schedule, e-signed.' },
  { id: 'finance', name: 'Bank & tax',           order: 4, owner: 'Finance',                     targetDays: 1, dualControl: true,  waivable: true,
    what: 'Settlement account, verified by micro-deposit, plus tax residency and withholding.' },
  /* Dual control buys nothing on a gate whose checks are machine-recorded, and
     it is not waivable for the same reason — there is nobody to waive it to. */
  { id: 'tech',    name: 'Technical readiness',  order: 5, owner: 'Platform engineering',        targetDays: 1, dualControl: false, waivable: false,
    what: 'Catalogue feed or portal upload, a reachable fulfilment webhook, and one sandbox order.' },
  { id: 'assure',  name: 'Compliance review',    order: 6, owner: 'Risk and compliance',         targetDays: 0, dualControl: true,  waivable: true,
    what: 'Security questionnaire, content policy acknowledgement and a sample listing audit.' },
  { id: 'golive',  name: 'Go-live',              order: 7, owner: 'Marketplace onboarding desk', targetDays: 0, dualControl: false, waivable: true,
    what: 'Storefront opened in the categories you were approved for, with your first listings live.' },
]

/** The published end-to-end SLA, computed rather than written down so it cannot
    drift away from the ladder it is the sum of. */
export const SLA_DAYS = GATES.reduce((n, g) => n + g.targetDays, 0)

/* Events a seller must be able to receive before going live. An event with
   nowhere to go is not queued and not retried — it does not arrive. */
export const REQUIRED_EVENTS = ['order.created', 'order.cancelled', 'stock.update']

/* Carried over from the prototype (_src/mp_shared.js:12711). The reasoning is
   shown in the UI, because a check whose purpose is invisible gets waived. */
export const TECH_CHECKS: TechCheck[] = [
  { id: 'registered', label: 'Endpoints registered for every required event',
    why: 'A required event with nowhere to go is not queued and not retried. It does not arrive.' },
  { id: 'auth', label: 'Every endpoint authenticates',
    why: 'Order payloads carry buyer data. An unauthenticated endpoint is a data leak with a URL.' },
  { id: 'tested', label: 'A signed test call acknowledged on each endpoint',
    why: 'Registration proves intent. An acknowledgement proves it works.' },
  { id: 'sandbox', label: 'One sandbox order completed end to end',
    why: 'The single requirement that removes most go-live failures.' },
]

const NO_AUTH = new Set(['', 'none'])

export function techStatus(
  endpoints: Endpoint[],
  calls: TestCall[],
  run: SandboxRun | null,
): TechStatus {
  const live = endpoints.filter(e => e.enabled)
  const covered = new Set(live.flatMap(e => e.events))
  const missing = REQUIRED_EVENTS.filter(ev => !covered.has(ev))
  const noAuth = live.filter(e => NO_AUTH.has((e.auth || '').trim().toLowerCase()))
  const acked = new Set(calls.filter(c => c.status === 'acknowledged').map(c => c.endpoint_id))
  const untested = live.filter(e => !acked.has(e.id))

  return {
    missing, noAuth, untested,
    checks: {
      registered: live.length > 0 && missing.length === 0,
      auth: live.length > 0 && noAuth.length === 0,
      tested: live.length > 0 && untested.length === 0,
      sandbox: run?.state === 'passed',
    },
  }
}

export function techReady(s: TechStatus): boolean {
  return TECH_CHECKS.every(c => s.checks[c.id])
}

export interface GateRow {
  id: string
  partner_id: string
  gate_name: string
  gate_order: number
  status: GateStatus
  notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
}

export interface TaskRow {
  id: string
  partner_id: string
  gate_id: string
  title: string
  detail: string
  owner: string
  due: string | null
  closed_by: string | null
  closed_at: string | null
}

export type ClearVerdict =
  | { ok: true }
  | { ok: false; reason: string; outstanding: TechCheck[] }

/* Rows carry the display name; the rules key off the stable id. */
export function gateIdFor(row: GateRow): string {
  return GATES.find(g => g.name === row.gate_name)?.id ?? ''
}

/* There is deliberately no override parameter. A caller cannot route around
   the technical gate because there is nothing to pass. */
export function canClearGate(gate: GateRow, all: GateRow[], tech: TechStatus): ClearVerdict {
  if (gate.status === 'cleared') {
    return { ok: false, reason: 'This gate is already cleared. Gates cannot be un-cleared — a partner that should not have progressed must be suspended instead.', outstanding: [] }
  }
  if (gate.status === 'failed') {
    return { ok: false, reason: 'This gate failed, which stops the application. It cannot be cleared afterwards — the seller reapplies with corrected documents, and that opens a new application.', outstanding: [] }
  }
  if (gate.status !== 'current') {
    return { ok: false, reason: 'This is not the current gate. Gates clear in order.', outstanding: [] }
  }
  if (gateIdFor(gate) === 'tech' && !techReady(tech)) {
    const outstanding = TECH_CHECKS.filter(c => !tech.checks[c.id])
    return {
      ok: false,
      outstanding,
      reason: `Technical readiness is not proved: ${outstanding.length} of ${TECH_CHECKS.length} checks outstanding. Each is a recorded check this gate enforces, not a live call to the seller's endpoints. No override exists for this gate.`,
    }
  }
  return { ok: true }
}

export function nextGate(gate: GateRow, all: GateRow[]): GateRow | null {
  return all.find(g => g.gate_order === gate.gate_order + 1) ?? null
}

/* State is derived from the gate, never stored. A stored status is a second
   opinion that can contradict the gate it belongs to.

   A failed gate is not a to-do list: one of its tasks is the reason it failed
   and the rest never got their turn. The two are told apart by whether the task
   carries a date — a task nobody ever owed anything on has none. */
export function deriveTaskState(task: TaskRow, gates: GateRow[]): 'done' | 'open' | 'blocked' | 'not_started' {
  const gate = gates.find(g => gateIdFor(g) === task.gate_id)
  if (!gate) return 'not_started'
  if (gate.status === 'cleared') return 'done'
  if (gate.status === 'current') return 'open'
  if (gate.status === 'failed') return task.due ? 'blocked' : 'not_started'
  return 'not_started'
}

/* ------------------------------------------------------------- journey ---- */

/** What the seller typed and attached at a gate. Recorded once, read by both
    consoles, and never editable by the party that submitted it — a record the
    submitter can rewrite is not evidence. */
export interface Submission {
  gate_id: string
  partner_id: string
  gate_key: string
  decision: string
  note: string | null
  /* [label, value] in the order the form asked. */
  fields: [string, string][]
}

export interface GateDocument {
  id: string
  gate_id: string
  partner_id: string
  name: string
  kind: string
  size: string
  uploaded_by: string | null
  uploaded_at: string | null
  sort_order: number
  /* Where the file lives in the evidence bucket. Null means the row is a claim
     with nothing behind it, which is a state the screens have to show. */
  path: string | null
}

/** One gate as the journey rail shows it: the row, its definition, what
    arrived, and how long it took against what it was supposed to take. */
export interface JourneyStep {
  row: GateRow & { owner: string; target_days: number; dual_control: boolean; waivable: boolean; evidence: string[]; submitted_at: string | null; submitted_by: string | null }
  gate: Gate
  submission: Submission | null
  documents: GateDocument[]
  /* Calendar days between submission and decision. Null while a gate is still
     open or has not been reached — an elapsed time on an undecided gate would
     be counting against a clock that has not stopped. */
  elapsedDays: number | null
  /* True only where a decided gate took longer than its target. Never true on a
     0-day target that decided the same day. */
  overTarget: boolean
}

const DAY = 24 * 60 * 60 * 1000

export function buildJourney(
  gates: readonly JourneyStep['row'][],
  submissions: readonly Submission[],
  documents: readonly GateDocument[],
): JourneyStep[] {
  return [...gates]
    .sort((a, b) => a.gate_order - b.gate_order)
    .map(row => {
      const gate = GATES.find(g => g.name === row.gate_name)
      const decided = row.status === 'cleared' || row.status === 'failed'
      const elapsedDays = decided && row.submitted_at && row.reviewed_at
        ? Math.max(0, Math.round((Date.parse(row.reviewed_at) - Date.parse(row.submitted_at)) / DAY))
        : null

      return {
        row,
        gate: gate ?? { id: '', name: row.gate_name, order: row.gate_order, owner: row.owner, targetDays: row.target_days, dualControl: row.dual_control, waivable: row.waivable, what: '' },
        submission: submissions.find(s => s.gate_id === row.id) ?? null,
        documents: documents.filter(d => d.gate_id === row.id).sort((a, b) => a.sort_order - b.sort_order),
        elapsedDays,
        overTarget: elapsedDays !== null && elapsedDays > row.target_days,
      }
    })
}

/** How far through the seven gates a seller is, for the rail's summary line. */
export function journeyProgress(steps: readonly JourneyStep[]): {
  cleared: number; total: number; current: JourneyStep | null; failed: JourneyStep | null; complete: boolean
} {
  const cleared = steps.filter(s => s.row.status === 'cleared').length
  return {
    cleared,
    total: steps.length,
    current: steps.find(s => s.row.status === 'current') ?? null,
    failed: steps.find(s => s.row.status === 'failed') ?? null,
    complete: steps.length > 0 && cleared === steps.length,
  }
}

/**
 * Each thing the gate demands, matched against what actually arrived. This is
 * the review: the gate's demand and the seller's submission are separate
 * records, and the gap between them is what the person clearing the gate is
 * deciding on.
 *
 * A text match, not a verdict — nothing here reads a document. It keys on the
 * demand's *longest* word rather than its first, because the first word is
 * usually the generic one and matches too much: "Tax residency certificate"
 * keyed on "tax" matched the field "Tax residency" and ticked a certificate
 * nobody had sent. Keyed on "certificate" it does not.
 *
 * A matching label is not enough on its own either: a gate still under review
 * carries fields whose value is the absence itself — "Treaty certificate: Not
 * yet supplied" is a label that matches and a fact that does not. So a field
 * counts only when its value does not read as an absence.
 *
 * The failure direction is deliberate. A match means something in the
 * submission names this and you should read it; no match means nothing does.
 * Neither means the demand is satisfied — that is the reviewer's job, which is
 * why clearing a gate asks them to type what they checked.
 */

/* "No match — OFAC, EU, UN, HMT" opens with "no" and is a *result*, so a bare
   leading negative is not enough to go on. These are the phrasings that say
   something has not happened rather than that it happened and found nothing. */
const ABSENT = /\bnot\s+(yet\s+)?(supplied|signed|assigned|started|run|tested|done|confirmed)\b|^not\s+yet\b|\bawaiting\b|^running\b/i

export function evidenceChecklist(step: JourneyStep): { demand: string; seen: boolean }[] {
  const sub = step.submission
  return step.row.evidence.map(demand => {
    if (!sub) return { demand, seen: false }
    const key = demand
      .toLowerCase()
      .split(/[^a-z0-9%]+/)
      .filter(Boolean)
      .reduce((longest, w) => (w.length > longest.length ? w : longest), '')
    if (!key) return { demand, seen: false }
    const seen =
      sub.fields.some(([label, value]) => label.toLowerCase().includes(key) && !ABSENT.test(value)) ||
      /* An attached document is present by definition — there is no value to
         contradict it. */
      step.documents.some(d => d.name.toLowerCase().includes(key))
    return { demand, seen }
  })
}
