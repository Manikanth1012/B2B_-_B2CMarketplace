import { describe, it, expect } from 'vitest'
import {
  fromPrice, templatesFor, partsFor, unavailable, togglePick, setPickQty, slotHint, totalsDiffer,
  type Shelf, type ShelfPart,
} from './shelf'
import type { BundleTemplate, BundleSlot, BundleOption } from '../../lib/bundles'

const part = (id: string, list: number | null, extra: Partial<ShelfPart> = {}): ShelfPart => ({
  id, name: id.toUpperCase(), seller: 'S', category_id: 'device', stock: 'in', status: 'live', unit: null,
  list, floor: null, ...extra,
})
const tpl: BundleTemplate = { id: 't1', name: 'Starter', description: 'Phone and plan', image: null, status: 'live', audiences: ['consumer'], discount_pct: 10 }
const phone: BundleSlot = { id: 's1', template_id: 't1', label: 'phone', min_pick: 1, max_pick: 1, qty_min: 1, qty_max: 3, qty_default: 1, sort_order: 0 }
const extras: BundleSlot = { id: 's2', template_id: 't1', label: 'extra', min_pick: 0, max_pick: 2, qty_min: 1, qty_max: 2, qty_default: 1, sort_order: 1 }
const opts: BundleOption[] = [
  { id: 'o1', slot_id: 's1', product_id: 'a', is_default: true, sort_order: 0 },
  { id: 'o2', slot_id: 's1', product_id: 'b', is_default: false, sort_order: 1 },
  { id: 'o3', slot_id: 's2', product_id: 'c', is_default: false, sort_order: 0 },
]
const shelf = (parts: ShelfPart[], t: BundleTemplate = tpl): Shelf => ({
  templates: [t], slots: [phone, extras], options: opts, parts: new Map(parts.map(p => [p.id, p])),
})

describe('bundle shelf', () => {
  it('prices the default configuration as the from price', () => {
    const f = fromPrice(tpl, shelf([part('a', 100), part('b', 200), part('c', 10)]), 'USD')
    expect(f?.total).toBe(90)
    expect(f?.saving).toBe(10)
  })

  it('has no from price when a default part is unpriced or out of stock', () => {
    expect(fromPrice(tpl, shelf([part('a', null)]), 'USD')).toBeNull()
    expect(fromPrice(tpl, shelf([part('a', 100, { stock: 'out' })]), 'USD')).toBeNull()
  })

  it('shows only live templates for the audience, the category and the search', () => {
    const s = shelf([part('a', 100), part('c', 10, { category_id: 'iot' })])
    expect(templatesFor(s, 'consumer', 'USD')).toHaveLength(1)
    expect(templatesFor(s, 'enterprise', 'USD')).toHaveLength(0)
    expect(templatesFor(s, 'consumer', 'USD', { category: 'iot' })).toHaveLength(1)
    expect(templatesFor(s, 'consumer', 'USD', { category: 'security' })).toHaveLength(0)
    expect(templatesFor(s, 'consumer', 'USD', { search: 'plan' })).toHaveLength(1)
    expect(templatesFor(s, 'consumer', 'USD', { search: 'tablet' })).toHaveLength(0)
    expect(templatesFor(shelf([part('a', 100)], { ...tpl, status: 'paused' }), 'consumer', 'USD')).toHaveLength(0)
  })

  it('names why a part cannot be chosen', () => {
    expect(unavailable(part('a', 1), 'INR')).toBeNull()
    expect(unavailable(part('a', null), 'INR')).toBe('Not sold in INR')
    expect(unavailable(part('a', 1, { stock: 'out' }), 'INR')).toBe('Out of stock')
    expect(unavailable(part('a', 1, { status: 'paused' }), 'INR')).toBe('Not on sale')
    expect(unavailable(undefined, 'INR')).toBe('Not on sale')
  })

  it('turns picks into priced parts, or null when one has no price', () => {
    const parts = new Map([['a', part('a', 100)], ['c', part('c', null)]])
    expect(partsFor([phone], { s1: [{ product_id: 'a', quantity: 2 }] }, parts)).toEqual([{ product_id: 'a', list: 100, floor: null, quantity: 2 }])
    expect(partsFor([phone, extras], { s1: [{ product_id: 'a', quantity: 1 }], s2: [{ product_id: 'c', quantity: 1 }] }, parts)).toBeNull()
  })

  it('replaces in a single-pick slot and toggles in a multi-pick one', () => {
    let c = togglePick({ s1: [{ product_id: 'a', quantity: 2 }] }, phone, 'b')
    expect(c.s1).toEqual([{ product_id: 'b', quantity: 1 }])
    c = togglePick(c, phone, 'b')
    expect(c.s1).toEqual([{ product_id: 'b', quantity: 1 }])   // a required single pick stays picked
    c = togglePick(c, extras, 'c')
    expect(c.s2).toEqual([{ product_id: 'c', quantity: 1 }])
    c = togglePick(c, extras, 'c')
    expect(c.s2).toEqual([])
  })

  it('keeps a quantity within the slot range', () => {
    const c = { s1: [{ product_id: 'a', quantity: 1 }] }
    expect(setPickQty(c, phone, 'a', 9).s1[0].quantity).toBe(3)
    expect(setPickQty(c, phone, 'a', 0).s1[0].quantity).toBe(1)
  })

  it('describes a slot and compares totals to the cent', () => {
    expect(slotHint(phone)).toBe('Choose one')
    expect(slotHint(extras)).toBe('Optional — choose up to 2')
    expect(totalsDiffer(10, 10.004)).toBe(false)
    expect(totalsDiffer(10, 10.01)).toBe(true)
  })
})
