/* Paying at a provider that is not this marketplace. Topping up used to be one
   dropdown of saved instruments and an immediate write. */
import { describe, it, expect } from 'vitest'
import {
  offersIn, savedFor, canHandOff, referenceFor, fieldsFor, validateFields, luhn,
  instrumentLabel, describe as describeAttempt, stale, inFlight, canStart,
  NET_BANKS, HANDOFF_MINUTES, marketForWallet, WALLET_BRANDS,
  confirmFor, validateConfirm, oneTimeCode, walletPin, nextBillDate, mask,
  limitsFor, isFinanced, instalmentOf, longestTenure, financingProblem,
  financingNote, planLine, tenureOf,
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


describe('the two rails a telecom marketplace ought to have', () => {
  const wallet = method({ id: 'mobile_wallet', label: 'Mobile wallet', kind: 'mobile_wallet' })
  const carrier = method({
    id: 'carrier_billing', label: 'Add to your telecom bill', kind: 'carrier_billing',
    max_amount: 30000,
  })

  it('asks a wallet customer which wallet, from ones they would recognise', () => {
    const fields = fieldsFor(wallet, null)
    expect(fields.map(f => f.key)).toEqual(['wallet', 'msisdn'])
    expect(fields[0].options).toEqual(WALLET_BRANDS)
  })

  it('asks carrier billing for the number the bill belongs to, and nothing else', () => {
    expect(fieldsFor(carrier, null).map(f => f.key)).toEqual(['msisdn'])
  })

  it('refuses a carrier-billed purchase over the ceiling, and names a way to pay', () => {
    /* A monthly telecom bill is not a credit line. Refusing here beats the
       operator's billing refusing it three days later. */
    const offers = [{ method: carrier, provider: 'Aventa Telecom billing', min_amount: null, max_amount: 30000 }]
    const r = canHandOff({ amount: 66098, method: carrier, offers })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/Pay by card or from your bank instead/)
    expect(canHandOff({ amount: 1099, method: carrier, offers }).ok).toBe(true)
  })

  it('shows a number back the way a provider does', () => {
    expect(mask('+91 98860 41127')).toBe('•••••• 1127')
    expect(mask('411')).toBe('411')
  })

  it('names what was charged', () => {
    expect(instrumentLabel(wallet, { wallet: 'PayTM', msisdn: '9886041127' }, null))
      .toBe('PayTM wallet •••••• 1127')
    expect(instrumentLabel(carrier, { msisdn: '9886041127' }, null))
      .toBe('the Aventa bill for •••••• 1127')
  })
})

describe('the provider\u2019s second step', () => {
  const REF = 'PAY-260805-3K2M'
  const money = (n: number) => `\u20b9${n.toFixed(2)}`
  const step = (m: PaymentMethod, values: Record<string, string> = {}) =>
    confirmFor({ method: m, values, reference: REF, amount: 2500, savedLabel: null, money,
                 now: new Date('2026-08-05T00:00:00Z') })

  it('gives a card payment the bank check that actually decides it', () => {
    /* A page that takes a card number and immediately says "paid" is not a
       payment page, it is a form. */
    const s = step(method(), { number: '4111111111111111' })
    expect(s.title).toMatch(/Verify with your bank/)
    expect(s.fields.map(f => f.key)).toEqual(['otp'])
    expect(s.shown).toBe(oneTimeCode(REF))
    expect(s.facts.find(f => f.label === 'Card')?.value).toBe('\u2022\u2022\u2022\u2022 1111')
  })

  it('sends a UPI customer to their own app, with nothing to type here', () => {
    const s = step(method({ kind: 'upi' }), { vpa: 'priya@okhdfcbank' })
    expect(s.fields).toEqual([])
    expect(s.shown).toBeNull()
    expect(s.action).toMatch(/approved it/)
  })

  it('sends an M-Pesa customer to the handset, because that is where the PIN goes', () => {
    const s = step(method({ kind: 'mobile_money' }), { msisdn: '0722431908' })
    expect(s.blurb).toMatch(/nothing is typed here/i)
    expect(s.fields).toEqual([])
  })

  it('puts a net-banking customer on their bank\u2019s own sign-in', () => {
    const s = step(method({ kind: 'netbanking' }), { bank: 'HDFC Bank' })
    expect(s.title).toBe('HDFC Bank \u2014 internet banking')
    expect(s.fields.map(f => f.key)).toEqual(['customer', 'password'])
    expect(s.blurb).toMatch(/merchant never sees these details/)
  })

  it('shows a wallet customer what the payment leaves behind', () => {
    const s = step(method({ kind: 'mobile_wallet' }), { wallet: 'PayTM', msisdn: '9886041127' })
    const before = Number(s.facts.find(f => f.label === 'Balance')!.value.replace(/[^\d.]/g, ''))
    const after = Number(s.facts.find(f => f.label === 'Left after')!.value.replace(/[^\d.]/g, ''))
    expect(+(before - after).toFixed(2)).toBe(2500)
    expect(before).toBeGreaterThan(2500)
  })

  it('tells a carrier-billing customer which bill it lands on', () => {
    const s = step(method({ kind: 'carrier_billing' }), { msisdn: '9886041127' })
    expect(s.facts.find(f => f.label === 'Appears on')?.value).toBe('your bill dated 2026-09-01')
    expect(s.blurb).toMatch(/nothing leaves your bank today/i)
  })

  it('strikes the bill on the first of the following month', () => {
    expect(nextBillDate(new Date('2026-08-05T00:00:00Z'))).toBe('2026-09-01')
    expect(nextBillDate(new Date('2026-12-31T00:00:00Z'))).toBe('2027-01-01')
  })

  it('gives every payment its own code rather than one code for all of them', () => {
    expect(oneTimeCode('PAY-A')).not.toBe(oneTimeCode('PAY-B'))
    expect(oneTimeCode(REF)).toMatch(/^\d{6}$/)
    expect(walletPin(REF)).toMatch(/^\d{4}$/)
    expect(walletPin(REF)).not.toBe(oneTimeCode(REF).slice(-4))
  })

  it('checks the code against the one this payment was issued', () => {
    /* A page that accepts any six digits has a code field for decoration. */
    const s = step(method(), { number: '4111111111111111' })
    expect(validateConfirm(s, { otp: '000000' }, REF).ok).toBe(false)
    expect(validateConfirm(s, { otp: oneTimeCode(REF) }, REF).ok).toBe(true)
  })

  it('warns a wallet customer what a wrong PIN costs', () => {
    const s = step(method({ kind: 'mobile_wallet' }), { wallet: 'PayTM', msisdn: '9886041127' })
    const r = validateConfirm(s, { pin: '0000' }, REF)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/before the wallet is locked/)
    expect(validateConfirm(s, { pin: walletPin(REF) }, REF).ok).toBe(true)
  })

  it('asks for both halves of a bank sign-in', () => {
    const s = step(method({ kind: 'netbanking' }), { bank: 'HDFC Bank' })
    expect(validateConfirm(s, { customer: 'ab', password: 'secret1' }, REF).ok).toBe(false)
    expect(validateConfirm(s, { customer: '48819021', password: 'secret1' }, REF).ok).toBe(true)
  })

  it('needs nothing typed where the confirmation happens elsewhere', () => {
    const s = step(method({ kind: 'upi' }), { vpa: 'priya@okhdfcbank' })
    expect(validateConfirm(s, {}, REF).ok).toBe(true)
  })
})

/* ------------------------------------------------------------ financing ---- */

const emi = method({
  id: 'emi', label: 'EMI on your card', kind: 'emi', sort_order: 8,
  asks_for: 'Your card, then the plan your bank offers you',
  typical: 'two or three minutes',
  financed: true, one_off_only: true, tenures: [3, 6, 9, 12, 18, 24],
  credit_note: 'The instalment agreement is with your card issuer, not with Aventa.',
})
const bnpl = method({
  id: 'bnpl', label: 'Pay in instalments', kind: 'bnpl', sort_order: 9,
  asks_for: 'Your mobile number and a one-time code',
  typical: 'about two minutes',
  financed: true, one_off_only: true, tenures: [3, 4, 6],
  credit_note: 'The instalment agreement is with the provider, not with Aventa.',
})
const emiOffer = { method: emi, provider: 'Razorpay · HDFC and ICICI credit cards', min_amount: 3000, max_amount: 500000 }

describe('limitsFor', () => {
  /* The bug this fixes: `payment_methods.max_amount` is one number applied to
     three currencies, so carrier billing capped India at ₹30,000, the Emirates
     at AED 30,000 — six times a sane monthly bill — and Kenya at KSh 30,000. */
  it('prefers the market row, because that is where the currency is known', () => {
    const carrierMethod = method({ id: 'carrier_billing', kind: 'carrier_billing', max_amount: 30000 })
    expect(limitsFor(carrierMethod, { min_amount: null, max_amount: 1500 }).max).toBe(1500)
  })

  it('falls back to the method for anything with no market row', () => {
    const carrierMethod = method({ id: 'carrier_billing', kind: 'carrier_billing', max_amount: 30000 })
    expect(limitsFor(carrierMethod, undefined).max).toBe(30000)
    expect(limitsFor(carrierMethod, undefined).min).toBeNull()
  })

  it('has no ceiling where neither says one', () => {
    expect(limitsFor(method(), undefined)).toEqual({ min: null, max: null })
  })
})

describe('instalmentOf and longestTenure', () => {
  it('divides, and says so — the provider states any interest', () => {
    expect(instalmentOf(64999, 12)).toBe(5416.58)
    expect(instalmentOf(9000, 3)).toBe(3000)
  })

  it('refuses a plan that is not a plan', () => {
    expect(instalmentOf(1000, 1)).toBeNull()
    expect(instalmentOf(1000, 0)).toBeNull()
    expect(instalmentOf(0, 12)).toBeNull()
    expect(instalmentOf(1000, 6.5)).toBeNull()
  })

  /* The longest plan gives the smallest monthly figure, which is the one worth
     showing beside the method — it is what makes the option worth choosing. */
  it('takes the longest the provider lists', () => {
    expect(longestTenure(emi)).toBe(24)
    expect(longestTenure(bnpl)).toBe(6)
    expect(longestTenure(method())).toBeNull()
  })
})

describe('financingProblem', () => {
  it('says nothing about a method that is not financing', () => {
    expect(financingProblem(method(), 10, { min: 3000, max: null })).toBeNull()
  })

  /* Ahead of the amount, because it is the one that does not go away by
     changing the amount. */
  it('refuses a recurring basket before it mentions any limit', () => {
    const r = financingProblem(emi, 10, { min: 3000, max: 500000 }, { recurring: true })
    expect(r).toMatch(/subscription cannot be spread/)
    expect(r).not.toMatch(/starts at/)
  })

  it('refuses below the floor and above the ceiling, naming the figure', () => {
    expect(financingProblem(emi, 1200, { min: 3000, max: 500000 })).toMatch(/starts at 3,000/)
    expect(financingProblem(emi, 900000, { min: 3000, max: 500000 })).toMatch(/goes up to 500,000/)
  })

  it('passes a one-off basket inside the band', () => {
    expect(financingProblem(emi, 64999, { min: 3000, max: 500000 })).toBeNull()
  })
})

describe('financingNote', () => {
  it('names who is owed, who decides, and an indicative figure', () => {
    const n = financingNote(emi, 'Razorpay · HDFC and ICICI credit cards', 64999)!
    expect(n).toMatch(/Up to 24 months/)
    expect(n).toMatch(/2,708\.29/)
    expect(n).toMatch(/decides whether you are approved/)
    expect(n).toMatch(/agreement is with your card issuer/)
  })

  it('says nothing for a method that is not financing', () => {
    expect(financingNote(method(), 'Razorpay', 100)).toBeNull()
  })
})

describe('canHandOff with financing', () => {
  it('hands a one-off basket over, and the note is the credit note', () => {
    const r = canHandOff({ amount: 64999, method: emi, offers: [emiOffer] })
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toMatch(/not with Aventa/)
  })

  it('refuses a subscription basket, whatever the amount', () => {
    const r = canHandOff({ amount: 64999, method: emi, offers: [emiOffer], recurring: true })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/cannot be spread/)
  })

  it('refuses a basket under the financier’s floor', () => {
    const r = canHandOff({ amount: 900, method: emi, offers: [emiOffer] })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/starts at 3,000/)
  })
})

describe('the financing page', () => {
  it('asks for the plan, which is the field that makes it financing', () => {
    expect(fieldsFor(emi, null).map(f => f.key)).toEqual(['number', 'expiry', 'cvv', 'tenure'])
    expect(fieldsFor(bnpl, null).map(f => f.key)).toEqual(['msisdn', 'tenure'])
    expect(fieldsFor(emi, null).find(f => f.key === 'tenure')!.options)
      .toEqual(['3 months', '6 months', '9 months', '12 months', '18 months', '24 months'])
  })

  it('will not go on without one', () => {
    const good = { number: '4111 1111 1111 1111', expiry: '11/29', cvv: '123' }
    expect(validateFields(emi, good).ok).toBe(false)
    expect(validateFields(emi, { ...good, tenure: '12 months' }).ok).toBe(true)
  })

  /* The select stores the label, so the integer that reaches the attempt row
     has to be read back out of it rather than assumed. */
  it('reads the months back out of the label', () => {
    expect(tenureOf('12 months')).toBe(12)
    expect(tenureOf('3 months')).toBe(3)
    expect(tenureOf('')).toBeNull()
    expect(tenureOf('monthly')).toBeNull()
    expect(tenureOf('1 month')).toBeNull()
    expect(tenureOf('999 months')).toBeNull()
  })

  it('shows the agreement rather than the payment', () => {
    const step = confirmFor({
      method: emi, values: { number: '4111111111111111', expiry: '11/29', cvv: '123', tenure: '12 months' },
      reference: 'PAY-260807-9A1B', amount: 64999, savedLabel: null,
      money: n => `₹${n.toLocaleString()}`,
    })
    const labels = step.facts.map(f => f.label)
    expect(labels).toContain('Plan')
    expect(labels).toContain('Each month')
    /* Stated, not implied — a plan shown without it is the complaint. */
    expect(labels).toContain('Interest')
    expect(step.facts.find(f => f.label === 'You owe')!.value).toMatch(/not Aventa/)
    expect(step.action).toBe('Confirm 12 months')
  })
})

describe('planLine', () => {
  it('reads back what the customer agreed to', () => {
    expect(planLine({ tenure_months: 12, instalment: 5645.75, financier: 'HDFC Bank', state: 'succeeded' },
      n => `₹${n.toLocaleString()}`)).toBe('12 months at ₹5,645.75 a month with HDFC Bank.')
  })

  /* Not yet decided is a different thing from no plan, and the difference
     matters to somebody refreshing an order page. */
  it('distinguishes waiting from not financed', () => {
    expect(planLine({ tenure_months: null, instalment: null, financier: null, state: 'initiated' }))
      .toMatch(/Waiting for the financier/)
    expect(planLine({ tenure_months: null, instalment: null, financier: null, state: 'succeeded' }))
      .toBeNull()
  })
})

describe('isFinanced', () => {
  it('is false for everything that takes the money today', () => {
    expect(isFinanced(method())).toBe(false)
    expect(isFinanced(emi)).toBe(true)
  })
})
