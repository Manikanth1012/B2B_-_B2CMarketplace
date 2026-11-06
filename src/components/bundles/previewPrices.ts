/* What a template being built would cost, per currency, before it is saved.
   Pure: the same arithmetic as the database (priceBundle), so the operator sees
   an estimate and the part that would hit its floor. The database still decides
   whether the bundle may be published. */
import { defaultChoices, priceBundle } from '../../lib/bundles'
import type { BundleOption, BundleSlot, PricedPart } from '../../lib/bundles'
import { bundleRoom } from '../../lib/pricing'

export interface PreviewSlot extends Omit<BundleSlot, 'template_id'> { options: { product_id: string; is_default: boolean }[] }
export interface PreviewPrice { price: number; floor_price: number | null }
export type PreviewKind = 'default' | 'cheapest' | 'dearest'

export type PreviewResult =
  | { kind: 'ok'; total: number; saving: number; partsTotal: number; atFloor: string[]; tightest: { name: string; roomPct: number } | null; parts: number }
  | { kind: 'missing'; names: string[] }
  | { kind: 'empty' }

/** The parts of one configuration. */
function configuration(slots: readonly PreviewSlot[], kind: PreviewKind, book: ReadonlyMap<string, PreviewPrice>) {
  if (kind === 'default') {
    const asSlots = slots as unknown as BundleSlot[]
    const opts: BundleOption[] = slots.flatMap(s => s.options.map((o, i) => ({
      id: `${s.id}:${i}`, slot_id: s.id, product_id: o.product_id, is_default: o.is_default, sort_order: i,
    })))
    const picks = defaultChoices(asSlots, opts)
    return slots.flatMap(s => (picks[s.id] ?? []).map(p => ({ product_id: p.product_id, quantity: p.quantity })))
  }
  const dear = kind === 'dearest'
  return slots.flatMap(s => {
    const ranked = s.options
      .map(o => ({ id: o.product_id, p: book.get(o.product_id)?.price ?? Number.POSITIVE_INFINITY }))
      .sort((a, b) => (dear ? b.p - a.p : a.p - b.p))
    const count = dear ? s.max_pick : s.min_pick
    return ranked.slice(0, count).map(r => ({ product_id: r.id, quantity: dear ? s.qty_max : s.qty_min }))
  })
}

export function previewConfiguration(
  slots: readonly PreviewSlot[], kind: PreviewKind, discountPct: number,
  book: ReadonlyMap<string, PreviewPrice>, nameOf: (productId: string) => string,
): PreviewResult {
  const picks = configuration(slots, kind, book)
  if (picks.length === 0 || !(discountPct > 0 && discountPct < 100)) return { kind: 'empty' }
  const missing = [...new Set(picks.filter(p => !book.has(p.product_id)).map(p => nameOf(p.product_id)))]
  if (missing.length) return { kind: 'missing', names: missing }
  const parts: PricedPart[] = picks.map(p => {
    const row = book.get(p.product_id)!
    return { product_id: p.product_id, list: row.price, floor: row.floor_price, quantity: p.quantity }
  })
  const priced = priceBundle(parts, discountPct, 1)
  const room = bundleRoom(parts.map(p => ({
    productId: p.product_id, name: nameOf(p.product_id), quantity: p.quantity, price: p.list, floor_price: p.floor ?? 0,
  })))
  return {
    kind: 'ok', total: priced.total, saving: priced.saving, partsTotal: priced.parts_total, parts: parts.length,
    atFloor: [...new Set(priced.lines.filter(l => l.at_floor).map(l => nameOf(l.product_id)))],
    tightest: room.tightest[0] ? { name: room.tightest[0].name, roomPct: room.tightest[0].roomPct } : null,
  }
}
