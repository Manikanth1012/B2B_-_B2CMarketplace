import { useState, useEffect, useCallback } from 'react'
import { Pager, usePaging } from '../Pager'
import {
  SectionCard, Table, Td, StatusPill, Btn, toast, fmtDate,
  Modal, FormField, TextInput, Select, ConfirmDialog,
} from '../operator/shared'
import { Callout } from '../OnboardingJourney'
import { PARTNER_PROFILE } from './data'
import { loadMyDetails, inviteColleague, removeColleague, restoreColleague } from '../../lib/partnerDetailsRepo'
import {
  ROLE_LABEL, ROLE_SCOPE, securityGaps, validateInvite, canRemove, blankInvite,
} from '../../lib/partnerDetails'
import type { PartnerUser, InviteDraft } from '../../lib/partnerDetails'

/* The roster is the same rows My details reads. It used to be three names in a
   TypeScript array, which meant this page and that one could disagree about who
   works here — and once they do, neither is worth reading. */
export function PartnerTeam({ partnerId }: { partnerId: string }) {
  const [team, setTeam] = useState<PartnerUser[] | null>(null)
  const [me, setMe] = useState<PartnerUser | null>(null)
  /* "Invite a colleague" raised an informational toast saying invitations are
     sent by the marketplace desk. The desk does not send them; nothing did. */
  const [inviting, setInviting] = useState<InviteDraft | null>(null)
  const [viewing, setViewing] = useState<PartnerUser | null>(null)
  const [removing, setRemoving] = useState<PartnerUser | null>(null)
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    const d = await loadMyDetails(partnerId)
    setMe(d.me)
    setTeam(d.me ? [d.me, ...d.colleagues] : d.colleagues)
  }, [partnerId])
  useEffect(() => { void reload() }, [reload])

  const send = async () => {
    if (!inviting || !team) return
    const check = validateInvite(inviting, team)
    if (!check.ok) { toast(check.reason, 'error'); return }
    setBusy(true)
    const r = await inviteColleague(partnerId, inviting)
    setBusy(false)
    toast(r.ok ? r.note ?? 'Invited' : r.reason, r.ok ? 'success' : 'error')
    if (r.ok) { setInviting(null); await reload() }
  }

  const drop = async () => {
    if (!removing) return
    setBusy(true)
    const r = await removeColleague(removing)
    setBusy(false)
    toast(r.ok ? r.note ?? 'Removed' : r.reason, r.ok ? 'success' : 'error')
    setRemoving(null); setViewing(null)
    if (r.ok) await reload()
  }

  const restore = async (who: PartnerUser) => {
    setBusy(true)
    const r = await restoreColleague(who)
    setBusy(false)
    toast(r.ok ? r.note ?? 'Restored' : r.reason, r.ok ? 'success' : 'error')
    setViewing(null)
    if (r.ok) await reload()
  }

  /* Above the loading guard: `usePaging` is a hook, and a hook after an
     early return runs on some renders and not others. */
  const teamPage = usePaging(team ?? [])

  if (!team) return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>

  const gaps = securityGaps(team)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Your Team</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            People at {PARTNER_PROFILE.name}. Only the seller admin can publish listings and act on onboarding.
          </p>
        </div>
        <Btn variant="primary" onClick={() => setInviting(blankInvite())}>
          Invite a colleague
        </Btn>
      </div>

      <div style={{
        padding: '14px 18px', borderRadius: 'var(--radius-md)',
        background: 'var(--info-bg)', border: '1px solid var(--info)',
        fontSize: 'var(--text-sm)', color: 'var(--info)',
      }}>
        These are people at <strong>{PARTNER_PROFILE.name}</strong>, not marketplace staff. The marketplace never sees your team list; it only sees which of you acted on an order.
      </div>

      {gaps.length > 0 && (
        <div style={{
          padding: '14px 18px', borderRadius: 'var(--radius-md)',
          background: 'var(--warning-bg)', borderLeft: '3px solid var(--warning)',
          fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6,
        }}>
          <strong style={{ color: 'var(--warning)', display: 'block', marginBottom: '4px' }}>
            {gaps.length} thing{gaps.length === 1 ? '' : 's'} worth fixing on these sign-ins
          </strong>
          {gaps.map((g, i) => (
            <div key={i}><strong>{g.who} — {g.what}.</strong> {g.why}</div>
          ))}
        </div>
      )}

      <SectionCard title="Your Team" subtitle={`${team.length} ${team.length === 1 ? 'person' : 'people'}`}>
        <><Table headers={['Name', 'Email', 'Role', 'MFA', 'Last active', 'Status', '']}>
          {teamPage.rows.map(m => (
            <tr key={m.email}>
              <Td>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#5E4B9B', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 'var(--text-xs)', flexShrink: 0 }}>
                    {m.name.split(' ').map(w => w[0]).join('')}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{m.name}{m.id === me?.id && <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}> · you</span>}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{m.job_title}</div>
                  </div>
                </div>
              </Td>
              <Td>{m.email}</Td>
              <Td>
                <div>{ROLE_LABEL[m.role]}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{ROLE_SCOPE[m.role]}</div>
              </Td>
              <Td right>{m.mfa ? <StatusPill status="active" /> : <StatusPill status="draft" />}</Td>
              <Td right style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{m.last_active ?? '—'}</Td>
              <Td right><StatusPill status={m.status} /></Td>
              <Td right>
                <Btn variant="secondary" size="sm" onClick={() => setViewing(m)}>
                  {m.id === me?.id ? 'That is you' : 'Detail'}
                </Btn>
              </Td>
            </tr>
          ))}
        </Table>
        <div style={{ padding: '0 18px 12px' }}><Pager page={teamPage} noun="people" /></div></>
      </SectionCard>

      {/* ---------------------------------------------------------- invite */}
      <Modal
        open={!!inviting}
        onClose={() => setInviting(null)}
        title="Invite a colleague"
        footer={
          <div style={{ display: 'flex', gap: '8px' }}>
            <Btn variant="secondary" onClick={() => setInviting(null)}>Cancel</Btn>
            <Btn variant="primary" disabled={busy} onClick={() => void send()}>
              {busy ? 'Sending…' : 'Send the invitation'}
            </Btn>
          </div>
        }>
        {inviting && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <Callout tone="info">
              They join as <strong>invited</strong> and can do nothing until they set a password and sign in.
              The marketplace never sees your team list — only which of you acted on an order.
            </Callout>

            <FormField label="Name" required hint="What colleagues see against their actions on the audit log.">
              <TextInput value={inviting.name} onChange={e => setInviting({ ...inviting, name: e.target.value })}
                         placeholder="Devika Rao" />
            </FormField>
            <FormField label="Work email" required>
              <TextInput value={inviting.email} onChange={e => setInviting({ ...inviting, email: e.target.value })}
                         placeholder={`someone@${me?.email.split('@')[1] ?? 'yourcompany.com'}`} />
            </FormField>
            <FormField label="Job title" required hint="The marketplace desk uses it to work out who to ask.">
              <TextInput value={inviting.jobTitle} onChange={e => setInviting({ ...inviting, jobTitle: e.target.value })}
                         placeholder="Warehouse lead" />
            </FormField>
            <FormField label="Role" hint={ROLE_SCOPE[inviting.role]}>
              <Select value={inviting.role}
                      onChange={e => setInviting({ ...inviting, role: e.target.value as PartnerUser['role'] })}>
                {(Object.keys(ROLE_LABEL) as PartnerUser['role'][]).map(r => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </Select>
            </FormField>

            {/* Said before they send it rather than after — a warning that
                arrives as a refusal is a warning nobody thanks you for. */}
            {team && inviting.email.trim() && (() => {
              const check = validateInvite(inviting, team)
              if (!check.ok) return <Callout tone="danger" title="This cannot be sent">{check.reason}</Callout>
              if (check.note) return <Callout tone="warning" title="Worth a look first">{check.note}</Callout>
              return null
            })()}
          </div>
        )}
      </Modal>

      {/* ---------------------------------------------------------- detail */}
      <Modal
        open={!!viewing}
        onClose={() => setViewing(null)}
        title={viewing ? viewing.name : ''}
        footer={
          <div style={{ display: 'flex', gap: '8px', justifyContent: 'space-between', width: '100%' }}>
            <div>
              {viewing && viewing.id !== me?.id && team && (
                viewing.status === 'removed'
                  ? <Btn variant="secondary" size="sm" disabled={busy} onClick={() => void restore(viewing)}>Re-invite them</Btn>
                  : <Btn variant="secondary" size="sm" onClick={() => setRemoving(viewing)}>Remove from account</Btn>
              )}
            </div>
            <Btn variant="secondary" onClick={() => setViewing(null)}>Close</Btn>
          </div>
        }>
        {viewing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 20px' }}>
              <Fact label="Email" value={viewing.email} />
              <Fact label="Job title" value={viewing.job_title} />
              <Fact label="Role" value={ROLE_LABEL[viewing.role]} />
              <Fact label="State" value={viewing.status} />
              <Fact label="Joined" value={fmtDate(viewing.joined)} />
              <Fact label="Last active" value={viewing.last_active ?? 'Never signed in'} />
              <Fact label="Second factor" value={viewing.mfa ? 'On' : 'Off'} />
              <Fact label="Password last changed" value={viewing.pwd_changed ? fmtDate(viewing.pwd_changed) : 'Never'} />
              <Fact label="Open sessions" value={String(viewing.sessions)} />
              <Fact label="Time zone" value={viewing.timezone} />
            </div>

            <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              {ROLE_SCOPE[viewing.role]}
            </div>

            {!viewing.mfa && (
              <Callout tone="warning" title="No second factor">
                A stolen password alone would be enough to sign in as {viewing.name.split(' ')[0]}. They can turn
                it on themselves under My details — nobody else can do it for them.
              </Callout>
            )}
            {viewing.must_reset && (
              <Callout tone="info" title="Password reset outstanding">
                {viewing.name.split(' ')[0]} cannot sign in until they set a new password.
              </Callout>
            )}
            {viewing.id === me?.id && (
              <Callout tone="info">Your own settings are under My details.</Callout>
            )}
            {viewing.id !== me?.id && team && !canRemove(viewing, team).ok && viewing.status !== 'removed' && (
              <Callout tone="warning" title="This one cannot be removed">
                {(canRemove(viewing, team) as { reason: string }).reason}
              </Callout>
            )}
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!removing}
        onClose={() => setRemoving(null)}
        onConfirm={() => void drop()}
        title={removing ? `Remove ${removing.name}?` : ''}
        message={removing && team
          ? (canRemove(removing, team).ok
              ? `They lose access immediately and any open session ends. What they did stays on the audit log against their name, which is why this is a removal and not a deletion.`
              : (canRemove(removing, team) as { reason: string }).reason)
          : ''}
        confirmLabel="Remove them"
        danger
      />
    </div>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: '10px', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-sm)', color: 'var(--text)', marginTop: '1px' }}>{value}</div>
    </div>
  )
}

export function PartnerAudit() {
  const entries = [
    { when: '28 Jul 2026, 07:58', who: 'Rajesh Kumar', action: 'Signed in', detail: 'Seller portal', sev: 'info' },
    { when: '25 Jul 2026, 14:22', who: 'Rajesh Kumar', action: 'Submitted listing for review', detail: 'Nimbus VPN Gateway (SKU-NB-VPN1)', sev: 'high' },
    { when: '22 Jul 2026, 11:05', who: 'Marketplace', action: 'Application submitted', detail: 'Security Marketplace onboarding — ONB-8842', sev: 'high' },
    { when: '15 Jul 2026, 09:30', who: 'Arjun Mehta', action: 'Downloaded settlement statement', detail: 'STM-2026-06', sev: 'info' },
    { when: '10 Jul 2026, 16:45', who: 'Priya Nair', action: 'Advanced order ORD-880487', detail: 'Marked as In transit', sev: 'normal' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Audit Log</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          <strong>Your account only.</strong> This is what happened on {PARTNER_PROFILE.name} — your people, your listings, your orders. Entries cannot be edited or deleted by anyone.
        </p>
      </div>

      <SectionCard title="Recent Activity" subtitle={`${entries.length} entries`}>
        <Table headers={['When', 'Who', 'Action', 'Detail', 'Severity']}>
          {entries.map((e, i) => (
            <tr key={i}>
              <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{e.when}</Td>
              <Td>{e.who}</Td>
              <Td>{e.action}</Td>
              <Td style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{e.detail}</Td>
              <Td right>
                <span style={{
                  fontSize: 'var(--text-xs)', fontWeight: 600, padding: '2px 8px', borderRadius: 'var(--radius-full)',
                  background: e.sev === 'high' ? 'var(--danger-bg)' : e.sev === 'normal' ? 'var(--info-bg)' : 'var(--bg-alt)',
                  color: e.sev === 'high' ? 'var(--danger)' : e.sev === 'normal' ? 'var(--info)' : 'var(--text-tertiary)',
                }}>
                  {e.sev}
                </span>
              </Td>
            </tr>
          ))}
        </Table>
      </SectionCard>
    </div>
  )
}
