import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorTicket } from '../../types'
import { SectionCard, Table, Td, StatusPill, PriorityPill, EmptyState, fmtDateTime } from './shared'
import { TriangleAlert as AlertTriangle, Clock } from 'lucide-react'

export function OperatorTickets() {
  const [tickets, setTickets] = useState<OperatorTicket[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('open')
  const [selected, setSelected] = useState<OperatorTicket | null>(null)

  useEffect(() => {
    supabase.from('operator_tickets').select('*').order('sort_order').then(({ data }) => {
      if (data) setTickets(data as OperatorTicket[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const filtered = filter === 'all' ? tickets : tickets.filter(t => t.status === filter)
  const openCount = tickets.filter(t => t.status === 'open').length
  const breachedCount = tickets.filter(t => t.breached).length
  const escalatedCount = tickets.filter(t => t.escalated).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Tickets & SLA</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {openCount} open · {breachedCount} breached · {escalatedCount} escalated
        </p>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {[
          { id: 'open', label: 'Open', count: openCount },
          { id: 'resolved', label: 'Resolved', count: tickets.filter(t => t.status === 'resolved').length },
          { id: 'all', label: 'All', count: tickets.length },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600,
            background: filter === f.id ? 'var(--brand-navy)' : 'white', color: filter === f.id ? 'white' : 'var(--text-secondary)',
            border: '1px solid var(--border)', cursor: 'pointer',
          }}>{f.label} ({f.count})</button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 400px', gap: '20px' }} className="op-grid-2col">
        <SectionCard title="Ticket Queue" subtitle="SLA clock pauses while waiting on customer">
          {filtered.length === 0 ? <EmptyState message="No tickets in this filter" /> : (
            <Table headers={['Subject', 'Category', 'Priority', 'Status', 'Opened', 'Owner']}>
              {filtered.map(t => (
                <tr key={t.id} onClick={() => setSelected(t)} style={{ cursor: 'pointer', background: selected?.id === t.id ? 'var(--bg-alt)' : 'transparent' }}>
                  <Td>
                    {t.breached && <AlertTriangle size={14} style={{ color: 'var(--danger)', display: 'inline', marginRight: '4px' }} />}
                    {t.escalated && <AlertTriangle size={14} style={{ color: 'var(--warning)', display: 'inline', marginRight: '4px' }} />}
                    {t.subject}
                  </Td>
                  <Td right>{t.category}</Td>
                  <Td right><PriorityPill priority={t.priority} /></Td>
                  <Td right><StatusPill status={t.status} /></Td>
                  <Td right style={{ fontSize: 'var(--text-xs)' }}>{fmtDateTime(t.opened_at)}</Td>
                  <Td right>{t.owner || 'Unassigned'}</Td>
                </tr>
              ))}
            </Table>
          )}
        </SectionCard>

        {/* Ticket detail */}
        <SectionCard title={selected ? 'Ticket Detail' : 'Select a ticket'} subtitle={selected?.id}>
          {selected ? (
            <div style={{ padding: '20px' }}>
              <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)' }}>{selected.subject}</h4>
              <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                <PriorityPill priority={selected.priority} />
                <StatusPill status={selected.status} />
                <span className="pill">{selected.category}</span>
              </div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '12px' }}>
                Opened by {selected.opened_by} · {selected.org} · {fmtDateTime(selected.opened_at)}
              </div>
              {selected.owner && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '4px' }}>Owner: {selected.owner}</div>}
              {selected.breached && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', fontWeight: 600, marginTop: '4px' }}>SLA breached</div>}
              {selected.waiting_on_customer && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--info)', fontWeight: 600, marginTop: '4px' }}><Clock size={12} style={{ display: 'inline' }} /> Waiting on customer</div>}

              <div style={{ marginTop: '16px', borderTop: '1px solid var(--border-light)', paddingTop: '16px' }}>
                <h5 style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase' }}>Conversation</h5>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '12px' }}>
                  {selected.messages.map((m, i) => (
                    <div key={i} style={{
                      padding: '10px 12px', borderRadius: 'var(--radius)',
                      background: m.who === 'System' ? 'var(--bg-alt)' : 'var(--info-bg)',
                    }}>
                      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: m.who === 'System' ? 'var(--text-tertiary)' : 'var(--info)' }}>{m.who} · {m.when}</div>
                      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text)', marginTop: '4px' }}>{m.text}</div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: '16px' }}>
                <textarea
                  placeholder="Reply..."
                  style={{ width: '100%', padding: '10px', borderRadius: 'var(--radius)', border: '1px solid var(--border)', fontSize: 'var(--text-sm)', resize: 'vertical', minHeight: '60px' }}
                />
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                  <button className="btn btn-primary btn-sm">Reply</button>
                  <button className="btn btn-secondary btn-sm">Internal note</button>
                  {selected.status === 'open' && <button className="btn btn-sm" style={{ background: 'var(--success)', color: 'white' }}>Resolve</button>}
                </div>
              </div>
            </div>
          ) : (
            <EmptyState message="Click a ticket to see details" />
          )}
        </SectionCard>
      </div>
    </div>
  )
}
