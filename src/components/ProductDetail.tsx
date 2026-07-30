import { useState, useEffect } from 'react'
import { Star, Minus, Plus, Shield, Truck, Zap, Check } from 'lucide-react'
import type { Product } from '../types'
import { getProductImage } from '../lib/images'
import { supabase } from '../lib/supabase'
import { aggregate, orderForDisplay, stars, type Review } from '../lib/reviews'

import type { View } from '../types/view'

interface ProductDetailProps {
  product: Product
  onAddToCart: (product: Product, quantity?: number) => void
  onNavigate: (view: View, opts?: { category?: string; product?: Product }) => void
}

const catColors: Record<string, string> = {
  consumer: 'var(--brand-accent)',
  partner: '#8B5CF6',
  iot: 'var(--success)',
  security: 'var(--info)',
  device: '#F5A623',
  content: '#E63946',
}

export function ProductDetail({ product, onAddToCart, onNavigate }: ProductDetailProps) {
  const [quantity, setQuantity] = useState(1)
  const [activeTab, setActiveTab] = useState<'description' | 'specs' | 'reviews'>('description')
  const [reviews, setReviews] = useState<Review[]>([])

  /* Published reviews only — the read policy allows nothing else to anyone but the
     author and the operator, so this is the public view by construction. */
  useEffect(() => {
    supabase.from('product_reviews').select('*').eq('product_id', product.id)
      .then(({ data }) => setReviews(orderForDisplay((data ?? []) as Review[])))
  }, [product.id])

  const agg = aggregate(reviews)
  const color = catColors[product.category_id] || 'var(--brand-accent)'
  const hasDiscount = product.was_price && product.was_price > product.price
  const outOfStock = product.stock === 'out'

  const fulfilLabels: Record<string, { label: string; icon: React.ReactNode }> = {
    instant: { label: 'Instant delivery', icon: <Zap size={16} /> },
    esim: { label: 'eSIM activation', icon: <Zap size={16} /> },
    shipped: { label: 'Physical delivery', icon: <Truck size={16} /> },
    provisioned: { label: 'Provisioned activation', icon: <Shield size={16} /> },
    activation: { label: 'Activation required', icon: <Shield size={16} /> },
  }

  const fulfilInfo = fulfilLabels[product.fulfil] || fulfilLabels.instant

  return (
    <section style={{ padding: '32px 0 64px' }}>
      <div className="container">
        {/* Breadcrumb */}
        <div style={{ display: 'flex', gap: '8px', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: '24px' }}>
          <button onClick={() => onNavigate('home')} style={{ color: 'inherit' }}>Home</button>
          <span>/</span>
          <button onClick={() => onNavigate('category', { category: product.category_id })} style={{ color: 'inherit', textTransform: 'capitalize' }}>
            {product.category_id}
          </button>
          <span>/</span>
          <span style={{ color: 'var(--text-secondary)' }}>{product.name}</span>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '48px',
          marginBottom: '48px',
        }}>
          {/* Gallery */}
          <div>
            <div
              style={{
                borderRadius: 'var(--radius-lg)',
                height: '420px',
                marginBottom: '16px',
                border: '1px solid var(--border)',
                overflow: 'hidden',
                position: 'relative',
              }}
            >
              <img
                src={getProductImage(product.id)}
                alt={product.name}
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
              {product.badge && (
                <span
                  className={`badge badge-${product.badge.toLowerCase().includes('best') ? 'bestseller' : 'bundle'}`}
                  style={{ position: 'absolute', top: '16px', left: '16px' }}
                >
                  {product.badge}
                </span>
              )}
            </div>
            {/* Thumbnails */}
            <div style={{ display: 'flex', gap: '12px' }}>
              {[1, 2, 3, 4].map((n) => (
                <div
                  key={n}
                  style={{
                    width: '72px',
                    height: '72px',
                    borderRadius: 'var(--radius)',
                    border: n === 1 ? `2px solid ${color}` : '1px solid var(--border)',
                    cursor: 'pointer',
                    overflow: 'hidden',
                  }}
                >
                  <img
                    src={getProductImage(product.id)}
                    alt={`${product.name} view ${n}`}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Info */}
          <div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
              {product.seller}
            </div>
            <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, marginBottom: '12px', lineHeight: 1.2 }}>
              {product.name}
            </h1>

            {product.rating && product.reviews > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' }}>
                <div style={{ display: 'flex' }}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <Star
                      key={n}
                      size={18}
                      fill={n <= Math.round(product.rating!) ? '#F5A623' : 'none'}
                      color={n <= Math.round(product.rating!) ? '#F5A623' : 'var(--gray-300)'}
                    />
                  ))}
                </div>
                <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                  {product.rating.toFixed(1)} · {product.reviews} reviews
                </span>
              </div>
            )}

            {/* Price */}
            <div style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '12px',
              padding: '20px 0',
              borderTop: '1px solid var(--border)',
              borderBottom: '1px solid var(--border)',
              marginBottom: '20px',
            }}>
              <span style={{ fontSize: 'var(--text-4xl)', fontWeight: 800 }}>
                ${product.price.toFixed(2)}
              </span>
              {product.unit && (
                <span style={{ fontSize: 'var(--text-lg)', color: 'var(--text-tertiary)' }}>{product.unit}</span>
              )}
              {hasDiscount && (
                <>
                  <span style={{ fontSize: 'var(--text-lg)', color: 'var(--text-tertiary)', textDecoration: 'line-through' }}>
                    ${product.was_price!.toFixed(2)}
                  </span>
                  <span className="badge badge-stock-out" style={{ background: 'var(--danger)', color: 'white' }}>
                    Save ${(product.was_price! - product.price).toFixed(2)}
                  </span>
                </>
              )}
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                {product.model === 'monthly' ? '/month' : product.model === 'annual' ? '/year' : 'one-time'}
              </span>
            </div>

            {/* Tags */}
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '20px' }}>
              {product.tags.map((tag) => (
                <span key={tag} className="pill">{tag}</span>
              ))}
            </div>

            {/* Fulfilment */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 16px',
              background: 'var(--bg-alt)',
              borderRadius: 'var(--radius)',
              marginBottom: '20px',
            }}>
              <span style={{ color: color }}>{fulfilInfo.icon}</span>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{fulfilInfo.label}</span>
            </div>

            {/* Stock */}
            <div style={{ marginBottom: '24px' }}>
              {product.stock === 'in' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--success)', fontSize: 'var(--text-sm)' }}>
                  <Check size={16} /> In stock — ready to ship
                </div>
              )}
              {product.stock === 'low' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--warning)', fontSize: 'var(--text-sm)' }}>
                  <Check size={16} /> Low stock — order soon
                </div>
              )}
              {product.stock === 'out' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
                  Out of stock — notify me when available
                </div>
              )}
            </div>

            {/* Quantity + Add to cart */}
            {!outOfStock && (
              <div style={{ display: 'flex', gap: '12px', marginBottom: '20px' }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  overflow: 'hidden',
                }}>
                  <button
                    onClick={() => setQuantity(Math.max(1, quantity - 1))}
                    style={{ padding: '12px', display: 'flex', alignItems: 'center' }}
                    aria-label="Decrease quantity"
                  >
                    <Minus size={16} />
                  </button>
                  <span style={{ padding: '0 16px', fontWeight: 600, minWidth: '32px', textAlign: 'center' }}>
                    {quantity}
                  </span>
                  <button
                    onClick={() => setQuantity(quantity + 1)}
                    style={{ padding: '12px', display: 'flex', alignItems: 'center' }}
                    aria-label="Increase quantity"
                  >
                    <Plus size={16} />
                  </button>
                </div>
                <button
                  onClick={() => onAddToCart(product, quantity)}
                  className="btn btn-primary btn-lg"
                  style={{ flex: 1 }}
                >
                  Add to Cart — ${(product.price * quantity).toFixed(2)}
                </button>
              </div>
            )}

            {/* Trust badges */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr 1fr',
              gap: '12px',
              padding: '16px',
              background: 'var(--bg-alt)',
              borderRadius: 'var(--radius)',
            }}>
              {[
                { icon: <Shield size={16} />, label: 'Secure checkout' },
                { icon: <Truck size={16} />, label: 'Free delivery' },
                { icon: <Check size={16} />, label: '30-day returns' },
              ].map((item) => (
                <div key={item.label} style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                  {item.icon}
                  {item.label}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ borderTop: '1px solid var(--border)', paddingTop: '32px' }}>
          <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--border)', marginBottom: '24px' }}>
            {([
              { id: 'description', label: 'Description' },
              { id: 'specs', label: 'Specifications' },
              { id: 'reviews', label: `Reviews (${product.reviews})` },
            ] as const).map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  padding: '12px 20px',
                  fontWeight: 600,
                  fontSize: 'var(--text-sm)',
                  color: activeTab === tab.id ? 'var(--brand-accent)' : 'var(--text-tertiary)',
                  borderBottom: activeTab === tab.id ? '2px solid var(--brand-accent)' : '2px solid transparent',
                  transition: 'all 150ms ease',
                  marginBottom: '-1px',
                }}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {activeTab === 'description' && (
            <div style={{ maxWidth: '720px' }}>
              <p style={{ fontSize: 'var(--text-base)', lineHeight: 1.7, color: 'var(--text-secondary)' }}>
                {product.description}
              </p>
            </div>
          )}
          {activeTab === 'specs' && (
            <div style={{ maxWidth: '600px' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <tbody>
                  <SpecRow label="Category" value={product.sub_category || '—'} />
                  <SpecRow label="Seller" value={product.seller} />
                  <SpecRow label="Pricing model" value={product.model} />
                  <SpecRow label="Fulfilment" value={fulfilInfo.label} />
                  <SpecRow label="Stock status" value={product.stock === 'in' ? 'In stock' : product.stock === 'low' ? 'Low stock' : 'Out of stock'} />
                  <SpecRow label="Listed since" value={product.listed || '—'} />
                  {product.tags.length > 0 && <SpecRow label="Tags" value={product.tags.join(', ')} />}
                </tbody>
              </table>
            </div>
          )}
          {activeTab === 'reviews' && (
            <div style={{ maxWidth: '760px' }}>
              {/* The catalogue's all-time figure, kept as-is. The bars beside it used
                  to be invented — 65% for the modal star, 20% below it, 5% for the
                  rest, computed from nothing. They now come from published reviews,
                  and say so, because two numbers that disagree are better than one
                  that is made up. */}
              {product.rating !== null && product.reviews > 0 && (
                <div style={{ display: 'flex', gap: '32px', marginBottom: '28px', alignItems: 'center' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 'var(--text-5xl)', fontWeight: 800, color: 'var(--text)' }}>
                      {product.rating.toFixed(1)}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <Star key={n} size={20} fill={n <= Math.round(product.rating!) ? '#F5A623' : 'none'} color={n <= Math.round(product.rating!) ? '#F5A623' : 'var(--gray-300)'} />
                      ))}
                    </div>
                    <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                      {product.reviews.toLocaleString()} all-time
                    </div>
                  </div>

                  <div style={{ flex: 1 }}>
                    {agg.count > 0 ? (
                      <>
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '8px' }}>
                          {agg.average} from {agg.count} review{agg.count === 1 ? '' : 's'} on the marketplace
                        </div>
                        {[5, 4, 3, 2, 1].map((star) => {
                          const c = agg.distribution[star - 1]
                          const pct = agg.count > 0 ? Math.round((c / agg.count) * 100) : 0
                          return (
                            <div key={star} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                              <span style={{ fontSize: 'var(--text-xs)', width: '20px' }}>{star}★</span>
                              <div style={{ flex: 1, height: '6px', background: 'var(--gray-100)', borderRadius: '3px', overflow: 'hidden' }}>
                                <div style={{ width: `${pct}%`, height: '100%', background: '#F5A623' }} />
                              </div>
                              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', width: '28px', textAlign: 'right' }}>{c}</span>
                            </div>
                          )
                        })}
                      </>
                    ) : (
                      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', margin: 0 }}>
                        No reviews written on the marketplace yet.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {reviews.length === 0 ? (
                <p style={{ color: 'var(--text-tertiary)' }}>No reviews yet. Buy this and you can be the first.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {reviews.map(r => (
                    <div key={r.id} style={{ borderTop: '1px solid var(--border-light)', paddingTop: '16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                        <span style={{ color: '#F5A623', letterSpacing: '1px' }}>{stars(r.rating)}</span>
                        <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{r.title}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                          {r.author} · {r.submitted}
                        </span>
                      </div>
                      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '8px 0 0', lineHeight: 1.6 }}>{r.body}</p>
                      {r.reply_text && (
                        <div style={{ marginTop: '10px', marginLeft: '12px', paddingLeft: '12px', borderLeft: '3px solid var(--brand-accent-dark)' }}>
                          <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700 }}>{r.reply_by} replied</div>
                          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '3px 0 0', lineHeight: 1.55 }}>{r.reply_text}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </section>
  )
}

function SpecRow({ label, value }: { label: string; value: string }) {
  return (
    <tr style={{ borderBottom: '1px solid var(--border-light)' }}>
      <td style={{ padding: '12px 0', fontWeight: 500, width: '180px', color: 'var(--text-secondary)' }}>{label}</td>
      <td style={{ padding: '12px 0', color: 'var(--text)' }}>{value}</td>
    </tr>
  )
}
