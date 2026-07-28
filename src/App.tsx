import { useState, useEffect, useCallback } from 'react'
import type { View, OperatorView, Persona } from './types/view'
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

export default function App() {
  const [persona, setPersona] = useState<Persona | null>(null)
  const [view, setView] = useState<View>('home')
  const [opView, setOpView] = useState<OperatorView>('op-dashboard')
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

  const handleLogin = (p: Persona) => {
    setPersona(p)
    if (p === 'operator') setOpView('op-dashboard')
    else setView('home')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleSignOut = () => {
    setPersona(null)
    setView('home')
    setOpView('op-dashboard')
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
      </OperatorShell>
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
