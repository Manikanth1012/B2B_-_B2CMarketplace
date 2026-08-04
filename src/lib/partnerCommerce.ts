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
  /* The terms in prose. Carries things no pair of numbers can — "logistics at
     cost", "the reseller invoices the end customer" — so it stays alongside the
     figures rather than being replaced by them. */
  fees: string
  /* The same payment fee as arithmetic. The dashboard used to hard-code 2.1%
     into its JSX for every seller on every plan. */
  payment_fee_pct: number
  payment_fee_flat: number
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

/**
 * Where a sale's money goes, on this seller's own plan.
 *
 * The dashboard drew this card from `1000 - 120 - 21` written into the JSX —
 * 12% commission and 2.1% of fees, the same three numbers whichever plan the
 * seller was on. Nimbus settles at 11% on 1.9% + $0.20 and was being shown a
 * figure $11.80 short of what they are paid.
 *
 * The flat fee is per order rather than per unit of value, which is why it is
 * separate: at a $20 sale it is 1% of the money and at a $2,000 sale it is
 * nothing, and a card that folded it into a percentage would be wrong at both.
 */
export function moneySplit(plan: CommissionPlan, gross: number, volume: number): {
  gross: number
  commission: number
  commissionRate: number
  fees: number
  keep: number
  /* Shares of the gross, for drawing the bar. They sum to 100 by construction
     — the seller's share is what is left, not a third independent figure. */
  commissionShare: number
  feesShare: number
  keepShare: number
} {
  const rate = rateAt(plan, volume)
  const commission = +(gross * rate / 100).toFixed(2)
  const fees = +(gross * Number(plan.payment_fee_pct ?? 0) / 100 + Number(plan.payment_fee_flat ?? 0)).toFixed(2)
  const keep = +(gross - commission - fees).toFixed(2)
  const share = (n: number) => (gross > 0 ? +((n / gross) * 100).toFixed(2) : 0)
  return {
    gross,
    commission,
    commissionRate: rate,
    fees,
    keep,
    commissionShare: share(commission),
    feesShare: share(fees),
    keepShare: share(keep),
  }
}

/**
 * The plan as rows somebody can take away — every tier, the terms, and where
 * this seller sits on it.
 *
 * "Download schedule" used to raise a toast saying the schedule had been
 * downloaded. A seller taking their commission ladder to their own finance team
 * is the entire reason the button is there.
 */
export function planSchedule(plan: CommissionPlan, volume: number): string[][] {
  const rows: string[][] = [['section', 'field', 'value']]
  rows.push(['plan', 'id', plan.id])
  rows.push(['plan', 'name', plan.name])
  rows.push(['plan', 'model', plan.model])
  rows.push(['plan', 'opening_rate_pct', String(plan.base_rate)])
  rows.push(['plan', 'payment_fee_pct', String(plan.payment_fee_pct ?? 0)])
  rows.push(['plan', 'payment_fee_flat', String(plan.payment_fee_flat ?? 0)])
  rows.push(['plan', 'fees_in_full', plan.fees])
  rows.push(['plan', 'payout_cycle', plan.cycle])
  rows.push(['plan', 'holdback', plan.hold])
  rows.push(['position', 'trailing_12m_gross', volume.toFixed(2)])
  rows.push(['position', 'current_rate_pct', String(rateAt(plan, volume))])

  const ahead = nextTier(plan, volume)
  rows.push(['position', 'next_tier_rate_pct', ahead ? String(ahead.tier.rate) : 'none — top tier'])
  rows.push(['position', 'gross_to_next_tier', ahead ? ahead.toGo.toFixed(2) : '0'])

  for (const t of [...plan.tiers].sort((a, b) => a.from - b.from)) {
    rows.push(['tier', `from_${t.from}`, `${t.rate}%`])
  }
  return rows
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
