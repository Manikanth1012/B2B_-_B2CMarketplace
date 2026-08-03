/* Subscription presentation rules, pure. No React — so the states can be tested
   without a DOM, and there is one place that decides what a paused subscription
   says rather than three branches inside a template. */

export interface SubscriptionRow {
  status: string
  auto_renew: boolean
  started_at: string
  next_renewal: string | null
  ends_at: string | null
  resumes_at: string | null
  price: number
  currency: string
  cycle: string | null
}

/* `next_renewal`, `ends_at` and `resumes_at` are SQL dates — 'YYYY-MM-DD', no time
   and no zone. `new Date('2026-08-02')` parses that as UTC midnight, which prints as
   1 August anywhere west of Greenwich. A renewal date shown a day early is a support
   ticket, so date-only values are formatted from their parts and never through a
   Date. `started_at` is a real timestamptz and is left to the platform. */
export function formatDateOnly(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  if (!y || !m || !d) return iso
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${d} ${MONTHS[m - 1]} ${y}`
}

export function isActive(s: { status: string }): boolean {
  return s.status.toLowerCase() === 'active'
}

export function isPaused(s: { status: string }): boolean {
  return s.status.toLowerCase() === 'paused'
}

export function isCancelled(s: { status: string }): boolean {
  return s.status.toLowerCase() === 'cancelled'
}

/**
 * The line under the title. Each status is answering a different question, so they
 * do not share a sentence:
 *   active    — when does this next take my money?
 *   paused    — when does it start again? (it still holds the slot, and still bills)
 *   cancelled — how long do I keep access?
 * An active subscription with auto-renew off is not the same as a cancelled one: it
 * runs to its next date and stops there, which is worth saying plainly.
 */
export function statusLine(s: SubscriptionRow): string {
  if (isPaused(s)) {
    return s.resumes_at ? `Paused · resumes ${formatDateOnly(s.resumes_at)}` : 'Paused'
  }
  if (isCancelled(s)) {
    return s.ends_at ? `Cancelled · access until ${formatDateOnly(s.ends_at)}` : 'Cancelled'
  }
  if (!s.next_renewal) return s.auto_renew ? 'Active' : 'Auto-renew off'
  return s.auto_renew
    ? `Renews ${formatDateOnly(s.next_renewal)}`
    : `Ends ${formatDateOnly(s.next_renewal)} — auto-renew off`
}

/** What the consumer is committed to each month. Paused and cancelled rows are not
    billing, so they do not count towards it. */
export function monthlyTotal(subs: readonly SubscriptionRow[]): number {
  return subs.filter(isActive).reduce((sum, s) => sum + s.price, 0)
}

/**
 * The currency these subscriptions are billed in.
 *
 * One account is billed in one currency — a subscription is a line on a bill,
 * and a bill has a single currency — so this is a lookup, not a sum. Returns
 * null when the rows disagree, because a total across two currencies is a
 * number with no meaning and the caller has to be able to tell.
 */
export function billingCurrency(subs: readonly SubscriptionRow[]): string | null {
  const seen = [...new Set(subs.map(s => s.currency).filter(Boolean))]
  return seen.length === 1 ? seen[0] : null
}

/** Which controls a row should offer. A cancelled subscription offers none — it has
    already run its course, and re-subscribing is a purchase, not a toggle. */
export function actionsFor(s: SubscriptionRow): {
  canToggleRenew: boolean
  canCancel: boolean
  canResume: boolean
} {
  return {
    canToggleRenew: isActive(s),
    canCancel: isActive(s) || isPaused(s),
    /* Without this a paused subscription is a dead end: the old screen only rendered
       controls for active rows, so nothing could ever bring it back. */
    canResume: isPaused(s),
  }
}
