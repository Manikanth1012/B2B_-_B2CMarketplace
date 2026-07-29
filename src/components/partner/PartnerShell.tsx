import { useState, useEffect } from 'react'
import {
  LayoutDashboard, Route, Package, ShoppingCart, Wallet, FileText,
  BarChart3, Plug, LifeBuoy, Users, History, User, ChevronDown,
  Search, Bell as BellIcon, LogOut, Menu, X, Store, BookOpen
} from 'lucide-react'
import type { PartnerView } from '../../types/view'

interface PartnerShellProps {
  view: PartnerView
  onNavigate: (v: PartnerView) => void
  onSignOut: () => void
  children: React.ReactNode
}

const NAV_SECTIONS: { label: string; items: { id: PartnerView; label: string; icon: React.ReactNode }[] }[] = [
  {
    label: 'Overview',
    items: [
      { id: 'pt-dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
      { id: 'pt-onboarding', label: 'Onboarding', icon: <Route size={18} /> },
    ]
  },
  {
    label: 'Catalogue',
    items: [
      { id: 'pt-listings', label: 'My Listings', icon: <Package size={18} /> },
      { id: 'pt-newlisting', label: 'New Listing', icon: <Store size={18} /> },
    ]
  },
  {
    label: 'Trade',
    items: [
      { id: 'pt-orders', label: 'Orders', icon: <ShoppingCart size={18} /> },
      { id: 'pt-settlement', label: 'Settlement', icon: <Wallet size={18} /> },
      { id: 'pt-plan', label: 'Settlement Plan', icon: <FileText size={18} /> },
    ]
  },
  {
    label: 'Insight',
    items: [
      { id: 'pt-performance', label: 'Performance', icon: <BarChart3 size={18} /> },
      { id: 'pt-integrations', label: 'Integrations', icon: <Plug size={18} /> },
      { id: 'pt-support', label: 'Disputes & Support', icon: <LifeBuoy size={18} /> },
    ]
  },
  {
    label: 'Account',
    items: [
      { id: 'pt-team', label: 'Your Team', icon: <Users size={18} /> },
      { id: 'pt-audit', label: 'Audit Log', icon: <History size={18} /> },
      { id: 'pt-profile', label: 'My Details', icon: <User size={18} /> },
      { id: 'pt-kb', label: 'Knowledge base', icon: <BookOpen size={18} /> },
    ]
  },
]

export function PartnerShell({ view, onNavigate, onSignOut, children }: PartnerShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)

  useEffect(() => {
    if (!profileOpen) return
    const close = () => setProfileOpen(false)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [profileOpen])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-alt)', display: 'flex' }}>
      {/* Sidebar */}
      <aside
        style={{
          width: 256,
          flexShrink: 0,
          background: 'var(--brand-navy)',
          color: 'white',
          display: mobileNavOpen ? 'flex' : 'none',
          flexDirection: 'column',
          position: 'fixed',
          top: 0, left: 0, bottom: 0,
          zIndex: 200,
          overflowY: 'auto',
        }}
        className="op-sidebar"
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <img src="/assets/brand/6d-logo-white.png" alt="6D Marketplace" style={{ height: '28px' }} />
          </div>
          <button onClick={() => setMobileNavOpen(false)} className="show-mobile" style={{ color: 'white' }}>
            <X size={20} />
          </button>
        </div>

        <nav style={{ flex: 1, padding: '12px 8px' }}>
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} style={{ marginBottom: '20px' }}>
              <div style={{
                padding: '4px 12px',
                fontSize: 'var(--text-xs)',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: 'rgba(255,255,255,0.4)',
                marginBottom: '4px',
              }}>
                {section.label}
              </div>
              {section.items.map((item) => {
                const active = view === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => { onNavigate(item.id); setMobileNavOpen(false) }}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '10px',
                      width: '100%', padding: '10px 12px',
                      borderRadius: 'var(--radius)',
                      fontSize: 'var(--text-sm)', fontWeight: 500,
                      color: active ? 'white' : 'rgba(255,255,255,0.65)',
                      background: active ? 'rgba(124,99,214,0.25)' : 'transparent',
                      border: 'none', cursor: 'pointer',
                      transition: 'all 150ms ease',
                      textAlign: 'left',
                    }}
                    onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'white' } }}
                    onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)' } }}
                  >
                    <span style={{ color: active ? '#B8A4E8' : 'rgba(255,255,255,0.5)' }}>{item.icon}</span>
                    {item.label}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div style={{ padding: '12px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <button
            onClick={onSignOut}
            style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              width: '100%', padding: '10px 12px',
              borderRadius: 'var(--radius)',
              fontSize: 'var(--text-sm)', fontWeight: 500,
              color: 'rgba(255,255,255,0.65)',
              background: 'transparent', border: 'none', cursor: 'pointer',
              transition: 'all 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'white' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)' }}
          >
            <LogOut size={18} />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main content area */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }} className="op-main">
        {/* Top bar */}
        <header style={{
          background: 'white',
          borderBottom: '1px solid var(--border)',
          height: 'var(--header-height)',
          display: 'flex', alignItems: 'center', gap: '16px',
          padding: '0 24px',
          position: 'sticky', top: 0, zIndex: 100,
        }}>
          <button onClick={() => setMobileNavOpen(true)} className="show-mobile" style={{ color: 'var(--text)' }}>
            <Menu size={22} />
          </button>

          <div style={{ flex: 1, maxWidth: '400px', position: 'relative' }} className="hide-mobile">
            <input
              type="text"
              placeholder="Search your listings and orders..."
              style={{
                width: '100%', padding: '8px 12px 8px 36px',
                borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                fontSize: 'var(--text-sm)', outline: 'none',
                background: 'var(--bg-alt)', color: 'var(--text)',
              }}
            />
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          </div>

          <div style={{ flex: 1 }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button style={{ padding: '8px', borderRadius: 'var(--radius)', color: 'var(--text-secondary)', position: 'relative' }}>
              <BellIcon size={20} />
              <span style={{ position: 'absolute', top: '4px', right: '4px', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--danger)' }} />
            </button>
            <div style={{ position: 'relative' }} onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '4px 8px 4px 4px', borderRadius: 'var(--radius-full)', background: 'var(--bg-alt)', border: 'none', cursor: 'pointer' }}
              >
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#5E4B9B', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 'var(--text-xs)' }}>RK</div>
                <div className="hide-mobile" style={{ textAlign: 'left' }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)' }}>Rajesh Kumar</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Seller Operations</div>
                </div>
                <ChevronDown size={14} style={{ color: 'var(--text-tertiary)' }} />
              </button>
              {profileOpen && (
                <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '8px', background: 'white', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border)', minWidth: '220px', zIndex: 200, overflow: 'hidden' }}>
                  <div style={{ padding: '14px 16px', borderBottom: '1px solid var(--border-light)' }}>
                    <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: 'var(--text)' }}>Rajesh Kumar</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>Seller Operations · Nimbus Sensors</div>
                  </div>
                  <div style={{ padding: '4px' }}>
                    <ProfileItem label="My profile" onClick={() => { onNavigate('pt-profile'); setProfileOpen(false) }} />
                    <ProfileItem label="Sign-in & security" onClick={() => setProfileOpen(false)} />
                    <ProfileItem label="Sessions" onClick={() => setProfileOpen(false)} />
                  </div>
                  <div style={{ padding: '4px', borderTop: '1px solid var(--border-light)' }}>
                    <ProfileItem label="Sign out" onClick={onSignOut} />
                  </div>
                </div>
              )}
            </div>
          </div>
        </header>

        {/* Content */}
        <div style={{ flex: 1, padding: '24px', overflow: 'auto' }}>
          {children}
        </div>
      </div>

      {/* Mobile overlay */}
      {mobileNavOpen && <div onClick={() => setMobileNavOpen(false)} className="show-mobile" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 150 }} />}
    </div>
  )
}

function ProfileItem({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 12px', borderRadius: 'var(--radius)', border: 'none', background: 'none', color: 'var(--text-secondary)', fontSize: 'var(--text-sm)', fontWeight: 500, cursor: 'pointer' }} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-alt)'} onMouseLeave={(e) => e.currentTarget.style.background = 'none'}>
      {label}
    </button>
  )
}
