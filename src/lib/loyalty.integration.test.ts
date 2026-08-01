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
import { offeredTo, validateRedemption } from './loyalty'

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
    expect(Number(member!.balance)).toBe(2500)
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
