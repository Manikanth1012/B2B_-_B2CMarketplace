import { useState, useEffect } from 'react'
import { PublicProductGrid } from './PublicProductGrid'
import { CategoryShowcase } from './CategoryShowcase'
import { BANNERS } from '../../lib/assets'
import { loadCatalogue, loadCategories, countByCategory } from '../../lib/storefrontRepo'
import { loadPriceBook, loadCopyBook, repriceAll } from '../../lib/moneyRepo'
import { useMarket } from '../../lib/MarketContext'
import { productsForPage, categoriesForPage } from '../../lib/storefront'
import type { Category, Product } from '../../types'
import type { PublicPage, Persona } from '../../types/view'

type Aud = Exclude<PublicPage, 'landing'>

/* One component, three configurations. They differ in copy, imagery and
   destination — not structure. Three components would drift. */
const CONFIG: Record<Aud, {
  title: string; blurb: string; points: string[]
  cta: string; banner: string
  rail: { title: string; subtitle: string }
  persona: Persona
}> = {
  retail: {
    title: 'Everything for your everyday connection',
    blurb: 'Plans, phones, entertainment and home devices — bought in one place, billed in one place.',
    points: ['Plans and devices side by side', 'Reward points on every order', 'One bill, one support queue'],
    cta: 'Start shopping',
    banner: BANNERS[1],
    rail: { title: 'Popular with shoppers', subtitle: 'Phones, wearables and entertainment' },
    persona: 'consumer',
  },
  enterprise: {
    title: 'Procure connected hardware with approvals built in',
    blurb: 'IoT, security and devices for your estate — with spend limits, approval thresholds and one point of settlement.',
    points: ['Approval workflow before spend', 'Contract pricing on committed volume', 'Consolidated invoicing across sellers'],
    cta: 'Sign in to procure',
    banner: BANNERS[5],
    rail: { title: 'Built for business', subtitle: 'Gateways, sensors, security and point of sale' },
    persona: 'enterprise',
  },
  partner: {
    title: 'Sell to consumers and enterprises on one marketplace',
    blurb: 'List once, reach retail shoppers and business buyers, and get settled on a published cycle.',
    points: ['Seven onboarding gates, five working days', 'Commission published before you list', 'Settlement you can reconcile line by line'],
    cta: 'Sign in to your seller console',
    banner: BANNERS[3],
    rail: { title: 'What sells here', subtitle: 'All six marketplaces are open to new sellers — here is what is already listed in each' },
    persona: 'partner',
  },
}

export function AudiencePage({ page, onSignIn, onApply, onResumeApplication, onRegister, onApplyBusiness, onResumeBusiness, onAddToBasket }: {
  page: Aud
  onSignIn: (p: Persona) => void
  onApply: () => void
  /* Applying takes several sittings, so coming back needs its own way in
     rather than being a button inside the one that starts a new one. */
  onResumeApplication: () => void
  /* A shopper has to be able to become one. "Start shopping" reaches the
     catalogue and stops at the first basket, which is a sign-in screen with
     four demo accounts on it. */
  onRegister: () => void
  /* A business applies rather than registers: an account carries a credit
     limit, terms and approval thresholds, which somebody agrees. */
  onApplyBusiness: () => void
  onResumeBusiness: () => void
  onAddToBasket: (p: Product) => void
}) {
  const { market, currency } = useMarket()
  /* The chosen currency, not the market's default. Reading the default here
     while the formatter reads the choice is how a shilling price ends up under
     a dollar sign — the same relabelling the bills migration had to undo. */
  const currencyCode = currency?.code ?? market?.currency ?? 'USD'
  const c = CONFIG[page]
  const [catalogue, setCatalogue] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  useEffect(() => {
    /* Priced for the market too. A shopper who sees $18.00 before signing in
       and ₹1,599.00 after has been shown two different shops. */
    Promise.all([loadCatalogue(), loadPriceBook(currencyCode), loadCopyBook()])
      .then(([rows, book, copy]) => setCatalogue(repriceAll(rows, book, currencyCode, copy)))
    loadCategories().then(setCategories)
    /* The currency is a dependency: without it this closes over the first one
       it saw and the page keeps showing that market's prices forever. */
  }, [currencyCode])

  /* The same rows the operator's catalogue holds — name, seller, price, rating —
     narrowed to the categories this page covers and to what is actually live. */
  const products = productsForPage(catalogue, categories, page)

  return (
    <>
      <section style={{ background: 'var(--brand-navy)', color: 'white' }}>
        <div className="container" style={{ paddingTop: '56px', paddingBottom: '56px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 'var(--text-4xl)', fontWeight: 800, lineHeight: 1.15 }}>{c.title}</h1>
            <p style={{ fontSize: 'var(--text-lg)', color: 'rgba(255,255,255,0.75)', marginTop: '16px' }}>{c.blurb}</p>
            <ul style={{ listStyle: 'none', margin: '24px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {c.points.map(p => (
                <li key={p} style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.85)' }}>— {p}</li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: '12px', marginTop: '32px', flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-lg" onClick={() => onSignIn(c.persona)}>{c.cta}</button>
              {page === 'retail' && (
                <>
                <button className="btn btn-secondary btn-lg" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', borderColor: 'rgba(255,255,255,0.2)' }} onClick={onRegister}>
                  Create an account
                </button>
                <button
                  onClick={() => onSignIn('consumer')}
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    color: 'rgba(255,255,255,0.75)', fontSize: 'var(--text-sm)',
                    textDecoration: 'underline', textUnderlineOffset: '3px', alignSelf: 'center',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'white' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.75)' }}
                >
                  Sign in
                </button>
                </>
              )}
              {page === 'enterprise' && (
                <>
                <button className="btn btn-secondary btn-lg" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', borderColor: 'rgba(255,255,255,0.2)' }} onClick={onApplyBusiness}>
                  Apply for an account
                </button>
                <button
                  onClick={onResumeBusiness}
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    color: 'rgba(255,255,255,0.75)', fontSize: 'var(--text-sm)',
                    textDecoration: 'underline', textUnderlineOffset: '3px', alignSelf: 'center',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'white' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.75)' }}
                >
                  Continue an application
                </button>
                </>
              )}
              {page === 'partner' && (
                <>
                <button className="btn btn-secondary btn-lg" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', borderColor: 'rgba(255,255,255,0.2)' }} onClick={onApply}>
                  Apply to sell
                </button>
                <button
                  onClick={onResumeApplication}
                  style={{
                    background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                    color: 'rgba(255,255,255,0.75)', fontSize: 'var(--text-sm)',
                    textDecoration: 'underline', textUnderlineOffset: '3px', alignSelf: 'center',
                  }}
                  onMouseEnter={e => { e.currentTarget.style.color = 'white' }}
                  onMouseLeave={e => { e.currentTarget.style.color = 'rgba(255,255,255,0.75)' }}
                >
                  Continue an application
                </button>
                </>
              )}
            </div>
          </div>
          <img src={c.banner} alt="" style={{ width: '100%', borderRadius: 'var(--radius-lg)' }} />
        </div>
      </section>

      {/* The catalogue itself. A seller wants to know which marketplaces they can
          list into and what already sells in each, so the partner page shows the six
          categories with real listings under them; the two buyer pages list rows
          with a working basket. */}
      {page === 'partner' ? (
        <CategoryShowcase
          title={c.rail.title}
          subtitle={c.rail.subtitle}
          categories={categoriesForPage('partner', categories)}
          products={catalogue}
          /* The seller shop window deliberately shows every shelf and everything
             on it — a prospective seller is deciding what to list, not shopping. */
          counts={countByCategory(catalogue)}
        />
      ) : (
        <PublicProductGrid
          title={c.rail.title}
          subtitle={c.rail.subtitle}
          products={products}
          onAdd={onAddToBasket}
        />
      )}
    </>
  )
}
