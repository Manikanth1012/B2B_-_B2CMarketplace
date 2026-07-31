import { useState, useEffect, useCallback } from 'react'
import {
  User, Mail, Phone, Building, MapPin, Shield, Lock, Key, Wallet, FileText,
  Store, Plus, Trash2, CircleCheck as CheckCircle, TriangleAlert as AlertTriangle,
  Eye, EyeOff, Clock,
} from 'lucide-react'
import {
  SectionCard, Btn, Modal, FormField, TextInput, TextArea, Select,
  toast, fmtDate,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { loadMyDetails, saveProfile, setAway, setMfa, signOutOtherSessions,
  stampPasswordChange, addContact, verifyContact, removeContact,
  requestBankChange, withdrawBankChange, recordTreatyCertificate,
  pauseStorefront, reopenStorefront } from '../../lib/partnerDetailsRepo'
import type { MyDetails } from '../../lib/partnerDetailsRepo'
import {
  maskAccount, maskTaxId, maskIban, bankCodeFor, showLocalCode, taxPosition, pendingChange,
  contactGaps, groupByPurpose, canRemoveContact, goLiveRows, awayCover, securityGaps,
  CONTACT_PURPOSES, PURPOSE_SPEC, ROLE_LABEL, ROLE_SCOPE, TIMEZONES, DATE_FORMATS,
} from '../../lib/partnerDetails'
import type { Contact, ContactKind, ContactPurpose, BankDraft, PartnerUser } from '../../lib/partnerDetails'
import { loadSellerRecord } from '../../lib/partnerRepo'
import type { SellerRecord } from '../../lib/partnerRepo'
import { changePassword, SignInError } from '../../lib/authRepo'
import { checkNewPassword, strengthOf, isDemoAccount, MIN_LENGTH } from '../../lib/password'

/* My details, for a seller.
 *
 * It used to be six read-only facts, three of which were wrong: it printed
 * India for a company registered in Munich because the values came from a
 * TypeScript constant rather than the record the operator reads. Nothing on it
 * could be changed — not the password, not who receives the remittance advice,
 * and not the account the money is paid into.
 *
 * Four tabs, because they are four different subjects and only two of them have
 * money in them. Everything reads from the same rows the operator reads.
 */

type Tab = 'you' | 'contacts' | 'settlement' | 'golive'

/* The shared StatusPill prints whatever key it is given, so it says "degraded"
   where this page needs to say "Open, nothing on sale". One small pill of our
   own rather than adding six statuses to the shared vocabulary. */
type Tone = 'good' | 'warn' | 'bad' | 'quiet' | 'info'

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const map: Record<Tone, { bg: string; color: string }> = {
    good: { bg: 'var(--success-bg)', color: 'var(--success)' },
    warn: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
    bad: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
    info: { bg: 'var(--info-bg)', color: 'var(--info)' },
    quiet: { bg: 'var(--bg-alt)', color: 'var(--text-tertiary)' },
  }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap',
      padding: '2px 10px', borderRadius: 'var(--radius-full)',
      fontSize: 'var(--text-xs)', fontWeight: 600, ...map[tone],
    }}>{children}</span>
  )
}

export function PartnerDetails({ partnerId }: { partnerId: string }) {
  const [snap, setSnap] = useState<MyDetails | null>(null)
  const [record, setRecord] = useState<SellerRecord | null>(null)
  const [tab, setTab] = useState<Tab>('you')

  const reload = useCallback(async () => {
    const [d, r] = await Promise.all([loadMyDetails(partnerId), loadSellerRecord(partnerId)])
    setSnap(d)
    setRecord(r)
  }, [partnerId])
  useEffect(() => { void reload() }, [reload])

  if (!snap || !record) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const partner = record.partner
  const gaps = contactGaps(snap.contacts)
  const rows = goLiveRows(record.categories, record.approvals, snap.golive, record.listings)
  const notTrading = rows.filter(r => r.state === 'empty' || r.state === 'paused').length
  const tax = taxPosition(snap.bank, new Date())
  const pending = pendingChange(snap.bank)

  const badges: Record<Tab, number> = {
    you: securityGaps(snap.me ? [snap.me, ...snap.colleagues] : snap.colleagues).length,
    contacts: gaps.length + snap.contacts.filter(c => !c.verified).length,
    settlement: (tax.level === 'expiring' || tax.level === 'expired' || tax.level === 'none' ? 1 : 0)
      + (pending.state !== 'none' ? 1 : 0),
    golive: notTrading,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>My details</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {snap.me ? `${snap.me.job_title} · ` : ''}{partner?.name ?? partnerId}
          {partner ? ` · ${partner.country} · seller since ${partner.joined}` : ''}
        </p>
      </div>

      {snap.loadError && <Callout tone="danger" title="Some of this page did not load">{snap.loadError}</Callout>}
      {record.loadError && <Callout tone="danger" title="Your seller record did not load">{record.loadError}</Callout>}

      {!snap.me && (
        <Callout tone="warning" title="This sign-in is not on your company's roster">
          You are signed in{snap.authEmail ? ` as ${snap.authEmail}` : ''}, but no person at {partner?.name ?? partnerId}{' '}
          holds that address. Contacts, settlement and go-live below are still your company's — only the
          personal half of this page has nobody to attach to.
        </Callout>
      )}

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {([
          ['you', 'You and sign-in'],
          ['contacts', `How we reach you (${snap.contacts.length})`],
          ['settlement', 'Settlement and tax'],
          ['golive', `Go-live (${rows.filter(r => r.state === 'trading').length} trading)`],
        ] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} style={{
            padding: '8px 15px', borderRadius: 'var(--radius)', cursor: 'pointer',
            fontSize: 'var(--text-sm)', fontWeight: 600, border: '1px solid var(--border)',
            background: tab === id ? 'var(--brand-navy)' : 'white',
            color: tab === id ? 'white' : 'var(--text-secondary)',
            display: 'flex', alignItems: 'center', gap: '7px',
          }}>
            {label}
            {badges[id] > 0 && (
              <span style={{
                minWidth: '18px', height: '18px', borderRadius: '9px', padding: '0 5px',
                background: tab === id ? 'rgba(255,255,255,0.25)' : 'var(--warning-bg)',
                color: tab === id ? 'white' : 'var(--warning)',
                fontSize: '11px', fontWeight: 700,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}>{badges[id]}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'you' && (
        <>
          <YouTab snap={snap} onChanged={reload} />
          <PartnerCompanyFacts record={record} />
        </>
      )}
      {tab === 'contacts' && <ContactsTab snap={snap} partnerId={partnerId} onChanged={reload} />}
      {tab === 'settlement' && (
        <SettlementTab snap={snap} partnerId={partnerId}
                       country={partner?.country ?? ''} onChanged={reload} />
      )}
      {tab === 'golive' && (
        <GoLiveTab rows={rows} snap={snap} partnerId={partnerId}
                   companyName={partner?.name ?? partnerId} onChanged={reload} />
      )}
    </div>
  )
}

/* ======================================================================= you */

function YouTab({ snap, onChanged }: { snap: MyDetails; onChanged: () => Promise<void> }) {
  const me = snap.me
  const [name, setName] = useState(me?.name ?? '')
  const [title, setTitle] = useState(me?.job_title ?? '')
  const [tz, setTz] = useState(me?.timezone ?? TIMEZONES[0])
  const [df, setDf] = useState(me?.date_format ?? DATE_FORMATS[0])
  const [digest, setDigest] = useState(me?.digest ?? 'Weekly, Monday 08:00')
  const [saving, setSaving] = useState(false)
  const [pwdOpen, setPwdOpen] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!me) return
    setName(me.name); setTitle(me.job_title); setTz(me.timezone)
    setDf(me.date_format); setDigest(me.digest)
  }, [me])

  if (!me) {
    return (
      <SectionCard title="About you">
        <div style={{ padding: '20px', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
          There is no person on this company's roster holding the address you signed in with, so there is
          nothing personal to edit here.
        </div>
      </SectionCard>
    )
  }

  const dirty = name !== me.name || title !== me.job_title || tz !== me.timezone
    || df !== me.date_format || digest !== me.digest
  const peers = snap.colleagues.filter(c => c.status === 'active')
  const gaps = securityGaps([me, ...snap.colleagues])

  const save = async () => {
    setSaving(true); setErr('')
    const r = await saveProfile(me, { name, job_title: title, timezone: tz, date_format: df, digest })
    setSaving(false)
    if (!r.ok) { setErr(r.reason); return }
    toast(r.note ?? 'Saved')
    await onChanged()
  }

  const toggleAway = async (on: boolean, delegateId: string | null) => {
    const r = await setAway(me, on, delegateId, peers)
    if (!r.ok) { toast(r.reason, 'error'); return }
    toast(r.note ?? 'Saved')
    await onChanged()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {me.must_reset && (
        <Callout tone="danger" title="Your password has to be reset before your next sign-in">
          Set a new one now — you will not be able to sign back in until you do.
        </Callout>
      )}

      {me.out_of_office && (
        <Callout tone="warning" title="You are marked as away">{awayCover(me, snap.colleagues)}</Callout>
      )}

      <SectionCard title="About you" subtitle="What colleagues and the marketplace desk see against your actions"
                   action={<Btn variant="primary" size="sm" disabled={!dirty || saving} onClick={save}>
                     {saving ? 'Saving…' : 'Save changes'}
                   </Btn>}>
        <div style={{ padding: '20px' }}>
          {err && <div style={{ marginBottom: '14px', fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600 }}>{err}</div>}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '0 16px' }}>
            <FormField label="Name" required>
              <TextInput value={name} onChange={e => setName(e.target.value)} />
            </FormField>
            <FormField label="Job title" required hint="The marketplace desk uses it to work out who to ask.">
              <TextInput value={title} onChange={e => setTitle(e.target.value)} />
            </FormField>
            <FormField label="Sign-in address"
                       hint="Change it under How we reach you — it is the address the account authenticates as.">
              <TextInput value={me.email} disabled style={{ background: 'var(--bg-alt)' }} />
            </FormField>
            <FormField label="Settlement digest" hint="How often you are told about statements and holds.">
              <Select value={digest} onChange={e => setDigest(e.target.value)}>
                {['Daily, 07:00', 'Weekly, Monday 08:00', 'Monthly, on the run date', 'Only when something needs me']
                  .map(o => <option key={o}>{o}</option>)}
              </Select>
            </FormField>
          </div>

          <div style={{ height: '1px', background: 'var(--border-light)', margin: '4px 0 18px' }} />
          <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '12px' }}>How things are shown to you</h4>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
            <FormField label="Time zone" hint="Timestamps, cycle dates and settlement run times follow this.">
              <Select value={tz} onChange={e => setTz(e.target.value)}>
                {TIMEZONES.map(o => <option key={o}>{o}</option>)}
              </Select>
            </FormField>
            <FormField label="Date format">
              <Select value={df} onChange={e => setDf(e.target.value)}>
                {DATE_FORMATS.map(o => <option key={o}>{o}</option>)}
              </Select>
            </FormField>
            {/* Stored per person and offered as one option. Translating the
                console is a separate piece of work, and a language picker that
                changes nothing is worse than one that admits its range. */}
            <FormField label="Language" hint="Only English is available in this build.">
              <Select value="English" disabled style={{ background: 'var(--bg-alt)' }}>
                <option>English</option>
              </Select>
            </FormField>
          </div>

          <div style={{ height: '1px', background: 'var(--border-light)', margin: '4px 0 18px' }} />
          <h4 style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '4px' }}>While you are away</h4>
          <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '12px' }}>
            {awayCover(me, snap.colleagues)}
          </p>
          <label style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: 'var(--text-sm)', fontWeight: 600, marginBottom: '12px', cursor: 'pointer' }}>
            <input type="checkbox" checked={me.out_of_office}
                   onChange={e => void toggleAway(e.target.checked, null)} />
            Mark me as away
          </label>
          <FormField label="Delegate"
                     hint="A delegate can act in your place. The audit log still records who actually acted.">
            <Select value={me.delegate_id ?? ''} disabled={!me.out_of_office}
                    style={me.out_of_office ? undefined : { background: 'var(--bg-alt)' }}
                    onChange={e => void toggleAway(true, e.target.value || null)}>
              <option value="">Nobody — work waits for me</option>
              {peers.map(p => <option key={p.id} value={p.id}>{p.name} · {ROLE_LABEL[p.role]}</option>)}
            </Select>
          </FormField>
        </div>
      </SectionCard>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '20px' }}>
        <SectionCard title="Your sign-in and security"
                     action={<Btn variant="primary" size="sm" onClick={() => setPwdOpen(true)}>
                       <Key size={13} /> Change password
                     </Btn>}>
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <SecurityRow
              label="Password"
              detail={me.pwd_changed ? `Last changed ${fmtDate(me.pwd_changed)}` : 'Never set — you sign in by one-time code'}
              right={me.pwd_strength
                ? <Pill tone={me.pwd_strength === 'strong' ? 'good' : me.pwd_strength === 'fair' ? 'warn' : 'bad'}>
                    {me.pwd_strength === 'strong' ? 'Strong' : me.pwd_strength === 'fair' ? 'Fair' : 'Weak'}
                  </Pill>
                : <Pill tone="quiet">Not set</Pill>}
            />
            <SecurityRow
              label="Multi-factor authentication"
              detail={me.mfa
                ? 'On. A stolen password alone is not enough to sign in as you.'
                : 'Off. A stolen password alone would be enough to sign in as you.'}
              right={
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: 'var(--text-xs)' }}>
                  <input type="checkbox" checked={me.mfa} onChange={async e => {
                    const r = await setMfa(me, e.target.checked)
                    toast(r.ok ? (r.note ?? 'Saved') : r.reason, r.ok && e.target.checked ? 'success' : r.ok ? 'info' : 'error')
                    await onChanged()
                  }} />
                </label>
              }
            />
            <SecurityRow
              label="Active sessions"
              detail={`${me.sessions} signed in, including this one`}
              right={<Btn variant="secondary" size="sm" onClick={async () => {
                const r = await signOutOtherSessions(me)
                toast(r.ok ? (r.note ?? 'Done') : r.reason, r.ok ? 'success' : 'error')
                await onChanged()
              }}>Sign out elsewhere</Btn>}
            />
            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6, borderTop: '1px solid var(--border-light)', paddingTop: '12px' }}>
              At least {MIN_LENGTH} characters, and it cannot match your current one. Rotation on a schedule is
              deliberately not required — forcing regular changes pushes people towards weaker, patterned
              passwords. Nobody at the marketplace can see your password, including support.
            </div>
          </div>
        </SectionCard>

        <SectionCard title="Your access" subtitle="What this account can do, and who else is here">
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <Fact label="Role" value={ROLE_LABEL[me.role]} sub={ROLE_SCOPE[me.role]} />
            <Fact label="Member since" value={fmtDate(me.joined)} />
            <Fact label="Last active" value={me.last_active ?? '—'} />
            <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6, borderTop: '1px solid var(--border-light)', paddingTop: '12px', margin: 0 }}>
              You cannot change your own role. That is deliberate — it is the control that stops one account
              quietly granting itself everything.
            </p>
            {gaps.length > 0 && (
              <div style={{ borderTop: '1px solid var(--border-light)', paddingTop: '12px' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700, marginBottom: '8px' }}>
                  {gaps.length} thing{gaps.length === 1 ? '' : 's'} worth fixing on this company's sign-ins
                </div>
                {gaps.map((g, i) => (
                  <div key={i} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
                    <AlertTriangle size={14} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: '2px' }} />
                    <div style={{ fontSize: 'var(--text-xs)' }}>
                      <strong>{g.who} — {g.what}.</strong>{' '}
                      <span style={{ color: 'var(--text-tertiary)' }}>{g.why}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SectionCard>
      </div>

      {pwdOpen && (
        <PasswordModal me={me} authEmail={snap.authEmail}
                       onClose={() => setPwdOpen(false)} onChanged={onChanged} />
      )}
    </div>
  )
}

function SecurityRow({ label, detail, right }: { label: string; detail: string; right: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{detail}</div>
      </div>
      <div style={{ flexShrink: 0 }}>{right}</div>
    </div>
  )
}

function Fact({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{value}</div>
      {sub && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>{sub}</div>}
    </div>
  )
}

function PasswordModal({ me, authEmail, onClose, onChanged }: {
  me: PartnerUser; authEmail: string | null; onClose: () => void; onChanged: () => Promise<void>
}) {
  const [cur, setCur] = useState('')
  const [nw, setNw] = useState('')
  const [confirm, setConfirm] = useState('')
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  /* The demo personas are shared and their credentials are printed on the
     sign-in cards, so one visitor changing this password locks everybody else
     out — including the integration suite. Said plainly rather than failing at
     the server. Everything else on the form is live. */
  const demo = authEmail !== null && isDemoAccount(authEmail)
  const strength = strengthOf(nw)

  const submit = async () => {
    setErr('')
    const check = checkNewPassword(cur, nw, confirm)
    if (!check.ok) { setErr(check.reason!); return }
    setSaving(true)
    try {
      await changePassword(cur, nw)
    } catch (e) {
      setSaving(false)
      setErr(e instanceof SignInError ? e.message : 'We could not change your password just now.')
      return
    }
    await stampPasswordChange(me, strength.level >= 3 ? 'strong' : strength.level === 2 ? 'fair' : 'weak')
    setSaving(false)
    toast('Your password has been changed')
    onClose()
    await onChanged()
  }

  return (
    <Modal open onClose={onClose} title="Change your password"
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="primary" disabled={saving || demo} onClick={submit}>
               {saving ? 'Saving…' : 'Change password'}
             </Btn>
           </>}>
      <FormField label="Current password" required>
        <TextInput type="password" autoComplete="current-password" value={cur} onChange={e => setCur(e.target.value)} />
      </FormField>
      <FormField label="New password" required hint={`At least ${MIN_LENGTH} characters. A long passphrase is stronger than a short one with symbols in it.`}>
        <TextInput type="password" autoComplete="new-password" value={nw} onChange={e => setNw(e.target.value)} />
      </FormField>
      {nw.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: '-8px 0 16px' }}>
          <div style={{ flex: 1, height: '4px', borderRadius: '2px', background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{
              width: `${(strength.level / 3) * 100}%`, height: '100%',
              background: strength.level >= 3 ? 'var(--success)' : strength.level === 2 ? 'var(--warning)' : 'var(--danger)',
            }} />
          </div>
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', minWidth: '64px' }}>{strength.label}</span>
        </div>
      )}
      <FormField label="Confirm new password" required>
        <TextInput type="password" autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} />
      </FormField>

      {demo && (
        <Callout tone="warning" title="This is a shared demonstration account">
          Its password is fixed — the credentials on the sign-in cards have to keep working. Everything else
          on this form is live: your current password is checked against the server for real.
        </Callout>
      )}
      {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600, marginTop: '12px' }}>{err}</div>}
    </Modal>
  )
}

/* ================================================================== contacts */

function ContactsTab({ snap, partnerId, onChanged }: {
  snap: MyDetails; partnerId: string; onChanged: () => Promise<void>
}) {
  const [adding, setAdding] = useState<ContactPurpose | null>(null)
  const [removing, setRemoving] = useState<Contact | null>(null)
  const groups = groupByPurpose(snap.contacts)
  const gaps = contactGaps(snap.contacts)
  const unverifiedRows = snap.contacts.filter(c => !c.verified)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <Callout tone="info" title="One address for everything is how things get missed">
        Each purpose below is sent something different. Where nobody is listed, it falls back to your sign-in
        address — which means the remittance advice, the overnight order failure and the policy notice all land
        in one person's inbox, and only when that person reads it.
      </Callout>

      {gaps.length > 0 && (
        <SectionCard title={`${gaps.length} nobody is listed for`} subtitle="What each one costs you">
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {gaps.map(g => (
              <div key={g.purpose} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                <AlertTriangle size={16} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: '2px' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{g.label}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{g.ifMissing}</div>
                </div>
                <Btn variant="secondary" size="sm" onClick={() => setAdding(g.purpose)}>
                  <Plus size={12} /> Add one
                </Btn>
              </div>
            ))}
          </div>
        </SectionCard>
      )}

      {unverifiedRows.length > 0 && (
        <Callout tone="warning" title={`${unverifiedRows.length} recorded but never proved`}>
          Nothing is sent to a contact nobody has confirmed reads it. An incident page to an unverified number
          is the same as no page at all — send the confirmation from the row below.
        </Callout>
      )}

      {groups.map(({ spec, rows }) => (
        <SectionCard key={spec.id} title={spec.label} subtitle={spec.sends}
                     action={<Btn variant="secondary" size="sm" onClick={() => setAdding(spec.id)}>
                       <Plus size={12} /> Add
                     </Btn>}>
          <div style={{ padding: rows.length === 0 ? '16px 20px' : '8px 20px 16px' }}>
            {rows.length === 0 ? (
              <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                Nobody listed. {spec.ifMissing}
              </div>
            ) : rows.map(c => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
                padding: '12px 0', borderBottom: '1px solid var(--border-light)',
              }}>
                {c.kind === 'email'
                  ? <Mail size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />
                  : <Phone size={16} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />}
                <div style={{ flex: 1, minWidth: '180px' }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{c.value}</div>
                  <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                    {c.label ?? '—'}
                    {c.verified && c.verified_on ? ` · verified ${fmtDate(c.verified_on)}` : ''}
                  </div>
                </div>
                {c.verified
                  ? <Pill tone="good"><CheckCircle size={11} /> Verified</Pill>
                  : <Btn variant="secondary" size="sm" onClick={async () => {
                      const r = await verifyContact(c)
                      toast(r.ok ? (r.note ?? 'Verified') : r.reason, r.ok ? 'success' : 'error')
                      await onChanged()
                    }}>Send confirmation</Btn>}
                {canRemoveContact(c).ok ? (
                  <button onClick={() => setRemoving(c)} title="Remove"
                          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '4px' }}>
                    <Trash2 size={15} />
                  </button>
                ) : (
                  <span title="This is the address you sign in with"
                        style={{ color: 'var(--text-tertiary)', padding: '4px', display: 'inline-flex' }}>
                    <Lock size={15} />
                  </span>
                )}
              </div>
            ))}
          </div>
        </SectionCard>
      ))}

      {adding && (
        <AddContactModal purpose={adding} partnerId={partnerId} existing={snap.contacts}
                         onClose={() => setAdding(null)} onChanged={onChanged} />
      )}

      {removing && (
        <Modal open onClose={() => setRemoving(null)} title={`Remove ${removing.value}?`}
               footer={<>
                 <Btn variant="secondary" onClick={() => setRemoving(null)}>Cancel</Btn>
                 <Btn variant="danger" onClick={async () => {
                   const r = await removeContact(removing)
                   toast(r.ok ? (r.note ?? 'Removed') : r.reason, r.ok ? 'success' : 'error')
                   setRemoving(null)
                   await onChanged()
                 }}>Remove it</Btn>
               </>}>
          <p style={{ fontSize: 'var(--text-sm)', lineHeight: 1.6 }}>
            {PURPOSE_SPEC[removing.purpose].sends} With this gone,{' '}
            {snap.contacts.filter(c => c.purpose === removing.purpose).length > 1
              ? 'the others listed for it still receive it.'
              : PURPOSE_SPEC[removing.purpose].ifMissing.charAt(0).toLowerCase() + PURPOSE_SPEC[removing.purpose].ifMissing.slice(1)}
          </p>
        </Modal>
      )}
    </div>
  )
}

function AddContactModal({ purpose, partnerId, existing, onClose, onChanged }: {
  purpose: ContactPurpose; partnerId: string; existing: Contact[]
  onClose: () => void; onChanged: () => Promise<void>
}) {
  const spec = PURPOSE_SPEC[purpose]
  const [kind, setKind] = useState<ContactKind>(spec.allows[0])
  const [value, setValue] = useState('')
  const [label, setLabel] = useState('')
  const [p, setP] = useState<ContactPurpose>(purpose)
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)

  const current = PURPOSE_SPEC[p]

  return (
    <Modal open onClose={onClose} title={`Add a ${current.label.toLowerCase()} contact`}
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="primary" disabled={saving} onClick={async () => {
               setSaving(true); setErr('')
               const r = await addContact({ partnerId, kind, value, purpose: p, label, existing })
               setSaving(false)
               if (!r.ok) { setErr(r.reason); return }
               toast(r.note ?? 'Added')
               onClose()
               await onChanged()
             }}>{saving ? 'Adding…' : 'Add contact'}</Btn>
           </>}>
      <FormField label="What it is for" hint={current.sends}>
        <Select value={p} onChange={e => {
          const next = e.target.value as ContactPurpose
          setP(next)
          if (!PURPOSE_SPEC[next].allows.includes(kind)) setKind(PURPOSE_SPEC[next].allows[0])
        }}>
          {CONTACT_PURPOSES.filter(x => x.id !== 'signin' || p === 'signin')
            .map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
        </Select>
      </FormField>
      <FormField label="Address or number">
        <div style={{ display: 'flex', gap: '8px' }}>
          <Select value={kind} onChange={e => setKind(e.target.value as ContactKind)}
                  style={{ width: '130px', flexShrink: 0 }}>
            {current.allows.map(k => <option key={k} value={k}>{k === 'email' ? 'Email' : 'Telephone'}</option>)}
          </Select>
          <TextInput value={value} onChange={e => setValue(e.target.value)}
                     placeholder={kind === 'email' ? 'name@company.com' : '+49 172 000 0000'} />
        </div>
      </FormField>
      <FormField label="Who this reaches" hint="Optional, but it is what tells the next person whether to keep it.">
        <TextInput value={label} onChange={e => setLabel(e.target.value)} placeholder="Finance desk, office hours" />
      </FormField>
      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
        Nothing is sent to it until it is verified.
      </div>
      {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600, marginTop: '12px' }}>{err}</div>}
    </Modal>
  )
}

/* ================================================================ settlement */

function SettlementTab({ snap, partnerId, country, onChanged }: {
  snap: MyDetails; partnerId: string; country: string; onChanged: () => Promise<void>
}) {
  const bank = snap.bank
  const [reveal, setReveal] = useState(false)
  const [changing, setChanging] = useState(false)
  const [treaty, setTreaty] = useState(false)
  const tax = taxPosition(bank, new Date())
  const pending = pendingChange(bank)
  const by = snap.me?.name ?? 'The seller'

  if (!bank) {
    return (
      <SectionCard title="Settlement account">
        <div style={{ padding: '20px', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
          Nothing can be paid to you until an account is recorded and verified. It is captured at the bank and
          tax gate during onboarding.
        </div>
      </SectionCard>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {pending.state === 'submitted' && (
        <Callout tone="warning" title={`A change to ${pending.to} is waiting on the marketplace`}>
          Requested by {pending.by} on {fmtDate(pending.on)} — “{pending.why}”. Settlements keep paying to the
          account on file until the marketplace confirms the new one.{' '}
          <button onClick={async () => {
            const r = await withdrawBankChange(partnerId, by)
            toast(r.ok ? (r.note ?? 'Withdrawn') : r.reason, r.ok ? 'success' : 'error')
            await onChanged()
          }} style={{ border: 'none', background: 'none', padding: 0, color: 'inherit', textDecoration: 'underline', cursor: 'pointer', fontWeight: 600 }}>
            Withdraw it
          </button>
        </Callout>
      )}

      {pending.state === 'rejected' && (
        <Callout tone="danger" title="Your last account change was refused">
          {pending.by} on {fmtDate(pending.on)}: “{pending.note}”. Nothing about your settlement account
          changed — payments are still going to the account below.
        </Callout>
      )}

      <SectionCard
        title="Settlement account"
        subtitle={bank.verified
          ? `Verified ${fmtDate(bank.verified_on)} by ${bank.verified_by} · ${bank.method}`
          : bank.method ?? 'Not verified yet'}
        action={<Btn variant="primary" size="sm" onClick={() => setChanging(true)}>Change account</Btn>}
      >
        <div style={{ padding: '20px' }}>
          {!bank.verified && (
            <div style={{ marginBottom: '16px' }}>
              <Callout tone="warning" title="Not verified yet">
                Two micro-deposits have to be matched before any money moves. Until then you accrue a balance
                but are not paid.
              </Callout>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
            <Fact label="Account holder" value={bank.holder} />
            <Fact label="Bank" value={bank.branch ? `${bank.bank} — ${bank.branch}` : bank.bank} />
            <Fact label="Account number" value={reveal ? bank.account : maskAccount(bank.account)} />
            <Fact label={bank.local_label} value={showLocalCode(country, bank.local_code)}
                  sub="A clearing code identifies a bank, not an account, so it is not masked." />
            <Fact label="SWIFT / BIC" value={bank.swift}
                  sub="A BIC identifies a bank, not an account, so it is not masked." />
            <Fact label="IBAN" value={bank.iban
              ? (reveal ? bank.iban : maskIban(bank.iban) ?? '—')
              : `Not used in ${bank.residency}`} />
            <Fact label="Settlement currency" value={bank.currency} />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '18px', paddingTop: '14px', borderTop: '1px solid var(--border-light)', flexWrap: 'wrap' }}>
            <span style={{ flex: 1, fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', minWidth: '220px' }}>
              Masked everywhere by default. This is your own account, so you may see it in full — the
              marketplace cannot, without a logged reason naming who looked.
            </span>
            <Btn variant="secondary" size="sm" onClick={() => setReveal(!reveal)}>
              {reveal ? <><EyeOff size={13} /> Hide it</> : <><Eye size={13} /> Show in full</>}
            </Btn>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Tax position" subtitle={`${bank.residency} · ${bank.tax_label} ${maskTaxId(bank.tax_id)}`}
                   action={<Btn variant="secondary" size="sm" onClick={() => setTreaty(true)}>
                     <FileText size={13} /> Record a certificate
                   </Btn>}>
        <div style={{ padding: '20px' }}>
          <div style={{ marginBottom: '16px' }}>
            <Callout tone={tax.level === 'ok' ? 'success' : tax.level === 'expiring' ? 'warning' : 'danger'}
                     title={tax.headline}>
              {tax.detail}
            </Callout>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '14px' }}>
            <Fact label="Tax residency" value={bank.residency} />
            <Fact label={bank.tax_label} value={reveal ? bank.tax_id : maskTaxId(bank.tax_id)} />
            <Fact label="Treaty certificate"
                  value={bank.treaty_on_file && bank.treaty_expires
                    ? `On file, valid to ${fmtDate(bank.treaty_expires)}`
                    : 'Not supplied'} />
            <Fact label="Withholding applied to your settlements" value={bank.withholding} />
          </div>
        </div>
      </SectionCard>

      {changing && (
        <BankChangeModal partnerId={partnerId} bank={bank} country={country} by={by}
                         onClose={() => setChanging(false)} onChanged={onChanged} />
      )}
      {treaty && (
        <TreatyModal partnerId={partnerId} by={by}
                     onClose={() => setTreaty(false)} onChanged={onChanged} />
      )}
    </div>
  )
}

function BankChangeModal({ partnerId, bank, country, by, onClose, onChanged }: {
  partnerId: string; bank: NonNullable<MyDetails['bank']>; country: string; by: string
  onClose: () => void; onChanged: () => Promise<void>
}) {
  const code = bankCodeFor(country)
  const [draft, setDraft] = useState<BankDraft>({
    holder: bank.holder, bank: '', branch: '', account: '', confirm: '', local: '', swift: '', why: '',
  })
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k: keyof BankDraft) => (e: { target: { value: string } }) =>
    setDraft(d => ({ ...d, [k]: e.target.value }))

  return (
    <Modal open onClose={onClose} title="Change the settlement account"
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="primary" disabled={saving} onClick={async () => {
               setSaving(true); setErr('')
               const r = await requestBankChange({ partnerId, draft, current: bank, requestedBy: by })
               setSaving(false)
               if (!r.ok) { setErr(r.reason); return }
               toast(r.note ?? 'Submitted')
               onClose()
               await onChanged()
             }}>{saving ? 'Submitting…' : 'Submit for verification'}</Btn>
           </>}>
      <div style={{ marginBottom: '16px' }}>
        <Callout tone="warning" title="Nothing is paid to a new account until the marketplace confirms it">
          Currently {maskAccount(bank.account)} at {bank.bank}. Settlements keep running to that account, and
          the marketplace is told the account was changed and by whom. Changing where money goes is the change
          most worth attacking, so it does not take effect on save.
        </Callout>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 16px' }}>
        <FormField label="Account holder" required
                   hint="It has to match the registered entity. A personal account in a director’s name is refused.">
          <TextInput value={draft.holder} onChange={set('holder')} />
        </FormField>
        <FormField label="Bank" required>
          <TextInput value={draft.bank} onChange={set('bank')} placeholder={bank.bank} />
        </FormField>
        <FormField label="Branch">
          <TextInput value={draft.branch} onChange={set('branch')} placeholder={bank.branch ?? 'Head office'} />
        </FormField>
        <FormField label="New account number" required>
          <TextInput value={draft.account} onChange={set('account')} placeholder="Digits only" />
        </FormField>
        <FormField label="Confirm the account number" required
                   hint="Typed twice on purpose. Nobody proof-reads a number they pasted.">
          <TextInput value={draft.confirm} onChange={set('confirm')} placeholder="Type it again" />
        </FormField>
        <FormField label={code.local}>
          <TextInput value={draft.local} onChange={set('local')} placeholder={code.localEg} />
        </FormField>
        <FormField label="SWIFT / BIC">
          <TextInput value={draft.swift} onChange={set('swift')} placeholder={bank.swift} />
        </FormField>
      </div>

      <FormField label="Why it is changing" required
                 hint="Recorded and visible to the marketplace. An unexplained payout change is the shape every account takeover takes.">
        <TextArea value={draft.why} onChange={set('why')}
                  placeholder="Moved our banking to a new provider on 20 July." />
      </FormField>

      {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600 }}>{err}</div>}
    </Modal>
  )
}

function TreatyModal({ partnerId, by, onClose, onChanged }: {
  partnerId: string; by: string; onClose: () => void; onChanged: () => Promise<void>
}) {
  const [expires, setExpires] = useState('')
  const [err, setErr] = useState('')

  return (
    <Modal open onClose={onClose} title="Record a tax residency certificate"
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="primary" onClick={async () => {
               setErr('')
               const r = await recordTreatyCertificate(partnerId, expires, by)
               if (!r.ok) { setErr(r.reason); return }
               toast(r.note ?? 'Recorded')
               onClose()
               await onChanged()
             }}>Record it</Btn>
           </>}>
      <div style={{ marginBottom: '16px' }}>
        <Callout tone="info" title="A valid certificate applies the treaty rate to your settlements">
          It is not backdated — anything already withheld stays withheld and is reclaimed from the authority,
          not from the marketplace. Withholding changes on the settlement run after the finance desk accepts
          it, not before.
        </Callout>
      </div>
      <FormField label="Valid to" required
                 hint="A certificate with no expiry cannot be checked, and checking it is the whole point. You are reminded 60 days out.">
        <TextInput type="date" value={expires} onChange={e => setExpires(e.target.value)} />
      </FormField>
      {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600 }}>{err}</div>}
    </Modal>
  )
}

/* =================================================================== go-live */

const GO_LIVE_TONE: Record<string, { label: string; tone: Tone }> = {
  trading:   { label: 'Trading',                tone: 'good' },
  empty:     { label: 'Open, nothing on sale',  tone: 'warn' },
  paused:    { label: 'Paused by you',          tone: 'warn' },
  applied:   { label: 'Applied for',            tone: 'info' },
  available: { label: 'Not applied for',        tone: 'quiet' },
}

function GoLiveTab({ rows, snap, partnerId, companyName, onChanged }: {
  rows: ReturnType<typeof goLiveRows>
  snap: MyDetails
  partnerId: string
  companyName: string
  onChanged: () => Promise<void>
}) {
  const [pausing, setPausing] = useState<{ categoryId: string; name: string; live: number } | null>(null)
  const by = snap.me?.name ?? 'The seller'
  const trading = rows.filter(r => r.state === 'trading')
  const open = rows.filter(r => r.state === 'trading' || r.state === 'empty' || r.state === 'paused')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <Callout tone={trading.length < open.length ? 'warning' : 'success'}
               title={trading.length === open.length
                 ? `${companyName} is trading in every marketplace it is open in`
                 : `Open in ${open.length}, trading in ${trading.length}`}>
        Being approved for a marketplace and selling in one are different things. A storefront that is open
        with nothing published is a shop with the lights on and no stock — from the marketplace's side nothing
        is wrong, so nobody tells you.
      </Callout>

      {rows.map(r => {
        const g = snap.golive.find(x => x.category_id === r.category_id)
        const tone = GO_LIVE_TONE[r.state]
        return (
          <SectionCard key={r.category_id} title={r.name}
                       subtitle={r.since ? `Open since ${fmtDate(r.since)}` : undefined}
                       action={<Pill tone={tone.tone}>{tone.label}</Pill>}>
            <div style={{ padding: '20px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px', marginBottom: r.next ? '16px' : 0 }}>
                <Fact label="Status" value={tone.label} />
                <Fact label="Live listings" value={String(r.live)} />
                <Fact label="In review" value={String(r.pending)} />
                {g?.first_listing_on && <Fact label="First published" value={fmtDate(g.first_listing_on)} />}
                {g?.opened_by && <Fact label="Opened by" value={g.opened_by} />}
              </div>

              {r.next && (
                <div style={{
                  display: 'flex', alignItems: 'flex-start', gap: '10px', flexWrap: 'wrap',
                  padding: '12px 14px', borderRadius: 'var(--radius)',
                  background: r.state === 'empty' || r.state === 'paused' ? 'var(--warning-bg)' : 'var(--bg-alt)',
                }}>
                  {r.state === 'empty' || r.state === 'paused'
                    ? <AlertTriangle size={15} style={{ color: 'var(--warning)', flexShrink: 0, marginTop: '2px' }} />
                    : <Clock size={15} style={{ color: 'var(--text-tertiary)', flexShrink: 0, marginTop: '2px' }} />}
                  <div style={{ flex: 1, minWidth: '200px', fontSize: 'var(--text-sm)', lineHeight: 1.5 }}>
                    {r.next}
                    {r.pausedReason && (
                      <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                        Your reason: “{r.pausedReason}”
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Only where there is something to hide. Offering it on an empty
                  storefront invites a click the rule then refuses, which reads
                  as the screen changing its mind. */}
              {r.state === 'trading' && (
                <div style={{ marginTop: '14px' }}>
                  <Btn variant="secondary" size="sm"
                       onClick={() => setPausing({ categoryId: r.category_id, name: r.name, live: r.live })}>
                    <Store size={13} /> Pause my storefront here
                  </Btn>
                </div>
              )}
              {r.state === 'paused' && (
                <div style={{ marginTop: '14px' }}>
                  <Btn variant="primary" size="sm" onClick={async () => {
                    const res = await reopenStorefront({ partnerId, categoryId: r.category_id, by })
                    toast(res.ok ? (res.note ?? 'Reopened') : res.reason, res.ok ? 'success' : 'error')
                    await onChanged()
                  }}>
                    <CheckCircle size={13} /> Reopen it
                  </Btn>
                </div>
              )}
            </div>
          </SectionCard>
        )
      })}

      {pausing && (
        <PauseModal {...pausing} partnerId={partnerId} by={by}
                    onClose={() => setPausing(null)} onChanged={onChanged} />
      )}
    </div>
  )
}

function PauseModal({ categoryId, name, live, partnerId, by, onClose, onChanged }: {
  categoryId: string; name: string; live: number; partnerId: string; by: string
  onClose: () => void; onChanged: () => Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [err, setErr] = useState('')

  return (
    <Modal open onClose={onClose} title={`Pause your ${name} storefront`}
           footer={<>
             <Btn variant="secondary" onClick={onClose}>Cancel</Btn>
             <Btn variant="danger" onClick={async () => {
               setErr('')
               const r = await pauseStorefront({ partnerId, categoryId, reason, liveListings: live, by })
               if (!r.ok) { setErr(r.reason); return }
               toast(r.note ?? 'Paused')
               onClose()
               await onChanged()
             }}>Pause it</Btn>
           </>}>
      <div style={{ marginBottom: '16px' }}>
        <Callout tone="warning" title={`${live} listing${live === 1 ? '' : 's'} would stop being visible to buyers`}>
          Pausing hides them rather than withdrawing them — nothing is deleted and reopening puts them straight
          back. Orders already placed are unaffected and still have to be fulfilled.
        </Callout>
      </div>
      <FormField label="Why" required
                 hint="A storefront that is dark with no reason on it becomes a support ticket a week later.">
        <TextArea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="Rebuilding the range for Q4 — back on 1 September." />
      </FormField>
      {err && <div style={{ fontSize: 'var(--text-sm)', color: 'var(--danger)', fontWeight: 600 }}>{err}</div>}
    </Modal>
  )
}

/* The company, as opposed to the person. It sits under "You" because that is
   where a seller looks for it, and it is read off the same partner record the
   operator console reads — the old page printed India for a company registered
   in Munich because it came from a constant nobody had kept up. */
function PartnerCompanyFacts({ record }: { record: SellerRecord }) {
  const p = record.partner
  if (!p) return null
  return (
    <SectionCard title="Company" subtitle="The record the marketplace reads">
      <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
        <IconFact icon={<Building size={16} />} label="Legal entity" value={p.name} />
        <IconFact icon={<MapPin size={16} />} label="Country" value={p.country} />
        <IconFact icon={<Shield size={16} />} label="Seller ID" value={p.id} />
        <IconFact icon={<User size={16} />} label="Primary contact" value={p.contact} />
        {/* An address is long enough to break mid-word in a 210px column, and a
            hyphenated email reads as a typo. Two columns, so it does not. */}
        <IconFact icon={<Mail size={16} />} label="Contact address" value={p.email} wide />
        <IconFact icon={<Wallet size={16} />} label="Commission plan" value={record.plan?.name ?? 'Not assigned'} />
      </div>
    </SectionCard>
  )
}

function IconFact({ icon, label, value, wide }: {
  icon: React.ReactNode; label: string; value: string; wide?: boolean
}) {
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'flex-start', gridColumn: wide ? 'span 2' : undefined }}>
      <span style={{ color: 'var(--text-tertiary)', marginTop: '2px' }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
        <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)', wordBreak: 'break-word' }}>{value}</div>
      </div>
    </div>
  )
}
