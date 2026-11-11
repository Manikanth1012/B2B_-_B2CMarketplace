import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountTabs, ACCOUNT_TABS_VERTICAL_QUERY } from './AccountTabs'

const TABS = [
  { id: 'profile', label: 'Profile', icon: null },
  { id: 'orders', label: 'Orders', icon: null },
  { id: 'rewards', label: 'Rewards', icon: null },
  { id: 'security', label: 'Security', icon: null },
] as const

function Harness() {
  const [active, setActive] = useState('profile')
  return (
    <AccountTabs tabs={TABS} active={active} onChange={setActive} idPrefix="acct">
      <p>{active} panel</p>
    </AccountTabs>
  )
}

/** A matchMedia whose answer the test can change, firing 'change' as a browser would. */
function mockMatchMedia(initial: boolean) {
  const listeners = new Set<() => void>()
  const mql = {
    matches: initial,
    media: ACCOUNT_TABS_VERTICAL_QUERY,
    addEventListener: (_: string, fn: () => void) => { listeners.add(fn) },
    removeEventListener: (_: string, fn: () => void) => { listeners.delete(fn) },
  }
  const matchMedia = vi.fn((query: string) => {
    expect(query).toBe(ACCOUNT_TABS_VERTICAL_QUERY)
    return mql as unknown as MediaQueryList
  })
  vi.stubGlobal('matchMedia', matchMedia)
  return {
    set(matches: boolean) {
      mql.matches = matches
      act(() => { listeners.forEach(fn => fn()) })
    },
    listeners,
  }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const tab = (name: string) => screen.getByRole('tab', { name })

describe('AccountTabs', () => {
  it('keeps only the selected tab in the Tab order', () => {
    render(<Harness />)
    expect(tab('Profile').tabIndex).toBe(0)
    expect(tab('Profile').getAttribute('aria-selected')).toBe('true')
    for (const name of ['Orders', 'Rewards', 'Security']) {
      expect(tab(name).tabIndex).toBe(-1)
      expect(tab(name).getAttribute('aria-selected')).toBe('false')
    }
    const panel = screen.getByRole('tabpanel')
    expect(panel.getAttribute('aria-labelledby')).toBe(tab('Profile').id)
  })

  it('moves with both arrow pairs, wrapping, and jumps with Home and End', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    tab('Profile').focus()

    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(tab('Orders'))
    expect(tab('Orders').tabIndex).toBe(0)
    expect(tab('Profile').tabIndex).toBe(-1)
    expect(screen.getByRole('tabpanel').textContent).toBe('orders panel')

    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(tab('Rewards'))

    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(tab('Orders'))

    await user.keyboard('{End}')
    expect(document.activeElement).toBe(tab('Security'))

    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(tab('Profile'))

    await user.keyboard('{ArrowLeft}')
    expect(document.activeElement).toBe(tab('Security'))

    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(tab('Profile'))
    expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe(tab('Profile').id)
  })

  it('Tab leaves the list for the panel rather than walking every tab', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    tab('Profile').focus()
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('tabpanel'))
  })

  it('says it runs vertically while the column layout applies, and follows a change', () => {
    const media = mockMatchMedia(true)
    render(<Harness />)
    const list = screen.getByRole('tablist')
    expect(list.getAttribute('aria-orientation')).toBe('vertical')

    media.set(false)
    expect(list.getAttribute('aria-orientation')).toBe('horizontal')

    media.set(true)
    expect(list.getAttribute('aria-orientation')).toBe('vertical')
  })

  it('says it runs horizontally below the breakpoint', () => {
    mockMatchMedia(false)
    render(<Harness />)
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('horizontal')
  })

  it('stops listening once it is gone', () => {
    const media = mockMatchMedia(true)
    const { unmount } = render(<Harness />)
    expect(media.listeners.size).toBe(1)
    unmount()
    expect(media.listeners.size).toBe(0)
  })

  it('falls back to horizontal where there is no matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined)
    render(<Harness />)
    expect(screen.getByRole('tablist').getAttribute('aria-orientation')).toBe('horizontal')
  })
})
