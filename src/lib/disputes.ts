/**
 * One desk, four kinds of argument.
 *
 * A dispute is money in limbo with somebody waiting for an answer, and this
 * marketplace can produce four of them: a buyer against a seller on an order, an
 * account against the marketplace on an invoice, a seller against the
 * marketplace on a settlement statement, and a seller against the marketplace on
 * a credit or debit note. Only the first was ever a record; the rest were a flag
 * and, at best, a sentence.
 *
 * Three ideas run through this module.
 *
 * A DISPUTE IS NOT A TICKET. A ticket is a question and the worst case is that
 * somebody is annoyed. A dispute holds money — somebody is not being paid, or is
 * paying for something they say they did not get — and it has a clock on it. The
 * two are ranked completely differently and merging them makes every question
 * look like a claim.
 *
 * WHO IS OUT OF POCKET DECIDES THE ORDER. Not age, not amount. A seller whose
 * statement is frozen is not being paid at all while the argument runs; a buyer
 * disputing a delivered order still has the goods. Both matter, and only one is
 * bleeding.
 *
 * NEVER SUM ACROSS CURRENCIES. The book is INR, KES, AED and USD, and "at stake"
 * is several figures or it is a quantity of nothing.
 */

import { byCurrency, money } from './money'
import type { Money } from './money'

/** One currency's worth, as `byCurrency` reports it. Never flattened into one. */
export type CurrencyGroup = { currency: string; total: Money; count: number }

export type DisputeKind = 'order' | 'invoice' | 'statement' | 'note'
export type DisputeStatus =
  'open' | 'awaiting_seller' | 'awaiting_marketplace' | 'resolved' | 'rejected'
export type DisputeOutcome =
  'refunded' | 'redelivered' | 'partial' | 'upheld_seller' | 'withdrawn'
export type DisputeOwner = 'seller' | 'marketplace' | 'buyer'

export interface DisputeRow {
  id: string
  kind: DisputeKind
  subject_ref: string
  partner_id: string | null
  account_id: string | null
  order_ref: string | null
  product_id: string | null
  category_id: string | null
  reason: string
  detail: string | null
  claimant: string
  raised: string
  amount: number
  currency: string
  owner: DisputeOwner
  status: DisputeStatus
  due_on: string | null
  outcome: DisputeOutcome | null
  resolution: string | null
  resolved_on: string | null
  sort_order: number
}

/* ------------------------------------------------------------- the vocabulary -- */

export const KIND_LABEL: Record<DisputeKind, string> = {
  order: 'An order',
  invoice: 'An invoice',
  statement: 'A settlement statement',
  note: 'A credit or debit note',
}

/** Who is arguing with whom. The screen leads with this because it decides everything else. */
export const KIND_PARTIES: Record<DisputeKind, string> = {
  order: 'A buyer against a seller. The marketplace holds the ring.',
  invoice: 'An account against the marketplace. We are the ones being disputed.',
  statement: 'A seller against the marketplace, about what we say we owe them.',
  note: 'A seller against an adjustment the marketplace raised on them.',
}

export const STATUS_LABEL: Record<DisputeStatus, string> = {
  open: 'Open',
  awaiting_seller: 'With the seller',
  awaiting_marketplace: 'With us',
  resolved: 'Resolved',
  rejected: 'Rejected',
}

export const STATUS_TONE: Record<DisputeStatus, string> = {
  open: 'pending',
  awaiting_seller: 'current',
  awaiting_marketplace: 'degraded',
  resolved: 'healthy',
  rejected: 'draft',
}

export const OUTCOME_LABEL: Record<DisputeOutcome, string> = {
  refunded: 'Refunded to the buyer',
  redelivered: 'Replaced at the seller’s cost',
  partial: 'Partially refunded',
  upheld_seller: 'Decided in the seller’s favour',
  withdrawn: 'Withdrawn by the claimant',
}

export function isClosed(d: Pick<DisputeRow, 'status'>): boolean {
  return d.status === 'resolved' || d.status === 'rejected'
}

/* ---------------------------------------------------------------- the clock -- */

const DAY = 86400000

/** Days until it is due, negative once it is late. Null when nothing set a date. */
export function daysLeft(d: Pick<DisputeRow, 'due_on'>, today: string): number | null {
  if (!d.due_on) return null
  const due = Date.parse(`${d.due_on}T00:00:00Z`)
  const now = Date.parse(`${today}T00:00:00Z`)
  if (Number.isNaN(due) || Number.isNaN(now)) return null
  return Math.round((due - now) / DAY)
}

export function isLate(d: Pick<DisputeRow, 'due_on' | 'status'>, today: string): boolean {
  if (isClosed(d)) return false
  const left = daysLeft(d, today)
  return left !== null && left < 0
}

/** How long it has been running, which is the figure a claimant quotes back. */
export function ageInDays(d: Pick<DisputeRow, 'raised'>, today: string): number {
  const from = Date.parse(`${d.raised}T00:00:00Z`)
  const now = Date.parse(`${today}T00:00:00Z`)
  return Math.max(0, Math.round((now - from) / DAY))
}

/** The clock, in words, for somebody who has to decide what to do about it. */
export function clockLine(d: DisputeRow, today: string): string {
  if (isClosed(d)) {
    return d.resolved_on
      ? `Closed on ${d.resolved_on}, ${ageInDays({ raised: d.raised }, d.resolved_on)} days after it was raised.`
      : 'Closed.'
  }
  const left = daysLeft(d, today)
  const age = ageInDays(d, today)
  if (left === null) return `Open ${age} days with no date on it — nobody is late on this.`
  if (left < 0) return `${-left} days late, and open ${age} days.`
  if (left === 0) return `Due today, and open ${age} days.`
  return `Due in ${left} days, open ${age} so far.`
}

/* ----------------------------------------------------------- who is bleeding -- */

/**
 * Whether the claimant is out of pocket while this runs.
 *
 * This is the distinction that orders the queue. A seller whose statement is
 * frozen or whose note is stopping their settlement is not being paid at all
 * until somebody decides. An account disputing an invoice is holding its own
 * money — uncomfortable, not bleeding. A buyer disputing a delivered order
 * usually has the goods.
 *
 * An order dispute where the marketplace is holding the seller's money is the
 * exception, and it is the one people forget.
 */
export function withholding(d: DisputeRow): boolean {
  if (isClosed(d)) return false
  if (d.kind === 'statement' || d.kind === 'note') return true
  return d.kind === 'order' && d.owner === 'marketplace'
}

/** Said plainly, because "withholding: true" is not something to put on a screen. */
export function pressureLine(d: DisputeRow): string {
  if (isClosed(d)) return 'Nothing is held.'
  switch (d.kind) {
    case 'statement':
      return 'This seller is not being paid at all while it is open.'
    case 'note':
      return 'The adjustment does not settle while it is open, so their payout is short by it.'
    case 'invoice':
      return 'The account is holding the money. Nothing is suspended and nothing is chasing.'
    case 'order':
      return d.owner === 'marketplace'
        ? 'We are holding the seller’s money on this order until it is decided.'
        : 'The seller has been asked to answer. Nothing is held from them yet.'
  }
}

/* ---------------------------------------------------------------- the queue -- */

/**
 * What to work, worst first.
 *
 * Somebody being unpaid beats somebody being late, and both beat somebody who
 * has merely asked. Within a band, the latest against its own clock — because a
 * dispute five days past a five-day promise is a broken promise, and one five
 * days into a thirty-day one is not.
 */
export function workQueue(disputes: readonly DisputeRow[], today: string): DisputeRow[] {
  const rank = (d: DisputeRow): number => {
    if (isClosed(d)) return 4
    if (withholding(d) && isLate(d, today)) return 0
    if (withholding(d)) return 1
    if (isLate(d, today)) return 2
    return 3
  }
  return [...disputes].sort((a, b) => {
    const r = rank(a) - rank(b)
    if (r !== 0) return r
    const la = daysLeft(a, today) ?? 9999
    const lb = daysLeft(b, today) ?? 9999
    if (la !== lb) return la - lb
    return b.amount - a.amount
  })
}

export interface AtStake {
  /* Money the claimant is not getting while this runs. The figure that belongs
     on a screen by itself, because it is somebody's payroll. */
  withheld: CurrencyGroup[]
  /* Claimed and not withheld — real exposure, nobody starving. */
  claimed: CurrencyGroup[]
  open: number
  late: number
  bleeding: number
}

export function atStake(disputes: readonly DisputeRow[], today: string): AtStake {
  const live = disputes.filter(d => !isClosed(d))
  const held = live.filter(withholding)
  return {
    withheld: byCurrency(held.map(d => money(d.amount, d.currency))),
    claimed: byCurrency(live.filter(d => !withholding(d)).map(d => money(d.amount, d.currency))),
    open: live.length,
    late: live.filter(d => isLate(d, today)).length,
    bleeding: held.length,
  }
}

/* ------------------------------------------------------------- closing one -- */

/**
 * Whether it can be closed, and what is missing.
 *
 * The rule the database enforces too: a closed dispute says which way it went
 * and why. Without an outcome nobody can tell who paid; without a resolution the
 * person who raised it has been ignored rather than answered.
 */
export function canClose(
  d: DisputeRow, outcome: DisputeOutcome | null, resolution: string,
): { ok: true } | { ok: false; reason: string } {
  if (isClosed(d)) return { ok: false, reason: `${d.id} is already ${STATUS_LABEL[d.status].toLowerCase()}.` }
  if (!outcome) {
    return { ok: false, reason: 'Say which way it went. Without an outcome nobody can tell who paid.' }
  }
  if (!resolution.trim()) {
    return {
      ok: false,
      reason: `${d.claimant} raised this and is owed an answer, whichever way it goes.`,
    }
  }
  return { ok: true }
}

/**
 * What closing it will actually do, before somebody does it.
 *
 * Each kind releases something different at the source, and the note is the one
 * worth spelling out — the outcome decides whether the adjustment stands.
 */
export function closingEffect(d: DisputeRow, outcome: DisputeOutcome | null): string {
  switch (d.kind) {
    case 'invoice':
      return `${d.subject_ref} goes back to being payable. The balance is unchanged — settling the argument is not the same as settling the invoice.`
    case 'statement':
      return `${d.subject_ref} stops being disputed and can be approved and paid on its cycle.`
    case 'note':
      return outcome === 'upheld_seller'
        ? `${d.subject_ref} is voided with this resolution as the reason. The seller keeps the money.`
        : `${d.subject_ref} goes back to issued and applies at the seller's next settlement run.`
    case 'order':
      return d.owner === 'marketplace'
        ? 'Whatever is held against the seller on this order is released at the next run.'
        : 'The order dispute closes. Nothing else moves on its own.'
  }
}

/** Which outcomes make sense for a kind. Offering all five everywhere invites the wrong one. */
export function outcomesFor(kind: DisputeKind): DisputeOutcome[] {
  if (kind === 'order') return ['refunded', 'redelivered', 'partial', 'upheld_seller', 'withdrawn']
  /* Nothing is redelivered on a money argument — there is no goods leg. */
  return ['refunded', 'partial', 'upheld_seller', 'withdrawn']
}

/* ----------------------------------------------------------- how it is doing -- */

export interface Record_ {
  closed: number
  /* "Won" from the marketplace's side means we did not pay: upheld, withdrawn,
     or replaced by the seller at their own cost. */
  upheld: number
  paidOut: number
  upheldPct: number | null
  medianDays: number | null
}

export function record(disputes: readonly DisputeRow[]): Record_ {
  const closed = disputes.filter(isClosed)
  const upheld = closed.filter(d =>
    d.outcome === 'upheld_seller' || d.outcome === 'withdrawn' || d.outcome === 'redelivered')
  const days = closed
    .filter(d => d.resolved_on)
    .map(d => ageInDays({ raised: d.raised }, d.resolved_on!))
    .sort((a, b) => a - b)
  return {
    closed: closed.length,
    upheld: upheld.length,
    paidOut: closed.length - upheld.length,
    upheldPct: closed.length === 0 ? null : Math.round((upheld.length / closed.length) * 1000) / 10,
    medianDays: days.length === 0 ? null : days[Math.floor(days.length / 2)],
  }
}

/* --------------------------------------------------------------- consistency -- */

/**
 * Where the book disagrees with itself.
 *
 * The interesting one is the last pair: a source still flagged as disputed with
 * the case closed, or a case open against a source that is not flagged. Either
 * way somebody is looking at one of them and believing it.
 */
export function disputeProblems(
  disputes: readonly DisputeRow[],
  flagged: { kind: DisputeKind; ref: string }[],
): string[] {
  const out: string[] = []

  for (const d of disputes) {
    if (isClosed(d) && (!d.outcome || !(d.resolution ?? '').trim())) {
      out.push(`${d.id} is closed with no answer on it.`)
    }
    if (!isClosed(d) && d.outcome) {
      out.push(`${d.id} is still open and already carries an outcome of "${d.outcome}".`)
    }
    if (d.resolved_on && d.resolved_on < d.raised) {
      out.push(`${d.id} was resolved on ${d.resolved_on}, before it was raised on ${d.raised}.`)
    }
    if (d.kind === 'order' && !d.order_ref) {
      out.push(`${d.id} is an order dispute naming no order.`)
    }
  }

  const openKey = new Set(disputes.filter(d => !isClosed(d)).map(d => `${d.kind}:${d.subject_ref}`))
  const flagKey = new Set(flagged.map(f => `${f.kind}:${f.ref}`))

  for (const f of flagKey) {
    if (!openKey.has(f)) out.push(`${f.split(':')[1]} is marked disputed and no case is open on it.`)
  }
  for (const k of openKey) {
    const [kind, ref] = k.split(':')
    if (kind === 'order') continue   /* an order carries no disputed flag of its own */
    if (!flagKey.has(k)) out.push(`${ref} has an open dispute and is not marked disputed at the source.`)
  }

  return out
}

/** One sentence naming what is being argued about and by whom. */
export function line(d: DisputeRow): string {
  return `${d.claimant} against ${d.subject_ref} — ${d.reason.toLowerCase()}.`
}
