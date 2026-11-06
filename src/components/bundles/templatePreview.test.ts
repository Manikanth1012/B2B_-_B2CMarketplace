import { describe, it, expect } from 'vitest'
import { previewConfiguration } from './templatePreview'
import type { PreviewSlot } from './templatePreview'

const slot = (id: string, over: Partial<PreviewSlot>): PreviewSlot => ({
  id, label: id, min_pick: 1, max_pick: 1, qty_min: 1, qty_max: 3, qty_default: 2, sort_order: 0, options: [], ...over,
})
const book = new Map([
  ['A', { price: 100, floor_price: 95 }], ['B', { price: 200, floor_price: 100 }], ['C', { price: 50, floor_price: null }],
])
const name = (id: string) => `Part ${id}`
const slots = [
  slot('s1', { options: [{ product_id: 'A', is_default: true }, { product_id: 'B', is_default: false }] }),
  slot('s2', { options: [{ product_id: 'C', is_default: true }] }),
]

describe('previewConfiguration', () => {
  it('prices the default and names a part at its floor', () => {
    const r = previewConfiguration(slots, 'default', 10, book, name)
    expect(r).toMatchObject({ kind: 'ok', atFloor: ['Part A'], parts: 2 })
  })
  it('cheapest takes the minimum picks, dearest the maximum quantity', () => {
    const lo = previewConfiguration(slots, 'cheapest', 10, book, name)
    const hi = previewConfiguration(slots, 'dearest', 10, book, name)
    expect(lo.kind === 'ok' && hi.kind === 'ok' && hi.total > lo.total).toBe(true)
  })
  it('reports a product with no price in the currency', () => {
    const r = previewConfiguration(slots, 'default', 10, new Map([['A', { price: 100, floor_price: null }]]), name)
    expect(r).toEqual({ kind: 'missing', names: ['Part C'] })
  })
})
