/* Touches the live Supabase project.
 *
 * Two claims that only the database can settle. The first is that an
 * organisation is on the organisation ladder — a company on the consumer
 * thresholds is top tier on its first invoice, which makes the tier
 * meaningless. The second is that spending company points needs two people,
 * enforced by a trigger rather than by the screen that draws the buttons.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadAccount } from './enterpriseRepo'
import { loadRewards, proposeRedemption, decideRedemption, withdrawRedemption } from './enterpriseRewardsRepo'
import type { RewardBook } from './enterpriseRewardsRepo'
import {
  balanceOf, summarise, tiersFor, tierProgress, qualifiesFor, optionsFor,
  canRelease, availablePoints, byRule,
} from './enterpriseRewards'
import type { Member } from './enterprise'

const ENTERPRISE = { email: 'vikram.shah@smartbuild.in', password: 'enterprise123' }
const OPERATOR   = { email: 'anika.sharma@aventa.com',   password: 'operator123' }
const PARTNER    = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const ACCOUNT = 'ENT-2007'

describe('the organisation\'s reward account', () => {
  let book: RewardBook
  let me: Member | null

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    book = await loadRewards()
    me = (await loadAccount()).me
    expect(book.loadError).toBeUndefined()
  })

  afterAll(async () => { await signOut() })

  it('sees its own member row and nobody else\'s', async () => {
    expect(book.member?.account_id).toBe(ACCOUNT)
    const { data } = await supabase.from('loyalty_members').select('id,account_id')
    expect(data!.every(m => m.account_id === ACCOUNT)).toBe(true)
  })

  it('sees only its own movements', async () => {
    const { data } = await supabase.from('loyalty_ledger').select('member')
    expect(data!.length).toBeGreaterThan(0)
    expect(data!.every(m => m.member === book.member!.id)).toBe(true)
  })

  it('is on the organisation ladder, not the consumer one', () => {
    const tier = book.tiers.find(t => t.id === book.member!.tier)!
    expect(tier.kind).toBe('enterprise')
    expect(tiersFor(book.tiers, 'enterprise').length).toBe(4)
  })

  it('holds the tier its spend actually qualifies for', () => {
    const should = qualifiesFor(Number(book.member!.qualify_12m), book.tiers, 'enterprise')!
    expect(book.member!.tier).toBe(should.id)
  })

  it('would be top tier on the consumer ladder, which is why there are two', () => {
    const consumerTop = qualifiesFor(Number(book.member!.qualify_12m), book.tiers, 'consumer')!
    expect(consumerTop.qualify_spend).toBeLessThan(Number(book.member!.qualify_12m))
    expect(tierProgress(book.member!, book.tiers).top).toBe(false)
  })

  it('has a balance that is the sum of its movements, not a number somebody typed', () => {
    expect(balanceOf(book.movements)).toBe(Number(book.member!.balance))
  })

  it('reconciles earned less redeemed to the balance', () => {
    const s = summarise(book.movements)
    expect(s.earned - s.redeemed - s.expired - s.reversed).toBe(s.balance)
    expect(s.earned).toBe(Number(book.member!.lifetime_earned))
  })

  it('traces every earn to an invoice the account was billed for', async () => {
    const { data } = await supabase.from('enterprise_invoices').select('id')
    const invoices = new Set(data!.map(i => i.id))
    for (const m of book.movements.filter(m => m.type === 'earn')) {
      expect(invoices.has(m.ref ?? ''), `${m.id} names ${m.ref}`).toBe(true)
    }
  })

  it('earns under rules written for a business, on what a business buys', () => {
    const used = byRule(book.movements, book.rules)
    expect(used.length).toBeGreaterThan(2)
    for (const r of used) {
      expect(r.rule, `${r.id} is not in the rule book`).toBeTruthy()
      expect(r.rule!.status).toBe('active')
      expect(['all', 'enterprise']).toContain(r.rule!.audience)
    }
    /* At least one accelerator aimed squarely at the business catalogue. */
    expect(used.some(r => r.rule!.audience === 'enterprise' && r.rule!.scope === 'vertical')).toBe(true)
  })

  it('pays a first-purchase rule once, not on every monthly invoice', () => {
    for (const rule of book.rules.filter(r => r.first_only)) {
      const n = book.movements.filter(m => m.rule_id === rule.id).length
      expect(n, `${rule.id} paid ${n} times`).toBeLessThanOrEqual(1)
    }
  })

  it('keeps every rule inside its own monthly cap', () => {
    for (const rule of book.rules.filter(r => r.cap_per_month !== null)) {
      const byMonth = new Map<string, number>()
      for (const m of book.movements.filter(m => m.rule_id === rule.id && m.type === 'earn')) {
        const key = m.when_date.split(' ').slice(1).join(' ')
        byMonth.set(key, (byMonth.get(key) ?? 0) + Number(m.points))
      }
      for (const [month, points] of byMonth) {
        expect(points, `${rule.id} issued ${points} in ${month}`).toBeLessThanOrEqual(rule.cap_per_month!)
      }
    }
  })

  it('offers only what a business can actually take', () => {
    const opts = optionsFor(book.options, book.member!)
    expect(opts.length).toBeGreaterThan(0)
    expect(opts.every(o => o.audience !== 'consumer')).toBe(true)
    expect(opts.every(o => o.status === 'active')).toBe(true)
  })

  it('does not let two proposals spend the same points', () => {
    const free = availablePoints(book.member!, book.redemptions)
    expect(free).toBeLessThan(Number(book.member!.balance))
    expect(free).toBeGreaterThanOrEqual(0)
  })

  it('refuses the lead releasing something they proposed themselves', () => {
    const mine = book.redemptions.find(r => r.state === 'proposed' && r.proposed_by === me!.id)
    if (!mine) return
    const c = canRelease(mine, me!.role, me!.id, book.policy!)
    expect(c.ok).toBe(false)
  })
})

describe('isolation', () => {
  afterAll(async () => { await signOut() })

  it('shows a seller nothing of the buyer\'s reward account', async () => {
    await signIn(PARTNER.email, PARTNER.password)
    const [mem, red] = await Promise.all([
      supabase.from('loyalty_members').select('id').eq('account_id', ACCOUNT),
      supabase.from('enterprise_redemptions').select('id'),
    ])
    expect(mem.data ?? []).toEqual([])
    expect(red.data ?? []).toEqual([])
    await signOut()
  })

  it('shows the marketplace every organisation, because it funds the programme', async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const { data } = await supabase.from('loyalty_members').select('id').eq('kind', 'enterprise')
    expect(data!.length).toBeGreaterThan(1)
    await signOut()
  })
})

describe('proposing and releasing, for real', () => {
  let book: RewardBook
  let me: Member
  let raised: string | null = null

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    book = await loadRewards()
    me = (await loadAccount()).me!
  })

  afterAll(async () => {
    /* As the operator, because the trigger refuses to re-open a decision for
       the account that made it — which is the behaviour being tested. */
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    if (raised) {
      await supabase.from('loyalty_ledger').delete().eq('id', `LTX-RDX-${raised.replace(/\D/g, '')}`)
      await supabase.from('enterprise_redemptions').delete().eq('id', raised)
    }
    await signOut()
  })

  it('refuses a proposal below the account minimum', async () => {
    const res = await proposeRedemption({
      book, me, option: optionsFor(book.options, book.member!)[0],
      points: 100, reason: 'too small', costCentre: 'CC-1000',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/minimum on this account/)
  })

  it('refuses more points than the account holds', async () => {
    const res = await proposeRedemption({
      book, me, option: optionsFor(book.options, book.member!)[0],
      points: 99_000_000, reason: 'far too much', costCentre: 'CC-1000',
    })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/more than the/)
  })

  it('raises one, then refuses to let the same person release it', async () => {
    const option = optionsFor(book.options, book.member!).find(o => o.id === 'RDM-02')!
    const res = await proposeRedemption({
      book, me, option, points: 6000,
      reason: 'Integration test — proposed and released by different people.',
      costCentre: 'CC-1000',
    })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    const after = await loadRewards()
    const mine = after.redemptions.find(r => r.proposed_by === me.id && r.state === 'proposed' && r.points === 6000)!
    expect(mine).toBeTruthy()
    raised = mine.id

    /* The screen refuses… */
    const check = canRelease(mine, me.role, me.id, after.policy!)
    expect(check.ok).toBe(false)

    /* …and so does the database, asked directly. */
    const { error } = await supabase.from('enterprise_redemptions')
      .update({ state: 'applied' }).eq('id', mine.id)
    expect(error, 'the database allowed a self-release').toBeTruthy()
    expect(error!.message).toMatch(/money too/i)

    const { data } = await supabase.from('enterprise_redemptions').select('state').eq('id', mine.id).single()
    expect(data!.state).toBe('proposed')
  })

  it('lets the proposer withdraw their own, and the points stay put', async () => {
    const before = await loadRewards()
    const mine = before.redemptions.find(r => r.id === raised)!
    const res = await withdrawRedemption(mine, me)
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    const after = await loadRewards()
    expect(after.redemptions.find(r => r.id === raised)!.state).toBe('withdrawn')
    expect(Number(after.member!.balance)).toBe(Number(before.member!.balance))
  })

  it('will not let a client edit the balance directly', async () => {
    const before = await loadRewards()
    await supabase.from('loyalty_members').update({ balance: 999999 }).eq('id', before.member!.id)
    const after = await loadRewards()
    expect(Number(after.member!.balance)).toBe(Number(before.member!.balance))
  })

  it('will not let a client write itself a movement', async () => {
    const before = await loadRewards()
    const { error } = await supabase.from('loyalty_ledger').insert({
      id: `LTX-CHEAT-${Date.now()}`, member: before.member!.id, when_date: '01 Aug 2026',
      type: 'earn', points: 500000, ref: 'INV-2026-0779', funder: 'operator', value: 5000,
    })
    const after = await loadRewards()
    expect(balanceOf(after.movements)).toBe(balanceOf(before.movements))
    if (error) expect(error.message).toBeTruthy()
  })
})

describe('a release that goes all the way through', () => {
  let book: RewardBook
  let me: Member
  let target: string | null = null
  let ledgerRef: string | null = null

  beforeAll(async () => {
    await signIn(ENTERPRISE.email, ENTERPRISE.password)
    book = await loadRewards()
    me = (await loadAccount()).me!
  })

  /**
   * Put it back the way a ledger is put back: by posting the opposite entry.
   *
   * `loyalty_ledger` has no delete and no update policy for anybody, on purpose
   * — a ledger a console can edit is not a ledger. `reverse_movement()` is the
   * marketplace's guarded correction path, and the rebalance trigger carries
   * the points home behind it. This file used to be un-re-runnable for want of
   * exactly that.
   */
  afterAll(async () => {
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    if (ledgerRef) {
      const { data } = await supabase.from('loyalty_ledger').select('id').eq('id', ledgerRef)
      if (data?.length) {
        await supabase.rpc('reverse_movement', {
          p_movement: ledgerRef,
          p_why: 'Integration test — putting the demo account back',
        })
      }
    }
    if (target) {
      await supabase.from('enterprise_redemptions').update({
        state: 'proposed', released_by: null, released_on: null,
        decision_note: null, applied_to: null, applied_on: null, ledger_ref: null,
      }).eq('id', target)
    }

    /* The balance comes back on its own: `loyalty_ledger_rebalance` recomputes
       it from the ledger whenever a row goes in, out or changes. Nothing here
       sets it directly and nothing should, so this asserts the trigger did its
       job rather than doing it — and that the account is where it started. */
    const member = book.member?.id
    if (member) {
      const [{ data: rows }, { data: m }] = await Promise.all([
        supabase.from('loyalty_ledger').select('points').eq('member', member),
        supabase.from('loyalty_members').select('balance').eq('id', member).maybeSingle(),
      ])
      const total = (rows ?? []).reduce((a, r) => a + Number(r.points), 0)
      expect(Number(m!.balance), `${member}'s balance does not match its ledger`).toBe(total)
      expect(Number(m!.balance), `${member} did not come back to where it started`).toBe(86630)
    }
    await signOut()
  })

  it('releases a colleague\'s proposal and takes the points off the balance', async () => {
    const mine = book.redemptions.find(r => r.state === 'proposed' && r.proposed_by !== me.id)
    expect(mine, 'nothing on the account was proposed by somebody else').toBeTruthy()
    target = mine!.id

    const before = Number(book.member!.balance)
    const res = await decideRedemption({ book, me, redemption: mine!, release: true, note: 'Released by the test.' })
    expect(res.ok, res.ok ? '' : res.reason).toBe(true)

    const after = await loadRewards()
    const saved = after.redemptions.find(r => r.id === target)!
    expect(['released', 'applied']).toContain(saved.state)
    expect(saved.released_by).toBe(me.id)
    expect(saved.released_on).toBeTruthy()

    /* The points actually moved — a release with no movement is a balance
       that says one thing and a history that says another. */
    expect(Number(after.member!.balance)).toBe(before - mine!.points)
    expect(balanceOf(after.movements)).toBe(Number(after.member!.balance))

    /* Read the movement rather than guessing its id. `apply_redemption()` mints
       one per posting, so that a redemption reversed and released again gets a
       second row instead of silently getting none — and a test that predicts
       the id would go on passing while the reversal path quietly broke. */
    const posted = after.movements.find(m => !book.movements.some(b => b.id === m.id))
    expect(posted, 'the release posted no movement').toBeTruthy()
    expect(posted!.type).toBe('redeem')
    expect(Number(posted!.points)).toBe(-mine!.points)
    ledgerRef = posted!.id
  })

  it('refuses to release it a second time', async () => {
    const fresh = await loadRewards()
    const saved = fresh.redemptions.find(r => r.id === target)!
    const res = await decideRedemption({ book: fresh, me, redemption: saved, release: true, note: '' })
    expect(res.ok).toBe(false)
  })
})
