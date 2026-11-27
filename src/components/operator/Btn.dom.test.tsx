import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
import { Btn } from './shared'

afterEach(cleanup)

describe('Btn', () => {
  it('loading disables the button, sets aria-busy and keeps the label', async () => {
    const onClick = vi.fn()
    render(<Btn loading onClick={onClick}>Save</Btn>)
    const b = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(b.disabled).toBe(true)
    expect(b.getAttribute('aria-busy')).toBe('true')
    expect(b.querySelector('svg.ui-spinner')).not.toBeNull()
    await userEvent.setup().click(b)
    expect(onClick).not.toHaveBeenCalled()
  })
  it('has tertiary and icon forms and no busy flag by default', () => {
    render(<Btn variant="tertiary" icon aria-label="More">x</Btn>)
    const b = screen.getByRole('button', { name: 'More' })
    expect(b.className).toContain('c-btn--tertiary')
    expect(b.className).toContain('c-btn--icon')
    expect(b.hasAttribute('aria-busy')).toBe(false)
  })
})
