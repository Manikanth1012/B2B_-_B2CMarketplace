/**
 * The arithmetic and rules of a buyer-built bundle. Pure: no database, no
 * clock. The database enforces every rule here (price_bundle, configure_bundle
 * and the guards); these functions mirror it so the screen can show an
 * estimate and a reason before it asks, and never decide differently.
 */
import { round2 } from './money'

export interface BundleTemplate { id: string; name: string; description: string | null; image: string | null; status: 'draft' | 'live' | 'paused'; audiences: ('consumer' | 'enterprise')[]; discount_pct: number }
export interface BundleSlot { id: string; template_id: string; label: string; min_pick: number; max_pick: number; qty_min: number; qty_max: number; qty_default: number; sort_order: number }
export interface BundleOption { id: string; slot_id: string; product_id: string; is_default: boolean; sort_order: number }
export type Choices = Record<string, { product_id: string; quantity: number }[]>   // slot id → picks
export interface PricedPart { product_id: string; list: number; floor: number | null; quantity: number }   // quantity per bundle
export interface PricedLine extends PricedPart { unit_price: number; line_total: number; at_floor: boolean }
export interface BundlePrice { lines: PricedLine[]; parts_total: number; total: number; saving: number }

/** The starting configuration: each required slot gets its default option(s)
    at the slot's default quantity; optional slots start empty. */
export function defaultChoices(slots: readonly BundleSlot[], options: readonly BundleOption[]): Choices {
  const out: Choices = {}
  for (const s of slots) {
    if (s.min_pick < 1) { out[s.id] = []; continue }
    out[s.id] = options
      .filter(o => o.slot_id === s.id && o.is_default)
      .sort((a, b) => a.sort_order - b.sort_order)
      .slice(0, s.max_pick)
      .map(o => ({ product_id: o.product_id, quantity: s.qty_default }))
  }
  return out
}

const plural = (n: number) => (n === 1 ? '' : 's')

/** What is wrong with a configuration, one sentence per offending slot id.
    An empty object means it is acceptable. */
export function validateChoices(
  slots: readonly BundleSlot[], options: readonly BundleOption[], choices: Choices,
): Record<string, string> {
  const problems: Record<string, string> = {}
  const known = new Set(slots.map(s => s.id))
  for (const id of Object.keys(choices)) {
    if (!known.has(id)) problems[id] = 'There is no such slot in this bundle'
  }
  for (const s of slots) {
    const picks = choices[s.id] ?? []
    if (picks.length < s.min_pick) {
      problems[s.id] = `Pick at least ${s.min_pick} ${s.label}`
      continue
    }
    if (picks.length > s.max_pick) {
      problems[s.id] = `Pick at most ${s.max_pick} ${s.label}`
      continue
    }
    const allowed = new Set(options.filter(o => o.slot_id === s.id).map(o => o.product_id))
    if (picks.some(p => !allowed.has(p.product_id))) {
      problems[s.id] = `A product picked for ${s.label} is not an option there`
      continue
    }
    if (new Set(picks.map(p => p.product_id)).size !== picks.length) {
      problems[s.id] = `Pick each ${s.label} product only once`
      continue
    }
    if (picks.some(p => !Number.isInteger(p.quantity) || p.quantity < s.qty_min || p.quantity > s.qty_max)) {
      problems[s.id] = `Choose ${s.qty_min} to ${s.qty_max} of each ${s.label} (${s.qty_max} unit${plural(s.qty_max)} at most)`
    }
  }
  return problems
}

/**
 * Same arithmetic as the database's price_bundle; keep them identical.
 * unit_price = max(round2(list × (1 − d/100)), round2(floor ?? 0)); line quantity =
 * part quantity × bundle quantity; each line is rounded, the total is exactly
 * the sum of the rounded lines.
 */
export function priceBundle(parts: readonly PricedPart[], discountPct: number, bundleQty: number): BundlePrice {
  if (!(discountPct > 0 && discountPct < 100)) throw new Error('A bundle discount must be above 0% and below 100%')
  if (!Number.isInteger(bundleQty) || bundleQty < 1) throw new Error('A bundle quantity must be a whole number, at least 1')
  const lines: PricedLine[] = parts.map(p => {
    const quantity = p.quantity * bundleQty
    const discounted = round2(p.list * (1 - discountPct / 100))
    /* Rounded to 2 dp once, as price_bundle does, so a floor stored with more
       decimals cannot make the screen and the database disagree by a cent. */
    const floor = round2(p.floor ?? 0)
    const at_floor = discounted < floor
    const unit_price = at_floor ? floor : discounted
    return { ...p, quantity, unit_price, line_total: round2(unit_price * quantity), at_floor }
  })
  const total = round2(lines.reduce((n, l) => n + l.line_total, 0))
  const parts_total = round2(lines.reduce((n, l) => n + round2(l.list * l.quantity), 0))
  return { lines, parts_total, total, saving: round2(parts_total - total) }
}

export type Standing = { kind: 'ok' } | { kind: 'expired' } | { kind: 'part-unavailable'; product_id: string; name: string }

/** Whether a configured price can still be bought. Dates are 'YYYY-MM-DD',
    compared as text; valid_until may be a timestamp, so only its date counts. */
export function bundleStanding(
  sel: { valid_until: string },
  lines: readonly { product_id: string; name: string }[],
  today: string,
  available: (productId: string) => boolean,
): Standing {
  if (sel.valid_until.slice(0, 10) < today) return { kind: 'expired' }
  const gone = lines.find(l => !available(l.product_id))
  return gone ? { kind: 'part-unavailable', product_id: gone.product_id, name: gone.name } : { kind: 'ok' }
}

/** Lines of one selection together at the first one's place; every ordinary
    line alone with selectionId null. Order otherwise kept. */
export function groupBySelection<T extends { bundle_selection_id?: string | null }>(
  lines: readonly T[],
): { selectionId: string | null; lines: T[] }[] {
  const groups: { selectionId: string | null; lines: T[] }[] = []
  const byId = new Map<string, { selectionId: string | null; lines: T[] }>()
  for (const l of lines) {
    const id = l.bundle_selection_id ?? null
    if (id === null) { groups.push({ selectionId: null, lines: [l] }); continue }
    let g = byId.get(id)
    if (!g) { g = { selectionId: id, lines: [] }; byId.set(id, g); groups.push(g) }
    g.lines.push(l)
  }
  return groups
}
