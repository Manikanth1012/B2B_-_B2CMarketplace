import { ArrowRight } from 'lucide-react'
import type { PromoSlide } from '../../lib/storefront'
import { bannerDestination } from '../../lib/storefront'
import type { PublicPage } from '../../types/view'

/* The promo strip. The artwork is decoration; the words are the operator's, straight
   from the Banners section of their console. Pausing a banner there removes it here. */

export function PromoStrip({ slides, onNavigate }: {
  slides: readonly PromoSlide[]
  onNavigate: (p: PublicPage) => void
}) {
  /* No banners live right now is a legitimate state — the operator has paused them
     all, or they are outside their date window. An empty strip beats an empty box. */
  if (slides.length === 0) return <></>

  return (
    <section
      className="container"
      aria-label="Marketplace offers"
      style={{ padding: '32px 24px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}
    >
      {slides.map(({ banner, image }) => (
        <button
          key={banner.id}
          onClick={() => onNavigate(bannerDestination(banner))}
          style={{
            position: 'relative', display: 'block', width: '100%', padding: 0,
            border: 'none', borderRadius: 'var(--radius-md)', overflow: 'hidden',
            cursor: 'pointer', textAlign: 'left', background: 'var(--brand-navy)',
            aspectRatio: '1000 / 240',
          }}
          onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--shadow-lg)' }}
          onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none' }}
        >
          <img
            src={image}
            alt=""
            loading="lazy"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
          />

          {/* The artwork behind this is arbitrary — the operator writes the copy, not
              the picture — so the text needs a floor it can rely on rather than a
              tint that happens to work on today's image. Opaque enough at the left
              that white stays past 4.5:1 even over the palest banner. */}
          <div style={{
            position: 'absolute', inset: 0,
            background: 'linear-gradient(90deg, rgba(6,15,28,0.92) 0%, rgba(6,15,28,0.78) 38%, rgba(6,15,28,0.35) 62%, rgba(6,15,28,0) 82%)',
          }} />

          <div style={{
            position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
            justifyContent: 'center', gap: '6px', padding: '0 clamp(16px, 4%, 32px)',
            maxWidth: '68%',
          }}>
            <div style={{
              fontSize: 'clamp(0.95rem, 1.5vw, var(--text-xl))', fontWeight: 800,
              color: 'white', lineHeight: 1.2, letterSpacing: '-0.01em',
            }}>
              {banner.title}
            </div>

            {banner.subtitle && (
              <div style={{
                fontSize: 'clamp(0.75rem, 1.05vw, var(--text-sm))',
                color: 'rgba(255,255,255,0.86)', lineHeight: 1.35,
              }}>
                {banner.subtitle}
              </div>
            )}

            {/* Rendered as text, not a nested <button> — the whole tile is already the
                control, and a button inside a button is invalid and unreachable. */}
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: '6px', marginTop: '6px',
              fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--brand-accent-light, #4FD1D1)',
            }}>
              {banner.cta} <ArrowRight size={14} />
            </span>
          </div>
        </button>
      ))}
    </section>
  )
}
