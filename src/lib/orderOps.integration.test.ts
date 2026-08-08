/* Touches the live Supabase project.
 *
 * The order book is the one table every persona writes to and nobody owned. It
 * is also where the two rules that bound this screen live: the operator may move
 * an order along but not rewrite what it cost or who bought it, and the final
 * step is refused while the network has not provisioned. Both are enforced in
 * the database and evaluated again in TypeScript so the button carries the
 * reason rather than the failure — which is two evaluations of one rule, and
 * they drift.
 *
 * The invariants below are the ones the register found broken when it was built:
 * twenty orders against one requisition, and two orders quoting their line
 * prices in a different convention from the other seventy-seven.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { signIn, signOut } from './authRepo'
import { loadOrderBook, removeOrder } from './orderOpsRepo'
import type { OrderBook } from './orderOpsRepo'
import {
  buyerKind, linesCharged, problemsFor, exceptionQueue, canAdvance, atEnd, rollup,
} from './orderOps'

const OPERATOR = { email: 'anika.sharma@aventa.com', password: 'operator123' }
const PARTNER = { email: 'rajesh.kumar@nimbussensors.com', password: 'partner123' }
const TODAY = new Date().toISOString().slice(0, 10)

describe('the order book the operator works from', () => {
  let book: OrderBook

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadOrderBook()
  })
  afterAll(async () => { await signOut() })

  it('loads every order, not one persona’s', () => {
    expect(book.loadError).toBeUndefined()
    expect(book.orders.length).toBeGreaterThan(20)
    const kinds = new Set(book.orders.map(buyerKind))
    expect(kinds.has('consumer'), 'no retail orders are visible').toBe(true)
    expect(kinds.has('enterprise'), 'no business orders are visible').toBe(true)
  })

  it('gives every figure back as a number', () => {
    for (const o of book.orders) {
      expect(typeof o.total, `${o.order_ref} total`).toBe('number')
      expect(typeof o.stage, `${o.order_ref} stage`).toBe('number')
    }
    for (const l of book.lines) {
      expect(typeof l.price, `${l.id} price`).toBe('number')
      expect(typeof l.quantity, `${l.id} quantity`).toBe('number')
    }
  })

  /* The finding the register was built on: one approval, twenty orders,
     ₹996,000, because the idempotency check asked the requisition rather than
     the orders table. */
  it('has one order per requisition and no more', () => {
    const seen = new Map<string, string[]>()
    for (const o of book.orders.filter(x => x.requisition_id)) {
      const held = seen.get(o.requisition_id!) ?? []
      held.push(o.order_ref)
      seen.set(o.requisition_id!, held)
    }
    const many = [...seen.entries()].filter(([, refs]) => refs.length > 1)
    expect(many.map(([r, refs]) => `${r}: ${refs.join(', ')}`)).toEqual([])
  })

  it('has no order at all against a requisition nobody approved', async () => {
    const { data } = await supabase.from('enterprise_requisitions').select('id,state,order_ref')
    const reqs = (data ?? []) as { id: string; state: string; order_ref: string | null }[]
    const undecided = new Set(reqs.filter(r => r.state !== 'approved').map(r => r.id))
    const wrong = book.orders.filter(o => o.requisition_id && undecided.has(o.requisition_id))
    expect(wrong.map(o => `${o.order_ref} on ${o.requisition_id}`)).toEqual([])
  })

  it('has every approved requisition pointing at an order that points back', async () => {
    const { data } = await supabase.from('enterprise_requisitions')
      .select('id,state,order_ref').eq('state', 'approved')
    const reqs = (data ?? []) as { id: string; order_ref: string | null }[]
    expect(reqs.length).toBeGreaterThan(0)
    for (const r of reqs) {
      expect(r.order_ref, `${r.id} is approved and points at nothing`).toBeTruthy()
      const o = book.orders.find(x => x.order_ref === r.order_ref)
      expect(o, `${r.id} points at ${r.order_ref}, which does not exist`).toBeTruthy()
      expect(o!.requisition_id, `${r.order_ref} does not point back at ${r.id}`).toBe(r.id)
    }
  })

  /* Line prices are quoted the way the buyer was quoted them — tax included —
     so they sum to what was charged before any order-level discount. Two orders
     used the other convention and nothing on the row said which, so any screen
     adding an order up had to guess. */
  it('quotes every line price in the same convention', () => {
    const bad: string[] = []
    for (const o of book.orders) {
      const mine = book.lines.filter(l => l.order_id === o.id)
      if (mine.length === 0) continue
      if (Math.abs(linesCharged(mine) - (o.total + o.discount)) > 0.02) {
        bad.push(`${o.order_ref}: lines ${linesCharged(mine)} against ${o.total + o.discount} charged`)
      }
    }
    expect(bad).toEqual([])
  })

  it('has lines behind every order', () => {
    const empty = book.orders.filter(o => !book.lines.some(l => l.order_id === o.id))
    expect(empty.map(o => o.order_ref)).toEqual([])
  })

  it('keeps every header equal to its own parts', () => {
    for (const o of book.orders) {
      const derived = Math.round((o.subtotal + o.tax - o.discount) * 100) / 100
      expect(Math.abs(o.total - derived), `${o.order_ref} total is asserted rather than derived`)
        .toBeLessThan(0.02)
    }
  })

  it('keeps every stage inside its own ladder', () => {
    for (const o of book.orders) {
      expect(o.stage, `${o.order_ref} stage ${o.stage} of ${o.stages.length}`).toBeGreaterThanOrEqual(0)
      expect(o.stage).toBeLessThan(o.stages.length)
    }
  })

  it('says why on every failure', () => {
    for (const o of book.orders.filter(x => x.failed)) {
      expect((o.failed_reason ?? '').trim(), `${o.order_ref} failed with nothing said about it`)
        .not.toBe('')
    }
  })

  /* The screen is only worth having if it finds something, and only trustworthy
     if what it finds is real. Both halves asserted. */
  it('finds real exceptions, each with a next move', () => {
    const q = exceptionQueue(book.orders, book.lines, book.pushes, TODAY)
    expect(q.length, 'the exception queue is empty, so the screen shows nothing').toBeGreaterThan(0)
    for (const e of q) {
      expect(e.problems.length).toBeGreaterThan(0)
      for (const p of e.problems) expect(p.next.trim(), `${e.order.order_ref}: ${p.what}`).not.toBe('')
    }
  })

  it('ranks anything untrue above anything merely slow', () => {
    const q = exceptionQueue(book.orders, book.lines, book.pushes, TODAY)
    const firstStalled = q.findIndex(e => e.worst !== 'wrong')
    if (firstStalled === -1) return
    expect(q.slice(firstStalled).every(e => e.worst !== 'wrong'),
      'a "wrong" order is sorted below a merely slow one').toBe(true)
  })

  it('never sums two currencies into one figure', () => {
    const r = rollup(book.orders, book.lines, book.pushes, TODAY)
    const currencies = new Set(r.value.map(g => g.currency))
    expect(currencies.size).toBe(r.value.length)
    expect(currencies.size, 'only one currency is open, so this proves nothing').toBeGreaterThan(1)
  })
})

describe('the same two rules, in the browser and in the database', () => {
  let book: OrderBook

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadOrderBook()
  })
  afterAll(async () => { await signOut() })

  /* `guard_operator_order_edit`. The operator has a write policy on orders —
     without this, "the marketplace does not rewrite what it cost" would be a
     sentence in a comment. */
  it('refuses to rewrite what an order cost', async () => {
    const o = book.orders[0]
    await supabase.from('orders').update({ total: 1, subtotal: 1, tax: 0 }).eq('id', o.id)
    const after = await loadOrderBook()
    const now = after.orders.find(x => x.id === o.id)!
    expect(now.total, `${o.order_ref} was repriced from a screen`).toBe(o.total)
  })

  it('refuses to rewrite who bought it', async () => {
    const o = book.orders.find(x => x.buyer_email)!
    await supabase.from('orders')
      .update({ buyer_email: 'somebody.else@example.com', buyer_name: 'Somebody Else' })
      .eq('id', o.id)
    const after = await loadOrderBook()
    expect(after.orders.find(x => x.id === o.id)!.buyer_email).toBe(o.buyer_email)
  })

  it('refuses to fail an order without saying why', async () => {
    const o = book.orders.find(x => !x.failed)!
    const { error } = await supabase.from('orders')
      .update({ failed: true, failed_reason: '' }).eq('id', o.id)
    expect(error, 'an order was failed with nothing said about it').toBeTruthy()

    const after = await loadOrderBook()
    expect(after.orders.find(x => x.id === o.id)!.failed).toBe(false)
  })

  /* `guard_order_completion`, which is the one this screen most needs to agree
     with: the button is disabled with the guard's own reasoning on it, and the
     database refuses the same write. */
  it('refuses the final step while the network has not provisioned, in both places', async () => {
    const stuck = book.orders.find(o => {
      const open = book.pushes.some(p => p.order_ref === o.order_ref
        && p.state !== 'completed' && p.state !== 'cancelled')
      return open && !atEnd(o)
    })
    if (!stuck) {
      /* Not a silent pass. If this case ever leaves the data the check has to
         say so rather than reporting green. */
      throw new Error('no order has an outstanding network push, so this rule is untested')
    }

    /* Ask the module first, then make the write the module refused. */
    const lastStep = stuck.stages.length - 1
    const verdict = canAdvance({ ...stuck, stage: lastStep - 1 }, book.pushes)
    expect(verdict.ok, 'the screen would offer the final step on an unprovisioned order').toBe(false)

    const { error } = await supabase.from('orders')
      .update({ stage: lastStep, status: 'delivered' }).eq('id', stuck.id)
    expect(error, `${stuck.order_ref} reached the end with its network fulfilment outstanding`)
      .toBeTruthy()

    const after = await loadOrderBook()
    expect(after.orders.find(x => x.id === stuck.id)!.stage).toBe(stuck.stage)
  })

  it('lets the marketplace move an order along, which is the thing it may do', async () => {
    const movable = book.orders.find(o => {
      if (o.failed || atEnd(o) || o.stage === 0) return false
      return canAdvance(o, book.pushes).ok
    })!
    expect(movable, 'nothing in the book can be moved, so this proves nothing').toBeTruthy()

    const { error } = await supabase.from('orders')
      .update({ stage: movable.stage + 1 }).eq('id', movable.id)
    expect(error).toBeNull()

    const after = await loadOrderBook()
    expect(after.orders.find(x => x.id === movable.id)!.stage).toBe(movable.stage + 1)

    /* Put it back — this file runs against the live project and twice. */
    await supabase.from('orders').update({ stage: movable.stage }).eq('id', movable.id)
    const restored = await loadOrderBook()
    expect(restored.orders.find(x => x.id === movable.id)!.stage).toBe(movable.stage)
  })

  it('refuses a second order against a requisition that already has one', async () => {
    const { data } = await supabase.from('enterprise_requisitions')
      .select('id,order_ref').eq('state', 'approved').not('order_ref', 'is', null).limit(1).maybeSingle()
    const req = data as { id: string; order_ref: string }

    /* The function's own answer: the existing reference, not a new order. */
    const before = (await loadOrderBook()).orders.length
    const { data: ref, error } = await supabase.rpc('place_requisition_order', { p_req_id: req.id })
    expect(error).toBeNull()
    expect(ref, 'a second order was minted instead of the existing one being returned')
      .toBe(req.order_ref)
    expect((await loadOrderBook()).orders.length).toBe(before)
  })

  /* The capability that closed the loop: the register's duplicate detection was
   * finding something the register could not fix, because `orders` had one
   * DELETE policy and it was the consumer's.
   *
   * The positive case — that a stray order really can be removed — is asserted
   * in `20260808220000`, which creates and removes one inside the migration.
   * It cannot be done from here: the operator has no INSERT policy on orders,
   * and that is correct. The marketplace does not place orders on people's
   * behalf; a checkout or an approved requisition does. So what this file proves
   * is the half that matters for safety — that the permission stops where it
   * should.
   */
  it('refuses to remove an order that went somewhere', async () => {
    const delivered = book.orders.find(o => o.status === 'delivered' || o.status === 'active')!
    expect(delivered, 'no fulfilled order to try this on').toBeTruthy()

    const r = await removeOrder(delivered)
    expect(r.ok, `${delivered.order_ref} was deleted despite being ${delivered.status}`).toBe(false)

    const after = await loadOrderBook()
    expect(after.orders.some(o => o.order_ref === delivered.order_ref)).toBe(true)
    /* And its lines are still there. `removeOrder` deletes those first, so a
       refusal that only stopped the order would leave the lines gone and the
       order pointing at nothing — worse than either outcome. */
    expect(after.lines.some(l => l.order_id === delivered.id),
      `${delivered.order_ref} kept its row and lost its lines`).toBe(true)
  })

  it('refuses to remove one a settlement line refers to', async () => {
    const { data } = await supabase.from('settlement_lines').select('order_ref')
    const settled = new Set(((data ?? []) as { order_ref: string }[]).map(x => x.order_ref))
    const target = book.orders.find(o => settled.has(o.order_ref) && o.status === 'placed')
    if (!target) return   /* covered by the status refusal above where they overlap */

    const r = await removeOrder(target)
    expect(r.ok, `${target.order_ref} was deleted despite being settled`).toBe(false)
    expect((await loadOrderBook()).orders.some(o => o.order_ref === target.order_ref)).toBe(true)
  })

  it('refuses to order against a requisition nobody has approved', async () => {
    const { data } = await supabase.from('enterprise_requisitions')
      .select('id,state').eq('state', 'pending').limit(1).maybeSingle()
    const req = data as { id: string } | null
    expect(req, 'nothing is pending, so this rule is untested').toBeTruthy()

    const { error } = await supabase.rpc('place_requisition_order', { p_req_id: req!.id })
    expect(error, 'an order was placed against an undecided requisition').toBeTruthy()
    expect(error!.message).toMatch(/nothing to order/)
  })
})

describe('what a seller can see of the order book', () => {
  beforeAll(async () => { await signIn(PARTNER.email, PARTNER.password) })
  afterAll(async () => { await signOut() })

  /* The register exists because no persona could see the whole book. That is
     still true of every persona except the operator, and it has to stay true. */
  it('does not get the whole book handed to it', async () => {
    const asSeller = await loadOrderBook()
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    const asOperator = await loadOrderBook()
    await signOut()
    await signIn(PARTNER.email, PARTNER.password)

    expect(asSeller.orders.length,
      'a seller reads as many orders as the marketplace does')
      .toBeLessThan(asOperator.orders.length)
  })

  it('cannot move somebody else’s order along', async () => {
    const mine = await loadOrderBook()
    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    const all = await loadOrderBook()
    const theirs = all.orders.find(o => !mine.orders.some(m => m.id === o.id))!
    await signOut()
    await signIn(PARTNER.email, PARTNER.password)

    await supabase.from('orders').update({ stage: theirs.stage + 1 }).eq('id', theirs.id)

    await signOut()
    await signIn(OPERATOR.email, OPERATOR.password)
    const after = await loadOrderBook()
    expect(after.orders.find(o => o.id === theirs.id)!.stage,
      'a seller moved an order that is not theirs').toBe(theirs.stage)
    await signOut()
    await signIn(PARTNER.email, PARTNER.password)
  })
})

describe('what the screen says about one real order', () => {
  let book: OrderBook

  beforeAll(async () => {
    await signIn(OPERATOR.email, OPERATOR.password)
    book = await loadOrderBook()
  })
  afterAll(async () => { await signOut() })

  it('describes the sent-and-silent case in the order manager’s own words', () => {
    const rejected = book.pushes.find(p => p.state === 'rejected')
    if (!rejected) throw new Error('nothing was rejected by the order manager, so this is untested')
    const o = book.orders.find(x => x.order_ref === rejected.order_ref)!
    const problems = problemsFor(o, book.lines, book.pushes, TODAY)
    const said = problems.find(p => p.what.includes('refused'))
    expect(said, `${o.order_ref} has a rejected push and the screen says nothing`).toBeTruthy()
    if (rejected.failure_reason) expect(said!.what).toContain(rejected.failure_reason.slice(0, 20))
  })
})
