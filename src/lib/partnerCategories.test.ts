import { describe, it, expect } from 'vitest'
import {
  addableCategories, canAddCategory, canApproveCategory, canWithdrawCategory,
  blockingRules, openingEvidence, approvalBasis,
} from './partnerCategories'
import type { CategoryRow, Approval, EvidenceRow, MatrixRow, PolicyRuleRow } from './partnerCategories'

const CATEGORIES: CategoryRow[] = [
  { id: 'consumer', name: 'Consumer', sort_order: 1 },
  { id: 'iot', name: 'IoT', sort_order: 3 },
  { id: 'security', name: 'Security', sort_order: 4 },
  { id: 'device', name: 'Devices', sort_order: 5 },
]

const RULES: PolicyRuleRow[] = [
  { id: 'PR-01', name: 'Certificate of incorporation', check_by: 'doc', evidence: 'Incorporation certificate' },
  { id: 'PR-02', name: 'Sanctions screening', check_by: 'platform', evidence: null },
  { id: 'PR-04', name: 'Radio type approval', check_by: 'doc', evidence: 'Type approval certificate' },
  { id: 'PR-07', name: 'Independent security attestation', check_by: 'doc', evidence: 'SOC 2 Type II report' },
]

const MATRIX: MatrixRow[] = [
  { category_id: 'iot', rule_id: 'PR-01', level: 'enforce' },
  { category_id: 'iot', rule_id: 'PR-02', level: 'enforce' },
  { category_id: 'iot', rule_id: 'PR-04', level: 'enforce' },
  { category_id: 'security', rule_id: 'PR-01', level: 'enforce' },
  { category_id: 'security', rule_id: 'PR-07', level: 'enforce' },
  /* Advisory: it never blocks, and testing that it does not is the point. */
  { category_id: 'security', rule_id: 'PR-04', level: 'advise' },
]

const approval = (category_id: string, approved_at: string | null = null): Approval =>
  ({ partner_id: 'PTR-1004', category_id, approved_at, approved_by: approved_at ? 'Anika Sharma' : null })

const ev = (category_id: string, rule_id: string, state: EvidenceRow['state']): EvidenceRow =>
  ({ partner_id: 'PTR-1004', category_id, rule_id, state, expires_on: null })

const listing = (id: string, name: string, category_id: string, status: string) =>
  ({ id, name, category_id, status })

describe('addableCategories', () => {
  it('offers only what the seller does not already hold, in display order', () => {
    const out = addableCategories(CATEGORIES, [approval('iot', '2026-01-04'), approval('security')])
    expect(out.map(c => c.id)).toEqual(['consumer', 'device'])
  })

  it('counts an applied-for category as held, not as addable', () => {
    /* Otherwise the operator adds it twice and the unique key refuses the
       second one at the far end of a round trip. */
    expect(addableCategories(CATEGORIES, [approval('iot')]).some(c => c.id === 'iot')).toBe(false)
  })

  it('offers nothing when the seller holds everything', () => {
    expect(addableCategories(CATEGORIES, CATEGORIES.map(c => approval(c.id)))).toEqual([])
  })
})

describe('canAddCategory', () => {
  it('allows a live seller a category they do not hold', () => {
    expect(canAddCategory('live', 'security', CATEGORIES, [approval('iot', '2026-01-04')])).toEqual({ ok: true })
  })

  it('refuses a suspended seller, because whatever suspended them is unresolved', () => {
    const v = canAddCategory('suspended', 'security', CATEGORIES, [])
    expect(v.ok).toBe(false)
    expect(!v.ok && v.reason).toMatch(/suspended/i)
  })

  it('refuses a terminated seller outright', () => {
    const v = canAddCategory('terminated', 'security', CATEGORIES, [])
    expect(!v.ok && v.reason).toMatch(/no agreement/i)
  })

  it('distinguishes already approved from already applied for', () => {
    const approved = canAddCategory('live', 'iot', CATEGORIES, [approval('iot', '2026-01-04')])
    expect(!approved.ok && approved.reason).toMatch(/already approved/)
    const applied = canAddCategory('live', 'iot', CATEGORIES, [approval('iot')])
    expect(!applied.ok && applied.reason).toMatch(/waiting on evidence/)
  })

  it('refuses a category that does not exist, and an empty choice', () => {
    expect(canAddCategory('live', 'nonsense', CATEGORIES, []).ok).toBe(false)
    expect(canAddCategory('live', '', CATEGORIES, []).ok).toBe(false)
  })
})

describe('openingEvidence', () => {
  it('owes a document for every document rule and nothing for a platform check', () => {
    const out = openingEvidence('iot', MATRIX, RULES)
    expect(out).toHaveLength(3)
    expect(out.find(o => o.rule_id === 'PR-01')).toEqual({ rule_id: 'PR-01', state: 'outstanding', document: 'Incorporation certificate' })
    /* Calling a sanctions screen "outstanding" would claim the seller owes a
       document nobody will ever ask them for. */
    expect(out.find(o => o.rule_id === 'PR-02')).toEqual({ rule_id: 'PR-02', state: 'standing', document: null })
  })

  it('includes advisory rules — advice still has to be recorded to be given', () => {
    expect(openingEvidence('security', MATRIX, RULES).map(o => o.rule_id).sort())
      .toEqual(['PR-01', 'PR-04', 'PR-07'])
  })

  it('skips a matrix row whose rule has been retired from the rulebook', () => {
    const matrix = [...MATRIX, { category_id: 'iot', rule_id: 'PR-99', level: 'enforce' }]
    expect(openingEvidence('iot', matrix, RULES).some(o => o.rule_id === 'PR-99')).toBe(false)
  })
})

describe('blockingRules and canApproveCategory', () => {
  const ready: EvidenceRow[] = [
    ev('iot', 'PR-01', 'accepted'), ev('iot', 'PR-02', 'standing'), ev('iot', 'PR-04', 'accepted'),
  ]

  it('approves when every enforced rule is satisfied', () => {
    expect(canApproveCategory('PTR-1004', 'iot', [approval('iot')], ready, MATRIX, RULES)).toEqual({ ok: true })
  })

  it('refuses while an enforced document is outstanding, and names it', () => {
    const evidence = [ev('iot', 'PR-01', 'accepted'), ev('iot', 'PR-02', 'standing'), ev('iot', 'PR-04', 'outstanding')]
    const v = canApproveCategory('PTR-1004', 'iot', [approval('iot')], evidence, MATRIX, RULES)
    expect(v.ok).toBe(false)
    expect(!v.ok && v.reason).toContain('Radio type approval')
  })

  it('refuses on a rejected document too — rejected is not merely unfinished', () => {
    const evidence = [ev('iot', 'PR-01', 'rejected'), ev('iot', 'PR-02', 'standing'), ev('iot', 'PR-04', 'accepted')]
    expect(canApproveCategory('PTR-1004', 'iot', [approval('iot')], evidence, MATRIX, RULES).ok).toBe(false)
  })

  it('lets a submitted document through rather than holding the seller for the operator’s own queue', () => {
    const evidence = [ev('iot', 'PR-01', 'submitted'), ev('iot', 'PR-02', 'standing'), ev('iot', 'PR-04', 'accepted')]
    expect(canApproveCategory('PTR-1004', 'iot', [approval('iot')], evidence, MATRIX, RULES).ok).toBe(true)
  })

  it('treats a waiver as satisfying the rule, because that is what a waiver is', () => {
    const evidence = [ev('iot', 'PR-01', 'waived'), ev('iot', 'PR-02', 'standing'), ev('iot', 'PR-04', 'accepted')]
    expect(canApproveCategory('PTR-1004', 'iot', [approval('iot')], evidence, MATRIX, RULES).ok).toBe(true)
  })

  it('never blocks on an advisory rule', () => {
    /* PR-04 is advisory in security. Outstanding advice is still advice. */
    const evidence = [ev('security', 'PR-01', 'accepted'), ev('security', 'PR-07', 'accepted'), ev('security', 'PR-04', 'outstanding')]
    expect(blockingRules('PTR-1004', 'security', evidence, MATRIX, RULES)).toEqual([])
    expect(canApproveCategory('PTR-1004', 'security', [approval('security')], evidence, MATRIX, RULES).ok).toBe(true)
  })

  it('refuses to approve what was never applied for, or what is approved already', () => {
    expect(canApproveCategory('PTR-1004', 'device', [], [], MATRIX, RULES).ok).toBe(false)
    expect(canApproveCategory('PTR-1004', 'iot', [approval('iot', '2026-01-04')], ready, MATRIX, RULES).ok).toBe(false)
  })
})

describe('canWithdrawCategory', () => {
  it('withdraws a category with nothing on sale in it', () => {
    const listings = [listing('SKU-1', 'Old sensor', 'iot', 'rejected')]
    expect(canWithdrawCategory('iot', [approval('iot', '2026-01-04')], listings)).toEqual({ ok: true })
  })

  it('refuses while listings are live, and names them', () => {
    const listings = [
      listing('SKU-1', 'Nimbus Occupancy sensor', 'iot', 'live'),
      listing('SKU-2', 'Nimbus Cold-chain sensor', 'iot', 'live'),
    ]
    const v = canWithdrawCategory('iot', [approval('iot', '2026-01-04')], listings)
    expect(v.ok).toBe(false)
    expect(!v.ok && v.reason).toContain('Nimbus Occupancy sensor')
    expect(!v.ok && v.reason).toMatch(/2 listings/)
  })

  it('counts a listing still in review, not only one on sale', () => {
    /* Approving it after the category was withdrawn would publish into a
       category the seller may not sell in. */
    const listings = [listing('SKU-3', 'Nimbus Air Quality sensor', 'iot', 'pending')]
    expect(canWithdrawCategory('iot', [approval('iot', '2026-01-04')], listings).ok).toBe(false)
  })

  it('summarises rather than listing twenty names', () => {
    const listings = Array.from({ length: 6 }, (_, i) => listing(`SKU-${i}`, `Sensor ${i}`, 'iot', 'live'))
    const v = canWithdrawCategory('iot', [approval('iot', '2026-01-04')], listings)
    expect(!v.ok && v.reason).toMatch(/and 3 more/)
  })

  it('refuses a category the seller never held', () => {
    expect(canWithdrawCategory('device', [approval('iot')], []).ok).toBe(false)
  })
})

describe('approvalBasis', () => {
  it('says what the approval was granted against, not just that it was', () => {
    const evidence = [ev('iot', 'PR-01', 'accepted'), ev('iot', 'PR-02', 'standing'), ev('iot', 'PR-04', 'accepted')]
    expect(approvalBasis('IoT', evidence, 'PTR-1004', 'iot', MATRIX))
      .toBe('IoT opened against 3 enforced rules, 2 documents accepted, 1 checked by the platform.')
  })

  it('mentions a waiver, because a waiver is the part somebody will ask about', () => {
    const evidence = [ev('iot', 'PR-01', 'waived'), ev('iot', 'PR-02', 'standing'), ev('iot', 'PR-04', 'accepted')]
    expect(approvalBasis('IoT', evidence, 'PTR-1004', 'iot', MATRIX)).toContain('1 waived')
  })
})
