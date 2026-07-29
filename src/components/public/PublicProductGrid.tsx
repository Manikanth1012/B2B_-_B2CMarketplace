import { useId } from 'react'
import { Star, ShoppingBag } from 'lucide-react'
import type { Product } from '../../types'
import { canAddToBasket } from '../../lib/storefront'

/* Real catalogue rows on the public pages — name, seller, price and rating as they
   sit in `products`, not stock photography with invented captions. */

/* Matches CartDrawer and the consumer console — a price that reads `$18.00` here
   and `US$18.00` two clicks later looks like two different shops. */
function money(n: number): string {
  return `$${n.toFixed(2)}`
}

export function PublicProductGrid({ title, subtitle, products, images, onAdd }: {
  title: string
  subtitle?: string
  products: readonly Product[]
  images: Record<string, string>
  onAdd: (p: Product) => void
}) {
  const headingId = useId()
  if (products.length === 0) return <></>

  return (
    <section className="container" style={{ padding: '40px 24px' }} aria-labelledby={headingId}>
      <h2 id={headingId} style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>{title}</h2>
      {subtitle && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '4px' }}>{subtitle}</p>}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
        gap: '20px', marginTop: '24px',
      }}>
        {products.map(p => {
          const available = canAddToBasket(p)
          return (
            <article key={p.id} className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ position: 'relative', height: '150px', background: 'var(--surface-2, #f4f6f8)' }}>
                <img src={images[p.id]} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                {p.badge && (
                  <span style={{
                    position: 'absolute', top: '10px', left: '10px', padding: '3px 8px',
                    borderRadius: '999px', background: 'var(--brand-navy)', color: 'white',
                    fontSize: 'var(--text-xs)', fontWeight: 700,
                  }}>
                    {p.badge}
                  </span>
                )}
              </div>

              <div style={{ padding: '14px 16px 16px', display: 'flex', flexDirection: 'column', flex: 1, gap: '4px' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)', lineHeight: 1.35 }}>
                  {p.name}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{p.seller}</div>

                {p.rating !== null && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                    <Star size={12} fill="currentColor" style={{ color: 'var(--brand-gold, #F5A623)' }} />
                    {p.rating.toFixed(1)}
                    <span style={{ color: 'var(--text-tertiary)' }}>({p.reviews})</span>
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginTop: 'auto', paddingTop: '10px' }}>
                  <span style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--text)' }}>
                    {money(p.price)}
                  </span>
                  {p.unit && <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{p.unit}</span>}
                  {p.was_price !== null && p.was_price > p.price && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textDecoration: 'line-through' }}>
                      {money(p.was_price)}
                    </span>
                  )}
                </div>

                <button
                  className="btn btn-primary"
                  disabled={!available}
                  onClick={() => onAdd(p)}
                  style={{ marginTop: '12px', width: '100%', justifyContent: 'center', gap: '8px', opacity: available ? 1 : 0.5, cursor: available ? 'pointer' : 'not-allowed' }}
                >
                  <ShoppingBag size={15} />
                  {available ? 'Add to basket' : 'Out of stock'}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
