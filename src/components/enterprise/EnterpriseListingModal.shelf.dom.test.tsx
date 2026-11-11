import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShelfBadges, shelfPriceTag } from './EnterpriseListingModal'

describe('shelf badges and price', () => {
  it('render nothing for a listing with no preference and no price book', () => {
    const { container } = render(<ShelfBadges l={{ preferred: null, on_contract: false }} />)
    expect(container.innerHTML).toBe('')
    expect(shelfPriceTag({ price: 10, published_price: 10, currency: 'USD', on_contract: false })).toBeUndefined()
  })
  it('say preferred and on-contract when true', () => {
    render(<ShelfBadges l={{ preferred: 'seller', on_contract: true }} />)
    expect(screen.getByText('Preferred seller')).toBeTruthy()
    expect(screen.getByText('On your price book')).toBeTruthy()
  })
})
