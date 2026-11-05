import React, { useState, useEffect, useCallback, useId } from 'react'
import { StatusBadge } from '../ui/StatusBadge'
import { statusTone } from '../../lib/consoleTone'
import { Dialog } from '../ui/Dialog'

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

/* `status` picks the colour; `label` is what it reads, where the two differ.
   The stock unit states borrow this palette — a despatched unit is coloured
   like anything else in flight — and without the override the pill printed the
   colour token instead of the state: "current" where it meant "Despatched". */
export function StatusPill({ status, label }: { status: string; label?: string }) {
  /* The status-to-tone map lives in lib/consoleTone.ts so it can be tested; the
     badge brings its own shape so a state never rests on colour alone. */
  return <StatusBadge tone={statusTone(status)}>{(label ?? status).replace(/_/g, ' ')}</StatusBadge>
}

export function PriorityPill({ priority }: { priority: string }) {
  return <StatusBadge tone={statusTone(priority)}>{priority}</StatusBadge>
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
    <div id={anchor} className="c-section">
      <div className="c-section__head">
        <div>
          <h3 className="c-section__title">{title}</h3>
          {subtitle && <p className="c-section__sub">{subtitle}</p>}
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
        ? <div className="c-section__body--pad">{children}</div>
        : children}
    </div>
  )
}

export function StatCard({ label, value, sublabel, color }: { label: string; value: string; sublabel?: string; color?: string }) {
  return (
    <div className="c-stat">
      <div className="c-stat__label">
        {color && <span className="c-stat__dot" style={{ background: color }} aria-hidden="true" />}
        {label}
      </div>
      <div className="c-stat__value">{value}</div>
      {sublabel && <div className="c-stat__sub">{sublabel}</div>}
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
 * An explicit `{ label, align }` still wins. A bare string no longer guesses:
 * it takes the alignment of the cells underneath it, read off the first row —
 * see `alignmentsFrom` below.
 */
export type Header = string | { label: string; align: 'left' | 'right' }

const headerLabel = (h: Header): string => (typeof h === 'string' ? h : h.label)

/**
 * Where each header sits, taken from the column rather than from its position.
 *
 * The rule used to be "first column left, every other right". That is correct
 * for a table of figures and wrong for every other table in the app: `Td`
 * left-aligns unless it is told `right`, so a heading over a name, a seller or
 * a status pill sat hard against the right edge with its own data at the left.
 * "Waiting for stock" was the reported case — SELLER floating above nothing,
 * three columns away from the sellers — but it was never one table. Ten of the
 * hundred and forty-four say their alignment; the rest inherited a default
 * that only ever suited a minority of them.
 *
 * So the header asks the cells. `Td right` already means "this is a figure",
 * which is the same fact the header needs, and it is stated once at the cell
 * where the data is rather than repeated in a list of strings at the top where
 * it can fall out of step.
 *
 * Read off the first row whose cell count matches the headers. A row with a
 * `colSpan` — the empty states, mostly — has no per-column answer to give, and
 * a row with a conditional cell in it has a different shape from the header
 * list; either would map the wrong cell onto the wrong heading, so both are
 * skipped in favour of the next row that lines up. If no row does, or there
 * are no rows at all, everything is left: the alignment a `Td` with nothing
 * said about it would take.
 *
 * Fragments are descended into rather than counted. Several tables emit
 * `<><tr>…</tr>{expanded && <tr>…</tr>}</>` per record, and a walker that
 * stopped at the fragment would find two `<tr>`s where it wanted ten cells,
 * conclude nothing, and fall back to left — which on the revenue-share table
 * put nine headings on the wrong side of nine columns of figures.
 */
function rowsIn(children: React.ReactNode): React.ReactElement[] {
  const out: React.ReactElement[] = []
  for (const node of React.Children.toArray(children)) {
    if (!React.isValidElement(node)) continue
    if (node.type === React.Fragment) {
      out.push(...rowsIn((node.props as { children?: React.ReactNode }).children))
    } else {
      out.push(node)
    }
  }
  return out
}

function alignmentsFrom(children: React.ReactNode, columns: number): ('left' | 'right')[] {
  for (const row of rowsIn(children)) {
    const cells = React.Children.toArray(
      (row.props as { children?: React.ReactNode }).children,
    ).filter(React.isValidElement)
    if (cells.length !== columns) continue
    return cells.map(c =>
      (c.props as { right?: boolean }).right ? 'right' : 'left')
  }
  return Array.from({ length: columns }, () => 'left' as const)
}

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
  const fromCells = alignmentsFrom(children, headers.length)
  return (
    <div className="c-table-wrap">
      <table className="c-table" style={{
        ['--cell-pad' as string]: padFor(headers.length),
        /* 13px rather than 14 (--text-table, in .c-table). Across a nine-column
           table that is most of a column, and at this size it is still a
           comfortable read — these are dense records, not prose.

           `min-width: min-content`, also in .c-table, is the floor. See above:
           without it a column can be narrower than the longest word it holds,
           and the browser breaks the word. */
      }}>
        <thead>
          <tr>
            {headers.map((h, i) => (
              <th key={i} style={{ textAlign: typeof h === 'string' ? fromCells[i] : h.align }}>{headerLabel(h)}</th>
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
    <td className="c-td" style={{
      textAlign: right ? 'right' : 'left',
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

export function EmptyState({ message, icon }: { message: string; icon?: React.ReactNode }) {
  return (
    <div className="c-empty">
      {icon && <div className="c-empty__icon" aria-hidden="true">{icon}</div>}
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
  /* Rendered through the shared Dialog, which brings the focus trap, the
     return of focus to whatever opened it, Escape and the backdrop click.
     The panel keeps `.c-modal` (640px, and `.c-modal:has(.pd--compact)` still
     widens the enterprise listing modal); the head, body and foot are
     Dialog's own, styled to the same measurements. */
  return (
    /* Named as a dialog, and labelled by its own title. Without this a
       screen reader announces the page behind it and there is nothing to say
       which region is the one demanding an answer. Dialog does this with
       aria-labelledby pointing at the title. */
    <Dialog open={open} onClose={onClose} title={title} footer={footer} className="c-modal">
      {/* `min-width: 0` (in .ui-dialog__body, as it was in .c-modal__body) is
          what keeps the 640px from being a suggestion.
          A column flex item's minimum width is `auto`, meaning "never narrower
          than my content" — so one unwrappable cell inside a table in here
          pushed the whole dialog wider than the window, and every value in it
          was clipped at the right-hand edge with no way to scroll to them. The
          table already carries its own `overflow-x`; this is what lets it use
          it rather than shoving its container open. */}
      {children}
    </Dialog>
  )
}

// ---------- Form primitives ----------

/**
 * A labelled field.
 *
 * The label used to sit beside its input and be attached to nothing: no
 * `htmlFor`, no `id`, and the input not nested inside it. So across every form
 * in this console, clicking a label did not focus its field and a screen reader
 * announced an unnamed text box — the field said "Role name" to somebody
 * looking at it and nothing at all to anybody who was not.
 *
 * The id is generated and pushed onto a single child element, which covers the
 * ordinary `<FormField><TextInput/></FormField>` shape without every call site
 * having to invent one. A field whose children are something else — a row of
 * chips, a group of buttons — is left alone: there is no one control for the
 * label to point at, and those carry their own accessible names.
 */
export function FormField({ label, children, required, hint }: { label: string; children: React.ReactNode; required?: boolean; hint?: string }) {
  const id = useId()
  const hintId = `${id}-hint`
  const only = React.Children.count(children) === 1 ? React.Children.only(children) : null
  const single = React.isValidElement(only) ? only : null
  const bound = single
    ? React.cloneElement(single as React.ReactElement<Record<string, unknown>>, {
      id: (single.props as { id?: string }).id ?? id,
      /* The hint is part of the field's description, not decoration beside it —
         "One line per line, as it should be printed" is instruction. A
         description the caller gave (an error message under the field) is
         kept beside it, not overwritten. */
      'aria-describedby': [(single.props as { 'aria-describedby'?: string })['aria-describedby'], hint ? hintId : undefined]
        .filter(Boolean).join(' ') || undefined,
      'aria-required': required || undefined,
    })
    : children

  return (
    <div className="c-field">
      <label htmlFor={single ? ((single.props as { id?: string }).id ?? id) : undefined}
        className="c-field__label">
        {label}{required && <span className="c-field__req"> *</span>}
      </label>
      {bound}
      {hint && <div id={hintId} className="c-field__hint">{hint}</div>}
    </div>
  )
}

/* Controls are 44px tall with a --border-strong edge (3:1 against white) and an
   electric focus ring, all in .c-input. A caller's own `style` and `className`
   still win/merge as before. */
const inputClass = (extra?: string) => extra ? `c-input ${extra}` : 'c-input'

export function TextInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={inputClass(props.className)} />
}

export function TextArea(props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={inputClass(props.className)} />
}

export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...props} className={inputClass(props.className)} />
}

export function Btn({ variant = 'primary', size = 'md', children, className, ...props }: {
  /* `accent` is the cyan call to action: one per screen, for its main step. */
  variant?: 'primary' | 'secondary' | 'danger' | 'success' | 'accent'
  size?: 'sm' | 'md'
  children: React.ReactNode
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  /* A small button is the one that appears four-at-a-time in a table cell,
     where 12px each side is 96px of whitespace across the group — enough on
     its own to push the last column off the edge. 10px (in .c-btn--sm) still
     reads as a button and gives the columns beside it room.

     `white-space: nowrap` and the inline-flex layout (in .c-btn) are why a
     label is one thing to press: in a narrow table cell "Duplicate" was coming
     out as "Duplica / te", which reads as two words and makes the button two
     rows tall. Icon and text are laid out there too, rather than by each caller
     wrapping them in a flex. */
  const classes = ['c-btn', `c-btn--${variant}`, size === 'sm' && 'c-btn--sm', className].filter(Boolean).join(' ')
  return (
    <button {...props} className={classes}>
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
      <p className="c-modal__message">{message}</p>
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
