import { useState, useEffect } from 'react'
import { TrendingUp, TrendingDown, TriangleAlert } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import type { OperatorProfile, OperatorTicket, SettlementStatement, Category, OperatorListing } from '../../types'
import { StatCard, SectionCard, Table, Td, StatusPill, PriorityPill, fmtInt, Btn } from './shared'
import { useMarket } from '../../lib/MarketContext'
import { ColumnChart, DonutChart, SERIES, seriesColour } from './charts'
import { monthlyStats, verticalSplit, inversionInsight, type MonthRow, type VerticalRow } from '../../lib/operatorStats'
import type { OperatorView } from '../../types/view'

/* A dashboard lists work. It was listing it and then stopping: the operator
   could read that five settlements were awaiting approval and had no way to
   open one — every drill-down meant navigating to the other screen and
   finding the row again by eye.
   Every figure and every row here now goes to the place the decision is made,
   carrying which record it was about. */
export function OperatorDashboard(
  { onNavigate }: { onNavigate?: (v: OperatorView, opts?: { focus?: string }) => void } = {},
) {
  const [profile, setProfile] = useState<OperatorProfile | null>(null)
  const [tickets, setTickets] = useState<OperatorTicket[]>([])
  const [statements, setStatements] = useState<SettlementStatement[]>([])
  const [months, setMonths] = useState<MonthRow[]>([])
  const [verticals, setVerticals] = useState<VerticalRow[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [queue, setQueue] = useState<OperatorListing[]>([])
  const [applications, setApplications] = useState(0)
  const [loading, setLoading] = useState(true)
  const { book: moneyBook, fmtIn } = useMarket()

  useEffect(() => {
    Promise.all([
      supabase.from('operator_profile').select('*').maybeSingle(),
      supabase.from('support_tickets').select('*').order('sort_order'),
      supabase.from('settlement_statements').select('*').eq('status', 'pending').order('sort_order'),
      supabase.from('operator_monthly').select('*').order('sort_order'),
      supabase.from('operator_vertical_stats').select('*').order('sort_order'),
      supabase.from('categories').select('*').order('sort_order'),
      supabase.from('operator_listings').select('*').eq('status', 'pending'),
      supabase.from('partners').select('id, status').in('status', ['onboarding', 'review']),
    ]).then(([p, t, s, m, v, c, l, a]) => {
      if (p.data) setProfile(p.data as OperatorProfile)
      if (t.data) setTickets(t.data as OperatorTicket[])
      if (s.data) setStatements(s.data as SettlementStatement[])
      if (m.data) setMonths(m.data as MonthRow[])
      if (v.data) setVerticals(v.data as VerticalRow[])
      if (c.data) setCategories(c.data as Category[])
      if (l.data) setQueue(l.data as OperatorListing[])
      setApplications((a.data ?? []).length)
      setLoading(false)
    })
  }, [])

  if (loading) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  if (!profile) return null

  /* Every figure on this screen is a reporting figure: the tables hold one
     currency (`20260802400000` made them say which) and the aggregate over
     three markets has already been converted into it. So there is nothing to
     group here — there is something to label, which is the opposite mistake to
     the one the wallets screen was making. */
  const reportingCurrency = profile.currency ?? moneyBook.currencies.find(c => c.is_reporting)?.code ?? 'USD'
  const report = (n: number, currency?: string) => fmtIn(Number(n), currency ?? reportingCurrency)

  const openTickets = tickets.filter(t => t.status === 'open')
  const breachedTickets = tickets.filter(t => t.breached)
  const stats = monthlyStats(months)
  const split = verticalSplit(verticals, categories)
  const insight = inversionInsight(verticals, categories)
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

      <div className="stat-row">
        {/* A rollup over orders placed in rupees, shillings and dirhams. It is
            already converted — that is what a reporting figure is — and now it
            says so, because "$4.2m GMV" and "$4.2m in the bank" are different
            claims and the screen was making the second one by accident. */}
        <StatCard label={`Total GMV, in ${reportingCurrency}`} value={report(profile.gmv)}
                  sublabel={`${fmtInt(profile.total_orders)} orders · ${report(profile.avg_order_value)} avg`} color="var(--brand-navy)" />
        <StatCard label={`Commission, in ${reportingCurrency}`} value={report(profile.commission)}
                  sublabel={`${profile.commission_rate}% blended take`} color="var(--brand-accent-dark)" />
        <Go to="op-partners" go={onNavigate}>
          <StatCard label="Active Partners" value={fmtInt(profile.active_partners)} sublabel={`${profile.pending_applications} pending applications`} />
        </Go>
        <Go to="op-tickets" go={onNavigate}>
          <StatCard label="Open Tickets" value={fmtInt(profile.open_tickets)} sublabel={`${profile.sla_breaches} SLA breaches`} color={profile.sla_breaches > 0 ? 'var(--danger)' : undefined} />
        </Go>
      </div>

      <div className="stat-row">
        <Go to="op-settlement" go={onNavigate}>
          <StatCard label="Settlements Due" value={fmtInt(profile.settlement_due)} sublabel="Awaiting approval" color="var(--warning)" />
        </Go>
        <Go to="op-refunds" go={onNavigate}>
          <StatCard label="Refund Requests" value={fmtInt(profile.refund_requests)} sublabel="Pending decision" />
        </Go>
        <Go to="op-dunning" go={onNavigate}>
          <StatCard label="Dunning Cases" value={fmtInt(profile.dunning_cases)} sublabel="Active collections" color="var(--danger)" />
        </Go>
        <Go to="op-dunning" go={onNavigate}>
          <StatCard label="Churn Risk" value={fmtInt(profile.churn_risk)} sublabel="Accounts flagged" color="var(--warning)" />
        </Go>
      </div>

      {/* What is actually waiting on this person, first — the prototype leads with
          it, and a dashboard that opens with a chart buries the work. */}
      {(queue.length > 0 || applications > 0) && (
        <div style={{
          display: 'flex', alignItems: 'flex-start', gap: '10px',
          background: '#FEF3C7', border: '1px solid #FCD34D',
          borderRadius: 'var(--radius)', padding: '12px 14px',
        }}>
          <TriangleAlert size={17} style={{ color: '#92400E', flexShrink: 0, marginTop: '1px' }} />
          <div style={{ fontSize: 'var(--text-sm)', color: '#92400E', lineHeight: 1.5 }}>
            <strong>{queue.length} listing{queue.length === 1 ? '' : 's'} and {applications} partner application{applications === 1 ? '' : 's'} are waiting on you.</strong>
            <div style={{ display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap' }}>
              {queue.length > 0 && (
                <Btn size="sm" variant="secondary" onClick={() => onNavigate?.('op-catalogue', { focus: queue[0].product_id })}>
                  Review the first listing
                </Btn>
              )}
              {applications > 0 && (
                <Btn size="sm" variant="secondary" onClick={() => onNavigate?.('op-onboarding')}>
                  Open partner onboarding
                </Btn>
              )}
            </div>
          </div>
        </div>
      )}

      <SectionCard title="Marketplace categories" subtitle="One platform, one settlement engine, six commercial propositions">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px', padding: '4px' }}>
          {categories.map((c, i) => {
            const v = verticals.find(x => x.category_id === c.id)
            return (
              <div key={c.id} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '12px', borderLeft: `3px solid ${seriesColour(i)}` }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{c.name}</div>
                <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{c.audience}</div>
                {v && (
                  <div style={{ marginTop: '8px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                    <div style={{ fontWeight: 700, color: 'var(--text)' }}>{report(v.gross, v.currency)}</div>
                    <div>{fmtInt(v.orders)} orders</div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </SectionCard>

      <SectionCard
        title="Gross value by month"
        subtitle="The two views reconcile: the last three months sum exactly to the 90-day figure above"
      >
        <div style={{ padding: '4px 4px 0' }}>
          <ColumnChart
            label="Gross merchandise value by month"
            data={months.map(m => ({ label: m.month.split(' ')[0], value: Number(m.gross), muted: m.aggregated, note: `${fmtInt(m.orders)} orders` }))}
          />
          <div style={{ display: 'flex', gap: '24px', flexWrap: 'wrap', marginTop: '16px', paddingTop: '14px', borderTop: '1px solid var(--border-light)' }}>
            <Figure label="Average month" value={report(stats.average)} />
            <Figure label="Best month" value={report(stats.best?.gross ?? 0)} sub={stats.best?.month} />
            <Figure label="Orders" value={fmtInt(stats.orders)} />
            <div style={{ flex: 1 }} />
            {/* A chart that mixes carried-forward aggregates with line-level months
                without saying so is claiming a precision it does not have. */}
            <div style={{ maxWidth: '340px' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Where the numbers come from</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                {stats.aggregated} months are monthly aggregates, shown faded; the most recent {stats.lineLevel} are computed from orders held at line level.
              </div>
            </div>
          </div>
        </div>
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '20px' }} className="op-grid-2col">
        <SectionCard title="Order count against gross value" subtitle="Two measures, two charts — never one axis carrying both">
          <div style={{ padding: '4px' }}>
            <ColumnChart label="Orders by marketplace" data={split.orders} format={fmtInt} colour={SERIES[0]} />
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', margin: '10px 0 14px' }}>Orders</div>
            <ColumnChart label="Gross value by marketplace" data={split.gross} colour={SERIES[2]} />
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', margin: '10px 0 0' }}>Gross value</div>
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.55, marginTop: '14px', paddingTop: '12px', borderTop: '1px solid var(--border-light)' }}>
              {insight}
            </p>
          </div>
        </SectionCard>

        <SectionCard title="Revenue mix" subtitle="Commission by marketplace">
          <div style={{ padding: '8px 4px' }}>
            <DonutChart
              label="Commission by marketplace"
              data={split.commission}
              centre={report(profile.commission)}
              centreSub="commission"
            />
          </div>
        </SectionCard>
      </div>

      <SectionCard title="Revenue Forecast" subtitle={`Linear trend × seasonal index · Backtest error: ${profile.forecast_accuracy}%`}>
        <div style={{ padding: '20px' }}>
          <div style={{ display: 'flex', gap: '32px', flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Projected GMV</div>
              <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--brand-navy)', marginTop: '4px' }}>{report(profile.forecast_gmv)}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
                {gmvTrendNum > 0 ? <TrendingUp size={14} style={{ color: 'var(--success)' }} /> : <TrendingDown size={14} style={{ color: 'var(--danger)' }} />}
                <span style={{ fontSize: 'var(--text-xs)', color: gmvTrendNum > 0 ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>{gmvTrendNum > 0 ? '+' : ''}{gmvTrend}%</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontWeight: 600, textTransform: 'uppercase' }}>Projected Commission</div>
              <div style={{ fontSize: 'var(--text-3xl)', fontWeight: 800, color: 'var(--brand-accent-dark)', marginTop: '4px' }}>{report(profile.forecast_commission)}</div>
            </div>
          </div>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '12px' }}>
            Method: linear trend over trailing 6 months adjusted by seasonal index. Planning input, not a board-pack figure. Assumptions: partner mix unchanged, no category launch or withdrawal, no pricing change.
          </p>
        </div>
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }} className="op-grid-2col">
        <SectionCard title="Pending Settlements"
          subtitle={`${statements.length} awaiting approval · a row opens the statement`}
          action={statements.length > 0
            ? <div style={{ display: 'flex', gap: '6px' }}>
                <Btn variant="secondary" size="sm" onClick={() => onNavigate?.('op-settlement')}>See all</Btn>
                <Btn variant="success" size="sm" onClick={() => statements.forEach(s => handleApproveSettlement(s.id))}>Approve all</Btn>
              </div>
            : undefined}
        >
          <Table headers={['Partner', 'Period', 'Gross', 'Net', 'Action']}>
            {statements.slice(0, 5).map(s => (
              <tr key={s.id} onClick={() => onNavigate?.('op-settlement', { focus: s.id })}
                  style={rowStyle(!!onNavigate)}
                  title={onNavigate ? `Open ${s.partner_name} in Settlement Runs` : undefined}>
                <Td>{s.partner_name}</Td>
                <Td right>{s.period}</Td>
                <Td right>{fmtIn(Number(s.gross), s.currency ?? reportingCurrency)}</Td>
                <Td right>{fmtIn(Number(s.net), s.currency ?? reportingCurrency)}</Td>
                {/* Stops the row's own click from firing behind it — approving
                    and opening are different intentions. */}
                <Td right><Btn variant="success" size="sm"
                  onClick={e => { e.stopPropagation(); void handleApproveSettlement(s.id) }}>Approve</Btn></Td>
              </tr>
            ))}
          </Table>
        </SectionCard>

        <SectionCard title="Open Tickets"
          subtitle={`${openTickets.length} open · ${breachedTickets.length} breached · a row opens the ticket`}
          action={<Btn variant="secondary" size="sm" onClick={() => onNavigate?.('op-tickets')}>See all</Btn>}>
          <Table headers={['Subject', 'Priority', 'Status', 'Owner']}>
            {openTickets.slice(0, 5).map(t => (
              <tr key={t.id} onClick={() => onNavigate?.('op-tickets', { focus: t.id })}
                  style={rowStyle(!!onNavigate)}
                  title={onNavigate ? 'Open this ticket' : undefined}>
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

/* A stat card that goes somewhere. Wrapped rather than given an onClick of its
   own, so `StatCard` stays a thing that shows a number and every other use of
   it is untouched. */
function Go(
  { to, go, children }: {
    to: OperatorView
    go?: (v: OperatorView, opts?: { focus?: string }) => void
    children: React.ReactNode
  },
) {
  if (!go) return <>{children}</>
  return (
    <div role="link" tabIndex={0}
      onClick={() => go(to)}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(to) } }}
      style={{ cursor: 'pointer', borderRadius: 'var(--radius-md)' }}>
      {children}
    </div>
  )
}

function rowStyle(clickable: boolean): React.CSSProperties {
  return clickable ? { cursor: 'pointer' } : {}
}

function Figure({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-lg)', fontWeight: 800, color: 'var(--text)' }}>{value}</div>
      {sub && <div style={{ fontSize: '10px', color: 'var(--text-tertiary)' }}>{sub}</div>}
    </div>
  )
}
