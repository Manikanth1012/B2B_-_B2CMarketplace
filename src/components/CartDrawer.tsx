import { X, Minus, Plus, Trash2, ShoppingBag, Bookmark, Undo2 } from 'lucide-react'
import type { CartItem } from '../types'
import { getProductImage } from '../lib/images'
import {
  activeLines, savedLines, basketCount, basketSubtotal, canCheckout,
  canMoveToBasket, SAVED_CAVEAT,
} from '../lib/basket'

interface CartDrawerProps {
  open: boolean
  items: CartItem[]
  onClose: () => void
  onUpdateQuantity: (itemId: string, quantity: number) => void
  onRemove: (itemId: string) => void
  onCheckout: () => void
  onSetSaved: (itemId: string, saved: boolean) => void
}

export function CartDrawer({ open, items, onClose, onUpdateQuantity, onRemove, onCheckout, onSetSaved }: CartDrawerProps) {
  /* Saved lines live in the same basket but are not part of it: not counted, not
     totalled, not bought. */
  const active = activeLines(items)
  const saved = savedLines(items)
  const subtotal = basketSubtotal(items)

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
            Your Cart ({basketCount(items)})
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
            active.map((item) => (
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

                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', alignSelf: 'flex-start' }}>
                  <button
                    onClick={() => onSetSaved(item.id, true)}
                    style={{ padding: '4px', color: 'var(--text-tertiary)' }}
                    aria-label={`Save ${item.product?.name ?? 'item'} for later`}
                    title="Save for later"
                  >
                    <Bookmark size={15} />
                  </button>
                  <button
                    onClick={() => onRemove(item.id)}
                    style={{ padding: '4px', color: 'var(--text-tertiary)' }}
                    aria-label="Remove"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}

          {/* Saved for later — the prototype keeps these in the basket, dimmed,
              rather than on a screen of their own. */}
          {saved.length > 0 && (
            <div style={{ marginTop: active.length > 0 ? '20px' : 0, paddingTop: '16px', borderTop: '1px solid var(--border)' }}>
              <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Bookmark size={14} /> Saved for later ({saved.length})
              </h3>
              {/* The two questions people actually ask, answered before they ask. */}
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: '0 0 12px' }}>
                {SAVED_CAVEAT}
              </p>
              {saved.map(item => {
                const returnable = canMoveToBasket(item)
                return (
                  <div key={item.id} style={{
                    display: 'flex', gap: '12px', padding: '12px', marginBottom: '8px',
                    borderRadius: 'var(--radius)', border: '1px solid var(--border-light)',
                    background: 'var(--bg-alt)', opacity: 0.92,
                  }}>
                    <div style={{ width: '48px', height: '48px', borderRadius: 'var(--radius)', overflow: 'hidden', flexShrink: 0, border: '1px solid var(--border-light)' }}>
                      <img src={getProductImage(item.product_id)} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{item.product?.seller}</div>
                      <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {item.product?.name}
                      </h4>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: '4px' }}>
                        <button
                          onClick={() => onSetSaved(item.id, false)}
                          disabled={!returnable}
                          className="btn btn-secondary btn-sm"
                          style={{ display: 'flex', alignItems: 'center', gap: '5px', opacity: returnable ? 1 : 0.5, cursor: returnable ? 'pointer' : 'not-allowed' }}
                          title={returnable ? undefined : 'Out of stock'}
                        >
                          <Undo2 size={12} /> {returnable ? 'Move to basket' : 'Out of stock'}
                        </button>
                        <span style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>
                          ${((item.product?.price || 0) * item.quantity).toFixed(2)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => onRemove(item.id)}
                      style={{ padding: '4px', color: 'var(--text-tertiary)', alignSelf: 'flex-start' }}
                      aria-label="Remove"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {canCheckout(items) && (
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
