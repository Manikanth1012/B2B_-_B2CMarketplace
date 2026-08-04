import { useState, useEffect } from 'react'
import { Pager, usePaging } from '../Pager'
import { SectionCard, Table, Td, StatusPill, Btn, toast, fmtDate } from '../operator/shared'
import { PARTNER_PROFILE } from './data'
import { loadMyDetails } from '../../lib/partnerDetailsRepo'
import { ROLE_LABEL, ROLE_SCOPE, securityGaps } from '../../lib/partnerDetails'
import type { PartnerUser } from '../../lib/partnerDetails'

/* The roster is the same rows My details reads. It used to be three names in a
   TypeScript array, which meant this page and that one could disagree about who
   works here — and once they do, neither is worth reading. */
export function PartnerTeam({ partnerId }: { partnerId: string }) {
  const [team, setTeam] = useState<PartnerUser[] | null>(null)
  const [me, setMe] = useState<PartnerUser | null>(null)

  useEffect(() => {
    void loadMyDetails(partnerId).then(d => {
      setMe(d.me)
      setTeam(d.me ? [d.me, ...d.colleagues] : d.colleagues)
    })
  }, [partnerId])

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
        <Btn variant="primary" onClick={() => toast('Invitations are sent by the marketplace desk in this build', 'info')}>
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
                <Btn variant="secondary" size="sm"
                     onClick={() => toast(m.id === me?.id
                       ? 'Your own details are under My details'
                       : `${m.name} last changed their password ${m.pwd_changed ? fmtDate(m.pwd_changed) : 'never'}`, 'info')}>
                  {m.id === me?.id ? 'That is you' : 'Detail'}
                </Btn>
              </Td>
            </tr>
          ))}
        </Table>
        <div style={{ padding: '0 18px 12px' }}><Pager page={teamPage} noun="people" /></div></>
      </SectionCard>
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
