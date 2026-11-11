import { useState, useEffect, useCallback, lazy, Suspense } from 'react'
import type { View, OperatorView, PartnerView, EnterpriseView, Persona, Session, Surface, PublicPage } from './types/view'
import { supabase } from './lib/supabase'
import { activeLines, basketCount } from './lib/basket'
import { bundleIdsOf, priceCartBundles, type BundleInfo } from './lib/bundleLines'
import { loadBundleInfo } from './lib/bundleBasketRepo'
import { BUNDLES_CHANGED } from './components/bundles/events'
import { registerBundleSink } from './components/bundles/handoff'
import { basketSink, requisitionSink } from './components/bundles/sinks'
import { NotifyMeModal } from './components/NotifyMeModal'
import { StockWatchCard } from './components/StockWatchCard'
import { isOpen as watchIsOpen, type Watch } from './lib/stockWatch'
import type { ConsumerProfile } from './types'
import { restoreSession, signOut } from './lib/authRepo'
import type { CartItem, Product } from './types'
import { MarketProvider, useMarket } from './lib/MarketContext'
import { loadPriceBook, loadCopyBook, reprice } from './lib/moneyRepo'
import { PublicShell } from './components/public/PublicShell'
import { Header } from './components/Header'
import { Footer } from './components/Footer'
import { ToastHost, toast } from './components/operator/shared'
import { OperatorShell } from './components/operator/OperatorShell'
import { PartnerShell } from './components/partner/PartnerShell'
import { EnterpriseShell } from './components/enterprise/EnterpriseShell'
import { RequisitionProvider } from './lib/RequisitionContext'
import { BundleConfiguratorHost } from './components/bundles/BundleConfigurator'
import { PageLoading } from './components/ui/PageLoading'

/* Loaded on demand, so each visitor downloads only the surface they are on.
 *
 * The shells (public chrome, the shop header and footer, each console's side
 * bar) stay in the main bundle and are drawn at once; what goes inside them
 * arrives as its own chunk behind a Suspense boundary. A visitor never fetches
 * a console, an operator never fetches the seller's or the buyer's, and the
 * shop's pages come down only once somebody is shopping. The modules export by
 * name, so each import picks its component out as the default `lazy` wants. */
const LoginScreen = lazy(() => import('./components/LoginScreen').then(m => ({ default: m.LoginScreen })))
const LandingPage = lazy(() => import('./components/public/LandingPage').then(m => ({ default: m.LandingPage })))
const AudiencePage = lazy(() => import('./components/public/AudiencePage').then(m => ({ default: m.AudiencePage })))
const ApplyToSell = lazy(() => import('./components/public/ApplyToSell').then(m => ({ default: m.ApplyToSell })))
const RegisterShopper = lazy(() => import('./components/public/RegisterShopper').then(m => ({ default: m.RegisterShopper })))
const ContinueWithAventaId = lazy(() => import('./components/public/ContinueWithAventaId').then(m => ({ default: m.ContinueWithAventaId })))
const OperatorScreens = lazy(() => import('./components/operator/OperatorScreens').then(m => ({ default: m.OperatorScreens })))
const PartnerScreens = lazy(() => import('./components/partner/PartnerScreens').then(m => ({ default: m.PartnerScreens })))
const EnterpriseScreens = lazy(() => import('./components/enterprise/EnterpriseScreens').then(m => ({ default: m.EnterpriseScreens })))
const Hero = lazy(() => import('./components/Hero').then(m => ({ default: m.Hero })))
const CategoryStrip = lazy(() => import('./components/CategoryStrip').then(m => ({ default: m.CategoryStrip })))
const ProductGrid = lazy(() => import('./components/ProductGrid').then(m => ({ default: m.ProductGrid })))
const ProductDetail = lazy(() => import('./components/ProductDetail').then(m => ({ default: m.ProductDetail })))
const CartDrawer = lazy(() => import('./components/CartDrawer').then(m => ({ default: m.CartDrawer })))
const Checkout = lazy(() => import('./components/Checkout').then(m => ({ default: m.Checkout })))
const OrdersView = lazy(() => import('./components/OrdersView').then(m => ({ default: m.OrdersView })))
const SubscriptionsView = lazy(() => import('./components/SubscriptionsView').then(m => ({ default: m.SubscriptionsView })))
const RewardsView = lazy(() => import('./components/RewardsView').then(m => ({ default: m.RewardsView })))
const AccountView = lazy(() => import('./components/AccountView').then(m => ({ default: m.AccountView })))
const KnowledgeBase = lazy(() => import('./components/KnowledgeBase').then(m => ({ default: m.KnowledgeBase })))

/* The market — and so the currency and the tax — is chosen once and read
   everywhere, so the provider wraps the app rather than sitting inside it.
   `App` returns early in several places (login, the public pages, each
   console), and a provider mounted below any of those would be missing on
   exactly the surfaces that show prices. */
export default function App() {
  return (
    <MarketProvider>
      <AppInner />
    </MarketProvider>
  )
}

function AppInner() {
  /* Where the shopper is buying, which decides both the price they are quoted
     and the rate they are taxed at. One source for both, because a basket that
     took its price from one place and its tax from another is how a Kenyan
     order came to carry Indian GST. */
  const { market, currency } = useMarket()
  const shopCurrency = currency?.code ?? market?.currency ?? 'USD'
  const shopTaxRate = Number(market?.tax_rate ?? 0)

  const [surface, setSurface] = useState<Surface>({ kind: 'public', page: 'landing' })
  const session = surface.kind === 'session' ? surface.session : null
  const persona = session?.persona ?? null
  const [view, setView] = useState<View>('home')
  const [opView, setOpView] = useState<OperatorView>('op-dashboard')
  /* Which record the screen we are navigating to should open.
     The dashboard lists work and had no way to hand a row on to the
     screen that can act on it, so every drill-down meant finding the
     row again by eye on the other side. */
  const [opFocus, setOpFocus] = useState<string | null>(null)
  const goOperator = (v: OperatorView, opts?: { focus?: string }) => {
    setOpFocus(opts?.focus ?? null)
    setOpView(v)
  }
  const [ptView, setPtView] = useState<PartnerView>('pt-dashboard')
  const [enView, setEnView] = useState<EnterpriseView>('en-dashboard')
  /* Which card on the destination screen to open at. The account menus offer
     "Sign-in & security" and "Sessions", and both are sections of a long
     profile page rather than screens of their own — without somewhere to put
     the section name, those items had nowhere to go and did nothing. */
  const [ptAnchor, setPtAnchor] = useState<string | undefined>()
  const [enAnchor, setEnAnchor] = useState<string | undefined>()
  const goPartner = (v: PartnerView, anchor?: string) => { setPtAnchor(anchor); setPtView(v) }
  const goEnterprise = (v: EnterpriseView, anchor?: string) => { setEnAnchor(anchor); setEnView(v) }
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [cartCount, setCartCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [accountTab, setAccountTab] = useState<string | undefined>(undefined)
  /* Held across the sign-in round trip: a visitor can browse the public catalogue
     without a session, but the basket is owner-scoped, so the first add has to
     become a sign-in and then finish itself. */
  const [pendingProduct, setPendingProduct] = useState<Product | null>(null)
  const [notifyProduct, setNotifyProduct] = useState<Product | null>(null)
  const [watching, setWatching] = useState<Set<string>>(new Set())
  const [consumerProfile, setConsumerProfile] = useState<ConsumerProfile | null>(null)

  /* Which products already have an open alert, so a tile can say "you will be told"
     rather than offering to sign the shopper up a second time. */
  const loadWatches = useCallback(async () => {
    const { data } = await supabase.from('stock_watch').select('*')
    const open = ((data ?? []) as Watch[]).filter(watchIsOpen).map(w => w.product_id)
    setWatching(new Set(open))
  }, [])

  /* The basket is priced the same way the shelf is.
   *
   * `products(*)` is the base row, and its `price` is the dollar list price. The
   * shelves have gone through `repriceAll` since prices became per-market, and
   * the basket never did — so a product the grid showed at ₹549 went into the
   * cart at $6.49 and the checkout wrote an order for that. The number was
   * right for a currency nobody was shopping in, which is the failure mode with
   * no visible symptom until somebody reads two screens at once.
   *
   * Reloaded when the market changes, for the same reason the grid is: a basket
   * left over from a different currency is a basket priced in it. */
  const loadCart = useCallback(async () => {
    const [{ data: cart }, book, copy] = await Promise.all([
      supabase.from('cart_items')
        .select('*, product:products(*)')
        .order('created_at', { ascending: false }),
      loadPriceBook(shopCurrency),
      loadCopyBook(),
    ])
    if (cart) {
      const shelf = (cart as CartItem[]).map(l => ({
        ...l,
        product: l.product ? reprice(l.product, book, shopCurrency, copy) : l.product,
      }))
      /* A configured bundle's parts are priced by their selection, not the
         book. No bundle lines (or no bundles migration) and this is a no-op. */
      const ids = bundleIdsOf(shelf)
      let info = new Map<string, BundleInfo>()
      if (ids.length) {
        const got = await loadBundleInfo(ids)
        if (got.ok) info = got.value
      }
      const lines = ids.length ? priceCartBundles(shelf, info) : shelf
      setCartItems(lines)
      /* Saved lines are in the basket but not of it — the badge counts what is
         actually being bought. */
      setCartCount(basketCount(lines))
    }
  }, [shopCurrency])

  useEffect(() => {
    loadCart().then(() => setLoading(false))
  }, [loadCart])

  /* A bundle added, edited or removed elsewhere (the configurator, the drawer). */
  useEffect(() => {
    const reload = () => { void loadCart() }
    window.addEventListener(BUNDLES_CHANGED, reload)
    return () => window.removeEventListener(BUNDLES_CHANGED, reload)
  }, [loadCart])

  /* Where the configurator's "Add bundle" goes: a shopper's basket, or a
     business buyer's requisition. Registered only for the persona that has
     one, so a visitor or an operator is told it is not available rather than
     writing a selection nothing will take. */
  useEffect(() => {
    if (persona === 'consumer') return registerBundleSink('basket', basketSink)
    if (persona === 'enterprise') return registerBundleSink('requisition', requisitionSink)
    return undefined
  }, [persona])


  const navigate = (v: View, opts?: { category?: string; product?: Product; tab?: string }) => {
    if (opts?.category !== undefined) setSelectedCategory(opts.category)
    if (opts?.product !== undefined) setSelectedProduct(opts.product)
    if (opts?.tab !== undefined) setAccountTab(opts.tab)
    else setAccountTab(undefined)
    setView(v)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /* Asks the database what is already in the basket rather than trusting the copy
     in state. Signing in mid-flow adds a row before `cartItems` has been reloaded
     for the new session, and reading the stale copy would insert a duplicate. */
  const addToCart = async (product: Product, quantity = 1) => {
    /* Bundle parts are not this product's line: their quantity belongs to the
       bundle, and the database refuses a change to it. `*` rather than naming
       bundle_selection_id, so this reads the same before the bundles migration. */
    const { data: rows } = await supabase
      .from('cart_items')
      .select('*')
      .eq('product_id', product.id)
    const existing = ((rows ?? []) as { id: string; quantity: number; bundle_selection_id?: string | null }[])
      .find(r => !r.bundle_selection_id) ?? null

    if (existing) {
      await supabase
        .from('cart_items')
        .update({ quantity: existing.quantity + quantity })
        .eq('id', existing.id)
    } else {
      await supabase
        .from('cart_items')
        .insert({ product_id: product.id, quantity })
    }
    await loadCart()
    setCartOpen(true)
  }

  const updateCartQuantity = async (itemId: string, quantity: number) => {
    if (quantity <= 0) {
      await supabase.from('cart_items').delete().eq('id', itemId)
    } else {
      await supabase.from('cart_items').update({ quantity }).eq('id', itemId)
    }
    await loadCart()
  }

  /* Moving between basket and saved is a flag flip, not a copy — same row, same
     quantity, so the two lists can never disagree about what is in them. */
  const setSaved = async (itemId: string, saved: boolean) => {
    await supabase.from('cart_items').update({ saved }).eq('id', itemId)
    await loadCart()
  }

  const removeFromCart = async (itemId: string) => {
    await supabase.from('cart_items').delete().eq('id', itemId)
    await loadCart()
  }

  const clearCart = async () => {
    await supabase.from('cart_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await loadCart()
  }

  const handleLogin = (s: Session) => {
    setSurface({ kind: 'session', session: s })
    if (s.persona === 'operator') setOpView('op-dashboard')
    /* Every persona lands on its dashboard. "Apply to sell" used to route a
       partner to Onboarding instead, carrying an intent flag across the sign-in
       round trip — it does not go through sign-in any more, because an
       applicant has no credentials to sign in with. */
    else if (s.persona === 'partner') setPtView('pt-dashboard')
    else if (s.persona === 'enterprise') setEnView('en-dashboard')
    else setView('home')

    /* The product the visitor picked before they had a session. `cart_items` is
       owner-scoped, so there was nowhere to put it until now — this is the add
       they already asked for, completed on the other side of the sign-in.
       Dropped for any other persona: an operator's basket is not a thing. */
    /* The basket is owner-scoped, so the mount-time load ran as a signed-out
       visitor and came back empty. Without this the customer signs in to an empty
       basket and only sees their real one after touching it. */
    if (s.persona === 'consumer') {
      void loadCart()
      void loadWatches()
      void supabase.from('consumer_profile').select('*').maybeSingle()
        .then(({ data }) => setConsumerProfile((data as ConsumerProfile) ?? null))
    }

    const pending = pendingProduct
    setPendingProduct(null)
    if (pending && s.persona === 'consumer') {
      void addToCart(pending)
    }

    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  /* Sign-in issues a real JWT that outlives the page, so a reload has to land
     back in the console the user was in rather than on the landing page. */
  useEffect(() => {
    restoreSession().then((s) => { if (s) handleLogin(s) })
    // handleLogin is stable for this purpose — it only ever sets state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSignOut = async () => {
    /* Clear the surface first: the console should not stay on screen while the
       network round trip runs, and a failed revoke must not strand the user in
       a console they asked to leave. */
    setSurface({ kind: 'public', page: 'landing' })
    setView('home')
    setOpView('op-dashboard'); setPtView('pt-dashboard'); setEnView('en-dashboard')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    await signOut()
  }

  // ---------- Public surface ----------
  /* The sign-in, application and registration screens are whole pages with no
     shell around them, so their placeholder fills the window. */
  if (surface.kind === 'login') {
    return (
      <Suspense fallback={<PageLoading fill />}>
      <LoginScreen
        prefill={surface.prefill}
        demo={surface.demo}
        onLogin={handleLogin}
        /* Back to the page they were on. The audience pages are where every real
           sign-in starts, so that is where cancelling returns to. */
        onBack={() => setSurface({
          kind: 'public',
          page: surface.prefill === 'partner' ? 'partner'
            : surface.prefill === 'enterprise' ? 'enterprise'
            : surface.prefill === 'consumer' ? 'retail'
            : 'landing',
        })}
        /* Whatever "get an account" means for the audience they arrived as. */
        onSso={() => { setSurface({ kind: 'sso' }); window.scrollTo({ top: 0 }) }}
        onNewAccount={() => {
          if (surface.prefill === 'partner') setSurface({ kind: 'apply' })
          else if (surface.prefill === 'enterprise') setSurface({ kind: 'apply', kindOf: 'business' })
          else if (surface.prefill === 'operator') setSurface({ kind: 'public', page: 'landing' })
          else setSurface({ kind: 'register' })
          window.scrollTo({ top: 0 })
        }}
        /* The notice exists because the visitor arrives here as the consequence
           of a click somewhere else, and a sign-in screen that does not say why
           it appeared reads as having lost their place. */
        notice={
          pendingProduct
            ? `Sign in to add "${pendingProduct.name}" to your basket.`
            : undefined
        }
      />
      </Suspense>
    )
  }

  /* Applying to sell, which is where "Apply to sell" now goes. It used to open
     the sign-in screen with a notice explaining that the journey started in the
     seller console — true, and no use at all to somebody who has never been a
     seller and so has no credentials to get into it. */
  if (surface.kind === 'apply') {
    return (
      <Suspense fallback={<PageLoading fill />}>
      <ApplyToSell
        /* Somebody arriving from "Continue an application" opens straight on
           the reference-and-code form. Landing them on the start form and
           making them find the resume button is how a returning applicant
           starts a second application by mistake. */
        kindOf={surface.kindOf ?? 'seller'}
        startAt={surface.resume ? 'resume' : 'start'}
        onLeave={() => {
          setSurface({ kind: 'public', page: surface.kindOf === 'business' ? 'enterprise' : 'partner' })
          window.scrollTo({ top: 0 })
        }}
        onSignIn={() => setSurface({ kind: 'login', prefill: surface.kindOf === 'business' ? 'enterprise' : 'partner' })}
      />
      </Suspense>
    )
  }

  /* Registering as a shopper. `handleLogin` is the same one sign-in uses, so a
     new customer lands where a returning one does and the basket, watches and
     profile are loaded for them on the way. */
  if (surface.kind === 'register') {
    return (
      <Suspense fallback={<PageLoading fill />}>
      <RegisterShopper
        onLeave={() => { setSurface({ kind: 'public', page: 'retail' }); window.scrollTo({ top: 0 }) }}
        onSignIn={() => setSurface({ kind: 'login', prefill: 'consumer' })}
        onSso={() => { setSurface({ kind: 'sso' }); window.scrollTo({ top: 0 }) }}
        onRegistered={(session) => handleLogin(session)}
      />
      </Suspense>
    )
  }

  /* Opening an account from an identity the telco already holds. Lands through
     the same `handleLogin` the form and the sign-in screen use, so a customer
     who came in this way reaches the same console with the same basket,
     watches and profile loaded on the way. */
  if (surface.kind === 'sso') {
    return (
      <Suspense fallback={<PageLoading fill />}>
      <ContinueWithAventaId
        onLeave={() => { setSurface({ kind: 'public', page: 'retail' }); window.scrollTo({ top: 0 }) }}
        onRegisterInstead={() => { setSurface({ kind: 'register' }); window.scrollTo({ top: 0 }) }}
        onDone={(session) => handleLogin(session)}
      />
      </Suspense>
    )
  }

  if (surface.kind === 'public') {
    /* A stock watch belongs to a signed-in shopper, so a visitor is sent to sign
       in. Unlike the basket, the product is not carried through; they reopen it. */
    const signInToWatch = () => { setSurface({ kind: 'login', prefill: 'consumer' }); window.scrollTo({ top: 0 }) }
    return (
      <PublicShell
        page={surface.page}
        onNavigate={(page) => { setSurface({ kind: 'public', page }); window.scrollTo({ top: 0 }) }}
        onDemoSignIn={() => setSurface({ kind: 'login', demo: true })}
        onSearch={(q) => { setSurface({ kind: 'public', page: 'retail', q }); window.scrollTo({ top: 0 }) }}
      >
        <Suspense fallback={<PageLoading />}>
        {surface.page === 'landing' && (
          <LandingPage
            onNavigate={(page) => { setSurface({ kind: 'public', page }); window.scrollTo({ top: 0 }) }}
            /* Same as the audience pages: the basket needs an owner, so the first
               add sends the visitor to sign in and completes it afterwards. */
            onAddToBasket={(p) => {
              setPendingProduct(p)
              setSurface({ kind: 'login', prefill: 'consumer' })
              window.scrollTo({ top: 0 })
            }}
            onNotifyMe={signInToWatch}
          />
        )}
        {surface.page !== 'landing' && (
          <AudiencePage
            /* A new search remounts the page so its filters start from the query. */
            key={`${surface.page}:${surface.q ?? ''}`}
            page={surface.page}
            initialQuery={surface.q}
            onSignIn={(p) => setSurface({ kind: 'login', prefill: p })}
            onApply={() => { setSurface({ kind: 'apply' }); window.scrollTo({ top: 0 }) }}
            onResumeApplication={() => { setSurface({ kind: 'apply', resume: true }); window.scrollTo({ top: 0 }) }}
            onRegister={() => { setSurface({ kind: 'register' }); window.scrollTo({ top: 0 }) }}
            onApplyBusiness={() => { setSurface({ kind: 'apply', kindOf: 'business' }); window.scrollTo({ top: 0 }) }}
            onResumeBusiness={() => { setSurface({ kind: 'apply', kindOf: 'business', resume: true }); window.scrollTo({ top: 0 }) }}
            /* Anyone can browse; the basket needs an owner. The first add sends
               the visitor to sign in and is completed for them afterwards. */
            onAddToBasket={(p) => {
              setPendingProduct(p)
              setSurface({ kind: 'login', prefill: 'consumer' })
              window.scrollTo({ top: 0 })
            }}
            onNotifyMe={signInToWatch}
          />
        )}
        </Suspense>
        {/* Visitors can configure and see the price; adding needs a sign-in. */}
        <BundleConfiguratorHost shop="consumer" signedIn={false}
          onSignIn={() => setSurface({ kind: 'login', prefill: 'consumer' })} />
      </PublicShell>
    )
  }

  // ---------- Operator persona ----------
  if (persona === 'operator') {
    return (
      <>
      <OperatorShell view={opView} onNavigate={(v, anchor) => goOperator(v, anchor ? { focus: anchor } : undefined)} onSignOut={handleSignOut}>
        <Suspense fallback={<PageLoading />}>
          <OperatorScreens view={opView} focus={opFocus} onNavigate={goOperator} onSetView={setOpView} />
        </Suspense>
      </OperatorShell>
      {/* Mounted in every persona, not only the shopper's.

          It lived in the consumer branch alone, and the three consoles return
          before ever reaching it — so every toast the operator, seller and
          business screens raised went to a host that was not on the page. A
          refusal that renders nowhere is indistinguishable from a button that
          does nothing, which is what the catalogue's Add appeared to be. */}
      <ToastHost />
      </>
    )
  }

  // ---------- Partner persona ----------
  if (persona === 'partner') {
    return (
      <>
      <PartnerShell view={ptView} onNavigate={goPartner} onSignOut={handleSignOut}>
        <Suspense fallback={<PageLoading />}>
          <PartnerScreens view={ptView} partnerId={session?.partnerId} anchor={ptAnchor} onSetView={setPtView} />
        </Suspense>
      </PartnerShell>
      {/* Mounted in every persona, not only the shopper's.

          It lived in the consumer branch alone, and the three consoles return
          before ever reaching it — so every toast the operator, seller and
          business screens raised went to a host that was not on the page. A
          refusal that renders nowhere is indistinguishable from a button that
          does nothing, which is what the catalogue's Add appeared to be. */}
      <ToastHost />
      </>
    )
  }

  // ---------- Enterprise persona ----------
  if (persona === 'enterprise') {
    return (
      /* The requisition being built wraps the whole console rather than sitting
         inside the catalogue, because a buyer fills it on one screen and raises
         it from wherever they happen to be. */
      <RequisitionProvider>
      <EnterpriseShell view={enView} onNavigate={goEnterprise} onSignOut={handleSignOut}>
        <Suspense fallback={<PageLoading />}>
          <EnterpriseScreens view={enView} anchor={enAnchor} onSetView={setEnView} />
        </Suspense>
        {/* One configurator for the whole console, opened by any bundle card. */}
        <BundleConfiguratorHost shop="enterprise" onOpenEnquiries={() => setEnView('en-enquiries')} />
      </EnterpriseShell>
      {/* Mounted in every persona, not only the shopper's.

          It lived in the consumer branch alone, and the three consoles return
          before ever reaching it — so every toast the operator, seller and
          business screens raised went to a host that was not on the page. A
          refusal that renders nowhere is indistinguishable from a button that
          does nothing, which is what the catalogue's Add appeared to be. */}
      <ToastHost />
      </RequisitionProvider>
    )
  }

  // ---------- Consumer persona ----------
  return (
    <>
      <Header
        cartCount={cartCount}
        onCartClick={() => setCartOpen(true)}
        onNavigate={navigate}
        onSignOut={handleSignOut}
        currentView={view}
      />
      <main>
        {loading && <div style={{ textAlign: 'center', padding: '60px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>}
        <Suspense fallback={<PageLoading />}>
        {!loading && view === 'home' && (
          <>
            <Hero onNavigate={navigate} />
            <CategoryStrip onNavigate={navigate} />
            <ProductGrid
              onNavigate={navigate}
              onAddToCart={addToCart}
              onNotifyMe={setNotifyProduct}
              watching={watching}
            />
          </>
        )}
        {!loading && view === 'category' && (
          <ProductGrid
            categoryFilter={selectedCategory}
            onNavigate={navigate}
            onAddToCart={addToCart}
            onNotifyMe={setNotifyProduct}
            watching={watching}
          />
        )}
        {!loading && view === 'product' && selectedProduct && (
          <ProductDetail
            product={selectedProduct}
            onAddToCart={addToCart}
            onNavigate={navigate}
            onNotifyMe={setNotifyProduct}
          />
        )}
        {!loading && view === 'checkout' && (
          <Checkout
            cartItems={activeLines(cartItems)}
            onClearCart={clearCart}
            onComplete={() => navigate('home')}
          />
        )}
        {!loading && view === 'orders' && <OrdersView />}
        {!loading && view === 'subscriptions' && <SubscriptionsView />}
        {!loading && view === 'rewards' && <RewardsView />}
        {!loading && view === 'account' && <AccountView initialTab={accountTab} onWatchesChanged={loadWatches} />}
        {!loading && view === 'kb' && <div className="container" style={{ paddingTop: '32px', paddingBottom: '32px' }}><KnowledgeBase persona="consumer" title="How things work" feedbackAs={{ actor: 'Priya Raman', org: 'Consumer' }} /></div>}
        </Suspense>
      </main>
      <Footer onNavigate={navigate} />

      {notifyProduct && (
        <NotifyMeModal
          product={notifyProduct}
          profile={consumerProfile}
          onClose={() => setNotifyProduct(null)}
          onWatched={async (p) => {
            setNotifyProduct(null)
            await loadWatches()
            toast(`We will tell you when ${p.name} is back`)
          }}
        />
      )}

      {/* No placeholder: the drawer is closed until asked for, and its code has
          long arrived by the time anybody reaches for the basket. */}
      <Suspense fallback={null}>
      <CartDrawer
        open={cartOpen}
        items={cartItems}
        onClose={() => setCartOpen(false)}
        onUpdateQuantity={updateCartQuantity}
        onRemove={removeFromCart}
        onSetSaved={setSaved}
        onCheckout={() => {
          setCartOpen(false)
          navigate('checkout')
        }}
      />
      </Suspense>
      {/* One configurator for the shop, opened by bundle cards and Edit bundle. */}
      <BundleConfiguratorHost shop="consumer" />
      <ToastHost />
    </>
  )
}
