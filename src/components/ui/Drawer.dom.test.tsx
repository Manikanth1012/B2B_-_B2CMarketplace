import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Drawer } from './Drawer'

const real = HTMLElement.prototype.getClientRects
beforeAll(() => { HTMLElement.prototype.getClientRects = function () { return [{ width: 1, height: 1 }] as unknown as DOMRectList } })
afterAll(() => { HTMLElement.prototype.getClientRects = real })
afterEach(cleanup)

function Opener() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <Drawer open={open} onClose={() => setOpen(false)} title="Filters" description="Narrow the list"
        footer={<button type="button">Apply</button>}>
        <input aria-label="Name" />
      </Drawer>
    </>
  )
}

describe('Drawer', () => {
  it('is a modal dialog named by its title, with a description', async () => {
    const user = userEvent.setup()
    render(<Opener />)
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Open' }))
    const d = screen.getByRole('dialog', { name: 'Filters' })
    expect(d.getAttribute('aria-modal')).toBe('true')
    expect(screen.getByText('Narrow the list')).toBeTruthy()
  })

  it('closes on its Close button', async () => {
    const user = userEvent.setup()
    render(<Opener />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('closes on Escape and returns focus to the opener', async () => {
    const user = userEvent.setup()
    render(<Opener />)
    const open = screen.getByRole('button', { name: 'Open' })
    await user.click(open)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(open)
  })

  it('closes on a backdrop press but not a press inside', async () => {
    const user = userEvent.setup()
    render(<Opener />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByLabelText('Name'))
    expect(screen.getByRole('dialog')).toBeTruthy()
    const back = screen.getByRole('dialog').parentElement!
    fireEvent.mouseDown(back); fireEvent.click(back)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('traps Tab inside', async () => {
    const user = userEvent.setup()
    render(<Opener />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    await user.tab(); await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Apply' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Apply' }))
  })
})
