import { useState, useEffect, useMemo } from 'react'
import { PublicProductModal } from './PublicProductModal'
import { CategoryShowcase } from './CategoryShowcase'
import { BANNERS } from '../../lib/assets'
import { loadCatalogue, loadCategories, countByCategory } from '../../lib/storefrontRepo'
import { loadPriceBookResult, loadCopyBookResult, repriceAll } from '../../lib/moneyRepo'
import { useMarket } from '../../lib/MarketContext'
import { productsForPage, categoriesForPage, pricedFor, cardAction } from '../../lib/storefront'
import { filterProducts, SORT_OPTIONS } from '../../lib/listing'
import type { SortKey } from '../../lib/listing'
import { stockLabel } from '../../lib/compare'
import { ProductCard, ListingLayout, ListingGrid, EmptyListing } from '../ui'
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
    /* Unused on retail — the hero's one button registers. Kept so the three
       pages share a shape, and because `cta` is the sign-in label for the other
       two rather than something invented per page. */
    cta: 'Sign in to shop',
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

export function AudiencePage({ page, onSignIn, onApply, onResumeApplication, onRegister, onApplyBusiness, onResumeBusiness, onAddToBasket, initialQuery }: {
  page: Aud
  /* A search from the header lands here with its words already applied. */
  initialQuery?: string
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
  /* Until the catalogue arrives the shelf is empty, which must not read as
     "nothing matches". */
  const [loaded, setLoaded] = useState(false)
  /* Bumped by Try again to re-run the load. */
  const [reloadKey, setReloadKey] = useState(0)
  /* A failed price read is not "nothing priced for your market"; say so and offer a retry. */
  const [priceError, setPriceError] = useState(false)
  /* Which product is open. Held here rather than inside the grid because the
     partner page shows categories instead of a grid, and the modal belongs to
     the page either way. */
  const [viewing, setViewing] = useState<Product | null>(null)

  useEffect(() => {
    let live = true
    setLoaded(false)
    /* Priced for the market too. A shopper who sees $18.00 before signing in
       and ₹1,599.00 after has been shown two different shops. */
    /* Categories are awaited too: the shelf is empty until both are in, and that
       must not flash "nothing here". */
    Promise.all([loadCatalogue(), loadPriceBookResult(currencyCode), loadCopyBookResult(), loadCategories()])
      .then(([rows, book, copy, cats]) => {
        if (!live) return
        setPriceError(!book.ok) /* copy only adds per-market wording; repriceAll falls back without it */
        setCatalogue(repriceAll(rows, book.ok ? book.value : new Map(), currencyCode, copy.ok ? copy.value : undefined))
        setCategories(cats)
        setLoaded(true)
      })
      /* A rejection must not leave the spinner up; an empty catalogue then
         reads as "couldn't load". */
      .catch(() => { if (live) setLoaded(true) })
    /* The currency is a dependency: without it this closes over the first one
       it saw and the page keeps showing that market's prices forever. */
    return () => { live = false }
  }, [currencyCode, reloadKey])

  /* The same rows the operator's catalogue holds — name, seller, price, rating —
     narrowed to the categories this page covers and to what is actually live. */
  /* The whole shelf, not the first twelve: filtering and counting have to see
     everything, and the market rule hides what this market does not price. */
  const shelf = useMemo(
    () => pricedFor(productsForPage(catalogue, categories, page, Infinity), currencyCode),
    [catalogue, categories, page, currencyCode],
  )
  const [search, setSearch] = useState(initialQuery ?? '')
  const [sub, setSub] = useState<string | null>(null)
  const [stock, setStock] = useState<string | null>(null)
  const [sort, setSort] = useState('featured')
  const shown = useMemo(
    () => filterProducts(shelf, { search, sub, stock, sort: sort as SortKey }),
    [shelf, search, sub, stock, sort],
  )
  const subCategories = useMemo(() => Array.from(new Set(shelf.map(p => p.sub_category))).sort(), [shelf])
  const stocks = useMemo(() => Array.from(new Set(shelf.map(p => p.stock))), [shelf])
  const clearFilters = () => { setSearch(''); setSub(null); setStock(null) }

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
              {/* Retail has one action, and it is registering.
                  "Start shopping" did not shop — it called `onSignIn`, which is
                  the same thing the Sign in link beside it did, so the hero
                  carried two controls for one action with the louder one
                  mislabelled. A returning customer reaches the same screen from
                  Demo sign-in in the header, and somebody who lands on Create an
                  account by mistake is offered Sign in there. */}
              {page === 'retail' ? (
                <>
                <button className="btn btn-primary btn-lg" onClick={onRegister}>
                  Create an account
                </button>
                {/* Sign in stays. What went was "Start shopping", which called
                    `onSignIn` and so was this link wearing a label that
                    described something else. */}
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
              ) : (
                <button className="btn btn-primary btn-lg" onClick={() => onSignIn(c.persona)}>{c.cta}</button>
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

      {/* Sales talks to signed-in business buyers, where the question can be
          answered against the account's own terms and catalogue. So Contact
          Sales signs in; a company without an account applies for one. */}
      {page === 'enterprise' && (
        <section className="enq-public" aria-labelledby="enq-public-title">
          <div className="container enq-public__inner">
            <div>
              <h2 id="enq-public-title" className="enq-public__title">Talk to sales</h2>
              <p className="enq-public__text">
                Volume pricing, a demo, or something not on the catalogue: sign in and ask from your console.
                No business account yet?{' '}
                <button type="button" className="enq-public__link" onClick={onApplyBusiness}>Apply for one</button>.
              </p>
            </div>
            <button type="button" className="btn btn-primary btn-lg" onClick={() => onSignIn('enterprise')}>
              Contact Sales
            </button>
          </div>
        </section>
      )}

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
        <section style={{ paddingTop: '40px', paddingBottom: '40px' }}>
          <ListingLayout
            headingLevel="h2"
            title={c.rail.title}
            subtitle={c.rail.subtitle}
            count={shown.length}
            total={shelf.length}
            search={{ value: search, onChange: setSearch, placeholder: 'Search this shelf' }}
            sort={{ value: sort, options: SORT_OPTIONS, onChange: setSort }}
            filters={[
              {
                id: 'sub', title: 'Type', selected: sub, onSelect: setSub,
                options: subCategories.map(s => ({ value: s, label: s, count: shelf.filter(p => p.sub_category === s).length })),
              },
              {
                id: 'stock', title: 'Availability', selected: stock, onSelect: setStock,
                options: stocks.map(v => ({ value: v, label: stockLabel(v), count: shelf.filter(p => p.stock === v).length })),
              },
            ]}
            onClear={clearFilters}
          >
            {!loaded ? (
              <div style={{ textAlign: 'center', padding: '64px' }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
              </div>
            ) : catalogue.length === 0 ? (
              /* The loaders return nothing on any error, so a wholly empty
                 catalogue is a failed load, not a claim about this market. */
              <EmptyListing
                title="We couldn't load the products"
                text="Please check your connection and try again."
                onClear={() => setReloadKey(k => k + 1)}
                actionLabel="Try again"
              />
            ) : priceError ? (
              <EmptyListing
                title="We couldn't load prices just now."
                text="Please check your connection and try again."
                onClear={() => setReloadKey(k => k + 1)}
                actionLabel="Retry"
              />
            ) : shelf.length === 0 ? (
              <EmptyListing
                title="Nothing here for your market yet"
                text={`No products on this page are priced for ${market?.name ?? 'your market'} yet. Try another market from the picker in the header.`}
              />
            ) : shown.length === 0 ? (
              <EmptyListing title="No products match" text="Try a different search or clear the filters." onClear={clearFilters} />
            ) : (
              <ListingGrid>
                {shown.map(p => (
                  <ProductCard
                    key={p.id}
                    product={p}
                    onOpen={() => setViewing(p)}
                    action={{ ...cardAction('retail', p), onClick: () => onAddToBasket(p) }}
                    showStock
                    priceNote={p.unit ?? undefined}
                  />
                ))}
              </ListingGrid>
            )}
          </ListingLayout>
        </section>
      )}

      <PublicProductModal
        product={viewing}
        onClose={() => setViewing(null)}
        onAddToBasket={onAddToBasket}
      />
    </>
  )
}
