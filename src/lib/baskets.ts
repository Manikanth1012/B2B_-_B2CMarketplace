/**
 * Baskets that are kept, watched and kept honest — the rules, without a database.
 *
 * A business buyer's requisition basket and a shopper's cart both live in the
 * database now (spec 11, decisions 1 and 2a–2c). Three things follow, and each
 * is decided here so the screens cannot disagree about it:
 *
 *  - how long a basket has been left (Pending under seven days, Abandoned from
 *    seven), which is what the operator watches;
 *  - what a stock flag means for a line — its note, and whether the buyer may
 *    accept it or only remove the line;
 *  - when a basket cannot go forward: any flagged line blocks it, and a bundle
 *    with a flagged part is blocked as a whole.
 *
 * The flags themselves are the database's (flag_basket_stock); nothing here
 * writes one. Pure: no Supabase.
 */
import type { Basket, BasketLine } from './requisitionBasket'
import type { BundleMeta, BundleBlock } from './bundleLines'
import { round2 } from './money'

/* ------------------------------------------------------------ idleness -- */

export const IDLE_DAYS = 7
const DAY_MS = 86_400_000

export type IdleState = 'pending' | 'abandoned'

/** Pending when the owner changed it in the last seven days, Abandoned after.
    An unreadable date reads as pending: nobody is chased on a guess. */
export function idleState(lastChange: string, now: Date | string): IdleState {
  const t = Date.parse(lastChange)
  const n = typeof now === 'string' ? Date.parse(now) : now.getTime()
  if (Number.isNaN(t) || Number.isNaN(n)) return 'pending'
  return n - t >= IDLE_DAYS * DAY_MS ? 'abandoned' : 'pending'
}

export const IDLE_LABEL: Record<IdleState, string> = { pending: 'Pending', abandoned: 'Abandoned' }

/* ---------------------------------------------------------------- value -- */

/** What the lines come to, to the cent. */
export function basketValue(lines: readonly { quantity: number; unit_price: number }[]): number {
  return round2(lines.reduce((n, l) => n + round2(Number(l.quantity) * Number(l.unit_price)), 0))
}

/* ---------------------------------------------------------------- flags -- */

/** The note the database writes when a listing cannot be bought at all. */
export const NO_LONGER_AVAILABLE = 'No longer available'

export interface Flaggable {
  stock_note?: string | null
  bundle_selection_id?: string | null
}

export type FlagAction = 'accept' | 'remove'

export const isFlagged = (l: Flaggable): boolean => !!l.stock_note

/**
 * What a flagged line shows and offers. A line cut to what is left can be
 * accepted (the quantity stays cut) or removed. A line no longer available can
 * only be removed — there is nothing to accept. A bundle part is never cut and
 * leaves only with its bundle, so it offers Remove (the bundle).
 */
export function lineFlag(l: Flaggable): { note: string; actions: FlagAction[] } | null {
  if (!l.stock_note) return null
  if (l.stock_note === NO_LONGER_AVAILABLE || l.bundle_selection_id) return { note: l.stock_note, actions: ['remove'] }
  return { note: l.stock_note, actions: ['accept', 'remove'] }
}

/** Whether anything in the basket stops it being raised or ordered. */
export function isBlocked(lines: readonly Flaggable[]): boolean {
  return lines.some(isFlagged)
}

export function flagCount(lines: readonly Flaggable[]): number {
  return lines.filter(isFlagged).length
}

/** The bundles with a flagged part: each is blocked whole. */
export function flaggedSelections(lines: readonly Flaggable[]): Set<string> {
  const out = new Set<string>()
  for (const l of lines) if (l.bundle_selection_id && isFlagged(l)) out.add(l.bundle_selection_id)
  return out
}

/** The sentence beside a Raise or Place order button that is off because of a flag. */
export function blockedSentence(lines: readonly Flaggable[], what: 'requisition' | 'order'): string | null {
  const n = flagCount(lines)
  if (!n) return null
  const act = what === 'requisition' ? 'raise this requisition' : 'place this order'
  return n === 1
    ? `1 line changed because stock ran out. Accept or remove it before you ${act}.`
    : `${n} lines changed because stock ran out. Accept or remove each of them before you ${act}.`
}

/** Why a bundle is blocked by a flagged part, or null when none is. */
export function bundleStockSays(lines: readonly (Flaggable & { name: string })[], bundleName: string): string | null {
  const part = lines.find(isFlagged)
  if (!part) return null
  return `${part.name}: ${part.stock_note}. ${bundleName} cannot be bought as it is. Remove the bundle to continue.`
}

/** The bundle's block when a part is flagged, in the shape the bundle card shows; null when none is. */
export function stockBlock(lines: readonly (Flaggable & { name: string })[], bundleName: string): BundleBlock | null {
  const says = bundleStockSays(lines, bundleName)
  return says ? { kind: 'stock', says } : null
}

/* -------------------------------------------------------- shopper carts -- */

export interface CartRowLike {
  user_id: string | null
  quantity: number
  /** The line's unit price in the owner's money; null when it could not be priced. */
  unit_price: number | null
  saved?: boolean | null
  updated_at?: string | null
  created_at?: string | null
  stock_note?: string | null
}

export interface CartGroup<T extends CartRowLike> {
  user_id: string
  lines: T[]
  lineCount: number
  value: number
  /** Lines with no price, left out of `value`. */
  unpriced: number
  flags: number
  lastChange: string
}

/**
 * Shopper baskets by owner: the lines being bought (saved-for-later lines are
 * not), what they come to, how many are flagged and the owner's last change —
 * the latest of their lines. An owner with only saved lines has no basket.
 * Newest change first.
 */
export function cartsByUser<T extends CartRowLike>(rows: readonly T[]): CartGroup<T>[] {
  const by = new Map<string, T[]>()
  for (const r of rows) {
    if (!r.user_id || r.saved) continue
    const list = by.get(r.user_id) ?? []
    list.push(r)
    by.set(r.user_id, list)
  }
  const out: CartGroup<T>[] = []
  for (const [user_id, lines] of by) {
    const priced = lines.filter(l => l.unit_price !== null && Number.isFinite(Number(l.unit_price)))
    const lastChange = lines
      .map(l => l.updated_at ?? l.created_at ?? '')
      .reduce((a, b) => (b > a ? b : a), '')
    out.push({
      user_id, lines, lineCount: lines.length,
      value: basketValue(priced.map(l => ({ quantity: l.quantity, unit_price: Number(l.unit_price) }))),
      unpriced: lines.length - priced.length,
      flags: flagCount(lines), lastChange,
    })
  }
  return out.sort((a, b) => (a.lastChange < b.lastChange ? 1 : a.lastChange > b.lastChange ? -1 : 0))
}

/* ------------------------------------------- the kept requisition basket -- */

/** A line as save_requisition_basket and the table return it. */
export interface KeptLine {
  id: string
  product_id: string
  name: string
  seller: string
  partner_id: string | null
  quantity: number
  unit_price: number
  model: 'oneoff' | 'monthly'
  vertical: string | null
  unit: string | null
  quote_line_id: string | null
  bundle_selection_id: string | null
  bundle: BundleMeta | null
  on_contract: boolean | null
  off_contract_reason: string | null
  stock_note: string | null
  was_quantity: number | null
  flagged_at: string | null
  sort_order: number
}

export interface KeptBasket {
  id: string
  account_id: string
  currency: string
  updated_at: string
  reminded_at: string | null
  lines: KeptLine[]
}

/** Which line is which across a save: product, bundle and quote — as the database matches them. */
export const lineKey = (l: Pick<BasketLine, 'product_id' | 'bundle_selection_id' | 'quote_line_id'>): string =>
  `${l.product_id}|${l.bundle_selection_id ?? ''}|${l.quote_line_id ?? ''}`

const flagOf = (k: KeptLine) => ({
  id: k.id, stock_note: k.stock_note ?? null,
  was_quantity: k.was_quantity == null ? null : Number(k.was_quantity),
  flagged_at: k.flagged_at ?? null,
})

/** A kept line as the client's line. Optional fields the client leaves unset stay unset. */
export function keptToLine(k: KeptLine): BasketLine {
  const l: BasketLine = {
    product_id: k.product_id, name: k.name, seller: k.seller ?? '', partner_id: k.partner_id ?? null,
    quantity: Number(k.quantity), unit_price: round2(Number(k.unit_price)),
    model: k.model, vertical: k.vertical ?? '', unit: k.unit ?? null,
    ...flagOf(k),
  }
  if (k.quote_line_id) l.quote_line_id = k.quote_line_id
  if (k.bundle_selection_id) l.bundle_selection_id = k.bundle_selection_id
  if (k.bundle) l.bundle = k.bundle
  if (k.on_contract !== null && k.on_contract !== undefined) l.on_contract = k.on_contract
  if (k.off_contract_reason) l.off_contract_reason = k.off_contract_reason
  return l
}

/** A kept basket as the client's basket; none is the empty one. */
export function fromKept(k: KeptBasket | null): Basket {
  if (!k || !k.lines.length) return { currency: '', lines: [] }
  return {
    currency: k.currency,
    lines: [...k.lines].sort((a, b) => a.sort_order - b.sort_order).map(keptToLine),
  }
}

/** What save_requisition_basket is sent: the line, without what only the database writes. */
export function lineToSave(l: BasketLine): Record<string, unknown> {
  return {
    product_id: l.product_id, name: l.name, seller: l.seller, partner_id: l.partner_id,
    quantity: l.quantity, unit_price: l.unit_price, model: l.model, vertical: l.vertical, unit: l.unit,
    quote_line_id: l.quote_line_id ?? null, bundle_selection_id: l.bundle_selection_id ?? null,
    bundle: l.bundle ?? null, on_contract: l.on_contract ?? null, off_contract_reason: l.off_contract_reason ?? null,
  }
}

/**
 * The basket after a save came back. Each line takes the server's id and stock
 * flag — the database may have flagged it since, and a save must never put an
 * old flag back. A line the buyer left alone while the save was out also takes
 * the server's quantity (the database may have cut it); a line they changed
 * meanwhile keeps their quantity, and the next save judges it. Lines the
 * server did not return are left as they are.
 */
export function mergeSaved(current: Basket, sent: Basket, server: KeptBasket | null): Basket {
  if (!server) return current
  const byKey = new Map(server.lines.map(k => [lineKey(k), k]))
  const sentBy = new Map(sent.lines.map(l => [lineKey(l), l]))
  let changed = false
  const lines = current.lines.map(l => {
    const k = byKey.get(lineKey(l))
    if (!k) return l
    const untouched = sentBy.get(lineKey(l))?.quantity === l.quantity
    const next: BasketLine = { ...l, ...flagOf(k) }
    if (untouched && Number(k.quantity) !== l.quantity) next.quantity = Number(k.quantity)
    if (next.id !== l.id || next.stock_note !== (l.stock_note ?? null) || next.was_quantity !== (l.was_quantity ?? null)
        || next.flagged_at !== (l.flagged_at ?? null) || next.quantity !== l.quantity) changed = true
    return next
  })
  return changed ? { ...current, lines } : current
}

/**
 * Ordinary lines whose listing has no published price in the basket's money
 * any more — fallen off the shelf while the basket was kept. Quoted and
 * bundled lines are held by their own prices and never fall off this way.
 */
export function fellOff(
  basket: Basket, published: ReadonlyMap<string, unknown>,
): { product_id: string; name: string }[] {
  return basket.lines
    .filter(l => !l.quote_line_id && !l.bundle_selection_id && !published.has(l.product_id))
    .map(l => ({ product_id: l.product_id, name: l.name }))
}
