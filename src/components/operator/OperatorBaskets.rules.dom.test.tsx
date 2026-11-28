import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
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
const rem = vi.hoisted(() => ({ settings: vi.fn(), log: vi.fn(), save: vi.fn(), remove: vi.fn() }))
vi.mock('../../lib/remindersRepo', () => ({
  loadBasketSettings: () => rem.settings(),
  loadScheduleLog: () => rem.log(),
  saveBasketSettings: (m: string, w: unknown) => rem.save(m, w),
  removeBasketSettings: (m: string) => rem.remove(m),
}))

import { OperatorBaskets } from './OperatorBaskets'

const ago = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()
const line = { id: 'L-1', product_id: 'SKU-1', name: 'Gateway', quantity: 2, unit_price: 1000, stock_note: null,
  was_quantity: null, bundle_selection_id: null }
const DATA = {
  business: [
    { id: 'B-1', user_id: 'U-1', owner: 'Vikram Rao', email: 'v@acme.test', account: 'Acme', currency: 'INR',
      updated_at: ago(1), reminded_at: null, lines: [line] },
    { id: 'B-2', user_id: 'U-2', owner: 'Meera Iyer', email: 'm@acme.test', account: 'Acme', currency: 'INR',
      updated_at: ago(9), reminded_at: null, lines: [{ ...line, id: 'L-2' }] },
  ],
  cartLines: [{ ...line, id: 'C-1', name: 'Router', user_id: 'S-1', saved: false, updated_at: ago(2), created_at: ago(2) }],
  shoppers: new Map([['S-1', { name: 'Priya Raman', email: 'p@example.com', currency: 'INR' }]]),
  cartReminders: new Map(),
}
const row = (market: string, p = 7, a = 7, c = 90) => ({
  market, pending_days: p, abandoned_after_days: a, clear_after_days: c, updated_at: null, updated_by: null,
})

beforeEach(() => {
  repo.load.mockResolvedValue({ ok: true, value: DATA })
  rem.settings.mockResolvedValue({ ok: true, value: [row('default'), row('IN', 7, 7, 60)] })
  rem.log.mockResolvedValue({ ok: true, value: [] })
  rem.save.mockImplementation(async (m: string, w: { pending_days: number }) => ({ ok: true, value: row(m, w.pending_days) }))
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

const num = (name: RegExp | string) => screen.getByRole('spinbutton', { name })

describe('Baskets: rules from settings', () => {
  it('reads the description from the default row and says some markets differ', async () => {
    render(<OperatorBaskets />)
    expect(await screen.findByText(/Pending: changed in the last 7 days\. Abandoned: left for 7 days or more\. Baskets untouched for 90 days are cleared/)).toBeTruthy()
    expect(screen.getByText(/some markets have their own/)).toBeTruthy()
  })

  it('refuses invalid rules, says the effect before saving, and saves', async () => {
    const user = userEvent.setup()
    render(<OperatorBaskets />)
    await user.click(await screen.findByRole('button', { name: 'Basket rules' }))
    const drawer = screen.getByRole('dialog', { name: 'Basket rules' })
    expect(within(drawer).getByText(/Pending is display only/)).toBeTruthy()

    /* Clear after not above abandoned after: refused, and Save is off. */
    fireEvent.change(num('Default clear after days'), { target: { value: '7' } })
    expect((await within(drawer).findByRole('alert')).textContent).toMatch(/Default: .*cleared only after it is abandoned/)
    expect((screen.getByRole('button', { name: 'Save rules' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(num('Default pending days'), { target: { value: '2' } })
    fireEvent.change(num('Default abandoned after days'), { target: { value: '2' } })
    fireEvent.change(num('Default clear after days'), { target: { value: '8' } })
    expect(screen.getByTestId('basket-rules-effect').textContent).toBe('1 basket becomes abandoned, 1 would be cleared tonight')

    await user.click(screen.getByRole('button', { name: 'Save rules' }))
    expect(rem.save).toHaveBeenCalledWith('default', { pending_days: 2, abandoned_after_days: 2, clear_after_days: 8 })
    expect(rem.save).toHaveBeenCalledTimes(1)
  })

  it('shows a scheduled reminder as the last reminder', async () => {
    rem.log.mockResolvedValue({ ok: true, value: [{ subject_id: 'B-1', outcome: 'sent', created_at: ago(0.2) }] })
    render(<OperatorBaskets />)
    const vikram = (await screen.findByText('Vikram Rao')).closest('tr')!
    await vi.waitFor(() => expect(within(vikram).queryByText('Never')).toBeNull())
    expect(within(screen.getByText('Meera Iyer').closest('tr')!).getByText('Never')).toBeTruthy()
  })

  it('says scheduled reminders arrive with the migration, and the page keeps working', async () => {
    rem.settings.mockResolvedValue({ ok: false, missing: true, error: 'does not exist' })
    rem.log.mockResolvedValue({ ok: false, missing: true, error: 'does not exist' })
    render(<OperatorBaskets />)
    expect(await screen.findByText(/Scheduled reminders arrive with migration 20261127400000/)).toBeTruthy()
    expect(screen.getByText('Vikram Rao')).toBeTruthy()
    expect(screen.getByText(/Pending: changed in the last 7 days/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Basket rules' })).toBeNull()
  })
})
