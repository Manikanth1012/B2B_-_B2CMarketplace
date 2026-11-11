/* The shop's side of a buyer-built bundle, pure: which templates a shelf shows,
 * what a choice costs by the price book the shop holds, and the words for a
 * slot. No database here — the estimate is only ever an estimate, and the
 * database's price (configure_bundle) is the one that is charged.
 */
import {
  defaultChoices, priceBundle,
  type BundleTemplate, type BundleSlot, type BundleOption, type Choices, type PricedPart, type BundlePrice,
} from '../../lib/bundles'
import type { BundlePart } from '../../lib/bundleRepo'

/** One product a bundle may contain, as the shop sees it in one currency. */
export type ShelfPart = BundlePart

export interface Shelf {
  templates: BundleTemplate[]
  slots: BundleSlot[]
  options: BundleOption[]
  parts: Map<string, ShelfPart>
}

export const EMPTY_SHELF: Shelf = { templates: [], slots: [], options: [], parts: new Map() }

export const slotsOf = (shelf: Shelf, templateId: string): BundleSlot[] =>
  shelf.slots.filter(s => s.template_id === templateId).sort((a, b) => a.sort_order - b.sort_order)

export const optionsOf = (shelf: Shelf, slotIds: readonly string[]): BundleOption[] => {
  const ids = new Set(slotIds)
  return shelf.options.filter(o => ids.has(o.slot_id)).sort((a, b) => a.sort_order - b.sort_order)
}

/** Why a part cannot be chosen right now, in the database's terms, or null. */
export function unavailable(part: ShelfPart | undefined, currency: string, audience?: 'consumer' | 'enterprise'): string | null {
  if (!part) return 'Not on sale'
  if (part.status !== 'live') return 'Not on sale'
  if (audience && !part.audiences.includes(audience)) return audience === 'consumer' ? 'Not sold to shoppers' : 'Not sold to business accounts'
  if (part.stock === 'out') return 'Out of stock'
  if (part.list === null) return `Not sold in ${currency}`
  return null
}

/** The picks as priced parts, in slot order. Null when a pick has no price. */
export function partsFor(slots: readonly BundleSlot[], choices: Choices, parts: ReadonlyMap<string, ShelfPart>): PricedPart[] | null {
  const out: PricedPart[] = []
  for (const s of slots) {
    for (const pick of choices[s.id] ?? []) {
      const p = parts.get(pick.product_id)
      if (!p || p.list === null) return null
      out.push({ product_id: p.id, list: p.list, floor: p.floor, quantity: pick.quantity })
    }
  }
  return out
}

/** priceBundle that answers null instead of throwing (a bad discount, no parts). */
export function estimate(parts: readonly PricedPart[] | null, discountPct: number, bundleQty: number): BundlePrice | null {
  if (!parts || parts.length === 0) return null
  try { return priceBundle(parts, discountPct, bundleQty) } catch { return null }
}

/** The "from" price of a template: its default configuration, one bundle.
    Null when the default cannot be bought here (a part unpriced or unavailable). */
export function fromPrice(template: BundleTemplate, shelf: Shelf, currency: string, audience?: 'consumer' | 'enterprise'): BundlePrice | null {
  const slots = slotsOf(shelf, template.id)
  if (slots.length === 0) return null
  const options = optionsOf(shelf, slots.map(s => s.id))
  const choices = defaultChoices(slots, options)
  const picked = Object.values(choices).flat()
  if (picked.some(p => unavailable(shelf.parts.get(p.product_id), currency, audience) !== null)) return null
  return estimate(partsFor(slots, choices, shelf.parts), template.discount_pct, 1)
}

/** The templates a shelf shows: live, for this audience, optionally only those
    with a part in one category, and only those whose default can be bought. */
export function templatesFor(
  shelf: Shelf, audience: 'consumer' | 'enterprise', currency: string,
  opts: { category?: string | null; search?: string } = {},
): { template: BundleTemplate; from: BundlePrice }[] {
  const q = (opts.search ?? '').trim().toLowerCase()
  const out: { template: BundleTemplate; from: BundlePrice }[] = []
  for (const t of shelf.templates) {
    if (t.status !== 'live' || !t.audiences.includes(audience)) continue
    if (q && !`${t.name} ${t.description ?? ''}`.toLowerCase().includes(q)) continue
    if (opts.category) {
      const slotIds = slotsOf(shelf, t.id).map(s => s.id)
      const inShelf = optionsOf(shelf, slotIds).some(o => shelf.parts.get(o.product_id)?.category_id === opts.category)
      if (!inShelf) continue
    }
    const from = fromPrice(t, shelf, currency, audience)
    if (from) out.push({ template: t, from })
  }
  return out
}

/** What a slot asks for, in words. */
export function slotHint(s: BundleSlot): string {
  if (s.min_pick === 0 && s.max_pick === 1) return 'Optional — choose one or none'
  if (s.min_pick === 0) return `Optional — choose up to ${s.max_pick}`
  if (s.min_pick === s.max_pick) return s.max_pick === 1 ? 'Choose one' : `Choose ${s.max_pick}`
  return `Choose ${s.min_pick} to ${s.max_pick}`
}

/** Toggle a product in a slot. A single-pick slot replaces; a multi-pick slot
    adds or removes. The new pick starts at the slot's default quantity. */
export function togglePick(choices: Choices, slot: BundleSlot, productId: string): Choices {
  const picks = choices[slot.id] ?? []
  const has = picks.some(p => p.product_id === productId)
  const fresh = { product_id: productId, quantity: slot.qty_default }
  let next
  if (slot.max_pick === 1) next = has && slot.min_pick === 0 ? [] : [has ? picks[0] : fresh]
  else next = has ? picks.filter(p => p.product_id !== productId) : [...picks, fresh]
  return { ...choices, [slot.id]: next }
}

/** Clear a single-pick optional slot ("None"). */
export const clearSlot = (choices: Choices, slotId: string): Choices => ({ ...choices, [slotId]: [] })

/** Set one pick's quantity, kept within the slot's range. */
export function setPickQty(choices: Choices, slot: BundleSlot, productId: string, quantity: number): Choices {
  const q = Math.min(slot.qty_max, Math.max(slot.qty_min, Math.round(quantity)))
  return { ...choices, [slot.id]: (choices[slot.id] ?? []).map(p => (p.product_id === productId ? { ...p, quantity: q } : p)) }
}

/** Whether the server's total is not the one the buyer was shown. */
export const totalsDiffer = (shown: number, server: number): boolean => Math.abs(shown - server) >= 0.005

export const BUNDLE_QTY_MAX = 999

/** A product picked in more than one slot (the database refuses it), or null. */
export function pickedTwice(choices: Choices): string | null {
  const seen = new Set<string>()
  for (const picks of Object.values(choices)) {
    for (const p of new Set(picks.map(x => x.product_id))) {
      if (seen.has(p)) return p
      seen.add(p)
    }
  }
  return null
}

/** The currency a bundle is priced in: the buyer's own (consumer home or
    business account currency), which is the only one configure_bundle takes.
    A visitor has none, and sees the shop's. */
export function bundleCurrency(account: string | null, header: string | null): string | null {
  return account ?? header
}
