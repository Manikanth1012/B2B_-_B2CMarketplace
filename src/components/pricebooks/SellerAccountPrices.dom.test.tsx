import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { SellerAccountPrices } from './SellerAccountPrices'

const repo = vi.hoisted(() => ({ result: { ok: true, value: [] } as unknown }))
vi.mock('../../lib/priceBookRepo', () => ({ loadSellerAccountPrices: () => Promise.resolve(repo.result) }))
vi.mock('../../lib/MarketContext', () => ({ useMarket: () => ({ book: { currencies: [] } }) }))

const row = (id: string, product_id: string, company: string) =>
  ({ id, company, product_id, product_name: 'P', currency: 'INR', unit_price: 100, starts_on: '2020-01-01', ends_on: null, source: 'negotiated' })

afterEach(() => cleanup())

describe('SellerAccountPrices', () => {
  it("lists only this listing's account prices in a captioned table", async () => {
    repo.result = { ok: true, value: [row('a', 'SKU-1', 'Acme Ltd'), row('b', 'SKU-2', 'Other Co')] }
    render(<SellerAccountPrices productId="SKU-1" />)
    expect(await screen.findByRole('table', { name: 'Account prices on this listing' })).toBeTruthy()
    expect(screen.getByText('Acme Ltd')).toBeTruthy()
    expect(screen.queryByText('Other Co')).toBeNull()
    expect(screen.getByText('in force')).toBeTruthy()
    expect(screen.getAllByRole('columnheader')).toHaveLength(5)
  })
  it('renders nothing when the read fails', async () => {
    repo.result = { ok: false, error: 'Price books are not set up on this database yet' }
    const { container } = render(<SellerAccountPrices productId="SKU-1" />)
    await waitFor(() => expect(container.innerHTML).toBe(''))
  })
})
