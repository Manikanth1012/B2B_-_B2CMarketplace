import { useState, useEffect } from 'react'
import { LayoutDashboard, Search, Shield, Cpu, Monitor, ShoppingCart, SquareCheck as CheckSquare, Users, History, User, Bell as BellIcon, LogOut, Menu, X, Building2, BookOpen, RotateCcw, Repeat, Receipt, Zap, LifeBuoy, Wallet as WalletIcon, KeyRound, Smartphone, FileSignature, MessageSquareText, BookMarked } from 'lucide-react'
import { ContactSalesDialog } from '../enquiries/ContactSalesDialog'
import { enquiriesChanged } from '../enquiries/events'
import { toast } from '../operator/shared'
import type { EnterpriseView } from '../../types/view'
import { ContextualHelp } from '../ContextualHelp'
import { AccountMenu } from '../AccountMenu'
import { AventaWordmark } from '../ui'
import { MarketPicker } from '../MarketPicker'
import { useRequisition } from '../../lib/RequisitionContext'

/** The basket, with what is in it. Hidden while empty rather than showing a
    zero — a control that does nothing is one a buyer learns to ignore. */
function RequisitionButton() {
  const { count, setOpen } = useRequisition()
  if (count === 0) return null
  return (
    <button
      onClick={() => setOpen(true)}
      data-requisition-opener
      aria-label={`Requisition — ${count} ${count === 1 ? 'unit' : 'units'}`}
      style={{ padding: '8px', borderRadius: 'var(--radius)', color: 'var(--text-secondary)', position: 'relative' }}
    >
      <ShoppingCart size={20} />
      <span style={{
        position: 'absolute', top: '0', right: '0', minWidth: '17px', height: '17px',
        padding: '0 4px', borderRadius: '9px', background: 'var(--brand-accent-dark, #006B6B)',
        color: 'white', fontSize: '10px', fontWeight: 700,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        {count > 99 ? '99+' : count}
      </span>
    </button>
  )
}

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
      /* Quotes, demos and sales questions, and what each is waiting on. */
      { id: 'en-enquiries', label: 'Enquiries', icon: <MessageSquareText size={18} /> },
      { id: 'en-refunds', label: 'Refunds', icon: <RotateCcw size={18} /> },
      { id: 'en-subs', label: 'Subscriptions', icon: <Repeat size={18} /> },
      { id: 'en-numbers', label: 'Numbers & SIMs', icon: <Smartphone size={18} /> },
      { id: 'en-billing', label: 'Billing', icon: <Receipt size={18} /> },
      { id: 'en-agreement', label: 'Your Agreement', icon: <FileSignature size={18} /> },
      { id: 'en-pricebook', label: 'Price book', icon: <BookMarked size={18} /> },
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
  const [askingSales, setAskingSales] = useState(false)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-alt)', display: 'flex' }}>
      <aside className="op-sidebar cpe-side" style={{ display: mobileNavOpen ? 'flex' : 'none' }}>
        {/* The approved 6D mark, then the Aventa wordmark beside it. */}
        <div className="cpe-side__brand">
          <div className="cpe-side__logos">
            <img src="/assets/brand/6d-logo-white.png" alt="6D" />
            <span className="cpe-side__divider" aria-hidden />
            <AventaWordmark size={20} />
          </div>
          <button onClick={() => setMobileNavOpen(false)} className="show-mobile" aria-label="Close menu" style={{ color: 'white' }}>
            <X size={20} />
          </button>
        </div>

        <nav className="cpe-side__nav" aria-label="Console">
          {NAV_SECTIONS.map((section) => (
            <div key={section.label} className="cpe-side__group">
              <div className="cpe-side__heading">{section.label}</div>
              {section.items.map((item) => {
                const active = view === item.id
                return (
                  <button
                    key={item.id}
                    onClick={() => { onNavigate(item.id); setMobileNavOpen(false) }}
                    className={`cpe-side__item${active ? ' is-active' : ''}`}
                    aria-current={active ? 'page' : undefined}
                  >
                    <span className="cpe-side__icon">{item.icon}</span>
                    {item.label}
                  </button>
                )
              })}
            </div>
          ))}
        </nav>

        <div className="cpe-side__foot">
          <button onClick={onSignOut} className="cpe-side__item">
            <span className="cpe-side__icon"><LogOut size={18} /></span> Sign out
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
            {/* Where the account contracts, and therefore whose tax its
                invoices carry. Fixed rather than choosable — `home` comes from
                `enterprise_accounts.market` and the picker renders it as
                settled, the same as it does for a signed-in shopper. The
                currency chips appear underneath wherever that market takes
                more than one. */}
            <div style={{ flexShrink: 0 }} className="hide-mobile">
              <MarketPicker tone="light" />
            </div>
            {/* The requisition being built. It has to be reachable from every
                screen, not only from the catalogue that filled it — a buyer who
                wanders off to check a budget and comes back otherwise has no
                way to find what they had collected. */}
            {/* A word with the marketplace's sales desk, from any screen. */}
            <button type="button" className="enq-cta" onClick={() => setAskingSales(true)}>
              <MessageSquareText size={16} aria-hidden="true" />
              <span className="enq-cta__text">Contact Sales</span>
            </button>
            <RequisitionButton />
            {/* It goes to Notifications. It had no onClick at all, so the one
                control in the header that looks like it leads somewhere led
                nowhere on every screen of this console.

                The red dot went with the fix. There is no read/unread state on
                a notification anywhere in the schema, so a permanently lit dot
                announced something new forever — which teaches people to
                ignore the one indicator that would matter if it were ever
                real. */}
            <button
              onClick={() => onNavigate('en-notifications')}
              aria-label="Notifications"
              title="Notifications"
              style={{ padding: '8px', borderRadius: 'var(--radius)', color: 'var(--text-secondary)', position: 'relative', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <BellIcon size={20} />
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

      <ContactSalesDialog open={askingSales} onClose={() => setAskingSales(false)}
        onRaised={() => {
          setAskingSales(false)
          toast('Sent to the sales desk. Follow it on Enquiries.', 'success')
          enquiriesChanged()
          onNavigate('en-enquiries')
        }} />

      {mobileNavOpen && <div onClick={() => setMobileNavOpen(false)} className="show-mobile" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', zIndex: 150 }} />}
    </div>
  )
}


