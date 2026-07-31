/* Refunds — who decides, by when, and what happens when nobody does.
   No React and no Supabase, so the rules can be tested without a network.

   The whole subject turns on one distinction. A refund is between a CUSTOMER
   and the party that sold to them, and it is the seller's revenue going back,
   so the seller decides on their own products. The marketplace decides what it
   sold itself, and steps in on a third-party refund only where a rule it
   published says it must. */

export type RefundState =
  | 'requested' | 'approved' | 'refunded' | 'declined' | 'escalated' | 'partial'

export type RefundReason =
  | 'not-received' | 'faulty' | 'not-activated' | 'duplicate'
  | 'cancelled' | 'unauthorised' | 'changed-mind'

export type Decider = 'seller' | 'marketplace' | 'auto'

export interface Refund {
  id: string
  order_ref: string
  product_id: string
  item: string
  category_id: string | null
  partner_id: string | null
  seller: string
  first_party: boolean
  bundle_ref: string | null
  customer: string
  buyer_type: 'consumer' | 'enterprise'
  user_id: string | null
  amount: number
  refunded: number | null
  currency: string
  reason: RefundReason
  detail: string | null
  evidence: string | null
  requested: string
  decider: Decider
  sla_due: string
  state: RefundState
  decided_on: string | null
  decided_by: string | null
  decision_note: string | null
  escalated_on: string | null
  escalated_why: string | null
  sort_order: number
}

export interface RefundPolicy {
  seller_sla_hours: number
  escalate_after_hours: number
  auto_approve_below: number
  auto_approve_reasons: RefundReason[]
  escalation_rule: string
  marketplace_decides_when: string
  funded_by: string
  store_credit: string
}

export interface StateSpec {
  label: string
  final: boolean
  /* Whose move it is, or whose it was. Blank on a final state — nobody's move. */
  who: string
  meaning: string
}

export const STATES: Record<RefundState, StateSpec> = {
  requested: {
    label: 'Requested', final: false, who: 'Waiting on whoever sold it',
    meaning: 'The clock is running against the response SLA.',
  },
  approved: {
    label: 'Approved', final: false, who: 'Waiting on the payment run',
    meaning: 'Agreed. The money is queued back to the instrument that paid.',
  },
  refunded: {
    label: 'Refunded', final: true, who: '',
    meaning: 'Money returned. It appears as a deduction on the seller’s next statement.',
  },
  declined: {
    label: 'Declined', final: true, who: '',
    meaning: 'Refused with a reason. It stands unless the customer escalates it.',
  },
  escalated: {
    label: 'Escalated', final: false, who: 'Waiting on the marketplace',
    meaning: 'The clock ran out with it unresolved, so the marketplace decides it. Nobody had to ask for that.',
  },
  partial: {
    label: 'Partly refunded', final: true, who: '',
    meaning: 'Less than the full amount, with the difference explained.',
  },
}

export interface ReasonSpec {
  label: string
  /* What settles the argument. Written as the thing to produce, not as a
     category, because "evidence" on its own tells a seller nothing. */
  evidence: string
  /* Whether a decision on it is a matter of record rather than of judgement. */
  provable: boolean
}

export const REASONS: Record<RefundReason, ReasonSpec> = {
  'not-received':  { label: 'Never arrived',              evidence: 'Tracking or the activation record', provable: false },
  'faulty':        { label: 'Faulty or not as described', evidence: 'A photograph or a fault report',     provable: false },
  'not-activated': { label: 'Service never activated',    evidence: 'The provisioning log',               provable: false },
  'duplicate':     { label: 'Charged twice',              evidence: 'Both charge references',             provable: true },
  'cancelled':     { label: 'Cancelled within the window', evidence: 'The cancellation timestamp',        provable: true },
  'unauthorised':  { label: 'I did not authorise this',   evidence: 'An account access review',           provable: false },
  'changed-mind':  { label: 'Changed my mind',            evidence: 'None required inside the window',    provable: false },
}

export const REASON_LIST: { id: RefundReason; label: string; evidence: string }[] =
  (Object.keys(REASONS) as RefundReason[]).map(id => ({ id, ...REASONS[id] }))

/* ========================================================================= */
/* The clock                                                                 */
/* ========================================================================= */

export type SlaLevel = 'settled' | 'ok' | 'today' | 'overdue' | 'gone'

export interface Sla {
  level: SlaLevel
  days: number
  /* One line a seller can act on. Never "SLA: 2 days" — the number on its own
     does not say what happens when it runs out. */
  text: string
}

const DAY = 86400000

function toUtc(iso: string): number {
  return new Date(iso + 'T00:00:00Z').getTime()
}

function todayUtc(now: Date): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
}

/**
 * Where a refund stands against its response deadline.
 *
 * The escalation clock is separate from the SLA and longer than it: the SLA is
 * when the answer was owed, escalation is when the marketplace stops waiting.
 * A seller who is past the first but not the second still has the decision.
 */
export function sla(refund: Refund, policy: RefundPolicy, now: Date): Sla {
  if (STATES[refund.state].final) {
    return { level: 'settled', days: 0, text: 'Closed.' }
  }
  if (refund.state === 'escalated') {
    return {
      level: 'gone', days: 0,
      text: 'The marketplace decides this now. It is out of the seller’s hands.',
    }
  }
  if (refund.state === 'approved') {
    return { level: 'settled', days: 0, text: 'Agreed — waiting on the payment run.' }
  }

  const days = Math.round((toUtc(refund.sla_due) - todayUtc(now)) / DAY)
  const escalateOn = toUtc(refund.requested) + policy.escalate_after_hours * 3600000
  const untilEscalation = Math.round((escalateOn - todayUtc(now)) / DAY)

  if (days > 1) return { level: 'ok', days, text: `An answer is owed in ${days} days.` }
  if (days === 1) return { level: 'ok', days, text: 'An answer is owed tomorrow.' }
  if (days === 0) return { level: 'today', days, text: 'An answer is owed today.' }

  const late = Math.abs(days)
  if (untilEscalation <= 0) {
    return {
      level: 'overdue', days,
      text: `${late} days past the deadline and past the escalation clock. The marketplace can take this decision away at any time.`,
    }
  }
  return {
    level: 'overdue', days,
    text: untilEscalation === 1
      ? `${late} day${late === 1 ? '' : 's'} late. It escalates to the marketplace tomorrow.`
      : `${late} days late. It escalates to the marketplace in ${untilEscalation} days.`,
  }
}

/** Whether the clock has run out on a request nobody has answered. Written as a
    rule rather than a button on purpose: a customer who has to know to press
    something to get a fair hearing is a customer we have quietly failed. */
export function escalationDue(refund: Refund, policy: RefundPolicy, now: Date): boolean {
  if (refund.state !== 'requested') return false
  if (refund.decider !== 'seller') return false
  return now.getTime() >= toUtc(refund.requested) + policy.escalate_after_hours * 3600000
}

/* ========================================================================= */
/* Who decides                                                               */
/* ========================================================================= */

export interface Ownership { owner: 'seller' | 'marketplace'; because: string }

/** Who this refund belongs to, and why it belongs to them. The reason matters:
    a seller who loses a decision without being told why concludes the
    marketplace simply took it. */
export function ownership(refund: Refund): Ownership {
  if (refund.first_party) {
    return { owner: 'marketplace', because: 'The marketplace sold this itself, so it both decides and funds it.' }
  }
  if (refund.bundle_ref) {
    return { owner: 'marketplace', because: 'It was sold inside a bundle the marketplace assembled, so the marketplace answers for the whole.' }
  }
  if (refund.state === 'escalated') {
    return { owner: 'marketplace', because: refund.escalated_why ?? 'The escalation clock ran out.' }
  }
  if (refund.decider === 'marketplace') {
    return { owner: 'marketplace', because: 'A published rule puts this decision with the marketplace.' }
  }
  return { owner: 'seller', because: 'It is the seller’s product and the seller’s revenue going back, so the seller decides.' }
}

/** Who ends up out of pocket. Not the same question as who decides, and the
    difference is the one sellers most often get wrong. */
export function fundedBy(refund: Refund, policy: RefundPolicy): string {
  if (refund.first_party) return 'The marketplace. It sold this itself, so it carries the cost.'
  return policy.funded_by
}

/** Would this decide itself? A duplicate charge is provable from the payment
    records and is never a judgement call; below the small-claim threshold,
    arguing costs both sides more than the refund. */
export function autoApproves(
  reason: RefundReason, amount: number, policy: RefundPolicy,
): { yes: boolean; because: string } {
  if (policy.auto_approve_reasons.includes(reason)) {
    return { yes: true, because: `${REASONS[reason].label} is provable from the record, so it is not a judgement call.` }
  }
  if (amount < policy.auto_approve_below) {
    return { yes: true, because: `Under the $${policy.auto_approve_below.toFixed(2)} threshold, where arguing about it costs both sides more than the refund.` }
  }
  return { yes: false, because: 'Somebody has to decide this one.' }
}

/* ========================================================================= */
/* Deciding                                                                  */
/* ========================================================================= */

export type Check = { ok: true } | { ok: false; reason: string }

export type Decision = 'approve' | 'decline' | 'partial'

/** May this persona decide this refund? */
export function canDecide(
  refund: Refund, as: 'seller' | 'marketplace',
): Check {
  if (STATES[refund.state].final) {
    return { ok: false, reason: `This is already ${STATES[refund.state].label.toLowerCase()}. A closed refund is not reopened — the customer raises a new request or the marketplace overturns it.` }
  }
  if (refund.state === 'approved') {
    return { ok: false, reason: 'This is agreed and queued to the payment run. There is nothing left to decide.' }
  }
  const own = ownership(refund)
  if (own.owner !== as) {
    return { ok: false, reason: as === 'seller'
      ? `This one is not yours to decide. ${own.because}`
      : 'The seller still owns this one. It comes to the marketplace when the clock runs out, not before.' }
  }
  return { ok: true }
}

/**
 * A decision, with what makes it a decision rather than a click.
 *
 * A decline needs a reason the customer can read, because a decline with no
 * reason on it is the thing that becomes a chargeback. A part refund needs the
 * difference explained, for the same reason and to the same person.
 */
export function validateDecision(
  { decision, amount, refunded, note, reason, evidence }: {
    decision: Decision
    amount: number
    refunded: number
    note: string
    reason: RefundReason
    evidence: string | null
  },
): Check {
  const words = note.trim().split(/\s+/).filter(Boolean).length

  if (decision === 'partial') {
    if (!(refunded > 0)) return { ok: false, reason: 'A part refund has to return something. To return nothing, decline it.' }
    if (refunded >= amount) return { ok: false, reason: `That is the whole amount. To return all $${amount.toFixed(2)}, approve it instead.` }
    if (words < 8) {
      return { ok: false, reason: 'Explain the difference. "Refunded three of twelve units, the other nine were kept" is what stops this coming back as a chargeback.' }
    }
    return { ok: true }
  }

  if (decision === 'decline') {
    if (words < 8) {
      return { ok: false, reason: 'A decline needs a reason the customer can read. One with nothing on it is the one that comes back as a chargeback.' }
    }
    if (!REASONS[reason].provable && !evidence) {
      /* Not a hard block on evidence the seller does not have — a block on
         declining a judgement call while pointing at nothing. */
      return { ok: false, reason: `You are declining "${REASONS[reason].label.toLowerCase()}" with nothing on the record. ${REASONS[reason].evidence} would settle it; a decline the marketplace cannot evidence escalates on its own.` }
    }
    return { ok: true }
  }

  if (words < 3) {
    return { ok: false, reason: 'Say a line about why you are agreeing. It is what the next person reads when the same claim arrives again.' }
  }
  return { ok: true }
}

/** What the record becomes. Kept here so the seller's console and the
    marketplace's cannot write two different shapes of the same decision. */
export function applyDecision(
  { decision, refunded }: { decision: Decision; refunded: number },
): { state: RefundState; refunded: number | null } {
  if (decision === 'decline') return { state: 'declined', refunded: null }
  if (decision === 'partial') return { state: 'partial', refunded: +refunded.toFixed(2) }
  /* Approved rather than refunded: the money has not moved yet. Saying
     "refunded" before the payment run has is how a customer is told twice that
     they have been paid and is not. */
  return { state: 'approved', refunded: null }
}

/* ========================================================================= */
/* Reading a book of them                                                    */
/* ========================================================================= */

export interface Summary {
  open: number
  /* Money that will leave if every open request is granted. Not a prediction —
     a ceiling, and the only number worth putting at the top of the page. */
  atStake: number
  overdue: number
  escalated: number
  decided: number
  refundedValue: number
  /* Of the ones that closed, how many did not cost the seller anything. Null
     when nothing has closed, because 0% and "nothing yet" are different. */
  heldPct: number | null
}

export function summarise(refunds: readonly Refund[], now: Date): Summary {
  const open = refunds.filter(r => !STATES[r.state].final)
  const closed = refunds.filter(r => STATES[r.state].final)
  const held = closed.filter(r => r.state === 'declined')
  const today = todayUtc(now)
  return {
    open: open.length,
    atStake: +open.reduce((n, r) => n + Number(r.amount), 0).toFixed(2),
    overdue: refunds.filter(r => r.state === 'requested' && toUtc(r.sla_due) < today).length,
    escalated: refunds.filter(r => r.state === 'escalated').length,
    decided: closed.length,
    refundedValue: +closed.reduce((n, r) => n + Number(r.refunded ?? 0), 0).toFixed(2),
    heldPct: closed.length === 0 ? null : Math.round((held.length / closed.length) * 1000) / 10,
  }
}

/** The queue, in the order somebody should work it: what is late, then what is
    closest to being late, then everything that no longer needs a decision. */
export function queue(refunds: readonly Refund[], policy: RefundPolicy, now: Date): Refund[] {
  const rank = (r: Refund): number => {
    if (r.state === 'requested') {
      const s = sla(r, policy, now)
      return s.level === 'overdue' ? 0 : s.level === 'today' ? 1 : 2
    }
    if (r.state === 'escalated') return 3
    if (r.state === 'approved') return 4
    return 5
  }
  return refunds.slice().sort((a, b) =>
    rank(a) - rank(b)
    || toUtc(a.sla_due) - toUtc(b.sla_due)
    || Number(b.amount) - Number(a.amount))
}

/** What the seller is on the hook for by marketplace, so a pattern in one
    category is visible rather than averaged away. */
export function byCategory(refunds: readonly Refund[]): {
  category_id: string; open: number; value: number; total: number
}[] {
  const map = new Map<string, { open: number; value: number; total: number }>()
  for (const r of refunds) {
    const key = r.category_id ?? 'unknown'
    const row = map.get(key) ?? { open: 0, value: 0, total: 0 }
    row.total += 1
    if (!STATES[r.state].final) { row.open += 1; row.value += Number(r.amount) }
    map.set(key, row)
  }
  return [...map.entries()]
    .map(([category_id, v]) => ({ category_id, ...v, value: +v.value.toFixed(2) }))
    .sort((a, b) => b.open - a.open || b.total - a.total)
}

/** Which sellers are letting the clock run. The operator's version of the
    queue: not who has the most refunds, but who is not answering them. */
export function slowSellers(refunds: readonly Refund[], now: Date): {
  partner_id: string; seller: string; overdue: number; escalated: number; value: number
}[] {
  const today = todayUtc(now)
  const map = new Map<string, { seller: string; overdue: number; escalated: number; value: number }>()
  for (const r of refunds) {
    if (!r.partner_id) continue
    const late = r.state === 'requested' && toUtc(r.sla_due) < today
    const esc = r.state === 'escalated'
    if (!late && !esc) continue
    const row = map.get(r.partner_id) ?? { seller: r.seller, overdue: 0, escalated: 0, value: 0 }
    if (late) row.overdue += 1
    if (esc) row.escalated += 1
    row.value += Number(r.amount)
    map.set(r.partner_id, row)
  }
  return [...map.entries()]
    .map(([partner_id, v]) => ({ partner_id, ...v, value: +v.value.toFixed(2) }))
    .sort((a, b) => (b.overdue + b.escalated) - (a.overdue + a.escalated) || b.value - a.value)
}

/** The refund window for a marketplace, and what it means there. */
export function windowFor(
  categoryId: string | null,
  windows: readonly { category_id: string; days: number; note: string }[],
): { days: number; note: string } | null {
  return windows.find(w => w.category_id === categoryId) ?? null
}

/** Whether a customer is still inside the window for this purchase. Advisory:
    a faulty product is refundable past the window, so this informs the decision
    rather than making it. */
export function insideWindow(
  purchased: string, categoryId: string | null,
  windows: readonly { category_id: string; days: number; note: string }[],
  now: Date,
): { inside: boolean; days: number; window: number } | null {
  const w = windowFor(categoryId, windows)
  if (!w) return null
  const elapsed = Math.round((todayUtc(now) - toUtc(purchased)) / DAY)
  return { inside: elapsed <= w.days, days: elapsed, window: w.days }
}
