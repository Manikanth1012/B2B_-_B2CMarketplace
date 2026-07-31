import { useState, useEffect, useCallback } from 'react'
import { Plus, MessageSquare, Clock, CircleCheck as CheckCircle } from 'lucide-react'
import {
  SectionCard, StatCard, StatusPill, Btn, Modal, FormField, TextInput, TextArea, Select,
  EmptyState, toast, fmtMoney, fmtDate,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import {
  loadPartnerSupport, contactMarketplace, disputeSummary, TOPICS, OUTCOME_LABEL,
} from '../../lib/disputeRepo'
import type { SupportSnapshot, Dispute, PartnerMessage } from '../../lib/disputeRepo'

/* Disputes hold the seller's money until they close, so who owns the next move
   and by when is the substance of the screen. The thread with the desk sits
   alongside rather than inside: a question is not a claim, and merging them
   would make every question look like one.

   Both used to be fiction — one hard-coded dispute shown to every seller, and
   a "Contact the marketplace" button wired to nothing. */

const STATUS_LABEL: Record<Dispute['status'], string> = {
  open: 'Open',
  awaiting_seller: 'Waiting on you',
  awaiting_marketplace: 'With the marketplace',
  resolved: 'Resolved',
  rejected: 'Closed',
}

export function PartnerSupport({ partnerId }: { partnerId: string }) {
  const [snap, setSnap] = useState<SupportSnapshot | null>(null)
  const [contacting, setContacting] = useState<{ ref?: string; subject?: string } | null>(null)
  const [tab, setTab] = useState<'disputes' | 'messages'>('disputes')

  const reload = useCallback(async () => setSnap(await loadPartnerSupport(partnerId)), [partnerId])
  useEffect(() => { void reload() }, [reload])

  if (!snap) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const stats = disputeSummary(snap.disputes)
  const live = snap.disputes.filter(d => !['resolved', 'rejected'].includes(d.status))
  const closed = snap.disputes.filter(d => ['resolved', 'rejected'].includes(d.status))
  const openThreads = snap.messages.filter(m => m.status === 'open')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Disputes and support</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {stats.open} open · ${fmtMoney(stats.held)} held from settlement until they close
          </p>
        </div>
        <Btn variant="primary" onClick={() => setContacting({})}>
          <Plus size={14} /> Contact the marketplace
        </Btn>
      </div>

      {snap.loadError && <Callout tone="danger" title="Some of this page did not load">{snap.loadError}</Callout>}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '12px' }}>
        <StatCard label="Open disputes" value={String(stats.open)}
                  sublabel={live.filter(d => d.owner === 'seller').length > 0
                    ? `${live.filter(d => d.owner === 'seller').length} waiting on you`
                    : 'None waiting on you'}
                  color={live.some(d => d.owner === 'seller') ? 'var(--warning)' : undefined} />
        <StatCard label="Held from settlement" value={`$${fmtMoney(stats.held)}`}
                  sublabel="Released as each one closes" color={stats.held > 0 ? 'var(--danger)' : undefined} />
        <StatCard label="Decided your way"
                  value={stats.wonPct === null ? '—' : `${stats.wonPct}%`}
                  sublabel={`of ${stats.totalClosed} closed`} color="var(--success)" />
        <StatCard label="Open questions" value={String(openThreads.length)}
                  sublabel={openThreads.length === 0 ? 'Nothing awaiting a reply' : 'Awaiting the desk'} />
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {([['disputes', `Disputes (${snap.disputes.length})`], ['messages', `Messages (${snap.messages.length})`]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '8px 15px', borderRadius: 'var(--radius)', cursor: 'pointer',
            fontSize: 'var(--text-sm)', fontWeight: 600, border: '1px solid var(--border)',
            background: tab === id ? 'var(--brand-navy)' : 'white',
            color: tab === id ? 'white' : 'var(--text-secondary)',
          }}>{label}</button>
        ))}
      </div>

      {tab === 'disputes' && (
        <>
          {live.length === 0 ? (
            <Callout tone="success" title="Nothing open">
              No money is being held against you. Anything raised in future appears here with a date on it.
            </Callout>
          ) : live.map(d => (
            <DisputeCard key={d.id} d={d} onRespond={() => setContacting({
              ref: d.id, subject: `Re ${d.id} — ${d.reason}`,
            })} />
          ))}

          {closed.length > 0 && (
            <SectionCard title={`Previously (${closed.length})`}
                         subtitle="How each one ended, and whether it cost you">
              <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '9px' }}>
                {closed.map(d => (
                  <div key={d.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '11px 13px' }}>
                    <div style={{ display: 'flex', gap: '9px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                      <CheckCircle size={13} style={{ color: 'var(--success)', flexShrink: 0 }} />
                      <strong style={{ fontSize: 'var(--text-xs)' }}>{d.reason}</strong>
                      <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                        {d.id} · order {d.order_ref} · {d.buyer} · raised {fmtDate(d.raised)}
                      </span>
                      <span style={{
                        marginLeft: 'auto', fontSize: '10px', fontWeight: 700,
                        color: ['upheld_seller', 'withdrawn'].includes(d.outcome ?? '') ? 'var(--success)' : 'var(--text-secondary)',
                      }}>
                        {OUTCOME_LABEL[d.outcome ?? ''] ?? d.outcome}
                      </span>
                      <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
                        ${fmtMoney(Number(d.amount))} · closed {d.resolved_on ? fmtDate(d.resolved_on) : ''}
                      </span>
                    </div>
                    {d.resolution && (
                      <p style={{ fontSize: '11px', color: 'var(--text-secondary)', margin: '5px 0 0', lineHeight: 1.5 }}>
                        {d.resolution}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </>
      )}

      {tab === 'messages' && (
        <SectionCard title="Your messages to the marketplace"
                     subtitle="Replies arrive here rather than by email, so the thread stays in one place">
          {snap.messages.length === 0 ? (
            <EmptyState message="Nothing raised yet" />
          ) : (
            <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {snap.messages.map(m => <MessageCard key={m.id} m={m} />)}
            </div>
          )}
        </SectionCard>
      )}

      {contacting && (
        <ContactDialog
          partnerId={partnerId}
          prefill={contacting}
          onClose={() => setContacting(null)}
          onSent={async () => { setContacting(null); setTab('messages'); await reload() }}
        />
      )}
    </div>
  )
}

function DisputeCard({ d, onRespond }: { d: Dispute; onRespond: () => void }) {
  const mine = d.owner === 'seller'
  const overdue = d.due_on ? d.due_on < new Date().toISOString().slice(0, 10) : false

  return (
    <SectionCard title={d.reason}
                 subtitle={`${d.id} · order ${d.order_ref} · raised by ${d.buyer} ${fmtDate(d.raised)}`}>
      <div style={{ padding: '16px 20px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <StatusPill status={mine ? 'pending' : 'open'} />
            <span style={{ fontSize: '11px', fontWeight: 700, color: mine ? 'var(--warning)' : 'var(--text-secondary)' }}>
              {STATUS_LABEL[d.status]}
            </span>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>${fmtMoney(Number(d.amount))}</div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>held from settlement</div>
          </div>
        </div>

        {d.detail && (
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '12px 0 0', lineHeight: 1.55 }}>
            {d.detail}
          </p>
        )}

        {/* Whose move, and by when. A dispute where nobody knows whose turn it
            is ages quietly for a month. */}
        <div style={{
          marginTop: '14px', paddingTop: '13px', borderTop: '1px solid var(--border-light)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
        }}>
          <span style={{ fontSize: 'var(--text-xs)', color: overdue ? 'var(--danger)' : 'var(--text-tertiary)' }}>
            <Clock size={11} style={{ display: 'inline', verticalAlign: '-1px', marginRight: '4px' }} />
            {mine
              ? `Your move${d.due_on ? ` — reply by ${fmtDate(d.due_on)}${overdue ? ', which has passed' : ''}` : ''}`
              : `With the marketplace${d.due_on ? ` — expect an answer by ${fmtDate(d.due_on)}` : ''}`}
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <Btn variant="secondary" size="sm" onClick={() => toast('Evidence upload opened')}>Upload evidence</Btn>
            <Btn variant="primary" size="sm" onClick={onRespond}>Respond</Btn>
          </div>
        </div>
      </div>
    </SectionCard>
  )
}

function MessageCard({ m }: { m: PartnerMessage }) {
  const desk = TOPICS.find(t => t.id === m.topic)?.desk ?? 'Marketplace support'
  return (
    <div style={{
      border: `1px solid ${m.status === 'open' ? 'var(--warning)' : 'var(--border)'}`,
      borderRadius: 'var(--radius-md)', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', gap: '9px', alignItems: 'center', padding: '9px 12px', flexWrap: 'wrap',
        background: m.status === 'open' ? 'var(--warning-bg)' : 'var(--bg-alt)',
      }}>
        <MessageSquare size={13} style={{ color: 'var(--text-tertiary)' }} />
        <strong style={{ fontSize: 'var(--text-xs)' }}>{m.subject}</strong>
        {m.priority === 'urgent' && (
          <span style={{ fontSize: '9px', fontWeight: 800, color: 'var(--danger)' }}>URGENT</span>
        )}
        <span style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>
          {desk} · {m.raised_by} · {fmtDate(m.raised_at)}
          {m.ref ? ` · about ${m.ref}` : ''}
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: '10px', fontWeight: 800,
          color: m.status === 'open' ? 'var(--warning)' : m.status === 'answered' ? 'var(--success)' : 'var(--text-tertiary)',
        }}>
          {m.status === 'open' ? 'Awaiting a reply' : m.status}
        </span>
      </div>
      <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: 0, padding: '10px 12px', lineHeight: 1.55 }}>
        {m.body}
      </p>
      {m.answer && (
        <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-light)', background: 'var(--bg-alt)' }}>
          <div style={{ fontSize: '10px', fontWeight: 700, color: 'var(--brand-navy)' }}>
            {m.answered_by}{m.answered_at ? ` · ${fmtDate(m.answered_at)}` : ''}
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', margin: '3px 0 0', lineHeight: 1.55 }}>
            {m.answer}
          </p>
        </div>
      )}
    </div>
  )
}

function ContactDialog({ partnerId, prefill, onClose, onSent }: {
  partnerId: string
  prefill: { ref?: string; subject?: string }
  onClose: () => void
  onSent: () => Promise<void>
}) {
  const [subject, setSubject] = useState(prefill.subject ?? '')
  const [topic, setTopic] = useState<PartnerMessage['topic']>(prefill.ref ? 'dispute' : 'settlement')
  const [body, setBody] = useState('')
  const [urgent, setUrgent] = useState(false)
  const [busy, setBusy] = useState(false)

  const desk = TOPICS.find(t => t.id === topic)?.desk ?? 'Marketplace support'
  const problem = !subject.trim()
    ? 'Give it a subject — it is what the desk sees first.'
    : body.trim().length < 20
    ? 'Say a bit more. A line the desk has to come back and ask about takes two days rather than one.'
    : null

  return (
    <Modal open onClose={onClose} title="Contact the marketplace"
      footer={<>
        <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
        <Btn size="sm" disabled={!!problem || busy} onClick={async () => {
          setBusy(true)
          try {
            const res = await contactMarketplace({
              partnerId, subject, topic, body,
              raisedBy: 'Seller operations', ref: prefill.ref ?? null, urgent,
            })
            if (!res.ok) { toast(res.reason, 'error'); return }
            toast(res.note ?? 'Sent')
            await onSent()
          } finally { setBusy(false) }
        }}>Send</Btn>
      </>}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <Callout tone="info">
          Replies come back here rather than by email, so the whole thread stays against your account.
          Choosing the right subject matters — it decides which desk reads it, and a settlement question
          in a general inbox waits behind everything else.
        </Callout>

        {prefill.ref && (
          <Callout tone="warning">This will be attached to {prefill.ref}, so the desk sees it alongside the dispute.</Callout>
        )}

        <FormField label="What is it about" required hint={`Goes to the ${desk.toLowerCase()}.`}>
          <Select value={topic} onChange={e => setTopic(e.target.value as PartnerMessage['topic'])}>
            {TOPICS.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </Select>
        </FormField>

        <FormField label="Subject" required>
          <TextInput value={subject} onChange={e => setSubject(e.target.value)}
                     placeholder="e.g. Hold on the June statement with no reference" />
        </FormField>

        <FormField label="What you need" required
                   hint="Include the reference and what you have already tried — it is the difference between one reply and three.">
          <TextArea value={body} onChange={e => setBody(e.target.value)} rows={5} />
        </FormField>

        <label style={{ display: 'flex', gap: '7px', alignItems: 'center', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', cursor: 'pointer' }}>
          <input type="checkbox" checked={urgent} onChange={e => setUrgent(e.target.checked)} />
          This is holding up money or an order
        </label>

        {problem && <Callout tone="danger">{problem}</Callout>}
      </div>
    </Modal>
  )
}
