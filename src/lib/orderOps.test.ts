import { describe, it, expect } from 'vitest'
import {
  buyerKind, BUYER_LABEL, contactLine, showing, atEnd, nextStage,
  ageInDays, isStuck, PATIENCE, problemsFor, exceptionQueue, linesCharged,
  bookValue, isFrozen, FROZEN, canAdvance, canFail, searchOrders, rollup,
  SEVERITY_LABEL,
} from './orderOps'
import type { OrderRow, LineRow, PushRow, Severity } from './orderOps'

const TODAY = '2026-08-08'

const order = (over: Partial<OrderRow> = {}): OrderRow => ({
  id: 'o1',
  order_ref: 'ORD-882090',
  status: 'placed',
  total: 1180,
  subtotal: 1000,
  tax: 180,
  discount: 0,
  tax_rate: 18,
  currency: 'INR',
  market: 'IN',
  buyer_name: 'Priya Raman',
  buyer_email: 'priya.raman@example.in',
  seller: 'Nimbus Sensors',
  vertical: 'iot',
  payment_method: 'UPI',
  payment_ref: 'PAY-1',
  tracking_ref: null,
  carrier: null,
  placed_date: '06 Aug 2026',
  created_at: '2026-08-06T09:00:00Z',
  failed: false,
  failed_reason: null,
  stage: 1,
  stages: ['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered'],
  user_id: 'u1',
  account_id: null,
  requisition_id: null,
  invoice_id: null,
  ordered_by: null,
  cost_centre: null,
  po_ref: null,
  ...over,
})

const lineOf = (over: Partial<LineRow> = {}): LineRow => ({
  id: 'l1',
  order_id: 'o1',
  product_id: 'SKU-5003',
  product_name: 'Nimbus Cold-chain sensor',
  price: 1180,
  quantity: 1,
  fulfil: 'shipped',
  status: 'placed',
  ...over,
})

const push = (over: Partial<PushRow> = {}): PushRow => ({
  id: 'c1',
  order_ref: 'ORD-882090',
  product_name: 'IoT Connect 2 GB',
  state: 'sent',
  failure_reason: null,
  ...over,
})

describe('who bought it', () => {
  it('files an account purchase as business however placed it', () => {
    /* An enterprise order carries both ids. Reading user_id first would file
       every business purchase as retail, which is the commission model, the tax
       treatment and the support queue all wrong at once. */
    expect(buyerKind({ account_id: 'ENT-2007', user_id: 'u9' })).toBe('enterprise')
  })

  it('files a signed-in shopper as retail', () => {
    expect(buyerKind({ account_id: null, user_id: 'u1' })).toBe('consumer')
  })

  it('files a checkout with neither as a guest', () => {
    expect(buyerKind({ account_id: null, user_id: null })).toBe('guest')
  })

  it('has a label for each', () => {
    for (const k of ['consumer', 'enterprise', 'guest'] as const) {
      expect(BUYER_LABEL[k]).toBeTruthy()
    }
  })

  it('names the person who raised a business order, not just the company', () => {
    const l = contactLine(order({ account_id: 'ENT-2007', buyer_name: 'Meridian Foods', ordered_by: 'EU-2007-03' }))
    expect(l).toContain('Meridian Foods')
    expect(l).toContain('EU-2007-03')
  })

  it('says a guest has no account to sign into, which is the support problem', () => {
    expect(contactLine(order({ user_id: null, account_id: null })))
      .toMatch(/no account to sign into/)
  })
})

describe('where the order is', () => {
  it('shows the stage the customer is being shown', () => {
    expect(showing(order({ stage: 1 }))).toBe('Confirmed')
  })

  it('knows when it is at the end of its own ladder', () => {
    expect(atEnd(order({ stage: 4 }))).toBe(true)
    expect(atEnd(order({ stage: 3 }))).toBe(false)
  })

  it('offers no next stage at the end', () => {
    expect(nextStage(order({ stage: 4 }))).toBeNull()
    expect(nextStage(order({ stage: 3 }))).toBe('Delivered')
  })

  /* Ladders differ: a provisioned service ends "Active", a parcel ends
     "Delivered", and hardcoding either would mislabel the other. */
  it('reads the end off the order’s own ladder, not a constant', () => {
    const service = order({ stage: 4, stages: ['Ordered', 'Confirmed', 'Provisioning', 'Activating', 'Active'] })
    expect(showing(service)).toBe('Active')
    expect(atEnd(service)).toBe(true)
  })
})

describe('how long it has been sitting', () => {
  it('counts whole days since it was placed', () => {
    expect(ageInDays(order({ created_at: '2026-08-06T09:00:00Z' }), TODAY)).toBe(1)
  })

  it('has no age when nothing recorded when it was placed', () => {
    expect(ageInDays(order({ created_at: null }), TODAY)).toBeNull()
  })

  it('leaves a state with no patience alone', () => {
    /* Delivered is not slow, it is finished. */
    expect(isStuck(order({ status: 'delivered', created_at: '2020-01-01T00:00:00Z' }), TODAY).stuck)
      .toBe(false)
  })

  it('is not stuck inside its allowance', () => {
    expect(isStuck(order({ status: 'placed', created_at: '2026-08-07T00:00:00Z' }), TODAY).stuck).toBe(false)
  })

  it('is stuck past it, and says by how much against what', () => {
    const s = isStuck(order({ status: 'placed', created_at: '2026-07-30T00:00:00Z' }), TODAY)
    expect(s.stuck).toBe(true)
    expect(s.stuck && s.days).toBe(9)
    expect(s.stuck && s.allowed).toBe(PATIENCE.placed)
  })

  it('is not stuck when nothing says when it started', () => {
    /* An unknown age is not a long one, and treating it as one would fill the
       queue with orders whose only fault is a missing timestamp — which is its
       own, quieter problem. */
    expect(isStuck(order({ status: 'placed', created_at: null }), TODAY).stuck).toBe(false)
  })

  it('gives a half-failed order the shortest fuse of any state', () => {
    expect(PATIENCE['partly-failed']).toBeLessThan(PATIENCE.placed)
  })
})

describe('what is wrong with one order', () => {
  it('finds nothing wrong with an ordinary one', () => {
    expect(problemsFor(order(), [lineOf()], [], TODAY)).toEqual([])
  })

  /* The worst thing this screen can find: the customer has been told their
     service is live and it is not. */
  it('catches a delivered order whose network fulfilment is still running', () => {
    const p = problemsFor(order({ status: 'delivered', stage: 4 }), [lineOf()],
                          [push({ state: 'in-progress' })], TODAY)
    expect(p[0].severity).toBe('wrong')
    expect(p[0].what).toMatch(/has not been provisioned/)
    expect(p[0].next).toMatch(/cannot\s+honestly reach the end/)
  })

  it('catches a status and a tracker that disagree', () => {
    const p = problemsFor(order({ status: 'delivered', stage: 0 }), [lineOf()], [], TODAY)
    const x = p.find(y => y.what.includes('Ordered'))!
    expect(x.severity).toBe('wrong')
    expect(x.next).toMatch(/Move it to the end/)
  })

  /* The screen must not tell somebody to do the thing its own button refuses.
     With a push outstanding the only available move is putting the status back,
     so that is the only one offered. */
  it('stops offering "move it to the end" when the network has not finished', () => {
    const p = problemsFor(order({ status: 'delivered', stage: 0 }), [lineOf()],
                          [push({ state: 'in-progress' })], TODAY)
    const x = p.find(y => y.what.includes('Ordered'))!
    expect(x.next).not.toMatch(/Move it to the end/)
    expect(x.next).toMatch(/Put the status back/)
  })

  it('catches a failure with nothing said about it', () => {
    const p = problemsFor(order({ failed: true, failed_reason: '  ' }), [lineOf()], [], TODAY)
    expect(p.some(x => x.what.includes('no reason'))).toBe(true)
  })

  it('says nothing about a failure that was explained', () => {
    const p = problemsFor(order({ failed: true, failed_reason: 'Card issuer declined twice.' }),
                          [lineOf()], [], TODAY)
    expect(p.some(x => x.what.includes('no reason'))).toBe(false)
  })

  it('catches an order with no lines behind it', () => {
    const p = problemsFor(order(), [], [], TODAY)
    expect(p[0].severity).toBe('wrong')
    expect(p[0].what).toMatch(/no lines/)
  })

  /* Lines are quoted tax-inclusive, so they sum to what was charged before any
     order-level discount — not to the subtotal, and not to the total on a
     discounted order. */
  it('accepts lines that sum to what was charged before discount', () => {
    const o = order({ total: 1080, discount: 100, subtotal: 915.25, tax: 164.75 })
    expect(problemsFor(o, [lineOf({ price: 1180 })], [], TODAY)).toEqual([])
  })

  it('catches lines that do not sum to what was charged, and quotes both', () => {
    const p = problemsFor(order(), [lineOf({ price: 900 })], [], TODAY)
    const gap = p.find(x => x.what.includes('come to'))
    expect(gap).toBeTruthy()
    expect(gap!.what).toContain('900.00')
    expect(gap!.what).toContain('1180.00')
    expect(gap!.next).toMatch(/customer has already paid/)
  })

  it('carries the order manager’s own words on a rejection', () => {
    const p = problemsFor(order(), [lineOf()],
      [push({ state: 'rejected', failure_reason: 'No usable msisdn block reserved for iot in AE.' })], TODAY)
    const r = p.find(x => x.what.includes('refused'))
    expect(r!.what).toContain('No usable msisdn block')
    expect(r!.severity).toBe('stalled')
  })

  it('names who to chase on a stalled order', () => {
    const p = problemsFor(order({ created_at: '2026-07-25T00:00:00Z' }), [lineOf()], [], TODAY)
    expect(p.some(x => x.next === 'Chase Nimbus Sensors.')).toBe(true)
  })

  it('asks who is fulfilling it when nothing says', () => {
    const p = problemsFor(order({ created_at: '2026-07-25T00:00:00Z', seller: null }), [lineOf()], [], TODAY)
    expect(p.some(x => x.next.includes('who is meant to be fulfilling'))).toBe(true)
  })

  it('flags an order in transit with nothing to track', () => {
    const p = problemsFor(order({ status: 'in-transit', tracking_ref: null, created_at: '2026-08-07T00:00:00Z' }),
                          [lineOf()], [], TODAY)
    expect(p.some(x => x.severity === 'untidy' && x.what.includes('tracking'))).toBe(true)
  })

  it('flags an order nothing dated', () => {
    const p = problemsFor(order({ created_at: null, placed_date: null }), [lineOf()], [], TODAY)
    expect(p.some(x => x.what.includes('when it was placed'))).toBe(true)
  })

  it('puts the untrue thing above the slow thing', () => {
    const p = problemsFor(
      order({ status: 'delivered', stage: 0, created_at: '2026-07-01T00:00:00Z', tracking_ref: null }),
      [lineOf()], [], TODAY)
    expect(p[0].severity).toBe('wrong')
  })

  it('has a next move on every problem it reports', () => {
    const p = problemsFor(
      order({ status: 'delivered', stage: 0, failed: true, failed_reason: '', created_at: null }),
      [], [push({ state: 'rejected' })], TODAY)
    expect(p.length).toBeGreaterThan(3)
    for (const x of p) expect(x.next.trim(), x.what).not.toBe('')
  })

  it('ignores a completed push — that one is finished', () => {
    expect(problemsFor(order({ status: 'delivered', stage: 4 }), [lineOf()],
                       [push({ state: 'completed' })], TODAY)).toEqual([])
  })

  it('ignores lines belonging to another order', () => {
    const p = problemsFor(order(), [lineOf({ order_id: 'somebody-else' })], [], TODAY)
    expect(p[0].what).toMatch(/no lines/)
  })
})

describe('the queue', () => {
  const clean = order({ id: 'clean', order_ref: 'A' })
  const untidy = order({ id: 'untidy', order_ref: 'B', status: 'in-transit', tracking_ref: null,
                         created_at: '2026-08-08T00:00:00Z' })
  const stalled = order({ id: 'stalled', order_ref: 'C', created_at: '2026-07-20T00:00:00Z' })
  const bad = order({ id: 'bad', order_ref: 'D', status: 'delivered', stage: 0 })
  const lines = [
    lineOf({ order_id: 'clean' }), lineOf({ order_id: 'untidy' }),
    lineOf({ order_id: 'stalled' }), lineOf({ order_id: 'bad' }),
  ]
  const q = exceptionQueue([clean, untidy, stalled, bad], lines, [], TODAY)

  it('leaves out the orders with nothing wrong', () => {
    expect(q.some(e => e.order.id === 'clean')).toBe(false)
  })

  it('ranks the untrue above the stalled above the untidy', () => {
    expect(q.map(e => e.order.id)).toEqual(['bad', 'stalled', 'untidy'])
  })

  it('reports the worst thing wrong, not the count', () => {
    expect(q[0].worst).toBe('wrong')
  })

  it('breaks a tie on which has been wrong longest', () => {
    const old = order({ id: 'old', order_ref: 'E', status: 'delivered', stage: 0, created_at: '2026-01-01T00:00:00Z' })
    const recent = order({ id: 'recent', order_ref: 'F', status: 'delivered', stage: 0, created_at: '2026-08-07T00:00:00Z' })
    const two = exceptionQueue([recent, old],
      [lineOf({ order_id: 'old' }), lineOf({ order_id: 'recent' })], [], TODAY)
    expect(two[0].order.id).toBe('old')
  })

  it('has a label for every severity it can report', () => {
    for (const s of ['wrong', 'stalled', 'untidy'] as Severity[]) {
      expect(SEVERITY_LABEL[s]).toBeTruthy()
    }
  })
})

describe('the money on the screen', () => {
  it('sums the lines as charged', () => {
    expect(linesCharged([lineOf({ price: 830, quantity: 60 })])).toBe(49800)
  })

  it('rounds to the cent rather than carrying float noise', () => {
    expect(linesCharged([lineOf({ price: 0.1, quantity: 3 })])).toBe(0.3)
  })

  /* Four currencies trade here. One total across them is the single most
     misleading number an operator screen can carry. */
  it('never adds two currencies together', () => {
    const v = bookValue([
      order({ currency: 'INR', total: 1000 }),
      order({ currency: 'KES', total: 500 }),
      order({ currency: 'INR', total: 200 }),
    ])
    expect(v.find(m => m.currency === 'INR')!.total.amount).toBe(1200)
    expect(v.find(m => m.currency === 'KES')!.total.amount).toBe(500)
    expect(v.length).toBe(2)
  })
})

describe('what the marketplace may change', () => {
  it('freezes everything that was agreed at checkout', () => {
    for (const f of ['total', 'currency', 'buyer_email', 'payment_ref', 'account_id']) {
      expect(isFrozen(f), f).toBe(true)
    }
  })

  it('leaves the things moving an order along alone', () => {
    for (const f of ['status', 'stage', 'tracking_ref', 'carrier', 'failed_reason']) {
      expect(isFrozen(f), f).toBe(false)
    }
  })

  it('freezes the money and the buyer, which is the whole rule', () => {
    expect(FROZEN).toContain('total')
    expect(FROZEN).toContain('user_id')
  })
})

describe('moving it on a step', () => {
  it('advances an ordinary order and says where to', () => {
    const r = canAdvance(order({ stage: 1 }), [])
    expect(r.ok).toBe(true)
    expect(r.ok && r.to).toBe('Dispatched')
  })

  it('refuses at the end of the ladder', () => {
    const r = canAdvance(order({ stage: 4 }), [])
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/end of its ladder/)
  })

  it('refuses to move a failed order without reversing the failure', () => {
    const r = canAdvance(order({ failed: true, failed_reason: 'Card declined' }), [])
    expect(r.ok).toBe(false)
  })

  /* The step that tells the customer their service is live. The database refuses
     it too — this exists so the button carries the reason. */
  it('refuses the last step while a push is outstanding, in the push’s own words', () => {
    const r = canAdvance(order({ stage: 3 }), [push({ state: 'sent', product_name: 'IoT Connect 2 GB' })])
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toContain('IoT Connect 2 GB')
    expect(!r.ok && r.reason).toMatch(/their service is live while it is not/)
  })

  it('allows the steps before the last one while a push is outstanding', () => {
    /* Packed and in transit are true whatever the network is doing. Blocking
       them would stop the operator recording things that actually happened. */
    expect(canAdvance(order({ stage: 1 }), [push({ state: 'sent' })]).ok).toBe(true)
  })

  it('allows the last step once the push completes', () => {
    expect(canAdvance(order({ stage: 3 }), [push({ state: 'completed' })]).ok).toBe(true)
  })

  it('ignores a push against a different order', () => {
    expect(canAdvance(order({ stage: 3 }), [push({ order_ref: 'ORD-OTHER' })]).ok).toBe(true)
  })
})

describe('failing an order', () => {
  it('refuses without an explanation', () => {
    const r = canFail('   ')
    expect(r.ok).toBe(false)
    expect(!r.ok && r.reason).toMatch(/dead order/)
  })

  it('accepts one with an explanation', () => {
    expect(canFail('Seller cannot source the part before the promised date.').ok).toBe(true)
  })
})

describe('finding an order', () => {
  const orders = [
    order({ id: 'a', order_ref: 'ORD-882090', buyer_email: 'priya@example.in', seller: 'Nimbus Sensors' }),
    order({ id: 'b', order_ref: 'ORD-771903', buyer_name: 'Meridian Foods', account_id: 'ENT-2007', seller: 'Sentinel Cyber' }),
    order({ id: 'c', order_ref: 'ORD-990311', buyer_email: 'wanjiru@example.ke', seller: 'Volta Devices' }),
  ]
  const lines = [
    lineOf({ order_id: 'a', product_name: 'Nimbus Cold-chain sensor' }),
    lineOf({ order_id: 'b', product_name: 'Sentinel MDR — 24/7' }),
    lineOf({ order_id: 'c', product_name: 'Travel eSIM — 10 GB' }),
  ]

  it('returns everything for an empty box', () => {
    expect(searchOrders(orders, lines, '   ').length).toBe(3)
  })

  it('finds by reference', () => {
    expect(searchOrders(orders, lines, 'ORD-771903').map(o => o.id)).toEqual(['b'])
  })

  it('finds by part of an email, which is how a caller gives it', () => {
    expect(searchOrders(orders, lines, 'wanjiru').map(o => o.id)).toEqual(['c'])
  })

  /* "The Sentinel order" is a real thing somebody says, and the product name is
     on the line rather than the order. */
  it('finds by what was bought', () => {
    expect(searchOrders(orders, lines, 'travel esim').map(o => o.id)).toEqual(['c'])
  })

  it('finds by the account it was bought on', () => {
    expect(searchOrders(orders, lines, 'ENT-2007').map(o => o.id)).toEqual(['b'])
  })

  it('does not care about case', () => {
    expect(searchOrders(orders, lines, 'nimbus sensors').map(o => o.id)).toEqual(['a'])
  })

  it('finds nothing for something nobody has', () => {
    expect(searchOrders(orders, lines, 'zzzz')).toEqual([])
  })

  it('does not reorder the caller’s array', () => {
    const src = [...orders]
    searchOrders(src, lines, '')
    expect(src[0].id).toBe('a')
  })
})

describe('the rollup at the top', () => {
  const orders = [
    order({ id: 'a', status: 'placed', currency: 'INR', total: 1000, created_at: '2026-08-08T00:00:00Z' }),
    order({ id: 'b', status: 'delivered', stage: 4, currency: 'INR', total: 500 }),
    order({ id: 'c', status: 'failed', failed: true, failed_reason: 'Declined', currency: 'KES', total: 300 }),
    order({ id: 'd', status: 'delivered', stage: 0, currency: 'INR', total: 200 }),
  ]
  const lines = orders.map(o => lineOf({ order_id: o.id, price: o.total }))
  const r = rollup(orders, lines, [], TODAY)

  it('counts everything', () => {
    expect(r.total).toBe(4)
  })

  it('counts what is still moving, which excludes finished and failed', () => {
    expect(r.open).toBe(1)
  })

  it('counts the failures', () => {
    expect(r.failed).toBe(1)
  })

  it('counts the exceptions and, separately, the ones saying something untrue', () => {
    expect(r.exceptions).toBe(1)
    expect(r.wrong).toBe(1)
  })

  /* The value is the open book — settled orders belong to the ledger, and a
     figure mixing the two answers no question anybody has. */
  it('values the open book only, in its own currencies', () => {
    expect(r.value).toEqual([{ currency: 'INR', total: { amount: 1000, currency: 'INR' }, count: 1 }])
  })
})
