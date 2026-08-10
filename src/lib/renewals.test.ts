import { describe, it, expect } from 'vitest'
import {
  cycleLength, advance, nextAfter, skipReason, isDue, chargeFor, plan, renewalLine,
} from './renewals'
import type { Subscription } from './renewals'

const sub = (over: Partial<Subscription> = {}): Subscription => ({
  id: 'b566aca4-6d88-4bdd-a571-6461891fa252', ref: 'SUB-9102',
  product_id: 'SKU-3005', product_name: 'Halo Music Family', seller: 'Halo Audio',
  status: 'active', auto_renew: true, next_renewal: '2026-08-09',
  ends_at: null, resumes_at: null, price: 1299, currency: 'INR', cycle: 'Monthly',
  ...over,
})

describe('how long a cycle is', () => {
  it('knows the ones this marketplace sells', () => {
    expect(cycleLength('Monthly')).toBe(1)
    expect(cycleLength('Quarterly')).toBe(3)
    expect(cycleLength('Half-yearly')).toBe(6)
    expect(cycleLength('Yearly')).toBe(12)
    expect(cycleLength('Annual')).toBe(12)
  })

  /* A cycle nobody recognises is a data problem. Refusing to render the screen
     over it helps nobody — the run's skip list is where it should surface. */
  it('falls back to monthly rather than throwing', () => {
    expect(cycleLength('fortnightly')).toBe(1)
    expect(cycleLength(null)).toBe(1)
    expect(cycleLength(undefined)).toBe(1)
  })
})

describe('moving a renewal date', () => {
  it('keeps the billing day the customer agreed to', () => {
    expect(advance('2026-08-09', 'Monthly')).toBe('2026-09-09')
    expect(advance('2026-08-09', 'Quarterly')).toBe('2026-11-09')
    expect(advance('2026-08-09', 'Yearly')).toBe('2027-08-09')
  })

  /* Whole cycles from the agreed date, never today plus a month — otherwise a
     late run walks the customer's billing day forward for ever. */
  it('walks whole cycles when the run is late', () => {
    expect(nextAfter('2026-05-09', 'Monthly', '2026-08-10')).toBe('2026-09-09')
    expect(advance('2026-05-09', 'Monthly', 4)).toBe('2026-09-09')
  })

  it('lands on the last day of a month that is too short', () => {
    expect(advance('2026-01-31', 'Monthly')).toBe('2026-02-28')
    /* And does not then stay on the 28th — the agreed day is 31. */
    expect(advance('2026-01-31', 'Monthly', 2)).toBe('2026-03-31')
  })

  it('does not move a date that is already in the future', () => {
    expect(nextAfter('2026-09-09', 'Monthly', '2026-08-10')).toBe('2026-09-09')
  })
})

describe('what does not renew', () => {
  it('renews an ordinary active subscription', () => {
    expect(skipReason(sub())).toBeNull()
    expect(isDue(sub(), '2026-08-10')).toBe(true)
  })

  it('is not due before its date', () => {
    expect(isDue(sub({ next_renewal: '2026-09-09' }), '2026-08-10')).toBe(false)
  })

  /* Charging somebody for a cycle they had already cancelled out of. */
  it('refuses one that ends before it would renew', () => {
    const out = skipReason(sub({ ends_at: '2026-08-01' }))
    expect(out?.kind).toBe('ends')
    expect(out?.why).toMatch(/Nothing renewed and nothing charged/)
  })

  it('lapses one with auto-renew off rather than charging it', () => {
    const out = skipReason(sub({ auto_renew: false }))
    expect(out?.kind).toBe('no-auto-renew')
    expect(out?.why).toMatch(/lapses/)
  })

  it('does nothing at all for a paused or cancelled one', () => {
    expect(skipReason(sub({ status: 'paused' }))?.kind).toBe('not-active')
    expect(skipReason(sub({ status: 'cancelled' }))?.kind).toBe('not-active')
  })
})

describe('the cycle being charged', () => {
  it('charges the cycle that starts on the renewal date', () => {
    expect(chargeFor(sub())).toMatchObject({
      period_start: '2026-08-09', period_end: '2026-09-08',
      period_label: 'Aug 2026', amount: 1299, currency: 'INR',
    })
  })

  it('spans the whole cycle on a longer one', () => {
    expect(chargeFor(sub({ cycle: 'Quarterly' }))).toMatchObject({
      period_start: '2026-08-09', period_end: '2026-11-08',
    })
  })

  it('has nothing to charge with no date', () => {
    expect(chargeFor(sub({ next_renewal: null }))).toBeNull()
  })
})

describe('what a run would do before it does it', () => {
  const book = [
    sub({ ref: 'A', next_renewal: '2026-08-09' }),
    sub({ ref: 'B', next_renewal: '2026-09-20' }),
    sub({ ref: 'C', next_renewal: '2026-08-01', auto_renew: false }),
    sub({ ref: 'D', next_renewal: '2026-08-01', ends_at: '2026-07-31' }),
    sub({ ref: 'E', next_renewal: '2026-05-09' }),
  ]

  it('charges what is due, leaves what is not, and names every refusal', () => {
    const p = plan(book, '2026-08-10')
    expect(p.charge.map(c => c.ref)).toEqual(['A', 'E'])
    expect(p.roll.map(r => r.ref)).toEqual(['A', 'E'])
    expect(p.skip.map(s => s.ref)).toEqual(['C', 'D'])
    for (const s of p.skip) expect(s.why.length).toBeGreaterThan(10)
  })

  /* Late runs catch up to the current cycle rather than to the next one. */
  it('rolls a late subscription to the cycle it is actually in', () => {
    const p = plan(book, '2026-08-10')
    expect(p.roll.find(r => r.ref === 'E')).toEqual(
      { ref: 'E', from: '2026-05-09', to: '2026-09-09' })
  })

  it('does nothing on a day nothing is due', () => {
    expect(plan(book, '2026-04-01')).toEqual({ charge: [], roll: [], skip: [] })
  })
})

describe('what the customer is told', () => {
  it('says when it renews', () => {
    expect(renewalLine(sub({ next_renewal: '2026-09-09' }), '2026-08-10'))
      .toBe('Renews 2026-09-09')
  })

  /* The defect this module exists for. A date in the past printed plainly is a
     screen telling somebody everything is fine while nothing is billing. */
  it('says overdue rather than printing a date that has gone', () => {
    expect(renewalLine(sub({ next_renewal: '2026-08-09' }), '2026-08-10'))
      .toBe('Overdue for renewal since 2026-08-09')
  })

  it('says when a pause ends', () => {
    expect(renewalLine(sub({ status: 'paused', resumes_at: '2026-10-01' }), '2026-08-10'))
      .toBe('Paused — resumes 2026-10-01')
  })

  it('says lapses rather than renews where auto-renew is off', () => {
    expect(renewalLine(sub({ auto_renew: false, next_renewal: '2026-09-09' }), '2026-08-10'))
      .toBe('Lapses 2026-09-09')
  })

  it('says ends where it ends', () => {
    expect(renewalLine(sub({ ends_at: '2026-08-01' }), '2026-08-10')).toBe('Ends 2026-08-01')
  })
})
