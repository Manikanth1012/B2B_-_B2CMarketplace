import { useState, useEffect, useCallback } from 'react'
import { TriangleAlert as AlertTriangle, Clock, Scale, Gavel, Banknote } from 'lucide-react'
import {
  SectionCard, StatCard, Btn, Modal, FormField, TextArea, toast, fmtMoney, fmtDate,
} from './shared'
import { Callout } from '../OnboardingJourney'
import { loadAllRefunds, escalateRefund, markRefundPaid } from '../../lib/refundRepo'
import type { RefundBook } from '../../lib/refundRepo'
import {
  STATES, REASONS, sla, ownership, summarise, queue, slowSellers, escalationDue,
} from '../../lib/refunds'
import type { Refund } from '../../lib/refunds'
import { DecideModal } from '../partner/PartnerRefunds'

/* The marketplace's view of every refund on the platform.
 *
 * The operator is not here to decide other people's refunds. It is here to
 * watch a clock: a request the seller has stopped answering is a customer the
 * marketplace is failing, whoever's product it was. So the page leads with what
 * is late and with which sellers are letting it happen, and only then with the
 * ones the marketplace has to decide itself.
 */

const ACTOR = 'Marketplace refunds desk'

type Tab = 'attention' | 'mine' | 'all' | 'sellers'

export function OperatorRefunds() {
  const [book, setBook] = useState<RefundBook | null>(null)
  const [tab, setTab] = useState<Tab>('attention')
  const [deciding, setDeciding] = useState<Refund | null>(null)
  const [taking, setTaking] = useState<Refund | null>(null)

  const reload = useCallback(async () => setBook(await loadAllRefunds()), [])
  useEffect(() => { void reload() }, [reload])

  if (!book) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const now = new Date()
  const policy = book.policy
  const stats = summarise(book.refunds, now)
  const ordered = policy ? queue(book.refunds, policy, now) : book.refunds
  const slow = slowSellers(book.refunds, now)

  /* Two different kinds of "needs somebody". A request past its deadline is the
     seller's failure the marketplace has to notice; an escalated one is the
     marketplace's own queue. */
  const late = ordered.filter(r =>
    r.state === 'requested' && policy && sla(r, policy, now).level === 'overdue')
  const mine = ordered.filter(r => ownership(r).owner === 'marketplace' && !STATES[r.state].final)
  const rows = tab === 'attention' ? late : tab === 'mine' ? mine : ordered

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Refunds</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          Every refund on the platform, whoever sold it. {stats.open} open ·
          ${fmtMoney(stats.atStake)} at stake · {stats.overdue} past the answer somebody owes.
        </p>
      </div>

      {book.loadError && <Callout tone="danger" title="Some of this page did not load">{book.loadError}</Callout>}

      {policy && (
        <Callout tone="info" title="How a refund reaches this desk">
          {policy.marketplace_decides_when} {policy.escalation_rule} <strong>{policy.funded_by}</strong>
        </Callout>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <StatCard label="Past the deadline" value={String(stats.overdue)}
                  sublabel={slow.length > 0 ? `across ${slow.length} sellers` : 'Nobody is late'}
                  color={stats.overdue > 0 ? 'var(--danger)' : undefined} />
        <StatCard label="On this desk" value={String(mine.length)}
                  sublabel="Escalated, first-party or bundled"
                  color={mine.length > 0 ? 'var(--warning)' : undefined} />
        <StatCard label="At stake" value={`$${fmtMoney(stats.atStake)}`}
                  sublabel="If every open request is granted" />
        <StatCard label="Refunded to date" value={`$${fmtMoney(stats.refundedValue)}`}
                  sublabel={`across ${stats.decided} decided`} />
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {([
          ['attention', `Past the deadline (${late.length})`],
          ['mine', `This desk decides (${mine.length})`],
          ['sellers', `Sellers not answering (${slow.length})`],
          ['all', `Everything (${book.refunds.length})`],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '8px 15px', borderRadius: 'var(--radius)', cursor: 'pointer',
            fontSize: 'var(--text-sm)', fontWeight: 600, border: '1px solid var(--border)',
            background: tab === id ? 'var(--brand-navy)' : 'white',
            color: tab === id ? 'white' : 'var(--text-secondary)',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'sellers' ? (
        slow.length === 0 ? (
          <Callout tone="success" title="Every seller is answering inside the SLA">
            Nothing is late and nothing has had to be escalated.
          </Callout>
        ) : (
          <SectionCard title="Sellers not answering"
                       subtitle="Ranked by how many customers are waiting on them, not by how many refunds they get">
            <div style={{ padding: '8px 20px 16px' }}>
              {slow.map(s => (
                <div key={s.partner_id} style={{
                  display: 'flex', alignItems: 'center', gap: '14px', flexWrap: 'wrap',
                  padding: '13px 0', borderBottom: '1px solid var(--border-light)',
                }}>
                  <div style={{ flex: 1, minWidth: '200px' }}>
                    <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>{s.seller}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{s.partner_id}</div>
                  </div>
                  <Metric n={s.overdue} label="past the deadline" tone={s.overdue > 0 ? 'var(--danger)' : undefined} />
                  <Metric n={s.escalated} label="already taken from them" tone={s.escalated > 0 ? 'var(--warning)' : undefined} />
                  <div style={{ textAlign: 'right', minWidth: '110px' }}>
                    <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)' }}>${fmtMoney(s.value)}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>customers waiting on</div>
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        )
      ) : rows.length === 0 ? (
        <Callout tone="success" title={tab === 'attention' ? 'Nothing is late' : tab === 'mine' ? 'Nothing on this desk' : 'No refunds on record'}>
          {tab === 'attention'
            ? 'Every open request is still inside the answer its seller owes.'
            : tab === 'mine'
              ? 'Nothing has escalated and nothing first-party is waiting on a decision here.'
              : 'Anything raised in future appears here.'}
        </Callout>
      ) : rows.map(r => (
        <Row key={r.id} refund={r} book={book} now={now}
             onTake={() => setTaking(r)}
             onDecide={() => setDeciding(r)}
             onPay={async () => {
               const res = await markRefundPaid(r, ACTOR)
               toast(res.ok ? (res.note ?? 'Paid') : res.reason, res.ok ? 'success' : 'error')
               await reload()
             }} />
      ))}

      {deciding && (
        <DecideModal refund={deciding} amount={Number(deciding.amount)} as="marketplace" by={ACTOR}
                     onClose={() => setDeciding(null)}
                     onDone={async () => { setDeciding(null); await reload() }} />
      )}

      {taking && policy && (
        <TakeOverModal refund={taking} due={escalationDue(taking, policy, now)}
                       onClose={() => setTaking(null)}
                       onTake={async why => {
                         const res = await escalateRefund({ refund: taking, policy, by: ACTOR, why })
                         toast(res.ok ? (res.note ?? 'Taken') : res.reason, res.ok ? 'success' : 'error')
                         if (res.ok) { setTaking(null); await reload() }
                         return res.ok
                       }} />
      )}
    </div>
  )
}

function Metric({ n, label, tone }: { n: number; label: string; tone?: string }) {
  return (
    <div style={{ textAlign: 'right', minWidth: '150px' }}>
      <div style={{ fontWeight: 700, fontSize: 'var(--text-sm)', color: tone }}>{n}</div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
    </div>
  )
}

function Row({ refund, book, now, onTake, onDecide, onPay }: {
  refund: Refund; book: RefundBook; now: Date
  onTake: () => void; onDecide: () => void; onPay: () => Promise<void>
}) {
  const clock = book.policy ? sla(refund, book.policy, now) : null
  const own = ownership(refund)
  const spec = STATES[refund.state]
  const canTake = refund.state === 'requested' && own.owner === 'seller'
  const canDecideHere = own.owner === 'marketplace' && !spec.final && refund.state !== 'approved'
  const canPay = refund.state === 'approved'

  return (
    <SectionCard
      title={`${refund.item} — $${fmtMoney(Number(refund.amount))}`}
      subtitle={`${refund.id} · ${refund.seller} · ${refund.customer} (${refund.buyer_type}) · ${refund.order_ref} · raised ${fmtDate(refund.requested)}`}
      action={
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: '5px', whiteSpace: 'nowrap',
          padding: '3px 11px', borderRadius: 'var(--radius-full)',
          fontSize: 'var(--text-xs)', fontWeight: 700,
          background: clock?.level === 'overdue' ? 'var(--danger-bg)'
            : refund.state === 'escalated' ? 'var(--warning-bg)'
            : spec.final ? 'var(--bg-alt)' : 'var(--info-bg)',
          color: clock?.level === 'overdue' ? 'var(--danger)'
            : refund.state === 'escalated' ? 'var(--warning)'
            : spec.final ? 'var(--text-tertiary)' : 'var(--info)',
        }}>{spec.label}</span>
      }
    >
      <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '13px' }}>
        {clock && clock.level !== 'settled' && (
          <div style={{
            display: 'flex', alignItems: 'flex-start', gap: '9px', padding: '11px 13px',
            borderRadius: 'var(--radius)',
            background: clock.level === 'overdue' || clock.level === 'gone' ? 'var(--danger-bg)'
              : clock.level === 'today' ? 'var(--warning-bg)' : 'var(--info-bg)',
          }}>
            {clock.level === 'overdue' || clock.level === 'gone'
              ? <AlertTriangle size={15} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '2px' }} />
              : <Clock size={15} style={{ color: 'var(--text-secondary)', flexShrink: 0, marginTop: '2px' }} />}
            <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>{clock.text}</div>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '13px' }}>
          <F label="Why" value={REASONS[refund.reason].label} />
          <F label="Who decides" value={own.owner === 'marketplace' ? 'This desk' : refund.seller} sub={own.because} />
          <F label="Who funds it"
             value={refund.first_party ? 'The marketplace' : refund.seller}
             sub={refund.first_party
               ? 'It sold this itself, so it carries the cost.'
               : 'Recovered from their settlement, whoever decides it.'} />
          {refund.bundle_ref && <F label="Sold inside" value={refund.bundle_ref} />}
        </div>

        {refund.detail && (
          <div style={{ borderLeft: '3px solid var(--border)', paddingLeft: '12px', fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
            “{refund.detail}”
            {refund.evidence && (
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                On the record: {refund.evidence}
              </div>
            )}
          </div>
        )}

        {refund.escalated_why && (
          <Callout tone="warning" title={`Escalated ${fmtDate(refund.escalated_on)}`}>{refund.escalated_why}</Callout>
        )}

        {refund.decision_note && (
          <div style={{ borderLeft: '3px solid var(--border)', paddingLeft: '12px' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              {spec.label} {refund.decided_on ? `on ${fmtDate(refund.decided_on)}` : ''} by {refund.decided_by}
            </div>
            <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
              {refund.decision_note}
              {refund.state === 'partial' && refund.refunded !== null && (
                <strong> ${fmtMoney(Number(refund.refunded))} of ${fmtMoney(Number(refund.amount))} returned.</strong>
              )}
            </div>
          </div>
        )}

        {(canTake || canDecideHere || canPay) && (
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            {canTake && <Btn variant="secondary" size="sm" onClick={onTake}><Gavel size={13} /> Take the decision</Btn>}
            {canDecideHere && <Btn variant="primary" size="sm" onClick={onDecide}><Scale size={13} /> Decide it</Btn>}
            {canPay && <Btn variant="primary" size="sm" onClick={() => void onPay()}><Banknote size={13} /> Mark it paid</Btn>}
          </div>
        )}
      </div>
    </SectionCard>
  )
}

function F({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px', lineHeight: 1.5 }}>{sub}</div>}
    </div>
  )
}

function TakeOverModal({ refund, due, onClose, onTake }: {
  refund: Refund; due: boolean; onClose: () => void; onTake: (why: string) => Promise<boolean>
}) {
  const [why, setWhy] = useState('')
  const [err, setErr] = useState('')

  return (
    <Modal open onClose={onClose} title={`Take this decision from ${refund.seller}`}
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="primary" onClick={async () => {
               setErr('')
               const ok = await onTake(why)
               if (!ok && !due && !why.trim()) setErr('A reason is required to take it early.')
             }}>Take it</Btn>
           </>}>
      <div style={{ marginBottom: '16px' }}>
        <Callout tone={due ? 'warning' : 'danger'}
                 title={due ? 'The clock has run out on this one' : 'The clock has not run out yet'}>
          {due
            ? `${refund.seller} was owed an answer by ${fmtDate(refund.sla_due)} and has not given one. Taking it is what the published rule says happens, so the seller is told rather than asked.`
            : `${refund.seller} still has until ${fmtDate(refund.sla_due)} plus the escalation window. Taking it early is a departure from the published rule, so it needs a reason on the record.`}
        </Callout>
      </div>
      <div style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6, marginBottom: '16px' }}>
        The decision moves to this desk. The money does not: a refund granted against{' '}
        {refund.seller}’s product is still recovered from their settlement, and this reason is what they get
        to argue with.
      </div>
      <FormField label={due ? 'Anything to add (optional)' : 'Why you are taking it early'} required={!due}>
        <TextArea value={why} onChange={e => setWhy(e.target.value)} rows={3}
                  placeholder={due
                    ? 'Leave blank to record the standard reason.'
                    : 'The buyer is an enterprise account under contract and escalated to their account manager.'} />
      </FormField>
      {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600 }}>{err}</div>}
    </Modal>
  )
}
