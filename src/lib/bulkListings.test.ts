/* Reading a catalogue feed. The button that promised this was a toast, so a
   seller with forty SKUs had the wizard forty times. */
import { describe, it, expect } from 'vitest'
import {
  parseFeed, feedTemplate, feedColumns, splitCsvLine, homePrice, feedSummary,
  toSubmission, FEED_FIXED,
} from './bulkListings'
import type { MarketOption } from './listingDraft'

const MARKETS: MarketOption[] = [
  { code: 'IN', name: 'India', currencies: ['INR'], taxRate: 18, taxLabel: 'GST' },
  { code: 'AE', name: 'United Arab Emirates', currencies: ['AED', 'USD'], taxRate: 5, taxLabel: 'VAT' },
]
const CATEGORIES = [{ id: 'iot', name: 'IoT' }, { id: 'device', name: 'Devices' }]
const opts = { markets: MARKETS, categories: CATEGORIES }

const HEAD = 'kind,name,description,category,sub_category,fulfil,markets,billing_period,cost,tags,price_INR,floor_INR,list_INR,price_AED,floor_AED,list_AED,price_USD,floor_USD,list_USD'
const row = (over: Partial<Record<string, string>> = {}) => {
  const base: Record<string, string> = {
    kind: 'single', name: 'Nimbus soil probe', description: 'Buried moisture probe.',
    category: 'iot', sub_category: 'Sensors', fulfil: 'shipped', markets: 'IN|AE',
    billing_period: '', cost: '3000', tags: 'iot|agri',
    price_INR: '7499', floor_INR: '5999', list_INR: '7999',
    price_AED: '299', floor_AED: '249', list_AED: '319',
    price_USD: '84', floor_USD: '70', list_USD: '90', ...over,
  }
  return HEAD.split(',').map(h => base[h] ?? '').join(',')
}
const feed = (...rows: string[]) => parseFeed([HEAD, ...rows].join('\n'), opts)

describe('splitting a line', () => {
  it('keeps a comma inside a quoted description', () => {
    /* Losing half a description is not a formatting quibble — it is the
       sentence a buyer reads before they buy. */
    expect(splitCsvLine('a,"one, two",b', ',')).toEqual(['a', 'one, two', 'b'])
  })

  it('unescapes a doubled quote', () => {
    expect(splitCsvLine('a,"6"" screen",b', ',')).toEqual(['a', '6" screen', 'b'])
  })
})

describe('the template', () => {
  it('names a price column per currency the seller trades in', () => {
    expect(feedColumns(['INR', 'AED'])).toEqual([
      ...FEED_FIXED, 'price_INR', 'floor_INR', 'list_INR', 'price_AED', 'floor_AED', 'list_AED',
    ])
  })

  it('ships a worked example rather than an empty header', () => {
    /* An empty header row is a file somebody has to guess the format of. */
    const t = feedTemplate(MARKETS, CATEGORIES)
    expect(t).toHaveLength(2)
    expect(t[1][t[0].indexOf('category')]).toBe('iot')
    expect(t[1][t[0].indexOf('markets')]).toBe('IN|AE')
  })
})

describe('reading a feed', () => {
  it('takes a good row', () => {
    const f = feed(row())
    expect(f.problems).toEqual([])
    expect(f.rows).toHaveLength(1)
    expect(f.rows[0].name).toBe('Nimbus soil probe')
    expect(f.rows[0].markets).toEqual(['IN', 'AE'])
    expect(f.rows[0].prices.map(p => p.currency)).toEqual(['INR', 'AED', 'USD'])
  })

  it('imports the good rows and refuses the bad one, naming the line', () => {
    /* Refusing the whole file for one typo means re-uploading forty listings
       and getting duplicates of the thirty-nine that worked. */
    const f = feed(row(), row({ name: 'Broken', price_INR: '' }), row({ name: 'Third' }))
    expect(f.rows.map(r => r.name)).toEqual(['Nimbus soil probe', 'Third'])
    expect(f.problems).toHaveLength(1)
    expect(f.problems[0].line).toBe(3)
    expect(f.problems[0].name).toBe('Broken')
    expect(f.problems[0].reason).toContain('INR')
  })

  it('refuses a row with no name', () => {
    expect(feed(row({ name: '' })).problems[0].reason).toMatch(/No name/)
  })

  it('refuses the same name twice in one file', () => {
    const f = feed(row(), row())
    expect(f.rows).toHaveLength(1)
    expect(f.problems[0].reason).toMatch(/appears twice/)
  })

  it('refuses a marketplace the seller is not approved for, naming it', () => {
    const f = feed(row({ markets: 'IN|GB' }))
    expect(f.rows).toEqual([])
    expect(f.problems[0].reason).toContain('GB')
  })

  it('refuses a category that is not a marketplace here', () => {
    expect(feed(row({ category: 'groceries' })).problems[0].reason).toContain('groceries')
  })

  it('makes a subscription say how often it bills', () => {
    expect(feed(row({ kind: 'subscription' })).problems[0].reason).toMatch(/how often it bills/)
    expect(feed(row({ kind: 'subscription', billing_period: 'quarterly' })).rows).toHaveLength(1)
  })

  it('refuses a billing period on something bought once', () => {
    const f = feed(row({ billing_period: 'monthly' }))
    expect(f.problems[0].reason).toMatch(/bought once/)
  })

  it('sends a bundle to the wizard rather than importing an empty one', () => {
    /* A bundle is made of other listings, and a spreadsheet cell is not where
       somebody picks them. */
    expect(feed(row({ kind: 'bundle' })).problems[0].reason).toMatch(/New listing/)
  })

  it('only asks for the currencies the row own markets take', () => {
    const f = feed(row({ markets: 'IN', price_AED: '', price_USD: '' }))
    expect(f.problems).toEqual([])
    expect(f.rows[0].prices.map(p => p.currency)).toEqual(['INR'])
  })

  it('defaults to every approved market when the column is blank', () => {
    expect(feed(row({ markets: '' })).rows[0].markets).toEqual(['IN', 'AE'])
  })

  it('judges each currency band on its own terms', () => {
    const f = feed(row({ floor_AED: '400' }))
    expect(f.rows).toEqual([])
    expect(f.problems[0].reason).toContain('AED')
  })

  it('handles a semicolon file with quoted commas', () => {
    const head = HEAD.replace(/,/g, ';')
    const body = row().replace('Buried moisture probe.', 'Buried, and waterproof.')
    const semi = body.replace(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/g, ';')
      .replace('Buried; and waterproof.', '"Buried, and waterproof."')
    const f = parseFeed([head, semi].join('\n'), opts)
    expect(f.rows).toHaveLength(1)
  })

  it('says so about an empty file and about a header with nothing under it', () => {
    expect(parseFeed('  ', opts).problems[0].reason).toMatch(/empty/)
    expect(parseFeed(HEAD, opts).problems[0].reason).toMatch(/nothing under it/)
  })

  it('refuses a file whose first row is not a header', () => {
    expect(parseFeed(row(), opts).problems[0].reason).toMatch(/name the columns/)
  })
})

describe('turning a row into a submission', () => {
  it('prices it in the first market own money, not whichever came first in the file', () => {
    const r = feed(row({ markets: 'AE|IN' })).rows[0]
    expect(homePrice(r, MARKETS).currency).toBe('AED')
    expect(homePrice(r, MARKETS).price).toBe(299)
  })

  it('falls back to the price when floor and list are blank', () => {
    const r = feed(row({ markets: 'IN', floor_INR: '', list_INR: '' })).rows[0]
    const h = homePrice(r, MARKETS)
    expect(h.floor).toBe(7499)
    expect(h.list).toBe(7499)
  })

  it('takes the tax rate from the market rather than from the file', () => {
    /* A seller typing their own rate into a spreadsheet is how one listing ends
       up at 18% in Nairobi. */
    expect(toSubmission(feed(row({ markets: 'AE' })).rows[0], 'PTR-1004', MARKETS).taxRate).toBe(5)
    expect(toSubmission(feed(row({ markets: 'IN' })).rows[0], 'PTR-1004', MARKETS).taxRate).toBe(18)
  })

  it('makes only a subscription recurring', () => {
    const sub = feed(row({ kind: 'subscription', billing_period: 'yearly' })).rows[0]
    expect(toSubmission(sub, 'PTR-1004', MARKETS).model).toBe('monthly')
    expect(toSubmission(feed(row()).rows[0], 'PTR-1004', MARKETS).model).toBe('oneoff')
  })

  it('carries every currency through, not just the home one', () => {
    const s = toSubmission(feed(row()).rows[0], 'PTR-1004', MARKETS)
    expect(s.prices.map(p => p.currency)).toEqual(['INR', 'AED', 'USD'])
    expect(s.prices[1].price).toBe(299)
  })
})

describe('what the import would do', () => {
  it('counts by kind and names the markets', () => {
    const f = feed(row(), row({ name: 'Two', kind: 'subscription', billing_period: 'monthly' }))
    const s = feedSummary(f)
    expect(s).toContain('1 single')
    expect(s).toContain('1 subscription')
    expect(s).toContain('AE, IN')
  })

  it('is honest when nothing would go', () => {
    expect(feedSummary({ rows: [], problems: [] })).toBe('Nothing would be submitted.')
  })
})
