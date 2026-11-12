/* The drawer's re-check before Raise: today's prices against what the basket holds. */
import { describe, it, expect } from 'vitest'
import { contractChanges, applyContractChanges, publishedIn } from './requisitionBasket'
import type { Basket, BasketLine } from './requisitionBasket'
import type { AccountPrice } from './accountPrices'

const TODAY = '2026-11-12'

const line = (over: Partial<BasketLine> = {}): BasketLine => ({
  product_id: 'SKU-1', name: 'Gateway', seller: 'Nimbus', partner_id: 'P-1', quantity: 2,
  unit_price: 1000, model: 'oneoff', vertical: 'iot', unit: null, on_contract: false, ...over,
})

const price = (over: Partial<AccountPrice> = {}): AccountPrice => ({
  id: 'AP-1', account_id: 'ENT-1', product_id: 'SKU-1', currency: 'INR', unit_price: 900,
  starts_on: '2026-01-01', ends_on: null, source: 'negotiated', quote_line_id: null, quote_ref: null,
  note: null, set_by: 'op', set_at: '2026-01-01', ended_by: null, ended_at: null, end_reason: null, ...over,
})

const published = (entries: [string, number, number | null][]) =>
  new Map(entries.map(([id, p, f]) => [id, { price: p, floor_price: f }]))

const basket = (...lines: BasketLine[]): Basket => ({ currency: 'INR', lines })

describe('contractChanges', () => {
  it('finds nothing when the basket still matches today', () => {
    const b = basket(line({ unit_price: 900, on_contract: true }))
    expect(contractChanges(b, { prices: [price()], published: published([['SKU-1', 1000, null]]) }, 'ENT-1', TODAY)).toEqual([])
  })

  it('a price that started since: the line is now on the price book at the account price', () => {
    const b = basket(line())
    expect(contractChanges(b, { prices: [price()], published: published([['SKU-1', 1000, null]]) }, 'ENT-1', TODAY)).toEqual([
      { product_id: 'SKU-1', name: 'Gateway', was: { unit_price: 1000, on_contract: false }, now: { unit_price: 900, on_contract: true } },
    ])
  })

  it('a price that ended since: the line is off, back at the published price', () => {
    const b = basket(line({ unit_price: 900, on_contract: true }))
    const ended = price({ ends_on: '2026-11-11' })
    const [c] = contractChanges(b, { prices: [ended], published: published([['SKU-1', 1000, null]]) }, 'ENT-1', TODAY)
    expect(c.now).toEqual({ unit_price: 1000, on_contract: false })
  })

  it('a new account price on a line already on the book, and the floor holding it', () => {
    const b = basket(line({ unit_price: 900, on_contract: true }))
    const lower = price({ unit_price: 700 })
    const [c] = contractChanges(b, { prices: [lower], published: published([['SKU-1', 1000, 800]]) }, 'ENT-1', TODAY)
    expect(c.now).toEqual({ unit_price: 800, on_contract: true })
  })

  it('the published price moved under an off line', () => {
    const b = basket(line())
    const [c] = contractChanges(b, { prices: [], published: published([['SKU-1', 1100, null]]) }, 'ENT-1', TODAY)
    expect(c.now).toEqual({ unit_price: 1100, on_contract: false })
  })

  it('another account, currency or a scheduled price does not count', () => {
    const b = basket(line())
    const prices = [price({ account_id: 'ENT-2' }), price({ currency: 'USD' }), price({ starts_on: '2026-12-01' })]
    expect(contractChanges(b, { prices, published: published([['SKU-1', 1000, null]]) }, 'ENT-1', TODAY)).toEqual([])
  })

  it('quoted and bundled lines are never re-read', () => {
    const b = basket(
      line({ quote_line_id: 'QL-1', unit_price: 500 }),
      line({ product_id: 'SKU-2', bundle_selection_id: 'BS-1', unit_price: 1 }),
    )
    const fresh = { prices: [price(), price({ product_id: 'SKU-2' })], published: published([['SKU-1', 1000, null], ['SKU-2', 1000, null]]) }
    expect(contractChanges(b, fresh, 'ENT-1', TODAY)).toEqual([])
  })

  it('no published price in the currency: the price is kept, the standing still judged', () => {
    const b = basket(line({ unit_price: 1000 }))
    const [c] = contractChanges(b, { prices: [price()], published: new Map() }, 'ENT-1', TODAY)
    expect(c.now).toEqual({ unit_price: 1000, on_contract: true })
  })

  it('compares at two places', () => {
    const b = basket(line({ unit_price: 999.999 }))
    expect(contractChanges(b, { prices: [], published: published([['SKU-1', 1000, null]]) }, 'ENT-1', TODAY)).toEqual([])
  })
})

describe('publishedIn (the price guard\'s published price)', () => {
  it('the currency row wins, with its floor', () => {
    const m = publishedIn('INR', [{ product_id: 'SKU-1', currency: 'INR', price: 1000, floor_price: 800 }], [{ id: 'SKU-1', currency: 'INR', price: 1200 }])
    expect(m.get('SKU-1')).toEqual({ price: 1000, floor_price: 800 })
  })

  it('no row in the currency: the base row when it is in that currency, with no floor', () => {
    const m = publishedIn('USD', [{ product_id: 'SKU-1', currency: 'INR', price: 1000, floor_price: 800 }], [{ id: 'SKU-1', currency: 'USD', price: 49.999 }])
    expect(m.get('SKU-1')).toEqual({ price: 50, floor_price: null })
  })

  it('a base row in other money is not a price here', () => {
    expect(publishedIn('USD', [], [{ id: 'SKU-1', currency: 'INR', price: 1000 }]).has('SKU-1')).toBe(false)
  })

  it('a listing priced only on its base row: an account price that starts moves its price to the account\'s', () => {
    const b: Basket = { currency: 'USD', lines: [line({ unit_price: 50 })] }
    const published = publishedIn('USD', [], [{ id: 'SKU-1', currency: 'USD', price: 50 }])
    const [c] = contractChanges(b, { prices: [price({ currency: 'USD', unit_price: 45 })], published }, 'ENT-1', TODAY)
    expect(c.now).toEqual({ unit_price: 45, on_contract: true })
  })
})

describe('applyContractChanges', () => {
  it('sets price and standing, and drops a reason once a line is on the book', () => {
    const b = basket(line({ off_contract_reason: 'Only stock' }), line({ product_id: 'SKU-2', name: 'Sensor' }))
    const next = applyContractChanges(b, [
      { product_id: 'SKU-1', name: 'Gateway', was: { unit_price: 1000, on_contract: false }, now: { unit_price: 900, on_contract: true } },
    ])
    expect(next.lines[0]).toMatchObject({ unit_price: 900, on_contract: true })
    expect('off_contract_reason' in next.lines[0]).toBe(false)
    expect(next.lines[1]).toBe(b.lines[1])
  })

  it('keeps the reason on a line that went off, and leaves quoted lines alone', () => {
    const b = basket(line({ on_contract: true, unit_price: 900, off_contract_reason: 'x' }), line({ product_id: 'SKU-Q', quote_line_id: 'QL' }))
    const next = applyContractChanges(b, [
      { product_id: 'SKU-1', name: 'Gateway', was: { unit_price: 900, on_contract: true }, now: { unit_price: 1000, on_contract: false } },
      { product_id: 'SKU-Q', name: 'Q', was: { unit_price: 1000, on_contract: false }, now: { unit_price: 1, on_contract: true } },
    ])
    expect(next.lines[0]).toMatchObject({ unit_price: 1000, on_contract: false, off_contract_reason: 'x' })
    expect(next.lines[1]).toBe(b.lines[1])
  })

  it('no changes: the same basket', () => {
    const b = basket(line())
    expect(applyContractChanges(b, [])).toBe(b)
  })
})
