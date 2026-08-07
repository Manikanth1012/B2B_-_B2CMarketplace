/* Privacy rules, pure. What is shared, what a data request commits us to, and what
   closing the account would actually cost. */

/* ---------------------------------------------------------------- disclosure */

/* The prototype states what is shared rather than offering toggles, and that is the
   right call: a switch that cannot really stop the sharing is worse than the plain
   sentence. A seller shipping a parcel has to have the address. So this is a
   disclosure list, and `shared` is a fact about the marketplace, not a setting. */
export interface SharingFact {
  what: string
  detail: string
  shared: boolean
}

export const SHARING: readonly SharingFact[] = [
  { what: 'Your name and delivery address', detail: 'Shared with sellers you buy physical goods from, so they can ship to you.', shared: true },
  { what: 'Your email', detail: 'Shared with subscription sellers so they can create your account with them.', shared: true },
  { what: 'Your mobile number', detail: 'Never shared with sellers. The marketplace contacts you on their behalf.', shared: false },
  { what: 'What you browse', detail: 'Never shared with sellers. Used only to order what you see here.', shared: false },
]

/* ------------------------------------------------------------- data requests */

export const REQUEST_KINDS = [
  'Everything held about me',
  'Orders and billing only',
  'Usage and service records only',
] as const

export type RequestKind = typeof REQUEST_KINDS[number]

/* Thirty days is the statutory answer window. Stored on the row rather than computed
   at read time, so a request keeps the deadline it was actually given even if the
   rule changes later. */
export const RESPONSE_DAYS = 30

export function dueDate(raised: Date): Date {
  const d = new Date(raised.getTime())
  d.setDate(d.getDate() + RESPONSE_DAYS)
  return d
}

export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** What the marketplace is committing to, said before the request is made. */
export const REQUEST_IMPACT: readonly string[] = [
  `We have ${RESPONSE_DAYS} days to answer, and usually take under five.`,
  'It arrives as a download link to your registered email, valid for 7 days.',
  'The copy covers what the marketplace holds. Each seller you have bought from keeps their own record, and the copy lists who they are so you can ask them directly.',
  /* Named because the marketplace now holds one. A field it holds and the
     copy omits is an export lying by omission. */
  'It includes your date of birth where we hold one, and says whether you told us or it came off your ID.',
  'Requesting a copy changes nothing about your account.',
]

/* ----------------------------------------------------------------- closure */

export const CLOSURE_NOTICE_DAYS = 30

export const CLOSURE_REASONS = [
  'Moving to another provider',
  'Too expensive',
  'Not using it',
  'Prefer not to say',
] as const

/** Typed to confirm. A high-risk action should cost more than one click. */
export const CLOSURE_CONFIRM_WORD = 'CLOSE'

export function closureEffective(requested: Date): Date {
  const d = new Date(requested.getTime())
  d.setDate(d.getDate() + CLOSURE_NOTICE_DAYS)
  return d
}

export interface ClosureContext {
  activeSubscriptions: { price: number }[]
  ordersInFlight: number
  walletBalance: number
  /* Split, because only one of the two comes back. Defaulted to the whole
     balance being the customer's where a caller has not looked it up, which is
     the safe direction: it over-promises nothing the wallet cannot pay. */
  walletCash?: number
  walletPromo?: number
  /* Where the refundable part goes. Null means nothing on file. */
  refundInstrument?: string | null
  householdMembers: number
}

/**
 * What closing the account would actually do, from live data rather than a fixed
 * paragraph. Somebody about to close an account is owed the specifics — which
 * subscriptions stop, what happens to money they are owed — not a generic warning.
 */
export function closureImpact(ctx: ClosureContext, effective: string): string[] {
  const monthly = ctx.activeSubscriptions.reduce((sum, s) => sum + s.price, 0)
  const out: string[] = [
    `Closure takes effect on ${effective}. Until then everything keeps working, and you can stop it at any point.`,
  ]

  out.push(ctx.activeSubscriptions.length > 0
    ? `${ctx.activeSubscriptions.length} active ${ctx.activeSubscriptions.length === 1 ? 'subscription' : 'subscriptions'} ($${monthly.toFixed(2)} a month) are cancelled on that date.`
    : 'You have no active subscriptions.')

  out.push(ctx.ordersInFlight > 0
    ? `${ctx.ordersInFlight} ${ctx.ordersInFlight === 1 ? 'order is' : 'orders are'} still in flight. They will be delivered before closure.`
    : 'No orders are in flight.')

  /* Money owed back is the thing people actually worry about, so it is stated even
     when the balance is zero — silence reads as "you lose it".

     And it is stated as two figures, because only one of them comes back. A
     wallet holding $30.60 of top-ups and $12.00 of converted points is not a
     "$42.60 refund": the points were never the customer's money and cannot be
     paid to a card. Saying so here is the difference between an expectation
     the marketplace can meet and a complaint it has already earned. */
  const cash = ctx.walletCash ?? ctx.walletBalance
  const promo = ctx.walletPromo ?? 0

  if (cash > 0) {
    out.push(ctx.refundInstrument
      ? `$${cash.toFixed(2)} of your own money — top-ups and refunds — goes back to ${ctx.refundInstrument}. Allow five working days.`
      : `$${cash.toFixed(2)} of your own money is returnable, but there is no payment method on file to send it to. Add one before you close.`)
  }
  if (promo > 0) {
    out.push(`$${promo.toFixed(2)} of credit we gave you — converted points and goodwill — cannot be paid out as cash and is cancelled. Spend it first if you would rather not lose it.`)
  }
  if (cash === 0 && promo === 0) {
    out.push('Your wallet is empty, so there is nothing to refund.')
  }

  if (ctx.householdMembers > 1) {
    out.push(`${ctx.householdMembers - 1} household members lose access on the same date.`)
  }

  out.push('Order and billing records are kept for the period tax law requires, then deleted.')
  return out
}

export function canScheduleClosure(typed: string): boolean {
  return typed.trim().toUpperCase() === CLOSURE_CONFIRM_WORD
}
