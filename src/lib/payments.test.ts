import { describe, it, expect } from 'vitest'
import { isExpired, paymentSummary, type PaymentMethodRow , paymentLabel} from './payments'

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

describe('what an order says about how it was paid', () => {
  const METHODS = [
    { id: 'card', label: 'Credit or debit card' },
    { id: 'mobile_money', label: 'M-Pesa' },
    { id: 'upi', label: 'UPI' },
  ]

  it('translates a gateway id through the table that already holds the words', () => {
    /* A customer in Kisumu read "mobile_money" on the order card while the
       payment-methods card on the same account said "M-Pesa". */
    expect(paymentLabel('mobile_money', METHODS)).toBe('M-Pesa')
    expect(paymentLabel('card', METHODS)).toBe('Credit or debit card')
    expect(paymentLabel('upi', METHODS)).toBe('UPI')
  })

  it('leaves an arrangement alone, because it is already the sentence', () => {
    /* Fourteen orders, every one of them enterprise. An arrangement is
       negotiated, not picked at a checkout, so there is no gateway id to
       normalise it to. */
    expect(paymentLabel('On account — Net 30', METHODS)).toBe('On account — Net 30')
    expect(paymentLabel('Invoice', METHODS)).toBe('Invoice')
    expect(paymentLabel('Bill to mobile · card ending 4419', METHODS))
      .toBe('Bill to mobile · card ending 4419')
  })

  it('humanises a token the table no longer knows', () => {
    /* An old order should not start showing machine text because somebody
       tidied the lookup table years later. */
    expect(paymentLabel('carrier_billing', METHODS)).toBe('Carrier billing')
    expect(paymentLabel('net-banking', METHODS)).toBe('Net banking')
  })

  it('says something rather than nothing when the order does not record one', () => {
    expect(paymentLabel(null, METHODS)).toBe('—')
    expect(paymentLabel('', METHODS)).toBe('—')
    expect(paymentLabel('   ', METHODS)).toBe('—')
  })

  it('still reads sensibly before the lookup table has loaded', () => {
    /* Every screen starts in this state, and an order card that prints
       "mobile_money" for a second is the bug appearing intermittently. */
    expect(paymentLabel('mobile_money')).toBe('Mobile money')
    expect(paymentLabel('On account — Net 30')).toBe('On account — Net 30')
  })

  it('prefers the table to its own guess', () => {
    /* The humanising rule must never override a real label — "M-Pesa" is not
       reachable by de-underscoring "mobile_money". */
    expect(paymentLabel('mobile_money', METHODS)).not.toBe('Mobile money')
  })
})
