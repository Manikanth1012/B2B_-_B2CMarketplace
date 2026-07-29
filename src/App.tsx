import { useState, useEffect, useCallback } from 'react'
import type { View, OperatorView, PartnerView, EnterpriseView, Persona, Session } from './types/view'
import { supabase } from './lib/supabase'
import type { CartItem, Product } from './types'
import { LoginScreen } from './components/LoginScreen'
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
import { OperatorCatalogue } from './components/operator/OperatorCatalogue'
import { OperatorSettlement } from './components/operator/OperatorSettlement'
import { OperatorInventory } from './components/operator/OperatorInventory'
import { OperatorTickets } from './components/operator/OperatorTickets'
import { OperatorDunning } from './components/operator/OperatorDunning'
import { OperatorDeveloper } from './components/operator/OperatorDeveloper'
import { OperatorPromotions } from './components/operator/OperatorPromotions'
import { OperatorBanners } from './components/operator/OperatorBanners'
import { OperatorChannels } from './components/operator/OperatorChannels'
import { OperatorRoles } from './components/operator/OperatorRoles'
import { OperatorAudit } from './components/operator/OperatorAudit'
import { ToastHost } from './components/operator/shared'
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
import { PartnerTeam, PartnerAudit, PartnerProfile } from './components/partner/PartnerMisc'
import { EnterpriseShell } from './components/enterprise/EnterpriseShell'
import { EnterpriseDashboard } from './components/enterprise/EnterpriseDashboard'
import { EnterpriseBrowse } from './components/enterprise/EnterpriseBrowse'
import { EnterpriseApprovals, EnterpriseOrders, EnterpriseSubs, EnterpriseMarketplace } from './components/enterprise/EnterpriseViews'
import { EnterpriseTeam, EnterpriseAudit, EnterpriseProfile } from './components/enterprise/EnterpriseMisc'
import { KnowledgeBase } from './components/KnowledgeBase'

export default function App() {
  const [session, setSession] = useState<Session | null>(null)
  const persona = session?.persona ?? null
  const [view, setView] = useState<View>('home')
  const [opView, setOpView] = useState<OperatorView>('op-dashboard')
  const [ptView, setPtView] = useState<PartnerView>('pt-dashboard')
  const [enView, setEnView] = useState<EnterpriseView>('en-dashboard')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [cartCount, setCartCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [accountTab, setAccountTab] = useState<string | undefined>(undefined)

  const loadCart = useCallback(async () => {
    const { data: cart } = await supabase
      .from('cart_items')
      .select('*, product:products(*)')
      .order('created_at', { ascending: false })
    if (cart) {
      setCartItems(cart as CartItem[])
      setCartCount(cart.reduce((sum: number, item: CartItem) => sum + item.quantity, 0))
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

  const addToCart = async (product: Product, quantity = 1) => {
    const existing = cartItems.find((item) => item.product_id === product.id)
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

  const removeFromCart = async (itemId: string) => {
    await supabase.from('cart_items').delete().eq('id', itemId)
    await loadCart()
  }

  const clearCart = async () => {
    await supabase.from('cart_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    await loadCart()
  }

  const handleLogin = (s: Session) => {
    setSession(s)
    if (s.persona === 'operator') setOpView('op-dashboard')
    else if (s.persona === 'partner') setPtView('pt-dashboard')
    else if (s.persona === 'enterprise') setEnView('en-dashboard')
    else setView('home')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSignOut = () => {
    setSession(null)
    setView('home')
    setOpView('op-dashboard')
    setPtView('pt-dashboard')
    setEnView('en-dashboard')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // ---------- Login screen ----------
  if (!persona) {
    return <LoginScreen onLogin={handleLogin} />
  }

  // ---------- Operator persona ----------
  if (persona === 'operator') {
    return (
      <OperatorShell view={opView} onNavigate={setOpView} onSignOut={handleSignOut}>
        {opView === 'op-dashboard' && <OperatorDashboard />}
        {opView === 'op-onboarding' && <OperatorOnboarding />}
        {opView === 'op-catalogue' && <OperatorCatalogue />}
        {opView === 'op-settlement' && <OperatorSettlement />}
        {opView === 'op-inventory' && <OperatorInventory />}
        {opView === 'op-tickets' && <OperatorTickets />}
        {opView === 'op-dunning' && <OperatorDunning />}
        {opView === 'op-developer' && <OperatorDeveloper />}
        {opView === 'op-promotions' && <OperatorPromotions />}
        {opView === 'op-banners' && <OperatorBanners />}
        {opView === 'op-channels' && <OperatorChannels />}
        {opView === 'op-roles' && <OperatorRoles />}
        {opView === 'op-audit' && <OperatorAudit />}
        {opView === 'op-kb' && <KnowledgeBase persona="operator" title="Knowledge base" />}
      </OperatorShell>
    )
  }

  // ---------- Partner persona ----------
  if (persona === 'partner') {
    return (
      <PartnerShell view={ptView} onNavigate={setPtView} onSignOut={handleSignOut}>
        {ptView === 'pt-dashboard' && <PartnerDashboard />}
        {ptView === 'pt-onboarding' && <PartnerOnboarding partnerId={session!.partnerId!} />}
        {ptView === 'pt-listings' && <PartnerListings />}
        {ptView === 'pt-newlisting' && <PartnerNewListing />}
        {ptView === 'pt-orders' && <PartnerOrders />}
        {ptView === 'pt-settlement' && <PartnerSettlement />}
        {ptView === 'pt-plan' && <PartnerSettlementPlan />}
        {ptView === 'pt-performance' && <PartnerPerformance />}
        {ptView === 'pt-integrations' && <PartnerIntegrations />}
        {ptView === 'pt-support' && <PartnerSupport />}
        {ptView === 'pt-team' && <PartnerTeam />}
        {ptView === 'pt-audit' && <PartnerAudit />}
        {ptView === 'pt-profile' && <PartnerProfile />}
        {ptView === 'pt-kb' && <KnowledgeBase persona="partner" title="Knowledge base" />}
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
        {enView === 'en-team' && <EnterpriseTeam />}
        {enView === 'en-audit' && <EnterpriseAudit />}
        {enView === 'en-profile' && <EnterpriseProfile />}
        {enView === 'en-kb' && <KnowledgeBase persona="enterprise" title="Knowledge base" />}
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
            <ProductGrid onNavigate={navigate} onAddToCart={addToCart} />
          </>
        )}
        {!loading && view === 'category' && (
          <ProductGrid
            categoryFilter={selectedCategory}
            onNavigate={navigate}
            onAddToCart={addToCart}
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
            cartItems={cartItems}
            onClearCart={clearCart}
            onComplete={() => navigate('home')}
          />
        )}
        {!loading && view === 'orders' && <OrdersView />}
        {!loading && view === 'subscriptions' && <SubscriptionsView />}
        {!loading && view === 'rewards' && <RewardsView />}
        {!loading && view === 'account' && <AccountView initialTab={accountTab} />}
        {!loading && view === 'kb' && <div className="container" style={{ padding: '32px 24px' }}><KnowledgeBase persona="consumer" title="How things work" /></div>}
      </main>
      <Footer onNavigate={navigate} />

      <CartDrawer
        open={cartOpen}
        items={cartItems}
        onClose={() => setCartOpen(false)}
        onUpdateQuantity={updateCartQuantity}
        onRemove={removeFromCart}
        onCheckout={() => {
          setCartOpen(false)
          navigate('checkout')
        }}
      />
      <ToastHost />
    </>
  )
}
