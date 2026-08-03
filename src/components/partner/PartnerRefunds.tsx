import { useState, useEffect, useCallback } from 'react'
import {
  RotateCcw, TriangleAlert as AlertTriangle, Clock, CircleCheck as CheckCircle,
  CircleX as XCircle, Scale,
} from 'lucide-react'
import {
  SectionCard, StatCard, Btn, Modal, FormField, TextInput, TextArea, Select,
  toast, fmtDate,
} from '../operator/shared'
import { useMarket } from '../../lib/MarketContext'
import { formatGroups } from '../../lib/money'
import { Callout } from '../OnboardingJourney'
import { loadSellerRefunds, decideRefund } from '../../lib/refundRepo'
import type { RefundBook } from '../../lib/refundRepo'
import {
  STATES, REASONS, sla, ownership, fundedBy, summarise, queue, windowFor, canDecide,
} from '../../lib/refunds'
import type { Refund, Decision } from '../../lib/refunds'

/* Refunds a seller is answering.
 *
 * Before this the seller could not see one at all: refunds lived on the
 * customer's account page, visible only to the customer who raised them, with
 * the seller recorded as a piece of free text. So the party whose revenue was
 * being given back had no way to agree, refuse or even know.
 *
 * The queue is ordered by what is late rather than by what is new, because the
 * only refund that costs a seller anything beyond the money is the one they did
 * not answer: after 72 hours the marketplace decides it for them, and the money
 * still comes off their settlement.
 */

const TONE: Record<string, { bg: string; ink: string }> = {
  overdue: { bg: 'var(--danger-bg)', ink: 'var(--danger)' },
  today:   { bg: 'var(--warning-bg)', ink: 'var(--warning)' },
  ok:      { bg: 'var(--info-bg)', ink: 'var(--info)' },
  gone:    { bg: 'var(--danger-bg)', ink: 'var(--danger)' },
  settled: { bg: 'var(--bg-alt)', ink: 'var(--text-tertiary)' },
}

export function PartnerRefunds({ partnerId }: { partnerId: string }) {
  /* A seller trades in whatever markets they are approved for, so their book is
     not in one currency. Every figure is drawn in the currency of the row it
     came from, and the two rollups are grouped rather than added. */
  const { fmtIn } = useMarket()
  const [book, setBook] = useState<RefundBook | null>(null)
  const [deciding, setDeciding] = useState<Refund | null>(null)
  const [tab, setTab] = useState<'open' | 'decided'>('open')

  const reload = useCallback(async () => setBook(await loadSellerRefunds(partnerId)), [partnerId])
  useEffect(() => { void reload() }, [reload])

  if (!book) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const now = new Date()
  const policy = book.policy
  const stats = summarise(book.refunds, now)
  const ordered = policy ? queue(book.refunds, policy, now) : book.refunds
  const open = ordered.filter(r => !STATES[r.state].final)
  const decided = ordered.filter(r => STATES[r.state].final)
  const rows = tab === 'open' ? open : decided

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Refunds</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          What customers have asked to have back, and what you have decided. {stats.open} open ·
          {' '}{formatGroups(stats.atStakeBy, fmtIn)} at stake if every one of them is granted.
        </p>
      </div>

      {book.loadError && <Callout tone="danger" title="Some of this page did not load">{book.loadError}</Callout>}

      {stats.overdue > 0 && policy && (
        <Callout tone="danger" title={`${stats.overdue} past the answer you owe`}>
          {policy.escalation_rule}
        </Callout>
      )}

      {stats.escalated > 0 && (
        <Callout tone="warning" title={`${stats.escalated} the marketplace is now deciding`}>
          These are no longer yours to decide, but they are still yours to fund — a refund the marketplace
          grants against your product is recovered from your settlement. The reason each one was taken is on
          the row.
        </Callout>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <StatCard label="Waiting on you"
                  value={String(open.filter(r => ownership(r).owner === 'seller' && r.state === 'requested').length)}
                  sublabel={stats.overdue > 0 ? `${stats.overdue} already late` : 'None late'}
                  color={stats.overdue > 0 ? 'var(--danger)' : undefined} />
        <StatCard label="At stake" value={formatGroups(stats.atStakeBy, fmtIn)}
                  sublabel="If every open request is granted" />
        <StatCard label="Refunded to date" value={formatGroups(stats.refundedBy, fmtIn)}
                  sublabel={`across ${stats.decided} decided`} />
        <StatCard label="Held" value={stats.heldPct === null ? '—' : `${stats.heldPct}%`}
                  sublabel={stats.heldPct === null ? 'Nothing decided yet' : 'of decided requests refused'}
                  color="var(--success)" />
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {([['open', `Open (${open.length})`], ['decided', `Decided (${decided.length})`]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '8px 15px', borderRadius: 'var(--radius)', cursor: 'pointer',
            fontSize: 'var(--text-sm)', fontWeight: 600, border: '1px solid var(--border)',
            background: tab === id ? 'var(--brand-navy)' : 'white',
            color: tab === id ? 'white' : 'var(--text-secondary)',
          }}>{label}</button>
        ))}
      </div>

      {rows.length === 0 ? (
        <Callout tone="success" title={tab === 'open' ? 'Nothing waiting on you' : 'Nothing decided yet'}>
          {tab === 'open'
            ? 'No customer is waiting for an answer. Anything raised in future appears here with the date it is owed by.'
            : 'Once you decide a refund it stays here with what you wrote against it.'}
        </Callout>
      ) : rows.map(r => (
        <RefundCard key={r.id} refund={r} book={book} now={now}
                    onDecide={() => setDeciding(r)} />
      ))}

      {deciding && policy && (
        <DecideModal refund={deciding} amount={Number(deciding.amount)}
                     onClose={() => setDeciding(null)}
                     onDone={async () => { setDeciding(null); await reload() }} />
      )}
    </div>
  )
}

function RefundCard({ refund, book, now, onDecide }: {
  refund: Refund; book: RefundBook; now: Date; onDecide: () => void
}) {
  const { fmtIn } = useMarket()
  /* The refund's own currency, not the seller's and not the viewer's market. */
  const mny = (n: number) => fmtIn(Number(n), refund.currency)
  const clock = book.policy ? sla(refund, book.policy, now) : null
  const own = ownership(refund)
  const spec = STATES[refund.state]
  const mine = canDecide(refund, 'seller').ok
  const win = windowFor(refund.category_id, book.windows)

  return (
    <SectionCard
      title={`${refund.item} — ${mny(refund.amount)}`}
      subtitle={`${refund.id} · ${refund.customer} · ${refund.order_ref} · raised ${fmtDate(refund.requested)}`}
      action={
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap',
          padding: '3px 11px', borderRadius: 'var(--radius-full)',
          fontSize: 'var(--text-xs)', fontWeight: 700,
          ...(clock ? { background: TONE[clock.level].bg, color: TONE[clock.level].ink }
                    : { background: 'var(--bg-alt)', color: 'var(--text-tertiary)' }),
        }}>{spec.label}</span>
      }
    >
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {clock && clock.level !== 'settled' && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '9px',
            padding: '11px 13px', borderRadius: 'var(--radius)',
            background: TONE[clock.level].bg,
          }}>
            {clock.level === 'overdue' || clock.level === 'gone'
              ? <AlertTriangle size={15} style={{ color: TONE[clock.level].ink, flexShrink: 0, marginTop: '2px' }} />
              : <Clock size={15} style={{ color: TONE[clock.level].ink, flexShrink: 0, marginTop: '2px' }} />}
            <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>{clock.text}</div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px' }}>
          <Fact label="Why" value={REASONS[refund.reason].label} />
          <Fact label="Bought by" value={`${refund.customer} (${refund.buyer_type})`} />
          <Fact label="Who decides" value={own.owner === 'seller' ? 'You' : 'The marketplace'} sub={own.because} />
          {win && <Fact label="Refund window here" value={`${win.days} days`} sub={win.note} />}
        </div>

        {refund.detail && (
          <Quote label="What the customer says">{refund.detail}</Quote>
        )}
        {refund.evidence
          ? <Fact label="On the record" value={refund.evidence} />
          : <div style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', fontWeight: 600 }}>
              Nothing on the record. {REASONS[refund.reason].evidence} would settle it.
            </div>}

        {refund.escalated_why && (
          <Callout tone="warning" title={`Taken by the marketplace on ${fmtDate(refund.escalated_on)}`}>
            {refund.escalated_why} {book.policy ? fundedBy(refund, book.policy) : ''}
          </Callout>
        )}

        {refund.decision_note && (
          <Quote label={`${spec.label} ${refund.decided_on ? `on ${fmtDate(refund.decided_on)}` : ''} by ${refund.decided_by}`}>
            {refund.decision_note}
            {refund.refunded !== null && refund.state === 'partial' && (
              <div style={{ marginTop: '6px', fontWeight: 700 }}>
                {mny(refund.refunded)} of {mny(refund.amount)} returned.
              </div>
            )}
          </Quote>
        )}

        {mine && (
          <div>
            <Btn variant="primary" size="sm" onClick={onDecide}>
              <Scale size={13} /> Decide this
            </Btn>
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px', lineHeight: 1.5 }}>{sub}</div>}
    </div>
  )
}

function Quote({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ borderLeft: '3px solid var(--border)', paddingLeft: '12px' }}>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '3px' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}

/* The decision itself. Shared by the seller's console and the marketplace's, so
   the two cannot write two different shapes of the same decision. */
export function DecideModal({ refund, amount, as = 'seller', by, onClose, onDone }: {
  refund: Refund
  amount: number
  as?: 'seller' | 'marketplace'
  by?: string
  onClose: () => void
  onDone: () => Promise<void>
}) {
  const { fmtIn } = useMarket()
  const mny = (n: number) => fmtIn(Number(n), refund.currency)
  const [decision, setDecision] = useState<Decision>('approve')
  const [partial, setPartial] = useState(String((amount / 2).toFixed(2)))
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const actor = by ?? (as === 'marketplace' ? 'Marketplace refunds desk' : `${refund.seller}`)

  return (
    <Modal open onClose={onClose} title={`Decide ${refund.id}`}
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant={decision === 'decline' ? 'danger' : 'primary'} disabled={saving}
                  onClick={async () => {
                    setSaving(true); setErr('')
                    const r = await decideRefund({
                      refund, decision, refunded: Number(partial) || 0,
                      note, by: actor, as,
                    })
                    setSaving(false)
                    if (!r.ok) { setErr(r.reason); return }
                    toast(r.note ?? 'Decided')
                    await onDone()
                  }}>
               {saving ? 'Saving…'
                 : decision === 'approve' ? `Refund ${mny(amount)}`
                 : decision === 'partial' ? `Refund ${mny(Number(partial) || 0)}`
                 : 'Decline it'}
             </Btn>
           </>}>
      <div style={{ marginBottom: '16px' }}>
        <Callout tone="info" title={`${refund.customer} asked for ${mny(amount)} back on ${fmtDate(refund.requested)}`}>
          {REASONS[refund.reason].label}. {refund.detail ?? ''}
        </Callout>
      </div>

      <FormField label="Your decision">
        <Select value={decision} onChange={e => setDecision(e.target.value as Decision)}>
          <option value="approve">Refund it in full</option>
          <option value="partial">Refund part of it</option>
          <option value="decline">Decline it</option>
        </Select>
      </FormField>

      {decision === 'partial' && (
        <FormField label="How much to return" required
                   hint={`Anything from ${mny(0.01)} to ${mny(amount - 0.01)}. To return all of it, approve instead.`}>
          <TextInput type="number" step="0.01" min="0.01" max={amount - 0.01}
                     value={partial} onChange={e => setPartial(e.target.value)} />
        </FormField>
      )}

      <FormField
        label={decision === 'decline' ? 'Why you are declining' : decision === 'partial' ? 'Explain the difference' : 'A line on why you agree'}
        required
        hint={decision === 'decline'
          ? `The customer reads this. A decline with nothing on it is the one that comes back as a chargeback. ${REASONS[refund.reason].evidence} is what settles this reason.`
          : decision === 'partial'
            ? 'Say what you are keeping back and why. "Refunded three of twelve units, the other nine were kept" is what stops this returning.'
            : 'What the next person reads when the same claim arrives again.'}>
        <TextArea value={note} onChange={e => setNote(e.target.value)} rows={3} />
      </FormField>

      {decision !== 'decline' && (
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
          Agreeing does not move money on its own — it queues the amount back to the instrument that paid, and
          it comes off the next settlement as a deduction with this reference on it.
        </div>
      )}
      {decision === 'decline' && !refund.evidence && !REASONS[refund.reason].provable && (
        <div style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', fontSize: 'var(--text-xs)', color: 'var(--warning)', lineHeight: 1.6 }}>
          <XCircle size={13} style={{ flexShrink: 0, marginTop: '2px' }} />
          <span>
            There is nothing on the record against this claim. A decline the marketplace cannot evidence
            escalates on its own, so this will come straight back.
          </span>
        </div>
      )}
      {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600, marginTop: '12px' }}>{err}</div>}
    </Modal>
  )
}

export { RotateCcw as RefundIcon, CheckCircle }
