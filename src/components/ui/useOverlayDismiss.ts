import { useEffect, useRef } from 'react'
import type React from 'react'
import { isTopmostTrap } from './useFocusTrap'

/**
 * What Dialog and Drawer share besides the focus trap: Escape on the document
 * (only the topmost trap answers, and the press is spent so nothing beneath
 * also closes) and a backdrop that closes only when the press started and
 * ended on it, so selecting text inside and releasing outside keeps it open.
 */
export function useOverlayDismiss(panel: React.RefObject<HTMLElement>, open: boolean, onClose: () => void) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const pressedBackdrop = useRef(false)

  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !isTopmostTrap(panel.current)) return
      closeRef.current()
      /* Spent here: a listener beneath (the account menu on window, a drawer
         on document) must not also close on the same press. */
      e.stopPropagation()
      e.stopImmediatePropagation()
      e.preventDefault()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, panel])

  return {
    onMouseDown: (e: React.MouseEvent) => { pressedBackdrop.current = e.target === e.currentTarget },
    onClick: (e: React.MouseEvent) => {
      if (pressedBackdrop.current && e.target === e.currentTarget) closeRef.current()
      pressedBackdrop.current = false
    },
  }
}
