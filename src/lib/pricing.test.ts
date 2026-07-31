import { describe, it, expect } from 'vitest'
import {
  bases, toOtherBasis, headroom, validateBand, bandWarnings,
  bundleRoom, checkBundleAgainstFloors,
} from './pricing'
import type { BundleComponent } from './pricing'

const comp = (over: Partial<BundleComponent> & Pick<BundleComponent, 'productId'>): BundleComponent => ({
  name: over.productId, quantity: 1, price: 100, floor_price: 80, ...over,
})

describe('bases', () => {
  it('splits a tax-inclusive price into what the seller books and what the buyer pays', () => {
    /* $118 inclusive at 18% is $100 net. */
    expect(bases({ price: 118, price_includes_tax: true, tax_rate: 18 }))
      .toEqual({ gross: 118, net: 100, tax: 18, rate: 18, quotedIn: 'gross' })
  })

  it('adds tax to an exclusive price rather than digging it back out', () => {
    expect(bases({ price: 100, price_includes_tax: false, tax_rate: 18 }))
      .toEqual({ gross: 118, net: 100, tax: 18, rate: 18, quotedIn: 'net' })
  })

  it('leaves a zero-rated price alone in both directions', () => {
    expect(bases({ price: 50, price_includes_tax: true, tax_rate: 0 }))
      .toMatchObject({ gross: 50, net: 50, tax: 0 })
    expect(bases({ price: 50, price_includes_tax: false, tax_rate: 0 }))
      .toMatchObject({ gross: 50, net: 50, tax: 0 })
  })

  it('says which basis was quoted, because the label depends on it', () => {
    expect(bases({ price: 18, price_includes_tax: true, tax_rate: 18 }).quotedIn).toBe('gross')
    expect(bases({ price: 18, price_includes_tax: false, tax_rate: 18 }).quotedIn).toBe('net')
  })

  it('round-trips through toOtherBasis', () => {
    expect(toOtherBasis(118, 18, 'gross')).toBe(100)
    expect(toOtherBasis(100, 18, 'net')).toBe(118)
  })
})

describe('headroom', () => {
  it('measures the gap down to the floor and up to the RRP', () => {
    const h = headroom({ price: 100, floor_price: 80, list_price: 120 })
    expect(h).toEqual({ amount: 20, pct: 20, above: 20, none: false })
  })

  it('reports none rather than a negative when the floor has caught the price', () => {
    expect(headroom({ price: 100, floor_price: 100, list_price: 100 }))
      .toMatchObject({ amount: 0, pct: 0, none: true })
  })

  it('does not divide by a zero price', () => {
    expect(headroom({ price: 0, floor_price: 0, list_price: 0 }).pct).toBe(0)
  })
})

describe('validateBand', () => {
  it('accepts a coherent band', () => {
    expect(validateBand({ price: 100, floor: 80, list: 120, cost: 60 })).toBeNull()
  })

  it('refuses a minimum above the asking price', () => {
    expect(validateBand({ price: 100, floor: 120, list: 130 })).toMatch(/not a target/)
  })

  it('refuses a maximum below the asking price', () => {
    expect(validateBand({ price: 100, floor: 80, list: 90 })).toMatch(/most it is ever sold for/)
  })

  it('refuses a floor under what it costs to deliver', () => {
    expect(validateBand({ price: 100, floor: 50, list: 120, cost: 60 })).toMatch(/loses you money/)
  })

  it('says nothing about cost when there is none on record', () => {
    expect(validateBand({ price: 100, floor: 50, list: 120 })).toBeNull()
  })

  it('wants a price at all', () => {
    expect(validateBand({ price: 0, floor: 0, list: 0 })).toMatch(/Set a price/)
  })

  it('allows a floor exactly at cost and a list exactly at price', () => {
    expect(validateBand({ price: 100, floor: 60, list: 100, cost: 60 })).toBeNull()
  })
})

describe('bandWarnings', () => {
  it('flags a listing with no room, because it can never be bundled', () => {
    expect(bandWarnings({ price: 100, floor: 100, list: 100 })[0]).toMatch(/No discount room/)
  })

  it('flags giving away an unusual amount of room', () => {
    expect(bandWarnings({ price: 100, floor: 40, list: 110 }).some(w => /60% off/.test(w))).toBe(true)
  })

  it('flags a thin margin before commission', () => {
    expect(bandWarnings({ price: 100, floor: 95, list: 110, cost: 95 }).some(w => /5% margin/.test(w))).toBe(true)
  })

  it('flags an RRP nobody would believe', () => {
    expect(bandWarnings({ price: 100, floor: 80, list: 250 }).some(w => /nobody believes/.test(w))).toBe(true)
  })

  it('stays quiet on an ordinary listing', () => {
    expect(bandWarnings({ price: 100, floor: 85, list: 110, cost: 60 })).toEqual([])
  })
})

describe('bundleRoom', () => {
  const parts = [
    comp({ productId: 'A', name: 'Sensor', quantity: 25, price: 84, floor_price: 70 }),
    comp({ productId: 'B', name: 'Connectivity', quantity: 300, price: 1.4, floor_price: 1.2 }),
  ]

  it('adds up what the parts ask and what their sellers will accept', () => {
    const r = bundleRoom(parts)
    expect(r.partsTotal).toBe(2520)
    expect(r.floorTotal).toBe(2110)
    expect(r.maxDiscount).toBe(410)
    expect(r.maxDiscountPct).toBe(16.3)
  })

  it('names the components with the least room, worst first', () => {
    const r = bundleRoom(parts)
    /* Connectivity gives 14.3%, the sensor 16.7% — connectivity constrains. */
    expect(r.tightest[0].name).toBe('Connectivity')
  })

  it('handles an empty bundle without dividing by zero', () => {
    expect(bundleRoom([])).toMatchObject({ partsTotal: 0, floorTotal: 0, maxDiscount: 0, maxDiscountPct: 0 })
  })

  it('reports no room when every component is already at its floor', () => {
    expect(bundleRoom([comp({ productId: 'A', price: 50, floor_price: 50 })]).maxDiscount).toBe(0)
  })
})

describe('checkBundleAgainstFloors', () => {
  const parts = [
    comp({ productId: 'A', name: 'Sensor', quantity: 25, price: 84, floor_price: 70 }),
    comp({ productId: 'B', name: 'Connectivity', quantity: 300, price: 1.4, floor_price: 1.2 }),
  ]

  it('accepts a price inside the band', () => {
    const v = checkBundleAgainstFloors(2295, parts)
    expect(v.ok).toBe(true)
  })

  it('refuses a price at or above the parts, because that is not a bundle', () => {
    const v = checkBundleAgainstFloors(2600, parts)
    expect(v.ok).toBe(false)
    expect(!v.ok && v.reason).toMatch(/not a bundle/)
  })

  it('refuses spending margin the sellers did not agree to, and says by how much', () => {
    const v = checkBundleAgainstFloors(2000, parts)
    expect(v.ok).toBe(false)
    expect(!v.ok && v.reason).toContain('$110.00 below')
    expect(!v.ok && v.reason).toContain('$2110.00')
  })

  it('names the component doing the constraining, so it can be swapped', () => {
    const v = checkBundleAgainstFloors(2000, parts)
    expect(!v.ok && v.reason).toContain('Connectivity')
  })

  it('accepts a price exactly on the collective floor', () => {
    expect(checkBundleAgainstFloors(2110, parts).ok).toBe(true)
  })

  it('returns the room either way, so the form can show it while refusing', () => {
    const v = checkBundleAgainstFloors(1, parts)
    expect(v.room.maxDiscount).toBe(410)
  })
})
