import { describe, it, expect } from 'vitest'
import {
  FUNDERS, shareOf, costOf, rewardCost, byRule, shareLabel, rulesCosting, myProposals,
  validateProposal, proposalImpact, canWithdraw, MAX_RATE,
  liability, costBySeller, pendingProposals, daysWaiting,
  validateApproval, validateRejection, newestFirst, movementDate,
} from './sellerRewards'
import type { EarnRule, Movement, Programme } from './sellerRewards'

const programme: Programme = {
  name: 'Aventa Rewards', unit: 'points', per_unit: 100, min_redeem: 500,
  expiry_months: 24, breakage: 0.18, funding_note: 'Somebody funds every point.', status: 'live',
}

const rule = (over: Partial<EarnRule> & Pick<EarnRule, 'id'>): EarnRule => ({
  name: 'Nimbus sensor starter pack', scope: 'partner', scope_id: 'PTR-1004',
  rate: 2.5, funder: 'partner', split: null, status: 'active',
  from: '01 Jun 2026', to: '30 Sep 2026', cap_per_order: 1200, cap_per_month: null,
  audience: 'all', bonus: null, first_only: null, why: 'Buy the second sale.',
  proposed_by: null, proposed_on: null, decided_by: null, decided_on: null, decision_note: null,
  ...over,
})

const mv = (over: Partial<Movement> & Pick<Movement, 'id'>): Movement => ({
  member: 'LM-4001', when_date: '01 Jul 2026', type: 'earn', points: 1000,
  ref: 'ORD-1', rule_id: 'ERN-09', funder: 'partner', seller_id: 'PTR-1004',
  value: 10, note: null,
  ...over,
})

/* ----------------------------------------------------------- whose money -- */

describe('shareOf', () => {
  const rules = [
    rule({ id: 'ERN-09' }),
    rule({ id: 'ERN-10', funder: 'shared', split: 40 }),
    rule({ id: 'ERN-01', funder: 'operator' }),
  ]

  it('charges a seller the whole of a rule they fund', () => {
    expect(shareOf(mv({ id: 'a' }), rules)).toBe(1)
  })

  it('charges nothing for a rule the marketplace funds', () => {
    /* Marketing spend hits the promotions budget, not a settlement line. */
    expect(shareOf(mv({ id: 'a', funder: 'operator', rule_id: 'ERN-01' }), rules)).toBe(0)
  })

  it('charges a seller the half of a shared rule that is not the marketplace’s', () => {
    /* split is the marketplace's percentage, so 40 leaves the seller 60. */
    expect(shareOf(mv({ id: 'a', funder: 'shared', rule_id: 'ERN-10' }), rules)).toBe(0.6)
  })

  it('falls back to the whole cost when the rule behind a shared movement is gone', () => {
    /* Assuming the marketplace paid a share nobody can evidence would understate
       what the seller is being billed. */
    expect(shareOf(mv({ id: 'a', funder: 'shared', rule_id: 'GONE' }), rules)).toBe(1)
  })
})

describe('costOf', () => {
  it('applies the share to the cent', () => {
    const rules = [rule({ id: 'ERN-10', funder: 'shared', split: 40 })]
    expect(costOf(mv({ id: 'a', funder: 'shared', rule_id: 'ERN-10', value: 9.4 }), rules)).toBe(5.64)
  })
})

/* ------------------------------------------------------------- the bill --- */

describe('rewardCost', () => {
  const rules = [rule({ id: 'ERN-09' })]
  const rows = [
    mv({ id: 'a', points: 1200, value: 12 }),
    mv({ id: 'b', points: 680, value: 6.8 }),
    mv({ id: 'c', type: 'reverse', points: -680, value: 6.8 }),
    mv({ id: 'd', type: 'redeem', points: -3000, value: 36, rule_id: null }),
  ]

  it('counts what was issued and what came back separately', () => {
    /* "You were charged and then you were not" is two facts a seller wants to
       see, not one net number. */
    const c = rewardCost(rows, rules)
    expect(c).toMatchObject({ issued: 1880, clawed: 680, redeemed: 3000 })
  })

  it('nets the clawback off the issuing cost but keeps redemption separate', () => {
    const c = rewardCost(rows, rules)
    expect(c.issuingCost).toBe(18.8)
    expect(c.clawedBack).toBe(6.8)
    expect(c.redemptionCost).toBe(36)
    expect(c.total).toBe(48)
  })

  it('reports nothing rather than NaN on a seller with no movements', () => {
    expect(rewardCost([], rules)).toMatchObject({ issued: 0, total: 0, movements: 0 })
  })
})

describe('byRule', () => {
  it('ranks campaigns by what they cost, so the expensive one is actionable', () => {
    const rules = [rule({ id: 'ERN-09' }), rule({ id: 'ERN-03', name: 'Device trade-in bonus' })]
    const out = byRule([
      mv({ id: 'a', rule_id: 'ERN-09', value: 12 }),
      mv({ id: 'b', rule_id: 'ERN-09', value: 9.4 }),
      mv({ id: 'c', rule_id: 'ERN-03', value: 6.8 }),
    ], rules)
    expect(out[0].rule.id).toBe('ERN-09')
    expect(out[0].cost).toBe(21.4)
    expect(out[0].movements).toBe(2)
  })

  it('subtracts a reversal from the rule it was issued under', () => {
    const rules = [rule({ id: 'ERN-09' })]
    const out = byRule([
      mv({ id: 'a', value: 12 }),
      mv({ id: 'b', type: 'reverse', points: -1200, value: 12 }),
    ], rules)
    expect(out[0].cost).toBe(0)
  })

  it('ignores a redemption, which belongs to no rule', () => {
    expect(byRule([mv({ id: 'a', type: 'redeem', rule_id: null })], [])).toEqual([])
  })
})

describe('shareLabel', () => {
  it('says "all of it" rather than 100%', () => {
    expect(shareLabel(rule({ id: 'a' }))).toBe('All of it')
  })

  it('spells out both halves of a shared rule', () => {
    expect(shareLabel(rule({ id: 'a', funder: 'shared', split: 40 })))
      .toBe('60% — the marketplace funds 40%')
  })

  it('says plainly when a rule costs the seller nothing', () => {
    expect(shareLabel(rule({ id: 'a', funder: 'operator' }))).toMatch(/marketplace funds it/)
  })
})

describe('rulesCosting', () => {
  const rules = [
    rule({ id: 'ERN-01', scope: 'all', scope_id: null, funder: 'operator' }),
    rule({ id: 'ERN-02', scope: 'vertical', scope_id: 'content', funder: 'shared', split: 50 }),
    rule({ id: 'ERN-06', scope_id: 'PTR-1002' }),
    rule({ id: 'ERN-09' }),
    rule({ id: 'ERN-10', status: 'pending', funder: 'shared', split: 40 }),
  ]

  it('leaves out the rules the marketplace pays for', () => {
    expect(rulesCosting(rules, 'PTR-1004').map(r => r.id)).not.toContain('ERN-01')
  })

  it('leaves out another seller’s rule — it is none of their business', () => {
    expect(rulesCosting(rules, 'PTR-1004').map(r => r.id)).not.toContain('ERN-06')
  })

  it('keeps a category rule the seller funds part of', () => {
    expect(rulesCosting(rules, 'PTR-1004').map(r => r.id)).toContain('ERN-02')
  })

  it('puts what is running before what is only proposed', () => {
    const out = rulesCosting(rules, 'PTR-1004')
    expect(out[out.length - 1].id).toBe('ERN-10')
  })
})

describe('myProposals', () => {
  it('returns only what this seller asked for', () => {
    const rules = [
      rule({ id: 'ERN-10', status: 'pending', proposed_by: 'Rajesh Kumar', proposed_on: '2026-07-18' }),
      rule({ id: 'ERN-11', scope_id: 'PTR-1003', status: 'pending', proposed_by: 'Farah', proposed_on: '2026-07-26' }),
      rule({ id: 'ERN-09' }),
    ]
    expect(myProposals(rules, 'PTR-1004').map(r => r.id)).toEqual(['ERN-10'])
  })
})

/* --------------------------------------------------------- proposing one -- */

describe('validateProposal', () => {
  const p = {
    name: 'Autumn accessory bonus', rate: 2, capPerOrder: 1000,
    from: '2026-09-01', to: '2026-11-30',
    why: 'Accessories attach to a sensor order or they never sell at all.',
  }

  it('accepts a complete, explained proposal', () => {
    expect(validateProposal(p)).toEqual({ ok: true })
  })

  it('refuses one with no cap — an open cheque on the largest order', () => {
    const v = validateProposal({ ...p, capPerOrder: 0 })
    expect(!v.ok && v.reason).toMatch(/open cheque/)
  })

  it('refuses a rate above the ceiling and says what happens instead', () => {
    const v = validateProposal({ ...p, rate: MAX_RATE + 1 })
    expect(!v.ok && v.reason).toMatch(/conversation rather than a form/)
  })

  it('refuses one that ends before it starts', () => {
    expect(validateProposal({ ...p, from: '2026-11-01', to: '2026-09-01' }).ok).toBe(false)
  })

  it('refuses one that does not say what it is meant to change', () => {
    const v = validateProposal({ ...p, why: 'more sales' })
    expect(!v.ok && v.reason).toMatch(/nobody can evaluate/)
  })

  it('accepts an open-ended one', () => {
    expect(validateProposal({ ...p, to: '' }).ok).toBe(true)
  })
})

describe('proposalImpact', () => {
  it('computes the worst case rather than describing it', () => {
    const lines = proposalImpact({
      name: 'x', rate: 2, capPerOrder: 1200, from: '', to: '', why: 'y',
    }, programme)
    expect(lines[0]).toMatch(/\$0\.01 a point/)
    expect(lines[1]).toMatch(/most one order can cost you is \$12\.00/)
  })

  it('says that nothing issues before approval', () => {
    const lines = proposalImpact({ name: 'x', rate: 2, capPerOrder: 100, from: '', to: '', why: 'y' }, programme)
    expect(lines.some(l => /not a live rule/.test(l))).toBe(true)
  })
})

describe('canWithdraw', () => {
  it('lets a seller take back something nobody has answered', () => {
    expect(canWithdraw(rule({ id: 'a', status: 'pending', proposed_by: 'Rajesh', proposed_on: '2026-07-18' })))
      .toEqual({ ok: true })
  })

  it('refuses to delete a rule that is already running', () => {
    const v = canWithdraw(rule({ id: 'a', proposed_by: 'Rajesh', proposed_on: '2026-07-18' }))
    expect(!v.ok && v.reason).toMatch(/live campaign/)
  })

  it('refuses to delete one the marketplace wrote', () => {
    const v = canWithdraw(rule({ id: 'a', status: 'pending' }))
    expect(!v.ok && v.reason).toMatch(/not yours to withdraw/)
  })
})

/* ------------------------------------------------- the marketplace's side -- */

describe('liability', () => {
  it('values every outstanding point, and says what it expects never to be spent', () => {
    const l = liability([{ balance: 10000 }, { balance: 5000 }], [], programme)
    expect(l.outstandingPoints).toBe(15000)
    expect(l.gross).toBe(150)
    expect(l.expected).toBe(123)
    expect(l.breakageValue).toBe(27)
  })

  it('splits what was issued by who funded it', () => {
    const l = liability([], [
      mv({ id: 'a', points: 1000, funder: 'operator' }),
      mv({ id: 'b', points: 500, funder: 'partner' }),
      mv({ id: 'c', points: -200, funder: 'partner', type: 'reverse' }),
    ], programme)
    expect(l.byFunder).toEqual({ operator: 1000, partner: 500, shared: 0 })
  })
})

describe('costBySeller', () => {
  it('ranks sellers by what the programme costs them', () => {
    const rules = [rule({ id: 'ERN-09' }), rule({ id: 'ERN-06', scope_id: 'PTR-1002' })]
    const out = costBySeller([
      mv({ id: 'a', value: 12 }),
      mv({ id: 'b', seller_id: 'PTR-1002', rule_id: 'ERN-06', value: 30 }),
    ], rules)
    expect(out[0]).toMatchObject({ partner_id: 'PTR-1002', cost: 30 })
  })

  it('leaves the marketplace’s own spend out — it is not a seller', () => {
    expect(costBySeller([mv({ id: 'a', seller_id: null, funder: 'operator' })], [])).toEqual([])
  })
})

describe('pendingProposals', () => {
  it('puts the one that has waited longest first', () => {
    const out = pendingProposals([
      rule({ id: 'new', status: 'pending', proposed_by: 'A', proposed_on: '2026-07-26' }),
      rule({ id: 'old', status: 'pending', proposed_by: 'B', proposed_on: '2026-07-18' }),
      rule({ id: 'live' }),
    ])
    expect(out.map(r => r.id)).toEqual(['old', 'new'])
  })

  it('ignores a pending rule the marketplace wrote for itself', () => {
    expect(pendingProposals([rule({ id: 'a', status: 'pending' })])).toEqual([])
  })
})

describe('daysWaiting', () => {
  it('counts the days a seller has been waiting on an answer', () => {
    expect(daysWaiting(rule({ id: 'a', proposed_on: '2026-07-18' }), new Date('2026-07-31T00:00:00Z'))).toBe(13)
  })

  it('is null on a rule nobody proposed', () => {
    expect(daysWaiting(rule({ id: 'a' }), new Date())).toBeNull()
  })
})

describe('validateApproval', () => {
  const pending = rule({ id: 'a', status: 'pending', proposed_by: 'Rajesh', proposed_on: '2026-07-18' })

  it('accepts approving it as the seller proposed', () => {
    expect(validateApproval(pending, { funder: 'partner', split: null, note: 'Approved as proposed.' }))
      .toEqual({ ok: true })
  })

  it('lets the marketplace agree to pay part of it', () => {
    expect(validateApproval(pending, { funder: 'shared', split: 40, note: 'We will carry 40%.' }).ok).toBe(true)
  })

  it('refuses a shared split nobody can compute', () => {
    const v = validateApproval(pending, { funder: 'shared', split: null, note: 'ok' })
    expect(!v.ok && v.reason).toMatch(/between 1 and 99/)
  })

  it('refuses to reclassify a seller’s proposal as marketplace-funded', () => {
    /* That is a different rule, and pretending otherwise puts the marketplace's
       marketing budget behind something a seller wrote. */
    const v = validateApproval(pending, { funder: 'operator', split: null, note: 'ok' })
    expect(!v.ok && v.reason).toMatch(/different rule/)
  })

  it('requires a note, because a changed split is what gets disputed', () => {
    const v = validateApproval(pending, { funder: 'shared', split: 40, note: '  ' })
    expect(!v.ok && v.reason).toMatch(/cannot plan around/)
  })

  it('refuses to decide something that is not waiting on a decision', () => {
    expect(validateApproval(rule({ id: 'a' }), { funder: 'partner', split: null, note: 'x' }).ok).toBe(false)
  })
})

describe('validateRejection', () => {
  it('demands a real reason', () => {
    const v = validateRejection('no')
    expect(!v.ok && v.reason).toMatch(/comes back next quarter/)
  })

  it('accepts one', () => {
    expect(validateRejection('The rate overlaps the category accelerator already running.')).toEqual({ ok: true })
  })
})

describe('the funder vocabulary', () => {
  it('says where each kind of money comes out of', () => {
    expect(FUNDERS.operator.note).toMatch(/promotions budget/)
    expect(FUNDERS.partner.note).toMatch(/your next settlement/)
    expect(FUNDERS.shared.note).toMatch(/own half/)
  })
})

describe('newestFirst', () => {
  it('sorts a statement-formatted date properly, rather than as text', () => {
    /* "27 Jun 2026" sorted as a string puts June after July, which is what the
       ledger did before this existed. */
    const out = newestFirst([
      mv({ id: 'jun', when_date: '27 Jun 2026' }),
      mv({ id: 'jul', when_date: '23 Jul 2026' }),
      mv({ id: 'aug', when_date: '02 Aug 2026' }),
    ])
    expect(out.map(m => m.id)).toEqual(['aug', 'jul', 'jun'])
  })

  it('keeps a reversal next to the issue it undid when they share a day', () => {
    const out = newestFirst([
      mv({ id: 'issue', when_date: '02 Jul 2026' }),
      mv({ id: 'reverse', when_date: '02 Jul 2026', type: 'reverse' }),
    ])
    expect(out.map(m => m.id)).toEqual(['issue', 'reverse'])
  })

  it('does not throw on a date it cannot read', () => {
    expect(movementDate('sometime last year')).toBe(0)
    expect(newestFirst([mv({ id: 'a', when_date: 'nonsense' })])).toHaveLength(1)
  })
})
