import { useState } from 'react'
import { ShoppingCart, TriangleAlert as AlertTriangle, CircleCheck as CheckCircle, Wallet, Download } from 'lucide-react'
import { StatCard, SectionCard, Table, Td, StatusPill, fmtMoney, fmtInt, Btn, toast, Modal } from '../operator/shared'
import { PARTNER_ORDERS, VERTICAL_NAMES } from './data'
import { Pager, usePaging } from '../Pager'

export function PartnerOrders() {
  const [orders, setOrders] = useState(PARTNER_ORDERS)
  /* The order a seller asked to see. "View" was `toast('Order detail opened')` —
     a message announcing a thing that did not happen. */
  const [viewing, setViewing] = useState<typeof PARTNER_ORDERS[number] | null>(null)
  const page = usePaging(orders)

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

      <div className="stat-row">
        <StatCard label="To fulfil" value={fmtInt(openOrders.length)} sublabel="Dispatch target: next working day" color="var(--brand-accent-dark)" />
        <StatCard label="Completed" value={fmtInt(completedOrders.length)} sublabel="Last 90 days" color="var(--success)" />
        <StatCard label="Failed" value={fmtInt(failedOrders.length)} sublabel={failedOrders.length ? 'Action needed' : 'None'} color={failedOrders.length ? 'var(--danger)' : undefined} />
        <StatCard label="Value to settle" value={`$${fmtMoney(valueToSettle)}`} sublabel="Net of commission, before fees" color="var(--brand-navy)" />
      </div>

      <SectionCard title="Your Orders" subtitle={`${orders.length} total`}>
        <Table headers={['Order', 'Product', 'Buyer', 'Qty', 'Gross', 'Commission', 'Status', '']}>
          {page.rows.map(o => (
            <tr key={o.id} onClick={() => setViewing(o)} style={{ cursor: 'pointer' }} title="Open this order">
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
                {/* The stage button moves the order on; it must not also open
                    the row it is sitting in. */}
                {o.failed
                  ? <Btn variant="primary" size="sm" onClick={e => { e.stopPropagation(); setViewing(o) }}>Resolve</Btn>
                  : o.stage < o.stages.length - 1
                  ? <Btn variant="primary" size="sm" onClick={e => { e.stopPropagation(); advanceOrder(o.id) }}>{o.stages[o.stage + 1]}</Btn>
                  : <Btn variant="secondary" size="sm" onClick={e => { e.stopPropagation(); setViewing(o) }}>View</Btn>}
              </Td>
            </tr>
          ))}
        </Table>
        <Pager page={page} noun="orders" />
      </SectionCard>

      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? `${viewing.id} — ${viewing.name}` : ''}
        footer={
          <>
            <Btn variant="secondary" size="sm" onClick={() => setViewing(null)}>Close</Btn>
            {viewing && !viewing.failed && viewing.stage < viewing.stages.length - 1 && (
              <Btn size="sm" onClick={() => { advanceOrder(viewing.id); setViewing(null) }}>
                Mark {viewing.stages[viewing.stage + 1].toLowerCase()}
              </Btn>
            )}
          </>
        }
      >
        {viewing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              Placed {viewing.placed} · {VERTICAL_NAMES[viewing.v]}
            </div>

            {/* Where it has got to, in the same rail language the rest of the
                console uses rather than a single word in a cell. */}
            <div>
              <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                Fulfilment
              </div>
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexWrap: 'wrap', gap: '2px' }}>
                {viewing.stages.map((st, i) => {
                  const done = i <= viewing.stage
                  const stopped = viewing.failed && i === viewing.stage
                  const ring = stopped ? 'var(--danger)' : done ? 'var(--success)' : 'var(--border)'
                  const fill = stopped ? 'var(--danger-bg)' : done ? 'var(--success-bg)' : 'var(--bg-alt)'
                  const ink = stopped ? 'var(--danger)' : done ? 'var(--success)' : 'var(--text-tertiary)'
                  return (
                    <li key={st} style={{ flex: '1 1 110px', minWidth: '110px' }}>
                      <div style={{ padding: '9px 10px', borderRadius: 'var(--radius-md)', border: `1px solid ${ring}`, background: fill }}>
                        <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: ink }}>
                          {stopped ? 'Failed' : done ? 'Done' : `Step ${i + 1}`}
                        </div>
                        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)', marginTop: '2px' }}>{st}</div>
                      </div>
                    </li>
                  )
                })}
              </ol>
            </div>

            <OrderFact label="Buyer" value={`${viewing.buyer} · ${viewing.buyerType} · ${viewing.channel}`} />
            <OrderFact label="Quantity" value={fmtInt(viewing.qty)} />

            <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '12px 14px' }}>
              <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
                What you receive
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '4px 16px', fontSize: 'var(--text-sm)' }}>
                <span>Gross</span><strong style={{ textAlign: 'right' }}>${fmtMoney(viewing.gross)}</strong>
                <span>Commission</span><span style={{ textAlign: 'right' }}>− ${fmtMoney(viewing.comm)}</span>
                <span style={{ fontWeight: 700 }}>Settles at</span>
                <strong style={{ textAlign: 'right' }}>${fmtMoney(viewing.gross - viewing.comm)}</strong>
              </div>
            </div>

            {viewing.failed && (
              <div style={{ padding: '12px 14px', borderRadius: 'var(--radius-md)', background: 'var(--danger-bg)', border: '1px solid var(--danger)', color: 'var(--danger)', fontSize: 'var(--text-sm)' }}>
                This order failed at fulfilment. It does not settle until it is resolved, and it counts
                against your dispatch-on-time rate.
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

function OrderFact({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: '12px', fontSize: 'var(--text-sm)' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ color: 'var(--text)' }}>{value}</span>
    </div>
  )
}
