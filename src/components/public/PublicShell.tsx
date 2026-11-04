import { useEffect, useRef, useState } from 'react'
import { Menu, Search, X } from 'lucide-react'
import type { PublicPage } from '../../types/view'
import { DiscoverMenu } from './DiscoverMenu'
import { AventaWordmark } from '../ui/AventaWordmark'
import { MarketPicker } from '../MarketPicker'
import { useMarket } from '../../lib/MarketContext'
import { marketProse } from '../../lib/money'
import { searchTarget } from '../../lib/listing'

const NAV: { id: PublicPage; label: string }[] = [
  { id: 'partner', label: 'Partners' },
  { id: 'retail', label: 'Retail' },
  { id: 'enterprise', label: 'Enterprise' },
]

/* The footer menu is the header's, plus Home — which the header carries on the
   logo, and a logo is not a menu item to everyone. */
const FOOTER_MENU: { id: PublicPage; label: string }[] = [
  { id: 'landing', label: 'Home' },
  ...NAV,
]

function FooterGroup({ heading, items, page, onNavigate }: {
  heading: string
  items: { id: PublicPage; label: string }[]
  page: PublicPage
  onNavigate: (p: PublicPage) => void
}) {
  return (
    <div>
      <h2 className="site-footer__heading">
        {heading}
      </h2>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {items.map(n => (
          <li key={n.id}>
            <button
              onClick={() => onNavigate(n.id)}
              aria-current={page === n.id ? 'page' : undefined}
              style={{
                background: 'none', border: 'none', padding: 0, cursor: 'pointer',
                fontSize: 'var(--text-sm)', textAlign: 'left',
                color: page === n.id ? 'white' : 'rgba(255,255,255,0.75)',
                fontWeight: page === n.id ? 700 : 400,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = 'white' }}
              onMouseLeave={e => { e.currentTarget.style.color = page === n.id ? 'white' : 'rgba(255,255,255,0.75)' }}
            >
              {n.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function PublicShell({ page, onNavigate, onDemoSignIn, onSearch, children }: {
  page: PublicPage
  onNavigate: (p: PublicPage) => void
  onDemoSignIn: () => void
  onSearch: (q: string) => void
  children: React.ReactNode
}) {
  /* Sorted the way the markets table orders them, so the footer, the storefront
     picker and the operator's own screen list them in one order. */
  const { book } = useMarket()
  const regions = [...book.markets].sort((a, b) => a.sort_order - b.sort_order)
  const [menuOpen, setMenuOpen] = useState(false)
  const [query, setQuery] = useState('')
  const go = (p: PublicPage) => { setMenuOpen(false); onNavigate(p) }
  const navRef = useRef<HTMLElement>(null)
  const menuBtn = useRef<HTMLButtonElement>(null)

  /* The nav precedes the header's end cluster in the DOM, so below 900px Tab
     from the menu button would skip past the opened menu into the page. Move
     focus into the menu when it opens; Escape closes it and returns to the
     button. */
  useEffect(() => {
    if (!menuOpen) return
    navRef.current?.querySelector<HTMLElement>('input, button, a[href]')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setMenuOpen(false)
      menuBtn.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [menuOpen])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-alt)' }}>
      <header className="site-header">
        <div className="container site-header__bar">
          <button className="site-header__brand" onClick={() => go('landing')} aria-label="Aventa marketplace — home">
            <img className="site-header__6d" src="/assets/brand/6d-logo-white.png" alt="" style={{ height: '30px' }} />
            <span className="site-header__divider" aria-hidden />
            <AventaWordmark size={26} />
          </button>

          <nav ref={navRef} className={`site-nav${menuOpen ? ' is-open' : ''}`} aria-label="Marketplace">
            {/* Phones hide the header field; the open menu carries its own. */}
            <form className="site-search site-search--menu" role="search" onSubmit={e => {
              e.preventDefault()
              const t = searchTarget(query)
              if (t) { setMenuOpen(false); onSearch(t.q) }
            }}>
              <Search size={16} aria-hidden />
              <input type="search" value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search products, services…" aria-label="Search the marketplace" />
            </form>
            <DiscoverMenu onNavigate={go} onDone={() => setMenuOpen(false)} />
            {NAV.map(n => (
              <button key={n.id} className="site-nav__item" onClick={() => go(n.id)}
                aria-current={page === n.id ? 'page' : undefined}>
                {n.label}
              </button>
            ))}
          </nav>

          <form className="site-search" role="search" onSubmit={e => {
              e.preventDefault()
              const t = searchTarget(query)
              if (t) { setMenuOpen(false); onSearch(t.q) }
            }}>
              <Search size={16} aria-hidden />
              <input type="search" value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search products, services…" aria-label="Search the marketplace" />
            </form>

          <div className="site-header__end">
            {/* A visitor has no account and so no home market — this is the one
                surface where the choice is genuinely free, and it is the surface
                most people meet first. */}
            <MarketPicker />
            <button className="btn btn-sm btn-outline-light" onClick={onDemoSignIn}>Sign in</button>
            <button ref={menuBtn} className="site-header__menu-btn" aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen} onClick={() => setMenuOpen(o => !o)}>
              {menuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      {/* The site menu repeats here so someone who has read to the bottom of a long
          page can move on without scrolling back up. Sign-in is deliberately not
          among them — it lives in the header, and one way in is enough. */}
      <footer className="site-footer">
        <div className="container" style={{ paddingTop: '48px', paddingBottom: '32px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '32px' }}>
          <div style={{ minWidth: '220px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
              <img src="/assets/brand/6d-logo-white.png" alt="" style={{ height: '26px', opacity: 0.9 }} />
              <span className="site-header__divider" aria-hidden />
              <AventaWordmark size={22} />
            </div>
            <p style={{ fontSize: 'var(--text-sm)', margin: '14px 0 0', maxWidth: '300px', lineHeight: 1.6 }}>
              One connected marketplace — devices, connectivity, security and IoT from verified
              partners, one checkout, one settlement cycle.
            </p>
          </div>

          <nav aria-label="Site menu" style={{ display: 'flex', gap: '48px', flexWrap: 'wrap' }}>
            <FooterGroup heading="Marketplace" items={FOOTER_MENU} page={page} onNavigate={go} />
            <div>
              <h2 className="site-footer__heading">Regions</h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Read from the markets table, not typed. */}
                {regions.map(r => (
                  <li key={r.code} style={{ fontSize: 'var(--text-sm)' }}>{r.name}</li>
                ))}
              </ul>
            </div>
          </nav>
        </div>

        <div className="container" style={{ paddingBottom: '28px' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.6)' }}>
            © 2026 6D Technologies · Aventa{regions.length > 0 && ` · ${marketProse(regions, { conjunction: '', separator: ' · ' })}`}
          </span>
        </div>
      </footer>
    </div>
  )
}
