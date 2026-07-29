import { Carousel } from './Carousel'
import { ProductRail } from './ProductRail'
import { HERO, CAROUSEL, BANNERS, RETAIL_PRODUCTS, ENTERPRISE_PRODUCTS } from '../../lib/assets'
import type { PublicPage } from '../../types/view'

export function LandingPage({ onNavigate }: { onNavigate: (p: PublicPage) => void }) {
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

      {/* Promo strip — 4 of the 12 banners. Decorative: every offer they show
          is reachable through the rails and the audience pages below. */}
      <section className="container" style={{ padding: '32px 24px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
        {BANNERS.slice(0, 4).map(src => (
          <img key={src} src={src} alt="" loading="lazy" style={{ width: '100%', borderRadius: 'var(--radius-md)' }} />
        ))}
      </section>

      <ProductRail title="Retail products" subtitle="Phones, wearables, entertainment and connected home" tiles={RETAIL_PRODUCTS} />
      <ProductRail title="Enterprise products" subtitle="IoT gateways, sensors, security and point of sale" tiles={ENTERPRISE_PRODUCTS} />
    </>
  )
}
