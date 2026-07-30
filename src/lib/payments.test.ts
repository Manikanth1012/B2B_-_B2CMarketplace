import { describe, it, expect } from 'vitest'
import { isExpired, paymentSummary, type PaymentMethodRow } from './payments'

const card = (o: Partial<PaymentMethodRow> = {}): PaymentMethodRow => ({
  status: 'active', expires: '08/28', is_primary: false, ...o,
})

const now = new Date('2026-07-30T00:00:00Z')

describe('isExpired', () => {
  /* A card is good through the last day of its stated month — 07/26 is still valid on
     30 July 2026. Getting this wrong expires a working card a month early. */
  it('keeps a card valid to the end of its stated month', () => {
    expect(isExpired({ expires: '07/26' }, now)).toBe(false)
    expect(isExpired({ expires: '06/26' }, now)).toBe(true)
  })

  it('handles four-digit years and stray spaces', () => {
    expect(isExpired({ expires: '12/2026' }, now)).toBe(false)
    expect(isExpired({ expires: ' 01 / 26 ' }, now)).toBe(true)
  })

  /* A method with no expiry — a wallet, a direct debit, bill-to-mobile — never
     expires, and must not be reported as though it had. */
  it('treats a method with no expiry as never expiring', () => {
    expect(isExpired({ expires: null }, now)).toBe(false)
  })

  it('does not guess at something it cannot parse', () => {
    expect(isExpired({ expires: 'soon' }, now)).toBe(false)
    expect(isExpired({ expires: '13/26' }, now)).toBe(false)
  })
})

describe('paymentSummary', () => {
  it('says so plainly when there is nothing saved', () => {
    expect(paymentSummary([], now)).toBe('None saved')
  })

  it('counts what is actually there', () => {
    expect(paymentSummary([card(), card()], now)).toBe('2 cards saved')
    expect(paymentSummary([card()], now)).toBe('1 card saved')
  })

  it('calls out expired cards separately, since they cannot be charged', () => {
    expect(paymentSummary([card(), card({ expires: '01/25' })], now)).toBe('2 saved (1 expired)')
  })

  /* The bug: this row was the fixed string "3 saved (1 expired)" whatever was stored,
     so adding a card changed nothing behind the dialog. */
  it('moves when the data moves', () => {
    const one = paymentSummary([card()], now)
    const three = paymentSummary([card(), card(), card()], now)
    expect(one).not.toBe(three)
  })
})
