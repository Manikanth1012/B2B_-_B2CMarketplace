/* Touches the live Supabase project.
 *
 * A refund is the one record on this platform that three different parties act
 * on: the customer who raised it, the seller whose revenue is going back, and
 * the marketplace that has to notice when nobody answers. So most of these
 * checks are about the seams — that each party sees what they should, that the
 * clock says the same thing to all three, and that a seller cannot quietly
 * rewrite what was asked for.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadAllRefunds, loadSellerRefunds, loadMyRefunds } from './refundRepo'
import { STATES, sla, ownership, summarise, slowSellers, escalationDue } from './refunds'
import type { Refund, RefundPolicy } from './refunds'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER  = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const CONSUMER = { email: 'priya.raman@example.com', password: 'demo1234' }
const DEMO = 'PTR-1004'

describe('the whole refund book, read by the marketplace', () => {
  let refunds: Refund[] = []
  let policy: RefundPolicy

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    const book = await loadAllRefunds()
    expect(book.loadError).toBeUndefined()
    refunds = book.refunds
    policy = book.policy!
    expect(refunds.length).toBeGreaterThan(0)
    expect(policy).toBeTruthy()
  })

  afterAll(async () => { await signOut() })

  it('names a real product, called what the catalogue calls it', async () => {
    const { data } = await supabase.from('products').select('id,name,seller,partner_id,category_id')
    const catalogue = (data ?? []) as { id: string; name: string; seller: string; partner_id: string | null; category_id: string }[]
    for (const r of refunds) {
      const p = catalogue.find(x => x.id === r.product_id)
      expect(p, `${r.id} points at ${r.product_id}, which is not in the catalogue`).toBeTruthy()
      expect(r.item.startsWith(p!.name), `${r.id} calls it "${r.item}"; the catalogue says "${p!.name}"`).toBe(true)
      /* A refund charged to the wrong seller is money taken from the wrong
         company, and nothing else in the system would notice. */
      expect(r.partner_id, `${r.id} is charged to a different seller from the one that sold it`).toBe(p!.partner_id)
      expect(r.seller).toBe(p!.seller)
    }
  })

  it('publishes one response deadline and applies it to every row', () => {
    for (const r of refunds) {
      const due = new Date(r.requested + 'T00:00:00Z')
      due.setUTCHours(due.getUTCHours() + policy.seller_sla_hours)
      expect(r.sla_due, `${r.id} has a deadline that is not the published SLA`).toBe(due.toISOString().slice(0, 10))
    }
  })

  it('never leaves a decision without who made it and why', () => {
    for (const r of refunds) {
      if (STATES[r.state].final || r.state === 'approved') {
        expect(r.decided_by, `${r.id} is ${r.state} with nobody against it`).toBeTruthy()
        expect(r.decision_note, `${r.id} is ${r.state} with no reason on it`).toBeTruthy()
      }
    }
  })

  it('returns the whole amount on a full refund and less than it on a part one', () => {
    for (const r of refunds) {
      if (r.state === 'refunded') expect(Number(r.refunded)).toBe(Number(r.amount))
      if (r.state === 'partial') {
        expect(Number(r.refunded)).toBeGreaterThan(0)
        expect(Number(r.refunded)).toBeLessThan(Number(r.amount))
      }
      if (r.state === 'requested' || r.state === 'escalated') expect(r.refunded).toBeNull()
    }
  })

  it('hands every escalated one to the marketplace, with the reason it was taken', () => {
    for (const r of refunds.filter(x => x.state === 'escalated')) {
      expect(ownership(r).owner).toBe('marketplace')
      expect(r.escalated_why, `${r.id} was escalated with no reason recorded`).toBeTruthy()
    }
  })

  it('leaves nobody first-party with a seller to charge it to', () => {
    for (const r of refunds.filter(x => x.first_party)) {
      expect(r.partner_id, `${r.id} is first-party but names a seller`).toBeNull()
      expect(ownership(r).owner).toBe('marketplace')
    }
  })

  it('has something late, and knows which sellers are letting it happen', () => {
    /* If this ever goes quiet the operator's queue is being demonstrated
       against nothing. */
    const stats = summarise(refunds, new Date())
    expect(stats.overdue).toBeGreaterThan(0)
    expect(slowSellers(refunds, new Date()).length).toBeGreaterThan(0)
  })

  it('is late on one of its own, not only on other people’s', () => {
    const now = new Date()
    const mine = refunds.filter(r => r.first_party && r.state === 'requested')
    expect(mine.some(r => sla(r, policy, now).level === 'overdue')).toBe(true)
  })
})

describe('a seller reading refunds against their own products', () => {
  beforeAll(async () => { await signIn(PARTNER.email, PARTNER.password) })
  afterAll(async () => { await signOut() })

  it('sees their own, decided and undecided', async () => {
    const book = await loadSellerRefunds(DEMO)
    expect(book.loadError).toBeUndefined()
    expect(book.refunds.length).toBeGreaterThan(3)
    expect(book.refunds.every(r => r.partner_id === DEMO)).toBe(true)
    expect(book.refunds.some(r => STATES[r.state].final)).toBe(true)
  })

  it('sees no other seller’s', async () => {
    const other = await loadSellerRefunds('PTR-1002')
    expect(other.refunds).toEqual([])
  })

  it('can read the rules it is being held to', async () => {
    const book = await loadSellerRefunds(DEMO)
    expect(book.policy?.seller_sla_hours).toBe(48)
    expect(book.windows.length).toBeGreaterThan(0)
  })

  it('has one it has already lost to the clock, and one it is about to', async () => {
    const book = await loadSellerRefunds(DEMO)
    const now = new Date()
    expect(book.refunds.some(r => r.state === 'escalated')).toBe(true)
    expect(book.refunds.some(r => escalationDue(r, book.policy!, now))).toBe(true)
  })

  /* The guard trigger. Row-level security cannot say "these columns but not
     those", so without it a seller could reduce the amount asked for, hand the
     decision back to themselves after the clock took it, or un-escalate.
     This writes for real and asserts nothing moved. */
  it('cannot rewrite what the customer asked for', async () => {
    const before = (await loadSellerRefunds(DEMO)).refunds.find(r => r.state === 'requested')!
    await supabase.from('refunds').update({
      amount: 1, reason: 'duplicate', customer: 'Somebody else', sla_due: '2027-01-01',
    }).eq('id', before.id)
    const after = (await loadSellerRefunds(DEMO)).refunds.find(r => r.id === before.id)!
    expect(Number(after.amount), 'a seller reduced the amount claimed').toBe(Number(before.amount))
    expect(after.reason).toBe(before.reason)
    expect(after.customer).toBe(before.customer)
    expect(after.sla_due, 'a seller moved their own deadline').toBe(before.sla_due)
  })

  it('cannot take back one the clock has already moved', async () => {
    const esc = (await loadSellerRefunds(DEMO)).refunds.find(r => r.state === 'escalated')!
    await supabase.from('refunds').update({
      state: 'declined', decider: 'seller', escalated_on: null, escalated_why: null,
      decided_on: '2026-07-31', decided_by: 'me', decision_note: 'mine again',
    }).eq('id', esc.id)
    const after = (await loadSellerRefunds(DEMO)).refunds.find(r => r.id === esc.id)!
    expect(after.state, 'a seller decided one the marketplace had taken').toBe('escalated')
    expect(after.escalated_why).toBe(esc.escalated_why)
  })
})

describe('a customer reading their own', () => {
  beforeAll(async () => { await signIn(CONSUMER.email, CONSUMER.password) })
  afterAll(async () => { await signOut() })

  it('sees only their own requests', async () => {
    const book = await loadMyRefunds()
    expect(book.refunds.length).toBeGreaterThan(0)
    expect(book.refunds.every(r => r.customer === 'Priya Raman')).toBe(true)
  })

  it('is told who is deciding and by when on anything still open', async () => {
    const book = await loadMyRefunds()
    const open = book.refunds.filter(r => !STATES[r.state].final)
    for (const r of open) {
      expect(ownership(r).because.length).toBeGreaterThan(10)
      expect(sla(r, book.policy!, new Date()).text.length).toBeGreaterThan(5)
    }
  })

  it('can read the policy without being able to change it', async () => {
    const book = await loadMyRefunds()
    expect(book.policy?.escalate_after_hours).toBe(72)
    const { error } = await supabase.from('refund_policy')
      .update({ seller_sla_hours: 1 }).eq('id', 'current')
    const after = await loadMyRefunds()
    /* Either the write is refused outright or it silently matches nothing —
       both are fine; what must not happen is the SLA moving. */
    expect(after.policy?.seller_sla_hours, `a customer rewrote the SLA (${error?.message ?? 'no error'})`).toBe(48)
  })
})
