/* Paying at a provider that is not this marketplace. Topping up used to be one
   dropdown of saved instruments and an immediate write. */
import { describe, it, expect } from 'vitest'
import {
  offersIn, savedFor, canHandOff, referenceFor, fieldsFor, validateFields, luhn,
  instrumentLabel, describe as describeAttempt, stale, inFlight, canStart,
  NET_BANKS, HANDOFF_MINUTES, marketForWallet,
} from './gateway'
import type { PaymentMethod, MethodMarket, PaymentAttempt, SavedInstrument } from './gateway'
import { isExpired } from './payments'

const method = (over: Partial<PaymentMethod> = {}): PaymentMethod => ({
  id: 'card', label: 'Credit or debit card', kind: 'card',
  blurb: 'Visa, Mastercard, RuPay or Amex.', redirects: true,
  asks_for: 'Card number, expiry, CVV, then your bank’s one-time code',
  typical: 'about a minute', sort_order: 1, ...over,
})

const METHODS: PaymentMethod[] = [
  method(),
  method({ id: 'upi', label: 'UPI', kind: 'upi', asks_for: 'Your UPI ID', sort_order: 3 }),
  method({ id: 'netbanking', label: 'Net banking', kind: 'netbanking', asks_for: 'Your bank’s sign-in', sort_order: 2 }),
  method({ id: 'mobile_money', label: 'M-Pesa', kind: 'mobile_money', asks_for: 'Your M-Pesa number', sort_order: 4 }),
]

const LINKS: MethodMarket[] = [
  { method_id: 'upi', market_code: 'IN', provider: 'Razorpay', sort_order: 1 },
  { method_id: 'card', market_code: 'IN', provider: 'Razorpay', sort_order: 2 },
  { method_id: 'netbanking', market_code: 'IN', provider: 'Razorpay', sort_order: 3 },
  { method_id: 'mobile_money', market_code: 'KE', provider: 'Safaricom M-Pesa', sort_order: 1 },
  { method_id: 'card', market_code: 'KE', provider: 'Flutterwave', sort_order: 2 },
]

const attempt = (over: Partial<PaymentAttempt> = {}): PaymentAttempt => ({
  id: 'PA-1', reference: 'PAY-260805-3K2M', wallet_id: 'WAL-4100',
  amount: 2500, currency: 'INR', method_id: 'upi', market_code: 'IN',
  provider: 'Razorpay', instrument: 'UPI priya@okhdfcbank', state: 'initiated',
  failure_reason: null, gateway_ref: null,
  started_at: '2026-08-05T09:00:00Z', decided_at: null, ledger_id: null, ...over,
})

const money = (n: number) => `₹${n.toFixed(2)}`
const NOW = new Date('2026-08-05T09:05:00Z')

describe('what a market can be paid in', () => {
  it('offers each market its own rails, in that market’s order', () => {
    /* UPI first in India because the row that says so is per market, not per
       method — a global sort would put the same thing first everywhere. */
    expect(offersIn('IN', METHODS, LINKS).map(o => o.method.id)).toEqual(['upi', 'card', 'netbanking'])
    expect(offersIn('KE', METHODS, LINKS).map(o => o.method.id)).toEqual(['mobile_money', 'card'])
  })

  it('does not offer an Indian rail to somebody in Kenya', () => {
    expect(offersIn('KE', METHODS, LINKS).map(o => o.method.id)).not.toContain('upi')
  })

  it('names who would handle it, per market', () => {
    expect(offersIn('IN', METHODS, LINKS).find(o => o.method.id === 'card')?.provider).toBe('Razorpay')
    expect(offersIn('KE', METHODS, LINKS).find(o => o.method.id === 'card')?.provider).toBe('Flutterwave')
  })

  it('says nothing rather than inventing a method for a market with none', () => {
    expect(offersIn('AE', METHODS, LINKS)).toEqual([])
  })
})

describe('which market’s rails a wallet is topped up over', () => {
  const accepted = [
    { market_code: 'IN', currency: 'INR', is_default: true },
    { market_code: 'AE', currency: 'AED', is_default: true },
    { market_code: 'AE', currency: 'USD', is_default: false },
    { market_code: 'KE', currency: 'KES', is_default: true },
    { market_code: 'KE', currency: 'USD', is_default: false },
  ]

  it('follows the wallet’s own currency, not the price picker', () => {
    /* A rupee wallet browsing Kenyan prices is still taking rupees. Offering
       M-Pesa would send the customer to a provider that cannot take the money. */
    expect(marketForWallet('INR', accepted, 'KE')).toBe('IN')
  })

  it('breaks a tie between markets sharing a currency with the picker', () => {
    expect(marketForWallet('USD', accepted, 'KE')).toBe('KE')
    expect(marketForWallet('USD', accepted, 'AE')).toBe('AE')
  })

  it('prefers the market that holds the currency as its default', () => {
    expect(marketForWallet('USD', accepted, null)).toBe('AE')
  })

  it('says nothing rather than guessing for a currency nobody takes', () => {
    expect(marketForWallet('GBP', accepted, 'IN')).toBeNull()
  })
})

describe('instruments already on the account', () => {
  const saved: SavedInstrument[] = [
    { id: 'PM-1', kind: 'Bill to mobile', detail: '+91 98860 41127', expires: null, is_primary: true, status: 'active' },
    { id: 'PM-2', kind: 'Visa', detail: '•••• 4419', expires: '09/2028', is_primary: false, status: 'active' },
    { id: 'PM-3', kind: 'Mastercard', detail: '•••• 8871', expires: '03/2026', is_primary: false, status: 'expired' },
  ]

  it('offers a saved card for a card payment and nothing for the rest', () => {
    expect(savedFor(method(), saved, isExpired).map(s => s.id)).toEqual(['PM-2'])
    expect(savedFor(method({ kind: 'upi' }), saved, isExpired)).toEqual([])
  })

  it('leaves out a card that has expired, rather than sending somebody to be refused', () => {
    expect(savedFor(method(), saved, isExpired).map(s => s.id)).not.toContain('PM-3')
  })
})

describe('going to the provider', () => {
  const offers = offersIn('IN', METHODS, LINKS)

  it('says what is about to happen, including that nothing lands until they answer', () => {
    const r = canHandOff({ amount: 2500, method: METHODS[1], offers })
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.note).toMatch(/Razorpay/)
      expect(r.note).toMatch(/Nothing is added to your wallet until/)
    }
  })

  it('refuses a method that market does not offer', () => {
    const r = canHandOff({ amount: 2500, method: METHODS[1], offers: offersIn('KE', METHODS, LINKS) })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/not offered here/)
  })

  it('says something useful when a market has no rails at all', () => {
    const r = canHandOff({ amount: 2500, method: METHODS[0], offers: [] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Support can take the top-up/)
  })

  it('asks for a choice before an amount problem', () => {
    const r = canHandOff({ amount: 0, method: null, offers })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Choose how/)
  })

  it('makes a reference short enough to read down a phone', () => {
    const ref = referenceFor(new Date('2026-08-05T09:00:00Z'), 123456789)
    expect(ref).toMatch(/^PAY-260805-[0-9A-Z]{4}$/)
  })
})

describe('the provider’s own page', () => {
  it('asks a card customer for a card and a UPI customer for a UPI ID', () => {
    expect(fieldsFor(method(), null).map(f => f.key)).toEqual(['number', 'expiry', 'cvv', 'name'])
    expect(fieldsFor(method({ kind: 'upi' }), null).map(f => f.key)).toEqual(['vpa'])
    expect(fieldsFor(method({ kind: 'netbanking' }), null)[0].options).toEqual(NET_BANKS)
  })

  it('asks a saved card only for the CVV', () => {
    const fields = fieldsFor(method(), '•••• 4419')
    expect(fields.map(f => f.key)).toEqual(['cvv'])
    expect(fields[0].label).toMatch(/4419/)
  })

  it('catches a mistyped card on the page rather than as a failed payment', () => {
    const bad = validateFields(method(), { number: '4111 1111 1111 1112', expiry: '09/28', cvv: '123', name: 'P Raman' })
    expect(bad.ok).toBe(false)
    if (!bad.ok) expect(bad.reason).toMatch(/does not check out/)

    expect(validateFields(method(), {
      number: '4111 1111 1111 1111', expiry: '09/28', cvv: '123', name: 'P Raman',
    }).ok).toBe(true)
  })

  it('does the check a card issuer does', () => {
    expect(luhn('4111111111111111')).toBe(true)
    expect(luhn('4111111111111112')).toBe(false)
    expect(luhn('')).toBe(false)
    expect(luhn('41111x1111111111')).toBe(false)
  })

  it('refuses an expiry that is not a month', () => {
    const r = validateFields(method(), { number: '4111111111111111', expiry: '13/28', cvv: '123', name: 'P' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/no month 13/)
  })

  it('refuses a UPI ID that is not one, and says where to look', () => {
    const r = validateFields(method({ kind: 'upi' }), { vpa: 'priya' })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/check it in your app/)
    expect(validateFields(method({ kind: 'upi' }), { vpa: 'priya@okhdfcbank' }).ok).toBe(true)
  })

  it('insists on a bank from the list rather than anything typed', () => {
    expect(validateFields(method({ kind: 'netbanking' }), { bank: 'My Bank' }).ok).toBe(false)
    expect(validateFields(method({ kind: 'netbanking' }), { bank: 'HDFC Bank' }).ok).toBe(true)
  })

  it('names what the provider charged, per method', () => {
    expect(instrumentLabel(method(), { number: '4111111111111111' }, null)).toBe('card ending 1111')
    expect(instrumentLabel(method(), {}, '•••• 4419')).toBe('•••• 4419')
    expect(instrumentLabel(method({ kind: 'netbanking' }), { bank: 'HDFC Bank' }, null)).toBe('HDFC Bank net banking')
    expect(instrumentLabel(method({ kind: 'upi' }), { vpa: 'priya@okhdfcbank' }, null)).toBe('UPI priya@okhdfcbank')
  })
})

describe('coming back, or not', () => {
  it('reports a success with what paid it and the reference', () => {
    const d = describeAttempt(attempt({ state: 'succeeded', ledger_id: 'WPA-1', decided_at: '2026-08-05T09:01:00Z' }), money, NOW)
    expect(d.tone).toBe('good')
    expect(d.detail).toMatch(/PAY-260805-3K2M/)
  })

  it('says nothing was charged when the provider refused', () => {
    /* A customer who thinks they have been charged for a refused payment rings
       support; one told plainly does not. */
    const d = describeAttempt(attempt({
      state: 'failed', decided_at: '2026-08-05T09:01:00Z',
      failure_reason: 'Your bank declined it.',
    }), money, NOW)
    expect(d.tone).toBe('bad')
    expect(d.detail).toMatch(/Nothing was added and nothing was charged/)
  })

  it('refuses to guess about one that never came back', () => {
    /* The money may have left their account. Calling it "failed" is a guess,
       and it is the guess that turns a confused customer into a chargeback. */
    const d = describeAttempt(attempt(), money, NOW)
    expect(d.tone).toBe('waiting')
    expect(d.detail).toMatch(/Nothing is added to your wallet until they answer/)
  })

  it('changes what it says once nobody should still be waiting', () => {
    const later = new Date('2026-08-05T09:40:00Z')
    const d = describeAttempt(attempt(), money, later)
    expect(d.detail).toMatch(/Do not pay again/)
    expect(stale([attempt()], later)).toHaveLength(1)
    expect(stale([attempt()], NOW)).toHaveLength(0)
  })

  it('tells somebody whose payment timed out that a debit comes back', () => {
    const d = describeAttempt(attempt({ state: 'expired', decided_at: '2026-08-05T09:20:00Z' }), money, NOW)
    expect(d.detail).toMatch(new RegExp(`${HANDOFF_MINUTES} minutes`))
    expect(d.detail).toMatch(/returned automatically/)
  })
})

describe('starting another one', () => {
  it('finds the one still in flight', () => {
    expect(inFlight([attempt({ state: 'succeeded', ledger_id: 'W1', decided_at: 'x' }), attempt({ id: 'PA-2' })])?.id).toBe('PA-2')
    expect(inFlight([attempt({ state: 'cancelled', decided_at: 'x' })])).toBeNull()
  })

  it('refuses a second payment while one is at the provider, and says why', () => {
    /* One top-up becoming two charges is the failure this exists to prevent. */
    const r = canStart([attempt()], NOW)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/charged twice/)
  })

  it('lets somebody through once the first is past hope, with a warning', () => {
    const later = new Date('2026-08-05T09:40:00Z')
    const r = canStart([attempt()], later)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toMatch(/never came back/)
  })

  it('says yes when there is nothing outstanding', () => {
    expect(canStart([], NOW).ok).toBe(true)
    expect(canStart([attempt({ state: 'failed', decided_at: 'x', failure_reason: 'Declined.' })], NOW).ok).toBe(true)
  })
})
