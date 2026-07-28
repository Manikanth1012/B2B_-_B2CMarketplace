import { useState, useEffect } from 'react'
import { Search, ShoppingCart, Menu, X, ChevronDown } from 'lucide-react'
import type { Category } from '../types'
import { supabase } from '../lib/supabase'

import type { View } from '../types/view'

interface HeaderProps {
  cartCount: number
  onCartClick: () => void
  onNavigate: (view: View, opts?: { category?: string }) => void
}

export function Header({ cartCount, onCartClick, onNavigate }: HeaderProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)

  useEffect(() => {
    supabase.from('categories').select('*').order('sort_order').then(({ data }) => {
      if (data) setCategories(data as Category[])
    })
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault()
    if (search.trim()) {
      onNavigate('category')
    }
  }

  return (
    <>
      {/* Top utility bar */}
      <div style={{
        background: 'var(--brand-navy-dark)',
        color: 'rgba(255,255,255,0.7)',
        fontSize: 'var(--text-xs)',
        padding: '6px 0',
      }}>
        <div className="container" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>India · UAE · Kenya</span>
          <div style={{ display: 'flex', gap: '20px' }}>
            <span className="hide-mobile">Track Order</span>
            <span className="hide-mobile">Help & Support</span>
            <span>EN</span>
          </div>
        </div>
      </div>

      {/* Main header */}
      <header style={{
        background: 'var(--brand-navy)',
        color: 'white',
        position: 'sticky',
        top: 0,
        zIndex: 100,
        boxShadow: scrolled ? 'var(--shadow-lg)' : 'none',
        transition: 'box-shadow 200ms ease',
      }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: '24px', height: 'var(--header-height)' }}>
          {/* Logo */}
          <button onClick={() => onNavigate('home')} style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
            <img src="/assets/brand/6d-logo-white.png" alt="6D Marketplace" style={{ height: '32px' }} />
          </button>

          {/* Search */}
          <form onSubmit={handleSearch} className="hide-mobile" style={{ flex: 1, maxWidth: '520px' }}>
            <div style={{ position: 'relative' }}>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search for plans, devices, services..."
                style={{
                  width: '100%',
                  padding: '10px 16px 10px 44px',
                  borderRadius: 'var(--radius-full)',
                  border: 'none',
                  background: 'rgba(255,255,255,0.1)',
                  color: 'white',
                  fontSize: 'var(--text-sm)',
                  outline: 'none',
                  transition: 'background 200ms ease',
                }}
                onFocus={(e) => e.target.style.background = 'rgba(255,255,255,0.15)'}
                onBlur={(e) => e.target.style.background = 'rgba(255,255,255,0.1)'}
              />
              <Search style={{
                position: 'absolute',
                left: '14px',
                top: '50%',
                transform: 'translateY(-50%)',
                width: 18,
                height: 18,
                opacity: 0.6,
              }} />
            </div>
          </form>

          {/* Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <button
              onClick={() => onNavigate('orders')}
              className="btn-ghost hide-mobile"
              style={{ color: 'rgba(255,255,255,0.85)', borderRadius: 'var(--radius)' }}
            >
              My Orders
            </button>
            <button
              onClick={() => onNavigate('subscriptions')}
              className="btn-ghost hide-mobile"
              style={{ color: 'rgba(255,255,255,0.85)', borderRadius: 'var(--radius)' }}
            >
              Subscriptions
            </button>
            <button
              onClick={onCartClick}
              style={{
                position: 'relative',
                padding: '8px',
                borderRadius: 'var(--radius)',
                color: 'white',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'background 150ms ease',
              }}
              aria-label="Shopping cart"
            >
              <ShoppingCart size={22} />
              {cartCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '2px',
                  right: '2px',
                  background: 'var(--brand-accent)',
                  color: 'white',
                  fontSize: '10px',
                  fontWeight: 700,
                  width: '18px',
                  height: '18px',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {cartCount}
                </span>
              )}
            </button>
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="show-mobile"
              style={{ color: 'white', padding: '8px' }}
              aria-label="Menu"
            >
              {mobileOpen ? <X size={22} /> : <Menu size={22} />}
            </button>
          </div>
        </div>

        {/* Category nav bar */}
        <nav className="hide-mobile" style={{
          borderTop: '1px solid rgba(255,255,255,0.08)',
          background: 'var(--brand-navy-light)',
        }}>
          <div className="container" style={{ display: 'flex', gap: '4px', height: 'var(--nav-height)', alignItems: 'center' }}>
            <button
              onClick={() => onNavigate('home')}
              style={{
                padding: '8px 14px',
                borderRadius: 'var(--radius)',
                color: 'rgba(255,255,255,0.85)',
                fontSize: 'var(--text-sm)',
                fontWeight: 500,
                transition: 'all 150ms ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'white' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.85)' }}
            >
              All Products
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => onNavigate('category', { category: cat.id })}
                style={{
                  padding: '8px 14px',
                  borderRadius: 'var(--radius)',
                  color: 'rgba(255,255,255,0.85)',
                  fontSize: 'var(--text-sm)',
                  fontWeight: 500,
                  transition: 'all 150ms ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.1)'; e.currentTarget.style.color = 'white' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.85)' }}
              >
                {cat.name}
                <ChevronDown size={14} style={{ opacity: 0.5 }} />
              </button>
            ))}
          </div>
        </nav>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="show-mobile" style={{ background: 'var(--brand-navy)', padding: '16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
            <form onSubmit={handleSearch} style={{ marginBottom: '16px' }}>
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search..."
                style={{
                  width: '100%',
                  padding: '10px 16px',
                  borderRadius: 'var(--radius)',
                  border: 'none',
                  background: 'rgba(255,255,255,0.1)',
                  color: 'white',
                  fontSize: 'var(--text-sm)',
                }}
              />
            </form>
            <button onClick={() => { onNavigate('home'); setMobileOpen(false) }} style={mobileLinkStyle}>All Products</button>
            {categories.map((cat) => (
              <button key={cat.id} onClick={() => { onNavigate('category', { category: cat.id }); setMobileOpen(false) }} style={mobileLinkStyle}>
                {cat.name}
              </button>
            ))}
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', marginTop: '8px', paddingTop: '8px' }}>
              <button onClick={() => { onNavigate('orders'); setMobileOpen(false) }} style={mobileLinkStyle}>My Orders</button>
              <button onClick={() => { onNavigate('subscriptions'); setMobileOpen(false) }} style={mobileLinkStyle}>Subscriptions</button>
            </div>
          </div>
        )}
      </header>
    </>
  )
}

const mobileLinkStyle: React.CSSProperties = {
  display: 'block',
  width: '100%',
  textAlign: 'left',
  padding: '10px 12px',
  color: 'rgba(255,255,255,0.85)',
  fontSize: 'var(--text-sm)',
  fontWeight: 500,
  borderRadius: 'var(--radius)',
}
