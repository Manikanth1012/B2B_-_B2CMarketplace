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
import { MarketProvider, useMarket } from './lib/MarketContext'
import { loadPriceBook, loadCopyBook, reprice } from './lib/moneyRepo'
import { LoginScreen } from './components/LoginScreen'
import { PublicShell } from './components/public/PublicShell'
import { LandingPage } from './components/public/LandingPage'
import { AudiencePage } from './components/public/AudiencePage'
import { ApplyToSell } from './components/public/ApplyToSell'
import { RegisterShopper } from './components/public/RegisterShopper'
import { ContinueWithAventaId } from './components/public/ContinueWithAventaId'
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
import { OperatorNumbers } from './components/operator/OperatorNumbers'
import { EnterpriseNumbers } from './components/enterprise/EnterpriseNumbers'
import { OperatorTickets } from './components/operator/OperatorTickets'
import { OperatorDunning } from './components/operator/OperatorDunning'
import { OperatorDeveloper } from './components/operator/OperatorDeveloper'
import { OperatorPromotions } from './components/operator/OperatorPromotions'
import { OperatorBanners } from './components/operator/OperatorBanners'
import { OperatorBillTemplates } from './components/operator/OperatorBillTemplates'
import { OperatorMarkets } from './components/operator/OperatorMarkets'
import { OperatorKnowledge } from './components/operator/OperatorKnowledge'
import { OperatorChannels } from './components/operator/OperatorChannels'
import { OperatorRoles } from './components/operator/OperatorRoles'
import { OperatorAudit } from './components/operator/OperatorAudit'
import { OperatorShelves } from './components/operator/OperatorShelves'
import { OperatorNotes } from './components/operator/OperatorNotes'
import { OperatorOrders } from './components/operator/OperatorOrders'
import { OperatorDisputes } from './components/operator/OperatorDisputes'
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
import { PartnerDeveloper } from './components/partner/PartnerDeveloper'
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
import { RequisitionProvider } from './lib/RequisitionContext'
import { RequisitionPanel } from './components/enterprise/RequisitionPanel'
import { EnterpriseDashboard } from './components/enterprise/EnterpriseDashboard'
import { EnterpriseBrowse } from './components/enterprise/EnterpriseBrowse'
import { EnterpriseSubs, EnterpriseMarketplace } from './components/enterprise/EnterpriseViews'
import { EnterpriseOrders } from './components/enterprise/EnterpriseOrders'
import { EnterpriseAudit } from './components/enterprise/EnterpriseMisc'
import { EnterpriseTeam } from './components/enterprise/EnterpriseTeam'
import { EnterpriseProfile } from './components/enterprise/EnterpriseProfile'
import { EnterpriseWallet } from './components/enterprise/EnterpriseWallet'
import { OperatorProfile } from './components/operator/OperatorProfile'
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
      const lines = (cart as CartItem[]).map(l => ({
        ...l,
        product: l.product ? reprice(l.product, book, shopCurrency, copy) : l.product,
      }))
      setCartItems(lines)
      /* Saved lines are in the basket but not of it — the badge counts what is
         actually being bought. */
      setCartCount(basketCount(lines))
    }
  }, [shopCurrency])

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
  if (surface.kind === 'login') {
    return (
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
    )
  }

  /* Applying to sell, which is where "Apply to sell" now goes. It used to open
     the sign-in screen with a notice explaining that the journey started in the
     seller console — true, and no use at all to somebody who has never been a
     seller and so has no credentials to get into it. */
  if (surface.kind === 'apply') {
    return (
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
    )
  }

  /* Registering as a shopper. `handleLogin` is the same one sign-in uses, so a
     new customer lands where a returning one does and the basket, watches and
     profile are loaded for them on the way. */
  if (surface.kind === 'register') {
    return (
      <RegisterShopper
        onLeave={() => { setSurface({ kind: 'public', page: 'retail' }); window.scrollTo({ top: 0 }) }}
        onSignIn={() => setSurface({ kind: 'login', prefill: 'consumer' })}
        onSso={() => { setSurface({ kind: 'sso' }); window.scrollTo({ top: 0 }) }}
        onRegistered={(session) => handleLogin(session)}
      />
    )
  }

  /* Opening an account from an identity the telco already holds. Lands through
     the same `handleLogin` the form and the sign-in screen use, so a customer
     who came in this way reaches the same console with the same basket,
     watches and profile loaded on the way. */
  if (surface.kind === 'sso') {
    return (
      <ContinueWithAventaId
        onLeave={() => { setSurface({ kind: 'public', page: 'retail' }); window.scrollTo({ top: 0 }) }}
        onRegisterInstead={() => { setSurface({ kind: 'register' }); window.scrollTo({ top: 0 }) }}
        onDone={(session) => handleLogin(session)}
      />
    )
  }

  if (surface.kind === 'public') {
    return (
      <PublicShell
        page={surface.page}
        onNavigate={(page) => { setSurface({ kind: 'public', page }); window.scrollTo({ top: 0 }) }}
        onDemoSignIn={() => setSurface({ kind: 'login', demo: true })}
      >
        {surface.page === 'landing' && <LandingPage onNavigate={(page) => { setSurface({ kind: 'public', page }); window.scrollTo({ top: 0 }) }} />}
        {surface.page !== 'landing' && (
          <AudiencePage
            page={surface.page}
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
          />
        )}
      </PublicShell>
    )
  }

  // ---------- Operator persona ----------
  if (persona === 'operator') {
    return (
      <>
      <OperatorShell view={opView} onNavigate={(v, anchor) => goOperator(v, anchor ? { focus: anchor } : undefined)} onSignOut={handleSignOut}>
        {opView === 'op-dashboard' && <OperatorDashboard onNavigate={goOperator} />}
        {opView === 'op-onboarding' && <OperatorOnboarding />}
        {opView === 'op-partners' && <OperatorPartners focus={opFocus} />}
        {opView === 'op-catalogue' && <OperatorCatalogue focus={opFocus} />}
        {opView === 'op-settlement' && <OperatorSettlement focus={opFocus} />}
        {opView === 'op-inventory' && <OperatorInventory />}
        {opView === 'op-numbers' && <OperatorNumbers />}
        {opView === 'op-tickets' && <OperatorTickets focus={opFocus} />}
        {opView === 'op-dunning' && <OperatorDunning />}
        {opView === 'op-developer' && <OperatorDeveloper />}
        {opView === 'op-promotions' && <OperatorPromotions />}
        {opView === 'op-banners' && <OperatorBanners />}
        {opView === 'op-billtemplates' && <OperatorBillTemplates />}
        {opView === 'op-profile' && <OperatorProfile anchor={opFocus ?? undefined} />}
        {opView === 'op-markets' && <OperatorMarkets />}
        {opView === 'op-notifications' && <OperatorNotifications />}
        {opView === 'op-channels' && <OperatorChannels />}
        {opView === 'op-roles' && <OperatorRoles />}
        {opView === 'op-shelves' && <OperatorShelves />}
        {opView === 'op-reviews' && <OperatorReviews />}
        {opView === 'op-wallets' && <OperatorWallets />}
        {opView === 'op-refunds' && <OperatorRefunds />}
        {opView === 'op-rewards' && <OperatorRewards />}
        {opView === 'op-revshare' && <OperatorRevenueShare />}
        {opView === 'op-notes' && <OperatorNotes />}
        {opView === 'op-orders' && <OperatorOrders />}
        {opView === 'op-disputes' && <OperatorDisputes />}
        {opView === 'op-ledger' && <OperatorLedger />}
        {opView === 'op-feedback' && <OperatorContentFeedback />}
        {opView === 'op-audit' && <OperatorAudit />}
        {opView === 'op-kb' && <OperatorKnowledge />}
        {/* No feedbackAs: the operator is the queue. */}
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
        {ptView === 'pt-dashboard' && <PartnerDashboard partnerId={session!.partnerId!} onNavigate={setPtView} />}
        {ptView === 'pt-onboarding' && <PartnerOnboarding partnerId={session!.partnerId!} />}
        {ptView === 'pt-listings' && <PartnerListings partnerId={session!.partnerId!} onNewListing={() => setPtView('pt-newlisting')} />}
        {ptView === 'pt-newlisting' && <PartnerNewListing partnerId={session!.partnerId!} />}
        {ptView === 'pt-orders' && <PartnerOrders partnerId={session!.partnerId!} />}
        {ptView === 'pt-settlement' && <PartnerSettlement partnerId={session!.partnerId!} />}
        {ptView === 'pt-plan' && <PartnerSettlementPlan partnerId={session!.partnerId!} />}
        {ptView === 'pt-performance' && <PartnerPerformance />}
        {ptView === 'pt-integrations' && <PartnerIntegrations partnerId={session!.partnerId!} />}
        {ptView === 'pt-developer' && <PartnerDeveloper partnerId={session!.partnerId!} />}
        {ptView === 'pt-reviews' && <PartnerReviews partnerId={session?.partnerId ?? ''} />}
        {ptView === 'pt-support' && <PartnerSupport partnerId={session!.partnerId!} />}
        {ptView === 'pt-refunds' && <PartnerRefunds partnerId={session!.partnerId!} />}
        {ptView === 'pt-rewards' && <PartnerRewards partnerId={session!.partnerId!} />}
        {ptView === 'pt-notifications' && <PartnerNotifications partnerId={session!.partnerId!} />}
        {ptView === 'pt-team' && <PartnerTeam partnerId={session!.partnerId!} />}
        {ptView === 'pt-audit' && <PartnerAudit />}
        {ptView === 'pt-profile' && <PartnerDetails partnerId={session!.partnerId!} anchor={ptAnchor} />}
        {ptView === 'pt-kb' && <KnowledgeBase persona="partner" title="Knowledge base" feedbackAs={{ actor: 'Rajesh Kumar', org: 'Nimbus Sensors' }} />}
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
        {/* Raising sends them to the queue their requisition just joined —
            within policy or not, it is waiting for a decision there and that is
            where the order gets placed. */}
        <RequisitionPanel onRaised={() => setEnView('en-approvals')} />
        {enView === 'en-dashboard' && <EnterpriseDashboard onNavigate={setEnView} />}
        {enView === 'en-browse' && <EnterpriseBrowse />}
        {enView === 'en-iot' && <EnterpriseMarketplace vertical="iot" />}
        {enView === 'en-security' && <EnterpriseMarketplace vertical="security" />}
        {enView === 'en-devices' && <EnterpriseMarketplace vertical="device" />}
        {enView === 'en-approvals' && <EnterpriseApprovals />}
        {enView === 'en-orders' && <EnterpriseOrders />}
        {enView === 'en-subs' && <EnterpriseSubs />}
        {enView === 'en-numbers' && <EnterpriseNumbers />}
        {enView === 'en-refunds' && <EnterpriseRefunds />}
        {enView === 'en-billing' && <EnterpriseBilling />}
        {enView === 'en-rewards' && <EnterpriseRewards />}
        {enView === 'en-support' && <EnterpriseSupport />}
        {enView === 'en-notifications' && <EnterpriseNotifications />}
        {enView === 'en-team' && <EnterpriseTeam />}
        {enView === 'en-audit' && <EnterpriseAudit />}
        {enView === 'en-profile' && <EnterpriseProfile anchor={enAnchor} />}
        {enView === 'en-wallet' && <EnterpriseWallet />}
        {enView === 'en-kb' && <KnowledgeBase persona="enterprise" title="Knowledge base" feedbackAs={{ actor: 'Vikram Shah', org: 'SmartBuild Ltd' }} />}
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
        {!loading && view === 'kb' && <div className="container" style={{ paddingTop: '32px', paddingBottom: '32px' }}><KnowledgeBase persona="consumer" title="How things work" feedbackAs={{ actor: 'Priya Raman', org: 'Consumer' }} /></div>}
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
