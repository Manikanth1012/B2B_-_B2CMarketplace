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
  it('is none when neither is known', () => {
    expect(orderLineImage('SKU-9', 'unknown-shelf', photos)).toEqual({ kind: 'none' })
    expect(orderLineImage(null, undefined, photos)).toEqual({ kind: 'none' })
  })
})
