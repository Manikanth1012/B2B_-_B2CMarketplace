/* What a partner may sell, and what they keep when they sell it. Pure.
 *
 * Two rules that were nowhere before. The catalogue let a seller be assigned any
 * category, and `products.comm` carried a per-SKU rate with no plan behind it —
 * no ladder, no cycle, nothing anybody had agreed to.
 */

export interface PartnerCategory {
  partner_id: string
  category_id: string
  approved_at: string | null
  approved_by: string | null
}

export interface CommissionTier {
  from: number
  rate: number
}

export interface CommissionPlan {
  id: string
  name: string
  category_id: string | null
  model: string
  base_rate: number
  tiers: CommissionTier[]
  fees: string
  cycle: string
  hold: string
  sort_order: number
}

/* ------------------------------------------------------- eligibility ------ */

export type ListingVerdict =
  | { ok: true }
  | { ok: false; reason: string }

/**
 * Whether a seller may list in a category. Approval is granted at the
 * application gate and is what every listing is checked against — a listing in
 * a category nobody approved is a listing nothing agreed to.
 */
export function canListIn(
  categoryId: string,
  approvals: readonly PartnerCategory[],
  categoryName: (id: string) => string,
): ListingVerdict {
  const grant = approvals.find(a => a.category_id === categoryId)
  if (!grant) {
    const open = approvals.filter(a => a.approved_at).map(a => categoryName(a.category_id))
    return {
      ok: false,
      reason: open.length === 0
        ? `You are not approved to sell in any category yet. Approval is granted when your application clears, and it is what every listing is checked against.`
        : `You are not approved to sell in ${categoryName(categoryId)}. You may list in ${open.join(' and ')}. Ask the marketplace desk to add a category — it is a change to your agreement, not a setting.`,
    }
  }
  if (!grant.approved_at) {
    return {
      ok: false,
      reason: `${categoryName(categoryId)} is on your application but not approved yet. It opens when your application clears.`,
    }
  }
  return { ok: true }
}

/** The categories a seller may list in today, in the order the marketplace
    shows its categories. */
export function approvedCategories(
  approvals: readonly PartnerCategory[],
  order: readonly { id: string; sort_order: number }[],
): string[] {
  const rank = (id: string) => order.find(c => c.id === id)?.sort_order ?? 999
  return approvals
    .filter(a => a.approved_at)
    .map(a => a.category_id)
    .sort((a, b) => rank(a) - rank(b))
}

/* --------------------------------------------------------- commission ----- */

/**
 * The rate that applies at a given cumulative volume. The ladder is read
 * downwards — the highest threshold at or below the volume wins — so a plan
 * whose tiers are listed out of order still resolves the same way.
 *
 * Note the two directions in the seeded plans: a commission ladder falls as
 * volume rises (the marketplace takes less from a bigger seller), while a
 * reseller's wholesale discount rises. Nothing here assumes either — it reads
 * the ladder rather than the intent.
 */
export function rateAt(plan: CommissionPlan, volume: number): number {
  const applicable = plan.tiers
    .filter(t => volume >= t.from)
    .sort((a, b) => b.from - a.from)[0]
  return applicable?.rate ?? plan.base_rate
}

/** The next step on the ladder, and what it takes to reach it. Shown to a
    seller because a tier they cannot see is a tier that does not motivate
    anything. Null once they are on the last step. */
export function nextTier(plan: CommissionPlan, volume: number): { tier: CommissionTier; toGo: number } | null {
  const ahead = plan.tiers.filter(t => t.from > volume).sort((a, b) => a.from - b.from)[0]
  return ahead ? { tier: ahead, toGo: ahead.from - volume } : null
}

/** Marketplace commission on a gross amount at the seller's current volume. */
export function commissionOn(plan: CommissionPlan, gross: number, volume: number): number {
  return +(gross * rateAt(plan, volume) / 100).toFixed(2)
}

/** Plans in the marketplace's own order, so the same plan sits in the same
    place on every screen that lists them. */
export function orderedPlans(plans: readonly CommissionPlan[]): CommissionPlan[] {
  return [...plans].sort((a, b) => a.sort_order - b.sort_order)
}

/* ------------------------------------------------------------ listings ---- */

export interface ListingRow {
  id: string
  name: string
  category_id: string
  status: string
  price: number
  stock: string
  listed: string | null
}

/** The lifecycle a listing sits in, and what it means for a buyer. Separate
    from the seller's own lifecycle: a live seller can hold a rejected listing,
    and a suspended seller's listings are all down regardless of their own
    state. */
export const LISTING_STATES: Record<string, { label: string; meaning: string }> = {
  live:      { label: 'Live',      meaning: 'On sale and visible to buyers.' },
  pending:   { label: 'In review', meaning: 'Submitted and waiting on the catalogue desk. Not visible to buyers.' },
  rejected:  { label: 'Rejected',  meaning: 'Failed a catalogue rule. The seller can correct it and resubmit.' },
  suspended: { label: 'Suspended', meaning: 'Taken down. Either the listing broke a rule or the seller is suspended.' },
  draft:     { label: 'Draft',     meaning: 'Not submitted. Only the seller can see it.' },
}

export function listingState(status: string): { label: string; meaning: string } {
  return LISTING_STATES[status] ?? { label: status, meaning: 'No description recorded for this state.' }
}

/** A seller's listings grouped by state, biggest group first, for the summary
    line above the table. */
export function listingBreakdown(rows: readonly ListingRow[]): { status: string; label: string; count: number }[] {
  const counts = new Map<string, number>()
  rows.forEach(r => counts.set(r.status, (counts.get(r.status) ?? 0) + 1))
  return [...counts]
    .map(([status, count]) => ({ status, label: listingState(status).label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}
