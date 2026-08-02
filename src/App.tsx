import { useState, useEffect, useCallback } from 'react'
import type { View, OperatorView, PartnerView, EnterpriseView, Persona, Session, Surface, PublicPage } from './types/view'
import { supabase } from './lib/supabase'
import { activeLines, basketCount } from './lib/basket'
import { NotifyMeModal } from './components/NotifyMeModal'
import { StockWatchCard } from './components/StockWatchCard'
import { isOpen as watchIsOpen, type Watch } from './lib/stockWatch'
import type { ConsumerProfile } from './types'
import { restoreSession, signOut } from './lib/authRepo'
import type { CartItem, Product } from './types'
import { MarketProvider } from './lib/MarketContext'
import { LoginScreen } from './components/LoginScreen'
import { PublicShell } from './components/public/PublicShell'
import { LandingPage } from './components/public/LandingPage'
import { AudiencePage } from './components/public/AudiencePage'
import { Header } from './components/Header'
import { Hero } from './components/Hero'
import { CategoryStrip } from './components/CategoryStrip'
import { ProductGrid } from './components/ProductGrid'
import { ProductDetail } from './components/ProductDetail'
import { CartDrawer } from './components/CartDrawer'
import { Checkout } from './components/Checkout'
import { Footer } from './components/Footer'
import { OrdersView } from './components/OrdersView'
import { SubscriptionsView } from './components/SubscriptionsView'
import { RewardsView } from './components/RewardsView'
import { AccountView } from './components/AccountView'
import { OperatorShell } from './components/operator/OperatorShell'
import { OperatorDashboard } from './components/operator/OperatorDashboard'
import { OperatorOnboarding } from './components/operator/OperatorOnboarding'
import { OperatorPartners } from './components/operator/OperatorPartners'
import { OperatorCatalogue } from './components/operator/OperatorCatalogue'
import { OperatorSettlement } from './components/operator/OperatorSettlement'
import { OperatorInventory } from './components/operator/OperatorInventory'
import { OperatorTickets } from './components/operator/OperatorTickets'
import { OperatorDunning } from './components/operator/OperatorDunning'
import { OperatorDeveloper } from './components/operator/OperatorDeveloper'
import { OperatorPromotions } from './components/operator/OperatorPromotions'
import { OperatorBanners } from './components/operator/OperatorBanners'
import { OperatorBillTemplates } from './components/operator/OperatorBillTemplates'
import { OperatorKnowledge } from './components/operator/OperatorKnowledge'
import { OperatorChannels } from './components/operator/OperatorChannels'
import { OperatorRoles } from './components/operator/OperatorRoles'
import { OperatorAudit } from './components/operator/OperatorAudit'
import { OperatorReviews } from './components/operator/OperatorReviews'
import { OperatorWallets } from './components/operator/OperatorWallets'
import { OperatorContentFeedback } from './components/operator/OperatorContentFeedback'
import { ToastHost, toast } from './components/operator/shared'
import { PartnerShell } from './components/partner/PartnerShell'
import { PartnerDashboard } from './components/partner/PartnerDashboard'
import { PartnerOnboarding } from './components/partner/PartnerOnboarding'
import { PartnerListings } from './components/partner/PartnerListings'
import { PartnerNewListing } from './components/partner/PartnerNewListing'
import { PartnerOrders } from './components/partner/PartnerOrders'
import { PartnerSettlement } from './components/partner/PartnerSettlement'
import { PartnerSettlementPlan } from './components/partner/PartnerSettlementPlan'
import { PartnerPerformance } from './components/partner/PartnerPerformance'
import { PartnerIntegrations } from './components/partner/PartnerIntegrations'
import { PartnerSupport } from './components/partner/PartnerSupport'
import { PartnerTeam, PartnerAudit } from './components/partner/PartnerMisc'
import { PartnerDetails } from './components/partner/PartnerDetails'
import { PartnerNotifications } from './components/partner/PartnerNotifications'
import { PartnerRefunds } from './components/partner/PartnerRefunds'
import { OperatorRefunds } from './components/operator/OperatorRefunds'
import { OperatorRewards } from './components/operator/OperatorRewards'
import { OperatorRevenueShare } from './components/operator/OperatorRevenueShare'
import { OperatorLedger } from './components/operator/OperatorLedger'
import { OperatorNotifications } from './components/operator/OperatorNotifications'
import { PartnerRewards } from './components/partner/PartnerRewards'
import { PartnerReviews } from './components/partner/PartnerReviews'
import { EnterpriseShell } from './components/enterprise/EnterpriseShell'
import { EnterpriseDashboard } from './components/enterprise/EnterpriseDashboard'
import { EnterpriseBrowse } from './components/enterprise/EnterpriseBrowse'
import { EnterpriseSubs, EnterpriseMarketplace } from './components/enterprise/EnterpriseViews'
import { EnterpriseOrders } from './components/enterprise/EnterpriseOrders'
import { EnterpriseAudit } from './components/enterprise/EnterpriseMisc'
import { EnterpriseTeam } from './components/enterprise/EnterpriseTeam'
import { EnterpriseProfile } from './components/enterprise/EnterpriseProfile'
import { EnterpriseNotifications } from './components/enterprise/EnterpriseNotifications'
import { EnterpriseApprovals } from './components/enterprise/EnterpriseApprovals'
import { EnterpriseRefunds } from './components/enterprise/EnterpriseRefunds'
import { EnterpriseBilling } from './components/enterprise/EnterpriseBilling'
import { EnterpriseRewards } from './components/enterprise/EnterpriseRewards'
import { EnterpriseSupport } from './components/enterprise/EnterpriseSupport'
import { KnowledgeBase } from './components/KnowledgeBase'

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
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [cartCount, setCartCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [accountTab, setAccountTab] = useState<string | undefined>(undefined)
  const [applyIntent, setApplyIntent] = useState(false)
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

  const loadCart = useCallback(async () => {
    const { data: cart } = await supabase
      .from('cart_items')
      .select('*, product:products(*)')
      .order('created_at', { ascending: false })
    if (cart) {
      const lines = cart as CartItem[]
      setCartItems(lines)
      /* Saved lines are in the basket but not of it — the badge counts what is
         actually being bought. */
      setCartCount(basketCount(lines))
    }
  }, [])

  useEffect(() => {
    loadCart().then(() => setLoading(false))
  }, [loadCart])


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
    const { data: existing } = await supabase
      .from('cart_items')
      .select('id, quantity')
      .eq('product_id', product.id)
      .maybeSingle()

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
    /* "Apply to sell" now goes via the login screen, so the intent has to
       outlive the round trip to land on Onboarding rather than the dashboard. */
    else if (s.persona === 'partner') setPtView(applyIntent ? 'pt-onboarding' : 'pt-dashboard')
    else if (s.persona === 'enterprise') setEnView('en-dashboard')
    else setView('home')
    setApplyIntent(false)

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
  if (surface.kind === 'login') {
    return (
      <LoginScreen
        prefill={surface.prefill}
        onLogin={handleLogin}
        /* Both notices exist for the same reason: the visitor arrives here as
           the consequence of a click somewhere else, and a sign-in screen that
           does not say why it appeared reads as having lost their place. */
        notice={
          pendingProduct
            ? `Sign in to add "${pendingProduct.name}" to your basket.`
            : applyIntent
            ? 'Applying to sell starts in the seller console. Sign in as a partner and you will land on the onboarding journey — seven gates, five working days once we have what each one asks for.'
            : undefined
        }
      />
    )
  }

  if (surface.kind === 'public') {
    return (
      <PublicShell
        page={surface.page}
        onNavigate={(page) => { setSurface({ kind: 'public', page }); window.scrollTo({ top: 0 }) }}
        onDemoSignIn={() => setSurface({ kind: 'login' })}
      >
        {surface.page === 'landing' && <LandingPage onNavigate={(page) => { setSurface({ kind: 'public', page }); window.scrollTo({ top: 0 }) }} />}
        {surface.page !== 'landing' && (
          <AudiencePage
            page={surface.page}
            onSignIn={(p) => setSurface({ kind: 'login', prefill: p })}
            onApply={() => { setApplyIntent(true); setSurface({ kind: 'login', prefill: 'partner' }) }}
            /* Anyone can browse; the basket needs an owner. The first add sends
               the visitor to sign in and is completed for them afterwards. */
            onAddToBasket={(p) => {
              setPendingProduct(p)
              setSurface({ kind: 'login', prefill: 'consumer' })
              window.scrollTo({ top: 0 })
            }}
          />
        )}
      </PublicShell>
    )
  }

  // ---------- Operator persona ----------
  if (persona === 'operator') {
    return (
      <OperatorShell view={opView} onNavigate={v => goOperator(v)} onSignOut={handleSignOut}>
        {opView === 'op-dashboard' && <OperatorDashboard onNavigate={goOperator} />}
        {opView === 'op-onboarding' && <OperatorOnboarding />}
        {opView === 'op-partners' && <OperatorPartners focus={opFocus} />}
        {opView === 'op-catalogue' && <OperatorCatalogue focus={opFocus} />}
        {opView === 'op-settlement' && <OperatorSettlement focus={opFocus} />}
        {opView === 'op-inventory' && <OperatorInventory />}
        {opView === 'op-tickets' && <OperatorTickets focus={opFocus} />}
        {opView === 'op-dunning' && <OperatorDunning />}
        {opView === 'op-developer' && <OperatorDeveloper />}
        {opView === 'op-promotions' && <OperatorPromotions />}
        {opView === 'op-banners' && <OperatorBanners />}
        {opView === 'op-billtemplates' && <OperatorBillTemplates />}
        {opView === 'op-notifications' && <OperatorNotifications />}
        {opView === 'op-channels' && <OperatorChannels />}
        {opView === 'op-roles' && <OperatorRoles />}
        {opView === 'op-reviews' && <OperatorReviews />}
        {opView === 'op-wallets' && <OperatorWallets />}
        {opView === 'op-refunds' && <OperatorRefunds />}
        {opView === 'op-rewards' && <OperatorRewards />}
        {opView === 'op-revshare' && <OperatorRevenueShare />}
        {opView === 'op-ledger' && <OperatorLedger />}
        {opView === 'op-feedback' && <OperatorContentFeedback />}
        {opView === 'op-audit' && <OperatorAudit />}
        {opView === 'op-kb' && <KnowledgeBase persona="operator" title="Knowledge base" />}
        {opView === 'op-kbadmin' && <OperatorKnowledge />}
        {/* No feedbackAs: the operator is the queue. */}
      </OperatorShell>
    )
  }

  // ---------- Partner persona ----------
  if (persona === 'partner') {
    return (
      <PartnerShell view={ptView} onNavigate={setPtView} onSignOut={handleSignOut}>
        {ptView === 'pt-dashboard' && <PartnerDashboard onNavigate={setPtView} />}
        {ptView === 'pt-onboarding' && <PartnerOnboarding partnerId={session!.partnerId!} />}
        {ptView === 'pt-listings' && <PartnerListings partnerId={session!.partnerId!} onNewListing={() => setPtView('pt-newlisting')} />}
        {ptView === 'pt-newlisting' && <PartnerNewListing partnerId={session!.partnerId!} />}
        {ptView === 'pt-orders' && <PartnerOrders />}
        {ptView === 'pt-settlement' && <PartnerSettlement partnerId={session!.partnerId!} />}
        {ptView === 'pt-plan' && <PartnerSettlementPlan partnerId={session!.partnerId!} />}
        {ptView === 'pt-performance' && <PartnerPerformance />}
        {ptView === 'pt-integrations' && <PartnerIntegrations />}
        {ptView === 'pt-reviews' && <PartnerReviews partnerId={session?.partnerId ?? ''} />}
        {ptView === 'pt-support' && <PartnerSupport partnerId={session!.partnerId!} />}
        {ptView === 'pt-refunds' && <PartnerRefunds partnerId={session!.partnerId!} />}
        {ptView === 'pt-rewards' && <PartnerRewards partnerId={session!.partnerId!} />}
        {ptView === 'pt-notifications' && <PartnerNotifications partnerId={session!.partnerId!} />}
        {ptView === 'pt-team' && <PartnerTeam partnerId={session!.partnerId!} />}
        {ptView === 'pt-audit' && <PartnerAudit />}
        {ptView === 'pt-profile' && <PartnerDetails partnerId={session!.partnerId!} />}
        {ptView === 'pt-kb' && <KnowledgeBase persona="partner" title="Knowledge base" feedbackAs={{ actor: 'Rajesh Kumar', org: 'Nimbus Sensors' }} />}
      </PartnerShell>
    )
  }

  // ---------- Enterprise persona ----------
  if (persona === 'enterprise') {
    return (
      <EnterpriseShell view={enView} onNavigate={setEnView} onSignOut={handleSignOut}>
        {enView === 'en-dashboard' && <EnterpriseDashboard onNavigate={setEnView} />}
        {enView === 'en-browse' && <EnterpriseBrowse />}
        {enView === 'en-iot' && <EnterpriseMarketplace vertical="iot" />}
        {enView === 'en-security' && <EnterpriseMarketplace vertical="security" />}
        {enView === 'en-devices' && <EnterpriseMarketplace vertical="device" />}
        {enView === 'en-approvals' && <EnterpriseApprovals />}
        {enView === 'en-orders' && <EnterpriseOrders />}
        {enView === 'en-subs' && <EnterpriseSubs />}
        {enView === 'en-refunds' && <EnterpriseRefunds />}
        {enView === 'en-billing' && <EnterpriseBilling />}
        {enView === 'en-rewards' && <EnterpriseRewards />}
        {enView === 'en-support' && <EnterpriseSupport />}
        {enView === 'en-notifications' && <EnterpriseNotifications />}
        {enView === 'en-team' && <EnterpriseTeam />}
        {enView === 'en-audit' && <EnterpriseAudit />}
        {enView === 'en-profile' && <EnterpriseProfile />}
        {enView === 'en-kb' && <KnowledgeBase persona="enterprise" title="Knowledge base" feedbackAs={{ actor: 'Vikram Shah', org: 'SmartBuild Ltd' }} />}
      </EnterpriseShell>
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
        {!loading && view === 'kb' && <div className="container" style={{ padding: '32px 24px' }}><KnowledgeBase persona="consumer" title="How things work" feedbackAs={{ actor: 'Priya Raman', org: 'Consumer' }} /></div>}
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
      <ToastHost />
    </>
  )
}
