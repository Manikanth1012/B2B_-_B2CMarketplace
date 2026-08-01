/* The customer's side of the rewards programme: what may be redeemed, for how
   much, and why a redemption is refused. No React and no Supabase, so the rules
   can be tested without a network.

   These rules are stated twice on purpose. Here, so the screen can refuse
   before it asks and say why in the customer's own words; and again inside
   `redeem_points()` in the database, because a client that is only asked
   nicely is a client that can decline to answer. The wording is deliberately
   kept in step between the two — a refusal that reads differently depending on
   which layer caught it is two rules wearing one name. */

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
