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
    P1: { bg: '#FEE2E2', color: 'var(--danger)' },
    P2: { bg: '#FEF3C7', color: 'var(--warning)' },
    P3: { bg: '#DBEAFE', color: 'var(--info)' },
    P4: { bg: '#F3F4F6', color: '#6B7280' },
  }
  const s = map[priority] || { bg: '#F3F4F6', color: '#6B7280' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', padding: '2px 8px', borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-xs)', fontWeight: 700, background: s.bg, color: s.color }}>
      {priority}
    </span>
  )
}

/**
 * `anchor` gives the card a name the account menu can send somebody to.
 *
 * The three consoles' avatar menus offer "Sign-in & security" and "Sessions",
 * and both live on a long profile page rather than on screens of their own.
 * Without a name to aim at, those two items had nowhere to go — which is why
 * they did nothing at all until now.
 */
export function SectionCard({ title, subtitle, children, action, anchor, pad }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode; anchor?: string; pad?: boolean }) {
  return (
    <div id={anchor} style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden', scrollMarginTop: '84px' }}>
      <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border-light)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ fontSize: 'var(--text-base)', fontWeight: 700, color: 'var(--text)' }}>{title}</h3>
          {subtitle && <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>{subtitle}</p>}
        </div>
        {action}
      </div>
      {/* A table runs edge to edge and a form does not.
       *
       * The body has always been unpadded, which is right for a `Table` — its
       * own cells carry the inset — and wrong for anything else. Every screen
       * that puts a form in one of these was expected to remember its own
       * wrapper, and six of them did not: the inputs sat flush against the
       * card's border, so the field box and the card box drew one on top of the
       * other and read as a single merged edge.
       *
       * `pad` rather than padding by default, because changing the default
       * would inset every table on the console by twenty pixels it does not
       * need. The last row's own margin is pulled back so the padding below a
       * form is the padding and not the padding plus a field's tail. */}
      {pad
        ? <div style={{ padding: '18px 20px 4px' }}>{children}</div>
        : children}
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

/**
 * The table these consoles are built from.
 *
 * Sized to fit its card rather than to a comfortable width with a scrollbar
 * underneath. Half the dashboard's cards sat in a two-column grid and pushed
 * their last column — usually the one with the button in it — out of sight
 * behind a horizontal scrollbar, which is the one place nobody looks.
 *
 * Three things buy the room back: 10px of side padding instead of 16, which
 * across five columns is sixty pixels; headers that wrap, because "SETTLEMENT
 * PLAN" over two lines costs nothing and holding it on one costs a column; and
 * figures that do not wrap, so the padding comes out of the prose rather than
 * out of "$41,871.56".
 *
 * `overflowX` stays as a floor — a narrow phone can always defeat this — but
 * it should now be rare rather than routine.
 *
 * What that squeeze cost, and what `min-content` buys back
 * -------------------------------------------------------
 * Sizing to the card was right; sizing to the card *at any price* was not. An
 * eleven-column inventory table given a nine-column card printed "Kestrel
 * Device / s" and "Catalog / ue" — words split down the middle, because
 * `width: 100%` lets the auto layout take a column below the width of the
 * longest word in it and break inside that word to fit.
 *
 * `min-width: min-content` is the floor that was missing. It says: never
 * narrower than the widest unbreakable thing in each column. Below that the
 * wrapper scrolls, which is the outcome the squeeze was avoiding — but a
 * scrollbar is recoverable and "Device s" is not. In practice almost every
 * table clears it and nothing scrolls; the two that do not were never going to
 * fit and were lying about it.
 */
/**
 * A column heading.
 *
 * A bare string keeps the old rule — first column left, every other right,
 * which is correct when every other column is a figure. Where one is not (a
 * "Why", a note, a reason) the alignment has to be sayable, or the header sits
 * at one edge of the column and its prose at the other.
 */
export type Header = string | { label: string; align: 'left' | 'right' }

const headerLabel = (h: Header): string => (typeof h === 'string' ? h : h.label)
const headerAlign = (h: Header, i: number): 'left' | 'right' =>
  typeof h === 'string' ? (i === 0 ? 'left' : 'right') : h.align

/**
 * Side padding, chosen by how many columns have to share the width.
 *
 * Ten columns paying 20px each in padding spend 200px on whitespace before a
 * single character is drawn, which on a 1000px card is a fifth of the table.
 * Five columns can afford it and ten cannot, so the number is not a constant.
 * Passed down through a CSS variable so the cells do not each need telling.
 */
const padFor = (columns: number): string =>
  columns >= 10 ? '6px' : columns >= 8 ? '7px' : '10px'

export function Table({ headers, children }: { headers: Header[]; children: React.ReactNode }) {
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{
        ['--cell-pad' as string]: padFor(headers.length),
        width: '100%', borderCollapse: 'collapse', tableLayout: 'auto',
        /* 13px rather than 14. Across a nine-column table that is most of a
           column, and at this size it is still a comfortable read — these are
           dense records, not prose. */
        fontSize: 'var(--text-table)',
        /* The floor. See above: without it a column can be narrower than the
           longest word it holds, and the browser breaks the word. */
        minWidth: 'min-content',
      }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--border)' }}>
            {headers.map((h, i) => (
              <th key={i} style={{
                textAlign: headerAlign(h, i), padding: '10px var(--cell-pad, 10px)',
                fontSize: 'var(--text-xs)', fontWeight: 700, color: 'var(--text-tertiary)',
                textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.25,
                /* A header may wrap between its words — "SETTLEMENT / PLAN" is
                   fine and cheap — but never inside one. "SUBSCRI / BERS" is
                   not a word anybody is looking for. */
                overflowWrap: 'normal', wordBreak: 'keep-all',
              }}>{headerLabel(h)}</th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/**
 * A cell.
 *
 * `right` means "this is a figure": right-aligned and never wrapped, because
 * breaking "$41,871.56" over two lines saves nothing — the wrapped half still
 * needs the width — and makes the column unreadable.
 *
 * Except when the caller has given the cell a width. `right` was being used for
 * prose too, and `white-space: nowrap` inside a `maxWidth` does not clip: the
 * text simply runs on, out of the cell and underneath the next column, which is
 * how the developer console's "Why" column ended up printed beneath its own
 * Edit and Delete buttons. A cell that has been given a width has been told it
 * must wrap, so it does.
 */
export function Td({ children, right, style }: { children: React.ReactNode; right?: boolean; style?: React.CSSProperties }) {
  const bounded = style !== undefined && ('maxWidth' in style || 'width' in style)
  return (
    <td style={{
      padding: '12px var(--cell-pad, 10px)', borderBottom: '1px solid var(--border-light)',
      textAlign: right ? 'right' : 'left', color: 'var(--text)', verticalAlign: 'middle',
      ...(right && !bounded
        ? { whiteSpace: 'nowrap' as const }
        /* `overflowWrap`, not `wordBreak`: break inside a word only when the
           word alone cannot fit, rather than wherever the line happens to run
           out. That is the difference between "Kestrel / Devices" and "Kestrel
           Device / s". */
        : { whiteSpace: 'normal' as const, overflowWrap: 'break-word' as const }),
      ...style,
    }}>{children}</td>
  )
}

/**
 * An identifier, wrapped at its separators and nowhere else.
 *
 * `onboarding.gate.cleared` has no space in it, so CSS gives it no break
 * opportunity: the column either takes the whole string's width — 361px of a
 * 1000px audit table, a third of it for one field — or, told to break anywhere,
 * produces "onboarding.gate.cle / ared", which is a string nobody can read or
 * search for.
 *
 * `<wbr>` is the third answer: a break opportunity the browser may take, at the
 * dots and dashes where a reader would expect one. Deliberately an element
 * rather than a zero-width space — U+200B would be copied along with the text
 * and paste an invisible character into whatever the operator pastes it into,
 * which is the same trap as the non-breaking space in the money formatter.
 */
export function Id({ children }: { children: string }) {
  /* Short enough to fit anywhere: one field, one line. `INV-2026-0779` down
     three lines as "INV- / 2026- / 0779" is one identifier pretending to be
     three, and a hyphen is a break opportunity CSS will take by default — so a
     short id has to be told not to, rather than left alone. */
  if (children.length <= SHORT_ID) {
    return <span style={{ whiteSpace: 'nowrap' }}>{children}</span>
  }
  /* Too long to hold on one line in any realistic column, so it breaks — but
     only where a reader would expect, at the separators. */
  const parts = children.split(/(?<=[.\-_/:])/)
  return (
    <>
      {parts.map((p, i) => (
        <React.Fragment key={i}>{p}{i < parts.length - 1 && <wbr />}</React.Fragment>
      ))}
    </>
  )
}

/* `INV-2026-0779`, `REQ-5512`, `CUS-449021`, `PTR-1004` are all under this and
   hold their line. `onboarding.gate.cleared` and
   `LTX-RDX-1101-260802075150876` are over it and wrap at their separators. */
const SHORT_ID = 18

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
      {/* Named as a dialog, and labelled by its own title. Without this a
          screen reader announces the page behind it and there is nothing to say
          which region is the one demanding an answer. */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
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
  /* A small button is the one that appears four-at-a-time in a table cell,
     where 12px each side is 96px of whitespace across the group — enough on
     its own to push the last column off the edge. 10px still reads as a
     button and gives the columns beside it room. */
  const pad = size === 'sm' ? '6px 10px' : '10px 16px'
  return (
    <button {...props} style={{
      padding: pad, borderRadius: 'var(--radius)',
      background: bg, color, border: variant === 'secondary' ? '1px solid var(--border)' : 'none',
      fontSize: size === 'sm' ? 'var(--text-xs)' : 'var(--text-sm)',
      fontWeight: 600, cursor: props.disabled ? 'not-allowed' : 'pointer',
      opacity: props.disabled ? 0.5 : 1,
      /* A label is one thing to press, so it stays on one line. In a narrow
         table cell "Duplicate" was coming out as "Duplica / te", which reads as
         two words and makes the button two rows tall. Icon and text are laid
         out here too, rather than by each caller wrapping them in a flex. */
      whiteSpace: 'nowrap',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
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
