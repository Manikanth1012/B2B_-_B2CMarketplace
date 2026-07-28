import { useState, useEffect } from 'react'
import { RefreshCw, Pause, Play, X, CreditCard } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Subscription } from '../types'

export function SubscriptionsView() {
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('subscriptions').select('*').order('started_at', { ascending: false }).then(({ data }) => {
      if (data) setSubs(data as Subscription[])
      setLoading(false)
    })
  }, [])

  const toggleAutoRenew = async (id: string, current: boolean) => {
    await supabase.from('subscriptions').update({ auto_renew: !current }).eq('id', id)
    setSubs(subs.map((s) => s.id === id ? { ...s, auto_renew: !current } : s))
  }

  const cancelSub = async (id: string) => {
    await supabase.from('subscriptions').update({ status: 'cancelled', auto_renew: false }).eq('id', id)
    setSubs(subs.map((s) => s.id === id ? { ...s, status: 'cancelled', auto_renew: false } : s))
  }

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

  return (
    <section style={{ padding: '32px 0 64px' }}>
      <div className="container" style={{ maxWidth: '800px' }}>
        <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, marginBottom: '8px' }}>My Subscriptions</h1>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>
          Manage your recurring services — pause, resume, or cancel anytime.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {subs.map((sub) => (
            <div key={sub.id} className="card" style={{ padding: '20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                <div>
                  <h3 style={{ fontWeight: 600, fontSize: 'var(--text-base)', marginBottom: '4px' }}>
                    {sub.product_name}
                  </h3>
                  <div style={{ display: 'flex', gap: '12px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    <span>Started {new Date(sub.started_at).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</span>
                    {sub.next_renewal && sub.status === 'active' && (
                      <span>· Renews {new Date(sub.next_renewal).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</span>
                    )}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>${sub.price.toFixed(2)}/mo</div>
                  <span className={`badge ${sub.status === 'active' ? 'badge-stock-in' : 'badge-stock-out'}`}>
                    {sub.status}
                  </span>
                </div>
              </div>
              {sub.status === 'active' && (
                <div style={{ display: 'flex', gap: '8px', marginTop: '16px', paddingTop: '16px', borderTop: '1px solid var(--border-light)' }}>
                  <button
                    onClick={() => toggleAutoRenew(sub.id, sub.auto_renew)}
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    {sub.auto_renew ? <><Pause size={14} /> Pause auto-renew</> : <><Play size={14} /> Resume auto-renew</>}
                  </button>
                  <button
                    onClick={() => cancelSub(sub.id)}
                    className="btn btn-ghost btn-sm"
                    style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '6px' }}
                  >
                    <X size={14} /> Cancel
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
