import { Star, ArrowRight } from 'lucide-react'
import type { Product } from '../../types'
import { getProductImage } from '../../lib/images'
import { useMarket } from '../../lib/MarketContext'
import { StatusBadge } from './StatusBadge'

/** The colour family for a catalogue badge. The words are the operator's;
    this only picks the tint, and the text carries the meaning. */
export function badgeTone(badge: string): 'success' | 'warning' | 'info' | 'neutral' {
  const b = badge.toLowerCase()
  if (b.includes('best') || b.includes('popular')) return 'warning'
  if (b.includes('new')) return 'success'
  if (b.includes('bundle') || b.includes('recommend')) return 'info'
  return 'neutral'
}

/* A real catalogue row: its own photograph, name, seller, description, price in
   the visitor's currency, and rating only when buyers have left one. The whole
   card opens the product; it is a real control, reachable by keyboard. */
export function ProductCard({ product: p, onOpen }: {
  product: Product
  onOpen: (p: Product) => void
}) {
  const { fmt } = useMarket()
  return (
    <article
      className="p-card"
      role="button"
      tabIndex={0}
      aria-label={`${p.name}, ${fmt(p.price)} — view details`}
      onClick={() => onOpen(p)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(p) } }}
    >
      <div className="p-card__media">
        <img src={getProductImage(p.id)} alt="" loading="lazy" />
        {p.badge && (
          <span className="p-card__badge">
            <StatusBadge tone={badgeTone(p.badge)} icon={null}>{p.badge}</StatusBadge>
          </span>
        )}
      </div>
      <div className="p-card__body">
        <div className="p-card__name">{p.name}</div>
        <div className="p-card__seller">{p.seller}</div>
        {p.description && <p className="p-card__desc">{p.description}</p>}
        {p.rating !== null && (
          <div className="p-card__rating">
            <Star size={12} fill="currentColor" style={{ color: 'var(--brand-gold)' }} aria-hidden />
            {p.rating.toFixed(1)} <span style={{ color: 'var(--text-tertiary)' }}>({p.reviews})</span>
          </div>
        )}
        <div className="p-card__foot">
          <span className="p-card__price">
            {fmt(p.price)}{p.unit && <span className="p-card__unit">{p.unit}</span>}
          </span>
          <span className="ui-link" aria-hidden>View details <ArrowRight size={14} /></span>
        </div>
      </div>
    </article>
  )
}
