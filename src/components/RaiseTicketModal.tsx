import { useState } from 'react'
import { LifeBuoy, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Order } from '../types'
import {
  TICKET_CATEGORIES, buildTicket, validateNote, severityFor, slaFor,
  type TicketCategory,
} from '../lib/orderTickets'

/* Raising a ticket against an order. The rules — which categories exist, what
   severity each carries, what counts as a usable description — live in
   lib/orderTickets so they can be tested without a DOM. */

export function RaiseTicketModal({ order, raisedBy, onClose, onRaised }: {
  order: Order
  raisedBy: string
  onClose: () => void
  onRaised: (ref: string) => void
}) {
  const [category, setCategory] = useState<TicketCategory>('delivery')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const severity = severityFor(category)
  const slaHours = Math.round(slaFor(severity) / 60)

  const submit = async () => {
    const check = validateNote(note)
    if (!check.ok) { setError(check.reason); return }

    setSaving(true)
    setError('')
    const draft = buildTicket(order, category, note, raisedBy)
    /* `support_tickets` has no default on user_id — the shared queue holds
       tickets from four personas, so who raised it has to be stated rather
       than assumed from the connection. */
    const { data: session } = await supabase.auth.getUser()
    /* The insert policy requires user_id to match the caller, so a ticket
       cannot be filed against somebody else's account even if this payload
       said so — and `guard_ticket` overwrites the SLA fields with the ones the
       policy sets, so a client cannot give itself a longer target either. */
    const { error: writeError } = await supabase.from('support_tickets').insert({ ...draft, user_id: session.user?.id ?? null })
    setSaving(false)

    if (writeError) { setError('We could not raise that just now. Please try again.'); return }
    onRaised(draft.id)
  }

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: '24px' }}
    >
      <div
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`Raise a ticket on ${order.order_ref}`}
        style={{ background: 'white', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '480px', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border-light)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <LifeBuoy size={20} style={{ color: 'var(--brand-accent-dark)' }} />
            <div>
              <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 700, margin: 0 }}>Get help with this order</h2>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                {order.order_ref}{order.seller && ` · ${order.seller}`}
              </div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '8px' }}>
              What is this about?
            </label>
            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
              {TICKET_CATEGORIES.map(c => (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  aria-pressed={category === c}
                  style={{
                    padding: '8px 14px', borderRadius: 'var(--radius)', cursor: 'pointer',
                    fontSize: 'var(--text-sm)', fontWeight: 600,
                    border: `1px solid ${category === c ? 'var(--brand-accent-dark)' : 'var(--border)'}`,
                    background: category === c ? 'var(--brand-accent-dark)' : 'white',
                    color: category === c ? 'white' : 'var(--text-secondary)',
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="ticket-note" style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '8px' }}>
              Tell us what happened
            </label>
            <textarea
              id="ticket-note"
              value={note}
              onChange={e => { setNote(e.target.value); setError('') }}
              rows={4}
              placeholder="The parcel was marked delivered but nothing arrived."
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 'var(--radius)',
                border: '1px solid var(--border)', fontSize: 'var(--text-sm)',
                fontFamily: 'inherit', resize: 'vertical',
              }}
            />
          </div>

          {/* The promise being made, before it is made. */}
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', background: 'var(--bg-alt)', padding: '10px 12px', borderRadius: 'var(--radius)' }}>
            Raised as <strong style={{ color: 'var(--text-secondary)' }}>{severity}</strong> — we aim to respond within {slaHours} hours.
          </div>

          {error && (
            <div role="alert" style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', padding: '16px 24px', borderTop: '1px solid var(--border-light)' }}>
          <button onClick={onClose} className="btn btn-secondary btn-sm">Cancel</button>
          <button onClick={submit} disabled={saving} className="btn btn-primary btn-sm">
            {saving ? 'Raising…' : 'Raise ticket'}
          </button>
        </div>
      </div>
    </div>
  )
}
