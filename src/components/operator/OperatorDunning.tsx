import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorDunningCase } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtMoney, fmtDate } from './shared'

export function OperatorDunning() {
  const [cases, setCases] = useState<OperatorDunningCase[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('operator_dunning_cases').select('*').order('sort_order').then(({ data }) => {
      if (data) setCases(data as OperatorDunningCase[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const totalOutstanding = cases.reduce((s, c) => s + c.amount, 0)
  const activeCount = cases.filter(c => c.status === 'active').length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Collections</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {activeCount} active cases · ${fmtMoney(totalOutstanding)} outstanding · Service not interrupted until day 14
        </p>
      </div>

      <SectionCard title="Dunning Cases" subtitle="Which ladder a case runs on is resolved from the account, not chosen by a collector">
        {cases.length === 0 ? <EmptyState message="No dunning cases" /> : (
          <Table headers={['Account', 'Type', 'Amount', 'Age', 'Step', 'Step Name', 'Ladder', 'Attempts', 'Reason', 'Promise', 'Status']}>
            {cases.map(c => (
              <tr key={c.id}>
                <Td>{c.account_name}</Td>
                <Td right>{c.account_type}</Td>
                <Td right style={{ fontWeight: 700, color: 'var(--danger)' }}>${fmtMoney(c.amount)}</Td>
                <Td right style={{ color: c.age_days > 30 ? 'var(--danger)' : c.age_days > 14 ? 'var(--warning)' : 'var(--text)' }}>{c.age_days}d</Td>
                <Td right>{c.step}/7</Td>
                <Td right>{c.step_name}</Td>
                <Td right>{c.ladder}</Td>
                <Td right>{c.attempts}</Td>
                <Td right style={{ fontSize: 'var(--text-xs)' }}>{c.reason}</Td>
                <Td right>{c.promise_to_pay ? fmtDate(c.promise_to_pay) : '—'}</Td>
                <Td right><StatusPill status={c.status} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>

      <SectionCard title="Ladder Rules" subtitle="A seller is never suspended — settlement is withheld instead">
        <div style={{ padding: '20px' }}>
          <ul style={{ paddingLeft: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}><strong>Consumer:</strong> suspended at day 14, not before. Involuntary churn costs more than the receivable.</li>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}><strong>Enterprise:</strong> not suspended before day 60 — a missed invoice is usually a PO delay.</li>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}><strong>Seller:</strong> never suspended — taking listings down strands a buyer mid-order. Settlement is withheld instead.</li>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>A promise to pay pauses the ladder where it stands and resumes from there if broken — restarting rewards a broken promise.</li>
            <li style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>A retry against an expired card never succeeds — the system asks for a new instrument.</li>
          </ul>
        </div>
      </SectionCard>
    </div>
  )
}
