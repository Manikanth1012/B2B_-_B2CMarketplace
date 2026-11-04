import { useEffect } from 'react'
import { X, Minus, Plus, Trash2, ShoppingBag, Bookmark, Undo2 } from 'lucide-react'
import type { CartItem } from '../types'
import { getProductImage } from '../lib/images'
import {
  activeLines, savedLines, basketCount, basketMoney, canCheckout,
  canMoveToBasket, SAVED_CAVEAT,
} from '../lib/basket'
import { useMarket } from '../lib/MarketContext'

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

  /* The shopper's own money and the rate where they are. Both used to be
     written into this file — a `$` in four places and a hard-coded 0.18, which
     is India's GST charged to a shopper in Nairobi where it is sixteen. */
  const { market, fmt } = useMarket()
  const money = basketMoney(items, Number(market?.tax_rate ?? 0))
  const taxLabel = market?.tax_label ?? 'Tax'

  /* Escape closes the drawer — listened for only while it is open. */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

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
      <div className={`drawer${open ? ' drawer--open' : ''}`}>
        {/* Header */}
        <div className="drawer__head">
          <h2>
            <ShoppingBag size={20} />
            Your Cart ({basketCount(items)})
          </h2>
          <button onClick={onClose} className="drawer-icon-btn" aria-label="Close cart">
            <X size={20} />
          </button>
        </div>

        {/* Items */}
        <div className="drawer__body">
          {items.length === 0 ? (
            <div className="drawer__empty">
              <ShoppingBag size={48} />
              <p style={{ fontWeight: 500, marginBottom: '4px' }}>Your cart is empty</p>
              <p style={{ fontSize: 'var(--text-sm)' }}>Browse the marketplace to add products.</p>
            </div>
          ) : (
            active.map((item) => (
              <div key={item.id} className="line">
                {/* Thumbnail */}
                <div className="line__thumb">
                  <img src={getProductImage(item.product_id)} alt={item.product?.name || ''} />
                </div>

                {/* Info */}
                <div className="line__info">
                  <div className="line__seller">{item.product?.seller}</div>
                  <h4 className="line__name">{item.product?.name}</h4>
                  <div className="line__row">
                    <div className="stepper">
                      <button
                        onClick={() => onUpdateQuantity(item.id, item.quantity - 1)}
                        aria-label="Decrease"
                      >
                        <Minus size={14} />
                      </button>
                      <span>{item.quantity}</span>
                      <button
                        onClick={() => onUpdateQuantity(item.id, item.quantity + 1)}
                        aria-label="Increase"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                    <span className="line__price">
                      {fmt((item.product?.price || 0) * item.quantity)}
                    </span>
                  </div>
                </div>

                <div className="line__actions">
                  <button
                    onClick={() => onSetSaved(item.id, true)}
                    className="drawer-icon-btn"
                    aria-label={`Save ${item.product?.name ?? 'item'} for later`}
                    title="Save for later"
                  >
                    <Bookmark size={16} />
                  </button>
                  <button
                    onClick={() => onRemove(item.id)}
                    className="drawer-icon-btn"
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
            <div className="drawer__saved" style={{ marginTop: active.length > 0 ? '20px' : 0 }}>
              <h3>
                <Bookmark size={14} /> Saved for later ({saved.length})
              </h3>
              {/* The two questions people actually ask, answered before they ask. */}
              <p className="drawer__saved-note">
                {SAVED_CAVEAT}
              </p>
              {saved.map(item => {
                const returnable = canMoveToBasket(item)
                return (
                  <div key={item.id} className="line line--saved">
                    <div className="line__thumb">
                      <img src={getProductImage(item.product_id)} alt="" />
                    </div>
                    <div className="line__info">
                      <div className="line__seller">{item.product?.seller}</div>
                      <h4 className="line__name" style={{ fontWeight: 500, marginBottom: '4px' }}>
                        {item.product?.name}
                      </h4>
                      <div className="line__row">
                        <button
                          onClick={() => onSetSaved(item.id, false)}
                          disabled={!returnable}
                          className="btn btn-secondary btn-sm"
                          style={{ display: 'flex', alignItems: 'center', gap: '5px', opacity: returnable ? 1 : 0.5, cursor: returnable ? 'pointer' : 'not-allowed' }}
                          title={returnable ? undefined : 'Out of stock'}
                        >
                          <Undo2 size={12} /> {returnable ? 'Move to basket' : 'Out of stock'}
                        </button>
                        <span className="line__price" style={{ fontWeight: 600 }}>
                          {fmt((item.product?.price || 0) * item.quantity)}
                        </span>
                      </div>
                    </div>
                    <div className="line__actions">
                      <button
                        onClick={() => onRemove(item.id)}
                        className="drawer-icon-btn"
                        aria-label="Remove"
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {canCheckout(items) && (
          <div className="drawer__foot">
            {/* A shelf price on this marketplace contains its tax, so the total
                is the sum of the prices the shopper just read and the tax is a
                component of it.

                This panel used to lay that out as "Before VAT / VAT at 16% /
                Total" — a subtotal, a tax line, then a larger number. That is
                the universal shape of tax being *added*, and a reader takes it
                as one however inclusive the arithmetic underneath is. The
                figures were right and the layout said something else. */}
            {money.inclusive ? (
              <>
                <div className="totals totals--grand">
                  <span>Total</span>
                  <span>{fmt(money.total)}</span>
                </div>
                <div className="totals totals--note" style={{ marginBottom: '16px' }}>
                  <span>
                    Includes {taxLabel}{market ? ` at ${market.tax_rate}%` : ''} — nothing is added at checkout
                  </span>
                  <span>{fmt(money.tax)}</span>
                </div>
              </>
            ) : (
              /* Something in the basket is quoted before tax, so the tax really
                 does go on top and the additive layout is the honest one. */
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Before {taxLabel.toLowerCase()}</span>
                  <span style={{ fontWeight: 700 }}>{fmt(money.net)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <span style={{ color: 'var(--text-secondary)' }}>
                    {taxLabel}{market ? ` at ${market.tax_rate}%` : ''}
                  </span>
                  <span style={{ fontWeight: 500 }}>{fmt(money.tax)}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '20px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                  <span style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>Total</span>
                  <span style={{ fontWeight: 800, fontSize: 'var(--text-lg)' }}>{fmt(money.total)}</span>
                </div>
              </>
            )}
            <button onClick={onCheckout} className="btn btn-cyan btn-lg" style={{ width: '100%' }}>
              Checkout
            </button>
          </div>
        )}
      </div>
    </>
  )
}
