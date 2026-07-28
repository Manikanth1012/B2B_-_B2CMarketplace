import { useState, useEffect, useCallback } from 'react'
import type { View } from './types/view'
import { supabase } from './lib/supabase'
import type { CartItem, Product } from './types'
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

export default function App() {
  const [view, setView] = useState<View>('home')
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null)
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null)
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [cartCount, setCartCount] = useState(0)
  const [loading, setLoading] = useState(true)

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

  const navigate = (v: View, opts?: { category?: string; product?: Product }) => {
    if (opts?.category !== undefined) setSelectedCategory(opts.category)
    if (opts?.product !== undefined) setSelectedProduct(opts.product)
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

  return (
    <>
      <Header cartCount={cartCount} onCartClick={() => setCartOpen(true)} onNavigate={navigate} />
      <main>
        {view === 'home' && (
          <>
            <Hero onNavigate={navigate} />
            <CategoryStrip onNavigate={navigate} />
            <ProductGrid onNavigate={navigate} onAddToCart={addToCart} />
          </>
        )}
        {view === 'category' && (
          <ProductGrid
            categoryFilter={selectedCategory}
            onNavigate={navigate}
            onAddToCart={addToCart}
          />
        )}
        {view === 'product' && selectedProduct && (
          <ProductDetail
            product={selectedProduct}
            onAddToCart={addToCart}
            onNavigate={navigate}
          />
        )}
        {view === 'checkout' && (
          <Checkout
            cartItems={cartItems}
            onClearCart={clearCart}
            onComplete={() => navigate('home')}
          />
        )}
        {view === 'orders' && <OrdersView />}
        {view === 'subscriptions' && <SubscriptionsView />}
        {view === 'rewards' && <RewardsView />}
        {view === 'account' && <AccountView />}
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
    </>
  )
}
