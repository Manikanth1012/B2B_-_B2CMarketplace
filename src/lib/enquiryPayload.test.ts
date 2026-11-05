import { describe, it, expect } from 'vitest'
import { quoteLinesPayload, asLine } from './enquiryPayload'

describe('quoteLinesPayload', () => {
  it('sends product, quantity and target; a missing target is null', () => {
    expect(quoteLinesPayload([
      { product_id: 'SKU-1', quantity: 120, target_unit_price: 3800 },
      { product_id: 'SKU-2', quantity: 5 },
      { product_id: 'SKU-3', quantity: 1, target_unit_price: null },
    ])).toEqual([
      { product_id: 'SKU-1', quantity: 120, target_unit_price: 3800 },
      { product_id: 'SKU-2', quantity: 5, target_unit_price: null },
      { product_id: 'SKU-3', quantity: 1, target_unit_price: null },
    ])
  })
  it('sends nothing the client could use to route or name the line', () => {
    const out = quoteLinesPayload([{ product_id: 'SKU-1', quantity: 1, name: 'x', partner_id: 'p' } as never])
    expect(Object.keys(out[0]).sort()).toEqual(['product_id', 'quantity', 'target_unit_price'])
  })
})

describe('asLine', () => {
  it('turns numeric strings into numbers and keeps nulls', () => {
    const l = asLine({
      id: 'a', enquiry_id: 'ENQ-1', product_id: 'p', name: 'n', partner_id: null,
      quantity: 2, target_unit_price: '10.50', quoted_unit_price: null, sort_order: 1,
    })
    expect(l.target_unit_price).toBe(10.5)
    expect(l.quoted_unit_price).toBeNull()
    expect(l.quantity).toBe(2)
  })
})
