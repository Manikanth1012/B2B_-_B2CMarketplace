import { TrendingUp, TrendingDown, TriangleAlert as AlertTriangle, Wallet, Package, ShoppingCart, Star, Clock, ChevronRight } from 'lucide-react'
import { StatCard, SectionCard, Table, Td, StatusPill, fmtMoney, fmtInt, Btn } from '../operator/shared'
import { PARTNER_PROFILE, PARTNER_LISTINGS, PARTNER_ORDERS, PARTNER_SETTLEMENTS, PARTNER_PLAN, ONB_TASKS, VERTICAL_NAMES } from './data'

export function PartnerDashboard({ onNavigate }: {
  /* The console owns navigation. Without this the dashboard can show that six
     orders need action and offer no way to reach any of them. */
  onNavigate?: (view: 'pt-orders' | 'pt-listings' | 'pt-support') => void
}) {
  const liveListings = PARTNER_LISTINGS.filter(l => l.status === 'live')
  const pendingListings = PARTNER_LISTINGS.filter(l => l.status === 'pending')
  const openOrders = PARTNER_ORDERS.filter(o => o.stage < o.stages.length - 1 && !o.failed)
  const failedOrders = PARTNER_ORDERS.filter(o => o.failed)
  const gmv = PARTNER_ORDERS.reduce((a, o) => a + o.gross, 0)
  const commission = PARTNER_ORDERS.reduce((a, o) => a + o.comm, 0)
  const dueSettlement = PARTNER_SETTLEMENTS.filter(s => s.status !== 'paid').reduce((a, s) => a + s.net, 0)
  const openTasks = ONB_TASKS.filter(t => t.status !== 'done' && t.status !== 'notstarted')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Seller Dashboard</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {PARTNER_PROFILE.name} · {PARTNER_PROFILE.id} · {PARTNER_PROFILE.tier} partner since {PARTNER_PROFILE.joined} · selling in {PARTNER_PROFILE.verticals.map(v => VERTICAL_NAMES[v]?.replace(' Marketplace', '')).join(' and ')}
        </p>
      </div>

      {/* Onboarding blocker banner */}
      <div style={{
        display: 'flex', gap: '12px', alignItems: 'flex-start',
        padding: '14px 18px', borderRadius: 'var(--radius-md)',
        background: 'var(--warning-bg)', border: '1px solid var(--warning)',
      }}>
        <AlertTriangle size={18} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: '1px' }} />
        <div style={{ fontSize: 'var(--text-sm)', color: 'var(--warning)' }}>
          <strong>Your Security Marketplace application is stuck at the technical gate.</strong> 3 of 5 working days elapsed, and the fulfilment webhook is failing on retry.
        </div>
      </div>

      {/* Stat cards */}
      <div className="stat-row">
        <StatCard label="Gross Merchandise Value" value={`$${fmtMoney(gmv)}`} sublabel={`${fmtInt(PARTNER_ORDERS.length)} orders`} color="var(--brand-navy)" />
        <StatCard label="Orders to Fulfil" value={fmtInt(openOrders.length)} sublabel={failedOrders.length ? `${failedOrders.length} failed and need action` : 'Nothing overdue'} color="var(--brand-accent-dark)" />
        <StatCard label="Settlement Due" value={`$${fmtMoney(dueSettlement)}`} sublabel={`Next payout ${PARTNER_SETTLEMENTS[0]?.due || '—'}`} color="var(--success)" />
        <StatCard label="Live Listings" value={`${liveListings.length} of ${PARTNER_LISTINGS.length}`} sublabel={`${pendingListings.length} awaiting marketplace review`} />
      </div>

      {/* Charts row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }} className="op-grid-2col">
        <SectionCard title="Gross Value by Listing" subtitle="Last 90 days · gross order value before commission">
          <div style={{ padding: '20px' }}>
            {liveListings.map((l, i) => {
              const listingGmv = PARTNER_ORDERS.filter(o => o.name === l.name).reduce((a, o) => a + o.gross, 0)
              const maxGmv = Math.max(...liveListings.map(ll => PARTNER_ORDERS.filter(o => o.name === ll.name).reduce((a, o) => a + o.gross, 0)), 1)
              return (
                <div key={l.id} style={{ marginBottom: '12px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', marginBottom: '4px' }}>
                    <span style={{ color: 'var(--text)', fontWeight: 500 }}>{l.name.split(' ').slice(0, 3).join(' ')}</span>
                    <span style={{ color: 'var(--text-tertiary)', fontVariantNumeric: 'tabular-nums' }}>${fmtMoney(listingGmv)}</span>
                  </div>
                  <div style={{ height: '8px', borderRadius: '4px', background: 'var(--bg-alt)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(listingGmv / maxGmv) * 100}%`, background: 'var(--brand-accent-dark)', borderRadius: '4px', transition: 'width 300ms ease' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </SectionCard>

        <SectionCard title="Where Your Money Goes" subtitle={`Illustrated on a $1,000 sale · Plan: ${PARTNER_PLAN.name}`}>
          <div style={{ padding: '20px' }}>
            <div style={{ display: 'flex', height: '28px', borderRadius: 'var(--radius)', overflow: 'hidden', marginBottom: '16px' }}>
              <div style={{ width: `${100 - PARTNER_PLAN.base - 2}%`, background: 'var(--brand-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                You ${fmtMoney(1000 - 120 - 21)}
              </div>
              <div style={{ width: `${PARTNER_PLAN.base}%`, background: '#5E4B9B', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 'var(--text-xs)', fontWeight: 600 }}>
                Commission
              </div>
              <div style={{ width: '2%', background: '#B8A4E8' }} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <Row label="Your plan" value={PARTNER_PLAN.name} />
              <Row label="Commission" value={`${PARTNER_PLAN.base}%`} />
              <Row label="Payout cycle" value={PARTNER_PLAN.cycle} />
              <Row label="Holdback" value={PARTNER_PLAN.hold} />
            </div>
            <Btn variant="secondary" size="sm" style={{ marginTop: '12px' }}>Full settlement plan</Btn>
          </div>
        </SectionCard>
      </div>

      {/* Orders + Rating */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }} className="op-grid-2col">
        <SectionCard
          title="Orders Needing You"
          subtitle={`${openOrders.length + failedOrders.length} require action`}
          action={
            <Btn size="sm" variant="secondary" onClick={() => onNavigate?.('pt-orders')}>
              Manage all <ChevronRight size={13} />
            </Btn>
          }>
          {/* Each row says what the next step actually is, and does it. A card
              headed "needing you" whose rows are read-only tells somebody they
              are late and gives them nowhere to go. */}
          <Table headers={['Order', 'Buyer', 'Value', 'Next step', '']}>
            {failedOrders.concat(openOrders).slice(0, 6).map(o => {
              const next = o.failed ? 'Resolve the failure' : o.stages[o.stage + 1]
              return (
                <tr key={o.id}>
                  <Td>
                    <div style={{ fontWeight: 600, whiteSpace: 'nowrap' }}>{o.id}</div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{o.name}</div>
                  </Td>
                  <Td>{o.buyer}</Td>
                  <Td right>${fmtMoney(o.gross)}</Td>
                  {/* The status pill and the next step said the same thing
                      twice and wrapped to three lines doing it. The step is the
                      useful half — it is what somebody has to go and do. */}
                  <Td>
                    {/* Not nowrap: "Resolve the failure" held on one line costs
                        the column 118px, and this card sits in a two-column
                        grid where that is the difference between fitting and a
                        scrollbar. A phrase wraps; a figure would not. */}
                    <span style={{
                      fontSize: '11px', fontWeight: 600,
                      color: o.failed ? 'var(--danger)' : 'var(--text-secondary)',
                    }}>
                      {next}
                    </span>
                  </Td>
                  <Td right>
                    <Btn size="sm" variant={o.failed ? 'primary' : 'secondary'}
                         onClick={() => onNavigate?.('pt-orders')}>
                      {o.failed ? 'Resolve' : 'Open'}
                    </Btn>
                  </Td>
                </tr>
              )
            })}
          </Table>
          {openOrders.length + failedOrders.length === 0 && (
            <div style={{ padding: '20px', textAlign: 'center', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
              Nothing waiting on you.
            </div>
          )}
        </SectionCard>

        <SectionCard title="Seller Rating" subtitle="Based on verified purchases">
          <div style={{ padding: '20px' }}>
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: '30px', fontWeight: 800, color: 'var(--text)' }}>{PARTNER_PROFILE.rating.toFixed(1)}</div>
                <div style={{ display: 'flex', gap: '2px', marginTop: '4px' }}>
                  {[1, 2, 3, 4, 5].map(n => (
                    <Star key={n} size={14} style={{ color: n <= Math.round(PARTNER_PROFILE.rating) ? '#F5A623' : 'var(--border)' }} fill={n <= Math.round(PARTNER_PROFILE.rating) ? '#F5A623' : 'none'} />
                  ))}
                </div>
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                {[5, 4, 3, 2, 1].map((n, i) => (
                  <div key={n} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: 'var(--text-xs)', width: '12px', color: 'var(--text-tertiary)' }}>{n}</span>
                    <div style={{ flex: 1, height: '6px', borderRadius: '3px', background: 'var(--bg-alt)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${[62, 24, 8, 4, 2][i]}%`, background: '#F5A623', borderRadius: '3px' }} />
                    </div>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', width: '30px', textAlign: 'right' }}>{[62, 24, 8, 4, 2][i]}%</span>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-light)', display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <Row label="Dispatch on time" value="96%" />
              <Row label="Dispute rate" value="0.8%" />
              <Row label="Returns" value="2.1%" />
              <Row label="Response time" value="4h median" />
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{label}</span>
      <span style={{ fontWeight: 600, color: 'var(--text)' }}>{value}</span>
    </div>
  )
}
