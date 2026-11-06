import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  defaultChoices, validateChoices, priceBundle, bundleStanding, groupBySelection,
  type BundleSlot, type BundleOption,
} from './bundles'

const slot = (o: Partial<BundleSlot> & { id: string }): BundleSlot => ({
  template_id: 'T', label: 'sensor', min_pick: 1, max_pick: 2, qty_min: 1, qty_max: 5, qty_default: 2, sort_order: 0, ...o,
})
const opt = (o: Partial<BundleOption> & { id: string; slot_id: string; product_id: string }): BundleOption => ({
  is_default: false, sort_order: 0, ...o,
})

const slots = [
  slot({ id: 's1', label: 'sensor', qty_default: 3 }),
  slot({ id: 's2', label: 'gateway', min_pick: 0, max_pick: 1, qty_default: 1 }),
]
const options = [
  opt({ id: 'o1', slot_id: 's1', product_id: 'P1', is_default: true }),
  opt({ id: 'o2', slot_id: 's1', product_id: 'P2' }),
  opt({ id: 'o3', slot_id: 's2', product_id: 'P3', is_default: true }),
]

describe('defaultChoices', () => {
  it('picks the default at qty_default for required slots and leaves optional ones empty', () => {
    expect(defaultChoices(slots, options)).toEqual({ s1: [{ product_id: 'P1', quantity: 3 }], s2: [] })
  })
})

describe('validateChoices', () => {
  it('accepts the defaults', () => {
    expect(validateChoices(slots, options, defaultChoices(slots, options))).toEqual({})
  })
  it('refuses too few picks', () => {
    expect(validateChoices(slots, options, { s1: [], s2: [] }).s1).toBe('Pick at least 1 sensor')
  })
  it('refuses too many picks', () => {
    const r = validateChoices(slots, options, { s1: [], s2: [{ product_id: 'P3', quantity: 1 }, { product_id: 'P3', quantity: 1 }] })
    expect(r.s2).toBe('Pick at most 1 gateway')
  })
  it('refuses a quantity out of range', () => {
    expect(validateChoices(slots, options, { s1: [{ product_id: 'P1', quantity: 9 }] }).s1).toMatch(/1 to 5/)
    expect(validateChoices(slots, options, { s1: [{ product_id: 'P1', quantity: 0 }] }).s1).toMatch(/1 to 5/)
  })
  it('refuses a product that is not an option of the slot', () => {
    expect(validateChoices(slots, options, { s1: [{ product_id: 'P3', quantity: 1 }] }).s1).toMatch(/not an option/)
  })
  it('refuses an unknown slot', () => {
    expect(validateChoices(slots, options, { ...defaultChoices(slots, options), zz: [] }).zz).toMatch(/no such/i)
  })
})

describe('priceBundle', () => {
  it('rounds a floor with more than two decimals before comparing, as price_bundle does', () => {
    // 10% off 100 is 90.00; a floor of 90.004 rounds to 90.00, so the part is not held at it.
    const r = priceBundle([{ product_id: 'P', list: 100, floor: 90.004, quantity: 1 }], 10, 1)
    expect(r.lines[0].unit_price).toBe(90)
    expect(r.lines[0].at_floor).toBe(false)
  })

  const parts = [
    { product_id: 'A', list: 100, floor: 50, quantity: 1 },
    { product_id: 'B', list: 40, floor: null, quantity: 2 },
  ]
  it('takes 10% off two parts', () => {
    const p = priceBundle(parts, 10, 1)
    expect(p.lines.map(l => l.unit_price)).toEqual([90, 36])
    expect(p.parts_total).toBe(180)
    expect(p.total).toBe(162)
    expect(p.saving).toBe(18)
    expect(p.lines.every(l => !l.at_floor)).toBe(true)
  })
  it('holds a part at its floor', () => {
    const p = priceBundle([{ product_id: 'A', list: 100, floor: 95, quantity: 1 }], 10, 1)
    expect(p.lines[0].unit_price).toBe(95)
    expect(p.lines[0].at_floor).toBe(true)
  })
  it('treats a null floor as 0', () => {
    expect(priceBundle([{ product_id: 'A', list: 10, floor: null, quantity: 1 }], 99, 1).lines[0].unit_price).toBe(0.1)
  })
  it('multiplies line quantities by the bundle quantity', () => {
    const p = priceBundle(parts, 10, 3)
    expect(p.lines.map(l => l.quantity)).toEqual([3, 6])
    expect(p.total).toBe(486)
  })
  it('rounds each line and the total is exactly their sum', () => {
    const p = priceBundle([
      { product_id: 'A', list: 3.33, floor: null, quantity: 3 },
      { product_id: 'B', list: 7.77, floor: null, quantity: 1 },
    ], 15, 1)
    expect(p.lines[0].unit_price).toBe(2.83)
    expect(p.lines[0].line_total).toBe(8.49)
    expect(p.lines[1].line_total).toBe(6.6)
    expect(p.total).toBe(15.09)
    expect(p.saving).toBe(Math.round((p.parts_total - p.total) * 100) / 100)
  })
  it('refuses impossible input', () => {
    expect(() => priceBundle(parts, 0, 1)).toThrow()
    expect(() => priceBundle(parts, -5, 1)).toThrow()
    expect(() => priceBundle(parts, 100, 1)).toThrow()
    expect(() => priceBundle(parts, 10, 0)).toThrow()
  })
})

describe('bundleStanding', () => {
  const lines = [{ product_id: 'A', name: 'Alpha' }, { product_id: 'B', name: 'Beta' }, { product_id: 'C', name: 'Gamma' }]
  it('is expired when valid_until is before today', () => {
    expect(bundleStanding({ valid_until: '2026-11-04' }, lines, '2026-11-05', () => true)).toEqual({ kind: 'expired' })
  })
  it('is ok on the day itself, also for a timestamp', () => {
    expect(bundleStanding({ valid_until: '2026-11-05' }, lines, '2026-11-05', () => true)).toEqual({ kind: 'ok' })
    expect(bundleStanding({ valid_until: '2026-11-05T23:59:00Z' }, lines, '2026-11-05', () => true)).toEqual({ kind: 'ok' })
  })
  it('names the first unavailable part', () => {
    expect(bundleStanding({ valid_until: '2026-11-12' }, lines, '2026-11-05', id => id === 'A'))
      .toEqual({ kind: 'part-unavailable', product_id: 'B', name: 'Beta' })
  })
})

describe('groupBySelection', () => {
  it('groups by id, keeps order, and leaves ordinary lines alone', () => {
    const l = [
      { n: 1, bundle_selection_id: 'X' }, { n: 2 }, { n: 3, bundle_selection_id: 'Y' },
      { n: 4, bundle_selection_id: 'X' }, { n: 5, bundle_selection_id: null },
    ]
    expect(groupBySelection(l)).toEqual([
      { selectionId: 'X', lines: [l[0], l[3]] },
      { selectionId: null, lines: [l[1]] },
      { selectionId: 'Y', lines: [l[2]] },
      { selectionId: null, lines: [l[4]] },
    ])
  })
})

describe('purity', () => {
  it('does not import supabase', () => {
    expect(readFileSync('src/lib/bundles.ts', 'utf8')).not.toMatch(/supabase/i)
  })
})
