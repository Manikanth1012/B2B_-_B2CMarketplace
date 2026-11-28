import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { Menu } from './Menu'

afterEach(cleanup)

function setup() {
  const onOk = vi.fn()
  const onNo = vi.fn()
  render(
    <Menu label="More actions" items={[
      { label: 'Duplicate', onSelect: onOk },
      { label: 'Delete', onSelect: onNo, disabled: true, hint: 'Assigned to two counterparties' },
    ]}>…</Menu>,
  )
  fireEvent.click(screen.getByRole('button', { name: 'More actions' }))
  return { onOk, onNo }
}

describe('Menu disabled items', () => {
  it('stays focusable, announced as disabled with its hint, and shows the reason', () => {
    setup()
    const del = screen.getByRole('menuitem', { name: /Delete/ })
    expect(del.getAttribute('aria-disabled')).toBe('true')
    expect(del.hasAttribute('disabled')).toBe(false)
    const hint = screen.getAllByText('Assigned to two counterparties')[0]
    expect(del.getAttribute('aria-describedby')).toBe(hint.id)
    fireEvent.keyDown(screen.getByRole('menuitem', { name: /Duplicate/ }), { key: 'ArrowDown' })
    expect(document.activeElement).toBe(del)
  })

  it('does nothing on Enter or click, and the menu stays open', () => {
    const { onNo } = setup()
    const del = screen.getByRole('menuitem', { name: /Delete/ })
    del.focus()
    fireEvent.keyDown(del, { key: 'Enter' })
    fireEvent.click(del)
    expect(onNo).not.toHaveBeenCalled()
    expect(screen.getByRole('menu')).toBeTruthy()
  })
})
