import { describe, it, expect } from 'vitest'
import {
  windowFor, lastClosed, nextClose, dueOn, periodLabel, heldBack, settle,
  cycleLine, holdLine, minimumLine, termsWarnings, termsProblem, MONTHS,
} from './settlementCycle'
import type { Terms } from './settlementCycle'

const terms = (over: Partial<Terms> = {}): Terms => ({
  partner_id: 'PTR-1001',
  frequency: 'monthly', align: 'calendar',
  starts_on: '2026-01-01', closes_on_day: 0,
  pay_within_days: 30, hold_days: 0, hold_reason: null,
  minimum_payout: 0, payout_currency: 'INR',
  agreed_on: '2024-04-12', agreed_by: 'Ruben Oyelaran', contract_ref: 'MSA-2024-1001',
  ...over,
})

describe('windowFor', () => {
  it('cuts a month on the month', () => {
    expect(windowFor(terms(), '2026-08-07')).toEqual({
      start: '2026-08-01', end: '2026-08-31', closes: '2026-08-31',
    })
  })

  it('cuts a calendar quarter on the calendar boundary, whatever month the contract began', () => {
    const t = terms({ frequency: 'quarterly', starts_on: '2026-01-01' })
    expect(windowFor(t, '2026-08-07')).toEqual({
      start: '2026-07-01', end: '2026-09-30', closes: '2026-09-30',
    })
  })

  /* Both alignments are written into real contracts, and a system that only
     does one silently pays the other partner on the wrong days. */
  it('cuts an anniversary quarter from the month the contract started', () => {
    const t = terms({ frequency: 'quarterly', align: 'anniversary', starts_on: '2026-02-01' })
    expect(windowFor(t, '2026-08-07')).toEqual({
      start: '2026-08-01', end: '2026-10-31', closes: '2026-10-31',
    })
    expect(windowFor(t, '2026-06-15')?.start).toBe('2026-05-01')
  })

  it('cuts half-years and years', () => {
    expect(windowFor(terms({ frequency: 'half-yearly' }), '2026-08-07')).toEqual({
      start: '2026-07-01', end: '2026-12-31', closes: '2026-12-31',
    })
    expect(windowFor(terms({ frequency: 'yearly' }), '2026-08-07')).toEqual({
      start: '2026-01-01', end: '2026-12-31', closes: '2026-12-31',
    })
  })

  /* The bug that shipped: counting the closing day from the START of the
     period. Invisible on a monthly cycle, eleven months wrong on a yearly one. */
  it('closes on the given day of the month the period ENDS in', () => {
    expect(windowFor(terms({ frequency: 'yearly', closes_on_day: 25 }), '2026-08-07')?.closes)
      .toBe('2026-12-25')
    expect(windowFor(terms({ closes_on_day: 25 }), '2026-08-07')?.closes)
      .toBe('2026-08-25')
    expect(windowFor(terms({ frequency: 'quarterly', closes_on_day: 25 }), '2026-08-07')?.closes)
      .toBe('2026-09-25')
  })

  it('never closes after the period ends', () => {
    /* February is short. A close day of 28 lands on the 28th; the clamp is
       there for the 29th, 30th and 31st a contract might one day carry. */
    const t = terms({ closes_on_day: 28 })
    expect(windowFor(t, '2027-02-10')?.closes).toBe('2027-02-28')
  })

  it('truncates the first period at the contract start rather than excluding it', () => {
    const t = terms({ frequency: 'quarterly', starts_on: '2026-02-15' })
    expect(windowFor(t, '2026-02-20')).toEqual({
      start: '2026-02-15', end: '2026-03-31', closes: '2026-03-31',
    })
  })

  it('has no window before the contract exists', () => {
    expect(windowFor(terms({ starts_on: '2026-06-01' }), '2026-01-15')).toBeNull()
  })
})

describe('lastClosed', () => {
  it('is the period before the one running', () => {
    expect(lastClosed(terms(), '2026-08-07')?.end).toBe('2026-07-31')
    expect(lastClosed(terms({ frequency: 'quarterly' }), '2026-08-07')?.end).toBe('2026-06-30')
  })

  it('is the current period once it has closed', () => {
    expect(lastClosed(terms(), '2026-08-31')?.end).toBe('2026-08-31')
  })

  /* A partner who signed last week is not owed a settlement, and inventing a
     short first period for them would settle orders that predate the
     agreement. */
  it('is nothing before the contract starts', () => {
    expect(lastClosed(terms({ starts_on: '2026-09-01' }), '2026-08-07')).toBeNull()
  })

  it('is nothing while the first period is still running', () => {
    expect(lastClosed(terms({ frequency: 'quarterly', starts_on: '2026-07-01' }), '2026-08-07'))
      .toBeNull()
  })
})

describe('nextClose', () => {
  it('is the close of the period now running', () => {
    expect(nextClose(terms(), '2026-08-07')).toBe('2026-08-31')
    expect(nextClose(terms({ frequency: 'quarterly' }), '2026-08-07')).toBe('2026-09-30')
  })

  /* The bug that shipped: a half-yearly partner's "next" settlement read
     30 June, six weeks in the past, because the old implementation started
     from the last period to close and added a cycle to its END. */
  it('is never in the past', () => {
    expect(nextClose(terms({ frequency: 'half-yearly' }), '2026-08-07')).toBe('2026-12-31')
    expect(nextClose(terms({ frequency: 'yearly' }), '2026-08-07')).toBe('2026-12-31')
    expect(nextClose(terms({ frequency: 'quarterly', align: 'anniversary', starts_on: '2026-02-01' }), '2026-08-07'))
      .toBe('2026-10-31')
  })

  it('steps to the following period on the day one closes', () => {
    expect(nextClose(terms(), '2026-08-31')).toBe('2026-09-30')
  })

  it('is the first close of a contract that has not started', () => {
    expect(nextClose(terms({ frequency: 'quarterly', starts_on: '2026-09-01' }), '2026-08-07'))
      .toBe('2026-09-30')
  })
})

describe('dueOn', () => {
  it('counts the contract days from the close, not from the period end', () => {
    expect(dueOn(terms({ pay_within_days: 15 }), '2026-07-31')).toBe('2026-08-15')
    expect(dueOn(terms({ pay_within_days: 45 }), '2026-06-30')).toBe('2026-08-14')
    expect(dueOn(terms({ pay_within_days: 0 }), '2026-07-31')).toBe('2026-07-31')
  })
})

describe('periodLabel', () => {
  it('names a period the way the contract does', () => {
    expect(periodLabel('monthly', '2026-08-01')).toBe('Aug 2026')
    expect(periodLabel('quarterly', '2026-07-01')).toBe('Q3 2026')
    expect(periodLabel('quarterly', '2026-05-01')).toBe('Q2 2026')
    expect(periodLabel('half-yearly', '2026-01-01')).toBe('H1 2026')
    expect(periodLabel('half-yearly', '2026-07-01')).toBe('H2 2026')
    expect(periodLabel('yearly', '2026-01-01')).toBe('2026')
  })
})

describe('heldBack', () => {
  const sales = [
    { net: 100, occurred_on: '2026-08-02' },
    { net: 200, occurred_on: '2026-08-20' },
    { net: 400, occurred_on: '2026-08-29' },
  ]

  /* Counted back from the CLOSE, not from today. A sale on the 29th of a month
     closing on the 31st is inside a 14-day returns window; settling it means
     paying the money and clawing it back. */
  it('holds what is still inside the window on the day the period closes', () => {
    expect(heldBack(sales, terms({ hold_days: 14, hold_reason: 'returns' }), '2026-08-31')).toBe(600)
    expect(heldBack(sales, terms({ hold_days: 7, hold_reason: 'chargebacks' }), '2026-08-31')).toBe(400)
  })

  it('holds nothing where the contract holds nothing', () => {
    expect(heldBack(sales, terms({ hold_days: 0 }), '2026-08-31')).toBe(0)
  })

  it('holds everything when the window covers the period', () => {
    expect(heldBack(sales, terms({ hold_days: 60, hold_reason: 'x' }), '2026-08-31')).toBe(700)
  })
})

describe('settle', () => {
  it('pays what is earned less what is held', () => {
    const r = settle({ earned: 1000, held: 200, carriedIn: 0, terms: terms() })
    expect(r.payable).toBe(800)
    expect(r.carriedOut).toBe(200)
    expect(r.belowMinimum).toBe(false)
  })

  it('adds what the last period could not pay', () => {
    const r = settle({ earned: 1000, held: 0, carriedIn: 150, terms: terms() })
    expect(r.payable).toBe(1150)
  })

  it('carries the whole balance when it is under the minimum, and says why', () => {
    const t = terms({ minimum_payout: 250, payout_currency: 'KES', contract_ref: 'MSA-2025-1009' })
    const r = settle({ earned: 90, held: 0, carriedIn: 0, terms: t })
    expect(r.payable).toBe(0)
    expect(r.carriedOut).toBe(90)
    expect(r.belowMinimum).toBe(true)
    expect(r.why).toMatch(/below the 250\.00 KES minimum/)
    expect(r.why).toMatch(/MSA-2025-1009/)
  })

  /* Testing the minimum before adding the carry-in would strand a partner
     forever: three periods of $90 against a $250 minimum would each carry and
     never combine. */
  it('combines carried balances until they clear the minimum', () => {
    const t = terms({ minimum_payout: 250, payout_currency: 'KES' })
    const first = settle({ earned: 90, held: 0, carriedIn: 0, terms: t })
    expect(first.payable).toBe(0)
    const second = settle({ earned: 90, held: 0, carriedIn: first.carriedOut, terms: t })
    expect(second.payable).toBe(0)
    const third = settle({ earned: 90, held: 0, carriedIn: second.carriedOut, terms: t })
    expect(third.payable).toBe(270)
    expect(third.belowMinimum).toBe(false)
  })

  it('never pays a negative amount', () => {
    const r = settle({ earned: 100, held: 0, carriedIn: -400, terms: terms() })
    expect(r.payable).toBe(0)
  })

  it('names the hold when there is one', () => {
    const t = terms({ hold_days: 14, hold_reason: 'Returns window on hardware.' })
    expect(settle({ earned: 1000, held: 200, carriedIn: 0, terms: t }).why)
      .toMatch(/Returns window on hardware/)
  })
})

describe('the cycle in words', () => {
  it('reads out a monthly contract', () => {
    expect(cycleLine(terms({ pay_within_days: 15 })))
      .toBe('Monthly, closing on the last day of the period, payable within 15 days.')
  })

  it('says which alignment a quarterly contract is on', () => {
    expect(cycleLine(terms({ frequency: 'quarterly' }))).toMatch(/on the calendar boundary/)
    expect(cycleLine(terms({ frequency: 'quarterly', align: 'anniversary' })))
      .toMatch(/counted from the month the contract started/)
  })

  it('reads a closing day back as a day of the month', () => {
    expect(cycleLine(terms({ frequency: 'yearly', closes_on_day: 25 })))
      .toMatch(/closing on the 25th of the closing month/)
  })

  it('says nothing about a hold or a minimum that is not there', () => {
    expect(holdLine(terms())).toBeNull()
    expect(minimumLine(terms())).toBeNull()
    expect(holdLine(terms({ hold_days: 14, hold_reason: 'Returns.' }))).toMatch(/14 days held back — Returns/)
    expect(minimumLine(terms({ minimum_payout: 250, payout_currency: 'KES' })))
      .toMatch(/Below 250\.00 KES/)
  })
})

describe('termsProblem', () => {
  it('passes a complete contract', () => {
    expect(termsProblem(terms())).toBeNull()
  })

  it('refuses a hold nobody can account for', () => {
    expect(termsProblem(terms({ hold_days: 14, hold_reason: null }))).toMatch(/what it is for/)
    expect(termsProblem(terms({ hold_days: 14, hold_reason: '   ' }))).toMatch(/what it is for/)
  })

  it('refuses a closing day that does not exist in February', () => {
    expect(termsProblem(terms({ closes_on_day: 30 }))).toMatch(/would not exist in February/)
    expect(termsProblem(terms({ closes_on_day: 28 }))).toBeNull()
    expect(termsProblem(terms({ closes_on_day: 0 }))).toBeNull()
  })

  it('refuses money due before the period closed', () => {
    expect(termsProblem(terms({ pay_within_days: -5 }))).toMatch(/before the period closed/)
  })

  it('wants the things it cannot infer', () => {
    expect(termsProblem({ ...terms(), frequency: undefined })).toMatch(/how often/)
    expect(termsProblem({ ...terms(), payout_currency: undefined })).toMatch(/currency/)
    expect(termsProblem({ ...terms(), starts_on: undefined })).toMatch(/counts from/)
  })
})

describe('termsWarnings', () => {
  it('is quiet about a contract that is fine', () => {
    expect(termsWarnings(terms())).toEqual([])
  })

  it('warns about a cycle nobody can point at a document for', () => {
    expect(termsWarnings(terms({ contract_ref: null }))[0]).toMatch(/contract reference/)
    expect(termsWarnings(terms({ agreed_by: null }))[0]).toMatch(/agreed it/)
  })

  /* A 90-day hold on a quarterly cycle holds back the whole quarter. Coherent
     as arithmetic, indefensible as a contract. */
  it('warns when the hold swallows the period', () => {
    const w = termsWarnings(terms({ frequency: 'quarterly', hold_days: 60, hold_reason: 'x' }))
    expect(w.some(s => /holds back most of the period/.test(s))).toBe(true)
  })

  it('warns about fourteen months from sale to money', () => {
    const w = termsWarnings(terms({ frequency: 'yearly', pay_within_days: 90 }))
    expect(w.some(s => /fourteen months/.test(s))).toBe(true)
  })
})

describe('MONTHS', () => {
  it('is the whole vocabulary and nothing else', () => {
    expect(Object.keys(MONTHS).sort()).toEqual(['half-yearly', 'monthly', 'quarterly', 'yearly'])
    expect(MONTHS.quarterly).toBe(3)
  })
})
