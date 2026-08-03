/* Rewards for an organisation. No React and no Supabase.

   The difference from a person's programme is who owns the points. Points
   earned on company spend are company money, so releasing them is the same
   kind of act as approving a requisition and gets the same control: one person
   proposes, another releases. Everything here exists so a screen can explain a
   refusal before the database has to.

   What a point is worth, and what a rung costs, are the retail programme's
   rules exactly — a business account is in one currency the same way a person
   is — so they are imported from `loyalty.ts` rather than restated. Stating
   them twice is how the consumer ladder and this one came to disagree about
   which tiers exist. */

import { ladderFor, rateFor, worthIn, returnRate, ladderIn, pointsFor, earnLine } from './loyalty'
import type { PointRate, Threshold } from './loyalty'

export type { PointRate, Threshold }
export { ladderFor, rateFor, worthIn, returnRate, ladderIn, pointsFor, earnLine }

export type RedemptionState = 'proposed' | 'released' | 'applied' | 'declined' | 'withdrawn'

/**
 * How to write an amount, supplied by whoever knows the currency.
 *
 * The rules here produce sentences with money in them — "worth ₹50,000", "leave
 * the balance, worth AED 200" — and money is a pair. Rather than import the
 * currency table into a rules module, the caller hands in a formatter already
 * bound to the reader's currency; on a screen that is `fmtIn` from `useMarket`,
 * and in the repo it is built from the book.
 */
export type Fmt = (amount: number) => string

export interface Tier {
  id: string
  name: string
  sort_order: number
  qualify_spend: number
  multiplier: number
  colour: string | null
  benefits: string[]
  note: string | null
  kind: 'consumer' | 'enterprise'
}

export interface RewardMember {
  id: string
  account_id: string | null
  name: string
  kind: string
  /* What this account's money figures are in — its qualifying spend, and what
     its points are worth. Follows the currency it is invoiced in. */
  currency: string
  tier: string
  balance: number
  joined: string
  qualify_12m: number
  lifetime_earned: number
  lifetime_redeemed: number
  expiring_soon: number
  expiring_on: string | null
  last_activity: string | null
}

export interface Movement {
  id: string
  member: string
  when_date: string
  type: 'earn' | 'redeem' | 'reverse' | 'expire' | 'adjust'
  points: number
  ref: string | null
  rule_id: string | null
  funder: string | null
  seller_id: string | null
  value: number
  /* The currency `value` is in. Always the member's — `guard_ledger_currency`
     refuses a movement in anything else. */
  currency: string
  note: string | null
}

export interface RewardRule {
  id: string
  name: string
  scope: string
  scope_id: string | null
  rate: number
  funder: string
  status: string
  audience: string
  cap_per_order: number | null
  cap_per_month: number | null
  first_only: boolean
  why: string | null
  from: string
}

export interface RedeemOption {
  id: string
  name: string
  kind: string
  min: number
  step: number
  value_per: number
  cost: string
  audience: string
  status: string
  description: string | null
  why: string | null
}

export interface RewardPolicy {
  account_id: string
  min_redeem: number
  propose_roles: string[]
  release_roles: string[]
  auto_apply: boolean
  allocate_to_cost_centre: boolean
  default_cost_centre: string | null
  note: string
  updated_by: string | null
  updated_on: string | null
}

export interface Redemption {
  id: string
  account_id: string
  member_id: string
  option_id: string
  points: number
  value: number
  currency: string
  cost_centre: string | null
  reason: string
  state: RedemptionState
  proposed_by: string
  proposed_on: string
  released_by: string | null
  released_on: string | null
  decision_note: string | null
  applied_to: string | null
  applied_on: string | null
  ledger_ref: string | null
  sort_order: number
}

export type Check = { ok: true; note?: string } | { ok: false; reason: string }

/** An option that adds nothing of its own, for asking what a point is simply worth. */
const PLAIN = { value_per: 1 }

/**
 * What a number of points is worth to this account, at the plain rate.
 *
 * Was `points / programme.per_unit` — one rate, 100 points to the dollar,
 * for every member of the marketplace. That is what made a point worth $0.01
 * to an account invoiced in rupees. `rate` is the member's own row from
 * `loyalty_point_rates`, and a member with no rate is worth nothing rather
 * than worth somebody else's number.
 */
export const pointsWorth = (points: number, rate: PointRate | null): number =>
  worthIn(points, PLAIN, rate)

/* ----------------------------------------------------------------- tiers -- */

export function tiersFor(tiers: Tier[], kind: 'consumer' | 'enterprise'): Tier[] {
  return ladderFor(tiers, kind)
}

/**
 * The ladder this account climbs: its own rungs, carrying the thresholds set
 * for the currency it is invoiced in.
 *
 * `loyalty_tiers.qualify_spend` is the dollar figure. An Indian account with
 * ₹6,854,777 of spend is past every dollar rung several times over, so an
 * unscoped ladder tells a Business Plus account it is Strategic and there is
 * nothing above it.
 */
export function ladderForMember(
  tiers: readonly Tier[], thresholds: readonly Threshold[], member: RewardMember,
): Tier[] {
  return ladderIn(tiers as (Tier & { id: string })[], thresholds, member)
}

/**
 * The top rung of the *retail* ladder, in one currency.
 *
 * The one figure from the other ladder this screen needs: it is the reason a
 * business ladder exists at all. Hard-coded as "$4,500" in the subtitle, which
 * is the wrong number for three of the four currencies and, more to the point,
 * would stay wrong when somebody moves the rung.
 */
export function topRetailRung(
  tiers: readonly Tier[], thresholds: readonly Threshold[], currency: string,
): number {
  const rungs = ladderIn(tiers as (Tier & { id: string })[], thresholds, { kind: 'consumer', currency })
  return rungs.length ? rungs[rungs.length - 1].qualify_spend : 0
}

export function tierOf(member: RewardMember, tiers: readonly Tier[]): Tier | null {
  return tiers.find(t => t.id === member.tier) ?? null
}

/**
 * Where the account sits and what it would take to move up.
 *
 * Takes the ladder rather than every tier, and the caller scopes it — to the
 * account's kind and to its currency — before calling. It used to re-scope
 * internally on kind alone, which silently threw away a currency-scoped ladder
 * a caller had already built. That is the same trap `nextRung` in `loyalty.ts`
 * was pulled out of, for the same reason.
 */
export function tierProgress(member: RewardMember, ladder: readonly Tier[]): {
  current: Tier | null; next: Tier | null; need: number; pct: number; top: boolean
} {
  const current = tierOf(member, ladder)
  const next = ladder.find(t => t.qualify_spend > member.qualify_12m) ?? null
  if (!next) return { current, next: null, need: 0, pct: 100, top: true }
  const floor = current?.qualify_spend ?? 0
  const span = next.qualify_spend - floor
  const pct = span > 0 ? Math.round(((member.qualify_12m - floor) / span) * 1000) / 10 : 0
  return {
    current, next,
    need: Math.round((next.qualify_spend - member.qualify_12m) * 100) / 100,
    pct: Math.max(0, Math.min(100, pct)),
    top: false,
  }
}

/** The tier the spend actually qualifies for, which is not always the one on
    file — an account can hold a tier through a quiet quarter. Takes a scoped
    ladder for the same reason `tierProgress` does. */
export function qualifiesFor(qualify: number, ladder: readonly Tier[]): Tier | null {
  let held: Tier | null = null
  for (const t of ladder) if (qualify >= t.qualify_spend) held = t
  return held
}

/* ------------------------------------------------------------ movements -- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "24 Jul 2026" is stored as text, so sorting it as a string puts June after
    July. Everything that orders movements goes through here. */
export function movementDate(when: string): number {
  const m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(when.trim())
  if (!m) { const t = Date.parse(when); return Number.isNaN(t) ? 0 : t }
  const month = MONTHS.indexOf(m[2].slice(0, 3))
  return month < 0 ? 0 : Date.UTC(Number(m[3]), month, Number(m[1]))
}

export function newestFirst(movements: Movement[]): Movement[] {
  return [...movements].sort((a, b) => movementDate(b.when_date) - movementDate(a.when_date))
}

export function balanceOf(movements: Movement[]): number {
  return movements.reduce((n, m) => n + Number(m.points), 0)
}

/** What the balance is made of, which is the only honest way to show a number
    the account cannot edit. */
export function summarise(movements: Movement[], rate: PointRate | null = null): {
  balance: number; earned: number; redeemed: number; expired: number; reversed: number
  movements: number; value: number
} {
  const sum = (t: Movement['type']) => movements.filter(m => m.type === t).reduce((n, m) => n + Number(m.points), 0)
  const balance = balanceOf(movements)
  return {
    balance,
    earned: sum('earn'),
    redeemed: -sum('redeem'),
    expired: -sum('expire'),
    reversed: -sum('reverse'),
    movements: movements.length,
    value: pointsWorth(balance, rate),
  }
}

/**
 * Which rules actually paid, and how much. An accelerator that has never
 * issued a point is one nobody is buying under.
 *
 * `value` is the sum of what the movements themselves said they were worth,
 * not the points put back through a rate. The worth was settled the day the
 * points were issued; recomputing it means last year's earn is restated every
 * time the marketplace reprices a point.
 */
export function byRule(movements: Movement[], rules: RewardRule[]): {
  rule: RewardRule | null; id: string; points: number; count: number; funder: string; value: number
}[] {
  const m = new Map<string, { points: number; count: number; value: number }>()
  for (const mv of movements) {
    if (mv.type !== 'earn' || !mv.rule_id) continue
    const row = m.get(mv.rule_id) ?? { points: 0, count: 0, value: 0 }
    row.points += Number(mv.points)
    row.value += Number(mv.value)
    row.count += 1
    m.set(mv.rule_id, row)
  }
  return [...m.entries()]
    .map(([id, v]) => {
      const rule = rules.find(r => r.id === id) ?? null
      return {
        id, rule, points: v.points, count: v.count,
        funder: rule?.funder ?? 'operator',
        value: Math.round(v.value * 100) / 100,
      }
    })
    .sort((a, b) => b.points - a.points)
}

/** What earned the points, by marketplace, so a procurement lead can see
    whether the programme rewards what the company actually buys. */
export function byVertical(movements: Movement[], rules: RewardRule[]): {
  vertical: string; points: number; count: number; value: number
}[] {
  const m = new Map<string, { points: number; count: number; value: number }>()
  for (const mv of movements) {
    if (mv.type !== 'earn') continue
    const rule = rules.find(r => r.id === mv.rule_id)
    const key = rule?.scope === 'vertical' ? (rule.scope_id ?? 'everything') : 'everything'
    const row = m.get(key) ?? { points: 0, count: 0, value: 0 }
    row.points += Number(mv.points)
    row.value += Number(mv.value)
    row.count += 1
    m.set(key, row)
  }
  return [...m.entries()]
    .map(([vertical, v]) => ({ vertical, ...v, value: Math.round(v.value * 100) / 100 }))
    .sort((a, b) => b.points - a.points)
}

/** Points on the account that nobody has spent. Worth saying in money, because
    "86,630 points" is not a number anybody has a feel for. */
export function idleValue(member: RewardMember, rate: PointRate | null): {
  points: number; value: number; monthsHeld: number | null
} {
  return {
    points: member.balance,
    value: pointsWorth(member.balance, rate),
    monthsHeld: null,
  }
}

/* --------------------------------------------------------- redemptions --- */

/** What the account can actually turn points into. Filtered to what applies to
    a business, because offering a consumer trade-in to a company is offering
    something that will fail at the last step. */
export function optionsFor(options: RedeemOption[], member: RewardMember): RedeemOption[] {
  const want = member.kind === 'enterprise' ? 'enterprise' : 'consumer'
  return options
    .filter(o => o.status === 'active' && (o.audience === 'all' || o.audience === want))
    .sort((a, b) => a.min - b.min)
}

export function canAfford(option: RedeemOption, member: RewardMember): boolean {
  return member.balance >= option.min
}

/** Who may put a redemption forward. Held as roles rather than names, so
    somebody leaving does not silently disable the programme. */
export function canPropose(role: string, policy: RewardPolicy): Check {
  return policy.propose_roles.includes(role)
    ? { ok: true }
    : { ok: false, reason: `A ${role.replace('-', ' ')} cannot propose a redemption on this account.` }
}

/**
 * Who may release one.
 *
 * The separation-of-duties test is skipped where the account has only one role
 * that can release — some accounts genuinely have one person, and refusing
 * them would mean the points can never be spent at all. The policy says so out
 * loud rather than the code deciding quietly.
 */
export function canRelease(redemption: Redemption, role: string, userId: string, policy: RewardPolicy): Check {
  if (redemption.state !== 'proposed') {
    return { ok: false, reason: `${redemption.id} was already ${redemption.state}.` }
  }
  if (!policy.release_roles.includes(role)) {
    return { ok: false, reason: `A ${role.replace('-', ' ')} cannot release a redemption on this account.` }
  }
  if (redemption.proposed_by === userId && policy.release_roles.length > 1) {
    return {
      ok: false,
      reason: 'You proposed this one. Somebody else has to release it — points earned on company spend are company money too.',
    }
  }
  return { ok: true }
}

export function validateProposal(
  draft: { option: RedeemOption | null; points: number; reason: string; costCentre: string | null },
  member: RewardMember, policy: RewardPolicy, rate: PointRate | null, fmt: Fmt,
): Check {
  if (!draft.option) return { ok: false, reason: 'Pick what the points are being turned into' }
  if (!Number.isFinite(draft.points) || draft.points <= 0) {
    return { ok: false, reason: 'Say how many points' }
  }
  if (draft.points > member.balance) {
    return { ok: false, reason: `That is more than the ${fmtPoints(member.balance)} the account holds.` }
  }
  if (draft.points < policy.min_redeem) {
    return { ok: false, reason: `The minimum on this account is ${fmtPoints(policy.min_redeem)} — worth ${fmt(pointsWorth(policy.min_redeem, rate))}.` }
  }
  if (draft.points < draft.option.min) {
    return { ok: false, reason: `${draft.option.name} starts at ${fmtPoints(draft.option.min)}.` }
  }
  if (draft.option.step > 1 && draft.points % draft.option.step !== 0) {
    return { ok: false, reason: `${draft.option.name} goes in steps of ${fmtPoints(draft.option.step)}.` }
  }
  if (!draft.reason.trim()) {
    return { ok: false, reason: 'Say what it is for. Whoever releases it is spending company money on your say-so.' }
  }
  if (policy.allocate_to_cost_centre && !draft.costCentre) {
    return { ok: false, reason: 'This account allocates reward credit to a cost centre — pick one.' }
  }
  return { ok: true }
}

export function validateRelease(release: boolean, note: string): Check {
  if (!release && !note.trim()) {
    return { ok: false, reason: 'A decline needs a reason. The proposer cannot revise what they were not told about.' }
  }
  return { ok: true }
}

/** What releasing actually does, in the terms the person signing it cares
    about: the balance afterwards, where the credit lands, and when. */
export function releaseImpact(
  redemption: Redemption, member: RewardMember, option: RedeemOption | null,
  policy: RewardPolicy, fmt: Fmt,
): string[] {
  const out: string[] = []
  out.push(`${fmtPoints(redemption.points)} leave the balance, worth ${fmt(Number(redemption.value))}.`)
  out.push(`${fmtPoints(member.balance - redemption.points)} left afterwards.`)
  out.push(
    policy.auto_apply
      ? `${option?.name ?? 'The credit'} lands on the next invoice automatically — nobody has to remember to apply it.`
      : `${option?.name ?? 'The credit'} has to be applied by hand once it is released.`,
  )
  if (redemption.cost_centre) out.push(`Attributed to ${redemption.cost_centre}.`)
  return out
}

export function waiting(redemptions: Redemption[]): Redemption[] {
  return redemptions.filter(r => r.state === 'proposed')
    .sort((a, b) => a.proposed_on.localeCompare(b.proposed_on))
}

export function settled(redemptions: Redemption[]): Redemption[] {
  return redemptions.filter(r => r.state !== 'proposed')
    .sort((a, b) => (b.released_on ?? b.proposed_on).localeCompare(a.released_on ?? a.proposed_on))
}

/** Points spoken for but not yet gone. Showing a balance that ignores what is
    already proposed is how two people spend the same points. */
export function committedPoints(redemptions: Redemption[]): number {
  return waiting(redemptions).reduce((n, r) => n + r.points, 0)
}

export function availablePoints(member: RewardMember, redemptions: Redemption[]): number {
  return member.balance - committedPoints(redemptions)
}

/* --------------------------------------------------------------- helpers -- */

export function fmtPoints(n: number): string {
  const whole = Math.round(n)
  /* Singular where it is one. A point is a rupee back in India, so "1 points
     buy ₹1.00" is a sentence this screen now says out loud. */
  return `${whole.toLocaleString('en-US')} point${whole === 1 ? '' : 's'}`
}

/* `money` and `money0` used to live here, each writing a `$` and nothing else
   could be said about it. They are gone rather than fixed: an amount and its
   currency are one thing, the currency belongs to the account, and a module
   that formats without being told which one is a module that will get it wrong
   for three accounts in four. Callers pass a `Fmt`. */

export const FUNDER_LABEL: Record<string, string> = {
  operator: 'the marketplace',
  partner: 'the seller',
  shared: 'the marketplace and the seller',
}
