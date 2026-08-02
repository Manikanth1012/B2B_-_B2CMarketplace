import { useState, useEffect } from 'react'
import { Carousel } from './Carousel'
import { CategoryRail } from './CategoryRail'
import { PromoStrip } from './PromoStrip'
import { HERO, CAROUSEL, BANNERS } from '../../lib/assets'
import { loadPromoBanners, loadCategories, loadCatalogue, countByCategory } from '../../lib/storefrontRepo'
import { loadPriceBook, repriceAll } from '../../lib/moneyRepo'
import { useMarket } from '../../lib/MarketContext'
import {
  promoStrip, retailCategories, enterpriseCategories,
  type PromoSlide,
} from '../../lib/storefront'
import type { Category, Product } from '../../types'
import type { PublicPage } from '../../types/view'

export function LandingPage({ onNavigate }: { onNavigate: (p: PublicPage) => void }) {
  const { market, currency } = useMarket()
  /* The chosen currency, not the market's default. Reading the default here
     while the formatter reads the choice is how a shilling price ends up under
     a dollar sign — the same relabelling the bills migration had to undo. */
  const currencyCode = currency?.code ?? market?.currency ?? 'USD'
  const [slides, setSlides] = useState<PromoSlide[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  /* Counted per rail, not once. A retail tile that counts the whole shelf
     promises ten products and opens on four — the per-seat security bundles and
     the fifty-unit fleet packs on it are not sold to a retail customer. */
  const [catalogue, setCatalogue] = useState<Product[]>([])

  useEffect(() => {
    /* Three independent reads. Any of them coming back empty degrades one band of
       the page rather than failing the page, which is why none of them throws. */
    loadPromoBanners().then(b => setSlides(promoStrip(b, BANNERS)))
    loadCategories().then(setCategories)
    /* Priced for the market too. A shopper who sees $18.00 before signing in
       and ₹1,599.00 after has been shown two different shops. */
    Promise.all([loadCatalogue(), loadPriceBook(currencyCode)])
      .then(([rows, book]) => setCatalogue(repriceAll(rows, book, currencyCode)))
    /* The currency is a dependency: without it this closes over the first one
       it saw and the page keeps showing that market's prices forever. */
  }, [currencyCode])

  const retail = retailCategories(categories)
  const enterprise = enterpriseCategories(categories)
  const retailCounts = countByCategory(catalogue, 'consumer')
  const enterpriseCounts = countByCategory(catalogue, 'enterprise')

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

      {/* The rails show the marketplace's own categories, split by the audience
          each one records, rather than a hand-kept list of pictures. Reselling is
          not among them: the Partner category sells white-label storefronts and
          wholesale packs to resellers, and neither a shopper nor an enterprise
          buyer can order one — it is reached from "Sell with us" instead. */}
      <CategoryRail
        title="Retail products"
        subtitle="Plans, devices, entertainment and connected home"
        categories={retail}
        counts={retailCounts}
        onNavigate={onNavigate}
      />
      <CategoryRail
        title="Enterprise products"
        subtitle="IoT, security and devices for your estate"
        categories={enterprise}
        counts={enterpriseCounts}
        onNavigate={onNavigate}
      />
    </>
  )
}
