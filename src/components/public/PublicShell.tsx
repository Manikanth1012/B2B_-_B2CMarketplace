import type { PublicPage } from '../../types/view'

const NAV: { id: PublicPage; label: string }[] = [
  { id: 'partner', label: 'Partners' },
  { id: 'retail', label: 'Retail' },
  { id: 'enterprise', label: 'Enterprise' },
]

export function PublicShell({ page, onNavigate, onDemoSignIn, children }: {
  page: PublicPage
  onNavigate: (p: PublicPage) => void
  onDemoSignIn: () => void
  children: React.ReactNode
}) {
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

      <footer style={{ background: 'var(--brand-navy-dark)', color: 'rgba(255,255,255,0.7)' }}>
        <div className="container" style={{ padding: '32px 24px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <span style={{ fontSize: 'var(--text-sm)' }}>© 2026 6D Marketplace · India · UAE · Kenya</span>
          <button onClick={onDemoSignIn} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 'var(--text-sm)', cursor: 'pointer', padding: 0 }}>
            Demo sign-in
          </button>
        </div>
      </footer>
    </div>
  )
}
