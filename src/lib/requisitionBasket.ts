/**
 * What a business buyer is collecting before they ask to spend.
 *
 * The catalogue's Add button announced "added to requisition" and added
 * nothing — it was a toast. `raiseRequisition` had been written and
 * integration-tested and then never called from anywhere, so the enterprise
 * persona could read a shelf and not buy from it.
 *
 * This is the missing middle: the rules for holding lines until there are
 * enough of them to be worth an approver's time. It is pure so the awkward
 * cases — a mixed basket, a currency change under it, a line whose product went
 * away — are decided here and tested, rather than being decided by whichever
 * component happened to render last.
 *
 * A basket is not a cart. Nothing here is bought; the outcome is a request that
 * somebody senior either agrees to or does not.
 */
import { requisitionTotal, needFor, policyNoteFor, inPolicyMoney, money } from './enterprise'
import type { Policy, Account, Need, Check } from './enterprise'
import type { Rate } from './money'

export interface BasketLine {
  product_id: string
  name: string
  seller: string
  partner_id: string | null
  quantity: number
  unit_price: number
  /* Carried per line so the basket can refuse a mix rather than average two
     different commitments into one number. A requisition has a single `model`
     column: filing a ₹64,999 handset alongside a ₹269/month SIM plan means one
     of the two is about to be misread by every approver who sees it. */
  model: 'oneoff' | 'monthly'
  /* Likewise per line, because `needFor` asks the vertical whether IT has to
     sign. A basket is filed under one of them and the choice has consequences,
     so `verticalOf` makes it deliberately. */
  vertical: string
  unit: string | null
}

export interface Basket {
  /* What the lines are priced in. Prices are chosen per currency rather than
     converted, so a basket belongs to one and `repriceTo` is how it moves. */
  currency: string
  lines: BasketLine[]
}

export const EMPTY_BASKET: Basket = { currency: '', lines: [] }

/* A quantity somebody typed rather than meant. The database only insists on
   more than nothing; this is the sanity bound on top, and it is generous
   because fleet orders are genuinely large — fifty trackers and four hundred
   SIMs are both real rows in this account already. */
export const MAX_QUANTITY = 100000

export type BasketResult =
  | { ok: true; basket: Basket; note?: string }
  | { ok: false; reason: string }

const MODEL_WORD: Record<BasketLine['model'], string> = {
  oneoff: 'a one-off purchase',
  monthly: 'a monthly subscription',
}

/**
 * Put something in, or add to what is already there.
 *
 * Refuses two mixes rather than resolving them, because both resolutions lie.
 * Summing a monthly line into a one-off total states a price nobody pays, and
 * summing across currencies produces a figure in no currency at all — the same
 * mistake the operator's rollups had to have taken out of them.
 */
export function addToBasket(
  basket: Basket, line: Omit<BasketLine, 'quantity'>, currency: string, quantity = 1,
): BasketResult {
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, reason: 'Ask for a whole number of them, at least one' }
  }
  if (line.unit_price <= 0) {
    return { ok: false, reason: `${line.name} has no price in ${currency}, so it cannot be requisitioned in it.` }
  }

  const empty = basket.lines.length === 0
  if (!empty && basket.currency !== currency) {
    return {
      ok: false,
      reason: `This requisition is priced in ${basket.currency}. Empty it first if you want to raise one in ${currency} — a requisition is settled in one currency, and adding across two would total to a figure in neither.`,
    }
  }
  if (!empty && basket.lines[0].model !== line.model) {
    return {
      ok: false,
      reason: `This requisition is ${MODEL_WORD[basket.lines[0].model]} and ${line.name} is ${MODEL_WORD[line.model]}. They are committed to and approved differently, so raise them separately.`,
    }
  }

  const at = basket.lines.findIndex(l => l.product_id === line.product_id)
  if (at >= 0) {
    const want = basket.lines[at].quantity + quantity
    if (want > MAX_QUANTITY) {
      return { ok: false, reason: `That is more than ${MAX_QUANTITY.toLocaleString()} of one thing. Raise it with your account manager instead.` }
    }
    const lines = basket.lines.slice()
    lines[at] = { ...lines[at], quantity: want }
    return { ok: true, basket: { currency, lines }, note: `${line.name} — now ${want}` }
  }

  if (quantity > MAX_QUANTITY) {
    return { ok: false, reason: `That is more than ${MAX_QUANTITY.toLocaleString()} of one thing. Raise it with your account manager instead.` }
  }
  return {
    ok: true,
    basket: { currency, lines: [...basket.lines, { ...line, quantity }] },
    note: `${line.name} added`,
  }
}

/** Nought or less removes it, because that is what a buyer means by typing 0. */
export function setQuantity(basket: Basket, product_id: string, quantity: number): BasketResult {
  if (!Number.isFinite(quantity) || !Number.isInteger(quantity)) {
    return { ok: false, reason: 'Quantities are whole numbers' }
  }
  if (quantity > MAX_QUANTITY) {
    return { ok: false, reason: `That is more than ${MAX_QUANTITY.toLocaleString()} of one thing. Raise it with your account manager instead.` }
  }
  if (quantity <= 0) return removeLine(basket, product_id)
  const lines = basket.lines.map(l => l.product_id === product_id ? { ...l, quantity } : l)
  return { ok: true, basket: { ...basket, lines } }
}

export function removeLine(basket: Basket, product_id: string): BasketResult {
  const lines = basket.lines.filter(l => l.product_id !== product_id)
  /* The currency goes with the last line. Keeping it would leave an empty
     basket that still refused the other currency. */
  return { ok: true, basket: lines.length ? { ...basket, lines } : EMPTY_BASKET }
}

export function basketTotal(basket: Basket): number {
  return requisitionTotal(basket.lines)
}

export function basketCount(basket: Basket): number {
  return basket.lines.reduce((n, l) => n + l.quantity, 0)
}

/**
 * Which marketplace the requisition is filed under.
 *
 * Security wins outright, and not as a tie-break: `needFor` only asks for IT
 * sign-off when the vertical is security, so a basket holding a firewall and
 * two handsets that got filed under devices would have the sign-off silently
 * skipped. Beyond that the vertical carrying the most money is the one the
 * requisition is mostly about.
 */
export function verticalOf(lines: readonly BasketLine[]): string {
  if (!lines.length) return ''
  if (lines.some(l => l.vertical === 'security')) return 'security'
  const value = new Map<string, number>()
  for (const l of lines) {
    value.set(l.vertical, (value.get(l.vertical) ?? 0) + l.quantity * l.unit_price)
  }
  return [...value.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
}

/** Set by the first line and held by every one after it, since a mix is refused. */
export function modelOf(lines: readonly BasketLine[]): 'oneoff' | 'monthly' {
  return lines[0]?.model ?? 'oneoff'
}

/**
 * The same basket priced in another currency.
 *
 * Re-read from the shelf rather than converted: `product_prices` holds a row
 * per currency and that row is the price, so multiplying the rupee one by a
 * rate would put a figure on the requisition that nobody set. Anything the new
 * shelf does not carry is dropped and named — silently keeping the old price
 * would raise a requisition in one currency at another's figures.
 */
export function repriceTo(
  basket: Basket, currency: string,
  shelf: readonly { id: string; price: number; model: string; unit: string | null }[],
): { basket: Basket; dropped: string[] } {
  if (!basket.lines.length) return { basket: EMPTY_BASKET, dropped: [] }
  if (basket.currency === currency) return { basket, dropped: [] }

  const dropped: string[] = []
  const lines: BasketLine[] = []
  for (const l of basket.lines) {
    const now = shelf.find(s => s.id === l.product_id)
    if (!now || now.price <= 0) { dropped.push(l.name); continue }
    lines.push({ ...l, unit_price: now.price, unit: now.unit })
  }
  return { basket: lines.length ? { currency, lines } : EMPTY_BASKET, dropped }
}

export interface BasketVerdict {
  total: number
  currency: string
  vertical: string
  model: 'oneoff' | 'monthly'
  need: Need
  /* The sentence the requester reads before they raise it, not after. An
     approval that arrives as a surprise is one the buyer planned around
     wrongly. Null when it cannot be judged — see `blocked`. */
  note: string | null
  /* Set when the total cannot be put into the policy's currency, which is the
     one case where the need is unknown rather than 'none'. Treating a missing
     rate as within policy would place an order nobody approved. */
  blocked: string | null
}

/**
 * What raising it will mean, worked out before the button is pressed.
 *
 * Deliberately the same three functions `raiseRequisition` uses — `inPolicyMoney`,
 * `needFor`, `policyNoteFor` — rather than a second opinion written for the
 * screen. A preview that disagrees with the decision is worse than no preview.
 */
export function verdict(
  basket: Basket, account: Account, policy: Policy, rates: readonly Rate[], today: string,
): BasketVerdict {
  const total = basketTotal(basket)
  const vertical = verticalOf(basket.lines)
  const model = modelOf(basket.lines)
  const base = { total, currency: basket.currency, vertical, model }

  if (total <= 0) {
    return { ...base, need: 'none', note: null, blocked: null }
  }

  const at = inPolicyMoney({ amount: total, currency: basket.currency }, account.currency, rates, today)
  if (!at) {
    return {
      ...base, need: 'none', note: null,
      blocked: `There is no exchange rate on file for ${basket.currency} to ${account.currency} on ${today}, so this cannot be checked against the ${money(policy.threshold, account.currency)} approval threshold.`,
    }
  }

  const need = needFor({ amount: at.amount, vertical }, policy)
  return { ...base, need, note: policyNoteFor(need, at.amount, policy, account.currency, at), blocked: null }
}

/**
 * What is still missing before this can be raised.
 *
 * Separate from `validateRequisition`, which answers the same question at the
 * point of writing. This one is for greying out a button and saying why, so it
 * covers the basket's own conditions too — the ones a draft form knows nothing
 * about.
 */
export type MissingField = 'lines' | 'title' | 'reason' | 'cost_centre' | 'po_ref'

/**
 * The same answer, but addressable.
 *
 * `whatIsMissing` returns prose, which is what the sentence under the button
 * needs and all a disabled button ever did with it. Naming the field as well is
 * what lets the screen take somebody to it — the first report of this panel was
 * that the requisition could not be raised, from a buyer looking at a greyed
 * button with the fields it wanted below the fold.
 */
export function missingFields(
  basket: Basket,
  draft: { title: string; reason: string; cost_centre: string | null; po_ref: string },
  account: Account,
): { field: MissingField; says: string }[] {
  const missing: { field: MissingField; says: string }[] = []
  if (!basket.lines.length) missing.push({ field: 'lines', says: 'at least one line' })
  if (!draft.title.trim()) missing.push({ field: 'title', says: 'a name an approver will recognise' })
  if (!draft.reason.trim()) missing.push({ field: 'reason', says: 'why it is needed' })
  if (!draft.cost_centre) missing.push({ field: 'cost_centre', says: 'the cost centre it comes out of' })
  if (account.po_required && !draft.po_ref.trim()) {
    missing.push({
      field: 'po_ref',
      says: 'a purchase order reference, which this account requires on every invoice',
    })
  }
  return missing
}

export function whatIsMissing(
  basket: Basket,
  draft: { title: string; reason: string; cost_centre: string | null; po_ref: string },
  account: Account,
): string[] {
  return missingFields(basket, draft, account).map(m => m.says)
}

/** For the sentence under the button. Reads as prose, not as a list. */
export function missingNote(missing: readonly string[]): string | null {
  if (!missing.length) return null
  const list = missing.length === 1 ? missing[0]
    : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`
  return `Still needs ${list}.`
}

export type { Check }
