import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  asTemplate, asSlot, asOption, asChoices, asSelection, asSelectionLine, asPriced,
  priceArgs, planTemplateSave, templateRow,
} from './bundlePayload'
import type { BundleSlot, BundleOption } from './bundles'

const slot = (o: Partial<BundleSlot> = {}): BundleSlot => ({
  id: 's1', template_id: 'T', label: 'Sensors', min_pick: 1, max_pick: 1,
  qty_min: 1, qty_max: 10, qty_default: 2, sort_order: 0, ...o,
})
const opt = (o: Partial<BundleOption> = {}): BundleOption => ({
  id: 'o1', slot_id: 's1', product_id: 'P1', is_default: true, sort_order: 0, ...o,
})
const input = (o: Record<string, unknown> = {}) => ({
  id: 's1', label: 'Sensors', min_pick: 1, max_pick: 1, qty_min: 1, qty_max: 10, qty_default: 2, sort_order: 0,
  options: [{ product_id: 'P1', is_default: true }], ...o,
}) as Parameters<typeof planTemplateSave>[2][number]

describe('row mapping', () => {
  it('turns numeric strings into numbers and blanks into null', () => {
    expect(asTemplate({ id: 'BT-1', name: 'N', description: null, image: undefined, status: 'live', audiences: ['consumer'], discount_pct: '12.50' }))
      .toEqual({ id: 'BT-1', name: 'N', description: null, image: null, status: 'live', audiences: ['consumer'], discount_pct: 12.5 })
    expect(asSlot({ id: 's', template_id: 'T', label: 'L', min_pick: '0', max_pick: '2', qty_min: 1, qty_max: '5', qty_default: 1, sort_order: null }).sort_order).toBe(0)
    expect(asOption({ id: 'o', slot_id: 's', product_id: 'P', is_default: false, sort_order: 3 }).is_default).toBe(false)
  })
  it('reads choices, tolerating a string and dropping the malformed', () => {
    expect(asChoices({ a: [{ product_id: 'P', quantity: '3' }], b: 'x' })).toEqual({ a: [{ product_id: 'P', quantity: 3 }] })
    expect(asChoices('{"a":[{"product_id":"P","quantity":1}]}')).toEqual({ a: [{ product_id: 'P', quantity: 1 }] })
    expect(asChoices('nonsense')).toEqual({})
    expect(asChoices(null)).toEqual({})
    expect(asChoices([1])).toEqual({})
  })
  it('maps a selection and a line', () => {
    const s = asSelection({ id: 'x', template_id: 'T', currency: 'INR', quantity: '2', total: '90.00', parts_total: '100.00', priced_at: 'a', valid_until: 'b', choices: {} })
    expect(s).toMatchObject({ quantity: 2, total: 90, parts_total: 100 })
    const l = asSelectionLine({ id: 'l', selection_id: 'x', product_id: 'P', name: 'N', partner_id: null, seller: 'S', quantity: 2, list_unit_price: '10.00', unit_price: '9.00', floor_unit_price: null, sort_order: 1 })
    expect(l).toMatchObject({ list_unit_price: 10, unit_price: 9, floor_unit_price: null, partner_id: null })
  })
  it('reads price_bundle output, lines without ids, and refuses a wrong shape', () => {
    const p = asPriced({ lines: [{ product_id: 'P', name: 'N', seller: 'S', quantity: 2, list_unit_price: 10, unit_price: 9, floor_unit_price: 8, sort_order: 1, partner_id: 'pt' }], total: 18, parts_total: 20, saving: 2 })
    expect(p).toMatchObject({ total: 18, parts_total: 20, saving: 2 })
    expect(p!.lines[0]).toMatchObject({ id: '', selection_id: '', floor_unit_price: 8, partner_id: 'pt' })
    expect(asPriced(null)).toBeNull()
    expect(asPriced({ total: 1 })).toBeNull()
  })
})

describe('priceArgs', () => {
  it('uses the migration argument names and plain numbers', () => {
    expect(priceArgs('BT-1', { s1: [{ product_id: 'P', quantity: 2 }], s2: [] }, 'INR', 3)).toEqual({
      p_template: 'BT-1', p_choices: { s1: [{ product_id: 'P', quantity: 2 }], s2: [] }, p_currency: 'INR', p_quantity: 3,
    })
  })
})

describe('templateRow', () => {
  it('trims, nulls blanks and sends no id', () => {
    const r = templateRow({ name: ' Kit ', description: '  ', image: null, status: 'draft', audiences: ['enterprise'], discount_pct: 10 })
    expect(r).toEqual({ name: 'Kit', description: null, image: null, status: 'draft', audiences: ['enterprise'], discount_pct: 10 })
    expect('id' in r).toBe(false)
  })
})

describe('planTemplateSave', () => {
  it('writes nothing when nothing changed (a live template can then be renamed)', () => {
    const plan = planTemplateSave([slot()], [opt()], [input()])
    expect(plan.removeSlots).toEqual([])
    expect(plan.slots).toHaveLength(1)
    expect(plan.slots[0].write).toBe(false)
    expect(plan.slots[0].options).toEqual({ remove: [], add: [], change: [] })
  })
  it('creates a slot with no id and adds its options in order', () => {
    const plan = planTemplateSave([], [], [input({ id: undefined, options: [{ product_id: 'A', is_default: true }, { product_id: 'B', is_default: false }] })])
    expect(plan.slots[0]).toMatchObject({ id: null, write: true })
    expect(plan.slots[0].options.add).toEqual([
      { product_id: 'A', is_default: true, sort_order: 0 }, { product_id: 'B', is_default: false, sort_order: 1 },
    ])
  })
  it('treats an unknown id as a new slot', () => {
    expect(planTemplateSave([slot()], [opt()], [input({ id: 'ghost' })]).slots[0].id).toBeNull()
  })
  it('removes slots left out and options left out', () => {
    const plan = planTemplateSave(
      [slot(), slot({ id: 's2' })], [opt(), opt({ id: 'o2', product_id: 'P2', is_default: false })],
      [input({ options: [{ product_id: 'P1', is_default: true }] })],
    )
    expect(plan.removeSlots).toEqual(['s2'])
    expect(plan.slots[0].options.remove).toEqual(['o2'])
  })
  it('updates a changed slot and a changed option default or position', () => {
    const plan = planTemplateSave([slot()], [opt()], [input({ qty_default: 3, options: [{ product_id: 'P1', is_default: false }] })])
    expect(plan.slots[0].write).toBe(true)
    expect(plan.slots[0].fields.qty_default).toBe(3)
    expect(plan.slots[0].options.change).toEqual([{ id: 'o1', is_default: false, sort_order: 0 }])
  })
})

describe('bundlePayload.ts', () => {
  it('never imports supabase', () => {
    const src = readFileSync(new URL('./bundlePayload.ts', import.meta.url), 'utf8')
    expect(src).not.toMatch(/from ['"]\.\/supabase['"]/)
    expect(src).not.toMatch(/import (?!type)[^\n]*from ['"]\.\/bundleRepo['"]/)
  })
})
