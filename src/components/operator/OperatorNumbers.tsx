import { useState, useEffect, useCallback } from 'react'
import { Search, X } from 'lucide-react'
import {
  SectionCard, StatCard, Table, Td, StatusPill, EmptyState, Btn, Modal,
  FormField, TextInput, Select, TextArea, toast, fmtInt,
} from './shared'
import { Callout } from '../OnboardingJourney'
import {
  KIND_LABEL, PURPOSE_LABEL, STATE_LABEL, STATE_TONE, ESIM_ORDER, ESIM_LABEL,
  utilisation, blockAlarm, blockLine, heldBy, reusable, lookupKind, estate,
  unreachable, systemLine, esimNext, canMoveProfile, validateAssignment,
} from '../../lib/numbers'
import type {
  RangeUse, HeldNumber, EsimProfile, NumberKind, Purpose, EsimState, NumberRange,
} from '../../lib/numbers'
import {
  loadNumberBook, loadRangeNumbers, findNumbers, loadEstate,
  assignNumber, releaseNumber, suspendNumber, resumeNumber, moveProfile, ageCheck,
} from '../../lib/numbersRepo'
import { withheld, allowed, permits, refusal, shortAnswer, incomplete } from '../../lib/channelRules'
import type { ChannelRule } from '../../lib/channelRules'
import { canHoldANumber, dobLine, sourceLine } from '../../lib/dob'
import type { DobSource } from '../../lib/dob'
import type { NumberBook } from '../../lib/numbersRepo'

/* Numbers and SIMs.
 *
 * The screen is honest about what it is: a query interface over somebody else's
 * inventory. The BSS owns every MSISDN and IMSI, the SIM vendor owns the ICCIDs
 * and the SM-DP+ owns the eSIM profiles. The marketplace holds the blocks it
 * reserved and the numbers it allocated out of them, and it does not hold a row
 * per free number — that would be a second answer to "is this number free"
 * which will disagree with the system that actually knows.
 *
 * Free is arithmetic. Every card that shows it says so.
 */

type Tab = 'blocks' | 'allocated' | 'esim' | 'systems'

const TABS: { id: Tab; label: string }[] = [
  { id: 'blocks', label: 'Blocks' },
  { id: 'allocated', label: 'Who has what' },
  { id: 'esim', label: 'eSIM profiles' },
  { id: 'systems', label: 'Where they come from' },
]

export function OperatorNumbers() {
  const [book, setBook] = useState<NumberBook | null>(null)
  const [all, setAll] = useState<HeldNumber[]>([])
  const [tab, setTab] = useState<Tab>('blocks')
  const [assigning, setAssigning] = useState(false)

  const reload = useCallback(async () => {
    const [b, e] = await Promise.all([loadNumberBook(), loadEstate()])
    setBook(b)
    setAll(e)
  }, [])
  useEffect(() => { void reload() }, [reload])

  if (!book) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const e = estate(all)
  const dark = unreachable(all)
  const alarms = book.use
    .map(u => ({ use: u, alarm: blockAlarm(u) }))
    .filter(x => x.alarm.level !== 'none')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Numbers &amp; SIMs</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {fmtInt(book.ranges.length)} blocks reserved · {fmtInt(e.inUse)} numbers in use
            {' · '}{fmtInt(e.onDevices)} of them fitted to a device
          </p>
        </div>
        <Btn onClick={() => setAssigning(true)}>Assign a number</Btn>
      </div>

      {book.loadError && <Callout tone="danger" title="This did not load">{book.loadError}</Callout>}

      <Callout tone="info" title="This is a query over somebody else's inventory">
        The BSS owns every MSISDN and IMSI, the SIM vendor owns the ICCIDs and the SM-DP+ owns the eSIM
        profiles. The marketplace holds the blocks it reserved and the numbers it allocated out of them —
        it does not hold a row per free number. A second register of what is free would disagree with the
        system that actually knows, and the disagreement would surface as a customer who cannot make a call.
      </Callout>

      {/* A device with a SIM and no number is a device nobody can reach. A
          count of SIMs would report it as connected. */}
      {dark.length > 0 && (
        <Callout tone="danger" title={`${dark.length} devices have a SIM and no number`}>
          {dark.slice(0, 5).map(d => (
            <div key={d.id} style={{ marginTop: '4px' }}>
              {d.device ?? d.stock_serial} on {d.device_order ?? 'an order'} — nothing can reach it.
            </div>
          ))}
          {dark.length > 5 && <div>and {dark.length - 5} more.</div>}
        </Callout>
      )}

      {alarms.filter(a => a.alarm.level === 'danger').map(a => (
        <Callout key={a.use.range_id} tone="danger" title={`${a.use.range_id} needs attention`}>
          {a.alarm.level !== 'none' && a.alarm.why}
        </Callout>
      ))}

      <div className="stat-row">
        <StatCard label="Numbers in use" value={fmtInt(e.inUse)}
                  sublabel={`${fmtInt(e.people)} people · ${fmtInt(e.accounts)} accounts`} />
        <StatCard label="Fitted to a device" value={fmtInt(e.onDevices)}
                  sublabel="IoT SIMs in sensors and gateways that have shipped" />
        <StatCard label="In quarantine" value={fmtInt(e.quarantined)}
                  sublabel="Released, and not reissuable for ninety days"
                  color={e.quarantined ? 'var(--warning)' : undefined} />
        <StatCard label="Blocks needing attention" value={fmtInt(alarms.length)}
                  sublabel={alarms.length ? 'Expiring reservations or nearly full' : 'Every reservation has room and time'}
                  color={alarms.length ? 'var(--warning)' : 'var(--success)'} />
      </div>

      <div style={{ display: 'flex', gap: '4px', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '10px 16px', border: 'none', background: 'none', cursor: 'pointer',
            fontSize: 'var(--text-sm)', fontWeight: tab === t.id ? 700 : 500,
            color: tab === t.id ? 'var(--brand-accent-dark)' : 'var(--text-tertiary)',
            borderBottom: tab === t.id ? '2px solid var(--brand-accent-dark)' : '2px solid transparent',
          }}>{t.label}</button>
        ))}
      </div>

      {tab === 'blocks' && <BlocksTab book={book} />}
      {tab === 'allocated' && <AllocatedTab onChanged={reload} />}
      {tab === 'esim' && <EsimTab book={book} onChanged={reload} />}
      {tab === 'systems' && <SystemsTab book={book} />}

      {assigning && (
        <AssignModal book={book} onClose={() => setAssigning(false)}
                     onDone={async () => { await reload(); setAssigning(false) }} />
      )}
    </div>
  )
}

/* ---- Blocks ---------------------------------------------------------------- */

function BlocksTab({ book }: { book: NumberBook }) {
  const [open, setOpen] = useState<RangeUse | null>(null)
  const rangeOf = (id: string) => book.ranges.find(r => r.id === id)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <SectionCard title="Blocks reserved from the owning systems"
                   subtitle="Utilisation is against what was reserved, never against the block size — a block of 10,000 with 500 reserved and 500 assigned is full.">
        <Table headers={['Block', 'What for', 'Range', 'Reserved', 'Allocated', 'Free', 'Used', 'Reservation', '']}>
          {book.use.map(u => {
            const alarm = blockAlarm(u)
            const r = rangeOf(u.range_id)
            return (
              <tr key={u.range_id}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{u.range_id}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {KIND_LABEL[u.kind]} · {u.market} · {u.system_id}
                  </div>
                </Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{PURPOSE_LABEL[u.purpose]}</Td>
                <Td right style={{ fontSize: '11px', fontFamily: 'ui-monospace, monospace' }}>
                  {u.range_from}<br />{u.range_to}
                </Td>
                <Td right>{fmtInt(u.reserved)}</Td>
                <Td right>
                  {fmtInt(u.reserved - u.free)}
                  {u.quarantine > 0 && (
                    <div style={{ fontSize: '11px', color: 'var(--warning)' }}>
                      {fmtInt(u.quarantine)} in quarantine
                    </div>
                  )}
                </Td>
                <Td right>{fmtInt(u.free)}</Td>
                <Td right style={{
                  fontWeight: 700,
                  color: utilisation(u) >= 95 ? 'var(--danger)' : utilisation(u) >= 80 ? 'var(--warning)' : 'var(--text)',
                }}>{utilisation(u)}%</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>
                  <StatusPill status={u.status === 'active' ? 'active' : u.status === 'expiring' ? 'pending' : 'retired'}
                              label={u.status} />
                  {alarm.level !== 'none' && (
                    <div style={{ color: alarm.level === 'danger' ? 'var(--danger)' : 'var(--warning)', marginTop: '2px', maxWidth: '220px' }}>
                      {alarm.why}
                    </div>
                  )}
                </Td>
                <Td right><Btn variant="secondary" size="sm" onClick={() => setOpen(u)}>Open</Btn></Td>
              </tr>
            )
          })}
        </Table>
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-light)' }}>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
            Free is the reservation less what has been allocated out of it. There is no list of free numbers
            here and there should not be — the owning system holds that, and a copy would be a second answer.
          </p>
        </div>
      </SectionCard>

      {open && <BlockDetail use={open} range={rangeOf(open.range_id) ?? null} onClose={() => setOpen(null)} />}
    </div>
  )
}

function BlockDetail({ use, range, onClose }: {
  use: RangeUse; range: NumberRange | null; onClose: () => void
}) {
  const [rows, setRows] = useState<HeldNumber[] | null>(null)
  useEffect(() => { void loadRangeNumbers(use.range_id).then(setRows) }, [use.range_id])
  const alarm = blockAlarm(use)

  return (
    <Modal open onClose={onClose} title={`${use.range_id} — ${PURPOSE_LABEL[use.purpose]}`}
           footer={<Btn variant="secondary" size="sm" onClick={onClose}>Close</Btn>}>
      {alarm.level !== 'none' && (
        <Callout tone={alarm.level === 'danger' ? 'danger' : 'warning'} title="This reservation needs a decision">
          {alarm.why}
        </Callout>
      )}
      <Callout tone="info" title={`${KIND_LABEL[use.kind]} · ${use.market}`}>
        {blockLine(use)}
        {range?.note && <div style={{ marginTop: '4px' }}>{range.note}</div>}
      </Callout>

      <SectionCard title="What has been allocated out of it">
        {rows === null ? <div style={{ padding: '24px', textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        : rows.length === 0 ? <EmptyState message="Nothing has been allocated out of this block yet" />
        : (
          <>
            <Table headers={['Number', 'State', 'Who or what has it', 'Since', 'Order']}>
              {rows.map(n => (
                <tr key={n.id}>
                  <Td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'var(--text-xs)' }}>{n.value}</Td>
                  <Td right><StatusPill status={STATE_TONE[n.state]} label={STATE_LABEL[n.state]} /></Td>
                  <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '340px' }}>{heldBy(n)}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{n.assigned_on ?? '—'}</Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{n.order_ref ?? '—'}</Td>
                </tr>
              ))}
            </Table>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', padding: '8px 16px' }}>
              Showing {fmtInt(rows.length)} of {fmtInt(use.reserved - use.free)} allocated. The counts come
              from the database, not from this page.
            </p>
          </>
        )}
      </SectionCard>
    </Modal>
  )
}

/* ---- Who has what ---------------------------------------------------------- */

function AllocatedTab({ onChanged }: { onChanged: () => Promise<void> }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState<HeldNumber[] | null>(null)
  const [open, setOpen] = useState<HeldNumber | null>(null)
  const [busy, setBusy] = useState(false)

  const run = useCallback(async (term: string) => {
    if (term.trim().length < 3) { toast('Three characters at least, or everything matches', 'error'); return }
    setBusy(true)
    setRows(await findNumbers(term))
    setBusy(false)
  }, [])

  useEffect(() => { void loadEstate(80).then(setRows) }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <SectionCard title="Find a number"
                   subtitle="A number, an order, a device serial or a name — support does not know which of those the customer is reading out.">
        <div style={{ padding: '14px 20px', display: 'flex', gap: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '260px' }}>
            <FormField label="Search">
              <TextInput value={q} onChange={e => setQ(e.target.value)}
                         onKeyDown={e => { if (e.key === 'Enter') void run(q) }}
                         placeholder="8912345600000, ORD-882091, SKU5007-0000012, SmartBuild" />
            </FormField>
          </div>
          <Btn size="sm" disabled={busy} onClick={() => void run(q)}>
            <Search size={14} /> {busy ? 'Looking…' : 'Search'}
          </Btn>
          {q && (
            <Btn variant="secondary" size="sm"
                 onClick={() => { setQ(''); void loadEstate(80).then(setRows) }}>
              <X size={14} /> Clear
            </Btn>
          )}
          {q.trim().length >= 3 && (
            <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', paddingBottom: '10px' }}>
              Reads as {lookupKind(q) === 'name' ? 'a name' : `a ${lookupKind(q)}`}
            </span>
          )}
        </div>
      </SectionCard>

      <SectionCard title={q ? 'What matches' : 'Most recently allocated'}
                   subtitle="Every number the marketplace has given out, and what is holding it.">
        {rows === null ? <div style={{ padding: '30px', textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
        : rows.length === 0 ? <EmptyState message="Nothing matches that" />
        : (
          <Table headers={['Number', 'Kind', 'What for', 'State', 'Who or what has it', 'Order', '']}>
            {rows.map(n => (
              <tr key={n.id}>
                <Td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'var(--text-xs)' }}>{n.value}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{KIND_LABEL[n.kind]}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{PURPOSE_LABEL[n.purpose]}</Td>
                <Td right><StatusPill status={STATE_TONE[n.state]} label={STATE_LABEL[n.state]} /></Td>
                <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '360px' }}>{heldBy(n)}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{n.order_ref ?? '—'}</Td>
                <Td right><Btn variant="secondary" size="sm" onClick={() => setOpen(n)}>Open</Btn></Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      {open && (
        <NumberDetail n={open} onClose={() => setOpen(null)}
                      onChanged={async () => { await onChanged(); await run(q || open.value) }} />
      )}
    </div>
  )
}

function NumberDetail({ n, onClose, onChanged }: {
  n: HeldNumber; onClose: () => void; onChanged: () => Promise<void>
}) {
  const [why, setWhy] = useState('')
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<{ ok: boolean; note?: string; reason?: string }>) => {
    setBusy(true)
    const r = await fn()
    setBusy(false)
    toast(r.ok ? r.note ?? 'Done' : r.reason ?? 'Refused', r.ok ? 'success' : 'error')
    if (r.ok) { await onChanged(); onClose() }
  }

  const facts: [string, string | null][] = [
    ['Kind', KIND_LABEL[n.kind]],
    ['What for', PURPOSE_LABEL[n.purpose]],
    ['Market', n.market],
    ['Out of block', n.range_id],
    ['Who or what has it', heldBy(n)],
    ['Device', n.device],
    ['Order', n.order_ref ?? n.device_order],
    ['Plan', n.plan],
    ['Paired with', n.paired_with],
    /* The reference the owning system gave back. The marketplace stores it; it
       does not decide the allocation. */
    ['Allocation reference', n.bss_ref],
    ['Assigned', n.assigned_on],
    ['Activated', n.activated_on],
    ['Suspended', n.suspended_on],
    ['Released', n.released_on],
    ['Reusable from', n.reusable_from],
    ['Note', n.note],
  ]

  return (
    <Modal open onClose={onClose} title={n.value}
           footer={<Btn variant="secondary" size="sm" onClick={onClose}>Close</Btn>}>
      <Callout tone={n.state === 'assigned' ? 'info' : 'warning'} title={STATE_LABEL[n.state]}>
        {heldBy(n)}
        {n.state === 'quarantine' && (
          <div style={{ marginTop: '4px' }}>
            {reusable(n)
              ? 'The quarantine has passed and this number can be reissued.'
              : 'Reissuing it before that date would send the last holder’s calls to somebody else.'}
          </div>
        )}
      </Callout>

      <SectionCard title="What we hold about it">
        <Table headers={['', '']}>
          {facts.map(([k, v]) => (
            <tr key={k}>
              <Td style={{ fontWeight: 600, color: 'var(--text-secondary)', width: '38%' }}>{k}</Td>
              {/* Widthed on purpose. `Td right` means "this is a figure" and
                  carries `nowrap` with it, which is right for $41,871.56 and
                  wrong for "Nimbus Occupancy sensor SKU5004-0000001, at Priya
                  Raman, from ORD-881044" — that ran the table past the edge of
                  its own modal and clipped every value in the list. A cell with
                  a width has been told it must wrap, and does. */}
              <Td right style={{ color: v?.trim() ? 'var(--text)' : 'var(--text-tertiary)', fontSize: 'var(--text-sm)', width: '62%' }}>
                {/* Declared, never blank — and an empty string is blank. `??`
                    alone let `market: ''` render as nothing at all, which is
                    the state this line exists to rule out. */}
                {v?.trim() ? v : 'Not recorded'}
              </Td>
            </tr>
          ))}
        </Table>
      </SectionCard>

      {n.state !== 'quarantine' && n.state !== 'released' && (
        <SectionCard title="Change it" subtitle="Suspending keeps the number allocated. Releasing sends it to quarantine for ninety days.">
          <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <FormField label="Why" hint="Somebody reads this when the number comes back round.">
              <TextArea value={why} onChange={e => setWhy(e.target.value)} />
            </FormField>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {n.state === 'assigned' && (
                <Btn variant="secondary" size="sm" disabled={busy}
                     onClick={() => void act(() => suspendNumber(n.id, why))}>Suspend</Btn>
              )}
              {n.state === 'suspended' && (
                <Btn variant="secondary" size="sm" disabled={busy}
                     onClick={() => void act(() => resumeNumber(n.id))}>Put back in service</Btn>
              )}
              <Btn variant="danger" size="sm" disabled={busy}
                   onClick={() => void act(() => releaseNumber(n.id, why))}>Release</Btn>
            </div>
          </div>
        </SectionCard>
      )}
    </Modal>
  )
}

/* ---- eSIM ------------------------------------------------------------------ */

function EsimTab({ book, onChanged }: { book: NumberBook; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null)

  const move = async (p: EsimProfile, to: EsimState) => {
    setBusy(p.iccid)
    const r = await moveProfile(p, to)
    setBusy(null)
    toast(r.ok ? r.note ?? 'Recorded' : r.reason, r.ok ? 'success' : 'error')
    if (r.ok) await onChanged()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <Callout tone="info" title="The SM-DP+ owns these states; this observes them">
        Released, downloaded, installed, enabled, disabled, deleted — the six SGP.22 defines and no others.
        A profile is created released, because claiming it is installed asserts something only the handset
        knows. Recording a change here records what the SM-DP+ reported; it does not cause it. Deleting is
        unrecoverable: the device needs a new profile issued, not this one restored.
      </Callout>

      <SectionCard title="Profiles" subtitle={`${book.esim.length} issued`}>
        {book.esim.length === 0 ? <EmptyState message="No eSIM profiles issued" /> : (
          <Table headers={['ICCID', 'EID', 'Where it has got to', 'SM-DP+', 'Changed', 'Record the next step']}>
            {book.esim.map(p => (
              <tr key={p.iccid}>
                <Td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'var(--text-xs)' }}>{p.iccid}</Td>
                <Td right style={{ fontFamily: 'ui-monospace, monospace', fontSize: '11px', maxWidth: '200px', wordBreak: 'break-all' }}>
                  {p.eid ?? 'Not recorded'}
                </Td>
                <Td right>
                  {/* The ladder, in the standard's order, so the state reads as
                      a position rather than a word. */}
                  <div style={{ display: 'flex', gap: '3px', alignItems: 'center', justifyContent: 'flex-end' }}>
                    {ESIM_ORDER.filter(s => s !== 'deleted').map(s => (
                      <span key={s} title={ESIM_LABEL[s]} style={{
                        width: '10px', height: '10px', borderRadius: '50%',
                        background: ESIM_ORDER.indexOf(s) <= ESIM_ORDER.indexOf(p.state)
                          ? 'var(--success)' : 'var(--gray-100)',
                      }} />
                    ))}
                    <span style={{ fontSize: 'var(--text-xs)', marginLeft: '6px' }}>{ESIM_LABEL[p.state]}</span>
                  </div>
                  {p.note && (
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '2px', maxWidth: '260px' }}>
                      {p.note}
                    </div>
                  )}
                </Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{p.smdp}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{p.changed_on ?? p.released_on}</Td>
                <Td right>
                  <div style={{ display: 'flex', gap: '4px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    {esimNext(p.state).length === 0
                      ? <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Deleted — nothing follows</span>
                      : esimNext(p.state).map(s => (
                        <Btn key={s} variant={s === 'deleted' ? 'danger' : 'secondary'} size="sm"
                             disabled={busy === p.iccid || !canMoveProfile(p.state, s).ok}
                             onClick={() => void move(p, s)}>{ESIM_LABEL[s]}</Btn>
                      ))}
                  </div>
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>
    </div>
  )
}

/* ---- Systems --------------------------------------------------------------- */

function SystemsTab({ book }: { book: NumberBook }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
    <ChannelPolicy rules={book.rules} />
    <SectionCard title="Where these resources come from"
                 subtitle="Each system is authoritative for what it declares and for nothing else.">
      <Table headers={['System', 'Owns', 'Interface', 'State', 'Last heard from']}>
        {book.systems.map(s => (
          <tr key={s.id}>
            <Td>
              <div style={{ fontWeight: 600 }}>{s.name}</div>
              {s.note && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', maxWidth: '380px' }}>{s.note}</div>
              )}
            </Td>
            <Td right style={{ fontSize: 'var(--text-xs)' }}>
              {s.resources.map(r => KIND_LABEL[r as NumberKind] ?? r).join(', ')}
            </Td>
            <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '220px' }}>{s.interface}</Td>
            <Td right>
              <StatusPill status={s.sync_state === 'healthy' ? 'healthy' : s.sync_state === 'degraded' ? 'degraded' : 'rejected'}
                          label={s.sync_state} />
              {/* A degraded system holds reservations rather than confirming
                  them, which is a promise this screen has to state. */}
              {s.sync_state !== 'healthy' && (
                <div style={{ fontSize: '11px', color: 'var(--warning)', marginTop: '2px', maxWidth: '200px' }}>
                  Reservations against it are held, not confirmed.
                </div>
              )}
            </Td>
            <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '280px' }}>{systemLine(s)}</Td>
          </tr>
        ))}
      </Table>
    </SectionCard>
    </div>
  )
}

/* What this channel does with numbers, and what it leaves to another one.
 *
 * Here rather than in a document because this is the screen somebody is on when
 * the question comes up, and because `assign_number` refuses out of these same
 * rows — the policy and the enforcement are one fact, printed once. */
function ChannelPolicy({ rules }: { rules: ChannelRule[] }) {
  const no = withheld(rules)
  const yes = allowed(rules)
  if (rules.length === 0) return null

  return (
    <SectionCard
      title="What this channel does with numbers"
      subtitle="Read by the allocation function as well as by you — a refusal here is the refusal a customer meets.">
      <Table headers={['', 'What', 'Where it is done', 'Why']}>
        {[...no, ...yes].map(r => (
          <tr key={r.id}>
            <Td>
              <StatusPill status={r.decision === 'sold here' ? 'healthy' : 'rejected'}
                          label={r.decision === 'sold here' ? 'here' : 'not here'} />
            </Td>
            <Td>
              <div style={{ fontWeight: 600 }}>{r.label}</div>
              <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono, monospace)' }}>
                {r.id}
              </div>
            </Td>
            <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '200px' }}>
              {shortAnswer(r)}
            </Td>
            <Td right style={{ fontSize: 'var(--text-xs)', maxWidth: '420px', color: 'var(--text-secondary)' }}>
              {r.reason}
              {/* A rule nobody agreed is one that gets reversed by whoever
                  complains loudest, so the desk gets told rather than the log. */}
              {incomplete(r) && (
                <div style={{ color: 'var(--warning)', marginTop: '3px' }}>{incomplete(r)}</div>
              )}
            </Td>
          </tr>
        ))}
      </Table>
    </SectionCard>
  )
}

/* ---- Assigning ------------------------------------------------------------- */

function AssignModal({ book, onClose, onDone }: {
  book: NumberBook; onClose: () => void; onDone: () => Promise<void>
}) {
  const [kind, setKind] = useState<NumberKind>('msisdn')
  const [market, setMarket] = useState('IN')
  const [purpose, setPurpose] = useState<Purpose>('retail')
  const [target, setTarget] = useState<'person' | 'account'>('account')
  const [userId, setUserId] = useState('')
  const [account, setAccount] = useState('')
  const [serial, setSerial] = useState('')
  const [holder, setHolder] = useState('')
  const [order, setOrder] = useState('')
  const [plan, setPlan] = useState('')
  const [busy, setBusy] = useState(false)
  /* Who the number would go to, and how old they are. The database refuses a
     retail number to somebody under 18 in their own name; this is so the desk
     is told before it tries rather than after. */
  const [who, setWho] = useState<{
    name: string | null; dob: string | null; source: string | null
    onNetwork: boolean; networkSince: string | null
  } | null>(null)

  useEffect(() => {
    if (target !== 'person' || userId.trim().length < 30) { setWho(null); return }
    let live = true
    void ageCheck(userId.trim()).then(r => { if (live) setWho(r) })
    return () => { live = false }
  }, [target, userId])

  const age = who ? canHoldANumber(who.dob) : null

  const draft = {
    kind, market, purpose,
    on_network: who?.onNetwork,
    user_id: target === 'person' ? userId || null : null,
    account_id: target === 'account' ? account || null : null,
    stock_serial: serial || null,
  }
  const check = validateAssignment(draft)

  /* And before any of that: is allocating this kind of number something this
     channel does? `assign_number` refuses a retail allocation out of the same
     rows, so the desk finds out here rather than after filling the form in. */
  const barred = purpose === 'retail' && !permits(book.rules, 'retail-line-onboarding')
    ? refusal(book.rules, 'retail-line-onboarding')
    : null

  /* Only the blocks that could actually serve this request. Offering one that
     cannot is offering a number that will not register. */
  const usable = book.use.filter(u =>
    u.kind === kind && u.market === market && u.purpose === purpose
    && u.status !== 'released' && u.free > 0)

  const go = async () => {
    setBusy(true)
    const r = await assignNumber({ ...draft, holder: holder || null, order_ref: order || null, plan: plan || null })
    setBusy(false)
    toast(r.ok ? r.note ?? 'Allocated' : r.reason, r.ok ? 'success' : 'error')
    if (r.ok) await onDone()
  }

  return (
    <Modal open onClose={onClose} title="Assign a number"
           footer={<>
             <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
             <Btn size="sm"
                  disabled={busy || !!barred || !check.ok || usable.length === 0 || (age ? !age.ok : false)}
                  onClick={() => void go()}>
               {busy ? 'Allocating…' : 'Allocate'}
             </Btn>
           </>}>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '140px' }}>
          <FormField label="Resource">
            <Select value={kind} onChange={e => setKind(e.target.value as NumberKind)}>
              {(['msisdn', 'iccid', 'eid'] as const).map(k => (
                <option key={k} value={k}>{KIND_LABEL[k]}</option>
              ))}
            </Select>
          </FormField>
        </div>
        <div style={{ flex: 1, minWidth: '110px' }}>
          <FormField label="Market">
            <Select value={market} onChange={e => setMarket(e.target.value)}>
              {[...new Set(book.ranges.map(r => r.market))].sort().map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </Select>
          </FormField>
        </div>
        <div style={{ flex: 1, minWidth: '160px' }}>
          <FormField label="What for"
                     hint="The blocks are not interchangeable — an M2M number is thirteen digits and will not work in a handset.">
            <Select value={purpose} onChange={e => setPurpose(e.target.value as Purpose)}>
              {(['retail', 'enterprise', 'iot'] as const).map(p => (
                <option key={p} value={p}>{PURPOSE_LABEL[p]}</option>
              ))}
            </Select>
          </FormField>
        </div>
      </div>

      {barred ? (
        /* Ahead of the block check, because "no block can serve that" would
           send somebody off to reserve a block for something this channel is
           not going to sell either way. */
        <Callout tone="danger" title="Not allocated through the marketplace">
          {barred}
          {' '}An existing line can still be recorded against a customer — that is a number self-care already
          gave them, not one issued here.
        </Callout>
      ) : usable.length === 0 ? (
        <Callout tone="danger" title="No block can serve that">
          Nothing is reserved for {PURPOSE_LABEL[purpose].toLowerCase()} {KIND_LABEL[kind].toLowerCase()}s in
          {' '}{market}, or what is reserved is exhausted. Claim a block from the owning system first.
        </Callout>
      ) : (
        <Callout tone="info" title={`Will come out of ${usable[0].range_id}`}>
          {blockLine(usable[0])}
        </Callout>
      )}

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '160px' }}>
          <FormField label="Belongs to"
                     hint="One or the other. A number belonging to both a person and an account belongs to neither.">
            <Select value={target} onChange={e => setTarget(e.target.value as 'person' | 'account')}>
              <option value="account">An account</option>
              <option value="person">A person</option>
            </Select>
          </FormField>
        </div>
        <div style={{ flex: 1, minWidth: '200px' }}>
          {target === 'account' ? (
            <FormField label="Account">
              <TextInput value={account} onChange={e => setAccount(e.target.value)} placeholder="ENT-2007" />
            </FormField>
          ) : (
            <FormField label="Person">
              <TextInput value={userId} onChange={e => setUserId(e.target.value)} placeholder="user id" />
            </FormField>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '200px' }}>
          <FormField label="Fitted to which device"
                     hint="The serial of the sensor or gateway this SIM goes into. Leave blank for a handset.">
            <TextInput value={serial} onChange={e => setSerial(e.target.value)} placeholder="SKU5007-0000012" />
          </FormField>
        </div>
        <div style={{ flex: 1, minWidth: '150px' }}>
          <FormField label="Order">
            <TextInput value={order} onChange={e => setOrder(e.target.value)} placeholder="ORD-882091" />
          </FormField>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: '180px' }}>
          <FormField label="Holder name">
            <TextInput value={holder} onChange={e => setHolder(e.target.value)} />
          </FormField>
        </div>
        <div style={{ flex: 1, minWidth: '180px' }}>
          <FormField label="Plan">
            <TextInput value={plan} onChange={e => setPlan(e.target.value)} placeholder="Aventa IoT Connect" />
          </FormField>
        </div>
      </div>

      {/* The age check, shown against the person rather than only enforced. */}
      {who && purpose === 'retail' && (
        <Callout tone={!who.onNetwork || (age && !age.ok) ? 'danger' : who.dob ? 'info' : 'warning'}
                 title={who.name ?? 'That customer'}>
          {/* On the network at all, before anything about their age. A
              marketplace account is not a subscription, and a number against
              somebody the BSS has never KYC'd is a regulatory problem. */}
          <div>
            {who.onNetwork
              ? `On the network since ${who.networkSince}.`
              : 'A marketplace customer, not a subscriber — no telco identity is linked to this account.'}
          </div>
          <div style={{ marginTop: '4px' }}>
            {who.dob
              ? `${dobLine(who.dob)} · ${sourceLine(who.source as DobSource | null)}`
              : 'No date of birth on file.'}
          </div>
          {age && !age.ok && <div style={{ marginTop: '4px' }}>{age.reason}</div>}
          {age && age.ok && age.note && <div style={{ marginTop: '4px' }}>{age.note}</div>}
        </Callout>
      )}

      {!check.ok && <Callout tone="danger" title="This cannot be allocated yet">{check.reason}</Callout>}
      {check.ok && check.note && <Callout tone="warning" title="Worth checking">{check.note}</Callout>}
    </Modal>
  )
}
