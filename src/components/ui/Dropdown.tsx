import React, { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/*
 * A select-only combobox (WAI-ARIA APG) that takes exactly what a native
 * <select> takes: `value` or `defaultValue`, `onChange`, `disabled`, `id`,
 * `name`, `aria-*`, `style`, `className`, and <option>/<optgroup> children
 * (through fragments, arrays and conditionals). `onChange` gets an object
 * shaped like the change event of a select — `target.value`,
 * `currentTarget.value`, `name`, `id` — and is called only when the value
 * actually changes.
 *
 * The control is a <button role="combobox">: it is labelable, so a
 * `<label htmlFor>` names it and clicking that label focuses it, and a
 * disabled one is disabled for real (not focusable, not openable). The popup
 * is drawn in a portal with fixed positioning so a scrolling table or card
 * cannot clip it; it follows scroll and resize, opens below the control, flips
 * above when there is no room, and never leaves the viewport. More than eight
 * enabled options bring a search box that filters by label (case and accents
 * ignored) and keeps the arrow keys working.
 */

export type DropdownProps = Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'multiple' | 'size'>

export type DropdownOption = { value: string; label: string; disabled: boolean; group: number | null }
export type DropdownGroup = { label: string }

const SEARCH_THRESHOLD = 8
const TYPEAHEAD_MS = 500
const MAX_HEIGHT = 320
const GAP = 4
const EDGE = 8

function textOf(node: React.ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (React.isValidElement(node)) return textOf((node.props as { children?: React.ReactNode }).children)
  return ''
}

/** Reads <option> and <optgroup> children the way the browser would build
 *  the select's option list: an option with no `value` uses its text, a
 *  disabled optgroup disables everything in it. */
export function parseOptions(children: React.ReactNode): { options: DropdownOption[]; groups: DropdownGroup[] } {
  const options: DropdownOption[] = []
  const groups: DropdownGroup[] = []
  const visit = (node: React.ReactNode, group: number | null, groupDisabled: boolean) => {
    React.Children.forEach(node, child => {
      if (!React.isValidElement(child)) return
      const props = child.props as { value?: unknown; children?: React.ReactNode; disabled?: boolean; label?: string }
      if (child.type === React.Fragment) { visit(props.children, group, groupDisabled); return }
      if (child.type === 'option') {
        const label = textOf(props.children).replace(/\s+/g, ' ').trim()
        options.push({
          value: props.value === undefined || props.value === null ? label : String(props.value),
          label,
          disabled: !!props.disabled || groupDisabled,
          group,
        })
        return
      }
      if (child.type === 'optgroup') {
        groups.push({ label: props.label ?? '' })
        visit(props.children, groups.length - 1, !!props.disabled)
      }
    })
  }
  visit(children, null, false)
  return { options, groups }
}

/** Lower case, accents dropped: "Café" finds "cafe". */
export function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/* A label whose own click activated the control: the browser forwards a
   label click to its button as a click on the button, which would otherwise
   open the list. A native select only takes focus from its label, so the
   dropdown does the same. One listener for the whole page, in the capture
   phase so it runs before the forwarded click reaches the button. */
let labelActivated: Element | null = null
let labelListener = false
function watchLabels() {
  if (labelListener || typeof document === 'undefined') return
  labelListener = true
  document.addEventListener('click', e => {
    const t = e.target
    if (!(t instanceof Element)) return
    const label = t.closest('label')
    const control = label?.control ?? null
    /* The click the label forwards lands on the control itself: leave the
       mark for it. A mark nobody used (a disabled control) lapses. */
    if (!control || control.contains(t)) return
    labelActivated = control
    window.setTimeout(() => { if (labelActivated === control) labelActivated = null }, 0)
  }, true)
}

type Place = { top: number; left: number; minWidth: number; maxWidth: number; maxHeight: number; above: boolean }

export function Dropdown(props: DropdownProps) {
  const {
    value, defaultValue, onChange, disabled, id, name, children, className, style,
    onKeyDown: callerKeyDown, onClick: callerClick, onBlur, onFocus, required, form, autoFocus,
    ...rest
  } = props
  void form
  const autoId = useId()
  const buttonId = id ?? `dd${autoId}`
  const listId = `${buttonId}-list`
  const optId = (i: number) => `${buttonId}-opt-${i}`

  const { options, groups } = useMemo(() => parseOptions(children), [children])
  const enabled = options.filter(o => !o.disabled)
  const firstEnabled = enabled[0]?.value ?? options[0]?.value ?? ''

  const controlled = value !== undefined
  const [inner, setInner] = useState<string>(() =>
    defaultValue !== undefined ? String(defaultValue) : firstEnabled)
  const raw = controlled ? String(value ?? '') : inner
  /* As a native select does: a value no option has shows the first option
     that can be chosen. */
  const selectedIndex = (() => {
    const at = options.findIndex(o => o.value === raw)
    if (at !== -1) return at
    const fallback = options.findIndex(o => !o.disabled)
    return fallback !== -1 ? fallback : (options.length ? 0 : -1)
  })()
  const selected = selectedIndex === -1 ? null : options[selectedIndex]

  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [query, setQuery] = useState('')
  const [place, setPlace] = useState<Place | null>(null)

  const button = useRef<HTMLButtonElement>(null)
  const popup = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const listbox = useRef<HTMLDivElement>(null)
  const typed = useRef({ text: '', at: 0 })

  useEffect(() => { watchLabels() }, [])

  const searchable = enabled.length > SEARCH_THRESHOLD
  const shown = useMemo(() => {
    const all = options.map((o, i) => i)
    if (!searchable || !query.trim()) return all
    const q = fold(query.trim())
    return all.filter(i => fold(options[i].label).includes(q))
  }, [options, searchable, query])
  const shownEnabled = shown.filter(i => !options[i].disabled)

  const choose = useCallback((index: number) => {
    const o = options[index]
    if (!o || o.disabled) return
    const current = selected?.value
    if (!controlled) setInner(o.value)
    if (o.value !== current && onChange) {
      const target = { value: o.value, name: name ?? '', id: buttonId }
      onChange({ target, currentTarget: target, type: 'change' } as unknown as React.ChangeEvent<HTMLSelectElement>)
    }
  }, [options, selected, controlled, onChange, name, buttonId])

  const openWith = useCallback((which: 'selected' | 'first' | 'last' | number, seed = '') => {
    if (disabled || options.length === 0) return
    setQuery(seed)
    const firstOf = options.findIndex(o => !o.disabled)
    let lastOf = -1
    options.forEach((o, i) => { if (!o.disabled) lastOf = i })
    const start = which === 'first' ? firstOf
      : which === 'last' ? lastOf
        : typeof which === 'number' ? which
          : (selected && !selected.disabled ? selectedIndex : firstOf)
    setActive(start)
    setOpen(true)
  }, [disabled, options, selected, selectedIndex])

  const close = useCallback((refocus: boolean) => {
    setOpen(false)
    setQuery('')
    setPlace(null)
    if (refocus) button.current?.focus()
  }, [])

  /* Disabling the control while it is open closes it. */
  useEffect(() => { if (disabled && open) close(false) }, [disabled, open, close])

  /* Where the popup goes: below, or above when below is short and above has
     more room; always inside the viewport and at least as wide as the
     control. */
  const measure = useCallback(() => {
    const b = button.current
    if (!b) return
    const r = b.getBoundingClientRect()
    const vw = window.innerWidth || document.documentElement.clientWidth
    const vh = window.innerHeight || document.documentElement.clientHeight
    /* The height it would like: search box, the whole list, the padding. */
    const content = (search.current ? search.current.offsetHeight + GAP : 0)
      + (listbox.current ? listbox.current.scrollHeight : MAX_HEIGHT) + 2 * GAP + 2
    const natural = Math.min(MAX_HEIGHT, content)
    const below = vh - r.bottom - GAP - EDGE
    const aboveRoom = r.top - GAP - EDGE
    const above = below < natural && aboveRoom > below
    const maxHeight = Math.max(80, Math.min(MAX_HEIGHT, above ? aboveRoom : below))
    const maxWidth = Math.max(r.width, vw - 2 * EDGE)
    const minWidth = Math.min(r.width, maxWidth)
    let left = r.left
    const width = Math.max(minWidth, popup.current ? popup.current.offsetWidth : minWidth)
    if (left + width > vw - EDGE) left = Math.max(EDGE, vw - EDGE - width)
    const height = Math.min(natural, maxHeight)
    const top = above ? Math.max(EDGE, r.top - GAP - height) : r.bottom + GAP
    setPlace(prev => (prev && prev.top === top && prev.left === left && prev.minWidth === minWidth
      && prev.maxWidth === maxWidth && prev.maxHeight === maxHeight && prev.above === above)
      ? prev : { top, left, minWidth, maxWidth, maxHeight, above })
  }, [])

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
  }, [open, measure, shown.length])

  /* A fixed element is placed against the viewport unless an ancestor of the
     portal target is transformed; if so, shift by the difference so it still
     sits under the control. */
  useLayoutEffect(() => {
    const p = popup.current
    if (!open || !place || !p) return
    const r = p.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) return // not laid out (no layout engine): nothing to correct
    const dx = r.left - place.left
    const dy = r.top - place.top
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      p.style.left = `${place.left - dx}px`
      p.style.top = `${place.top - dy}px`
    }
  }, [open, place])

  /* Focus goes to the search box when there is one; otherwise it stays on
     the control, which points at the active option. */
  useEffect(() => {
    if (open && searchable) search.current?.focus()
  }, [open, searchable])

  /* The active option is kept in view as it moves. */
  useEffect(() => {
    if (!open || active < 0) return
    const el = document.getElementById(optId(active))
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, active])

  /* Filtering keeps the active option if it is still shown, else the first
     one that is. */
  useEffect(() => {
    if (!open) return
    if (!shownEnabled.includes(active)) setActive(shownEnabled[0] ?? -1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query])

  /* A press anywhere outside the control and the popup closes it, leaving
     the value and focus where they are. */
  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node | null
      if (!t) return
      if (button.current?.contains(t) || popup.current?.contains(t)) return
      close(false)
    }
    document.addEventListener('mousedown', away, true)
    document.addEventListener('touchstart', away, true)
    return () => {
      document.removeEventListener('mousedown', away, true)
      document.removeEventListener('touchstart', away, true)
    }
  }, [open, close])

  const move = (from: number, step: number): number => {
    const list = shownEnabled
    if (list.length === 0) return -1
    const at = list.indexOf(from)
    if (at === -1) return step > 0 ? list[0] : list[list.length - 1]
    return list[Math.max(0, Math.min(list.length - 1, at + step))]
  }

  /* Type-ahead: letters typed within half a second build one prefix; the
     same letter repeated cycles through the options that start with it. */
  const typeahead = (ch: string): number => {
    const now = Date.now()
    const t = typed.current
    t.text = now - t.at > TYPEAHEAD_MS ? ch : t.text + ch
    t.at = now
    const pool = options.map((o, i) => i).filter(i => !options[i].disabled)
    if (pool.length === 0) return -1
    const from = open ? active : selectedIndex
    const same = t.text.length > 1 && t.text.split('').every(c => c === t.text[0])
    const prefix = fold(same ? t.text[0] : t.text)
    const startAt = Math.max(0, pool.indexOf(from))
    const order = [...pool.slice(startAt + (t.text.length === 1 || same ? 1 : 0)), ...pool.slice(0, startAt + (t.text.length === 1 || same ? 1 : 0))]
    return order.find(i => fold(options[i].label).startsWith(prefix)) ?? -1
  }

  const isChar = (e: React.KeyboardEvent) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey

  const onKey = (e: React.KeyboardEvent<HTMLElement>, fromSearch: boolean) => {
    if (disabled) return
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault(); openWith('selected'); return
      }
      if (e.key === 'Home') { e.preventDefault(); openWith('first'); return }
      if (e.key === 'End') { e.preventDefault(); openWith('last'); return }
      if (isChar(e)) {
        e.preventDefault()
        if (searchable) { openWith('selected', e.key); return }
        const hit = typeahead(e.key)
        openWith(hit === -1 ? 'selected' : hit)
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); if (e.altKey) return; setActive(a => move(a, 1)); return
      case 'ArrowUp':
        e.preventDefault()
        if (e.altKey) { if (active >= 0) choose(active); close(true); return }
        setActive(a => move(a, -1)); return
      case 'Home': e.preventDefault(); setActive(shownEnabled[0] ?? -1); return
      case 'End': e.preventDefault(); setActive(shownEnabled[shownEnabled.length - 1] ?? -1); return
      case 'PageDown': e.preventDefault(); setActive(a => move(a, 10)); return
      case 'PageUp': e.preventDefault(); setActive(a => move(a, -10)); return
      case 'Enter':
        e.preventDefault()
        if (active >= 0 && shownEnabled.includes(active)) choose(active)
        close(true); return
      case 'Escape':
        /* Kept from the dialog or drawer around it: this Escape closes the
           list, not them. */
        e.preventDefault(); e.stopPropagation()
        close(true); return
      case 'Tab':
        /* Nothing new is chosen. Focus is put back on the control first so
           the browser (or a focus trap) moves on from there. */
        close(false)
        if (fromSearch) button.current?.focus()
        return
      default:
        if (e.key === ' ' && !fromSearch) {
          e.preventDefault()
          if (active >= 0) choose(active)
          close(true); return
        }
        if (!fromSearch && isChar(e)) {
          e.preventDefault()
          const hit = typeahead(e.key)
          if (hit !== -1) setActive(hit)
        }
    }
  }

  const activeShown = open && active >= 0 && shown.includes(active)

  const renderOption = (i: number) => {
    const o = options[i]
    const isSel = i === selectedIndex
    const cls = ['ui-dd__opt', isSel && 'is-selected', i === active && 'is-active', o.disabled && 'is-disabled']
      .filter(Boolean).join(' ')
    return (
      <div key={i} id={optId(i)} role="option" aria-selected={isSel} aria-disabled={o.disabled || undefined}
        data-value={o.value}
        className={cls}
        onMouseDown={e => e.preventDefault()}
        onMouseMove={() => { if (!o.disabled && active !== i) setActive(i) }}
        onClick={() => { if (o.disabled) return; choose(i); close(true) }}>
        <span className="ui-dd__label">{o.label || ' '}</span>
        {isSel && (
          <svg className="ui-dd__tick" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
    )
  }

  const renderList = () => {
    if (shown.length === 0) return <div className="ui-dd__empty" role="presentation">No matches</div>
    const out: React.ReactNode[] = []
    let i = 0
    while (i < shown.length) {
      const g = options[shown[i]].group
      if (g === null) { out.push(renderOption(shown[i])); i++; continue }
      const members: number[] = []
      while (i < shown.length && options[shown[i]].group === g) { members.push(shown[i]); i++ }
      const labelId = `${buttonId}-grp-${g}`
      out.push(
        <div key={`g${g}-${members[0]}`} role="group" aria-labelledby={labelId} className="ui-dd__group">
          <div id={labelId} className="ui-dd__group-label" role="presentation">{groups[g].label}</div>
          {members.map(renderOption)}
        </div>,
      )
    }
    return out
  }

  const portalTarget = (): HTMLElement | null => {
    if (typeof document === 'undefined') return null
    /* Inside a modal dialog the list is drawn within it, so assistive tech
       that hides everything outside an aria-modal dialog still reaches it. */
    return (button.current?.closest('[role="dialog"]') as HTMLElement | null) ?? document.body
  }

  const target = open ? portalTarget() : null
  const restAria = rest as Record<string, unknown>
  const describedBy = restAria['aria-describedby'] as string | undefined
  const ariaRequired = restAria['aria-required'] as boolean | undefined
  const ariaLabel = restAria['aria-label'] as string | undefined

  return (
    <>
      <button
        {...(rest as React.ButtonHTMLAttributes<HTMLButtonElement>)}
        ref={button}
        type="button"
        /* The chosen value, readable as `.value` the way a select's is (a
           button's value attribute does nothing else outside a form post,
           and type="button" never posts). */
        value={selected?.value ?? ''}
        id={buttonId}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={activeShown && !searchable ? optId(active) : undefined}
        aria-disabled={disabled || undefined}
        aria-required={ariaRequired ?? (required || undefined)}
        aria-describedby={describedBy}
        disabled={disabled}
        autoFocus={autoFocus}
        className={['c-input', 'ui-dd', open && 'is-open', className].filter(Boolean).join(' ')}
        style={style}
        onFocus={onFocus as unknown as React.FocusEventHandler<HTMLButtonElement>}
        onBlur={onBlur as unknown as React.FocusEventHandler<HTMLButtonElement>}
        onKeyDown={e => {
          (callerKeyDown as unknown as React.KeyboardEventHandler<HTMLButtonElement> | undefined)?.(e)
          if (!e.defaultPrevented) onKey(e, false)
        }}
        onClick={e => {
          (callerClick as unknown as React.MouseEventHandler<HTMLButtonElement> | undefined)?.(e)
          if (labelActivated === button.current) {
            labelActivated = null
            button.current?.focus()
            return
          }
          labelActivated = null
          if (disabled) return
          if (open) close(true)
          else { button.current?.focus(); openWith('selected') }
        }}
      >
        <span className="ui-dd__value">{selected ? (selected.label || ' ') : ' '}</span>
        <svg className="ui-dd__chev" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {name !== undefined && <input type="hidden" name={name} value={selected?.value ?? ''} disabled={disabled} />}
      {open && target && createPortal(
        <div ref={popup} className={['ui-dd__pop', place?.above && 'is-above'].filter(Boolean).join(' ')}
          style={place
            ? { top: place.top, left: place.left, minWidth: place.minWidth, maxWidth: place.maxWidth, maxHeight: place.maxHeight }
            : { top: 0, left: 0, visibility: 'hidden' }}
          onMouseDown={e => { if (e.target !== search.current) e.preventDefault() }}>
          {searchable && (
            <input ref={search} type="search" className="ui-dd__search" placeholder="Search…"
              aria-label="Search options" aria-controls={listId} aria-autocomplete="list"
              aria-activedescendant={activeShown ? optId(active) : undefined}
              autoComplete="off" spellCheck={false}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => onKey(e, true)} />
          )}
          <div ref={listbox} id={listId} role="listbox" className="ui-dd__list" tabIndex={-1}
            {...(ariaLabel ? { 'aria-label': ariaLabel } : { 'aria-labelledby': buttonId })}>
            {renderList()}
          </div>
        </div>,
        target,
      )}
    </>
  )
}
