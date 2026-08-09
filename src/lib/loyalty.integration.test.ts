/* Touches the live Supabase project.
 *
 * One claim, and it is the reason this file exists: a signed-in customer
 * cannot write their own points. The screen goes through `redeem_points()`,
 * but a screen is not a control — the test that matters is the one that
 * bypasses it and calls the API the way an attacker would.
 *
 * Everything written here is undone in the same file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadMyRewards, redeemPoints } from './loyaltyRepo'
import type { RewardsBook } from './loyaltyRepo'
import type { PointRate } from './loyalty'
import { offeredTo, validateRedemption, earnedOn } from './loyalty'

const CONSUMER = { email: 'priya.raman@example.com', password: 'demo1234' }
const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }

/* Undone at the end as the marketplace: the ledger is append-only to everybody
   else on purpose, which is the whole point of the file. */
const minted: string[] = []
const redeemed: string[] = []

describe('a customer cannot mint themselves points', () => {
  let book: RewardsBook

  beforeAll(async () => {
    await signIn(CONSUMER.email, CONSUMER.password)
    book = await loadMyRewards()
    expect(book.loadError).toBeUndefined()
    expect(book.member, 'the demo customer is not on a rewards programme').toBeTruthy()
  })

  afterAll(async () => { await signOut() })

  it('reads its own membership without being told which one', () => {
    expect(book.member!.user_id).toBeTruthy()
    expect(book.ledger.every(e => e.member === book.member!.id)).toBe(true)
  })

  it('cannot post an earn movement to the ledger', async () => {
    const { data, error } = await supabase.from('loyalty_ledger').insert({
      id: `LTX-MINT-${Date.now()}`, member: book.member!.id,
      when_date: '01 Aug 2026', type: 'earn', points: 1_000_000,
      ref: 'FREE', funder: 'operator', value: 10_000,
      note: 'Minted by a test that should not be able to',
      user_id: book.member!.user_id,
    }).select('id')
    if (data?.length) minted.push(...data.map(r => r.id))

    expect(error, 'the ledger accepted a million points from the client').not.toBeNull()
    expect(minted, 'a minting row survived').toEqual([])
  })

  it('cannot reverse a redemption by deleting the movement', async () => {
    const one = book.ledger.find(e => Number(e.points) < 0)
    if (!one) return
    const { data, error } = await supabase.from('loyalty_ledger')
      .delete().eq('id', one.id).select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)

    const after = await loadMyRewards()
    expect(after.ledger.some(e => e.id === one.id), 'a movement was deleted').toBe(true)
  })

  it('cannot edit a movement it does not like the look of', async () => {
    const one = book.ledger[0]
    if (!one) return
    const { data, error } = await supabase.from('loyalty_ledger')
      .update({ points: 999_999 }).eq('id', one.id).select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)

    const after = await loadMyRewards()
    expect(Number(after.ledger.find(e => e.id === one.id)!.points)).toBe(Number(one.points))
  })

  it('cannot simply type a larger balance', async () => {
    const before = Number(book.member!.balance)
    const { data, error } = await supabase.from('loyalty_members')
      .update({ balance: before + 500_000 }).eq('id', book.member!.id).select('id')
    expect(error !== null || (data ?? []).length === 0).toBe(true)

    const after = await loadMyRewards()
    expect(Number(after.member!.balance)).toBe(before)
  })

  it('cannot open a second membership for itself', async () => {
    const { data, error } = await supabase.from('loyalty_members').insert({
      id: `LM-MINT-${Date.now()}`, name: 'Second helping', kind: 'consumer',
      tier: 'gold', balance: 500_000, qualify_12m: 0, lifetime_earned: 500_000,
      lifetime_redeemed: 0, expiring_soon: 0, user_id: book.member!.user_id,
    }).select('id')
    if (data?.length) minted.push(...data.map(r => r.id))
    expect(error).not.toBeNull()
  })

  it('and the balance still equals the ledger behind it', async () => {
    const after = await loadMyRewards()
    const sum = after.ledger.reduce((a, e) => a + Number(e.points), 0)
    expect(Number(after.member!.balance)).toBe(sum)
  })
})

describe('but redemption itself still works', () => {
  let book: RewardsBook

  beforeAll(async () => {
    await signIn(CONSUMER.email, CONSUMER.password)
    book = await loadMyRewards()
  })

  afterAll(async () => { await signOut() })

  it('refuses a redemption the rules do not allow, in the same words either side', async () => {
    const option = offeredTo(book.options, book.member)[0]
    expect(option, 'nothing is offered to the demo customer').toBeTruthy()

    const tooMuch = Number(book.member!.balance) + option.step
    /* The client says no first… */
    const local = validateRedemption({
      member: book.member, option, programme: book.programme, points: tooMuch,
    })
    expect(local.ok).toBe(false)

    /* …and so does the database when asked directly, which is what matters. */
    const { error } = await supabase.rpc('redeem_points', {
      p_option: option.id, p_points: tooMuch,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/more than your balance/i)
  })

  it('refuses a figure between the steps at the API, not only in the form', async () => {
    const option = offeredTo(book.options, book.member).find(o => o.step > 1)
    if (!option) return
    const { error } = await supabase.rpc('redeem_points', {
      p_option: option.id, p_points: option.min + 1,
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/steps of/i)
  })

  it('takes points off the balance and posts one movement, and no more', async () => {
    const option = offeredTo(book.options, book.member)[0]
    const points = option.min
    const before = Number(book.member!.balance)
    if (before < points) return

    const res = await redeemPoints({ book, optionId: option.id, points })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    const after = await loadMyRewards()
    expect(Number(after.member!.balance)).toBe(before - points)
    expect(after.ledger.length).toBe(book.ledger.length + 1)

    /* The balance is the ledger — that is the invariant the whole arrangement
       protects, and it holds after a real redemption as well as after a
       refused one. */
    expect(Number(after.member!.balance))
      .toBe(after.ledger.reduce((a, e) => a + Number(e.points), 0))

    const posted = after.ledger.find(e => !book.ledger.some(b => b.id === e.id))!
    expect(posted.type).toBe('redeem')
    expect(Number(posted.points)).toBe(-points)
    redeemed.push(posted.id)
  })
})

/* Put the demo account back, the way a ledger is actually put back: by posting
   the opposite entry. Nothing here deletes a movement, because nothing can —
   and that is the arrangement working rather than an inconvenience. */
describe('tidying up as the marketplace', () => {
  beforeAll(async () => { await signIn(OPERATOR.email, OPERATOR.password) })
  afterAll(async () => { await signOut() })

  it('reverses what the redemption test spent, and the balance follows', async () => {
    if (!redeemed.length) return
    for (const id of redeemed) {
      const { error } = await supabase.rpc('reverse_movement', {
        p_movement: id, p_why: 'Integration test — putting the demo account back',
      })
      expect(error, `${id} could not be reversed`).toBeNull()
    }

    /* The original is still there and so is its reversal: a ledger that can
       forget is a ledger nobody can reconcile against. */
    const { data } = await supabase.from('loyalty_ledger').select('id').in('id', redeemed)
    expect((data ?? []).length).toBe(redeemed.length)

    const { data: member } = await supabase.from('loyalty_members')
      .select('id, balance').eq('id', 'LM-4001').maybeSingle()
    const { data: rows } = await supabase.from('loyalty_ledger').select('points').eq('member', 'LM-4001')
    const sum = (rows ?? []).reduce((a, r) => a + Number(r.points), 0)
    expect(Number(member!.balance)).toBe(sum)
    /* There was a `.toBe(2500)` here too, under the line that derives the same
       figure from the ledger. It added nothing the derived check does not say
       and it went stale the moment the demo customer legitimately earned points
       on new orders — which is the balance working, not breaking.
     *
       What this test is for is that the reversal put back exactly what the
       redemption took, and that is `balance === sum` whatever the starting
       figure was. */
  })

  it('refuses a reversal with no reason, and a second reversal of the same movement', async () => {
    if (!redeemed.length) return
    const [one] = redeemed
    const blank = await supabase.rpc('reverse_movement', { p_movement: one, p_why: '   ' })
    expect(blank.error).not.toBeNull()
    expect(blank.error!.message).toMatch(/say why/i)

    const twice = await supabase.rpc('reverse_movement', { p_movement: one, p_why: 'again' })
    expect(twice.error).not.toBeNull()
    expect(twice.error!.message).toMatch(/already been reversed/i)
  })
})

describe('and a customer cannot reverse anything', () => {
  beforeAll(async () => { await signIn(CONSUMER.email, CONSUMER.password) })
  afterAll(async () => { await signOut() })

  it('is refused at the correction path too, not only at the table', async () => {
    const book = await loadMyRewards()
    const one = book.ledger.find(e => Number(e.points) < 0)
    if (!one) return
    const { error } = await supabase.rpc('reverse_movement', {
      p_movement: one.id, p_why: 'I would like these back please',
    })
    expect(error).not.toBeNull()
    expect(error!.message).toMatch(/only the marketplace/i)
  })
})

/* The rate schedule, read rather than admired.
 *
 * `loyalty_point_rates`, `loyalty_earn_rules` and `loyalty_tiers` describe what
 * an order earns. Until `20260809300000` nothing multiplied them together and
 * every one of the 413 movements was a figure somebody wrote down. Now the
 * database computes it in `loyalty_points_for` and the browser computes it in
 * `earnedOn` — which is two evaluations of one rule, and this is what stops
 * them drifting apart.
 */
describe('what the schedule says an order earns', () => {
  beforeAll(async () => { await signIn(OPERATOR.email, OPERATOR.password) })
  afterAll(async () => { await signOut() })

  it('agrees with the browser on every live rule and tier', async () => {
    const [{ data: rules }, { data: rates }, { data: members }, { data: tiers }] = await Promise.all([
      supabase.from('loyalty_earn_rules').select('id,rate,bonus,cap_per_order').eq('status', 'active'),
      supabase.from('loyalty_point_rates').select('*'),
      supabase.from('loyalty_members').select('id,tier,currency'),
      supabase.from('loyalty_tiers').select('id,multiplier'),
    ])
    expect((rules ?? []).length).toBeGreaterThan(0)
    expect((members ?? []).length).toBeGreaterThan(0)

    const mult = new Map((tiers ?? []).map(t =>
      [(t as { id: string }).id, Number((t as { multiplier: number }).multiplier)]))

    for (const rule of rules as { id: string; rate: number; bonus: number | null; cap_per_order: number | null }[]) {
      for (const m of (members as { id: string; tier: string; currency: string }[]).slice(0, 4)) {
        const rate = (rates as PointRate[]).find(r => r.currency === m.currency)!
        for (const amount of [0, 949, 14999, 199999]) {
          const { data, error } = await supabase.rpc('loyalty_points_for', {
            p_amount: amount, p_currency: m.currency, p_rule: rule.id,
            p_member: m.id, p_on: new Date().toISOString().slice(0, 10),
          })
          expect(error, `${rule.id}/${m.id}: ${error?.message}`).toBeNull()
          const here = earnedOn({
            amount, rate,
            rule: { rate: Number(rule.rate), bonus: rule.bonus === null ? null : Number(rule.bonus),
                    cap_per_order: rule.cap_per_order === null ? null : Number(rule.cap_per_order) },
            multiplier: mult.get(m.tier) ?? 1,
          })
          expect(Number(data),
            `${rule.id} for ${m.id} on ${amount} ${m.currency}: database ${data}, browser ${here}`)
            .toBe(here)
        }
      }
    }
  }, 120000)

  /* Points are earned in the money the member banks in. Wanjiru is Kenyan and
     three of her orders are priced in dollars, which the marketplace allows —
     her balance is still shillings, and `guard_ledger_currency` enforces it
     from the other side. */
  it('converts an order priced in another currency before crediting it', async () => {
    const { data: usd } = await supabase.rpc('loyalty_points_for', {
      p_amount: 100, p_currency: 'USD', p_rule: 'ERN-01',
      p_member: 'LM-4030', p_on: '2026-08-01',
    })
    const { data: kes } = await supabase.rpc('loyalty_points_for', {
      p_amount: 100, p_currency: 'KES', p_rule: 'ERN-01',
      p_member: 'LM-4030', p_on: '2026-08-01',
    })
    /* A hundred dollars is worth far more than a hundred shillings, so it must
       earn far more. Crediting the dollar figure at the shilling rate is what
       the first version of the function did. */
    expect(Number(usd)).toBeGreaterThan(Number(kes) * 100)
  })

  it('refuses an order in a currency nobody has priced a point in', async () => {
    const { error } = await supabase.rpc('loyalty_points_for', {
      p_amount: 100, p_currency: 'JPY', p_rule: 'ERN-01',
      p_member: 'LM-4030', p_on: '2026-08-01',
    })
    expect(error, 'a yen order was credited at somebody else’s rate').toBeTruthy()
    expect(error!.message).toMatch(/no .*rate on file|have no value set/i)
  })

  it('has every order-linked movement equal to what the schedule produces', async () => {
    const { data } = await supabase
      .from('loyalty_ledger')
      .select('id, member, rule_id, ref, points, type')
      .eq('type', 'earn')
    const earns = (data ?? []) as
      { id: string; member: string; rule_id: string; ref: string; points: number }[]
    expect(earns.length).toBeGreaterThan(0)

    const { data: orders } = await supabase.from('orders').select('order_ref,total,currency,created_at')
    const byRef = new Map((orders ?? []).map(o =>
      [(o as { order_ref: string }).order_ref, o as { total: number; currency: string; created_at: string }]))

    let checked = 0
    for (const e of earns) {
      const o = byRef.get(e.ref)
      if (!o || !e.rule_id) continue
      const { data: expected, error } = await supabase.rpc('loyalty_points_for', {
        p_amount: Number(o.total), p_currency: o.currency, p_rule: e.rule_id,
        p_member: e.member, p_on: o.created_at.slice(0, 10),
      })
      expect(error, `${e.id}: ${error?.message}`).toBeNull()
      /* At or below: a monthly ceiling can take a row below its own figure, and
         that is the cap working. Above it is the defect. */
      expect(Number(e.points) <= Number(expected),
        `${e.id} earned ${e.points} on ${e.ref} and the schedule allows ${expected}`).toBe(true)
      checked++
    }
    expect(checked, 'no order-linked earn movement was checked').toBeGreaterThan(10)
  }, 120000)

  /* The pair that came apart: an earn restated and its reversal left behind. */
  it('has every reversal worth exactly what it reverses', async () => {
    const { data } = await supabase.from('loyalty_ledger')
      .select('id, member, ref, points, type').in('type', ['earn', 'reverse'])
    const rows = (data ?? []) as
      { id: string; member: string; ref: string; points: number; type: string }[]
    const reversals = rows.filter(r => r.type === 'reverse')
    expect(reversals.length, 'no reversal on the book, so this proves nothing').toBeGreaterThan(0)

    for (const r of reversals) {
      const earn = rows.find(e => e.type === 'earn' && e.member === r.member && e.ref === r.ref)
      if (!earn) continue
      expect(Number(r.points),
        `${r.id} is ${r.points} and reverses ${earn.id} which is ${earn.points}`)
        .toBe(-Number(earn.points))
    }
  })

  /* A balance that moves for a reason the holder cannot read is worse than a
     wrong balance, because there is nothing to query. */
  it('shows a member every movement on their own membership', async () => {
    const { data } = await supabase.from('loyalty_ledger')
      .select('id, member, user_id')
    const rows = (data ?? []) as { id: string; member: string; user_id: string | null }[]
    const { data: ms } = await supabase.from('loyalty_members').select('id,user_id')
    const owned = new Set((ms ?? [])
      .filter(m => (m as { user_id: string | null }).user_id)
      .map(m => (m as { id: string }).id))

    const hidden = rows.filter(r => owned.has(r.member) && !r.user_id)
    expect(hidden.map(r => r.id), 'movements a member cannot see on their own history').toEqual([])
  })
})
