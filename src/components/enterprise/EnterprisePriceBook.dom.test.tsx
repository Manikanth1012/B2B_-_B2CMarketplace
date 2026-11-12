import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react'
import { EnterprisePriceBook } from './EnterprisePriceBook'
import { DEFAULT_RULES } from '../../lib/accountPrices'

const roles = [{ id: 'lead', can_set_policy: true }]
const book = (can: boolean) => ({
  account: { id: 'A1', currency: 'INR' }, me: { role: can ? 'lead' : 'other' }, roles,
  prices: [], rules: DEFAULT_RULES('A1'), preferences: [],
})
let current = book(true)
const add = vi.fn()
const save = vi.fn()
let products: unknown[] = []

vi.mock('../../lib/enterpriseRepo', () => ({
  loadAccount: async () => current,
  loadEnterpriseCatalogue: async () => [{ id: 'p1', name: 'Gauge', partner_id: 'S1', seller: 'Nimbus' }],
}))
vi.mock('../../lib/priceBookRepo', () => ({
  saveBuyingRules: (...a: unknown[]) => save(...a),
  addPreference: (...a: unknown[]) => add(...a),
  removePreference: async () => ({ ok: true, value: undefined }),
  loadProductsByIds: async () => ({ ok: true, value: products }),
}))
vi.mock('../../lib/MarketContext', () => ({ useMarket: () => ({ book: null }) }))

afterEach(() => { cleanup(); vi.clearAllMocks(); products = [] })

describe('EnterprisePriceBook', () => {
  it('shows the empty state and the database sentence when a save is refused', async () => {
    current = book(true)
    save.mockResolvedValue({ ok: false, error: 'Price books are not set up on this database yet, so nothing was changed.' })
    render(<EnterprisePriceBook />)
    await screen.findByText(/no prices of its own yet/)
    fireEvent.click(screen.getByRole('button', { name: 'Save buying rules' }))
    expect((await screen.findAllByText(/not set up on this database/)).length).toBeGreaterThan(0)
  })

  it('keeps an unsaved rule when a preference is added', async () => {
    current = book(true)
    add.mockResolvedValue({ ok: true, value: {} })
    render(<EnterprisePriceBook />)
    await screen.findByText(/no prices of its own yet/)
    fireEvent.click(screen.getAllByRole('radio')[2])
    fireEvent.change(screen.getByLabelText(/Add to preferred sellers/i), { target: { value: 'S1' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0])
    await waitFor(() => expect(add).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByLabelText(/Add to preferred sellers/i)).toHaveProperty('value', ''))
    expect(screen.getAllByRole('radio')[2].getAttribute('aria-checked')).toBe('true')
  })

  it('is read-only without the policy capability', async () => {
    current = book(false)
    render(<EnterprisePriceBook />)
    await screen.findByText(/no prices of its own yet/)
    expect(screen.getAllByText(/Only somebody who can set your account's policy/).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: 'Save buying rules' })).toBeNull()
  })

  it('shows the charged price, not the agreed one, when the floor holds it up', async () => {
    current = { ...book(true), prices: [{
      id: 'P1', account_id: 'A1', product_id: 'p1', currency: 'INR', unit_price: 60,
      starts_on: '2020-01-01', ends_on: null, withdrawn_on: null,
    }] } as unknown as ReturnType<typeof book>
    products = [{ id: 'p1', name: 'Gauge', published: { INR: 100 }, floors: { INR: 80 } }]
    render(<EnterprisePriceBook />)
    await screen.findByText('held at floor')
    expect(screen.queryByText(/60/)).toBeNull()
    expect(screen.getAllByText(/80/).length).toBeGreaterThan(0)
  })
})
