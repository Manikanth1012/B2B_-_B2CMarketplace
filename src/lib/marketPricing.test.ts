import { describe, it, expect } from 'vitest'
import {
  marketsFor, priceableCurrencies, priceProblems, problemOn, priceIsUsable,
  suggestPrice, missingPrices, sellableIn, emptyDraft, draftFrom, toRow,
} from './marketPricing'
import type { PartnerMarket, BookRow, PriceDraft } from './marketPricing'
import type { Currency, Market, Rate } from './money'

const CURRENCIES: Currency[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', minor_units: 2, symbol_first: true, locale: 'en-US', is_reporting: true, sort_order: 1 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', minor_units: 2, symbol_first: true, locale: 'en-IN', is_reporting: false, sort_order: 2 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', minor_units: 2, symbol_first: true, locale: 'en-AE', is_reporting: false, sort_order: 3 },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', minor_units: 2, symbol_first: true, locale: 'en-KE', is_reporting: false, sort_order: 4 },
  { code: 'JPY', name: 'Yen', symbol: '¥', minor_units: 0, symbol_first: true, locale: 'ja-JP', is_reporting: false, sort_order: 9 },
]

const MARKETS: Market[] = [
  { code: 'IN', name: 'India', currency: 'INR', tax_label: 'GST', tax_rate: 18, tax_note: '', is_default: true, sort_order: 1 },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', tax_label: 'VAT', tax_rate: 5, tax_note: '', is_default: false, sort_order: 2 },
  { code: 'KE', name: 'Kenya', currency: 'KES', tax_label: 'VAT', tax_rate: 16, tax_note: '', is_default: false, sort_order: 3 },
]

const grant = (p: string, m: string, state: PartnerMarket['state']): PartnerMarket =>
  ({ partner_id: p, market_code: m, state, approved_at: null, approved_by: null, note: '' })

const GRANTS: PartnerMarket[] = [
  grant('PTR-1004', 'IN', 'approved'),
  grant('PTR-1004', 'AE', 'approved'),
  grant('PTR-1004', 'KE', 'approved'),
  grant('PTR-1009', 'IN', 'approved'),
  grant('PTR-1009', 'AE', 'requested'),
  grant('PTR-1012', 'IN', 'suspended'),
]

const RATES: Rate[] = [
  { base: 'USD', quote: 'INR', rate: 86.90, as_of: '2026-07-01', pegged: false },
  { base: 'USD', quote: 'INR', rate: 87.42, as_of: '2026-08-01', pegged: false },
  { base: 'USD', quote: 'AED', rate: 3.6725, as_of: '2026-08-01', pegged: true },
]

const draft = (over: Partial<PriceDraft> = {}): PriceDraft =>
  ({ ...emptyDraft('INR'), price: '999', ...over })

const ALL = ['INR', 'AED', 'KES']

/* ------------------------------------------------------------- who may --- */

describe('which markets a seller sells in', () => {
  it('lists only the approved ones', () => {
    expect(marketsFor(GRANTS, 'PTR-1004', MARKETS).map(m => m.code)).toEqual(['IN', 'AE', 'KE'])
    expect(marketsFor(GRANTS, 'PTR-1009', MARKETS).map(m => m.code)).toEqual(['IN'])
  })

  it('does not count a request as a grant', () => {
    expect(marketsFor(GRANTS, 'PTR-1009', MARKETS).map(m => m.code)).not.toContain('AE')
  })

  it('does not count a suspension as a grant', () => {
    expect(marketsFor(GRANTS, 'PTR-1012', MARKETS)).toEqual([])
  })

  it('gives a seller with no grants nothing', () => {
    expect(marketsFor(GRANTS, 'PTR-9999', MARKETS)).toEqual([])
    expect(marketsFor(GRANTS, null, MARKETS)).toEqual([])
  })
})

describe('which currencies each console may price in', () => {
  it('gives the operator every market currency', () => {
    expect(priceableCurrencies({ persona: 'operator' }, MARKETS, GRANTS).sort())
      .toEqual(['AED', 'INR', 'KES'])
  })

  it('gives a seller only the markets they are approved in', () => {
    expect(priceableCurrencies({ persona: 'partner', partnerId: 'PTR-1009' }, MARKETS, GRANTS))
      .toEqual(['INR'])
  })

  it('gives a seller with no grants nothing to price in', () => {
    expect(priceableCurrencies({ persona: 'partner', partnerId: 'PTR-1012' }, MARKETS, GRANTS))
      .toEqual([])
  })
})

/* ----------------------------------------------------------- validation --- */

describe('what makes a price acceptable', () => {
  it('accepts a plain good price', () => {
    expect(priceProblems(draft(), ALL, CURRENCIES)).toEqual([])
    expect(priceIsUsable(draft(), ALL, CURRENCIES)).toBe(true)
  })

  it('refuses a currency the seller is not approved for', () => {
    const p = priceProblems(draft({ currency: 'AED' }), ['INR'], CURRENCIES)
    expect(problemOn(p, 'currency')).toMatch(/not approved/i)
  })

  it('requires a price at all', () => {
    expect(problemOn(priceProblems(draft({ price: '' }), ALL, CURRENCIES), 'price')).toMatch(/needs a price/i)
  })

  it('refuses nonsense and non-positive prices', () => {
    expect(problemOn(priceProblems(draft({ price: 'free' }), ALL, CURRENCIES), 'price')).toMatch(/not a number/i)
    expect(problemOn(priceProblems(draft({ price: '0' }), ALL, CURRENCIES), 'price')).toMatch(/more than nothing/i)
    expect(problemOn(priceProblems(draft({ price: '-5' }), ALL, CURRENCIES), 'price')).toMatch(/more than nothing/i)
  })

  it('refuses a price below the floor — the thing the guard trigger also refuses', () => {
    const p = priceProblems(draft({ price: '500', floor_price: '699' }), ALL, CURRENCIES)
    expect(problemOn(p, 'price')).toMatch(/below the floor/i)
  })

  it('allows a price exactly on the floor', () => {
    expect(priceProblems(draft({ price: '699', floor_price: '699' }), ALL, CURRENCIES)).toEqual([])
  })

  it('refuses a list price under the price', () => {
    expect(problemOn(priceProblems(draft({ price: '999', list_price: '899' }), ALL, CURRENCIES), 'list_price'))
      .toMatch(/cannot be under/i)
  })

  it('refuses a strikethrough that is not a saving', () => {
    expect(problemOn(priceProblems(draft({ price: '999', was_price: '999' }), ALL, CURRENCIES), 'was_price'))
      .toMatch(/above the price/i)
    expect(problemOn(priceProblems(draft({ price: '999', was_price: '899' }), ALL, CURRENCIES), 'was_price'))
      .toMatch(/above the price/i)
    expect(priceProblems(draft({ price: '999', was_price: '1299' }), ALL, CURRENCIES)).toEqual([])
  })

  it('refuses more decimals than the currency is charged to', () => {
    expect(problemOn(priceProblems(draft({ price: '999.999' }), ALL, CURRENCIES), 'price'))
      .toMatch(/2 decimal places/)
    const yen = priceProblems({ ...emptyDraft('JPY'), price: '1234.5' }, ['JPY'], CURRENCIES)
    expect(problemOn(yen, 'price')).toMatch(/0 decimal places/)
  })

  it('reports every problem at once rather than the first', () => {
    const p = priceProblems(
      { currency: 'AED', price: '500', was_price: '400', floor_price: '699', list_price: '450' },
      ['INR'], CURRENCIES,
    )
    expect(p.map(x => x.field).sort()).toEqual(['currency', 'list_price', 'price', 'was_price'])
  })

  it('treats blank optional fields as absent, not as zero', () => {
    expect(priceProblems(draft({ was_price: '', floor_price: '', list_price: '' }), ALL, CURRENCIES)).toEqual([])
  })
})

describe('turning a draft into a row', () => {
  it('keeps the numbers and nulls the blanks', () => {
    expect(toRow(draft({ price: '999', was_price: '1299', floor_price: '', list_price: '1499' }), 'SKU-1'))
      .toEqual({
        product_id: 'SKU-1', currency: 'INR', price: 999,
        was_price: 1299, floor_price: null, list_price: 1499,
      })
  })

  it('round-trips a stored row through the editor unchanged', () => {
    const row: BookRow = {
      product_id: 'SKU-1', currency: 'AED', price: 47.99,
      was_price: 59.99, floor_price: 39.99, list_price: 64.99,
    }
    expect(toRow(draftFrom(row), 'SKU-1')).toEqual(row)
  })
})

/* ----------------------------------------------------------- suggesting --- */

describe('suggesting a price for an unpriced market', () => {
  it('converts and then charm-rounds, because ₹1,082.67 is not a price', () => {
    const s = suggestPrice({ amount: 12.39, currency: 'USD' }, 'INR', RATES, '2026-08-01')
    expect(s!.price).toBe(1099)
    expect(s!.rate).toBe(87.42)
  })

  it('uses the rate in force on the date given', () => {
    expect(suggestPrice({ amount: 100, currency: 'USD' }, 'INR', RATES, '2026-07-15')!.as_of).toBe('2026-07-01')
  })

  it('inverts when only the other direction is quoted', () => {
    const s = suggestPrice({ amount: 8742, currency: 'INR' }, 'USD', RATES, '2026-08-01')
    /* 8742 / 87.42 = 100, charm-rounded in dollars */
    expect(s!.price).toBeGreaterThan(80)
    expect(s!.price).toBeLessThan(120)
  })

  it('suggests nothing where there is no rate', () => {
    expect(suggestPrice({ amount: 10, currency: 'USD' }, 'KES', RATES, '2026-08-01')).toBeNull()
    expect(suggestPrice({ amount: 10, currency: 'USD' }, 'INR', RATES, '2020-01-01')).toBeNull()
  })

  it('suggests nothing for a free product', () => {
    expect(suggestPrice({ amount: 0, currency: 'USD' }, 'INR', RATES, '2026-08-01')).toBeNull()
  })
})

describe('which markets are still unpriced', () => {
  const rows: BookRow[] = [
    { product_id: 'SKU-1', currency: 'INR', price: 999, was_price: null, floor_price: null, list_price: null },
  ]

  it('names the gaps', () => {
    expect(missingPrices(rows, 'SKU-1', ALL)).toEqual(['AED', 'KES'])
  })

  it('counts a product with nothing as missing everything', () => {
    expect(missingPrices(rows, 'SKU-2', ALL)).toEqual(ALL)
  })

  it('is empty when every market is priced', () => {
    expect(missingPrices(rows, 'SKU-1', ['INR'])).toEqual([])
  })
})

/* -------------------------------------------------------------- selling --- */

describe('whether a listing can go on sale in a market', () => {
  const rows: BookRow[] = [
    { product_id: 'SKU-1', currency: 'INR', price: 999, was_price: null, floor_price: null, list_price: null },
    { product_id: 'SKU-1', currency: 'AED', price: 47.99, was_price: null, floor_price: null, list_price: null },
  ]
  const seller = { id: 'SKU-1', partner_id: 'PTR-1009' }
  const firstParty = { id: 'SKU-1', partner_id: null }

  it('lets an approved, priced listing sell', () => {
    expect(sellableIn(seller, MARKETS[0], GRANTS, rows)).toEqual({ ok: true })
  })

  it('distinguishes "not approved" from "no price" — they need different actions', () => {
    /* PTR-1009 is only requested in the UAE, and has an AED price. */
    expect(sellableIn(seller, MARKETS[1], GRANTS, rows))
      .toEqual({ ok: false, reason: 'United Arab Emirates approval not granted yet.' })
    /* Approved in India but Kenya has no price row. */
    const kenyan = { ...seller, partner_id: 'PTR-1004' }
    expect(sellableIn(kenyan, MARKETS[2], GRANTS, rows))
      .toEqual({ ok: false, reason: 'No KES price set.' })
  })

  it('says so plainly when the seller has no grant at all', () => {
    expect(sellableIn({ id: 'SKU-1', partner_id: 'PTR-9999' }, MARKETS[0], GRANTS, rows))
      .toEqual({ ok: false, reason: 'Not selling in India.' })
  })

  it('reports a suspension as a suspension', () => {
    expect(sellableIn({ id: 'SKU-1', partner_id: 'PTR-1012' }, MARKETS[0], GRANTS, rows))
      .toEqual({ ok: false, reason: 'Suspended in India.' })
  })

  it('asks nothing of a first-party listing but a price', () => {
    expect(sellableIn(firstParty, MARKETS[0], GRANTS, rows)).toEqual({ ok: true })
    expect(sellableIn(firstParty, MARKETS[2], GRANTS, rows))
      .toEqual({ ok: false, reason: 'No KES price set.' })
  })
})
