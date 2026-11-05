import { useEffect, useRef } from 'react'
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
    el.tabIndex >= 0 && !el.hasAttribute('inert') && el.getClientRects().length > 0
    /* An unchecked radio whose group has a checked one is not a Tab stop. */
    && !(el instanceof HTMLInputElement && el.type === 'radio' && !el.checked && el.name
      && root.querySelector(`input[type="radio"][name="${CSS.escape(el.name)}"]:checked`)))
}

/** True when `el` is the innermost active trap: the one that should answer
 *  Tab and Escape while dialogs are stacked. */
export function isTopmostTrap(el: HTMLElement | null): boolean {
  return el !== null && stack[stack.length - 1] === el
}

/**
 * Keeps keyboard focus inside `ref` while `active`.
 *
 * On activate it remembers what had focus (read during the render that
 * turns it on, before any child mounts, so a field with `autoFocus` inside
 * is not mistaken for the opener), then focuses the first focusable
 * element inside (or the container itself, made focusable with tabIndex -1,
 * when there is nothing to press). Tab and Shift+Tab cycle within it. On
 * deactivate or unmount focus goes back to what had it, so closing a dialog
 * returns a keyboard user to the button that opened it rather than to the top
 * of the page.
 */
export function useFocusTrap(ref: React.RefObject<HTMLElement>, active: boolean): void {
  const opener = useRef<HTMLElement | null>(null)
  const wasActive = useRef(false)
  /* Read in render on the closed-to-open flip. By the time an effect runs,
     React has already focused any `autoFocus` child, and that child is gone
     again by the time the dialog closes. */
  if (active && !wasActive.current) {
    const el = typeof document !== 'undefined' ? document.activeElement : null
    opener.current = el instanceof HTMLElement && el !== document.body ? el : null
  }
  wasActive.current = active

  useEffect(() => {
    if (!active) return
    const root = ref.current
    if (!root) return
    const previous = opener.current && !root.contains(opener.current) ? opener.current : null

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
      /* Hand focus back only if it is still ours to hand: inside the dialog,
         or dropped to <body> because the dialog went away. If the close
         moved it somewhere on purpose, leave it there. An opener that has
         itself gone (the row a confirm deleted) is skipped. */
      const now = document.activeElement
      const ours = !now || now === document.body || root.contains(now)
      if (ours && previous && previous.isConnected) previous.focus()
    }
  }, [ref, active])
}
