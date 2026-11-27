import { useId, useRef } from 'react'
import type React from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from './useFocusTrap'
import { useOverlayDismiss } from './useOverlayDismiss'

/**
 * A modal dialog.
 *
 * Named as a dialog and labelled by its own h2 title, so a screen reader
 * announces the question being asked rather than the page behind it. Focus
 * moves in on open, stays in while it is open, and goes back to whatever
 * opened it on close. Escape and a click on the backdrop both close it.
 * Dialogs can stack: only the top one traps Tab and answers Escape.
 *
 * `className` lands on the panel beside `.ui-dialog`; the console's Modal uses
 * it to keep `.c-modal`, which is what `.c-modal:has(.pd--compact)` widens.
 * The base `.ui-dialog` rules sit inside `:where()` so a passed class always
 * wins over them.
 */
export function Dialog({ open, onClose, title, children, footer, wide, labelId, className, description }: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean          // 920px instead of 560px
  labelId?: string        // optional; otherwise generated with useId
  className?: string
  description?: React.ReactNode   // quiet line under the title
}): JSX.Element | null {
  const generated = useId()
  const titleId = labelId ?? `${generated}-title`
  const panel = useRef<HTMLDivElement>(null)

  useFocusTrap(panel, open)
  /* Escape on the document and a backdrop that closes only when the press
     started and ended on it (see useOverlayDismiss). */
  const backdrop = useOverlayDismiss(panel, open, onClose)

  if (!open) return null

  const cls = ['ui-dialog', wide && 'ui-dialog--wide', className].filter(Boolean).join(' ')

  return (
    <div className="ui-dialog-back" {...backdrop}>
      {/* tabIndex -1: a click on plain text inside focuses the panel rather
          than dropping focus to <body>, so the trap and Escape keep working. */}
      <div ref={panel} className={cls} role="dialog" aria-modal="true" aria-labelledby={titleId}
        tabIndex={-1}
        /* Kept from the old modals: a click inside must not reach a clickable
           ancestor (a row or card) the dialog happens to be rendered in. */
        onClick={(e) => e.stopPropagation()}>
        <div className="ui-dialog__head">
          <div className="ui-dialog__heading">
            <h2 id={titleId} className="ui-dialog__title">{title}</h2>
            {description && <p className="ui-dialog__desc">{description}</p>}
          </div>
          <button type="button" className="ui-dialog__close" onClick={onClose} aria-label="Close">
            <X size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="ui-dialog__body">
          {children}
        </div>
        {footer && <div className="ui-dialog__foot">{footer}</div>}
      </div>
    </div>
  )
}
