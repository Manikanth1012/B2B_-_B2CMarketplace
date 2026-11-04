import { useRef } from 'react'
import type React from 'react'
import { tabKeyTarget } from '../../lib/tabKeys'

export interface AccountTab { id: string; label: string; icon: React.ReactNode }

/**
 * The account screen's sections as a tablist.
 *
 * At 1024px and wider it is a sticky column on the left; below that it is a
 * row of chips that scrolls sideways. Which way it runs is CSS only, so the
 * arrow keys accept both pairs (tabKeyTarget) and Home/End jump to the ends.
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

  const onKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const target = tabKeyTarget(e.key, index, tabs.length)
    if (target === null) return
    e.preventDefault()
    onChange(tabs[target].id)
    refs.current[target]?.focus()
  }

  return (
    <div className="acct-tabs">
      <div className="acct-tabs__list" role="tablist" aria-label="Account sections">
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
