import { useEffect, useRef, useState } from 'react'
import type React from 'react'
import { tabKeyTarget } from '../../lib/tabKeys'

export interface AccountTab { id: string; label: string; icon: React.ReactNode }

/** The breakpoint at which src/styles/account.css turns the tab row into a column. */
export const ACCOUNT_TABS_VERTICAL_QUERY = '(min-width: 1024px)'

/* 'vertical' while the column layout applies, else 'horizontal'. Where there
   is no matchMedia (a test or server environment) the list is a row. */
function useOrientation(): 'vertical' | 'horizontal' {
  const query = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(ACCOUNT_TABS_VERTICAL_QUERY) : null
  const [vertical, setVertical] = useState(() => query()?.matches ?? false)
  useEffect(() => {
    const mql = query()
    if (!mql) return
    const update = () => setVertical(mql.matches)
    update()
    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', update)
      return () => mql.removeEventListener('change', update)
    }
    /* Safari before 14 has only the older pair. */
    mql.addListener(update)
    return () => mql.removeListener(update)
  }, [])
  return vertical ? 'vertical' : 'horizontal'
}

/**
 * The account screen's sections as a tablist.
 *
 * At 1024px and wider it is a sticky column on the left; below that it is a
 * row of chips that scrolls sideways. The layout is CSS; aria-orientation
 * follows the same 1024px breakpoint through matchMedia so a screen reader
 * is told which way it runs. The arrow keys accept both pairs either way
 * (tabKeyTarget) and Home/End jump to the ends.
 * Only the selected tab is in the Tab order (roving tabIndex): Tab moves from
 * the list into the panel rather than through nine tabs first.
 *
 * `children` is the active panel; there is one panel element, labelled by
 * whichever tab is selected.
 */
export function AccountTabs({ tabs, active, onChange, idPrefix, children }: {
  tabs: readonly AccountTab[]
  active: string
  onChange(id: string): void
  idPrefix: string
  children: React.ReactNode
}): JSX.Element {
  const refs = useRef<Array<HTMLButtonElement | null>>([])
  const panelId = `${idPrefix}-panel`
  const tabId = (id: string) => `${idPrefix}-tab-${id}`
  const activeIndex = Math.max(0, tabs.findIndex(t => t.id === active))
  const orientation = useOrientation()

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = tabKeyTarget(e.key, index, tabs.length)
    if (target === null) return
    e.preventDefault()
    onChange(tabs[target].id)
    refs.current[target]?.focus()
  }

  return (
    <div className="acct-tabs">
      <div className="acct-tabs__list" role="tablist" aria-label="Account sections"
        aria-orientation={orientation}>
        {tabs.map((tab, i) => {
          const selected = i === activeIndex
          return (
            <button
              key={tab.id}
              ref={(el) => { refs.current[i] = el }}
              type="button"
              role="tab"
              id={tabId(tab.id)}
              className={selected ? 'acct-tabs__tab acct-tabs__tab--active' : 'acct-tabs__tab'}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(tab.id)}
              onKeyDown={(e) => onKeyDown(e, i)}
            >
              <span className="acct-tabs__icon" aria-hidden="true">{tab.icon}</span>
              <span className="acct-tabs__label">{tab.label}</span>
            </button>
          )
        })}
      </div>
      <div className="acct-tabs__panel" role="tabpanel" id={panelId}
        aria-labelledby={tabs[activeIndex] ? tabId(tabs[activeIndex].id) : undefined}
        tabIndex={0}>
        {children}
      </div>
    </div>
  )
}
