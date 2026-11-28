import { useRef } from 'react'
import type React from 'react'

export interface TabDef { id: string; label: string; count?: number; disabled?: boolean }

/**
 * Controlled tabs with automatic activation: arrow keys, Home and End move
 * focus and select. Only the selected tab is a Tab stop (roving tabindex).
 * `panelIdPrefix` makes `aria-controls` point at `${prefix}${id}`.
 */
export function Tabs({ tabs, value, onChange, ariaLabel, panelIdPrefix }: {
  tabs: TabDef[]
  value: string
  onChange: (id: string) => void
  ariaLabel: string
  panelIdPrefix?: string
}): JSX.Element {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const enabled = tabs.filter(t => !t.disabled)

  const move = (e: React.KeyboardEvent, id: string) => {
    if (enabled.length === 0) return
    const i = enabled.findIndex(t => t.id === id)
    let next = -1
    if (e.key === 'ArrowRight') next = (i + 1) % enabled.length
    else if (e.key === 'ArrowLeft') next = (i - 1 + enabled.length) % enabled.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = enabled.length - 1
    if (next < 0) return
    e.preventDefault()
    const t = enabled[next]
    refs.current[t.id]?.focus()
    onChange(t.id)
  }

  /* If the value matches no enabled tab, the first enabled one is the stop. */
  const stop = enabled.some(t => t.id === value) ? value : enabled[0]?.id

  return (
    <div className="ui-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map(t => (
        <button key={t.id} type="button" role="tab"
          ref={el => { refs.current[t.id] = el }}
          id={panelIdPrefix ? `${panelIdPrefix}${t.id}-tab` : undefined}
          className="ui-tab" disabled={t.disabled}
          aria-selected={t.id === value}
          aria-controls={panelIdPrefix ? `${panelIdPrefix}${t.id}` : undefined}
          tabIndex={t.id === stop ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={e => move(e, t.id)}>
          {t.label}
          {t.count !== undefined && (
            <>
              {/* en-US grouping, as the rest of the console's counts: the machine's
                  locale would print 1.234 on some browsers. */}
              <span className="ui-tab__count" aria-hidden="true">{t.count.toLocaleString('en-US')}</span>
              <span className="sr-only">({t.count.toLocaleString('en-US')})</span>
            </>
          )}
        </button>
      ))}
    </div>
  )
}
