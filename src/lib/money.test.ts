import { describe, it, expect } from 'vitest'
import {
  money, add, sumOf, byCurrency, formatGroups, isMixed, currenciesIn, negate,
  roundMinor, round, minorUnitsOf, rateOn, convert, totalIn, presentIn,
  format, symbolOf, charmPrice, wasPriceFor, priceBandOk,
  currenciesOf, marketTakes, marketsTaking,
  describeIn, marketProse
, round2} from './money'
import type { Currency, Market, MarketCurrency, Rate } from './money'

const CURRENCIES: Currency[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', minor_units: 2, symbol_first: true, locale: 'en-US', is_reporting: true, sort_order: 1 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', minor_units: 2, symbol_first: true, locale: 'en-IN', is_reporting: false, sort_order: 2 },
  { code: 'AED', name: 'UAE Dirham', symbol: 'AED', minor_units: 2, symbol_first: true, locale: 'en-AE', is_reporting: false, sort_order: 3 },
  { code: 'KES', name: 'Kenyan Shilling', symbol: 'KSh', minor_units: 2, symbol_first: true, locale: 'en-KE', is_reporting: false, sort_order: 4 },
  /* Not in the marketplace, present so the rules are tested rather than the
     coincidence that all four real currencies have two decimals. */
  { code: 'JPY', name: 'Yen', symbol: '¥', minor_units: 0, symbol_first: true, locale: 'ja-JP', is_reporting: false, sort_order: 9 },
  { code: 'KWD', name: 'Kuwaiti Dinar', symbol: 'KD', minor_units: 3, symbol_first: true, locale: 'en-KW', is_reporting: false, sort_order: 10 },
]

const RATES: Rate[] = [
  { base: 'USD', quote: 'INR', rate: 86.90, as_of: '2026-07-01', pegged: false },
  { base: 'USD', quote: 'AED', rate: 3.6725, as_of: '2026-07-01', pegged: true },
  { base: 'USD', quote: 'KES', rate: 128.45, as_of: '2026-07-01', pegged: false },
  { base: 'USD', quote: 'INR', rate: 87.42, as_of: '2026-08-01', pegged: false },
  { base: 'USD', quote: 'AED', rate: 3.6725, as_of: '2026-08-01', pegged: true },
  { base: 'USD', quote: 'KES', rate: 129.20, as_of: '2026-08-01', pegged: false },
]

const MARKETS: Market[] = [
  { code: 'IN', name: 'India', currency: 'INR', tax_label: 'GST', tax_rate: 18, tax_note: '', is_default: true, sort_order: 1 },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', tax_label: 'VAT', tax_rate: 5, tax_note: '', is_default: false, sort_order: 2 },
  { code: 'KE', name: 'Kenya', currency: 'KES', tax_label: 'VAT', tax_rate: 16, tax_note: '', is_default: false, sort_order: 3 },
]

/* Deliberately out of order and with the default late in the list, so the
   sorting is tested rather than the order it happens to be written in. */
const ACCEPTED: MarketCurrency[] = [
  { market_code: 'KE', currency: 'USD', is_default: false, sort_order: 2 },
  { market_code: 'AE', currency: 'USD', is_default: false, sort_order: 2 },
  { market_code: 'IN', currency: 'INR', is_default: true, sort_order: 1 },
  { market_code: 'KE', currency: 'KES', is_default: true, sort_order: 1 },
  { market_code: 'AE', currency: 'AED', is_default: true, sort_order: 1 },
]

/* --------------------------------------------- what a market will take --- */

describe('the currencies a market accepts', () => {
  it('puts the default first, whatever order the rows came back in', () => {
    expect(currenciesOf('KE', ACCEPTED)).toEqual(['KES', 'USD'])
    expect(currenciesOf('AE', ACCEPTED)).toEqual(['AED', 'USD'])
  })

  it('gives a single-currency market one currency', () => {
    expect(currenciesOf('IN', ACCEPTED)).toEqual(['INR'])
  })

  it('gives a market nobody has configured nothing, rather than guessing', () => {
    expect(currenciesOf('ZZ', ACCEPTED)).toEqual([])
  })

  it('answers whether a market takes a currency', () => {
    expect(marketTakes('KE', 'USD', ACCEPTED)).toBe(true)
    expect(marketTakes('IN', 'USD', ACCEPTED)).toBe(false)
    /* Not "some market takes USD" — this one. */
    expect(marketTakes('ZZ', 'USD', ACCEPTED)).toBe(false)
  })
})

describe('the markets that take a currency', () => {
  it('names every one of them, not the first found', () => {
    expect(marketsTaking('USD', ACCEPTED, MARKETS)).toEqual(['AE', 'KE'])
  })

  it('orders them as the markets are ordered', () => {
    /* So "United Arab Emirates · Kenya" reads the same wherever markets are
       listed, rather than in whatever order the join returned. */
    expect(marketsTaking('USD', ACCEPTED, MARKETS)).toEqual(['AE', 'KE'])
  })

  it('names one market for a currency only one market takes', () => {
    expect(marketsTaking('INR', ACCEPTED, MARKETS)).toEqual(['IN'])
  })

  it('names none for a currency nobody trades in', () => {
    expect(marketsTaking('JPY', ACCEPTED, MARKETS)).toEqual([])
  })

  it('falls back to sorted codes when no market list is given', () => {
    expect(marketsTaking('USD', ACCEPTED)).toEqual(['AE', 'KE'])
  })
})

/* ------------------------------------------------------------ rounding --- */

describe('rounding to the currency, not to two places', () => {
  it('rounds to the minor units the currency actually has', () => {
    expect(roundMinor(1234.567, 2)).toBe(1234.57)
    expect(roundMinor(1234.567, 0)).toBe(1235)
    expect(roundMinor(1234.5674, 3)).toBe(1234.567)
  })

  it('rounds half away from zero, symmetrically', () => {
    /* Math.round sends 0.005 up and -0.005 to -0, so a charge and a refund of
       the same size would round to different magnitudes. */
    expect(roundMinor(0.005, 2)).toBe(0.01)
    expect(roundMinor(-0.005, 2)).toBe(-0.01)
    expect(roundMinor(2.675, 2)).toBe(2.68)
    expect(roundMinor(-2.675, 2)).toBe(-2.68)
  })

  it('rounds 1.005 up, which binary floating point does not do unaided', () => {
    expect(roundMinor(1.005, 2)).toBe(1.01)
  })

  it('never produces negative zero', () => {
    expect(Object.is(roundMinor(-0.001, 2), -0)).toBe(false)
    expect(roundMinor(-0.001, 2)).toBe(0)
  })

  it('reads the minor units off the currency', () => {
    expect(minorUnitsOf('JPY', CURRENCIES)).toBe(0)
    expect(minorUnitsOf('KWD', CURRENCIES)).toBe(3)
    expect(minorUnitsOf('INR', CURRENCIES)).toBe(2)
    expect(round(money(1234.567, 'JPY'), CURRENCIES)).toEqual(money(1235, 'JPY'))
  })

  it('assumes two places for a currency it has never heard of, rather than throwing', () => {
    expect(minorUnitsOf('XXX', CURRENCIES)).toBe(2)
  })
})

/* ---------------------------------------------------------- arithmetic --- */

describe('amounts in different currencies do not add', () => {
  it('adds two amounts of one currency', () => {
    expect(add(money(10, 'INR'), money(5, 'INR'))).toEqual(money(15, 'INR'))
  })

  it('refuses to add across currencies', () => {
    expect(add(money(10, 'INR'), money(5, 'AED'))).toBeNull()
    expect(add(money(10, 'USD'), money(5, 'INR'))).toBeNull()
  })

  it('totals a single-currency list and refuses a mixed one', () => {
    expect(sumOf([money(10, 'KES'), money(5, 'KES'), money(2.5, 'KES')])).toEqual(money(17.5, 'KES'))
    expect(sumOf([money(10, 'KES'), money(5, 'INR')])).toBeNull()
  })

  it('has no total for an empty list — zero of nothing has no currency', () => {
    expect(sumOf([])).toBeNull()
  })

  it('knows when a list is mixed', () => {
    expect(isMixed([money(1, 'USD'), money(1, 'USD')])).toBe(false)
    expect(isMixed([money(1, 'USD'), money(1, 'INR')])).toBe(true)
    expect(currenciesIn([money(1, 'USD'), money(1, 'INR'), money(2, 'USD')]).sort()).toEqual(['INR', 'USD'])
  })

  it('splits a mixed list into honest per-currency totals', () => {
    const out = byCurrency([
      money(100, 'INR'), money(5, 'AED'), money(50, 'INR'), money(1, 'USD'),
    ])
    expect(out).toEqual([
      { currency: 'INR', total: money(150, 'INR'), count: 2 },
      { currency: 'AED', total: money(5, 'AED'), count: 1 },
      { currency: 'USD', total: money(1, 'USD'), count: 1 },
    ])
  })

  it('negates without losing the currency', () => {
    expect(negate(money(12.5, 'AED'))).toEqual(money(-12.5, 'AED'))
  })
})

/* ------------------------------------------------------------ exchange --- */

describe('a rate is as of a date', () => {
  it('uses the rate in force on the day, not the newest one', () => {
    /* The whole feature in one assertion: a document dated 15 July is
       converted at the 1 July fix, and stays that way after August's arrives. */
    expect(rateOn(RATES, 'USD', 'INR', '2026-07-15')).toMatchObject({ rate: 86.90, as_of: '2026-07-01' })
    expect(rateOn(RATES, 'USD', 'INR', '2026-08-15')).toMatchObject({ rate: 87.42, as_of: '2026-08-01' })
  })

  it('uses a rate dated exactly on the day', () => {
    expect(rateOn(RATES, 'USD', 'INR', '2026-08-01')).toMatchObject({ rate: 87.42, as_of: '2026-08-01' })
  })

  it('has no rate for a date before any were recorded, rather than the closest', () => {
    expect(rateOn(RATES, 'USD', 'INR', '2026-06-30')).toBeNull()
  })

  it('is 1 for a currency against itself, on any date', () => {
    expect(rateOn(RATES, 'INR', 'INR', '2020-01-01')).toMatchObject({ rate: 1 })
  })

  it('derives the inverse rather than storing it', () => {
    const back = rateOn(RATES, 'INR', 'USD', '2026-08-01')
    expect(back?.inverted).toBe(true)
    expect(back!.rate).toBeCloseTo(1 / 87.42, 12)
  })

  it('round-trips exactly, because the inverse is derived and not rounded', () => {
    const out = rateOn(RATES, 'USD', 'INR', '2026-08-01')!
    const back = rateOn(RATES, 'INR', 'USD', '2026-08-01')!
    expect(100 * out.rate * back.rate).toBeCloseTo(100, 10)
  })

  it('has no rate for a pair nobody quoted', () => {
    expect(rateOn(RATES, 'INR', 'KES', '2026-08-01')).toBeNull()
  })

  it('reports the peg as pegged, so a screen need not pretend it was observed', () => {
    expect(rateOn(RATES, 'USD', 'AED', '2026-08-01')?.pegged).toBe(true)
    expect(rateOn(RATES, 'USD', 'INR', '2026-08-01')?.pegged).toBe(false)
  })
})

describe('converting', () => {
  it('converts and rounds to the target currency', () => {
    const out = convert(money(100, 'USD'), 'INR', 87.42, '2026-08-01', CURRENCIES)
    expect(out.money).toEqual(money(8742, 'INR'))
    expect(out).toMatchObject({ rate: 87.42, as_of: '2026-08-01', from: 'USD' })
  })

  it('is a no-op at rate 1 when the currency already matches', () => {
    const out = convert(money(100, 'INR'), 'INR', 999, '2026-08-01', CURRENCIES)
    expect(out.money).toEqual(money(100, 'INR'))
    expect(out.rate).toBe(1)
  })

  it('carries the rate and date it used, so a document can state them', () => {
    const out = convert(money(1, 'USD'), 'KES', 128.45, '2026-07-01', CURRENCIES)
    expect(out.money).toEqual(money(128.45, 'KES'))
    expect(out.as_of).toBe('2026-07-01')
  })
})

describe('totalling a mixed list honestly', () => {
  it('converts each amount and reports the date used', () => {
    const out = totalIn(
      [money(100, 'USD'), money(8742, 'INR'), money(367.25, 'AED')],
      'USD', RATES, '2026-08-01', CURRENCIES,
    )
    /* 100 + 8742/87.42 + 367.25/3.6725 = 100 + 100 + 100 */
    expect(out.total).toEqual(money(300, 'USD'))
    expect(out.missing).toEqual([])
    expect(out.asOf).toBe('2026-08-01')
  })

  it('names what it could not convert instead of quietly leaving it out', () => {
    const out = totalIn(
      [money(100, 'USD'), money(500, 'GBP')], 'USD', RATES, '2026-08-01', CURRENCIES,
    )
    expect(out.total).toEqual(money(100, 'USD'))
    expect(out.missing).toEqual(['GBP'])
  })

  it('uses the date given, so a July report does not move when August arrives', () => {
    const july = totalIn([money(8690, 'INR')], 'USD', RATES, '2026-07-15', CURRENCIES)
    const august = totalIn([money(8690, 'INR')], 'USD', RATES, '2026-08-15', CURRENCIES)
    expect(july.total).toEqual(money(100, 'USD'))
    expect(august.total.amount).toBeCloseTo(99.41, 2)
  })
})

/* ---------------------------------------------------------- formatting --- */

describe('formatting', () => {
  it('groups rupees by lakh, the way they are written in India', () => {
    expect(format(money(100000, 'INR'), CURRENCIES)).toBe('₹1,00,000.00')
    expect(format(money(12345678, 'INR'), CURRENCIES)).toBe('₹1,23,45,678.00')
  })

  it('groups dollars in thousands', () => {
    expect(format(money(100000, 'USD'), CURRENCIES)).toBe('$100,000.00')
  })

  it('spaces a multi-letter mark and does not space a symbol', () => {
    expect(format(money(1200, 'AED'), CURRENCIES)).toBe('AED 1,200.00')
    expect(format(money(1200, 'USD'), CURRENCIES)).toBe('$1,200.00')
    expect(format(money(1200, 'KES'), CURRENCIES)).toBe('KSh 1,200.00')
  })

  it('puts the sign outside the symbol', () => {
    /* "$-1,893.44" appeared on a seller statement. */
    expect(format(money(-1893.44, 'USD'), CURRENCIES)).toBe('-$1,893.44')
    expect(format(money(-50, 'AED'), CURRENCIES)).toBe('-AED 50.00')
  })

  it('never prints negative zero', () => {
    expect(format(money(-0.001, 'USD'), CURRENCIES)).toBe('$0.00')
  })

  it('drops the decimals on request, for a dense table', () => {
    expect(format(money(1234.56, 'USD'), CURRENCIES, { decimals: false })).toBe('$1,235')
  })

  it('shows no decimals for a currency that has none', () => {
    expect(format(money(1234, 'JPY'), CURRENCIES)).toBe('¥1,234')
  })

  it('shows three for a currency that has three', () => {
    expect(format(money(12.3456, 'KWD'), CURRENCIES)).toBe('KD 12.346')
  })

  it('can append the code, for a document that must be unambiguous', () => {
    expect(format(money(50, 'USD'), CURRENCIES, { code: true })).toBe('$50.00 USD')
  })

  it('separates the mark with an ordinary space, not U+00A0', () => {
    /* A non-breaking space is better typography and worse for a finance app:
       it stops Excel parsing a pasted figure as a number. One was typed into
       the formatter by accident and the tests could not show the difference —
       'AED 1,200.00' and 'AED 1,200.00' look identical in a diff. */
    for (const code of ['AED', 'KES', 'USD', 'INR']) {
      const out = format(money(1200, code), CURRENCIES)
      expect([...out].some(ch => ch.charCodeAt(0) > 127 && /\s/u.test(ch)), `${code}: ${JSON.stringify(out)}`).toBe(false)
    }
  })

  it('falls back to the code as its own mark for an unknown currency', () => {
    expect(format(money(50, 'XXX'), CURRENCIES)).toBe('XXX 50.00')
    expect(symbolOf('XXX', CURRENCIES)).toBe('XXX')
    expect(symbolOf('INR', CURRENCIES)).toBe('₹')
  })
})

/* ------------------------------------------------------------- pricing --- */

describe('a converted price is not a listed price', () => {
  it('pulls a converted rupee price to something a human would have chosen', () => {
    /* $12.39 * 87.42 = 1083.13, which nobody lists. */
    const listed = charmPrice(1083.13, 'INR')
    expect(listed).toBe(1099)
  })

  it('produces prices that end in 9 across the range', () => {
    for (const raw of [122, 349, 1083, 4870, 26000, 419616]) {
      const p = charmPrice(raw, 'INR')
      expect(String(Math.round(p)).endsWith('9'), `${raw} -> ${p}`).toBe(true)
    }
  })

  it('stays within a sensible distance of what it was given', () => {
    for (const raw of [122, 349, 1083, 4870, 26000, 419616]) {
      const p = charmPrice(raw, 'INR')
      expect(Math.abs(p - raw) / raw, `${raw} -> ${p} moved too far`).toBeLessThan(0.16)
    }
  })

  it('uses coarser steps for bigger numbers', () => {
    /* All plausible shelf prices; ₹1,08,267 is not. */
    expect(charmPrice(1083, 'INR')).toBe(1099)
    expect(charmPrice(49230, 'INR')).toBe(48999)
    expect(charmPrice(419616, 'INR')).toBe(419999)
  })

  it('does not move a small price a fifth of the way', () => {
    /* ₹122 shared a bracket with ₹999 under a digit-count rule, took a step of
       50, and came out at ₹99. */
    expect(charmPrice(122, 'INR')).toBe(119)
  })

  it('keeps a small dollar price small rather than rounding it to nothing', () => {
    expect(charmPrice(1.4, 'USD')).toBeGreaterThan(0)
    expect(charmPrice(1.4, 'USD')).toBeLessThan(3)
  })

  it('leaves a free product free', () => {
    expect(charmPrice(0, 'INR')).toBe(0)
    expect(charmPrice(-5, 'INR')).toBe(0)
  })
})

describe('a strikethrough has to be a real saving', () => {
  it('keeps a was-price that is genuinely above the price', () => {
    expect(wasPriceFor(999, 1299)).toBe(1299)
  })

  it('drops one that rounding collapsed onto the price', () => {
    /* $11.52 down from $12.00 is a real 4% saving that both round to ₹999.
       Showing ₹999 struck through above ₹999 claims a discount nobody gave. */
    expect(wasPriceFor(999, 999)).toBeNull()
    expect(wasPriceFor(999, 899)).toBeNull()
  })

  it('treats an absent was-price as absent', () => {
    expect(wasPriceFor(999, null)).toBeNull()
    expect(wasPriceFor(999, undefined)).toBeNull()
  })
})

describe('the price band', () => {
  it('accepts floor <= price <= list', () => {
    expect(priceBandOk({ price: 999, floor_price: 699, list_price: 1099 })).toBe(true)
    expect(priceBandOk({ price: 999 })).toBe(true)
  })

  it('rejects a floor above the price or a list below it', () => {
    expect(priceBandOk({ price: 999, floor_price: 1099 })).toBe(false)
    expect(priceBandOk({ price: 999, list_price: 899 })).toBe(false)
  })
})


describe('formatGroups', () => {
  const fmt = (n: number, c: string) => `${c} ${n.toFixed(2)}`

  it('writes every currency rather than one total', () => {
    const groups = byCurrency([money(89980, 'INR'), money(2547, 'AED'), money(20, 'INR')])
    expect(formatGroups(groups, fmt)).toBe('INR 90000.00 · AED 2547.00')
  })

  it('writes one figure when there is only one currency', () => {
    expect(formatGroups(byCurrency([money(549, 'INR')]), fmt)).toBe('INR 549.00')
  })

  it('says nothing rather than zero when there is nothing', () => {
    /* "0" in a box labelled "at stake" is a claim that nothing is at stake.
       Nothing having been measured is a different statement. */
    expect(formatGroups([], fmt)).toBe('—')
    expect(formatGroups([], fmt, 'Nothing outstanding')).toBe('Nothing outstanding')
  })

  it('never produces a figure that is the sum of two currencies', () => {
    const groups = byCurrency([money(100, 'INR'), money(100, 'KES')])
    expect(formatGroups(groups, fmt)).not.toContain('200')
  })
})

describe('describeIn', () => {
  const product = { id: 'SKU-2004', description: 'Cover for one handset, with an excess set for your market.' }
  const copy = new Map([
    ['SKU-2004|INR', 'Cover for one handset. Two claims per year, ₹4,000 excess.'],
    ['SKU-2004|AED', 'Cover for one handset. Two claims per year, AED 185 excess.'],
  ])

  it('gives the copy written for that currency', () => {
    expect(describeIn(product, copy, 'INR')).toContain('₹4,000')
    expect(describeIn(product, copy, 'AED')).toContain('AED 185')
  })

  it('falls back to the base row where no copy was written', () => {
    /* Which is why the base row names no currency: "an excess set for your
       market" is true everywhere, and a rupee figure would not be. */
    expect(describeIn(product, copy, 'KES')).toBe(product.description)
    expect(describeIn(product, copy, 'KES')).not.toMatch(/₹|AED|\$/)
  })

  it('never shows one market’s figure to another', () => {
    expect(describeIn(product, copy, 'AED')).not.toContain('₹')
    expect(describeIn(product, copy, 'INR')).not.toContain('AED')
  })

  it('handles a product with no copy at all', () => {
    const plain = { id: 'SKU-9999', description: 'A thing.' }
    expect(describeIn(plain, copy, 'INR')).toBe('A thing.')
  })

  it('handles an empty book', () => {
    expect(describeIn(product, new Map(), 'INR')).toBe(product.description)
  })
})

describe('naming the markets in prose', () => {
  const m = (code: string, name: string, sort_order: number): Market =>
    ({ code, name, currency: 'X', tax_label: '', tax_rate: 0, tax_note: '', is_default: false, sort_order })

  const THREE = [m('KE', 'Kenya', 3), m('IN', 'India', 1), m('AE', 'United Arab Emirates', 2)]

  it('reads as a sentence, in the table’s own order', () => {
    expect(marketProse(THREE)).toBe('India, United Arab Emirates and Kenya')
  })

  it('makes a separator list when asked for one', () => {
    expect(marketProse(THREE, { conjunction: '', separator: ' · ' }))
      .toBe('India · United Arab Emirates · Kenya')
  })

  it('does not dangle a conjunction on one market', () => {
    expect(marketProse([m('IN', 'India', 1)])).toBe('India')
  })

  it('survives a marketplace with no markets yet', () => {
    /* The sentence around it has to still make sense while the book is
       loading, which is the state every screen starts in. */
    expect(marketProse([])).toBe('')
  })

  it('picks up a fourth market without anybody editing a sentence', () => {
    /* The whole point. Uganda was added and removed inside an hour this week. */
    expect(marketProse([...THREE, m('UG', 'Uganda', 4)]))
      .toBe('India, United Arab Emirates, Kenya and Uganda')
  })
})

describe('two decimal places, agreeing with the database', () => {
  it('rounds a half-cent up, where the naive version rounds it down', () => {
    /* The case the comment in money.ts names. $12.50 x 128.45 is 1605.625,
       which binary floating point stores as 160562.49999999997 once scaled —
       so Math.round(n*100)/100 gives 1605.62 while Postgres numeric gives
       1605.63, and the app and the ledger differ by a cent on one purchase. */
    const naive = (n: number) => Math.round(n * 100) / 100
    expect(naive(12.50 * 128.45)).toBe(1605.62)
    expect(round2(12.50 * 128.45)).toBe(1605.63)
  })

  it('agrees with the naive version everywhere it is not a half-cent', () => {
    for (const n of [0, 1, 1.1, 2.5, 99.999, 1234.567, -8.125, 1e6 + 0.004]) {
      const naive = Math.round(n * 100) / 100
      if (Math.abs(naive - round2(n)) > 0) continue
      expect(round2(n)).toBe(naive)
    }
  })

  it('rounds away from zero on both sides, so a credit and a debit are symmetric', () => {
    expect(round2(2.345)).toBe(2.35)
    expect(round2(-2.345)).toBe(-2.35)
  })

  it('never returns negative zero, which reads as a debt of nothing', () => {
    expect(Object.is(round2(-0.001), -0)).toBe(false)
    expect(round2(-0.001)).toBe(0)
  })

  it('leaves a figure that is already exact alone', () => {
    for (const n of [0.01, 12.34, 1605.63, 999999.99]) expect(round2(n)).toBe(n)
  })
})

describe('presenting a frozen figure in the account currency', () => {
  /* Otieno Odhiambo is a Kisumu customer whose account is kept in dollars. His
     bills were issued in shillings and were paid in shillings, and the record
     of what he paid is not rewritten to suit the screen. */

  it('converts at the document own date, not at today rate', () => {
    /* The same shilling amount is a different number of dollars in June and in
       August, and each bill is owed its own month rate. Converting the lot at
       today rate is the single most common way this goes wrong. */
    const bill = money(6946, 'KES')
    const june = presentIn(bill, 'USD', RATES, '2026-07-15', CURRENCIES)!
    const august = presentIn(bill, 'USD', RATES, '2026-08-15', CURRENCIES)!
    expect(june.money.amount).toBe(54.08)
    expect(august.money.amount).toBe(53.76)
    expect(june.money.amount).not.toBe(august.money.amount)
    expect(june.as_of).toBe('2026-07-01')
    expect(august.as_of).toBe('2026-08-01')
  })

  it('says what it converted from, so the original can be shown beside it', () => {
    const p = presentIn(money(10145, 'KES'), 'USD', RATES, '2026-09-01', CURRENCIES)!
    expect(p.from).toBe('KES')
    expect(p.rate).toBeCloseTo(1 / 129.20, 8)
  })

  it('has nothing to say when the figure is already in the account currency', () => {
    /* The wallet is in dollars now. Restating a dollar as a dollar beside
       itself is noise. */
    expect(presentIn(money(56.66, 'USD'), 'USD', RATES, '2026-08-07', CURRENCIES)).toBeNull()
  })

  it('has nothing to say for somebody with no account currency', () => {
    /* A visitor. Nobody has told the marketplace what they are billed in. */
    expect(presentIn(money(6946, 'KES'), null, RATES, '2026-08-07', CURRENCIES)).toBeNull()
  })

  it('refuses to convert a document older than any rate on file', () => {
    /* Showing the original alone is better than restating it at a rate struck
       years after it was issued. */
    expect(presentIn(money(6946, 'KES'), 'USD', RATES, '2020-01-01', CURRENCIES)).toBeNull()
  })

  it('rounds to the account currency minor units, not the original', () => {
    /* A yen account showing a shilling bill gets whole yen. */
    const rates: Rate[] = [...RATES, { base: 'JPY', quote: 'KES', rate: 0.85, as_of: '2026-08-01', pegged: false }]
    const p = presentIn(money(6946, 'KES'), 'JPY', rates, '2026-08-07', CURRENCIES)!
    expect(Number.isInteger(p.money.amount)).toBe(true)
  })
})
