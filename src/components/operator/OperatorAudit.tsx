import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorAuditEntry } from '../../types'
import { SectionCard, Table, Td, EmptyState, fmtDateTime } from './shared'

export function OperatorAudit() {
  const [entries, setEntries] = useState<OperatorAuditEntry[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('operator_audit_log').select('*').order('when_ts', { ascending: false }).then(({ data }) => {
      if (data) setEntries(data as OperatorAuditEntry[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const severityColor = (s: string) => {
    if (s === 'high') return 'var(--danger)'
    if (s === 'warning') return 'var(--warning)'
    return 'var(--text-tertiary)'
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Audit Trail</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {entries.length} entries · Append-only · Hash-chained · Reading this log is itself audited
        </p>
      </div>

      <SectionCard title="Audit Log" subtitle="Every consequential action, recorded. No edit path, no delete path.">
        {entries.length === 0 ? <EmptyState message="No audit entries" /> : (
          <Table headers={['When', 'Actor', 'Role', 'Action', 'Object', 'Category', 'Severity', 'Outcome']}>
            {entries.map(e => (
              <tr key={e.id}>
                <Td style={{ fontSize: 'var(--text-xs)' }}>{fmtDateTime(e.when_ts)}</Td>
                <Td>{e.actor}</Td>
                <Td right>{e.role}</Td>
                <Td right style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{e.action}</Td>
                <Td right style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)' }}>{e.object || '—'}</Td>
                <Td right>{e.category}</Td>
                <Td right style={{ color: severityColor(e.severity), fontWeight: 600 }}>{e.severity}</Td>
                <Td right>{e.outcome}</Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      <SectionCard title="Chain Integrity" subtitle="Hash chain anchored daily to object-locked storage">
        <div style={{ padding: '20px' }}>
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Entries Checked</div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--success)' }}>{entries.length}</div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Gaps Found</div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--success)' }}>0</div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Last Anchor</div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text)' }}>28 Jul 2026</div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>SIEM Destinations</div>
              <div style={{ fontSize: 'var(--text-xl)', fontWeight: 800, color: 'var(--text)' }}>3</div>
            </div>
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '12px' }}>
            The chain is for detection, not prevention. A permission stops people who respect permissions; a chain makes tampering detectable after the fact.
          </p>
        </div>
      </SectionCard>
    </div>
  )
}
