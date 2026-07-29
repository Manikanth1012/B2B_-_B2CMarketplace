import { Star, Plus } from 'lucide-react'
import type { Product } from '../types'
import { getProductImage } from '../lib/images'

interface ProductCardProps {
  product: Product
  onClick: () => void
  onAddToCart: () => void
}

/* Hex literals on purpose: these feed `${color}10` / `${color}05` below, where
   the suffix is hex alpha. var() cannot participate in that concatenation.
   Decorative card tints only — no text is rendered on them. */
const catColors: Record<string, string> = {
  consumer: '#00A6A6',
  partner: '#8B5CF6',
  iot: '#16A34A',
  security: '#2563EB',
  device: '#F5A623',
  content: '#E63946',
}

export function ProductCard({ product, onClick, onAddToCart }: ProductCardProps) {
  const color = catColors[product.category_id] || '#00A6A6'
  const hasDiscount = product.was_price && product.was_price > product.price
  const outOfStock = product.stock === 'out'

  return (
    <div
      className="card card-hover"
      style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column' }}
      onClick={onClick}
    >
      {/* Image area */}
      <div
        style={{
          height: '200px',
          position: 'relative',
          overflow: 'hidden',
          borderBottom: '1px solid var(--border-light)',
          background: `linear-gradient(135deg, ${color}10, ${color}05)`,
        }}
      >
        {/* Badge */}
        {product.badge && (
          <span
            className={`badge badge-${product.badge.toLowerCase().includes('best') ? 'bestseller' : 'bundle'}`}
            style={{ position: 'absolute', top: '12px', left: '12px', zIndex: 2 }}
          >
            {product.badge}
          </span>
        )}
        {/* Discount badge */}
        {hasDiscount && (
          <span
            className="badge badge-stock-out"
            style={{ position: 'absolute', top: '12px', right: '12px', background: 'var(--danger)', color: 'white', zIndex: 2 }}
          >
            -{Math.round((1 - product.price / (product.was_price || product.price)) * 100)}%
          </span>
        )}
        <img
          src={getProductImage(product.id)}
          alt={product.name}
          loading="lazy"
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            transition: 'transform 400ms ease',
          }}
          onError={(e) => {
            const img = e.currentTarget
            if (img.dataset.fallback) return
            img.dataset.fallback = '1'
            img.src = `data:image/svg+xml,${encodeURIComponent(
              `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="200" viewBox="0 0 400 200"><rect width="400" height="200" fill="${color}10"/><text x="200" y="100" font-family="sans-serif" font-size="14" fill="${color}" text-anchor="middle" dominant-baseline="middle">${product.name.slice(0, 30)}</text></svg>`
            )}`
          }}
          onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.08)'}
          onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
        />
      </div>

      {/* Content */}
      <div style={{ padding: '16px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* Seller */}
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
          {product.seller}
        </div>

        {/* Name */}
        <h3 style={{
          fontWeight: 600,
          fontSize: 'var(--text-sm)',
          marginBottom: '8px',
          lineHeight: 1.4,
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}>
          {product.name}
        </h3>

        {/* Rating */}
        {product.rating && product.reviews > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              {[1, 2, 3, 4, 5].map((n) => (
                <Star
                  key={n}
                  size={12}
                  fill={n <= Math.round(product.rating!) ? '#F5A623' : 'none'}
                  color={n <= Math.round(product.rating!) ? '#F5A623' : 'var(--gray-300)'}
                />
              ))}
            </div>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {product.rating.toFixed(1)} ({product.reviews})
            </span>
          </div>
        )}

        {/* Tags */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', marginBottom: '12px' }}>
          {product.tags.slice(0, 2).map((tag) => (
            <span key={tag} className="pill" style={{ fontSize: '10px', padding: '2px 8px' }}>
              {tag}
            </span>
          ))}
        </div>

        {/* Price + action */}
        <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
              <span style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>
                ${product.price.toFixed(2)}
              </span>
              {product.unit && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {product.unit}
                </span>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              {hasDiscount && (
                <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textDecoration: 'line-through' }}>
                  ${product.was_price!.toFixed(2)}
                </span>
              )}
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                {product.model === 'monthly' ? '/mo' : product.model === 'annual' ? '/yr' : 'one-off'}
              </span>
            </div>
          </div>

          {outOfStock ? (
            <span className="badge badge-stock-out">Out of stock</span>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onAddToCart()
              }}
              className="btn btn-primary btn-sm"
              style={{ padding: '8px 12px' }}
            >
              <Plus size={14} />
              Add
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
