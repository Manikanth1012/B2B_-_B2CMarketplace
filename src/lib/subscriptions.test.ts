import { describe, it, expect } from 'vitest'
import {
  formatDateOnly, statusLine, monthlyTotal, actionsFor,
  isActive, isPaused, isCancelled, type SubscriptionRow,
} from './subscriptions'

const sub = (o: Partial<SubscriptionRow> = {}): SubscriptionRow => ({
  status: 'active', auto_renew: true, started_at: '2025-01-14T00:00:00+00:00',
  next_renewal: '2026-08-14', ends_at: null, resumes_at: null,
  price: 6.9, cycle: 'Monthly', ...o,
})

describe('formatDateOnly', () => {
  /* The bug this exists to prevent: `new Date('2026-08-02')` is UTC midnight, which
     renders as 1 August anywhere west of Greenwich. A renewal date shown a day early
     is a support ticket. */
  it('reads the date as written, with no timezone shift', () => {
    expect(formatDateOnly('2026-08-02')).toBe('2 Aug 2026')
    expect(formatDateOnly('2026-01-01')).toBe('1 Jan 2026')
    expect(formatDateOnly('2026-12-31')).toBe('31 Dec 2026')
  })

  it('tolerates a full timestamp by taking its date part', () => {
    expect(formatDateOnly('2026-08-02T23:30:00+00:00')).toBe('2 Aug 2026')
  })

  it('hands back anything it cannot parse rather than printing NaN', () => {
    expect(formatDateOnly('not a date')).toBe('not a date')
  })
})

describe('status predicates', () => {
  it('reads the status case-insensitively', () => {
    expect(isActive({ status: 'Active' })).toBe(true)
    expect(isPaused({ status: 'PAUSED' })).toBe(true)
    expect(isCancelled({ status: 'cancelled' })).toBe(true)
    expect(isActive({ status: 'paused' })).toBe(false)
  })
})

describe('statusLine', () => {
  it('tells an active subscription when it next takes money', () => {
    expect(statusLine(sub())).toBe('Renews 14 Aug 2026')
  })

  /* Auto-renew off is not cancellation: it runs to the date already paid for and
     stops there. Saying "Renews" would be wrong and saying "Cancelled" would be
     alarming, so it says what actually happens. */
  it('distinguishes auto-renew off from cancelled', () => {
    expect(statusLine(sub({ auto_renew: false }))).toBe('Ends 14 Aug 2026 — auto-renew off')
    expect(statusLine(sub({ status: 'cancelled', auto_renew: false, next_renewal: null, ends_at: '2026-08-19' })))
      .toBe('Cancelled · access until 19 Aug 2026')
  })

  it('tells a paused subscription when it starts billing again', () => {
    expect(statusLine(sub({ status: 'paused', auto_renew: false, next_renewal: null, resumes_at: '2026-09-01' })))
      .toBe('Paused · resumes 1 Sep 2026')
  })

  it('degrades to the bare state when the date is missing', () => {
    expect(statusLine(sub({ status: 'paused', resumes_at: null, next_renewal: null }))).toBe('Paused')
    expect(statusLine(sub({ status: 'cancelled', ends_at: null, next_renewal: null }))).toBe('Cancelled')
    expect(statusLine(sub({ next_renewal: null }))).toBe('Active')
  })
})

describe('monthlyTotal', () => {
  it('counts only what is actually billing', () => {
    const all = [
      sub({ price: 12.99 }),
      sub({ price: 14.99 }),
      sub({ price: 9.99, status: 'cancelled' }),
      sub({ price: 6.49, status: 'paused' }),
    ]
    expect(monthlyTotal(all)).toBeCloseTo(27.98, 2)
  })

  it('is zero for an empty or entirely dormant list', () => {
    expect(monthlyTotal([])).toBe(0)
    expect(monthlyTotal([sub({ status: 'paused' })])).toBe(0)
  })

  /* Priya's seeded six: four active at 12.99 + 14.99 + 18.00 + 6.90. */
  it('matches the seeded consumer account', () => {
    const seeded = [
      sub({ price: 12.99 }), sub({ price: 14.99 }), sub({ price: 18.00 }), sub({ price: 6.90 }),
      sub({ price: 9.99, status: 'cancelled' }), sub({ price: 6.49, status: 'paused' }),
    ]
    expect(monthlyTotal(seeded)).toBeCloseTo(52.88, 2)
  })
})

describe('actionsFor', () => {
  it('offers renew and cancel on an active subscription', () => {
    expect(actionsFor(sub())).toEqual({ canToggleRenew: true, canCancel: true, canResume: false })
  })

  /* The dead end this fixes: the old screen rendered controls only for active rows,
     so a paused subscription could never be brought back. */
  it('lets a paused subscription be resumed', () => {
    const can = actionsFor(sub({ status: 'paused' }))
    expect(can.canResume).toBe(true)
    expect(can.canCancel).toBe(true)
  })

  it('offers nothing on a cancelled one — resubscribing is a purchase', () => {
    expect(actionsFor(sub({ status: 'cancelled' })))
      .toEqual({ canToggleRenew: false, canCancel: false, canResume: false })
  })
})
