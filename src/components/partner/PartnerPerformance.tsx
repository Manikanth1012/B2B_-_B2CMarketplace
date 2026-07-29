import { PieChart, BarChart3, Eye, ShoppingCart, Wallet, Undo, Star } from 'lucide-react'
import { StatCard, SectionCard, Table, Td, fmtMoney, fmtInt, Btn } from '../operator/shared'
import { PARTNER_LISTINGS, PARTNER_ORDERS, PARTNER_PLAN, PARTNER_PROFILE } from './data'

export function PartnerPerformance() {
  const live = PARTNER_LISTINGS.filter(l => l.status === 'live')
  const totalOrders = PARTNER_ORDERS.length
  const totalGmv = PARTNER_ORDERS.reduce((a, o) => a + o.gross, 0)
  const views = 18402
  const conversion = totalOrders > 0 ? (totalOrders / views * 100).toFixed(2) : '0'

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Performance</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          How your listings convert and where the gross value comes from. Your data only — no other seller is visible to you.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
        <StatCard label="Listing views" value={fmtInt(views)} sublabel="Last 90 days" />
        <StatCard label="Orders" value={fmtInt(totalOrders)} sublabel={`Conversion ${conversion}%`} color="var(--brand-accent-dark)" />
        <StatCard label="Average order value" value={`$${fmtMoney(totalOrders ? totalGmv / totalOrders : 0)}`} sublabel="Bundles lift this materially" color="var(--brand-navy)" />
        <StatCard label="Return rate" value="2.1%" sublabel="Marketplace median for hardware is 3.4%" color="var(--success)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }} className="op-grid-2col">
        <SectionCard title="Gross Value by Listing" subtitle="Your own orders only">
          <div style={{ padding: '20px' }}>
            {live.map(l => {
              const gmv = PARTNER_ORDERS.filter(o => o.name === l.name).reduce((a, o) => a + o.gross, 0)
              const max = Math.max(...live.map(ll => PARTNER_ORDERS.filter(o => o.name === ll.name).reduce((a, o) => a + o.gross, 0)), 1)
              return (
                <div key={l.id} style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 500 }}>{l.name.split(' ').slice(0, 3).join(' ')}</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>${fmtMoney(gmv)}</span>
                  </div>
                  <div style={{ height: '8px', borderRadius: '4px', background: 'var(--bg-alt)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(gmv / max) * 100}%`, background: 'var(--brand-accent-dark)', borderRadius: '4px' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </SectionCard>

        <SectionCard title="Orders by Marketplace" subtitle={`${totalOrders} total`}>
          <div style={{ padding: '20px' }}>
            {PARTNER_PROFILE.verticals.map(v => {
              const count = PARTNER_ORDERS.filter(o => o.v === v).length
              return (
                <div key={v} style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 500 }}>{v}</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>{count} orders</span>
                  </div>
                  <div style={{ height: '8px', borderRadius: '4px', background: 'var(--bg-alt)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(count / totalOrders) * 100}%`, background: '#5E4B9B', borderRadius: '4px' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Listing Detail" subtitle="Conversion and value per listing">
        <Table headers={['Listing', 'Views', 'Orders', 'Conversion', 'Gross', 'Commission', 'Net to you']}>
          {live.map((l, i) => {
            const os = PARTNER_ORDERS.filter(o => o.name === l.name)
            const g = os.reduce((a, o) => a + o.gross, 0)
            const c = os.reduce((a, o) => a + o.comm, 0)
            const v = [6200, 4100, 3300][i % 3]
            return (
              <tr key={l.id}>
                <Td>
                  <div style={{ fontWeight: 600 }}>{l.name}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{l.cat}</div>
                </Td>
                <Td right>{fmtInt(v)}</Td>
                <Td right>{os.length}</Td>
                <Td right>{os.length ? (os.length / v * 100).toFixed(2) + '%' : '—'}</Td>
                <Td right>${fmtMoney(g)}</Td>
                <Td right>less ${fmtMoney(c)}</Td>
                <Td right>${fmtMoney(g - c - g * 0.019)}</Td>
              </tr>
            )
          })}
        </Table>
      </SectionCard>

      <SectionCard title="Reviews" subtitle="Verified purchases only">
        <div style={{ padding: '20px', display: 'flex', gap: '20px', alignItems: 'center' }}>
          <div style={{ textAlign: 'center', flexShrink: 0 }}>
            <div style={{ fontSize: '30px', fontWeight: 800 }}>{PARTNER_PROFILE.rating.toFixed(1)}</div>
            <div style={{ display: 'flex', gap: '2px', justifyContent: 'center', marginTop: '4px' }}>
              {[1, 2, 3, 4, 5].map(n => (
                <Star key={n} size={14} style={{ color: n <= Math.round(PARTNER_PROFILE.rating) ? '#F5A623' : 'var(--border)' }} fill={n <= Math.round(PARTNER_PROFILE.rating) ? '#F5A623' : 'none'} />
              ))}
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>268 published</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '6px' }}>Most recent criticism</div>
            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', fontStyle: 'italic' }}>
              "The sensor works well but the mounting bracket was missing from the box. Support replaced it quickly though."
            </div>
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>GreenCity Corp on Nimbus Air Quality Sensor</div>
          </div>
        </div>
      </SectionCard>
    </div>
  )
}
