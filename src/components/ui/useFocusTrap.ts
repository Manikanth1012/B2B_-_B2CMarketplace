import { useEffect } from 'react'
import type React from 'react'
import { nextFocusIndex } from '../../lib/focusTrap'

/* What can take focus by Tab. Disabled controls, `tabindex="-1"` and hidden
   inputs are left out; elements that are not rendered (display: none, or
   inside a closed <details>) are filtered by having no client rects. */
const FOCUSABLE = [
  'a[href]', 'area[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])', 'textarea:not([disabled])', 'iframe', 'summary',
  '[contenteditable="true"]', '[tabindex]',
].join(',')

/* Traps that are active, innermost last. A confirm opened over a console
   modal is two traps at once; only the top one handles Tab, or the outer one
   would pull focus back out of the confirm. */
const stack: HTMLElement[] = []

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el =>
    el.tabIndex >= 0 && !el.hasAttribute('inert') && el.getClientRects().length > 0)
}

/**
 * Keeps keyboard focus inside `ref` while `active`.
 *
 * On activate it remembers what had focus, then focuses the first focusable
 * element inside (or the container itself, made focusable with tabIndex -1,
 * when there is nothing to press). Tab and Shift+Tab cycle within it. On
 * deactivate or unmount focus goes back to what had it, so closing a dialog
 * returns a keyboard user to the button that opened it rather than to the top
 * of the page.
 */
export function useFocusTrap(ref: React.RefObject<HTMLElement>, active: boolean): void {
  useEffect(() => {
    if (!active) return
    const root = ref.current
    if (!root) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null

    if (!root.contains(document.activeElement)) {
      const first = focusables(root)[0]
      if (first) first.focus()
      else {
        if (!root.hasAttribute('tabindex')) root.tabIndex = -1
        root.focus()
      }
    }

    stack.push(root)

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || stack[stack.length - 1] !== root) return
      const list = focusables(root)
      if (list.length === 0) { e.preventDefault(); root.focus(); return }
      const current = list.indexOf(document.activeElement as HTMLElement)
      /* Only the wrap and the escape are taken over; a Tab between two
         middle elements is left to the browser. */
      const next = nextFocusIndex(current, list.length, e.shiftKey)
      const atEdge = current === -1 || (e.shiftKey ? current === 0 : current === list.length - 1)
      if (!atEdge) return
      e.preventDefault()
      list[next].focus()
    }
    document.addEventListener('keydown', onKey)

    return () => {
      document.removeEventListener('keydown', onKey)
      const at = stack.lastIndexOf(root)
      if (at !== -1) stack.splice(at, 1)
      if (previous && previous.isConnected) previous.focus()
    }
  }, [ref, active])
}
