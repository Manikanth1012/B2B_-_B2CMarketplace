/* The operator's order views group a configured bundle's parts under its name
   (spec 11, decision 11). Each part keeps its own row and price. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/MarketContext', () => ({
  useMarket: () => ({ fmtIn: (n: number, c: string) => `${c} ${n.toFixed(2)}` }),
}))
const book = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('../../lib/orderOpsRepo', () => ({
  loadOrderBook: async () => book.value,
  advance: vi.fn(), stepBack: vi.fn(), failOrder: vi.fn(), unfail: vi.fn(), setTracking: vi.fn(), removeOrder: vi.fn(),
}))
vi.mock('../../lib/bundleBasketRepo', () => ({
  loadBundleInfo: async (ids: string[]) => ({
    ok: true,
    value: new Map(ids.map(id => [id, { name: 'Home office', selection: { id }, lines: [] }])),
  }),
}))

import { OperatorOrders } from './OperatorOrders'

const order = {
  id: 'O-1', order_ref: 'ORD-77', status: 'placed', total: 1500, subtotal: 1271.19, tax: 228.81, discount: 0,
  tax_rate: 18, currency: 'INR', market: 'IN', buyer_name: 'Priya Raman', buyer_email: 'priya@example.com',
  seller: 'Aventa Telecom', vertical: null, payment_method: 'card', payment_ref: 'PAY-1', tracking_ref: null,
  carrier: null, placed_date: '2026-11-12', created_at: '2026-11-12T10:00:00Z', failed: false, failed_reason: null,
  stage: 0, stages: ['Placed', 'Shipped', 'Delivered'], user_id: 'U-1', account_id: null, requisition_id: null,
  invoice_id: null, ordered_by: null, cost_centre: null, po_ref: null,
}
const line = (id: string, name: string, price: number, bundle: string | null) => ({
  id, order_id: 'O-1', product_id: `SKU-${id}`, product_name: name, price, quantity: 1, fulfil: 'shipped',
  status: 'placed', bundle_selection_id: bundle,
})

afterEach(cleanup)

describe('OperatorOrders, bundles', () => {
  it("groups a bundle's parts under its name in the book and in the order", async () => {
    book.value = {
      orders: [order],
      lines: [line('1', 'Router', 800, 'BS-1'), line('2', 'Cable', 200, null), line('3', 'eSIM plan', 500, 'BS-1')],
      pushes: [],
    }
    const user = userEvent.setup()
    render(<OperatorOrders />)
    await user.click(await screen.findByRole('button', { name: 'The whole book' }))

    const row = screen.getByText('ORD-77').closest('tr')!
    expect(await within(row).findByText('Bundle: Home office (Router, eSIM plan), Cable')).toBeTruthy()

    await user.click(within(row).getByRole('button', { name: 'Open' }))
    const dialog = await screen.findByRole('dialog')
    const head = (await within(dialog).findByText('Bundle: Home office')).closest('tr')!
    /* The bundle's two parts together: 800 + 500. */
    expect(within(head).getByText('INR 1300.00')).toBeTruthy()

    const rows = within(dialog).getAllByRole('row').map(r => r.textContent ?? '')
    const at = (s: string) => rows.findIndex(t => t.includes(s))
    expect(at('Bundle: Home office')).toBeLessThan(at('Router'))
    expect(at('Router')).toBeLessThan(at('eSIM plan'))
    /* Per part, unchanged: each part still shows its own price. */
    expect(within(dialog).getByText('INR 800.00')).toBeTruthy()
    expect(within(dialog).getByText('INR 500.00')).toBeTruthy()
    expect(within(dialog).getByText('Router').closest('tr')!.className).toBe('bundle-row-part')
    expect(within(dialog).getByText('Cable').closest('tr')!.className).toBe('')
  })
})
