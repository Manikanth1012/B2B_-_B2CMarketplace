import { useId, useRef } from 'react'
import type React from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from './useFocusTrap'

/**
 * A modal dialog.
 *
 * Named as a dialog and labelled by its own h2 title, so a screen reader
 * announces the question being asked rather than the page behind it. Focus
 * moves in on open, stays in while it is open, and goes back to whatever
 * opened it on close. Escape and a click on the backdrop both close it.
 * Dialogs can stack: only the top one traps Tab and hears Escape.
 *
 * `className` lands on the panel beside `.ui-dialog`; the console's Modal uses
 * it to keep `.c-modal`, which is what `.c-modal:has(.pd--compact)` widens.
 * The base `.ui-dialog` rules sit inside `:where()` so a passed class always
 * wins over them.
 */
export function Dialog({ open, onClose, title, children, footer, wide, labelId, className }: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean          // 920px instead of 560px
  labelId?: string        // optional; otherwise generated with useId
  className?: string
}): JSX.Element | null {
  const generated = useId()
  const titleId = labelId ?? `${generated}-title`
  const panel = useRef<HTMLDivElement>(null)
  const pressedBackdrop = useRef(false)

  useFocusTrap(panel, open)

  if (!open) return null

  const cls = ['ui-dialog', wide && 'ui-dialog--wide', className].filter(Boolean).join(' ')

  return (
    /* Closes only when the press started and ended on the backdrop itself, so
       selecting text inside and releasing outside does not throw it away. */
    <div className="ui-dialog-back"
      onMouseDown={(e) => { pressedBackdrop.current = e.target === e.currentTarget }}
      onClick={(e) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose()
        pressedBackdrop.current = false
      }}>
      {/* Escape is heard on the panel, not the window: focus is trapped
          inside, so only the dialog on top hears it and a confirm over a
          modal closes alone. */}
      <div ref={panel} className={cls} role="dialog" aria-modal="true" aria-labelledby={titleId}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); onClose() }
        }}>
        <div className="ui-dialog__head">
          <h2 id={titleId} className="ui-dialog__title">{title}</h2>
          <button type="button" className="ui-dialog__close" onClick={onClose} aria-label="Close">
            <X size={20} aria-hidden="true" />
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
