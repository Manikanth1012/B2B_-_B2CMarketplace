import { Users, History, User, Mail, Phone, MapPin, Building2, Shield, FileText } from 'lucide-react'
import { SectionCard, Table, Td, StatusPill, Btn, toast } from '../operator/shared'
import { ENTERPRISE_PROFILE } from './data'

export function EnterpriseTeam() {
  const team = [
    { name: 'Vikram Shah', email: 'vikram.shah@smartbuild.in', role: 'Procurement Lead', status: 'active', mfa: true },
    { name: 'Anita Rao', email: 'anita.rao@smartbuild.in', role: 'Buyer', status: 'active', mfa: true },
    { name: 'Meera Iyer', email: 'meera.iyer@smartbuild.in', role: 'Approver (CFO)', status: 'active', mfa: true },
    { name: 'Karthik N', email: 'karthik.n@smartbuild.in', role: 'IT Sign-off', status: 'active', mfa: false },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Team & Roles</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            People at {ENTERPRISE_PROFILE.company} who can buy or approve. The marketplace sees who placed each order.
          </p>
        </div>
        <Btn variant="primary">Invite a colleague</Btn>
      </div>

      <SectionCard title="Your Team" subtitle={`${team.length} members`}>
        <Table headers={['Name', 'Email', 'Role', 'MFA', 'Status', '']}>
          {team.map(m => (
            <tr key={m.email}>
              <Td>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#006B6B', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 'var(--text-xs)', flexShrink: 0 }}>
                    {m.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
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

export function EnterpriseAudit() {
  const entries = [
    { when: '28 Jul 2026, 08:12', who: 'Vikram Shah', action: 'Signed in', detail: 'Enterprise portal', sev: 'info' },
    { when: '26 Jul 2026, 14:30', who: 'Vikram Shah', action: 'Raised requisition', detail: 'REQ-301 · CloudZTNA seat expansion', sev: 'high' },
    { when: '25 Jul 2026, 11:15', who: 'Anita Rao', action: 'Raised requisition', detail: 'REQ-302 · Nimbus Cold-Chain Bundle (10 units)', sev: 'high' },
    { when: '24 Jul 2026, 09:45', who: 'Meera Iyer', action: 'Approved requisition', detail: 'REQ-299 · 6D Connect SIM renewal', sev: 'normal' },
    { when: '20 Jul 2026, 16:20', who: 'Vikram Shah', action: 'Placed order', detail: 'ORD-880487 · Nimbus Air Quality Sensor', sev: 'normal' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Audit Log</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          <strong>Your account only.</strong> What happened on {ENTERPRISE_PROFILE.company} — your people, your orders, your approvals. Entries cannot be edited or deleted.
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

export function EnterpriseProfile() {
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
          <DetailRow icon={<User size={16} />} label="Name" value={ENTERPRISE_PROFILE.contact} />
          <DetailRow icon={<Building2 size={16} />} label="Company" value={ENTERPRISE_PROFILE.company} />
          <DetailRow icon={<Mail size={16} />} label="Email" value="vikram.shah@smartbuild.in" />
          <DetailRow icon={<Phone size={16} />} label="Phone" value="+91 98100 12345" />
          <DetailRow icon={<MapPin size={16} />} label="Sites" value={`${ENTERPRISE_PROFILE.sites} locations`} />
          <DetailRow icon={<Shield size={16} />} label="Account ID" value={ENTERPRISE_PROFILE.id} />
        </div>
      </SectionCard>

      <SectionCard title="Procurement Settings" subtitle="Approval thresholds and policies">
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <DetailRow icon={<FileText size={16} />} label="Approval threshold" value="$2,000 — finance approval required above this" />
          <DetailRow icon={<Shield size={16} />} label="Security sign-off" value="Required for all security purchases regardless of value" />
          <DetailRow icon={<Building2 size={16} />} label="Payment terms" value={ENTERPRISE_PROFILE.terms} />
          <DetailRow icon={<Users size={16} />} label="Approver" value={ENTERPRISE_PROFILE.approver} />
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
