/* Touches the live Supabase project.
 *
 * The loyalty ledger is the one table where three parties' money meets: a
 * customer's points, a seller's settlement deduction and the marketplace's
 * promotions budget. Most of these checks are about that seam — that a seller
 * sees their own cost and no more, that a rule cannot spend somebody else's
 * margin, and that the arithmetic on both sides of a shared rule adds up.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadProgramme, loadSellerRewards } from './rewardsRepo'
import {
  rewardCost, byRule, rulesCosting, shareOf, costBySeller, pendingProposals, liability,
} from './sellerRewards'
import type { EarnRule, Movement } from './sellerRewards'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER  = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const DEMO = 'PTR-1004'

describe('the programme, read by the marketplace', () => {
  let rules: EarnRule[] = []
  let movements: Movement[] = []

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const book = await loadProgramme()
    expect(book.loadError).toBeUndefined()
    rules = book.rules
    movements = book.movements
    expect(rules.length).toBeGreaterThan(0)
    expect(movements.length).toBeGreaterThan(0)
  })

  afterAll(async () => { await signOut() })

  it('names a real seller on every rule scoped to one', () => {
    for (const r of rules.filter(x => x.scope === 'partner')) {
      expect(r.scope_id, `${r.id} is scoped to a seller with no id`).toBeTruthy()
    }
  })

  it('gives every shared rule a split, and gives nothing else one', () => {
    /* Without it neither side can compute their half, which is the argument
       this column exists to end. */
    for (const r of rules) {
      expect(r.split !== null, `${r.id} is ${r.funder} with split ${r.split}`).toBe(r.funder === 'shared')
    }
  })

  it('charges every non-marketplace movement to a named seller', () => {
    for (const m of movements) {
      if (m.funder === 'operator') continue
      expect(m.seller_id, `${m.id} is ${m.funder}-funded and names no seller`).toBeTruthy()
    }
  })

  it('never bills a seller under another seller’s rule', () => {
    for (const m of movements) {
      if (!m.rule_id || !m.seller_id) continue
      const r = rules.find(x => x.id === m.rule_id)
      if (!r || r.scope !== 'partner') continue
      expect(r.scope_id, `${m.id} bills ${m.seller_id} under ${r.id}, which belongs to ${r.scope_id}`)
        .toBe(m.seller_id)
    }
  })

  it('reverses the points on any order that was refunded', async () => {
    /* The defect this feature's migration was written to remove: a seller was
       being charged for loyalty on a sale that did not stand, while the refund
       record said in as many words that the points had gone back. */
    const { data } = await supabase.from('refunds').select('order_ref,state')
    const refunded = new Set(((data ?? []) as { order_ref: string; state: string }[])
      .filter(r => r.state === 'refunded' || r.state === 'partial')
      .map(r => r.order_ref))
    for (const m of movements.filter(x => x.type === 'earn' && x.ref && refunded.has(x.ref))) {
      const reversed = movements.some(x =>
        x.type === 'reverse' && x.ref === m.ref && x.member === m.member)
      expect(reversed, `${m.id} stands against ${m.ref}, which was refunded`).toBe(true)
    }
  })

  it('has proposals waiting, from more than one seller', () => {
    const pending = pendingProposals(rules)
    expect(pending.length).toBeGreaterThan(1)
    expect(new Set(pending.map(r => r.scope_id)).size).toBeGreaterThan(1)
  })

  it('splits the outstanding liability by who funded it, and by what it is owed in', async () => {
    const book = await loadProgramme()
    const owed = liability(book.members, book.movements, book.programme!, book.rates)

    /* Several debts, not one. The demo has members in rupees, shillings and
       dirhams, so a single gross figure would be three currencies added up. */
    expect(owed.gross.length, 'every member is in one currency, so this proves nothing')
      .toBeGreaterThan(1)
    for (const [i, g] of owed.gross.entries()) {
      expect(g.amount, `${g.currency} owes nothing`).toBeGreaterThan(0)
      expect(owed.expected[i].amount).toBeLessThan(g.amount)
      expect(owed.expected[i].currency).toBe(g.currency)
    }

    /* Every currency the members hold points in has a price for one. A member
       nobody has priced would be silently worth zero. */
    for (const m of book.members) {
      expect(book.rates.some(r => r.currency === m.currency),
        `nobody has priced a point in ${m.currency}, which ${m.name} holds`).toBe(true)
    }

    expect(owed.byFunder.operator + owed.byFunder.partner + owed.byFunder.shared)
      .toBeGreaterThan(0)
  })

  it('attributes cost to sellers without counting the marketplace as one', () => {
    const rows = costBySeller(movements, rules)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every(r => r.partner_id.startsWith('PTR-'))).toBe(true)
  })
})

describe('a seller reading what the programme costs them', () => {
  beforeAll(async () => { await signIn(PARTNER.email, PARTNER.password) })
  afterAll(async () => { await signOut() })

  it('sees the movements attributed to them and no others', async () => {
    const book = await loadSellerRewards(DEMO)
    expect(book.loadError).toBeUndefined()
    expect(book.movements.length).toBeGreaterThan(0)
    expect(book.movements.every(m => m.seller_id === DEMO)).toBe(true)
  })

  it('cannot see another seller’s cost', async () => {
    const other = await loadSellerRewards('PTR-1002')
    expect(other.movements).toEqual([])
  })

  it('cannot read who earned the points — only that somebody did', async () => {
    /* The member id travels on the row because the ledger is one table, but a
       seller must not be able to resolve it to a person. */
    const { data } = await supabase.from('loyalty_members').select('id,name')
    expect(data ?? []).toEqual([])
  })

  it('has a bill with all four parts on it, in each currency it trades in', async () => {
    const book = await loadSellerRewards(DEMO)
    const cost = rewardCost(book.movements, book.rules)
    const at = (list: readonly { amount: number; currency: string }[], c: string) =>
      list.find(m => m.currency === c)?.amount ?? 0

    expect(cost.issuingCost.length).toBeGreaterThan(0)
    expect(cost.clawedBack.length).toBeGreaterThan(0)
    expect(cost.redemptionCost.length).toBeGreaterThan(0)

    /* The identity, held inside each currency and never across them. */
    for (const t of cost.total) {
      expect(t.amount, `${t.currency} does not reconcile`).toBeCloseTo(
        at(cost.issuingCost, t.currency)
        - at(cost.clawedBack, t.currency)
        + at(cost.redemptionCost, t.currency), 2)
    }
  })

  it('is billed for points issued in a market other than its own', async () => {
    /* This seller has points issued against its products in three currencies.
       The old single total added them and printed a dollar sign; the check that
       finds that is not arithmetic, it is that more than one currency is here
       at all. */
    const book = await loadSellerRewards(DEMO)
    const seen = new Set(book.movements.map(m => m.currency))
    expect(seen.size, `${DEMO} only ever sold into ${[...seen].join(', ')}`).toBeGreaterThan(1)
    for (const m of book.movements) {
      expect(book.rates.some(r => r.currency === m.currency),
        `${m.id} is in ${m.currency}, which nobody has priced a point in`).toBe(true)
    }
  })

  it('breaks the bill down by campaign', async () => {
    const book = await loadSellerRewards(DEMO)
    const rows = byRule(book.movements, book.rules)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0].points).toBeGreaterThanOrEqual(rows[rows.length - 1].points)
    /* Never a bucket per movement — each rule's cost is one figure per currency. */
    for (const r of rows) {
      expect(new Set(r.cost.map(m => m.currency)).size).toBe(r.cost.length)
    }
  })

  it('is shown no rule scoped to somebody else', async () => {
    const book = await loadSellerRewards(DEMO)
    for (const r of rulesCosting(book.rules, DEMO)) {
      if (r.scope !== 'partner') continue
      expect(r.scope_id, `${r.id} belongs to ${r.scope_id}`).toBe(DEMO)
    }
  })

  it('is charged only its own half of a shared rule', async () => {
    const book = await loadSellerRewards(DEMO)
    const shared = book.rules.find(r => r.funder === 'shared' && r.split !== null)!
    expect(shareOf({ ...book.movements[0], funder: 'shared', rule_id: shared.id }, book.rules))
      .toBeCloseTo((100 - shared.split!) / 100, 4)
  })

  /* The three ways a seller could spend money that is not theirs. Each writes
     for real and asserts the row never appeared. */
  it('cannot write a rule against another seller', async () => {
    await supabase.from('loyalty_earn_rules').insert({
      id: 'ERN-HACK-1', name: 'Not mine', scope: 'partner', scope_id: 'PTR-1002',
      rate: 3, funder: 'partner', split: null, status: 'pending',
      from: '01 Aug 2026', to: null, cap_per_order: 100, audience: 'all',
      why: 'spending somebody else’s margin', proposed_by: 'me', proposed_on: '2026-07-31',
    })
    const { data } = await supabase.from('loyalty_earn_rules').select('id').eq('id', 'ERN-HACK-1')
    expect(data ?? [], 'a seller wrote a rule against another seller').toEqual([])
  })

  it('cannot write a rule the marketplace pays for', async () => {
    await supabase.from('loyalty_earn_rules').insert({
      id: 'ERN-HACK-2', name: 'On the house', scope: 'partner', scope_id: DEMO,
      rate: 3, funder: 'operator', split: null, status: 'pending',
      from: '01 Aug 2026', to: null, cap_per_order: 100, audience: 'all',
      why: 'spending the marketplace’s budget', proposed_by: 'me', proposed_on: '2026-07-31',
    })
    const { data } = await supabase.from('loyalty_earn_rules').select('id').eq('id', 'ERN-HACK-2')
    expect(data ?? [], 'a seller wrote a marketplace-funded rule').toEqual([])
  })

  it('cannot write a rule that is already live', async () => {
    await supabase.from('loyalty_earn_rules').insert({
      id: 'ERN-HACK-3', name: 'Straight to live', scope: 'partner', scope_id: DEMO,
      rate: 3, funder: 'partner', split: null, status: 'active',
      from: '01 Aug 2026', to: null, cap_per_order: 100, audience: 'all',
      why: 'skipping the approval', proposed_by: 'me', proposed_on: '2026-07-31',
    })
    const { data } = await supabase.from('loyalty_earn_rules').select('id').eq('id', 'ERN-HACK-3')
    expect(data ?? [], 'a seller published a live rule without approval').toEqual([])
  })

  it('cannot delete a rule that is already running', async () => {
    const before = await loadSellerRewards(DEMO)
    const live = before.rules.find(r => r.scope === 'partner' && r.scope_id === DEMO && r.status === 'active')!
    await supabase.from('loyalty_earn_rules').delete().eq('id', live.id)
    const after = await loadSellerRewards(DEMO)
    expect(after.rules.some(r => r.id === live.id), 'a seller deleted a live rule').toBe(true)
  })
})
