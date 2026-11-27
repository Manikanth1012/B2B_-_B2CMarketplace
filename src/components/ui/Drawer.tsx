import { useId, useRef } from 'react'
import type React from 'react'
import { X } from 'lucide-react'
import { useFocusTrap } from './useFocusTrap'
import { useOverlayDismiss } from './useOverlayDismiss'

/**
 * A right-hand side panel. Same contract as Dialog: named by its title, focus
 * trapped and returned, Escape and a backdrop press close it. The header and
 * footer stay put; only the body scrolls.
 */
export function Drawer({ open, onClose, title, description, children, footer, width, labelId }: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  description?: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  width?: string          // CSS width; default min(480px, 100vw)
  labelId?: string
}): JSX.Element | null {
  const generated = useId()
  const titleId = labelId ?? `${generated}-title`
  const panel = useRef<HTMLDivElement>(null)

  useFocusTrap(panel, open)
  const backdrop = useOverlayDismiss(panel, open, onClose)

  if (!open) return null

  return (
    <div className="ui-drawer-back" {...backdrop}>
      <div ref={panel} className="ui-drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}
        tabIndex={-1} style={width ? { width } : undefined}
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
        <div className="ui-drawer__body">{children}</div>
        {footer && <div className="ui-dialog__foot">{footer}</div>}
      </div>
    </div>
  )
}
