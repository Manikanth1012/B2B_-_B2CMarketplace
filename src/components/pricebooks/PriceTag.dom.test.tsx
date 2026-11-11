import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { PriceTag, ContractBadge, PreferredBadge, OffContractMarker } from './PriceTag'

const row = (code: string, symbol: string, locale: string, symbol_first = true) =>
  ({ code, name: code, symbol, minor_units: 2, symbol_first, locale, is_reporting: false, sort_order: 1 })

const market = vi.hoisted(() => ({ currencies: [] as unknown[] }))
vi.mock('../../lib/MarketContext', () => ({
  useMarket: () => ({ book: { currencies: market.currencies } }),
}))

afterEach(() => { cleanup(); market.currencies = [] })

describe('PriceTag', () => {
  it('says both prices aloud when the account pays less, and hides the visual copy', () => {
    const { container } = render(<PriceTag price={21999} published={23999} currency="INR" />)
    expect(screen.getByText('Your price ₹21,999, published price ₹23,999').className).toContain('sr-only')
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull()
    expect(container.querySelector('s')?.textContent).toBe('₹23,999')
    expect(container.querySelector('[aria-label]')).toBeNull()
  })
  it('shows one figure and no "Your price" when the prices are equal', () => {
    const { container } = render(<PriceTag price={23999} published={23999} currency="INR" />)
    expect(container.querySelector('s')).toBeNull()
    expect(container.textContent).not.toContain('Your price')
    expect(screen.getAllByText('₹23,999')).toHaveLength(2) // spoken and seen
  })
  it('does not strike anything when the price is above the published one', () => {
    const { container } = render(<PriceTag price={25000} published={23999} currency="INR" />)
    expect(container.querySelector('s')).toBeNull()
    expect(container.textContent).not.toContain('Your price')
  })
  it('writes both figures with the same decimals', () => {
    render(<PriceTag price={21999} published={23999.5} currency="INR" />)
    expect(screen.getByText('Your price ₹21,999.00, published price ₹23,999.50')).toBeTruthy()
  })
  it('uses the operator currency rows for KES and AED', () => {
    market.currencies = [row('KES', 'KSh', 'en-KE'), row('AED', 'AED', 'en-AE'), row('INR', '₹', 'en-IN')]
    render(<><PriceTag price={21999} published={23999} currency="KES" /><PriceTag price={21999} published={23999} currency="AED" /></>)
    expect(screen.getByText('Your price KSh 21,999, published price KSh 23,999')).toBeTruthy()
    expect(screen.getByText('Your price AED 21,999, published price AED 23,999')).toBeTruthy()
  })
  it('falls back to the code for a currency nobody has a row or an ICU entry for', () => {
    render(<PriceTag price={1000} published={1000} currency="XXQ" />)
    expect(screen.getAllByText('XXQ 1,000').length).toBeGreaterThan(0)
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
