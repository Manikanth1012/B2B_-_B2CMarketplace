import { useState, useEffect, useCallback } from 'react'
import { Package, Clock, Check, Truck, X, MapPin, CircleAlert as AlertCircle, ChevronRight, Download } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Order, OrderItem } from '../types'

function fmtMoney(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

const STAGE_ICONS = [Clock, Clock, Truck, Truck, Check]

export function OrdersView() {
  const [orders, setOrders] = useState<Order[]>([])
  const [orderItems, setOrderItems] = useState<Record<string, OrderItem[]>>({})
  const [loading, setLoading] = useState(true)
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)

  const loadOrders = useCallback(async () => {
    const { data } = await supabase.from('orders').select('*').order('created_at', { ascending: false })
    if (data) {
      const ords = data as Order[]
      setOrders(ords)
      const itemsMap: Record<string, OrderItem[]> = {}
      await Promise.all(ords.map(async (order) => {
        const { data: items } = await supabase.from('order_items').select('*').eq('order_id', order.id)
        if (items) itemsMap[order.id] = items as OrderItem[]
      }))
      setOrderItems(itemsMap)
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadOrders() }, [loadOrders])

  if (loading) {
    return (
      <section style={{ padding: '64px 0' }}>
        <div className="container" style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      </section>
    )
  }

  if (orders.length === 0) {
    return (
      <section style={{ padding: '64px 0' }}>
        <div className="container" style={{ textAlign: 'center', maxWidth: '400px', margin: '0 auto' }}>
          <Package size={48} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
          <h2 style={{ marginBottom: '8px' }}>No orders yet</h2>
          <p style={{ color: 'var(--text-secondary)' }}>When you place an order, it will appear here.</p>
        </div>
      </section>
    )
  }

  const failedOrders = orders.filter((o) => o.failed)

  return (
    <section style={{ padding: '32px 0 64px' }}>
      <div className="container" style={{ maxWidth: '800px' }}>
        <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, marginBottom: '8px' }}>My Orders</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
          {orders.length} orders · track delivery, activation and provisioning in one place
        </p>

        {failedOrders.length > 0 && (
          <div style={{
            display: 'flex', gap: '12px', alignItems: 'flex-start', padding: '16px 20px',
            background: '#FEF3C7', borderRadius: 'var(--radius-lg)', marginBottom: '24px',
            border: '1px solid #FCD34D',
          }}>
            <AlertCircle size={20} style={{ color: '#D97706', flexShrink: 0, marginTop: 2 }} />
            <div style={{ fontSize: 'var(--text-sm)', color: '#92400E' }}>
              <strong>One order needs your attention.</strong> A delivery attempt failed and the parcel is waiting at the depot.
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {orders.map((order) => {
            const items = orderItems[order.id] || []
            const stages = order.stages || ['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered']
            const currentStage = order.stage || 0
            const isDigital = order.carrier === 'Digital'
            return (
              <div key={order.id} className="card" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '16px' }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                      <span style={{
                        padding: '3px 10px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)',
                        fontWeight: 600,
                        background: order.failed ? '#FEE2E2' : order.status === 'delivered' ? '#DCFCE7' : order.status === 'refunded' ? '#FEF3C7' : '#E0E7FF',
                        color: order.failed ? '#DC2626' : order.status === 'delivered' ? '#16A34A' : order.status === 'refunded' ? '#D97706' : '#4338CA',
                      }}>
                        {order.status}
                      </span>
                      {order.vertical && (
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', textTransform: 'capitalize' }}>
                          {order.vertical}
                        </span>
                      )}
                    </div>
                    <div style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>{order.order_ref}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      {order.placed_date || new Date(order.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                      {order.seller ? ` · ${order.seller}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>{fmtMoney(order.total)}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{order.payment_method}</div>
                  </div>
                </div>

                {/* Items */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                  {items.map((item) => (
                    <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>
                        {item.product_name} × {item.quantity}
                      </span>
                      <span style={{ fontWeight: 500 }}>{fmtMoney(item.price * item.quantity)}</span>
                    </div>
                  ))}
                </div>

                {/* Tracking pipeline */}
                <div style={{ padding: '12px 0', borderTop: '1px solid var(--border-light)', borderBottom: '1px solid var(--border-light)', marginBottom: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0' }}>
                    {stages.map((stage, i) => {
                      const Icon = isDigital && i <= 1 ? (i === 0 ? Clock : Check) : (STAGE_ICONS[i] || Check)
                      const done = i <= currentStage
                      const isLast = i === stages.length - 1
                      return (
                        <div key={stage} style={{ display: 'flex', alignItems: 'center', flex: isLast ? '0 0 auto' : '1 1 0' }}>
                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                            <div style={{
                              width: '28px', height: '28px', borderRadius: '50%',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              background: done ? 'var(--brand-accent)' : 'var(--bg-alt)',
                              color: done ? 'white' : 'var(--text-tertiary)',
                              transition: 'all 200ms ease',
                            }}>
                              <Icon size={14} />
                            </div>
                            <span style={{
                              fontSize: 'var(--text-xs)', fontWeight: done ? 600 : 400,
                              color: done ? 'var(--text)' : 'var(--text-tertiary)',
                              whiteSpace: 'nowrap',
                            }}>
                              {stage}
                            </span>
                          </div>
                          {!isLast && (
                            <div style={{
                              flex: 1, height: '2px', margin: '0 4px', marginBottom: '18px',
                              background: i < currentStage ? 'var(--brand-accent)' : 'var(--border-light)',
                              transition: 'background 200ms ease',
                            }} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Footer */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {order.tracking_ref ? (
                      <>
                        <Truck size={14} /> {order.carrier} · {order.tracking_ref}
                      </>
                    ) : isDigital ? (
                      <>
                        <Clock size={14} /> Instant delivery
                      </>
                    ) : (
                      <>
                        <Clock size={14} /> {order.status}
                      </>
                    )}
                  </div>
                  <button
                    onClick={() => setDetailOrder(order)}
                    style={{
                      padding: '6px 16px', borderRadius: 'var(--radius)', border: '1px solid var(--border)',
                      background: 'white', color: 'var(--text-secondary)', fontWeight: 600,
                      fontSize: 'var(--text-xs)', cursor: 'pointer',
                    }}
                  >
                    Details
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Detail modal */}
      {detailOrder && (
        <OrderDetailModal
          order={detailOrder}
          items={orderItems[detailOrder.id] || []}
          onClose={() => setDetailOrder(null)}
        />
      )}
    </section>
  )
}

function OrderDetailModal({ order, items, onClose }: { order: Order; items: OrderItem[]; onClose: () => void }) {
  const stages = order.stages || ['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered']
  const currentStage = order.stage || 0
  const addr = order.shipping_address || {}

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 400,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 'var(--radius-lg)', padding: '28px',
          maxWidth: '560px', width: '100%', maxHeight: '90vh', overflowY: 'auto',
          boxShadow: 'var(--shadow-lg)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: 'var(--text-xl)', fontWeight: 800 }}>Order {order.order_ref}</h2>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
            <X size={20} />
          </button>
        </div>

        {/* Status + meta */}
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '20px' }}>
          <span style={{
            padding: '4px 12px', borderRadius: 'var(--radius-full)', fontSize: 'var(--text-xs)', fontWeight: 600,
            background: order.failed ? '#FEE2E2' : order.status === 'delivered' ? '#DCFCE7' : order.status === 'refunded' ? '#FEF3C7' : '#E0E7FF',
            color: order.failed ? '#DC2626' : order.status === 'delivered' ? '#16A34A' : order.status === 'refunded' ? '#D97706' : '#4338CA',
          }}>
            {order.status}
          </span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
            Placed {order.placed_date || new Date(order.created_at).toLocaleDateString()}
          </span>
        </div>

        {/* Pipeline */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '12px' }}>Tracking</div>
          {stages.map((stage, i) => {
            const done = i <= currentStage
            return (
              <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                <div style={{
                  width: '24px', height: '24px', borderRadius: '50%',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: done ? 'var(--brand-accent)' : 'var(--bg-alt)',
                  color: done ? 'white' : 'var(--text-tertiary)',
                  flexShrink: 0,
                }}>
                  {done ? <Check size={12} /> : <Clock size={12} />}
                </div>
                <span style={{
                  fontSize: 'var(--text-sm)', fontWeight: done ? 600 : 400,
                  color: done ? 'var(--text)' : 'var(--text-tertiary)',
                }}>
                  {stage}
                </span>
              </div>
            )
          })}
          {order.tracking_ref && (
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '8px', marginLeft: '34px' }}>
              Carrier: {order.carrier} · Tracking: {order.tracking_ref}
            </div>
          )}
        </div>

        {/* Items */}
        <div style={{ marginBottom: '24px' }}>
          <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '12px' }}>Items</div>
          {items.map((item) => (
            <div key={item.id} style={{
              display: 'flex', justifyContent: 'space-between', padding: '8px 0',
              borderBottom: '1px solid var(--border-light)', fontSize: 'var(--text-sm)',
            }}>
              <div>
                <div style={{ fontWeight: 500 }}>{item.product_name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  Qty {item.quantity} · {fmtMoney(item.price)} each
                </div>
              </div>
              <div style={{ fontWeight: 600 }}>{fmtMoney(item.price * item.quantity)}</div>
            </div>
          ))}
        </div>

        {/* Shipping */}
        {order.carrier !== 'Digital' && addr.line1 && (
          <div style={{ marginBottom: '24px' }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '8px' }}>Delivery address</div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
              <MapPin size={16} style={{ flexShrink: 0, marginTop: 2, color: 'var(--text-tertiary)' }} />
              <div>
                <div>{addr.line1}</div>
                <div>{addr.city} {addr.pin}</div>
              </div>
            </div>
          </div>
        )}

        {/* Totals */}
        <div style={{ paddingTop: '16px', borderTop: '2px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            <span>Subtotal</span><span>{fmtMoney(order.subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginBottom: '4px' }}>
            <span>Tax</span><span>{fmtMoney(order.tax)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-base)', fontWeight: 700, marginTop: '8px' }}>
            <span>Total</span><span>{fmtMoney(order.total)}</span>
          </div>
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            Paid by {order.payment_method}
          </div>
        </div>
      </div>
    </div>
  )
}
