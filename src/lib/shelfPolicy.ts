/**
 * Governing a shelf: what may go on it, from whom, and how much.
 *
 * The marketplace has six categories and each one is a different commercial
 * proposition. Security is sold to enterprises under contract with an
 * attestation behind it; digital content is somebody else's rights being
 * resold; devices are boxes that ship. Governing them identically means either
 * strangling the cheap ones or under-checking the expensive ones.
 *
 * The model this reads was already in the database and only half connected: the
 * rules, the rule × category matrix and the per-category policy all existed,
 * `applyPolicy` evaluated the matrix against a listing, and the caps and rating
 * bars were read by nothing. What is here is the other half — what an operator
 * needs to see to change any of it safely:
 *
 *   WHERE A SHELF ACTUALLY IS against the rules set for it. A cap is only a
 *   decision if you can see who is near it; a bar is only a decision if you can
 *   see who it would exclude.
 *
 *   WHAT A CHANGE WOULD DO before it is made. Raising a bar to 4.0 with three
 *   sellers at 3.7 is a decision to remove three suppliers, and a screen that
 *   does not say so is a screen that lets somebody do it by accident.
 *
 *   WHERE THE POLICY CONTRADICTS ITSELF. Auto-publishing on a shelf reviewed by
 *   hand, a rule that blocks but only warns everywhere, a draft rule being
 *   enforced. Each of these is individually plausible and jointly wrong.
 */

import type { CategoryPolicy, PolicyRuleRow } from './catalogue'

export type RuleLevel = 'off' | 'warn' | 'enforce'

export interface MatrixRow {
  category_id: string
  rule_id: string
  level: RuleLevel
}

export interface CategoryRow {
  id: string
  name: string
  audience: string | null
  blurb: string | null
  open_to_buyers: boolean
  sort_order: number
}

export interface ListingRow {
  id: string
  category_id: string
  partner_id: string | null
  status: string
  price: number
  cost: number
}

export interface SellerRow {
  id: string
  name: string
  status: string
  rating: number | null
}

/* A listing occupies the shelf unless it never reached it or the marketplace
   took it down. Suspended is deliberately not counted: taking somebody's
   listing away and then charging it against their allowance bills them twice
   for one decision. */
export const OCCUPIES = (status: string): boolean =>
  status !== 'retired' && status !== 'rejected' && status !== 'suspended'

export const LEVEL_LABEL: Record<RuleLevel, string> = {
  off: 'Not applied',
  warn: 'Flagged for the reviewer',
  enforce: 'Blocks the listing',
}

/* ------------------------------------------------------------ occupancy -- */

export type CapState = 'ok' | 'nearly' | 'full' | 'over'

export interface Occupancy {
  seller_id: string | null
  seller: string
  held: number
  cap: number | null
  /* Null where the shelf is uncapped — not 0, which would render as a full bar. */
  pct: number | null
  state: CapState
}

export function capState(held: number, cap: number | null): CapState {
  if (cap === null) return 'ok'
  if (held > cap) return 'over'
  if (held >= cap) return 'full'
  /* Four fifths. Early enough that a seller can plan, late enough that it is
     not shouting at somebody with half a shelf free. */
  return held / cap >= 0.8 ? 'nearly' : 'ok'
}

/** Who holds what on one shelf, fullest first. */
export function occupancy(
  listings: readonly ListingRow[], sellers: readonly SellerRow[],
  categoryId: string, policy: CategoryPolicy | null,
): Occupancy[] {
  const cap = policy?.max_listings_per_seller ?? null
  const held = new Map<string | null, number>()
  for (const l of listings) {
    if (l.category_id !== categoryId || !OCCUPIES(l.status)) continue
    held.set(l.partner_id, (held.get(l.partner_id) ?? 0) + 1)
  }
  return [...held.entries()]
    .map(([id, n]) => ({
      seller_id: id,
      seller: id === null ? 'The marketplace' : sellers.find(s => s.id === id)?.name ?? id,
      held: n,
      cap,
      pct: cap === null ? null : Math.round(n / cap * 100),
      state: capState(n, cap),
    }))
    .sort((a, b) => b.held - a.held || a.seller.localeCompare(b.seller))
}

/* --------------------------------------------------- what a change does -- */

export interface BarImpact {
  /* Sellers who would be newly excluded, named. A count alone is not something
     anybody can weigh. */
  excluded: SellerRow[]
  /* And the listings that would come off the shelf with them. */
  listings: number
  unratedAffected: SellerRow[]
}

/**
 * Who a rating bar would exclude if it were set to this.
 *
 * The screen's whole job. "Set the bar to 4.0" and "remove TrackWise, Volta and
 * their five listings" are the same act, and only one of them is what the
 * person clicking believes they are doing.
 */
export function barImpact(
  sellers: readonly SellerRow[], listings: readonly ListingRow[],
  categoryId: string, bar: number | null, allowUnrated: boolean,
): BarImpact {
  const onShelf = listings.filter(l => l.category_id === categoryId && OCCUPIES(l.status))
  const here = new Set(onShelf.map(l => l.partner_id).filter((x): x is string => x !== null))

  const excluded = sellers.filter(s =>
    here.has(s.id) && s.rating !== null && bar !== null && s.rating < bar)
  const unratedAffected = allowUnrated ? [] : sellers.filter(s => here.has(s.id) && s.rating === null)

  const ids = new Set([...excluded, ...unratedAffected].map(s => s.id))
  return {
    excluded,
    unratedAffected,
    listings: onShelf.filter(l => l.partner_id !== null && ids.has(l.partner_id)).length,
  }
}

/** Who a cap would put over, if it were set to this. */
export function capImpact(
  listings: readonly ListingRow[], sellers: readonly SellerRow[],
  categoryId: string, cap: number,
): { seller: string; held: number; over: number }[] {
  return occupancy(listings, sellers, categoryId, { max_listings_per_seller: cap } as CategoryPolicy)
    .filter(o => o.held > cap)
    .map(o => ({ seller: o.seller, held: o.held, over: o.held - cap }))
}

/* --------------------------------------------------------- the sentences -- */

/** The rating bar, including the half of it a number cannot say. */
export function barLine(policy: CategoryPolicy): string {
  if (policy.min_rating === null) {
    return 'No rating bar. Any seller approved for this category may list on it.'
  }
  const unrated = policy.allow_unrated
    ? 'A seller nobody has rated yet is admitted — they are not below the bar, they are not on it.'
    : 'A seller nobody has rated yet is refused.'
  return `Sellers rated below ${policy.min_rating.toFixed(1)} may not list here. ${unrated}`
}

export function reviewLine(policy: CategoryPolicy): string {
  const how = policy.review || 'Reviewed'
  const publish = policy.auto_publish
    ? 'A passing listing goes live without waiting for anybody.'
    : 'Every listing waits for a person.'
  return `${how}, within ${policy.sla_hours} hours. ${publish}`
}

export function returnsLine(policy: CategoryPolicy): string {
  const w = (policy.returns_window ?? '').trim()
  if (!w || /^not applicable$/i.test(w)) {
    return 'No returns window — nothing on this shelf is returnable once supplied.'
  }
  if (/contract/i.test(w)) {
    return 'Returns are contractual — each agreement sets its own, and a blanket window would contradict them.'
  }
  return `Returns within ${w} of supply.`
}

export function capLine(policy: CategoryPolicy): string {
  return policy.max_listings_per_seller === null
    ? 'No limit on how much of this shelf one supplier may hold.'
    : `One supplier may hold up to ${policy.max_listings_per_seller} listings here.`
}

/* ------------------------------------------------- where it contradicts -- */

/**
 * Where the policy disagrees with itself or with the shelf.
 *
 * Each of these is plausible on its own and wrong in combination, which is
 * exactly the kind of thing that survives a review of one field at a time.
 */
export function shelfWarnings(
  policy: CategoryPolicy, category: CategoryRow,
  listings: readonly ListingRow[], sellers: readonly SellerRow[],
): string[] {
  const out: string[] = []

  if (!policy.open_to_buyers && !(policy.closed_reason ?? '').trim()) {
    out.push(`${category.name} is closed to buyers and no reason is recorded. Somebody will reopen it without knowing why it was shut.`)
  }

  /* Auto-publish under a manual review is the shelf saying two opposite things
     about the same listing. */
  if (policy.auto_publish && /manual/i.test(policy.review ?? '')) {
    out.push('Listings auto-publish on a shelf whose review mode says a person decides every one. One of those is not happening.')
  }

  /* A bar nobody can be under is not a bar. */
  if (policy.min_rating !== null) {
    const here = new Set(listings
      .filter(l => l.category_id === category.id && OCCUPIES(l.status))
      .map(l => l.partner_id).filter((x): x is string => x !== null))
    const rated = sellers.filter(s => here.has(s.id) && s.rating !== null)
    if (rated.length > 0 && rated.every(s => s.rating! >= policy.min_rating! + 1)) {
      out.push(`Every seller here is rated at least a full point above the ${policy.min_rating.toFixed(1)} bar, so the bar has never decided anything. It may be set too low to be doing the job it was set for.`)
    }
  }

  /* A cap below where the shelf already is. Not caught by the guard, because
     the guard only refuses the next one. */
  const over = occupancy(listings, sellers, category.id, policy).filter(o => o.state === 'over')
  if (over.length > 0) {
    out.push(`${over.map(o => `${o.seller} holds ${o.held}`).join(', ')} — above the cap of ${policy.max_listings_per_seller}. The cap refuses the next listing and does nothing about the ones already there.`)
  }

  if (!policy.price_floor) {
    out.push('A listing may be priced below what it costs the marketplace to supply. Deliberate on a shelf sold at a loss to win the account; expensive everywhere else.')
  }

  return out
}

/* ------------------------------------------------------------ the rules -- */

export function levelOf(
  matrix: readonly MatrixRow[], categoryId: string, ruleId: string,
): RuleLevel {
  return matrix.find(m => m.category_id === categoryId && m.rule_id === ruleId)?.level ?? 'off'
}

/** Which shelves a rule is applied to, and how hard. */
export function reachOf(
  matrix: readonly MatrixRow[], ruleId: string,
): { enforced: string[]; warned: string[] } {
  const mine = matrix.filter(m => m.rule_id === ruleId)
  return {
    enforced: mine.filter(m => m.level === 'enforce').map(m => m.category_id),
    warned: mine.filter(m => m.level === 'warn').map(m => m.category_id),
  }
}

/** What the rule is, in the terms the person who owns it would use. */
export function ruleLine(rule: PolicyRuleRow): string {
  const how = rule.check_by === 'auto' ? 'The platform checks this itself'
    : rule.check_by === 'doc' ? `Checked against a document${rule.evidence ? ` — ${rule.evidence}` : ''}`
    : rule.check_by === 'extern' ? 'Checked by an external service'
    : 'Checked by a person'
  const bite = rule.blocks ? 'A listing that fails it cannot go live.' : 'A failure is recorded and does not block.'
  return `${how}. ${rule.basis}, owned by ${rule.owner}. ${bite}`
}

/**
 * Where the rule book contradicts itself.
 *
 * The two that matter both look like housekeeping and are not: a rule being
 * enforced before it is published means listings are being refused under a
 * policy nobody has agreed; a published rule applied nowhere means somebody
 * wrote it, everybody assumes it is running, and it is not.
 */
export function matrixProblems(
  rules: readonly PolicyRuleRow[], matrix: readonly MatrixRow[],
  categories: readonly CategoryRow[],
): string[] {
  const out: string[] = []
  const nameOf = (id: string) => categories.find(c => c.id === id)?.name ?? id

  for (const rule of rules) {
    const reach = reachOf(matrix, rule.id)
    const applied = reach.enforced.length + reach.warned.length

    if (rule.status !== 'active' && applied > 0) {
      out.push(`${rule.name} is ${rule.status} and is being applied to ${[...reach.enforced, ...reach.warned].map(nameOf).join(', ')}. Listings are being judged against a rule that has not been published.`)
    }
    if (rule.status === 'active' && applied === 0) {
      out.push(`${rule.name} is active and applied to no category. It reads as a rule the marketplace enforces and it enforces nothing.`)
    }
    /* A blocking rule that only ever warns is a rule whose own `blocks` flag is
       a claim the matrix contradicts. */
    if (rule.blocks && reach.enforced.length === 0 && reach.warned.length > 0) {
      out.push(`${rule.name} is marked as blocking but only warns, on every shelf it applies to. Either it does not block or the flag is wrong.`)
    }
  }

  /* A shelf with nothing blocking on it is a shelf with no rules at all,
     whatever the matrix looks like. */
  for (const c of categories) {
    const enforced = matrix.filter(m => m.category_id === c.id && m.level === 'enforce')
    if (enforced.length === 0) {
      out.push(`${c.name} enforces no rule. Everything on it is advisory, so nothing on it can be refused.`)
    }
  }

  return out
}

/** How much of the rule book each shelf actually carries. */
export function ruleCoverage(
  rules: readonly PolicyRuleRow[], matrix: readonly MatrixRow[], categoryId: string,
): { applicable: number; enforced: number; warned: number; off: number } {
  const active = rules.filter(r => r.status === 'active')
  const enforced = active.filter(r => levelOf(matrix, categoryId, r.id) === 'enforce').length
  const warned = active.filter(r => levelOf(matrix, categoryId, r.id) === 'warn').length
  return { applicable: active.length, enforced, warned, off: active.length - enforced - warned }
}

/**
 * What turning a rule up would newly refuse.
 *
 * Only answerable for the rules the platform checks itself; for a document or a
 * person, the honest answer is that nobody knows until they look, and saying so
 * is better than a confident zero.
 */
export function levelImpact(
  rule: PolicyRuleRow, policy: CategoryPolicy | null,
  listings: readonly ListingRow[], categoryId: string,
): { known: true; failing: number } | { known: false; why: string } {
  if (rule.check_by !== 'auto') {
    return {
      known: false,
      why: `${rule.name} is checked by ${rule.check_by === 'doc' ? 'a document' : rule.check_by === 'extern' ? 'an external service' : 'a person'}, so how many listings would fail is not something this screen can work out.`,
    }
  }
  const here = listings.filter(l => l.category_id === categoryId && OCCUPIES(l.status))
  if (rule.id === 'PR-03') {
    const floor = policy?.price_floor ?? true
    return { known: true, failing: floor ? here.filter(l => l.cost > 0 && l.price < l.cost).length : 0 }
  }
  /* The remaining automatic rules are checked against fields this screen does
     not carry, so it does not guess. */
  return { known: false, why: `${rule.name} is checked against the listing itself, one at a time.` }
}
