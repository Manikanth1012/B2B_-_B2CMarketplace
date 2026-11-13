import { useCallback, useEffect, useMemo, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import { BentoCard } from '../ui/BentoCard'
import { StatusBadge } from '../ui/StatusBadge'
import { Btn, EmptyState, FormField, Modal, Table, Td, TextArea, TextInput, fmtDateTime } from './shared'
import { Callout } from '../OnboardingJourney'
import { useMarket } from '../../lib/MarketContext'
import {
  decideHeldOrder, loadRiskBook, rescoreAccounts, setRiskBands, updateRiskRule,
} from '../../lib/riskRepo'
import type { AccountRiskRow, FlaggedRow, HeldRow, RiskBook, RuleRow } from '../../lib/riskRepo'
import { bandTone, bandsProblem, reasonsLine, ruleEditProblem } from '../../lib/risk'
import type { Bands } from '../../lib/risk'

/* Fraud and risk scoring (spec 13). Orders and accounts are scored by rules the
   marketplace tunes here. A risky order is held before it is fulfilled; this is
   where the marketplace releases it or cancels and refunds it. A buyer or seller
   is only ever told the order is being checked: never a score, never a rule.
   Before the migration the screen says it is not set up yet. */

type Tab = 'held' | 'flagged' | 'accounts' | 'rules'
type Said = { ok: boolean; text: string } | null

const TAB_LABEL: Record<Tab, string> = { held: 'Held', flagged: 'Flagged', accounts: 'Accounts', rules: 'Rules' }

const BAND_LABEL = { low: 'Low', review: 'Review', hold: 'Hold', high: 'High' } as const

export function OperatorRisk() {
  const { fmtIn } = useMarket()
  const [book, setBook] = useState<RiskBook | null>(null)
  const [problem, setProblem] = useState<{ missing: boolean; error: string } | null>(null)
  const [tab, setTab] = useState<Tab>('held')
  const [said, setSaid] = useState<Said>(null)

  const reload = useCallback(async () => {
    const r = await loadRiskBook()
    if (r.ok) { setBook(r.value); setProblem(null) } else setProblem({ missing: r.missing, error: r.error })
  }, [])
  useEffect(() => { void reload() }, [reload])

  const counts: Record<Tab, number | null> = {
    held: book?.held.length ?? null,
    flagged: book?.flagged.length ?? null,
    accounts: book?.accounts.length ?? null,
    rules: book?.rules.length ?? null,
  }

  return (
    <div className="op-risk">
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Risk</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          Orders and accounts are scored by the rules below. An order scoring at the hold threshold is held before it is
          fulfilled until the marketplace releases it or cancels and refunds it. Buyers and sellers are only told an order
          is being checked.
        </p>
      </div>

      {problem?.missing && (
        <Callout tone="info" title="Risk scoring is not set up yet">
          This database does not score orders or accounts yet (the risk migration is not applied), so nothing is held and
          there is nothing to show.
        </Callout>
      )}
      {problem && !problem.missing && (
        <div role="alert" className="op-risk__error">Risk could not be read: {problem.error}</div>
      )}
      {!problem && !book && <p role="status" className="op-risk__note">Loading risk…</p>}

      {book && (
        <BentoCard as="article" headingLevel={2} title={TAB_LABEL[tab]}>
          <div role="tablist" aria-label="Risk" className="op-risk__tabs">
            {(Object.keys(TAB_LABEL) as Tab[]).map(t => (
              <button key={t} type="button" role="tab" id={`op-risk-tab-${t}`} aria-selected={tab === t}
                aria-controls="op-risk-panel" className="op-risk__tab"
                onClick={() => { setTab(t); setSaid(null) }}>
                {TAB_LABEL[t]}{counts[t] !== null ? ` (${counts[t]})` : ''}
              </button>
            ))}
          </div>
          <div id="op-risk-panel" role="tabpanel" aria-labelledby={`op-risk-tab-${tab}`}>
            {said && (
              <p role={said.ok ? 'status' : 'alert'} className={said.ok ? 'op-risk__sent' : 'op-risk__refused'}>{said.text}</p>
            )}
            {tab === 'held' && <HeldTab rows={book.held} fmt={fmtIn} onSaid={setSaid} onChanged={reload} />}
            {tab === 'flagged' && <FlaggedTab rows={book.flagged} fmt={fmtIn} />}
            {tab === 'accounts' && <AccountsTab rows={book.accounts} onSaid={setSaid} onChanged={reload} />}
            {tab === 'rules' && <RulesTab book={book} onSaid={setSaid} onChanged={reload} />}
          </div>
        </BentoCard>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------- held -- */

function HeldTab({ rows, fmt, onSaid, onChanged }: {
  rows: HeldRow[]; fmt: (n: number, c: string) => string
  onSaid: (s: Said) => void; onChanged: () => Promise<void>
}) {
  const [asking, setAsking] = useState<{ row: HeldRow; decision: 'release' | 'cancel' } | null>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  /* Decided from this screen: gone from the list at once, before the re-read. */
  const [gone, setGone] = useState<Set<string>>(new Set())

  const close = () => { setAsking(null); setNote(''); setRefusal(null) }

  const confirm = async () => {
    if (!asking) return
    const text = note.trim()
    if (!text) { setRefusal('Say why. A decision on a held order needs a note.'); return }
    setBusy(true)
    setRefusal(null)
    const { row, decision } = asking
    const res = await decideHeldOrder(row.order_ref, decision, text)
    setBusy(false)
    if (!res.ok) {
      setRefusal(res.error)
      return
    }
    setGone(g => new Set(g).add(row.order_ref))
    onSaid({
      ok: true,
      text: decision === 'release' ? `${row.order_ref} was released.` : `${row.order_ref} was cancelled and refunded.`,
    })
    close()
    void onChanged()
  }

  const shown = rows.filter(r => !gone.has(r.order_ref))
  if (shown.length === 0) return <EmptyState icon={<ShieldAlert size={28} />} message="No order is being held." />

  return (
    <>
      <Table headers={['Order', 'Buyer', { label: 'Amount', align: 'right' }, { label: 'Score', align: 'right' }, 'Why', 'Scored', '']}>
        {shown.map(r => (
          <tr key={r.order_ref}>
            <Td><strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{r.order_ref}</strong></Td>
            <Td>{r.buyer}</Td>
            <Td right>{fmt(r.total, r.currency)}</Td>
            <Td right><StatusBadge tone={bandTone(r.band)}>{r.score}</StatusBadge></Td>
            <Td style={{ maxWidth: '40ch' }}>{reasonsLine(r.reasons)}</Td>
            <Td>{fmtDateTime(r.scored_at)}</Td>
            <Td>
              <div className="op-risk__actions">
                <Btn variant="primary" size="sm" className="op-risk__btn" onClick={() => setAsking({ row: r, decision: 'release' })}>
                  Release<span className="sr-only"> {r.order_ref}</span>
                </Btn>
                <Btn variant="danger" size="sm" className="op-risk__btn" onClick={() => setAsking({ row: r, decision: 'cancel' })}>
                  Cancel and refund<span className="sr-only"> {r.order_ref}</span>
                </Btn>
              </div>
            </Td>
          </tr>
        ))}
      </Table>

      <Modal open={asking !== null} onClose={close}
        title={asking?.decision === 'cancel' ? `Cancel and refund ${asking.row.order_ref}` : `Release ${asking?.row.order_ref ?? ''}`}
        footer={
          <>
            <Btn variant="secondary" size="sm" className="op-risk__btn" onClick={close}>Keep it held</Btn>
            <Btn variant={asking?.decision === 'cancel' ? 'danger' : 'primary'} size="sm" className="op-risk__btn"
              disabled={busy} onClick={() => { void confirm() }}>
              {busy ? 'Working…' : asking?.decision === 'cancel' ? 'Cancel and refund' : 'Release order'}
            </Btn>
          </>
        }>
        <p className="op-risk__sub" style={{ marginTop: 0 }}>
          {asking?.decision === 'cancel'
            ? 'The order is cancelled and the buyer is refunded in full. The note is shown to the buyer and the seller on the refund, so it must not name a rule or a score.'
            : 'The order goes on to be fulfilled as if it had never been held. The note is kept with the decision.'}
        </p>
        <FormField label="Note" required>
          <TextArea rows={3} value={note} onChange={e => setNote(e.target.value)} />
        </FormField>
        {refusal && <p role="alert" className="op-risk__refused">{refusal}</p>}
      </Modal>
    </>
  )
}

/* ---------------------------------------------------------------- flagged -- */

function FlaggedTab({ rows, fmt }: { rows: FlaggedRow[]; fmt: (n: number, c: string) => string }) {
  if (rows.length === 0) return <EmptyState icon={<ShieldAlert size={28} />} message="No order was flagged for review in the last 30 days." />
  return (
    <>
      <p className="op-risk__sub">Orders scored for review (not held) in the last 30 days.</p>
      <Table headers={['Order', 'Buyer', { label: 'Amount', align: 'right' }, { label: 'Score', align: 'right' }, 'Why', 'Scored', 'Order status']}>
        {rows.map(r => (
          <tr key={r.order_ref}>
            <Td><strong style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{r.order_ref}</strong></Td>
            <Td>{r.buyer}</Td>
            <Td right>{fmt(r.total, r.currency)}</Td>
            <Td right><StatusBadge tone={bandTone(r.band)}>{r.score}</StatusBadge></Td>
            <Td style={{ maxWidth: '40ch' }}>{reasonsLine(r.reasons)}</Td>
            <Td>{fmtDateTime(r.scored_at)}</Td>
            <Td>{r.status}</Td>
          </tr>
        ))}
      </Table>
    </>
  )
}

/* --------------------------------------------------------------- accounts -- */

function AccountsTab({ rows, onSaid, onChanged }: {
  rows: AccountRiskRow[]; onSaid: (s: Said) => void; onChanged: () => Promise<void>
}) {
  const [filter, setFilter] = useState<'all' | 'review' | 'high'>('all')
  const [busy, setBusy] = useState(false)
  const sorted = useMemo(() => [...rows].sort((a, b) => b.score - a.score), [rows])
  const shown = sorted.filter(r => filter === 'all' || r.band === filter)
  const n = (b: 'review' | 'high') => rows.filter(r => r.band === b).length

  const rescore = async () => {
    setBusy(true)
    onSaid(null)
    const res = await rescoreAccounts()
    setBusy(false)
    if (!res.ok) { onSaid({ ok: false, text: res.error }); return }
    onSaid({ ok: true, text: `${res.value.scored} accounts scored, ${res.value.review} to review, ${res.value.high} high.` })
    await onChanged()
  }

  return (
    <>
      <div className="op-risk__filters">
        <div role="group" aria-label="Show" className="op-risk__filters">
          {([['all', `All (${rows.length})`], ['review', `Review (${n('review')})`], ['high', `High (${n('high')})`]] as const).map(([f, label]) => (
            <button key={f} type="button" aria-pressed={filter === f} className="op-risk__filter" onClick={() => setFilter(f)}>{label}</button>
          ))}
        </div>
        <Btn variant="secondary" size="sm" className="op-risk__btn" disabled={busy} onClick={() => { void rescore() }}>
          {busy ? 'Scoring…' : 'Rescore now'}
        </Btn>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={<ShieldAlert size={28} />} message={rows.length === 0 ? 'No account has been scored yet.' : 'No account in that band.'} />
      ) : (
        <Table headers={['Account', 'Kind', { label: 'Score', align: 'right' }, 'Band', 'Why', 'Scored']}>
          {shown.map(r => (
            <tr key={`${r.kind}:${r.id}`}>
              <Td><div style={{ fontWeight: 600 }}>{r.name}</div></Td>
              <Td>{r.kind === 'business' ? 'Business' : 'Shopper'}</Td>
              <Td right>{r.score}</Td>
              <Td><StatusBadge tone={bandTone(r.band)}>{BAND_LABEL[r.band]}</StatusBadge></Td>
              <Td style={{ maxWidth: '40ch' }}>{reasonsLine(r.reasons)}</Td>
              <Td>{fmtDateTime(r.scored_at)}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ rules -- */

function RulesTab({ book, onSaid, onChanged }: {
  book: RiskBook; onSaid: (s: Said) => void; onChanged: () => Promise<void>
}) {
  return (
    <>
      {(['order', 'account'] as const).map(kind => (
        <section key={kind} aria-label={kind === 'order' ? 'Order rules' : 'Account rules'} className="op-risk__section">
          <h3 className="op-risk__h">{kind === 'order' ? 'Order rules' : 'Account rules'}</h3>
          <Table headers={['Rule', { label: 'Points', align: 'right' }, 'On', 'Threshold', '']}>
            {book.rules.filter(r => r.applies === kind).map(r => (
              <RuleRowEditor key={r.id} rule={r} onSaid={onSaid} onChanged={onChanged} />
            ))}
          </Table>
          <BandsForm kind={kind} bands={book.bands[kind]} onSaid={onSaid} onChanged={onChanged} />
        </section>
      ))}

      <section aria-label="Recent changes" className="op-risk__section">
        <h3 className="op-risk__h">Recent changes</h3>
        {book.changes.length === 0 ? (
          <p className="op-risk__sub">No rule or band has been changed yet.</p>
        ) : (
          <ul className="op-risk__changes">
            {book.changes.map(c => (
              <li key={c.id}>
                {fmtDateTime(c.at)} · {c.by_name} changed {c.rule_id} {c.field} from {c.was ?? 'nothing'} to {c.now ?? 'nothing'}
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  )
}

function RuleRowEditor({ rule, onSaid, onChanged }: {
  rule: RuleRow; onSaid: (s: Said) => void; onChanged: () => Promise<void>
}) {
  const [points, setPoints] = useState(String(rule.points))
  const [enabled, setEnabled] = useState(rule.enabled)
  const [threshold, setThreshold] = useState(rule.threshold === null ? '' : String(rule.threshold))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Said>(null)
  const needsThreshold = rule.threshold !== null

  const save = async () => {
    setMsg(null)
    onSaid(null)
    const edit = {
      points: points.trim() === '' ? NaN : Number(points),
      threshold: needsThreshold ? (threshold.trim() === '' ? null : Number(threshold)) : null,
      needsThreshold,
    }
    const bad = ruleEditProblem(edit)
    if (bad) { setMsg({ ok: false, text: bad }); return }
    setBusy(true)
    const res = await updateRiskRule(rule.id, { points: edit.points, enabled, threshold: edit.threshold })
    setBusy(false)
    if (!res.ok) { setMsg({ ok: false, text: res.error }); return }
    setMsg({ ok: true, text: 'Saved.' })
    await onChanged()
  }

  return (
    <tr>
      <Td>
        <div style={{ fontWeight: 600 }}>{rule.label}</div>
        <div className="op-risk__sub">{rule.id}</div>
      </Td>
      <Td right>
        <TextInput type="number" inputMode="numeric" aria-label={`Points for ${rule.label}`} value={points}
          onChange={e => setPoints(e.target.value)} style={{ width: '88px' }} />
      </Td>
      <Td>
        <label className="op-risk__toggle">
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
          <span>{enabled ? 'On' : 'Off'}<span className="sr-only"> for {rule.label}</span></span>
        </label>
      </Td>
      <Td>
        {needsThreshold ? (
          <span className="op-risk__thresh">
            <TextInput type="number" inputMode="decimal" aria-label={`Threshold for ${rule.label}`} value={threshold}
              onChange={e => setThreshold(e.target.value)} style={{ width: '104px' }} />
            {rule.unit && <span className="op-risk__sub">{rule.unit}</span>}
          </span>
        ) : <span className="op-risk__sub">None</span>}
      </Td>
      <Td>
        <Btn variant="secondary" size="sm" className="op-risk__btn" disabled={busy} onClick={() => { void save() }}>
          {busy ? 'Saving…' : 'Save'}<span className="sr-only"> {rule.label}</span>
        </Btn>
        {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'op-risk__sent' : 'op-risk__refused'}>{msg.text}</p>}
      </Td>
    </tr>
  )
}

function BandsForm({ kind, bands, onSaid, onChanged }: {
  kind: 'order' | 'account'; bands: Bands; onSaid: (s: Said) => void; onChanged: () => Promise<void>
}) {
  const [review, setReview] = useState(String(bands.review_at))
  const [hold, setHold] = useState(String(bands.hold_at))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Said>(null)
  const upper = kind === 'order' ? 'Hold' : 'High'

  const save = async () => {
    setMsg(null)
    onSaid(null)
    const next = { review_at: review.trim() === '' ? NaN : Number(review), hold_at: hold.trim() === '' ? NaN : Number(hold) }
    const bad = bandsProblem(next)
    if (bad) { setMsg({ ok: false, text: bad }); return }
    setBusy(true)
    const res = await setRiskBands(kind, next)
    setBusy(false)
    if (!res.ok) { setMsg({ ok: false, text: res.error }); return }
    setMsg({ ok: true, text: 'Saved.' })
    await onChanged()
  }

  return (
    <form className="op-risk__bands" onSubmit={e => { e.preventDefault(); void save() }}
      aria-label={kind === 'order' ? 'Order bands' : 'Account bands'}>
      <FormField label={`${kind === 'order' ? 'Order' : 'Account'} Review from`}>
        <TextInput type="number" inputMode="numeric" value={review} onChange={e => setReview(e.target.value)} style={{ width: '104px' }} />
      </FormField>
      <FormField label={`${kind === 'order' ? 'Order' : 'Account'} ${upper} from`}>
        <TextInput type="number" inputMode="numeric" value={hold} onChange={e => setHold(e.target.value)} style={{ width: '104px' }} />
      </FormField>
      <Btn type="submit" variant="secondary" size="sm" className="op-risk__btn" disabled={busy}>
        {busy ? 'Saving…' : `Save ${kind} bands`}
      </Btn>
      {msg && <p role={msg.ok ? 'status' : 'alert'} className={msg.ok ? 'op-risk__sent' : 'op-risk__refused'}>{msg.text}</p>}
    </form>
  )
}
