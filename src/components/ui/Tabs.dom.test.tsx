import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Tabs } from './Tabs'

afterEach(cleanup)

const tabs = [
  { id: 'a', label: 'Held', count: 2 },
  { id: 'b', label: 'Flagged', disabled: true },
  { id: 'c', label: 'Accounts' },
  { id: 'd', label: 'Rules' },
]
function Host() {
  const [v, setV] = useState('a')
  return <Tabs tabs={tabs} value={v} onChange={setV} ariaLabel="Sections" panelIdPrefix="p-" />
}

describe('Tabs', () => {
  it('is a labelled tablist with selection, panel links and a roving tabindex', () => {
    render(<Host />)
    expect(screen.getByRole('tablist', { name: 'Sections' })).toBeTruthy()
    const held = screen.getByRole('tab', { name: /Held/ })
    expect(held.getAttribute('aria-selected')).toBe('true')
    expect(held.getAttribute('aria-controls')).toBe('p-a')
    expect(held.tabIndex).toBe(0)
    expect(screen.getByRole('tab', { name: 'Accounts' }).tabIndex).toBe(-1)
    expect(screen.getByText('2')).toBeTruthy()
  })

  it('arrows, Home and End move focus and select, skipping disabled tabs', async () => {
    const user = userEvent.setup()
    render(<Host />)
    screen.getByRole('tab', { name: /Held/ }).focus()
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Accounts' }))
    expect(screen.getByRole('tab', { name: 'Accounts' }).getAttribute('aria-selected')).toBe('true')
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: 'Rules' }))
    await user.keyboard('{ArrowRight}')
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: /Held/ }))
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: 'Rules' }).getAttribute('aria-selected')).toBe('true')
    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: /Held/ }).getAttribute('aria-selected')).toBe('true')
  })

  it('selects on click', async () => {
    const user = userEvent.setup()
    render(<Host />)
    await user.click(screen.getByRole('tab', { name: 'Rules' }))
    expect(screen.getByRole('tab', { name: 'Rules' }).getAttribute('aria-selected')).toBe('true')
  })
})
