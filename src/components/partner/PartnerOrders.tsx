import { useState } from 'react'
import { ShoppingCart, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Wallet, Download } from 'lucide-react'
import { StatCard, SectionCard, Table, Td, StatusPill, fmtMoney, fmtInt, Btn, toast } from '../operator/shared'
import { PARTNER_ORDERS, VERTICAL_NAMES } from './data'

export function PartnerOrders() {
  const [orders, setOrders] = useState(PARTNER_ORDERS)

  const openOrders = orders.filter(o => o.stage < o.stages.length - 1 && !o.failed)
  const failedOrders = orders.filter(o => o.failed)
  const completedOrders = orders.filter(o => o.stage === o.stages.length - 1 && !o.failed)
  const valueToSettle = orders.filter(o => !o.failed).reduce((a, o) => a + o.gross - o.comm, 0)

  const advanceOrder = (id: string) => {
    setOrders(prev => prev.map(o => {
      if (o.id === id && o.stage < o.stages.length - 1) {
        return { ...o, stage: o.stage + 1 }
      }
      return o
    }))
    const order = orders.find(o => o.id === id)
    const nextStage = order ? order.stages[order.stage + 1] : ''
    toast(`${id} marked as ${nextStage.toLowerCase()}`)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Orders</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {orders.length} orders · {openOrders.length} to fulfil{failedOrders.length ? ` · ${failedOrders.length} failed` : ''}
          </p>
        </div>
        <Btn variant="secondary" onClick={() => toast('Bulk dispatch — upload tracking numbers as CSV')}><Download size={14} /> Bulk dispatch</Btn>
      </div>

      {failedOrders.length > 0 && (
        <div style={{
          display: 'flex', gap: '12px', alignItems: 'flex-start',
          padding: '14px 18px', borderRadius: 'var(--radius-md)',
          background: 'var(--danger-bg)', border: '1px solid var(--danger)',
        }}>
          <AlertTriangle size={18} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '1px' }} />
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
            <strong>{failedOrders.length} order{failedOrders.length === 1 ? '' : 's'} failed at fulfilment.</strong> These do not settle until they are resolved, and they count against your dispatch-on-time rate.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
        <StatCard label="To fulfil" value={fmtInt(openOrders.length)} sublabel="Dispatch target: next working day" color="var(--brand-accent-dark)" />
        <StatCard label="Completed" value={fmtInt(completedOrders.length)} sublabel="Last 90 days" color="var(--success)" />
        <StatCard label="Failed" value={fmtInt(failedOrders.length)} sublabel={failedOrders.length ? 'Action needed' : 'None'} color={failedOrders.length ? 'var(--danger)' : undefined} />
        <StatCard label="Value to settle" value={`$${fmtMoney(valueToSettle)}`} sublabel="Net of commission, before fees" color="var(--brand-navy)" />
      </div>

      <SectionCard title="Your Orders" subtitle={`${orders.length} total`}>
        <Table headers={['Order', 'Product', 'Buyer', 'Qty', 'Gross', 'Commission', 'Status', '']}>
          {orders.map(o => (
            <tr key={o.id}>
              <Td>
                <div style={{ fontWeight: 600 }}>{o.id}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{o.placed}</div>
              </Td>
              <Td>
                <div style={{ fontWeight: 500 }}>{o.name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{VERTICAL_NAMES[o.v]}</div>
              </Td>
              <Td>
                <div>{o.buyer}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{o.buyerType} · {o.channel}</div>
              </Td>
              <Td right>{o.qty}</Td>
              <Td right>${fmtMoney(o.gross)}</Td>
              <Td right>less ${fmtMoney(o.comm)}</Td>
              <Td right>
                {o.failed ? <StatusPill status="rejected" />
                  : o.stage < o.stages.length - 1 ? <StatusPill status="open" />
                  : <StatusPill status="resolved" />}
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>{o.stages[o.stage]}</div>
              </Td>
              <Td right>
                {o.failed
                  ? <Btn variant="primary" size="sm" onClick={() => toast('Redelivery arranged')}>Resolve</Btn>
                  : o.stage < o.stages.length - 1
                  ? <Btn variant="primary" size="sm" onClick={() => advanceOrder(o.id)}>{o.stages[o.stage + 1]}</Btn>
                  : <Btn variant="secondary" size="sm" onClick={() => toast('Order detail opened')}>View</Btn>}
              </Td>
            </tr>
          ))}
        </Table>
      </SectionCard>
    </div>
  )
}
