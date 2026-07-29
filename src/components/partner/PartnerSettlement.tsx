import { Wallet, TrendingUp, PieChart as PieIcon, Clock, Download, FileText } from 'lucide-react'
import { StatCard, SectionCard, Table, Td, StatusPill, fmtMoney, fmtInt, Btn, toast } from '../operator/shared'
import { PARTNER_SETTLEMENTS, PARTNER_PLAN, PARTNER_ORDERS } from './data'

export function PartnerSettlement() {
  const cur = PARTNER_SETTLEMENTS[0]
  const due = PARTNER_SETTLEMENTS.filter(s => s.status !== 'paid').reduce((a, s) => a + s.net, 0)
  const openOrders = PARTNER_ORDERS.filter(o => o.stage < o.stages.length - 1 && !o.failed)
  const failedOrders = PARTNER_ORDERS.filter(o => o.failed)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Settlement</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            What you are owed, how it was worked out, and when it lands. Plan: {PARTNER_PLAN.name} · {PARTNER_PLAN.cycle}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Btn variant="secondary" onClick={() => toast('Previous bills opened')}><FileText size={14} /> Previous bills</Btn>
          <Btn variant="secondary"><Download size={14} /> Export</Btn>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
        <StatCard label="Due to you" value={`$${fmtMoney(due)}`} sublabel={`Payout ${cur.due} by ${cur.method}`} color="var(--success)" />
        <StatCard label="Gross this period" value={`$${fmtMoney(cur.gross)}`} sublabel={`${cur.orders} orders`} color="var(--brand-navy)" />
        <StatCard label="Effective commission" value={`${((cur.commission / cur.gross) * 100).toFixed(1)}%`} sublabel={`Plan rate ${PARTNER_PLAN.base}%`} color="var(--brand-accent-dark)" />
        <StatCard label="Holdback" value={PARTNER_PLAN.hold === 'None' ? 'None' : PARTNER_PLAN.hold.split('(')[0]} sublabel="Released after returns window" />
      </div>

      {/* Current statement */}
      <SectionCard title={`Current Statement — ${cur.period}`} subtitle={`Statement ${cur.id}`}>
        <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '24px' }} className="op-grid-2col">
          <div>
            {/* Split bar */}
            <div style={{ display: 'flex', height: '28px', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '16px' }}>
              <div style={{ width: `${(cur.net / cur.gross) * 100}%`, background: 'var(--brand-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                You ${fmtMoney(cur.net)}
              </div>
              <div style={{ width: `${(cur.commission / cur.gross) * 100}%`, background: '#5E4B9B', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                Commission
              </div>
              <div style={{ width: `${Math.max(6, (cur.fees + cur.refunds) / cur.gross * 100)}%`, background: '#B8A4E8' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: 'var(--text-sm)' }}>
              <SettleRow label={`Gross order value (${cur.orders} orders)`} value={`$${fmtMoney(cur.gross)}`} />
              <SettleRow label={`Marketplace commission — ${PARTNER_PLAN.name} at ${PARTNER_PLAN.base}%`} value={`less $${fmtMoney(cur.commission)}`} />
              <SettleRow label="Payment processing and per-order fees" value={`less $${fmtMoney(cur.fees)}`} />
              {cur.refunds > 0 && <SettleRow label="Refunds and chargebacks" value={`less $${fmtMoney(cur.refunds)}`} />}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '8px', borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                <span>Net payout</span>
                <span style={{ fontSize: 'var(--text-lg)', fontWeight: 800 }}>${fmtMoney(cur.net)}</span>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <SettleRow label="Statement" value={cur.id} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>State</span>
              <StatusPill status={cur.status} />
            </div>
            <SettleRow label="Payout date" value={cur.due} />
            <SettleRow label="Method" value={cur.method} />
            <SettleRow label="Account" value="•••• 4471" />
            <div style={{
              marginTop: '4px', padding: '12px', borderRadius: 'var(--radius)',
              background: cur.status === 'pending' ? 'var(--warning-bg)' : 'var(--success-bg)',
              border: `1px solid ${cur.status === 'pending' ? 'var(--warning)' : 'var(--success)'}`,
              fontSize: 'var(--text-xs)', color: cur.status === 'pending' ? 'var(--warning)' : 'var(--success)',
            }}>
              {cur.status === 'pending'
                ? 'Awaiting marketplace approval. Statements are approved after the returns window closes, then paid on the cycle date.'
                : 'Approved. Payment is released on the cycle date; funds usually clear within two working days.'}
            </div>
            <Btn variant="primary" size="sm" onClick={() => toast('Invoice opened')}>View the invoice</Btn>
            <Btn variant="secondary" size="sm" onClick={() => toast('Statement downloaded')}>Download statement</Btn>
          </div>
        </div>
      </SectionCard>

      {/* Statement history */}
      <SectionCard title="Statement History" subtitle="Every statement you have ever been paid against">
        <Table headers={['Period', 'Orders', 'Gross', 'Commission', 'Fees', 'Refunds', 'Net payout', 'State', '']}>
          {PARTNER_SETTLEMENTS.map(s => (
            <tr key={s.id}>
              <Td>
                <div style={{ fontWeight: 600 }}>{s.period}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{s.id}</div>
              </Td>
              <Td right>{s.orders}</Td>
              <Td right>${fmtMoney(s.gross)}</Td>
              <Td right>less ${fmtMoney(s.commission)}</Td>
              <Td right>less ${fmtMoney(s.fees)}</Td>
              <Td right>{s.refunds ? `less $${fmtMoney(s.refunds)}` : '—'}</Td>
              <Td right>${fmtMoney(s.net)}</Td>
              <Td right><StatusPill status={s.status} /></Td>
              <Td right>
                <Btn variant="secondary" size="sm" onClick={() => toast('Statement opened')}>View</Btn>
              </Td>
            </tr>
          ))}
        </Table>
      </SectionCard>

      {/* Reconciliation */}
      <SectionCard title="Reconciliation" subtitle="How orders map to this statement">
        <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }} className="op-grid-2col">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            <SettleRow label="Orders in the period" value={fmtInt(PARTNER_ORDERS.length)} />
            <SettleRow label="Orders excluded — not yet delivered" value={fmtInt(openOrders.length)} />
            <SettleRow label="Orders excluded — failed fulfilment" value={fmtInt(failedOrders.length)} />
            <SettleRow label="Orders in this statement" value={fmtInt(cur.orders)} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
              Anything not delivered by the cycle cut-off rolls into the next statement rather than being estimated. Failed orders never settle at all.
            </div>
            <SettleRow label="Value rolling to next period" value={`$${fmtMoney(openOrders.reduce((a, o) => a + o.gross, 0))}`} />
            <SettleRow label="Value that will never settle" value={`$${fmtMoney(failedOrders.reduce((a, o) => a + o.gross, 0))}`} />
          </div>
        </div>
      </SectionCard>
    </div>
  )
}

function SettleRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{value}</span>
    </div>
  )
}
