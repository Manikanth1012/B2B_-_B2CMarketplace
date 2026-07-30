/* Warehouse stock, pure.
 *
 * The rules that decide what a stock line means, stated once. The ledger screen,
 * the storefront badge and the migration's assertions all key off `stockBadge`,
 * so a product cannot read "in stock" to a buyer while the warehouse holds none.
 */

export interface StockLine {
  id: string
  product_id: string
  warehouse_id: string
  on_hand: number
  reserved: number
  /* Generated in the database as on_hand − reserved. Never written, and never
     recomputed here — a third opinion is what this column exists to prevent. */
  available: number
  reorder_point: number
  inbound: number
  inbound_due: string | null
  unit_cost: number
  last_count: string | null
  sort_order: number
}

export type StockBadge = 'in' | 'low' | 'out'

/**
 * What a buyer is told, from what the warehouse holds.
 *
 * `low` is available at or below the reorder point rather than below it: the
 * reorder point is the level at which you are supposed to be reordering, so
 * being exactly on it is already the warning, not one unit away from it.
 */
export function stockBadge(available: number, reorderPoint: number): StockBadge {
  if (available <= 0) return 'out'
  if (available <= reorderPoint) return 'low'
  return 'in'
}

export function stockLabel(badge: StockBadge): string {
  return badge === 'out' ? 'Out of stock' : badge === 'low' ? 'Low stock' : 'In stock'
}

/** Reserved stock is sold but not yet shipped, so it is not available and it is
    also not gone. Both matter: the first to a buyer, the second to a count. */
export function committed(line: Pick<StockLine, 'on_hand' | 'reserved'>): number {
  return line.reserved
}

/** What the line is worth at cost. The figure a stock write-down is taken
    against, so it counts everything on hand — including what is reserved, which
    is still in the building. */
export function lineValue(line: Pick<StockLine, 'on_hand' | 'unit_cost'>): number {
  return +(line.on_hand * line.unit_cost).toFixed(2)
}

export function totalValue(lines: readonly Pick<StockLine, 'on_hand' | 'unit_cost'>[]): number {
  return +lines.reduce((n, l) => n + l.on_hand * l.unit_cost, 0).toFixed(2)
}

export type Attention =
  | { kind: 'out'; covered: boolean }
  | { kind: 'low'; covered: boolean }
  | null

/**
 * Whether a line needs somebody to do something, and whether a purchase order
 * already covers it. The distinction is the whole point of the panel: a line
 * that is out with 2,000 units landing on Friday needs nothing from anybody,
 * and showing it beside one that is out with nothing on order teaches people to
 * ignore both.
 */
export function needsAttention(line: Pick<StockLine, 'available' | 'reorder_point' | 'inbound'>): Attention {
  const badge = stockBadge(line.available, line.reorder_point)
  if (badge === 'in') return null
  /* Covered means the inbound quantity actually clears the reorder point, not
     merely that something is on the way. */
  return { kind: badge, covered: line.available + line.inbound > line.reorder_point }
}

/** Lines wanting attention, worst first: out and uncovered, out, low and
    uncovered, low. Sorted so the top of the list is where to start. */
export function attentionOrder<T extends Pick<StockLine, 'available' | 'reorder_point' | 'inbound'>>(
  lines: readonly T[],
): { line: T; attention: NonNullable<Attention> }[] {
  const rank = (a: NonNullable<Attention>) =>
    (a.kind === 'out' ? 0 : 2) + (a.covered ? 1 : 0)

  return lines
    .map(line => ({ line, attention: needsAttention(line) }))
    .filter((r): r is { line: T; attention: NonNullable<Attention> } => r.attention !== null)
    .sort((a, b) => rank(a.attention) - rank(b.attention))
}

/** Whether a warehouse is allowed to hold stock for a category. Forward stock
    never sits in a returns centre — a returns location holds things coming back,
    and counting them as sellable would sell a customer their own return. */
export function canStock(
  warehouse: { type: string; categories: string[] },
  categoryId: string,
): { ok: true } | { ok: false; reason: string } {
  if (warehouse.type === 'returns') {
    return { ok: false, reason: 'A returns centre holds stock coming back, not stock to sell.' }
  }
  if (!warehouse.categories.includes(categoryId)) {
    return {
      ok: false,
      reason: `This warehouse does not serve that marketplace. It handles ${warehouse.categories.join(', ') || 'nothing'}.`,
    }
  }
  return { ok: true }
}
