import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { SettlementStatement } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtMoney } from './shared'

export function OperatorSettlement() {
  const [statements, setStatements] = useState<SettlementStatement[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')

  useEffect(() => {
    supabase.from('settlement_statements').select('*').order('sort_order').then(({ data }) => {
      if (data) setStatements(data as SettlementStatement[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const filtered = filter === 'all' ? statements : statements.filter(s => s.status === filter)
  const pendingCount = statements.filter(s => s.status === 'pending').length
  const approvedCount = statements.filter(s => s.status === 'approved').length
  const totalPending = statements.filter(s => s.status === 'pending').reduce((sum, s) => sum + s.net, 0)

  const handleApprove = async (id: string) => {
    await supabase.from('settlement_statements').update({
      status: 'approved',
      approved_by: 'Finance Team',
      approved_at: new Date().toISOString(),
    }).eq('id', id)
    setStatements(prev => prev.map(s => s.id === id ? { ...s, status: 'approved', approved_by: 'Finance Team', approved_at: new Date().toISOString() } : s))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Settlement Runs</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {pendingCount} pending · ${fmtMoney(totalPending)} net payable · {approvedCount} approved
        </p>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        {[
          { id: 'all', label: 'All', count: statements.length },
          { id: 'pending', label: 'Pending', count: pendingCount },
          { id: 'approved', label: 'Approved', count: approvedCount },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            padding: '8px 16px', borderRadius: 'var(--radius)', fontSize: 'var(--text-sm)', fontWeight: 600,
            background: filter === f.id ? 'var(--brand-navy)' : 'white', color: filter === f.id ? 'white' : 'var(--text-secondary)',
            border: '1px solid var(--border)', cursor: 'pointer',
          }}>{f.label} ({f.count})</button>
        ))}
      </div>

      <SectionCard title="Settlement Statements" subtitle="Gross-to-net deduction stack">
        {filtered.length === 0 ? <EmptyState message="No statements in this filter" /> : (
          <Table headers={['Partner', 'Period', 'Gross', 'Commission', 'Fees', 'Refunds', 'Net', 'Orders', 'Status', 'Action']}>
            {filtered.map(s => (
              <tr key={s.id}>
                <Td>{s.partner_name}{s.disputed && <span style={{ fontSize: '10px', color: 'var(--danger)', marginLeft: '4px' }}>disputed</span>}</Td>
                <Td right>{s.period}</Td>
                <Td right>${fmtMoney(s.gross)}</Td>
                <Td right>-${fmtMoney(s.commission)}</Td>
                <Td right>-${fmtMoney(s.fees)}</Td>
                <Td right>-${fmtMoney(s.refunds)}</Td>
                <Td right style={{ fontWeight: 700 }}>${fmtMoney(s.net)}</Td>
                <Td right>{s.order_count}</Td>
                <Td right><StatusPill status={s.status} /></Td>
                <Td right>
                  {s.status === 'pending' ? (
                    <button onClick={() => handleApprove(s.id)} className="btn btn-sm" style={{ background: 'var(--success)', color: 'white' }}>Approve</button>
                  ) : (
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{s.approved_by}</span>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        )}
      </SectionCard>
    </div>
  )
}
