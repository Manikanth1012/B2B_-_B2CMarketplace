import { useState, useEffect } from 'react'
import { Carousel } from './Carousel'
import { CategoryRail } from './CategoryRail'
import { PromoStrip } from './PromoStrip'
import { HERO, CAROUSEL, BANNERS, DEVICE_THUMBS } from '../../lib/assets'
import { loadPromoBanners, loadCategories, loadCatalogue, countByCategory } from '../../lib/storefrontRepo'
import {
  promoStrip, retailCategories, enterpriseCategories, assignImages,
  type PromoSlide,
} from '../../lib/storefront'
import type { Category } from '../../types'
import type { PublicPage } from '../../types/view'

export function LandingPage({ onNavigate }: { onNavigate: (p: PublicPage) => void }) {
  const [slides, setSlides] = useState<PromoSlide[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    /* Three independent reads. Any of them coming back empty degrades one band of
       the page rather than failing the page, which is why none of them throws. */
    loadPromoBanners().then(b => setSlides(promoStrip(b, BANNERS)))
    loadCategories().then(setCategories)
    loadCatalogue().then(p => setCounts(countByCategory(p)))
  }, [])

  const retail = retailCategories(categories)
  const enterprise = enterpriseCategories(categories)
  /* One image per category, assigned across both rails at once so Devices — which
     legitimately appears in both — carries the same picture in each. */
  const art = assignImages(categories.map(c => c.id), DEVICE_THUMBS)

  return (
    <>
      {/* Hero */}
      <section style={{ position: 'relative', background: 'var(--brand-navy)', color: 'white', overflow: 'hidden' }}>
        <img src={HERO} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.25 }} />
        <div className="container" style={{ position: 'relative', padding: '64px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '48px', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 'var(--text-5xl)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
              One marketplace.<br />Every kind of buyer.
            </h1>
            <p style={{ fontSize: 'var(--text-lg)', color: 'rgba(255,255,255,0.75)', marginTop: '20px', maxWidth: '460px' }}>
              Plans, devices, security and IoT — sold by verified partners, settled by the marketplace,
              across India, UAE and Kenya.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '32px', flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-lg" onClick={() => onNavigate('retail')}>Shop retail</button>
              <button className="btn btn-secondary btn-lg" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', borderColor: 'rgba(255,255,255,0.2)' }} onClick={() => onNavigate('enterprise')}>
                For business
              </button>
              <button className="btn btn-secondary btn-lg" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', borderColor: 'rgba(255,255,255,0.2)' }} onClick={() => onNavigate('partner')}>
                Sell with us
              </button>
            </div>
          </div>
          <Carousel slides={CAROUSEL} alt="What you can buy here" />
        </div>
      </section>

      {/* Promo strip — the operator's live storefront banners. The copy is theirs;
          pausing a banner in their console takes it off this page. */}
      <PromoStrip slides={slides} onNavigate={onNavigate} />

      {/* The rails show the marketplace's own six categories, split by the audience
          each one records, rather than a hand-kept list of pictures. */}
      <CategoryRail
        title="Retail products"
        subtitle="Plans, devices, entertainment and connected home"
        categories={retail}
        images={art}
        counts={counts}
        onNavigate={onNavigate}
      />
      <CategoryRail
        title="Enterprise products"
        subtitle="IoT, security, devices and reselling"
        categories={enterprise}
        images={art}
        counts={counts}
        onNavigate={onNavigate}
      />
    </>
  )
}
