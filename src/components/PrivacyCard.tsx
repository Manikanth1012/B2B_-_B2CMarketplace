import { useState, useEffect, useCallback } from 'react'
import { ShieldCheck, Download, TriangleAlert } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { requestWalletReturn, cancelWalletReturn } from '../lib/walletRepo'
import type { ConsumerProfile } from '../types'
import {
  SHARING, REQUEST_KINDS, REQUEST_IMPACT, dueDate, toIsoDate,
  CLOSURE_REASONS, CLOSURE_CONFIRM_WORD, CLOSURE_NOTICE_DAYS,
  closureEffective, closureImpact, canScheduleClosure,
  type RequestKind,
} from '../lib/privacy'
import { formatDateOnly } from '../lib/subscriptions'
import { useMarket } from '../lib/MarketContext'

interface DataRequest { id: string; kind: string; raised: string; due: string; status: string }

/* Privacy, in the shape the prototype uses: a statement of what is shared, the data
   requests already raised, and account closure on notice. */

export function PrivacyCard({ profile, showToast }: {
  profile: ConsumerProfile
  showToast: (m: string) => void
}) {
  const { fmtIn } = useMarket()
  const [requests, setRequests] = useState<DataRequest[]>([])
  const [asking, setAsking] = useState(false)
  const [kind, setKind] = useState<RequestKind>(REQUEST_KINDS[0])
  const [closing, setClosing] = useState(false)
  const [typed, setTyped] = useState('')
  const [reason, setReason] = useState<string>(CLOSURE_REASONS[0])
  const [impact, setImpact] = useState<string[]>([])
  const [closure, setClosure] = useState<string | null>(profile.closure_effective ?? null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('consumer_data_requests').select('*').order('raised', { ascending: false })
    if (data) setRequests(data as DataRequest[])
  }, [])

  useEffect(() => { load() }, [load])

  const audit = async (action: string, label: string, detail: string, severity = 'notice') => {
    const now = new Date()
    await supabase.from('consumer_audit_log').insert({
      id: 'AUD-CU-' + Date.now(),
      when_date: now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ' ' +
                 now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }),
      action, label, category: 'Privacy', severity, detail,
    })
  }

  const raiseRequest = async () => {
    const raised = new Date()
    const ref = `DSR-${Date.now().toString().slice(-6)}`
    const { error } = await supabase.from('consumer_data_requests').insert({
      id: ref, kind, raised: toIsoDate(raised), due: toIsoDate(dueDate(raised)), status: 'open',
    })
    if (error) { showToast('We could not raise that just now'); return }
    await audit('data.requested', 'Data export requested', kind)
    setAsking(false)
    await load()
    showToast(`Request raised — ${ref}, due ${formatDateOnly(toIsoDate(dueDate(raised)))}`)
  }

  /* The impact is worked out from live data when the dialog opens, not written into
     the markup — somebody about to close an account is owed the specifics. */
  const openClosure = async () => {
    const [subs, orders, household, wallet, cards] = await Promise.all([
      supabase.from('subscriptions').select('price, status'),
      supabase.from('orders').select('status'),
      supabase.from('consumer_household').select('id'),
      /* The two pots, read rather than assumed. Only one of them comes back,
         and telling somebody otherwise is a complaint already earned. */
      supabase.from('wallets').select('cash, promo, balance').maybeSingle(),
      supabase.from('consumer_payment_methods').select('detail, is_primary')
        .order('is_primary', { ascending: false }).limit(1),
    ])
    const active = (subs.data ?? []).filter(s => s.status === 'active') as { price: number }[]
    const inFlight = (orders.data ?? []).filter(o => !['refunded', 'cancelled', 'delivered'].includes(o.status)).length
    const effective = toIsoDate(closureEffective(new Date()))
    setImpact(closureImpact({
      activeSubscriptions: active,
      ordersInFlight: inFlight,
      walletBalance: Number(wallet.data?.balance ?? profile.wallet),
      walletCash: wallet.data ? Number(wallet.data.cash) : undefined,
      walletPromo: wallet.data ? Number(wallet.data.promo) : undefined,
      refundInstrument: (cards.data ?? [])[0]?.detail ?? null,
      householdMembers: (household.data ?? []).length,
    }, formatDateOnly(effective)))
    setTyped('')
    setClosing(true)
  }

  const scheduleClosure = async () => {
    const requested = new Date()
    const effective = toIsoDate(closureEffective(requested))
    await supabase.from('consumer_profile').update({
      closure_requested_at: toIsoDate(requested), closure_effective: effective, closure_reason: reason,
    }).eq('user_id', profile.user_id)
    /* The wallet is frozen and the return is registered now, but no money moves
       until the closure actually completes — they can still change their mind. */
    const { data: w } = await supabase.from('wallets').select('id, currency').maybeSingle()
    const { data: card } = await supabase.from('consumer_payment_methods')
      .select('detail').order('is_primary', { ascending: false }).limit(1)
    let walletNote = ''
    if (w) {
      const res = await requestWalletReturn({
        walletId: w.id,
        instrument: (card ?? [])[0]?.detail ?? null,
        effective: formatDateOnly(effective),
      })
      if (!res.ok) { showToast(res.reason); return }
      if (res.cashReturned && res.cashReturned > 0) {
        /* The wallet's own currency, not the market the storefront is set to —
           money already in a wallet comes back in the money it went in as. */
        walletNote = ` · ${fmtIn(res.cashReturned, w.currency)} will be returned to you`
      }
    }

    await audit('account.closure_scheduled', 'Account closure scheduled', `Effective ${effective} · ${reason}`, 'warning')
    setClosure(effective)
    setClosing(false)
    showToast(`Closure scheduled for ${formatDateOnly(effective)} — you can stop it any time before then${walletNote}`)
  }

  const cancelClosure = async () => {
    await supabase.from('consumer_profile').update({
      closure_requested_at: null, closure_effective: null, closure_reason: null,
    }).eq('user_id', profile.user_id)
    const { data: w } = await supabase.from('wallets').select('id, currency').maybeSingle()
    if (w) await cancelWalletReturn(w.id)
    await audit('account.closure_cancelled', 'Account closure withdrawn', 'Account stays open')
    setClosure(null)
    showToast('Closure cancelled — your account and wallet stay open')
  }

  return (
    <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
        <span style={{ color: 'var(--brand-accent-dark)' }}><ShieldCheck size={18} /></span>
        <h2 style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>Privacy</h2>
      </div>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: '20px' }}>
        What sellers see, and what you can ask us for
      </p>

      {/* Stated, not switched. A toggle that cannot really stop the sharing — a seller
          shipping a parcel must have the address — would be worse than the sentence. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '20px' }}>
        {SHARING.map(s => (
          <div key={s.what} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text)' }}>{s.what}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.45 }}>{s.detail}</div>
            </div>
            <span style={{
              flexShrink: 0, padding: '2px 10px', borderRadius: '999px', fontSize: 'var(--text-xs)', fontWeight: 700,
              background: s.shared ? '#DBEAFE' : '#DCFCE7', color: s.shared ? '#1D4ED8' : '#15803D',
            }}>
              {s.shared ? 'Shared' : 'Never'}
            </span>
          </div>
        ))}
      </div>

      <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '16px', marginBottom: '16px' }}>
        <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '8px' }}>A copy of your data</h3>
        {requests.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '12px' }}>
            {requests.map(r => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <div>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{r.kind}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    Raised {formatDateOnly(r.raised)} · {r.id}
                  </div>
                </div>
                <span style={{ flexShrink: 0, padding: '2px 10px', borderRadius: '999px', fontSize: 'var(--text-xs)', fontWeight: 700, background: '#FEF3C7', color: '#92400E' }}>
                  Due {formatDateOnly(r.due)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: '0 0 12px', lineHeight: 1.5 }}>
            You can ask for a copy of everything held about you. We have {CLOSURE_NOTICE_DAYS} days to answer,
            and it arrives as a download link to your registered email.
          </p>
        )}

        {asking ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <select value={kind} onChange={e => setKind(e.target.value as RequestKind)} style={selectStyle}>
              {REQUEST_KINDS.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
              {REQUEST_IMPACT.map(i => <li key={i}>{i}</li>)}
            </ul>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={raiseRequest} className="btn btn-primary btn-sm">Request my data</button>
              <button onClick={() => setAsking(false)} className="btn btn-secondary btn-sm">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAsking(true)} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <Download size={14} /> Request my data
          </button>
        )}
      </div>

      <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '16px' }}>
        <h3 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '8px' }}>Closing your account</h3>

        {closure ? (
          <div style={{ background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 'var(--radius)', padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--text-sm)', color: '#92400E', fontWeight: 600 }}>
              <TriangleAlert size={15} /> Closure scheduled for {formatDateOnly(closure)}
            </div>
            <p style={{ margin: 0, fontSize: 'var(--text-xs)', color: '#92400E', lineHeight: 1.5 }}>
              Everything keeps working until then. You can stop this at any point.
            </p>
            <button onClick={cancelClosure} className="btn btn-secondary btn-sm" style={{ alignSelf: 'flex-start' }}>
              Keep my account
            </button>
          </div>
        ) : closing ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <select value={reason} onChange={e => setReason(e.target.value)} style={selectStyle}>
              {CLOSURE_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
            <ul style={{ margin: 0, paddingLeft: '18px', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {impact.map(i => <li key={i}>{i}</li>)}
            </ul>
            <input
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder={`Type ${CLOSURE_CONFIRM_WORD} to confirm`}
              aria-label={`Type ${CLOSURE_CONFIRM_WORD} to confirm`}
              style={selectStyle}
            />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                onClick={scheduleClosure}
                disabled={!canScheduleClosure(typed)}
                className="btn btn-sm"
                style={{
                  background: 'var(--danger)', color: 'white', border: 'none',
                  opacity: canScheduleClosure(typed) ? 1 : 0.45,
                  cursor: canScheduleClosure(typed) ? 'pointer' : 'not-allowed',
                }}
              >
                Schedule closure
              </button>
              <button onClick={() => setClosing(false)} className="btn btn-secondary btn-sm">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={openClosure} className="btn btn-secondary btn-sm" style={{ color: 'var(--danger)' }}>
            Close my account
          </button>
        )}
      </div>
    </div>
  )
}

const selectStyle: React.CSSProperties = {
  width: '100%', padding: '9px 12px', borderRadius: 'var(--radius)',
  border: '1px solid var(--border)', fontSize: 'var(--text-sm)',
  fontFamily: 'inherit', color: 'var(--text)', background: 'white',
}
