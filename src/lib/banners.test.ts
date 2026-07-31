import { describe, it, expect } from 'vitest'
import {
  checkArtwork, occupancy, stateFromDates, scheduleDrift,
  validateBanner, bannerWarnings, metrics, destinationLabel, ASPECT_TOLERANCE,
} from './banners'
import type { BannerSlot, BannerRow, BannerDraft } from './banners'

const slot = (over: Partial<BannerSlot> & Pick<BannerSlot, 'id'>): BannerSlot => ({
  label: over.id, surface: 'somewhere', width: 1200, height: 267,
  max_banners: 3, personal_targeting: true, note: '', sort_order: 1, ...over,
})

const LOGIN = slot({ id: 'login', label: 'Login screen', width: 1200, height: 267, max_banners: 3, personal_targeting: false })
const HERO = slot({ id: 'storefront_hero', label: 'Storefront hero', width: 1600, height: 356, max_banners: 4 })
const SLOTS = [LOGIN, HERO]

const row = (over: Partial<BannerRow> & Pick<BannerRow, 'id'>): BannerRow => ({
  slot: 'storefront_hero', name: over.id, title: 'A headline', subtitle: 'A line under it',
  cta: 'Shop now', audience: 'consumer', region: 'India', device: 'all', weight: 50,
  impressions: 0, clicks: 0, orders: 0, revenue: 0, status: 'live',
  starts_at: null, ends_at: null, destination: 'retail', destination_ref: null,
  accent: '#1b3a6b', image_url: '/assets/mp/banner-01.webp', alt: 'Artwork', sort_order: 1, ...over,
})

const draft = (over: Partial<BannerDraft> = {}): BannerDraft => ({
  name: 'Spring push', slot: 'storefront_hero', title: 'A headline', subtitle: 'A line under it',
  cta: 'Shop now', audience: 'consumer', region: 'India', device: 'all', weight: 50,
  status: 'live', starts_at: null, ends_at: null, destination: 'retail', destination_ref: null,
  accent: '#1b3a6b', image_url: '/assets/mp/banner-01.webp', alt: 'Artwork', ...over,
})

const TODAY = '2026-07-31'
const fits = checkArtwork({ width: 1600, height: 356 }, HERO)

describe('checkArtwork', () => {
  it('accepts artwork at the declared size', () => {
    const v = checkArtwork({ width: 1600, height: 356 }, HERO)
    expect(v.ok).toBe(true)
    expect(v.blocking).toBe(false)
  })

  it('accepts the library artwork, which is the same shape at a smaller scale', () => {
    /* Every banner-*.webp in the repo is 768x171, and every slot asks for that
       ratio — so the real assets pass the shape check and only note the scale. */
    const v = checkArtwork({ width: 768, height: 171 }, HERO)
    expect(v.blocking).toBe(false)
    expect(v.message).toMatch(/under size/)
  })

  it('refuses the wrong shape and says which edges would be lost', () => {
    const wide = checkArtwork({ width: 1600, height: 200 }, HERO)
    expect(wide.blocking).toBe(true)
    expect(wide.message).toMatch(/left and right/)

    const tall = checkArtwork({ width: 1600, height: 900 }, HERO)
    expect(tall.blocking).toBe(true)
    expect(tall.message).toMatch(/top and bottom/)
  })

  it('tolerates a shape that is off by less than the tolerance', () => {
    /* 1600x356 is 4.494:1. Nudge the height by 3%, well inside 8%. */
    const nudged = Math.round(356 * 1.03)
    expect(checkArtwork({ width: 1600, height: nudged }, HERO).blocking).toBe(false)
    expect(ASPECT_TOLERANCE).toBe(0.08)
  })

  it('blocks when there is no artwork at all, naming the size wanted', () => {
    const v = checkArtwork(null, HERO)
    expect(v.blocking).toBe(true)
    expect(v.message).toContain('1600×356')
  })

  it('rejects a file with no dimensions rather than dividing by zero', () => {
    expect(checkArtwork({ width: 0, height: 0 }, HERO).blocking).toBe(true)
  })
})

describe('occupancy', () => {
  const banners = [
    row({ id: 'a', weight: 60 }), row({ id: 'b', weight: 30 }),
    row({ id: 'c', weight: 10, status: 'draft' }),
    row({ id: 'd', weight: 90, status: 'ended' }),
    row({ id: 'e', slot: 'login' }),
  ]

  it('counts only what competes for the rotation', () => {
    const o = occupancy(HERO, banners)
    expect(o.running).toBe(2)
    expect(o.remaining).toBe(2)
    expect(o.over).toBe(false)
  })

  it('counts a scheduled banner, because it has already taken the space', () => {
    expect(occupancy(HERO, [...banners, row({ id: 'f', status: 'scheduled' })]).running).toBe(3)
  })

  it('turns weight into a share, since weight has no units', () => {
    const o = occupancy(HERO, banners)
    expect(o.share.map(s => s.pct)).toEqual([66.7, 33.3])
  })

  it('reports being over capacity rather than clamping', () => {
    const many = Array.from({ length: 5 }, (_, i) => row({ id: `x${i}` }))
    const o = occupancy(HERO, many)
    expect(o.over).toBe(true)
    expect(o.remaining).toBe(0)
  })

  it('gives every share as zero when nothing carries weight', () => {
    expect(occupancy(HERO, [row({ id: 'z', weight: 0 })]).share[0].pct).toBe(0)
  })
})

describe('stateFromDates and scheduleDrift', () => {
  it('says nothing about a draft or a paused banner — those are decisions', () => {
    expect(stateFromDates({ status: 'draft', starts_at: null, ends_at: null }, TODAY)).toBeNull()
    expect(stateFromDates({ status: 'paused', starts_at: '2020-01-01', ends_at: '2020-02-01' }, TODAY)).toBeNull()
  })

  it('reads a closed window as ended and a future one as scheduled', () => {
    expect(stateFromDates({ status: 'live', starts_at: null, ends_at: '2026-06-30' }, TODAY)).toBe('ended')
    expect(stateFromDates({ status: 'live', starts_at: '2026-08-15', ends_at: null }, TODAY)).toBe('scheduled')
    expect(stateFromDates({ status: 'live', starts_at: '2026-01-01', ends_at: '2026-12-31' }, TODAY)).toBe('live')
  })

  it('flags a banner that claims live after its window shut', () => {
    const b = row({ id: 'a', status: 'live', ends_at: '2026-06-30' })
    expect(scheduleDrift(b, TODAY)).toMatch(/window closed/)
  })

  it('flags one still scheduled after its start passed', () => {
    const b = row({ id: 'a', status: 'scheduled', starts_at: '2026-07-01' })
    expect(scheduleDrift(b, TODAY)).toMatch(/start date has passed/)
  })

  it('stays quiet when the state and the dates agree', () => {
    expect(scheduleDrift(row({ id: 'a', status: 'live', ends_at: '2026-12-31' }), TODAY)).toBeNull()
    expect(scheduleDrift(row({ id: 'a', status: 'paused', ends_at: '2020-01-01' }), TODAY)).toBeNull()
  })
})

describe('validateBanner', () => {
  const ok = (d: Partial<BannerDraft> = {}, banners: BannerRow[] = []) =>
    validateBanner(draft(d), HERO, fits, SLOTS, banners, TODAY)

  it('passes a complete live banner', () => {
    expect(ok()).toBeNull()
  })

  it('wants a name, a headline and a button label', () => {
    expect(ok({ name: '  ' })).toMatch(/name/i)
    expect(ok({ title: '' })).toMatch(/headline/i)
    expect(ok({ cta: '' })).toMatch(/call to action/i)
  })

  it('refuses personal targeting on a slot seen before sign-in', () => {
    const problem = validateBanner(
      draft({ slot: 'login', audience: 'lapsed customers' }), LOGIN, fits, SLOTS, [], TODAY)
    expect(problem).toMatch(/before sign-in/)
  })

  it('allows a locale-based audience on that same slot', () => {
    expect(validateBanner(draft({ slot: 'login', audience: 'all' }), LOGIN, fits, SLOTS, [], TODAY)).toBeNull()
  })

  it('refuses a window that ends before it starts', () => {
    expect(ok({ starts_at: '2026-09-01', ends_at: '2026-08-01' })).toMatch(/before it starts/)
  })

  it('holds a draft to a lower bar, because half-written is what a draft is for', () => {
    /* No artwork, no alt text, no destination — all fine while it is a draft. */
    expect(ok({ status: 'draft', image_url: null, alt: '', destination: null })).toBeNull()
    expect(ok({ status: 'live', image_url: null })).toMatch(/needs artwork/)
  })

  it('refuses to publish artwork of the wrong shape', () => {
    const bad = checkArtwork({ width: 1600, height: 900 }, HERO)
    expect(validateBanner(draft(), HERO, bad, SLOTS, [], TODAY)).toMatch(/Wrong shape/)
  })

  it('insists on alt text before anything goes live', () => {
    expect(ok({ alt: '   ' })).toMatch(/screen reader/)
  })

  it('insists the click lands somewhere', () => {
    expect(ok({ destination: null })).toMatch(/where the call to action lands/)
    expect(ok({ destination: null, destination_ref: 'SKU-2001' })).toMatch(/no page/)
  })

  it('refuses to over-subscribe a slot, and says what is already in it', () => {
    const full = Array.from({ length: 4 }, (_, i) => row({ id: `x${i}` }))
    expect(ok({}, full)).toMatch(/already carries 4 of 4/)
  })

  it('does not count the banner being edited against its own slot', () => {
    const full = Array.from({ length: 4 }, (_, i) => row({ id: `x${i}` }))
    expect(validateBanner(draft(), HERO, fits, SLOTS, full, TODAY, 'x0')).toBeNull()
  })

  it('keeps each state honest about its own dates', () => {
    expect(ok({ status: 'scheduled', starts_at: '2026-07-01' })).toMatch(/opens later/)
    expect(ok({ status: 'ended', ends_at: '2026-12-31' })).toMatch(/window has closed/)
    expect(ok({ status: 'live', ends_at: '2026-06-30' })).toMatch(/already passed/)
  })

  it('refuses a weight outside the dial', () => {
    expect(ok({ weight: 0 })).toMatch(/1 to 100/)
    expect(ok({ weight: 250 })).toMatch(/1 to 100/)
  })

  it('refuses a slot that does not exist, and lists the ones that do', () => {
    const problem = validateBanner(draft({ slot: 'nowhere' }), undefined, fits, SLOTS, [], TODAY)
    expect(problem).toContain('Login screen')
  })
})

describe('bannerWarnings', () => {
  it('mentions under-size artwork without blocking it', () => {
    const small = checkArtwork({ width: 768, height: 171 }, HERO)
    expect(bannerWarnings(draft(), HERO, small, []).some(w => /under size/.test(w))).toBe(true)
    expect(validateBanner(draft(), HERO, small, SLOTS, [], TODAY)).toBeNull()
  })

  it('notes a missing supporting line and an over-long headline', () => {
    expect(bannerWarnings(draft({ subtitle: '' }), HERO, fits, []).some(w => /supporting line/.test(w))).toBe(true)
    const long = 'x'.repeat(70)
    expect(bannerWarnings(draft({ title: long }), HERO, fits, []).some(w => /wraps on a phone/.test(w))).toBe(true)
  })

  it('works out the share of the rotation it would take', () => {
    const existing = [row({ id: 'a', weight: 50 })]
    const w = bannerWarnings(draft({ weight: 50 }), HERO, fits, existing)
    expect(w.some(x => x.includes('50%'))).toBe(true)
  })

  it('says nothing about a clean banner in an empty slot', () => {
    expect(bannerWarnings(draft(), HERO, fits, [])).toEqual([])
  })
})

describe('metrics', () => {
  it('reports rates rather than totals', () => {
    const m = metrics({ impressions: 45200, clicks: 1850, orders: 148, revenue: 1926 })
    expect(m.ctr).toBe(4.1)
    expect(m.conversion).toBe(8)
    expect(m.revenuePerOrder).toBe(13.01)
  })

  it('returns null where nothing has run, rather than a zero that reads as failure', () => {
    const m = metrics({ impressions: 0, clicks: 0, orders: 0, revenue: 0 })
    expect(m).toEqual({ ctr: null, conversion: null, revenuePerMille: null, revenuePerOrder: null })
  })
})

describe('destinationLabel', () => {
  it('spells out the page', () => {
    expect(destinationLabel({ destination: 'retail', destination_ref: null })).toBe('the retail storefront')
  })

  it('names the product when the click opens one', () => {
    expect(destinationLabel({ destination: 'retail', destination_ref: 'SKU-2001' },
      id => id === 'SKU-2001' ? 'Aventa Freedom 50 GB' : undefined))
      .toBe('Aventa Freedom 50 GB, on the retail storefront')
  })

  it('says so when nothing was chosen', () => {
    expect(destinationLabel({ destination: null, destination_ref: null })).toMatch(/nowhere/)
  })
})
