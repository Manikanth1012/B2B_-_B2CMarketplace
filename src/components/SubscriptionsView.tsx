import { useState, useEffect } from 'react'
import { RefreshCw, Pause, Play, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Subscription } from '../types'
import { statusLine, monthlyTotal, billingCurrency, actionsFor, isActive } from '../lib/subscriptions'
import { useMarket } from '../lib/MarketContext'
import { StatusBadge } from './ui'
import { AccountPage } from './account/AccountPage'
import { statusTone } from '../lib/consoleTone'

export function SubscriptionsView() {
  const [subs, setSubs] = useState<Subscription[]>([])
  const [loading, setLoading] = useState(true)
  /* Formatted in the currency the rows carry, not in the one the visitor has
     chosen in the market picker: this is what the account is billed, and it
     does not change because somebody is browsing in dollars. */
  const { fmtIn } = useMarket()

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
      <AccountPage title="My Subscriptions">
        <div style={{ textAlign: 'center', padding: '32px 0' }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      </AccountPage>
    )
  }

  if (subs.length === 0) {
    return (
      <AccountPage title="My Subscriptions">
        <div className="acct-empty">
          <RefreshCw size={48} aria-hidden="true" style={{ margin: '0 auto 16px', opacity: 0.3 }} />
          <h2 style={{ marginBottom: '8px' }}>No subscriptions</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Your active recurring services will appear here.</p>
        </div>
      </AccountPage>
    )
  }

  const activeCount = subs.filter(isActive).length
  const total = monthlyTotal(subs)
  /* Null when the rows disagree, which the guard now prevents — but a total
     labelled with a currency picked from the first row would be a lie in
     exactly the case that matters. */
  const currency = billingCurrency(subs)

  return (
    <AccountPage
      title="My Subscriptions"
      subtitle="Manage your recurring services — pause, resume, or cancel anytime."
    >
      {/* What the consumer is actually committed to. Counts only what is billing:
          a paused or cancelled row is not part of the monthly figure. */}
      <div className="sub-summary">
        <span>{activeCount} active of {subs.length}</span>
        <span>
          Billing <strong className="sub-summary__total">
            {currency ? fmtIn(total, currency) : total.toFixed(2)}
          </strong>/mo
        </span>
      </div>

      <div className="sub-list">
        {subs.map((sub) => {
          const can = actionsFor(sub)
          const showActions = can.canToggleRenew || can.canCancel || can.canResume
          return (
            <article key={sub.id} className="sub-card">
              <div className="sub-card__info">
                <h2 className="sub-card__name">{sub.product_name}</h2>
                {sub.seller && <div className="sub-card__meta">{sub.seller}</div>}
                <div className="sub-card__meta">{statusLine(sub)}</div>
              </div>
              <div className="sub-card__price">
                <div className="sub-card__amount">
                  {fmtIn(sub.price, sub.currency)}
                  <span className="sub-card__cycle">
                    /{(sub.cycle ?? 'Monthly').toLowerCase() === 'monthly' ? 'mo' : sub.cycle}
                  </span>
                </div>
                <StatusBadge tone={statusTone(sub.status.toLowerCase())}>{sub.status}</StatusBadge>
              </div>

              {showActions && (
                <div className="sub-card__actions">
                  {can.canToggleRenew && (
                    <button type="button" onClick={() => toggleAutoRenew(sub)} className="acct-btn">
                      {sub.auto_renew ? <><Pause size={16} aria-hidden="true" /> Pause auto-renew</> : <><Play size={16} aria-hidden="true" /> Resume auto-renew</>}
                    </button>
                  )}
                  {can.canResume && (
                    <button type="button" onClick={() => resume(sub)} className="acct-btn">
                      <Play size={16} aria-hidden="true" /> Resume now
                    </button>
                  )}
                  {can.canCancel && (
                    <button type="button" onClick={() => cancel(sub)} className="acct-btn acct-btn--danger">
                      <X size={16} aria-hidden="true" /> Cancel
                    </button>
                  )}
                </div>
              )}
            </article>
          )
        })}
      </div>
    </AccountPage>
  )
}
