import { useState, useEffect } from 'react'
import { Package, Clock, Check, Truck } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Order, OrderItem } from '../types'

export function OrdersView() {
  const [orders, setOrders] = useState<Order[]>([])
  const [orderItems, setOrderItems] = useState<Record<string, OrderItem[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('orders').select('*').order('created_at', { ascending: false }).then(({ data }) => {
      if (data) {
        setOrders(data as Order[])
        data.forEach((order: Order) => {
          supabase.from('order_items').select('*').eq('order_id', order.id).then(({ data: items }) => {
            if (items) {
              setOrderItems((prev) => ({ ...prev, [order.id]: items as OrderItem[] }))
            }
          })
        })
      }
      setLoading(false)
    })
  }, [])

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

  return (
    <section style={{ padding: '32px 0 64px' }}>
      <div className="container" style={{ maxWidth: '800px' }}>
        <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, marginBottom: '32px' }}>My Orders</h1>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {orders.map((order) => (
            <div key={order.id} className="card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '16px' }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 'var(--text-base)' }}>{order.order_ref}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {new Date(order.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </div>
                <span className="badge badge-stock-in">
                  <Check size={12} /> {order.status}
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '16px' }}>
                {(orderItems[order.id] || []).map((item) => (
                  <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
                    <span style={{ color: 'var(--text-secondary)' }}>
                      {item.product_name} × {item.quantity}
                    </span>
                    <span style={{ fontWeight: 500 }}>${(item.price * item.quantity).toFixed(2)}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {order.total > 100 ? <Truck size={14} /> : <Clock size={14} />}
                  {order.total > 100 ? 'Shipped' : 'Instant delivery'}
                </div>
                <span style={{ fontWeight: 700 }}>${order.total.toFixed(2)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
