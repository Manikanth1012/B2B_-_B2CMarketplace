/* Rewards for an organisation. No React and no Supabase.

   The difference from a person's programme is who owns the points. Points
   earned on company spend are company money, so releasing them is the same
   kind of act as approving a requisition and gets the same control: one person
   proposes, another releases. Everything here exists so a screen can explain a
   refusal before the database has to. */

export type RedemptionState = 'proposed' | 'released' | 'applied' | 'declined' | 'withdrawn'

export interface Tier {
  id: string
  name: string
  sort_order: number
  qualify_spend: number
  multiplier: number
  colour: string | null
  benefits: string[]
  note: string | null
  kind: 'consumer' | 'enterprise'
}

export interface RewardMember {
  id: string
  account_id: string | null
  name: string
  kind: string
  tier: string
  balance: number
  joined: string
  qualify_12m: number
  lifetime_earned: number
  lifetime_redeemed: number
  expiring_soon: number
  expiring_on: string | null
  last_activity: string | null
}

export interface Movement {
  id: string
  member: string
  when_date: string
  type: 'earn' | 'redeem' | 'reverse' | 'expire' | 'adjust'
  points: number
  ref: string | null
  rule_id: string | null
  funder: string | null
  seller_id: string | null
  value: number
  note: string | null
}

export interface RewardRule {
  id: string
  name: string
  scope: string
  scope_id: string | null
  rate: number
  funder: string
  status: string
  audience: string
  cap_per_order: number | null
  cap_per_month: number | null
  first_only: boolean
  why: string | null
  from: string
}

export interface RedeemOption {
  id: string
  name: string
  kind: string
  min: number
  step: number
  value_per: number
  cost: string
  audience: string
  status: string
  description: string | null
  why: string | null
}

export interface RewardPolicy {
  account_id: string
  min_redeem: number
  propose_roles: string[]
  release_roles: string[]
  auto_apply: boolean
  allocate_to_cost_centre: boolean
  default_cost_centre: string | null
  note: string
  updated_by: string | null
  updated_on: string | null
}

export interface Redemption {
  id: string
  account_id: string
  member_id: string
  option_id: string
  points: number
  value: number
  cost_centre: string | null
  reason: string
  state: RedemptionState
  proposed_by: string
  proposed_on: string
  released_by: string | null
  released_on: string | null
  decision_note: string | null
  applied_to: string | null
  applied_on: string | null
  ledger_ref: string | null
  sort_order: number
}

export type Check = { ok: true; note?: string } | { ok: false; reason: string }

/* Points per unit of currency comes from the programme; 100 points to the
   dollar throughout. Passed in rather than assumed so a screen cannot quote a
   rate the programme does not use. */
export const DEFAULT_PER_UNIT = 100

export function pointsValue(points: number, perUnit = DEFAULT_PER_UNIT): number {
  return Math.round((points / perUnit) * 100) / 100
}

/* ----------------------------------------------------------------- tiers -- */

export function tiersFor(tiers: Tier[], kind: 'consumer' | 'enterprise'): Tier[] {
  return tiers.filter(t => t.kind === kind).sort((a, b) => a.sort_order - b.sort_order)
}

export function tierOf(member: RewardMember, tiers: Tier[]): Tier | null {
  return tiers.find(t => t.id === member.tier) ?? null
}

/** Where the account sits and what it would take to move up. A tier with no
    distance to the next one is a badge; a tier with the gap on it is a reason
    to consolidate spend on the marketplace rather than around it. */
export function tierProgress(member: RewardMember, tiers: Tier[]): {
  current: Tier | null; next: Tier | null; need: number; pct: number; top: boolean
} {
  const ladder = tiersFor(tiers, member.kind === 'enterprise' ? 'enterprise' : 'consumer')
  const current = tierOf(member, tiers)
  const next = ladder.find(t => t.qualify_spend > member.qualify_12m) ?? null
  if (!next) return { current, next: null, need: 0, pct: 100, top: true }
  const floor = current?.qualify_spend ?? 0
  const span = next.qualify_spend - floor
  const pct = span > 0 ? Math.round(((member.qualify_12m - floor) / span) * 1000) / 10 : 0
  return {
    current, next,
    need: Math.round((next.qualify_spend - member.qualify_12m) * 100) / 100,
    pct: Math.max(0, Math.min(100, pct)),
    top: false,
  }
}

/** The tier the spend actually qualifies for, which is not always the one on
    file — an account can hold a tier through a quiet quarter. */
export function qualifiesFor(qualify: number, tiers: Tier[], kind: 'consumer' | 'enterprise'): Tier | null {
  const ladder = tiersFor(tiers, kind)
  let held: Tier | null = null
  for (const t of ladder) if (qualify >= t.qualify_spend) held = t
  return held
}

/* ------------------------------------------------------------ movements -- */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "24 Jul 2026" is stored as text, so sorting it as a string puts June after
    July. Everything that orders movements goes through here. */
export function movementDate(when: string): number {
  const m = /^(\d{1,2}) ([A-Za-z]{3})[a-z]* (\d{4})$/.exec(when.trim())
  if (!m) { const t = Date.parse(when); return Number.isNaN(t) ? 0 : t }
  const month = MONTHS.indexOf(m[2].slice(0, 3))
  return month < 0 ? 0 : Date.UTC(Number(m[3]), month, Number(m[1]))
}

export function newestFirst(movements: Movement[]): Movement[] {
  return [...movements].sort((a, b) => movementDate(b.when_date) - movementDate(a.when_date))
}

export function balanceOf(movements: Movement[]): number {
  return movements.reduce((n, m) => n + Number(m.points), 0)
}

/** What the balance is made of, which is the only honest way to show a number
    the account cannot edit. */
export function summarise(movements: Movement[]): {
  balance: number; earned: number; redeemed: number; expired: number; reversed: number
  movements: number; value: number
} {
  const sum = (t: Movement['type']) => movements.filter(m => m.type === t).reduce((n, m) => n + Number(m.points), 0)
  const balance = balanceOf(movements)
  return {
    balance,
    earned: sum('earn'),
    redeemed: -sum('redeem'),
    expired: -sum('expire'),
    reversed: -sum('reverse'),
    movements: movements.length,
    value: pointsValue(balance),
  }
}

/** Which rules actually paid, and how much. An accelerator that has never
    issued a point is one nobody is buying under. */
export function byRule(movements: Movement[], rules: RewardRule[]): {
  rule: RewardRule | null; id: string; points: number; count: number; funder: string; value: number
}[] {
  const m = new Map<string, { points: number; count: number }>()
  for (const mv of movements) {
    if (mv.type !== 'earn' || !mv.rule_id) continue
    const row = m.get(mv.rule_id) ?? { points: 0, count: 0 }
    row.points += Number(mv.points)
    row.count += 1
    m.set(mv.rule_id, row)
  }
  return [...m.entries()]
    .map(([id, v]) => {
      const rule = rules.find(r => r.id === id) ?? null
      return { id, rule, points: v.points, count: v.count, funder: rule?.funder ?? 'operator', value: pointsValue(v.points) }
    })
    .sort((a, b) => b.points - a.points)
}

/** What earned the points, by marketplace, so a procurement lead can see
    whether the programme rewards what the company actually buys. */
export function byVertical(movements: Movement[], rules: RewardRule[]): {
  vertical: string; points: number; count: number
}[] {
  const m = new Map<string, { points: number; count: number }>()
  for (const mv of movements) {
    if (mv.type !== 'earn') continue
    const rule = rules.find(r => r.id === mv.rule_id)
    const key = rule?.scope === 'vertical' ? (rule.scope_id ?? 'everything') : 'everything'
    const row = m.get(key) ?? { points: 0, count: 0 }
    row.points += Number(mv.points)
    row.count += 1
    m.set(key, row)
  }
  return [...m.entries()]
    .map(([vertical, v]) => ({ vertical, ...v }))
    .sort((a, b) => b.points - a.points)
}

/** Points on the account that nobody has spent. Worth saying in money, because
    "86,630 points" is not a number anybody has a feel for. */
export function idleValue(member: RewardMember, perUnit = DEFAULT_PER_UNIT): {
  points: number; value: number; monthsHeld: number | null
} {
  return {
    points: member.balance,
    value: pointsValue(member.balance, perUnit),
    monthsHeld: null,
  }
}

/* --------------------------------------------------------- redemptions --- */

/** What the account can actually turn points into. Filtered to what applies to
    a business, because offering a consumer trade-in to a company is offering
    something that will fail at the last step. */
export function optionsFor(options: RedeemOption[], member: RewardMember): RedeemOption[] {
  const want = member.kind === 'enterprise' ? 'enterprise' : 'consumer'
  return options
    .filter(o => o.status === 'active' && (o.audience === 'all' || o.audience === want))
    .sort((a, b) => a.min - b.min)
}

export function canAfford(option: RedeemOption, member: RewardMember): boolean {
  return member.balance >= option.min
}

/** Who may put a redemption forward. Held as roles rather than names, so
    somebody leaving does not silently disable the programme. */
export function canPropose(role: string, policy: RewardPolicy): Check {
  return policy.propose_roles.includes(role)
    ? { ok: true }
    : { ok: false, reason: `A ${role.replace('-', ' ')} cannot propose a redemption on this account.` }
}

/**
 * Who may release one.
 *
 * The separation-of-duties test is skipped where the account has only one role
 * that can release — some accounts genuinely have one person, and refusing
 * them would mean the points can never be spent at all. The policy says so out
 * loud rather than the code deciding quietly.
 */
export function canRelease(redemption: Redemption, role: string, userId: string, policy: RewardPolicy): Check {
  if (redemption.state !== 'proposed') {
    return { ok: false, reason: `${redemption.id} was already ${redemption.state}.` }
  }
  if (!policy.release_roles.includes(role)) {
    return { ok: false, reason: `A ${role.replace('-', ' ')} cannot release a redemption on this account.` }
  }
  if (redemption.proposed_by === userId && policy.release_roles.length > 1) {
    return {
      ok: false,
      reason: 'You proposed this one. Somebody else has to release it — points earned on company spend are company money too.',
    }
  }
  return { ok: true }
}

export function validateProposal(
  draft: { option: RedeemOption | null; points: number; reason: string; costCentre: string | null },
  member: RewardMember, policy: RewardPolicy,
): Check {
  if (!draft.option) return { ok: false, reason: 'Pick what the points are being turned into' }
  if (!Number.isFinite(draft.points) || draft.points <= 0) {
    return { ok: false, reason: 'Say how many points' }
  }
  if (draft.points > member.balance) {
    return { ok: false, reason: `That is more than the ${fmtPoints(member.balance)} the account holds.` }
  }
  if (draft.points < policy.min_redeem) {
    return { ok: false, reason: `The minimum on this account is ${fmtPoints(policy.min_redeem)} — worth ${money(pointsValue(policy.min_redeem))}.` }
  }
  if (draft.points < draft.option.min) {
    return { ok: false, reason: `${draft.option.name} starts at ${fmtPoints(draft.option.min)}.` }
  }
  if (draft.option.step > 1 && draft.points % draft.option.step !== 0) {
    return { ok: false, reason: `${draft.option.name} goes in steps of ${fmtPoints(draft.option.step)}.` }
  }
  if (!draft.reason.trim()) {
    return { ok: false, reason: 'Say what it is for. Whoever releases it is spending company money on your say-so.' }
  }
  if (policy.allocate_to_cost_centre && !draft.costCentre) {
    return { ok: false, reason: 'This account allocates reward credit to a cost centre — pick one.' }
  }
  return { ok: true }
}

export function validateRelease(release: boolean, note: string): Check {
  if (!release && !note.trim()) {
    return { ok: false, reason: 'A decline needs a reason. The proposer cannot revise what they were not told about.' }
  }
  return { ok: true }
}

/** What releasing actually does, in the terms the person signing it cares
    about: the balance afterwards, where the credit lands, and when. */
export function releaseImpact(
  redemption: Redemption, member: RewardMember, option: RedeemOption | null, policy: RewardPolicy,
): string[] {
  const out: string[] = []
  out.push(`${fmtPoints(redemption.points)} leave the balance, worth ${money(Number(redemption.value))}.`)
  out.push(`${fmtPoints(member.balance - redemption.points)} left afterwards.`)
  out.push(
    policy.auto_apply
      ? `${option?.name ?? 'The credit'} lands on the next invoice automatically — nobody has to remember to apply it.`
      : `${option?.name ?? 'The credit'} has to be applied by hand once it is released.`,
  )
  if (redemption.cost_centre) out.push(`Attributed to ${redemption.cost_centre}.`)
  return out
}

export function waiting(redemptions: Redemption[]): Redemption[] {
  return redemptions.filter(r => r.state === 'proposed')
    .sort((a, b) => a.proposed_on.localeCompare(b.proposed_on))
}

export function settled(redemptions: Redemption[]): Redemption[] {
  return redemptions.filter(r => r.state !== 'proposed')
    .sort((a, b) => (b.released_on ?? b.proposed_on).localeCompare(a.released_on ?? a.proposed_on))
}

/** Points spoken for but not yet gone. Showing a balance that ignores what is
    already proposed is how two people spend the same points. */
export function committedPoints(redemptions: Redemption[]): number {
  return waiting(redemptions).reduce((n, r) => n + r.points, 0)
}

export function availablePoints(member: RewardMember, redemptions: Redemption[]): number {
  return member.balance - committedPoints(redemptions)
}

/* --------------------------------------------------------------- helpers -- */

export function fmtPoints(n: number): string {
  return `${Math.round(n).toLocaleString('en-US')} points`
}

export function money(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export function money0(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`
}

export const FUNDER_LABEL: Record<string, string> = {
  operator: 'the marketplace',
  partner: 'the seller',
  shared: 'the marketplace and the seller',
}
