import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { Category } from '../types'
import type { SellableProduct } from './storefront'
import { featuredProducts, ecosystemSellers, tileCount, categoryVisual, HOME_ART } from './home'

const cat = (id: string, shoppable_by: Category['shoppable_by'], audience = 'B2C', sort_order = 0): Category =>
  ({ id, name: id, audience, shoppable_by, icon: 'package', blurb: '', sort_order })

const prod = (o: Partial<SellableProduct> & { id: string }): SellableProduct => ({
  name: o.id, seller: 'Seller', price: 10, was_price: null, rating: null, reviews: 0,
  stock: 'In stock', badge: null, unit: null, category_id: 'device', status: 'live',
  sort_order: 0, audiences: null, ...o,
})

const CATS = [
  cat('device', ['consumer', 'enterprise'], 'B2C'),
  cat('iot', ['enterprise'], 'Enterprise'),
  cat('partner', ['partner'], 'B2B2X'),
]

describe('featuredProducts', () => {
  it('offers only what a retail visitor can buy', () => {
    const rows = [
      prod({ id: 'ok' }),
      prod({ id: 'draft', status: 'draft' }),
      prod({ id: 'biz-only', audiences: ['enterprise'] }),
      prod({ id: 'iot-shelf', category_id: 'iot' }),
    ]
    expect(featuredProducts(rows, CATS).map(p => p.id)).toEqual(['ok'])
  })

  it('leads with bestsellers, then rating, then catalogue order', () => {
    const rows = [
      prod({ id: 'a', rating: 4.9, sort_order: 1 }),
      prod({ id: 'b', badge: 'Bestseller', rating: 3.1, sort_order: 2 }),
      prod({ id: 'c', rating: 4.9, sort_order: 0 }),
      prod({ id: 'd', rating: null, sort_order: 0 }),
    ]
    expect(featuredProducts(rows, CATS).map(p => p.id)).toEqual(['b', 'c', 'a', 'd'])
  })

  it('leaves out a shelf promoted only to enterprise, which the retail page does not list', () => {
    const cats = [...CATS, cat('biz', ['consumer', 'enterprise'], 'Enterprise')]
    const rows = [prod({ id: 'ok' }), prod({ id: 'hidden', category_id: 'biz' })]
    expect(featuredProducts(rows, cats).map(p => p.id)).toEqual(['ok'])
  })

  describe('by currency', () => {
    const priced = (id: string, currency: string) => ({ ...prod({ id }), currency })
    const rows = [priced('inr', 'INR'), priced('usd', 'USD')]

    it('drops a product priced in another currency than the visitor’s', () => {
      expect(featuredProducts(rows, CATS, 4, 'INR').map(p => p.id)).toEqual(['inr'])
    })
    it('keeps every product priced in that currency', () => {
      const two = [priced('a', 'INR'), priced('b', 'INR')]
      expect(featuredProducts(two, CATS, 4, 'INR')).toHaveLength(2)
    })
    it('keeps all when no currency is given', () => {
      expect(featuredProducts(rows, CATS)).toHaveLength(2)
    })
    it('keeps a product that carries no currency', () => {
      expect(featuredProducts([prod({ id: 'bare' })], CATS, 4, 'INR')).toHaveLength(1)
    })
  })

  it('returns at most n', () => {
    const rows = Array.from({ length: 9 }, (_, i) => prod({ id: `p${i}` }))
    expect(featuredProducts(rows, CATS, 4)).toHaveLength(4)
    expect(featuredProducts(rows, CATS)).toHaveLength(4)
  })
})

describe('ecosystemSellers', () => {
  it('names each live seller once, busiest first, then alphabetically', () => {
    const rows = [
      { seller: 'Zeta', status: 'live' }, { seller: 'Alpha', status: 'live' },
      { seller: 'Zeta', status: 'live' }, { seller: 'Beta', status: 'live' },
      { seller: 'Gone', status: 'delisted' }, { seller: '  ', status: 'live' },
    ]
    expect(ecosystemSellers(rows)).toEqual(['Zeta', 'Alpha', 'Beta'])
  })

  it('returns at most n', () => {
    const rows = ['a', 'b', 'c'].map(seller => ({ seller, status: 'live' }))
    expect(ecosystemSellers(rows, 2)).toEqual(['a', 'b'])
  })
})

describe('tileCount', () => {
  it('counts a retail tile in what a consumer can buy', () => {
    const rows = [
      prod({ id: '1' }), prod({ id: '2', audiences: ['enterprise'] }),
      prod({ id: '3', status: 'draft' }), prod({ id: '4', category_id: 'iot' }),
    ]
    expect(tileCount(CATS[0], rows)).toBe(1)
  })

  it('counts every live row on a shelf only resellers buy from', () => {
    const rows = [prod({ id: '1', category_id: 'partner' }), prod({ id: '2', category_id: 'partner', audiences: ['partner'] })]
    expect(tileCount(CATS[2], rows)).toBe(2)
  })
})

describe('categoryVisual', () => {
  const onDisk = (p: string) => existsSync(join('public', p.replace(/^\//, '')))

  it('has a picture on disk for each of the six shelves', () => {
    for (const id of ['consumer', 'device', 'content', 'iot', 'security', 'partner']) {
      const v = categoryVisual(id)
      expect(v, id).not.toBeNull()
      expect(onDisk(v!.src), `${id} → ${v!.src}`).toBe(true)
    }
  })

  it('returns null for a shelf it does not know, so the tile draws its fallback', () => {
    expect(categoryVisual('something-new')).toBeNull()
  })

  it('points the hero cards at files on disk', () => {
    expect(Object.values(HOME_ART).every(onDisk)).toBe(true)
  })
})
