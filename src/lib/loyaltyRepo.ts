/* The only module that reads the customer's rewards account or redeems from it.
   Rules live in loyalty.ts so they can be tested without a network. */

import { supabase } from './supabase'
import { validateRedemption } from './loyalty'
import type { Check, Member, Programme, RedeemOption } from './loyalty'
import type { LoyaltyTier, EarnRule, LoyaltyLedgerEntry } from '../types'

export type Result = Check

export interface RewardsBook {
  programme: Programme | null
  member: Member | null
  tiers: LoyaltyTier[]
  rules: EarnRule[]
  options: RedeemOption[]
  ledger: LoyaltyLedgerEntry[]
  loadError?: string
}

const EMPTY: RewardsBook = {
  programme: null, member: null, tiers: [], rules: [], options: [], ledger: [],
}

/**
 * The customer's whole rewards account in one read.
 *
 * `member` comes back under row-level security rather than by a hard-coded id:
 * the screen used to ask for LM-4001 by name, which is right for exactly one
 * demo login and wrong for everybody else. There is one row visible here and it
 * is the caller's own.
 */
export async function loadMyRewards(): Promise<RewardsBook> {
  const [p, m, t, r, o, l] = await Promise.all([
    supabase.from('loyalty_programme').select('*').maybeSingle(),
    supabase.from('loyalty_members').select('*').maybeSingle(),
    supabase.from('loyalty_tiers').select('*').order('sort_order'),
    supabase.from('loyalty_earn_rules').select('*').order('id'),
    supabase.from('loyalty_redeem_options').select('*').order('min'),
    supabase.from('loyalty_ledger').select('*').order('when_date', { ascending: false }),
  ])

  const errors: string[] = []
  const grab = <T>(res: { data: unknown; error: { message: string } | null }, what: string): T[] => {
    if (res.error) errors.push(`${what}: ${res.error.message}`)
    return (res.data ?? []) as T[]
  }

  const member = (m.data ?? null) as Member | null

  return {
    ...EMPTY,
    programme: (p.data ?? null) as Programme | null,
    member: member ? { ...member, balance: Number(member.balance) } : null,
    tiers: grab<LoyaltyTier>(t, 'tiers'),
    rules: grab<EarnRule>(r, 'how points are earned'),
    options: grab<RedeemOption>(o, 'what points buy'),
    /* Only this member's movements. The seller and marketplace consoles read
       the same table through their own policies, and a customer's history
       should not depend on which of those happens to overlap. */
    ledger: grab<LoyaltyLedgerEntry>(l, 'your points history')
      .filter(e => !member || e.member === member.id),
    ...(errors.length ? { loadError: `Some of this did not load (${errors.join('; ')}).` } : {}),
  }
}

/**
 * Redeem points.
 *
 * The client no longer writes the ledger — it cannot, the policies that let it
 * are gone. `redeem_points()` reads the option, the programme and the balance
 * for itself and posts the movement, so a caller that lies about any of them is
 * describing a world the function does not read. This checks first anyway, so
 * the refusal is a sentence rather than a database error.
 */
export async function redeemPoints(
  { book, optionId, points }: { book: RewardsBook; optionId: string; points: number },
): Promise<Result & { worth?: number; balance?: number }> {
  const option = book.options.find(o => o.id === optionId)
  const check = validateRedemption({
    member: book.member, option, programme: book.programme, points,
  })
  if (!check.ok) return check

  const { data, error } = await supabase.rpc('redeem_points', {
    p_option: optionId, p_points: points,
  })
  if (error) return { ok: false, reason: friendly(error.message) }

  const row = (Array.isArray(data) ? data[0] : data) as
    { ledger_id: string; worth: number; new_balance: number } | undefined
  if (!row) return { ok: false, reason: REFUSED }

  return {
    ok: true,
    note: `${Math.round(points).toLocaleString('en-US')} pts redeemed for $${Number(row.worth).toFixed(2)} of ${option!.name.toLowerCase()}.`,
    worth: Number(row.worth),
    balance: Number(row.new_balance),
  }
}

/* --------------------------------------------------------------- helpers -- */

const REFUSED = 'Nothing changed — that redemption was not accepted.'

/** `redeem_points()` refuses in its own words on purpose; this strips the
    Postgres wrapper so the customer reads the sentence and not the stack. */
function friendly(message: string): string {
  const m = message.replace(/^.*?\bERROR:\s*/i, '').trim()
  if (/permission denied|row-level security/i.test(m)) {
    return 'Your rewards account is not accepting redemptions at the moment.'
  }
  return m
}
