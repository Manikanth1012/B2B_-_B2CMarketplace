/* What a listing has to say, per kind. All the cases the one-size wizard could
   not have got right, because it never asked. */
import { describe, it, expect } from 'vitest'
import {
  BILLING_PERIODS, periodOf, monthlyEquivalent, modelFor, taxPerMarket,
  currenciesFor, validateMarkets, blankPrices, reconcilePrices, validatePrices,
  componentsTotal, bundleSaving, validateBundle, draftOutstanding,
} from './listingDraft'
import type { MarketOption, PriceRow, BundleComponent, BundleRules } from './listingDraft'

const MARKETS: MarketOption[] = [
  { code: 'IN', name: 'India', currencies: ['INR'], taxRate: 18, taxLabel: 'GST' },
  { code: 'KE', name: 'Kenya', currencies: ['KES', 'USD'], taxRate: 16, taxLabel: 'VAT' },
  { code: 'AE', name: 'United Arab Emirates', currencies: ['AED', 'USD'], taxRate: 5, taxLabel: 'VAT' },
]

const priced = (over: Partial<PriceRow> & { currency: string }): PriceRow =>
  ({ price: '100', floor: '', list: '', ...over })

const comp = (over: Partial<BundleComponent> = {}): BundleComponent =>
  ({ product_id: 'SKU-5003', name: 'Cold-chain sensor', quantity: 1, unit_price: 8400, ...over })

const RULES: BundleRules = { min_components: 2, max_components: 6, max_discount: 40 }

describe('how often it bills', () => {
  it('offers the four periods and knows how many months each is', () => {
    expect(BILLING_PERIODS.map(p => p.id)).toEqual(['monthly', 'quarterly', 'half-yearly', 'yearly'])
    expect(BILLING_PERIODS.map(p => p.months)).toEqual([1, 3, 6, 12])
  })

  it('converts to a monthly figure so two periods can be compared', () => {
    /* The reason `months` is on the record at all: ₹12,000 a year and ₹1,200 a
       month are not the same commitment and a screen totalling them has to
       know which. */
    expect(monthlyEquivalent(12000, 'yearly')).toBe(1000)
    expect(monthlyEquivalent(3600, 'quarterly')).toBe(1200)
    expect(monthlyEquivalent(1200, 'monthly')).toBe(1200)
    expect(monthlyEquivalent(600, 'half-yearly')).toBe(100)
  })

  it('gives each period a suffix, so a price is never bare', () => {
    expect(periodOf('yearly')?.suffix).toBe('/yr')
    expect(periodOf('quarterly')?.suffix).toBe('/qtr')
    expect(periodOf('nonsense')).toBeNull()
  })

  it('makes only a subscription recurring', () => {
    expect(modelFor('subscription')).toBe('monthly')
    expect(modelFor('single')).toBe('oneoff')
    expect(modelFor('bundle')).toBe('oneoff')
  })
})

describe('where it is sold, and therefore what it is priced in', () => {
  it('takes the union of the markets currencies, not the intersection', () => {
    /* Sold in India and the UAE needs rupees AND dirhams — a buyer in each is
       quoted in their own market's money and neither is converted. */
    expect(currenciesFor(['IN', 'AE'], MARKETS)).toEqual(['INR', 'AED', 'USD'])
  })

  it('lists a shared currency once', () => {
    expect(currenciesFor(['KE', 'AE'], MARKETS)).toEqual(['KES', 'USD', 'AED'])
  })

  it('is nothing when nowhere is chosen', () => {
    expect(currenciesFor([], MARKETS)).toEqual([])
  })

  it('ignores a market the seller does not hold rather than inventing its currency', () => {
    expect(currenciesFor(['IN', 'GB'], MARKETS)).toEqual(['INR'])
  })

  it('refuses a listing sold nowhere', () => {
    const r = validateMarkets([], MARKETS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/cannot be bought anywhere/)
  })

  it('refuses a market the seller is not approved for, naming it', () => {
    const r = validateMarkets(['IN', 'GB'], MARKETS)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('GB')
  })
})

describe('the tax each market charges', () => {
  const rows = [
    priced({ currency: 'INR', price: '11800' }),
    priced({ currency: 'AED', price: '105' }),
    priced({ currency: 'USD', price: '100' }),
  ]

  it('uses each market\'s own rate and its own name for it', () => {
    /* The whole point: one listing, three markets, three different taxes. The
       wizard used to ask a seller to type one number, defaulted to 18. */
    const out = taxPerMarket(['IN', 'KE', 'AE'], MARKETS, rows, true)
    expect(out.map(r => `${r.label} ${r.rate}%`)).toEqual(['GST 18%', 'VAT 16%', 'VAT 5%'])
  })

  it('splits the price of the market\'s own currency, not a shared one', () => {
    /* India is quoted in rupees and the UAE in dirhams — splitting both from
       one figure is the mistake the per-currency table exists to prevent. */
    const out = taxPerMarket(['IN', 'AE'], MARKETS, rows, true)
    expect(out[0].currency).toBe('INR')
    expect(out[1].currency).toBe('AED')
    expect(out[0].gross).toBe(11800)
    expect(out[1].gross).toBe(105)
  })

  it('works out tax from an inclusive price', () => {
    const [india] = taxPerMarket(['IN'], MARKETS, rows, true)
    expect(india.gross).toBe(11800)
    expect(india.net).toBe(10000)
    expect(india.tax).toBe(1800)
  })

  it('adds tax to an exclusive one', () => {
    const [india] = taxPerMarket(['IN'], MARKETS, [priced({ currency: 'INR', price: '10000' })], false)
    expect(india.net).toBe(10000)
    expect(india.gross).toBe(11800)
    expect(india.tax).toBe(1800)
  })

  it('says nothing about a market that is not chosen', () => {
    expect(taxPerMarket(['IN'], MARKETS, rows, true).map(r => r.code)).toEqual(['IN'])
    expect(taxPerMarket([], MARKETS, rows, true)).toEqual([])
  })

  it('is quiet rather than wrong when the price has not been typed yet', () => {
    const [india] = taxPerMarket(['IN'], MARKETS, [], true)
    expect(india.gross).toBe(0)
    expect(india.tax).toBe(0)
  })
})

describe('a price in every currency', () => {
  it('starts one row per currency', () => {
    expect(blankPrices(['INR', 'AED']).map(r => r.currency)).toEqual(['INR', 'AED'])
  })

  it('keeps what was typed when the markets change under it', () => {
    const was = [priced({ currency: 'INR', price: '7499' }), priced({ currency: 'KES', price: '10999' })]
    const now = reconcilePrices(was, ['INR', 'AED'])
    expect(now.map(r => r.currency)).toEqual(['INR', 'AED'])
    expect(now[0].price).toBe('7499')
    expect(now[1].price).toBe('')
  })

  it('insists on a figure in each', () => {
    const r = validatePrices([priced({ currency: 'INR' }), priced({ currency: 'AED', price: '' })])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('AED')
  })

  it('judges each currency band on its own terms, not by converting', () => {
    /* The rupee row is fine and the dirham one is not; a check that looked at
       only the first would pass this. */
    const r = validatePrices([
      priced({ currency: 'INR', price: '7499', floor: '5999', list: '7999' }),
      priced({ currency: 'AED', price: '84', floor: '90', list: '92' }),
    ])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('AED')
  })

  it('refuses a list price below the asking price, which would be a negative saving', () => {
    const r = validatePrices([priced({ currency: 'INR', price: '100', list: '80' })])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/negative/)
  })

  it('treats a blank floor and list as the price itself', () => {
    expect(validatePrices([priced({ currency: 'INR', price: '100' })]).ok).toBe(true)
  })

  it('says so when there is nothing to price yet', () => {
    const r = validatePrices([])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/choose where it is sold/)
  })
})

describe('what is in a bundle', () => {
  it('totals its parts by quantity', () => {
    expect(componentsTotal([comp({ quantity: 2 }), comp({ product_id: 'b', unit_price: 1200 })])).toBe(18000)
  })

  it('reports the saving against buying them separately', () => {
    expect(bundleSaving(9000, [comp({ quantity: 1, unit_price: 10000 })])).toBe(10)
    expect(bundleSaving(10000, [comp({ quantity: 1, unit_price: 10000 })])).toBe(0)
  })

  it('needs at least two things in it', () => {
    const r = validateBundle([comp()], 8000, RULES)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/at least 2/)
  })

  it('stops at the ceiling', () => {
    const many = Array.from({ length: 7 }, (_, i) => comp({ product_id: `p${i}` }))
    expect(validateBundle(many, 100, RULES).ok).toBe(false)
  })

  it('refuses a bundle dearer than its parts', () => {
    const r = validateBundle([comp(), comp({ product_id: 'b' })], 20000, RULES)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/more than its parts/)
  })

  it('refuses a discount past the cap, which is usually a mistyped quantity', () => {
    const r = validateBundle([comp({ unit_price: 10000 }), comp({ product_id: 'b', unit_price: 10000 })], 1000, RULES)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/95% off|above the 40%/)
  })

  it('accepts a sensible one', () => {
    expect(validateBundle(
      [comp({ unit_price: 10000 }), comp({ product_id: 'b', unit_price: 10000 })], 16000, RULES,
    ).ok).toBe(true)
  })

  it('refuses a quantity below one', () => {
    expect(validateBundle([comp({ quantity: 0 }), comp({ product_id: 'b' })], 100, RULES).ok).toBe(false)
  })
})

describe('what the draft is still short of', () => {
  const base = {
    kind: 'single' as const, name: 'Nimbus sensor', markets: ['IN'],
    prices: [priced({ currency: 'INR', price: '7499' })],
    billingPeriod: null, components: [],
  }

  it('is nothing when a single product is complete', () => {
    expect(draftOutstanding(base)).toEqual([])
  })

  it('asks a subscription how often it bills', () => {
    expect(draftOutstanding({ ...base, kind: 'subscription' })).toEqual(['how often it bills'])
    expect(draftOutstanding({ ...base, kind: 'subscription', billingPeriod: 'yearly' })).toEqual([])
  })

  it('asks a bundle what is in it, and does not ask a single product', () => {
    expect(draftOutstanding({ ...base, kind: 'bundle' })).toEqual(['the listings this bundle is made of'])
    expect(draftOutstanding({ ...base, kind: 'bundle', components: [comp(), comp({ product_id: 'b' })] })).toEqual([])
  })

  it('names every unpriced currency', () => {
    const out = draftOutstanding({
      ...base, markets: ['IN', 'AE'],
      prices: [priced({ currency: 'INR', price: '7499' }), priced({ currency: 'AED', price: '' }), priced({ currency: 'USD', price: '' })],
    })
    expect(out).toEqual(['prices in AED, USD'])
  })

  it('asks for a market before anything else that depends on one', () => {
    const out = draftOutstanding({ ...base, markets: [], prices: [] })
    expect(out[0]).toBe('at least one market to sell it in')
  })
})
