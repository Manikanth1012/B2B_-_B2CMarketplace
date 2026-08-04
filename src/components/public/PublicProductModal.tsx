/* A product's own page, opened from the public storefront.
 *
 * The cards on the Retail and Enterprise pages showed a name, a price and an
 * Add button and nothing else was clickable — a visitor could put something in
 * a basket but not read what it was. The signed-in shopper has had a full
 * product page all along.
 *
 * So this shows that page rather than a second, thinner version of it.
 * `ProductDetail` needs no session: everything on it comes from the product row
 * and published reviews, and `anon` may read both. A separate public summary
 * would be one more thing to keep in step with it, and the first thing to fall
 * behind would be the specifications nobody remembers exist.
 *
 * A modal rather than a route because the public surface is a small state
 * machine with four pages on it, and a product is not a fifth — the visitor is
 * mid-browse and expects to come back to where they were.
 */
import { useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import { ProductDetail } from '../ProductDetail'
import type { Product } from '../../types'

export function PublicProductModal({ product, onClose, onAddToBasket }: {
  product: Product | null
  onClose: () => void
  onAddToBasket: (p: Product) => void
}) {
  const panel = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!product) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    /* The page behind must not scroll while this is over it — on a long
       storefront the wheel otherwise moves the page and leaves the dialog
       sitting still, which reads as frozen. */
    const had = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = had
    }
  }, [product, onClose])

  if (!product) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.45)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '32px 16px', overflowY: 'auto',
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={product.name}
        tabIndex={-1}
        onClick={e => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-lg)',
          width: 'min(920px, 100%)', padding: '24px', position: 'relative', outline: 'none',
        }}
      >
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: '14px', right: '14px', zIndex: 1,
            background: 'white', border: '1px solid var(--border)', borderRadius: '50%',
            width: '32px', height: '32px', display: 'flex', alignItems: 'center',
            justifyContent: 'center', cursor: 'pointer', color: 'var(--text-secondary)',
          }}
        >
          <X size={18} />
        </button>

        {/* No `onNavigate`: there is nowhere on the public surface for a
            breadcrumb to go, so it renders as text. */}
        <ProductDetail
          compact
          product={product}
          onAddToCart={p => { onAddToBasket(p); onClose() }}
        />
      </div>
    </div>
  )
}
