/* The only module that reads or writes the organisation's reward account.
   Rules live in enterpriseRewards.ts so they can be tested without a network.

   Nothing here writes the balance. A balance a client can set is not a
   balance — it is the sum of the movements, and the movements are written by
   the platform when something is earned or released. */

import { supabase } from './supabase'
import {
  validateProposal, validateRelease, canPropose, canRelease, pointsWorth, rateFor,
  fmtPoints,
} from './enterpriseRewards'
import type {
  Tier, RewardMember, Movement, RewardRule, RedeemOption, RewardPolicy, Redemption,
  Check, PointRate, Threshold, Fmt,
} from './enterpriseRewards'
import { format as formatMoney, money as asMoney } from './money'
import type { Currency } from './money'
import type { Member } from './enterprise'

export type Result = Check

export interface RewardBook {
  member: RewardMember | null
  tiers: Tier[]
  movements: Movement[]
  rules: RewardRule[]
  options: RedeemOption[]
  policy: RewardPolicy | null
  redemptions: Redemption[]
  /* What a point is worth, per currency, and what each rung costs in each.
     Both are chosen figures rather than converted ones — see the migration
     `20260802230000_a_point_is_worth_different_money_in_different_places`. */
  rates: PointRate[]
  thresholds: Threshold[]
  currencies: Currency[]
  loadError?: string
}

const EMPTY: RewardBook = {
  member: null, tiers: [], movements: [], rules: [], options: [],
  policy: null, redemptions: [], rates: [], thresholds: [], currencies: [],
}

/** The rate this account's points are denominated at, or null if nobody has
    priced a point in its currency. */
export const rateOf = (book: RewardBook): PointRate | null =>
  book.member ? rateFor(book.rates, book.member.currency) : null

/**
 * How to write an amount for this account.
 *
 * The repo builds one because it produces sentences of its own — the note that
 * comes back from proposing or releasing — and there is no React context down
 * here to ask. A screen builds its own from `useMarket`, which is the same
 * `format` underneath.
 */
export const fmtFor = (book: RewardBook): Fmt =>
  n => formatMoney(asMoney(n, book.member?.currency ?? 'USD'), book.currencies)

export async function loadRewards(): Promise<RewardBook> {
  const [m, t, l, r, o, p, x, pr, th, cur] = await Promise.all([
    supabase.from('loyalty_members').select('*').maybeSingle(),
    supabase.from('loyalty_tiers').select('*').order('sort_order'),
    supabase.from('loyalty_ledger').select('*'),
    supabase.from('loyalty_earn_rules').select('*').order('id'),
    supabase.from('loyalty_redeem_options').select('*').order('min'),
    supabase.from('enterprise_reward_policy').select('*').maybeSingle(),
    supabase.from('enterprise_redemptions').select('*').order('sort_order'),
    supabase.from('loyalty_point_rates').select('*'),
    supabase.from('loyalty_tier_thresholds').select('*'),
    supabase.from('currencies').select('*').order('sort_order'),
  ])

  const errors: string[] = []
  const grab = <T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] => {
    if (res.error) errors.push(`${what}: ${res.error.message}`)
    return (res.data ?? []) as T[]
  }

  return {
    ...EMPTY,
    member: (m.data ?? null) as RewardMember | null,
    tiers: grab<Tier>(t, 'tiers'),
    movements: grab<Movement>(l, 'movements'),
    rules: grab<RewardRule>(r, 'earn rules'),
    options: grab<RedeemOption>(o, 'what points buy'),
    policy: (p.data ?? null) as RewardPolicy | null,
    redemptions: grab<Redemption>(x, 'redemptions'),
    /* PostgREST hands numerics back as strings, and a rate that is a string
       divides to NaN — which renders as "NaN" rather than failing. */
    rates: grab<PointRate>(pr, 'what a point is worth').map(v => ({
      ...v, earn_per_unit: Number(v.earn_per_unit), per_unit: Number(v.per_unit),
    })),
    thresholds: grab<Threshold>(th, 'tier thresholds').map(v => ({
      ...v, qualify_spend: Number(v.qualify_spend),
    })),
    currencies: grab<Currency>(cur, 'currencies'),
    ...(errors.length ? { loadError: `Some of this did not load (${errors.join('; ')}).` } : {}),
  }
}

const REFUSED = 'Nothing changed — you are not allowed to make that change on this account.'

/** Putting a redemption forward. The value is fixed here, at the rate on the
    day, so nobody argues about the rate between proposing and releasing. */
export async function proposeRedemption(
  { book, me, option, points, reason, costCentre }: {
    book: RewardBook
    me: Member
    option: RedeemOption | null
    points: number
    reason: string
    costCentre: string | null
  },
): Promise<Result> {
  if (!book.member || !book.policy) return { ok: false, reason: 'This account is not enrolled in the programme.' }

  const allowed = canPropose(me.role, book.policy)
  if (!allowed.ok) return allowed

  const rate = rateOf(book)
  const fmt = fmtFor(book)
  const check = validateProposal({ option, points, reason, costCentre }, book.member, book.policy, rate, fmt)
  if (!check.ok) return check

  /* Refused rather than proposed at somebody else's rate. A redemption whose
     value was computed from a rate that does not apply here is a promise the
     account cannot be held to. */
  if (!rate) {
    return { ok: false, reason: `Points have no value set in ${book.member.currency} yet, so nothing can be proposed against them.` }
  }

  const worth = pointsWorth(points, rate)
  const { error } = await supabase.from('enterprise_redemptions').insert({
    id: `RDX-${Math.floor(Date.now() / 1000).toString().slice(-4)}`,
    account_id: book.member.account_id,
    member_id: book.member.id,
    option_id: option!.id,
    points,
    value: worth,
    /* `guard_redemption_currency` would fill this in, but a row that arrives
       saying what it is worth in is a row that can be checked rather than
       corrected. */
    currency: book.member.currency,
    cost_centre: costCentre,
    reason: reason.trim(),
    state: 'proposed',
    proposed_by: me.id,
    proposed_on: new Date().toISOString().slice(0, 10),
    sort_order: 0,
  })
  if (error) return { ok: false, reason: friendly(error.message) }

  return {
    ok: true,
    note: `${fmtPoints(points)} proposed — worth ${fmt(worth)}. Somebody who can release it has to sign it off before anything moves.`,
  }
}

/**
 * Releasing or declining one.
 *
 * Releasing produces the movement as well as the decision — a redemption
 * marked spent with the points still sitting there is a balance that says one
 * thing and a history that says another. Both happen in the same write
 * because the database does the second half; see the note below.
 */
export async function decideRedemption(
  { book, me, redemption, release, note }: {
    book: RewardBook; me: Member; redemption: Redemption; release: boolean; note: string
  },
): Promise<Result> {
  if (!book.policy || !book.member) return { ok: false, reason: 'This account is not enrolled in the programme.' }

  const allowed = canRelease(redemption, me.role, me.id, book.policy)
  if (!allowed.ok) return allowed
  const written = validateRelease(release, note)
  if (!written.ok) return written

  const { data, error } = await supabase.from('enterprise_redemptions').update({
    state: release ? (book.policy.auto_apply ? 'applied' : 'released') : 'declined',
    decision_note: note.trim() || (release ? 'Released.' : null),
    /* released_by and released_on are stamped by the trigger, which knows who
       is signed in. */
    /* The movement that takes the points off is written by `apply_redemption`
       in the database, not here. The account has no insert rights on the
       ledger — a balance a client can write is not a balance — so a caller
       that tried would mark the redemption spent and leave the points sitting
       there. */
    ...(release && book.policy.auto_apply
      ? { applied_on: new Date().toISOString().slice(0, 10) }
      : {}),
  }).eq('id', redemption.id).select('id')

  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }

  if (!release) {
    return { ok: true, note: `${redemption.id} declined. The points stay on the balance and the proposer has been told why.` }
  }

  return {
    ok: true,
    note: `${fmtPoints(redemption.points)} released, worth ${fmtFor(book)(Number(redemption.value))}. ${
      book.policy.auto_apply ? 'It lands on the next invoice automatically.' : 'It still has to be applied by hand.'
    }`,
  }
}

export async function withdrawRedemption(redemption: Redemption, me: Member): Promise<Result> {
  if (redemption.state !== 'proposed') {
    return { ok: false, reason: `${redemption.id} was already ${redemption.state}.` }
  }
  if (redemption.proposed_by !== me.id) {
    return { ok: false, reason: `Only the person who proposed ${redemption.id} can withdraw it.` }
  }
  const { data, error } = await supabase.from('enterprise_redemptions')
    .update({ state: 'withdrawn' }).eq('id', redemption.id).select('id')
  if (error) return { ok: false, reason: friendly(error.message) }
  if (!data?.length) return { ok: false, reason: REFUSED }
  return { ok: true, note: `${redemption.id} withdrawn. Nothing left the balance.` }
}

function friendly(message: string): string {
  const m = message.replace(/^.*?\bERROR:\s*/i, '').trim()
  if (/row-level security/i.test(m)) return 'You are not allowed to change that on this account.'
  if (/duplicate key/i.test(m)) return 'That already exists.'
  return m
}
