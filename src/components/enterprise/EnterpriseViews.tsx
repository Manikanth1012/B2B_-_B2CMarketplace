import { useState } from 'react'
import { SquareCheck as CheckSquare, X, Shield, Cpu, Package } from 'lucide-react'
import { StatCard, SectionCard, Table, Td, StatusPill, fmtMoney, fmtInt, Btn, toast, Modal } from '../operator/shared'
import { ENTERPRISE_SUBS, ENTERPRISE_ORDERS, VERTICAL_NAMES } from './data'

/* EnterpriseApprovals moved to EnterpriseApprovals.tsx when requisitions
   became rows rather than a constant. Deciding one here filtered a React array,
   so an approval survived until the next refresh and no colleague ever saw it. */

export function EnterpriseOrders() {
  const [orders, setOrders] = useState(ENTERPRISE_ORDERS)

  const openOrders = orders.filter(o => o.stage < o.stages.length - 1 && !o.failed)
  const failedOrders = orders.filter(o => o.failed)
  const completedOrders = orders.filter(o => o.stage === o.stages.length - 1 && !o.failed)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Orders</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {orders.length} orders · {openOrders.length} in flight{failedOrders.length ? ` · ${failedOrders.length} failed` : ''}
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
        <StatCard label="In flight" value={fmtInt(openOrders.length)} sublabel="Provisioning and delivery" color="var(--brand-accent-dark)" />
        <StatCard label="Completed" value={fmtInt(completedOrders.length)} sublabel="Delivered or provisioned" color="var(--success)" />
        <StatCard label="Failed" value={fmtInt(failedOrders.length)} sublabel={failedOrders.length ? 'Needs attention' : 'None'} color={failedOrders.length ? 'var(--danger)' : undefined} />
        <StatCard label="Total spend" value={`$${fmtMoney(orders.reduce((a, o) => a + o.gross, 0))}`} sublabel="All orders" color="var(--brand-navy)" />
      </div>

      <SectionCard title="Your Orders" subtitle={`${orders.length} total`}>
        <Table headers={['Order', 'Product', 'Seller', 'Qty', 'Value', 'Status', '']}>
          {orders.map(o => (
            <tr key={o.id}>
              <Td>
                <div style={{ fontWeight: 600 }}>{o.id}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{o.placed}</div>
              </Td>
              <Td><div style={{ fontWeight: 500 }}>{o.name}</div></Td>
              <Td>{o.seller}</Td>
              <Td right>{o.qty}</Td>
              <Td right>${fmtMoney(o.gross)}</Td>
              <Td right>
                {o.failed ? <StatusPill status="rejected" />
                  : o.stage < o.stages.length - 1 ? <StatusPill status="open" />
                  : <StatusPill status="resolved" />}
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>{o.stages[o.stage]}</div>
              </Td>
              <Td right><Btn variant="secondary" size="sm" onClick={() => toast('Order detail opened')}>View</Btn></Td>
            </tr>
          ))}
        </Table>
      </SectionCard>
    </div>
  )
}

export function EnterpriseSubs() {
  const activeSubs = ENTERPRISE_SUBS.filter(s => s.status === 'active')
  const mrc = activeSubs.reduce((a, s) => a + s.monthly, 0)
  const unassigned = activeSubs.reduce((a, s) => a + (s.seatsTotal - s.seatsUsed), 0)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Subscriptions</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {activeSubs.length} active · ${fmtMoney(mrc)}/month committed · {unassigned} unassigned seats
        </p>
      </div>

      {ENTERPRISE_SUBS.some(s => s.status === 'suspended') && (
        <div style={{
          display: 'flex', gap: '12px', alignItems: 'flex-start',
          padding: '14px 18px', borderRadius: 'var(--radius-md)',
          background: 'var(--danger-bg)', border: '1px solid var(--danger)',
        }}>
          <Shield size={18} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '1px' }} />
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
            <strong>Vertex Endpoint Protect is suspended.</strong> Your 120 licences run to contract end (30 Sep 2026) but will not renew. Sentinel MDR covers the same endpoints and you already hold it for 620 of them.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
        <StatCard label="Monthly committed" value={`$${fmtMoney(mrc)}`} sublabel={`${activeSubs.length} active subscriptions`} color="var(--brand-navy)" />
        <StatCard label="Unassigned seats" value={fmtInt(unassigned)} sublabel={`~$${fmtMoney(unassigned * 6.5)}/mo at risk`} color="var(--warning)" />
        <StatCard label="Suspended" value={fmtInt(ENTERPRISE_SUBS.filter(s => s.status === 'suspended').length)} sublabel="Needs replacement decision" color="var(--danger)" />
        <StatCard label="Next renewal" value="30 Sep" sublabel="Vertex Endpoint Protect" color="var(--warning)" />
      </div>

      <SectionCard title="Your Security Stack" subtitle="Active and suspended subscriptions">
        <Table headers={['Service', 'Seller', 'Licensed', 'Assigned', 'Monthly', 'Renews', 'State', '']}>
          {ENTERPRISE_SUBS.map(s => (
            <tr key={s.id}>
              <Td>
                <div style={{ fontWeight: 600 }}>{s.name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{s.unit}</div>
              </Td>
              <Td>{s.seller}</Td>
              <Td right>{fmtInt(s.qty)}</Td>
              <Td right>
                {s.status === 'suspended'
                  ? <span style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>Not assignable</span>
                  : (
                    <div>
                      <div style={{ fontSize: 'var(--text-sm)' }}>{s.seatsUsed} / {s.seatsTotal}</div>
                      <div style={{ height: '6px', borderRadius: '3px', background: 'var(--bg-alt)', overflow: 'hidden', marginTop: '4px' }}>
                        <div style={{ height: '100%', width: `${(s.seatsUsed / s.seatsTotal) * 100}%`, background: 'var(--brand-accent-dark)', borderRadius: '3px' }} />
                      </div>
                    </div>
                  )}
              </Td>
              <Td right>${fmtMoney(s.monthly)}</Td>
              <Td>{s.renews}</Td>
              <Td right><StatusPill status={s.status} /></Td>
              <Td right><Btn variant="secondary" size="sm" onClick={() => toast('Subscription detail opened')}>Manage</Btn></Td>
            </tr>
          ))}
        </Table>
      </SectionCard>
    </div>
  )
}

export function EnterpriseMarketplace({ vertical }: { vertical: string }) {
  const items = ENTERPRISE_ORDERS.length > 0 ? [] : [] // not used for listing display
  const catalogue = ENTERPRISE_SUBS // placeholder
  const listings = [
    { id: 'SKU-3001', name: '6D Connect IoT SIM 100-pack', cat: 'IoT SIM plans', v: 'iot', price: 900, model: 'monthly', seller: '6D Telecom', rating: 4.2, reviews: 45, desc: '100 IoT SIMs with shared data pool' },
    { id: 'SKU-3002', name: 'Nimbus Air Quality Sensor', cat: 'Sensors', v: 'iot', price: 189, model: 'oneoff', seller: 'Nimbus Sensors', rating: 4.5, reviews: 128, desc: 'Indoor air quality monitor' },
    { id: 'SKU-3004', name: 'Nimbus Cold-Chain Starter Bundle', cat: 'Bundles', v: 'iot', price: 599, model: 'oneoff', seller: 'Nimbus Sensors', rating: 4.8, reviews: 56, desc: '5 sensors + gateway + dashboard' },
    { id: 'SKU-6001', name: 'Sentinel Managed Firewall', cat: 'Managed firewall', v: 'security', price: 450, model: 'monthly', seller: 'Sentinel Cyber', rating: 4.3, reviews: 32, desc: 'Next-gen firewall with 24/7 SOC' },
    { id: 'SKU-6002', name: 'Sentinel MDR Service', cat: 'MDR', v: 'security', price: 20, model: 'monthly', seller: 'Sentinel Cyber', rating: 4.6, reviews: 67, desc: 'Managed detection and response' },
    { id: 'SKU-6004', name: 'CloudZTNA Zero Trust Access', cat: 'VPN / ZTNA', v: 'security', price: 15, model: 'monthly', seller: 'CloudPath', rating: 4.4, reviews: 28, desc: 'Zero-trust network access' },
    { id: 'SKU-7001', name: 'Aventa Business Router Pro', cat: 'Routers', v: 'device', price: 320, model: 'oneoff', seller: 'Aventa', rating: 4.5, reviews: 90, desc: 'Dual-WAN business router with 5G' },
    { id: 'SKU-7002', name: 'Aventa Field Tablet 10"', cat: 'Tablets', v: 'device', price: 449, model: 'oneoff', seller: 'Aventa', rating: 4.2, reviews: 55, desc: 'Rugged 10-inch tablet for field teams' },
  ]

  const filtered = listings.filter(l => l.v === vertical)
  const byCat: Record<string, typeof filtered> = {}
  filtered.forEach(l => { (byCat[l.cat] = byCat[l.cat] || []).push(l) })

  const mine = ENTERPRISE_SUBS.filter(s => s.v === vertical)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>{VERTICAL_NAMES[vertical]}</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {filtered.length} listings from {new Set(filtered.map(l => l.seller)).size} sellers
        </p>
      </div>

      {vertical === 'security' && (
        <div style={{
          padding: '14px 18px', borderRadius: 'var(--radius-md)',
          background: 'var(--warning-bg)', border: '1px solid var(--warning)',
          fontSize: 'var(--text-sm)', color: 'var(--warning)',
        }}>
          <strong>Security purchases need IT sign-off</strong> regardless of value, on top of the usual finance threshold. That is your own policy, not a marketplace rule.
        </div>
      )}

      {mine.length > 0 && (
        <SectionCard title="What you already hold" subtitle={`${mine.length} subscriptions`}>
          <Table headers={['Service', 'Seller', 'Licensed', 'Monthly', 'Renews', 'State']}>
            {mine.map(s => (
              <tr key={s.id}>
                <Td><strong>{s.name}</strong></Td>
                <Td>{s.seller}</Td>
                <Td right>{fmtInt(s.qty)}</Td>
                <Td right>${fmtMoney(s.monthly)}</Td>
                <Td>{s.renews}</Td>
                <Td right><StatusPill status={s.status} /></Td>
              </tr>
            ))}
          </Table>
        </SectionCard>
      )}

      {Object.entries(byCat).map(([cat, items]) => (
        <SectionCard key={cat} title={cat} subtitle={`${items.length} listings`}>
          <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '14px' }}>
            {items.map(p => (
              <div key={p.id} style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
                <div style={{ height: '100px', background: 'var(--bg-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <Package size={28} style={{ color: 'var(--text-tertiary)' }} />
                </div>
                <div style={{ padding: '12px', flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{p.name}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{p.seller}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{p.desc}</div>
                </div>
                <div style={{ padding: '10px 12px', borderTop: '1px solid var(--border-light)', background: 'var(--bg-alt)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontWeight: 700 }}>${fmtMoney(p.price)}{p.model === 'monthly' ? '/mo' : ''}</span>
                  <Btn variant="primary" size="sm" onClick={() => toast(`${p.name} added to requisition`)}>Add</Btn>
                </div>
              </div>
            ))}
          </div>
        </SectionCard>
      ))}
    </div>
  )
}
