import { describe, it, expect } from 'vitest'
import {
  STATE_LABEL, HOLD_LABEL, inBuilding, sellable, unitStory, provenance,
  holdsOn, oldestOnShelf, byOrder, batchReach, driftLine, matches, queryKind,
  nextStates, canMove,
} from './serials'
import type { StockUnit, Drift } from './serials'

const u = (over: Partial<StockUnit> = {}): StockUnit => ({
  serial: '353404120000001', product_id: 'SKU-4001', warehouse_id: 'wh-001',
  state: 'in_stock', hold_reason: null, received_on: '2026-01-10',
  grn_ref: 'GRN-202601-004', supplier_id: 'PTR-1001', batch_ref: 'BATCH-202601-4001',
  order_id: null, order_item_id: null, order_ref: null, customer: null,
  despatched_on: null, delivered_on: null, returned_on: null, note: null, ...over,
})

const shipped = (over: Partial<StockUnit> = {}) => u({
  state: 'delivered', order_id: 'o1', order_item_id: 'oi1', order_ref: 'ORD-771339',
  customer: 'Wanjiru Kamau', despatched_on: '2026-06-20', delivered_on: '2026-06-23', ...over,
})

describe('where a unit is', () => {
  it('counts what is physically here, and does not count what left', () => {
    expect(inBuilding(u({ state: 'in_stock' }))).toBe(true)
    expect(inBuilding(u({ state: 'reserved' }))).toBe(true)
    /* A faulty unit is in the building and unsellable. One number cannot carry
       both facts, which is why there are two functions. */
    expect(inBuilding(u({ state: 'faulty' }))).toBe(true)
    expect(sellable(u({ state: 'faulty' }))).toBe(false)
    expect(inBuilding(shipped())).toBe(false)
  })

  it('tells the story rather than printing the state', () => {
    expect(unitStory(shipped())).toContain('Wanjiru Kamau')
    expect(unitStory(shipped())).toContain('ORD-771339')
    expect(unitStory(u())).toContain('On the shelf')
  })

  it('says what a reservation is against, not merely that it is one', () => {
    const onOrder = u({ state: 'reserved', hold_reason: 'order', order_ref: 'ORD-882116' })
    expect(unitStory(onOrder)).toContain('ORD-882116')
    const held = u({ state: 'reserved', hold_reason: 'quarantine', note: 'Awaiting a calibration certificate' })
    expect(unitStory(held)).toContain('quarantine')
    expect(unitStory(held)).toContain('calibration')
  })

  it('declares what it does not hold rather than leaving a blank', () => {
    const rows = provenance(u({ batch_ref: null }))
    expect(rows.find(r => r.label === 'Batch')!.value).toBeNull()
    expect(rows.find(r => r.label === 'Received')!.value).toBe('2026-01-10')
  })
})

describe('why a line is short', () => {
  const line = [
    u({ serial: 'a', state: 'reserved', hold_reason: 'quarantine', note: 'Calibration certificate' }),
    u({ serial: 'b', state: 'reserved', hold_reason: 'quarantine', note: 'Calibration certificate' }),
    u({ serial: 'c', state: 'reserved', hold_reason: 'order', order_ref: 'ORD-1' }),
    u({ serial: 'd', state: 'in_stock' }),
  ]

  it('groups the holds and keeps the reason attached', () => {
    const holds = holdsOn(line)
    expect(holds.map(h => [h.reason, h.count])).toEqual([['quarantine', 2], ['order', 1]])
    expect(holds[0].note).toBe('Calibration certificate')
  })

  it('drops a shared note that is not shared', () => {
    /* Two holds for the same reason and different reasons behind them means
       the note is no longer the explanation, so it stops pretending to be. */
    const holds = holdsOn([
      u({ serial: 'a', state: 'reserved', hold_reason: 'allocation', note: 'Channel A' }),
      u({ serial: 'b', state: 'reserved', hold_reason: 'allocation', note: 'Channel B' }),
    ])
    expect(holds[0].note).toBeNull()
    expect(holds[0].count).toBe(2)
  })

  it('has nothing to say about a line with no holds', () => {
    expect(holdsOn([u(), shipped()])).toEqual([])
  })

  it('finds the oldest thing still on the shelf', () => {
    const old = oldestOnShelf([
      u({ serial: 'new', received_on: '2026-06-01' }),
      u({ serial: 'old', received_on: '2025-02-01' }),
      /* Reserved is not on the shelf — it is spoken for. */
      u({ serial: 'older', received_on: '2024-01-01', state: 'reserved', hold_reason: 'demo' }),
    ], new Date('2026-08-07'))
    expect(old!.serial).toBe('old')
    expect(old!.days).toBeGreaterThan(500)
  })

  it('has no oldest when the shelf is empty', () => {
    expect(oldestOnShelf([shipped()])).toBeNull()
  })
})

describe('where the stock went', () => {
  const gone = [
    shipped({ serial: '1', order_ref: 'ORD-A', delivered_on: '2026-06-23' }),
    shipped({ serial: '2', order_ref: 'ORD-A', delivered_on: '2026-06-23' }),
    shipped({ serial: '3', order_ref: 'ORD-B', delivered_on: '2026-07-12', customer: 'SmartBuild Ltd' }),
  ]

  it('groups by the order that took them, most recent first', () => {
    const out = byOrder(gone)
    expect(out.map(o => o.order_ref)).toEqual(['ORD-B', 'ORD-A'])
    expect(out.find(o => o.order_ref === 'ORD-A')!.count).toBe(2)
    expect(out.find(o => o.order_ref === 'ORD-A')!.serials).toEqual(['1', '2'])
  })

  it('ignores what has not left', () => {
    expect(byOrder([u()])).toEqual([])
  })

  it('answers the recall question a count cannot', () => {
    /* Given a bad batch: how many, how many are still ours, and which
       customers are holding the rest. */
    const r = batchReach([
      ...gone.map(g => ({ ...g, batch_ref: 'BATCH-X' })),
      u({ serial: '4', batch_ref: 'BATCH-X' }),
      u({ serial: '5', batch_ref: 'BATCH-OTHER' }),
    ], 'BATCH-X')
    expect(r.total).toBe(4)
    expect(r.shipped).toBe(3)
    expect(r.stillHere).toBe(1)
    expect(r.orders.map(o => o.order_ref).sort()).toEqual(['ORD-A', 'ORD-B'])
  })
})

describe('the ledger against the units', () => {
  const d = (over: Partial<Drift> = {}): Drift => ({
    line_id: 'inv-4003', product_id: 'SKU-4003', warehouse_id: 'wh-001',
    ledger_on_hand: 95, counted_on_hand: 95, ledger_reserved: 30, counted_reserved: 30,
    agrees: true, ...over,
  })

  it('says nothing when the count is the count', () => {
    expect(driftLine(d())).toBeNull()
  })

  it('names both halves of a disagreement and says which wins', () => {
    const line = driftLine(d({ agrees: false, counted_on_hand: 91, counted_reserved: 28 }))!
    expect(line).toContain('95 on hand and 91 units exist')
    expect(line).toContain('30 reserved and 28 are')
    /* The physical count wins, the same rule the warehouse screen already
       states for WMS drift. */
    expect(line).toContain('The units are the count')
  })
})

describe('finding one', () => {
  it('matches a serial, an order, a customer, a batch or a goods-in reference', () => {
    const unit = shipped({ batch_ref: 'BATCH-202606-4001', grn_ref: 'GRN-202605-002' })
    for (const q of ['353404', 'ORD-771339', 'wanjiru', 'batch-202606', 'grn-202605']) {
      expect(matches(unit, q), q).toBe(true)
    }
    expect(matches(unit, 'ORD-999999')).toBe(false)
  })

  it('matches nothing on an empty query rather than everything', () => {
    expect(matches(shipped(), '   ')).toBe(false)
  })

  it('says what it thinks it was given, so a miss is explainable', () => {
    expect(queryKind('353404120000002')).toBe('an IMEI')
    expect(queryKind('ORD-771339')).toBe('an order')
    expect(queryKind('BATCH-202606-4001')).toBe('a batch')
    expect(queryKind('GRN-202601-004')).toBe('a goods-in reference')
    expect(queryKind('SKU5007-0000012')).toBe('a serial')
    expect(queryKind('Wanjiru')).toContain('name')
    expect(queryKind('')).toBe('nothing yet')
  })
})

describe('moving one', () => {
  it('offers only the states it can actually reach', () => {
    expect(nextStates('in_stock')).toEqual(['reserved', 'faulty', 'written_off'])
    /* A unit on the shelf cannot be delivered — it has not left. */
    expect(nextStates('in_stock')).not.toContain('delivered')
    expect(nextStates('written_off')).toEqual([])
  })

  it('refuses a jump the warehouse could not make', () => {
    const r = canMove(u(), 'delivered')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('cannot go straight to')
  })

  it('refuses a reservation that does not say why', () => {
    const r = canMove(u(), 'reserved')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('nobody could explain')
  })

  it('refuses reserving against an order without naming one', () => {
    const r = canMove(u(), 'reserved', 'order')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('naming the order')
  })

  it('allows a hold that names its reason', () => {
    expect(canMove(u(), 'reserved', 'quarantine').ok).toBe(true)
  })

  it('warns that writing off is final', () => {
    const r = canMove(u(), 'written_off')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toContain('final')
  })

  it('warns when a faulty unit is put back on sale', () => {
    const r = canMove(u({ state: 'faulty' }), 'in_stock')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toContain('sellable again')
  })

  it('refuses a move to where it already is', () => {
    const r = canMove(u(), 'in_stock')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('already')
  })

  it('has a word for every state and every hold', () => {
    for (const s of ['in_stock', 'reserved', 'despatched', 'delivered', 'returned', 'faulty', 'written_off'] as const) {
      expect(STATE_LABEL[s]).toBeTruthy()
    }
    for (const h of ['order', 'quarantine', 'allocation', 'demo', 'engineering'] as const) {
      expect(HOLD_LABEL[h]).toBeTruthy()
    }
  })
})
