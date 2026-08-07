import { useState, useEffect } from 'react'
import { Smartphone } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { loadHeldBy, onNetwork } from '../lib/numbersRepo'
import {
  STATE_LABEL, ESIM_ORDER, ESIM_LABEL, formatMsisdn,
} from '../lib/numbers'
import type { HeldNumber, EsimProfile } from '../lib/numbers'

/* The customer's own number.
 *
 * The profile screen has been showing an MSISDN since it was written, typed
 * into `consumer_profile` as a display string with nothing behind it. This is
 * the allocation: the number, the SIM it is paired with, the plan it is on, and
 * for an eSIM how far the profile has got.
 *
 * Read-only on purpose. Releasing a number puts it into a ninety-day quarantine
 * and is not something to offer beside a name and an email address.
 */

export function MyNumberCard({ userId }: { userId: string | null }) {
  const [rows, setRows] = useState<HeldNumber[] | null>(null)
  const [profiles, setProfiles] = useState<EsimProfile[]>([])
  /* A marketplace account is not a network subscription. Somebody can sign up,
     buy a router and never be a telco customer, and this card vanishing without
     a word leaves them wondering where their number went. */
  const [subscriber, setSubscriber] = useState<boolean | null>(null)

  useEffect(() => {
    if (!userId) { setRows([]); setSubscriber(false); return }
    void loadHeldBy({ user_id: userId }).then(setRows)
    void onNetwork(userId).then(setSubscriber)
    void supabase.from('esim_profile').select('*').then(({ data }) =>
      setProfiles((data ?? []) as EsimProfile[]))
  }, [userId])

  if (rows === null || subscriber === null) return null

  /* Said rather than hidden. The marketplace sells connectivity, so "you have
     not got any" is an answer somebody may want to act on. */
  if (!subscriber) {
    return (
      <div style={{
        background: 'white', border: '1px solid var(--border)',
        borderRadius: 'var(--radius-md)', padding: '16px 18px',
      }}>
        <h3 style={{
          fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text)',
          display: 'flex', gap: '8px', alignItems: 'center',
        }}>
          <Smartphone size={16} style={{ color: 'var(--text-tertiary)' }} />
          No mobile number or SIM
        </h3>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '6px', lineHeight: 1.5 }}>
          This is a marketplace account. You can buy from any seller here without being an Aventa mobile
          customer, and a number and a SIM come with a network subscription rather than with the account —
          which starts with an identity check the marketplace does not do. The number on your details above
          is how we contact you, not a line with us.
        </p>
      </div>
    )
  }

  if (rows.length === 0) return null

  /* The personal line only. A sensor's M2M SIM is also a number in this
     customer's name, and listing it here made the screen show three mobile
     numbers where the customer has one — with the device's activation date
     standing in for the date their line started. Device connectivity is a
     property of the thing they bought, and it gets its own list below. */
  const msisdn = rows.filter(r => r.kind === 'msisdn' && r.purpose === 'retail')
  const sims = rows.filter(r => r.kind === 'iccid' && r.purpose === 'retail')
  const devices = rows.filter(r => r.kind === 'iccid' && r.stock_serial)

  return (
    <div style={{
      background: 'white', border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)', overflow: 'hidden',
    }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border-light)' }}>
        <h3 style={{
          fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text)',
          display: 'flex', gap: '8px', alignItems: 'center',
        }}>
          <Smartphone size={16} style={{ color: 'var(--brand-navy)' }} />
          Your number and SIM
        </h3>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>
          What the network has allocated to you.
        </p>
      </div>

      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {msisdn.map(m => {
          const sim = sims.find(s => s.id === m.paired_with) ?? sims[0]
          const profile = sim ? profiles.find(p => p.iccid === sim.value) : undefined
          return (
            <div key={m.id} style={{
              border: '1px solid var(--border)', borderRadius: 'var(--radius)',
              padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '6px',
            }}>
              <div style={{ display: 'flex', gap: '10px', alignItems: 'baseline', flexWrap: 'wrap' }}>
                {/* With its country code, the way the customer knows it. The
                    bare national number beside their own contact number reads
                    as two numbers rather than one. */}
                <span style={{ fontSize: 'var(--text-lg)', fontWeight: 800, fontFamily: 'ui-monospace, monospace' }}>
                  {formatMsisdn(m.value, m.market)}
                </span>
                <span style={{
                  padding: '2px 10px', borderRadius: '999px', fontSize: 'var(--text-xs)', fontWeight: 700,
                  background: m.state === 'assigned' ? '#DCFCE7' : '#FEF3C7',
                  color: m.state === 'assigned' ? '#15803D' : '#92400E',
                }}>{STATE_LABEL[m.state]}</span>
                {m.plan && (
                  <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{m.plan}</span>
                )}
              </div>

              <Row label="SIM" value={sim?.value ?? null} mono />
              <Row label="In service since" value={m.activated_on} />
              {/* The reference the network gave back. Support asks for it. */}
              <Row label="Network reference" value={m.bss_ref} />

              {profile && (
                <div style={{ marginTop: '4px' }}>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '4px' }}>
                    eSIM profile
                  </div>
                  <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    {ESIM_ORDER.filter(s => s !== 'deleted').map(s => (
                      <span key={s} title={ESIM_LABEL[s]} style={{
                        width: '10px', height: '10px', borderRadius: '50%',
                        background: ESIM_ORDER.indexOf(s) <= ESIM_ORDER.indexOf(profile.state)
                          ? 'var(--success)' : 'var(--gray-100)',
                      }} />
                    ))}
                    <span style={{ fontSize: 'var(--text-sm)', marginLeft: '6px', fontWeight: 600 }}>
                      {ESIM_LABEL[profile.state]}
                    </span>
                  </div>
                  {profile.state === 'released' && profile.activation_code && (
                    <div style={{
                      marginTop: '6px', fontSize: '11px', fontFamily: 'ui-monospace, monospace',
                      background: 'var(--bg-alt)', padding: '6px 8px', borderRadius: 'var(--radius)',
                      wordBreak: 'break-all',
                    }}>
                      {profile.activation_code}
                    </div>
                  )}
                  {profile.note && (
                    <div style={{ fontSize: '11px', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                      {profile.note}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}

        {/* A SIM with no number on it is worth showing rather than hiding —
            a customer holding a card that does nothing will ring about it. */}
        {sims.filter(s => !msisdn.some(m => m.paired_with === s.id)).map(s => (
          <div key={s.id} style={{
            border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '10px 14px',
            fontSize: 'var(--text-sm)', color: 'var(--text-secondary)',
          }}>
            SIM <span style={{ fontFamily: 'ui-monospace, monospace' }}>{s.value}</span> — not yet paired
            with a number.
          </div>
        ))}

        {/* What is in the things they bought. Named separately because it is
            not their phone number and reading it as one is what the screen
            used to invite. */}
        {devices.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '12px' }}>
            <div style={{ fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)', marginBottom: '6px' }}>
              Connectivity in devices you bought
            </div>
            {devices.map(d => {
              const line = rows.find(r => r.kind === 'msisdn' && r.stock_serial === d.stock_serial)
              return (
                <div key={d.id} style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '4px' }}>
                  {d.device ?? 'A device'}
                  {' — '}
                  <span style={{ fontFamily: 'ui-monospace, monospace' }}>{d.stock_serial}</span>
                  {line && (
                    <>
                      {' · '}
                      <span style={{ fontFamily: 'ui-monospace, monospace' }}>{formatMsisdn(line.value, line.market)}</span>
                    </>
                  )}
                  {d.device_order && (
                    <span style={{ color: 'var(--text-tertiary)' }}>{' · from '}{d.device_order}</span>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', margin: 0 }}>
          Changing or giving up a number is done through support. A number that is given back is held for
          ninety days before anybody else can have it, so that calls meant for you do not reach somebody else.
        </p>
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string | null; mono?: boolean }) {
  return (
    <div style={{ display: 'flex', gap: '10px', fontSize: 'var(--text-sm)' }}>
      <span style={{ color: 'var(--text-tertiary)', minWidth: '160px' }}>{label}</span>
      {/* Declared, never blank. */}
      <span style={{
        color: value ? 'var(--text)' : 'var(--text-tertiary)',
        fontFamily: mono && value ? 'ui-monospace, monospace' : undefined,
      }}>
        {value ?? 'Not recorded'}
      </span>
    </div>
  )
}
