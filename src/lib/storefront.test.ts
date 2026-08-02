import { describe, it, expect } from 'vitest'
import {
  promoStrip, bannerDestination, assignImages,
  retailCategories, enterpriseCategories, categoriesFor, shoppableBy, categoriesForPage, categoryDestination,
  soldTo, productsFor,
  productsForPage, isSellable, canAddToBasket, exampleProducts,
  type PublicBanner, type SellableProduct,
} from './storefront'
import type { Category } from '../types'

const banner = (o: Partial<PublicBanner> & { id: string }): PublicBanner => ({
  slot: 'storefront_strip', title: 'T', subtitle: null, cta: 'Go',
  audience: 'consumer', destination: null, weight: 50, sort_order: 1, ...o,
})

const IMAGES = ['/a.webp', '/b.webp', '/c.webp', '/d.webp', '/e.webp', '/f.webp']

/* The six the marketplace actually ships, copied from the table. `audience` is
   the prose a tile prints and the rail that promotes it; `shoppable_by` is who
   may buy. Partner is the pair that comes apart: it is a business audience and
   no business shops it — a reseller does. */
const CATEGORIES: Category[] = [
  { id: 'consumer', name: 'Consumer', audience: 'B2C', shoppable_by: ['consumer'], icon: 'smartphone', blurb: '', sort_order: 1 },
  { id: 'partner', name: 'Partner', audience: 'B2B2X', shoppable_by: ['partner'], icon: 'group', blurb: '', sort_order: 2 },
  { id: 'iot', name: 'IoT', audience: 'Enterprise', shoppable_by: ['consumer', 'enterprise'], icon: 'cpu', blurb: '', sort_order: 3 },
  { id: 'security', name: 'Security', audience: 'Enterprise', shoppable_by: ['consumer', 'enterprise'], icon: 'shield', blurb: '', sort_order: 4 },
  { id: 'device', name: 'Devices', audience: 'Consumer & Enterprise', shoppable_by: ['consumer', 'enterprise'], icon: 'monitor', blurb: '', sort_order: 5 },
  { id: 'content', name: 'Digital Content', audience: 'B2C', shoppable_by: ['consumer'], icon: 'play', blurb: '', sort_order: 6 },
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
    expect(enterpriseCategories(CATEGORIES).map(c => c.id)).toEqual(['iot', 'security', 'device'])
  })

  /* Partner reads as a business audience and used to ride this rail on the
     strength of that, which put a wholesale pack of 500 lines in front of an
     enterprise buyer who cannot order one. No enterprise shops it — a reseller
     does — so the column vetoes what the prose suggests. */
  it('keeps Partner off both shopping rails, because neither can buy from it', () => {
    expect(retailCategories(CATEGORIES).map(c => c.id)).not.toContain('partner')
    expect(enterpriseCategories(CATEGORIES).map(c => c.id)).not.toContain('partner')
  })

  /* And it is not shown to retail even though IoT, which is also promoted as
     an enterprise shelf, is — the difference is who may pay for it. */
  it('separates being promoted somewhere from being buyable there', () => {
    expect(retailCategories(CATEGORIES).map(c => c.id)).not.toContain('iot')
    expect(categoriesFor(CATEGORIES, 'consumer').map(c => c.id)).toContain('iot')
    expect(categoriesFor(CATEGORIES, 'consumer').map(c => c.id)).not.toContain('partner')
    expect(categoriesFor(CATEGORIES, 'partner').map(c => c.id)).toEqual(['partner'])
  })

  it('answers who may buy from one category at a time', () => {
    const partner = CATEGORIES.find(c => c.id === 'partner')!
    expect(shoppableBy(partner, 'partner')).toBe(true)
    expect(shoppableBy(partner, 'consumer')).toBe(false)
    expect(shoppableBy(partner, 'enterprise')).toBe(false)
  })

  /* A row that arrived before the column existed, or from a client that did not
     select it. Treated as "nobody", which hides a shelf rather than opening one. */
  it('treats a missing column as nobody rather than everybody', () => {
    const legacy = { ...CATEGORIES[0], shoppable_by: undefined as unknown as Category['shoppable_by'] }
    expect(shoppableBy(legacy, 'consumer')).toBe(false)
    expect(categoriesFor([legacy], 'consumer')).toEqual([])
  })

  /* Devices records 'Consumer & Enterprise' and genuinely sells to both, so it
     appearing twice is the audience column being honoured, not a bug. */
  it('shows Devices on both rails because that is what its audience says', () => {
    expect(retailCategories(CATEGORIES).map(c => c.id)).toContain('device')
    expect(enterpriseCategories(CATEGORIES).map(c => c.id)).toContain('device')
  })

  /* Five, not six. Partner is reached from its own page, which is where the
     landing tile sends it — see the routing test below. */
  it('places every shoppable category somewhere between the two rails', () => {
    const shown = new Set([
      ...retailCategories(CATEGORIES).map(c => c.id),
      ...enterpriseCategories(CATEGORIES).map(c => c.id),
    ])
    expect(shown).toEqual(new Set(['consumer', 'device', 'content', 'iot', 'security']))
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

/* A shelf is not a product.
   `shoppable_by` decides which shelves a persona sees, and that was the right
   unit for the seller shelf, which is wholesale all the way through. It is the
   wrong unit for IoT, where a $52 occupancy sensor and a fifty-unit fleet
   bundle sit next to each other — so the product carries its own audience and
   both are asked. */
describe('who a particular product is sold to', () => {
  const sensor = product({ id: 'SKU-5004', category_id: 'iot', audiences: ['consumer', 'enterprise'] })
  const fleet = product({ id: 'SKU-5008', category_id: 'iot', audiences: ['enterprise'], sort_order: 2 })
  const mdr = product({ id: 'SKU-6002', category_id: 'security', audiences: ['enterprise'] })
  const phone = product({ id: 'SKU-4001', category_id: 'device', audiences: ['consumer', 'enterprise'] })

  it('keeps a fifty-unit fleet bundle off the retail shelf and on the business one', () => {
    expect(soldTo(fleet, 'consumer')).toBe(false)
    expect(soldTo(fleet, 'enterprise')).toBe(true)
  })

  it('leaves a single sensor on both', () => {
    expect(soldTo(sensor, 'consumer')).toBe(true)
    expect(soldTo(sensor, 'enterprise')).toBe(true)
  })

  /* A caller that did not select the column must not have every grid on the
     site silently emptied under it. Absent means unrestricted, not forbidden. */
  it('treats a missing audience list as unrestricted rather than as nobody', () => {
    expect(soldTo(product({ id: 'x', category_id: 'iot' }), 'consumer')).toBe(true)
    expect(soldTo(product({ id: 'y', category_id: 'iot', audiences: null }), 'consumer')).toBe(true)
    expect(soldTo(product({ id: 'z', category_id: 'iot', audiences: [] }), 'consumer')).toBe(true)
  })

  it('drops what a page’s shopper cannot buy, even from a shelf they can see', () => {
    const shown = productsForPage([sensor, fleet, mdr, phone], CATEGORIES, 'retail').map(p => p.id)
    expect(shown).toContain('SKU-4001')
    expect(shown).not.toContain('SKU-5008')
    expect(shown).not.toContain('SKU-6002')
  })

  it('keeps all of it on the business page', () => {
    const shown = productsForPage([sensor, fleet, mdr, phone], CATEGORIES, 'enterprise').map(p => p.id)
    expect(shown).toEqual(expect.arrayContaining(['SKU-5004', 'SKU-5008', 'SKU-6002']))
  })

  /* The seller page is a shop window for deciding what to list, not a shelf to
     buy from, so it is not narrowed to one buyer's slice. */
  it('shows a prospective seller everything', () => {
    const shown = productsForPage([sensor, fleet, mdr, phone], CATEGORIES, 'partner').map(p => p.id)
    expect(shown).toEqual(expect.arrayContaining(['SKU-5004', 'SKU-5008', 'SKU-6002', 'SKU-4001']))
  })

  it('narrows one shelf to one persona', () => {
    expect(productsFor([sensor, fleet, mdr, phone], 'consumer', 'iot').map(p => p.id)).toEqual(['SKU-5004'])
    expect(productsFor([sensor, fleet, mdr, phone], 'enterprise', 'iot').map(p => p.id))
      .toEqual(['SKU-5004', 'SKU-5008'])
  })

  it('still refuses a listing that is not live, whoever it is for', () => {
    const draft = product({ id: 'd', category_id: 'device', status: 'pending', audiences: ['consumer'] })
    expect(productsFor([draft], 'consumer').map(p => p.id)).toEqual([])
  })
})
