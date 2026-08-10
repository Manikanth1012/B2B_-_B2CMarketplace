/**
 * When a subscription renews, and what that cycle costs.
 *
 * `next_renewal` is the date a customer agreed to be charged on, and until now
 * nothing in this build ever moved it. Three active monthly subscriptions sat
 * on 2026-08-09 until the calendar went past them — an active subscription
 * renewing in the past is one that has quietly stopped billing, and it took a
 * test noticing the next morning for anybody to know.
 *
 * Every rule here has a counterpart in SQL — `cycle_length`,
 * `renew_subscriptions` — for the same reason the settlement rules do: the run
 * has to charge and roll in one transaction, so it lives in the database; and a
 * screen has to say "renews on the 9th of next month, £12.99" for a cycle
 * nobody has run yet, so it lives here too. The integration suite checks the
 * two agree on every subscription on file.
 *
 * Dates are ISO strings and every computation is UTC.
 */

export type Cycle = 'Monthly' | 'Quarterly' | 'Half-yearly' | 'Yearly' | 'Annual'

export interface Subscription {
  id: string
  ref: string
  product_id: string
  product_name: string
  seller: string | null
  status: string
  auto_renew: boolean
  next_renewal: string | null
  ends_at: string | null
  resumes_at: string | null
  price: number
  currency: string
  cycle: string | null
}

export interface Charge {
  subscription_id: string
  ref: string
  period_start: string
  period_end: string
  period_label: string
  amount: number
  currency: string
}

const MONTHS: Record<string, number> = {
  monthly: 1, quarterly: 3, 'half-yearly': 6, yearly: 12, annual: 12,
}

const MONTH_NAME = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const utc = (s: string) => new Date(`${s}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)

/**
 * How many months a cycle is.
 *
 * Unknown means monthly rather than throwing. A cycle nobody recognises is a
 * data problem, and refusing to render the whole screen over it helps nobody —
 * the run's own skip list is where an unrecognised cycle should surface.
 */
export function cycleLength(cycle: string | null | undefined): number {
  return MONTHS[String(cycle ?? 'monthly').toLowerCase()] ?? 1
}

/**
 * The next date after `from` on the same billing day.
 *
 * Whole cycles from the agreed date, never "today plus a month". Somebody
 * billed on the 9th stays on the 9th however late the run is; adding a month to
 * the run date would walk their billing day forward every time anybody was slow.
 *
 * A day that does not exist in the target month lands on that month's last day,
 * which is what `Date.UTC` does with day 31 of February and is the behaviour
 * every billing system settles on eventually.
 */
export function advance(from: string, cycle: string | null, times = 1): string {
  const d = utc(from)
  const months = cycleLength(cycle) * times
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return iso(new Date(Date.UTC(
    target.getUTCFullYear(), target.getUTCMonth(), Math.min(d.getUTCDate(), lastDay))))
}

/** The first renewal date strictly after `on`, counting whole cycles. */
export function nextAfter(from: string, cycle: string | null, on: string): string {
  let next = from
  /* Bounded: a subscription abandoned for a decade on a monthly cycle is 120
     steps, and a loop with no ceiling on data nobody has checked is how a
     screen hangs. */
  for (let i = 0; i < 600 && next <= on; i++) next = advance(next, cycle)
  return next
}

export type SkipReason =
  | { kind: 'ends'; why: string }
  | { kind: 'no-auto-renew'; why: string }
  | { kind: 'not-active'; why: string }

/**
 * Why this subscription is not renewing, or null when it is.
 *
 * The same refusals the run reports, in the same words, so a screen can say
 * "this lapses on the 9th" before the date rather than after it.
 */
export function skipReason(s: Subscription): SkipReason | null {
  if (s.status !== 'active') {
    return { kind: 'not-active', why: `${s.ref} is ${s.status}, so nothing renews.` }
  }
  if (s.ends_at && s.next_renewal && s.ends_at <= s.next_renewal) {
    return {
      kind: 'ends',
      why: `Ends on ${s.ends_at}, before the renewal on ${s.next_renewal}. Nothing renewed and nothing charged.`,
    }
  }
  if (!s.auto_renew) {
    return {
      kind: 'no-auto-renew',
      why: `Auto-renew is off. It lapses on ${s.next_renewal ?? 'its end date'} rather than renewing, and the customer has to take it again.`,
    }
  }
  return null
}

/** Whether the run would pick this up on a given day. */
export function isDue(s: Subscription, on: string): boolean {
  return !!s.next_renewal && s.next_renewal <= on && skipReason(s) === null
}

/** What the cycle starting on the renewal date costs, and what it covers. */
export function chargeFor(s: Subscription): Charge | null {
  if (!s.next_renewal) return null
  const start = s.next_renewal
  const end = iso(new Date(utc(advance(start, s.cycle)).getTime() - 86_400_000))
  const d = utc(start)
  return {
    subscription_id: s.id,
    ref: s.ref,
    period_start: start,
    period_end: end,
    period_label: `${MONTH_NAME[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
    amount: Math.round(s.price * 100) / 100,
    currency: s.currency,
  }
}

export interface RunPlan {
  charge: Charge[]
  roll: { ref: string; from: string; to: string }[]
  skip: { ref: string; why: string }[]
}

/**
 * What a run on this date would do, without doing it.
 *
 * The screen that offers a renewal run should be able to say what it is about
 * to charge and to whom. A button that says "run" and reports afterwards is one
 * nobody presses twice.
 */
export function plan(subs: readonly Subscription[], on: string): RunPlan {
  const out: RunPlan = { charge: [], roll: [], skip: [] }
  for (const s of subs) {
    if (!s.next_renewal || s.next_renewal > on) continue
    const no = skipReason(s)
    if (no) { out.skip.push({ ref: s.ref, why: no.why }); continue }
    const c = chargeFor(s)
    if (c) out.charge.push(c)
    out.roll.push({ ref: s.ref, from: s.next_renewal, to: nextAfter(s.next_renewal, s.cycle, on) })
  }
  return out
}

/** What a customer is told about their own subscription, on their own screen. */
export function renewalLine(s: Subscription, on: string): string {
  if (s.status === 'paused') {
    return s.resumes_at ? `Paused — resumes ${s.resumes_at}` : 'Paused'
  }
  if (s.status !== 'active') return s.status[0].toUpperCase() + s.status.slice(1)
  if (!s.next_renewal) return 'No renewal date set'
  const no = skipReason(s)
  if (no) return no.kind === 'ends' ? `Ends ${s.ends_at}` : `Lapses ${s.next_renewal}`
  /* A date in the past on an active subscription is the defect this module was
     written for, and a screen should say so rather than print it plainly. */
  if (s.next_renewal < on) return `Overdue for renewal since ${s.next_renewal}`
  return `Renews ${s.next_renewal}`
}
