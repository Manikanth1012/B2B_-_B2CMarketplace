import { describe, it, expect } from 'vitest'
import {
  matchesSearch, applyFilters, sortRows, paginate, byStatus, byTier, byCategory,
  categoryReadiness, EMPTY_FILTERS, EVIDENCE_MEANING,
  type DirectoryRow, type Tier, type CategoryEvidence, type EvidenceState,
} from './partnerDirectory'

const row = (o: Partial<DirectoryRow> & { id: string; name: string }): DirectoryRow => ({
  type: 'IoT hardware', country: 'India', status: 'live', tier_id: 'silver',
  categories: ['iot'], planName: 'IoT — hardware + connectivity', listings: 3, liveListings: 3,
  contact: 'Katrin Boehm', email: 'k.boehm@nimbussensors.com',
  currentGate: null, clearedGates: 7, totalGates: 7, ...o,
})

const TIERS: Tier[] = [
  { id: 'bronze', name: 'Bronze', rank: 1, qualify_gross: 0, benefits: [], rate_relief: 0, colour: '#8C6239', sort_order: 1 },
  { id: 'silver', name: 'Silver', rank: 2, qualify_gross: 120000, benefits: [], rate_relief: 0.5, colour: '#8A8D93', sort_order: 2 },
  { id: 'gold', name: 'Gold', rank: 3, qualify_gross: 400000, benefits: [], rate_relief: 1, colour: '#C8952B', sort_order: 3 },
  { id: 'platinum', name: 'Platinum', rank: 4, qualify_gross: 1000000, benefits: [], rate_relief: 1.5, colour: '#455A64', sort_order: 4 },
]

const CATEGORIES = [
  { id: 'consumer', name: 'Consumer', sort_order: 1 },
  { id: 'iot', name: 'IoT', sort_order: 3 },
  { id: 'device', name: 'Devices', sort_order: 5 },
]

describe('matchesSearch', () => {
  const r = row({ id: 'PTR-1004', name: 'Nimbus Sensors' })

  it('matches on name, id, type, country and contact', () => {
    expect(matchesSearch(r, 'nimbus')).toBe(true)
    expect(matchesSearch(r, '1004')).toBe(true)
    expect(matchesSearch(r, 'iot hardware')).toBe(true)
    expect(matchesSearch(r, 'india')).toBe(true)
    expect(matchesSearch(r, 'boehm')).toBe(true)
  })

  it('is case and whitespace insensitive', () => {
    expect(matchesSearch(r, '  NIMBUS  ')).toBe(true)
  })

  it('matches everything on an empty query', () => {
    expect(matchesSearch(r, '')).toBe(true)
  })

  /* The category has its own filter. Folding it into free text would make
     "device" match sellers the category chip excludes. */
  it('does not match on category', () => {
    expect(matchesSearch(row({ id: 'X', name: 'X', categories: ['device'] }), 'device')).toBe(false)
  })
})

describe('applyFilters', () => {
  const rows = [
    row({ id: 'A', name: 'Alpha', status: 'live', tier_id: 'gold', categories: ['iot'] }),
    row({ id: 'B', name: 'Beta', status: 'suspended', tier_id: 'silver', categories: ['device', 'iot'] }),
    row({ id: 'C', name: 'Gamma', status: 'onboarding', tier_id: 'bronze', categories: ['consumer'] }),
  ]

  it('returns everything with no filters set', () => {
    expect(applyFilters(rows, EMPTY_FILTERS)).toHaveLength(3)
  })

  it('filters by status', () => {
    expect(applyFilters(rows, { ...EMPTY_FILTERS, statuses: ['live', 'suspended'] }).map(r => r.id)).toEqual(['A', 'B'])
  })

  it('filters by tier', () => {
    expect(applyFilters(rows, { ...EMPTY_FILTERS, tiers: ['bronze'] }).map(r => r.id)).toEqual(['C'])
  })

  /* Any, not all — picking two categories must widen the result, not empty it. */
  it('matches a seller who sells in any of the chosen categories', () => {
    expect(applyFilters(rows, { ...EMPTY_FILTERS, categories: ['iot', 'consumer'] }).map(r => r.id))
      .toEqual(['A', 'B', 'C'])
  })

  it('combines filters as an intersection', () => {
    expect(applyFilters(rows, { ...EMPTY_FILTERS, statuses: ['live'], categories: ['iot'] }).map(r => r.id))
      .toEqual(['A'])
  })

  it('returns nothing rather than everything when nothing matches', () => {
    expect(applyFilters(rows, { ...EMPTY_FILTERS, search: 'zzz' })).toEqual([])
  })
})

describe('sortRows', () => {
  const rows = [
    row({ id: 'A', name: 'Zeta', status: 'live', tier_id: 'bronze', liveListings: 1, clearedGates: 7, totalGates: 7 }),
    row({ id: 'B', name: 'Alpha', status: 'review', tier_id: 'platinum', liveListings: 9, clearedGates: 2, totalGates: 7 }),
    row({ id: 'C', name: 'Mid', status: 'onboarding', tier_id: 'gold', liveListings: 5, clearedGates: 5, totalGates: 7 }),
  ]

  it('sorts by name', () => {
    expect(sortRows(rows, 'name', 'asc', TIERS).map(r => r.name)).toEqual(['Alpha', 'Mid', 'Zeta'])
  })

  /* Lifecycle order, not alphabetical: what needs attention comes first. */
  it('sorts status by what needs attention rather than by letter', () => {
    expect(sortRows(rows, 'status', 'asc', TIERS).map(r => r.status)).toEqual(['review', 'onboarding', 'live'])
  })

  it('sorts tier by rank rather than by name', () => {
    expect(sortRows(rows, 'tier', 'desc', TIERS).map(r => r.tier_id)).toEqual(['platinum', 'gold', 'bronze'])
  })

  it('sorts progress by fraction, not by gates cleared', () => {
    const mixed = [
      row({ id: 'X', name: 'X', clearedGates: 3, totalGates: 4 }),
      row({ id: 'Y', name: 'Y', clearedGates: 4, totalGates: 7 }),
    ]
    expect(sortRows(mixed, 'progress', 'desc', TIERS).map(r => r.id)).toEqual(['X', 'Y'])
  })

  it('breaks ties by name so the order is stable', () => {
    const tied = [row({ id: 'B', name: 'Beta' }), row({ id: 'A', name: 'Alpha' })]
    expect(sortRows(tied, 'status', 'asc', TIERS).map(r => r.name)).toEqual(['Alpha', 'Beta'])
  })

  it('does not mutate the input', () => {
    const input = [...rows]
    sortRows(input, 'name', 'asc', TIERS)
    expect(input.map(r => r.id)).toEqual(['A', 'B', 'C'])
  })
})

describe('paginate', () => {
  const rows = Array.from({ length: 23 }, (_, i) => i)

  it('returns the requested page and describes the range', () => {
    expect(paginate(rows, 2, 10)).toMatchObject({ page: 2, pages: 3, from: 11, to: 20, total: 23 })
  })

  it('gives a short last page rather than padding it', () => {
    expect(paginate(rows, 3, 10).items).toHaveLength(3)
  })

  /* Filtering down to two results while on page 5 must show the two. */
  it('clamps a page beyond the end rather than returning nothing', () => {
    const p = paginate(rows.slice(0, 2), 5, 10)
    expect(p.page).toBe(1)
    expect(p.items).toHaveLength(2)
  })

  it('clamps a page below one', () => {
    expect(paginate(rows, 0, 10).page).toBe(1)
  })

  it('reports an honest empty range with nothing to show', () => {
    expect(paginate([], 1, 10)).toMatchObject({ items: [], pages: 1, from: 0, to: 0, total: 0 })
  })
})

describe('summaries', () => {
  const rows = [
    row({ id: 'A', name: 'A', status: 'live', tier_id: 'gold', categories: ['iot', 'device'] }),
    row({ id: 'B', name: 'B', status: 'live', tier_id: 'gold', categories: ['iot'] }),
    row({ id: 'C', name: 'C', status: 'onboarding', tier_id: 'bronze', categories: ['consumer'] }),
  ]

  /* A chip that appears and disappears as the data moves is a chip people stop
     trusting, and "no suspended sellers" is itself an answer. */
  it('keeps every status present even at zero', () => {
    const b = byStatus(rows)
    expect(b.map(x => x.key)).toEqual(['live', 'onboarding', 'review', 'suspended', 'rejected'])
    expect(b.find(x => x.key === 'suspended')!.count).toBe(0)
    expect(b.find(x => x.key === 'live')!.count).toBe(2)
  })

  it('orders tiers from the top down and carries their colour', () => {
    const b = byTier(rows, TIERS)
    expect(b.map(x => x.label)).toEqual(['Platinum', 'Gold', 'Silver', 'Bronze'])
    expect(b.find(x => x.key === 'gold')!.count).toBe(2)
    expect(b[0].colour).toBe('#455A64')
  })

  /* A seller in two categories counts in both, so these sum to more than the
     partner count on purpose. */
  it('counts a multi-category seller in each of their categories', () => {
    const b = byCategory(rows, CATEGORIES)
    expect(b.find(x => x.key === 'iot')!.count).toBe(2)
    expect(b.find(x => x.key === 'device')!.count).toBe(1)
    expect(b.reduce((n, x) => n + x.count, 0)).toBeGreaterThan(rows.length)
  })
})

describe('categoryReadiness', () => {
  const TODAY = new Date('2026-07-30T00:00:00Z')

  const ev = (o: Partial<CategoryEvidence> & { rule_id: string; state: EvidenceState }): CategoryEvidence => ({
    id: `pce-${o.rule_id}`, partner_id: 'PTR-1004', category_id: 'device',
    document: null, path: null, kind: null, size: null, expires_on: null,
    submitted_by: null, submitted_at: null, reviewed_by: null, reviewed_at: null, note: null,
    ...o,
  })

  it('counts what is satisfied against what the category asks for', () => {
    const r = categoryReadiness('device', [
      ev({ rule_id: 'PR-03', state: 'standing' }),
      ev({ rule_id: 'PR-04', state: 'accepted' }),
      ev({ rule_id: 'PR-08', state: 'outstanding' }),
    ], true, TODAY)
    expect(r).toMatchObject({ satisfied: 2, total: 3 })
    expect(r.outstanding.map(e => e.rule_id)).toEqual(['PR-08'])
  })

  it('ignores evidence belonging to another category', () => {
    const r = categoryReadiness('device', [
      ev({ rule_id: 'PR-04', state: 'accepted' }),
      ev({ rule_id: 'PR-06', state: 'outstanding', category_id: 'security' }),
    ], true, TODAY)
    expect(r.total).toBe(1)
    expect(r.outstanding).toEqual([])
  })

  it('counts a waiver as satisfied, because that is what a waiver is', () => {
    expect(categoryReadiness('device', [ev({ rule_id: 'PR-04', state: 'waived' })], true, TODAY).satisfied).toBe(1)
  })

  it('treats a rejected submission as outstanding', () => {
    const r = categoryReadiness('device', [ev({ rule_id: 'PR-04', state: 'rejected' })], true, TODAY)
    expect(r.outstanding).toHaveLength(1)
    expect(r.clear).toBe(false)
  })

  it('separates expired evidence from evidence expiring soon', () => {
    const r = categoryReadiness('device', [
      ev({ rule_id: 'PR-04', state: 'accepted', expires_on: '2026-07-11' }),
      ev({ rule_id: 'PR-06', state: 'accepted', expires_on: '2026-09-01' }),
      ev({ rule_id: 'PR-01', state: 'accepted', expires_on: '2027-06-01' }),
    ], true, TODAY)
    expect(r.expired.map(e => e.rule_id)).toEqual(['PR-04'])
    expect(r.expiring.map(e => e.rule_id)).toEqual(['PR-06'])
  })

  /* The distinction the panel exists for: approved is what the operator did,
     clear is whether it is safe to list today. */
  it('is approved but not clear when a certificate has lapsed', () => {
    const r = categoryReadiness('device',
      [ev({ rule_id: 'PR-04', state: 'accepted', expires_on: '2026-07-11' })], true, TODAY)
    expect(r.approved).toBe(true)
    expect(r.clear).toBe(false)
  })

  it('is not clear when the category was never approved', () => {
    const r = categoryReadiness('device', [ev({ rule_id: 'PR-03', state: 'standing' })], false, TODAY)
    expect(r.clear).toBe(false)
  })

  it('is clear when approved with nothing outstanding and nothing lapsed', () => {
    const r = categoryReadiness('device', [
      ev({ rule_id: 'PR-03', state: 'standing' }),
      ev({ rule_id: 'PR-04', state: 'accepted', expires_on: '2027-06-01' }),
    ], true, TODAY)
    expect(r.clear).toBe(true)
  })

  it('does not report zero of zero as a problem for a category with no rules', () => {
    const r = categoryReadiness('partner', [], true, TODAY)
    expect(r).toMatchObject({ satisfied: 0, total: 0, clear: true })
  })
})

describe('EVIDENCE_MEANING', () => {
  it('explains every state a row can be in', () => {
    const states: EvidenceState[] = ['accepted', 'standing', 'submitted', 'outstanding', 'rejected', 'waived']
    states.forEach(s => expect(EVIDENCE_MEANING[s].length).toBeGreaterThan(15))
  })

  /* The one that most needs saying: nobody owes anything. */
  it('says a standing rule needs nothing supplied', () => {
    expect(EVIDENCE_MEANING.standing).toMatch(/nothing to supply/i)
  })
})
