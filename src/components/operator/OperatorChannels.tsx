import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorChannel } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtMoney } from './shared'

export function OperatorChannels() {
  const [channels, setChannels] = useState<OperatorChannel[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('operator_channels').select('*').order('sort_order').then(({ data }) => {
      if (data) setChannels(data as OperatorChannel[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Channels</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {channels.length} channels · {channels.filter(c => c.enabled).length} enabled · {channels.filter(c => c.is_primary).length} primary
        </p>
      </div>

      <SectionCard title="Channel Master" subtitle="A channel is what the customer experiences; a provider is what carries it.">
        {channels.length === 0 ? <EmptyState message="No channels configured" /> : (
          <Table headers={['Name', 'Type', 'Transport', 'Protocol', 'Sender', 'Throughput', 'Unit Cost', 'Success Rate', 'Receipt', 'Primary', 'Status']}>
            {channels.map(c => (
              <tr key={c.id}>
                <Td>{c.name}</Td>
                <Td right>{c.type}</Td>
                <Td right>{c.transport}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{c.protocol}</Td>
                <Td right>{c.sender}</Td>
                <Td right>{c.throughput}/s</Td>
                <Td right>${fmtMoney(c.unit_cost)}</Td>
                <Td right>{c.success_rate > 0 ? `${c.success_rate}%` : '—'}</Td>
                <Td right>{c.has_receipt ? 'Yes' : <span style={{ color: 'var(--warning)', fontWeight: 600 }}>No</span>}</Td>
                <Td right>{c.is_primary ? <StatusPill status="active" /> : '—'}</Td>
                <Td right><StatusPill status={c.enabled ? 'active' : 'paused'} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      <SectionCard title="Delivery Notes" subtitle="Push has no true delivery receipt — acceptance only, not that a handset displayed anything">
        <div style={{ padding: '20px' }}>
          <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Push success rate is <strong>not averaged</strong> into the platform-wide delivery figure — averaging a measured number with an unmeasurable one produces a number that means nothing.</li>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Hard rejections (invalid number, unsubscribed, blocked) are <strong>never retried</strong> — retrying an invalid number produces three charges and no message.</li>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Failover is automatic after a defined number of attempts on the primary.</li>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>Cost is reported per channel, per message and per thousand.</li>
          </ul>
        </div>
      </SectionCard>
    </div>
  )
}
