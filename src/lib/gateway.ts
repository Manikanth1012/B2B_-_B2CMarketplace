/**
 * Paying for something at a provider that is not this marketplace.
 *
 * Topping up used to be one dropdown of already-saved instruments and an
 * immediate write. A real payment leaves: the customer goes to their bank or
 * their UPI app, authenticates there, and comes back with an answer that may be
 * no — or does not come back at all.
 *
 * Everything here is about the shape of that trip and nothing about the network
 * it happens over, so it can be tested without one. What the money does when
 * the answer arrives is `settle_payment_attempt` in the database, on purpose:
 * the wallet, the ledger row and the attempt move together or not at all.
 */
export type { Check } from './enterprise'
import type { Check } from './enterprise'

export type MethodKind = 'card' | 'netbanking' | 'upi' | 'mobile_money' | 'bank_transfer'

export interface PaymentMethod {
  id: string
  label: string
  kind: MethodKind
  blurb: string
  redirects: boolean
  asks_for: string
  typical: string
  sort_order: number
}

export interface MethodMarket {
  method_id: string
  market_code: string
  provider: string
  sort_order: number
}

export type AttemptState = 'initiated' | 'succeeded' | 'failed' | 'cancelled' | 'expired'

export interface PaymentAttempt {
  id: string
  reference: string
  wallet_id: string | null
  amount: number
  currency: string
  method_id: string
  market_code: string | null
  provider: string | null
  instrument: string | null
  state: AttemptState
  failure_reason: string | null
  gateway_ref: string | null
  started_at: string
  decided_at: string | null
  ledger_id: string | null
}

/** A way to pay, in a market, with the provider who would handle it. */
export interface Offer {
  method: PaymentMethod
  provider: string
}

/**
 * What this customer, standing in this market, may pay with.
 *
 * Ordered by the market's own preference rather than the method's: UPI is first
 * in India and last nowhere else, because the row that says so is per market.
 */
export function offersIn(
  marketCode: string,
  methods: readonly PaymentMethod[],
  links: readonly MethodMarket[],
): Offer[] {
  return links
    .filter(l => l.market_code === marketCode)
    .sort((a, b) => a.sort_order - b.sort_order)
    .flatMap(l => {
      const method = methods.find(m => m.id === l.method_id)
      return method ? [{ method, provider: l.provider }] : []
    })
}

/**
 * Which market's rails a wallet is topped up over.
 *
 * The wallet's currency decides it, not whichever market the shopper has the
 * picker set to. A customer with a rupee wallet browsing Kenyan prices is still
 * putting rupees into a rupee wallet, and offering them M-Pesa would send them
 * to a provider that cannot take the money. The picker is used only to break a
 * tie between markets that share a currency.
 */
export function marketForWallet(
  walletCurrency: string,
  accepted: readonly { market_code: string; currency: string; is_default: boolean }[],
  preferred: string | null,
): string | null {
  const takers = accepted.filter(a => a.currency === walletCurrency)
  if (takers.length === 0) return null
  const prefer = preferred && takers.some(a => a.market_code === preferred) ? preferred : null
  return prefer
    ?? takers.find(a => a.is_default)?.market_code
    ?? takers[0].market_code
}

/* ------------------------------------------------------ saved instruments -- */

export interface SavedInstrument {
  id: string
  kind: string
  detail: string
  expires: string | null
  is_primary: boolean
  status: string
}

/**
 * Which saved instruments could be used for a method.
 *
 * Only cards are saved, and only a card method can use one. An expired card
 * stays on the account and stays visible on the security screen, but offering
 * it here would send the customer to a provider to be told no.
 */
export function savedFor(
  method: PaymentMethod,
  saved: readonly SavedInstrument[],
  expired: (c: { expires: string | null }) => boolean,
): SavedInstrument[] {
  if (method.kind !== 'card') return []
  return saved
    .filter(s => s.status === 'active' && !expired(s))
    .filter(s => !/mobile/i.test(s.kind))
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary))
}

/* ------------------------------------------------------------- the handoff -- */

export interface Handoff {
  amount: number
  method: PaymentMethod | null
  offers: readonly Offer[]
}

/**
 * Whether the customer can be sent to the provider yet.
 *
 * The amount is checked by `canTopUp` against the wallet's own ceiling before
 * this; what is left is whether there is anywhere to send them. The refusals
 * name what to do rather than what is missing.
 */
export function canHandOff({ amount, method, offers }: Handoff): Check {
  if (offers.length === 0) {
    return {
      ok: false,
      reason: 'No way to pay is set up for this market yet. Support can take the top-up over the phone in the meantime.',
    }
  }
  if (!method) return { ok: false, reason: 'Choose how you want to pay.' }
  if (!offers.some(o => o.method.id === method.id)) {
    return { ok: false, reason: `${method.label} is not offered here. Pick one of the others.` }
  }
  if (amount <= 0) return { ok: false, reason: 'Enter an amount first.' }

  const provider = offers.find(o => o.method.id === method.id)!.provider
  return {
    ok: true,
    note: method.redirects
      ? `You will be handed to ${provider}, who will ask for ${lowerFirst(method.asks_for)}. It takes ${method.typical}. Nothing is added to your wallet until they say the payment went through.`
      : `${provider} will take the payment without leaving this page.`,
  }
}

const lowerFirst = (s: string) => (s ? s[0].toLowerCase() + s.slice(1) : s)

/** A reference short enough to read down a phone and unique enough to find. */
export function referenceFor(now: Date, seed: number): string {
  const stamp = now.toISOString().slice(2, 10).replace(/-/g, '')
  const tail = Math.abs(Math.floor(seed)).toString(36).toUpperCase().padStart(4, '0').slice(-4)
  return `PAY-${stamp}-${tail}`
}

/* --------------------------------------------------- the provider's page --- */

export interface Field {
  key: string
  label: string
  hint?: string
  kind: 'text' | 'select' | 'password'
  options?: string[]
}

/* The banks a net-banking page offers. Real ones, because a list of fictional
   banks tells a reader the screen is a mock more loudly than a label saying so
   — and the label saying so is there anyway. */
export const NET_BANKS = [
  'HDFC Bank', 'ICICI Bank', 'State Bank of India', 'Axis Bank',
  'Kotak Mahindra Bank', 'Punjab National Bank', 'Bank of Baroda',
]

/**
 * What the provider's page asks for.
 *
 * Different per method because they genuinely are different: a bank chooser is
 * not a card form with the fields renamed, and pretending otherwise produces a
 * page asking a UPI customer for a CVV.
 */
export function fieldsFor(method: PaymentMethod, savedLabel: string | null): Field[] {
  switch (method.kind) {
    case 'card':
      return savedLabel
        ? [{ key: 'cvv', label: `CVV for ${savedLabel}`, kind: 'password', hint: 'The three digits on the back. We never see it — the provider does.' }]
        : [
            { key: 'number', label: 'Card number', kind: 'text', hint: '16 digits, spaces are fine' },
            { key: 'expiry', label: 'Expiry', kind: 'text', hint: 'MM/YY' },
            { key: 'cvv', label: 'CVV', kind: 'password' },
            { key: 'name', label: 'Name on the card', kind: 'text' },
          ]
    case 'netbanking':
      return [{ key: 'bank', label: 'Your bank', kind: 'select', options: NET_BANKS,
                hint: 'You will sign in on your own bank’s page, not here.' }]
    case 'upi':
      return [{ key: 'vpa', label: 'UPI ID', kind: 'text', hint: 'Something like priya@okhdfcbank' }]
    case 'mobile_money':
      return [{ key: 'msisdn', label: 'M-Pesa number', kind: 'text', hint: 'The number the PIN prompt goes to, e.g. 0722 000 000' }]
    case 'bank_transfer':
      return [
        { key: 'account', label: 'Account number', kind: 'text' },
        { key: 'holder', label: 'Account holder', kind: 'text' },
      ]
  }
}

const digits = (s: string) => s.replace(/\D/g, '')

/**
 * Whether the provider's page has enough to go on.
 *
 * These are the provider's checks, not the marketplace's — a card number is
 * refused here for the same reason it would be refused there, and the wording
 * is the provider's kind of wording rather than ours.
 */
export function validateFields(method: PaymentMethod, values: Record<string, string>): Check {
  const need = fieldsFor(method, values.__saved ?? null)
  for (const f of need) {
    if (!(values[f.key] ?? '').trim()) return { ok: false, reason: `${f.label} is needed.` }
  }

  switch (method.kind) {
    case 'card': {
      if (values.__saved) {
        if (digits(values.cvv ?? '').length < 3) return { ok: false, reason: 'A CVV is three digits, or four on an Amex.' }
        return { ok: true }
      }
      const pan = digits(values.number ?? '')
      if (pan.length < 15 || pan.length > 19) return { ok: false, reason: 'A card number is 15 to 19 digits.' }
      if (!luhn(pan)) return { ok: false, reason: 'That card number does not check out. Read it off the card again.' }
      const exp = /^(\d{2})\s*\/\s*(\d{2})$/.exec((values.expiry ?? '').trim())
      if (!exp) return { ok: false, reason: 'Give the expiry as MM/YY.' }
      if (Number(exp[1]) < 1 || Number(exp[1]) > 12) return { ok: false, reason: `There is no month ${exp[1]}.` }
      if (digits(values.cvv ?? '').length < 3) return { ok: false, reason: 'A CVV is three digits, or four on an Amex.' }
      return { ok: true }
    }
    case 'netbanking':
      if (!NET_BANKS.includes(values.bank ?? '')) return { ok: false, reason: 'Choose your bank from the list.' }
      return { ok: true }
    case 'upi':
      if (!/^[\w.\-]{2,}@[a-z]{2,}$/i.test((values.vpa ?? '').trim())) {
        return { ok: false, reason: 'A UPI ID looks like name@bank — check it in your app.' }
      }
      return { ok: true }
    case 'mobile_money': {
      const n = digits(values.msisdn ?? '')
      if (n.length < 9 || n.length > 12) return { ok: false, reason: 'That is not a mobile number M-Pesa would recognise.' }
      return { ok: true }
    }
    case 'bank_transfer':
      if (digits(values.account ?? '').length < 6) return { ok: false, reason: 'An account number is at least six digits.' }
      return { ok: true }
  }
}

/* The check a card issuer does before anything leaves the building. Here so a
   mistyped digit is caught on the page rather than becoming a failed attempt
   the customer has to be told about. */
export function luhn(pan: string): boolean {
  let sum = 0
  let double = false
  for (let i = pan.length - 1; i >= 0; i--) {
    let d = pan.charCodeAt(i) - 48
    if (d < 0 || d > 9) return false
    if (double) { d *= 2; if (d > 9) d -= 9 }
    sum += d
    double = !double
  }
  return pan.length > 0 && sum % 10 === 0
}

/** What the provider would call the thing it charged. */
export function instrumentLabel(
  method: PaymentMethod, values: Record<string, string>, savedLabel: string | null,
): string {
  switch (method.kind) {
    case 'card':
      return savedLabel ?? `card ending ${digits(values.number ?? '').slice(-4)}`
    case 'netbanking': return `${values.bank} net banking`
    case 'upi': return `UPI ${values.vpa}`
    case 'mobile_money': return `M-Pesa ${values.msisdn}`
    case 'bank_transfer': return `bank transfer from ${digits(values.account ?? '').slice(-4)}`
  }
}

/* ---------------------------------------------------------- coming back --- */

/** How long an attempt is given before nobody should be waiting on it. */
export const HANDOFF_MINUTES = 15

/**
 * What to tell the customer about an attempt they are looking at.
 *
 * `initiated` is the state that matters. It means the customer went to the
 * provider and this side never heard the answer — the money may have left their
 * account. Saying "failed" would be a guess, and it is the guess that turns one
 * confused customer into a chargeback.
 */
export function describe(a: PaymentAttempt, money: (n: number) => string, now = new Date()): {
  tone: 'good' | 'bad' | 'waiting'
  headline: string
  detail: string
} {
  switch (a.state) {
    case 'succeeded':
      return {
        tone: 'good',
        headline: `${money(a.amount)} added`,
        detail: `Paid by ${a.instrument ?? 'card'} and cleared by ${a.provider ?? 'the provider'}. Reference ${a.reference}.`,
      }
    case 'failed':
      return {
        tone: 'bad',
        headline: 'The payment did not go through',
        detail: `${a.failure_reason ?? 'The provider refused it.'} Nothing was added and nothing was charged. Reference ${a.reference}.`,
      }
    case 'cancelled':
      return {
        tone: 'bad',
        headline: 'You cancelled the payment',
        detail: `Nothing was charged and nothing was added. Reference ${a.reference} if you want us to look at it.`,
      }
    case 'expired':
      return {
        tone: 'bad',
        headline: 'The payment timed out',
        detail: `${a.provider ?? 'The provider'} did not answer in ${HANDOFF_MINUTES} minutes. If your account was debited it is returned automatically — quote ${a.reference}.`,
      }
    default: {
      const mins = Math.floor((now.getTime() - Date.parse(a.started_at)) / 60_000)
      return {
        tone: 'waiting',
        headline: `Waiting on ${a.provider ?? 'the provider'}`,
        detail: mins >= HANDOFF_MINUTES
          ? `Started ${mins} minutes ago and still unanswered. Do not pay again — quote ${a.reference} to support and they will find it.`
          : `${money(a.amount)} is with ${a.provider ?? 'the provider'}. Nothing is added to your wallet until they answer. Reference ${a.reference}.`,
      }
    }
  }
}

/** Attempts nobody should still be waiting on. */
export function stale(attempts: readonly PaymentAttempt[], now = new Date()): PaymentAttempt[] {
  return attempts.filter(a =>
    a.state === 'initiated'
    && now.getTime() - Date.parse(a.started_at) > HANDOFF_MINUTES * 60_000)
}

/** The one still in flight, if there is one. A customer with a payment at the
    provider should not be starting a second — that is how one top-up becomes
    two charges. */
export function inFlight(attempts: readonly PaymentAttempt[]): PaymentAttempt | null {
  return attempts.find(a => a.state === 'initiated') ?? null
}

/** Whether a new payment may be started at all. */
export function canStart(attempts: readonly PaymentAttempt[], now = new Date()): Check {
  const open = inFlight(attempts)
  if (!open) return { ok: true }
  if (stale([open], now).length > 0) {
    return {
      ok: true,
      note: `An earlier payment (${open.reference}) never came back from ${open.provider ?? 'the provider'}. Starting another is fine — if the first one did go through, it is credited when the provider tells us.`,
    }
  }
  return {
    ok: false,
    reason: `${open.reference} is still with ${open.provider ?? 'the provider'}. Finish or cancel that one before starting another, or you may be charged twice.`,
  }
}
