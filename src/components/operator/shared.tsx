import React from 'react'

export function fmtMoney(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtInt(n: number): string {
  return n.toLocaleString('en-US')
}

export function fmtDate(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function fmtDateTime(s: string | null): string {
  if (!s) return '—'
  const d = new Date(s)
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' }) + ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    pending: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
    approved: { bg: 'var(--success-bg)', color: 'var(--success)' },
    rejected: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
    cleared: { bg: 'var(--success-bg)', color: 'var(--success)' },
    current: { bg: 'var(--info-bg)', color: 'var(--info)' },
    open: { bg: 'var(--info-bg)', color: 'var(--info)' },
    resolved: { bg: 'var(--success-bg)', color: 'var(--success)' },
    active: { bg: 'var(--success-bg)', color: 'var(--success)' },
    paused: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
    escalated: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
    degraded: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
    healthy: { bg: 'var(--success-bg)', color: 'var(--success)' },
    live: { bg: 'var(--success-bg)', color: 'var(--success)' },
  }
  const s = map[status] || { bg: 'var(--gray-100)', color: 'var(--text-secondary)' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '2px 10px', borderRadius: 'var(--radius-full)',
      fontSize: 'var(--text-xs)', fontWeight: 600,
      background: s.bg, color: s.color,
    }}>
      {status}
    </span>
  )
}

export function PriorityPill({ priority }: { priority: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    P1: { bg: '#FEE2E2', color: '#DC2626' },
    P2: { bg: '#FEF3C7', color: '#F59E0B' },
    P3: { bg: '#DBEAFE', color: '#2563EB' },
    P4: { bg: '#F3F4F6', color: '#6B7280' },
  }
  const s = map[priority] || { bg: '#F3F4F6', color: '#6B7280' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', fontWeight: 700, background: s.bg, color: s.color }}>
      {priority}
    </span>
  )
}

export function SectionCard({ title, subtitle, children, action }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
          {subtitle && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

export function StatCard({ label, value, sublabel, color }: { label: string; value: string; sublabel?: string; color?: string }) {
  return (
    <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '20px' }}>
      <div style={{ fontSize: 'var(--text-xs)', fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{label}</div>
      <div style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: color || 'var(--text)', marginTop: '4px' }}>{value}</div>
      {sublabel && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{sublabel}</div>}
    </div>
  )
}

export function Table({ headers, children }: { headers: string[]; children: React.ReactNode }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--text-sm)' }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            {headers.map((h, i) => (
              <th key={i} style={{ textAlign: i === 0 ? 'left' : 'right', padding: '10px 16px', fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Td({ children, right, style }: { children: React.ReactNode; right?: boolean; style?: React.CSSProperties }) {
  return <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-light)', textAlign: right ? 'right' : 'left', color: 'var(--text)', verticalAlign: 'middle', ...style }}>{children}</td>
}

export function EmptyState({ message }: { message: string }) {
  return (
    <div style={{ padding: '40px 20px', textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
      {message}
    </div>
  )
}
