import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import { CONTENT_FEEDBACK_CATEGORY } from '../../lib/kbRepo'
import type { OperatorTicket } from '../../types'
import { SectionCard, Table, Td, StatusPill, PriorityPill, EmptyState, fmtDateTime, Btn, Modal, FormField, TextInput, TextArea, Select, toast, ConfirmDialog } from './shared'
import { TriangleAlert as AlertTriangle, Clock } from 'lucide-react'

export function OperatorTickets() {
  const [tickets, setTickets] = useState<OperatorTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('open')
  const [queue, setQueue] = useState<'service' | 'feedback'>('service')
  const [selected, setSelected] = useState<OperatorTicket | null>(null)
  const [reply, setReply] = useState('')
  const [addModal, setAddModal] = useState(false)
  const [newTicket, setNewTicket] = useState({ subject: '', category: 'Provisioning', priority: 'P3', opened_by: '', org: '' })

  useEffect(() => {
    supabase.from('support_tickets').select('*').order('sort_order').then(({ data }) => {
      if (data) setTickets(data as OperatorTicket[])
      setLoading(false)
    })
  }, [])

  useEffect(() => {
    setSelected(null)
  }, [queue])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  /* Content feedback is a different kind of work and must not inflate the
     service SLA figures, so the counts below are service-only. */
  const service = tickets.filter(t => t.category !== CONTENT_FEEDBACK_CATEGORY)
  const feedback = tickets.filter(t => t.category === CONTENT_FEEDBACK_CATEGORY)
  const inQueue = queue === 'service' ? service : feedback
  const filtered = filter === 'all' ? inQueue : inQueue.filter(t => t.status === filter)
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

  const handleResolve = async (id: string) => {
    await supabase.from('support_tickets').update({
      status: 'resolved', resolution_mins: 120, owner: 'Operator Admin',
    }).eq('id', id)
    toast('Ticket resolved')
    await refresh()
    setSelected(null)
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Tickets & SLA</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '4px' }}>
            {openCount} open · {breachedCount} breached · {service.filter(t => t.escalated).length} escalated
            {feedback.length > 0 && ` · ${feedback.length} content feedback (counted separately)`}
          </p>
        </div>
        <Btn onClick={() => setAddModal(true)}>New ticket</Btn>
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
        {(['service', 'feedback'] as const).map(qk => (
          <button key={qk} onClick={() => setQueue(qk)} style={{
            padding: '6px 14px', borderRadius: 'var(--radius-full)',
            fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer',
            border: '1px solid var(--border)',
            background: queue === qk ? 'var(--brand-navy)' : 'white',
            color: queue === qk ? 'white' : 'var(--text-secondary)',
          }}>
            {qk === 'service' ? `Service tickets (${service.length})` : `Content feedback (${feedback.length})`}
          </button>
        ))}
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
              {filtered.map(t => (
                <tr key={t.id} onClick={() => setSelected(t)} style={{ cursor: 'pointer', background: selected?.id === t.id ? 'var(--bg-alt)' : 'transparent' }}>
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

              <div style={{ marginTop: '16px' }}>
                <TextArea value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Reply to ticket..." />
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
                  <Btn size="sm" onClick={handleReply} disabled={!reply.trim()}>Reply</Btn>
                  <Select style={{ width: 'auto', padding: '6px 10px' }} value={selected.owner || ''} onChange={(e) => handleAssign(selected.id, e.target.value)}>
                    <option value="">Assign to...</option>
                    <option>Support Agent</option><option>Finance Team</option><option>Integrations Team</option><option>Catalogue Team</option>
                  </Select>
                  {!selected.escalated && <Btn variant="secondary" size="sm" onClick={() => handleEscalate(selected.id)}>Escalate</Btn>}
                  {selected.status === 'open' && <Btn variant="success" size="sm" onClick={() => handleResolve(selected.id)}>Resolve</Btn>}
                  <Btn variant="danger" size="sm" onClick={() => handleDelete(selected.id)}>Delete</Btn>
                </div>
              </div>
            </div>
          ) : <EmptyState message="Click a ticket to see details" />}
        </SectionCard>
      </div>

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
