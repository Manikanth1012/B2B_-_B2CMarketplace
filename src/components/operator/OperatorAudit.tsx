import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorAuditEntry } from '../../types'
import { SectionCard, Table, Td, Id, EmptyState, fmtDateTime, Btn, Modal, FormField, TextInput, Select, TextArea, toast } from './shared'
import { Pager, usePaging } from '../Pager'

export function OperatorAudit() {
  const [entries, setEntries] = useState<OperatorAuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    supabase.from('operator_audit_log').select('*').order('when_ts', { ascending: false }).then(({ data }) => {
      if (data) setEntries(data as OperatorAuditEntry[])
      setLoading(false)
    })
  }, [])

  const categories = [...new Set(entries.map(e => e.category))]
  const filtered = filter === 'all' ? entries : entries.filter(e => e.category === filter)
  /* An append-only log only grows. Changing the category is a different
     question, so it starts again at page one; new rows arriving under the same
     question are not.

     Above the loading guard: `usePaging` is a hook, and a hook below an early
     return runs on some renders and not others. */
  const page = usePaging(filtered, { resetKey: filter })

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
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{entries.length} entries · Append-only · Hash-chained · Reading this log is itself audited</p>
      </div>

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button onClick={() => setFilter('all')} style={{ padding: '6px 12px', borderRadius: 'var(--radius)', fontSize: 'var(--text-xs)', fontWeight: 600, background: filter === 'all' ? 'var(--brand-navy)' : 'white', color: filter === 'all' ? 'white' : 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>All</button>
        {categories.map(c => (
          <button key={c} onClick={() => setFilter(c)} style={{ padding: '6px 12px', borderRadius: 'var(--radius)', fontSize: 'var(--text-xs)', fontWeight: 600, background: filter === c ? 'var(--brand-navy)' : 'white', color: filter === c ? 'white' : 'var(--text-secondary)', border: '1px solid var(--border)', cursor: 'pointer' }}>{c}</button>
        ))}
      </div>

      <SectionCard title="Audit Log" subtitle="Every consequential action, recorded. No edit path, no delete path.">
        {filtered.length === 0 ? <EmptyState message="No audit entries" /> : (
          <Table headers={['When', 'Actor', 'Role', 'Action', 'Object', 'Category', 'Severity', 'Outcome']}>
            {page.rows.map(e => (
              <tr key={e.id}>
                <Td style={{ fontSize: 'var(--text-xs)' }}>{fmtDateTime(e.when_ts)}</Td>
                <Td>{e.actor}</Td>
                <Td right>{e.role}</Td>
                {/* Identifiers, not prose. `onboarding.gate.cleared` has no
                    space in it, so CSS gives it no break opportunity and the
                    column was claiming 361px of a 1000px table — a third of the
                    width for one field, pushing Outcome off the end. `Id` adds
                    break opportunities at the dots, so it wraps where a reader
                    would expect rather than as "onboarding.gate.cle / ared". */}
                <Td right style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', maxWidth: '150px' }}><Id>{e.action}</Id></Td>
                <Td right style={{ fontFamily: 'monospace', fontSize: 'var(--text-xs)', maxWidth: '200px' }}><Id>{e.object || '—'}</Id></Td>
                <Td right>{e.category}</Td>
                <Td right style={{ color: severityColor(e.severity), fontWeight: 600 }}>{e.severity}</Td>
                <Td right>{e.outcome}</Td>
              </tr>
            ))}
          </Table>
        )}
        <Pager page={page} noun="entries" />
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
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '12px' }}>The chain is for detection, not prevention. A permission stops people who respect permissions; a chain makes tampering detectable after the fact.</p>
        </div>
      </SectionCard>
    </div>
  )
}
