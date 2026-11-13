import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/MarketContext', () => ({
  useMarket: () => ({ fmtIn: (n: number, c: string) => `${c} ${n.toFixed(2)}` }),
}))
const repo = vi.hoisted(() => ({ load: vi.fn(), remind: vi.fn() }))
vi.mock('../../lib/basketRepo', () => ({
  loadWatchedBaskets: () => repo.load(),
  remindBasketOwner: (kind: string, id: string) => repo.remind(kind, id),
}))

import { OperatorBaskets } from './OperatorBaskets'

const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
const line = (over: Record<string, unknown> = {}) => ({
  id: 'L-1', product_id: 'SKU-1', name: 'Gateway', quantity: 2, unit_price: 1000, stock_note: null,
  was_quantity: null, bundle_selection_id: null, ...over,
})

const DATA = {
  business: [
    { id: 'B-1', user_id: 'U-1', owner: 'Vikram Rao', email: 'vikram@acme.test', account: 'Acme Logistics', currency: 'INR',
      updated_at: ago(1), reminded_at: null, lines: [line()] },
    { id: 'B-2', user_id: 'U-2', owner: 'Meera Iyer', email: 'meera@acme.test', account: 'Acme Logistics', currency: 'INR',
      updated_at: ago(9), reminded_at: ago(0.5),
      lines: [line({ id: 'L-2', name: 'Sensor', stock_note: 'Only 3 left — we reduced this from 5', quantity: 3 })] },
  ],
  cartLines: [
    { ...line({ id: 'C-1', name: 'Router' }), user_id: 'S-1', saved: false, updated_at: ago(2), created_at: ago(2) },
  ],
  shoppers: new Map([['S-1', { name: 'Priya Raman', email: 'priya@example.com', currency: 'INR' }]]),
  cartReminders: new Map(),
}

beforeEach(() => {
  repo.load.mockReset()
  repo.remind.mockReset()
})
afterEach(cleanup)

describe('OperatorBaskets', () => {
  it('lists business baskets as Pending and Abandoned, and filters by state', async () => {
    repo.load.mockResolvedValue({ ok: true, value: DATA })
    const user = userEvent.setup()
    render(<OperatorBaskets />)
    const vikram = (await screen.findByText('Vikram Rao')).closest('tr')!
    expect(within(vikram).getByText('Pending')).toBeTruthy()
    expect(within(vikram).getByText(/vikram@acme\.test · Acme Logistics/)).toBeTruthy()
    expect(within(vikram).getByText('INR 2000.00')).toBeTruthy()
    const meera = screen.getByText('Meera Iyer').closest('tr')!
    expect(within(meera).getByText('Abandoned')).toBeTruthy()
    /* Lines 1, stock flags 1 (Vikram's reads None). */
    expect(within(meera).getAllByText('1')).toHaveLength(2)
    expect(within(vikram).getByText('None')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Abandoned (1)' }))
    expect(screen.queryByText('Vikram Rao')).toBeNull()
    expect(screen.getByText('Meera Iyer')).toBeTruthy()

    await user.click(screen.getByRole('tab', { name: /Shoppers/ }))
    await user.click(screen.getByRole('button', { name: 'All (1)' }))
    expect(screen.getByText('Priya Raman')).toBeTruthy()
  })

  it('opens a basket to its lines and notes, and says why a reminder was refused', async () => {
    repo.load.mockResolvedValue({ ok: true, value: DATA })
    repo.remind.mockResolvedValue({
      ok: false, missing: false,
      error: 'A reminder went on 13 Nov 2026 01:00 UTC. One a day at most: the next can go after 14 Nov 2026 01:00 UTC.',
    })
    const user = userEvent.setup()
    render(<OperatorBaskets />)
    await user.click(await screen.findByRole('button', { name: /Open Meera Iyer/ }))
    expect(screen.getByText('Only 3 left — we reduced this from 5')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Send reminder' }))
    expect(repo.remind).toHaveBeenCalledWith('requisition', 'B-2')
    expect((await screen.findByRole('alert')).textContent).toMatch(/Not sent: A reminder went on 13 Nov 2026/)
  })

  it('says a sent reminder, and shoppers are reminded by user id', async () => {
    repo.load.mockResolvedValue({ ok: true, value: DATA })
    repo.remind.mockResolvedValue({ ok: true, value: { reminded_at: new Date().toISOString(), lines: 1 } })
    const user = userEvent.setup()
    render(<OperatorBaskets />)
    await user.click(await screen.findByRole('tab', { name: /Shoppers/ }))
    await user.click(screen.getByRole('button', { name: /Open Priya Raman/ }))
    await user.click(screen.getByRole('button', { name: 'Send reminder' }))
    expect(repo.remind).toHaveBeenCalledWith('cart', 'S-1')
    expect((await screen.findByRole('status')).textContent).toMatch(/Reminder sent to Priya Raman about 1 item/)
  })

  it('says it is not set up yet before the migration', async () => {
    repo.load.mockResolvedValue({ ok: false, missing: true, error: 'relation "public.requisition_baskets" does not exist' })
    render(<OperatorBaskets />)
    expect(await screen.findByText('Baskets are not set up yet')).toBeTruthy()
    expect(screen.getByText(/kept only in the page they have open/)).toBeTruthy()
    expect(screen.queryByText(/browser/)).toBeNull()
    expect(screen.queryByRole('table')).toBeNull()
  })
})
