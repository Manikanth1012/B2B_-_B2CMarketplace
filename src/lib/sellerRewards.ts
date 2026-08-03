/* What the loyalty programme costs a seller, and what they may do about it.
   No React and no Supabase, so the arithmetic can be tested without a network.

   The whole subject is one question: who pays for a point. The marketplace can
   fund one as marketing spend, a seller can fund one to buy repeat business on
   their own line, or the two can split it. A seller is entitled to see their
   own half and nothing about another seller's customers.

   Every cost here is a `Money`, and the totals are lists of them rather than
   numbers. A seller sells into more than one market: Nimbus Sensors has points
   issued against its products in rupees, dirhams and shillings, and the old
   single total added all three and printed a dollar sign in front. The sum was
   a perfectly ordinary number, which is what makes that failure invisible. */

import { money as asMoney, byCurrency } from './money'
import type { Money } from './money'
import { rateFor, worthIn } from './loyalty'
import type { PointRate } from './loyalty'

export type { Money, PointRate }
export { rateFor, worthIn }

export type Funder = 'operator' | 'partner' | 'shared'

/** One total per currency, largest first — the honest shape of a mixed sum. */
export const bucket = (list: readonly Money[]): Money[] =>
  byCurrency(list).map(b => b.total)
export type RuleStatus = 'active' | 'scheduled' | 'paused' | 'pending'
export type MovementType = 'earn' | 'redeem' | 'reverse' | 'expire' | 'adjust'

export interface EarnRule {
  id: string
  name: string
  scope: 'all' | 'vertical' | 'partner'
  scope_id: string | null
  rate: number
  funder: Funder
  split: number | null
  status: RuleStatus
  from: string
  to: string | null
  cap_per_order: number | null
  cap_per_month: number | null
  audience: string
  bonus: number | null
  first_only: boolean | null
  why: string
  proposed_by: string | null
  proposed_on: string | null
  decided_by: string | null
  decided_on: string | null
  decision_note: string | null
}

export interface Movement {
  id: string
  member: string
  when_date: string
  type: MovementType
  points: number
  ref: string | null
  rule_id: string | null
  funder: Funder
  seller_id: string | null
  value: number
  /* The currency `value` is in — the member's, not the seller's. A seller in
     Bengaluru selling to a customer in Nairobi is charged in shillings for the
     points that customer earned. */
  currency: string
  note: string | null
}

export interface Programme {
  name: string
  unit: string
  per_unit: number
  min_redeem: number
  expiry_months: number
  breakage: number
  funding_note: string
  status: string
}

/* ========================================================================= */
/* Whose money                                                               */
/* ========================================================================= */

export const FUNDERS: Record<Funder, { label: string; note: string }> = {
  operator: { label: 'Marketplace', note: 'Marketing spend. It hits the marketplace’s promotions budget, not your settlement.' },
  partner:  { label: 'You',         note: 'Recovered on your next settlement, itemised by rule.' },
  shared:   { label: 'Shared',      note: 'Split at the rate on the rule. Both sides see their own half.' },
}

/**
 * The seller's share of one movement.
 *
 * A shared rule only costs the seller its share, and a seller is entitled to
 * see which half is theirs rather than the whole number. `split` is the
 * marketplace's percentage, so what is left is the seller's.
 */
export function shareOf(movement: Movement, rules: readonly EarnRule[]): number {
  if (movement.funder === 'operator') return 0
  if (movement.funder === 'partner') return 1
  const rule = movement.rule_id ? rules.find(r => r.id === movement.rule_id) : null
  if (!rule || rule.split === null) return 1
  return +((100 - rule.split) / 100).toFixed(4)
}

/** What a movement actually costs this seller, to the cent, in the money it
    was issued in. */
export function costOf(movement: Movement, rules: readonly EarnRule[]): Money {
  return asMoney(+(Number(movement.value) * shareOf(movement, rules)).toFixed(2), movement.currency)
}

/* Dates on the ledger are written the way a statement writes them —
   "27 Jun 2026" — so sorting the column as text puts June after July. Parsed
   once here rather than in each screen that lists them. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function movementDate(when: string): number {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})\w*\s+(\d{4})$/.exec(when.trim())
  if (!m) return 0
  const month = MONTHS.indexOf(m[2].slice(0, 1).toUpperCase() + m[2].slice(1, 3).toLowerCase())
  if (month < 0) return 0
  return Date.UTC(Number(m[3]), month, Number(m[1]))
}

/** Newest first, which is what a ledger is read in. Ties keep the order they
    arrived in so a reversal stays next to the issue it undid. */
export function newestFirst(movements: readonly Movement[]): Movement[] {
  return movements.slice().sort((a, b) => movementDate(b.when_date) - movementDate(a.when_date))
}

/* ========================================================================= */
/* The bill                                                                  */
/* ========================================================================= */

export interface RewardCost {
  /* Points issued on this seller's products under rules they fund some or all
     of. Reversals are counted separately rather than netted, because "you were
     charged and then you were not" is two facts a seller wants to see.

     Points add across currencies and money does not: a point is a unit the
     marketplace issues, the same unit everywhere, and only what it is worth is
     local. That is why these three stay plain numbers and the rest are lists. */
  issued: number
  clawed: number
  redeemed: number
  /* Cost of issuing, and what came back on reversals — one figure per currency. */
  issuingCost: Money[]
  clawedBack: Money[]
  /* Redemptions the seller funds are a second, separate bill: a voucher costs
     them at the moment it is spent, not when the point was earned. */
  redemptionCost: Money[]
  /* What lands on the next settlement, per currency. */
  total: Money[]
  movements: number
}

export function rewardCost(movements: readonly Movement[], rules: readonly EarnRule[]): RewardCost {
  const earns = movements.filter(m => m.type === 'earn')
  const reverses = movements.filter(m => m.type === 'reverse')
  const redeems = movements.filter(m => m.type === 'redeem')

  const cost = (ms: readonly Movement[], sign = 1) =>
    ms.map(m => { const c = costOf(m, rules); return asMoney(c.amount * sign, c.currency) })

  return {
    issued: earns.reduce((a, m) => a + Number(m.points), 0),
    clawed: reverses.reduce((a, m) => a + Math.abs(Number(m.points)), 0),
    redeemed: redeems.reduce((a, m) => a + Math.abs(Number(m.points)), 0),
    issuingCost: bucket(cost(earns)),
    clawedBack: bucket(cost(reverses)),
    redemptionCost: bucket(cost(redeems)),
    /* Issuing, less clawbacks, plus redemptions — netted inside each currency
       and never across them. */
    total: bucket([...cost(earns), ...cost(reverses, -1), ...cost(redeems)]),
    movements: movements.length,
  }
}

export interface RuleCost {
  rule: EarnRule
  points: number
  cost: Money[]
  movements: number
  /* What the seller's half actually is, said in words rather than as a
     percentage nobody converts in their head. */
  yourShare: string
}

/** Cost per rule, so a seller can see which campaign is the expensive one
    rather than one total they cannot act on. */
export function byRule(movements: readonly Movement[], rules: readonly EarnRule[]): RuleCost[] {
  const map = new Map<string, { points: number; cost: Money[]; movements: number }>()
  for (const m of movements) {
    if (!m.rule_id) continue
    const row = map.get(m.rule_id) ?? { points: 0, cost: [], movements: 0 }
    const c = costOf(m, rules)
    row.points += Number(m.points)
    row.cost.push(asMoney(c.amount * (m.type === 'reverse' ? -1 : 1), c.currency))
    row.movements += 1
    map.set(m.rule_id, row)
  }
  return [...map.entries()]
    .map(([id, v]) => {
      const rule = rules.find(r => r.id === id)!
      return { rule, points: v.points, cost: bucket(v.cost), movements: v.movements, yourShare: shareLabel(rule) }
    })
    .filter(r => r.rule)
    /* Ranked on points rather than on cost. Cost is a list now and lists do not
       compare — and ranking on the largest bucket would rank ₹500 above $50,
       which is the same mistake in a different place. */
    .sort((a, b) => b.points - a.points)
}

export function shareLabel(rule: EarnRule): string {
  if (rule.funder === 'operator') return 'None — the marketplace funds it'
  if (rule.funder === 'partner') return 'All of it'
  if (rule.split === null) return 'Split'
  return `${100 - rule.split}% — the marketplace funds ${rule.split}%`
}

/** The rules that can cost this seller money: their own, plus any marketplace-
    wide or category rule they are on the hook for part of. A rule scoped to
    another seller is none of their business and is not returned. */
export function rulesCosting(rules: readonly EarnRule[], partnerId: string): EarnRule[] {
  return rules
    .filter(r => r.funder === 'partner' || r.funder === 'shared')
    .filter(r => r.scope !== 'partner' || r.scope_id === partnerId)
    .slice()
    .sort((a, b) => rank(a.status) - rank(b.status) || a.id.localeCompare(b.id))
}

function rank(s: RuleStatus): number {
  return s === 'active' ? 0 : s === 'scheduled' ? 1 : s === 'pending' ? 2 : 3
}

/** What the seller has asked for and nobody has answered. */
export function myProposals(rules: readonly EarnRule[], partnerId: string): EarnRule[] {
  return rules.filter(r =>
    r.proposed_by !== null && r.scope === 'partner' && r.scope_id === partnerId)
}

/* ========================================================================= */
/* Proposing one                                                             */
/* ========================================================================= */

export type Check = { ok: true } | { ok: false; reason: string }

export interface Proposal {
  name: string
  rate: number
  capPerOrder: number
  from: string
  to: string
  why: string
}

/* Deliberately narrow. A seller proposing a rule is proposing to spend their own
   margin, so the checks are about the two ways that goes wrong: a rule with no
   ceiling, and a rule nobody can evaluate because it does not say what it is
   meant to change. */
export const MAX_RATE = 5

export function validateProposal(p: Proposal): Check {
  if (!p.name.trim()) {
    return { ok: false, reason: 'A rule needs a name before it can be reviewed. It is what appears on your settlement line.' }
  }
  if (!(p.rate > 0)) return { ok: false, reason: 'A rate of zero issues nothing.' }
  if (p.rate > MAX_RATE) {
    return { ok: false, reason: `${p.rate}× is above the ${MAX_RATE}× ceiling. Above that the marketplace wants a conversation rather than a form.` }
  }
  if (!(p.capPerOrder > 0)) {
    return { ok: false, reason: 'Set a cap per order. A rule without one is an open cheque on your largest order.' }
  }
  if (p.to && p.from && p.to < p.from) {
    return { ok: false, reason: 'It cannot end before it starts.' }
  }
  if (p.why.trim().split(/\s+/).filter(Boolean).length < 8) {
    return { ok: false, reason: 'Say what this is meant to change. The marketplace reads the reason before the rate — a rule nobody can evaluate is a rule nobody approves.' }
  }
  return { ok: true }
}

/**
 * What agreeing to this actually commits the seller to. Computed rather than
 * written out, so the numbers cannot drift from the programme.
 *
 * A seller sells into every market they are approved for, so "the most one
 * order can cost you" is a different figure in each — it used to be one dollar
 * number, which is the cap priced as though every customer were American.
 */
export function proposalImpact(
  p: Proposal, rates: readonly PointRate[], fmt: (amount: number, currency: string) => string,
): string[] {
  /* Dearest first, because the sentence is about the worst case. */
  const worst = [...rates]
    .map(r => ({ currency: r.currency, cost: worthIn(p.capPerOrder, { value_per: 1 }, r) }))
    .sort((a, b) => b.cost - a.cost)

  const perPoint = rates
    .map(r => fmt(worthIn(1, { value_per: 1 }, r), r.currency))
    .join(', ')

  return [
    `You fund every point this rule issues — ${perPoint || 'at the rate set for each market'}, depending on where the customer is.`,
    `At ${p.rate}× and a ${p.capPerOrder.toLocaleString()}-point cap, the most one order can cost you is ${
      worst.length ? worst.map(w => fmt(w.cost, w.currency)).join(' · ') : 'set by the cap'}.`,
    'It issues nothing until the marketplace approves it. An unapproved rule is not a live rule.',
    'It applies to your products only — you cannot write a rule that spends somebody else’s margin.',
    'Points already issued are never withdrawn if you later stop the rule.',
  ]
}

/** Whether a seller may still withdraw a proposal. Once it is live, stopping it
    is a change to a running campaign and the marketplace has to be in on it. */
export function canWithdraw(rule: EarnRule): Check {
  if (rule.status !== 'pending') {
    return { ok: false, reason: `${rule.name} is ${rule.status}. Stopping a rule that is already running is a change to a live campaign — ask the marketplace rather than deleting it.` }
  }
  if (!rule.proposed_by) {
    return { ok: false, reason: 'This one was written by the marketplace, so it is not yours to withdraw.' }
  }
  return { ok: true }
}

/* ========================================================================= */
/* The marketplace's side                                                    */
/* ========================================================================= */

export interface Liability {
  /* Every point issued is a liability from the moment it exists, not a cost
     when it is spent. Breakage is the share the programme expects never to be
     redeemed — an estimate, and labelled as one. */
  outstandingPoints: number
  /* One figure per currency. The marketplace owes rupees to its Indian members
     and shillings to its Kenyan ones, and those are two debts, not one number.
     A screen that wants a single headline converts them itself, with `totalIn`,
     at a rate and a date it names. */
  gross: Money[]
  expected: Money[]
  breakageValue: Money[]
  byFunder: Record<Funder, number>
}

/**
 * What the programme owes, by currency.
 *
 * Was `outstandingPoints / programme.per_unit` — every member's balance divided
 * by one marketplace-wide rate. That is a dollar answer for a member who has
 * never been quoted a dollar, and adding those answers up gave the operator a
 * gross liability figure that was wrong by two orders of magnitude for most of
 * the members in it.
 */
export function liability(
  members: readonly { balance: number; currency: string }[],
  movements: readonly Movement[],
  programme: Programme,
  rates: readonly PointRate[],
): Liability {
  const outstandingPoints = members.reduce((a, m) => a + Number(m.balance), 0)

  const owed = members.map(m =>
    asMoney(worthIn(Number(m.balance), { value_per: 1 }, rateFor(rates, m.currency)), m.currency))

  const gross = bucket(owed)
  const expected = gross.map(g => asMoney(+(g.amount * (1 - programme.breakage)).toFixed(2), g.currency))
  const breakageValue = gross.map((g, i) => asMoney(+(g.amount - expected[i].amount).toFixed(2), g.currency))

  const byFunder: Record<Funder, number> = { operator: 0, partner: 0, shared: 0 }
  for (const m of movements) {
    if (m.points > 0) byFunder[m.funder] += Number(m.points)
  }
  return { outstandingPoints, gross, expected, breakageValue, byFunder }
}

export interface SellerLine {
  partner_id: string
  points: number
  cost: Money[]
  movements: number
}

/** What the programme costs each seller, for the marketplace's view. The
    marketplace's own share is not a seller line and is left out. */
export function costBySeller(movements: readonly Movement[], rules: readonly EarnRule[]): SellerLine[] {
  const map = new Map<string, { points: number; cost: Money[]; movements: number }>()
  for (const m of movements) {
    if (!m.seller_id) continue
    const row = map.get(m.seller_id) ?? { points: 0, cost: [], movements: 0 }
    const c = costOf(m, rules)
    row.points += m.type === 'earn' ? Number(m.points) : 0
    row.cost.push(asMoney(c.amount * (m.type === 'reverse' ? -1 : 1), c.currency))
    row.movements += 1
    map.set(m.seller_id, row)
  }
  return [...map.entries()]
    .map(([partner_id, v]) => ({ partner_id, points: v.points, movements: v.movements, cost: bucket(v.cost) }))
    /* On points, for the same reason `byRule` is: costs in different currencies
       do not order. */
    .sort((a, b) => b.points - a.points)
}

/** Proposals waiting on the marketplace. Oldest first: a delay here costs the
    seller their campaign rather than costing the marketplace anything, so the
    one that has waited longest is the one that matters. */
export function pendingProposals(rules: readonly EarnRule[]): EarnRule[] {
  return rules
    .filter(r => r.status === 'pending' && r.proposed_by !== null)
    .slice()
    .sort((a, b) => (a.proposed_on ?? '').localeCompare(b.proposed_on ?? ''))
}

export function daysWaiting(rule: EarnRule, now: Date): number | null {
  if (!rule.proposed_on) return null
  const from = new Date(rule.proposed_on + 'T00:00:00Z').getTime()
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  return Math.round((today - from) / 86400000)
}

/** Approving one. The marketplace may move a seller-funded proposal to shared —
    that is it agreeing to pay part — but not the other way, because turning a
    shared rule into a seller-funded one after the fact is changing the price
    somebody already agreed to. */
export function validateApproval(
  rule: EarnRule, { funder, split, note }: { funder: Funder; split: number | null; note: string },
): Check {
  if (rule.status !== 'pending') {
    return { ok: false, reason: `${rule.name} is not waiting on a decision.` }
  }
  if (funder === 'operator') {
    return { ok: false, reason: 'A seller proposed to fund this. Taking the whole cost onto the marketplace is a different rule — write one rather than reclassifying theirs.' }
  }
  if (funder === 'shared' && (split === null || split <= 0 || split >= 100)) {
    return { ok: false, reason: 'A shared rule needs the marketplace’s percentage, between 1 and 99. Without it nobody can compute either half.' }
  }
  if (!note.trim()) {
    return { ok: false, reason: 'Say something back. A rule approved silently is one the seller cannot plan around, and a change to the funding split with no note on it is a change they will dispute.' }
  }
  return { ok: true }
}

export function validateRejection(note: string): Check {
  if (note.trim().split(/\s+/).filter(Boolean).length < 5) {
    return { ok: false, reason: 'Say why. A proposal refused with nothing on it comes back next quarter unchanged.' }
  }
  return { ok: true }
}
