import { describe, it, expect } from 'vitest'
import {
  promoStrip, bannerDestination, assignImages,
  retailCategories, enterpriseCategories, categoriesForPage, categoryDestination,
  productsForPage, isSellable, canAddToBasket, exampleProducts,
  type PublicBanner, type SellableProduct,
} from './storefront'
import type { Category } from '../types'

const banner = (o: Partial<PublicBanner> & { id: string }): PublicBanner => ({
  slot: 'storefront_strip', title: 'T', subtitle: null, cta: 'Go',
  audience: 'consumer', destination: null, weight: 50, sort_order: 1, ...o,
})

const IMAGES = ['/a.webp', '/b.webp', '/c.webp', '/d.webp', '/e.webp', '/f.webp']

/* The six the marketplace actually ships, audiences copied from the table. */
const CATEGORIES: Category[] = [
  { id: 'consumer', name: 'Consumer', audience: 'B2C', icon: 'smartphone', blurb: '', sort_order: 1 },
  { id: 'partner', name: 'Partner', audience: 'B2B2X', icon: 'group', blurb: '', sort_order: 2 },
  { id: 'iot', name: 'IoT', audience: 'Enterprise', icon: 'cpu', blurb: '', sort_order: 3 },
  { id: 'security', name: 'Security', audience: 'Enterprise', icon: 'shield', blurb: '', sort_order: 4 },
  { id: 'device', name: 'Devices', audience: 'Consumer & Enterprise', icon: 'monitor', blurb: '', sort_order: 5 },
  { id: 'content', name: 'Digital Content', audience: 'B2C', icon: 'play', blurb: '', sort_order: 6 },
]

const product = (o: Partial<SellableProduct> & { id: string; category_id: string }): SellableProduct => ({
  name: 'P', seller: 'S', price: 10, was_price: null, rating: null, reviews: 0,
  stock: 'in', badge: null, unit: null, status: 'live', sort_order: 1, ...o,
})

describe('promoStrip', () => {
  it('shows only the storefront slots, so a login banner stays on the login screen', () => {
    const out = promoStrip([
      banner({ id: 'a', slot: 'login' }),
      banner({ id: 'b', slot: 'storefront_strip' }),
      banner({ id: 'c', slot: 'category_header' }),
      banner({ id: 'd', slot: 'storefront_hero' }),
    ], IMAGES)
    expect(out.map(s => s.banner.id).sort()).toEqual(['b', 'd'])
  })

  it('orders by the operator weight, heaviest first', () => {
    const out = promoStrip([
      banner({ id: 'light', weight: 10 }),
      banner({ id: 'heavy', weight: 90 }),
      banner({ id: 'mid', weight: 50 }),
    ], IMAGES)
    expect(out.map(s => s.banner.id)).toEqual(['heavy', 'mid', 'light'])
  })

  it('breaks a weight tie on sort_order, then on id, so the order never depends on row order', () => {
    const a = promoStrip([
      banner({ id: 'z', weight: 50, sort_order: 2 }),
      banner({ id: 'y', weight: 50, sort_order: 1 }),
      banner({ id: 'x', weight: 50, sort_order: 1 }),
    ], IMAGES)
    const b = promoStrip([
      banner({ id: 'x', weight: 50, sort_order: 1 }),
      banner({ id: 'z', weight: 50, sort_order: 2 }),
      banner({ id: 'y', weight: 50, sort_order: 1 }),
    ], IMAGES)
    expect(a.map(s => s.banner.id)).toEqual(['x', 'y', 'z'])
    expect(b.map(s => s.banner.id)).toEqual(a.map(s => s.banner.id))
  })

  it('caps the strip at the limit', () => {
    const many = Array.from({ length: 9 }, (_, i) => banner({ id: `b${i}` }))
    expect(promoStrip(many, IMAGES)).toHaveLength(4)
    expect(promoStrip(many, IMAGES, 2)).toHaveLength(2)
  })

  it('returns nothing when the operator has paused every storefront banner', () => {
    expect(promoStrip([banner({ id: 'a', slot: 'login' })], IMAGES)).toEqual([])
    expect(promoStrip([], IMAGES)).toEqual([])
  })

  it('gives each banner a different image', () => {
    const out = promoStrip(
      [banner({ id: 'a' }), banner({ id: 'b' }), banner({ id: 'c' }), banner({ id: 'd' })],
      IMAGES,
    )
    expect(new Set(out.map(s => s.image)).size).toBe(4)
  })

  /* The point of hashing the id rather than using the position: pausing one banner
     must not reshuffle the artwork on the ones that remain. */
  it('keeps a banner on the same image when another is paused', () => {
    const all = [banner({ id: 'a' }), banner({ id: 'b' }), banner({ id: 'c' })]
    const before = promoStrip(all, IMAGES)
    const after = promoStrip(all.filter(b => b.id !== 'a'), IMAGES)
    const imageOf = (r: ReturnType<typeof promoStrip>, id: string) => r.find(s => s.banner.id === id)!.image
    expect(imageOf(after, 'c')).toBe(imageOf(before, 'c'))
  })

  it('survives having no images rather than rendering a broken tile', () => {
    expect(promoStrip([banner({ id: 'a' })], [])).toEqual([])
  })
})

describe('bannerDestination', () => {
  /* The operator's choice wins. Audience is who the banner is shown to; the
     destination is where the click lands, and they are not the same question. */
  it('uses the destination the operator chose', () => {
    expect(bannerDestination({ audience: 'all', destination: 'partner' })).toBe('partner')
    expect(bannerDestination({ audience: 'consumer', destination: 'enterprise' })).toBe('enterprise')
  })

  /* The bug this fixes: "Become a marketplace seller · Apply to sell" is shown to
     everyone, so its audience is `all`, and inferring from that sent would-be
     sellers to the retail shop. */
  it('does not send an all-audience seller banner to retail', () => {
    expect(bannerDestination({ audience: 'all', destination: 'partner' })).not.toBe('retail')
  })

  it('falls back to the audience when no destination is set', () => {
    expect(bannerDestination({ audience: 'enterprise', destination: null })).toBe('enterprise')
    expect(bannerDestination({ audience: 'B2B2X', destination: null })).toBe('enterprise')
    expect(bannerDestination({ audience: 'consumer', destination: null })).toBe('retail')
    expect(bannerDestination({ audience: 'all' })).toBe('retail')
  })

  it('ignores a destination that is not a real page', () => {
    expect(bannerDestination({ audience: 'enterprise', destination: 'nowhere' })).toBe('enterprise')
  })
})

describe('assignImages', () => {
  it('repeats rather than failing when there are more ids than images', () => {
    const out = assignImages(['a', 'b', 'c'], ['/only.webp'])
    expect(Object.values(out)).toEqual(['/only.webp', '/only.webp', '/only.webp'])
  })
  it('is empty when there is nothing to assign from', () => {
    expect(assignImages(['a'], [])).toEqual({})
  })
})

describe('category rails', () => {
  it('puts the consumer-facing categories on the retail rail', () => {
    expect(retailCategories(CATEGORIES).map(c => c.id)).toEqual(['consumer', 'device', 'content'])
  })

  it('puts the business-facing categories on the enterprise rail', () => {
    expect(enterpriseCategories(CATEGORIES).map(c => c.id)).toEqual(['partner', 'iot', 'security', 'device'])
  })

  /* Devices records 'Consumer & Enterprise' and genuinely sells to both, so it
     appearing twice is the audience column being honoured, not a bug. */
  it('shows Devices on both rails because that is what its audience says', () => {
    expect(retailCategories(CATEGORIES).map(c => c.id)).toContain('device')
    expect(enterpriseCategories(CATEGORIES).map(c => c.id)).toContain('device')
  })

  it('places all six categories somewhere between the two rails', () => {
    const shown = new Set([
      ...retailCategories(CATEGORIES).map(c => c.id),
      ...enterpriseCategories(CATEGORIES).map(c => c.id),
    ])
    expect(shown.size).toBe(6)
  })

  it('keeps the catalogue order within a rail', () => {
    expect(retailCategories(CATEGORIES).map(c => c.sort_order)).toEqual([1, 5, 6])
  })

  it('gives the partner page every category, because it sells listing not shopping', () => {
    expect(categoriesForPage('partner', CATEGORIES)).toHaveLength(6)
  })

  it('routes a category tile to the page that serves it', () => {
    expect(categoryDestination(CATEGORIES[0])).toBe('retail')
    expect(categoryDestination(CATEGORIES[1])).toBe('partner')
    expect(categoryDestination(CATEGORIES[2])).toBe('enterprise')
  })
})

describe('productsForPage', () => {
  const CATALOGUE = [
    product({ id: 'p1', category_id: 'consumer', sort_order: 2 }),
    product({ id: 'p2', category_id: 'iot', sort_order: 1 }),
    product({ id: 'p3', category_id: 'device', sort_order: 3 }),
    product({ id: 'p4', category_id: 'consumer', status: 'pending', sort_order: 4 }),
    product({ id: 'p5', category_id: 'security', status: 'suspended', sort_order: 5 }),
  ]

  it('lists only the categories the page covers', () => {
    expect(productsForPage(CATALOGUE, CATEGORIES, 'retail').map(p => p.id)).toEqual(['p1', 'p3'])
    expect(productsForPage(CATALOGUE, CATEGORIES, 'enterprise').map(p => p.id)).toEqual(['p2', 'p3'])
  })

  /* A public page advertising a pending or suspended listing is offering something
     nobody can buy — the operator has not approved it. */
  it('leaves out anything not live in the operator catalogue', () => {
    const ids = productsForPage(CATALOGUE, CATEGORIES, 'retail').map(p => p.id)
    expect(ids).not.toContain('p4')
    expect(productsForPage(CATALOGUE, CATEGORIES, 'enterprise').map(p => p.id)).not.toContain('p5')
  })

  it('honours the catalogue order', () => {
    expect(productsForPage(CATALOGUE, CATEGORIES, 'enterprise').map(p => p.id)).toEqual(['p2', 'p3'])
  })

  it('caps the page length', () => {
    const many = Array.from({ length: 30 }, (_, i) => product({ id: `p${i}`, category_id: 'consumer', sort_order: i }))
    expect(productsForPage(many, CATEGORIES, 'retail')).toHaveLength(12)
    expect(productsForPage(many, CATEGORIES, 'retail', 4)).toHaveLength(4)
  })
})

describe('exampleProducts', () => {
  const CATALOGUE = [
    product({ id: 'plain', category_id: 'iot', rating: 4.9, sort_order: 5 }),
    product({ id: 'best', category_id: 'iot', badge: 'Bestseller', rating: 3.1, sort_order: 9 }),
    product({ id: 'rated', category_id: 'iot', rating: 4.4, sort_order: 1 }),
    product({ id: 'dead', category_id: 'iot', badge: 'Bestseller', rating: 5, status: 'suspended', sort_order: 0 }),
    product({ id: 'other', category_id: 'security', badge: 'Bestseller', sort_order: 1 }),
  ]

  /* A bestseller with a middling score still leads: it is the operator's own flag,
     and the point of the section is to show a seller what moves. */
  it('leads with what the operator flagged, then what buyers rated', () => {
    expect(exampleProducts(CATALOGUE, 'iot').map(p => p.id)).toEqual(['best', 'plain', 'rated'])
  })

  it('stays inside the category', () => {
    expect(exampleProducts(CATALOGUE, 'security').map(p => p.id)).toEqual(['other'])
  })

  it('never showcases a listing that is not live', () => {
    expect(exampleProducts(CATALOGUE, 'iot').map(p => p.id)).not.toContain('dead')
  })

  it('caps the examples, and copes with a category that has none', () => {
    expect(exampleProducts(CATALOGUE, 'iot', 2).map(p => p.id)).toEqual(['best', 'plain'])
    expect(exampleProducts(CATALOGUE, 'content')).toEqual([])
  })

  it('does not depend on the order rows came back in', () => {
    const shuffled = [...CATALOGUE].reverse()
    expect(exampleProducts(shuffled, 'iot').map(p => p.id))
      .toEqual(exampleProducts(CATALOGUE, 'iot').map(p => p.id))
  })
})

describe('sellability', () => {
  it('counts only approved catalogue statuses as sellable', () => {
    expect(isSellable({ status: 'live' })).toBe(true)
    expect(isSellable({ status: 'LIVE' })).toBe(true)
    expect(isSellable({ status: 'pending' })).toBe(false)
    expect(isSellable({ status: 'suspended' })).toBe(false)
  })

  it('refuses the basket only when stock is out', () => {
    expect(canAddToBasket({ stock: 'in' })).toBe(true)
    expect(canAddToBasket({ stock: 'low' })).toBe(true)
    expect(canAddToBasket({ stock: 'out' })).toBe(false)
  })
})
