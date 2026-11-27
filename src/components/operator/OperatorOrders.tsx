import { useState, useEffect, useCallback, useMemo } from 'react'
import { TriangleAlert, PackageSearch, Truck, CircleSlash } from 'lucide-react'
import {
  SectionCard, EmptyState, Btn, StatusPill, Table, Td, toast,
  Modal, FormField, TextInput, TextArea, Select, fmtInt, PageHeader, FilterBar, RowActions,
} from './shared'
import { Tabs } from '../ui/Tabs'
import { KpiCard, KpiRow, groupsToKpi } from '../ui/KpiCard'
import { Callout } from '../OnboardingJourney'
import { Pager, usePaging } from '../Pager'
import { StatusBadge } from '../ui/StatusBadge'
import { orderScores } from '../../lib/riskRepo'
import { bandTone } from '../../lib/risk'
import { loadOrderBook, advance, stepBack, failOrder, unfail, setTracking, removeOrder } from '../../lib/orderOpsRepo'
import type { OrderBook } from '../../lib/orderOpsRepo'
import {
  buyerKind, BUYER_LABEL, contactLine, showing, atEnd, ageInDays, problemsFor,
  exceptionQueue, linesCharged, canAdvance, searchOrders, rollup,
  STATUS_TONE, SEVERITY_LABEL, FROZEN_REASON, HELD_FOR_REVIEW,
} from '../../lib/orderOps'
import type { OrderRow, Severity } from '../../lib/orderOps'
import { STATE_LABEL as COM_LABEL, STATE_TONE as COM_TONE } from '../../lib/com'
import { useMarket } from '../../lib/MarketContext'
import { groupBySelection } from '../../lib/bundles'
import { useBundleNames } from '../bundles/useBundleNames'

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
      <PageHeader
        title="Orders"
        description="Every order across retail, business accounts and guest checkout, in one place. The marketplace moves an order along; it does not rewrite what it cost or who bought it, and a refund is the way to change those.">
        <Tabs ariaLabel="Order views" panelIdPrefix="orders-panel-" value={tab} onChange={id => setTab(id as 'exceptions' | 'all')}
          tabs={[{ id: 'exceptions', label: 'Needs somebody' }, { id: 'all', label: 'The whole book' }]} />
      </PageHeader>

      <Rollup book={book} today={today} />

      <div role="tabpanel" id={`orders-panel-${tab}`}>
      {tab === 'exceptions' && <Exceptions book={book} today={today} onOpen={setOpen} />}
      {tab === 'all' && <Register book={book} today={today} onOpen={setOpen} />}
      </div>


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

  const money = groupsToKpi(r.value, fmtIn)

  return (
    <KpiRow label="Order summary">
      <KpiCard variant="ops" label="Still moving" value={fmtInt(r.open)}
        status={`of ${fmtInt(r.total)} in the book`} />
      {/* Four currencies trade here, so this is several figures. A single total
          across them would be a quantity of nothing, and it would look entirely
          reasonable on the screen. The largest leads; the rest are listed. */}
      <KpiCard variant="money" label="Open order value" value={money.value} breakdown={money.breakdown}
        context="Each market in its own money" />
      <KpiCard variant={r.wrong > 0 ? 'risk' : 'ops'} label="Saying something untrue" value={fmtInt(r.wrong)}
        tone={r.wrong > 0 ? 'warning' : undefined}
        status={r.wrong === 0 ? 'Nothing is misreporting itself' : 'A customer has been told something false'} />
      <KpiCard variant="ops" label="Needs somebody" value={fmtInt(r.exceptions)}
        tone={r.exceptions > 0 ? 'warning' : undefined}
        status={`${fmtInt(r.failed)} failed outright`} />
    </KpiRow>
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
      <Table headers={['Order', 'Buyer', 'Value', 'What is wrong', 'Actions']}>
        {queue.map(e => {
          const o = e.order
          const age = ageInDays(o, today)
          return (
            <tr key={o.id}>
              <Td kind="id">
                <strong className="c-mono">{o.order_ref}</strong>
                <div className="c-sub">
                  {o.market} · {o.placed_date ?? 'undated'}{age !== null ? ` · ${age}d old` : ''}
                </div>
                <div style={{ marginTop: '3px' }}>
                  <StatusPill status={STATUS_TONE[o.status] ?? 'draft'} label={o.status} />
                </div>
              </Td>
              <Td style={{ maxWidth: '26ch' }}>
                <div>{BUYER_LABEL[buyerKind(o)]}</div>
                <div className="c-sub">{o.buyer_name ?? '—'}</div>
                {o.seller && <div className="c-sub">from {o.seller}</div>}
              </Td>
              <Td kind="num">
                <strong>{fmtIn(o.total, o.currency)}</strong>
              </Td>
              <Td style={{ maxWidth: '52ch' }}>
                {e.problems.map((p, i) => (
                  <div key={i} style={{ marginBottom: i === e.problems.length - 1 ? 0 : '7px' }}>
                    <StatusPill status={SEVERITY_TONE[p.severity]} label={SEVERITY_LABEL[p.severity]} />
                    <div style={{ marginTop: '2px', lineHeight: 1.5 }}>{p.what}</div>
                    <div className="c-sub">{p.next}</div>
                  </div>
                ))}
              </Td>
              <Td>
                <RowActions label={o.order_ref} actions={[{ label: 'Open', variant: 'primary', onClick: () => onOpen(o.id) }]} />
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
  /* A configured bundle's parts read as one item under its name. */
  const bundleName = useBundleNames(book.lines)
  /* The risk score of the orders on this page; nothing until the risk migration is applied. */
  const [scores, setScores] = useState<Awaited<ReturnType<typeof orderScores>>>(new Map())
  const pageIds = page.rows.map(o => o.id).join(',')
  useEffect(() => {
    let live = true
    void orderScores(pageIds ? pageIds.split(',') : []).then(m => { if (live) setScores(m) })
    return () => { live = false }
  }, [pageIds])
  const statuses = [...new Set(book.orders.map(o => o.status))].sort()

  return (
    <SectionCard title="Every order"
      subtitle="One box, because a caller does not know which field they are holding — a reference, an email, an account, a purchase order or the name of the thing they bought.">
      <FilterBar ariaLabel="Filter orders"
        search={{ value: q, onChange: setQ, ariaLabel: 'Search orders',
          placeholder: 'Reference, email, account, PO, tracking, or what they bought' }}>
        <Select aria-label="Buyer" value={kind} onChange={e => setKind(e.target.value as typeof kind)}>
          <option value="all">Every buyer</option>
          <option value="consumer">Retail</option>
          <option value="enterprise">Business accounts</option>
          <option value="guest">Guest checkout</option>
        </Select>
        <Select aria-label="State" value={status} onChange={e => setStatus(e.target.value)}>
          <option value="all">Any state</option>
          {statuses.map(s => <option key={s} value={s}>{s}</option>)}
        </Select>
      </FilterBar>

      {found.length === 0
        ? <EmptyState message={q ? `Nothing matches "${q}".` : 'No orders.'} />
        : (
          <>
            <Table headers={['Order', 'Buyer', 'Bought', 'Value', 'State', 'Actions']}>
              {page.rows.map(o => {
                const mine = book.lines.filter(l => l.order_id === o.id)
                const problems = problemsFor(o, book.lines, book.pushes, today)
                return (
                  <tr key={o.id}>
                    <Td kind="id">
                      <strong className="c-mono">{o.order_ref}</strong>
                      <div className="c-sub">{o.market} · {o.placed_date ?? 'undated'}</div>
                    </Td>
                    <Td style={{ maxWidth: '24ch' }}>
                      <div>{o.buyer_name ?? '—'}</div>
                      <div className="c-sub">{BUYER_LABEL[buyerKind(o)]}</div>
                    </Td>
                    <Td style={{ maxWidth: '30ch' }}>
                      <div style={{ lineHeight: 1.5 }}>
                        {groupBySelection(mine).map(g => g.selectionId
                          ? `Bundle: ${bundleName(g.selectionId)} (${g.lines.map(l => l.product_name).join(', ')})`
                          : g.lines[0].product_name).join(', ') || '—'}
                      </div>
                      {o.seller && <div className="c-sub">{o.seller}</div>}
                    </Td>
                    <Td kind="num"><strong>{fmtIn(o.total, o.currency)}</strong></Td>
                    <Td kind="status">
                      <StatusPill status={STATUS_TONE[o.status] ?? 'draft'} label={o.status} />
                      {scores.has(o.id) && (
                        <div style={{ marginTop: '3px' }}>
                          <StatusBadge tone={bandTone(scores.get(o.id)!.band)}>Risk {scores.get(o.id)!.score}</StatusBadge>
                        </div>
                      )}
                      <div className="c-sub" style={{ marginTop: '2px' }}>showing “{showing(o)}”</div>
                      {problems.length > 0 && (
                        <div style={{ color: 'var(--warning)', marginTop: '2px' }}>
                          {problems.length} thing{problems.length === 1 ? '' : 's'} wrong
                        </div>
                      )}
                    </Td>
                    <Td>
                      <RowActions label={o.order_ref} actions={[{ label: 'Open', variant: 'secondary', onClick: () => onOpen(o.id) }]} />
                    </Td>
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
  /* A configured bundle is one group under its name; each part keeps its own
     row and price, as settlement and refunds are per part. */
  const bundleName = useBundleNames(lines)
  const pushes = book.pushes.filter(p => p.order_ref === order.order_ref)
  const problems = problemsFor(order, book.lines, book.pushes, today)
  const forward = canAdvance(order, book.pushes)
  const held = order.status === 'held'
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
      <Table headers={['Line', 'Fulfilment', 'Qty', 'Charged', 'Network']}>
        {groupBySelection(lines).flatMap(g => [
          ...(g.selectionId ? [
            <tr key={`b-${g.selectionId}`} className="bundle-row-head">
              <td className="c-td" colSpan={3}><strong>Bundle: {bundleName(g.selectionId)}</strong></td>
              <Td kind="num" style={{ fontWeight: 700 }}>{fmtIn(g.lines.reduce((n, l) => n + l.price * l.quantity, 0), order.currency)}</Td>
              <td className="c-td" />
            </tr>,
          ] : []),
          ...g.lines.map(l => {
          const p = pushes.find(x => x.product_name === l.product_name)
          return (
            <tr key={l.id} className={g.selectionId ? 'bundle-row-part' : undefined}>
              <Td>
                <div>{l.product_name}</div>
                <div className="c-sub c-mono">{l.product_id}</div>
              </Td>
              <Td>{l.fulfil}</Td>
              <Td kind="num">{fmtInt(l.quantity)}</Td>
              <Td kind="num">{fmtIn(l.price * l.quantity, order.currency)}</Td>
              <Td kind="status">
                {p
                  ? <>
                      <StatusPill status={COM_TONE[p.state]} label={COM_LABEL[p.state]} />
                      {p.failure_reason && (
                        <div style={{ color: 'var(--danger)', marginTop: '2px', maxWidth: '24ch', lineHeight: 1.4, whiteSpace: 'normal' }}>
                          {p.failure_reason}
                        </div>
                      )}
                    </>
                  : <span className="c-sub">not a network order</span>}
              </Td>
            </tr>
          )
          }),
        ])}
      </Table>

      {/* Tax-inclusive, so the lines sum to what was charged before any
          order-level discount — said on the screen because a reader adding the
          column up and getting the total rather than the subtotal would
          otherwise think one of them was wrong. */}
      <div style={{ color: 'var(--slate-600)', margin: '8px 0 16px', lineHeight: 1.6 }}>
        Lines come to {fmtIn(charged, order.currency)} — prices are what the buyer was quoted, tax
        included, so {fmtIn(order.tax, order.currency)} of that is {order.tax_rate}% tax collected on
        the authority's behalf.{' '}
        {order.discount > 0
          ? <>A discount of {fmtIn(order.discount, order.currency)} came off, so {fmtIn(order.total, order.currency)} was charged.</>
          : <>Nothing came off, so {fmtIn(order.total, order.currency)} was charged.</>}
      </div>

      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '4px' }}>What can be done here</div>
      <p style={{ color: 'var(--slate-600)', margin: '0 0 10px', lineHeight: 1.6 }}>
        {FROZEN_REASON}
      </p>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {/* A held order is frozen until the Risk screen decides it (the database
            refuses each of these anyway), so it is not moved on, stepped back,
            failed or un-failed from here. */}
        {!held && (
          <Btn size="sm" disabled={busy || !forward.ok}
               title={forward.ok ? `Move it to “${forward.to}”` : forward.reason}
               onClick={() => void run(() => advance(order), 'Moved on.')}>
            {forward.ok ? `Move to “${forward.to}”` : 'Cannot move on'}
          </Btn>
        )}
        {!held && (
          <Btn size="sm" variant="secondary" disabled={busy || order.stage === 0}
               onClick={() => void run(() => stepBack(order), 'Stepped back.')}>Step back</Btn>
        )}
        {held ? null : order.failed
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

      {(held || !forward.ok) && (
        <div style={{ color: 'var(--slate-600)', marginTop: '8px', lineHeight: 1.6 }}>
          {held ? HELD_FOR_REVIEW : !forward.ok && forward.reason}
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
      <div className="c-sub" style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
        {icon}<span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</span>
      </div>
      <div style={{ marginTop: '3px', lineHeight: 1.5 }}>{value}</div>
    </div>
  )
}
