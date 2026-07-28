import React, { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'

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
    draft: { bg: 'var(--bg-alt)', color: 'var(--text-tertiary)' },
    deprecated: { bg: 'var(--warning-bg)', color: 'var(--warning)' },
    sunset: { bg: 'var(--danger-bg)', color: 'var(--danger)' },
    supported: { bg: 'var(--info-bg)', color: 'var(--info)' },
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

// ---------- Modal ----------

export interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
  footer?: React.ReactNode
}

export function Modal({ open, onClose, title, children, footer }: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '40px 16px',
        overflowY: 'auto',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'white', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-lg)',
          maxWidth: '640px', width: '100%', margin: '0 auto',
          display: 'flex', flexDirection: 'column',
          maxHeight: '90vh',
        }}
      >
        <div style={{
          padding: '16px 20px', borderBottom: '1px solid var(--border-light)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <h3 style={{ fontSize: 'var(--text-lg)', fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
          <button onClick={onClose} style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: '4px' }}>
            <X size={20} />
          </button>
        </div>
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1 }}>
          {children}
        </div>
        {footer && (
          <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border-light)', display: 'flex', gap: '8px', justifyContent: 'flex-end', flexShrink: 0 }}>
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------- Form primitives ----------

export function FormField({ label, children, required, hint }: { label: string; children: React.ReactNode; required?: boolean; hint?: string }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <label style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)', marginBottom: '6px' }}>
        {label}{required && <span style={{ color: 'var(--danger)' }}> *</span>}
      </label>
      {children}
      {hint && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>{hint}</div>}
    </div>
  )
}

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} style={{
    width: '100%', padding: '10px 12px',
    borderRadius: 'var(--radius)', border: '1px solid var(--border)',
    fontSize: 'var(--text-sm)', color: 'var(--text)', outline: 'none',
    ...props.style,
  }} />
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} style={{
    width: '100%', padding: '10px 12px',
    borderRadius: 'var(--radius)', border: '1px solid var(--border)',
    fontSize: 'var(--text-sm)', color: 'var(--text)', outline: 'none',
    resize: 'vertical', minHeight: '60px',
    ...props.style,
  }} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} style={{
    width: '100%', padding: '10px 12px',
    borderRadius: 'var(--radius)', border: '1px solid var(--border)',
    fontSize: 'var(--text-sm)', color: 'var(--text)', outline: 'none',
    background: 'white',
    ...props.style,
  }} />
}

export function Btn({ variant = 'primary', size = 'md', children, ...props }: {
  variant?: 'primary' | 'secondary' | 'danger' | 'success'
  size?: 'sm' | 'md'
  children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const bg = variant === 'danger' ? 'var(--danger)' : variant === 'success' ? 'var(--success)' : variant === 'secondary' ? 'var(--bg-alt)' : 'var(--brand-navy)'
  const color = variant === 'secondary' ? 'var(--text-secondary)' : 'white'
  const pad = size === 'sm' ? '6px 12px' : '10px 16px'
  return (
    <button {...props} style={{
      padding: pad, borderRadius: 'var(--radius)',
      background: bg, color, border: variant === 'secondary' ? '1px solid var(--border)' : 'none',
      fontSize: size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)',
      fontWeight: 600, cursor: props.disabled ? 'not-allowed' : 'pointer',
      opacity: props.disabled ? 0.5 : 1,
      ...props.style,
    }}>
      {children}
    </button>
  )
}

// ---------- Confirm dialog ----------

export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, danger }: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
}) {
  return (
    <Modal open={open} onClose={onClose} title={title}
      footer={
        <>
          <Btn variant="secondary" size="sm" onClick={onClose}>Cancel</Btn>
          <Btn variant={danger ? 'danger' : 'primary'} size="sm" onClick={() => { onConfirm(); onClose() }}>{confirmLabel || 'Confirm'}</Btn>
        </>
      }
    >
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>{message}</p>
    </Modal>
  )
}

// ---------- Toast ----------

let toastId = 0
const toastListeners: Set<(t: { id: number; message: string; kind: string }) => void> = new Set()

export function toast(message: string, kind: 'success' | 'error' | 'info' = 'success') {
  toastId++
  toastListeners.forEach(l => l({ id: toastId, message, kind }))
}

export function ToastHost() {
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: string }[]>([])

  useEffect(() => {
    const listener = (t: { id: number; message: string; kind: string }) => {
      setToasts(prev => [...prev, t])
      setTimeout(() => setToasts(prev => prev.filter(x => x.id !== t.id)), 3500)
    }
    toastListeners.add(listener)
    return () => { toastListeners.delete(listener) }
  }, [])

  return (
    <div style={{ position: 'fixed', bottom: '24px', right: '24px', zIndex: 2000, display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          padding: '12px 20px', borderRadius: 'var(--radius-md)',
          background: t.kind === 'error' ? 'var(--danger)' : t.kind === 'info' ? 'var(--info)' : 'var(--success)',
          color: 'white', fontSize: 'var(--text-sm)', fontWeight: 600,
          boxShadow: 'var(--shadow-lg)',
          animation: 'slideIn 200ms ease',
        }}>
          {t.message}
        </div>
      ))}
    </div>
  )
}
