import { Star, ArrowRight, Bell, ShoppingBag } from 'lucide-react'
import { getProductImage } from '../../lib/images'
import { useMarket } from '../../lib/MarketContext'
import { StatusBadge } from './StatusBadge'
import { stockLabel } from '../../lib/compare'

export interface CardProduct {
  id: string
  name: string
  seller: string
  description?: string | null
  price: number
  was_price?: number | null
  currency?: string
  unit?: string | null
  rating: number | null
  reviews: number
  badge?: string | null
  stock: string
}

/** The colour family for a catalogue badge. The words are the operator's;
    this only picks the tint, and the text carries the meaning. */
export function badgeTone(badge: string): 'success' | 'warning' | 'info' | 'neutral' {
  const b = badge.toLowerCase()
  if (b.includes('best') || b.includes('popular')) return 'warning'
  if (b.includes('new')) return 'success'
  if (b.includes('bundle') || b.includes('recommend')) return 'info'
  return 'neutral'
}

export function stockTone(stock: string): 'success' | 'warning' | 'danger' {
  const s = stock.toLowerCase()
  if (s.includes('out')) return 'danger'
  if (s.includes('low')) return 'warning'
  return 'success'
}

/* A real catalogue row: its own photograph, name, seller, description, price in
   the currency it was priced in, and rating only when buyers have left one. The
   name is the button that opens the product, stretched over the whole card by CSS;
   the basket button and checkbox sit above it as separate, reachable controls. */
export function ProductCard({ product: p, onOpen, action, compare, showStock, notify, priceNote, badges, priceSlot }: {
  product: CardProduct
  onOpen: (p: CardProduct) => void
  action?: { label: string; onClick: () => void; disabled?: boolean }
  compare?: { checked: boolean; onToggle: () => void; disabled?: boolean }
  showStock?: boolean
  notify?: { watching: boolean; onNotify: () => void }
  priceNote?: string
  /* Business shelf only: preferred and price-book badges, and the account's own price in place of the plain figure. */
  badges?: React.ReactNode
  priceSlot?: React.ReactNode
}) {
  const { fmtIn, currency } = useMarket()
  const price = (n: number) => fmtIn(n, p.currency ?? currency?.code ?? 'USD')
  const outOfStock = stockTone(p.stock) === 'danger'
  const hasRating = p.rating !== null && p.rating > 0

  return (
    <article className="p-card">
      <div className="p-card__media">
        <img src={getProductImage(p.id)} alt="" loading="lazy" />
        {p.badge && (
          <span className="p-card__badge">
            <StatusBadge tone={badgeTone(p.badge)} icon={null}>{p.badge}</StatusBadge>
          </span>
        )}
      </div>
      <div className="p-card__body">
        <h3 className="p-card__name">
          <button type="button" className="p-card__open" onClick={() => onOpen(p)}
            aria-label={`${p.name}, ${price(p.price)} — view details`}>{p.name}</button>
        </h3>
        <div className="p-card__seller">{p.seller}</div>
        {badges}
        {p.description && <p className="p-card__desc">{p.description}</p>}
        {hasRating && (
          <div className="p-card__rating">
            <Star size={12} fill="currentColor" style={{ color: 'var(--brand-gold)' }} aria-hidden />
            {p.rating!.toFixed(1)} <span style={{ color: 'var(--text-tertiary)' }}>({p.reviews})</span>
          </div>
        )}
        {showStock && <div><StatusBadge tone={stockTone(p.stock)}>{stockLabel(p.stock)}</StatusBadge></div>}
        <div className="p-card__foot">
          <span className="p-card__price">
            {priceSlot ?? price(p.price)}
            {(priceNote ?? p.unit) && <span className="p-card__unit">{priceNote ?? p.unit}</span>}
            {p.was_price != null && p.was_price > p.price && (
              <span className="p-card__was">{price(p.was_price)}</span>
            )}
          </span>
          {!action && <span className="ui-link" aria-hidden>View details <ArrowRight size={14} /></span>}
        </div>
        {(action || compare || (notify && outOfStock)) && (
          <div className="p-card__actions">
            {compare && (
              <label className="p-card__compare">
                <input type="checkbox" aria-label={`Compare ${p.name}`} checked={compare.checked} disabled={compare.disabled} onChange={compare.onToggle} />
                Compare
              </label>
            )}
            {notify && outOfStock ? (
              <button className="btn btn-sm btn-secondary" onClick={notify.onNotify} disabled={notify.watching}>
                <Bell size={14} aria-hidden /> {notify.watching ? 'You will be told' : 'Notify me'}
              </button>
            ) : action && (
              <button className="btn btn-sm btn-cyan" onClick={action.onClick} disabled={action.disabled}>
                <ShoppingBag size={14} aria-hidden /> {action.label}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
