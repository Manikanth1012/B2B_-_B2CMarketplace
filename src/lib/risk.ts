/**
 * Fraud and risk scoring — the bands, the wording and the rule checks, without a database.
 *
 * The database adds up the points of the rules that fired on an order or an
 * account (spec 13). What a score means is decided here so every screen reads
 * it the same way:
 *
 *  - which band a score falls in (orders: Low, Review, Hold; accounts: Low,
 *    Review, High), from thresholds an operator can edit;
 *  - how the reasons behind a score read on one line;
 *  - what colour each band wears;
 *  - whether an edit to a rule or to the bands is acceptable.
 *
 * A buyer or seller never sees a score or a rule: only HELD_FOR_BUYER.
 * Pure: no Supabase.
 */

export type OrderBand = 'low' | 'review' | 'hold'
export type AccountBand = 'low' | 'review' | 'high'

export interface RiskReason { rule: string; label: string; points: number }
export interface Bands { review_at: number; hold_at: number }

export const DEFAULT_ORDER_BANDS: Bands = { review_at: 40, hold_at: 70 }
export const DEFAULT_ACCOUNT_BANDS: Bands = { review_at: 40, hold_at: 70 }

/** The only thing a buyer is told about a held order. */
export const HELD_FOR_BUYER = "We're checking this order \u2014 usually within a few hours."

/** Hold from the hold threshold up, Review from the review threshold up, else Low. */
export function orderBand(score: number, b: Bands): OrderBand {
  if (score >= b.hold_at) return 'hold'
  if (score >= b.review_at) return 'review'
  return 'low'
}

/** High from the upper threshold up, Review from the lower threshold up, else Low. */
export function accountBand(score: number, b: Bands): AccountBand {
  if (score >= b.hold_at) return 'high'
  if (score >= b.review_at) return 'review'
  return 'low'
}

/** "New account +20 · First order +10": biggest first, ties by label.
    A rule that took points off reads "Label −15" with a true minus sign. */
export function reasonsLine(reasons: readonly RiskReason[]): string {
  if (reasons.length === 0) return 'No rules fired'
  return [...reasons]
    .sort((a, b) => b.points - a.points || a.label.localeCompare(b.label))
    .map(r => (r.points < 0 ? `${r.label} \u2212${-r.points}` : `${r.label} +${r.points}`))
    .join(' \u00b7 ')
}

/** Green for low, amber for review, red for hold or high. */
export function bandTone(band: OrderBand | AccountBand): 'success' | 'warning' | 'danger' {
  if (band === 'low') return 'success'
  if (band === 'review') return 'warning'
  return 'danger'
}

/** Null when the edit is fine, else one plain sentence saying what to fix.
    The threshold only matters for a rule that has one. */
export function ruleEditProblem(edit: {
  points: number
  threshold: number | null
  needsThreshold: boolean
}): string | null {
  if (!Number.isInteger(edit.points)) return 'Points must be a whole number.'
  if (edit.points < -50 || edit.points > 100) return 'Points must be between \u221250 and 100.'
  if (edit.needsThreshold) {
    const t = edit.threshold
    if (t === null || !Number.isFinite(t) || t <= 0) return 'This rule needs a threshold above zero.'
  }
  return null
}

/** Null when the two thresholds are fine, else one plain sentence. */
export function bandsProblem(b: Bands): string | null {
  const whole = (n: number) => Number.isInteger(n) && n >= 1 && n <= 100
  if (!whole(b.review_at) || !whole(b.hold_at)) return 'Both thresholds must be whole numbers from 1 to 100.'
  if (b.review_at >= b.hold_at) return 'The review threshold must be below the hold threshold.'
  return null
}
