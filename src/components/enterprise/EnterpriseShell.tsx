import { useState, useEffect } from 'react'
import { LayoutDashboard, Search, Shield, Cpu, Monitor, ShoppingCart, SquareCheck as CheckSquare, Users, History, User, Bell as BellIcon, LogOut, Menu, X, Building2, BookOpen, RotateCcw, Repeat, Receipt, Zap, LifeBuoy, Wallet as WalletIcon, KeyRound } from 'lucide-react'
import type { EnterpriseView } from '../../types/view'
import { ContextualHelp } from '../ContextualHelp'
import { AccountMenu } from '../AccountMenu'

interface EnterpriseShellProps {
  view: EnterpriseView
  /* `anchor` names a card on the destination screen. "Sign-in & security" is a
     section of My details rather than a screen of its own, and without a way to
     say which section the menu item had nowhere to go. */
  onNavigate: (v: EnterpriseView, anchor?: string) => void
  onSignOut: () => void
  children: React.ReactNode
}

const NAV_SECTIONS: { label: string; items: { id: EnterpriseView; label: string; icon: React.ReactNode }[] }[] = [
  {
    label: 'Overview',
    items: [
      { id: 'en-dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
      { id: 'en-approvals', label: 'Approvals', icon: <CheckSquare size={18} /> },
    ]
  },
  {
    label: 'Marketplaces',
    items: [
      { id: 'en-browse', label: 'Browse Catalogue', icon: <Search size={18} /> },
      { id: 'en-iot', label: 'IoT', icon: <Cpu size={18} /> },
      { id: 'en-security', label: 'Security', icon: <Shield size={18} /> },
      { id: 'en-devices', label: 'Devices', icon: <Monitor size={18} /> },
    ]
  },
  {
    label: 'Procurement',
    items: [
      { id: 'en-orders', label: 'Orders', icon: <ShoppingCart size={18} /> },
      { id: 'en-refunds', label: 'Refunds', icon: <RotateCcw size={18} /> },
      { id: 'en-subs', label: 'Subscriptions', icon: <Repeat size={18} /> },
      { id: 'en-billing', label: 'Billing', icon: <Receipt size={18} /> },
      /* Money the marketplace is holding for the company. It sat in the
         database with no screen anywhere in this persona. */
      { id: 'en-wallet', label: 'Wallet', icon: <WalletIcon size={18} /> },
      { id: 'en-rewards', label: 'Rewards', icon: <Zap size={18} /> },
      { id: 'en-support', label: 'Support', icon: <LifeBuoy size={18} /> },
    ]
  },
  {
    label: 'Account',
    items: [
      { id: 'en-notifications', label: 'Notifications', icon: <BellIcon size={18} /> },
      { id: 'en-team', label: 'Team & Roles', icon: <Users size={18} /> },
      { id: 'en-audit', label: 'Audit Log', icon: <History size={18} /> },
      { id: 'en-profile', label: 'My Details', icon: <User size={18} /> },
      { id: 'en-kb', label: 'Knowledge base', icon: <BookOpen size={18} /> },
    ]
  },
]

export function EnterpriseShell({ view, onNavigate, onSignOut, children }: EnterpriseShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-alt)', display: 'flex' }}>
      <aside
        style={{
          width: 256, flexShrink: 0, background: 'var(--brand-navy)', color: 'white',
          display: mobileNavOpen ? 'flex' : 'none', flexDirection: 'column',
          position: 'fixed', top: 0, left: 0, bottom: 0, zIndex: 200, overflowY: 'auto',
        }}
        className="op-sidebar"
      >
        <div style={{ padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <img src="/assets/brand/6d-logo-white.png" alt="6D Marketplace" style={{ height: '28px' }} />
          <button onClick={() => setMobileNavOpen(false)} className="show-mobile" style={{ color: 'white' }}>
            <X size={20} />
          </button>
        </div>

        <nav style={{ flex: 1, padding: '12px 8px' }}>
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} style={{ marginBottom: '20px' }}>
              <div style={{
                padding: '4px 12px', fontSize: 'var(--text-xs)', fontWeight: 700,
                textTransform: 'uppercase', letterSpacing: '0.05em',
                color: 'rgba(255,255,255,0.4)', marginBottom: '4px',
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
                      width: '100%', padding: '10px 12px', borderRadius: 'var(--radius)',
                      fontSize: 'var(--text-sm)', fontWeight: 500,
                      color: active ? 'white' : 'rgba(255,255,255,0.65)',
                      background: active ? 'rgba(0,107,107,0.3)' : 'transparent',
                      border: 'none', cursor: 'pointer', transition: 'all 150ms ease', textAlign: 'left',
                    }}
                    onMouseEnter={(e) => { if (!active) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'white' } }}
                    onMouseLeave={(e) => { if (!active) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)' } }}
                  >
                    <span style={{ color: active ? '#4FCDCD' : 'rgba(255,255,255,0.5)' }}>{item.icon}</span>
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
              width: '100%', padding: '10px 12px', borderRadius: 'var(--radius)',
              fontSize: 'var(--text-sm)', fontWeight: 500, color: 'rgba(255,255,255,0.65)',
              background: 'transparent', border: 'none', cursor: 'pointer', transition: 'all 150ms ease',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'white' }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'rgba(255,255,255,0.65)' }}
          >
            <LogOut size={18} /> Sign out
          </button>
        </div>
      </aside>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }} className="op-main">
        <header style={{
          background: 'white', borderBottom: '1px solid var(--border)',
          height: 'var(--header-height)', display: 'flex', alignItems: 'center', gap: '16px',
          padding: '0 24px', position: 'sticky', top: 0, zIndex: 100,
        }}>
          <button onClick={() => setMobileNavOpen(true)} className="show-mobile" style={{ color: 'var(--text)' }}>
            <Menu size={22} />
          </button>

          <div style={{ flex: 1, maxWidth: '400px', position: 'relative' }} className="hide-mobile">
            <input
              type="text" placeholder="Search catalogue, orders, subscriptions..."
              style={{
                width: '100%', padding: '8px 12px 8px 36px', borderRadius: 'var(--radius)',
                border: '1px solid var(--border)', fontSize: 'var(--text-sm)', outline: 'none',
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
            <ContextualHelp persona="enterprise" view={view} onOpenCatalogue={() => onNavigate('en-kb')} />
            <AccountMenu
              initials="VS" name="Vikram Shah" role="Procurement Lead" org="SmartBuild Ltd"
              colour="#006B6B"
              onSignOut={onSignOut} signOutIcon={<LogOut size={16} />}
              items={[
                { icon: <User size={16} />, label: 'My details', onClick: () => onNavigate('en-profile') },
                /* This used to close the menu and do nothing else. The card is
                   on My details — it just had no name to aim at. Sessions are
                   listed inside the same card, so there is one item rather than
                   two that land in the same place. */
                { icon: <KeyRound size={16} />, label: 'Sign-in & security', onClick: () => onNavigate('en-profile', 'security') },
                { icon: <WalletIcon size={16} />, label: 'Wallet', onClick: () => onNavigate('en-wallet') },
                { icon: <BellIcon size={16} />, label: 'Notifications', onClick: () => onNavigate('en-notifications') },
                { icon: <BookOpen size={16} />, label: 'Knowledge base', onClick: () => onNavigate('en-kb') },
              ]}
            />
          </div>
        </header>

        <div style={{ flex: 1, padding: '24px', overflow: 'auto' }}>
          {children}
        </div>
      </div>

      {mobileNavOpen && <div onClick={() => setMobileNavOpen(false)} className="show-mobile" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 150 }} />}
    </div>
  )
}


