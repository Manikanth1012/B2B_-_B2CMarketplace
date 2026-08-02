import { describe, it, expect } from 'vitest'
import { addableTo, canRemove, canMakeDefault, grid, tallyFor, outstanding, suspensionCost } from './marketAdmin'
import type { Market, MarketCurrency } from './money'
import type { PartnerMarket } from './marketPricing'

const MARKETS: Market[] = [
  { code: 'IN', name: 'India', currency: 'INR', tax_label: 'GST', tax_rate: 18, tax_note: '', is_default: true, sort_order: 1 },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', tax_label: 'VAT', tax_rate: 5, tax_note: '', is_default: false, sort_order: 2 },
  { code: 'KE', name: 'Kenya', currency: 'KES', tax_label: 'VAT', tax_rate: 16, tax_note: '', is_default: false, sort_order: 3 },
]

const ACCEPTED: MarketCurrency[] = [
  { market_code: 'IN', currency: 'INR', is_default: true, sort_order: 1 },
  { market_code: 'AE', currency: 'AED', is_default: true, sort_order: 1 },
  { market_code: 'AE', currency: 'USD', is_default: false, sort_order: 2 },
  { market_code: 'KE', currency: 'KES', is_default: true, sort_order: 1 },
  { market_code: 'KE', currency: 'USD', is_default: false, sort_order: 2 },
]

const ALL = [{ code: 'USD' }, { code: 'INR' }, { code: 'AED' }, { code: 'KES' }]
const CLEAR = { bills: 0, listings: 0 }

const grant = (p: string, m: string, state: PartnerMarket['state']): PartnerMarket =>
  ({ partner_id: p, market_code: m, state, approved_at: null, approved_by: null, note: '' })

const SELLERS = [{ id: 'PTR-1' }, { id: 'PTR-2' }, { id: 'PTR-3' }]
const GRANTS: PartnerMarket[] = [
  grant('PTR-1', 'IN', 'approved'),
  grant('PTR-1', 'KE', 'approved'),
  grant('PTR-2', 'IN', 'requested'),
  grant('PTR-3', 'AE', 'suspended'),
]

/* ---------------------------------------------------------- adding --- */

describe('which currencies a market could be given', () => {
  it('offers only the ones it does not already take', () => {
    expect(addableTo('KE', ACCEPTED, ALL).sort()).toEqual(['AED', 'INR'])
  })

  it('offers everything else to a single-currency market', () => {
    expect(addableTo('IN', ACCEPTED, ALL).sort()).toEqual(['AED', 'KES', 'USD'])
  })

  it('offers nothing when a market takes them all', () => {
    const everything: MarketCurrency[] = ALL.map((c, i) =>
      ({ market_code: 'IN', currency: c.code, is_default: i === 0, sort_order: i + 1 }))
    expect(addableTo('IN', everything, ALL)).toEqual([])
  })
})

/* -------------------------------------------------------- removing --- */

describe('whether a currency can come off a market', () => {
  it('allows a second currency nothing depends on', () => {
    expect(canRemove('KE', 'USD', ACCEPTED, CLEAR)).toEqual({ ok: true, warning: undefined })
  })

  it('will not leave a market with nothing to trade in', () => {
    const check = canRemove('IN', 'INR', ACCEPTED, CLEAR)
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/at least one currency/i)
  })

  /* The rule the guard states as an exception, stated here as a sentence. */
  it('will not orphan bills already raised in it', () => {
    const check = canRemove('KE', 'USD', ACCEPTED, { bills: 3, listings: 0 })
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/3 bills have already been raised in USD/i)
  })

  it('counts one bill as one bill, not "1 bills"', () => {
    expect(canRemove('KE', 'USD', ACCEPTED, { bills: 1, listings: 0 }).reason)
      .toMatch(/1 bill has already been raised/i)
  })

  it('refuses the default, and says what to do instead', () => {
    const check = canRemove('KE', 'KES', ACCEPTED, CLEAR)
    expect(check.ok).toBe(false)
    expect(check.reason).toMatch(/make another currency the default first/i)
  })

  it('refuses a currency the market never took', () => {
    expect(canRemove('IN', 'USD', ACCEPTED, CLEAR).ok).toBe(false)
  })

  /* A warning is not a refusal — the difference is the whole point of having
     two fields, because withdrawing a price is a thing an operator may mean. */
  it('warns about priced listings without refusing', () => {
    const check = canRemove('KE', 'USD', ACCEPTED, { bills: 0, listings: 12 })
    expect(check.ok).toBe(true)
    expect(check.warning).toMatch(/12 listings are priced in USD/i)
  })

  /* The market keeps its default currency, so nothing leaves the shelf — only
     the option of paying in this one does. Saying otherwise would tell an
     operator they were about to delist a catalogue they were not. */
  it('does not claim the listings come off the shelf', () => {
    const check = canRemove('KE', 'USD', ACCEPTED, { bills: 0, listings: 12 })
    expect(check.warning).not.toMatch(/stop being on sale|come off the shelf/i)
    expect(check.warning).toMatch(/no longer be able to pay in it/i)
  })

  it('says nothing about listings when there are none', () => {
    expect(canRemove('KE', 'USD', ACCEPTED, CLEAR).warning).toBeUndefined()
  })
})

describe('making a currency the default', () => {
  it('allows a second currency the market takes', () => {
    expect(canMakeDefault('KE', 'USD', ACCEPTED)).toEqual({ ok: true })
  })

  it('refuses the one that already is', () => {
    expect(canMakeDefault('KE', 'KES', ACCEPTED).reason).toMatch(/already the default/i)
  })

  it('refuses one the market does not take', () => {
    expect(canMakeDefault('IN', 'USD', ACCEPTED).ok).toBe(false)
  })
})

/* --------------------------------------------------- who sells where --- */

describe('the seller-by-market grid', () => {
  const cells = grid(SELLERS, MARKETS, GRANTS)

  it('has a cell for every pair, including the ones nobody asked about', () => {
    expect(cells).toHaveLength(SELLERS.length * MARKETS.length)
  })

  it('calls an absent grant "none" rather than leaving it undefined', () => {
    expect(cells.find(c => c.partner_id === 'PTR-3' && c.market_code === 'KE')?.state).toBe('none')
  })

  it('carries each grant\'s own state through', () => {
    expect(cells.find(c => c.partner_id === 'PTR-1' && c.market_code === 'IN')?.state).toBe('approved')
    expect(cells.find(c => c.partner_id === 'PTR-2' && c.market_code === 'IN')?.state).toBe('requested')
    expect(cells.find(c => c.partner_id === 'PTR-3' && c.market_code === 'AE')?.state).toBe('suspended')
  })

  it('tallies a market without counting another market\'s sellers', () => {
    expect(tallyFor('IN', cells)).toEqual({ approved: 1, requested: 1, suspended: 0, none: 1 })
    expect(tallyFor('AE', cells)).toEqual({ approved: 0, requested: 0, suspended: 1, none: 2 })
    expect(tallyFor('KE', cells)).toEqual({ approved: 1, requested: 0, suspended: 0, none: 2 })
  })

  it('adds up to every seller, in every market', () => {
    for (const m of MARKETS) {
      const t = tallyFor(m.code, cells)
      expect(t.approved + t.requested + t.suspended + t.none).toBe(SELLERS.length)
    }
  })

  it('lists only the requests, because those are the only ones waiting on anybody', () => {
    expect(outstanding(cells).map(c => `${c.partner_id}/${c.market_code}`)).toEqual(['PTR-2/IN'])
  })

  it('finds nothing outstanding when nothing is', () => {
    expect(outstanding(grid(SELLERS, MARKETS, [grant('PTR-1', 'IN', 'approved')]))).toEqual([])
  })
})

describe('what suspending costs', () => {
  it('names the listings that come off the shelf', () => {
    expect(suspensionCost(MARKETS[2], 4)).toBe('4 listings will come off the shelf in Kenya.')
  })

  it('reads as one listing when there is one', () => {
    expect(suspensionCost(MARKETS[2], 1)).toBe('1 listing will come off the shelf in Kenya.')
  })

  it('says nothing when nothing is priced there', () => {
    expect(suspensionCost(MARKETS[2], 0)).toBeNull()
  })
})
