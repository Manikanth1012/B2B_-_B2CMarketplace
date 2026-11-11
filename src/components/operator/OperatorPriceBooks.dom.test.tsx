import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { AccountPrice } from '../../lib/accountPrices'

/* Each account's reads are held until the test lets them go, so the order they answer in is chosen here. */
const gates = vi.hoisted(() => new Map<string, (v: unknown) => void>())
const hold = (key: string, value: unknown) => new Promise(res => gates.set(key, () => res(value)))

const row = (account_id: string, id: string): AccountPrice => ({
  id, account_id, product_id: 'SKU-4006', currency: 'INR', unit_price: 21999, starts_on: '2026-01-01', ends_on: null,
  source: 'negotiated', quote_line_id: null, quote_ref: null, note: null, set_by: 'x', set_at: '2026-01-01',
  ended_by: null, ended_at: null, end_reason: null,
})

vi.mock('../../lib/accountsRepo', () => ({
  loadAccountBook: async () => ({
    accounts: [
      { id: 'ENT-1', company: 'SmartBuild Ltd', market: 'IN', currency: 'INR', segment: '', status: 'active', terms: '' },
      { id: 'ENT-2', company: 'Acme Corp', market: 'IN', currency: 'INR', segment: '', status: 'active', terms: '' },
    ],
    steps: [], credit: [], shoppers: [], waiting: 0, waitingApps: [],
  }),
}))
vi.mock('../../lib/priceBookRepo', () => ({
  loadAccountPrices: (id: string) => hold(id, { ok: true, value: [row(id, id === 'ENT-1' ? 'AP-SMART' : 'AP-ACME')] }),
  loadPromotable: async () => ({ ok: true, value: [] }),
  loadProductsByIds: async () => ({ ok: true, value: [{ id: 'SKU-4006', name: 'Edge Gateway', published: {} }] }),
  setAccountPrice: vi.fn(), endAccountPrice: vi.fn(), promoteQuoteLine: vi.fn(),
}))
vi.mock('../../lib/moneyRepo', () => ({
  loadPriceBook: async () => new Map([['SKU-4006', { product_id: 'SKU-4006', currency: 'INR', price: 23999, was_price: null, floor_price: 22999, list_price: null }]]),
  loadProductPrices: async () => [],
}))
vi.mock('../../lib/enterpriseRepo', () => ({ loadEnterpriseCatalogue: async () => [] }))
vi.mock('../../lib/MarketContext', () => ({
  useMarket: () => ({ book: { currencies: [], accepted: [{ market_code: 'IN', currency: 'INR', is_default: true, sort_order: 1 }] }, fmtIn: () => 'CONVERTED' }),
}))

import { OperatorPriceBooks } from './OperatorPriceBooks'

afterEach(() => { cleanup(); gates.clear() })

describe('OperatorPriceBooks', () => {
  it('a late answer for the account picked before never fills the table of the one shown', async () => {
    render(<OperatorPriceBooks />)
    const pick = await screen.findByLabelText('Account')
    await screen.findByRole('option', { name: /SmartBuild Ltd/ })
    fireEvent.change(pick, { target: { value: 'ENT-1' } })
    fireEvent.change(pick, { target: { value: 'ENT-2' } })
    await act(async () => { gates.get('ENT-2')?.(undefined) })
    expect(await screen.findByText(/AP-ACME/)).toBeTruthy()
    await act(async () => { gates.get('ENT-1')?.(undefined) })
    expect(screen.queryByText(/AP-SMART/)).toBeNull()
    expect(screen.getByText("Acme Corp's price book")).toBeTruthy()
  })

  it('shows the charged figure held at the floor, in the price\'s own money', async () => {
    render(<OperatorPriceBooks />)
    const pick = await screen.findByLabelText('Account')
    await screen.findByRole('option', { name: /SmartBuild Ltd/ })
    fireEvent.change(pick, { target: { value: 'ENT-1' } })
    await act(async () => { gates.get('ENT-1')?.(undefined) })
    expect(await screen.findByText('held at floor')).toBeTruthy()
    expect(screen.queryByText(/CONVERTED/)).toBeNull()
  })
})
