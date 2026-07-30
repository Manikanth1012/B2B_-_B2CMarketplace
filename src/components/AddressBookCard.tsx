import { useState, useEffect, useCallback } from 'react'
import { MapPin, Plus, Trash2, Check } from 'lucide-react'
import { supabase } from '../lib/supabase'
import {
  orderedAddresses, validateAddress, canDelete, formatAddress,
  type Address, type AddressDraft,
} from '../lib/addresses'

const EMPTY: AddressDraft = { label: '', line1: '', city: '', pin: '', phone: null, notes: null }

export function AddressBookCard({ showToast }: { showToast: (m: string) => void }) {
  const [addresses, setAddresses] = useState<Address[]>([])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<AddressDraft>(EMPTY)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    const { data } = await supabase.from('consumer_addresses').select('*')
    if (data) setAddresses(data as Address[])
  }, [])

  useEffect(() => { load() }, [load])

  const add = async () => {
    const problems = validateAddress(draft)
    if (problems.length > 0) {
      setErrors(Object.fromEntries(problems.map(p => [p.field, p.reason])))
      return
    }
    setErrors({})
    const { error } = await supabase.from('consumer_addresses').insert({
      id: 'AD-' + Date.now().toString().slice(-8),
      ...draft,
      /* The first address saved is the default, because a book with no default
         leaves Checkout with nothing to start on. */
      is_default: addresses.length === 0,
    })
    if (error) { showToast('We could not save that address'); return }
    setDraft(EMPTY)
    setAdding(false)
    await load()
    showToast('Address saved')
  }

  const makeDefault = async (id: string) => {
    /* Clear then set. A unique index allows only one default per customer, so both
       writes are needed and the order matters — setting first would collide. */
    await supabase.from('consumer_addresses').update({ is_default: false }).eq('is_default', true)
    await supabase.from('consumer_addresses').update({ is_default: true }).eq('id', id)
    await load()
    showToast('Default delivery address updated')
  }

  const remove = async (a: Address) => {
    if (!canDelete(a, addresses)) {
      showToast('Make another address the default first')
      return
    }
    await supabase.from('consumer_addresses').delete().eq('id', a.id)
    await load()
    showToast('Address removed')
  }

  return (
    <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
        <span style={{ color: 'var(--brand-accent-dark)' }}><MapPin size={18} /></span>
        <h2 style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>Delivery addresses</h2>
      </div>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: '20px' }}>
        Where physical orders go. The default is filled in at checkout.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {orderedAddresses(addresses).map(a => (
          <div key={a.id} style={{
            border: `1px solid ${a.is_default ? 'var(--brand-accent-dark)' : 'var(--border)'}`,
            borderRadius: 'var(--radius)', padding: '14px',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>{a.label}</span>
                  {a.is_default && (
                    <span style={{ padding: '1px 8px', borderRadius: '999px', fontSize: '10px', fontWeight: 700, background: 'var(--brand-accent-dark)', color: 'white' }}>
                      Default
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {formatAddress(a)}
                </div>
                {a.phone && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{a.phone}</div>}
                {/* The line that actually gets a parcel delivered. */}
                {a.notes && (
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontStyle: 'italic', marginTop: '4px' }}>
                    {a.notes}
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                {!a.is_default && (
                  <button onClick={() => makeDefault(a.id)} className="btn btn-secondary btn-sm" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Check size={13} /> Default
                  </button>
                )}
                <button
                  onClick={() => remove(a)}
                  aria-label={`Remove ${a.label}`}
                  disabled={!canDelete(a, addresses)}
                  title={canDelete(a, addresses) ? undefined : 'Make another address the default first'}
                  className="btn btn-secondary btn-sm"
                  style={{ color: 'var(--danger)', opacity: canDelete(a, addresses) ? 1 : 0.4 }}
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          </div>
        ))}

        {addresses.length === 0 && !adding && (
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', margin: 0 }}>
            No addresses saved yet. Add one and checkout will fill it in for you.
          </p>
        )}

        {adding ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '14px' }}>
            <AddrField label="Name (Home, Work…)" value={draft.label} error={errors.label}
              onChange={v => setDraft({ ...draft, label: v })} />
            <AddrField label="Street address" value={draft.line1} error={errors.line1}
              onChange={v => setDraft({ ...draft, line1: v })} />
            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 2 }}>
                <AddrField label="City" value={draft.city} error={errors.city}
                  onChange={v => setDraft({ ...draft, city: v })} />
              </div>
              <div style={{ flex: 1 }}>
                <AddrField label="Postcode" value={draft.pin} error={errors.pin}
                  onChange={v => setDraft({ ...draft, pin: v })} />
              </div>
            </div>
            <AddrField label="Phone (optional)" value={draft.phone ?? ''}
              onChange={v => setDraft({ ...draft, phone: v || null })} />
            <AddrField label="Delivery note (optional)" value={draft.notes ?? ''}
              onChange={v => setDraft({ ...draft, notes: v || null })} />
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={add} className="btn btn-primary btn-sm">Save address</button>
              <button onClick={() => { setAdding(false); setErrors({}) }} className="btn btn-secondary btn-sm">Cancel</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setAdding(true)} className="btn btn-secondary btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: '6px', alignSelf: 'flex-start' }}>
            <Plus size={14} /> Add an address
          </button>
        )}
      </div>
    </div>
  )
}

function AddrField({ label, value, error, onChange }: {
  label: string; value: string; error?: string; onChange: (v: string) => void
}) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: '4px' }}>
        {label}
      </label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        aria-label={label}
        aria-invalid={error ? true : undefined}
        style={{
          width: '100%', padding: '9px 12px', borderRadius: 'var(--radius)',
          border: `1px solid ${error ? 'var(--danger)' : 'var(--border)'}`,
          fontSize: 'var(--text-sm)', fontFamily: 'inherit', color: 'var(--text)',
        }}
      />
      {error && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', marginTop: '3px' }}>{error}</div>}
    </div>
  )
}
