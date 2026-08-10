import { describe, it, expect } from 'vitest'
import {
  cycleLength, advance, nextAfter, skipReason, isDue, chargeFor, plan, renewalLine,
  ownedByMarketplace, daysLate, band, reportProblem,
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
    expect(plan(book, '2026-04-01')).toEqual({ charge: [], roll: [], skip: [], awaiting: [] })
  })
})

/* The correction this module was rewritten for. A subscription sold by a seller
   is renewed by that seller; a run that rolls their date on their behalf is
   asserting a renewal that may never have happened. */
describe('who renews what', () => {
  const mine = sub({ ref: 'OURS', vendor: null, seller: 'Aventa Telecom' })
  const theirs = sub({ ref: 'THEIRS', vendor: 'PTR-1007', seller: 'Halo Audio' })

  it('knows a marketplace line from a seller line', () => {
    expect(ownedByMarketplace(mine)).toBe(true)
    expect(ownedByMarketplace(theirs)).toBe(false)
    /* Absent is ours: every row on file before the split was the marketplace's
       to renew as far as the old run was concerned, and a missing column must
       not silently hand a subscription to a vendor. */
    expect(ownedByMarketplace(sub({ vendor: undefined }))).toBe(true)
  })

  it('charges what we sell and waits on what we do not', () => {
    const p = plan([mine, theirs], '2026-08-10')
    expect(p.charge.map(c => c.ref)).toEqual(['OURS'])
    expect(p.roll.map(r => r.ref)).toEqual(['OURS'])
    expect(p.awaiting.map(a => a.ref)).toEqual(['THEIRS'])
  })

  it('names the vendor and says why on everything it is waiting for', () => {
    const [a] = plan([theirs], '2026-08-10').awaiting
    expect(a.vendor).toBe('Halo Audio')
    expect(a.due).toBe('2026-08-09')
    expect(a.daysLate).toBe(1)
    expect(a.why).toMatch(/Halo Audio/)
    expect(a.why).toMatch(/does not roll a date it does not own/)
  })

  /* A lapsed subscription is nobody's to renew, so there is nothing to wait on
     a vendor for and it must not appear as work. */
  it('does not chase a vendor for one that was never going to renew', () => {
    const p = plan([sub({ ref: 'X', vendor: 'PTR-1007', auto_renew: false })], '2026-08-10')
    expect(p.awaiting).toEqual([])
    expect(p.skip.map(s => s.ref)).toEqual(['X'])
  })

  it('counts the days late and never counts them backwards', () => {
    expect(daysLate('2026-08-04', '2026-08-10')).toBe(6)
    expect(daysLate('2026-09-04', '2026-08-10')).toBe(0)
    expect(daysLate(null, '2026-08-10')).toBe(0)
  })

  /* A day late is an overnight job that has not landed. A month late is a
     subscription somebody is still using that nobody has billed for. */
  it('separates a slow morning from a missing month', () => {
    expect(band(0)).toBe('watch')
    expect(band(6)).toBe('watch')
    expect(band(7)).toBe('chase')
    expect(band(30)).toBe('escalate')
  })
})

describe('what a vendor may report', () => {
  const theirs = sub({ ref: 'SUB-KE-450121', vendor: 'PTR-1009', seller: 'Beacon Reseller Co' })

  it('accepts the cycle that is due', () => {
    expect(reportProblem(theirs, '2026-08-09', '2026-08-10')).toBeNull()
  })

  it('refuses a cycle that has not started', () => {
    expect(reportProblem(sub({ vendor: 'PTR-1009', next_renewal: '2026-09-09' }), '2026-09-09', '2026-08-10'))
      .toMatch(/has not started/)
  })

  it('refuses a cycle that is not the one due, so nothing is skipped over', () => {
    expect(reportProblem(theirs, '2026-07-09', '2026-08-10')).toMatch(/is the one to report/)
  })

  /* Answered rather than refused: a retry from a vendor's own system is not an
     error, and telling them it is teaches them nothing about what to do. */
  it('says a cycle already on file is already on file', () => {
    expect(reportProblem(theirs, '2026-08-09', '2026-08-10', ['2026-08-09']))
      .toMatch(/already been reported/)
  })

  it('refuses one the marketplace sells, because the run raises that', () => {
    expect(reportProblem(sub({ vendor: null }), '2026-08-09', '2026-08-10'))
      .toMatch(/sold by the marketplace/)
  })

  it('refuses one that is lapsing or already gone', () => {
    expect(reportProblem(sub({ vendor: 'PTR-1009', auto_renew: false }), '2026-08-09', '2026-08-10'))
      .toMatch(/Auto-renew is off/)
    expect(reportProblem(sub({ vendor: 'PTR-1009', status: 'cancelled' }), '2026-08-09', '2026-08-10'))
      .toMatch(/cancelled/)
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

  /* The same date means two different things depending on who bills it. On one
     a seller bills, the customer's service is running and the gap is ours, so
     telling them they are overdue would be alarming and wrong. */
  it('does not tell a customer they are overdue when it is the seller we are waiting on', () => {
    expect(renewalLine(sub({ next_renewal: '2026-08-04', vendor: 'PTR-1009', seller: 'Beacon Reseller Co' }), '2026-08-10'))
      .toBe('Renewing — awaiting confirmation from Beacon Reseller Co')
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
