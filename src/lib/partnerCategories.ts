/**
 * Adding, approving and withdrawing a seller's right to sell in a category.
 *
 * The seven company gates say who a seller is; a category approval says what
 * they may sell. They are separate because the demands are separate — security
 * wants an independent attestation, devices want type approval per market,
 * content wants distribution rights — and a seller who cleared onboarding has
 * not thereby cleared any of those.
 *
 * Adding a category is a change to the seller's agreement rather than a
 * setting, so it lands unapproved with its evidence outstanding, and it opens
 * only when the rules the matrix enforces are actually satisfied.
 */

export interface CategoryRow { id: string; name: string; sort_order: number }
export interface Approval {
  partner_id: string
  category_id: string
  approved_at: string | null
  approved_by: string | null
}
export interface EvidenceRow {
  partner_id: string
  category_id: string
  rule_id: string
  state: 'accepted' | 'standing' | 'submitted' | 'outstanding' | 'rejected' | 'waived'
  expires_on: string | null
}
export interface MatrixRow { category_id: string; rule_id: string; level: string }
export interface PolicyRuleRow { id: string; name: string; check_by: string; evidence: string | null }

export type Verdict = { ok: true } | { ok: false; reason: string }

/* A rule is met when the seller supplied something and it was accepted, when
   the platform enforces it without anybody uploading anything, or when it was
   deliberately waived. `submitted` counts too: it is with the reviewer, and
   holding the whole category for a queue the operator controls would punish the
   seller for the operator's backlog. */
const MET = new Set(['accepted', 'standing', 'waived', 'submitted'])

/** Which categories this seller could still be added to. A category they
    already hold — approved or merely applied for — is not one of them. */
export function addableCategories(
  categories: readonly CategoryRow[],
  approvals: readonly Approval[],
): CategoryRow[] {
  const held = new Set(approvals.map(a => a.category_id))
  return categories.filter(c => !held.has(c.id)).sort((a, b) => a.sort_order - b.sort_order)
}

/**
 * Whether a category may be added to this seller at all.
 *
 * A suspended or terminated seller is not a seller who should be picking up new
 * marketplaces; whatever caused the suspension is unresolved by definition.
 */
export function canAddCategory(
  partnerStatus: string,
  categoryId: string,
  categories: readonly CategoryRow[],
  approvals: readonly Approval[],
): Verdict {
  if (!categoryId) return { ok: false, reason: 'Choose a category.' }
  const category = categories.find(c => c.id === categoryId)
  if (!category) return { ok: false, reason: 'That category does not exist.' }

  if (partnerStatus === 'suspended') {
    return { ok: false, reason: 'This seller is suspended. Lift the suspension before widening what they may sell — whatever caused it is unresolved.' }
  }
  if (partnerStatus === 'terminated' || partnerStatus === 'rejected') {
    return { ok: false, reason: `This seller is ${partnerStatus}. There is no agreement to add a category to.` }
  }
  if (approvals.some(a => a.category_id === categoryId)) {
    const existing = approvals.find(a => a.category_id === categoryId)!
    return {
      ok: false,
      reason: existing.approved_at
        ? `${category.name} is already approved for this seller.`
        : `${category.name} has already been applied for — it is waiting on evidence, not on another application.`,
    }
  }
  return { ok: true }
}

/** The rules a newly added category will owe, and what each starts as. Mirrors
    the seeding in the category-onboarding migration, so a category added here
    and one seeded there look identical afterwards. */
export function openingEvidence(
  categoryId: string,
  matrix: readonly MatrixRow[],
  rules: readonly PolicyRuleRow[],
): { rule_id: string; state: 'outstanding' | 'standing'; document: string | null }[] {
  return matrix
    .filter(m => m.category_id === categoryId)
    .flatMap(m => {
      const rule = rules.find(r => r.id === m.rule_id)
      if (!rule) return []
      /* A rule the platform checks itself is neither owed nor supplied — it is
         simply in force from the moment the category is applied for. */
      const byDocument = rule.check_by === 'doc'
      return [{
        rule_id: m.rule_id,
        state: (byDocument ? 'outstanding' : 'standing') as 'outstanding' | 'standing',
        document: byDocument ? rule.evidence : null,
      }]
    })
}

/** What still stands between an applied-for category and an approved one. */
export function blockingRules(
  partnerId: string,
  categoryId: string,
  evidence: readonly EvidenceRow[],
  matrix: readonly MatrixRow[],
  rules: readonly PolicyRuleRow[],
): { rule_id: string; name: string; state: string }[] {
  const enforced = new Set(
    matrix.filter(m => m.category_id === categoryId && m.level === 'enforce').map(m => m.rule_id),
  )
  return evidence
    .filter(e => e.partner_id === partnerId && e.category_id === categoryId)
    .filter(e => enforced.has(e.rule_id) && !MET.has(e.state))
    .map(e => ({
      rule_id: e.rule_id,
      name: rules.find(r => r.id === e.rule_id)?.name ?? e.rule_id,
      state: e.state,
    }))
}

/**
 * Whether the operator may approve this category now.
 *
 * The same condition the database asserts after every migration: no rule the
 * matrix enforces may be outstanding or rejected. Stated here as well so the
 * button is disabled with a reason rather than the write failing at the far end
 * of a round trip.
 */
export function canApproveCategory(
  partnerId: string,
  categoryId: string,
  approvals: readonly Approval[],
  evidence: readonly EvidenceRow[],
  matrix: readonly MatrixRow[],
  rules: readonly PolicyRuleRow[],
): Verdict {
  const approval = approvals.find(a => a.category_id === categoryId)
  if (!approval) return { ok: false, reason: 'This seller has not applied for that category.' }
  if (approval.approved_at) return { ok: false, reason: 'It is already approved.' }

  const blocking = blockingRules(partnerId, categoryId, evidence, matrix, rules)
  if (blocking.length > 0) {
    const named = blocking.map(b => `${b.name} (${b.state})`).join(', ')
    return {
      ok: false,
      reason: `${blocking.length} rule${blocking.length === 1 ? '' : 's'} the marketplace enforces ${blocking.length === 1 ? 'is' : 'are'} not satisfied: ${named}.`,
    }
  }
  return { ok: true }
}

/**
 * Whether the operator may withdraw a category.
 *
 * Live listings are the reason this is not simply a delete. Withdrawing the
 * approval underneath them would leave products on sale in a category their
 * seller is no longer allowed to sell in — which is the exact contradiction the
 * whole eligibility model exists to prevent, and which the database asserts
 * against. They have to be dealt with first, and naming them is the difference
 * between a refusal somebody can act on and one they cannot.
 */
export function canWithdrawCategory(
  categoryId: string,
  approvals: readonly Approval[],
  listings: readonly { id: string; name: string; category_id: string; status: string }[],
): Verdict {
  const approval = approvals.find(a => a.category_id === categoryId)
  if (!approval) return { ok: false, reason: 'This seller does not hold that category.' }

  const onSale = listings.filter(l => l.category_id === categoryId && (l.status === 'live' || l.status === 'pending'))
  if (onSale.length > 0) {
    const named = onSale.slice(0, 3).map(l => l.name).join(', ')
    const more = onSale.length > 3 ? ` and ${onSale.length - 3} more` : ''
    return {
      ok: false,
      reason: `${onSale.length} listing${onSale.length === 1 ? '' : 's'} in this category ${onSale.length === 1 ? 'is' : 'are'} still on sale or in review: ${named}${more}. Suspend or reject ${onSale.length === 1 ? 'it' : 'them'} first — withdrawing now would leave ${onSale.length === 1 ? 'it' : 'them'} for sale in a category this seller may not sell in.`,
    }
  }
  return { ok: true }
}

/** A one-line account of where a category stands, for the record and the audit
    trail. "Approved" on its own does not say what it was approved against. */
export function approvalBasis(
  categoryName: string,
  evidence: readonly EvidenceRow[],
  partnerId: string,
  categoryId: string,
  matrix: readonly MatrixRow[],
): string {
  const mine = evidence.filter(e => e.partner_id === partnerId && e.category_id === categoryId)
  const enforced = matrix.filter(m => m.category_id === categoryId && m.level === 'enforce').length
  const documents = mine.filter(e => e.state === 'accepted').length
  const standing = mine.filter(e => e.state === 'standing').length
  const waived = mine.filter(e => e.state === 'waived').length

  const parts = [`${enforced} enforced rule${enforced === 1 ? '' : 's'}`]
  if (documents > 0) parts.push(`${documents} document${documents === 1 ? '' : 's'} accepted`)
  if (standing > 0) parts.push(`${standing} checked by the platform`)
  if (waived > 0) parts.push(`${waived} waived`)
  return `${categoryName} opened against ${parts.join(', ')}.`
}
