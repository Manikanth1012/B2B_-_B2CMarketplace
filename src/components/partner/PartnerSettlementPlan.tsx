import { FileText, Download, TrendingUp, Calendar, Clock, PieChart } from 'lucide-react'
import { StatCard, SectionCard, Table, Td, StatusPill, fmtMoney, Btn, toast } from '../operator/shared'
import { PARTNER_PLAN, PARTNER_ORDERS } from './data'

export function PartnerSettlementPlan() {
  const gmv = PARTNER_ORDERS.reduce((a, o) => a + o.gross, 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Settlement Plan</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {PARTNER_PLAN.name} · {PARTNER_PLAN.model} · applies to every listing you sell
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Btn variant="secondary" onClick={() => toast('Schedule downloaded')}><Download size={14} /> Download schedule</Btn>
          <Btn variant="primary" onClick={() => toast('Tier review requested — reference TRV-118')}>Request a tier review</Btn>
        </div>
      </div>

      <div style={{
        padding: '14px 18px', borderRadius: 'var(--radius-md)',
        background: 'var(--info-bg)', border: '1px solid var(--info)',
        fontSize: 'var(--text-sm)', color: 'var(--info)',
      }}>
        Commission is set by your plan, not by individual listings. Tiers are applied to trailing twelve-month gross value and are recalculated on the first of each month.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
        <StatCard label="Current rate" value={`${PARTNER_PLAN.base}%`} sublabel={PARTNER_PLAN.model} />
        <StatCard label="Trailing GMV" value={`$${fmtMoney(gmv)}`} sublabel="Rolling 12 months" color="var(--brand-navy)" />
        <StatCard label="Payout cycle" value={PARTNER_PLAN.cycle.split(',')[0]} sublabel={PARTNER_PLAN.cycle.split(',')[1] || ''} />
        <StatCard label="Holdback" value={PARTNER_PLAN.hold === 'None' ? 'None' : PARTNER_PLAN.hold.split('(')[0]} sublabel="Protects against returns" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }} className="op-grid-2col">
        <SectionCard title="Commission Tiers" subtitle="Trailing 12-month gross value determines your rate">
          <Table headers={['Trailing 12-month gross', 'Commission', 'You keep', 'State']}>
            {PARTNER_PLAN.tiers.map((t, i) => {
              const next = PARTNER_PLAN.tiers[i + 1]
              const active = gmv >= t.from && (!next || gmv < next.from)
              return (
                <tr key={i} style={active ? { background: 'var(--bg-alt)' } : undefined}>
                  <Td>
                    {t.from === 0 ? `Up to $${fmtMoney(next ? next.from : 0)}`
                      : next ? `$${fmtMoney(t.from)} to $${fmtMoney(next.from)}`
                      : `Above $${fmtMoney(t.from)}`}
                  </Td>
                  <Td right>{t.rate}%</Td>
                  <Td right>{(100 - t.rate).toFixed(1)}%</Td>
                  <Td right>
                    {active ? <StatusPill status="active" />
                      : gmv >= t.from ? <StatusPill status="cleared" />
                      : <StatusPill status="draft" />}
                  </Td>
                </tr>
              )
            })}
          </Table>
        </SectionCard>

        <SectionCard title="Plan Terms" subtitle={PARTNER_PLAN.id}>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: 'var(--text-sm)' }}>
            <TermRow label="Plan" value={PARTNER_PLAN.id} />
            <TermRow label="Model" value={PARTNER_PLAN.model} />
            <TermRow label="Base rate" value={`${PARTNER_PLAN.base}%`} />
            <TermRow label="Fees" value={PARTNER_PLAN.fees} />
            <TermRow label="Cycle" value={PARTNER_PLAN.cycle} />
            <TermRow label="Holdback" value={PARTNER_PLAN.hold} />
            <TermRow label="Currency" value="USD — settled in USD" />
            <TermRow label="Withholding" value="Treaty rate applied while tax certificate is valid" />
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

function TermRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ fontWeight: 600, textAlign: 'right', maxWidth: '60%' }}>{value}</span>
    </div>
  )
}
