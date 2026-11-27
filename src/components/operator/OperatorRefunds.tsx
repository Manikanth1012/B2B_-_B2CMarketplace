import { useState, useEffect, useCallback } from 'react'
import { TriangleAlert as AlertTriangle, Clock, Scale, Gavel, Banknote } from 'lucide-react'
import {
  SectionCard, Btn, Modal, FormField, TextArea, toast, fmtDate, PageHeader, Table, Td,
} from './shared'
import { Tabs } from '../ui/Tabs'
import { KpiCard, KpiRow, groupsToKpi } from '../ui/KpiCard'
import { StatusBadge } from '../ui/StatusBadge'
import { Callout } from '../OnboardingJourney'
import { loadAllRefunds, escalateRefund, markRefundPaid } from '../../lib/refundRepo'
import type { RefundBook } from '../../lib/refundRepo'
import {
  STATES, REASONS, sla, ownership, summarise, queue, slowSellers, escalationDue,
} from '../../lib/refunds'
import type { Refund } from '../../lib/refunds'
import { DecideModal } from '../partner/PartnerRefunds'
import { useMarket } from '../../lib/MarketContext'

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

  /* The marketplace's book spans every market, so nothing here is added up
     across currencies — the rollups are grouped and each row is drawn in the
     money it is in. */
  const { fmtIn } = useMarket()
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
  const atStake = groupsToKpi(stats.atStakeBy, fmtIn)
  const refunded = groupsToKpi(stats.refundedBy, fmtIn)
  const rows = tab === 'attention' ? late : tab === 'mine' ? mine : ordered

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader title="Refunds"
        description={`Every refund on the platform, whoever sold it. ${stats.open} open · ${stats.atStakeBy.length ? stats.atStakeBy.map(g => fmtIn(g.total.amount, g.currency)).join(' · ') : '—'} at stake · ${stats.overdue} past the answer somebody owes.`} />

      {book.loadError && <Callout tone="danger" title="Some of this page did not load">{book.loadError}</Callout>}

      {policy && (
        <Callout tone="info" title="How a refund reaches this desk">
          {policy.marketplace_decides_when} {policy.escalation_rule} <strong>{policy.funded_by}</strong>
        </Callout>
      )}

      <KpiRow label="Refunds summary">
        <KpiCard variant={stats.overdue > 0 ? 'risk' : 'ops'} label="Past the deadline" value={String(stats.overdue)}
                 tone={stats.overdue > 0 ? 'warning' : undefined}
                 status={slow.length > 0 ? `across ${slow.length} sellers` : 'Nobody is late'} />
        <KpiCard variant="ops" label="On this desk" value={String(mine.length)}
                 tone={mine.length > 0 ? 'warning' : undefined}
                 status="Escalated, first-party or bundled" />
        <KpiCard variant="money" label="At stake" value={atStake.value} breakdown={atStake.breakdown}
                 context="If every open request is granted" />
        <KpiCard variant="money" label="Refunded to date" value={refunded.value} breakdown={refunded.breakdown}
                 context={`across ${stats.decided} decided`} />
      </KpiRow>

      <Tabs ariaLabel="Refund views" panelIdPrefix="refunds-panel-" value={tab} onChange={id => setTab(id as Tab)}
        tabs={[
          { id: 'attention', label: 'Past the deadline', count: late.length },
          { id: 'mine', label: 'This desk decides', count: mine.length },
          { id: 'sellers', label: 'Sellers not answering', count: slow.length },
          { id: 'all', label: 'Everything', count: book.refunds.length },
        ]} />

      <div role="tabpanel" id={`refunds-panel-${tab}`} style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {tab === 'sellers' ? (
        slow.length === 0 ? (
          <Callout tone="success" title="Every seller is answering inside the SLA">
            Nothing is late and nothing has had to be escalated.
          </Callout>
        ) : (
          <SectionCard title="Sellers not answering"
                       subtitle="Ranked by how many customers are waiting on them, not by how many refunds they get">
            <Table headers={['Seller', 'Past the deadline', 'Taken from them', 'Customers waiting on']}>
              {slow.map(s => (
                <tr key={s.partner_id}>
                  <Td>
                    <div style={{ fontWeight: 700 }}><span className="c-td__clamp" style={{ WebkitLineClamp: 2 }} title={s.seller}>{s.seller}</span></div>
                    <div className="c-sub">{s.partner_id}</div>
                  </Td>
                  <Td kind="num"><span style={{ fontWeight: 700, color: s.overdue > 0 ? 'var(--danger)' : undefined }}>{s.overdue}</span></Td>
                  <Td kind="num"><span style={{ fontWeight: 700, color: s.escalated > 0 ? 'var(--warning)' : undefined }}>{s.escalated}</span></Td>
                  <Td kind="num">
                    {s.valueBy.map(g => <div key={g.currency} style={{ fontWeight: 700 }}>{fmtIn(g.total.amount, g.currency)}</div>)}
                  </Td>
                </tr>
              ))}
            </Table>
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
      </div>

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

function Row({ refund, book, now, onTake, onDecide, onPay }: {
  refund: Refund; book: RefundBook; now: Date
  onTake: () => void; onDecide: () => void; onPay: () => Promise<void>
}) {
  const { fmtIn } = useMarket()
  const clock = book.policy ? sla(refund, book.policy, now) : null
  const own = ownership(refund)
  const spec = STATES[refund.state]
  const canTake = refund.state === 'requested' && own.owner === 'seller'
  const canDecideHere = own.owner === 'marketplace' && !spec.final && refund.state !== 'approved'
  const canPay = refund.state === 'approved'

  return (
    <SectionCard
      title={`${refund.item} — ${fmtIn(Number(refund.amount), refund.currency)}`}
      subtitle={`${refund.id} · ${refund.seller} · ${refund.customer} (${refund.buyer_type}) · ${refund.order_ref} · raised ${fmtDate(refund.requested)}`}
      action={
        <StatusBadge tone={clock?.level === 'overdue' ? 'danger' : refund.state === 'escalated' ? 'warning' : spec.final ? 'neutral' : 'info'}>
          {spec.label}
        </StatusBadge>
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
              : <Clock size={15} style={{ color: 'var(--slate-600)', flexShrink: 0, marginTop: '2px' }} />}
            <div style={{ lineHeight: 1.5 }}>{clock.text}</div>
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
          <div style={{ borderLeft: '3px solid var(--border)', paddingLeft: '12px', lineHeight: 1.6 }}>
            “{refund.detail}”
            {refund.evidence && (
              <div className="c-sub" style={{ marginTop: '4px' }}>
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
            <div className="c-sub">
              {spec.label} {refund.decided_on ? `on ${fmtDate(refund.decided_on)}` : ''} by {refund.decided_by}
            </div>
            <div style={{ lineHeight: 1.6 }}>
              {refund.decision_note}
              {refund.state === 'partial' && refund.refunded !== null && (
                <strong> {fmtIn(Number(refund.refunded), refund.currency)} of {fmtIn(Number(refund.amount), refund.currency)} returned.</strong>
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
      <div className="c-sub">{label}</div>
      <div style={{ fontWeight: 600 }}>{value}</div>
      {sub && <div className="c-sub" style={{ marginTop: '2px', lineHeight: 1.5 }}>{sub}</div>}
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
      <div style={{ lineHeight: 1.6, marginBottom: '16px' }}>
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
      {err && <div style={{ color: 'var(--danger)', fontWeight: 600 }}>{err}</div>}
    </Modal>
  )
}
