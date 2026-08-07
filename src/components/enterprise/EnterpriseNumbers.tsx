import { useState, useEffect } from 'react'
import { Smartphone, Cpu, Search } from 'lucide-react'
import {
  SectionCard, Table, Td, EmptyState, StatCard, Btn, FormField, TextInput,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import {
  KIND_LABEL, STATE_LABEL, STATE_TONE, PURPOSE_LABEL, ESIM_ORDER, ESIM_LABEL,
  heldBy, estate, unreachable,
} from '../../lib/numbers'
import type { HeldNumber, EsimProfile } from '../../lib/numbers'
import { loadHeldBy } from '../../lib/numbersRepo'
import { supabase } from '../../lib/supabase'
import { loadAccount } from '../../lib/enterpriseRepo'

/* The account's connectivity.
 *
 * A buyer who ordered forty sensors has forty SIMs in the field and, until
 * this screen, no way to say which SIM is in which sensor or which order it
 * came on. The device is the answer to "whose number is this" — the account is
 * context, and the thing somebody is actually asking about is the gateway on
 * the roof of a particular site.
 *
 * RLS scopes this to the account. The filter below is so the query is small.
 */

export function EnterpriseNumbers() {
  const [rows, setRows] = useState<HeldNumber[] | null>(null)
  const [profiles, setProfiles] = useState<EsimProfile[]>([])
  const [q, setQ] = useState('')

  useEffect(() => {
    void (async () => {
      const book = await loadAccount()
      const id = book.account?.id
      /* RLS scopes both of these to the account whatever is asked for. The
         filter is here so the query is small, not so that it is safe. */
      setRows(id ? await loadHeldBy({ account_id: id }) : [])
      const { data } = await supabase.from('esim_profile').select('*')
      setProfiles((data ?? []) as EsimProfile[])
    })()
  }, [])

  if (rows === null) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const e = estate(rows)
  const dark = unreachable(rows)
  const term = q.trim().toLowerCase()
  const shown = term
    ? rows.filter(r => [r.value, r.stock_serial, r.device, r.order_ref, r.plan]
        .some(v => (v ?? '').toLowerCase().includes(term)))
    : rows

  /* Grouped by the device, because a gateway with a SIM and a number is one
     thing on a wall, not two rows in a table. */
  const devices = new Map<string, HeldNumber[]>()
  for (const r of shown) {
    if (!r.stock_serial) continue
    devices.set(r.stock_serial, [...(devices.get(r.stock_serial) ?? []), r])
  }
  const loose = shown.filter(r => !r.stock_serial)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Numbers &amp; SIMs</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          Every number on the account, and which device each one is in.
        </p>
      </div>

      {dark.length > 0 && (
        <Callout tone="danger" title={`${dark.length} of your devices have a SIM and no number`}>
          {dark.slice(0, 4).map(d => (
            <div key={d.id} style={{ marginTop: '4px' }}>
              {d.device ?? d.stock_serial} from {d.device_order ?? 'an order'} — nothing can reach it yet.
              Raise a ticket and the marketplace will allocate one.
            </div>
          ))}
        </Callout>
      )}

      <div className="stat-row">
        <StatCard label="Numbers in use" value={String(e.inUse)}
                  sublabel="Voice lines and device connectivity" />
        <StatCard label="In your devices" value={String(e.onDevices)}
                  sublabel="SIMs fitted to sensors and gateways you bought" />
        <StatCard label="Suspended" value={String(e.suspended)}
                  sublabel={e.suspended ? 'Still allocated to you and not billing traffic' : 'Nothing suspended'} />
      </div>

      {rows.length === 0 ? (
        <SectionCard title="Nothing allocated yet"
                     subtitle="Numbers appear here once connectivity is provisioned against an order.">
          <EmptyState message="No numbers on this account" />
        </SectionCard>
      ) : (
        <>
          <SectionCard title="Find one" subtitle="A number, a device serial, an order or a plan.">
            <div style={{ padding: '14px 20px', display: 'flex', gap: '8px', alignItems: 'flex-end' }}>
              <div style={{ flex: 1 }}>
                <FormField label="Search">
                  <TextInput value={q} onChange={ev => setQ(ev.target.value)}
                             placeholder="8912345600001, SKU5007-0000012, ORD-882091" />
                </FormField>
              </div>
              {q && <Btn variant="secondary" size="sm" onClick={() => setQ('')}>Clear</Btn>}
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', paddingBottom: '10px' }}>
                <Search size={12} style={{ verticalAlign: 'middle' }} /> {shown.length} of {rows.length}
              </span>
            </div>
          </SectionCard>

          {devices.size > 0 && (
            <SectionCard title={`Connectivity in your devices (${devices.size})`}
                         subtitle="The SIM and the number that make each one reachable, and the order it arrived on.">
              <Table headers={['Device', 'Serial', 'SIM', 'Number', 'Plan', 'From', 'State']}>
                {[...devices.entries()].map(([serial, ns]) => {
                  const sim = ns.find(x => x.kind === 'iccid')
                  const msisdn = ns.find(x => x.kind === 'msisdn')
                  const any = sim ?? msisdn!
                  return (
                    <tr key={serial}>
                      <Td>
                        <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                          <Cpu size={13} style={{ color: 'var(--text-tertiary)' }} />
                          {any.device ?? 'A device'}
                        </span>
                      </Td>
                      <Td right style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'var(--text-xs)' }}>{serial}</Td>
                      <Td right style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'var(--text-xs)' }}>
                        {sim?.value ?? <span style={{ color: 'var(--danger)' }}>none</span>}
                      </Td>
                      <Td right style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'var(--text-xs)' }}>
                        {msisdn?.value ?? <span style={{ color: 'var(--danger)' }}>none</span>}
                      </Td>
                      <Td right style={{ fontSize: 'var(--text-xs)' }}>{any.plan ?? '—'}</Td>
                      <Td right style={{ fontSize: 'var(--text-xs)' }}>{any.device_order ?? any.order_ref ?? '—'}</Td>
                      <Td right>
                        <Pill state={any.state} />
                      </Td>
                    </tr>
                  )
                })}
              </Table>
            </SectionCard>
          )}

          {loose.length > 0 && (
            <SectionCard title={`Lines on the account (${loose.length})`}
                         subtitle="Numbers that are not fitted to a device.">
              <Table headers={['Number', 'Kind', 'What for', 'Plan', 'Since', 'State']}>
                {loose.map(r => (
                  <tr key={r.id}>
                    <Td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'var(--text-xs)' }}>
                      <span style={{ display: 'inline-flex', gap: '6px', alignItems: 'center' }}>
                        <Smartphone size={13} style={{ color: 'var(--text-tertiary)' }} />
                        {r.value}
                      </span>
                    </Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{KIND_LABEL[r.kind]}</Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{PURPOSE_LABEL[r.purpose]}</Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{r.plan ?? '—'}</Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{r.assigned_on ?? '—'}</Td>
                    <Td right><Pill state={r.state} /></Td>
                  </tr>
                ))}
              </Table>
            </SectionCard>
          )}

          {profiles.length > 0 && (
            <SectionCard title="eSIM profiles"
                         subtitle="Where each profile has got to. The marketplace observes these; the device and the SM-DP+ decide them.">
              <Table headers={['SIM', 'Where it has got to', 'Changed']}>
                {profiles.map(p => (
                  <tr key={p.iccid}>
                    <Td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 'var(--text-xs)' }}>{p.iccid}</Td>
                    <Td right>
                      <div style={{ display: 'flex', gap: '3px', alignItems: 'center', justifyContent: 'flex-end' }}>
                        {ESIM_ORDER.filter(s => s !== 'deleted').map(s => (
                          <span key={s} title={ESIM_LABEL[s]} style={{
                            width: '9px', height: '9px', borderRadius: '50%',
                            background: ESIM_ORDER.indexOf(s) <= ESIM_ORDER.indexOf(p.state)
                              ? 'var(--success)' : 'var(--gray-100)',
                          }} />
                        ))}
                        <span style={{ fontSize: 'var(--text-xs)', marginLeft: '6px' }}>{ESIM_LABEL[p.state]}</span>
                      </div>
                    </Td>
                    <Td right style={{ fontSize: 'var(--text-xs)' }}>{p.changed_on ?? p.released_on}</Td>
                  </tr>
                ))}
              </Table>
            </SectionCard>
          )}
        </>
      )}

      <Callout tone="info" title="What you can and cannot do here">
        The account can see every number allocated to it and which device each is in. Allocating, suspending
        and releasing are the marketplace's to do — releasing a number puts it into a ninety-day quarantine
        before anybody else can have it, and that is not a button worth having on a page where somebody is
        looking something up.
      </Callout>
    </div>
  )
}

function Pill({ state }: { state: HeldNumber['state'] }) {
  const tone = STATE_TONE[state]
  const colour = tone === 'active' ? { bg: '#DCFCE7', fg: '#15803D' }
    : tone === 'pending' ? { bg: '#FEF3C7', fg: '#92400E' }
    : tone === 'paused' ? { bg: '#FEF3C7', fg: '#92400E' }
    : { bg: '#F1F5F9', fg: '#475569' }
  return (
    <span style={{
      padding: '2px 10px', borderRadius: '999px', fontSize: 'var(--text-xs)', fontWeight: 700,
      background: colour.bg, color: colour.fg,
    }}>{STATE_LABEL[state]}</span>
  )
}
