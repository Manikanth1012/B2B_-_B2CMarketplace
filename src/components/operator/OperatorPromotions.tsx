import { useState, useEffect } from 'react'
import { supabase } from '../../lib/supabase'
import type { OperatorPromotion } from '../../types'
import { SectionCard, Table, Td, StatusPill, EmptyState, fmtMoney } from './shared'

export function OperatorPromotions() {
  const [promos, setPromos] = useState<OperatorPromotion[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('operator_promotions').select('*').order('sort_order').then(({ data }) => {
      if (data) setPromos(data as OperatorPromotion[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const activeCount = promos.filter(p => p.status === 'active').length
  const pausedCount = promos.filter(p => p.status === 'paused').length
  const totalBudget = promos.reduce((sum, p) => sum + p.budget, 0)
  const totalSpent = promos.reduce((sum, p) => sum + p.spent, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Promotions</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {activeCount} active · {pausedCount} paused · ${fmtMoney(totalSpent)} of ${fmtMoney(totalBudget)} budget used
        </p>
      </div>

      <SectionCard title="Conditional Discount Rules" subtitle="Conditions + effect + budget. Cost floor enforced in the pricing engine.">
        {promos.length === 0 ? <EmptyState message="No promotions configured" /> : (
          <Table headers={['Name', 'Description', 'Effect', 'Value', 'Stacking', 'Priority', 'Budget', 'Spent', 'Status']}>
            {promos.map(p => {
              const pct = p.budget > 0 ? (p.spent / p.budget * 100).toFixed(0) : 0
              return (
                <tr key={p.id}>
                  <Td>{p.name}</Td>
                  <Td>{p.description}</Td>
                  <Td right>{p.effect_type}</Td>
                  <Td right>{p.effect_type === 'percentage' ? `${p.effect_value}%` : p.effect_type === 'fixed' ? `$${fmtMoney(p.effect_value)}` : `${p.effect_value} mo`}</Td>
                  <Td right>{p.stacking ? 'Yes' : 'No'}</Td>
                  <Td right>{p.priority}</Td>
                  <Td right>${fmtMoney(p.budget)}</Td>
                  <Td right style={{ color: Number(pct) > 80 ? 'var(--danger)' : Number(pct) > 50 ? 'var(--warning)' : 'var(--success)' }}>
                    ${fmtMoney(p.spent)} ({pct}%)
                  </Td>
                  <Td right><StatusPill status={p.status} /></Td>
                </tr>
              )
            })}
          </Table>
        )}
      </SectionCard>
    </div>
  )
}
