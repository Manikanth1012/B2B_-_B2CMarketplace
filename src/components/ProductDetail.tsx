import { useState, useEffect } from 'react'
import { Star, Minus, Plus, Shield, Truck, Zap, Check } from 'lucide-react'
import type { Product } from '../types'
import { getProductImage } from '../lib/images'
import { supabase } from '../lib/supabase'
import {
  aggregate, orderForDisplay, stars, provenanceOf, PROVENANCE_BADGE, verifiedShare,
  type Review,
} from '../lib/reviews'
import { useMarket } from '../lib/MarketContext'
import { stockLabel } from '../lib/compare'
import { StatusBadge, stockTone } from './ui'

import type { View } from '../types/view'

interface ProductDetailProps {
  product: Product
  onAddToCart: (product: Product, quantity?: number) => void
  /* Optional, because this page is shown on the public storefront too, where
     there is no consumer router to navigate — the public surface is its own
     state machine and knows nothing about `View`. Everything else this page
     renders comes from the product row and published reviews, both of which
     `anon` may read, so the same component serves signed-in and signed-out
     rather than there being a second one to keep in step. */
  onNavigate?: (view: View, opts?: { category?: string; product?: Product }) => void
  /* Trims the page chrome for the modal the public pages open it in. */
  compact?: boolean
}

export function ProductDetail({ product, onAddToCart, onNavigate, compact = false }: ProductDetailProps) {
  /* The product arrived already priced in the market's currency — `repriceAll`
     did that at load, and it stamped the currency on the row. So this page
     formats what it was given rather than converting anything, the same way the
     card the shopper clicked to get here does. */
  const { fmtIn } = useMarket()
  const price = (n: number) => fmtIn(n, product.currency ?? 'USD')
  const [quantity, setQuantity] = useState(1)
  const [reviews, setReviews] = useState<Review[]>([])
  /* The photographs this product actually has, and which one is showing.

     The strip used to be `[1, 2, 3, 4].map` over one image: four identical
     thumbnails, the first ringed as selected, none of them clickable. It looked
     like a gallery and was decoration. `product_media` holds the real rows —
     every product has two, 38 of the 47 are genuinely different pictures, and
     each carries its own alt text. */
  const [media, setMedia] = useState<{ url: string; alt: string }[]>([])
  const [shown, setShown] = useState(0)

  /* Published reviews only — the read policy allows nothing else to anyone but the
     author and the operator, so this is the public view by construction. */
  useEffect(() => {
    supabase.from('product_reviews').select('*').eq('product_id', product.id)
      .then(({ data }) => setReviews(orderForDisplay((data ?? []) as Review[])))
  }, [product.id])

  useEffect(() => {
    /* Back to the first shot when the product changes, or the second picture of
       the last one is still selected on a product that may not have two. */
    setShown(0)
    supabase.from('product_media').select('url, alt, sort_order')
      .eq('product_id', product.id).order('sort_order')
      .then(({ data }) => setMedia(((data ?? []) as { url: string; alt: string | null }[])
        .map(r => ({ url: r.url, alt: r.alt ?? '' }))))
  }, [product.id])

  /* The card's picture first, then anything else this product has.

     Leading with `getProductImage` rather than the media table's own hero keeps
     the detail opening on the photograph that was clicked — the two sources
     disagree on about half the catalogue, and a card that shows one picture and
     opens on another reads as the wrong product. Duplicates are dropped, so a
     product whose rows are all the same photograph gets one shot and no strip:
     one picture is not a gallery. */
  const shots: { url: string; alt: string }[] = []
  for (const shot of [{ url: getProductImage(product.id), alt: product.name }, ...media]) {
    if (!shots.some(s => s.url === shot.url)) shots.push(shot)
  }
  const active = shots[Math.min(shown, shots.length - 1)]

  const agg = aggregate(reviews)
  const backing = verifiedShare(reviews)
  const hasDiscount = product.was_price && product.was_price > product.price
  const outOfStock = product.stock === 'out'
  const specEntries = Object.entries(product.specs ?? {})

  const fulfilLabels: Record<string, { label: string; icon: React.ReactNode }> = {
    instant: { label: 'Instant delivery', icon: <Zap size={16} /> },
    esim: { label: 'eSIM activation', icon: <Zap size={16} /> },
    shipped: { label: 'Physical delivery', icon: <Truck size={16} /> },
    provisioned: { label: 'Provisioned activation', icon: <Shield size={16} /> },
    activation: { label: 'Activation required', icon: <Shield size={16} /> },
  }

  const fulfilInfo = fulfilLabels[product.fulfil] || fulfilLabels.instant

  return (
    <section style={{ padding: compact ? '0' : '32px 0 64px' }}>
      <div className={compact ? undefined : 'container'}>
        {/* Breadcrumb. Plain text where there is nowhere to navigate to — a
            crumb that looks like a link and does nothing is worse than one that
            does not look like a link. */}
        <div style={{ display: 'flex', gap: '8px', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: '24px' }}>
          {onNavigate ? (
            <>
              <button onClick={() => onNavigate('home')} style={{ color: 'inherit' }}>Home</button>
              <span>/</span>
              <button onClick={() => onNavigate('category', { category: product.category_id })} style={{ color: 'inherit', textTransform: 'capitalize' }}>
                {product.category_id}
              </button>
            </>
          ) : (
            <span style={{ textTransform: 'capitalize' }}>{product.category_id}</span>
          )}
          <span>/</span>
          <span style={{ color: 'var(--text-secondary)' }}>{product.name}</span>
        </div>

        <div className={`pd${compact ? ' pd--compact' : ''}`}>
          <div className="pd__gallery">
            <div className="pd__media" style={{ position: 'relative' }}>
              <img src={active.url} alt={active.alt || product.name} />
              {product.badge && (
                <span
                  className={`badge badge-${product.badge.toLowerCase().includes('best') ? 'bestseller' : 'bundle'}`}
                  style={{ position: 'absolute', top: '16px', left: '16px' }}
                >
                  {product.badge}
                </span>
              )}
            </div>
            {/* Thumbnails. Only where there is more than one photograph, and
                each one is a real button: it changes the picture above, says
                which is showing, and can be reached with a keyboard. */}
            {shots.length > 1 && (
              <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }} role="group" aria-label={`${product.name} photographs`}>
                {shots.map((shot, i) => (
                  <button
                    key={shot.url}
                    type="button"
                    onClick={() => setShown(i)}
                    aria-label={shot.alt || `${product.name} photograph ${i + 1}`}
                    aria-current={i === shown}
                    style={{
                      width: '72px',
                      height: '72px',
                      padding: 0,
                      borderRadius: 'var(--radius)',
                      border: i === shown ? '2px solid var(--brand-accent-dark)' : '1px solid var(--border)',
                      cursor: 'pointer',
                      overflow: 'hidden',
                      background: 'none',
                    }}
                  >
                    <img
                      src={shot.url}
                      alt=""
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* The buying decision: held in view beside the page on a desktop. */}
          <aside className="pd__buy" aria-label="Buy this product">
            <div>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '8px' }}>
                {product.seller}
              </div>
              <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, lineHeight: 1.2, color: 'var(--text)' }}>
                {product.name}
              </h1>
            </div>

            {product.rating && product.reviews > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
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
              flexWrap: 'wrap',
              gap: '4px 12px',
              padding: '16px 0',
              borderTop: '1px solid var(--border)',
              borderBottom: '1px solid var(--border)',
            }}>
              <span className="pd__price">{price(product.price)}</span>
              {product.unit && (
                <span style={{ fontSize: 'var(--text-lg)', color: 'var(--text-secondary)' }}>{product.unit}</span>
              )}
              {hasDiscount && (
                <>
                  <span style={{ fontSize: 'var(--text-lg)', color: 'var(--text-secondary)', textDecoration: 'line-through' }}>
                    {price(product.was_price!)}
                  </span>
                  <StatusBadge tone="danger" icon={null}>
                    Save {price(product.was_price! - product.price)}
                  </StatusBadge>
                </>
              )}
              <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                {product.model === 'monthly' ? '/month' : product.model === 'annual' ? '/year' : 'one-time'}
              </span>
            </div>

            {/* Stock */}
            <div>
              <StatusBadge tone={stockTone(product.stock)}>{stockLabel(product.stock)}</StatusBadge>
              {product.stock === 'in' && (
                <span style={{ marginLeft: '8px', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Ready to ship</span>
              )}
              {product.stock === 'low' && (
                <span style={{ marginLeft: '8px', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Order soon</span>
              )}
              {product.stock === 'out' && (
                <div style={{ marginTop: '8px', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                  Notify me when available
                </div>
              )}
            </div>

            {/* Fulfilment */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              padding: '12px 16px',
              background: 'var(--bg-alt)',
              borderRadius: 'var(--radius)',
            }}>
              <span style={{ color: 'var(--text-secondary)', display: 'flex' }}>{fulfilInfo.icon}</span>
              <span style={{ fontSize: 'var(--text-sm)', fontWeight: 500 }}>{fulfilInfo.label}</span>
            </div>

            {/* Quantity + Add to cart */}
            {!outOfStock && (
              <>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  alignSelf: 'flex-start',
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
                  className="btn btn-cyan btn-lg"
                  style={{ width: '100%' }}
                >
                  Add to Cart — {price(product.price * quantity)}
                </button>
              </>
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
          </aside>

          {/* What the product is: picture, overview, specifications, seller, reviews. */}
          <div className="pd__main">

            <div className="pd__section">
              <h2>Overview</h2>
              <p style={{ fontSize: 'var(--text-base)', lineHeight: 1.7, color: 'var(--text-secondary)', maxWidth: '720px' }}>
                {product.description}
              </p>
              {product.tags.length > 0 && (
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px' }}>
                  {product.tags.map((tag) => (
                    <span key={tag} className="pill">{tag}</span>
                  ))}
                </div>
              )}
            </div>

            {specEntries.length > 0 && (
              <div className="pd__section">
                <details className="pd-acc">
                  <summary>Specifications</summary>
                  <dl>
                    {specEntries.map(([k, v]) => (
                      <div key={k} style={{ display: 'contents' }}>
                        <dt>{k}</dt>
                        <dd>{v}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </div>
            )}

            <div className="pd__section">
              <h2>Seller</h2>
              <div className="pd-acc">
                <dl style={{ paddingTop: '16px' }}>
                  <dt>Seller</dt><dd>{product.seller}</dd>
                  <dt>Category</dt><dd style={{ textTransform: 'capitalize' }}>{product.sub_category || product.category_id}</dd>
                  <dt>Pricing model</dt><dd style={{ textTransform: 'capitalize' }}>{product.model}</dd>
                  <dt>Fulfilment</dt><dd>{fulfilInfo.label}</dd>
                  {product.listed && (<><dt>Listed since</dt><dd>{product.listed}</dd></>)}
                </dl>
              </div>
            </div>

            <div className="pd__section">
              <h2>Reviews ({product.reviews})</h2>
              <div style={{ maxWidth: '760px' }}>
                {/* The catalogue's all-time figure, kept as-is. The bars beside it used
                    to be invented — 65% for the modal star, 20% below it, 5% for the
                    rest, computed from nothing. They now come from published reviews,
                    and say so, because two numbers that disagree are better than one
                    that is made up. */}
                {product.rating !== null && product.reviews > 0 && (
                  <div style={{ display: 'flex', gap: '32px', marginBottom: '28px', alignItems: 'center', flexWrap: 'wrap' }}>
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

                    <div style={{ flex: 1, minWidth: '220px' }}>
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
                          {/* Counted, not converted to a percentage: "2 of 3 backed by an
                              order" and "200 of 300" are different facts about a product,
                              and 67% hides which one you are reading. */}
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '8px' }}>
                            {backing.verified} of {backing.published} backed by an order on file
                          </div>
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
                          {/* Badged when the order is on file, silent otherwise. There is no
                              "unverified" badge on purpose — it reads as an accusation against
                              someone who may simply have bought the thing before this
                              marketplace existed. */}
                          {PROVENANCE_BADGE[provenanceOf(r)] && (
                            <span style={{
                              fontSize: 'var(--text-xs)', fontWeight: 600, padding: '2px 8px',
                              borderRadius: '10px', background: 'var(--green-50, #ECFDF3)',
                              color: 'var(--green-700, #067647)',
                              border: '1px solid var(--green-200, #ABEFC6)',
                            }}>
                              {PROVENANCE_BADGE[provenanceOf(r)]}
                            </span>
                          )}
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
            </div>
          </div>
        </div>
      </div>

      {/* On a phone the price and the button follow the shopper down the page.
          Not in the modal, which has its own footing. */}
      {!compact && !outOfStock && (
        <div className="pd__bar">
          <span className="pd__price" style={{ fontSize: 'var(--text-xl)' }}>{price(product.price * quantity)}</span>
          <button onClick={() => onAddToCart(product, quantity)} className="btn btn-cyan btn-lg">
            Add to Cart
          </button>
        </div>
      )}
    </section>
  )
}
