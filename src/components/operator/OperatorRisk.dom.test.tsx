import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/MarketContext', () => ({
  useMarket: () => ({ fmtIn: (n: number, c: string) => `${c} ${n.toFixed(2)}` }),
}))
const repo = vi.hoisted(() => ({
  load: vi.fn(), decide: vi.fn(), update: vi.fn(), bands: vi.fn(), rescore: vi.fn(),
}))
vi.mock('../../lib/riskRepo', () => ({
  loadRiskBook: () => repo.load(),
  decideHeldOrder: (ref: string, d: string, n: string) => repo.decide(ref, d, n),
  updateRiskRule: (id: string, e: unknown) => repo.update(id, e),
  setRiskBands: (k: string, b: unknown) => repo.bands(k, b),
  rescoreAccounts: () => repo.rescore(),
}))

import { OperatorRisk } from './OperatorRisk'

const BOOK = () => ({
  held: [{
    order_ref: 'ORD-1001', buyer: 'Priya Raman', total: 2500, currency: 'INR', score: 80, band: 'hold' as const,
    reasons: [{ rule: 'new-account', label: 'New account', points: 20 }, { rule: 'big', label: 'Large order', points: 60 }],
    scored_at: '2026-11-13T08:00:00Z',
  }],
  flagged: [{
    order_ref: 'ORD-0900', buyer: 'Dev Patel', total: 900, currency: 'INR', score: 85, band: 'hold' as const,
    reasons: [{ rule: 'big', label: 'Large order', points: 60 }], scored_at: '2026-11-10T08:00:00Z',
    status: 'cancelled', decision: 'cancelled', decided_by: 'Anika Sharma', decided_at: '2026-11-10T09:00:00Z',
    note: 'Card holder could not be reached',
  }],
  accounts: [
    { kind: 'shopper' as const, id: 'u1', name: 'Asha', score: 45, band: 'review' as const, reasons: [], scored_at: '2026-11-13T00:30:00Z' },
    { kind: 'business' as const, id: 'ENT-1', name: 'Acme Logistics', score: 75, band: 'high' as const, reasons: [], scored_at: '2026-11-13T00:30:00Z' },
  ],
  rules: [
    { id: 'big', applies: 'order' as const, label: 'Large order', points: 60, enabled: true, threshold: 10000, unit: 'INR', sort_order: 1 },
    { id: 'new-account', applies: 'order' as const, label: 'New account', points: 20, enabled: true, threshold: null, unit: null, sort_order: 2 },
  ],
  bands: { order: { review_at: 40, hold_at: 70 }, account: { review_at: 40, hold_at: 70 } },
  changes: [],
})

beforeEach(() => { Object.values(repo).forEach(f => f.mockReset()) })
afterEach(cleanup)

describe('OperatorRisk', () => {
  it('releases a held order through the repo, with a note, and the row leaves the list', async () => {
    repo.load.mockResolvedValue({ ok: true, value: BOOK() })
    repo.decide.mockResolvedValue({ ok: true, value: {} })
    const user = userEvent.setup()
    render(<OperatorRisk />)
    const row = (await screen.findByText('ORD-1001', { selector: 'strong' })).closest('tr')!
    expect(within(row).getByText('Large order +60 · New account +20')).toBeTruthy()
    expect(within(row).getByText('INR 2500.00')).toBeTruthy()
    await user.click(within(row).getByRole('button', { name: /Release/ }))
    await user.type(screen.getByLabelText(/Note/), 'Spoke to the buyer')
    await user.click(screen.getByRole('button', { name: 'Release order' }))
    expect(repo.decide).toHaveBeenCalledWith('ORD-1001', 'release', 'Spoke to the buyer')
    expect((await screen.findByRole('status')).textContent).toMatch(/ORD-1001 was released/)
    expect(screen.queryByText('Priya Raman')).toBeNull()
  })

  it('keeps a decided hold visible with its decision, who, when and the note', async () => {
    repo.load.mockResolvedValue({ ok: true, value: BOOK() })
    const user = userEvent.setup()
    render(<OperatorRisk />)
    await user.click(await screen.findByRole('tab', { name: /Flagged/ }))
    const row = screen.getByText('ORD-0900').closest('tr')!
    expect(within(row).getByText('Cancelled and refunded')).toBeTruthy()
    expect(within(row).getByText(/Anika Sharma/)).toBeTruthy()
    expect(within(row).getByText('Card holder could not be reached')).toBeTruthy()
    expect(within(row).getByText('Large order +60')).toBeTruthy()
    expect(within(row).getByText('85')).toBeTruthy()
  })

  it('needs a note, and says the cancel note is shown to the buyer and seller', async () => {
    repo.load.mockResolvedValue({ ok: true, value: BOOK() })
    const user = userEvent.setup()
    render(<OperatorRisk />)
    await user.click(await screen.findByRole('button', { name: /Cancel and refund/ }))
    expect(screen.getByText(/shown to the buyer and the seller/)).toBeTruthy()
    await user.click(screen.getAllByRole('button', { name: 'Cancel and refund' }).pop()!)
    expect((await screen.findByRole('alert')).textContent).toMatch(/needs a note/)
    expect(repo.decide).not.toHaveBeenCalled()
  })

  it('shows the database refusal and keeps the row', async () => {
    repo.load.mockResolvedValue({ ok: true, value: BOOK() })
    repo.decide.mockResolvedValue({ ok: false, missing: false, error: 'ORD-1001 is not held (it is placed), so there is nothing to decide.' })
    const user = userEvent.setup()
    render(<OperatorRisk />)
    await user.click(await screen.findByRole('button', { name: /Release/ }))
    await user.type(screen.getByLabelText(/Note/), 'ok')
    await user.click(screen.getByRole('button', { name: 'Release order' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/is not held/)
    expect(screen.getByText('Priya Raman')).toBeTruthy()
  })

  it('refuses a rule edit that ruleEditProblem rejects, without calling the repo', async () => {
    repo.load.mockResolvedValue({ ok: true, value: BOOK() })
    const user = userEvent.setup()
    render(<OperatorRisk />)
    await user.click(await screen.findByRole('tab', { name: /Rules/ }))
    const points = screen.getByLabelText('Points for Large order')
    await user.clear(points)
    await user.type(points, '150')
    await user.click(screen.getByRole('button', { name: /Save Large order/ }))
    expect((await screen.findByRole('alert')).textContent).toBe('Points must be between −50 and 100.')
    expect(repo.update).not.toHaveBeenCalled()
  })

  it('saves a valid rule edit and a bad bands pair is refused', async () => {
    repo.load.mockResolvedValue({ ok: true, value: BOOK() })
    repo.update.mockResolvedValue({ ok: true, value: {} })
    const user = userEvent.setup()
    render(<OperatorRisk />)
    await user.click(await screen.findByRole('tab', { name: /Rules/ }))
    const points = screen.getByLabelText('Points for New account')
    await user.clear(points)
    await user.type(points, '25')
    await user.click(screen.getByRole('button', { name: /Save New account/ }))
    expect(repo.update).toHaveBeenCalledWith('new-account', { points: 25, enabled: true, threshold: null })

    const form = screen.getByRole('form', { name: 'Order bands' })
    const hold = within(form).getByLabelText('Order Hold from')
    await user.clear(hold)
    await user.type(hold, '30')
    await user.click(within(form).getByRole('button', { name: /Save order bands/ }))
    expect(within(form).getByRole('alert').textContent).toMatch(/review threshold must be below/)
    expect(repo.bands).not.toHaveBeenCalled()
  })

  it('lists accounts by score, filters by band, and rescores', async () => {
    repo.load.mockResolvedValue({ ok: true, value: BOOK() })
    repo.rescore.mockResolvedValue({ ok: true, value: { scored: 2, review: 1, high: 1 } })
    const user = userEvent.setup()
    render(<OperatorRisk />)
    await user.click(await screen.findByRole('tab', { name: /Accounts/ }))
    const names = screen.getAllByRole('row').slice(1).map(r => r.textContent ?? '')
    expect(names[0]).toMatch(/Acme Logistics/)
    await user.click(screen.getByRole('button', { name: /^Review \(1\)/ }))
    expect(screen.queryByText('Acme Logistics')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Rescore now' }))
    expect(repo.rescore).toHaveBeenCalled()
    expect((await screen.findByRole('status')).textContent).toMatch(/2 accounts scored, 1 to review, 1 high/)
    expect(screen.getByRole('status').textContent).not.toMatch(/could not be scored/)
  })

  it('says how many accounts a rescore could not score', async () => {
    repo.load.mockResolvedValue({ ok: true, value: BOOK() })
    repo.rescore.mockResolvedValue({ ok: true, value: { scored: 2, review: 1, high: 1, failed: 1 } })
    const user = userEvent.setup()
    render(<OperatorRisk />)
    await user.click(await screen.findByRole('tab', { name: /Accounts/ }))
    await user.click(screen.getByRole('button', { name: 'Rescore now' }))
    expect((await screen.findByRole('status')).textContent)
      .toMatch(/2 accounts scored, 1 to review, 1 high\. 1 could not be scored and keep their last score\./)
  })

  it('says it is not set up yet before the migration', async () => {
    repo.load.mockResolvedValue({ ok: false, missing: true, error: 'relation "public.order_risk" does not exist' })
    render(<OperatorRisk />)
    expect(await screen.findByText('Risk scoring is not set up yet')).toBeTruthy()
    expect(screen.queryByRole('tablist')).toBeNull()
  })
})
