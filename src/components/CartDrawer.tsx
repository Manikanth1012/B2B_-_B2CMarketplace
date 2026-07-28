import { X, Minus, Plus, Trash2, ShoppingBag } from 'lucide-react'
import type { CartItem } from '../types'
import { getProductImage } from '../lib/images'

interface CartDrawerProps {
  open: boolean
  items: CartItem[]
  onClose: () => void
  onUpdateQuantity: (itemId: string, quantity: number) => void
  onRemove: (itemId: string) => void
  onCheckout: () => void
}

export function CartDrawer({ open, items, onClose, onUpdateQuantity, onRemove, onCheckout }: CartDrawerProps) {
  const subtotal = items.reduce((sum, item) => {
    const price = item.product?.price || 0
    return sum + price * item.quantity
  }, 0)

  return (
    <>
      {/* Overlay */}
      {open && (
        <div
          onClick={onClose}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 200,
            animation: 'fadeIn 200ms ease',
          }}
        />
      )}

      {/* Drawer */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: '420px',
          maxWidth: '100vw',
          background: 'white',
          zIndex: 201,
          display: 'flex',
          flexDirection: 'column',
          transform: open ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 300ms cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: 'var(--shadow-xl)',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '20px',
          borderBottom: '1px solid var(--border)',
        }}>
          <h2 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <ShoppingBag size={20} />
            Your Cart ({items.length})
          </h2>
          <button onClick={onClose} style={{ padding: '8px', borderRadius: 'var(--radius)' }}>
            <X size={20} />
          </button>
        </div>

        {/* Items */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
          {items.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '64px 20px', color: 'var(--text-tertiary)' }}>
              <ShoppingBag size={48} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
              <p style={{ fontWeight: 500, marginBottom: '4px' }}>Your cart is empty</p>
              <p style={{ fontSize: 'var(--text-sm)' }}>Browse the marketplace to add products.</p>
            </div>
          ) : (
            items.map((item) => (
              <div
                key={item.id}
                style={{
                  display: 'flex',
                  gap: '12px',
                  padding: '12px',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border-light)',
                  marginBottom: '8px',
                }}
              >
                {/* Thumbnail */}
                <div style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: 'var(--radius)',
                  overflow: 'hidden',
                  flexShrink: 0,
                  border: '1px solid var(--border-light)',
                }}>
                  <img
                    src={getProductImage(item.product_id)}
                    alt={item.product?.name || ''}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                </div>

                {/* Info */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{item.product?.seller}</div>
                  <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.product?.name}
                  </h4>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                      <button
                        onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                        style={{ padding: '4px 6px', display: 'flex' }}
                        aria-label="Decrease"
                      >
                        <Minus size={12} />
                      </button>
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 600, minWidth: '20px', textAlign: 'center' }}>
                        {item.quantity}
                      </span>
                      <button
                        onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                        style={{ padding: '4px 6px', display: 'flex' }}
                        aria-label="Increase"
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                    <span style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>
                      ${((item.product?.price || 0) * item.quantity).toFixed(2)}
                    </span>
                  </div>
                </div>

                <button
                  onClick={() => onRemove(item.id)}
                  style={{ padding: '4px', color: 'var(--text-tertiary)', alignSelf: 'flex-start' }}
                  aria-label="Remove"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div style={{ padding: '20px', borderTop: '1px solid var(--border)', background: 'var(--bg-alt)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Subtotal</span>
              <span style={{ fontWeight: 700 }}>${subtotal.toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Tax (estimated)</span>
              <span style={{ fontWeight: 500 }}>${(subtotal * 0.18).toFixed(2)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
              <span style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>Total</span>
              <span style={{ fontWeight: 800, fontSize: 'var(--text-lg)' }}>${(subtotal * 1.18).toFixed(2)}</span>
            </div>
            <button onClick={onCheckout} className="btn btn-primary btn-lg" style={{ width: '100%' }}>
              Proceed to Checkout
            </button>
          </div>
        )}
      </div>
    </>
  )
}
