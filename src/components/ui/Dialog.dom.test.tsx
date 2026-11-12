import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { useRef, useState } from 'react'
import type React from 'react'
import { cleanup, render, screen, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Dialog } from './Dialog'
import { useFocusTrap, hasOpenTrap } from './useFocusTrap'

/* jsdom lays nothing out, so every element has no client rects and the trap
   would treat all of them as hidden. Give each one a box. */
const realGetClientRects = HTMLElement.prototype.getClientRects
beforeAll(() => {
  HTMLElement.prototype.getClientRects = function () {
    return [{ width: 1, height: 1 }] as unknown as DOMRectList
  }
})
afterAll(() => {
  HTMLElement.prototype.getClientRects = realGetClientRects
})

afterEach(cleanup)

/** A button that opens a dialog, with two fields and a footer button inside. */
function Opener({ autoFocus = false }: { autoFocus?: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open</button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Rename the list"
        footer={<button type="button">Save</button>}>
        <input aria-label="Name" autoFocus={autoFocus} />
        <input aria-label="Note" />
      </Dialog>
    </>
  )
}

/** A dialog with a button that opens a second dialog over it. */
function Stacked() {
  const [outer, setOuter] = useState(true)
  const [inner, setInner] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOuter(true)}>Open outer</button>
      <Dialog open={outer} onClose={() => setOuter(false)} title="Outer">
        <button type="button" onClick={() => setInner(true)}>Delete</button>
        <Dialog open={inner} onClose={() => setInner(false)} title="Are you sure?">
          <button type="button">Yes, delete</button>
        </Dialog>
      </Dialog>
    </>
  )
}

describe('Dialog', () => {
  it('is a modal dialog named by its title', async () => {
    const user = userEvent.setup()
    render(<Opener />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    const dialog = screen.getByRole('dialog', { name: 'Rename the list' })
    expect(dialog.getAttribute('aria-modal')).toBe('true')
    const title = document.getElementById(dialog.getAttribute('aria-labelledby')!)
    expect(title?.tagName).toBe('H2')
  })

  it('moves focus in on open, to the first thing that can take it', async () => {
    const user = userEvent.setup()
    render(<Opener />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }))
  })

  it('wraps Tab from the last control to the first, and Shift+Tab back', async () => {
    const user = userEvent.setup()
    render(<Opener />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    const close = screen.getByRole('button', { name: 'Close' })
    const save = screen.getByRole('button', { name: 'Save' })

    save.focus()
    await user.tab()
    expect(document.activeElement).toBe(close)

    await user.tab({ shift: true })
    expect(document.activeElement).toBe(save)

    /* A Tab between two middle controls is the browser's own. */
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Note' }))
  })

  it('returns focus to the button that opened it when closed', async () => {
    const user = userEvent.setup()
    render(<Opener />)
    const open = screen.getByRole('button', { name: 'Open' })
    await user.click(open)
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(open)
  })

  it('does not take an autoFocus field inside for the opener', async () => {
    const user = userEvent.setup()
    render(<Opener autoFocus />)
    const open = screen.getByRole('button', { name: 'Open' })
    await user.click(open)
    /* The autoFocus field has focus, and the trap leaves it there. */
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Name' }))
    await user.click(screen.getByRole('button', { name: 'Close' }))
    expect(document.activeElement).toBe(open)
  })

  it('closes only the top of two stacked dialogs on Escape', async () => {
    const user = userEvent.setup()
    render(<Stacked />)
    await user.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByRole('dialog', { name: 'Are you sure?' })).toBeTruthy()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Are you sure?' })).toBeNull()
    expect(screen.getByRole('dialog', { name: 'Outer' })).toBeTruthy()
    /* Focus went back to the button that opened the confirm. */
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }))

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Outer' })).toBeNull()
  })

  it('spends the Escape: a listener beneath it does not also close', async () => {
    const user = userEvent.setup()
    render(<Opener />)
    await user.click(screen.getByRole('button', { name: 'Open' }))

    /* The account menu listens on window; a drawer on document. */
    const onWindow = vi.fn()
    const onDocument = vi.fn()
    window.addEventListener('keydown', onWindow)
    document.addEventListener('keydown', onDocument)
    try {
      const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
      act(() => { document.activeElement!.dispatchEvent(event) })
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(event.defaultPrevented).toBe(true)
      expect(onWindow).not.toHaveBeenCalled()
      expect(onDocument).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('keydown', onWindow)
      document.removeEventListener('keydown', onDocument)
    }

    /* With no dialog open the same key reaches them as before. */
    window.addEventListener('keydown', onWindow)
    try {
      fireEvent.keyDown(document.body, { key: 'Escape' })
      expect(onWindow).toHaveBeenCalledTimes(1)
    } finally {
      window.removeEventListener('keydown', onWindow)
    }
  })

  it('closes on Escape when focus has fallen to <body>', async () => {
    const user = userEvent.setup()
    render(<Opener />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    ;(document.activeElement as HTMLElement).blur()
    expect(document.activeElement).toBe(document.body)
    fireEvent.keyDown(document.body, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('a document listener added before it opened, guarded by hasOpenTrap, stays open', async () => {
    /* Mirrors the cart drawer: its Escape listener is registered first, so it
       runs before the dialog's and only its own guard can hold it back. */
    const closeBeneath = vi.fn()
    const beneath = (e: KeyboardEvent) => { if (e.key === 'Escape' && !hasOpenTrap()) closeBeneath() }
    document.addEventListener('keydown', beneath)
    try {
      const user = userEvent.setup()
      render(<Opener />)
      await user.click(screen.getByRole('button', { name: 'Open' }))
      await user.keyboard('{Escape}')
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(closeBeneath).not.toHaveBeenCalled()

      /* With the dialog gone, the next Escape is the listener's. */
      await user.keyboard('{Escape}')
      expect(closeBeneath).toHaveBeenCalledTimes(1)
    } finally {
      document.removeEventListener('keydown', beneath)
    }
  })

  it('closes on a press and release on the backdrop, not on one inside', async () => {
    const user = userEvent.setup()
    render(<Opener />)
    await user.click(screen.getByRole('button', { name: 'Open' }))
    await user.click(screen.getByRole('textbox', { name: 'Name' }))
    expect(screen.getByRole('dialog')).toBeTruthy()
    await user.click(screen.getByRole('dialog').parentElement!)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

/** A bare trap over a container, for the cases a Dialog never reaches. */
function Trap({ active, children }: { active: boolean; children?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useFocusTrap(ref, active)
  return <div ref={ref} data-testid="trap">{children}</div>
}

describe('useFocusTrap', () => {
  it('focuses the container itself when there is nothing inside to press', () => {
    render(<Trap active><p>Only words.</p></Trap>)
    const trap = screen.getByTestId('trap')
    expect(trap.tabIndex).toBe(-1)
    expect(document.activeElement).toBe(trap)

    /* Tab has nowhere to go and stays put. */
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(trap)
  })

  it('leaves out disabled, hidden and tabindex -1 controls', async () => {
    const user = userEvent.setup()
    render(
      <Trap active>
        <button type="button" disabled>Off</button>
        <button type="button">First</button>
        <input type="hidden" />
        <button type="button" tabIndex={-1}>Skipped</button>
        <button type="button">Last</button>
      </Trap>,
    )
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Last' }))
  })

  it('leaves focus where the close put it on purpose', () => {
    const { rerender } = render(
      <>
        <button type="button">Opener</button>
        <button type="button">Elsewhere</button>
        <Trap active={false}><button type="button">Inside</button></Trap>
      </>,
    )
    screen.getByRole('button', { name: 'Opener' }).focus()
    rerender(
      <>
        <button type="button">Opener</button>
        <button type="button">Elsewhere</button>
        <Trap active><button type="button">Inside</button></Trap>
      </>,
    )
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Inside' }))

    const elsewhere = screen.getByRole('button', { name: 'Elsewhere' })
    elsewhere.focus()
    rerender(
      <>
        <button type="button">Opener</button>
        <button type="button">Elsewhere</button>
        <Trap active={false}><button type="button">Inside</button></Trap>
      </>,
    )
    expect(document.activeElement).toBe(elsewhere)
  })
})

/* The Close button's hit target. jsdom lays nothing out, so the dialog's own
   stylesheet is put in the document and the cascade read back. */
describe('Dialog Close button', () => {
  /* By path from the project root: under jsdom import.meta.url is not a file URL. */
  const css = readFileSync(resolve(process.cwd(), 'src/styles/account.css'), 'utf8')

  it('is 44×44 with the 20px icon, and gives the extra 8px back in margin so the header does not grow', () => {
    const style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
    try {
      render(<Dialog open onClose={() => {}} title="Rename the list"><p>Body</p></Dialog>)
      const close = screen.getByRole('button', { name: 'Close' })
      expect(close.className).toBe('ui-dialog__close')
      const cs = getComputedStyle(close)
      expect(cs.width).toBe('44px')
      expect(cs.height).toBe('44px')
      expect(cs.minWidth).toBe('44px')
      expect(cs.minHeight).toBe('44px')
      /* 44 - 8 = 36: the footprint it had before. */
      expect(cs.marginTop).toBe('-4px')
      expect(cs.marginBottom).toBe('-4px')
      const icon = close.querySelector('svg')!
      expect(icon.getAttribute('width')).toBe('20')
      expect(icon.getAttribute('height')).toBe('20')
      expect(icon.getAttribute('aria-hidden')).toBe('true')
    } finally {
      style.remove()
    }
  })

  it('keeps a visible focus ring', () => {
    expect(css).toMatch(/\.ui-dialog__close:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--electric\)/)
    expect(css).not.toMatch(/\.ui-dialog__close[^{]*\{[^}]*outline:\s*(none|0)/)
  })
})
