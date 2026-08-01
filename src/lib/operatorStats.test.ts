import { describe, it, expect } from 'vitest'
import {
  monthlyStats, lineLevelTotals, verticalSplit, inversionInsight,
  type MonthRow, type VerticalRow,
} from './operatorStats'
import type { Category } from '../types'

const month = (o: Partial<MonthRow> & { id: string; month: string }): MonthRow => ({
  month_start: '2026-01-01', gross: 100000, commission: 9300, orders: 400,
  aggregated: true, sort_order: 1, ...o,
})

const CATEGORIES: Category[] = [
  { shoppable_by: ['consumer'], id: 'consumer', name: 'Consumer', audience: 'B2C', icon: '', blurb: '', sort_order: 1 },
  { shoppable_by: ['partner'], id: 'partner', name: 'Partner', audience: 'B2B2X', icon: '', blurb: '', sort_order: 2 },
  { shoppable_by: ['consumer', 'enterprise'], id: 'iot', name: 'IoT', audience: 'Enterprise', icon: '', blurb: '', sort_order: 3 },
  { shoppable_by: ['consumer', 'enterprise'], id: 'security', name: 'Security', audience: 'Enterprise', icon: '', blurb: '', sort_order: 4 },
  { shoppable_by: ['consumer', 'enterprise'], id: 'device', name: 'Devices', audience: 'Consumer & Enterprise', icon: '', blurb: '', sort_order: 5 },
  { shoppable_by: ['consumer'], id: 'content', name: 'Digital Content', audience: 'B2C', icon: '', blurb: '', sort_order: 6 },
]

/* The live seed, so the tests fail if the migration and the screen drift apart. */
const VERTICALS: VerticalRow[] = [
  { category_id: 'consumer', orders: 1061, gross: 109510.77, commission: 9331.24, sort_order: 1 },
  { category_id: 'partner', orders: 40, gross: 49180.32, commission: 4576.19, sort_order: 2 },
  { category_id: 'iot', orders: 188, gross: 196720.55, commission: 18384.72, sort_order: 3 },
  { category_id: 'security', orders: 115, gross: 156847.32, commission: 14612.11, sort_order: 4 },
  { category_id: 'device', orders: 401, gross: 167486.24, commission: 15528.66, sort_order: 5 },
  { category_id: 'content', orders: 795, gross: 31363.73, commission: 3871.11, sort_order: 6 },
]

describe('monthlyStats', () => {
  const rows = [
    month({ id: '1', month: 'May 2026', gross: 100, orders: 10, aggregated: false }),
    month({ id: '2', month: 'Jun 2026', gross: 300, orders: 30, aggregated: false }),
    month({ id: '3', month: 'Apr 2026', gross: 200, orders: 20, aggregated: true }),
  ]

  it('totals and averages the series', () => {
    const s = monthlyStats(rows)
    expect(s.months).toBe(3)
    expect(s.gross).toBe(600)
    expect(s.orders).toBe(60)
    expect(s.average).toBe(200)
  })

  it('names the best month rather than the last one', () => {
    expect(monthlyStats(rows).best?.month).toBe('Jun 2026')
  })

  /* The provenance line on the panel is built from these two counts. */
  it('counts carried-forward months separately from line-level ones', () => {
    const s = monthlyStats(rows)
    expect(s.aggregated).toBe(1)
    expect(s.lineLevel).toBe(2)
  })

  it('is zero rather than NaN on an empty series', () => {
    expect(monthlyStats([])).toMatchObject({ months: 0, gross: 0, average: 0, best: null })
  })
})

describe('lineLevelTotals', () => {
  /* The claim printed on the panel: the last three months sum exactly to the 90-day
     figure the cards above show. If the seed drifts, this fails rather than the
     screen quietly contradicting itself. */
  it('matches the operator profile figures the headline cards read', () => {
    const rows: MonthRow[] = [
      month({ id: 'a', month: 'Apr 2026', gross: 203839.37, commission: 18957.06, orders: 745, aggregated: true }),
      month({ id: 'b', month: 'May 2026', gross: 223999.31, commission: 20885.77, orders: 819, aggregated: false }),
      month({ id: 'c', month: 'Jun 2026', gross: 238221.49, commission: 22211.85, orders: 871, aggregated: false }),
      month({ id: 'd', month: 'Jul 2026', gross: 248888.13, commission: 23206.41, orders: 910, aggregated: false }),
    ]
    const t = lineLevelTotals(rows)
    expect(t.gross).toBeCloseTo(711108.93, 2)
    expect(t.commission).toBeCloseTo(66304.03, 2)
    expect(t.orders).toBe(2600)
  })
})

describe('verticalSplit', () => {
  it('returns the three series in the categories own order', () => {
    const s = verticalSplit(VERTICALS, CATEGORIES)
    expect(s.orders.map(c => c.label)).toEqual(['Consumer', 'Partner', 'IoT', 'Security', 'Devices', 'Digital'])
    /* Same order across all three, so a colour always means the same marketplace. */
    expect(s.gross.map(c => c.label)).toEqual(s.orders.map(c => c.label))
    expect(s.commission.map(c => c.label)).toEqual(s.orders.map(c => c.label))
  })

  it('leaves out a category with no figures rather than plotting a zero', () => {
    const s = verticalSplit(VERTICALS.filter(v => v.category_id !== 'partner'), CATEGORIES)
    expect(s.orders.map(c => c.label)).not.toContain('Partner')
  })
})

describe('inversionInsight', () => {
  it('states the split the two charts exist to show', () => {
    const text = inversionInsight(VERTICALS, CATEGORIES)
    expect(text).toMatch(/two charts invert/i)
    expect(text).toMatch(/support load/i)
    expect(text).toMatch(/%/)
  })

  /* Computed, not written down — so it cannot drift away from the data. And if the
     data stops supporting the claim, it says nothing rather than saying it anyway. */
  it('says nothing when the volume categories also carry the value', () => {
    const flipped: VerticalRow[] = [
      { category_id: 'consumer', orders: 900, gross: 900000, commission: 1, sort_order: 1 },
      { category_id: 'iot', orders: 100, gross: 100000, commission: 1, sort_order: 3 },
    ]
    expect(inversionInsight(flipped, CATEGORIES)).toBe('')
  })

  it('says nothing at all with no data', () => {
    expect(inversionInsight([], CATEGORIES)).toBe('')
  })
})
