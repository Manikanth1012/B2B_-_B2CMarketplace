import { useState, useEffect, useCallback, useRef } from 'react'
import { TriangleAlert as AlertTriangle, Download, Upload, TriangleAlert } from 'lucide-react'
import {
  StatCard, SectionCard, Table, Td, StatusPill, fmtInt, Btn, toast, Modal,
  EmptyState, FormField, TextInput, TextArea,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { Pager, usePaging } from '../Pager'
import { VERTICAL_NAMES } from './data'
import {
  isOpen, isDone, nextStep, needsTracking, canAdvance,
  dispatchExport, parseDispatch, dispatchSummary, DISPATCH_HEADER,
} from '../../lib/fulfilment'
import type { SellerOrder, DispatchRow } from '../../lib/fulfilment'
import { loadSellerOrders, advance, markFailed, applyDispatch } from '../../lib/fulfilmentRepo'
import type { OrderBook } from '../../lib/fulfilmentRepo'
import { toCsv } from '../../lib/ledger'
import { saveBlob } from '../../lib/billPdf'
import { useMarket } from '../../lib/MarketContext'

/* The screen ran on `PARTNER_ORDERS` in `data.ts`: six invented orders in
   dollars, whose stage buttons moved a number in React state and were gone on
   reload. `orders` had no policy letting a seller read the orders they have to
   pack, which is why. It has one now, so this reads the table. */
export function PartnerOrders({ partnerId }: { partnerId: string }) {
  const [book, setBook] = useState<OrderBook>({ orders: [], lines: [], mine: new Set(), parts: [] })
  const [loading, setLoading] = useState(true)
  const [viewing, setViewing] = useState<SellerOrder | null>(null)
  const [failing, setFailing] = useState<SellerOrder | null>(null)
  const [why, setWhy] = useState('')
  const [asking, setAsking] = useState<SellerOrder | null>(null)
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const [bulk, setBulk] = useState(false)
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const file = useRef<HTMLInputElement>(null)

  /* Amounts are frozen on the order in the buyer's own currency — a rupee order
     and a dirham one sit in this table together and neither is converted. */
  const { fmtIn } = useMarket()

  const reload = useCallback(async () => {
    setBook(await loadSellerOrders(partnerId))
    setLoading(false)
  }, [partnerId])
  useEffect(() => { void reload() }, [reload])

  const page = usePaging(book.orders)

  const linesOf = (o: SellerOrder) => book.lines.filter(l => l.order_id === o.id)

  const step = async (o: SellerOrder, patch?: { carrier: string; tracking: string }) => {
    const check = canAdvance(o, linesOf(o), book.mine)
    if (!check.ok) { toast(check.reason, 'error'); return }
    setBusy(true)
    const r = await advance(o, patch)
    setBusy(false)
    toast(r.ok ? r.note ?? 'Saved' : r.reason, r.ok ? 'success' : 'error')
    if (r.ok) { setAsking(null); setViewing(null); setCarrier(''); setTracking(''); await reload() }
  }

  /* A physical order moving on without a tracking number is the one a buyer
     rings about, so it is asked for rather than left blank. */
  const onStep = (o: SellerOrder) => {
    if (needsTracking(o, linesOf(o))) { setAsking(o); setCarrier(o.carrier ?? ''); setTracking('') ; return }
    void step(o)
  }

  const fail = async () => {
    if (!failing) return
    setBusy(true)
    const r = await markFailed(failing, why)
    setBusy(false)
    toast(r.ok ? r.note ?? 'Saved' : r.reason, r.ok ? 'success' : 'error')
    if (r.ok) { setFailing(null); setWhy(''); setViewing(null); await reload() }
  }

  const exportOpen = () => {
    const rows = dispatchExport(book.orders, book.lines)
    if (rows.length <= 1) { toast('Nothing is waiting to be dispatched.', 'info'); return }
    saveBlob(new Blob([toCsv(rows)], { type: 'text/csv' }), `dispatch-${new Date().toISOString().slice(0, 10)}.csv`)
    toast(`${rows.length - 1} order${rows.length === 2 ? '' : 's'} exported. Fill in the carrier and tracking columns and bring the file back.`)
  }

  const parsed = pasted.trim() ? parseDispatch(pasted, book.orders) : null

  const applyRows = async (rows: readonly DispatchRow[]) => {
    setBusy(true)
    const { applied, failures } = await applyDispatch(rows, book.orders)
    setBusy(false)
    await reload()
    if (applied) toast(`${applied} order${applied === 1 ? '' : 's'} dispatched.`)
    if (failures.length) toast(failures.slice(0, 3).join(' '), 'error')
    if (applied && !failures.length) { setBulk(false); setPasted('') }
  }

  const readFile = (f: File) => {
    const reader = new FileReader()
    reader.onload = () => setPasted(String(reader.result ?? ''))
    reader.readAsText(f)
  }

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const open = book.orders.filter(isOpen)
  const failed = book.orders.filter(o => o.failed)
  const complete = book.orders.filter(isDone)
  const dispatchable = dispatchExport(book.orders, book.lines).length - 1

  /* Value is grouped by currency rather than summed: a rupee total and a dirham
     one added together is a number that means nothing. */
  const byCurrency = new Map<string, number>()
  for (const o of book.orders) {
    if (o.failed) continue
    byCurrency.set(o.currency, (byCurrency.get(o.currency) ?? 0) + o.total)
  }
  const value = [...byCurrency.entries()].map(([c, n]) => fmtIn(n, c)).join(' · ') || '—'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Orders</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {book.orders.length} order{book.orders.length === 1 ? '' : 's'} · {open.length} to fulfil{failed.length ? ` · ${failed.length} failed` : ''}
          </p>
        </div>
        <Btn variant="secondary" onClick={() => setBulk(true)}>
          <Upload size={14} /> Bulk dispatch
        </Btn>
      </div>

      {book.loadError && <Callout tone="danger" title="Some of this did not load">{book.loadError}</Callout>}

      {failed.length > 0 && (
        <div style={{
          display: 'flex', gap: '12px', alignItems: 'flex-start',
          padding: '14px 18px', borderRadius: 'var(--radius-md)',
          background: 'var(--danger-bg)', border: '1px solid var(--danger)',
        }}>
          <AlertTriangle size={18} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '1px' }} />
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
            <strong>{failed.length} order{failed.length === 1 ? '' : 's'} failed at fulfilment.</strong> These do not
            settle until they are resolved, and they count against your dispatch-on-time rate.
          </div>
        </div>
      )}

      <div className="stat-row">
        <StatCard label="To fulfil" value={fmtInt(open.length)}
                  sublabel={dispatchable ? `${dispatchable} awaiting a tracking number` : 'Nothing needs dispatching'}
                  color="var(--brand-accent-dark)" />
        <StatCard label="Completed" value={fmtInt(complete.length)} sublabel="Delivered or in service" color="var(--success)" />
        <StatCard label="Failed" value={fmtInt(failed.length)} sublabel={failed.length ? 'Action needed' : 'None'}
                  color={failed.length ? 'var(--danger)' : undefined} />
        <StatCard label="Value ordered" value={value} sublabel="Gross, in each buyer's own money" color="var(--brand-navy)" />
      </div>

      <SectionCard title="Your orders" subtitle="Newest first. Click a row for the lines and where it has got to.">
        {book.orders.length === 0 ? (
          <EmptyState message="Nothing has been ordered from you yet. Orders appear here the moment a buyer places one." />
        ) : (
          <>
            <Table headers={['Order', 'What', 'Buyer', 'Value', 'Where it is', '']}>
              {page.rows.map(o => {
                const mine = linesOf(o)
                const shared = mine.some(l => !book.mine.has(l.product_id))
                return (
                  <tr key={o.id} onClick={() => setViewing(o)} style={{ cursor: 'pointer' }} title="Open this order">
                    <Td>
                      <div style={{ fontWeight: 600 }}>{o.order_ref}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{o.placed_date ?? ''}</div>
                    </Td>
                    <Td>
                      {mine.filter(l => book.mine.has(l.product_id)).map(l => (
                        <div key={l.product_id} style={{ fontSize: 'var(--text-sm)' }}>
                          {l.quantity}× {l.product_name}
                        </div>
                      ))}
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {VERTICAL_NAMES[o.vertical] ?? o.vertical}
                        {shared && ' · shared with another seller'}
                      </div>
                    </Td>
                    <Td>
                      <div>{o.buyer_name}</div>
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                        {o.account_id ? `Business · ${o.cost_centre ?? 'no cost centre'}` : 'Retail'}
                      </div>
                    </Td>
                    <Td right>{fmtIn(o.total, o.currency)}</Td>
                    <Td right>
                      {o.failed ? <StatusPill status="rejected" />
                        : isOpen(o) ? <StatusPill status="open" />
                        : <StatusPill status="resolved" />}
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                        {o.stages[o.stage] ?? ''}
                      </div>
                    </Td>
                    <Td right>
                      {/* The stage button moves the order on; it must not also
                          open the row it is sitting in. */}
                      {o.failed
                        ? <Btn variant="primary" size="sm" onClick={e => { e.stopPropagation(); setViewing(o) }}>Resolve</Btn>
                        : isOpen(o) && !shared
                        ? <Btn variant="primary" size="sm" disabled={busy}
                               onClick={e => { e.stopPropagation(); onStep(o) }}>{nextStep(o)}</Btn>
                        : <Btn variant="secondary" size="sm" onClick={e => { e.stopPropagation(); setViewing(o) }}>View</Btn>}
                    </Td>
                  </tr>
                )
              })}
            </Table>
            <Pager page={page} noun="orders" />
          </>
        )}
      </SectionCard>

      {/* ------------------------------------------------------- one order */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? viewing.order_ref : ''}
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', width: '100%' }}>
            <div>
              {viewing && isOpen(viewing) && (
                <Btn variant="secondary" size="sm" onClick={() => { setFailing(viewing); setWhy('') }}>
                  Something went wrong
                </Btn>
              )}
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Btn variant="secondary" size="sm" onClick={() => setViewing(null)}>Close</Btn>
              {viewing && isOpen(viewing) && canAdvance(viewing, linesOf(viewing), book.mine).ok && (
                <Btn size="sm" disabled={busy} onClick={() => onStep(viewing)}>
                  Mark {(nextStep(viewing) ?? '').toLowerCase()}
                </Btn>
              )}
            </div>
          </div>
        }>
        {viewing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Placed {viewing.placed_date ?? ''} · {VERTICAL_NAMES[viewing.vertical] ?? viewing.vertical}
              {viewing.tracking_ref ? ` · ${viewing.carrier ?? 'carrier not named'} ${viewing.tracking_ref}` : ''}
            </div>

            {/* Where it has got to, in the same rail language the rest of the
                console uses rather than a single word in a cell. */}
            <div>
              <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                Fulfilment
              </div>
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                {viewing.stages.map((st, i) => {
                  const done = i <= viewing.stage
                  const stopped = viewing.failed && i === viewing.stage
                  const ring = stopped ? 'var(--danger)' : done ? 'var(--success)' : 'var(--border)'
                  const fill = stopped ? 'var(--danger-bg)' : done ? 'var(--success-bg)' : 'var(--bg-alt)'
                  const ink = stopped ? 'var(--danger)' : done ? 'var(--success)' : 'var(--text-tertiary)'
                  return (
                    <li key={st} style={{ flex: '1 1 110px', minWidth: '110px' }}>
                      <div style={{ padding: '9px 10px', borderRadius: 'var(--radius-md)', border: `1px solid ${ring}`, background: fill }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: ink }}>
                          {stopped ? 'Failed' : done ? 'Done' : `Step ${i + 1}`}
                        </div>
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)', marginTop: '2px' }}>{st}</div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>

            <OrderFact label="Buyer" value={`${viewing.buyer_name} · ${viewing.account_id ? 'business account' : 'retail'}`} />
            {viewing.account_id && (
              <OrderFact label="Charged to" value={`${viewing.cost_centre ?? 'no cost centre'} · ${viewing.account_id}`} />
            )}

            <div>
              <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: '6px' }}>
                Lines
              </div>
              <Table headers={['Item', 'Qty', 'Unit', 'Line']}>
                {linesOf(viewing).map(l => (
                  <tr key={l.product_id}>
                    <Td>
                      {l.product_name}
                      {!book.mine.has(l.product_id) && (
                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}> · another seller's</span>
                      )}
                    </Td>
                    <Td right>{fmtInt(l.quantity)}</Td>
                    <Td right>{fmtIn(l.price, viewing.currency)}</Td>
                    <Td right>{fmtIn(l.price * l.quantity, viewing.currency)}</Td>
                  </tr>
                ))}
              </Table>
            </div>

            {!canAdvance(viewing, linesOf(viewing), book.mine).ok && isOpen(viewing) && (
              <Callout tone="warning" title="This one is not yours to move on">
                {(canAdvance(viewing, linesOf(viewing), book.mine) as { reason: string }).reason}
              </Callout>
            )}

            {viewing.failed && (
              <Callout tone="danger" title="This order failed at fulfilment">
                {viewing.failed_reason ?? 'No reason was recorded.'} It does not settle until it is resolved,
                and it counts against your dispatch-on-time rate. Raise it with the marketplace from Disputes
                &amp; Support — a failure the buyer is not told about becomes a refund.
              </Callout>
            )}
          </div>
        )}
      </Modal>

      {/* ------------------------------------------------------ a tracking # */}
      <Modal
        open={!!asking}
        onClose={() => setAsking(null)}
        title={asking ? `Dispatch ${asking.order_ref}` : ''}
        footer={
          <div style={{ display: 'flex', gap: '8px' }}>
            <Btn variant="secondary" onClick={() => setAsking(null)}>Cancel</Btn>
            <Btn variant="primary" disabled={busy || !carrier.trim() || !tracking.trim()}
                 onClick={() => asking && step(asking, { carrier, tracking })}>
              {busy ? 'Saving…' : 'Mark dispatched'}
            </Btn>
          </div>
        }>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Callout tone="info">
            The buyer is shown the carrier and the number, so this is what they will quote when they ring.
            Getting it in now is the difference between a question and a dispute.
          </Callout>
          <FormField label="Carrier" required>
            <TextInput value={carrier} onChange={e => setCarrier(e.target.value)} placeholder="BlueDart" />
          </FormField>
          <FormField label="Tracking number" required>
            <TextInput value={tracking} onChange={e => setTracking(e.target.value)} placeholder="TRK-886201" />
          </FormField>
        </div>
      </Modal>

      {/* ---------------------------------------------------------- failure */}
      <Modal
        open={!!failing}
        onClose={() => setFailing(null)}
        title={failing ? `What went wrong with ${failing.order_ref}?` : ''}
        footer={
          <div style={{ display: 'flex', gap: '8px' }}>
            <Btn variant="secondary" onClick={() => setFailing(null)}>Cancel</Btn>
            <Btn variant="primary" disabled={busy || !why.trim()} onClick={() => void fail()}>
              {busy ? 'Saving…' : 'Flag it'}
            </Btn>
          </div>
        }>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Callout tone="warning">
            The buyer and the marketplace both see what you write. The order stops settling until it is
            resolved, so say enough that somebody can pick it up without asking you.
          </Callout>
          <FormField label="What happened" required>
            <TextArea rows={4} value={why} onChange={e => setWhy(e.target.value)}
                      placeholder="Two of the six sensors failed the pre-dispatch calibration check. Replacements ship Thursday." />
          </FormField>
        </div>
      </Modal>

      {/* ---------------------------------------------------- bulk dispatch */}
      <Modal
        open={bulk}
        onClose={() => { setBulk(false); setPasted('') }}
        title="Bulk dispatch"
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', width: '100%' }}>
            <Btn variant="secondary" onClick={exportOpen}>
              <Download size={14} /> Export what is waiting
            </Btn>
            <div style={{ display: 'flex', gap: '8px' }}>
              <Btn variant="secondary" onClick={() => { setBulk(false); setPasted('') }}>Close</Btn>
              <Btn variant="primary" disabled={busy || !parsed?.rows.length}
                   onClick={() => parsed && applyRows(parsed.rows)}>
                {busy ? 'Applying…' : parsed?.rows.length ? `Dispatch ${parsed.rows.length}` : 'Dispatch'}
              </Btn>
            </div>
          </div>
        }>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <Callout tone="info" title="Export, fill in, bring back">
            Export gives you every order waiting to ship with the carrier and tracking columns blank.
            Fill them in — in a spreadsheet, or by your warehouse system — and drop the file back here.
            Columns may be reordered and extra ones are ignored; the header row has to name{' '}
            <strong>{DISPATCH_HEADER.join(', ')}</strong>.
          </Callout>

          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input ref={file} type="file" accept=".csv,text/csv,text/plain" style={{ display: 'none' }}
                   onChange={e => { const f = e.target.files?.[0]; if (f) readFile(f); e.target.value = '' }} />
            <Btn variant="secondary" size="sm" onClick={() => file.current?.click()}>Choose a file</Btn>
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>or paste it below</span>
          </div>

          <FormField label="The file">
            <TextArea rows={7} value={pasted} onChange={e => setPasted(e.target.value)}
                      style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}
                      placeholder={`${DISPATCH_HEADER.join(',')}\nORD-883101,BlueDart,TRK-886400`} />
          </FormField>

          {parsed && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {parsed.rows.length > 0 && (
                <Callout tone="info" title="What this will do">
                  {dispatchSummary(parsed.rows, book.orders)}
                </Callout>
              )}
              {parsed.problems.length > 0 && (
                <div style={{
                  padding: '12px 14px', borderRadius: 'var(--radius-md)',
                  background: 'var(--warning-bg)', border: '1px solid var(--warning)',
                  fontSize: 'var(--text-sm)', color: 'var(--warning)',
                }}>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center', fontWeight: 700, marginBottom: '6px' }}>
                    <TriangleAlert size={15} />
                    {parsed.problems.length} row{parsed.problems.length === 1 ? '' : 's'} cannot be used
                  </div>
                  {/* Named individually, because "3 of 40 failed" without saying
                      which three is an import nobody can fix. */}
                  {parsed.problems.map((p, i) => <div key={i} style={{ marginTop: '2px' }}>{p}</div>)}
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}

function OrderFact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '12px', fontSize: 'var(--text-sm)' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  )
}
