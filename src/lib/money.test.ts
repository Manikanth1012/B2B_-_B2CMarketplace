import { describe, it, expect } from 'vitest'
import {
  money, add, sumOf, byCurrency, isMixed, currenciesIn, negate,
  roundMinor, round, minorUnitsOf, rateOn, convert, totalIn,
  format, symbolOf, charmPrice, wasPriceFor, priceBandOk,
} from './money'
import type { Currency, Rate } from './money'

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
