import { describe, it, expect } from 'vitest'
import { orderLineImage } from './orderLineImage'

describe('orderLineImage', () => {
  const photos = { 'SKU-1': 'https://img/one.jpg' }
  it('prefers the product photo', () => {
    expect(orderLineImage('SKU-1', 'iot', photos)).toEqual({ kind: 'product', src: 'https://img/one.jpg' })
  })
  it('falls back to the category artwork', () => {
    const r = orderLineImage('SKU-9', 'iot', photos)
    expect(r.kind).toBe('category')
  })
  it('uses the shelf icon when the shelf is known but has no artwork', () => {
    expect(orderLineImage('SKU-9', 'unknown-shelf', photos)).toEqual({ kind: 'shelf', categoryId: 'unknown-shelf' })
    expect(orderLineImage(null, 'unknown-shelf', photos)).toEqual({ kind: 'shelf', categoryId: 'unknown-shelf' })
  })
  it('is none when the shelf is unknown', () => {
    expect(orderLineImage('SKU-9', undefined, photos)).toEqual({ kind: 'none' })
    expect(orderLineImage(null, undefined, photos)).toEqual({ kind: 'none' })
  })
})
