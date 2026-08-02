import { useState, useEffect } from 'react'
import { Search, ShoppingCart, Menu, X, ChevronDown, User, Bell, Shield, LogOut, Star, BookOpen, Wallet as WalletIcon, FolderOpen } from 'lucide-react'
import type { Category } from '../types'
import { supabase } from '../lib/supabase'
import { categoriesFor } from '../lib/storefront'
import { ContextualHelp } from './ContextualHelp'

import type { View } from '../types/view'

interface HeaderProps {
  cartCount: number
  onCartClick: () => void
  onNavigate: (view: View, opts?: { category?: string; tab?: string }) => void
  onSignOut?: () => void
  currentView?: View
}

export function Header({ cartCount, onCartClick, onNavigate, onSignOut, currentView }: HeaderProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [search, setSearch] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [scrolled, setScrolled] = useState(false)
  const [acctOpen, setAcctOpen] = useState(false)
  /* The menu used to name the customer, their tier and their points in the
     markup. The points were 3,180 and the ledger was reconciled to 2,500 in
     `20260801820000_one_points_balance_per_customer.sql`, so the header said
     one number and the rewards page said another — the kind of contradiction
     nobody reports because each screen looks right on its own. */
  const [me, setMe] = useState<{ name: string; tier: string; points: number } | null>(null)

  /* The nav is a retail customer's nav, so it lists the shelves a retail
     customer can buy from. Partner is reseller enablement and was on it. */
  useEffect(() => {
    supabase.from('categories').select('*').order('sort_order').then(({ data }) => {
      if (data) setCategories(categoriesFor(data as Category[], 'consumer'))
    })
    supabase.from('consumer_profile').select('name,tier,points').eq('id', 'me').maybeSingle()
      .then(({ data }) => { if (data) setMe({ ...data, points: Number(data.points) } as typeof me) })
    const onScroll = () => setScrolled(window.scrollY > 10)
    window.addEventListener('scroll', onScroll)
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (!acctOpen) return
    const close = () => setAcctOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [acctOpen])

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
            <button onClick={() => onNavigate('account', { tab: 'support' })} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 'var(--text-xs)', padding: 0 }} className="hide-mobile">Help & Support</button>
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
            <HeaderNavBtn label="My Orders" onClick={() => onNavigate('orders')} />
            <HeaderNavBtn label="Subscriptions" onClick={() => onNavigate('subscriptions')} />
            <HeaderNavBtn label="Rewards" onClick={() => onNavigate('rewards')} />
            {currentView && <ContextualHelp persona="consumer" view={currentView} onOpenCatalogue={() => onNavigate('kb')} onDark />}
            {/* Account avatar */}
            <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setAcctOpen(!acctOpen)}
                style={{
                  display: 'flex', alignItems: 'center', gap: '8px',
                  padding: '4px 8px 4px 4px', borderRadius: 'var(--radius-full)',
                  background: acctOpen ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.08)',
                  border: 'none', color: 'white', cursor: 'pointer',
                  transition: 'background 150ms ease',
                }}
              >
                <div style={{
                  width: '32px', height: '32px', borderRadius: '50%',
                  background: 'var(--brand-accent-dark)', color: 'white',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 700, fontSize: 'var(--text-xs)',
                }}>
                  {(me?.name ?? 'My account').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                </div>
                <ChevronDown size={14} style={{ opacity: 0.6 }} />
              </button>
              {acctOpen && (
                <div style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: '8px',
                  background: 'white', borderRadius: 'var(--radius-lg)',
                  boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border)',
                  minWidth: '240px', zIndex: 200, overflow: 'hidden',
                }}>
                  <div style={{ padding: '16px', borderBottom: '1px solid var(--border-light)' }}>
                    <div style={{ fontWeight: 800, fontSize: 'var(--text-sm)', color: 'var(--text)' }}>
                      {me?.name ?? 'My account'}
                    </div>
                    {me && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                        {me.tier} member · {me.points.toLocaleString('en-US')} pts
                      </div>
                    )}
                  </div>
                  <div style={{ padding: '4px' }}>
                    {/* Every one of these used to call onNavigate('account') with no
                        tab, so all four landed on My details and three of them looked
                        broken. Each now names the tab it means. */}
                    <AcctItem icon={<User size={16} />} label="My details" onClick={() => { onNavigate('account', { tab: 'profile' }); setAcctOpen(false) }} />
                    <AcctItem icon={<Bell size={16} />} label="Notification preferences" onClick={() => { onNavigate('account', { tab: 'notifications' }); setAcctOpen(false) }} />
                    <AcctItem icon={<Shield size={16} />} label="Sign-in & security" onClick={() => { onNavigate('account', { tab: 'security' }); setAcctOpen(false) }} />
                    {/* Money the marketplace is holding for them. It belongs in
                        this menu rather than three clicks into a settings page:
                        it is the customer's own money. */}
                    <AcctItem icon={<WalletIcon size={16} />} label="Wallet" onClick={() => { onNavigate('account', { tab: 'wallet' }); setAcctOpen(false) }} />
                    {/* Household is where this account's roles and spend caps live —
                        what this person may and may not do. */}
                    <AcctItem icon={<Star size={16} />} label="My permissions" onClick={() => { onNavigate('account', { tab: 'household' }); setAcctOpen(false) }} />
                    {/* The agreement, the mandate, the cover certificate. A
                        customer asked for one of these is asked at short notice
                        and by somebody else, so it is one click rather than a
                        tab found by accident. */}
                    <AcctItem icon={<FolderOpen size={16} />} label="My documents" onClick={() => { onNavigate('account', { tab: 'documents' }); setAcctOpen(false) }} />
                    <AcctItem icon={<BookOpen size={16} />} label="How things work" onClick={() => { onNavigate('kb'); setAcctOpen(false) }} />
                  </div>
                  <div style={{ padding: '4px', borderTop: '1px solid var(--border-light)' }}>
                    {onSignOut && <AcctItem icon={<LogOut size={16} />} label="Sign out" onClick={() => { onSignOut(); setAcctOpen(false) }} />}
                  </div>
                </div>
              )}
            </div>
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
              /* The badge is a visual-only count — folding it into the label is the
                 only way a screen reader hears how much is in the basket. */
              aria-label={cartCount === 1 ? 'Shopping cart, 1 item' : `Shopping cart, ${cartCount} items`}
            >
              <ShoppingCart size={22} />
              {cartCount > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '2px',
                  right: '2px',
                  background: 'var(--brand-accent-dark)',
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
              <button onClick={() => { onNavigate('rewards'); setMobileOpen(false) }} style={mobileLinkStyle}>Rewards</button>
              <button onClick={() => { onNavigate('account'); setMobileOpen(false) }} style={mobileLinkStyle}>My Account</button>
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

/* Nav buttons sit on the dark navy header, so they cannot use .btn-ghost —
   that class is built for light surfaces and its :hover sets a light background
   with dark text. Forcing white text inline (as this did) wins over the class,
   so hovering produced white-on-light. Tint the background instead, matching
   the account button above. */
function HeaderNavBtn({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="hide-mobile"
      style={{
        padding: 'var(--space-2) var(--space-3)',
        borderRadius: 'var(--radius)',
        border: 'none', background: 'transparent',
        color: 'rgba(255,255,255,0.85)',
        fontSize: 'var(--text-sm)', fontWeight: 500,
        cursor: 'pointer', transition: 'background 150ms ease, color 150ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)'; e.currentTarget.style.color = 'white' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.85)' }}
    >
      {label}
    </button>
  )
}

function AcctItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
        padding: '10px 12px', borderRadius: 'var(--radius)', border: 'none',
        background: 'none', color: 'var(--text-secondary)',
        fontSize: 'var(--text-sm)', fontWeight: 500, cursor: 'pointer',
        textAlign: 'left', transition: 'background 150ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--bg-alt)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'none' }}
    >
      <span style={{ color: 'var(--text-tertiary)' }}>{icon}</span>
      {label}
    </button>
  )
}
