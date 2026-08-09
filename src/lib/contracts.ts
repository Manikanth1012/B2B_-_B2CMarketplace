/**
 * The agreement an account buys under.
 *
 * No React and no Supabase, so the rules can be tested without a network.
 *
 * A contract here settles everything except the price. Nothing is negotiated on
 * this marketplace — every account buys at the published price for its market —
 * so there is no rate card hanging off this, and `term_value` is a figure the
 * account stated rather than a commitment that buys anything. CR-008 records the
 * boundary; this module is what is left once pricing is out of it, which is
 * still the thing that decides whether the account may buy at all.
 *
 * Three ideas run through it.
 *
 * IN FORCE IS A DATE, NOT A FLAG. `state` says what a person decided — drafted,
 * active, terminated, superseded. Whether it binds today is two dates and the
 * clock, so it is computed at the moment somebody looks. A stored "expired"
 * boolean is wrong every morning until a job runs, and the morning it is wrong
 * is the morning an account buys something it has no agreement for.
 *
 * EXPIRING IS THE STATE WORTH SHOWING. Expired is too late to act on: the
 * account is already unable to buy and somebody is already annoyed. The window
 * that matters is the notice period, which is per contract because a ninety-day
 * notice is a ninety-day warning.
 *
 * AND A TERM VALUE IS EVIDENCE, NOT A PROMISE. What the account said it would
 * spend, next to what it has actually spent, is the most useful line in a credit
 * review and the most misleading number on a dashboard. It is reported as a
 * comparison or not at all.
 */

import { byCurrency, money } from './money'
import type { Money } from './money'

export type ContractState = 'draft' | 'active' | 'terminated' | 'superseded'

/** What the register calls it, once the clock has been applied. */
export type Standing =
  | 'draft' | 'not started' | 'in force' | 'expiring' | 'expired'
  | 'terminated' | 'superseded'

export interface Contract {
  id: string
  account_id: string
  company: string
  market: string
  title: string
  signed_on: string
  starts_on: string
  ends_on: string
  terms: string
  currency: string
  auto_renew: boolean
  notice_days: number
  term_value: number | null
  signed_by: string
  signed_title: string
  countersigned_by: string
  document_name: string | null
  document_path: string | null
  state: ContractState
  superseded_by: string | null
  terminated_on: string | null
  terminated_why: string | null
  note: string | null
  /* Both computed by `account_contract`, and recomputed here by `standingOf`
     when a screen needs to ask about a date that is not today. */
  days_left: number
  in_force: boolean
  standing: Standing
}

export type AmendmentKind = 'extension' | 'terms' | 'value' | 'contact' | 'other'

export interface Amendment {
  id: string
  contract_id: string
  kind: AmendmentKind
  signed_on: string
  effective_on: string
  was: string
  now_says: string
  why: string
  signed_by: string
  document_name: string | null
  document_path: string | null
}

/* ---------------------------------------------------------------- the words -- */

export const STANDING_LABEL: Record<Standing, string> = {
  draft: 'Draft',
  'not started': 'Starts later',
  'in force': 'In force',
  expiring: 'Expiring',
  expired: 'Expired',
  terminated: 'Terminated',
  superseded: 'Superseded',
}

export const STANDING_TONE: Record<Standing, string> = {
  draft: 'pending',
  'not started': 'pending',
  'in force': 'healthy',
  expiring: 'degraded',
  expired: 'rejected',
  terminated: 'rejected',
  superseded: 'draft',
}

export const AMENDMENT_LABEL: Record<AmendmentKind, string> = {
  extension: 'Term extended',
  terms: 'Payment terms',
  value: 'Expected spend',
  contact: 'Contact',
  other: 'Other',
}

/* -------------------------------------------------------------- the clock -- */

const days = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000)

/** How many days the contract has left on a given day. Negative once it is past. */
export function daysLeft(c: Pick<Contract, 'ends_on'>, today: string): number {
  return days(today, c.ends_on)
}

/**
 * Where a contract stands on a given day.
 *
 * The same rule as the `account_contract` view, evaluated here so a screen can
 * ask about a date that is not today — "what will this look like at renewal" —
 * and so the ordering can be tested without a database. The view is what the
 * screens read; the integration test reconciles the two, because a rule
 * evaluated in two places is one edit away from being two rules.
 */
export function standingOf(
  c: Pick<Contract, 'state' | 'starts_on' | 'ends_on' | 'notice_days' | 'superseded_by'>,
  today: string,
): Standing {
  if (c.state === 'draft') return 'draft'
  if (c.state === 'terminated') return 'terminated'
  if (c.state === 'superseded') return 'superseded'
  if (days(today, c.starts_on) > 0) return 'not started'
  const left = days(today, c.ends_on)
  /* Past its term with a successor named is superseded, not expired. Expired
     means nothing replaced it and the account is locked out; saying that about
     an agreement that was properly renewed sends somebody chasing a renewal
     that already happened.

     Which also means an agreement that has been renewed early keeps binding
     until its own end date. Marking it replaced the moment the successor was
     signed took the account off account-purchasing for the rest of its term —
     a punishment for acting inside the notice period, which is the behaviour
     the notice period exists to produce. */
  if (left < 0) return c.superseded_by ? 'superseded' : 'expired'
  return left <= c.notice_days ? 'expiring' : 'in force'
}

/** Whether the account may buy under this one today. */
export function inForce(
  c: Pick<Contract, 'state' | 'starts_on' | 'ends_on' | 'notice_days' | 'superseded_by'>,
  today: string,
): boolean {
  const s = standingOf(c, today)
  return s === 'in force' || s === 'expiring'
}

/**
 * The last day either side can give notice and still be inside the term.
 *
 * Returned rather than "days until you must decide", because a date is
 * actionable and a countdown is a number somebody has to convert. Null where
 * there is no notice period, which is not the same as today.
 */
export function noticeBy(c: Pick<Contract, 'ends_on' | 'notice_days'>): string | null {
  if (c.notice_days <= 0) return null
  const d = new Date(`${c.ends_on}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - c.notice_days)
  return d.toISOString().slice(0, 10)
}

/**
 * What happens when the term runs out, in a sentence.
 *
 * Auto-renewing and not auto-renewing are opposite problems and both are easy to
 * get wrong: one lapses because nobody acted, the other rolls for another year
 * because nobody acted.
 */
export function whatHappensNext(c: Contract, today: string): string {
  const s = standingOf(c, today)
  if (s === 'terminated') {
    return `Terminated on ${c.terminated_on}. ${c.terminated_why ?? ''}`.trim()
  }
  if (s === 'superseded') return `Ran to ${c.ends_on} and was replaced by ${c.superseded_by}.`
  if (s === 'draft') return 'Not signed into force yet, so nothing can be bought under it.'
  if (s === 'not started') return `Starts on ${c.starts_on}. Nothing can be bought under it before then.`
  if (s === 'expired') {
    return `Ran out on ${c.ends_on}. Purchases on account are refused until it is renewed.`
  }
  const left = daysLeft(c, today)
  const by = noticeBy(c)
  /* Already renewed and still running. Saying "renews automatically unless
     notice is given" about an agreement whose successor is signed and waiting
     would have somebody give notice on a term that is already replaced. */
  if (c.superseded_by) {
    return `Runs to ${c.ends_on}, ${left} days from now, and ${c.superseded_by} takes over `
      + 'the day after. Nothing needs doing.'
  }
  if (c.auto_renew) {
    return by
      ? `Renews automatically on ${c.ends_on} unless either side gives notice by ${by}. `
        + `${left} days left of this term.`
      : `Renews automatically on ${c.ends_on}. ${left} days left of this term.`
  }
  return by
    ? `Ends on ${c.ends_on} and does not roll over. Notice is due by ${by}, ${left} days from now.`
    : `Ends on ${c.ends_on} and does not roll over. ${left} days from now.`
}

/* ------------------------------------------------------------- the queue -- */

/**
 * What to look at, soonest first.
 *
 * Expired above expiring, because an expired agreement is an account that cannot
 * buy right now and every hour of that is a purchase somebody is failing to
 * make. Then expiring by how little time is left. Everything settled falls to
 * the bottom in whatever order it was given.
 */
export function renewalQueue(list: readonly Contract[], today: string): Contract[] {
  const rank = (c: Contract): number => {
    const s = standingOf(c, today)
    if (s === 'expired') return 0
    if (s === 'expiring') return 1
    if (s === 'draft' || s === 'not started') return 2
    if (s === 'in force') return 3
    return 4
  }
  return [...list].sort((a, b) => {
    const r = rank(a) - rank(b)
    return r !== 0 ? r : daysLeft(a, today) - daysLeft(b, today)
  })
}

/** Contracts to act on within a window — what a renewal report is made of. */
export function dueWithin(list: readonly Contract[], today: string, withinDays: number): Contract[] {
  return list.filter(c => {
    const s = standingOf(c, today)
    if (s === 'expired') return true
    if (s !== 'in force' && s !== 'expiring') return false
    return daysLeft(c, today) <= withinDays
  })
}

/* -------------------------------------------------------------- the book -- */

export interface Register {
  total: number
  inForce: number
  expiring: number
  expired: number
  /* Never one figure. Stated term values are in four currencies and adding them
     produces a quantity of nothing. */
  committed: { currency: string; total: Money; count: number }[]
  autoRenewing: number
  unsigned: number
}

export function registerOf(list: readonly Contract[], today: string): Register {
  const live = list.filter(c => inForce(c, today))
  return {
    total: list.length,
    inForce: live.length,
    expiring: list.filter(c => standingOf(c, today) === 'expiring').length,
    expired: list.filter(c => standingOf(c, today) === 'expired').length,
    committed: byCurrency(live.filter(c => c.term_value != null)
      .map(c => money(c.term_value!, c.currency))),
    autoRenewing: live.filter(c => c.auto_renew).length,
    unsigned: list.filter(c => c.state === 'draft').length,
  }
}

/**
 * What the account said it would spend against what it has.
 *
 * Reported as a pair rather than a percentage on its own, because a term that is
 * two months old and one that is two months from ending produce the same
 * percentage and mean opposite things. `throughTerm` is how far into the term we
 * are, which is the number that makes the other one readable.
 */
export function againstTerm(
  c: Contract, spent: number, today: string,
): { stated: number; spent: number; pct: number | null; throughTerm: number; currency: string } | null {
  if (c.term_value == null || c.term_value <= 0) return null
  const whole = days(c.starts_on, c.ends_on)
  const gone = Math.max(0, Math.min(whole, days(c.starts_on, today)))
  return {
    stated: c.term_value,
    spent,
    pct: Math.round((spent / c.term_value) * 1000) / 10,
    throughTerm: whole <= 0 ? 100 : Math.round((gone / whole) * 1000) / 10,
    currency: c.currency,
  }
}

/* ------------------------------------------------------------ amendments -- */

/** Amendments in the order they took effect, which is not the order they were signed. */
export function inEffectOrder(list: readonly Amendment[]): Amendment[] {
  return [...list].sort((a, b) =>
    a.effective_on === b.effective_on
      ? a.signed_on.localeCompare(b.signed_on)
      : a.effective_on.localeCompare(b.effective_on))
}

/**
 * What an amendment must say before it is worth recording.
 *
 * Both sides and a reason. A change with only the new wording cannot be read
 * back by the person who has to explain it to the account that signed it, and a
 * change with no reason is an edit somebody made.
 */
export function validateAmendment(
  a: {
    kind?: string; was: string; now_says: string; why: string
    effective_on: string; signed_on: string; terms?: string
  },
  contract: Pick<Contract, 'starts_on' | 'ends_on'>,
): { ok: true } | { ok: false; reason: string } {
  /* A terms amendment carries the new terms as a value. Deriving it from the
     prose is what turned "Payment terms: Net 45 from date of invoice." into an
     account billed on a whole sentence. */
  if (a.kind === 'terms' && !a.terms?.trim()) {
    return { ok: false, reason: 'Say what the payment terms become — "Net 45" — as well as describing the change. The agreement is updated from that, not from the wording.' }
  }
  if (!a.was.trim() || !a.now_says.trim()) {
    return { ok: false, reason: 'An amendment has to say what it changed from and what to. One side alone cannot be read back.' }
  }
  if (a.was.trim() === a.now_says.trim()) {
    return { ok: false, reason: 'The before and after are the same, so nothing was amended.' }
  }
  if (a.why.trim().length < 20) {
    return { ok: false, reason: 'Say why it changed. An amendment with no reason is an edit somebody made.' }
  }
  if (a.effective_on < a.signed_on) {
    return { ok: false, reason: `This takes effect on ${a.effective_on} and was signed on ${a.signed_on}. Backdating an amendment needs saying out loud, not hiding in a date.` }
  }
  if (a.effective_on > contract.ends_on) {
    return { ok: false, reason: `The agreement ends on ${contract.ends_on}, so an amendment effective ${a.effective_on} changes nothing.` }
  }
  return { ok: true }
}

/* --------------------------------------------------------------- checks -- */

/**
 * Where the contract file disagrees with itself, or with what it governs.
 *
 * The first is the one that produced all of this: an account trading with
 * nothing behind it. The rest are the ways a contract table goes quietly wrong —
 * two agreements live at once, terms that no longer match the account they are
 * meant to govern, a superseded row pointing at nothing.
 */
export function contractProblems(
  list: readonly Contract[],
  accounts: readonly { id: string; company: string; status: string; terms: string }[],
  today: string,
): string[] {
  const out: string[] = []

  for (const a of accounts.filter(x => x.status === 'active')) {
    const mine = list.filter(c => c.account_id === a.id)
    const live = mine.filter(c => inForce(c, today))
    if (live.length === 0) {
      const last = mine.filter(c => c.state === 'active')
        .sort((x, y) => y.ends_on.localeCompare(x.ends_on))[0]
      out.push(last
        ? `${a.company} is trading and its agreement ran out on ${last.ends_on}.`
        : `${a.company} is trading with no agreement on file at all.`)
      continue
    }
    if (live.length > 1) {
      out.push(`${a.company} has ${live.length} agreements in force at once (${live.map(c => c.id).join(', ')}).`)
    }
    const one = live[0]
    if (one.terms !== a.terms) {
      out.push(`${a.company} is billed on "${a.terms}" and ${one.id} says "${one.terms}".`)
    }
  }

  for (const c of list) {
    if (c.state === 'superseded' && !c.superseded_by) {
      out.push(`${c.id} is superseded and does not say by what.`)
    }
    if (c.state === 'superseded' && c.superseded_by && !list.some(x => x.id === c.superseded_by)) {
      out.push(`${c.id} points at ${c.superseded_by}, which is not on the register.`)
    }
    if (c.ends_on <= c.starts_on) out.push(`${c.id} ends on or before it starts.`)
    if (c.signed_on > c.starts_on) out.push(`${c.id} starts before it was signed.`)
    if (!c.document_path) out.push(`${c.id} has no signed copy attached.`)
  }

  return out
}
