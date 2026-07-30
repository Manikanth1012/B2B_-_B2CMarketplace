import { describe, it, expect } from 'vitest'
import {
  SHARING, REQUEST_KINDS, REQUEST_IMPACT, RESPONSE_DAYS, dueDate, toIsoDate,
  CLOSURE_NOTICE_DAYS, CLOSURE_CONFIRM_WORD, closureEffective, closureImpact,
  canScheduleClosure,
} from './privacy'

describe('the sharing disclosure', () => {
  /* Deliberately not toggles. A switch that cannot really stop the sharing — a
     seller shipping a parcel must have the address — is worse than the sentence. */
  it('says what is shared and what never is', () => {
    expect(SHARING.filter(s => s.shared).map(s => s.what))
      .toEqual(['Your name and delivery address', 'Your email'])
    expect(SHARING.filter(s => !s.shared).map(s => s.what))
      .toEqual(['Your mobile number', 'What you browse'])
  })

  it('explains every line rather than leaving a bare label', () => {
    for (const s of SHARING) expect(s.detail.length).toBeGreaterThan(20)
  })
})

describe('data requests', () => {
  it('offers the three scopes rather than all-or-nothing', () => {
    expect(REQUEST_KINDS).toHaveLength(3)
    expect(REQUEST_KINDS[0]).toBe('Everything held about me')
  })

  it('is due the statutory 30 days after it was raised', () => {
    const raised = new Date('2026-07-30T00:00:00Z')
    expect(toIsoDate(dueDate(raised))).toBe('2026-08-29')
    expect(RESPONSE_DAYS).toBe(30)
  })

  it('crosses a month end correctly', () => {
    expect(toIsoDate(dueDate(new Date('2026-12-20T00:00:00Z')))).toBe('2027-01-19')
  })

  /* The commitments are stated before the request is made, not after. */
  it('says what we are committing to, including that sellers hold their own copy', () => {
    expect(REQUEST_IMPACT.join(' ')).toMatch(/30 days/)
    expect(REQUEST_IMPACT.join(' ')).toMatch(/seller/i)
  })
})

describe('closure', () => {
  const effective = ' 29 Aug 2026'

  it('takes effect 30 days out, not immediately', () => {
    expect(CLOSURE_NOTICE_DAYS).toBe(30)
    expect(toIsoDate(closureEffective(new Date('2026-07-30T00:00:00Z')))).toBe('2026-08-29')
  })

  it('needs the word typed, case-insensitively but not loosely', () => {
    expect(canScheduleClosure('CLOSE')).toBe(true)
    expect(canScheduleClosure('  close ')).toBe(true)
    expect(canScheduleClosure('CLOS')).toBe(false)
    expect(canScheduleClosure('')).toBe(false)
    expect(CLOSURE_CONFIRM_WORD).toBe('CLOSE')
  })

  /* Somebody about to close an account is owed the specifics, from live data — which
     subscriptions stop, and what happens to money they are owed. */
  it('names the subscriptions that stop and what they cost', () => {
    const lines = closureImpact({
      activeSubscriptions: [{ price: 12.99 }, { price: 14.99 }, { price: 18 }, { price: 6.9 }],
      ordersInFlight: 2, walletBalance: 42.6, householdMembers: 5,
    }, effective)
    expect(lines.join(' ')).toMatch(/4 active subscriptions \(\$52\.88 a month\)/)
    expect(lines.join(' ')).toMatch(/2 orders are still in flight/)
    expect(lines.join(' ')).toMatch(/wallet balance of \$42\.60 is refunded/)
    expect(lines.join(' ')).toMatch(/4 household members lose access/)
  })

  /* Silence about the wallet reads as "you lose it", so zero is stated too. */
  it('says the wallet is empty rather than saying nothing', () => {
    const lines = closureImpact({
      activeSubscriptions: [], ordersInFlight: 0, walletBalance: 0, householdMembers: 1,
    }, effective)
    expect(lines.join(' ')).toMatch(/wallet is empty/)
    expect(lines.join(' ')).toMatch(/no active subscriptions/i)
    expect(lines.join(' ')).toMatch(/No orders are in flight/)
  })

  it('leaves household out when there is nobody else on the account', () => {
    const lines = closureImpact({
      activeSubscriptions: [], ordersInFlight: 0, walletBalance: 0, householdMembers: 1,
    }, effective)
    expect(lines.join(' ')).not.toMatch(/household/i)
  })

  it('always says the account keeps working until the date', () => {
    const lines = closureImpact({
      activeSubscriptions: [], ordersInFlight: 0, walletBalance: 0, householdMembers: 1,
    }, effective)
    expect(lines[0]).toMatch(/stop it at any point/)
    expect(lines[0]).toContain(effective.trim())
  })

  it('is honest that records are kept for the tax period', () => {
    const lines = closureImpact({
      activeSubscriptions: [], ordersInFlight: 0, walletBalance: 0, householdMembers: 1,
    }, effective)
    expect(lines.join(' ')).toMatch(/tax law/i)
  })
})
