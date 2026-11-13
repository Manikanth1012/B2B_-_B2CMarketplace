import { describe, it, expect } from 'vitest'
import {
  idleState, IDLE_DAYS, basketValue, cartUnitPrice, lineFlag, isFlagged, isBlocked, flaggedSelections, blockedSentence,
  bundleStockSays, cartsByUser, lineKey, fromKept, mergeSaved, fellOff, NO_LONGER_AVAILABLE,
} from './baskets'
import type { KeptBasket, KeptLine } from './baskets'
import type { Basket, BasketLine } from './requisitionBasket'

const NOW = '2026-11-13T12:00:00Z'
const daysAgo = (d: number) => new Date(Date.parse(NOW) - d * 86_400_000).toISOString()

const line = (over: Partial<BasketLine> = {}): BasketLine => ({
  product_id: 'SKU-1', name: 'Router', seller: 'Acme', partner_id: null, quantity: 2, unit_price: 100,
  model: 'oneoff', vertical: 'devices', unit: null, ...over,
})

const kept = (over: Partial<KeptLine> = {}): KeptLine => ({
  id: 'L-1', product_id: 'SKU-1', name: 'Router', seller: 'Acme', partner_id: null, quantity: 2, unit_price: 100,
  model: 'oneoff', vertical: 'devices', unit: null, quote_line_id: null, bundle_selection_id: null, bundle: null,
  on_contract: null, off_contract_reason: null, stock_note: null, was_quantity: null, flagged_at: null, sort_order: 0,
  ...over,
})

describe('idle state', () => {
  it('is pending for under seven days and abandoned from seven', () => {
    expect(IDLE_DAYS).toBe(7)
    expect(idleState(daysAgo(0), NOW)).toBe('pending')
    expect(idleState(daysAgo(6.99), NOW)).toBe('pending')
    expect(idleState(daysAgo(7), NOW)).toBe('abandoned')
    expect(idleState(daysAgo(30), new Date(NOW))).toBe('abandoned')
  })
  it('treats an unreadable date as pending, not abandoned', () => {
    expect(idleState('not a date', NOW)).toBe('pending')
  })
})

describe('value', () => {
  it('sums quantity times price, to the cent', () => {
    expect(basketValue([{ quantity: 3, unit_price: 0.1 }, { quantity: 1, unit_price: 99.99 }])).toBe(100.29)
    expect(basketValue([])).toBe(0)
  })
})

describe('a flagged line', () => {
  it('is not flagged without a note', () => {
    expect(lineFlag(line())).toBeNull()
    expect(isFlagged(line({ stock_note: null }))).toBe(false)
  })
  it('a capped line can be accepted or removed', () => {
    expect(lineFlag(line({ stock_note: 'Only 3 left — we reduced this from 5', was_quantity: 5 })))
      .toEqual({ note: 'Only 3 left — we reduced this from 5', actions: ['accept', 'remove'] })
  })
  it('a line no longer available can only be removed', () => {
    expect(lineFlag(line({ stock_note: NO_LONGER_AVAILABLE })))
      .toEqual({ note: 'No longer available', actions: ['remove'] })
  })
  it('a bundle part goes only with its bundle', () => {
    expect(lineFlag(line({ stock_note: 'Only 2 left — this bundle needs 4', bundle_selection_id: 'BS-1' })))
      .toEqual({ note: 'Only 2 left — this bundle needs 4', actions: ['remove'] })
  })
})

describe('blocked', () => {
  it('is blocked while any line is flagged, bundle parts included', () => {
    expect(isBlocked([line(), line({ product_id: 'SKU-2' })])).toBe(false)
    expect(isBlocked([line(), line({ product_id: 'SKU-2', stock_note: NO_LONGER_AVAILABLE })])).toBe(true)
    expect(isBlocked([line({ bundle_selection_id: 'BS-1', stock_note: 'Only 1 left — this bundle needs 2' })])).toBe(true)
  })
  it('names the bundles with a flagged part', () => {
    const lines = [
      line({ bundle_selection_id: 'BS-1' }),
      line({ product_id: 'SKU-2', bundle_selection_id: 'BS-1', stock_note: 'Only 1 left — this bundle needs 2' }),
      line({ product_id: 'SKU-3', bundle_selection_id: 'BS-2' }),
    ]
    expect([...flaggedSelections(lines)]).toEqual(['BS-1'])
  })
  it('says what stops the basket, or nothing', () => {
    expect(blockedSentence([line()], 'requisition')).toBeNull()
    expect(blockedSentence([line({ stock_note: NO_LONGER_AVAILABLE })], 'requisition'))
      .toBe('1 line changed because stock ran out. Accept or remove it before you raise this requisition.')
    expect(blockedSentence([line({ stock_note: 'x' }), line({ product_id: 'SKU-2', stock_note: 'y' })], 'order'))
      .toBe('2 lines changed because stock ran out. Accept or remove each of them before you place this order.')
  })
  it('says why a bundle is blocked', () => {
    expect(bundleStockSays([line({ bundle_selection_id: 'BS-1' })], 'Office kit')).toBeNull()
    expect(bundleStockSays([line({ name: 'Desk phone', bundle_selection_id: 'BS-1', stock_note: 'Only 1 left — this bundle needs 2' })], 'Office kit'))
      .toBe('Desk phone: Only 1 left — this bundle needs 2. Office kit cannot be bought as it is. Remove the bundle to continue.')
  })
})

describe('shopper carts by owner', () => {
  const rows = [
    { user_id: 'U1', quantity: 2, unit_price: 10, saved: false, updated_at: daysAgo(1), stock_note: null },
    { user_id: 'U1', quantity: 1, unit_price: 5, saved: false, updated_at: daysAgo(3), stock_note: 'No longer available' },
    { user_id: 'U1', quantity: 9, unit_price: 100, saved: true, updated_at: daysAgo(0), stock_note: null },
    { user_id: 'U2', quantity: 1, unit_price: null, saved: false, updated_at: daysAgo(10), stock_note: null },
    { user_id: 'U3', quantity: 1, unit_price: 3, saved: true, updated_at: daysAgo(1), stock_note: null },
    { user_id: null, quantity: 1, unit_price: 3, saved: false, updated_at: daysAgo(1), stock_note: null },
  ]
  it('groups the lines being bought, newest change first, saved lines left out', () => {
    const carts = cartsByUser(rows)
    expect(carts.map(c => c.user_id)).toEqual(['U1', 'U2'])
    expect(carts[0]).toMatchObject({ lineCount: 2, value: 25, flags: 1, unpriced: 0, lastChange: daysAgo(1) })
    expect(carts[1]).toMatchObject({ lineCount: 1, value: 0, flags: 0, unpriced: 1, lastChange: daysAgo(10) })
  })
})

describe('keeping the requisition basket', () => {
  it('keys a line by product, bundle and quote', () => {
    expect(lineKey(line())).toBe('SKU-1||')
    expect(lineKey(line({ bundle_selection_id: 'BS-1' }))).toBe('SKU-1|BS-1|')
    expect(lineKey(kept({ quote_line_id: 'QL-1' }))).toBe('SKU-1||QL-1')
  })

  it('reads a kept basket as a basket, with its flags', () => {
    const k: KeptBasket = {
      id: 'B-1', account_id: 'ENT-1', currency: 'INR', updated_at: NOW, reminded_at: null,
      lines: [kept({ unit_price: '100.50' as unknown as number, stock_note: 'Only 1 left — we reduced this from 2', was_quantity: 2, quantity: 1 })],
    }
    const b = fromKept(k)
    expect(b.currency).toBe('INR')
    expect(b.lines[0]).toMatchObject({ id: 'L-1', unit_price: 100.5, quantity: 1, stock_note: 'Only 1 left — we reduced this from 2', was_quantity: 2 })
    expect(b.lines[0].quote_line_id).toBeUndefined()
    expect(fromKept(null)).toEqual({ currency: '', lines: [] })
  })

  it('takes the server flag and id after a save without losing an edit made meanwhile', () => {
    const sent: Basket = { currency: 'INR', lines: [line(), line({ product_id: 'SKU-2', quantity: 5 })] }
    /* While the save was out, the buyer changed SKU-1 to 4. */
    const current: Basket = { currency: 'INR', lines: [line({ quantity: 4 }), sent.lines[1]] }
    const server: KeptBasket = {
      id: 'B-1', account_id: 'ENT-1', currency: 'INR', updated_at: NOW, reminded_at: null,
      lines: [
        kept({ id: 'L-1', quantity: 2 }),
        kept({ id: 'L-2', product_id: 'SKU-2', quantity: 3, stock_note: 'Only 3 left — we reduced this from 5', was_quantity: 5, flagged_at: NOW }),
      ],
    }
    const merged = mergeSaved(current, sent, server)
    expect(merged.lines[0]).toMatchObject({ id: 'L-1', quantity: 4, stock_note: null })
    /* Untouched during the save: the server's cap is taken. */
    expect(merged.lines[1]).toMatchObject({ id: 'L-2', quantity: 3, stock_note: 'Only 3 left — we reduced this from 5', was_quantity: 5 })
  })

  it('leaves a line the server did not return as it is', () => {
    const sent: Basket = { currency: 'INR', lines: [line()] }
    const current: Basket = { currency: 'INR', lines: [line(), line({ product_id: 'SKU-9' })] }
    const merged = mergeSaved(current, sent, null)
    expect(merged).toBe(current)
  })
})

describe('lines that fell off the shelf', () => {
  it('names ordinary lines with no published price; quoted and bundled lines are held', () => {
    const b: Basket = { currency: 'INR', lines: [
      line(), line({ product_id: 'SKU-2', name: 'Gone' }),
      line({ product_id: 'SKU-3', quote_line_id: 'QL-1' }), line({ product_id: 'SKU-4', bundle_selection_id: 'BS-1' }),
    ] }
    const published = new Map([['SKU-1', { price: 100, floor_price: null }]])
    expect(fellOff(b, published)).toEqual([{ product_id: 'SKU-2', name: 'Gone' }])
  })
})

describe('cartUnitPrice', () => {
  it('prices a bundle part at the bundle price checkout charges, whatever the list says', () => {
    expect(cartUnitPrice({ bundle: 45.5, own: 60, base: 55 })).toBe(45.5)
  })
  it("prices anything else from the price book in the owner's money, then the listing's base", () => {
    expect(cartUnitPrice({ bundle: null, own: 60, base: 55 })).toBe(60)
    expect(cartUnitPrice({ bundle: null, own: null, base: 55 })).toBe(55)
  })
  it("says nothing when no price is in the owner's money", () => {
    expect(cartUnitPrice({ bundle: null, own: null, base: null })).toBeNull()
  })
  it('keeps a bundle price of zero rather than falling back to the list', () => {
    expect(cartUnitPrice({ bundle: 0, own: 60, base: 55 })).toBe(0)
  })
})
