import { useMarket } from '../../lib/MarketContext'
import { useId } from 'react'
import type { Category, Product } from '../../types'
import { getCategoryImage } from '../../lib/images'
import { exampleProducts } from '../../lib/storefront'

/* "What sells here", for the partner page. A prospective seller wants to know which
   marketplaces they can list into and what already sells in each — so this is the
   six categories with real listings underneath them, not a rail of stock imagery. */



export function CategoryShowcase({ title, subtitle, categories, products, counts }: {
  title: string
  subtitle?: string
  categories: readonly Category[]
  products: readonly Product[]
  counts: Record<string, number>
}) {
  /* The product carries the currency it was priced in — these pages reprice
     for the market like every other surface. Printing a dollar sign over a
     rupee amount is worse than either mistake alone: the number is right and
     the label says it is something else. */
  const { fmt } = useMarket()
  const money = (n: number) => fmt(n)
  const headingId = useId()
  if (categories.length === 0) return <></>

  return (
    <section className="container" style={{ paddingTop: '40px', paddingBottom: '40px' }} aria-labelledby={headingId}>
      <h2 id={headingId} style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>{title}</h2>
      {subtitle && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '4px' }}>{subtitle}</p>}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
        gap: '20px', marginTop: '24px',
      }}>
        {categories.map(cat => {
          const examples = exampleProducts(products, cat.id)
          return (
            <article key={cat.id} className="card" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <div style={{ position: 'relative', height: '120px' }}>
                <img
                  src={getCategoryImage(cat.id)}
                  alt=""
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <span style={{
                  position: 'absolute', top: '10px', left: '10px', padding: '3px 8px',
                  borderRadius: '999px', background: 'rgba(6,15,28,0.82)', color: 'white',
                  fontSize: 'var(--text-xs)', fontWeight: 600,
                }}>
                  {cat.audience}
                </span>
              </div>

              <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '8px' }}>
                  <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text)', margin: 0 }}>
                    {cat.name}
                  </h3>
                  {counts[cat.id] > 0 && (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
                      {counts[cat.id]} listed
                    </span>
                  )}
                </div>

                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: '6px 0 0', lineHeight: 1.5 }}>
                  {cat.blurb}
                </p>

                {examples.length > 0 && (
                  <div style={{ marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                    <div style={{
                      fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-secondary)',
                      textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px',
                    }}>
                      Selling now
                    </div>
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      {examples.map(p => (
                        <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '12px', fontSize: 'var(--text-xs)' }}>
                          <span style={{ color: 'var(--text)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {p.name}
                            <span style={{ color: 'var(--text-tertiary)' }}> · {p.seller}</span>
                          </span>
                          <span style={{ color: 'var(--text)', fontWeight: 700, whiteSpace: 'nowrap' }}>{money(p.price)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}
