import { useState, useEffect } from 'react'
import { Wallet, PieChart as PieIcon, SquareCheck as CheckSquare, ShoppingCart, TriangleAlert as AlertTriangle, TrendingUp, Cpu, Shield, Monitor, Search } from 'lucide-react'
import { StatCard, SectionCard, Table, Td, StatusPill, fmtInt, Btn, toast } from '../operator/shared'
import { VERTICAL_NAMES } from './data'
import { supabase } from '../../lib/supabase'
import { loadAccount } from '../../lib/enterpriseRepo'
import type { AccountBook } from '../../lib/enterpriseRepo'
import { waiting, committed, budgetPosition, NEED_LABEL } from '../../lib/enterprise'
import { useAccountMoney } from './money'
import type { EnterpriseView } from '../../types/view'

const TODAY = new Date().toISOString().slice(0, 10)

export function EnterpriseDashboard({ onNavigate }: { onNavigate: (v: EnterpriseView) => void }) {
  /* Budget, approvals and what the account holds all come from the account
     itself. They used to be constants, which meant this page and the Approvals
     and Billing screens quoted three different budgets. */
  const [book, setBook] = useState<AccountBook | null>(null)
  const [orders, setOrders] = useState<{ order_ref: string; seller: string; total: number; placed_date: string; failed: boolean; stage: number; stages: string[] }[]>([])
  useEffect(() => {
    void (async () => {
      setBook(await loadAccount())
      const { data } = await supabase.from('orders')
        .select('order_ref,seller,total,placed_date,failed,stage,stages')
        .order('created_at', { ascending: false })
      setOrders(data ?? [])
    })()
  }, [])

  const account = book?.account ?? null
  const { money, money0 } = useAccountMoney(account?.currency)
  const queue = book ? waiting(book.requisitions) : []
  const com = book ? committed(book.subscriptions) : { billed: 0, renewing: 0, suspended: 0 }
  const budget = book && account ? budgetPosition(book.invoices, account, TODAY) : null
  const suspended = book?.subscriptions.filter(s => s.status === 'suspended') ?? []
  const ordersInFlight = orders.filter(o => !o.failed && o.stage < o.stages.length - 1)
  const failedOrders = orders.filter(o => o.failed)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Procurement Dashboard</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            {account
              ? `${account.company} · ${account.id} · ${account.sites} sites, ${fmtInt(account.staff)} staff · ${account.terms}`
              : 'Loading your account…'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <Btn variant="secondary" onClick={() => onNavigate('en-approvals')}><CheckSquare size={14} /> Approvals ({queue.length})</Btn>
          <Btn variant="primary" onClick={() => onNavigate('en-browse')}><Search size={14} /> Browse catalogue</Btn>
        </div>
      </div>

      {suspended.map(sub => (
        <div key={sub.id} style={{
          display: 'flex', gap: '12px', alignItems: 'flex-start',
          padding: '14px 18px', borderRadius: 'var(--radius-md)',
          background: 'var(--danger-bg)', border: '1px solid var(--danger)',
        }}>
          <AlertTriangle size={18} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '1px' }} />
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>
            <strong>{sub.name} has been suspended by the marketplace.</strong> {sub.why_suspended}
            <button onClick={() => onNavigate('en-subs')} style={{ background: 'none', border: 'none', color: 'var(--danger)', textDecoration: 'underline', cursor: 'pointer', font: 'inherit', marginLeft: '4px' }}>See the subscription</button>
          </div>
        </div>
      ))}

      {/* Stat cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '16px' }}>
        <StatCard label="Committed monthly" value={money(com.billed)}
                  sublabel={com.suspended ? `${money(com.renewing)} renewing · ${money(com.suspended)} running to contract end` : `${book?.subscriptions.filter(s => s.status === 'active').length ?? 0} active subscriptions`}
                  color="var(--brand-navy)" />
        <StatCard label="Budget used" value={budget ? `${budget.pct}%` : '—'}
                  sublabel={budget ? `${money0(budget.spent)} of ${money0(budget.budget)} · ${money0(budget.left)} left · ${budget.yearPct}% of the year gone` : ''}
                  color={budget?.ahead ? 'var(--warning)' : 'var(--brand-accent-dark)'} />
        <StatCard label="Awaiting approval" value={fmtInt(queue.length)}
                  sublabel={`${money(queue.reduce((a, r) => a + Number(r.amount), 0))} of requests`} color="var(--warning)" />
        <StatCard label="Orders in flight" value={fmtInt(ordersInFlight.length)} sublabel={failedOrders.length ? `${failedOrders.length} failed` : 'Provisioning and delivery'} color={failedOrders.length ? 'var(--danger)' : undefined} />
      </div>

      {/* Buy from tiles */}
      <SectionCard title="Buy from" subtitle="Your account can buy from the IoT, Security and Device marketplaces">
        <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px' }}>
          {[
            { v: 'iot', name: 'IoT Marketplace', icon: <Cpu size={24} />, color: '#006B6B' },
            { v: 'security', name: 'Security Marketplace', icon: <Shield size={24} />, color: '#B45309' },
            { v: 'device', name: 'Device Marketplace', icon: <Monitor size={24} />, color: '#5E4B9B' },
          ].map(t => (
            <button
              key={t.v}
              onClick={() => onNavigate(t.v === 'iot' ? 'en-iot' : t.v === 'security' ? 'en-security' : 'en-devices')}
              style={{
                display: 'flex', flexDirection: 'column', gap: '6px', padding: '16px',
                borderRadius: 'var(--radius-md)', border: '1px solid var(--border)',
                background: 'white', cursor: 'pointer', textAlign: 'left', transition: 'all 200ms ease',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--brand-accent)'; e.currentTarget.style.background = 'var(--bg-alt)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'white' }}
            >
              <div style={{ width: 40, height: 40, borderRadius: 'var(--radius)', display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${t.color}15`, color: t.color }}>
                {t.icon}
              </div>
              <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{t.name}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{(book?.subscriptions ?? []).filter(s => s.vertical === t.v && s.status === 'active').length} active subscriptions</div>
            </button>
          ))}
        </div>
      </SectionCard>

      {/* Spend charts */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }} className="op-grid-2col">
        <SectionCard title="Spend against budget" subtitle="Financial year to date">
          <div style={{ padding: '20px' }}>
            {['Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul'].map((m, i) => {
              const monthly = Math.round((budget?.spent ?? 0) / 12 * (0.8 + i * 0.035))
              const budgetPerMonth = Math.round((budget?.budget ?? 0) / 12)
              return (
                <div key={m} style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                  <span style={{ fontSize: 'var(--text-xs)', width: '30px', color: 'var(--text-tertiary)' }}>{m}</span>
                  <div style={{ flex: 1, height: '14px', borderRadius: '3px', background: 'var(--bg-alt)', overflow: 'hidden', position: 'relative' }}>
                    <div style={{ position: 'absolute', inset: 0, width: `${budgetPerMonth ? (monthly / budgetPerMonth) * 100 : 0}%`, background: 'var(--brand-accent-dark)', borderRadius: '3px' }} />
                  </div>
                  <span style={{ fontSize: 'var(--text-xs)', width: '78px', textAlign: 'right', color: 'var(--text-tertiary)' }}>{money0(monthly)}</span>
                </div>
              )
            })}
          </div>
        </SectionCard>

        <SectionCard title="Spend by marketplace" subtitle="Monthly recurring">
          <div style={{ padding: '20px' }}>
            {['iot', 'security', 'device'].map(v => {
              const subs = book?.subscriptions ?? []
              const spend = subs.filter(s => s.vertical === v && s.status === 'active').reduce((a, s) => a + Number(s.monthly), 0)
              const max = Math.max(...['iot', 'security', 'device'].map(x => subs.filter(s => s.vertical === x && s.status === 'active').reduce((a, s) => a + Number(s.monthly), 0)), 1)
              return (
                <div key={v} style={{ marginBottom: '14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--text-sm)', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 500 }}>{VERTICAL_NAMES[v]?.replace(' Marketplace', '')}</span>
                    <span style={{ color: 'var(--text-tertiary)' }}>{money(spend)}/mo</span>
                  </div>
                  <div style={{ height: '10px', borderRadius: '5px', background: 'var(--bg-alt)', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(spend / max) * 100}%`, background: v === 'iot' ? '#006B6B' : v === 'security' ? '#B45309' : '#5E4B9B', borderRadius: '5px' }} />
                  </div>
                </div>
              )
            })}
            <div style={{ marginTop: '16px', paddingTop: '12px', borderTop: '1px solid var(--border-light)', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              One-off purchases are not in this split — it is monthly commitment only. One-off ordered to date:
              {money(orders.filter(o => !o.failed).reduce((a, o) => a + Number(o.total), 0))}
            </div>
          </div>
        </SectionCard>
      </div>

      {/* Pending approvals + Orders */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }} className="op-grid-2col">
        <SectionCard title="Waiting on an approver" subtitle={`${queue.length} pending`}>
          <div style={{ padding: '0 20px 20px' }}>
            {queue.map(a => (
              <div key={a.id} style={{ display: 'flex', gap: '11px', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: 'var(--radius)', background: 'var(--bg-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  {a.vertical === 'iot' ? <Cpu size={15} style={{ color: 'var(--text-tertiary)' }} /> : <Shield size={15} style={{ color: 'var(--text-tertiary)' }} />}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{a.title}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {book?.members.find(m => m.id === a.raised_by)?.name ?? a.raised_by} · {a.raised_at} · {NEED_LABEL[a.need]}
                  </div>
                </div>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{money(Number(a.amount))}</div>
              </div>
            ))}
            <Btn variant="secondary" size="sm" style={{ marginTop: '12px' }} onClick={() => onNavigate('en-approvals')}>Open approvals</Btn>
          </div>
        </SectionCard>

        <SectionCard title="Provisioning and delivery" subtitle="Recent orders">
          <div style={{ padding: '0 20px 20px' }}>
            {orders.slice(0, 4).map(o => (
              <div key={o.order_ref} style={{ display: 'flex', gap: '11px', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border-light)' }}>
                <div style={{ width: '34px', height: '34px', borderRadius: 'var(--radius)', background: 'var(--bg-alt)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <ShoppingCart size={15} style={{ color: 'var(--text-tertiary)' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{o.stages[o.stage] ?? '—'}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{o.order_ref} · {o.seller} · {o.placed_date}</div>
                </div>
                {o.failed ? <StatusPill status="rejected" /> : o.stage < o.stages.length - 1 ? <StatusPill status="open" /> : <StatusPill status="resolved" />}
              </div>
            ))}
            <Btn variant="secondary" size="sm" style={{ marginTop: '12px' }} onClick={() => onNavigate('en-orders')}>All orders</Btn>
          </div>
        </SectionCard>
      </div>
    </div>
  )
}
