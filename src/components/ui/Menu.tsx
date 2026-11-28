import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type React from 'react'
import { createPortal } from 'react-dom'

/**
 * A button that opens a short menu of commands (the "More" behind a table
 * row's actions, spec 18 rule 4).
 *
 * Drawn the way Dropdown draws its listbox, and for the same reason: in a
 * portal with fixed positioning, because a table sits in an `overflow-x: auto`
 * wrapper and anything absolutely placed inside it is clipped at the last row.
 * It reuses the listbox's popup and option styling (`.ui-dd__pop`,
 * `.ui-dd__opt`) so a menu and a dropdown look like one family.
 *
 * Keyboard: Enter, Space or ArrowDown on the button opens it on the first
 * item (ArrowUp on the last); ArrowUp/ArrowDown/Home/End move; Enter or Space
 * runs the item; Escape closes and returns focus to the button; Tab closes.
 */
export interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
  /** Printed in the danger colour: a destructive command. */
  danger?: boolean
  icon?: React.ReactNode
  /** Words for a screen reader only, after the label. */
  srOnly?: string
  /** A visible line under the label, linked by aria-describedby. For a disabled
      item it is the reason: the item stays focusable so the reason can be read. */
  hint?: string
}

const GAP = 4
const EDGE = 8

export function Menu({ items, label, children, triggerClassName, align = 'end' }: {
  items: MenuItem[]
  /** The button's accessible name, e.g. "More actions for INV-0779". */
  label: string
  /** What the button shows (usually an icon). */
  children: React.ReactNode
  triggerClassName?: string
  /** Which edge of the button the menu lines up with. */
  align?: 'start' | 'end'
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const [place, setPlace] = useState<{ top: number; left: number } | null>(null)
  const button = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])
  const menuId = useId()

  /* Disabled items stay in the roving focus, so their reason can be reached and read. */
  const enabled = items.map((_, i) => i)

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    setPlace(null)
    if (refocus) button.current?.focus()
  }, [])

  const openAt = (which: 'first' | 'last') => {
    if (enabled.length === 0) return
    setActive(which === 'first' ? enabled[0] : enabled[enabled.length - 1])
    setOpen(true)
  }

  const measure = useCallback(() => {
    const b = button.current
    if (!b) return
    const r = b.getBoundingClientRect()
    const vw = window.innerWidth || document.documentElement.clientWidth
    const vh = window.innerHeight || document.documentElement.clientHeight
    const w = popup.current?.offsetWidth ?? 0
    const h = popup.current?.offsetHeight ?? 0
    let left = align === 'end' ? r.right - w : r.left
    left = Math.max(EDGE, Math.min(left, vw - EDGE - w))
    const below = r.bottom + GAP
    const top = below + h > vh - EDGE && r.top - GAP - h > EDGE ? r.top - GAP - h : below
    setPlace(prev => (prev && prev.top === top && prev.left === left ? prev : { top, left }))
  }, [align])

  useLayoutEffect(() => {
    if (!open) return
    measure()
    const onMove = () => measure()
    window.addEventListener('resize', onMove)
    window.addEventListener('scroll', onMove, true)
    return () => {
      window.removeEventListener('resize', onMove)
      window.removeEventListener('scroll', onMove, true)
    }
  }, [open, measure])

  /* Focus follows the active item once the popup is placed (a hidden element
     cannot take focus). Keyed on "placed", not on the position, so following
     a scroll does not refocus; and `preventScroll`, because the popup is fixed
     to the viewport already and Chrome would otherwise scroll the page
     (smoothly, under the app's scroll-behavior) toward a fixed element. */
  const placed = place !== null
  useEffect(() => {
    if (open && placed) itemRefs.current[active]?.focus({ preventScroll: true })
  }, [open, placed, active])

  /* A press anywhere else closes it. */
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => {
      const t = e.target as Node
      if (popup.current?.contains(t) || button.current?.contains(t)) return
      close(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open, close])

  const move = (step: 1 | -1) => {
    const at = enabled.indexOf(active)
    const next = enabled[(at + step + enabled.length) % enabled.length]
    if (next !== undefined) setActive(next)
  }

  const onMenuKey = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); move(1); break
      case 'ArrowUp': e.preventDefault(); move(-1); break
      case 'Home': e.preventDefault(); if (enabled.length) setActive(enabled[0]); break
      case 'End': e.preventDefault(); if (enabled.length) setActive(enabled[enabled.length - 1]); break
      case 'Escape': e.preventDefault(); e.stopPropagation(); close(true); break
      /* The popup is portalled to the end of <body>, so a Tab left to the
         browser would fall off the page, and a dialog's focus trap, seeing a
         Tab from outside its panel, would wrap to its first control. Tab
         closes the menu with focus back on its button: the press is spent
         here, and the next Tab moves on from the button as usual. */
      case 'Tab': e.preventDefault(); e.stopPropagation(); close(true); break
    }
  }

  const run = (it: MenuItem) => {
    if (it.disabled) return
    close(true)
    it.onSelect()
  }

  return (
    <>
      <button ref={button} type="button" className={triggerClassName}
        aria-label={label} aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close(false) : openAt('first'))}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') { e.preventDefault(); openAt('first') }
          else if (e.key === 'ArrowUp') { e.preventDefault(); openAt('last') }
        }}>
        {children}
      </button>
      {open && typeof document !== 'undefined' && createPortal(
        <div ref={popup} id={menuId} role="menu" aria-label={label}
          className="ui-dd__pop ui-menu"
          style={place ? { top: place.top, left: place.left } : { top: 0, left: 0, visibility: 'hidden' }}
          onKeyDown={onMenuKey}>
          {items.map((it, i) => (
            <button key={it.label} ref={el => { itemRefs.current[i] = el }} type="button" role="menuitem"
              tabIndex={i === active ? 0 : -1} aria-disabled={it.disabled || undefined}
              aria-describedby={it.hint ? `${menuId}-hint-${i}` : undefined}
              className={['ui-dd__opt', 'ui-menu__item', i === active && 'is-active', it.danger && 'ui-menu__item--danger', it.disabled && 'is-disabled'].filter(Boolean).join(' ')}
              onMouseEnter={() => setActive(i)}
              onClick={() => run(it)}>
              {it.icon && <span className="ui-menu__icon" aria-hidden="true">{it.icon}</span>}
              <span className="ui-dd__label">{it.label}{it.srOnly && <span className="sr-only"> {it.srOnly}</span>}
                {it.hint && <span id={`${menuId}-hint-${i}`} className="c-sub" style={{ display: 'block' }}>{it.hint}</span>}</span>
            </button>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
