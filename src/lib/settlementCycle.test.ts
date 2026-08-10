import { describe, it, expect } from 'vitest'
import {
  windowFor, lastClosed, nextClose, dueOn, periodLabel, heldBack, settle, projectPayout,
  cycleLine, holdLine, minimumLine, termsWarnings, termsProblem, MONTHS, reserveOn,
} from './settlementCycle'
import type { Terms, Accruing } from './settlementCycle'
import type { Rule } from './withholding'

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

  /* The term the function did not have. `run_settlements_core` deducts tax at
     source before anything is held or carried; this used to model the same
     stack with that step missing. */
  it('takes tax at source off before anything is held', () => {
    const r = settle({ earned: 1000, withheld: 11, held: 200, carriedIn: 0, terms: terms() })
    expect(r.payable).toBe(789)
    expect(r.withheld).toBe(11)
    /* What is held is still what is held. Withholding does not enlarge it —
       that money is with the revenue authority, not carried into next period. */
    expect(r.carriedOut).toBe(200)
  })

  it('leaves everything unchanged when nothing is withheld', () => {
    const with0 = settle({ earned: 1000, withheld: 0, held: 200, carriedIn: 0, terms: terms() })
    const without = settle({ earned: 1000, held: 200, carriedIn: 0, terms: terms() })
    expect(with0).toEqual(without)
  })

  /* The case that makes the missing term more than a rounding difference: a
     deduction can be what drops a payment under the minimum, and the seller is
     paid nothing rather than the figure the old card showed them. */
  it('can be the thing that puts a payment under the minimum', () => {
    const t = terms({ minimum_payout: 250, payout_currency: 'KES' })
    expect(settle({ earned: 255, withheld: 0, held: 0, carriedIn: 0, terms: t }).payable).toBe(255)
    const taxed = settle({ earned: 255, withheld: 10, held: 0, carriedIn: 0, terms: t })
    expect(taxed.payable).toBe(0)
    expect(taxed.belowMinimum).toBe(true)
    expect(taxed.carriedOut).toBe(245)
  })
})

describe('projectPayout', () => {
  /* Both Indian statutes, as they are actually configured: 1% of gross under
     194-O and 0.1% of the net supply under s.52 CGST. */
  const inRules: Rule[] = [
    {
      id: 'WHT-IN-194O', market: 'IN', applies_to: 'partner-payout', basis: 'gross',
      statute: 's.194-O', label: 'TDS on e-commerce', resident_rate: 1, non_resident_rate: 20,
      treaty_rate: null, threshold_amount: null, threshold_period: null,
      effective_from: '2020-10-01', effective_to: null, note: null, sort_order: 1,
    },
    {
      id: 'WHT-IN-52', market: 'IN', applies_to: 'partner-payout', basis: 'net',
      statute: 's.52 CGST', label: 'TCS on the supply', resident_rate: 0.1, non_resident_rate: 0.1,
      treaty_rate: null, threshold_amount: null, threshold_period: null,
      effective_from: '2018-10-01', effective_to: null, note: null, sort_order: 2,
    },
  ]

  const accruing = (over: Partial<Accruing> = {}): Accruing => ({
    gross: 10000, commission: 1000, fees: 200, refunds: 0, net: 8800,
    held_back: 0, carried_in: 0,
    market: 'IN', tax_residence: 'IN', treaty_on_file: false,
    closed_on: '2026-08-31',
    ...over,
  })

  it('deducts under every statute in force, listed rather than totalled', () => {
    const r = projectPayout({ accruing: accruing(), terms: terms(), rules: inRules })
    expect(r.deductions.map(d => d.statute)).toEqual(['s.194-O', 's.52 CGST'])
    expect(r.deductions[0].amount).toBe(100)
    /* 0.1% of gross less commission, fees and refunds — not of `net`, and not
       of gross. Getting the basis wrong here is a tenfold error, not a
       rounding one. */
    expect(r.deductions[1].amount).toBe(8.8)
    expect(r.withheld).toBe(108.8)
    expect(r.payable).toBe(8691.2)
  })

  /* The figure the card used to show. Kept as a test so the gap cannot quietly
     reopen — it is 108.80 on this seller and it is the seller's money. */
  it('pays less than net minus the hold, which is what the card used to claim', () => {
    const a = accruing({ held_back: 300 })
    const r = projectPayout({ accruing: a, terms: terms(), rules: inRules })
    expect(a.net - a.held_back).toBe(8500)
    expect(r.payable).toBe(8391.2)
  })

  it('adds what the last period could not pay', () => {
    const r = projectPayout({
      accruing: accruing({ carried_in: 250 }), terms: terms(), rules: inRules,
    })
    expect(r.payable).toBe(8941.2)
  })

  /* A treaty reduces a rate that crosses a border and does nothing to a
     domestic one. The seller who exercises this is real: PTR-1009 sells into
     Kenya and is resident in the UAE. */
  it('charges a non-resident the non-resident rate, reduced by a treaty on file', () => {
    const a = accruing({ market: 'IN', tax_residence: 'AE', treaty_on_file: false })
    expect(projectPayout({ accruing: a, terms: terms(), rules: inRules }).deductions[0].rate).toBe(20)

    const relieved: Rule[] = [{ ...inRules[0], treaty_rate: 10 }, inRules[1]]
    const b = accruing({ market: 'IN', tax_residence: 'AE', treaty_on_file: true })
    expect(projectPayout({ accruing: b, terms: terms(), rules: relieved }).deductions[0].rate).toBe(10)

    /* And the same certificate does nothing for a domestic payee. */
    const c = accruing({ market: 'IN', tax_residence: 'IN', treaty_on_file: true })
    expect(projectPayout({ accruing: c, terms: terms(), rules: relieved }).deductions[0].rate).toBe(1)
  })

  /* The UAE imposes none. A nil rate is a real answer and not a missing one,
     and it is not a line on a statement. */
  it('deducts nothing where no rule is in force, and says so with an empty list', () => {
    const r = projectPayout({
      accruing: accruing({ market: 'AE', tax_residence: 'AE' }), terms: terms(), rules: inRules,
    })
    expect(r.deductions).toEqual([])
    expect(r.withheld).toBe(0)
    expect(r.payable).toBe(8800)
  })

  /* Rates are read on the closing date, not today — a rule that came into
     force after this period ended did not govern it. */
  it('applies the rules in force when the period closes', () => {
    const future: Rule[] = [{ ...inRules[0], effective_from: '2026-12-01' }]
    const r = projectPayout({
      accruing: accruing({ closed_on: '2026-08-31' }), terms: terms(), rules: future,
    })
    expect(r.deductions).toEqual([])
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

/* Seven sellers carried a reserve rate and none of them ever had a cent
   retained, because nothing in the run or in this file mentioned the word. */
describe('the rolling reserve', () => {
  const at = (over: Partial<Parameters<typeof reserveOn>[0]> = {}) =>
    reserveOn({ gross: 10_000, room: 8_000, rate: 10, matured: 0, ...over })

  /* Against gross, not against the payout. A refund returns the sale price,
     not the seller's margin. */
  it('is a percentage of gross', () => {
    expect(at().due).toBe(1000)
    expect(at({ gross: 4_321, rate: 2.5 }).due).toBe(108.03)
  })

  it('retains nothing where there is no rate', () => {
    expect(at({ rate: 0 })).toMatchObject({ due: 0, withheld: 0 })
  })

  /* You cannot hold money that is not there. */
  it('never retains more than the period has', () => {
    expect(at({ room: 250 }).withheld).toBe(250)
    expect(at({ room: 0 }).withheld).toBe(0)
    expect(at({ room: -900 }).withheld).toBe(0)
  })

  it('says what it wanted as well as what it got', () => {
    const r = at({ room: 250 })
    expect(r.due).toBe(1000)
    expect(r.withheld).toBe(250)
  })

  it('returns what has matured', () => {
    expect(at({ matured: 412.5 }).released).toBe(412.5)
  })
})

describe('a settlement that retains and returns a reserve', () => {
  const terms: Terms = {
    partner_id: 'PTR-1011', frequency: 'monthly', align: 'calendar',
    starts_on: '2026-01-01', closes_on_day: 0, pay_within_days: 30,
    hold_days: 0, hold_reason: null, minimum_payout: 250, payout_currency: 'USD',
    agreed_on: '2026-01-01', agreed_by: 'A', contract_ref: 'MSA-1',
  }

  it('takes the reserve off what is paid and puts the matured part back', () => {
    const out = settle({
      earned: 10_000, withheld: 0, held: 0, carriedIn: 0,
      reserve: reserveOn({ gross: 20_000, room: 10_000, rate: 5, matured: 300 }),
      terms,
    })
    expect(out.reserveWithheld).toBe(1000)
    expect(out.reserveReleased).toBe(300)
    expect(out.payable).toBe(9300)
  })

  /* The minimum asks what reaches the bank. Testing it before the retention
     would pay out a sum the run had already decided to hold. */
  it('tests the minimum against the figure after the reserve, not before it', () => {
    const out = settle({
      earned: 1_000, withheld: 0, held: 0, carriedIn: 0,
      reserve: reserveOn({ gross: 20_000, room: 1_000, rate: 4, matured: 0 }),
      terms,
    })
    expect(out.reserveWithheld).toBe(800)
    expect(out.payable).toBe(0)
    expect(out.belowMinimum).toBe(true)
  })

  it('is unchanged for a seller with no reserve on file', () => {
    const plain = settle({ earned: 5_000, held: 0, carriedIn: 0, terms })
    expect(plain.payable).toBe(5000)
    expect(plain.reserveWithheld).toBe(0)
    expect(plain.reserveReleased).toBe(0)
  })

  /* Naming one reason and not the other leaves the seller short by the
     difference and reading a statement that does not add up. */
  it('names the holdback and the reserve where both apply', () => {
    const out = settle({
      earned: 10_000, held: 400, carriedIn: 0,
      reserve: reserveOn({ gross: 20_000, room: 9_600, rate: 5, matured: 120 }),
      terms: { ...terms, hold_days: 14, hold_reason: 'the returns window' },
    })
    expect(out.why).toMatch(/held back/)
    expect(out.why).toMatch(/rolling reserve/)
    expect(out.why).toMatch(/matured and is returned/)
  })

  it('says so when the period could only cover part of the reserve', () => {
    const out = settle({
      earned: 500, held: 0, carriedIn: 0,
      reserve: reserveOn({ gross: 20_000, room: 500, rate: 10, matured: 0 }),
      terms: { ...terms, minimum_payout: 0 },
    })
    expect(out.why).toMatch(/all this period could cover of 2000\.00/)
  })
})
