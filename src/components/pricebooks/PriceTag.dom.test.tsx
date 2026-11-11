import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PriceTag, ContractBadge, PreferredBadge, OffContractMarker } from './PriceTag'

afterEach(cleanup)

describe('PriceTag', () => {
  it('names both prices when the account pays less', () => {
    const { container } = render(<PriceTag price={21999} published={23999} currency="INR" />)
    expect(screen.getByRole('group', { name: 'Your price ₹21,999, published price ₹23,999' })).toBeTruthy()
    expect(container.querySelector('s')?.textContent).toBe('₹23,999')
    expect(container.textContent).toContain('Your price')
  })
  it('shows one figure and no "Your price" when the prices are equal', () => {
    const { container } = render(<PriceTag price={23999} published={23999} currency="INR" />)
    expect(container.querySelector('s')).toBeNull()
    expect(container.textContent).not.toContain('Your price')
    expect(screen.getByRole('group', { name: '₹23,999' })).toBeTruthy()
  })
  it('does not strike anything when the price is above the published one', () => {
    const { container } = render(<PriceTag price={25000} published={23999} currency="INR" />)
    expect(container.querySelector('s')).toBeNull()
    expect(container.textContent).not.toContain('Your price')
  })
})

describe('badges and marker', () => {
  it('say what they are in words', () => {
    render(<><ContractBadge /><PreferredBadge kind="seller" /><PreferredBadge kind="product" /></>)
    expect(screen.getByText('On your price book')).toBeTruthy()
    expect(screen.getByText('Preferred seller')).toBeTruthy()
    expect(screen.getByText('Preferred product')).toBeTruthy()
  })
  it('renders an off-contract reason as text, not a tooltip', () => {
    const { container } = render(<OffContractMarker reason="Urgent site fix" />)
    expect(screen.getByText('Urgent site fix')).toBeTruthy()
    expect(container.querySelector('[title]')).toBeNull()
  })
  it('renders without a reason', () => {
    render(<OffContractMarker />)
    expect(screen.getByText('Off your price book')).toBeTruthy()
  })
})
