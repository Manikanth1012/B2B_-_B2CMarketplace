/* A line the marketplace's stock flag caught: its note, Accept and Remove, and Raise held until it is dealt with. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Basket, BasketLine } from '../../lib/requisitionBasket'
import type { AccountBook } from '../../lib/enterpriseRepo'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const repo = vi.hoisted(() => ({ book: null as unknown as AccountBook, raise: vi.fn() }))
vi.mock('../../lib/enterpriseRepo', () => ({
  loadAccount: () => Promise.resolve(repo.book),
  raiseRequisition: (args: unknown) => repo.raise(args),
}))
vi.mock('../../lib/priceBookRepo', () => ({
  loadAccountPrices: () => Promise.resolve({ ok: true, value: [] }),
  loadBuyingRules: () => Promise.resolve({ ok: true, value: { account_id: 'ENT-1', off_contract: 'allow', note: null, updated_by: null, updated_on: null } }),
  loadPublishedPrices: () => Promise.resolve({ ok: true, value: new Map() }),
}))
vi.mock('../../lib/MarketContext', () => ({
  useMarket: () => ({ fmtIn: (n: number, c: string) => `${c} ${n.toFixed(2)}`, book: null }),
}))

const ctx = vi.hoisted(() => ({
  basket: null as unknown, setOpen: () => {},
  accept: vi.fn(), remove: vi.fn(), removeBundle: vi.fn(), sync: vi.fn(),
}))
vi.mock('../../lib/RequisitionContext', () => ({
  useRequisition: () => {
    const basket = ctx.basket as Basket
    return {
      basket, open: true, setOpen: ctx.setOpen,
      setQuantity: () => ({ ok: true }), remove: ctx.remove, removeBundle: ctx.removeBundle,
      setReason: () => ({ ok: true }), applyChanges: () => {}, empty: () => {},
      total: basket.lines.reduce((n, l) => n + l.quantity * l.unit_price, 0),
      count: basket.lines.reduce((n, l) => n + l.quantity, 0),
      restored: null, dismissRestored: () => {}, keepError: null,
      sync: ctx.sync, acceptFlag: ctx.accept, raised: () => Promise.resolve(),
    }
  },
}))

import { RequisitionPanel } from './RequisitionPanel'

const BOOK = {
  account: {
    id: 'ENT-1', company: 'Acme', legal_name: 'Acme Ltd', segment: 'mid', industry: 'x', sites: 1, staff: 1,
    terms: 'net 30', currency: 'INR', market: 'IN', fy_starts: '2026-04-01', budget_year: 1e7,
    reg_type: 'x', registration: null, place_of_supply: 'x', po_required: false, reverse_charge: false,
    cost_centre_on_invoice: false, tax_exempt: false, exempt_cert: null, status: 'active',
  },
  me: {
    id: 'EU-1', account_id: 'ENT-1', user_id: null, name: 'V', email: 'v@x', title: 'Lead', role: 'procurement-lead',
    can_raise: true, approves_finance: true, approves_it: false, approve_limit: null, cost_centre: null,
    phone: null, mfa: false, status: 'active', sort_order: 0,
  },
  policy: {
    account_id: 'ENT-1', threshold: 400000, security_signoff: true, duplicate_flag: false,
    auto_approve_renewals: false, self_approve: false, note: '', updated_by: null, updated_on: null,
  },
  centres: [{ id: 'CC-1', name: 'Ops' }], currencies: ['INR'], rates: [], prices: [],
  rules: { account_id: 'ENT-1', off_contract: 'allow', note: null, updated_by: null, updated_on: null },
  preferences: [],
} as unknown as AccountBook

const line = (over: Partial<BasketLine>): BasketLine => ({
  product_id: 'SKU-1', name: 'Gateway', seller: 'Nimbus', partner_id: 'P-1', quantity: 3, unit_price: 1000,
  model: 'oneoff', vertical: 'iot', unit: null, on_contract: true, ...over,
})

function Harness({ lines }: { lines: BasketLine[] }) {
  const [basket] = useState<Basket>({ currency: 'INR', lines })
  ctx.basket = basket
  return <RequisitionPanel onRaised={() => {}} />
}

beforeEach(() => {
  repo.book = BOOK
  repo.raise.mockReset()
  ctx.accept.mockReset()
  ctx.remove.mockReset()
  ctx.removeBundle.mockReset()
  ctx.sync.mockReset()
  ctx.sync.mockImplementation(() => Promise.resolve(ctx.basket))
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

describe('RequisitionPanel with a stock flag', () => {
  it('shows the note with Accept and Remove, and holds Raise with a sentence', async () => {
    ctx.accept.mockResolvedValue({ ok: true })
    render(<Harness lines={[line({ id: 'L-1', stock_note: 'Only 3 left — we reduced this from 5', was_quantity: 5 })]} />)
    expect(await screen.findByText(/Only 3 left — we reduced this from 5/)).toBeTruthy()
    expect(screen.getByText('1 line changed because stock ran out. Accept or remove it before you raise this requisition.')).toBeTruthy()
    const raise = screen.getByRole('button', { name: /Raise/ }) as HTMLButtonElement
    await vi.waitFor(() => expect(raise.disabled).toBe(true))

    await userEvent.click(screen.getByRole('button', { name: 'Accept the change to Gateway' }))
    expect(ctx.accept).toHaveBeenCalledWith('L-1')
    await userEvent.click(screen.getByRole('button', { name: 'Remove Gateway from the requisition' }))
    expect(ctx.remove).toHaveBeenCalledWith('SKU-1')
    expect(repo.raise).not.toHaveBeenCalled()
  })

  it('says why an Accept was refused, under the line', async () => {
    ctx.accept.mockResolvedValue({ ok: false, reason: 'Gateway has less left than this line asks for (Only 1 left). Remove it, or lower the quantity.' })
    render(<Harness lines={[line({ id: 'L-1', stock_note: 'Only 3 left — we reduced this from 5', was_quantity: 5 })]} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Accept the change to Gateway' }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/has less left than this line asks for/)
  })

  it('a line no longer available offers only Remove', async () => {
    render(<Harness lines={[line({ id: 'L-1', stock_note: 'No longer available' })]} />)
    expect(await screen.findByText(/No longer available/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Accept/ })).toBeNull()
    expect(screen.getByRole('button', { name: 'Remove Gateway from the requisition' })).toBeTruthy()
  })

  it('a bundle with a flagged part is blocked whole, with Remove bundle', async () => {
    const bundle = { templateId: 'T-1', name: 'Office kit', choices: {}, quantity: 1, currency: 'INR', validUntil: '2099-01-01', total: 3000 }
    render(<Harness lines={[
      line({ id: 'L-1', product_id: 'SKU-1', bundle_selection_id: 'BS-1', bundle, on_contract: undefined }),
      line({ id: 'L-2', product_id: 'SKU-2', name: 'Desk phone', bundle_selection_id: 'BS-1', bundle, on_contract: undefined,
        stock_note: 'Only 1 left — this bundle needs 3' }),
    ]} />)
    const group = await screen.findByRole('group', { name: 'Bundle: Office kit' })
    expect(within(group).getByText(/Desk phone: Only 1 left — this bundle needs 3\. Office kit cannot be bought as it is/)).toBeTruthy()
    await userEvent.click(within(group).getByRole('button', { name: 'Remove bundle Office kit' }))
    expect(ctx.removeBundle).toHaveBeenCalledWith('BS-1')
    expect((screen.getByRole('button', { name: /Raise/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('a flag that arrives on the re-read before Raise stops it', async () => {
    render(<Harness lines={[line({ id: 'L-1' })]} />)
    await userEvent.type(await screen.findByLabelText('What is it for'), 'Depot')
    await userEvent.type(screen.getByLabelText('Why it is needed'), 'Opening')
    await userEvent.selectOptions(screen.getByLabelText('Cost centre'), 'CC-1')
    ctx.sync.mockResolvedValue({ currency: 'INR', lines: [line({ id: 'L-1', stock_note: 'No longer available' })] })
    await userEvent.click(screen.getByRole('button', { name: /Raise/ }))
    expect(ctx.sync).toHaveBeenCalled()
    expect(repo.raise).not.toHaveBeenCalled()
  })
})
