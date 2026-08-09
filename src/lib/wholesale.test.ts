import { describe, it, expect } from 'vitest'
import {
  daysCharged, monthsIn, chargesOver, netOff, buyProblem,
  chargeLine, monthlyCost, running, outstanding, adjustmentNoun, adjustmentSources,
} from './wholesale'
import type { Purchase, Sellable } from './wholesale'

const buy = (over: Partial<Purchase> = {}): Purchase => ({
  id: 'PP-1009-01', partner_id: 'PTR-1009', product_id: 'SKU-7002',
  product_name: 'Wholesale connectivity pack — 500 lines',
  quantity: 1, unit_price: 3900, currency: 'USD', billing_period: 'monthly',
  state: 'active', started_on: '2026-07-01', ends_on: null, ordered_by: 'Wanjiru Otieno',
  ...over,
})

describe('how much of a month was used', () => {
  it('charges a whole month as a whole month', () => {
    expect(daysCharged('2026-07-01', '2026-07-31', '2026-07-01', null))
      .toEqual({ charged: 31, inPeriod: 31 })
  })

  /* Taken on the 18th of a 31-day month: the 18th through the 31st is 14 days,
     not 13. A purchase is live on the day it is taken. */
  it('counts the day it started', () => {
    expect(daysCharged('2026-07-01', '2026-07-31', '2026-07-18', null))
      .toEqual({ charged: 14, inPeriod: 31 })
  })

  it('counts the day it stopped, and nothing after it', () => {
    expect(daysCharged('2026-07-01', '2026-07-31', '2026-07-01', '2026-07-10').charged).toBe(10)
  })

  it('is nothing for a month the purchase was not alive in', () => {
    expect(daysCharged('2026-07-01', '2026-07-31', '2026-08-01', null).charged).toBe(0)
    expect(daysCharged('2026-08-01', '2026-08-31', '2026-06-01', '2026-07-15').charged).toBe(0)
  })

  it('knows February from July', () => {
    expect(daysCharged('2026-02-01', '2026-02-28', '2026-02-01', null).inPeriod).toBe(28)
  })
})

describe('cutting a span into months', () => {
  it('gives one month one month', () => {
    expect(monthsIn('2026-07-01', '2026-07-31'))
      .toEqual([{ start: '2026-07-01', end: '2026-07-31' }])
  })

  /* Beacon settles quarterly and the products are priced monthly. One charge
     for the quarter would bill a reseller for a third of what they used. */
  it('gives a quarter three', () => {
    expect(monthsIn('2026-07-01', '2026-09-30')).toEqual([
      { start: '2026-07-01', end: '2026-07-31' },
      { start: '2026-08-01', end: '2026-08-31' },
      { start: '2026-09-01', end: '2026-09-30' },
    ])
  })

  it('clips the ends to the span rather than to the calendar', () => {
    expect(monthsIn('2026-07-15', '2026-08-10')).toEqual([
      { start: '2026-07-15', end: '2026-07-31' },
      { start: '2026-08-01', end: '2026-08-10' },
    ])
  })
})

describe('what a cycle costs', () => {
  it('charges a quarterly cycle three times for a monthly product', () => {
    const out = chargesOver([buy()], '2026-07-01', '2026-09-30')
    expect(out.length).toBe(3)
    expect(out.map(c => c.gross)).toEqual([3900, 3900, 3900])
  })

  it('pro-rates the month it started in and charges the rest in full', () => {
    const out = chargesOver(
      [buy({ id: 'PP-1011-01', unit_price: 249, started_on: '2026-07-18' })],
      '2026-07-01', '2026-08-31')
    expect(out[0].days_charged).toBe(14)
    /* 249 × 14/31 */
    expect(out[0].gross).toBe(112.45)
    expect(out[1].gross).toBe(249)
  })

  it('multiplies by how many were taken', () => {
    const out = chargesOver([buy({ unit_price: 9.8, quantity: 20 })], '2026-07-01', '2026-07-31')
    expect(out[0].gross).toBe(196)
  })

  /* Sandbox access is free. A zero line on a statement is one a partner has to
     read past to find the ones that cost something. */
  it('raises nothing for something that costs nothing', () => {
    expect(chargesOver([buy({ unit_price: 0 })], '2026-07-01', '2026-07-31')).toEqual([])
  })

  it('stops at the month it was cancelled in', () => {
    const out = chargesOver(
      [buy({ ends_on: '2026-08-15' })], '2026-07-01', '2026-09-30')
    expect(out.length).toBe(2)
    expect(out[1].days_charged).toBe(15)
  })
})

describe('netting off against what is owed', () => {
  const charge = (id: string, gross: number, recovered = 0) => ({ id, gross, recovered })

  it('takes the whole charge when the period covers it', () => {
    const out = netOff({ room: 10_000, charges: [charge('a', 3900)] })
    expect(out.recovered).toBe(3900)
    expect(out.carried).toBe(0)
    expect(out.why).toBeNull()
  })

  /* The case this design exists for: a reseller whose wholesale bill is bigger
     than the quarter they earned. */
  it('takes what is there and carries the rest', () => {
    const out = netOff({ room: 9817.12, charges: [charge('a', 3900), charge('b', 3900), charge('c', 3900)] })
    expect(out.recovered).toBe(9817.12)
    expect(out.carried).toBe(1882.88)
    expect(out.taken.map(t => t.taken)).toEqual([3900, 3900, 2017.12])
    expect(out.taken[2].outstanding).toBe(1882.88)
    expect(out.why).toMatch(/carries to the next one/)
  })

  it('never takes more than is there, and never goes negative', () => {
    const out = netOff({ room: 0, charges: [charge('a', 249)] })
    expect(out.recovered).toBe(0)
    expect(out.carried).toBe(249)
    expect(out.taken).toEqual([])
  })

  /* A period that earned nothing and owes nothing is not in deficit. */
  it('treats a period already in the red as having nothing to give', () => {
    const out = netOff({ room: -500, charges: [charge('a', 100)] })
    expect(out.recovered).toBe(0)
    expect(out.carried).toBe(100)
  })

  it('picks up what an earlier period already recovered', () => {
    const out = netOff({ room: 5000, charges: [charge('a', 3900, 2017.12)] })
    expect(out.recovered).toBe(1882.88)
    expect(out.carried).toBe(0)
  })

  it('skips a charge that is already settled', () => {
    const out = netOff({ room: 5000, charges: [charge('a', 3900, 3900), charge('b', 249)] })
    expect(out.taken.map(t => t.charge_id)).toEqual(['b'])
  })
})

describe('what a partner may take', () => {
  const shelf = (over: Partial<Sellable> = {}): Sellable => ({
    id: 'SKU-7002', name: 'Wholesale connectivity pack — 500 lines', status: 'live',
    audiences: ['partner'], partner_id: null, seller: 'Aventa Telecom',
    billing_period: 'monthly', ...over,
  })
  const beacon = { id: 'PTR-1009', name: 'Beacon Reseller Co', status: 'live' }

  it('lets a live seller take a live partner product', () => {
    expect(buyProblem(shelf(), beacon)).toBeNull()
  })

  it('refuses a product that is not on the partner shelf', () => {
    expect(buyProblem(shelf({ audiences: ['consumer'] }), beacon)).toMatch(/not sold to partners/)
  })

  it('refuses one the marketplace has not finished reviewing', () => {
    expect(buyProblem(shelf({ status: 'pending' }), beacon)).toMatch(/not live/)
  })

  /* A commission line and a charge line on one statement for one supply. */
  it('refuses a seller their own listing', () => {
    expect(buyProblem(shelf({ partner_id: 'PTR-1009' }), beacon)).toMatch(/does not buy from themselves/)
  })

  it('refuses an account that is not trading', () => {
    expect(buyProblem(shelf(), { id: 'PTR-1012', name: 'Northwind Mobility', status: 'onboarding' }))
      .toMatch(/not taken on by an account that is not trading/)
  })

  it('refuses a price it cannot bill by the month', () => {
    expect(buyProblem(shelf({ billing_period: 'yearly' }), beacon)).toMatch(/calendar month/)
  })
})

describe('saying it in words', () => {
  it('names a full month without an arithmetic aside', () => {
    expect(chargeLine({ product_name: 'White-label storefront', quantity: 1, days_charged: 31, days_in_period: 31 }))
      .toBe('White-label storefront × 1')
  })

  it('shows the fraction where there is one', () => {
    expect(chargeLine({ product_name: 'White-label storefront', quantity: 1, days_charged: 14, days_in_period: 31 }))
      .toBe('White-label storefront × 1, 14 of 31 days')
  })

  it('adds up a month and what is still owed', () => {
    expect(monthlyCost({ unit_price: 9.8, quantity: 20 })).toBe(196)
    expect(outstanding([{ gross: 3900, recovered: 2017.12 }, { gross: 249, recovered: 249 }])).toBe(1882.88)
  })

  it('knows whether it was running on a day', () => {
    expect(running(buy({ started_on: '2026-07-01', ends_on: '2026-08-15' }), '2026-08-01')).toBe(true)
    expect(running(buy({ started_on: '2026-07-01', ends_on: '2026-08-15' }), '2026-08-16')).toBe(false)
    expect(running(buy({ started_on: '2026-07-01' }), '2026-06-30')).toBe(false)
  })
})

/* Beacon's own listing is also pending. Both refusals are true and only one
   ends the question. */
describe('when two refusals are both true', () => {
  it('says it is yours rather than telling you to wait for it', () => {
    expect(buyProblem(
      { id: 'SKU-7004', name: 'Beacon wholesale data pack — 500 lines', status: 'pending',
        audiences: ['partner'], partner_id: 'PTR-1009', seller: 'Beacon Reseller Co',
        billing_period: 'monthly' },
      { id: 'PTR-1009', name: 'Beacon Reseller Co', status: 'live' },
    )).toMatch(/does not buy from themselves/)
  })
})

/* "Applied by note" was true while notes were the only thing in `adjustments`.
   A reseller's quarter now carries wholesale in the same column, and naming a
   document that does not exist is worse than naming none. */
describe('naming what moved a statement', () => {
  const note = { note_id: 'CN-1', kind: 'credit', amount: 100 }
  const charge = { charge_id: 'PC-1', kind: 'debit', amount: 3900 }

  it('says note when it is notes', () => {
    expect(adjustmentNoun([note])).toBe('by note')
  })

  it('says wholesale when it is wholesale, and counts it', () => {
    expect(adjustmentNoun([charge])).toBe('by a wholesale charge')
    expect(adjustmentNoun([charge, { charge_id: 'PC-2' }])).toBe('by wholesale charges')
  })

  it('names both where both are there', () => {
    expect(adjustmentNoun([note, charge])).toBe('by note and by wholesale charge')
  })

  it('does not fall over on a statement written before any of this existed', () => {
    expect(adjustmentSources(null)).toEqual({ notes: 0, charges: 0 })
    expect(adjustmentNoun(undefined)).toBe('by note')
  })
})
