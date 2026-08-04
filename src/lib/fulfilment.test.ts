/* The rules the seller's Orders screen runs on, which used to be a number moved
   in React state and lost on reload. */
import { describe, it, expect } from 'vitest'
import {
  isOpen, isDone, nextStep, needsTracking, progress, canAdvance,
  dispatchExport, parseDispatch, dispatchSummary, DISPATCH_HEADER,
} from './fulfilment'
import type { SellerOrder, SellerLine } from './fulfilment'

const SHIP = ['Ordered', 'Approved', 'Packed', 'In transit', 'Delivered']

const order = (over: Partial<SellerOrder> = {}): SellerOrder => ({
  id: 'o1', order_ref: 'ORD-883101', status: 'processing', buyer_name: 'SmartBuild Ltd',
  placed_date: '02 Aug 2026', created_at: '2026-08-02T00:00:00Z', seller: 'Nimbus Sensors',
  vertical: 'iot', stage: 1, stages: SHIP, failed: false, failed_reason: null,
  tracking_ref: null, carrier: null, total: 20997, currency: 'INR',
  account_id: 'ENT-2007', cost_centre: 'CC-2200', ordered_by: 'EU-2007-01', ...over,
})

const line = (over: Partial<SellerLine> = {}): SellerLine => ({
  order_id: 'o1', product_id: 'SKU-5003', product_name: 'Nimbus Cold-chain sensor',
  price: 7499, quantity: 2, fulfil: 'shipped', ...over,
})

const MINE = new Set(['SKU-5003', 'SKU-5004', 'SKU-5009'])

describe('where an order has got to', () => {
  it('is open until the last stage', () => {
    expect(isOpen(order({ stage: 1 }))).toBe(true)
    expect(isOpen(order({ stage: 4 }))).toBe(false)
    expect(isDone(order({ stage: 4 }))).toBe(true)
  })

  it('is neither open nor done when it failed', () => {
    /* A failed order is not work in progress and not finished — counting it as
       either is how it disappears off a queue nobody then works. */
    const bad = order({ failed: true, failed_reason: 'Packed without the certificate' })
    expect(isOpen(bad)).toBe(false)
    expect(isDone(bad)).toBe(false)
  })

  it('names the next step in the order own stage words', () => {
    expect(nextStep(order({ stage: 1 }))).toBe('Packed')
    expect(nextStep(order({ stage: 4 }))).toBeNull()
    expect(nextStep(order({ failed: true }))).toMatch(/Resolve/)
  })

  it('measures progress against its own stage list', () => {
    expect(progress(order({ stage: 0 }))).toBe(0)
    expect(progress(order({ stage: 2 }))).toBe(50)
    expect(progress(order({ stage: 4 }))).toBe(100)
  })

  it('asks for a tracking number only where something moves', () => {
    /* A licence that provisions instantly has no carrier and never will. */
    expect(needsTracking(order(), [line()])).toBe(true)
    expect(needsTracking(order(), [line({ fulfil: 'provisioned' })])).toBe(false)
    expect(needsTracking(order({ tracking_ref: 'TRK-1' }), [line()])).toBe(false)
    expect(needsTracking(order({ stage: 4 }), [line()])).toBe(false)
  })
})

describe('whether this seller may move it on', () => {
  it('allows an order that is all theirs', () => {
    const r = canAdvance(order(), [line()], MINE)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toMatch(/packed/)
  })

  it('refuses an order carrying another seller lines, and says why', () => {
    /* Marking the whole order delivered would tell the buyer the other
       seller's goods had arrived too. */
    const r = canAdvance(order(), [line(), line({ product_id: 'SKU-5007' })], MINE)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/another seller/)
  })

  it('refuses one they supply nothing on', () => {
    expect(canAdvance(order(), [line({ product_id: 'SKU-9999' })], MINE).ok).toBe(false)
  })

  it('refuses a failed order until it is resolved', () => {
    expect(canAdvance(order({ failed: true }), [line()], MINE).ok).toBe(false)
  })

  it('refuses to go past the last stage', () => {
    const r = canAdvance(order({ stage: 4 }), [line()], MINE)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('Delivered')
  })
})

describe('exporting what is waiting to be dispatched', () => {
  const orders = [
    order({ id: 'a', order_ref: 'ORD-1', stage: 1 }),
    order({ id: 'b', order_ref: 'ORD-2', stage: 4 }),
    order({ id: 'c', order_ref: 'ORD-3', stage: 1, failed: true }),
    order({ id: 'd', order_ref: 'ORD-4', stage: 1 }),
  ]
  const lines = [
    line({ order_id: 'a' }), line({ order_id: 'b' }), line({ order_id: 'c' }),
    line({ order_id: 'd', fulfil: 'provisioned' }),
  ]

  it('covers only what is open and actually ships', () => {
    const rows = dispatchExport(orders, lines)
    expect(rows.slice(1).map(r => r[0])).toEqual(['ORD-1'])
  })

  it('writes the carrier and tracking columns blank rather than omitting them', () => {
    /* The file that comes back is the file that went out — a warehouse will not
       reliably invent a column. */
    const rows = dispatchExport(orders, lines)
    expect(rows[0].slice(0, 3)).toEqual([...DISPATCH_HEADER])
    expect(rows[1][1]).toBe('')
    expect(rows[1][2]).toBe('')
  })

  it('says what is in the box, so a picker can check it', () => {
    expect(dispatchExport(orders, lines)[1][5]).toContain('2× Nimbus Cold-chain sensor')
  })
})

describe('reading a dispatch file back', () => {
  const known = [
    order({ id: 'a', order_ref: 'ORD-1', stage: 1 }),
    order({ id: 'b', order_ref: 'ORD-2', stage: 4 }),
  ]

  it('takes the plain case', () => {
    const r = parseDispatch('order_ref,carrier,tracking_ref\nORD-1,BlueDart,TRK-9', known)
    expect(r.problems).toEqual([])
    expect(r.rows).toEqual([{ order_ref: 'ORD-1', carrier: 'BlueDart', tracking_ref: 'TRK-9' }])
  })

  it('survives what a warehouse actually sends back', () => {
    /* A BOM, semicolons, quoted cells, reordered and extra columns. None of
       that is a reason to refuse somebody's tracking numbers. */
    const messy = '﻿"buyer";"tracking_ref";"order_ref";"carrier"\n"SmartBuild";"TRK-9";"ord-1";"BlueDart"'
    const r = parseDispatch(messy, known)
    expect(r.rows).toEqual([{ order_ref: 'ORD-1', carrier: 'BlueDart', tracking_ref: 'TRK-9' }])
  })

  it('passes over a row the warehouse has not filled in yet', () => {
    const r = parseDispatch('order_ref,carrier,tracking_ref\nORD-1,,\n', known)
    expect(r.rows).toEqual([])
    expect(r.problems[0]).toMatch(/Nothing in the file/)
  })

  it('names the row and the reason for everything it cannot use', () => {
    /* "3 of 40 failed" without saying which three is an import nobody can fix. */
    const r = parseDispatch([
      'order_ref,carrier,tracking_ref',
      'ORD-9,BlueDart,TRK-1',
      'ORD-2,BlueDart,TRK-2',
      'ORD-1,,TRK-3',
      ',BlueDart,TRK-4',
    ].join('\n'), known)
    expect(r.rows).toEqual([])
    expect(r.problems).toHaveLength(4)
    expect(r.problems[0]).toContain('ORD-9')
    expect(r.problems[1]).toMatch(/already delivered/)
    expect(r.problems[2]).toMatch(/no carrier/)
    expect(r.problems[3]).toMatch(/no order reference/)
  })

  it('refuses one order twice with two different numbers', () => {
    const r = parseDispatch([
      'order_ref,carrier,tracking_ref', 'ORD-1,BlueDart,TRK-1', 'ORD-1,BlueDart,TRK-2',
    ].join('\n'), known)
    expect(r.rows).toHaveLength(1)
    expect(r.problems[0]).toMatch(/twice/)
  })

  it('refuses a file with no header it recognises', () => {
    const r = parseDispatch('ORD-1,BlueDart,TRK-9', known)
    expect(r.rows).toEqual([])
    expect(r.problems[0]).toMatch(/first row has to name the columns/)
  })

  it('says so about an empty file rather than reporting nothing', () => {
    expect(parseDispatch('   ', known).problems[0]).toMatch(/empty/)
  })
})

describe('what an import is about to do', () => {
  it('says how many, to what, and by whom', () => {
    const known = [order({ id: 'a', order_ref: 'ORD-1', stage: 1 })]
    const s = dispatchSummary([{ order_ref: 'ORD-1', carrier: 'BlueDart', tracking_ref: 'T' }], known)
    expect(s).toContain('1 order')
    expect(s).toContain('packed')
    expect(s).toContain('BlueDart')
  })

  it('is honest when there is nothing to do', () => {
    expect(dispatchSummary([], [])).toBe('Nothing to apply.')
  })
})
