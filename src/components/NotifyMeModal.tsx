import { useState } from 'react'
import { Bell, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Product, ConsumerProfile } from '../types'
import {
  CHANNELS, defaultAddressFor, validateDestination, WATCH_CAVEAT, type Channel,
} from '../lib/stockWatch'

/* Asks how to reach them rather than assuming. The prototype does the same, and the
   reason is that the channel is part of the promise being made. */

export function NotifyMeModal({ product, profile, onClose, onWatched }: {
  product: Product
  profile: Pick<ConsumerProfile, 'email' | 'msisdn'> | null
  onClose: () => void
  onWatched: (product: Product) => void
}) {
  const [channel, setChannel] = useState<Channel>('Email')
  const [to, setTo] = useState(() => defaultAddressFor('Email', profile ?? {}))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const pickChannel = (c: Channel) => {
    setChannel(c)
    setTo(defaultAddressFor(c, profile ?? {}))
    setError(null)
  }

  const submit = async () => {
    const problem = validateDestination(channel, to)
    if (problem) { setError(problem); return }

    setSaving(true)
    const { error: writeError } = await supabase.from('stock_watch').insert({
      id: `WCH-${Date.now().toString().slice(-8)}`,
      product_id: product.id,
      channel,
      to_address: to.trim(),
    })
    setSaving(false)

    if (writeError) {
      /* The unique index refuses a second open watch on the same product, which is
         the same request twice rather than an error worth alarming anyone about. */
      setError(/duplicate|unique/i.test(writeError.message)
        ? 'You are already on the list for this one.'
        : 'We could not set that up just now.')
      return
    }
    onWatched(product)
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
        aria-label={`Tell me when ${product.name} is back`}
        style={{ background: 'white', borderRadius: 'var(--radius-lg)', width: '100%', maxWidth: '440px', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid var(--border-light)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Bell size={18} style={{ color: 'var(--brand-accent-dark)' }} />
            <div>
              <h2 style={{ fontSize: 'var(--text-base)', fontWeight: 700, margin: 0 }}>Tell me when it is back</h2>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{product.name}</div>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)' }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '8px' }}>How should we tell you?</label>
            <div style={{ display: 'flex', gap: '8px' }}>
              {CHANNELS.map(c => (
                <button
                  key={c}
                  onClick={() => pickChannel(c)}
                  aria-pressed={channel === c}
                  style={{
                    padding: '8px 16px', borderRadius: 'var(--radius)', cursor: 'pointer',
                    fontSize: 'var(--text-sm)', fontWeight: 600,
                    border: `1px solid ${channel === c ? 'var(--brand-accent-dark)' : 'var(--border)'}`,
                    background: channel === c ? 'var(--brand-accent-dark)' : 'white',
                    color: channel === c ? 'white' : 'var(--text-secondary)',
                  }}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="watch-to" style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '8px' }}>
              {channel === 'SMS' ? 'Mobile number' : 'Email address'}
            </label>
            <input
              id="watch-to"
              value={to}
              onChange={e => { setTo(e.target.value); setError(null) }}
              style={{
                width: '100%', padding: '10px 12px', borderRadius: 'var(--radius)',
                border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
                fontSize: 'var(--text-sm)', fontFamily: 'inherit', color: 'var(--text)',
              }}
            />
          </div>

          {/* Said before the promise is made, not after. */}
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', background: 'var(--bg-alt)', padding: '10px 12px', borderRadius: 'var(--radius)', lineHeight: 1.5 }}>
            {WATCH_CAVEAT} We will tell you once, and you can cancel it from your account at any time.
          </div>

          {error && <div role="alert" style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)' }}>{error}</div>}
        </div>

        <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', padding: '16px 24px', borderTop: '1px solid var(--border-light)' }}>
          <button onClick={onClose} className="btn btn-secondary btn-sm">Cancel</button>
          <button onClick={submit} disabled={saving} className="btn btn-primary btn-sm">
            {saving ? 'Setting up…' : 'Tell me when it is back'}
          </button>
        </div>
      </div>
    </div>
  )
}
