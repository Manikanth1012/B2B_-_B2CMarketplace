import { useId } from 'react'
import type { Category } from '../../types'
import { categoryDestination } from '../../lib/storefront'
import type { PublicPage } from '../../types/view'

/* A rail of real categories rather than stock photography. The six categories come
   from the `categories` table, so the rail follows the catalogue rather than a list
   maintained by hand in this file. */

export function CategoryRail({ title, subtitle, categories, images, counts, onNavigate }: {
  title: string
  subtitle?: string
  categories: readonly Category[]
  images: Record<string, string>
  counts: Record<string, number>
  onNavigate: (p: PublicPage) => void
}) {
  const headingId = useId()
  if (categories.length === 0) return <></>

  return (
    <section className="container" style={{ padding: '40px 24px' }}>
      <h2 id={headingId} style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>{title}</h2>
      {subtitle && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '4px' }}>{subtitle}</p>}

      {/* Same focus and labelling treatment as ProductRail: a scrolling div that
          cannot hold focus strands anyone who cannot use a pointer. */}
      <div
        tabIndex={0}
        role="region"
        aria-labelledby={headingId}
        style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '12px', marginTop: '20px', scrollSnapType: 'x mandatory' }}
      >
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => onNavigate(categoryDestination(cat))}
            className="card card-hover"
            style={{
              flexShrink: 0, width: '260px', scrollSnapAlign: 'start', padding: 0,
              border: '1px solid var(--border)', background: 'white',
              textAlign: 'left', cursor: 'pointer', overflow: 'hidden',
            }}
          >
            <div style={{ position: 'relative', height: '132px' }}>
              <img
                src={images[cat.id]}
                alt=""
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              <span style={{
                position: 'absolute', top: '10px', left: '10px',
                padding: '3px 8px', borderRadius: '999px',
                background: 'rgba(6,15,28,0.82)', color: 'white',
                fontSize: 'var(--text-xs)', fontWeight: 600,
              }}>
                {cat.audience}
              </span>
            </div>

            <div style={{ padding: '14px 16px 16px' }}>
              <div style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text)' }}>{cat.name}</div>
              <p style={{
                fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)',
                margin: '6px 0 0', lineHeight: 1.5, minHeight: '2.8em',
              }}>
                {cat.blurb}
              </p>
              {counts[cat.id] > 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '10px', fontWeight: 600 }}>
                  {counts[cat.id]} {counts[cat.id] === 1 ? 'product' : 'products'}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>
    </section>
  )
}
