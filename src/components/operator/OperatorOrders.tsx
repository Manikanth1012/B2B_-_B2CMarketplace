import { useState, useEffect, useCallback, useMemo } from 'react'
import { Search, TriangleAlert, PackageSearch, Truck, CircleSlash } from 'lucide-react'
import {
  SectionCard, StatCard, EmptyState, Btn, StatusPill, Table, Td, toast,
  Modal, FormField, TextInput, TextArea, Select, fmtInt,
} from './shared'
import { Callout } from '../OnboardingJourney'
import { Pager, usePaging } from '../Pager'
import { loadOrderBook, advance, stepBack, failOrder, unfail, setTracking, removeOrder } from '../../lib/orderOpsRepo'
import type { OrderBook } from '../../lib/orderOpsRepo'
import {
  buyerKind, BUYER_LABEL, contactLine, showing, atEnd, ageInDays, problemsFor,
  exceptionQueue, linesCharged, canAdvance, searchOrders, rollup,
  STATUS_TONE, SEVERITY_LABEL, FROZEN_REASON,
} from '../../lib/orderOps'
import type { OrderRow, Severity } from '../../lib/orderOps'
import { STATE_LABEL as COM_LABEL, STATE_TONE as COM_TONE } from '../../lib/com'
import { formatGroups } from '../../lib/money'
import { useMarket } from '../../lib/MarketContext'

/* Working somebody else's order.
 *
 * Every persona could see its own orders and nobody could see all of them. A
 * buyer rings up with a reference, a seller says the marketplace never sent
 * theirs, an enterprise says they were charged twice — and there was no screen
 * where those three accounts of the same order could be put beside each other.
 *
 * Building it found what such a screen is for. The book was carrying twenty
 * copies of one enterprise order — ₹996,000 against a requisition nobody has
 * approved — because the "have I already placed this?" check asked the
 * requisition rather than the orders table, and a reference collision was
 * handled by minting a different reference. Nothing on any screen would ever
 * have shown that, because every screen showed one persona's own orders and
 * ENT-2007 saw twenty rows it had no reason to count.
 *
 * So the screen leads with exceptions rather than with a list. And it ranks them
 * by whether the order is saying something untrue rather than by how old it is:
 * an order sitting in "placed" for nine days is slow, an order showing
 * "Delivered" while the network has not provisioned has already told somebody
 * something false.
 */

const SEVERITY_TONE: Record<Severity, string> = {
  wrong: 'rejected', stalled: 'degraded', untidy: 'pending',
}

export function OperatorOrders() {
  const [book, setBook] = useState<OrderBook | null>(null)
  const [tab, setTab] = useState<'exceptions' | 'all'>('exceptions')
  const [open, setOpen] = useState<string | null>(null)

  const reload = useCallback(async () => setBook(await loadOrderBook()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }
  if (book.loadError) {
    return <Callout tone="danger" title="The order book did not load">{book.loadError}</Callout>
  }

  const today = new Date().toISOString().slice(0, 10)
  const opened = book.orders.find(o => o.id === open) ?? null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Orders</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px', maxWidth: '80ch' }}>
          Every order across retail, business accounts and guest checkout, in one place. The
          marketplace moves an order along; it does not rewrite what it cost or who bought it —
          those were agreed at checkout and a refund is the way to change them.
        </p>
      </div>

      <Rollup book={book} today={today} />

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {([['exceptions', 'Needs somebody'], ['all', 'The whole book']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{
              padding: '7px 14px', borderRadius: 'var(--radius-md)', fontSize: 'var(--text-sm)',
              fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${tab === id ? 'var(--primary)' : 'var(--border)'}`,
              background: tab === id ? 'var(--primary-soft)' : 'var(--surface)',
              color: tab === id ? 'var(--primary)' : 'var(--text-secondary)',
            }}>{label}</button>
        ))}
      </div>

      {tab === 'exceptions' && <Exceptions book={book} today={today} onOpen={setOpen} />}
      {tab === 'all' && <Register book={book} today={today} onOpen={setOpen} />}

      {opened && (
        <OrderDetail order={opened} book={book} today={today}
          onClose={() => setOpen(null)} onChanged={reload} />
      )}
    </div>
  )
}

/* --------------------------------------------------------------- the rollup -- */

function Rollup({ book, today }: { book: OrderBook; today: string }) {
  const { fmtIn } = useMarket()
  const r = rollup(book.orders, book.lines, book.pushes, today)

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '12px' }}>
      <StatCard label="Still moving" value={fmtInt(r.open)}
        sublabel={`of ${fmtInt(r.total)} in the book`} />
      {/* Four currencies trade here, so this is several figures. A single total
          across them would be a quantity of nothing, and it would look entirely
          reasonable on the screen. */}
      <StatCard label="Open order value" value={formatGroups(r.value, fmtIn)}
        sublabel="Each market in its own money" />
      <StatCard label="Saying something untrue" value={fmtInt(r.wrong)}
        sublabel={r.wrong === 0 ? 'Nothing is misreporting itself' : 'A customer has been told something false'}
        color={r.wrong > 0 ? 'var(--danger)' : undefined} />
      <StatCard label="Needs somebody" value={fmtInt(r.exceptions)}
        sublabel={`${fmtInt(r.failed)} failed outright`}
        color={r.exceptions > 0 ? 'var(--warning)' : undefined} />
    </div>
  )
}

/* ----------------------------------------------------------- the exceptions -- */

function Exceptions({ book, today, onOpen }: {
  book: OrderBook; today: string; onOpen: (id: string) => void
}) {
  const { fmtIn } = useMarket()
  const queue = useMemo(
    () => exceptionQueue(book.orders, book.lines, book.pushes, today),
    [book, today])

  if (queue.length === 0) {
    return (
      <SectionCard title="Nothing needs anybody"
        subtitle="Every order in the book agrees with its lines, its network fulfilment and what the customer is being shown.">
        <EmptyState message="No exceptions." />
      </SectionCard>
    )
  }

  return (
    <SectionCard title="What needs somebody, worst first"
      subtitle="An order saying something untrue comes above one that is merely slow — a delay is a delay, but a customer who has been told their service is live has already been misled.">
      <Table headers={['Order', 'Buyer', { label: 'Value', align: 'right' }, 'What is wrong', { label: '', align: 'right' }]}>
        {queue.map(e => {
          const o = e.order
          const age = ageInDays(o, today)
          return (
            <tr key={o.id}>
              <Td>
                <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{o.order_ref}</strong>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {o.market} · {o.placed_date ?? 'undated'}{age !== null ? ` · ${age}d old` : ''}
                </div>
                <div style={{ marginTop: '3px' }}>
                  <StatusPill status={STATUS_TONE[o.status] ?? 'draft'} label={o.status} />
                </div>
              </Td>
              <Td style={{ maxWidth: '26ch' }}>
                <div style={{ fontSize: 'var(--text-xs)' }}>{BUYER_LABEL[buyerKind(o)]}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                  {o.buyer_name ?? '—'}
                </div>
                {o.seller && (
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>from {o.seller}</div>
                )}
              </Td>
              <Td right>
                <strong>{fmtIn(o.total, o.currency)}</strong>
              </Td>
              <Td style={{ maxWidth: '52ch' }}>
                {e.problems.map((p, i) => (
                  <div key={i} style={{ marginBottom: i === e.problems.length - 1 ? 0 : '7px' }}>
                    <StatusPill status={SEVERITY_TONE[p.severity]} label={SEVERITY_LABEL[p.severity]} />
                    <div style={{ fontSize: 'var(--text-xs)', marginTop: '2px', lineHeight: 1.5 }}>{p.what}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>
                      {p.next}
                    </div>
                  </div>
                ))}
              </Td>
              <Td right>
                <Btn size="sm" onClick={() => onOpen(o.id)}>Open</Btn>
              </Td>
            </tr>
          )
        })}
      </Table>
    </SectionCard>
  )
}

/* -------------------------------------------------------------- the register -- */

function Register({ book, today, onOpen }: {
  book: OrderBook; today: string; onOpen: (id: string) => void
}) {
  const { fmtIn } = useMarket()
  const [q, setQ] = useState('')
  const [kind, setKind] = useState<'all' | 'consumer' | 'enterprise' | 'guest'>('all')
  const [status, setStatus] = useState('all')

  const found = useMemo(() => {
    let rows = searchOrders(book.orders, book.lines, q)
    if (kind !== 'all') rows = rows.filter(o => buyerKind(o) === kind)
    if (status !== 'all') rows = rows.filter(o => o.status === status)
    return rows
  }, [book, q, kind, status])

  const page = usePaging(found)
  const statuses = [...new Set(book.orders.map(o => o.status))].sort()

  return (
    <SectionCard title="Every order"
      subtitle="One box, because a caller does not know which field they are holding — a reference, an email, an account, a purchase order or the name of the thing they bought.">
      <div style={{ padding: '14px 18px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: '1 1 280px' }}>
          <Search size={15} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <TextInput value={q} onChange={e => setQ(e.target.value)} style={{ paddingLeft: '32px' }}
            placeholder="Reference, email, account, PO, tracking, or what they bought" />
        </div>
        <Select value={kind} onChange={e => setKind(e.target.value as typeof kind)} style={{ width: 'auto' }}>
          <option value="all">Every buyer</option>
          <option value="consumer">Retail</option>
          <option value="enterprise">Business accounts</option>
          <option value="guest">Guest checkout</option>
        </Select>
        <Select value={status} onChange={e => setStatus(e.target.value)} style={{ width: 'auto' }}>
          <option value="all">Any state</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
      </div>

      {found.length === 0
        ? <EmptyState message={q ? `Nothing matches "${q}".` : 'No orders.'} />
        : (
          <>
            <Table headers={['Order', 'Buyer', 'Bought', { label: 'Value', align: 'right' }, 'State', { label: '', align: 'right' }]}>
              {page.rows.map(o => {
                const mine = book.lines.filter(l => l.order_id === o.id)
                const problems = problemsFor(o, book.lines, book.pushes, today)
                return (
                  <tr key={o.id}>
                    <Td>
                      <strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{o.order_ref}</strong>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {o.market} · {o.placed_date ?? 'undated'}
                      </div>
                    </Td>
                    <Td style={{ maxWidth: '24ch' }}>
                      <div style={{ fontSize: 'var(--text-xs)' }}>{o.buyer_name ?? '—'}</div>
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                        {BUYER_LABEL[buyerKind(o)]}
                      </div>
                    </Td>
                    <Td style={{ maxWidth: '30ch' }}>
                      <div style={{ fontSize: 'var(--text-xs)', lineHeight: 1.5 }}>
                        {mine.map(l => l.product_name).join(', ') || '—'}
                      </div>
                      {o.seller && (
                        <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{o.seller}</div>
                      )}
                    </Td>
                    <Td right><strong>{fmtIn(o.total, o.currency)}</strong></Td>
                    <Td>
                      <StatusPill status={STATUS_TONE[o.status] ?? 'draft'} label={o.status} />
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                        showing “{showing(o)}”
                      </div>
                      {problems.length > 0 && (
                        <div style={{ fontSize: '10px', color: 'var(--warning)', marginTop: '2px' }}>
                          {problems.length} thing{problems.length === 1 ? '' : 's'} wrong
                        </div>
                      )}
                    </Td>
                    <Td right><Btn size="sm" variant="secondary" onClick={() => onOpen(o.id)}>Open</Btn></Td>
                  </tr>
                )
              })}
            </Table>
            <div style={{ padding: '0 18px 12px' }}><Pager page={page} noun="orders" /></div>
          </>
        )}
    </SectionCard>
  )
}

/* ----------------------------------------------------------------- the order -- */

function OrderDetail({ order, book, today, onClose, onChanged }: {
  order: OrderRow; book: OrderBook; today: string
  onClose: () => void; onChanged: () => Promise<void>
}) {
  const { fmtIn } = useMarket()
  const [busy, setBusy] = useState(false)
  const [failing, setFailing] = useState(false)
  const [why, setWhy] = useState('')
  const [tracking, setTracking2] = useState(false)
  const [carrier, setCarrier] = useState(order.carrier ?? '')
  const [ref, setRef] = useState(order.tracking_ref ?? '')

  const lines = book.lines.filter(l => l.order_id === order.id)
  const pushes = book.pushes.filter(p => p.order_ref === order.order_ref)
  const problems = problemsFor(order, book.lines, book.pushes, today)
  const forward = canAdvance(order, book.pushes)
  const charged = linesCharged(lines)

  const run = async (fn: () => Promise<{ ok: boolean; why?: string; to?: string }>, good: string) => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    toast(r.ok ? (r.to ? `${order.order_ref} moved to “${r.to}”.` : good) : (r.why ?? 'That did not go through'),
          r.ok ? 'success' : 'error')
    if (r.ok) { await onChanged(); onClose() }
  }

  return (
    <Modal open title={order.order_ref} onClose={onClose}
      footer={<Btn variant="secondary" size="sm" onClick={onClose}>Close</Btn>}>

      {problems.length > 0 && (
        <div style={{ marginBottom: '14px' }}>
          {problems.map((p, i) => (
            <Callout key={i} tone={p.severity === 'wrong' ? 'danger' : 'warning'}
                     title={SEVERITY_LABEL[p.severity]}>
              <div style={{ lineHeight: 1.6 }}>{p.what}</div>
              <div style={{ marginTop: '3px', opacity: 0.85 }}>{p.next}</div>
            </Callout>
          ))}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '10px', marginBottom: '14px' }}>
        <Fact icon={<PackageSearch size={14} />} label="Buyer" value={contactLine(order)} />
        <Fact icon={<Truck size={14} />} label="Showing the customer"
              value={`${showing(order)}${atEnd(order) ? ' — the end of its ladder' : ''}`} />
        <Fact icon={<CircleSlash size={14} />} label="Paid"
              value={`${fmtIn(order.total, order.currency)} by ${order.payment_method ?? 'an unrecorded method'}`} />
        {order.requisition_id && (
          <Fact icon={<TriangleAlert size={14} />} label="Bought on"
                value={`${order.requisition_id}${order.po_ref ? ` · ${order.po_ref}` : ''}${order.cost_centre ? ` · ${order.cost_centre}` : ''}`} />
        )}
      </div>

      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '6px' }}>What was bought</div>
      <Table headers={['Line', 'Fulfilment', { label: 'Qty', align: 'right' }, { label: 'Charged', align: 'right' }, 'Network']}>
        {lines.map(l => {
          const p = pushes.find(x => x.product_name === l.product_name)
          return (
            <tr key={l.id}>
              <Td>
                <div style={{ fontSize: 'var(--text-xs)' }}>{l.product_name}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)' }}>
                  {l.product_id}
                </div>
              </Td>
              <Td><span style={{ fontSize: 'var(--text-xs)' }}>{l.fulfil}</span></Td>
              <Td right>{fmtInt(l.quantity)}</Td>
              <Td right>{fmtIn(l.price * l.quantity, order.currency)}</Td>
              <Td>
                {p
                  ? <>
                      <StatusPill status={COM_TONE[p.state]} label={COM_LABEL[p.state]} />
                      {p.failure_reason && (
                        <div style={{ fontSize: '10px', color: 'var(--danger)', marginTop: '2px', maxWidth: '24ch', lineHeight: 1.4 }}>
                          {p.failure_reason}
                        </div>
                      )}
                    </>
                  : <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>not a network order</span>}
              </Td>
            </tr>
          )
        })}
      </Table>

      {/* Tax-inclusive, so the lines sum to what was charged before any
          order-level discount — said on the screen because a reader adding the
          column up and getting the total rather than the subtotal would
          otherwise think one of them was wrong. */}
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: '8px 0 16px', lineHeight: 1.6 }}>
        Lines come to {fmtIn(charged, order.currency)} — prices are what the buyer was quoted, tax
        included, so {fmtIn(order.tax, order.currency)} of that is {order.tax_rate}% tax collected on
        the authority's behalf.{' '}
        {order.discount > 0
          ? <>A discount of {fmtIn(order.discount, order.currency)} came off, so {fmtIn(order.total, order.currency)} was charged.</>
          : <>Nothing came off, so {fmtIn(order.total, order.currency)} was charged.</>}
      </div>

      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '4px' }}>What can be done here</div>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: '0 0 10px', lineHeight: 1.6 }}>
        {FROZEN_REASON}
      </p>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <Btn size="sm" disabled={busy || !forward.ok}
             title={forward.ok ? `Move it to “${forward.to}”` : forward.reason}
             onClick={() => void run(() => advance(order), 'Moved on.')}>
          {forward.ok ? `Move to “${forward.to}”` : 'Cannot move on'}
        </Btn>
        <Btn size="sm" variant="secondary" disabled={busy || order.stage === 0}
             onClick={() => void run(() => stepBack(order), 'Stepped back.')}>Step back</Btn>
        {order.failed
          ? <Btn size="sm" variant="secondary" disabled={busy}
                 title="The reason stays on the record — a failure that was investigated and reversed is still worth reading about."
                 onClick={() => void run(() => unfail(order), 'Failure reversed. The reason is kept.')}>
              Reverse the failure
            </Btn>
          : <Btn size="sm" variant="secondary" disabled={busy} onClick={() => setFailing(true)}>Fail it</Btn>}
        <Btn size="sm" variant="secondary" disabled={busy} onClick={() => setTracking2(true)}>
          {order.tracking_ref ? 'Change tracking' : 'Add tracking'}
        </Btn>
        {/* Only for the order a fault minted. The database refuses it the moment
            a payment, refund, settlement line, network push, number, stock unit
            or invoice refers to it — so the button is offered and the refusal,
            if it comes, names what is holding on. */}
        {order.status === 'placed' && !order.failed && (
          <Btn size="sm" variant="secondary" disabled={busy}
               title="Only possible for an order nothing has touched — no payment, no fulfilment, no invoice."
               onClick={() => void run(() => removeOrder(order), `${order.order_ref} removed.`)}>
            Remove as a duplicate
          </Btn>
        )}
      </div>

      {!forward.ok && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '8px', lineHeight: 1.6 }}>
          {forward.reason}
        </div>
      )}

      {failing && (
        <Modal open title={`Fail ${order.order_ref}`} onClose={() => setFailing(false)}
          footer={<>
            <Btn variant="secondary" size="sm" onClick={() => setFailing(false)}>Cancel</Btn>
            <Btn size="sm" disabled={busy || !why.trim()}
                 onClick={() => void run(() => failOrder(order, why), 'Failed, with the reason recorded.')}>
              Fail it
            </Btn>
          </>}>
          <FormField label="What went wrong" required
                     hint="The customer and support both read this. “Failed” on its own leaves them with a dead order and nothing to say about it.">
            <TextArea rows={3} value={why} onChange={e => setWhy(e.target.value)} />
          </FormField>
        </Modal>
      )}

      {tracking && (
        <Modal open title={`Tracking for ${order.order_ref}`} onClose={() => setTracking2(false)}
          footer={<>
            <Btn variant="secondary" size="sm" onClick={() => setTracking2(false)}>Cancel</Btn>
            <Btn size="sm" disabled={busy || !ref.trim()}
                 onClick={() => void run(() => setTracking(order, carrier, ref), 'Tracking recorded.')}>
              Save
            </Btn>
          </>}>
          <FormField label="Carrier">
            <TextInput value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="Blue Dart" />
          </FormField>
          <FormField label="Tracking reference" required
                     hint="Without it the customer has nothing to look up and support has nothing to quote.">
            <TextInput value={ref} onChange={e => setRef(e.target.value)} />
          </FormField>
        </Modal>
      )}
    </Modal>
  )
}

function Fact({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '9px 11px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--text-tertiary)' }}>
        {icon}<span style={{ fontSize: '10px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      </div>
      <div style={{ fontSize: 'var(--text-xs)', marginTop: '3px', lineHeight: 1.5 }}>{value}</div>
    </div>
  )
}
