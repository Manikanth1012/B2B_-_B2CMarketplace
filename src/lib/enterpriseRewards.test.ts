import { describe, it, expect } from 'vitest'
import {
  pointsWorth, tiersFor, tierOf, tierProgress, qualifiesFor, movementDate, newestFirst,
  balanceOf, summarise, byRule, byVertical, optionsFor, canAfford, canPropose, canRelease,
  validateProposal, validateRelease, releaseImpact, waiting, settled, committedPoints,
  availablePoints, fmtPoints, ladderForMember, topRetailRung, pointsFor, returnRate,
  FUNDER_LABEL,
} from './enterpriseRewards'
import type {
  Tier, RewardMember, Movement, RewardRule, RedeemOption, RewardPolicy, Redemption,
  PointRate, Threshold, Fmt,
} from './enterpriseRewards'

const TIERS: Tier[] = [
  { id: 'bronze', name: 'Bronze', sort_order: 1, qualify_spend: 0, multiplier: 1, colour: null, benefits: [], note: null, kind: 'consumer' },
  { id: 'gold', name: 'Gold', sort_order: 3, qualify_spend: 1800, multiplier: 1.5, colour: null, benefits: [], note: null, kind: 'consumer' },
  { id: 'org-bronze', name: 'Registered', sort_order: 1, qualify_spend: 0, multiplier: 1, colour: null, benefits: [], note: null, kind: 'enterprise' },
  { id: 'org-silver', name: 'Business', sort_order: 2, qualify_spend: 12000, multiplier: 1.25, colour: null, benefits: [], note: null, kind: 'enterprise' },
  { id: 'org-gold', name: 'Business Plus', sort_order: 3, qualify_spend: 35000, multiplier: 1.5, colour: null, benefits: [], note: null, kind: 'enterprise' },
  { id: 'org-platinum', name: 'Strategic', sort_order: 4, qualify_spend: 100000, multiplier: 2, colour: null, benefits: [], note: null, kind: 'enterprise' },
]

/* The business ladder as it is set in rupees, and the retail one, so a
   currency-scoped read can be told apart from an unscoped one. */
const THRESHOLDS: Threshold[] = [
  { tier_id: 'org-bronze', currency: 'INR', qualify_spend: 0 },
  { tier_id: 'org-silver', currency: 'INR', qualify_spend: 1_000_000 },
  { tier_id: 'org-gold', currency: 'INR', qualify_spend: 3_000_000 },
  { tier_id: 'org-platinum', currency: 'INR', qualify_spend: 8_500_000 },
  { tier_id: 'bronze', currency: 'INR', qualify_spend: 0 },
  { tier_id: 'gold', currency: 'INR', qualify_spend: 150_000 },
]

const USD: PointRate = { currency: 'USD', earn_per_unit: 1, per_unit: 100 }
const INR: PointRate = { currency: 'INR', earn_per_unit: 0.01, per_unit: 1 }

/* The formatters a screen would pass in. Deliberately not `money.ts`'s
   `format` — these rules do not care how the mark is drawn, only that they were
   handed one and used it. */
const usd: Fmt = n => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const inr: Fmt = n => `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function member(over: Partial<RewardMember> = {}): RewardMember {
  return {
    id: 'LM-4104', account_id: 'ENT-2007', name: 'SmartBuild Ltd', kind: 'enterprise',
    currency: 'USD',
    tier: 'org-gold', balance: 86630, joined: '12 Aug 2025', qualify_12m: 78412,
    lifetime_earned: 101630, lifetime_redeemed: 15000, expiring_soon: 0, expiring_on: null,
    last_activity: '29 Jul 2026', ...over,
  }
}

function mv(over: Partial<Movement> = {}): Movement {
  return {
    id: 'LTX-1', member: 'LM-4104', when_date: '29 Jul 2026', type: 'earn', points: 1000,
    ref: 'INV-2026-0779', rule_id: 'ERN-01', funder: 'operator', seller_id: null,
    value: 10, currency: 'USD', note: null, ...over,
  }
}

function rule(over: Partial<RewardRule> = {}): RewardRule {
  return {
    id: 'ERN-01', name: 'Base earn — everything', scope: 'all', scope_id: null, rate: 1,
    funder: 'operator', status: 'active', audience: 'all', cap_per_order: null,
    cap_per_month: null, first_only: false, why: null, from: '01 Mar 2024', ...over,
  }
}

function option(over: Partial<RedeemOption> = {}): RedeemOption {
  return {
    id: 'RDM-02', name: 'Credit on the next bill', kind: 'bill', min: 500, step: 100,
    value_per: 0.01, cost: 'operator', audience: 'all', status: 'active',
    description: null, why: null, ...over,
  }
}

const POLICY: RewardPolicy = {
  account_id: 'ENT-2007', min_redeem: 5000,
  propose_roles: ['buyer', 'procurement-lead', 'it-approver'],
  release_roles: ['procurement-lead', 'finance-approver'],
  auto_apply: true, allocate_to_cost_centre: true, default_cost_centre: 'CC-1000',
  note: '', updated_by: null, updated_on: null,
}

const SOLO: RewardPolicy = { ...POLICY, release_roles: ['procurement-lead'] }

function redemption(over: Partial<Redemption> = {}): Redemption {
  return {
    id: 'RDX-1101', account_id: 'ENT-2007', member_id: 'LM-4104', option_id: 'RDM-02',
    points: 20000, value: 200, currency: 'USD', cost_centre: 'CC-1000', reason: 'Against the July invoice.',
    state: 'proposed', proposed_by: 'EU-2007-04', proposed_on: '2026-07-30',
    released_by: null, released_on: null, decision_note: null, applied_to: null,
    applied_on: null, ledger_ref: null, sort_order: 1, ...over,
  }
}

/* ----------------------------------------------------------------- tiers -- */

describe('the two ladders', () => {
  it('keeps organisations off the consumer ladder', () => {
    expect(tiersFor(TIERS, 'enterprise').map(t => t.id)).toEqual(['org-bronze', 'org-silver', 'org-gold', 'org-platinum'])
    expect(tiersFor(TIERS, 'consumer').map(t => t.id)).toEqual(['bronze', 'gold'])
  })

  it('qualifies a company on business thresholds, not a person\'s', () => {
    /* $78,412 would be several times top tier on the consumer ladder. */
    expect(qualifiesFor(78412, tiersFor(TIERS, 'enterprise'))!.id).toBe('org-gold')
    expect(qualifiesFor(78412, tiersFor(TIERS, 'consumer'))!.id).toBe('gold')
  })

  it('puts a brand-new account at the bottom rather than nowhere', () => {
    expect(qualifiesFor(0, tiersFor(TIERS, 'enterprise'))!.id).toBe('org-bronze')
  })
})

describe('the ladder in the account\'s own currency', () => {
  const indian = member({ currency: 'INR', tier: 'org-gold', qualify_12m: 6_854_777 })

  it('carries the rupee thresholds rather than the dollar ones', () => {
    expect(ladderForMember(TIERS, THRESHOLDS, indian).map(t => t.qualify_spend))
      .toEqual([0, 1_000_000, 3_000_000, 8_500_000])
  })

  it('does not put a Business Plus account at the top of the ladder', () => {
    /* The bug this exists to prevent: ₹6,854,777 is past every dollar rung,
       including $100,000, so an unscoped ladder reports "nothing above". */
    const wrong = tierProgress(indian, tiersFor(TIERS, 'enterprise'))
    expect(wrong.top).toBe(true)

    const right = tierProgress(indian, ladderForMember(TIERS, THRESHOLDS, indian))
    expect(right.top).toBe(false)
    expect(right.next!.id).toBe('org-platinum')
    expect(right.need).toBe(1_645_223)
  })

  it('keeps a rung that has no threshold in this currency rather than zeroing it', () => {
    /* Zero would read as "already qualified" and quietly promote somebody. */
    const kenyan = member({ currency: 'KES' })
    expect(ladderForMember(TIERS, THRESHOLDS, kenyan).map(t => t.qualify_spend))
      .toEqual([0, 12000, 35000, 100000])
  })

  it('names the retail top rung in the reader\'s money, so the subtitle is not a dollar figure', () => {
    expect(topRetailRung(TIERS, THRESHOLDS, 'INR')).toBe(150_000)
    expect(topRetailRung(TIERS, THRESHOLDS, 'USD')).toBe(1800)
  })
})

describe('tierProgress', () => {
  const ladder = tiersFor(TIERS, 'enterprise')

  it('measures the gap from the current tier, not from zero', () => {
    const p = tierProgress(member(), ladder)
    expect(p.current!.id).toBe('org-gold')
    expect(p.next!.id).toBe('org-platinum')
    expect(p.need).toBe(21588)
    /* 78,412 of the way from 35,000 to 100,000 */
    expect(p.pct).toBe(66.8)
  })

  it('says plainly when there is nothing above', () => {
    const p = tierProgress(member({ tier: 'org-platinum', qualify_12m: 140000 }), ladder)
    expect(p.top).toBe(true)
    expect(p.next).toBeNull()
    expect(p.pct).toBe(100)
  })

  it('never reports negative progress for an account holding a tier it has dropped below', () => {
    const p = tierProgress(member({ tier: 'org-gold', qualify_12m: 20000 }), ladder)
    expect(p.pct).toBe(0)
    expect(p.next!.id).toBe('org-gold')
  })
})

/* ------------------------------------------------------------ movements -- */

describe('movementDate', () => {
  it('sorts by the date rather than the text, so June does not follow July', () => {
    const log = [mv({ id: 'jun', when_date: '20 Jun 2026' }), mv({ id: 'jul', when_date: '01 Jul 2026' })]
    expect(newestFirst(log).map(m => m.id)).toEqual(['jul', 'jun'])
  })

  it('reads the four-letter month Intl produces for September', () => {
    expect(movementDate('30 Sept 2026')).toBe(Date.UTC(2026, 8, 30))
  })

  it('gives anything unparseable a stable place rather than NaN', () => {
    expect(movementDate('whenever')).toBe(0)
  })
})

describe('summarise', () => {
  const log = [
    mv({ id: 'a', type: 'earn', points: 60000 }),
    mv({ id: 'b', type: 'earn', points: 41630 }),
    mv({ id: 'c', type: 'redeem', points: -15000 }),
  ]

  it('shows what the balance is made of rather than just the number', () => {
    const s = summarise(log, USD)
    expect(s.balance).toBe(86630)
    expect(s.earned).toBe(101630)
    expect(s.redeemed).toBe(15000)
    expect(s.value).toBe(866.3)
  })

  it('values the same balance in the account\'s own money, not always the dollar', () => {
    /* The whole point: 86,630 points is $866.30 to an American account and
       ₹86,630 to an Indian one. It used to be $866.30 to both. */
    expect(summarise(log, INR).value).toBe(86630)
  })

  it('counts an expiry and a reversal as points lost, not gained', () => {
    const s = summarise([...log, mv({ id: 'd', type: 'expire', points: -500 }), mv({ id: 'e', type: 'reverse', points: -200 })])
    expect(s.expired).toBe(500)
    expect(s.reversed).toBe(200)
    expect(s.balance).toBe(85930)
  })
})

describe('byRule', () => {
  const rules = [rule(), rule({ id: 'ERN-20', name: 'Managed security', funder: 'shared', scope: 'vertical', scope_id: 'security' })]

  it('ranks the rules that actually paid and attributes the funder', () => {
    const out = byRule([
      mv({ rule_id: 'ERN-01', points: 1000 }),
      mv({ rule_id: 'ERN-20', points: 4000 }),
      mv({ rule_id: 'ERN-20', points: 1000 }),
    ], rules)
    expect(out.map(r => r.id)).toEqual(['ERN-20', 'ERN-01'])
    expect(out[0].count).toBe(2)
    expect(out[0].funder).toBe('shared')
    /* The movements' own worth added up, not the points put back through a
       rate. Recomputing means last year's earn is restated the day the
       marketplace reprices a point. */
    expect(out[0].value).toBe(20)
  })

  it('ignores redemptions, which no rule earned', () => {
    expect(byRule([mv({ type: 'redeem', points: -5000, rule_id: null })], rules)).toEqual([])
  })
})

describe('byVertical', () => {
  it('shows whether the programme rewards what the company actually buys', () => {
    const rules = [
      rule(),
      rule({ id: 'ERN-20', scope: 'vertical', scope_id: 'security' }),
      rule({ id: 'ERN-04', scope: 'vertical', scope_id: 'iot' }),
    ]
    const out = byVertical([
      mv({ rule_id: 'ERN-20', points: 26618 }),
      mv({ rule_id: 'ERN-04', points: 7790 }),
      mv({ rule_id: 'ERN-01', points: 58097 }),
    ], rules)
    expect(out.map(r => r.vertical)).toEqual(['everything', 'security', 'iot'])
  })
})

/* --------------------------------------------------------- redemptions --- */

describe('optionsFor', () => {
  const options = [
    option({ id: 'RDM-01', audience: 'consumer', min: 100 }),
    option({ id: 'RDM-02', audience: 'all', min: 500 }),
    option({ id: 'RDM-09', audience: 'enterprise', min: 5000 }),
    option({ id: 'RDM-08', audience: 'all', status: 'retired' }),
  ]

  it('does not offer a company something built for a person', () => {
    expect(optionsFor(options, member()).map(o => o.id)).toEqual(['RDM-02', 'RDM-09'])
  })

  it('leaves out anything retired', () => {
    expect(optionsFor(options, member()).some(o => o.status === 'retired')).toBe(false)
  })

  it('offers the cheapest first, so the affordable ones lead', () => {
    expect(optionsFor(options, member())[0].min).toBe(500)
  })
})

describe('canAfford', () => {
  it('compares against the balance, not the tier', () => {
    expect(canAfford(option({ min: 5000 }), member({ balance: 4999 }))).toBe(false)
    expect(canAfford(option({ min: 5000 }), member({ balance: 5000 }))).toBe(true)
  })
})

describe('canPropose', () => {
  it('lets a buyer put one forward', () => {
    expect(canPropose('buyer', POLICY).ok).toBe(true)
  })

  it('refuses a role the policy does not name, readably', () => {
    const c = canPropose('finance-approver', POLICY)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/finance approver cannot propose/)
  })
})

describe('canRelease', () => {
  it('lets the procurement lead release somebody else\'s', () => {
    expect(canRelease(redemption(), 'procurement-lead', 'EU-2007-01', POLICY).ok).toBe(true)
  })

  it('refuses releasing your own where more than one role can', () => {
    const c = canRelease(redemption({ proposed_by: 'EU-2007-01' }), 'procurement-lead', 'EU-2007-01', POLICY)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/company money too/)
  })

  it('allows it where the account genuinely has only one releaser', () => {
    /* Refusing here would mean the points can never be spent at all. */
    expect(canRelease(redemption({ proposed_by: 'EU-2007-01' }), 'procurement-lead', 'EU-2007-01', SOLO).ok).toBe(true)
  })

  it('refuses a role that cannot release at all', () => {
    const c = canRelease(redemption(), 'buyer', 'EU-2007-09', POLICY)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/buyer cannot release/)
  })

  it('refuses to re-decide something settled', () => {
    const c = canRelease(redemption({ state: 'applied' }), 'procurement-lead', 'EU-2007-01', POLICY)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/already applied/)
  })
})

describe('validateProposal', () => {
  const draft = { option: option(), points: 20000, reason: 'Against the July invoice', costCentre: 'CC-1000' }

  it('accepts a well-formed proposal', () => {
    expect(validateProposal(draft, member(), POLICY, USD, usd).ok).toBe(true)
  })

  it('refuses more points than the account holds', () => {
    const c = validateProposal({ ...draft, points: 999999 }, member(), POLICY, USD, usd)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/more than the 86,630 points/)
  })

  it('holds the account to its own floor, and says what it is worth', () => {
    const c = validateProposal({ ...draft, points: 1000 }, member(), POLICY, USD, usd)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/minimum on this account is 5,000 points — worth \$50.00/)
  })

  it('says what it is worth in the account\'s own money', () => {
    /* 5,000 points is $50 to an American account and ₹5,000 to an Indian one.
       The refusal used to say "$50.00" to both. */
    const c = validateProposal({ ...draft, points: 1000 }, member({ currency: 'INR' }), POLICY, INR, inr)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/worth ₹5,000.00/)
  })

  it('respects the step the option is sold in', () => {
    const c = validateProposal({ ...draft, points: 20050 }, member(), POLICY, USD, usd)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/steps of 100 points/)
  })

  it('insists on a reason, because somebody else signs it', () => {
    const c = validateProposal({ ...draft, reason: '  ' }, member(), POLICY, USD, usd)
    expect(c.ok).toBe(false)
    if (!c.ok) expect(c.reason).toMatch(/company money on your say-so/)
  })

  it('insists on a cost centre only where the account allocates', () => {
    expect(validateProposal({ ...draft, costCentre: null }, member(), POLICY, USD, usd).ok).toBe(false)
    expect(validateProposal({ ...draft, costCentre: null }, member(), { ...POLICY, allocate_to_cost_centre: false }, USD, usd).ok).toBe(true)
  })
})

describe('validateRelease', () => {
  it('insists on a reason for a decline', () => {
    expect(validateRelease(false, '').ok).toBe(false)
  })

  it('does not for a release', () => {
    expect(validateRelease(true, '').ok).toBe(true)
  })
})

describe('releaseImpact', () => {
  it('states the balance afterwards and where the credit lands', () => {
    const out = releaseImpact(redemption(), member(), option(), POLICY, usd)
    expect(out[0]).toMatch(/20,000 points leave the balance, worth \$200.00/)
    expect(out[1]).toMatch(/66,630 points left/)
    expect(out.some(s => /automatically/.test(s))).toBe(true)
  })

  it('states it in the money the redemption is actually in', () => {
    const r = redemption({ currency: 'INR', value: 20000 })
    const out = releaseImpact(r, member({ currency: 'INR' }), option(), POLICY, inr)
    expect(out[0]).toMatch(/worth ₹20,000.00/)
  })

  it('says so when it has to be applied by hand', () => {
    const out = releaseImpact(redemption(), member(), option(), { ...POLICY, auto_apply: false }, usd)
    expect(out.some(s => /by hand/.test(s))).toBe(true)
  })
})

describe('what is already spoken for', () => {
  const list = [
    redemption({ id: 'a', points: 20000 }),
    redemption({ id: 'b', points: 8000 }),
    redemption({ id: 'c', points: 15000, state: 'applied', released_by: 'EU-2007-02', released_on: '2026-06-25' }),
  ]

  it('queues what is waiting, oldest first', () => {
    expect(waiting(list).map(r => r.id)).toEqual(['a', 'b'])
  })

  it('shows settled ones newest first', () => {
    expect(settled(list).map(r => r.id)).toEqual(['c'])
  })

  it('does not let two people spend the same points', () => {
    expect(committedPoints(list)).toBe(28000)
    expect(availablePoints(member(), list)).toBe(58630)
  })
})

/* --------------------------------------------------------------- helpers -- */

describe('formatting', () => {
  it('groups points and names the unit, because a bare number means nothing', () => {
    expect(fmtPoints(86630)).toBe('86,630 points')
  })

  it('turns points into money at the rate for the account\'s own currency', () => {
    expect(pointsWorth(86630, USD)).toBe(866.3)
    expect(pointsWorth(86630, INR)).toBe(86630)
  })

  it('is worth nothing rather than worth somebody else\'s number when unpriced', () => {
    expect(pointsWorth(86630, null)).toBe(0)
  })

  it('gives every currency the same return, which is the check that a local rate is still one', () => {
    /* Self-consistency proves nothing here — each rate agrees with itself by
       construction. What matters is that a dirham and a rupee buy back the same
       proportion of what was spent. */
    expect(returnRate(USD)).toBeCloseTo(1, 10)
    expect(returnRate(INR)).toBeCloseTo(1, 10)
  })

  it('earns points on spend at the rung\'s multiplier, in the local denomination', () => {
    /* ₹14,000 at 1.5× Gold is 210 points — the figure on Priya's ledger. */
    expect(pointsFor(14000, INR, 1.5)).toBe(210)
    /* The same 1.5× on $140 of dollar spend is the same 210. */
    expect(pointsFor(140, USD, 1.5)).toBe(210)
  })

  it('names who is paying in words rather than a code', () => {
    expect(FUNDER_LABEL.shared).toBe('the marketplace and the seller')
  })
})
