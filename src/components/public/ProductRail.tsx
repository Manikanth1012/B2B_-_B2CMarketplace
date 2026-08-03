import { useId } from 'react'
import type { ProductTile } from '../../lib/assets'

export function ProductRail({ title, subtitle, tiles }: {
  title: string
  subtitle?: string
  tiles: readonly ProductTile[]
}) {
  const headingId = useId()

  return (
    <section className="container" style={{ paddingTop: '40px', paddingBottom: '40px' }}>
      <h2 id={headingId} style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>{title}</h2>
      {subtitle && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '4px' }}>{subtitle}</p>}

      {/* A div that scrolls is not reachable with a keyboard unless it can hold
          focus, which strands anyone who cannot use a pointer at the first few
          tiles. Focusable, named, and given a role so it is announced as the
          region it already is. */}
      <div
        tabIndex={0}
        role="region"
        aria-labelledby={headingId}
        style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '12px', marginTop: '20px', scrollSnapType: 'x mandatory' }}
      >
        {tiles.map(t => (
          <div key={t.src} className="card card-hover" style={{ flexShrink: 0, width: '200px', scrollSnapAlign: 'start' }}>
            <img src={t.src} alt={t.alt} loading="lazy" style={{ width: '100%', height: '150px', objectFit: 'cover' }} />
            <div style={{ padding: '12px' }}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)' }}>{t.alt}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
