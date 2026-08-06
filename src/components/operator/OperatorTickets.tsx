import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { CONTENT_FEEDBACK_CATEGORY } from '../../lib/kbRepo'
import type { OperatorTicket } from '../../types'
import { SectionCard, Table, Td, StatusPill, PriorityPill, EmptyState, fmtDateTime, Btn, Modal, FormField, TextInput, TextArea, Select, toast, ConfirmDialog } from './shared'
import { TriangleAlert as AlertTriangle, Clock } from 'lucide-react'
import { AttachmentList } from '../AttachmentList'
import { loadAttachments } from '../../lib/attachmentRepo'
import type { Attachment } from '../../lib/attachments'
import { Pager, usePaging } from '../Pager'
import { resolveTicket, closeOffline, closeUnanswered } from '../../lib/supportRepo'
import { CLOSE_LABEL } from '../../lib/support'

/* `focus` is a ticket id handed over from the dashboard. */
export function OperatorTickets({ focus = null }: { focus?: string | null } = {}) {
  const [tickets, setTickets] = useState<OperatorTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('open')
  const [selected, setSelected] = useState<OperatorTicket | null>(null)
  /* What the customer sent with the complaint. Loaded when a ticket is opened
     rather than with the queue: most tickets have none, and a request per row
     to find that out is a request per row wasted. */
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [reply, setReply] = useState('')
  /* Resolving now asks for the note that the requester reads before agreeing,
     so it needs a state of its own rather than borrowing the reply box. */
  const [resolving, setResolving] = useState(false)
  const [resolution, setResolution] = useState('')
  const [offline, setOffline] = useState(false)
  const [agreedBy, setAgreedBy] = useState('')
  const [addModal, setAddModal] = useState(false)
  const [newTicket, setNewTicket] = useState({ subject: '', category: 'Provisioning', priority: 'P3', opened_by: '', org: '' })

  useEffect(() => {
    supabase.from('support_tickets').select('*').order('sort_order').then(({ data }) => {
      if (data) setTickets(data as OperatorTicket[])
      setLoading(false)
    })
  }, [])

  /* Content feedback is a different kind of work, worked on its own screen and
     never counted against the service SLA. This queue is service-only; the
     filter below narrows the same set rather than a second one.

     Derived above the loading guard, because `usePaging` is a hook: below an
     early return it is called on some renders and not others, and React blanks
     the screen the moment `loading` flips. */
  const service = tickets.filter(t => t.category !== CONTENT_FEEDBACK_CATEGORY)
  const inQueue = service
  const filtered = filter === 'all' ? inQueue : inQueue.filter(t => t.status === filter)
  const page = usePaging(filtered, { resetKey: filter })

  useEffect(() => {
    if (!focus || !tickets.length) return
    const wanted = tickets.find(t => t.id === focus)
    if (wanted) setSelected(wanted)
  }, [focus, tickets])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const openCount = service.filter(t => t.status === 'open').length
  const breachedCount = service.filter(t => t.breached).length

  const refresh = async () => {
    const { data } = await supabase.from('support_tickets').select('*').order('sort_order')
    if (data) setTickets(data as OperatorTicket[])
  }

  const handleReply = async () => {
    if (!selected) return
    if (!reply.trim()) { toast('Reply cannot be empty', 'error'); return }
    const messages = [...selected.messages, { who: 'Operator Admin', when: new Date().toISOString().slice(0, 16).replace('T', ' '), text: reply }]
    await supabase.from('support_tickets').update({ messages, waiting_on_customer: false }).eq('id', selected.id)
    toast('Reply sent')
    setReply('')
    await refresh()
    setSelected({ ...selected, messages })
  }

  /* Resolving is answering, not finishing.
   *
   * This used to write `status: 'resolved'` with no resolution_note, which
   * `support_tickets_resolved_check` has always refused — so the button
   * reported "Ticket resolved" and the row never changed. Now it asks for the
   * note, which is also the thing the requester reads when deciding whether to
   * agree. */
  const handleResolve = async () => {
    if (!selected) return
    if (!resolution.trim()) { toast('Say what resolved it — that is what they read before agreeing', 'error'); return }
    const res = await resolveTicket(selected, resolution, 'Operator Admin')
    if (!res.ok) { toast(res.reason, 'error'); return }
    toast(res.note ?? 'Resolved')
    setResolution(''); setResolving(false)
    await refresh()
    setSelected(null)
  }

  /* An agreement given on the phone. Allowed, and labelled as the desk's own
     word rather than as the customer's click, so a queue closed entirely this
     way is a queue that says so. */
  const handleOffline = async () => {
    if (!selected) return
    const res = await closeOffline(selected, agreedBy, resolution, 'Operator Admin')
    if (!res.ok) { toast(res.reason, 'error'); return }
    toast(res.note ?? 'Closed')
    setAgreedBy(''); setResolution(''); setOffline(false)
    await refresh()
    setSelected(null)
  }

  /* The ones nobody answered inside their window. Names them rather than
     reporting a count, because a sweep you cannot check is a sweep. */
  const handleSweep = async () => {
    const res = await closeUnanswered()
    toast(res.ok ? res.note ?? 'Swept' : res.reason, res.ok ? 'success' : 'error')
    if (res.ok) { await refresh(); setSelected(null) }
  }

  const handleAssign = async (id: string, owner: string) => {
    await supabase.from('support_tickets').update({ owner }).eq('id', id)
    toast(`Assigned to ${owner}`)
    await refresh()
    if (selected) setSelected({ ...selected, owner })
  }

  const handleEscalate = async (id: string) => {
    await supabase.from('support_tickets').update({
      escalated: true, escalated_at: new Date().toISOString(),
    }).eq('id', id)
    toast('Ticket escalated')
    await refresh()
    if (selected) setSelected({ ...selected, escalated: true })
  }

  const handleDelete = async (id: string) => {
    await supabase.from('support_tickets').delete().eq('id', id)
    toast('Ticket deleted')
    await refresh()
    setSelected(null)
  }

  const handleAddTicket = async () => {
    if (!newTicket.subject.trim()) { toast('Subject is required', 'error'); return }
    if (!newTicket.opened_by.trim()) { toast('Opened by is required', 'error'); return }
    const id = `tk-${Date.now()}`
    const sortOrder = tickets.length > 0 ? Math.max(...tickets.map(t => t.sort_order)) + 1 : 0
    await supabase.from('support_tickets').insert({
      id, subject: newTicket.subject, category: newTicket.category, priority: newTicket.priority,
      status: 'open', opened_by: newTicket.opened_by, org: newTicket.org || 'External',
      owner: null, opened_at: new Date().toISOString(), sla_mins: newTicket.priority === 'P1' ? 240 : newTicket.priority === 'P2' ? 480 : 960,
      response_mins: null, resolution_mins: null, breached: false, escalated: false,
      waiting_on_customer: false, messages: [{ who: newTicket.opened_by, when: new Date().toISOString().slice(0, 16).replace('T', ' '), text: newTicket.subject }],
      sort_order: sortOrder,
    })
    toast('Ticket created')
    setNewTicket({ subject: '', category: 'Provisioning', priority: 'P3', opened_by: '', org: '' })
    setAddModal(false)
    await refresh()
  }

  /* Counted off the queue rather than off a stored figure: "closed because
     they agreed" and "closed because nobody replied" are different outcomes
     and a desk measured on their total will always prefer the second. */
  const consent = {
    awaiting: inQueue.filter(t => t.status === 'resolved').length,
    confirmed: inQueue.filter(t => t.closed_how === 'confirmed').length,
    offline: inQueue.filter(t => t.closed_how === 'offline').length,
    auto: inQueue.filter(t => t.closed_how === 'auto').length,
    bounced: inQueue.filter(t => (t.reopened ?? 0) >= 2).length,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Tickets & SLA</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {openCount} open · {breachedCount} breached · {service.filter(t => t.escalated).length} escalated
          </p>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
            {consent.awaiting} waiting on the requester to agree · {consent.confirmed} closed on their word ·{' '}
            {consent.offline} on ours · {consent.auto} unanswered
            {consent.bounced > 0 && ` · ${consent.bounced} sent back more than once`}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {/* The sweep exists because a resolved ticket nobody answers would
              otherwise sit in 'resolved' for ever. It names what it closed. */}
          <Btn variant="secondary" onClick={handleSweep}>Close the unanswered</Btn>
          <Btn onClick={() => setAddModal(true)}>New ticket</Btn>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {[{ id: 'open', label: 'Open', count: inQueue.filter(t => t.status === 'open').length }, { id: 'resolved', label: 'Resolved', count: inQueue.filter(t => t.status === 'resolved').length }, { id: 'all', label: 'All', count: inQueue.length }].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{ padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600, background: filter === f.id ? 'var(--brand-navy)' : 'white', color: filter === f.id ? 'white' : 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>{f.label} ({f.count})</button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '20px' }} className="op-grid-2col">
        <SectionCard title="Ticket Queue" subtitle="SLA clock pauses while waiting on customer">
          {filtered.length === 0 ? <EmptyState message="No tickets in this filter" /> : (
            <Table headers={['Subject', 'Priority', 'Status', 'Owner']}>
              {page.rows.map(t => (
                <tr key={t.id} onClick={() => { setSelected(t); setAttachments([]); void loadAttachments(t.id).then(setAttachments) }} style={{ cursor: 'pointer', background: selected?.id === t.id ? 'var(--bg-alt)' : 'transparent' }}>
                  <Td>
                    {t.breached && <AlertTriangle size={14} style={{ color: 'var(--danger)', display: 'inline', marginRight: '4px' }} />}
                    {t.escalated && <AlertTriangle size={14} style={{ color: 'var(--warning)', display: 'inline', marginRight: '4px' }} />}
                    {t.subject}
                  </Td>
                  <Td right><PriorityPill priority={t.priority} /></Td>
                  <Td right><StatusPill status={t.status} /></Td>
                  <Td right>{t.owner || 'Unassigned'}</Td>
                </tr>
              ))}
            </Table>
          )}
          <Pager page={page} noun="tickets" />
        </SectionCard>

        <SectionCard title={selected ? 'Ticket Detail' : 'Select a ticket'} subtitle={selected?.id}>
          {selected ? (
            <div style={{ padding: '20px' }}>
              <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)' }}>{selected.subject}</h4>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <PriorityPill priority={selected.priority} />
                <StatusPill status={selected.status} />
                <span className="pill">{selected.category}</span>
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '12px' }}>Opened by {selected.opened_by} · {selected.org} · {fmtDateTime(selected.opened_at)}</div>
              {selected.owner && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '4px' }}>Owner: {selected.owner}</div>}
              {selected.breached && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', fontWeight: 600, marginTop: '4px' }}>SLA breached</div>}
              {selected.waiting_on_customer && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--info)', fontWeight: 600, marginTop: '4px' }}><Clock size={12} style={{ display: 'inline' }} /> Waiting on customer</div>}

              {/* Where it stands on the second rung. A resolved ticket is not a
                  finished one — it is one this desk believes it has answered. */}
              {selected.status === 'resolved' && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', fontWeight: 600, marginTop: '4px' }}>
                  Answered — waiting for {selected.opened_by} to agree
                  {selected.confirm_due && ` (until ${fmtDateTime(selected.confirm_due)})`}
                </div>
              )}
              {selected.status === 'closed' && selected.closed_how && (
                <div style={{
                  fontSize: 'var(--text-xs)', marginTop: '4px', fontWeight: 600,
                  color: selected.closed_how === 'auto' ? 'var(--text-tertiary)' : 'var(--success)',
                }}>
                  {CLOSE_LABEL[selected.closed_how]}
                  {selected.confirmed_by && ` — ${selected.confirmed_by}`}
                </div>
              )}
              {(selected.reopened ?? 0) > 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: (selected.reopened ?? 0) >= 2 ? 'var(--danger)' : 'var(--text-tertiary)', marginTop: '4px' }}>
                  Sent back {selected.reopened} time{selected.reopened === 1 ? '' : 's'}
                  {(selected.reopened ?? 0) >= 2 && ' — this was cleared rather than answered'}
                </div>
              )}
              {selected.resolution_note && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '8px', lineHeight: 1.5 }}>
                  <strong>Resolution:</strong> {selected.resolution_note}
                </div>
              )}

              <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-light)', paddingTop: '16px' }}>
                <h5 style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Conversation</h5>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                  {selected.messages.map((m, i) => (
                    <div key={i} style={{ padding: '10px 12px', borderRadius: 'var(--radius)', background: m.who === 'System' ? 'var(--bg-alt)' : 'var(--info-bg)' }}>
                      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: m.who === 'System' ? 'var(--text-tertiary)' : 'var(--info)' }}>{m.who} · {m.when}</div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text)', marginTop: '4px' }}>{m.text}</div>
                    </div>
                  ))}
                </div>
              </div>

              <AttachmentList attachments={attachments} />

              <div style={{ marginTop: '16px' }}>
                <TextArea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to ticket..." />
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                  <Btn size="sm" onClick={handleReply} disabled={!reply.trim()}>Reply</Btn>
                  <Select style={{ width: 'auto', padding: '6px 10px' }} value={selected.owner || ''} onChange={(e) => handleAssign(selected.id, e.target.value)}>
                    <option value="">Assign to...</option>
                    <option>Support Agent</option><option>Finance Team</option><option>Integrations Team</option><option>Catalogue Team</option>
                  </Select>
                  {!selected.escalated && <Btn variant="secondary" size="sm" onClick={() => handleEscalate(selected.id)}>Escalate</Btn>}
                  {(selected.status === 'open' || selected.status === 'new' || selected.status === 'escalated') && (
                    <Btn variant="success" size="sm" onClick={() => { setResolution(reply); setResolving(true) }}>Resolve</Btn>
                  )}
                  {selected.status === 'resolved' && (
                    <Btn variant="secondary" size="sm" onClick={() => setOffline(true)}>They agreed on the phone</Btn>
                  )}
                  <Btn variant="danger" size="sm" onClick={() => handleDelete(selected.id)}>Delete</Btn>
                </div>
              </div>
            </div>
          ) : <EmptyState message="Click a ticket to see details" />}
        </SectionCard>
      </div>

      {/* Resolving. The note is not paperwork — it is what the requester reads
          before deciding whether to agree, which is now a decision they make. */}
      <Modal open={resolving} onClose={() => setResolving(false)} title="Resolve this ticket"
        footer={<>
          <Btn variant="secondary" size="sm" onClick={() => setResolving(false)}>Cancel</Btn>
          <Btn variant="success" size="sm" onClick={handleResolve}>Send it back for confirmation</Btn>
        </>}>
        <FormField label="What resolved it" required
                   hint="This goes to the person who raised it. They confirm it or send it back, and the ticket does not close until one of those happens.">
          <TextArea value={resolution} onChange={(e) => setResolution(e.target.value)}
                    placeholder="e.g. The gateway firmware was two releases behind; updated and both sensors paired." />
        </FormField>
        {selected && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
            {selected.opened_by} gets the window set by the {selected.priority} policy to answer. If nobody
            does, it closes itself and is counted as unanswered rather than as agreed.
          </div>
        )}
      </Modal>

      {/* An agreement given somewhere this system cannot see. Allowed, named. */}
      <Modal open={offline} onClose={() => setOffline(false)} title="They agreed it is resolved"
        footer={<>
          <Btn variant="secondary" size="sm" onClick={() => setOffline(false)}>Cancel</Btn>
          <Btn variant="success" size="sm" onClick={handleOffline}>Record it and close</Btn>
        </>}>
        <FormField label="Who agreed" required
                   hint="A name, not a role. This is recorded as the desk's word rather than as the customer's click, and the queue counts the two separately.">
          <TextInput value={agreedBy} onChange={(e) => setAgreedBy(e.target.value)}
                     placeholder={selected?.opened_by ?? 'e.g. Vikram Shah'} />
        </FormField>
        <FormField label="How they said so" hint="A call, an email, a site visit — enough that somebody reading this later knows it happened.">
          <TextArea value={resolution} onChange={(e) => setResolution(e.target.value)}
                    placeholder="e.g. Confirmed by phone on the number on the account." />
        </FormField>
      </Modal>

      {/* Add ticket modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="New Ticket"
        footer={<><Btn variant="secondary" size="sm" onClick={() => setAddModal(false)}>Cancel</Btn><Btn size="sm" onClick={handleAddTicket}>Create</Btn></>}>
        <FormField label="Subject" required>
          <TextInput value={newTicket.subject} onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })} placeholder="e.g. Order delivery failed" />
        </FormField>
        <div style={{ display: 'flex', gap: '12px' }}>
          <div style={{ flex: 1 }}><FormField label="Category"><Select value={newTicket.category} onChange={(e) => setNewTicket({ ...newTicket, category: e.target.value })}><option>Provisioning</option><option>Billing</option><option>Logistics</option><option>Finance</option><option>Access</option><option>Catalogue</option></Select></FormField></div>
          <div style={{ flex: 1 }}><FormField label="Priority"><Select value={newTicket.priority} onChange={(e) => setNewTicket({ ...newTicket, priority: e.target.value })}><option>P1</option><option>P2</option><option>P3</option><option>P4</option></Select></FormField></div>
        </div>
        <FormField label="Opened by" required>
          <TextInput value={newTicket.opened_by} onChange={(e) => setNewTicket({ ...newTicket, opened_by: e.target.value })} placeholder="Customer or partner name" />
        </FormField>
        <FormField label="Organisation">
          <TextInput value={newTicket.org} onChange={(e) => setNewTicket({ ...newTicket, org: e.target.value })} placeholder="e.g. Consumer, Enterprise" />
        </FormField>
      </Modal>
    </div>
  )
}
