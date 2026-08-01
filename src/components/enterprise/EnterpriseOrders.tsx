import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { ShoppingCart, TriangleAlert as AlertTriangle, Package, Check } from 'lucide-react'
import {
  StatCard, SectionCard, Table, Td, StatusPill, fmtMoney, fmtInt, Btn, EmptyState,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { loadAccount } from '../../lib/enterpriseRepo'
import type { AccountBook } from '../../lib/enterpriseRepo'
import { money, money0, day } from '../../lib/enterprise'

/* Orders, as the middle of a chain rather than a list.
 *
 * A business order is only half the story on its own. Somebody asked for it,
 * somebody approved it, it was provisioned or delivered, it was invoiced, and
 * sometimes it came back. This screen shows that chain on every row, because
 * the questions a procurement lead actually has — who authorised this, which
 * invoice is it on, is the refund against it still open — are all questions
 * about the things either side of the order rather than the order itself.
 *
 * Provisioning and delivery run on different rails: a subscription is never
 * "in transit" and a pallet of sensors is never "activated". Each order
 * carries its own stage names for that reason.
 */

interface Order {
  id: string
  order_ref: string
  status: string
  total: number
  subtotal: number
  tax: number
  placed_date: string
  seller: string
  vertical: string
  failed: boolean
  failed_reason: string | null
  stage: number
  stages: string[]
  tracking_ref: string | null
  carrier: string | null
  shipping_address: Record<string, string> | null
  requisition_id: string | null
  invoice_id: string | null
  ordered_by: string | null
  cost_centre: string | null
  po_ref: string | null
}

interface Item {
  id: string
  order_id: string
  product_id: string
  product_name: string
  price: number
  quantity: number
  fulfil: string
  status: string
}

interface Refund { id: string; order_ref: string; amount: number; state: string; reason: string }
interface Ticket { id: string; ref: string | null; subject: string; status: string }

export function EnterpriseOrders() {
  const [orders, setOrders] = useState<Order[] | null>(null)
  const [items, setItems] = useState<Item[]>([])
  const [refunds, setRefunds] = useState<Refund[]>([])
  const [tickets, setTickets] = useState<Ticket[]>([])
  const [account, setAccount] = useState<AccountBook | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    const [o, i, r, t, a] = await Promise.all([
      supabase.from('orders').select('*').order('created_at', { ascending: false }),
      supabase.from('order_items').select('*'),
      supabase.from('refunds').select('id,order_ref,amount,state,reason'),
      supabase.from('support_tickets').select('id,ref,subject,status'),
      loadAccount(),
    ])
    if (o.error) setError(`Your orders did not load (${o.error.message}).`)
    setOrders((o.data ?? []) as Order[])
    setItems((i.data ?? []) as Item[])
    setRefunds((r.data ?? []) as Refund[])
    setTickets((t.data ?? []) as Ticket[])
    setAccount(a)
  }, [])
  useEffect(() => { void reload() }, [reload])

  if (!orders || !account) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const done = (o: Order) => !o.failed && o.stage >= o.stages.length - 1
  const inFlight = orders.filter(o => !o.failed && !done(o))
  const failed = orders.filter(o => o.failed)
  const complete = orders.filter(done)
  const spend = orders.reduce((a, o) => a + Number(o.total), 0)

  const nameOf = (id: string | null) => account.members.find(m => m.id === id)?.name ?? '—'
  const refundsFor = (ref: string) => refunds.filter(r => r.order_ref === ref)
  const ticketsFor = (ref: string) => tickets.filter(t => t.ref === ref)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Orders</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {orders.length} placed by {account.account?.company ?? 'this account'} · {inFlight.length} in flight
          {failed.length ? ` · ${failed.length} with a problem` : ''}
        </p>
      </div>

      {error && <Callout tone="danger" title="Some of this did not load">{error}</Callout>}

      {failed.map(o => (
        <Callout key={o.id} tone="danger" title={`${o.order_ref} — ${o.seller}`}>
          {o.failed_reason}
          {refundsFor(o.order_ref).length > 0 && (
            <> A refund is on record: {refundsFor(o.order_ref).map(r => `${r.id} for ${money(Number(r.amount))} (${r.state})`).join(', ')}.</>
          )}
        </Callout>
      ))}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
        <StatCard label="In flight" value={fmtInt(inFlight.length)}
                  sublabel="Being provisioned or delivered" color="var(--brand-accent-dark)" />
        <StatCard label="Completed" value={fmtInt(complete.length)}
                  sublabel="Delivered or in service" color="var(--success)" />
        <StatCard label="With a problem" value={fmtInt(failed.length)}
                  sublabel={failed.length ? 'Each one says what went wrong' : 'Nothing outstanding'}
                  color={failed.length ? 'var(--danger)' : undefined} />
        <StatCard label="Ordered in total" value={money0(spend)}
                  sublabel={`Across ${new Set(orders.map(o => o.seller)).size} sellers`} />
      </div>

      <Callout tone="info" title="Every order here traces back to who authorised it">
        An order on a business account is the middle of a chain: a requisition authorised it, an invoice
        billed it, and a refund or a ticket may be open against it. Click a row to see the whole chain.
      </Callout>

      <SectionCard title="Your orders" subtitle="Newest first. Click a row for the items and what is attached to it.">
        {orders.length === 0 ? <EmptyState message="Nothing has been ordered on this account yet" /> : (
          <Table headers={['Order', 'What', 'Seller', 'Ordered by', 'Value', 'Where it is', 'State']}>
            {orders.map(o => {
              const mine = items.filter(i => i.order_id === o.id)
              return (
                <>
                  <tr key={o.id} onClick={() => setOpen(open === o.id ? null : o.id)} style={{ cursor: 'pointer' }}>
                    <Td>
                      <div style={{ fontWeight: 600 }}>{o.order_ref}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{o.placed_date}</div>
                    </Td>
                    <Td>
                      <div>{mine[0]?.product_name ?? '—'}{mine.length > 1 ? ` and ${mine.length - 1} more` : ''}</div>
                      {o.requisition_id && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                          Authorised by {o.requisition_id}
                        </div>
                      )}
                    </Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{o.seller}</Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{nameOf(o.ordered_by)}</Td>
                    <Td right style={{ fontWeight: 600 }}>${fmtMoney(Number(o.total))}</Td>
                    <Td right style={{ fontSize: 'var(--text-xs)', minWidth: '150px' }}>
                      <div style={{ fontWeight: 600, color: o.failed ? 'var(--danger)' : undefined }}>
                        {o.stages[o.stage] ?? '—'}
                      </div>
                      <Rail stage={o.stage} stages={o.stages} failed={o.failed} />
                    </Td>
                    <Td right>
                      <StatusPill status={o.failed ? 'rejected' : done(o) ? 'resolved' : 'open'} />
                      {refundsFor(o.order_ref).length > 0 && (
                        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', marginTop: '2px' }}>
                          refund open
                        </div>
                      )}
                    </Td>
                  </tr>
                  {open === o.id && (
                    <tr key={`${o.id}-detail`}>
                      <td colSpan={7} style={{ padding: '14px 18px', background: 'var(--bg-alt)', borderBottom: '1px solid var(--border)' }}>
                        <Detail order={o} items={mine} account={account}
                                refunds={refundsFor(o.order_ref)} tickets={ticketsFor(o.order_ref)} />
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </Table>
        )}
      </SectionCard>
    </div>
  )
}

function Rail({ stage, stages, failed }: { stage: number; stages: string[]; failed: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '2px', marginTop: '4px', justifyContent: 'flex-end' }}>
      {stages.map((s, i) => (
        <span key={s} title={s} style={{
          width: '18px', height: '4px', borderRadius: '2px',
          background: i > stage ? 'var(--border)' : failed && i === stage ? 'var(--danger)' : 'var(--brand-accent-dark)',
        }} />
      ))}
    </div>
  )
}

function Detail({ order, items, account, refunds, tickets }: {
  order: Order; items: Item[]; account: AccountBook; refunds: Refund[]; tickets: Ticket[]
}) {
  const req = account.requisitions.find(r => r.id === order.requisition_id)
  const invoice = account.invoices.find(i => i.id === order.invoice_id)
  const centre = account.centres.find(c => c.id === order.cost_centre)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <Table headers={['Item', 'How it is fulfilled', 'Qty', 'Unit', 'Line']}>
        {items.map(i => (
          <tr key={i.id}>
            <Td>{i.product_name}</Td>
            <Td right style={{ fontSize: 'var(--text-xs)' }}>{i.fulfil === 'digital' ? 'Provisioned' : 'Shipped'}</Td>
            <Td right>{fmtInt(i.quantity)}</Td>
            <Td right>${fmtMoney(Number(i.price))}</Td>
            <Td right style={{ fontWeight: 600 }}>${fmtMoney(Number(i.price) * i.quantity)}</Td>
          </tr>
        ))}
      </Table>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '12px' }}>
        <Fact label="Authorised by"
              value={req ? `${req.id} — ${account.members.find(m => m.id === req.decided_by)?.name ?? 'nobody'} on ${day(req.decided_on)}`
                : 'Placed within policy — no approval was needed'} />
        <Fact label="Billed on" value={invoice ? `${invoice.id} · ${invoice.period} · ${money(Number(invoice.total))}` : 'Not yet invoiced'} />
        <Fact label="Cost centre" value={centre ? `${centre.name} (${centre.id})` : 'Not allocated'} />
        <Fact label="Purchase order" value={order.po_ref ?? 'None'} />
        <Fact label="Delivery" value={
          order.carrier === 'Digital'
            ? 'Provisioned — nothing shipped'
            : `${order.carrier ?? 'Carrier'}${order.tracking_ref ? ` · ${order.tracking_ref}` : ''}`} />
        <Fact label="Where" value={
          order.shipping_address
            ? Object.values(order.shipping_address).filter(Boolean).join(', ')
            : '—'} />
        <Fact label="Before tax" value={`${money(Number(order.subtotal))} + ${money(Number(order.tax))} tax`} />
        <Fact label="Marketplace" value={order.vertical} />
      </div>

      {order.failed_reason && (
        <Callout tone="danger" title="What went wrong">{order.failed_reason}</Callout>
      )}

      {refunds.length > 0 && (
        <Callout tone="warning" title={`${refunds.length} refund${refunds.length === 1 ? '' : 's'} against this order`}>
          {refunds.map(r => `${r.id} — ${money(Number(r.amount))}, ${r.reason.replace('-', ' ')}, ${r.state}`).join('; ')}.
        </Callout>
      )}

      {tickets.length > 0 && (
        <Callout tone="info" title={`${tickets.length} support ticket${tickets.length === 1 ? '' : 's'} about it`}>
          {tickets.map(t => `${t.id} — ${t.subject} (${t.status})`).join('; ')}.
        </Callout>
      )}
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, lineHeight: 1.4 }}>{value}</div>
    </div>
  )
}

export { ShoppingCart, AlertTriangle, Package, Check }
