import { useState, useEffect } from 'react'
import { RefreshCw, Pause, Play, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Subscription } from '../types'
import { statusLine, monthlyTotal, actionsFor, isActive } from '../lib/subscriptions'

export function SubscriptionsView() {
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('subscriptions').select('*').order('started_at', { ascending: false }).then(({ data }) => {
      if (data) setSubs(data as Subscription[])
      setLoading(false)
    })
  }, [])

  /* Every mutation writes, then mirrors the same change locally rather than
     refetching — the row is small and the screen should not flicker. */
  const patch = async (id: string, change: Partial<Subscription>) => {
    await supabase.from('subscriptions').update(change).eq('id', id)
    setSubs(subs.map(s => s.id === id ? { ...s, ...change } : s))
  }

  const toggleAutoRenew = (s: Subscription) => patch(s.id, { auto_renew: !s.auto_renew })

  /* Cancelling keeps the access already paid for rather than cutting it off today:
     `ends_at` becomes the renewal date that will now not happen. */
  const cancel = (s: Subscription) =>
    patch(s.id, { status: 'cancelled', auto_renew: false, ends_at: s.next_renewal, next_renewal: null })

  const resume = (s: Subscription) =>
    patch(s.id, { status: 'active', auto_renew: true, next_renewal: s.resumes_at, resumes_at: null })

  if (loading) {
    return (
      <section style={{ padding: '64px 0' }}>
        <div className="container" style={{ textAlign: 'center' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      </section>
    )
  }

  if (subs.length === 0) {
    return (
      <section style={{ padding: '64px 0' }}>
        <div className="container" style={{ textAlign: 'center', maxWidth: '400px', margin: '0 auto' }}>
          <RefreshCw size={48} style={{ margin: '0 auto 16px', opacity: 0.3 }} />
          <h2 style={{ marginBottom: '8px' }}>No subscriptions</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Your active recurring services will appear here.</p>
        </div>
      </section>
    )
  }

  const activeCount = subs.filter(isActive).length
  const total = monthlyTotal(subs)

  return (
    <section style={{ padding: '32px 0 64px' }}>
      <div className="container" style={{ maxWidth: '800px' }}>
        <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, marginBottom: '8px' }}>My Subscriptions</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '24px' }}>
          Manage your recurring services — pause, resume, or cancel anytime.
        </p>

        {/* What the consumer is actually committed to. Counts only what is billing:
            a paused or cancelled row is not part of the monthly figure. */}
        <div className="card" style={{ padding: '16px 20px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            {activeCount} active of {subs.length}
          </span>
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
            Billing <strong style={{ color: 'var(--text)', fontSize: 'var(--text-lg)', fontWeight: 800 }}>${total.toFixed(2)}</strong>/mo
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {subs.map((sub) => {
            const can = actionsFor(sub)
            const showActions = can.canToggleRenew || can.canCancel || can.canResume
            return (
              <div key={sub.id} className="card" style={{ padding: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '16px' }}>
                  <div style={{ minWidth: 0 }}>
                    <h3 style={{ fontWeight: 600, fontSize: 'var(--text-base)', marginBottom: '2px' }}>
                      {sub.product_name}
                    </h3>
                    {sub.seller && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                        {sub.seller}
                      </div>
                    )}
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      {statusLine(sub)}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>
                      ${sub.price.toFixed(2)}
                      <span style={{ fontSize: 'var(--text-xs)', fontWeight: 500, color: 'var(--text-tertiary)' }}>
                        /{(sub.cycle ?? 'Monthly').toLowerCase() === 'monthly' ? 'mo' : sub.cycle}
                      </span>
                    </div>
                    <span className={`badge ${isActive(sub) ? 'badge-stock-in' : 'badge-stock-out'}`}>
                      {sub.status}
                    </span>
                  </div>
                </div>

                {showActions && (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-light)' }}>
                    {can.canToggleRenew && (
                      <button
                        onClick={() => toggleAutoRenew(sub)}
                        className="btn btn-secondary btn-sm"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        {sub.auto_renew ? <><Pause size={14} /> Pause auto-renew</> : <><Play size={14} /> Resume auto-renew</>}
                      </button>
                    )}
                    {can.canResume && (
                      <button
                        onClick={() => resume(sub)}
                        className="btn btn-secondary btn-sm"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <Play size={14} /> Resume now
                      </button>
                    )}
                    {can.canCancel && (
                      <button
                        onClick={() => cancel(sub)}
                        className="btn btn-ghost btn-sm"
                        style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '6px' }}
                      >
                        <X size={14} /> Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
