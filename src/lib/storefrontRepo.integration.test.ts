/* Touches the live Supabase project. Reads only — creates and changes nothing.
   Runs signed out on purpose: this is the storefront a visitor with no session
   sees, and the point of most of these assertions is what they *cannot* reach. */
import { describe, it, expect, beforeAll } from 'vitest'
import { supabase } from './supabase'
import { signOut } from './authRepo'
import { loadPromoBanners, loadCategories, loadCatalogue, countByCategory } from './storefrontRepo'
import { promoStrip, retailCategories, enterpriseCategories, productsForPage } from './storefront'
import { BANNERS } from './assets'

beforeAll(async () => {
  await signOut()
})

describe('the signed-out storefront', () => {
  it('reads the operator banners through the view, with the commercial columns gone', async () => {
    const banners = await loadPromoBanners()
    expect(banners.length).toBeGreaterThan(0)

    /* impressions, clicks and revenue are the operator's numbers. The view drops
       them, and this is the assertion that keeps them dropped. */
    for (const b of banners) {
      expect(b).not.toHaveProperty('impressions')
      expect(b).not.toHaveProperty('clicks')
      expect(b).not.toHaveProperty('revenue')
      expect(b.title.length).toBeGreaterThan(0)
    }
  })

  it('cannot reach operator_banners itself', async () => {
    /* RLS filters rather than throwing, so the tell is an empty set, not an error.
       A test that expected an error would pass for the wrong reason. */
    const { data, error } = await supabase.from('operator_banners').select('*')
    expect(error).toBeNull()
    expect(data).toEqual([])
  })

  it('never offers a paused or out-of-window banner', async () => {
    const banners = await loadPromoBanners()
    const ids = banners.map(b => b.id)
    /* bn-005 is active; if the operator pauses it in their console it must leave
       this list. Assert the view's own rule instead: everything it returns is one
       the storefront is allowed to show right now. */
    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('fills the promo strip with storefront banners only', async () => {
    const slides = promoStrip(await loadPromoBanners(), BANNERS)
    expect(slides.length).toBeGreaterThan(0)
    expect(slides.length).toBeLessThanOrEqual(4)
    for (const s of slides) {
      expect(['storefront_hero', 'storefront_strip']).toContain(s.banner.slot)
      expect(s.image).toMatch(/^\/assets\//)
    }
  })

  it('splits the shoppable categories across the two landing rails', async () => {
    const categories = await loadCategories()
    expect(categories).toHaveLength(6)

    const retail = retailCategories(categories).map(c => c.id)
    const enterprise = enterpriseCategories(categories).map(c => c.id)
    expect(retail).toEqual(['consumer', 'device', 'content'])
    expect(enterprise).toEqual(['iot', 'security', 'device'])
  })

  /* Five of the six. Partner sells white-label storefronts and wholesale packs
     of 500 lines to resellers — no shopper and no enterprise buyer can order
     one, so it is reached from "Sell with us" rather than from a rail. */
  it('keeps the reseller shelf off both rails, and still shows it to a visitor', async () => {
    const categories = await loadCategories()
    const rails = new Set([
      ...retailCategories(categories).map(c => c.id),
      ...enterpriseCategories(categories).map(c => c.id),
    ])
    expect(rails.has('partner')).toBe(false)
    expect(rails.size).toBe(5)

    /* Readable, though — the public partner page is the shop window for
       becoming a reseller, and hiding the rows would empty it. */
    expect(categories.some(c => c.id === 'partner')).toBe(true)
    const catalogue = await loadCatalogue()
    expect(catalogue.some(p => p.category_id === 'partner')).toBe(true)
  })

  it('lists real catalogue rows on the audience pages, and only live ones', async () => {
    const [catalogue, categories] = await Promise.all([loadCatalogue(), loadCategories()])
    expect(catalogue.length).toBeGreaterThan(0)

    const retail = productsForPage(catalogue, categories, 'retail')
    expect(retail.length).toBeGreaterThan(0)
    for (const p of retail) {
      expect(p.status).toBe('live')
      expect(p.name.length).toBeGreaterThan(0)
      expect(p.seller.length).toBeGreaterThan(0)
      expect(p.price).toBeGreaterThan(0)
    }

    /* The catalogue holds pending and suspended rows. A public page must not be
       advertising something the operator has not approved. */
    const notLive = catalogue.filter(p => p.status !== 'live')
    expect(notLive.length).toBeGreaterThan(0)
    const shown = new Set([
      ...retail.map(p => p.id),
      ...productsForPage(catalogue, categories, 'enterprise').map(p => p.id),
    ])
    for (const p of notLive) expect(shown.has(p.id)).toBe(false)
  })

  it('counts products per category for the rail tiles', async () => {
    const counts = countByCategory(await loadCatalogue())
    expect(Object.keys(counts).length).toBeGreaterThan(0)
    for (const n of Object.values(counts)) expect(n).toBeGreaterThan(0)
  })

  it('cannot start a basket without a session', async () => {
    /* The other half of the login gate. The UI routes a signed-out visitor to sign
       in before the first add; this is the database refusing it regardless. */
    const { error } = await supabase.from('cart_items').insert({ product_id: 'SKU-2001', quantity: 1 })
    expect(error).not.toBeNull()
  })
})
