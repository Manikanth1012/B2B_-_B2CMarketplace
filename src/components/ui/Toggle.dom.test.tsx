import { afterEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Toggle } from './Toggle'

afterEach(cleanup)

function Harness({ onChange = () => {}, disabled }: { onChange?: (n: boolean) => void; disabled?: boolean }) {
  const [on, setOn] = useState(false)
  return <Toggle checked={on} label="Email alerts" disabled={disabled} onChange={n => { setOn(n); onChange(n) }} />
}

describe('Toggle', () => {
  it('is a switch named by its visible label and reflects checked', () => {
    render(<Toggle checked label="Email alerts" onChange={() => {}} />)
    const sw = screen.getByRole('switch', { name: 'Email alerts' })
    expect(sw.getAttribute('aria-checked')).toBe('true')
  })

  it('toggles on click, Space and Enter', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    const sw = screen.getByRole('switch')
    await user.click(sw)
    expect(onChange).toHaveBeenLastCalledWith(true)
    sw.focus()
    await user.keyboard(' ')
    expect(onChange).toHaveBeenLastCalledWith(false)
    await user.keyboard('{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(true)
    expect(sw.getAttribute('aria-checked')).toBe('true')
  })

  it('clicking the label toggles it', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} />)
    await userEvent.setup().click(screen.getByText('Email alerts'))
    expect(onChange).toHaveBeenCalledWith(true)
  })

  it('does nothing when disabled', async () => {
    const onChange = vi.fn()
    render(<Harness onChange={onChange} disabled />)
    await userEvent.setup().click(screen.getByRole('switch'))
    expect(onChange).not.toHaveBeenCalled()
  })
})
