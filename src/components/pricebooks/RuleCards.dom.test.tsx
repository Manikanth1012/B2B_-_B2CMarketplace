import { afterEach, describe, expect, it } from 'vitest'
import { useState } from 'react'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { RuleCards } from './RuleCards'
import type { OffContractRule } from '../../lib/accountPrices'

afterEach(cleanup)

function Harness({ readOnly = false }: { readOnly?: boolean }) {
  const [v, setV] = useState<OffContractRule>('allow')
  return <RuleCards value={v} onChange={setV} readOnly={readOnly} />
}

describe('RuleCards', () => {
  it('is a radio group with exactly one checked card and one tab stop', () => {
    render(<Harness />)
    expect(screen.getByRole('radiogroup')).toBeTruthy()
    const radios = screen.getAllByRole('radio')
    expect(radios.map(r => r.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    expect(radios.map(r => r.tabIndex)).toEqual([0, -1, -1])
  })

  it('moves and selects with the arrow keys, wrapping at both ends', () => {
    render(<Harness />)
    const checked = () => screen.getAllByRole('radio').findIndex(r => r.getAttribute('aria-checked') === 'true')
    fireEvent.keyDown(screen.getAllByRole('radio')[0], { key: 'ArrowRight' })
    expect(checked()).toBe(1)
    expect(document.activeElement).toBe(screen.getAllByRole('radio')[1])
    fireEvent.keyDown(screen.getAllByRole('radio')[1], { key: 'ArrowDown' })
    expect(checked()).toBe(2)
    fireEvent.keyDown(screen.getAllByRole('radio')[2], { key: 'ArrowRight' })
    expect(checked()).toBe(0)
    fireEvent.keyDown(screen.getAllByRole('radio')[0], { key: 'ArrowLeft' })
    expect(checked()).toBe(2)
  })

  it('selects on click', () => {
    render(<Harness />)
    fireEvent.click(screen.getAllByRole('radio')[1])
    expect(screen.getAllByRole('radio')[1].getAttribute('aria-checked')).toBe('true')
  })

  it('cannot be changed when read-only', () => {
    render(<Harness readOnly />)
    fireEvent.keyDown(screen.getAllByRole('radio')[0], { key: 'ArrowRight' })
    fireEvent.click(screen.getAllByRole('radio')[2])
    expect(screen.getAllByRole('radio')[0].getAttribute('aria-checked')).toBe('true')
  })
})
