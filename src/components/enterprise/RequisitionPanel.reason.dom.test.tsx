import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Basket } from '../../lib/requisitionBasket'
import { setReason as setLineReason } from '../../lib/requisitionBasket'
import type { AccountBook } from '../../lib/enterpriseRepo'
import type { OffContractRule } from '../../lib/accountPrices'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const repo = vi.hoisted(() => ({
  book: null as unknown as AccountBook,
  raise: vi.fn(),
}))
vi.mock('../../lib/enterpriseRepo', () => ({
  loadAccount: () => Promise.resolve(repo.book),
  raiseRequisition: (args: unknown) => repo.raise(args),
}))
vi.mock('../../lib/MarketContext', () => ({
  useMarket: () => ({ fmtIn: (n: number, c: string) => `${c} ${n.toFixed(2)}`, book: null }),
}))

/* Stable, as the real context's is: the drawer refocuses itself whenever setOpen changes. */
const ctx = vi.hoisted(() => ({ basket: null as unknown, setBasket: null as unknown, setOpen: () => {} }))
vi.mock('../../lib/RequisitionContext', () => ({
  useRequisition: () => {
    const basket = ctx.basket as Basket
    const setBasket = ctx.setBasket as (b: Basket) => void
    return {
      basket, open: true, setOpen: ctx.setOpen,
      setQuantity: () => ({ ok: true, basket }), remove: () => {}, removeBundle: () => {},
      setReason: (id: string, reason: string) => {
        const r = setLineReason(basket, id, reason)
        if (r.ok) setBasket(r.basket)
        return r
      },
      empty: () => {}, total: basket.lines.reduce((n, l) => n + l.quantity * l.unit_price, 0),
      count: basket.lines.reduce((n, l) => n + l.quantity, 0),
    }
  },
}))

import { RequisitionPanel } from './RequisitionPanel'

const ACCOUNT = {
  id: 'ENT-1', company: 'Acme', legal_name: 'Acme Ltd', segment: 'mid', industry: 'x', sites: 1, staff: 1,
  terms: 'net 30', currency: 'INR', market: 'IN', fy_starts: '2026-04-01', budget_year: 1e7,
  reg_type: 'x', registration: null, place_of_supply: 'x', po_required: false, reverse_charge: false,
  cost_centre_on_invoice: false, tax_exempt: false, exempt_cert: null, status: 'active',
}
const POLICY = {
  account_id: 'ENT-1', threshold: 400000, security_signoff: true, duplicate_flag: false,
  auto_approve_renewals: false, self_approve: false, note: '', updated_by: null, updated_on: null,
}
const ME = {
  id: 'EU-1', account_id: 'ENT-1', user_id: null, name: 'V', email: 'v@x', title: 'Lead', role: 'procurement-lead',
  can_raise: true, approves_finance: true, approves_it: false, approve_limit: null, cost_centre: null,
  phone: null, mfa: false, status: 'active', sort_order: 0,
}

function bookWith(rule: OffContractRule): AccountBook {
  return {
    account: ACCOUNT, me: ME, policy: POLICY, centres: [{ id: 'CC-1', name: 'Ops' }],
    currencies: ['INR'], rates: [], prices: [],
    rules: { account_id: 'ENT-1', off_contract: rule, note: null, updated_by: null, updated_on: null },
    preferences: [],
  } as unknown as AccountBook
}

const LINE = {
  product_id: 'SKU-9001', name: 'Gateway', seller: 'Nimbus', partner_id: 'P-1', quantity: 2, unit_price: 1000,
  model: 'oneoff' as const, vertical: 'iot', unit: null, on_contract: false,
}

function Harness() {
  const [basket, setBasket] = useState<Basket>({ currency: 'INR', lines: [LINE] })
  ctx.basket = basket
  ctx.setBasket = setBasket
  return <RequisitionPanel onRaised={() => {}} />
}

beforeEach(() => {
  repo.raise.mockReset()
  repo.raise.mockResolvedValue({ ok: true, note: 'Raised' })
  Element.prototype.scrollIntoView = vi.fn()
})
afterEach(cleanup)

async function fillDraft() {
  await userEvent.type(screen.getByLabelText('What is it for'), 'Depot gateways')
  await userEvent.type(screen.getByLabelText('Why it is needed'), 'Depot 4 opens')
  await userEvent.selectOptions(screen.getByLabelText('Cost centre'), 'CC-1')
}

describe('RequisitionPanel and the buying rules', () => {
  it("rule 'reason': a labelled field per off line, Raise goes to it, and the reason is sent", async () => {
    repo.book = bookWith('reason')
    render(<Harness />)
    const field = await screen.findByLabelText('Why buy Gateway off your price book')
    expect(screen.getByText('Off your price book')).toBeTruthy()
    expect(field.id).toBe('req-offreason-SKU-9001')
    await fillDraft()

    await userEvent.click(screen.getByRole('button', { name: /Raise/ }))
    expect(repo.raise).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(field)
    expect(field.getAttribute('aria-invalid')).toBe('true')
    const error = screen.getByText(/Gateway is not on your account's price book/)
    expect(field.getAttribute('aria-describedby')).toContain(error.id)

    await userEvent.type(field, '  Only seller with stock  ')
    await userEvent.click(screen.getByRole('button', { name: /Raise/ }))
    await waitFor(() => expect(repo.raise).toHaveBeenCalledTimes(1))
    const args = repo.raise.mock.calls[0][0]
    expect(args.draft.lines[0].off_contract_reason).toBe('Only seller with stock')
    expect(args.rules.off_contract).toBe('reason')
    expect(args.prices).toEqual([])
  })

  it("rule 'approval': the sentence, no field, and a note that does not contradict itself", async () => {
    repo.book = bookWith('approval')
    render(<Harness />)
    expect(await screen.findByText('Goes to a finance approver because it is off your price book')).toBeTruthy()
    expect(screen.queryByLabelText(/off your price book$/)).toBeNull()
    expect(screen.queryByText(/no approval needed/)).toBeNull()
    expect(screen.getByText(/finance approval required/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Raise for approval/ })).toBeTruthy()
  })

  it("rule 'allow' with no prices (a database without price books): nothing is marked and nothing extra is sent", async () => {
    repo.book = bookWith('allow')
    render(<Harness />)
    await screen.findByText(/no approval needed/)
    expect(screen.queryByText('Off your price book')).toBeNull()
    await fillDraft()
    await userEvent.click(screen.getByRole('button', { name: /Raise/ }))
    await waitFor(() => expect(repo.raise).toHaveBeenCalledTimes(1))
    expect('off_contract_reason' in repo.raise.mock.calls[0][0].draft.lines[0]).toBe(false)
  })
})
