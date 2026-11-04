import { useState, useEffect } from 'react'
import {
  Star,
  LayoutDashboard, Building2, Users, Package, DollarSign, Warehouse, Ticket,
  Shield, Code, Megaphone, Tag, TrendingUp, Settings,
  Search, ChevronDown, Bell as BellIcon, LogOut, Menu, X, BookOpen, Store, Wallet as WalletIcon, MessageSquareWarning, RotateCcw, Gift, Scale, BookText, Radio, Receipt, LibraryBig, Globe,
  User, KeyRound, Monitor, Smartphone, Layers, FileText, PackageSearch, Landmark, FileSignature, CalendarClock } from 'lucide-react'
import type { OperatorView } from '../../types/view'
import { ContextualHelp } from '../ContextualHelp'
import { AccountMenu } from '../AccountMenu'
import { AventaWordmark } from '../ui'

interface OperatorShellProps {
  view: OperatorView
  /* `anchor` names a card on the destination screen — "Sign-in & security"
     is a section of My details rather than a screen of its own. */
  onNavigate: (v: OperatorView, anchor?: string) => void
  onSignOut: () => void
  children: React.ReactNode
}

type NavItem = { id: OperatorView; label: string; icon: React.ReactNode }

/* "Operations" was eighteen items in one list, which is a list you scroll
   rather than one you find things in. It is seven groups now, split by the job
   being done (overview, partners & accounts, commerce, finance, service,
   platform, governance). Every item kept. The order within a group follows the
   reading order explained beside each item below — Inventory after Renewals,
   Revenue Share ahead of Credit — not the order it had inside Operations. */
const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Overview',
    items: [
      { id: 'op-dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
    ]
  },
  {
    label: 'Partners & accounts',
    items: [
      { id: 'op-onboarding', label: 'Onboarding', icon: <Users size={18} /> },
      { id: 'op-accounts', label: 'Accounts', icon: <Building2 size={18} /> },
      { id: 'op-partners', label: 'Sellers', icon: <Store size={18} /> },
      { id: 'op-catalogue', label: 'Catalogue Review', icon: <Package size={18} /> },
    ]
  },
  {
    label: 'Commerce',
    items: [
      /* Above tickets: a ticket is what somebody says about an order, and the
         order is the thing itself. Support reads them in that direction. */
      { id: 'op-orders', label: 'Orders', icon: <PackageSearch size={18} /> },
      /* Beside orders, above numbers: a renewal is the order that keeps
         happening, and half of them are a seller's to make happen. */
      { id: 'op-renewals', label: 'Renewals', icon: <CalendarClock size={18} /> },
      { id: 'op-inventory', label: 'Inventory & WMS', icon: <Warehouse size={18} /> },
      { id: 'op-numbers', label: 'Numbers & SIMs', icon: <Smartphone size={18} /> },
      { id: 'op-refunds', label: 'Refunds', icon: <RotateCcw size={18} /> },
      { id: 'op-rewards', label: 'Rewards', icon: <Gift size={18} /> },
    ]
  },
  {
    label: 'Finance',
    items: [
      { id: 'op-settlement', label: 'Settlement Runs', icon: <DollarSign size={18} /> },
      { id: 'op-revshare', label: 'Revenue Share', icon: <Scale size={18} /> },
      /* Above collections: credit decides who may owe us, collections chases
         what they already do. Read in that order or the second is a surprise. */
      { id: 'op-credit', label: 'Credit & Exposure', icon: <Landmark size={18} /> },
      { id: 'op-dunning', label: 'Collections', icon: <TrendingUp size={18} /> },
      { id: 'op-wallets', label: 'Wallets', icon: <WalletIcon size={18} /> },
      /* Beside revenue share rather than beside billing: a note is what the
         marketplace pays a seller outside the commission model, and the two are
         read together when somebody is asking why a payout moved. */
      { id: 'op-notes', label: 'Credit & Debit Notes', icon: <FileText size={18} /> },
      { id: 'op-ledger', label: 'General Ledger', icon: <BookText size={18} /> },
      { id: 'op-billtemplates', label: 'Bill Templates', icon: <Receipt size={18} /> },
      { id: 'op-markets', label: 'Markets & Currencies', icon: <Globe size={18} /> },
    ]
  },
  {
    label: 'Service',
    items: [
      { id: 'op-tickets', label: 'Tickets & SLA', icon: <Ticket size={18} /> },
      /* Below tickets and separate from them on purpose. A ticket is a question
         and the worst case is somebody is annoyed; a dispute holds money and has
         a clock on it, and merging the two makes every question look like a
         claim. */
      { id: 'op-disputes', label: 'Disputes', icon: <Scale size={18} /> },
      { id: 'op-contracts', label: 'Agreements', icon: <FileSignature size={18} /> },
    ]
  },
  {
    label: 'Platform',
    items: [
      { id: 'op-developer', label: 'Developer Portal', icon: <Code size={18} /> },
      { id: 'op-promotions', label: 'Promotions', icon: <Tag size={18} /> },
      /* A megaphone, not a bell. Banners and Notifications sat next to each
         other wearing the same icon — `BellIcon` is `Bell` aliased — so the two
         rows were told apart only by their labels. The bell stays with
         Notifications, where it means what it looks like. */
      { id: 'op-banners', label: 'Storefront Banners', icon: <Megaphone size={18} /> },
      { id: 'op-notifications', label: 'Notifications', icon: <BellIcon size={18} /> },
      { id: 'op-channels', label: 'Channels', icon: <Radio size={18} /> },
    ]
  },
  {
    label: 'Governance',
    items: [
      /* Governance of the shelf itself, above governance of what buyers say
         about it — a listing has to get onto a shelf before it can be reviewed. */
      { id: 'op-shelves', label: 'Shelves & Rules', icon: <Layers size={18} /> },
      { id: 'op-reviews', label: 'Reviews', icon: <Star size={18} /> },
      { id: 'op-feedback', label: 'Content Feedback', icon: <MessageSquareWarning size={18} /> },
      { id: 'op-roles', label: 'Roles & Users', icon: <Shield size={18} /> },
      { id: 'op-audit', label: 'Audit Trail', icon: <Settings size={18} /> },
      /* One entry, not two. "Knowledge base" was the reading screen and "Manage
         content" the authoring one, so checking what an article looked like
         meant leaving the editor. They are three tabs of one screen now. */
      { id: 'op-kb', label: 'Knowledge base', icon: <BookOpen size={18} /> },
    ]
  },
]

export function OperatorShell({ view, onNavigate, onSignOut, children }: OperatorShellProps) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  /* Which groups the person has opened by hand. Component state only: a fresh
     session starts with just the group you are in open. */
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => new Set())
  const toggleGroup = (label: string) => setOpenGroups(prev => {
    const next = new Set(prev)
    if (next.has(label)) next.delete(label); else next.add(label)
    return next
  })
  const onGroupHead = (label: string, holdsActive: boolean) => {
    /* The group holding the current page is open whatever was clicked; toggling
       it did nothing visible and was remembered, so it stayed open after you
       left. Nothing to toggle, so nothing to remember. */
    if (!holdsActive) toggleGroup(label)
  }

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
        <div className="cpe-side__brand">
          <div className="cpe-side__logos">
            <img src="/assets/brand/6d-logo-white.png" alt="6D Technologies" />
            <AventaWordmark size={20} />
          </div>
          <button onClick={() => setMobileNavOpen(false)} className="show-mobile" aria-label="Close menu" style={{ color: 'white' }}>
            <X size={20} />
          </button>
        </div>

        <nav className="op-nav" aria-label="Operator console">
          {NAV_SECTIONS.map((section) => {
            const holdsActive = section.items.some(i => i.id === view)
            /* The group you are standing in is always open: collapsing it
               would hide the item that says where you are. */
            const expanded = holdsActive || openGroups.has(section.label)
            const panelId = `op-group-${section.label.replace(/\W+/g, '-').toLowerCase()}`
            return (
              <div key={section.label} className="op-nav__group">
                <button
                  type="button"
                  className="op-nav__head"
                  aria-expanded={expanded}
                  aria-disabled={holdsActive ? 'true' : undefined}
                  aria-controls={expanded ? panelId : undefined}
                  onClick={() => onGroupHead(section.label, holdsActive)}
                >
                  <span>{section.label}</span>
                  {holdsActive && <span className="sr-only"> (open — contains the current page)</span>}
                  <ChevronDown size={14} className="op-nav__chev" aria-hidden="true" />
                </button>
                {expanded && (
                  <div id={panelId} className="op-nav__items">
                    {section.items.map((item) => {
                      const active = view === item.id
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className="op-nav__item"
                          aria-current={active ? 'page' : undefined}
                          onClick={() => { onNavigate(item.id); setMobileNavOpen(false) }}
                        >
                          <span className="op-nav__icon">{item.icon}</span>
                          {item.label}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
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
              placeholder="Search partners, orders, tickets..."
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
              onClick={() => onNavigate('op-notifications')}
              aria-label="Notifications"
              title="Notifications"
              style={{ padding: '8px', borderRadius: 'var(--radius)', color: 'var(--text-secondary)', position: 'relative', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              <BellIcon size={20} />
            </button>
            <ContextualHelp persona="operator" view={view} onOpenCatalogue={() => onNavigate('op-kb')} />
            <AccountMenu
              initials="AS" name="Anika Sharma" role="Operator Admin" org="Aventa Communications"
              colour="var(--brand-navy)"
              onSignOut={onSignOut} signOutIcon={<LogOut size={16} />}
              items={[
                /* All three of these closed the menu and did nothing else, and
                   the console had no screen for any of them to go to. */
                { icon: <User size={16} />, label: 'My details', onClick: () => onNavigate('op-profile') },
                { icon: <KeyRound size={16} />, label: 'Sign-in & security', onClick: () => onNavigate('op-profile', 'security') },
                { icon: <Monitor size={16} />, label: 'Sessions', onClick: () => onNavigate('op-profile', 'sessions') },
                { icon: <Users size={16} />, label: 'Roles & users', onClick: () => onNavigate('op-roles') },
                { icon: <BookOpen size={16} />, label: 'Knowledge base', onClick: () => onNavigate('op-kb') },
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


