import { useState, useEffect, useCallback } from 'react'
import { Search, X } from 'lucide-react'
import {
  SectionCard, Table, Td, StatusPill, EmptyState, Btn, Modal, FormField,
  TextInput, Select, TextArea, toast, fmtInt, fmtDate,
} from './shared'
import { Callout } from '../OnboardingJourney'
import type { OperatorInventory } from '../../types'
import {
  STATE_LABEL, STATE_TONE, HOLD_LABEL, unitStory, provenance, holdsOn,
  oldestOnShelf, byOrder, batchReach, nextStates, canMove, matches, queryKind,
} from '../../lib/serials'
import type { StockUnit, UnitEvent, UnitRollup, UnitState, HoldReason } from '../../lib/serials'
import {
  loadLineUnits, loadLineDespatches, loadUnitHistory, findUnits, loadBatch,
  moveUnit, receiveUnits, recountLine,
} from '../../lib/serialsRepo'

/* What is behind a stock line.
 *
 * The ledger row says 68 on hand and 20 reserved. Neither number is a decision
 * and neither is checkable — "20 reserved" is where the conversation stops
 * unless somebody can say reserved against what. This screen is the twenty
 * units, with their serials, the order or the hold each is against, and where
 * every unit that has left this line went.
 */

export function StockLineDetail({ line, rollup, onClose, onChanged }: {
  line: OperatorInventory
  rollup: UnitRollup | null
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [tab, setTab] = useState<'units' | 'went' | 'receive'>('units')
  const [filter, setFilter] = useState<UnitState | 'all'>('all')
  const [units, setUnits] = useState<StockUnit[] | null>(null)
  const [gone, setGone] = useState<StockUnit[] | null>(null)
  const [open, setOpen] = useState<StockUnit | null>(null)

  const reload = useCallback(async () => {
    setUnits(null)
    const [u, g] = await Promise.all([
      loadLineUnits(line.product_id, line.warehouse_id, { state: filter }),
      loadLineDespatches(line.product_id, line.warehouse_id),
    ])
    setUnits(u)
    setGone(g)
  }, [line.product_id, line.warehouse_id, filter])

  useEffect(() => { void reload() }, [reload])

  const holds = holdsOn(units ?? [])
  const oldest = oldestOnShelf(units ?? [])
  const orders = byOrder(gone ?? [])

  return (
    <Modal open onClose={onClose}
           title={`${line.product?.name ?? line.product_id} · ${line.warehouse?.name ?? line.warehouse_id}`}
           footer={<Btn variant="secondary" size="sm" onClick={onClose}>Close</Btn>}>

      <div className="stat-row">
        <Tile label="On the shelf" value={rollup?.in_stock ?? 0}
              sub="Sellable right now" />
        <Tile label="Reserved" value={rollup?.reserved ?? 0}
              sub={rollup
                ? `${fmtInt(rollup.reserved_on_orders)} on orders · ${fmtInt(rollup.held_back)} held back`
                : '—'} />
        <Tile label="Gone" value={(rollup?.despatched ?? 0) + (rollup?.delivered ?? 0)}
              sub={`${fmtInt(rollup?.delivered ?? 0)} delivered · ${fmtInt(rollup?.despatched ?? 0)} in transit`} />
        <Tile label="Not sellable" value={(rollup?.faulty ?? 0) + (rollup?.returned ?? 0)}
              sub={`${fmtInt(rollup?.returned ?? 0)} came back · ${fmtInt(rollup?.faulty ?? 0)} faulty`} />
      </div>

      {/* Why a line is short. "48 available against a reorder point of 60" is
          not a decision; twenty units committed to a framework agreement is. */}
      {holds.length > 0 && (
        <Callout tone="info" title={`${fmtInt(line.reserved)} units are reserved, and this is what against`}>
          {holds.map(h => (
            <div key={h.reason} style={{ marginTop: '4px' }}>
              <strong>{fmtInt(h.count)}</strong> — {h.label}
              {h.note ? `: ${h.note}` : h.reason === 'order' ? ', awaiting picking' : ''}
            </div>
          ))}
        </Callout>
      )}

      {line.available < line.reorder_point && (
        <Callout tone={line.inbound >= line.reorder_point - line.available ? 'info' : 'danger'}
                 title={line.available === 0 ? 'Nothing sellable on this line' : 'Below the reorder point'}>
          {fmtInt(line.available)} available against a reorder point of {fmtInt(line.reorder_point)}.
          {' '}
          {line.inbound > 0
            ? `${fmtInt(line.inbound)} are on order${line.inbound_due ? `, due ${fmtDate(line.inbound_due)}` : ''}${
                line.inbound >= line.reorder_point - line.available
                  ? ' — enough to clear it, so this needs nothing from anybody today.'
                  : ' — not enough to clear it.'}`
            : 'Nothing is on order.'}
        </Callout>
      )}

      {oldest && oldest.days > 240 && (
        <Callout tone="warning" title="The back of this shelf is old">
          {oldest.serial} has been here {fmtInt(oldest.days)} days, since {oldest.received}. A line can be
          healthy on quantity and still be carrying units nobody will take.
        </Callout>
      )}

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
        {([
          { id: 'units' as const, label: 'The units' },
          { id: 'went' as const, label: `Where it went (${orders.length} orders)` },
          { id: 'receive' as const, label: 'Receive a delivery' },
        ]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '6px 12px', borderRadius: 'var(--radius)', fontSize: 'var(--text-xs)',
            fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border)',
            background: tab === t.id ? 'var(--brand-navy)' : 'white',
            color: tab === t.id ? 'white' : 'var(--text-secondary)',
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'units' && (
        <>
          <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
            {(['all', 'in_stock', 'reserved', 'despatched', 'delivered', 'returned', 'faulty'] as const).map(s => (
              <button key={s} onClick={() => setFilter(s)} style={{
                padding: '4px 10px', borderRadius: 'var(--radius-full)', fontSize: '11px',
                fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border)',
                background: filter === s ? 'var(--bg-alt)' : 'white',
                color: filter === s ? 'var(--text)' : 'var(--text-tertiary)',
              }}>{s === 'all' ? 'Everything' : STATE_LABEL[s]}</button>
            ))}
          </div>
          {units === null ? (
            <div style={{ textAlign: 'center', padding: '30px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
          ) : units.length === 0 ? (
            <EmptyState message="No units in that state on this line" />
          ) : (
            <>
              <Table headers={['Serial', 'State', 'Where it is', 'Received', 'Batch', '']}>
                {units.map(u => (
                  <tr key={u.serial}>
                    <Td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'var(--text-xs)' }}>{u.serial}</Td>
                    <Td right><StatusPill status={STATE_TONE[u.state]} label={STATE_LABEL[u.state]} /></Td>
                    <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '320px' }}>{unitStory(u)}</Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{u.received_on}</Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{u.batch_ref ?? '—'}</Td>
                    <Td right><Btn variant="secondary" size="sm" onClick={() => setOpen(u)}>Open</Btn></Td>
                  </tr>
                ))}
              </Table>
              {/* Said rather than left to be inferred from a list that stops. */}
              <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', padding: '8px 4px' }}>
                Showing {fmtInt(units.length)} units. The counts above are the whole line — they are
                computed in the database, not by counting these rows.
              </p>
            </>
          )}
        </>
      )}

      {tab === 'went' && (
        gone === null ? <div style={{ textAlign: 'center', padding: '30px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        : orders.length === 0 ? <EmptyState message="Nothing has left this line yet" />
        : (
          <SectionCard title="Which order took which units"
                       subtitle="The question a count cannot answer.">
            <Table headers={['Order', 'Customer', 'Units', 'State', 'When', 'Serials']}>
              {orders.map(o => (
                <tr key={o.order_ref}>
                  <Td>{o.order_ref}</Td>
                  <Td right>{o.customer ?? '—'}</Td>
                  <Td right>{fmtInt(o.count)}</Td>
                  <Td right><StatusPill status={STATE_TONE[o.state]} label={STATE_LABEL[o.state]} /></Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{o.on ?? '—'}</Td>
                  <Td right style={{ fontFamily: 'ui-monospace, monospace', fontSize: '11px', maxWidth: '340px' }}>
                    {o.serials.slice(0, 4).join(', ')}
                    {o.serials.length > 4 && ` and ${o.serials.length - 4} more`}
                  </Td>
                </tr>
              ))}
            </Table>
          </SectionCard>
        )
      )}

      {tab === 'receive' && (
        <ReceiveForm line={line} onDone={async () => { await reload(); await onChanged() }} />
      )}

      {open && (
        <UnitDetail unit={open} onClose={() => setOpen(null)}
                    onChanged={async () => { await reload(); await onChanged() }} />
      )}
    </Modal>
  )
}

function Tile({ label, value, sub }: { label: string; value: number; sub: string }) {
  return (
    <div style={{
      background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
      padding: '12px 14px', flex: 1, minWidth: '150px',
    }}>
      <div style={{ fontSize: '11px', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text)' }}>{fmtInt(value)}</div>
      <div style={{ fontSize: '11px', color: 'var(--text-tertiary)' }}>{sub}</div>
    </div>
  )
}

/* ---- One unit -------------------------------------------------------------- */

export function UnitDetail({ unit, onClose, onChanged }: {
  unit: StockUnit; onClose: () => void; onChanged: () => Promise<void>
}) {
  const [history, setHistory] = useState<UnitEvent[] | null>(null)
  const [batch, setBatch] = useState<StockUnit[] | null>(null)
  const [to, setTo] = useState<UnitState | ''>('')
  const [hold, setHold] = useState<HoldReason>('quarantine')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { void loadUnitHistory(unit.serial).then(setHistory) }, [unit.serial])

  const check = to ? canMove(unit, to, to === 'reserved' ? hold : undefined) : null

  const move = async () => {
    if (!to) return
    setBusy(true)
    const r = await moveUnit(unit, to, { hold: to === 'reserved' ? hold : null, note: note || undefined })
    setBusy(false)
    toast(r.ok ? r.note ?? 'Moved' : r.reason, r.ok ? 'success' : 'error')
    if (r.ok) { await onChanged(); onClose() }
  }

  const reach = batch && unit.batch_ref ? batchReach(batch, unit.batch_ref) : null

  return (
    <Modal open onClose={onClose} title={unit.serial}
           footer={<Btn variant="secondary" size="sm" onClick={onClose}>Close</Btn>}>
      <Callout tone="info" title={STATE_LABEL[unit.state]}>{unitStory(unit)}</Callout>

      <SectionCard title="Where it came from and where it went">
        <Table headers={['', '']}>
          {provenance(unit).map(p => (
            <tr key={p.label}>
              <Td style={{ fontWeight: 600, color: 'var(--text-secondary)', width: '40%' }}>{p.label}</Td>
              {/* Declared, never blank — "we did not record it" and "there is
                  nothing to record" are different and a gap reads as neither. */}
              <Td right style={{ color: p.value ? 'var(--text)' : 'var(--text-tertiary)' }}>
                {p.value ?? 'Not recorded'}
              </Td>
            </tr>
          ))}
        </Table>
      </SectionCard>

      <SectionCard title="Everything that has happened to it"
                   subtitle="Written when the state changed, not reconstructed from the row afterwards.">
        {history === null ? <div style={{ padding: '20px', textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        : history.length === 0 ? <EmptyState message="No history recorded" />
        : (
          <Table headers={['When', 'From', 'To', 'What happened', 'By']}>
            {history.map(e => (
              <tr key={e.id}>
                <Td style={{ fontSize: 'var(--text-xs)', whiteSpace: 'nowrap' }}>{new Date(e.at).toLocaleString('en-GB')}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{e.from_state ? STATE_LABEL[e.from_state as UnitState] : '—'}</Td>
                <Td right><StatusPill status={STATE_TONE[e.to_state as UnitState]} label={STATE_LABEL[e.to_state as UnitState]} /></Td>
                <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '300px' }}>{e.detail}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{e.actor}</Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      {/* The recall question. Nobody could ask it of a count. */}
      {unit.batch_ref && (
        <SectionCard title={`Batch ${unit.batch_ref}`}
                     subtitle="If this one is bad, these are the others and these are the customers holding them.">
          <div style={{ padding: '12px 16px' }}>
            {!reach ? (
              <Btn size="sm" onClick={() => void loadBatch(unit.batch_ref!).then(setBatch)}>
                Trace the batch
              </Btn>
            ) : (
              <>
                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                  {fmtInt(reach.total)} units in this batch · {fmtInt(reach.stillHere)} still with us
                  {' · '}{fmtInt(reach.shipped)} shipped to {reach.orders.length} order{reach.orders.length === 1 ? '' : 's'}.
                </p>
                {reach.orders.length > 0 && (
                  <Table headers={['Order', 'Customer', 'Units from this batch']}>
                    {reach.orders.map(o => (
                      <tr key={o.order_ref}>
                        <Td>{o.order_ref}</Td>
                        <Td right>{o.customer ?? '—'}</Td>
                        <Td right>{fmtInt(o.count)}</Td>
                      </tr>
                    ))}
                  </Table>
                )}
              </>
            )}
          </div>
        </SectionCard>
      )}

      <SectionCard title="Move it" subtitle="Only where it can actually go from where it is.">
        <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {nextStates(unit.state).length === 0 ? (
            <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
              A written-off unit does not move again. That is what writing off means.
            </p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
                <div style={{ flex: 1, minWidth: '160px' }}>
                  <FormField label="To">
                    <Select value={to} onChange={e => setTo(e.target.value as UnitState)}>
                      <option value="">Leave it where it is</option>
                      {nextStates(unit.state).map(s => (
                        <option key={s} value={s}>{STATE_LABEL[s]}</option>
                      ))}
                    </Select>
                  </FormField>
                </div>
                {to === 'reserved' && (
                  <div style={{ flex: 1, minWidth: '160px' }}>
                    <FormField label="Held why" hint="A reservation that does not say why is the number nobody could explain.">
                      <Select value={hold} onChange={e => setHold(e.target.value as HoldReason)}>
                        {(['quarantine', 'allocation', 'demo', 'engineering'] as const).map(h => (
                          <option key={h} value={h}>{HOLD_LABEL[h]}</option>
                        ))}
                      </Select>
                    </FormField>
                  </div>
                )}
              </div>
              <FormField label="Note">
                <TextArea value={note} onChange={e => setNote(e.target.value)}
                          placeholder="Why — this is what somebody reads in six months" />
              </FormField>
              {check && !check.ok && (
                <Callout tone="danger" title="That is not a move this unit can make">{check.reason}</Callout>
              )}
              {check && check.ok && check.note && (
                <Callout tone="warning" title="Before you do">{check.note}</Callout>
              )}
              <div>
                <Btn size="sm" disabled={!to || busy || (check ? !check.ok : false)} onClick={() => void move()}>
                  {busy ? 'Moving…' : 'Move this unit'}
                </Btn>
              </div>
            </>
          )}
        </div>
      </SectionCard>
    </Modal>
  )
}

/* ---- Receiving ------------------------------------------------------------- */

function ReceiveForm({ line, onDone }: { line: OperatorInventory; onDone: () => Promise<void> }) {
  const [qty, setQty] = useState(line.inbound > 0 ? line.inbound : 50)
  const [grn, setGrn] = useState('')
  const [batch, setBatch] = useState('')
  const [busy, setBusy] = useState(false)

  const receive = async () => {
    setBusy(true)
    const r = await receiveUnits(line.product_id, line.warehouse_id, qty, grn, batch)
    if (r.ok) {
      /* The count follows the units. Receiving without recounting would put the
         ledger back into the state this whole thing was built to end. */
      await recountLine(line.product_id, line.warehouse_id)
    }
    setBusy(false)
    toast(r.ok ? r.note ?? 'Received' : r.reason, r.ok ? 'success' : 'error')
    if (r.ok) await onDone()
  }

  return (
    <SectionCard title="Receive a delivery"
                 subtitle="Every unit gets a serial as it lands. An inbound quantity with no units behind it is the number this screen used to hold.">
      <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {line.inbound > 0 && (
          <Callout tone="info" title={`${fmtInt(line.inbound)} are on order`}>
            Due {line.inbound_due ? fmtDate(line.inbound_due) : 'on a date nobody recorded'}. Receiving
            here mints the serials; it does not change what is still on order.
          </Callout>
        )}
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '110px' }}>
            <FormField label="Units">
              <TextInput type="number" value={qty} onChange={e => setQty(parseInt(e.target.value) || 0)} />
            </FormField>
          </div>
          <div style={{ flex: 1, minWidth: '150px' }}>
            <FormField label="Goods-in reference">
              <TextInput value={grn} onChange={e => setGrn(e.target.value)} placeholder="GRN-202608-001" />
            </FormField>
          </div>
          <div style={{ flex: 1, minWidth: '150px' }}>
            <FormField label="Batch" hint="What a recall is traced by">
              <TextInput value={batch} onChange={e => setBatch(e.target.value)} placeholder="BATCH-202608-4003" />
            </FormField>
          </div>
        </div>
        <div>
          <Btn size="sm" disabled={busy || qty < 1} onClick={() => void receive()}>
            {busy ? 'Receiving…' : `Receive ${fmtInt(qty)} units`}
          </Btn>
        </div>
      </div>
    </SectionCard>
  )
}

/* ---- Finding one ----------------------------------------------------------- */

/** The box support types into when a customer rings holding a handset. They do
    not know whether what they are reading out is a serial, an order or a batch,
    so all of them are tried. */
export function SerialSearch() {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<StockUnit[] | null>(null)
  const [open, setOpen] = useState<StockUnit | null>(null)
  const [busy, setBusy] = useState(false)

  const run = async () => {
    if (q.trim().length < 3) { toast('Three characters at least, or everything matches', 'error'); return }
    setBusy(true)
    setResults(await findUnits(q))
    setBusy(false)
  }

  return (
    <SectionCard title="Find a unit"
                 subtitle="A serial, an order, a customer, a batch or a goods-in reference — whichever of those the person on the phone is holding.">
      <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '240px' }}>
            <FormField label="Search">
              <TextInput value={q} onChange={e => setQ(e.target.value)}
                         onKeyDown={e => { if (e.key === 'Enter') void run() }}
                         placeholder="353404120000002, ORD-771339, Wanjiru Kamau, BATCH-202606-5007" />
            </FormField>
          </div>
          <Btn size="sm" disabled={busy} onClick={() => void run()}>
            <Search size={14} /> {busy ? 'Looking…' : 'Search'}
          </Btn>
          {results !== null && (
            <Btn variant="secondary" size="sm" onClick={() => { setResults(null); setQ('') }}>
              <X size={14} /> Clear
            </Btn>
          )}
        </div>

        {results !== null && (
          <>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {results.length === 0
                ? `Nothing matches that. It looks like ${queryKind(q)}, and no unit on file carries it.`
                : `${fmtInt(results.length)} units match, searched as ${queryKind(q)}.`}
            </p>
            {results.length > 0 && (
              <Table headers={['Serial', 'Product', 'State', 'Where it is', 'Order', '']}>
                {results.map(u => (
                  <tr key={u.serial}>
                    <Td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'var(--text-xs)' }}>{u.serial}</Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{u.product_id}</Td>
                    <Td right><StatusPill status={STATE_TONE[u.state]} label={STATE_LABEL[u.state]} /></Td>
                    <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '300px' }}>{unitStory(u)}</Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{u.order_ref ?? '—'}</Td>
                    <Td right><Btn variant="secondary" size="sm" onClick={() => setOpen(u)}>Open</Btn></Td>
                  </tr>
                ))}
              </Table>
            )}
          </>
        )}
      </div>

      {open && (
        <UnitDetail unit={open} onClose={() => setOpen(null)} onChanged={async () => { await run() }} />
      )}
    </SectionCard>
  )
}

/* Exported for the tests that check the filter without a network. */
export const unitMatches = matches
