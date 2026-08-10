import { useState, useEffect } from 'react'
import {
  Star,
  LayoutDashboard, Route, Package, ShoppingCart, ShoppingBag, Wallet, FileText,
  BarChart3, Plug, LifeBuoy, Users, History, User,
  Search, Bell as BellIcon, LogOut, Menu, X, Store, BookOpen, RotateCcw, Gift,
  KeyRound, Monitor, Code2, CalendarClock,
} from 'lucide-react'
import type { PartnerView } from '../../types/view'
import { ContextualHelp } from '../ContextualHelp'
import { AccountMenu } from '../AccountMenu'

interface PartnerShellProps {
  view: PartnerView
  /* `anchor` names a card on the destination screen — "Sign-in & security"
     is a section of My details rather than a screen of its own. */
  onNavigate: (v: PartnerView, anchor?: string) => void
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
      { id: 'pt-wholesale', label: 'Wholesale', icon: <ShoppingBag size={18} /> },
      /* Yours to maintain: the marketplace bills its own lines and reports
         nothing on your behalf. */
      { id: 'pt-renewals', label: 'Renewals', icon: <CalendarClock size={18} /> },
      { id: 'pt-refunds', label: 'Refunds', icon: <RotateCcw size={18} /> },
      { id: 'pt-rewards', label: 'Rewards', icon: <Gift size={18} /> },
      { id: 'pt-settlement', label: 'Settlement', icon: <Wallet size={18} /> },
      { id: 'pt-plan', label: 'Settlement Plan', icon: <FileText size={18} /> },
    ]
  },
  {
    label: 'Insight',
    items: [
      { id: 'pt-performance', label: 'Performance', icon: <BarChart3 size={18} /> },
      { id: 'pt-integrations', label: 'Integrations', icon: <Plug size={18} /> },
      { id: 'pt-developer', label: 'Developer', icon: <Code2 size={18} /> },
      { id: 'pt-reviews', label: 'Reviews', icon: <Star size={18} /> },
      { id: 'pt-support', label: 'Disputes & Support', icon: <LifeBuoy size={18} /> },
    ]
  },
  {
    label: 'Account',
    items: [
      { id: 'pt-notifications', label: 'Notifications', icon: <BellIcon size={18} /> },
      { id: 'pt-team', label: 'Your Team', icon: <Users size={18} /> },
      { id: 'pt-audit', label: 'Audit Log', icon: <History size={18} /> },
      { id: 'pt-profile', label: 'My Details', icon: <User size={18} /> },
      { id: 'pt-kb', label: 'Knowledge base', icon: <BookOpen size={18} /> },
    ]
  },
]

export function PartnerShell({ view, onNavigate, onSignOut, children }: PartnerShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

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
            {/* It goes to Notifications. It had no onClick at all, so the one
                control in the header that looks like it leads somewhere led
                nowhere on every screen of this console.

                The red dot went with the fix. There is no read/unread state on
                a notification anywhere in the schema, so a permanently lit dot
                announced something new forever — which teaches people to
                ignore the one indicator that would matter if it were ever
                real. */}
            <button
              onClick={() => onNavigate('pt-notifications')}
              aria-label="Notifications"
              title="Notifications"
              style={{ padding: '8px', borderRadius: 'var(--radius)', color: 'var(--text-secondary)', position: 'relative', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <BellIcon size={20} />
            </button>
            <ContextualHelp persona="partner" view={view} onOpenCatalogue={() => onNavigate('pt-kb')} />
            <AccountMenu
              initials="RK" name="Rajesh Kumar" role="Seller Operations" org="Nimbus Sensors"
              colour="#5E4B9B"
              onSignOut={onSignOut} signOutIcon={<LogOut size={16} />}
              items={[
                { icon: <User size={16} />, label: 'My details', onClick: () => onNavigate('pt-profile') },
                /* The card is on My details, and it lists the active sessions
                   too — so one item rather than two that land in the same
                   place. It had no name to aim at until `SectionCard` grew an
                   anchor, which is why it did nothing at all. */
                { icon: <KeyRound size={16} />, label: 'Sign-in & security', onClick: () => onNavigate('pt-profile', 'security') },
                { icon: <BellIcon size={16} />, label: 'Notifications', onClick: () => onNavigate('pt-notifications') },
                { icon: <BookOpen size={16} />, label: 'Knowledge base', onClick: () => onNavigate('pt-kb') },
              ]}
            />
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


