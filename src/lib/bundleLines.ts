/**
 * A configured bundle on a basket, a requisition and an order. Pure: no
 * database. The bundle travels as ordinary lines carrying
 * `bundle_selection_id` and the selection's own unit prices; these functions
 * group them, price them from the selection (never from a price book) and say
 * what stops one being bought. A line without `bundle_selection_id` passes
 * through every function here untouched.
 */
import { bundleStanding, type Choices } from './bundles'
import { nextRenewalFrom } from './subscriptions'
import type { Selection, SelectionLine } from './bundlePayload'
import type { Basket, BasketLine } from './requisitionBasket'

/** One selection with its lines and its template's name, as a basket shows it. */
export interface BundleInfo { selection: Selection; lines: SelectionLine[]; name: string }

/** What a requisition basket line remembers of the bundle it belongs to. */
export interface BundleMeta {
  templateId: string
  name: string
  choices: Choices
  quantity: number
  currency: string
  validUntil: string
  total: number
}

export const BUNDLE_FALLBACK_NAME = 'Configured bundle'

/** The distinct selection ids on some lines, in order. */
export function bundleIdsOf(lines: readonly { bundle_selection_id?: string | null }[]): string[] {
  const ids: string[] = []
  for (const l of lines) {
    const id = l.bundle_selection_id
    if (id && !ids.includes(id)) ids.push(id)
  }
  return ids
}

export const isBundleLine = (l: { bundle_selection_id?: string | null }): boolean => !!l.bundle_selection_id

/**
 * Basket lines priced from their selections. A bundle line takes the
 * selection's unit price for its product (and the product row is given that
 * price, so every total that reads `product.price` adds up the bundle at its
 * bundle price). A bundle line whose selection did not load gets
 * `bundle_unit_price: null` and keeps no shelf price — it cannot be bought
 * until it loads. Ordinary lines come back exactly as they went in.
 */
export function priceCartBundles<T extends { product_id: string; bundle_selection_id?: string | null; product?: { price: number } | null }>(
  lines: readonly T[], info: ReadonlyMap<string, BundleInfo>,
): (T & { bundle?: BundleInfo | null; bundle_unit_price?: number | null })[] {
  return lines.map(l => {
    if (!l.bundle_selection_id) return l
    const b = info.get(l.bundle_selection_id) ?? null
    const part = b?.lines.find(x => x.product_id === l.product_id) ?? null
    const unit = part ? part.unit_price : null
    return {
      ...l,
      bundle: b,
      bundle_unit_price: unit,
      product: l.product ? { ...l.product, price: unit ?? 0 } : l.product,
    }
  })
}

export type BundleBlock =
  | { kind: 'ok' }
  | { kind: 'unloaded'; says: string }
  | { kind: 'currency'; says: string }
  | { kind: 'expired'; says: string }
  | { kind: 'part-unavailable'; product_id: string; name: string; says: string }
  /* A part the marketplace's stock flag caught (baskets.ts): blocked whole until removed. */
  | { kind: 'stock'; says: string }

/**
 * Whether a bundle in the basket can be bought now, and the sentence when it
 * cannot. `available` says whether a product is still on sale as the screen
 * last read it; the database decides finally.
 */
export function bundleBlock(
  info: BundleInfo | null | undefined, currency: string, now: string,
  available: (productId: string) => boolean,
): BundleBlock {
  if (!info) return { kind: 'unloaded', says: 'This bundle’s price did not load, so it cannot be bought yet. Reload, or remove it.' }
  if (info.selection.currency !== currency) {
    return { kind: 'currency', says: `${info.name} is priced in ${info.selection.currency}, and this basket is being paid in ${currency}.` }
  }
  const s = bundleStanding(info.selection, info.lines, now, available)
  if (s.kind === 'expired') {
    return { kind: 'expired', says: `The price of ${info.name} was held for seven days and that has passed. Re-price it to continue.` }
  }
  if (s.kind === 'part-unavailable') {
    return { ...s, says: `${s.name} is no longer available as it was configured, so ${info.name} cannot be bought. Edit the bundle to continue.` }
  }
  return { kind: 'ok' }
}

/* ------------------------------------------------------- requisition -- */

/** The facts a requisition line needs that a selection line does not carry. */
export interface PartFacts { id: string; seller: string; model: string; category_id: string; unit: string | null }

/** A selection's lines as requisition basket lines, at the selection's unit
    prices. A part whose product could not be read is named in `unread`. */
export function bundleBasketLines(
  info: BundleInfo, facts: ReadonlyMap<string, PartFacts>,
): { lines: BasketLine[]; unread: string[] } {
  const meta: BundleMeta = {
    templateId: info.selection.template_id, name: info.name, choices: info.selection.choices,
    quantity: info.selection.quantity, currency: info.selection.currency,
    validUntil: info.selection.valid_until, total: info.selection.total,
  }
  const lines: BasketLine[] = []
  const unread: string[] = []
  for (const l of [...info.lines].sort((a, b) => a.sort_order - b.sort_order)) {
    const p = facts.get(l.product_id)
    if (!p) { unread.push(l.name); continue }
    lines.push({
      product_id: l.product_id, name: l.name, seller: l.seller || p.seller, partner_id: l.partner_id,
      quantity: l.quantity, unit_price: l.unit_price,
      model: billingOf(p.model), vertical: p.category_id, unit: p.unit,
      bundle_selection_id: info.selection.id, bundle: meta,
    })
  }
  return { lines, unread }
}

/** How a requisition line is committed to for a product model: monthly, or
    one-off for anything else. */
export const billingOf = (model: string | null | undefined): 'oneoff' | 'monthly' =>
  (model === 'monthly' ? 'monthly' : 'oneoff')

/** Why a bundle cannot join a requisition already committed the other way. */
function otherCommitment(held: 'oneoff' | 'monthly', name: string): string {
  return `This requisition is ${held === 'monthly' ? 'a monthly subscription' : 'a one-off purchase'} and ${name} is not. They are committed to and approved differently, so raise them separately.`
}

/** How the lines a requisition basket already holds are committed to,
    leaving out the bundle being replaced (Edit bundle), or null when nothing
    else is held — what `addBundleToBasket` compares a new bundle against. */
export function heldBilling(basket: Basket, replaceSelectionId?: string): 'oneoff' | 'monthly' | null {
  const rest = replaceSelectionId ? basket.lines.filter(l => l.bundle_selection_id !== replaceSelectionId) : basket.lines
  return rest.length ? rest[0].model : null
}

/**
 * Whether the chosen parts of a business bundle cannot go on the requisition
 * for how they are billed, as the sentence to show, or null when they can:
 * the parts mix one-off and monthly, or `held` (the open requisition's
 * commitment, `heldBilling`) is the other one. The same rules
 * `addBundleToBasket` refuses by, said before `configure_bundle` writes a
 * selection nobody could put on the requisition. A part whose model is not
 * known (`modelOf` gives nothing) is left to the basket.
 */
export function requisitionBillingBlock(
  name: string, picks: readonly { product_id: string }[],
  modelOf: (productId: string) => string | null | undefined, nameOf: (productId: string) => string,
  held: 'oneoff' | 'monthly' | null = null,
): string | null {
  const known = picks.flatMap(p => {
    const m = modelOf(p.product_id)
    return m == null ? [] : [{ id: p.product_id, billing: billingOf(m) }]
  })
  const billings = new Set(known.map(k => k.billing))
  if (billings.size === 0) return null
  if (billings.size === 1) {
    const [mine] = billings
    return held && held !== mine ? `${otherCommitment(held, name)} Request a quote for this bundle, or raise the requisition first.` : null
  }
  const parts = known
    .slice().sort((a, b) => (a.billing === b.billing ? 0 : a.billing === 'oneoff' ? -1 : 1))
    .map(k => `${nameOf(k.id)} (${k.billing === 'oneoff' ? 'one-off' : 'monthly'})`)
  return `${name} mixes one-off and monthly parts (${parts.join(', ')}), which are approved differently, so it cannot go on one requisition. Choose parts billed the same way, or request a quote.`
}

export type BundleBasketResult = { ok: true; basket: Basket; note: string } | { ok: false; reason: string }

/**
 * Put a whole bundle into a requisition basket, in place of `replaceSelectionId`
 * when it is given (Edit bundle, a new quantity, Re-price). The bundle goes in
 * whole or not at all, in its own currency, and is refused beside lines of
 * the other commitment (one-off against monthly).
 */
export function addBundleToBasket(
  basket: Basket, lines: readonly BasketLine[], currency: string, replaceSelectionId?: string,
): BundleBasketResult {
  if (!lines.length) return { ok: false, reason: 'That bundle has no parts to add.' }
  const id = lines[0].bundle_selection_id
  if (!id || lines.some(l => l.bundle_selection_id !== id)) {
    return { ok: false, reason: 'Those lines are not one bundle.' }
  }
  const name = lines[0].bundle?.name ?? BUNDLE_FALLBACK_NAME
  if (basket.lines.some(l => l.bundle_selection_id === id)) {
    return { ok: false, reason: `${name} is already in your requisition.` }
  }
  const at = replaceSelectionId ? basket.lines.findIndex(l => l.bundle_selection_id === replaceSelectionId) : -1
  const rest = replaceSelectionId ? basket.lines.filter(l => l.bundle_selection_id !== replaceSelectionId) : basket.lines
  if (rest.length && basket.currency !== currency) {
    return {
      ok: false,
      reason: `This requisition is priced in ${basket.currency} and ${name} is priced in ${currency}. A requisition is settled in one currency, so raise or empty it first.`,
    }
  }
  const model = lines[0].model
  if (lines.some(l => l.model !== model)) {
    return { ok: false, reason: `${name} mixes one-off and monthly parts, which are approved differently, so it cannot go on one requisition.` }
  }
  if (rest.length && rest[0].model !== model) {
    return { ok: false, reason: otherCommitment(rest[0].model, name) }
  }
  const next = rest.slice()
  if (at >= 0) next.splice(Math.min(at, next.length), 0, ...lines)
  else next.push(...lines)
  return { ok: true, basket: { currency, lines: next }, note: replaceSelectionId ? `${name} updated` : `${name} added` }
}

/** Take every line of one bundle out. */
export function removeBundleFromBasket(basket: Basket, selectionId: string): Basket {
  const lines = basket.lines.filter(l => l.bundle_selection_id !== selectionId)
  return lines.length ? { ...basket, lines } : { currency: '', lines: [] }
}

/** Whether the basket holds a configured bundle. */
export function holdsBundle(basket: Basket): boolean {
  return basket.lines.some(isBundleLine)
}

/** What to say when the shelf moves to another currency under a basket whose
    prices are fixed (a quote or a bundle), or null when nothing is held. */
export function heldCurrencyNote(basket: Basket, shelf: string): string | null {
  const quoted = basket.lines.some(l => !!l.quote_line_id)
  const bundled = holdsBundle(basket)
  if (!quoted && !bundled) return null
  const what = quoted && bundled ? 'quoted prices and a configured bundle' : quoted ? 'quoted prices' : 'a configured bundle'
  const which = quoted && bundled ? 'those lines' : quoted ? 'the quoted lines' : 'the bundle'
  return `Your requisition holds ${what} in ${basket.currency}, so it stays in ${basket.currency}. Raise it, or remove ${which}, before adding from the ${shelf} shelf.`
}

/** Whether a requisition bundle can still be raised, from what its basket
    lines remember: the same standing as the basket's, by the instant its hold
    ends. Parts on sale are the database's check when the requisition is
    written (the basket does not carry product status). */
export function requisitionBundleBlock(
  meta: BundleMeta | undefined, lines: readonly { product_id: string; name: string }[], currency: string, now: string,
): BundleBlock {
  if (!meta) return { kind: 'ok' }
  if (meta.currency !== currency) {
    return { kind: 'currency', says: `${meta.name} is priced in ${meta.currency}, and this requisition is in ${currency}.` }
  }
  const s = bundleStanding({ valid_until: meta.validUntil }, lines, now, () => true)
  if (s.kind === 'expired') {
    return { kind: 'expired', says: `The price of ${meta.name} was held for seven days and that has passed. Re-price it to raise it.` }
  }
  return { kind: 'ok' }
}

/** Whether a basket line's product is still on sale as the screen read it:
    live and not out of stock. A line whose product did not load is not. */
export function partOnSale(product: { status?: string | null; stock?: string | null } | null | undefined): boolean {
  if (!product) return false
  if (product.status != null && product.status !== 'live') return false
  return !(product.stock ?? '').toLowerCase().includes('out')
}

/** The bundles in a basket that stop it being bought, with their sentences. */
export function basketBundleBlocks<T extends { product_id: string; bundle_selection_id?: string | null; bundle?: BundleInfo | null; product?: { status?: string | null; stock?: string | null } | null }>(
  lines: readonly T[], currency: string, now: string,
): { selectionId: string; block: Exclude<BundleBlock, { kind: 'ok' }> }[] {
  const out: { selectionId: string; block: Exclude<BundleBlock, { kind: 'ok' }> }[] = []
  for (const id of bundleIdsOf(lines)) {
    const mine = lines.filter(l => l.bundle_selection_id === id)
    const onSale = new Map(mine.map(l => [l.product_id, partOnSale(l.product)]))
    const b = bundleBlock(mine[0]?.bundle ?? null, currency, now, pid => onSale.get(pid) ?? true)
    if (b.kind !== 'ok') out.push({ selectionId: id, block: b })
  }
  return out
}

/** The lines a raised requisition writes for a bundle part: its selection and
    its fixed unit price. Only sent when set, so an ordinary line writes exactly
    the columns it always has. */
export function bundleColumns(l: { bundle_selection_id?: string | null }): { bundle_selection_id?: string } {
  return l.bundle_selection_id ? { bundle_selection_id: l.bundle_selection_id } : {}
}

/** How long a monthly bundle part renews at the bundle price (spec 11, decision 3). */
export const BUNDLE_PRICE_MONTHS = 12

/** The day the bundle price stops on a part bought on `purchasedOn`: the same
    day twelve months on (clamped into a shorter month). A renewal starting on
    that day is charged the published price. */
export function bundlePriceUntil(purchasedOn: string): string {
  return nextRenewalFrom(purchasedOn, BUNDLE_PRICE_MONTHS)
}

/** What a monthly bundle part's subscription carries beyond an ordinary one.
    Nothing on an ordinary line, so its insert writes what it always has (and
    still works before the columns exist). */
export function bundleSubscriptionColumns(
  l: { bundle_selection_id?: string | null }, purchasedOn: string,
): { bundle_selection_id?: string; bundle_price_until?: string } {
  return l.bundle_selection_id
    ? { bundle_selection_id: l.bundle_selection_id, bundle_price_until: bundlePriceUntil(purchasedOn) }
    : {}
}

/** Said under a monthly bundle part: what it renews at, and from when. Null
    for a one-off part, or when its published price in this currency is not
    known (nothing is promised that cannot be stated). */
export function bundleRenewalNote(
  model: string | null | undefined, listUnitPrice: number | null | undefined, fmt: (n: number) => string,
): string | null {
  if (billingOf(model) !== 'monthly') return null
  if (listUnitPrice == null || !Number.isFinite(Number(listUnitPrice))) return null
  return `Bundle price for ${BUNDLE_PRICE_MONTHS} months, then ${fmt(Number(listUnitPrice))}/month`
}
