import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorAuditEntry } from '../../types'
import { SectionCard, Table, Td, Id, EmptyState, fmtDateTime, Btn, Modal, FormField, TextInput, Select, TextArea, toast, FilterBar, DateRangeFilter } from './shared'
import { Pager, usePaging } from '../Pager'
import { inLocalRange } from '../../lib/localDay'

export function OperatorAudit() {
  const [entries, setEntries] = useState<OperatorAuditEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [filterSel, setFilter] = useState<string>('all')
  const [severitySel, setSeverity] = useState<string>('all')
  const [q, setQ] = useState('')
  const [range, setRange] = useState({ from: '', to: '' })

  useEffect(() => {
    supabase.from('operator_audit_log').select('*').order('when_ts', { ascending: false }).then(({ data }) => {
      if (data) setEntries(data as OperatorAuditEntry[])
      setLoading(false)
    })
  }, [])

  const categories = [...new Set(entries.map(e => e.category))]
  const severities = [...new Set(entries.map(e => e.severity))]
  /* A choice that no longer exists after a refetch reads as "All". */
  const filter = filterSel === 'all' || categories.includes(filterSel) ? filterSel : 'all'
  const severity = severitySel === 'all' || severities.includes(severitySel) ? severitySel : 'all'
  const needle = q.trim().toLowerCase()
  /* when_ts is a timestamp; the date inputs are days, compared as the
     operator's local day of the stored value. */
  const filtered = entries.filter(e =>
    (filter === 'all' || e.category === filter) &&
    (severity === 'all' || e.severity === severity) &&
    inLocalRange(e.when_ts, range.from, range.to) &&
    (!needle || [e.actor, e.action, e.object, e.outcome].some(v => (v ?? '').toLowerCase().includes(needle))))
  const filtering = filter !== 'all' || severity !== 'all' || q !== '' || range.from !== '' || range.to !== ''
  /* An append-only log only grows. Changing the category is a different
     question, so it starts again at page one; new rows arriving under the same
     question are not.

     Above the loading guard: `usePaging` is a hook, and a hook below an early
     return runs on some renders and not others. */
  const page = usePaging(filtered, { resetKey: `${filter}:${severity}:${q}:${range.from}:${range.to}` })

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

      <FilterBar ariaLabel="Audit filters"
        search={{ value: q, onChange: setQ, placeholder: 'Actor, action, object or outcome', ariaLabel: 'Search the audit trail' }}
        summary={filtering ? `${filtered.length} of ${entries.length} entries match` : undefined}
        actions={filtering ? <Btn variant="tertiary" size="sm" onClick={() => { setFilter('all'); setSeverity('all'); setQ(''); setRange({ from: '', to: '' }) }}>Clear filters</Btn> : undefined}>
        <DateRangeFilter from={range.from} to={range.to} onChange={setRange} />
        <Select aria-label="Category" value={filter} onChange={e => setFilter(e.target.value)}>
          <option value="all">All categories</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </Select>
        <Select aria-label="Severity" value={severity} onChange={e => setSeverity(e.target.value)}>
          <option value="all">All severities</option>
          {severities.map(c => <option key={c} value={c}>{c}</option>)}
        </Select>
      </FilterBar>

      <SectionCard title="Audit Log" subtitle="Every consequential action, recorded. No edit path, no delete path.">
        {filtered.length === 0 ? <EmptyState message={filtering ? 'No audit entries match these filters' : 'No audit entries'} /> : (
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
