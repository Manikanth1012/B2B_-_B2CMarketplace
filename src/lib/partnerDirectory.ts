/* Finding a partner among many, and summarising the set. Pure.
 *
 * The console listed every seller as a chip in a wrapped row. That is readable
 * at fifteen and unusable at a hundred, and it answered none of the questions
 * anybody actually brings to a partner list: how many are live, who is stuck,
 * who sells what, and which tier the book is concentrated in.
 */

import type { PartnerStatus } from './partnerLifecycle'

export interface DirectoryRow {
  id: string
  name: string
  type: string
  country: string
  status: PartnerStatus
  tier_id: string
  categories: string[]
  planName: string | null
  listings: number
  liveListings: number
  contact: string
  email: string
  currentGate: string | null
  clearedGates: number
  totalGates: number
}

export interface Tier {
  id: string
  name: string
  rank: number
  qualify_gross: number
  benefits: string[]
  rate_relief: number
  colour: string
  sort_order: number
}

export interface Filters {
  search: string
  /* Empty means every value — an explicit "all" would be a sixth status that
     does not exist. */
  statuses: PartnerStatus[]
  tiers: string[]
  categories: string[]
}

export const EMPTY_FILTERS: Filters = { search: '', statuses: [], tiers: [], categories: [] }

/**
 * Free text is matched against the fields somebody would actually type: the
 * name, the id, the trading type, the country and the named contact. Not the
 * category — that has its own filter, and folding it in here would make
 * "device" match sellers the category chip would not.
 */
export function matchesSearch(row: DirectoryRow, search: string): boolean {
  const q = search.trim().toLowerCase()
  if (!q) return true
  return [row.name, row.id, row.type, row.country, row.contact, row.email]
    .some(v => (v ?? '').toLowerCase().includes(q))
}

export function applyFilters(rows: readonly DirectoryRow[], f: Filters): DirectoryRow[] {
  return rows.filter(r =>
    matchesSearch(r, f.search) &&
    (f.statuses.length === 0 || f.statuses.includes(r.status)) &&
    (f.tiers.length === 0 || f.tiers.includes(r.tier_id)) &&
    /* A seller matches a category filter if they sell in *any* of the chosen
       ones. Requiring all of them would make picking two categories return
       almost nothing, which reads as a broken filter rather than a narrow one. */
    (f.categories.length === 0 || r.categories.some(c => f.categories.includes(c))))
}

export type SortKey = 'name' | 'status' | 'tier' | 'listings' | 'progress'

/* Status in lifecycle order rather than alphabetically: an operator scanning a
   sorted list is looking for what needs attention, and 'live' sorting above
   'rejected' because L precedes R helps nobody. */
const STATUS_ORDER: Record<string, number> = {
  review: 0, onboarding: 1, suspended: 2, rejected: 3, live: 4,
}

export function sortRows(
  rows: readonly DirectoryRow[],
  key: SortKey,
  dir: 'asc' | 'desc',
  tiers: readonly Tier[],
): DirectoryRow[] {
  const rank = (id: string) => tiers.find(t => t.id === id)?.rank ?? 0
  const value = (r: DirectoryRow): number | string => {
    switch (key) {
      case 'name': return r.name.toLowerCase()
      case 'status': return STATUS_ORDER[r.status] ?? 99
      case 'tier': return rank(r.tier_id)
      case 'listings': return r.liveListings
      /* Fraction rather than count, so a seller 3 of 7 through sorts below one
         6 of 7 through even if both have the same number cleared. */
      case 'progress': return r.totalGates === 0 ? 0 : r.clearedGates / r.totalGates
    }
  }
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = value(a), y = value(b)
    if (x === y) return a.name.localeCompare(b.name)
    return (x < y ? -1 : 1) * sign
  })
}

export interface Page<T> {
  items: T[]
  page: number
  pages: number
  from: number
  to: number
  total: number
}

/** Clamped rather than trusted: filtering down to two results while on page 5
    must show the two, not an empty table. */
export function paginate<T>(rows: readonly T[], page: number, size: number): Page<T> {
  const total = rows.length
  const pages = Math.max(1, Math.ceil(total / size))
  const clamped = Math.min(Math.max(1, page), pages)
  const from = (clamped - 1) * size
  return {
    items: rows.slice(from, from + size),
    page: clamped,
    pages,
    total,
    from: total === 0 ? 0 : from + 1,
    to: Math.min(from + size, total),
  }
}

/* ------------------------------------------------------------ summaries -- */

export interface Bucket { key: string; label: string; count: number; colour?: string }

/**
 * How many sellers sit in each state. Every state is present even at zero,
 * because a filter chip that appears and disappears as the data moves is a
 * filter people stop trusting — and "no suspended sellers" is itself an answer.
 */
export function byStatus(rows: readonly DirectoryRow[]): Bucket[] {
  const LABELS: Record<PartnerStatus, string> = {
    live: 'Live', onboarding: 'Onboarding', review: 'In review',
    suspended: 'Suspended', rejected: 'Rejected',
  }
  return (Object.keys(LABELS) as PartnerStatus[]).map(key => ({
    key, label: LABELS[key], count: rows.filter(r => r.status === key).length,
  }))
}

export function byTier(rows: readonly DirectoryRow[], tiers: readonly Tier[]): Bucket[] {
  return [...tiers]
    .sort((a, b) => b.rank - a.rank)
    .map(t => ({ key: t.id, label: t.name, count: rows.filter(r => r.tier_id === t.id).length, colour: t.colour }))
}

/** Sellers per marketplace. A seller approved for two categories counts in
    both, so these deliberately sum to more than the partner count — and the
    caller says so rather than letting somebody add them up and be wrong. */
export function byCategory(
  rows: readonly DirectoryRow[],
  categories: readonly { id: string; name: string; sort_order: number }[],
): Bucket[] {
  return [...categories]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map(c => ({
      key: c.id,
      label: c.name,
      count: rows.filter(r => r.categories.includes(c.id)).length,
    }))
}

/* -------------------------------------------- category-level onboarding -- */

export interface PolicyRule {
  id: string
  name: string
  descr: string
  check_by: 'auto' | 'doc' | 'manual' | 'extern'
  basis: string
  owner: string
  evidence: string | null
  blocks: boolean
  appeal: boolean
  status: string
  locked: string | null
  note: string | null
  sort_order: number
}

export type EvidenceState = 'accepted' | 'standing' | 'submitted' | 'outstanding' | 'rejected' | 'waived'

export interface CategoryEvidence {
  id: string
  partner_id: string
  category_id: string
  rule_id: string
  state: EvidenceState
  document: string | null
  kind: string | null
  size: string | null
  expires_on: string | null
  submitted_by: string | null
  submitted_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  note: string | null
}

export interface CategoryReadiness {
  categoryId: string
  /* Whether the operator has approved it, from partner_categories. */
  approved: boolean
  satisfied: number
  total: number
  outstanding: CategoryEvidence[]
  expiring: CategoryEvidence[]
  expired: CategoryEvidence[]
  /* Approved and nothing lapsed. The distinction from `approved` is the point:
     a category can be approved and still not be safe to list in, because a
     certificate that expired last week does not un-approve anything by itself. */
  clear: boolean
}

const DAY = 24 * 60 * 60 * 1000

/**
 * What a seller still owes in one category, and what is about to lapse.
 *
 * `today` is a parameter rather than `new Date()` so this is testable and so a
 * screen and a report cannot disagree about what "expiring soon" means.
 */
export function categoryReadiness(
  categoryId: string,
  evidence: readonly CategoryEvidence[],
  approved: boolean,
  today: Date,
  soonDays = 60,
): CategoryReadiness {
  const mine = evidence.filter(e => e.category_id === categoryId)
  const satisfiedStates: EvidenceState[] = ['accepted', 'standing', 'waived']

  const expired = mine.filter(e => e.expires_on && Date.parse(e.expires_on) < today.getTime())
  const expiring = mine.filter(e =>
    e.expires_on &&
    Date.parse(e.expires_on) >= today.getTime() &&
    Date.parse(e.expires_on) - today.getTime() <= soonDays * DAY)

  return {
    categoryId,
    approved,
    satisfied: mine.filter(e => satisfiedStates.includes(e.state)).length,
    total: mine.length,
    outstanding: mine.filter(e => e.state === 'outstanding' || e.state === 'rejected'),
    expiring,
    expired,
    clear: approved && expired.length === 0 && !mine.some(e => e.state === 'outstanding' || e.state === 'rejected'),
  }
}

/** What the evidence state means, in words the reviewer and the seller read the
    same way. `standing` is the one that needs saying: nobody owes anything. */
export const EVIDENCE_MEANING: Record<EvidenceState, string> = {
  accepted:    'Supplied and accepted by the rule owner.',
  standing:    'Enforced by the platform on every listing. There is nothing to supply.',
  submitted:   'Supplied and waiting on the rule owner.',
  outstanding: 'Not supplied. This is what is holding the category.',
  rejected:    'Supplied and refused. The seller has been told why and can resubmit.',
  waived:      'Waived with a recorded reason.',
}
