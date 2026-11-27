import { describe, it, expect } from 'vitest'
import { checkBundleLines, percentOffLine, type BundleLine } from './pricing'

const line = (id: string, price: number, floor: number, unitPrice: number, quantity = 1): BundleLine =>
  ({ productId: id, name: id, quantity, price, floor_price: floor, unitPrice })

describe('checkBundleLines', () => {
  it('adds the lines up into the bundle price and reports the saving', () => {
    const v = checkBundleLines([line('a', 7.99, 7.19, 7.5), line('b', 229, 182.8, 210, 2)])
    expect(v.ok).toBe(true)
    expect(v.total).toBe(427.5)
    expect(v.partsTotal).toBe(465.99)
    expect(v.saving).toBe(38.49)
    expect(v.savingPct).toBe(8.3)
    expect(v.reason).toBeNull()
  })
  it('refuses a line below its seller floor, above its normal price, or empty', () => {
    const v = checkBundleLines([line('a', 7.99, 7.19, 7.18), line('b', 6.9, 6.21, 6.91), line('c', 10, 9, NaN)])
    expect(v.ok).toBe(false)
    expect(v.lineErrors.a).toMatch(/no lower than \$7\.19/)
    expect(v.lineErrors.b).toMatch(/normal price of \$6\.90/)
    expect(v.lineErrors.c).toBe('Set a price.')
    expect(v.reason).toMatch(/3 products/)
  })
  it('accepts a line exactly at its floor and exactly at its price', () => {
    expect(checkBundleLines([line('a', 7.99, 7.19, 7.19), line('b', 6.9, 6.21, 6.9)]).ok).toBe(true)
  })
  it('refuses a bundle with no discount at all', () => {
    const v = checkBundleLines([line('a', 7.99, 7.19, 7.99), line('b', 6.9, 6.21, 6.9)])
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/same as buying the parts/)
  })
  it('refuses an empty bundle', () => {
    expect(checkBundleLines([]).ok).toBe(false)
  })
})

describe('percentOffLine', () => {
  it('takes the percentage off the normal price', () => {
    expect(percentOffLine({ price: 229, floor_price: 182.8 }, 10)).toBe(206.1)
  })
  it('stops at the seller floor', () => {
    expect(percentOffLine({ price: 7.99, floor_price: 7.19 }, 25)).toBe(7.19)
  })
  it('clamps silly percentages', () => {
    expect(percentOffLine({ price: 10, floor_price: 0 }, -5)).toBe(10)
    expect(percentOffLine({ price: 10, floor_price: 2 }, 150)).toBe(2)
  })
})
