import { useState, useEffect, useCallback } from 'react'
import { Package, Clock, Check, Truck, X, MapPin, CircleAlert as AlertCircle, LifeBuoy } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { Dialog, StatusBadge } from './ui'
import { AccountPage } from './account/AccountPage'
import { statusTone } from '../lib/consoleTone'
import type { Order, OrderItem } from '../types'
import { canRaiseTicket } from '../lib/orderTickets'
import { RaiseTicketModal } from './RaiseTicketModal'
import { Pager, usePaging } from './Pager'
import { useMarket } from '../lib/MarketContext'
import { OrderParts } from './OrderParts'
import { partsOf, summaryOf } from '../lib/orderParts'
import type { Part } from '../lib/orderParts'
import { paymentLabel } from '../lib/payments'
import { loadPaymentCatalogue } from '../lib/gatewayRepo'
import { planLine } from '../lib/gateway'
import type { PaymentMethod, PaymentAttempt } from '../lib/gateway'
import { loadPushesFor } from '../lib/comRepo'
import { STATE_LABEL, STATE_MEANING } from '../lib/com'
import type { Push } from '../lib/com'

/* An order is read in the money it was placed in, not in whatever market the
   shopper has the storefront set to now. Switching to Kenya does not restate
   what somebody paid in rupees last March, so `order.currency` is the argument
   here and the market context supplies only the formatter. */

const STAGE_ICONS = [Clock, Clock, Truck, Truck, Check]

export function OrdersView() {
  const { fmtIn } = useMarket()
  const [orders, setOrders] = useState<Order[]>([])
  const [orderItems, setOrderItems] = useState<Record<string, OrderItem[]>>({})
  /* What each order is actually doing, part by part. The single `stages` rail
     the card used to draw was one of the two journeys a mixed basket is on. */
  const [parts, setParts] = useState<Part[]>([])
  const [loading, setLoading] = useState(true)
  const [detailOrder, setDetailOrder] = useState<Order | null>(null)
  const [ticketOrder, setTicketOrder] = useState<Order | null>(null)
  const [raised, setRaised] = useState<string | null>(null)
  /* The words for "how it was paid". The order stores a gateway id and this
     table holds what to call it — the card printed the id for want of the
     join. */
  const [methods, setMethods] = useState<PaymentMethod[]>([])
  /* The payments behind these orders, keyed by the reference the order carries.
     Only financing needs them — "paid by EMI" without the tenure is a line
     nobody can check against their bank statement, which is why the plan is
     required on the payment in the first place. */
  const [plans, setPlans] = useState<Record<string, PaymentAttempt>>({})
  /* Order cards are tall. Five of them is a screenful; twenty is a scroll with
     no sense of how far down it goes. */
  const ordersPage = usePaging(orders, { initialSize: 5 })

  const loadOrders = useCallback(async () => {
    void loadPaymentCatalogue().then(c => setMethods(c.methods))
    const { data } = await supabase.from('orders').select('*').order('created_at', { ascending: false })
    if (data) {
      const ords = data as Order[]
      setOrders(ords)

      /* RLS scopes this to the shopper's own payments, so the filter is for
         size rather than for safety — the same arrangement everywhere else
         here. Keyed by reference because that is what the order carries. */
      const refs = ords.map(o => o.payment_ref).filter((r): r is string => !!r)
      if (refs.length > 0) {
        const { data: paid } = await supabase.from('payment_attempts')
          .select('*').in('reference', refs).eq('state', 'succeeded')
        setPlans(Object.fromEntries(
          ((paid ?? []) as PaymentAttempt[]).map(a => [a.reference, a])))
      }

      const itemsMap: Record<string, OrderItem[]> = {}
      await Promise.all(ords.map(async (order) => {
        const { data: items } = await supabase.from('order_items').select('*').eq('order_id', order.id)
        if (items) itemsMap[order.id] = items as OrderItem[]
      }))
      setOrderItems(itemsMap)

      /* One read for every order rather than one per order: parts are small and
         RLS already narrows them to this buyer's own. */
      const { data: pt } = await supabase.from('order_part')
        .select('*').in('order_id', ords.map(o => o.id)).order('sort_order')
      setParts(((pt ?? []) as Record<string, unknown>[]).map(r => ({
        ...r, order_id: String(r.order_id), sort_order: Number(r.sort_order ?? 0),
      })) as unknown as Part[])
    }
    setLoading(false)
  }, [])

  useEffect(() => { loadOrders() }, [loadOrders])

  if (loading) {
    return (
      <AccountPage title="My Orders">
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      </AccountPage>
    )
  }

  if (orders.length === 0) {
    return (
      <AccountPage title="My Orders">
        <div className="acct-empty">
          <Package size={48} aria-hidden="true" style={{ margin: '0 auto 16px', opacity: 0.3 }} />
          <h2 style={{ marginBottom: '8px' }}>No orders yet</h2>
          <p style={{ color: 'var(--text-secondary)' }}>When you place an order, it will appear here.</p>
        </div>
      </AccountPage>
    )
  }

  const failedOrders = orders.filter((o) => o.failed)

  return (
    <AccountPage
      title="My Orders"
      subtitle={`${orders.length} orders · track delivery, activation and provisioning in one place`}
    >
      {failedOrders.length > 0 && (
        <div className="acct-notice acct-notice--warning">
          <AlertCircle size={20} aria-hidden="true" className="acct-notice__icon" />
          <div>
            <strong>One order needs your attention.</strong> A delivery attempt failed and the parcel is waiting at the depot.
          </div>
        </div>
      )}

      <div className="ord-list">
        {ordersPage.rows.map((order) => {
          const items = orderItems[order.id] || []
          const ownParts = partsOf(parts, order.id)
          const stages = order.stages || ['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered']
          const currentStage = order.stage || 0
          const isDigital = order.carrier === 'Digital'
          return (
            <article key={order.id} className="ord-card">
              <div className="ord-card__head">
                <div className="ord-card__id">
                  <h2 className="ord-card__ref">{order.order_ref}</h2>
                  <div className="ord-card__meta">
                    {order.placed_date || new Date(order.created_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                    {order.seller ? ` · ${order.seller}` : ''}
                    {order.vertical && <span className="ord-card__vertical"> · {order.vertical}</span>}
                  </div>
                </div>
                <OrderStatus order={order} />
                <div className="ord-card__money">
                  {/* At the order's own date. An order placed a year ago
                      converted at today's rate shows a price nobody paid. */}
                  <div className="ord-card__total">
                    {fmtIn(order.total, order.currency, { asOf: order.created_at?.slice(0, 10) })}
                  </div>
                  <div className="ord-card__meta">{paymentLabel(order.payment_method, methods)}</div>
                  {/* The plan, where there is one. An order financed over a
                      year that reads only "paid by EMI" is a total the
                      customer cannot match to anything on their statement. */}
                  {order.payment_ref && plans[order.payment_ref] && (() => {
                    const line = planLine(plans[order.payment_ref],
                      n => fmtIn(n, order.currency, { asOf: order.created_at?.slice(0, 10) }))
                    return line ? <div className="ord-card__plan">{line}</div> : null
                  })()}
                </div>
              </div>

              {/* Items. The order item rows carry no image, so the thumbnail is
                  a neutral tile rather than a picture invented for it. */}
              <ul className="ord-items">
                {items.map((item) => (
                  <li key={item.id} className="ord-item">
                    <span className="ord-item__thumb" aria-hidden="true"><Package size={18} /></span>
                    <span className="ord-item__name">{item.product_name} × {item.quantity}</span>
                    <span className="ord-item__price">{fmtIn(item.price * item.quantity, order.currency)}</span>
                  </li>
                ))}
              </ul>

              {/* One rail per part, not one for the order.
                  `orders.stages` held a single journey, so a basket of a
                  handset and an eSIM drew whichever of the two it happened to
                  carry over both halves — the eSIM appeared to be waiting for
                  a van. A single-part order still draws exactly one rail. */}
              <div className="ord-rail">
                {ownParts.length > 0 ? (
                  <>
                    {ownParts.length > 1 && (
                      <div className="ord-rail__summary">{summaryOf(ownParts)}</div>
                    )}
                    <OrderParts parts={ownParts} />
                  </>
                ) : (
                  /* No parts on file is a record older than this change, not
                     an order with nothing happening — so it keeps the rail it
                     was drawn with rather than rendering as empty. */
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0', overflowX: 'auto' }}>
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
                              background: done ? 'var(--brand-accent-dark)' : 'var(--bg-alt)',
                              color: done ? 'white' : 'var(--text-secondary)',
                            }}>
                              <Icon size={14} aria-hidden="true" />
                            </div>
                            <span style={{
                              fontSize: 'var(--text-xs)', fontWeight: done ? 600 : 400,
                              color: done ? 'var(--text)' : 'var(--text-secondary)',
                              whiteSpace: 'nowrap',
                            }}>
                              {stage}
                            </span>
                          </div>
                          {!isLast && (
                            <div style={{
                              flex: 1, height: '2px', margin: '0 4px', marginBottom: '18px',
                              background: i < currentStage ? 'var(--brand-accent)' : 'var(--border-light)',
                            }} />
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="ord-card__foot">
                <div className="ord-card__carriage">
                  {/* Carriage is on the part that ships and is printed
                      there. Repeating it under the whole order was the
                      header claiming one parcel for a basket that might have
                      two, or none. */}
                  {ownParts.length > 0 ? (
                    <>
                      <Clock size={14} aria-hidden="true" /> {summaryOf(ownParts)}
                    </>
                  ) : order.tracking_ref ? (
                    <>
                      <Truck size={14} aria-hidden="true" /> {order.carrier} · {order.tracking_ref}
                    </>
                  ) : isDigital ? (
                    <>
                      <Clock size={14} aria-hidden="true" /> Instant delivery
                    </>
                  ) : (
                    <>
                      <Clock size={14} aria-hidden="true" /> {order.status}
                    </>
                  )}
                </div>
                <div className="ord-card__actions">
                  {/* Only while there is still something to chase. A refunded order
                      is concluded, and a refund dispute is its own flow. */}
                  {canRaiseTicket(order) && (
                    <button type="button" className="acct-btn" onClick={() => setTicketOrder(order)}>
                      <LifeBuoy size={16} aria-hidden="true" /> Get help
                    </button>
                  )}
                  <button type="button" className="acct-btn acct-btn--primary"
                    aria-label={`View details for order ${order.order_ref}`}
                    onClick={() => setDetailOrder(order)}>
                    View details
                  </button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
      <Pager page={ordersPage} noun="orders" />

      {ticketOrder && (
        <RaiseTicketModal
          order={ticketOrder}
          raisedBy={ticketOrder.buyer_name || 'You'}
          onClose={() => setTicketOrder(null)}
          onRaised={(id) => { setTicketOrder(null); setRaised(id) }}
        />
      )}

      {/* Confirmed in place rather than by silently closing — a support request that
          leaves no trace is indistinguishable from one that failed. */}
      {raised && (
        <div
          role="status"
          style={{
            position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)',
            background: 'var(--brand-navy)', color: 'white', padding: '12px 20px',
            borderRadius: 'var(--radius)', boxShadow: 'var(--shadow-lg)', zIndex: 1100,
            display: 'flex', alignItems: 'center', gap: '12px', fontSize: 'var(--text-sm)',
          }}
        >
          Ticket {raised} raised — we will be in touch.
          <button onClick={() => setRaised(null)} aria-label="Dismiss" className="acct-icon-btn">
            <X size={16} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Detail modal */}
      {detailOrder && (
        <OrderDetailModal
          order={detailOrder}
          items={orderItems[detailOrder.id] || []}
          methods={methods}
          onClose={() => setDetailOrder(null)}
        />
      )}
    </AccountPage>
  )
}

/* The order's status as a badge. A failed order reads as failed whatever its
   status word says. `statusTone` now maps 'refunded' to success (the money came
   back, which suits a refund screen), but an order that ended in a refund did
   not go as planned, so it stays amber here, as it was before. */
function OrderStatus({ order }: { order: Order }) {
  const tone = order.failed ? 'danger' : order.status === 'refunded' ? 'warning' : statusTone(order.status)
  return <StatusBadge tone={tone}>{order.status}</StatusBadge>
}

/* What the network has actually been asked, and what it said back.
 *
 * The rail above says where the marketplace thinks the order is. This says
 * where it really is, and the two can disagree in exactly one direction: the
 * marketplace cannot show the last rung until the order manager has finished,
 * but it can and does sit at "Confirmed" for an order that was refused hours
 * ago. Somebody chasing a SIM that has not arrived is owed the reason rather
 * than a progress bar that has stopped. */
function NetworkFulfilment({ orderRef }: { orderRef: string }) {
  const [pushes, setPushes] = useState<Push[]>([])
  useEffect(() => {
    let live = true
    void loadPushesFor(orderRef).then(r => { if (live) setPushes(r) })
    return () => { live = false }
  }, [orderRef])

  if (pushes.length === 0) return null
  return (
    <div style={{ marginTop: '12px', marginLeft: '34px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
      {pushes.map(p => {
        const bad = p.state === 'rejected' || p.state === 'failed'
        return (
          <div key={p.id} style={{
            fontSize: 'var(--text-xs)', lineHeight: 1.55,
            color: bad ? 'var(--danger)' : 'var(--text-tertiary)',
          }}>
            <strong>{p.product_name ?? p.product_id} — {STATE_LABEL[p.state].toLowerCase()}.</strong>{' '}
            {bad
              ? 'Nothing has been provisioned. Support has been given the reason and can move it on.'
              : STATE_MEANING[p.state]}
          </div>
        )
      })}
    </div>
  )
}

function OrderDetailModal({ order, items, methods, onClose }: {
  order: Order; items: OrderItem[]; methods: readonly PaymentMethod[]; onClose: () => void
}) {
  const { fmtIn } = useMarket()
  const mny = (n: number) => fmtIn(n, order.currency, { asOf: order.created_at?.slice(0, 10) })
  const stages = order.stages || ['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered']
  const currentStage = order.stage || 0
  const addr = order.shipping_address || {}
  const hasAddress = order.carrier !== 'Digital' && !!addr.line1

  return (
    <Dialog open onClose={onClose} wide title={`Order ${order.order_ref}`}>
      {/* Status + meta */}
      <div className="ord-detail__status">
        <OrderStatus order={order} />
        <span className="ord-card__meta">
          Placed {order.placed_date || new Date(order.created_at).toLocaleDateString()}
        </span>
      </div>

      <div className="ord-detail">
        <div className="ord-detail__main">
          {/* Pipeline */}
          <section className="ord-detail__section">
            <h3 className="ord-detail__h">Tracking</h3>
            {stages.map((stage, i) => {
              const done = i <= currentStage
              return (
                <div key={stage} style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <div style={{
                    width: '24px', height: '24px', borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: done ? 'var(--brand-accent-dark)' : 'var(--bg-alt)',
                    color: done ? 'white' : 'var(--text-secondary)',
                    flexShrink: 0,
                  }}>
                    {done ? <Check size={12} aria-hidden="true" /> : <Clock size={12} aria-hidden="true" />}
                  </div>
                  <span style={{
                    fontSize: 'var(--text-sm)', fontWeight: done ? 600 : 400,
                    color: done ? 'var(--text)' : 'var(--text-secondary)',
                  }}>
                    {stage}
                  </span>
                </div>
              )
            })}
            {order.tracking_ref && (
              <div className="ord-card__meta" style={{ marginTop: '8px', marginLeft: '34px' }}>
                Carrier: {order.carrier} · Tracking: {order.tracking_ref}
              </div>
            )}
            <NetworkFulfilment orderRef={order.order_ref} />
          </section>

          {/* Items */}
          <section className="ord-detail__section">
            <h3 className="ord-detail__h">Items</h3>
            {items.map((item) => (
              <div key={item.id} className="ord-detail__line">
                <div>
                  <div style={{ fontWeight: 500 }}>{item.product_name}</div>
                  <div className="ord-card__meta">Qty {item.quantity} · {mny(item.price)} each</div>
                </div>
                <div style={{ fontWeight: 600 }}>{mny(item.price * item.quantity)}</div>
              </div>
            ))}
          </section>
        </div>

        <div className="ord-detail__side">
          {/* Shipping */}
          {hasAddress && (
            <section className="ord-detail__section">
              <h3 className="ord-detail__h">Delivery address</h3>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                <MapPin size={16} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <div>{addr.line1}</div>
                  <div>{addr.city} {addr.pin}</div>
                </div>
              </div>
            </section>
          )}

          {/* Totals */}
          <section className="ord-detail__section">
            <h3 className="ord-detail__h">Payment</h3>
            <div className="ord-detail__row"><span>Before tax</span><span>{mny(order.subtotal)}</span></div>
            <div className="ord-detail__row"><span>Tax at {order.tax_rate}%</span><span>{mny(order.tax)}</span></div>
            <div className="ord-detail__row ord-detail__row--total"><span>Total</span><span>{mny(order.total)}</span></div>
            <div className="ord-card__meta" style={{ marginTop: '4px' }}>
              Paid by {paymentLabel(order.payment_method, methods)}
            </div>
          </section>
        </div>
      </div>
    </Dialog>
  )
}
