/* The customer's side of the rewards programme: what may be redeemed, for how
   much, and why a redemption is refused. No React and no Supabase, so the rules
   can be tested without a network.

   These rules are stated twice on purpose. Here, so the screen can refuse
   before it asks and say why in the customer's own words; and again inside
   `redeem_points()` in the database, because a client that is only asked
   nicely is a client that can decline to answer. The wording is deliberately
   kept in step between the two — a refusal that reads differently depending on
   which layer caught it is two rules wearing one name. */

import { round2 } from './money'

export type Check = { ok: true; note?: string } | { ok: false; reason: string }

export interface Programme {
  id: string
  name: string
  unit: string
  per_unit: number
  min_redeem: number
  expiry_months: number
  rounding_note: string
  status: string
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
  description: string
  why: string | null
}

export interface Member {
  id: string
  name: string
  kind: string
  /* What this member's money figures are in — their qualifying spend, and what
     their points are worth. Follows the currency they are billed in. */
  currency: string
  tier: string
  balance: number
  qualify_12m: number
  lifetime_earned: number
  lifetime_redeemed: number
  expiring_soon: number
  expiring_on: string | null
  last_activity: string | null
  user_id: string | null
}

/* ------------------------------------------------------- what is on offer -- */

/**
 * The options this member can actually choose.
 *
 * Audience is the one that matters: an organisation ladder and a retail one
 * share this table, and showing a customer a redemption written for a company
 * account is an invitation to a refusal.
 */
export function offeredTo(options: readonly RedeemOption[], member: Member | null): RedeemOption[] {
  if (!member) return []
  return options.filter(o =>
    o.status === 'active' && (o.audience === 'all' || o.audience === member.kind))
}

/** What a number of points is worth under an option, to the cent. */
export function worthOf(points: number, option: RedeemOption, programme: Programme): number {
  return Math.round((points / programme.per_unit) * option.value_per * 100) / 100
}

/** The most this member could redeem on an option, respecting its step. */
export function mostRedeemable(option: RedeemOption, member: Member): number {
  if (option.step <= 0) return Math.min(member.balance, member.balance)
  return Math.floor(member.balance / option.step) * option.step
}

/* --------------------------------------------------------- the refusals -- */

/**
 * Whether a redemption can go ahead.
 *
 * The order matters. "You have not got enough points" is the answer a customer
 * needs first; being told the step size on a balance that could never reach the
 * minimum is a correct sentence about the wrong problem.
 */
export function validateRedemption(
  { member, option, programme, points }: {
    member: Member | null
    option: RedeemOption | undefined
    programme: Programme | null
    points: number
  },
): Check {
  if (!member || !programme) return { ok: false, reason: 'Your rewards account has not loaded yet.' }
  if (!option) return { ok: false, reason: 'Choose what to redeem for.' }

  if (option.status !== 'active') {
    return { ok: false, reason: `${option.name} is not available at the moment.` }
  }
  if (option.audience !== 'all' && option.audience !== member.kind) {
    return { ok: false, reason: `${option.name} is not offered on your kind of account.` }
  }
  if (!Number.isFinite(points) || points <= 0) {
    return { ok: false, reason: 'Choose how many points to redeem.' }
  }
  if (points > member.balance) {
    return { ok: false, reason: `That is more than your balance — ${fmtPoints(member.balance)} available.` }
  }
  if (points < programme.min_redeem) {
    return { ok: false, reason: `You need at least ${fmtPoints(programme.min_redeem)} before anything can be redeemed.` }
  }
  if (points < option.min) {
    return { ok: false, reason: `${option.name} starts at ${fmtPoints(option.min)}.` }
  }
  if (option.step > 0 && points % option.step !== 0) {
    return { ok: false, reason: `${option.name} goes up in steps of ${fmtPoints(option.step)}.` }
  }

  const worth = worthOf(points, option, programme)
  return {
    ok: true,
    note: `${fmtPoints(points)} for ${fmtMoney(worth)} of ${option.name.toLowerCase()}. Points leave your balance as soon as you confirm, and a redemption is not reversible.`,
  }
}

/** Whether anything at all can be redeemed today, and what to say if not. */
export function canRedeemAnything(
  member: Member | null, options: readonly RedeemOption[], programme: Programme | null,
): Check {
  if (!member || !programme) return { ok: false, reason: 'Your rewards account has not loaded yet.' }
  const offered = offeredTo(options, member)
  if (!offered.length) {
    return { ok: false, reason: 'There is nothing on offer for your account at the moment.' }
  }
  if (member.balance < programme.min_redeem) {
    return {
      ok: false,
      reason: `You need at least ${fmtPoints(programme.min_redeem)} before anything can be redeemed — ${fmtPoints(member.balance)} so far.`,
    }
  }
  const cheapest = Math.min(...offered.map(o => o.min))
  if (member.balance < cheapest) {
    return { ok: false, reason: `The smallest redemption on offer is ${fmtPoints(cheapest)}.` }
  }
  return { ok: true }
}

/* ------------------------------------------------------------- the words -- */

export function fmtPoints(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `${Math.round(n).toLocaleString('en-US')} pts`
}

export function fmtMoney(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/* ------------------------------------------------------------- the ladder -- */

/**
 * One rung of one ladder.
 *
 * Structural rather than imported from `../types` so this module stays pure and
 * free of the app's wider type graph — the fields below are all the rules here
 * need.
 */
export interface Rung {
  id: string
  sort_order: number
  qualify_spend: number
  kind: string
}

/**
 * The rungs this member's account can actually climb.
 *
 * `loyalty_tiers` holds two ladders: Bronze/Silver/Gold/Platinum for retail and
 * Registered/Business/Business Plus/Strategic for business accounts. They are
 * separate progressions that happen to share a table, and they share
 * `sort_order` 1..4 as well — so an unfiltered, sort-ordered read interleaves
 * them into a single strip whose qualifying spend runs $600, $12,000, $35,000,
 * $1,800, $100,000, $4,500. That is what the retail rewards page was drawing.
 */
export function ladderFor<T extends Rung>(tiers: readonly T[], memberKind: string): T[] {
  const kind = memberKind === 'enterprise' ? 'enterprise' : 'consumer'
  return tiers.filter(t => t.kind === kind).sort((a, b) => a.sort_order - b.sort_order)
}

/**
 * The rung the member is on, or null when their tier names no rung in the list.
 *
 * Takes a ladder rather than every tier. It used to re-scope internally, which
 * meant a caller who had already scoped — to the member's kind *and* to their
 * currency's thresholds — silently got the unscoped list back. That is how the
 * screen came to tell a Gold customer there was nothing above Gold: `nextRung`
 * re-derived the ladder from the raw tiers, whose thresholds are dollars, and
 * ₹187,127 is past every one of $0, $600, $1,800 and $4,500.
 */
export function rungOf<T extends Rung>(ladder: readonly T[], member: { tier: string }): T | null {
  return ladder.find(t => t.id === member.tier) ?? null
}

/**
 * Climbed, standing on, or still ahead.
 *
 * "Here" is decided by identity, not by rank. Rank is only unique within one
 * ladder, and comparing `sort_order` against the current tier's put "You are
 * here" under both Gold and Business Plus — both of them rung 3, of different
 * ladders.
 */
export function rungState<T extends Rung>(rung: T, current: T | null): 'past' | 'here' | 'future' {
  if (!current) return 'future'
  if (rung.id === current.id) return 'here'
  return rung.sort_order < current.sort_order ? 'past' : 'future'
}

/**
 * The next rung up, and what it would take.
 *
 * Takes the ladder the member actually climbs — scoped to their kind and
 * carrying the thresholds set for their currency. See `rungOf` for why it does
 * not scope for itself.
 */
export function nextRung<T extends Rung>(
  ladder: readonly T[], member: { tier: string; qualify_12m: number },
): { next: T | null; need: number; pct: number } {
  const current = rungOf(ladder, member)
  const next = ladder.find(t => t.qualify_spend > member.qualify_12m) ?? null
  if (!next) return { next: null, need: 0, pct: 100 }
  /* Measured from the rung below rather than from zero, or a member who has
     just arrived on a rung reads as most of the way to the next one. */
  const floor = current?.qualify_spend ?? 0
  const span = next.qualify_spend - floor
  const pct = span > 0 ? Math.round(((member.qualify_12m - floor) / span) * 100) : 0
  return {
    next,
    need: Math.max(0, Math.round((next.qualify_spend - member.qualify_12m) * 100) / 100),
    pct: Math.max(0, Math.min(100, pct)),
  }
}

/* ------------------------------------------ what a point is worth, where -- */

/**
 * The denomination of a point in one currency.
 *
 * A point is a unit the marketplace issues, not a currency — but what it is
 * worth is a local decision, made the same way a price is: chosen, not
 * converted. `₹52,452` is what `$600` comes to; `₹50,000` is what somebody
 * would actually set.
 */
export interface PointRate {
  currency: string
  /** Points earned per one unit of this currency spent, before tier multiplier. */
  earn_per_unit: number
  /** Points that buy one unit of this currency back, before the option's rate. */
  per_unit: number
}

/** What it takes to reach one rung, in one currency. */
export interface Threshold {
  tier_id: string
  currency: string
  qualify_spend: number
}

export const rateFor = (rates: readonly PointRate[], currency: string): PointRate | null =>
  rates.find(r => r.currency === currency) ?? null

/**
 * What a number of points is worth under an option, in the member's own money.
 *
 * Was `points / programme.per_unit`, with one `per_unit` for the whole
 * marketplace — so a point was $0.01 to a customer billed in rupees. The rate
 * is per currency now and the caller passes the member's.
 */
export function worthIn(
  points: number, option: Pick<RedeemOption, 'value_per'>, rate: PointRate | null,
): number {
  if (!rate || rate.per_unit <= 0) return 0
  return Math.round((points / rate.per_unit) * option.value_per * 100) / 100
}

/**
 * The ladder as this member meets it: their own rungs, with the thresholds set
 * for the currency they are billed in.
 *
 * Returned as rungs rather than as a lookup so everything downstream —
 * `rungOf`, `rungState`, `nextRung` — keeps working on one shape and does not
 * each need to know about currencies.
 */
export function ladderIn<T extends Rung & { id: string }>(
  tiers: readonly T[], thresholds: readonly Threshold[], member: { kind: string; currency: string },
): T[] {
  return ladderFor(tiers, member.kind).map(t => {
    const th = thresholds.find(x => x.tier_id === t.id && x.currency === member.currency)
    /* A rung with no threshold in this currency keeps the one it came with
       rather than dropping to zero — zero would read as "already qualified"
       and quietly promote somebody. */
    return th ? { ...t, qualify_spend: th.qualify_spend } : t
  })
}

/**
 * The points a spend earns, at a rung's multiplier.
 *
 * Whole, because the ledger holds whole points. Nothing on the marketplace
 * issues a fraction of one, and a screen that quotes "210.4 points" is quoting
 * a number the ledger will never contain.
 *
 * Floored rather than rounded: a point that was not earned is not awarded. This
 * was `Math.round`, which disagreed with every seeded row on the marketplace —
 * KES 3,188.79 at 1.25× is 39.86 points and the ledger says 39. Two rules for
 * one number, and the screen quoting the customer's next earn was using the
 * generous one.
 */
export const pointsFor = (spend: number, rate: PointRate | null, multiplier = 1): number =>
  rate ? Math.floor(spend * rate.earn_per_unit * multiplier) : 0

/**
 * What a purchase earns when it was not made in the member's own currency.
 *
 * A member holds one balance, and a balance is a single number — so a point has
 * to mean one thing across everything they have ever bought. The rule is that
 * **the spend converts and the points do not**: the amount paid is brought into
 * the member's currency at the rate in force on the day, and only then are
 * points computed.
 *
 * Doing it the other way round quietly loses money. Earning in the paid
 * currency and then converting the point count gives a different answer,
 * because the point count carries no currency with it — the moment it lands in
 * a KES member's balance it *means* KES:
 *
 *     $12.50 net, Silver 1.25×, USD→KES 128.45
 *       spend converts:  12.50 × 128.45 = KES 1,605.63 → 20 points (worth KSh 20)
 *       points convert:  floor(12.50 × 1 × 1.25) = 15 points, and 15 points in
 *                        a KES programme is KSh 15 — the customer is short
 *
 * The 1% return invariant is what makes the first answer the right one: KSh
 * 1,605.63 of spend returns KSh 20 of points wherever it is earned, which is
 * exactly what the same money spent in shillings would have returned.
 *
 * @param fxRate the paid currency into the member's, on the day of the
 *   purchase. Pass 1 when they are the same currency — the caller looks the
 *   dated rate up, because a rate is a fact about a moment and this module has
 *   no clock.
 */
/* Two decimal places, agreeing with the database.
 *
 * `Math.round(n * 100) / 100` — the version copied into six modules here — puts
 * $12.50 × 128.45 at 160562.49999999997 and rounds it *down* to 1,605.62, while
 * Postgres `round(1605.625, 2)` on `numeric` gives 1,605.63. A conversion is
 * exactly where a half-cent lands, so the app and the ledger would differ by a
 * cent on the same purchase — and occasionally, at the boundary, by a point.
 *
 * `toPrecision(12)` puts the product back on the decimal the arithmetic meant
 * before the rounding decision is taken. Twelve digits is far inside a double's
 * 15–17 and far outside any money this marketplace handles.
 */
/* Was a private `toMoney` using toPrecision(12). `round2` reaches the same
   answer by nudging past the binary midpoint instead, and agrees with it on all
   400,000 sampled conversions — so this is one implementation rather than two
   that happen to concur. */
const toMoney = round2

export function earnOnSpend(
  { spend, paidIn, member, rates, fxRate, multiplier = 1 }: {
    spend: number
    paidIn: string
    member: { currency: string }
    rates: readonly PointRate[]
    fxRate: number
    multiplier?: number
  },
): { points: number; spendInHome: number; converted: boolean; fxRate: number } {
  const same = paidIn === member.currency
  /* A conversion with no rate is refused rather than defaulted to 1. Treating a
     missing USD→KES rate as parity would award 1/129th of the points and look
     like an ordinary small purchase. */
  if (!same && !(fxRate > 0)) {
    return { points: 0, spendInHome: 0, converted: true, fxRate: 0 }
  }
  const applied = same ? 1 : fxRate
  const spendInHome = toMoney(spend * applied)
  return {
    points: pointsFor(spendInHome, rateFor(rates, member.currency), multiplier),
    spendInHome,
    converted: !same,
    fxRate: applied,
  }
}

/**
 * What a reversal gives back: exactly the points the earn gave, never a
 * recomputation.
 *
 * The one place the exchange rate must not be applied a second time. A customer
 * who buys in dollars and returns the item after the shilling weakens would
 * otherwise keep the difference, and one who returns it after the shilling
 * strengthens would be short — neither of which is anything either party
 * agreed to.
 */
export const reversalOf = (earned: number): number => -Math.abs(earned)

/**
 * How much of one unit of currency comes back as points, as a percentage.
 *
 * The number that says whether a "local" rate has quietly become five times as
 * generous in one country. Every currency here returns 1%.
 */
export const returnRate = (rate: PointRate): number =>
  rate.per_unit > 0 ? (rate.earn_per_unit / rate.per_unit) * 100 : 0

/**
 * "1 point per ₹100" — the earn side, said the way a customer reads it.
 *
 * Assembled rather than stored. The tiers used to carry "Earn 1.5 points per
 * $1" as prose on every rung, which is wrong in three of the four currencies
 * the marketplace trades in.
 */
export function earnLine(rate: PointRate, multiplier = 1): string {
  const points = rate.earn_per_unit * multiplier
  const spend = 1 / rate.earn_per_unit
  return points >= 1
    ? `${trim(points)} point${points === 1 ? '' : 's'} per 1 spent`
    : `${trim(multiplier)} point${multiplier === 1 ? '' : 's'} per ${trim(spend)} spent`
}

/* Deliberately not `round2`. This trims a *rate* for a sentence — "1.25 points
   per 1 spent" — and a rate is not money, so the half-cent argument that made
   every other call site switch does not apply to it. */
const trim = (n: number): string =>
  Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100)

/* ------------------------------------------------------------- what it earns -- */

/**
 * An earn rule, as the operator configures it.
 *
 * `rate` multiplies the currency's own points-per-unit; `bonus` is a flat award
 * on top; the caps are ceilings, one per order and one per member per month.
 */
export interface EarnRule {
  id: string
  name: string
  rate: number
  bonus: number | null
  cap_per_order: number | null
  cap_per_month: number | null
  status: string
}

/**
 * What an order earns, before any monthly ceiling.
 *
 * The same arithmetic as `loyalty_points_for` in the database, which is what
 * actually writes the ledger. This exists so a screen can say what a basket
 * will earn before it is placed, and the integration test reconciles the two —
 * a rule evaluated in two places is one edit away from being two rules.
 *
 * Three things multiply and they are easy to mistake for one:
 *
 *   the currency rate    a point per hundred rupees, a point per dollar
 *   the rule rate        double points on content, triple on a launch
 *   the tier multiplier  Gold earns 1.5x of whatever the rule gives
 *
 * I reported thirteen rows as "three times or more what the rate tables allow"
 * by comparing against the first of those alone. On that arithmetic a Gold
 * customer during a triple-points window looks like a four-and-a-half-times
 * error, and the rows that stood out loudest were the ones where the promotion
 * was working.
 *
 * `amount` is in the member's own currency. Points are earned in the money the
 * member banks in, not the money the order was priced in — a Kenyan buyer may
 * pay in dollars and still earn shillings, so the conversion happens before
 * this is called.
 */
export function earnedOn(
  { amount, rate, rule, multiplier }: {
    amount: number
    /* The member's own currency rate — `rateFor(rates, member.currency)`. */
    rate: PointRate | null
    rule: Pick<EarnRule, 'rate' | 'bonus' | 'cap_per_order'>
    multiplier: number
  },
): number {
  /* Built on `pointsFor` rather than repeating its arithmetic. That one answers
     "what does this spend earn at the base rate", which is what the tier
     projection needs; this one adds the rule on top. Two functions computing
     the same floor with different rounding is precisely the defect `pointsFor`'s
     own comment describes. */
  const base = pointsFor(amount, rate, rule.rate * multiplier)
  const raw = base + (rule.bonus ?? 0)
  const capped = rule.cap_per_order === null ? raw : Math.min(raw, rule.cap_per_order)
  return Math.max(0, capped)
}

/**
 * How much of a monthly ceiling is left, given what has already been earned.
 *
 * Separate from `pointsFor` because a per-order cap is a property of the order
 * and a per-month cap is a property of everything before it. Applying the
 * second inside the first would make the answer depend on what else the caller
 * happened to know.
 */
export function withinMonthlyCap(
  points: number, alreadyEarned: number, cap: number | null,
): number {
  if (cap === null) return points
  return Math.max(0, Math.min(points, cap - alreadyEarned))
}

/**
 * What a reversal's cash figure is.
 *
 * `reversalOf` above already gives the points. This is the other half, and it
 * is the half that is easy to get wrong by symmetry: a movement's `value` is
 * the money the points come to, and money does not go negative because the
 * points did. A redemption carries −100 points and a positive value; so does
 * its reversal's mirror. `guard_ledger_currency` refuses anything else.
 *
 * Worth its own function only because restating an earn and leaving its
 * reversal at the old figure left one customer 512 points down on an order she
 * had been refunded for — the pair has to move together, and moving it
 * together means knowing which of the two flips sign.
 */
export const reversalValueOf = (value: number): number => Math.abs(value)
