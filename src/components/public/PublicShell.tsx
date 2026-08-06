import type { PublicPage } from '../../types/view'
import { MarketPicker } from '../MarketPicker'
import { useMarket } from '../../lib/MarketContext'
import { marketProse } from '../../lib/money'

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
      <h2 style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.55)', fontWeight: 700, margin: '0 0 12px' }}>
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

export function PublicShell({ page, onNavigate, onDemoSignIn, children }: {
  page: PublicPage
  onNavigate: (p: PublicPage) => void
  onDemoSignIn: () => void
  children: React.ReactNode
}) {
  /* Sorted the way the markets table orders them, so the footer, the storefront
     picker and the operator's own screen list them in one order. */
  const { book } = useMarket()
  const regions = [...book.markets].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-alt)' }}>
      <header style={{ background: 'var(--brand-navy)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: '24px', height: '64px' }}>
          <button onClick={() => onNavigate('landing')} style={{ display: 'flex', alignItems: 'center', flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer' }}>
            <img src="/assets/brand/6d-logo-white.png" alt="6D Marketplace — home" style={{ height: '32px' }} />
          </button>

          <nav style={{ display: 'flex', gap: '4px', flex: 1 }} aria-label="Audiences">
            {NAV.map(n => (
              <button
                key={n.id}
                onClick={() => onNavigate(n.id)}
                aria-current={page === n.id ? 'page' : undefined}
                style={{
                  padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius)',
                  border: 'none', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600,
                  background: page === n.id ? 'rgba(255,255,255,0.14)' : 'transparent',
                  color: page === n.id ? 'white' : 'rgba(255,255,255,0.85)',
                  transition: 'background 150ms ease',
                }}
                onMouseEnter={e => { if (page !== n.id) e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
                onMouseLeave={e => { if (page !== n.id) e.currentTarget.style.background = 'transparent' }}
              >
                {n.label}
              </button>
            ))}
          </nav>

          {/* A visitor has no account and so no home market — this is the one
              surface where the choice is genuinely free, and it is the surface
              most people meet first. Without it the storefront quoted every
              visitor in rupees whatever country they were in, while the shelves
              behind it were already priced for three markets. */}
          <div style={{ flexShrink: 0 }}>
            <MarketPicker />
          </div>

          <button
            onClick={onDemoSignIn}
            style={{
              padding: 'var(--space-2) var(--space-5)', borderRadius: 'var(--radius)',
              border: '1px solid rgba(255,255,255,0.25)', background: 'transparent',
              color: 'white', fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer', flexShrink: 0,
            }}
          >
            Demo sign-in
          </button>
        </div>
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      {/* The site menu repeats here so someone who has read to the bottom of a long
          page can move on without scrolling back up. Sign-in is deliberately not
          among them — it lives in the header, and one way in is enough. */}
      <footer style={{ background: 'var(--brand-navy-dark)', color: 'rgba(255,255,255,0.7)' }}>
        <div className="container" style={{ paddingTop: '40px', paddingBottom: '32px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '32px' }}>
          <div style={{ minWidth: '220px' }}>
            <img src="/assets/brand/6d-logo-white.png" alt="" style={{ height: '28px', opacity: 0.9 }} />
            <p style={{ fontSize: 'var(--text-sm)', margin: '12px 0 0', maxWidth: '280px', lineHeight: 1.6 }}>
              Plans, devices, security and IoT from verified partners — one marketplace,
              one checkout, one settlement cycle.
            </p>
          </div>

          <nav aria-label="Site menu" style={{ display: 'flex', gap: '48px', flexWrap: 'wrap' }}>
            <FooterGroup heading="Marketplace" items={FOOTER_MENU} page={page} onNavigate={onNavigate} />
            <div>
              <h2 style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'rgba(255,255,255,0.55)', fontWeight: 700, margin: '0 0 12px' }}>
                Regions
              </h2>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Read from the markets table, not typed. Uganda was added to
                    that table and taken out again inside an hour; a footer that
                    names its regions by hand would have gone on advertising a
                    market the storefront had stopped selling in. */}
                {regions.map(r => (
                  <li key={r.code} style={{ fontSize: 'var(--text-sm)' }}>{r.name}</li>
                ))}
              </ul>
            </div>
          </nav>
        </div>

        <div className="container" style={{ paddingBottom: '28px' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.55)' }}>
            © 2026 6D Marketplace{regions.length > 0 && ` · ${marketProse(regions, { conjunction: '', separator: ' · ' })}`}
          </span>
        </div>
      </footer>
    </div>
  )
}
