import { useState, useEffect } from 'react'
import { Download } from 'lucide-react'
import { StatCard, SectionCard, Table, Td, StatusPill, fmtMoney, Btn, EmptyState, toast } from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { loadSellerRecord } from '../../lib/partnerRepo'
import type { SellerRecord } from '../../lib/partnerRepo'
import { rateAt, nextTier } from '../../lib/partnerCommerce'
import { PARTNER_ORDERS } from './data'

/* Reads the plan the seller actually settles on. The hard-coded one quoted a
   12% base against CP-IOT-STD, which settles at 11% — a number a seller reads
   and plans against has to be the number they are paid on. */
export function PartnerSettlementPlan({ partnerId }: { partnerId: string }) {
  const [rec, setRec] = useState<SellerRecord | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadSellerRecord(partnerId).then(r => { setRec(r); setLoading(false) })
  }, [partnerId])

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const plan = rec?.plan ?? null

  if (!plan) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Settlement plan</h1>
        {rec?.loadError
          ? <Callout tone="danger" title="This did not load">{rec.loadError}</Callout>
          : <Callout tone="warning" title="No plan is assigned yet">
              A commission schedule is counter-signed at the agreements gate, and nothing settles without one.
              Your onboarding page shows which gate you are on.
            </Callout>}
      </div>
    )
  }

  /* Trailing gross from the seller's own orders. The tiers below are read
     against this figure, so the "you are here" row is derived rather than
     asserted. */
  const gmv = PARTNER_ORDERS.reduce((a, o) => a + o.gross, 0)
  const rate = rateAt(plan, gmv)
  const ahead = nextTier(plan, gmv)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '16px', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Settlement plan</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {plan.name} · {plan.model} · applies to every listing you sell
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Btn variant="secondary" onClick={() => toast('Schedule downloaded')}><Download size={14} /> Download schedule</Btn>
          <Btn variant="primary" onClick={() => toast('Tier review requested — reference TRV-118')}>Request a tier review</Btn>
        </div>
      </div>

      <Callout tone="info">
        Commission is set by your plan, not by individual listings. Tiers apply to trailing twelve-month
        gross value and are recalculated on the first of each month.
        {ahead && ` At $${fmtMoney(ahead.toGo)} more you move to ${ahead.tier.rate}%.`}
      </Callout>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
        <StatCard label="Current rate" value={`${rate}%`} sublabel={plan.model} />
        <StatCard label="Trailing gross" value={`$${fmtMoney(gmv)}`} sublabel="Rolling 12 months" color="var(--brand-navy)" />
        <StatCard label="Payout cycle" value={plan.cycle.split(',')[0]} sublabel={plan.cycle.split(',')[1] || ''} />
        <StatCard label="Holdback" value={plan.hold === 'None' ? 'None' : plan.hold.split('(')[0]} sublabel="Protects against returns" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '20px' }} className="op-grid-2col">
        <SectionCard title="Commission tiers" subtitle="Trailing 12-month gross value determines your rate">
          {plan.tiers.length === 0 ? <EmptyState message="This plan has a single flat rate" /> : (
            <Table headers={['Trailing 12-month gross', 'Commission', 'You keep', 'State']}>
              {plan.tiers.map((t, i) => {
                const next = plan.tiers[i + 1]
                const active = gmv >= t.from && (!next || gmv < next.from)
                return (
                  <tr key={t.from} style={active ? { background: 'var(--bg-alt)' } : undefined}>
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
          )}
        </SectionCard>

        <SectionCard title="Plan terms" subtitle={plan.id}>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: 'var(--text-sm)' }}>
            <TermRow label="Plan" value={plan.id} />
            <TermRow label="Model" value={plan.model} />
            <TermRow label="Opening rate" value={`${plan.base_rate}%`} />
            <TermRow label="Fees" value={plan.fees} />
            <TermRow label="Cycle" value={plan.cycle} />
            <TermRow label="Holdback" value={plan.hold} />
            <TermRow label="Currency" value="USD — settled in USD" />
            <TermRow label="Withholding" value="Treaty rate applied while your tax certificate is valid" />
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
