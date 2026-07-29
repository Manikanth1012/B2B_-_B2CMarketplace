import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { OperatorProfile, OperatorTicket, SettlementStatement } from '../../types'
import { StatCard, SectionCard, Table, Td, StatusPill, PriorityPill, fmtMoney, fmtInt, Btn } from './shared'

export function OperatorDashboard() {
  const [profile, setProfile] = useState<OperatorProfile | null>(null)
  const [tickets, setTickets] = useState<OperatorTicket[]>([])
  const [statements, setStatements] = useState<SettlementStatement[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('operator_profile').select('*').maybeSingle(),
      supabase.from('operator_tickets').select('*').order('sort_order'),
      supabase.from('settlement_statements').select('*').eq('status', 'pending').order('sort_order'),
    ]).then(([p, t, s]) => {
      if (p.data) setProfile(p.data as OperatorProfile)
      if (t.data) setTickets(t.data as OperatorTicket[])
      if (s.data) setStatements(s.data as SettlementStatement[])
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!profile) return null

  const openTickets = tickets.filter(t => t.status === 'open')
  const breachedTickets = tickets.filter(t => t.breached)
  const gmvTrendNum = (profile.forecast_gmv - profile.gmv) / profile.gmv * 100
  const gmvTrend = gmvTrendNum.toFixed(1)

  const handleApproveSettlement = async (id: string) => {
    await supabase.from('settlement_statements').update({
      status: 'approved', approved_by: 'Finance Team', approved_at: new Date().toISOString(),
    }).eq('id', id)
    setStatements(prev => prev.filter(s => s.id !== id))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Operator Dashboard</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{profile.operator_name} · Marketplace overview</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
        <StatCard label="Total GMV" value={`$${fmtMoney(profile.gmv)}`} sublabel={`${fmtInt(profile.total_orders)} orders · $${fmtMoney(profile.avg_order_value)} avg`} color="var(--brand-navy)" />
        <StatCard label="Commission" value={`$${fmtMoney(profile.commission)}`} sublabel={`${profile.commission_rate}% blended take`} color="var(--brand-accent-dark)" />
        <StatCard label="Active Partners" value={fmtInt(profile.active_partners)} sublabel={`${profile.pending_applications} pending applications`} />
        <StatCard label="Open Tickets" value={fmtInt(profile.open_tickets)} sublabel={`${profile.sla_breaches} SLA breaches`} color={profile.sla_breaches > 0 ? 'var(--danger)' : undefined} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
        <StatCard label="Settlements Due" value={fmtInt(profile.settlement_due)} sublabel="Awaiting approval" color="var(--warning)" />
        <StatCard label="Refund Requests" value={fmtInt(profile.refund_requests)} sublabel="Pending decision" />
        <StatCard label="Dunning Cases" value={fmtInt(profile.dunning_cases)} sublabel="Active collections" color="var(--danger)" />
        <StatCard label="Churn Risk" value={fmtInt(profile.churn_risk)} sublabel="Accounts flagged" color="var(--warning)" />
      </div>

      <SectionCard title="Revenue Forecast" subtitle={`Linear trend × seasonal index · Backtest error: ${profile.forecast_accuracy}%`}>
        <div style={{ padding: '20px' }}>
          <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Projected GMV</div>
              <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--brand-navy)', marginTop: '4px' }}>${fmtMoney(profile.forecast_gmv)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                {gmvTrendNum > 0 ? <TrendingUp size={14} style={{ color: 'var(--success)' }} /> : <TrendingDown size={14} style={{ color: 'var(--danger)' }} />}
                <span style={{ fontSize: 'var(--text-xs)', color: gmvTrendNum > 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{gmvTrendNum > 0 ? '+' : ''}{gmvTrend}%</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Projected Commission</div>
              <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--brand-accent-dark)', marginTop: '4px' }}>${fmtMoney(profile.forecast_commission)}</div>
            </div>
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '12px' }}>
            Method: linear trend over trailing 6 months adjusted by seasonal index. Planning input, not a board-pack figure. Assumptions: partner mix unchanged, no category launch or withdrawal, no pricing change.
          </p>
        </div>
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }} className="op-grid-2col">
        <SectionCard title="Pending Settlements" subtitle={`${statements.length} awaiting approval`}
          action={statements.length > 0 ? <Btn variant="success" size="sm" onClick={() => statements.forEach(s => handleApproveSettlement(s.id))}>Approve all</Btn> : undefined}
        >
          <Table headers={['Partner', 'Period', 'Gross', 'Net', 'Action']}>
            {statements.slice(0, 5).map(s => (
              <tr key={s.id}>
                <Td>{s.partner_name}</Td>
                <Td right>{s.period}</Td>
                <Td right>${fmtMoney(s.gross)}</Td>
                <Td right>${fmtMoney(s.net)}</Td>
                <Td right><Btn variant="success" size="sm" onClick={() => handleApproveSettlement(s.id)}>Approve</Btn></Td>
              </tr>
            ))}
          </Table>
        </SectionCard>

        <SectionCard title="Open Tickets" subtitle={`${openTickets.length} open · ${breachedTickets.length} breached`}>
          <Table headers={['Subject', 'Priority', 'Status', 'Owner']}>
            {openTickets.slice(0, 5).map(t => (
              <tr key={t.id}>
                <Td>{t.subject}</Td>
                <Td right><PriorityPill priority={t.priority} /></Td>
                <Td right><StatusPill status={t.status} /></Td>
                <Td right>{t.owner || 'Unassigned'}</Td>
              </tr>
            ))}
          </Table>
        </SectionCard>
      </div>
    </div>
  )
}
