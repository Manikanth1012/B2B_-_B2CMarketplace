import { Users, Shield, History, User, Mail, Phone, MapPin, Building, FileText } from 'lucide-react'
import { SectionCard, Table, Td, StatusPill, Btn, toast } from '../operator/shared'
import { PARTNER_PROFILE } from './data'

export function PartnerTeam() {
  const team = [
    { name: 'Rajesh Kumar', email: 'rajesh.kumar@nimbussensors.com', role: 'Seller Admin', status: 'active', mfa: true },
    { name: 'Priya Nair', email: 'priya.nair@nimbussensors.com', role: 'Fulfilment Operator', status: 'active', mfa: false },
    { name: 'Arjun Mehta', email: 'arjun.mehta@nimbussensors.com', role: 'Finance', status: 'active', mfa: true },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Your Team</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            People at {PARTNER_PROFILE.name}. Only the seller admin can publish listings and act on onboarding.
          </p>
        </div>
        <Btn variant="primary">Invite a colleague</Btn>
      </div>

      <div style={{
        padding: '14px 18px', borderRadius: 'var(--radius-md)',
        background: 'var(--info-bg)', border: '1px solid var(--info)',
        fontSize: 'var(--text-sm)', color: 'var(--info)',
      }}>
        These are people at <strong>{PARTNER_PROFILE.name}</strong>, not marketplace staff. The marketplace never sees your team list; it only sees which of you acted on an order.
      </div>

      <SectionCard title="Your Team" subtitle={`${team.length} members`}>
        <Table headers={['Name', 'Email', 'Role', 'MFA', 'Status', '']}>
          {team.map(m => (
            <tr key={m.email}>
              <Td>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#5E4B9B', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 'var(--text-xs)', flexShrink: 0 }}>
                    {m.name.split(' ').map(w => w[0]).join('')}
                  </div>
                  <span style={{ fontWeight: 600 }}>{m.name}</span>
                </div>
              </Td>
              <Td>{m.email}</Td>
              <Td>{m.role}</Td>
              <Td right>{m.mfa ? <StatusPill status="active" /> : <StatusPill status="draft" />}</Td>
              <Td right><StatusPill status={m.status} /></Td>
              <Td right><Btn variant="secondary" size="sm" onClick={() => toast('Team member detail opened')}>Edit</Btn></Td>
            </tr>
          ))}
        </Table>
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

export function PartnerProfile() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>My Details</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          Name, contact, time zone and cover while you are away.
        </p>
      </div>

      <SectionCard title="Contact Information" subtitle="What the marketplace holds about you">
        <div style={{ padding: '20px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
          <DetailRow icon={<User size={16} />} label="Name" value={PARTNER_PROFILE.contact} />
          <DetailRow icon={<Building size={16} />} label="Company" value={PARTNER_PROFILE.name} />
          <DetailRow icon={<Mail size={16} />} label="Email" value="rajesh.kumar@nimbussensors.com" />
          <DetailRow icon={<Phone size={16} />} label="Phone" value="+91 98765 43210" />
          <DetailRow icon={<MapPin size={16} />} label="Country" value={PARTNER_PROFILE.country} />
          <DetailRow icon={<Shield size={16} />} label="Partner ID" value={PARTNER_PROFILE.id} />
        </div>
      </SectionCard>

      <SectionCard title="Compliance Documents" subtitle="What you handed over at onboarding">
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[
            { name: 'Certificate of incorporation', status: 'verified', when: '09 Sep 2024' },
            { name: 'Beneficial ownership declaration', status: 'verified', when: '09 Sep 2024' },
            { name: 'Bank verification letter', status: 'verified', when: '13 Sep 2024' },
            { name: 'Tax residency certificate', status: 'expiring', when: 'Expires 11 Sep 2026' },
          ].map(d => (
            <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 'var(--radius)' }}>
              <FileText size={18} style={{ color: 'var(--text-tertiary)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{d.name}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{d.when}</div>
              </div>
              <StatusPill status={d.status === 'verified' ? 'verified' : 'degraded'} />
              <Btn variant="secondary" size="sm" onClick={() => toast('Document opened')}>View</Btn>
            </div>
          ))}
        </div>
      </SectionCard>
    </div>
  )
}

function DetailRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
      <span style={{ color: 'var(--text-tertiary)' }}>{icon}</span>
      <div>
        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{label}</div>
        <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>{value}</div>
      </div>
    </div>
  )
}

