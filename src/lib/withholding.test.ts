import { describe, it, expect } from 'vitest'
import {
  rulesFor, rateFor, baseFor, deductionsOn, totalOf, effectiveRate,
  positionLine, payeeWarnings, certificateLine, claimable, byStatute,
  CERTIFICATE_STATE,
} from './withholding'
import type { Rule, Payee, Certificate } from './withholding'

/* The real rules, because the bug this replaces was invisible against a
   plausible-looking fixture and obvious against the actual statutes. */
const IN194O: Rule = {
  id: 'WHT-IN-194O', market: 'IN', applies_to: 'partner-payout', basis: 'gross',
  statute: 'Income Tax Act, s.194-O', label: 'TDS on e-commerce sales facilitated',
  resident_rate: 1, non_resident_rate: 1, treaty_rate: null,
  threshold_amount: 500000, threshold_period: 'year',
  effective_from: '2020-10-01', effective_to: null, note: null, sort_order: 1,
}
const INTCS: Rule = {
  ...IN194O, id: 'WHT-IN-TCS52', basis: 'net',
  statute: 'CGST Act, s.52', label: 'GST tax collected at source',
  resident_rate: 0.5, non_resident_rate: 0.5,
  threshold_amount: null, threshold_period: null,
  effective_from: '2024-07-10', sort_order: 2,
}
const KECOMM: Rule = {
  id: 'WHT-KE-COMM', market: 'KE', applies_to: 'partner-payout', basis: 'commission',
  statute: 'Income Tax Act, s.35 — Third Schedule', label: 'Withholding tax on commission',
  resident_rate: 5, non_resident_rate: 20, treaty_rate: 15,
  threshold_amount: null, threshold_period: null,
  effective_from: '2015-01-01', effective_to: null, note: null, sort_order: 3,
}
const AENONE: Rule = {
  id: 'WHT-AE-NONE', market: 'AE', applies_to: 'partner-payout', basis: 'commission',
  statute: 'Federal Decree-Law No. 47 of 2022', label: 'No withholding tax',
  resident_rate: 0, non_resident_rate: 0, treaty_rate: null,
  threshold_amount: null, threshold_period: null,
  effective_from: '2023-06-01', effective_to: null, note: null, sort_order: 4,
}
const RULES = [IN194O, INTCS, KECOMM, AENONE]

const AMOUNTS = { gross: 10000, commission: 1100, net: 8900 }
const resident = (m: string, treaty = false): Payee => ({ residence: m, treaty_on_file: treaty })
const TODAY = '2026-08-07'

describe('rulesFor', () => {
  it('takes only the market and direction asked for', () => {
    expect(rulesFor(RULES, 'IN', 'partner-payout', TODAY).map(r => r.id))
      .toEqual(['WHT-IN-194O', 'WHT-IN-TCS52'])
    expect(rulesFor(RULES, 'AE', 'partner-payout', TODAY).map(r => r.id)).toEqual(['WHT-AE-NONE'])
    expect(rulesFor(RULES, 'IN', 'enterprise-payment', TODAY)).toEqual([])
  })

  /* The rate a period was earned under, not the rate today. TCS was 1% until
     July 2024 and 0.5% after. */
  it('respects the date a rule came into force', () => {
    expect(rulesFor(RULES, 'IN', 'partner-payout', '2024-01-01').map(r => r.id))
      .toEqual(['WHT-IN-194O'])
    expect(rulesFor(RULES, 'IN', 'partner-payout', '2019-01-01')).toEqual([])
  })

  it('drops a rule that has been superseded', () => {
    const old = { ...IN194O, effective_to: '2025-12-31' }
    expect(rulesFor([old], 'IN', 'partner-payout', TODAY)).toEqual([])
  })
})

describe('rateFor — residence first, treaty second', () => {
  /* The whole of the bug. Every seller's record read "Nil under treaty",
     including seven Indian companies paid by an Indian company. */
  it('applies the domestic rate to a domestic payee, treaty or no treaty', () => {
    expect(rateFor(IN194O, 'IN', resident('IN'))).toBe(1)
    expect(rateFor(IN194O, 'IN', resident('IN', true))).toBe(1)
    expect(rateFor(KECOMM, 'KE', resident('KE', true))).toBe(5)
  })

  it('applies the non-resident rate across a border', () => {
    expect(rateFor(KECOMM, 'KE', resident('US'))).toBe(20)
  })

  it('lets a treaty reduce the non-resident rate, and only that one', () => {
    expect(rateFor(KECOMM, 'KE', resident('US', true))).toBe(15)
    /* No treaty relief published, so the certificate changes nothing. */
    expect(rateFor(IN194O, 'IN', resident('US', true))).toBe(1)
  })
})

describe('baseFor', () => {
  /* India deducts on the whole sale, Kenya on the commission. Reading the
     basis wrong is a twenty-fold error at a ten-per-cent take rate. */
  it('is the sale in India and the commission in Kenya', () => {
    expect(baseFor(IN194O, AMOUNTS)).toBe(10000)
    expect(baseFor(KECOMM, AMOUNTS)).toBe(1100)
    expect(baseFor(INTCS, AMOUNTS)).toBe(8900)
  })
})

describe('deductionsOn', () => {
  it('deducts under both Indian statutes at once', () => {
    const d = deductionsOn({
      rules: RULES, market: 'IN', direction: 'partner-payout',
      payee: resident('IN', true), amounts: AMOUNTS, on: TODAY,
    })
    expect(d.map(x => [x.rule_id, x.amount])).toEqual([
      ['WHT-IN-194O', 100],   /* 1% of the 10,000 sale */
      ['WHT-IN-TCS52', 44.5], /* 0.5% of the 8,900 net supply */
    ])
    expect(totalOf(d)).toBe(144.5)
  })

  it('deducts on the commission in Kenya, at the rate residence dictates', () => {
    const home = deductionsOn({
      rules: RULES, market: 'KE', direction: 'partner-payout',
      payee: resident('KE'), amounts: AMOUNTS, on: TODAY,
    })
    expect(totalOf(home)).toBe(55)

    const away = deductionsOn({
      rules: RULES, market: 'KE', direction: 'partner-payout',
      payee: resident('US'), amounts: AMOUNTS, on: TODAY,
    })
    expect(totalOf(away)).toBe(220)

    const treaty = deductionsOn({
      rules: RULES, market: 'KE', direction: 'partner-payout',
      payee: resident('US', true), amounts: AMOUNTS, on: TODAY,
    })
    expect(totalOf(treaty)).toBe(165)
  })

  /* A nil rate is a real answer and not a line on a statement. */
  it('produces no line in a market that imposes nothing', () => {
    expect(deductionsOn({
      rules: RULES, market: 'AE', direction: 'partner-payout',
      payee: resident('AE'), amounts: AMOUNTS, on: TODAY,
    })).toEqual([])
  })

  it('produces nothing where no rule is in force yet', () => {
    expect(deductionsOn({
      rules: RULES, market: 'IN', direction: 'partner-payout',
      payee: resident('IN'), amounts: AMOUNTS, on: '2019-01-01',
    })).toEqual([])
  })
})

describe('effectiveRate', () => {
  it('is derived from the deductions, so it cannot disagree with them', () => {
    const d = deductionsOn({
      rules: RULES, market: 'IN', direction: 'partner-payout',
      payee: resident('IN'), amounts: AMOUNTS, on: TODAY,
    })
    expect(effectiveRate(d, 10000)).toBe(1.445)
    expect(effectiveRate([], 10000)).toBe(0)
    expect(effectiveRate(d, 0)).toBe(0)
  })
})

describe('positionLine', () => {
  it('says the domestic rate applies and no treaty is engaged', () => {
    const s = positionLine(RULES, 'IN', resident('IN', true), TODAY)
    expect(s).toMatch(/Resident in IN/)
    expect(s).toMatch(/no treaty is engaged/)
    expect(s).toMatch(/s\.194-O at 1% of gross/)
  })

  it('says a treaty reduced but did not remove a cross-border rate', () => {
    const s = positionLine(RULES, 'KE', resident('US', true), TODAY)
    expect(s).toMatch(/reduced but not removed/)
    expect(s).toMatch(/at 15% of commission/)
  })

  it('says nil is nil, and says why', () => {
    expect(positionLine(RULES, 'AE', resident('AE'), TODAY))
      .toMatch(/nil rate on domestic payments/)
  })

  /* A market nobody has ruled on and a market that imposes nothing look the
     same on a screen and are not the same thing. */
  it('distinguishes a nil rate from an unconfigured jurisdiction', () => {
    expect(positionLine(RULES, 'SG', resident('SG'), TODAY))
      .toMatch(/No withholding position is configured/)
  })
})

describe('payeeWarnings', () => {
  it('is quiet about a domestic payee with a tax id', () => {
    expect(payeeWarnings({ ...resident('IN'), tax_id: 'AAACA4471Q' }, 'IN', TODAY)).toEqual([])
  })

  it('warns when there is no tax identifier at all', () => {
    expect(payeeWarnings({ ...resident('IN'), tax_id: null }, 'IN', TODAY)[0])
      .toMatch(/higher rate/)
  })

  it('warns about a cross-border payee with no certificate', () => {
    const w = payeeWarnings({ ...resident('US'), tax_id: 'X' }, 'KE', TODAY)
    expect(w.some(s => /no treaty certificate/.test(s))).toBe(true)
  })

  it('warns about relief claimed against an expired certificate', () => {
    const w = payeeWarnings(
      { ...resident('US', true), tax_id: 'X', treaty_expires: '2026-01-01' }, 'KE', TODAY)
    expect(w.some(s => /the authority will reverse/.test(s))).toBe(true)
  })

  /* The exact record this module replaces: thirteen sellers, all "Nil under
     treaty", seven of them domestic. */
  it('catches a treaty certificate on a domestic payee', () => {
    const w = payeeWarnings({ ...resident('IN', true), tax_id: 'X' }, 'IN', TODAY)
    expect(w.some(s => /does nothing here/.test(s))).toBe(true)
  })
})

const cert = (over: Partial<Certificate> = {}): Certificate => ({
  id: 'WHT-1001-2026Q2-194O', partner_id: 'PTR-1001', market: 'IN',
  rule_id: 'WHT-IN-194O', statute: 'Income Tax Act, s.194-O',
  form: 'Form 16A', certificate_no: null,
  period_start: '2026-04-01', period_end: '2026-06-30',
  amount: 30.02, currency: 'USD', status: 'accruing',
  filed_on: null, issued_on: null, ...over,
})

describe('the certificate', () => {
  /* The useful distinction is whether the seller can claim it yet. */
  it('says what stage it is at, in terms of what the seller can do', () => {
    expect(certificateLine(cert())).toMatch(/still running/)
    expect(certificateLine(cert({ status: 'filed', filed_on: '2026-07-31' })))
      .toMatch(/Filed with the authority on 2026-07-31/)
    expect(certificateLine(cert({ status: 'issued', certificate_no: 'ABCD12345', issued_on: '2026-08-15' })))
      .toMatch(/Form 16A ABCD12345 — quote it on your own return/)
  })

  it('lists only what can be claimed today, newest first', () => {
    const list = [
      cert({ id: 'a', status: 'issued', certificate_no: '1', period_start: '2026-01-01' }),
      cert({ id: 'b', status: 'accruing' }),
      cert({ id: 'c', status: 'issued', certificate_no: '2', period_start: '2026-04-01' }),
    ]
    expect(claimable(list).map(c => c.id)).toEqual(['c', 'a'])
  })

  it('adds up by statute, heaviest first', () => {
    const list = [
      cert({ statute: 's.194-O', amount: 400.77 }),
      cert({ statute: 's.52 CGST', amount: 178.42 }),
      cert({ statute: 's.194-O', amount: 418.72 }),
    ]
    expect(byStatute(list)).toEqual([
      { statute: 's.194-O', amount: 819.49, count: 2 },
      { statute: 's.52 CGST', amount: 178.42, count: 1 },
    ])
  })

  it('has a word for every state it can be in', () => {
    expect(Object.keys(CERTIFICATE_STATE).sort()).toEqual(['accruing', 'filed', 'issued'])
  })
})
