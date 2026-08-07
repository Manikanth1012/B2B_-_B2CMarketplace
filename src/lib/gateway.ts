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

export type MethodKind =
  | 'card' | 'netbanking' | 'upi' | 'mobile_money' | 'bank_transfer'
  | 'mobile_wallet' | 'carrier_billing' | 'emi' | 'bnpl'

export interface PaymentMethod {
  id: string
  label: string
  kind: MethodKind
  blurb: string
  redirects: boolean
  asks_for: string
  typical: string
  sort_order: number
  /* Legacy: one ceiling for every market, which is the same figure standing for
     three different amounts of money. Kept only as a fallback for a method with
     no per-market row — `limitsFor` prefers the market's own. */
  max_amount?: number | null

  /* Financing. The marketplace is paid in full on the day and the customer owes
     the financier, so `financed` is not a payment style — it is a statement
     about who carries the credit and whose terms the customer is agreeing to. */
  financed?: boolean
  /* What the financier typically offers. Indicative: the plan somebody is
     actually approved for is decided there and comes back on the attempt. */
  tenures?: number[] | null
  credit_note?: string | null
  /* You cannot take twelve months to pay a monthly subscription — the second
     instalment lands with next month's charge. */
  one_off_only?: boolean
}

export interface MethodMarket {
  method_id: string
  market_code: string
  provider: string
  sort_order: number
  /* Both in this market's own currency. */
  min_amount?: number | null
  max_amount?: number | null
}

export type AttemptState = 'initiated' | 'succeeded' | 'failed' | 'cancelled' | 'expired'

export interface PaymentAttempt {
  id: string
  reference: string
  purpose?: 'wallet_topup' | 'order'
  /* What the financier approved, or null on everything that is not financing.
     Null on a financed attempt still in flight, which is a different thing from
     no plan — hence null rather than 0. */
  tenure_months?: number | null
  instalment?: number | null
  financier?: string | null
  wallet_id: string | null
  order_ref?: string | null
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
  /* Carried through from the market row so callers do not have to go back to
     `links` to find out what this method takes here. In the market's currency. */
  min_amount: number | null
  max_amount: number | null
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
      if (!method) return []
      const { min, max } = limitsFor(method, l)
      return [{ method, provider: l.provider, min_amount: min, max_amount: max }]
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

/* ------------------------------------------------------------- financing ---- */

/**
 * The floor and the ceiling for a method in a market, in that market's money.
 *
 * The per-market row wins. `payment_methods.max_amount` is one number applied
 * to three currencies — 30,000 is a sane monthly carrier-bill cap in rupees, an
 * absurd one in dirhams and a tight one in shillings — so it is only a fallback
 * for a method nobody has given a market row.
 */
export function limitsFor(
  method: PaymentMethod,
  offer: { min_amount?: number | null; max_amount?: number | null } | undefined,
): { min: number | null; max: number | null } {
  return {
    min: offer?.min_amount ?? null,
    max: offer?.max_amount ?? method.max_amount ?? null,
  }
}

/** Whether a method spreads the cost rather than taking it. */
export function isFinanced(method: PaymentMethod): boolean {
  return method.financed === true
}

/**
 * An indicative monthly figure, for the checkout to show beside the method.
 *
 * Straight division, and labelled as indicative wherever it is printed, because
 * a real plan may carry interest and the financier states it. Showing a figure
 * that turns out lower than the one on the agreement is the single most
 * complained-about thing in consumer credit, so this is never presented as the
 * amount somebody will pay.
 */
export function instalmentOf(amount: number, months: number): number | null {
  if (!Number.isFinite(amount) || amount <= 0) return null
  if (!Number.isInteger(months) || months < 2) return null
  return Math.round((amount / months) * 100) / 100
}

/** The longest plan the provider lists, which is the one that gives the
    smallest monthly figure — the one worth showing on the method row. */
export function longestTenure(method: PaymentMethod): number | null {
  const t = method.tenures ?? []
  return t.length > 0 ? Math.max(...t) : null
}

/**
 * Why this basket cannot be financed, or null when it can.
 *
 * Kept apart from `canHandOff` so the checkout can grey a method out and say
 * why beside it, rather than letting somebody pick it and be refused on the
 * next screen.
 */
export function financingProblem(
  method: PaymentMethod,
  amount: number,
  limits: { min: number | null; max: number | null },
  basket: { recurring: boolean } = { recurring: false },
  fmt: (n: number) => string = n => n.toLocaleString(),
): string | null {
  if (!isFinanced(method)) return null

  /* First, because it is the one that does not go away by changing the amount.
     A monthly subscription financed over twelve months bills the customer twice
     from month two. */
  if (method.one_off_only && basket.recurring) {
    return 'A subscription cannot be spread — the instalments would run alongside the monthly charge. Pay for the subscription separately.'
  }
  if (limits.min != null && amount < limits.min) {
    return `${method.label} starts at ${fmt(limits.min)}. This basket is under that.`
  }
  if (limits.max != null && amount > limits.max) {
    return `${method.label} goes up to ${fmt(limits.max)}. This basket is over that.`
  }
  return null
}

/**
 * What the customer is told before they are handed over.
 *
 * The three things they need and are least likely to be told: who they will owe,
 * that the marketplace is paid today either way, and that approval is not ours
 * to give.
 */
export function financingNote(
  method: PaymentMethod, provider: string, amount: number,
  fmt: (n: number) => string = n => n.toLocaleString(),
): string | null {
  if (!isFinanced(method)) return null
  const months = longestTenure(method)
  const each = months ? instalmentOf(amount, months) : null
  const indicative = each != null && months != null
    ? `Up to ${months} months — around ${fmt(each)} a month before any interest they charge. `
    : ''
  return `${indicative}${provider} decides whether you are approved and on what terms, and shows you those before you confirm. ${method.credit_note ?? ''}`.trim()
}

/**
 * How an order records that it was financed.
 *
 * "Paid by EMI" on its own is a line nobody — customer, support or auditor —
 * can reconcile against a bank statement, which is why the plan is required on
 * a succeeded financed attempt in the first place.
 */
export function planLine(
  attempt: Pick<PaymentAttempt, 'tenure_months' | 'instalment' | 'financier' | 'state'>,
  fmt: (n: number) => string = n => n.toLocaleString(),
): string | null {
  if (attempt.tenure_months == null) {
    return attempt.state === 'initiated' ? 'Waiting for the financier to decide the plan.' : null
  }
  const each = attempt.instalment != null ? `${fmt(attempt.instalment)} a month` : 'monthly instalments'
  const who = attempt.financier ? ` with ${attempt.financier}` : ''
  return `${attempt.tenure_months} months at ${each}${who}.`
}

/* ------------------------------------------------------------- the handoff -- */

export interface Handoff {
  amount: number
  method: PaymentMethod | null
  offers: readonly Offer[]
  /* Whether anything in the basket recurs. Financing refuses it. */
  recurring?: boolean
  /* How to write money. Passed in rather than assumed, because these notes
     quote figures — "around 2,708.29 a month" beside a page of ₹ amounts reads
     as a different currency, and on this screen it would be a credit figure. */
  fmt?: (n: number) => string
}

/**
 * Whether the customer can be sent to the provider yet.
 *
 * The amount is checked by `canTopUp` against the wallet's own ceiling before
 * this; what is left is whether there is anywhere to send them. The refusals
 * name what to do rather than what is missing.
 */
export function canHandOff(
  { amount, method, offers, recurring = false, fmt = n => n.toLocaleString() }: Handoff,
): Check {
  if (offers.length === 0) {
    return {
      ok: false,
      reason: 'No way to pay is set up for this market yet. Support can take the top-up over the phone in the meantime.',
    }
  }
  if (!method) return { ok: false, reason: 'Choose how you want to pay.' }
  const offer = offers.find(o => o.method.id === method.id)
  if (!offer) {
    return { ok: false, reason: `${method.label} is not offered here. Pick one of the others.` }
  }
  if (amount <= 0) return { ok: false, reason: 'Enter an amount first.' }

  /* Financing first, because its refusals are about what is in the basket
     rather than how much it comes to, and "this is over the limit" is an
     unhelpful thing to be told about a subscription that could never have been
     financed at any price. */
  const credit = financingProblem(method, amount, limitsFor(method, offer), { recurring }, fmt)
  if (credit) return { ok: false, reason: credit }

  /* A carrier bill is not a credit line, so the ceiling is refused here rather
     than by the operator's billing three days later. The market's own figure,
     because the method-level one is the same number for three currencies. */
  const { min, max } = limitsFor(method, offer)
  if (max != null && amount > max) {
    return {
      ok: false,
      reason: `${method.label} takes up to ${fmt(max)} at a time, and this is more than that. Pay by card or from your bank instead.`,
    }
  }
  if (min != null && amount < min) {
    return { ok: false, reason: `${method.label} starts at ${fmt(min)}.` }
  }

  const provider = offer.provider
  if (isFinanced(method)) {
    return {
      ok: true,
      note: `You will be handed to ${provider}, who will ask for ${lowerFirst(method.asks_for)}. ${financingNote(method, provider, amount, fmt)}`,
    }
  }
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
    case 'mobile_wallet':
      return [
        { key: 'wallet', label: 'Which wallet', kind: 'select', options: WALLET_BRANDS,
          hint: 'The balance is debited straight away — there is no bill afterwards.' },
        { key: 'msisdn', label: 'Registered mobile number', kind: 'text',
          hint: 'The number the wallet is registered against, not necessarily the one you are browsing on.' },
      ]
    case 'carrier_billing':
      return [
        { key: 'msisdn', label: 'Your Aventa mobile number', kind: 'text',
          hint: 'It has to be a number billed by Aventa. Another operator’s number cannot be charged here.' },
      ]
    /* The plan is the field. Everything else on an EMI page is a card page,
       which is why financing gets its own kind rather than reusing 'card' —
       a plan chooser bolted onto a CVV box is how a customer ends up agreeing
       to twenty-four months without noticing they chose it. */
    case 'emi':
      return [
        { key: 'number', label: 'Credit card number', kind: 'text',
          hint: 'It has to be a credit card. A debit card cannot carry an instalment plan.' },
        { key: 'expiry', label: 'Expiry', kind: 'text', hint: 'MM/YY' },
        { key: 'cvv', label: 'CVV', kind: 'password' },
        { key: 'tenure', label: 'Over how long', kind: 'select',
          options: (method.tenures ?? []).map(t => `${t} months`),
          hint: 'Your bank decides which of these it will offer you, and states any interest before you confirm.' },
      ]
    case 'bnpl':
      return [
        { key: 'msisdn', label: 'Mobile number', kind: 'text',
          hint: 'The provider texts a code to it and runs its eligibility check against it.' },
        { key: 'tenure', label: 'How many instalments', kind: 'select',
          options: (method.tenures ?? []).map(t => `${t} months`),
          hint: 'Subject to what they approve you for.' },
      ]
  }
}

/* The wallets an Indian or Emirati shopper would actually recognise. Named
   rather than invented, for the same reason the bank list is. */
export const WALLET_BRANDS = ['PayTM', 'PhonePe', 'Amazon Pay', 'Mobikwik', 'Careem Pay', 'e& money']

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
    case 'mobile_wallet': {
      if (!WALLET_BRANDS.includes(values.wallet ?? '')) return { ok: false, reason: 'Choose which wallet you are paying from.' }
      const n = digits(values.msisdn ?? '')
      if (n.length < 9 || n.length > 12) return { ok: false, reason: 'That is not a mobile number a wallet would be registered against.' }
      return { ok: true }
    }
    case 'carrier_billing': {
      const n = digits(values.msisdn ?? '')
      if (n.length < 9 || n.length > 12) return { ok: false, reason: 'Give the mobile number Aventa bills you on.' }
      return { ok: true }
    }
    case 'emi': {
      const pan = digits(values.number ?? '')
      if (pan.length < 15 || pan.length > 19) return { ok: false, reason: 'A card number is 15 to 19 digits.' }
      if (!luhn(pan)) return { ok: false, reason: 'That card number does not check out. Read it off the card again.' }
      const exp = /^(\d{2})\s*\/\s*(\d{2})$/.exec((values.expiry ?? '').trim())
      if (!exp) return { ok: false, reason: 'Give the expiry as MM/YY.' }
      if (Number(exp[1]) < 1 || Number(exp[1]) > 12) return { ok: false, reason: `There is no month ${exp[1]}.` }
      if (digits(values.cvv ?? '').length < 3) return { ok: false, reason: 'A CVV is three digits, or four on an Amex.' }
      if (!tenureOf(values.tenure)) return { ok: false, reason: 'Choose how long you want to spread it over.' }
      return { ok: true }
    }
    case 'bnpl': {
      const n = digits(values.msisdn ?? '')
      if (n.length < 9 || n.length > 12) return { ok: false, reason: 'That is not a mobile number we can text a code to.' }
      if (!tenureOf(values.tenure)) return { ok: false, reason: 'Choose how many instalments.' }
      return { ok: true }
    }
  }
}

/** The months out of "12 months", or null if there is no number in it. The
    select stores the label rather than the integer, so the integer that reaches
    the attempt row has to be recovered rather than assumed. */
export function tenureOf(value: string | null | undefined): number | null {
  const m = /^(\d+)\s*month/.exec((value ?? '').trim())
  if (!m) return null
  const n = Number(m[1])
  return Number.isInteger(n) && n >= 2 && n <= 60 ? n : null
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
    case 'mobile_wallet': return `${values.wallet} wallet ${mask(values.msisdn ?? '')}`
    case 'carrier_billing': return `the Aventa bill for ${mask(values.msisdn ?? '')}`
    case 'emi': return `EMI on the card ending ${digits(values.number ?? '').slice(-4)}`
    case 'bnpl': return `instalments on ${mask(values.msisdn ?? '')}`
  }
}

/* A number a customer can recognise without it being a number anybody else
   could use. The last four, which is what every provider shows back. */
export function mask(msisdn: string): string {
  const d = digits(msisdn)
  return d.length <= 4 ? d : `•••••• ${d.slice(-4)}`
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

/* ------------------------------------------------- the provider's step two -- */

/**
 * What happens after the customer has said how they want to pay.
 *
 * Every one of these rails has a second act, and it is the act that decides
 * whether the payment happens: the bank's one-time code, the wallet's PIN, the
 * approval that arrives in a UPI app, the code texted to the number the bill
 * belongs to. A payment page that takes a card number and immediately says
 * "paid" is not a payment page, it is a form.
 *
 * There is no SMS and no bank, so the code is shown on screen. That is the one
 * place the flow admits mid-way that it is a stand-in, and it is better than
 * the alternative — a code field nobody can fill.
 */
export interface Fact {
  label: string
  value: string
}

export interface ConfirmStep {
  title: string
  /* In the provider's voice, not the marketplace's. */
  blurb: string
  /* What the customer types. Empty where the confirmation happens somewhere
     else entirely — a UPI app, an M-Pesa PIN prompt on the handset itself. */
  fields: Field[]
  /* The code or PIN, shown because there is nowhere for it to arrive. Null when
     nothing has to be typed. */
  shown: string | null
  /* What the provider knows about this payment and would show back. */
  facts: Fact[]
  action: string
}

/**
 * A six-digit code from the payment's own reference.
 *
 * Deterministic, so the page can show it and check it without holding it in
 * state where a re-render would lose it, and so two payments never share one.
 */
export function oneTimeCode(reference: string): string {
  let h = 7
  for (let i = 0; i < reference.length; i++) h = (h * 31 + reference.charCodeAt(i)) % 1_000_000
  return String(h).padStart(6, '0')
}

/** A four-digit wallet PIN, from the same reference by a different seed. */
export function walletPin(reference: string): string {
  return oneTimeCode(`${reference}#pin`).slice(-4)
}

/** The date a carrier-billed purchase lands on. Bills are struck on the 1st. */
export function nextBillDate(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
  return d.toISOString().slice(0, 10)
}

/* A balance the wallet would plausibly hold — always enough, because a wallet
   that could not cover it would have been refused before this screen. */
function walletBalance(reference: string, amount: number): number {
  return Math.round((amount + 500 + (Number(oneTimeCode(reference)) % 9000)) * 100) / 100
}

export function confirmFor(
  { method, values, reference, amount, savedLabel, money, now = new Date() }: {
    method: PaymentMethod
    values: Record<string, string>
    reference: string
    amount: number
    savedLabel: string | null
    money: (n: number) => string
    now?: Date
  },
): ConfirmStep {
  const code = oneTimeCode(reference)
  const target = mask(values.msisdn ?? '')

  switch (method.kind) {
    case 'card': {
      const pan = savedLabel ?? `•••• ${(values.number ?? '').replace(/\D/g, '').slice(-4)}`
      return {
        title: 'Verify with your bank',
        blurb: `Your bank is checking this payment. A one-time code has been sent to the mobile number registered against ${pan}. It is valid for five minutes.`,
        fields: [{ key: 'otp', label: 'One-time code', kind: 'text', hint: 'Six digits' }],
        shown: code,
        facts: [
          { label: 'Card', value: pan },
          { label: 'Amount', value: money(amount) },
          { label: 'Merchant', value: 'AVENTA TELECOM' },
          { label: 'Reference', value: reference },
        ],
        action: 'Confirm payment',
      }
    }

    case 'netbanking':
      return {
        title: `${values.bank} — internet banking`,
        blurb: 'Sign in to authorise the payment. You are on your bank’s page; the merchant never sees these details.',
        fields: [
          { key: 'customer', label: 'Customer ID', kind: 'text' },
          { key: 'password', label: 'Password', kind: 'password' },
        ],
        shown: null,
        facts: [
          { label: 'Paying', value: 'AVENTA TELECOM' },
          { label: 'Amount', value: money(amount) },
          { label: 'From', value: `${values.bank} savings account` },
          { label: 'Reference', value: reference },
        ],
        action: 'Sign in and pay',
      }

    case 'upi':
      return {
        title: 'Approve it in your UPI app',
        blurb: `A collect request has gone to ${values.vpa}. Open your UPI app and approve it — the request expires in five minutes.`,
        fields: [],
        shown: null,
        facts: [
          { label: 'To', value: 'aventatelecom@razorpay' },
          { label: 'Amount', value: money(amount) },
          { label: 'From', value: values.vpa ?? '' },
          { label: 'Reference', value: reference },
        ],
        action: 'I have approved it',
      }

    case 'mobile_money':
      return {
        title: 'Check your phone',
        blurb: `An M-Pesa prompt has been sent to ${target}. Enter your M-Pesa PIN on the handset to confirm — nothing is typed here.`,
        fields: [],
        shown: null,
        facts: [
          { label: 'Pay bill', value: '247 247 · Aventa Telecom' },
          { label: 'Amount', value: money(amount) },
          { label: 'Phone', value: target },
          { label: 'Reference', value: reference },
        ],
        action: 'I have entered my PIN',
      }

    case 'mobile_wallet': {
      const before = walletBalance(reference, amount)
      return {
        title: `${values.wallet} — confirm payment`,
        blurb: `Enter your ${values.wallet} PIN to release the payment. The balance is debited straight away.`,
        fields: [{ key: 'pin', label: `${values.wallet} PIN`, kind: 'password', hint: 'Four digits' }],
        shown: walletPin(reference),
        facts: [
          { label: 'Wallet', value: `${values.wallet} · ${target}` },
          { label: 'Balance', value: money(before) },
          { label: 'This payment', value: money(amount) },
          { label: 'Left after', value: money(+(before - amount).toFixed(2)) },
        ],
        action: 'Pay from wallet',
      }
    }

    case 'carrier_billing':
      return {
        title: 'Confirm the charge to your bill',
        blurb: `We have texted a code to ${target}. Entering it authorises Aventa to put this purchase on your monthly bill — nothing leaves your bank today.`,
        fields: [{ key: 'otp', label: 'Code we texted you', kind: 'text', hint: 'Six digits' }],
        shown: code,
        facts: [
          { label: 'Number', value: target },
          { label: 'Amount', value: money(amount) },
          { label: 'Appears on', value: `your bill dated ${nextBillDate(now)}` },
          { label: 'Reference', value: reference },
        ],
        action: 'Add it to my bill',
      }

    case 'bank_transfer':
      return {
        title: 'Authorise the transfer',
        blurb: 'Confirm the transfer in your banking app. Quote the reference below if your bank asks for one.',
        fields: [],
        shown: null,
        facts: [
          { label: 'Beneficiary', value: 'Aventa Telecom FZ-LLC' },
          { label: 'Amount', value: money(amount) },
          { label: 'Reference', value: reference },
        ],
        action: 'I have authorised it',
      }

    /* The two financing steps show the agreement rather than the payment. The
       thing a customer must be able to read before confirming is not "₹64,999
       to AVENTA TELECOM" — they know that — it is how many months, how much
       each, and who they will owe. */
    case 'emi': {
      const months = tenureOf(values.tenure) ?? longestTenure(method) ?? 12
      const each = instalmentOf(amount, months)
      const pan = `•••• ${(values.number ?? '').replace(/\D/g, '').slice(-4)}`
      return {
        title: 'Your bank’s instalment offer',
        blurb: `Your bank has approved this purchase over ${months} months. Confirming converts the charge to instalments on ${pan} and sends a one-time code to the number registered against it.`,
        fields: [{ key: 'otp', label: 'One-time code', kind: 'text', hint: 'Six digits' }],
        shown: code,
        facts: [
          { label: 'Card', value: pan },
          { label: 'Purchase', value: money(amount) },
          { label: 'Plan', value: `${months} months` },
          { label: 'Each month', value: each != null ? money(each) : '—' },
          /* Stated, not implied. A plan shown without this is the complaint. */
          { label: 'Interest', value: 'As stated by your bank on this screen' },
          { label: 'You owe', value: 'Your card issuer, not Aventa' },
          { label: 'Reference', value: reference },
        ],
        action: `Confirm ${months} months`,
      }
    }

    case 'bnpl': {
      const months = tenureOf(values.tenure) ?? longestTenure(method) ?? 3
      const each = instalmentOf(amount, months)
      return {
        title: 'Approved — confirm your plan',
        blurb: `You are approved for ${months} instalments. We have texted a code to ${target}; entering it accepts the agreement.`,
        fields: [{ key: 'otp', label: 'Code we texted you', kind: 'text', hint: 'Six digits' }],
        shown: code,
        facts: [
          { label: 'Phone', value: target },
          { label: 'Purchase', value: money(amount) },
          { label: 'Plan', value: `${months} instalments` },
          { label: 'Each month', value: each != null ? money(each) : '—' },
          { label: 'First payment', value: 'Today' },
          { label: 'You owe', value: 'The provider, not Aventa' },
          { label: 'Reference', value: reference },
        ],
        action: `Accept ${months} instalments`,
      }
    }
  }
}

/**
 * Whether the second step is answered.
 *
 * The code is checked against the one this payment was issued, not merely for
 * being six digits — a page that accepts any six digits has a code field for
 * decoration.
 */
export function validateConfirm(
  step: ConfirmStep, values: Record<string, string>, reference: string,
): Check {
  for (const f of step.fields) {
    if (!(values[f.key] ?? '').trim()) return { ok: false, reason: `${f.label} is needed.` }
  }

  if ('otp' in values || step.fields.some(f => f.key === 'otp')) {
    if (values.otp !== oneTimeCode(reference)) {
      return { ok: false, reason: 'That code is not the one we sent. Check it and try again.' }
    }
  }
  if (step.fields.some(f => f.key === 'pin')) {
    if (values.pin !== walletPin(reference)) {
      return { ok: false, reason: 'That PIN is wrong. Two more attempts before the wallet is locked.' }
    }
  }
  if (step.fields.some(f => f.key === 'password')) {
    if ((values.customer ?? '').trim().length < 4) {
      return { ok: false, reason: 'A customer ID is at least four characters.' }
    }
    if ((values.password ?? '').length < 6) {
      return { ok: false, reason: 'Your internet banking password is at least six characters.' }
    }
  }
  return { ok: true }
}
