import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ShelfBadges, shelfPriceTag } from './EnterpriseListingModal'

/* No database here: CI has no Supabase keys, and supabase.ts throws without them. */
vi.mock('../../lib/supabase', () => ({ supabase: {} }))

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
