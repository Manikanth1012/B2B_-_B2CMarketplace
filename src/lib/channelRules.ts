/**
 * What this marketplace sells, and what is left to another channel.
 *
 * The rules are rows rather than an `if` in a function on purpose. `assign_number`
 * reads the same table the operator screen prints, so the refusal a customer
 * meets and the policy a desk quotes cannot drift apart — which is the failure
 * this build keeps finding: a screen that describes behaviour nothing enforces,
 * or a guard nobody can discover.
 *
 * Kept free of the database so the wording, the grouping and the "does this
 * belong here" test can be exercised without one.
 */

export type Decision = 'sold here' | 'not sold here'

export interface ChannelRule {
  id: string
  what: string
  label: string
  decision: Decision
  sold_through: string | null
  reason: string
  kb_ref: string | null
  effective_from: string
  agreed_by: string | null
  sort_order: number
}

/** The rules that say no, in the order they were agreed. What a desk reaches
    for when a customer asks why they cannot buy something. */
export function withheld(rules: readonly ChannelRule[]): ChannelRule[] {
  return rules
    .filter(r => r.decision === 'not sold here')
    .sort((a, b) => a.sort_order - b.sort_order)
}

/** And the ones that say yes. Stated rather than implied by absence, because
    "IoT connectivity is sold here" is the sentence that stops somebody reading
    the M2M number allocation as an oversight. */
export function allowed(rules: readonly ChannelRule[]): ChannelRule[] {
  return rules
    .filter(r => r.decision === 'sold here')
    .sort((a, b) => a.sort_order - b.sort_order)
}

export function ruleFor(rules: readonly ChannelRule[], what: string): ChannelRule | null {
  return rules.find(r => r.what === what) ?? null
}

/**
 * Whether a thing may be sold here. Unknown is permissive: a question nobody
 * has ruled on is not a refusal, and a default of "no" would silently withdraw
 * everything the moment a rule was renamed.
 */
export function permits(rules: readonly ChannelRule[], what: string): boolean {
  const rule = ruleFor(rules, what)
  return rule === null || rule.decision === 'sold here'
}

/**
 * What to tell somebody who tried. Names the rule, says why, and — the part
 * that matters — says where they can actually do it. A refusal with no
 * destination is a customer who phones the marketplace back.
 */
export function refusal(rules: readonly ChannelRule[], what: string): string | null {
  const rule = ruleFor(rules, what)
  if (!rule || rule.decision === 'sold here') return null
  const where = rule.sold_through
    ? ` It is done through ${rule.sold_through}.`
    : ''
  return `${rule.label} is not done in the marketplace. ${rule.reason}${where}`
}

/** The short form, for a chip or a column. The long reason does not fit and
    truncating it mid-sentence loses the destination, which is the useful half. */
export function shortAnswer(rule: ChannelRule): string {
  if (rule.decision === 'sold here') return 'Sold here'
  return rule.sold_through ? `Sold through ${rule.sold_through}` : 'Not sold here'
}

/**
 * A rule that cannot be acted on. A refusal with no destination leaves the
 * customer nowhere, and a rule agreed by nobody is one that gets reversed by
 * whoever complains loudest.
 */
export function incomplete(rule: ChannelRule): string | null {
  if (rule.decision === 'not sold here' && !rule.sold_through) {
    return 'Says no without saying where. A customer turned away with no destination comes straight back.'
  }
  if (!rule.reason.trim()) {
    return 'Has no reason on it, so nobody can defend it or retire it.'
  }
  if (!rule.agreed_by) {
    return 'Nobody is recorded as having agreed it.'
  }
  return null
}
