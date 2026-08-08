import { describe, it, expect } from 'vitest'
import {
  OCCUPIES, capState, occupancy, barImpact, capImpact,
  barLine, reviewLine, returnsLine, capLine, shelfWarnings,
  levelOf, reachOf, ruleLine, matrixProblems, ruleCoverage, levelImpact,
  LEVEL_LABEL,
} from './shelfPolicy'
import type { CategoryRow, ListingRow, SellerRow, MatrixRow } from './shelfPolicy'
import type { CategoryPolicy, PolicyRuleRow } from './catalogue'

const pol = (over: Partial<CategoryPolicy> = {}): CategoryPolicy => ({
  category_id: 'security', review: 'Manual — every listing', auto_publish: false,
  returns_window: 'Contractual', sla_hours: 96, price_floor: false,
  min_rating: 4.0, allow_unrated: false, unrated_note: null,
  max_listings_per_seller: 6, open_to_buyers: true, closed_reason: null,
  note: null, updated_on: null, updated_by: null, ...over,
})

const cat: CategoryRow = {
  id: 'security', name: 'Security', audience: 'Enterprise',
  blurb: null, open_to_buyers: true, sort_order: 5,
}

const listing = (over: Partial<ListingRow>): ListingRow => ({
  id: 'p', category_id: 'security', partner_id: 'PTR-1003',
  status: 'live', price: 100, cost: 40, ...over,
})

const seller = (over: Partial<SellerRow>): SellerRow => ({
  id: 'PTR-1003', name: 'Sentinel Cyber', status: 'live', rating: 4.8, ...over,
})

const rule = (over: Partial<PolicyRuleRow>): PolicyRuleRow => ({
  id: 'PR-06', name: 'Security attestation', descr: '', check_by: 'doc',
  basis: 'Trust and safety', owner: 'Security', evidence: 'SOC 2 report',
  blocks: true, status: 'active', locked: null, sort_order: 6, ...over,
})

describe('what occupies a shelf', () => {
  /* Taking somebody's listing down and then counting it against their
     allowance bills them twice for one decision. */
  it('does not count a listing the marketplace suspended', () => {
    expect(OCCUPIES('live')).toBe(true)
    expect(OCCUPIES('pending')).toBe(true)
    expect(OCCUPIES('paused')).toBe(true)
    expect(OCCUPIES('suspended')).toBe(false)
    expect(OCCUPIES('retired')).toBe(false)
    expect(OCCUPIES('rejected')).toBe(false)
  })
})

describe('capState', () => {
  it('warns before the cap rather than at it, so a seller can plan', () => {
    expect(capState(4, 6)).toBe('ok')
    expect(capState(5, 6)).toBe('nearly')
    expect(capState(6, 6)).toBe('full')
    expect(capState(7, 6)).toBe('over')
  })

  it('is never anything but ok on an uncapped shelf', () => {
    expect(capState(900, null)).toBe('ok')
  })
})

describe('occupancy', () => {
  const listings = [
    listing({ id: '1', partner_id: 'PTR-1003' }),
    listing({ id: '2', partner_id: 'PTR-1003' }),
    listing({ id: '3', partner_id: 'PTR-1003' }),
    listing({ id: '4', partner_id: 'PTR-1003' }),
    listing({ id: '5', partner_id: 'PTR-1010' }),
    listing({ id: '6', partner_id: 'PTR-1015', status: 'suspended' }),
    listing({ id: '7', partner_id: null }),
    listing({ id: '8', partner_id: 'PTR-1003', category_id: 'device' }),
  ]
  const sellers = [seller({}), seller({ id: 'PTR-1010', name: 'ClearVault Cloud', rating: 4.4 })]

  it('counts each supplier on that shelf only, fullest first', () => {
    const o = occupancy(listings, sellers, 'security', pol())
    expect(o.map(x => [x.seller, x.held])).toEqual([
      ['Sentinel Cyber', 4], ['ClearVault Cloud', 1], ['The marketplace', 1],
    ])
  })

  it('leaves a suspended seller off it entirely', () => {
    expect(occupancy(listings, sellers, 'security', pol()).some(o => o.seller_id === 'PTR-1015'))
      .toBe(false)
  })

  it('names the marketplace as a supplier on its own shelf, because it is one', () => {
    expect(occupancy(listings, sellers, 'security', pol()).find(o => o.seller_id === null)?.seller)
      .toBe('The marketplace')
  })

  /* A full bar against no cap is a lie the eye reads before the label. */
  it('reports no percentage at all on an uncapped shelf', () => {
    const o = occupancy(listings, sellers, 'security', pol({ max_listings_per_seller: null }))
    expect(o[0].pct).toBeNull()
    expect(o[0].state).toBe('ok')
  })
})

describe('barImpact', () => {
  const sellers = [
    seller({ id: 'A', name: 'Above', rating: 4.6 }),
    seller({ id: 'B', name: 'Below', rating: 3.2 }),
    seller({ id: 'C', name: 'Unrated', rating: null }),
    seller({ id: 'D', name: 'Elsewhere', rating: 1.0 }),
  ]
  const listings = [
    listing({ id: '1', partner_id: 'A' }), listing({ id: '2', partner_id: 'B' }),
    listing({ id: '3', partner_id: 'B' }), listing({ id: '4', partner_id: 'C' }),
    listing({ id: '5', partner_id: 'D', category_id: 'device' }),
  ]

  /* "Set the bar to 4.0" and "remove Below and its two listings" are the same
     act, and only one of them is what the person clicking believes. */
  it('names who would go, and how many listings with them', () => {
    const r = barImpact(sellers, listings, 'security', 4.0, true)
    expect(r.excluded.map(s => s.name)).toEqual(['Below'])
    expect(r.listings).toBe(2)
  })

  it('counts the unrated only where the shelf refuses them', () => {
    expect(barImpact(sellers, listings, 'security', 4.0, true).unratedAffected).toEqual([])
    const r = barImpact(sellers, listings, 'security', 4.0, false)
    expect(r.unratedAffected.map(s => s.name)).toEqual(['Unrated'])
    expect(r.listings).toBe(3)
  })

  it('never counts a seller who is not on that shelf', () => {
    expect(barImpact(sellers, listings, 'security', 4.0, false).excluded.map(s => s.name))
      .not.toContain('Elsewhere')
  })

  it('excludes nobody where there is no bar', () => {
    const r = barImpact(sellers, listings, 'security', null, true)
    expect(r.excluded).toEqual([])
    expect(r.listings).toBe(0)
  })
})

describe('capImpact', () => {
  it('says who a proposed cap would already put over, and by how much', () => {
    const listings = Array.from({ length: 5 }, (_, i) => listing({ id: `p${i}` }))
    expect(capImpact(listings, [seller({})], 'security', 3))
      .toEqual([{ seller: 'Sentinel Cyber', held: 5, over: 2 }])
    expect(capImpact(listings, [seller({})], 'security', 6)).toEqual([])
  })
})

describe('the sentences', () => {
  it('says what a bar does about a seller nobody has rated', () => {
    expect(barLine(pol({ min_rating: 4.0, allow_unrated: false }))).toMatch(/is refused/)
    expect(barLine(pol({ min_rating: 4.0, allow_unrated: true })))
      .toMatch(/not below the bar, they are not on it/)
  })

  it('does not pretend an absent bar is a bar of zero', () => {
    expect(barLine(pol({ min_rating: null }))).toMatch(/No rating bar/)
  })

  it('distinguishes no returns from contractual returns from a window', () => {
    expect(returnsLine(pol({ returns_window: 'Not applicable' }))).toMatch(/nothing on this shelf is returnable/)
    expect(returnsLine(pol({ returns_window: 'Contractual' }))).toMatch(/each agreement sets its own/)
    expect(returnsLine(pol({ returns_window: '14 days' }))).toMatch(/within 14 days/)
  })

  it('says whether a listing waits for a person', () => {
    expect(reviewLine(pol({ auto_publish: false }))).toMatch(/waits for a person/)
    expect(reviewLine(pol({ auto_publish: true }))).toMatch(/without waiting/)
    expect(reviewLine(pol())).toMatch(/96 hours/)
  })

  it('does not describe an uncapped shelf as capped', () => {
    expect(capLine(pol({ max_listings_per_seller: null }))).toMatch(/No limit/)
    expect(capLine(pol({ max_listings_per_seller: 6 }))).toMatch(/up to 6 listings/)
  })
})

describe('shelfWarnings', () => {
  const sellers = [seller({ id: 'A', name: 'A', rating: 4.9 })]
  const listings = [listing({ id: '1', partner_id: 'A' })]

  it('catches a shelf closed for no recorded reason', () => {
    const w = shelfWarnings(pol({ open_to_buyers: false, closed_reason: null }),
                            { ...cat, open_to_buyers: false }, listings, sellers)
    expect(w.some(x => /no reason is recorded/.test(x))).toBe(true)
  })

  it('is quiet when the closure says why', () => {
    const w = shelfWarnings(pol({ open_to_buyers: false, closed_reason: 'Regulator review' }),
                            { ...cat, open_to_buyers: false }, listings, sellers)
    expect(w.some(x => /no reason is recorded/.test(x))).toBe(false)
  })

  /* Two fields, each defensible, that cannot both be true of one listing. */
  it('catches auto-publish on a shelf that reviews every listing by hand', () => {
    const w = shelfWarnings(pol({ auto_publish: true }), cat, listings, sellers)
    expect(w.some(x => /One of those is not happening/.test(x))).toBe(true)
  })

  it('catches a bar so low that nothing has ever been near it', () => {
    const w = shelfWarnings(pol({ min_rating: 3.0 }), cat, listings, sellers)
    expect(w.some(x => /never decided anything/.test(x))).toBe(true)
  })

  /* The guard refuses the next listing. It cannot do anything about the ones
     already sitting above a cap that was lowered underneath them. */
  it('catches a cap set below where the shelf already is', () => {
    const many = Array.from({ length: 8 }, (_, i) => listing({ id: `p${i}`, partner_id: 'A' }))
    const w = shelfWarnings(pol({ max_listings_per_seller: 6 }), cat, many, sellers)
    expect(w.some(x => /above the cap of 6/.test(x))).toBe(true)
    expect(w.some(x => /does nothing about the ones already there/.test(x))).toBe(true)
  })

  it('says when a shelf allows a listing below cost, without calling it wrong', () => {
    const w = shelfWarnings(pol({ price_floor: false }), cat, listings, sellers)
    expect(w.some(x => /Deliberate on a shelf sold at a loss/.test(x))).toBe(true)
  })
})

describe('the rule book', () => {
  const rules = [
    rule({ id: 'PR-03', name: 'Price floor', check_by: 'auto', blocks: true, status: 'active' }),
    rule({ id: 'PR-06', name: 'Security attestation', check_by: 'doc', blocks: true, status: 'active' }),
    rule({ id: 'PR-11', name: 'Accessibility statement', check_by: 'doc', blocks: false, status: 'draft' }),
  ]
  const cats: CategoryRow[] = [cat, { ...cat, id: 'device', name: 'Devices' }]

  it('treats an absent matrix row as off rather than as a gap', () => {
    expect(levelOf([], 'security', 'PR-03')).toBe('off')
    expect(levelOf([{ category_id: 'security', rule_id: 'PR-03', level: 'warn' }], 'security', 'PR-03'))
      .toBe('warn')
  })

  it('says where a rule reaches, split by how hard', () => {
    const m: MatrixRow[] = [
      { category_id: 'security', rule_id: 'PR-06', level: 'enforce' },
      { category_id: 'device', rule_id: 'PR-06', level: 'warn' },
    ]
    expect(reachOf(m, 'PR-06')).toEqual({ enforced: ['security'], warned: ['device'] })
  })

  it('describes a rule in the terms its owner would use', () => {
    const s = ruleLine(rules[1])
    expect(s).toMatch(/Checked against a document — SOC 2 report/)
    expect(s).toMatch(/owned by Security/)
    expect(s).toMatch(/cannot go live/)
    expect(ruleLine(rule({ blocks: false }))).toMatch(/does not block/)
    expect(ruleLine(rule({ check_by: 'extern' }))).toMatch(/external service/)
  })

  describe('matrixProblems', () => {
    /* Listings being refused under a policy nobody has agreed. */
    it('catches a rule enforced before it is published', () => {
      const m: MatrixRow[] = [
        { category_id: 'security', rule_id: 'PR-11', level: 'enforce' },
        { category_id: 'security', rule_id: 'PR-03', level: 'enforce' },
        { category_id: 'device', rule_id: 'PR-03', level: 'enforce' },
        { category_id: 'security', rule_id: 'PR-06', level: 'enforce' },
      ]
      expect(matrixProblems(rules, m, cats).some(p => /has not been published/.test(p))).toBe(true)
    })

    /* Somebody wrote it, everybody assumes it runs, it does not. */
    it('catches a published rule applied to nothing', () => {
      const m: MatrixRow[] = [
        { category_id: 'security', rule_id: 'PR-03', level: 'enforce' },
        { category_id: 'device', rule_id: 'PR-03', level: 'enforce' },
      ]
      expect(matrixProblems(rules, m, cats).some(p => /enforces nothing/.test(p))).toBe(true)
    })

    it('catches a blocking rule that only ever warns', () => {
      const m: MatrixRow[] = [
        { category_id: 'security', rule_id: 'PR-06', level: 'warn' },
        { category_id: 'security', rule_id: 'PR-03', level: 'enforce' },
        { category_id: 'device', rule_id: 'PR-03', level: 'enforce' },
      ]
      expect(matrixProblems(rules, m, cats).some(p => /only warns, on every shelf/.test(p))).toBe(true)
    })

    it('catches a shelf that can refuse nothing at all', () => {
      const m: MatrixRow[] = [
        { category_id: 'security', rule_id: 'PR-03', level: 'enforce' },
        { category_id: 'security', rule_id: 'PR-06', level: 'enforce' },
      ]
      expect(matrixProblems(rules, m, cats).some(p => /Devices enforces no rule/.test(p))).toBe(true)
    })

    it('is quiet about a rule book that hangs together', () => {
      const m: MatrixRow[] = [
        { category_id: 'security', rule_id: 'PR-03', level: 'enforce' },
        { category_id: 'security', rule_id: 'PR-06', level: 'enforce' },
        { category_id: 'device', rule_id: 'PR-03', level: 'enforce' },
        { category_id: 'device', rule_id: 'PR-06', level: 'warn' },
      ]
      expect(matrixProblems(rules, m, cats)).toEqual([])
    })
  })

  it('counts coverage against the published rules only', () => {
    const m: MatrixRow[] = [
      { category_id: 'security', rule_id: 'PR-03', level: 'enforce' },
      { category_id: 'security', rule_id: 'PR-06', level: 'warn' },
    ]
    expect(ruleCoverage(rules, m, 'security')).toEqual({ applicable: 2, enforced: 1, warned: 1, off: 0 })
  })

  describe('levelImpact', () => {
    it('counts what a price floor would refuse, because it can', () => {
      const listings = [
        listing({ id: '1', price: 10, cost: 40 }),
        listing({ id: '2', price: 100, cost: 40 }),
      ]
      expect(levelImpact(rules[0], pol({ price_floor: true }), listings, 'security'))
        .toEqual({ known: true, failing: 1 })
    })

    /* A confident zero on a rule a person checks is worse than saying nobody
       knows. */
    it('refuses to guess for a rule a person or a document decides', () => {
      const r = levelImpact(rules[1], pol(), [], 'security')
      expect(r.known).toBe(false)
      if (!r.known) expect(r.why).toMatch(/not something this screen can work out/)
    })
  })
})

describe('LEVEL_LABEL', () => {
  it('says what each level does rather than naming it', () => {
    expect(LEVEL_LABEL.off).toBe('Not applied')
    expect(LEVEL_LABEL.warn).toMatch(/reviewer/)
    expect(LEVEL_LABEL.enforce).toMatch(/Blocks/)
  })
})
