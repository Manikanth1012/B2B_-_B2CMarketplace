import { describe, it, expect } from 'vitest'
import { periodEnd, payoutFor, payoutAgrees, statementAddsUp } from './settlement'
import type { Rate, Currency } from './money'

/* The fixes the marketplace actually holds, monthly. Two of them mattered
   before this: a settlement for February had no rate at or before its period
   end, so half the book could not be converted at all. */
const RATES: Rate[] = [
  { base: 'USD', quote: 'INR', rate: 85.55, as_of: '2026-02-01', source: 'x', pegged: false },
  { base: 'USD', quote: 'INR', rate: 86.30, as_of: '2026-04-01', source: 'x', pegged: false },
  { base: 'USD', quote: 'INR', rate: 87.42, as_of: '2026-08-01', source: 'x', pegged: false },
  { base: 'USD', quote: 'AED', rate: 3.6725, as_of: '2026-02-01', source: 'peg', pegged: true },
]

const CURRENCIES: Currency[] = [
  { code: 'USD', name: 'US Dollar', symbol: '$', minor_units: 2, locale: 'en-US', symbol_first: true, is_reporting: true, sort_order: 1 },
  { code: 'INR', name: 'Indian Rupee', symbol: '₹', minor_units: 2, locale: 'en-IN', symbol_first: true, is_reporting: false, sort_order: 2 },
]

describe('periodEnd', () => {
  it('reads a period and gives its last day', () => {
    expect(periodEnd('Feb 2026')).toBe('2026-02-28')
    expect(periodEnd('Aug 2026')).toBe('2026-08-31')
    expect(periodEnd('Apr 2026')).toBe('2026-04-30')
  })

  it('handles February in a leap year without anybody listing them', () => {
    expect(periodEnd('Feb 2028')).toBe('2028-02-29')
  })

  it('accepts a full month name', () => {
    expect(periodEnd('February 2026')).toBe('2026-02-28')
  })

  /* Four vocabularies, because partners settle on four cycles and each names
     its periods its own way. "Q1 2026" used to be refused, correctly — nothing
     produced it. Eleven statements were labelled that way the moment the
     contracted cycles went in, and refusing them left half the book undatable. */
  it('dates a quarter, a half and a year as well as a month', () => {
    expect(periodEnd('Q1 2026')).toBe('2026-03-31')
    expect(periodEnd('Q2 2026')).toBe('2026-06-30')
    expect(periodEnd('Q4 2026')).toBe('2026-12-31')
    expect(periodEnd('H1 2026')).toBe('2026-06-30')
    expect(periodEnd('H2 2026')).toBe('2026-12-31')
    expect(periodEnd('2026')).toBe('2026-12-31')
  })

  it('refuses rather than guessing', () => {
    /* Guessing a date here silently picks a rate, which is the failure with no
       symptom — the figure comes out, it is just the wrong one. */
    expect(periodEnd('2026-02')).toBeNull()
    expect(periodEnd('Q5 2026')).toBeNull()
    expect(periodEnd('H3 2026')).toBeNull()
    expect(periodEnd('first quarter')).toBeNull()
    expect(periodEnd('')).toBeNull()
  })
})

describe('payoutFor', () => {
  const base = { net: 1000, from: 'USD', period: 'Apr 2026', rates: RATES, currencies: CURRENCIES }

  it('converts at the fix in force when the period closed', () => {
    const r = payoutFor({ ...base, to: 'INR' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payout).toMatchObject({ currency: 'INR', rate: 86.30, asOf: '2026-04-01' })
    expect(r.payout.net).toBeCloseTo(86300, 2)
  })

  it('uses the rate in force at or before the period, never the newest', () => {
    /* The whole reason `fx_as_of` is on the row. A February statement converted
       at August's fix is a different document from the one the seller was paid
       against. */
    const r = payoutFor({ ...base, to: 'INR', period: 'Feb 2026' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payout.rate).toBe(85.55)
    expect(r.payout.asOf).toBe('2026-02-01')
  })

  it('leaves a same-currency payout alone at a rate of one', () => {
    const r = payoutFor({ ...base, to: 'USD' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payout).toMatchObject({ currency: 'USD', net: 1000, rate: 1 })
    /* Rate 1 rather than null, so every statement reads the same way. */
    expect(r.payout.rate).not.toBeNull()
  })

  it('refuses when there is no rate old enough', () => {
    const r = payoutFor({ ...base, to: 'INR', period: 'Jan 2026' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/no USD→INR rate on file at or before 2026-01-31/)
  })

  it('refuses a period it cannot date', () => {
    const r = payoutFor({ ...base, to: 'INR', period: 'second half' })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.reason).toMatch(/Aug 2026/)
  })

  it('converts a quarterly statement at the rate in force when the quarter closed', () => {
    const r = payoutFor({ ...base, to: 'INR', period: 'Q2 2026' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    /* 30 June, not whichever rate happens to be latest. */
    expect(r.payout.asOf <= '2026-06-30').toBe(true)
  })

  it('handles a pegged rate like any other', () => {
    /* A peg is a rate that happens not to move. Code that treats it as an
       absence of a rate breaks on the day it is repegged. */
    const r = payoutFor({ ...base, to: 'AED' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payout.rate).toBe(3.6725)
  })

  it('rounds to the target currency, not to two places by assumption', () => {
    const r = payoutFor({ ...base, net: 1234.567, to: 'INR' })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.payout.net).toBe(Math.round(1234.567 * 86.30 * 100) / 100)
  })
})

describe('payoutAgrees', () => {
  it('accepts a statement that reproduces its own conversion', () => {
    expect(payoutAgrees({ net: 1000, payout_net: 86300, fx_rate: 86.3 })).toBe(true)
  })

  it('catches a rate edited without the amount', () => {
    expect(payoutAgrees({ net: 1000, payout_net: 86300, fx_rate: 87.42 })).toBe(false)
  })

  it('catches an amount edited without the rate', () => {
    expect(payoutAgrees({ net: 1000, payout_net: 90000, fx_rate: 86.3 })).toBe(false)
  })

  it('tolerates a rounding unit', () => {
    expect(payoutAgrees({ net: 1000, payout_net: 86300.01, fx_rate: 86.3 })).toBe(true)
  })
})

describe('statementAddsUp', () => {
  const s = { gross: 29016.99, commission: 2611.53, fees: 569.72, withholding: 0, refunds: 0, net: 25835.74 }

  it('accepts a statement whose net is what is left', () => {
    expect(statementAddsUp(s)).toBe(true)
  })

  it('catches a deduction that went missing', () => {
    expect(statementAddsUp({ ...s, fees: 0 })).toBe(false)
  })

  it('is independent of currency — this is arithmetic, not money', () => {
    expect(statementAddsUp({ gross: 100, commission: 10, fees: 5, withholding: 0, refunds: 0, net: 85 })).toBe(true)
  })
})
