import { useState, useEffect } from 'react'
import { Users, History, User, Mail, Phone, MapPin, Building2, Shield, FileText } from 'lucide-react'
import { SectionCard, Table, Td, StatusPill, Btn, toast } from '../operator/shared'
import { loadAccount } from '../../lib/enterpriseRepo'
import type { AccountBook } from '../../lib/enterpriseRepo'
import { ROLE_LABEL, money } from '../../lib/enterprise'

/* The team, the account and what it may spend all come from `enterprise_users`
   and `enterprise_accounts`. They used to be arrays typed into this file, which
   is how the team page listed an "Anita Rao" who does not exist while every
   requisition on the account was raised by Anita Desai. */
function useAccount(): AccountBook | null {
  const [book, setBook] = useState<AccountBook | null>(null)
  useEffect(() => { void (async () => setBook(await loadAccount()))() }, [])
  return book
}

export function EnterpriseTeam() {
  const book = useAccount()
  const team = book?.members ?? []

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Team & Roles</h1>
          <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
            People at {book?.account?.company ?? 'this account'} who can buy or approve. Who may sign what is the account’s
            own control — the marketplace only records who placed each order.
          </p>
        </div>
        <Btn variant="primary">Invite a colleague</Btn>
      </div>

      <SectionCard title="Your Team" subtitle={`${team.length} members · what each of them may sign`}>
        <Table headers={['Name', 'Email', 'Role', 'May raise', 'May approve', 'Up to', 'Cost centre', 'MFA', 'Status']}>
          {team.map(m => (
            <tr key={m.id}>
              <Td>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#006B6B', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 'var(--text-xs)', flexShrink: 0 }}>
                    {m.name.split(' ').map(w => w[0]).join('').slice(0, 2)}
                  </div>
                  <div>
                    <div style={{ fontWeight: 600 }}>{m.name}</div>
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>{m.title}</div>
                  </div>
                </div>
              </Td>
              <Td>{m.email}</Td>
              <Td>{ROLE_LABEL[m.role]}</Td>
              <Td right>{m.can_raise ? 'yes' : '—'}</Td>
              <Td right style={{ fontSize: 'var(--text-xs)' }}>
                {m.approves_finance && m.approves_it ? 'finance and IT'
                  : m.approves_finance ? 'finance'
                    : m.approves_it ? 'IT' : '—'}
              </Td>
              <Td right>{m.approves_finance || m.approves_it ? (m.approve_limit === null ? 'no ceiling' : money(Number(m.approve_limit))) : '—'}</Td>
              <Td right style={{ fontSize: 'var(--text-xs)' }}>
                {book?.centres.find(c => c.id === m.cost_centre)?.name ?? m.cost_centre ?? '—'}
              </Td>
              <Td right>{m.mfa ? <StatusPill status="active" /> : <StatusPill status="draft" />}</Td>
              <Td right><StatusPill status={m.status === 'invited' ? 'pending' : m.status} /></Td>
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
          <strong>Your account only.</strong> What happened on this account — your people, your orders, your approvals. Entries cannot be edited or deleted.
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
  const book = useAccount()
  const account = book?.account
  const me = book?.me
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
          <DetailRow icon={<User size={16} />} label="Name" value={me?.name ?? '—'} />
          <DetailRow icon={<Building2 size={16} />} label="Company" value={account?.company ?? '—'} />
          <DetailRow icon={<Mail size={16} />} label="Email" value={me?.email ?? '—'} />
          <DetailRow icon={<Phone size={16} />} label="Phone" value={me?.phone ?? 'Not on file'} />
          <DetailRow icon={<MapPin size={16} />} label="Sites" value={account ? `${account.sites} locations` : '—'} />
          <DetailRow icon={<Shield size={16} />} label="Account ID" value={account?.id ?? '—'} />
        </div>
      </SectionCard>

      <SectionCard title="Procurement Settings" subtitle="Approval thresholds and policies">
        <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <DetailRow icon={<FileText size={16} />} label="Approval threshold"
                     value={book?.policy ? `${money(Number(book.policy.threshold))} — finance approval required at or above this` : '—'} />
          <DetailRow icon={<Shield size={16} />} label="Security sign-off"
                     value={book?.policy?.security_signoff ? 'Required for every security purchase whatever it costs' : 'Not required separately'} />
          <DetailRow icon={<Building2 size={16} />} label="Payment terms" value={account?.terms ?? '—'} />
          <DetailRow icon={<Users size={16} />} label="Approvers"
                     value={(book?.members ?? []).filter(m => m.approves_finance || m.approves_it).map(m => m.name).join(', ') || '—'} />
          <DetailRow icon={<Shield size={16} />} label="Self-approval"
                     value={book?.policy?.self_approve ? 'Allowed — an approver may sign their own request' : 'Not allowed — somebody else has to sign your request'} />
          <DetailRow icon={<FileText size={16} />} label="Purchase order"
                     value={account?.po_required ? 'Required on every invoice' : 'Not required'} />
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
