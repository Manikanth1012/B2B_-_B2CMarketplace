/* A held order waits for the Risk screen, so the order register offers neither
   moving it on nor failing it (spec 17, decision 6; the database refuses both). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/MarketContext', () => ({
  useMarket: () => ({ fmtIn: (n: number, c: string) => `${c} ${n.toFixed(2)}` }),
}))
vi.mock('../../lib/riskRepo', () => ({ orderScores: async () => new Map() }))
const book = vi.hoisted(() => ({ value: null as unknown }))
vi.mock('../../lib/orderOpsRepo', () => ({
  loadOrderBook: async () => book.value,
  advance: vi.fn(), stepBack: vi.fn(), failOrder: vi.fn(), unfail: vi.fn(), setTracking: vi.fn(), removeOrder: vi.fn(),
}))
vi.mock('../../lib/bundleBasketRepo', () => ({ loadBundleInfo: async () => ({ ok: true, value: new Map() }) }))

import { OperatorOrders } from './OperatorOrders'

const order = (ref: string, status: string) => ({
  id: `O-${ref}`, order_ref: ref, status, total: 1500, subtotal: 1271.19, tax: 228.81, discount: 0,
  tax_rate: 18, currency: 'INR', market: 'IN', buyer_name: 'Priya Raman', buyer_email: 'priya@example.com',
  seller: 'Aventa Telecom', vertical: null, payment_method: 'card', payment_ref: 'PAY-1', tracking_ref: null,
  carrier: null, placed_date: '2026-11-12', created_at: '2026-11-12T10:00:00Z', failed: false, failed_reason: null,
  stage: 0, stages: ['Placed', 'Shipped', 'Delivered'], user_id: 'U-1', account_id: null, requisition_id: null,
  invoice_id: null, ordered_by: null, cost_centre: null, po_ref: null,
})
const line = (orderId: string) => ({
  id: `L-${orderId}`, order_id: orderId, product_id: 'SKU-1', product_name: 'Router', price: 1500, quantity: 1,
  fulfil: 'shipped', status: 'placed', bundle_selection_id: null,
})

afterEach(cleanup)

async function open(ref: string) {
  const user = userEvent.setup()
  render(<OperatorOrders />)
  await user.click(await screen.findByRole('button', { name: 'The whole book' }))
  const row = screen.getByText(ref).closest('tr')!
  await user.click(within(row).getByRole('button', { name: 'Open' }))
  return screen.findByRole('dialog')
}

describe('OperatorOrders, a held order', () => {
  const noMoves = (dialog: HTMLElement) => {
    for (const name of [/^Move to/, 'Cannot move on', 'Step back', 'Fail it', 'Reverse the failure']) {
      expect(within(dialog).queryByRole('button', { name }), `${name} is offered on a held order`).toBeNull()
    }
    expect(within(dialog).getByText(/Held for a fraud review\. Release it or cancel it on the Risk screen/)).toBeTruthy()
  }

  it('offers no move (on, back, fail), and says why', async () => {
    book.value = { orders: [{ ...order('ORD-H', 'held'), stage: 1 }], lines: [line('O-ORD-H')], pushes: [] }
    noMoves(await open('ORD-H'))
  })

  it('does not offer to reverse a failure on a held order either', async () => {
    book.value = {
      orders: [{ ...order('ORD-HF', 'held'), failed: true, failed_reason: 'Card declined' }],
      lines: [line('O-ORD-HF')], pushes: [],
    }
    noMoves(await open('ORD-HF'))
  })

  it('still offers them on an order that is not held', async () => {
    book.value = { orders: [{ ...order('ORD-P', 'placed'), stage: 1 }], lines: [line('O-ORD-P')], pushes: [] }
    const dialog = await open('ORD-P')
    expect(within(dialog).getByRole('button', { name: /^Move to/ })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Step back' })).toBeTruthy()
    expect(within(dialog).getByRole('button', { name: 'Fail it' })).toBeTruthy()
    expect(within(dialog).queryByText(/Held for a fraud review/)).toBeNull()
  })

  it('still offers to reverse a failure on an order that is not held', async () => {
    book.value = {
      orders: [{ ...order('ORD-F', 'failed'), failed: true, failed_reason: 'Card declined' }],
      lines: [line('O-ORD-F')], pushes: [],
    }
    const dialog = await open('ORD-F')
    expect(within(dialog).getByRole('button', { name: 'Reverse the failure' })).toBeTruthy()
  })
})
