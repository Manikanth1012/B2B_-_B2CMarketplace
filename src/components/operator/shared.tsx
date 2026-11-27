import React, { useState, useEffect, useCallback, useId } from 'react'
import { StatusBadge } from '../ui/StatusBadge'
import { statusTone } from '../../lib/consoleTone'
import { Dialog } from '../ui/Dialog'
import { Spinner } from '../ui/Spinner'
import { Dropdown } from '../ui/Dropdown'
import { Menu } from '../ui/Menu'
import { ChevronDown, ChevronUp, ChevronsUpDown, CheckCircle2, XCircle, Info, MoreHorizontal, Search } from 'lucide-react'

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
export function SectionCard({ title, subtitle, children, action, anchor, pad, level = 3 }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode; anchor?: string; pad?: boolean
  /** The title's heading level. 3 under a page's h2 sections; 2 when the card sits straight under the h1. */
  level?: 2 | 3 }) {
  const Title = level === 2 ? 'h2' : 'h3'
  return (
    <div id={anchor} className="c-section">
      <div className="c-section__head">
        <div>
          <Title className="c-section__title">{title}</Title>
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
export type HeaderSort = { active: boolean; dir: 'asc' | 'desc'; onSort: () => void }
export type Header = string | { label: string; align?: 'left' | 'right'; sort?: HeaderSort }

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

/* A cell is a figure when it says `right` or `kind="num"`. */
const cellIsRight = (props: { right?: boolean; kind?: TdKind }): boolean =>
  !!props.right || props.kind === 'num'

function alignmentsFrom(children: React.ReactNode, columns: number): { align: ('left' | 'right')[]; known: boolean } {
  for (const row of rowsIn(children)) {
    const cells = React.Children.toArray(
      (row.props as { children?: React.ReactNode }).children,
    ).filter(React.isValidElement)
    if (cells.length !== columns) continue
    return { align: cells.map(c => (cellIsRight(c.props as { right?: boolean; kind?: TdKind }) ? 'right' : 'left')), known: true }
  }
  return { align: Array.from({ length: columns }, () => 'left' as const), known: false }
}

/* Rule 2 (spec 18): a header sits where its cells sit. An explicit `align`
   still wins, but when it contradicts the cells read off the first row it is
   almost always a stale setting at the top of the table, so development says
   so: once per header, not on every render. */
const warnedHeaders = new Set<string>()
function warnContradiction(label: string, said: 'left' | 'right', cells: 'left' | 'right') {
  if (!import.meta.env.DEV) return
  const key = `${label}|${said}|${cells}`
  if (warnedHeaders.has(key)) return
  warnedHeaders.add(key)
  console.warn(`Table: the "${label}" header is aligned ${said} but its cells are ${cells}. Drop the header's align, or mark the cells (Td right / kind="num").`)
}

/* Rule 4: an actions column carries no visible heading. "Actions" over a
   column of buttons says nothing the buttons do not; the name stays for a
   screen reader. Only a heading that says "Actions" is treated so: a blank
   heading may sit over anything (a checkbox, an expander, a link), and naming
   it "Actions" would mislabel it. */
const isActionsHeader = (label: string): boolean => label.trim().toLowerCase() === 'actions'

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
  const { align: fromCells, known } = alignmentsFrom(children, headers.length)
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
            {headers.map((h, i) => {
              const align = typeof h === 'string' ? fromCells[i] : (h.align ?? fromCells[i])
              if (typeof h !== 'string' && h.align && known && h.align !== fromCells[i]) warnContradiction(h.label, h.align, fromCells[i])
              const sort = typeof h === 'string' ? undefined : h.sort
              if (!sort && isActionsHeader(headerLabel(h))) {
                return <th key={i} className="c-th--actions"><span className="sr-only">Actions</span></th>
              }
              return (
                <th key={i} style={{ textAlign: align }}
                  aria-sort={sort ? (sort.active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none') : undefined}>
                  {sort ? (
                    <button type="button" className="c-table__sort" onClick={sort.onSort}>
                      {headerLabel(h)}
                      <span className="c-table__sort-ind" aria-hidden="true">
                        {sort.active && sort.dir === 'desc' ? <ChevronDown size={12} /> : sort.active ? <ChevronUp size={12} /> : <ChevronsUpDown size={12} />}
                      </span>
                    </button>
                  ) : headerLabel(h)}
                </th>
              )
            })}
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
/**
 * A body row that can be selected. Optional: plain `<tr>` rows keep working.
 * `selected` sets `aria-selected` and the highlight; other props pass through.
 */
export function TableRow({ selected, children, ...rest }: React.HTMLAttributes<HTMLTableRowElement> & { selected?: boolean }) {
  return (
    <tr {...rest} aria-selected={selected || undefined}
      className={`${selected ? 'c-tr--selected ' : ''}${rest.className ?? ''}`.trim() || undefined}>
      {children}
    </tr>
  )
}

/**
 * What a column holds, for cells that would rather say so than set three
 * props (spec 18, rules 1 and 3):
 *
 *   num     a number, money, a percentage or a count: right, tabular, one line
 *   text    prose or a name: left, wraps
 *   status  a pill or a state: left, one line, never right
 *   date    a date or time printed as text: left, one line
 *   id      a short reference: left, one line
 */
export type TdKind = 'num' | 'text' | 'status' | 'date' | 'id'

export function Td({ children, right, kind, nowrap, clamp, title, colSpan, style }: {
  children?: React.ReactNode
  right?: boolean
  kind?: TdKind
  /** Hold the cell on one line. On by default for figures, statuses, dates and ids. */
  nowrap?: boolean
  /** Wrap to at most this many lines (`true` = 2) and show the whole text on hover. */
  clamp?: boolean | number
  /** The hover text for a clamped cell; a plain string child is used when this is not given. */
  title?: string
  colSpan?: number
  style?: React.CSSProperties
}) {
  const isRight = cellIsRight({ right, kind })
  const bounded = style !== undefined && ('maxWidth' in style || 'width' in style)
  const lines = clamp === true ? 2 : typeof clamp === 'number' ? clamp : 0
  const oneLine = nowrap ?? (lines === 0 && ((isRight && !bounded) || kind === 'status' || kind === 'date' || kind === 'id'))
  const classes = ['c-td', isRight && 'c-td--num', lines > 0 && 'c-td--clamp'].filter(Boolean).join(' ')
  const hover = title ?? (typeof children === 'string' ? children : undefined)
  return (
    <td className={classes} colSpan={colSpan} title={lines > 0 ? hover : undefined} style={{
      textAlign: isRight ? 'right' : 'left',
      ...(oneLine
        ? { whiteSpace: 'nowrap' as const }
        /* `overflowWrap`, not `wordBreak`: break inside a word only when the
           word alone cannot fit, rather than wherever the line happens to run
           out. That is the difference between "Kestrel / Devices" and "Kestrel
           Device / s". */
        : { whiteSpace: 'normal' as const, overflowWrap: 'break-word' as const }),
      ...style,
    }}>
      {lines > 0
        ? <span className="c-td__clamp" style={{ WebkitLineClamp: lines }}>{children}</span>
        : children}
    </td>
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

export function EmptyState({ message, icon, title, action }: { message: string; icon?: React.ReactNode; title?: string; action?: React.ReactNode }) {
  return (
    <div className="c-empty">
      {icon && <div className="c-empty__icon" aria-hidden="true">{icon}</div>}
      {title && <div className="c-empty__title">{title}</div>}
      {message}
      {action && <div className="c-empty__action">{action}</div>}
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
export function FormField({ label, children, required, hint, compact }: { label: string; children: React.ReactNode; required?: boolean; hint?: string
  /** No bottom margin: for a field in a FieldRow, a FilterBar or a card that sets its own spacing. */
  compact?: boolean }) {
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
    <div className={compact ? 'c-field c-field--compact' : 'c-field'}>
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

/* A custom dropdown (ui/Dropdown) with the same props a native <select>
   took: value/defaultValue, onChange reading e.target.value, disabled, id,
   aria-*, style, className and <option>/<optgroup> children. Dropdown adds
   the .c-input class itself. */
export function Select(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <Dropdown {...props} />
}

export function Btn({ variant = 'primary', size = 'md', loading, icon, children, className, disabled, ...props }: {
  /* `accent` is the cyan call to action: one per screen, for its main step. */
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'success' | 'accent'
  size?: 'sm' | 'md'
  /* Shows a spinner beside the label, sets aria-busy and disables the button. */
  loading?: boolean
  /* A square icon-only button; give it an aria-label. */
  icon?: boolean
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
  const classes = ['c-btn', `c-btn--${variant}`, size === 'sm' && 'c-btn--sm', icon && 'c-btn--icon', className].filter(Boolean).join(' ')
  return (
    <button {...props} className={classes} disabled={disabled || loading} aria-busy={loading || undefined}>
      {loading && <Spinner size={size === 'sm' ? 12 : 14} />}
      {children}
    </button>
  )
}

// ---------- Row actions (spec 18, rule 4) ----------

export interface RowAction {
  label: string
  onClick: () => void
  variant?: 'primary' | 'secondary' | 'tertiary' | 'danger' | 'success'
  disabled?: boolean
  loading?: boolean
  icon?: React.ReactNode
  /** A stable identity for the action. Set it whenever an action can appear or
      disappear while others stay (Approve gone once approved): without it the
      buttons are keyed by position, so focus left on slot one would then sit on
      whatever moved into it, and a second Enter would fire that instead. A
      label that toggles (Journey / Hide) keeps one `id` so its focus survives. */
  id?: string
  /** Words for a screen reader only, after the label ("Open" + " Meera's basket"). */
  srOnly?: string
  /** For a button that opens something in place: sets `aria-expanded`. */
  expanded?: boolean
}

/**
 * A table row's buttons: right-aligned, on one line, at the 32px row size.
 *
 * Two fit beside a record without crowding it; a third is where the column
 * starts taking width from the data. So up to `max` (two) are drawn as
 * buttons and anything after them goes into a "More" menu, which is keyboard
 * operable and carries the row's name so "More actions" is never ambiguous
 * among twenty rows. `false`/`null` entries are dropped, so a caller can write
 * `canEdit && { … }` inline.
 */
/* Enter and Space on a row's button are the button's, not the row's: a
   clickable row must not also open. Every other key carries on, because the
   dialog's Escape and the focus trap's Tab listen on the document, and
   stopping a React key event stops the native one before it gets there. */
const keepFromRow = (e: React.KeyboardEvent) => {
  if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') e.stopPropagation()
}

export function RowActions({ actions, max = 2, label }: {
  actions: (RowAction | false | null | undefined)[]
  max?: number
  /** What the row is, for the More button's name: "More actions for {label}". */
  label?: string
}) {
  const list = actions.filter((a): a is RowAction => !!a)
  const inline = list.length > max ? list.slice(0, max) : list
  const rest = list.length > max ? list.slice(max) : []
  return (
    <div className="c-row-actions">
      {inline.map((a, i) => (
        <Btn key={a.id ?? `#${i}`} size="sm" variant={a.variant ?? 'tertiary'} disabled={a.disabled} loading={a.loading}
          aria-expanded={a.expanded}
          onClick={e => { e.stopPropagation(); a.onClick() }} onKeyDown={keepFromRow}>
          {a.icon}{a.label}{a.srOnly && <span className="sr-only"> {a.srOnly}</span>}
        </Btn>
      ))}
      {rest.length > 0 && (
        <span onClick={e => e.stopPropagation()} onKeyDown={keepFromRow} className="c-row-actions__more">
          <Menu label={label ? `More actions for ${label}` : 'More actions'}
            triggerClassName="c-btn c-btn--tertiary c-btn--sm c-btn--icon"
            items={rest.map(a => ({ label: a.label, onSelect: a.onClick, disabled: a.disabled || a.loading, danger: a.variant === 'danger', icon: a.icon }))}>
            <MoreHorizontal size={16} aria-hidden="true" />
          </Menu>
        </span>
      )}
    </div>
  )
}

// ---------- Filter bar (spec 18, rule 5) ----------

/**
 * The one line above a list: search, filters, actions.
 *
 * One height (40px, the control height) and one line: the search takes the
 * room that is left, each filter keeps a fixed width (`--filter-w`, 180px;
 * a child can set its own `width`), actions sit at the end. Below about 720px
 * of its own width (a container query, so a narrow card counts as narrow) it
 * wraps: search on its own line, the filters under it.
 *
 * `summary` is the line under the bar that says how much matched ("12 nights,
 * 40 runs"), announced politely as it changes.
 */
export function FilterBar({ search, children, actions, summary, ariaLabel = 'Filters' }: {
  search?: { value: string; onChange: (value: string) => void; placeholder?: string; ariaLabel: string }
  children?: React.ReactNode
  actions?: React.ReactNode
  summary?: React.ReactNode
  ariaLabel?: string
}) {
  return (
    <div className="c-filterbar-wrap">
      <div className="c-filterbar" role="group" aria-label={ariaLabel}>
        {search && (
          <span className="c-search c-filterbar__search">
            <Search size={16} aria-hidden="true" />
            <TextInput type="search" value={search.value} placeholder={search.placeholder}
              aria-label={search.ariaLabel} onChange={e => search.onChange(e.target.value)} />
          </span>
        )}
        {children && <div className="c-filterbar__filters">{children}</div>}
        {actions && <div className="c-filterbar__actions">{actions}</div>}
      </div>
      {summary !== undefined && summary !== null && summary !== false && (
        <div className="c-filterbar__summary" aria-live="polite">{summary}</div>
      )}
    </div>
  )
}

/* Dates as `YYYY-MM-DD`, the value a native date input reads and writes, in
   local time so "today" is the operator's today and not UTC's. */
export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function daysBefore(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  return isoDay(new Date(y, m - 1, d - n))
}

/**
 * From and to, as two native date inputs dressed as the console's inputs, and
 * quick picks for the last 7, 14 or 30 days. A pick sets `to` to today and
 * `from` so the range holds that many days including today; the pick whose
 * range is showing reads as pressed.
 */
export function DateRangeFilter({ from, to, onChange, quick = [7, 14, 30], quickLabel = n => `${n} days`, today, label = 'Date range' }: {
  from: string
  to: string
  onChange: (range: { from: string; to: string }) => void
  quick?: number[]
  /** The words on a quick pick: "7 days", or "7 nights" for a nightly log. */
  quickLabel?: (n: number) => string
  /** `YYYY-MM-DD`; defaults to the local today. */
  today?: string
  label?: string
}) {
  const now = today ?? isoDay(new Date())
  return (
    <div className="c-daterange" role="group" aria-label={label}>
      <input type="date" className="c-input c-daterange__input" aria-label="From" value={from} max={to || undefined}
        onChange={e => onChange({ from: e.target.value, to })} />
      <span className="c-daterange__sep" aria-hidden="true">to</span>
      <input type="date" className="c-input c-daterange__input" aria-label="To" value={to} min={from || undefined}
        onChange={e => onChange({ from, to: e.target.value })} />
      {quick.length > 0 && (
        <span className="c-daterange__quick">
          {quick.map(n => {
            const range = { from: daysBefore(now, n - 1), to: now }
            const on = from === range.from && to === range.to
            return (
              <button key={n} type="button" className="c-chip" aria-pressed={on}
                onClick={() => onChange(range)}>{quickLabel(n)}</button>
            )
          })}
        </span>
      )}
    </div>
  )
}

// ---------- Field row (spec 18, rule 6) ----------

/**
 * Fields and their buttons on one line, lined up on the input.
 *
 * The fields inside lose their bottom margin and grow; buttons sit on the
 * input's baseline at the input's height (40px), a small button included,
 * because a 32px button beside a 40px input is the "Find a unit" misalignment
 * whatever the screen. A field with a hint under it would push its button up
 * by the hint's height, so hints belong outside a row.
 */
export function FieldRow({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={className ? `c-field-row ${className}` : 'c-field-row'}>{children}</div>
}

// ---------- Page header (spec 18, rule 8) ----------

/**
 * A screen's top: the title, one line saying what the screen is for, and the
 * primary action on the right. On a narrow screen the actions drop under the
 * title rather than squeezing it. `children` (tabs, a filter bar) sit under
 * the whole header.
 */
export function PageHeader({ title, description, actions, children, level = 1 }: {
  title: React.ReactNode
  description?: React.ReactNode
  actions?: React.ReactNode
  children?: React.ReactNode
  /** 1 for a screen; 2 when the screen sits inside a page that has its own h1. */
  level?: 1 | 2
}) {
  const H = level === 2 ? 'h2' : 'h1'
  return (
    <header className="c-page-head">
      <div className="c-page-head__row">
        <div className="c-page-head__text">
          <H className="c-page-head__title">{title}</H>
          {description && <p className="c-page-head__desc">{description}</p>}
        </div>
        {actions && <div className="c-page-head__actions">{actions}</div>}
      </div>
      {children}
    </header>
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
    <div className="toast-host">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span className="toast__icon" aria-hidden="true">
            {t.kind === 'error' ? <XCircle size={16} /> : t.kind === 'info' ? <Info size={16} /> : <CheckCircle2 size={16} />}
          </span>
          <span>{t.message}</span>
        </div>
      ))}
    </div>
  )
}
