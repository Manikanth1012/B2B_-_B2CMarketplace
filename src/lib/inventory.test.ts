import { describe, it, expect } from 'vitest'
import {
  stockBadge, stockLabel, lineValue, totalValue, needsAttention, attentionOrder, canStock,
  type StockLine,
} from './inventory'

const line = (o: Partial<StockLine>): StockLine => ({
  id: 'inv-1', product_id: 'SKU-4001', warehouse_id: 'wh-001',
  on_hand: 100, reserved: 20, available: 80, reorder_point: 50,
  inbound: 0, inbound_due: null, unit_cost: 10, last_count: null, sort_order: 1,
  ...o,
})

describe('stockBadge', () => {
  it('is out when there is none available', () => {
    expect(stockBadge(0, 50)).toBe('out')
  })

  /* Reserved stock is sold. Having 200 on hand with all 200 reserved is out, and
     telling a buyer otherwise sells the same unit twice. */
  it('is out when everything on hand is already reserved', () => {
    expect(stockBadge(0, 200)).toBe('out')
  })

  /* The reorder point is the level at which you reorder, so sitting exactly on
     it is already the warning rather than one unit away from it. */
  it('is low at the reorder point, not one below it', () => {
    expect(stockBadge(50, 50)).toBe('low')
    expect(stockBadge(51, 50)).toBe('in')
  })

  it('is low below the reorder point', () => {
    expect(stockBadge(65, 80)).toBe('low')
  })

  it('is in when there is comfortably more than the reorder point', () => {
    expect(stockBadge(330, 100)).toBe('in')
  })

  /* A reorder point of zero means nothing is ever "low" — it is in stock until
     it is gone. Digital-style lines behave this way. */
  it('never reports low when nothing triggers a reorder', () => {
    expect(stockBadge(1, 0)).toBe('in')
    expect(stockBadge(0, 0)).toBe('out')
  })

  it('treats a negative available as out rather than as a number', () => {
    expect(stockBadge(-5, 50)).toBe('out')
  })
})

describe('stockLabel', () => {
  it('gives each badge words a buyer reads', () => {
    expect(stockLabel('out')).toBe('Out of stock')
    expect(stockLabel('low')).toBe('Low stock')
    expect(stockLabel('in')).toBe('In stock')
  })
})

describe('value', () => {
  /* Reserved stock is sold but still in the building, so a write-down is taken
     against everything on hand rather than against what is available. */
  it('values everything on hand, not only what is available', () => {
    expect(lineValue(line({ on_hand: 100, reserved: 90, unit_cost: 10 }))).toBe(1000)
  })

  it('rounds to the cent rather than carrying a float', () => {
    expect(lineValue(line({ on_hand: 3, unit_cost: 0.1 }))).toBe(0.3)
  })

  it('totals a set of lines', () => {
    expect(totalValue([
      line({ on_hand: 450, unit_cost: 520 }),
      line({ on_hand: 68, unit_cost: 124 }),
    ])).toBe(242432)
  })

  it('is zero rather than NaN with nothing to total', () => {
    expect(totalValue([])).toBe(0)
  })
})

describe('needsAttention', () => {
  it('says nothing about a healthy line', () => {
    expect(needsAttention(line({ available: 330, reorder_point: 100, inbound: 0 }))).toBeNull()
  })

  it('flags an out line with nothing on order', () => {
    expect(needsAttention(line({ available: 0, reorder_point: 200, inbound: 0 })))
      .toEqual({ kind: 'out', covered: false })
  })

  /* The distinction the panel exists for: out with 2,000 landing on Friday needs
     nothing from anybody. */
  it('marks an out line covered when the inbound clears the reorder point', () => {
    expect(needsAttention(line({ available: 0, reorder_point: 200, inbound: 2000 })))
      .toEqual({ kind: 'out', covered: true })
  })

  /* Something on the way is not the same as enough on the way. */
  it('does not call a line covered when the inbound falls short', () => {
    expect(needsAttention(line({ available: 0, reorder_point: 200, inbound: 150 })))
      .toEqual({ kind: 'out', covered: false })
  })

  it('flags a low line and says whether it is covered', () => {
    expect(needsAttention(line({ available: 65, reorder_point: 80, inbound: 300 })))
      .toEqual({ kind: 'low', covered: true })
    expect(needsAttention(line({ available: 48, reorder_point: 60, inbound: 5 })))
      .toEqual({ kind: 'low', covered: false })
  })
})

describe('attentionOrder', () => {
  it('puts uncovered before covered, and out before low', () => {
    const lines = [
      line({ id: 'low-covered', available: 65, reorder_point: 80, inbound: 300 }),
      line({ id: 'out-covered', available: 0, reorder_point: 200, inbound: 2000 }),
      line({ id: 'low-bare', available: 48, reorder_point: 60, inbound: 0 }),
      line({ id: 'healthy', available: 330, reorder_point: 100, inbound: 0 }),
      line({ id: 'out-bare', available: 0, reorder_point: 50, inbound: 0 }),
    ]
    expect(attentionOrder(lines).map(r => r.line.id))
      .toEqual(['out-bare', 'out-covered', 'low-bare', 'low-covered'])
  })

  it('leaves healthy lines out entirely rather than ranking them last', () => {
    expect(attentionOrder([line({ available: 330, reorder_point: 100 })])).toEqual([])
  })
})

describe('canStock', () => {
  const mumbai = { type: 'fulfilment', categories: ['consumer', 'device'] }
  const returns = { type: 'returns', categories: ['iot', 'device'] }

  it('allows a category the warehouse serves', () => {
    expect(canStock(mumbai, 'device').ok).toBe(true)
  })

  it('refuses one it does not, and says what it does handle', () => {
    const v = canStock(mumbai, 'iot')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/consumer, device/)
  })

  /* Counting returned stock as sellable sells a customer their own return. */
  it('refuses a returns centre whatever category it lists', () => {
    const v = canStock(returns, 'device')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/coming back/i)
  })

  it('says something useful about a warehouse serving nothing', () => {
    const v = canStock({ type: 'fulfilment', categories: [] }, 'device')
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/nothing/)
  })
})
