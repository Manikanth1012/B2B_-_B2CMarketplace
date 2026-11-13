/* Raise reads the account's prices and rules again, and stops on any line they moved. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Basket, ContractChange } from '../../lib/requisitionBasket'
import { setReason as setLineReason, applyContractChanges } from '../../lib/requisitionBasket'
import type { AccountBook } from '../../lib/enterpriseRepo'
import type { AccountPrice, OffContractRule } from '../../lib/accountPrices'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const repo = vi.hoisted(() => ({
  book: null as unknown as AccountBook,
  raise: vi.fn(),
  prices: vi.fn(),
  rules: vi.fn(),
  published: vi.fn(),
}))
vi.mock('../../lib/enterpriseRepo', () => ({
  loadAccount: () => Promise.resolve(repo.book),
  raiseRequisition: (args: unknown) => repo.raise(args),
}))
vi.mock('../../lib/priceBookRepo', () => ({
  loadAccountPrices: (id: string) => repo.prices(id),
  loadBuyingRules: (id: string) => repo.rules(id),
  loadPublishedPrices: (ids: string[], c: string) => repo.published(ids, c),
}))
vi.mock('../../lib/MarketContext', () => ({
  useMarket: () => ({ fmtIn: (n: number, c: string) => `${c} ${n.toFixed(2)}`, book: null }),
}))
const toasts = vi.hoisted(() => ({ calls: [] as unknown[][] }))
vi.mock('../operator/shared', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  toast: (...a: unknown[]) => { toasts.calls.push(a) },
}))

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
      applyChanges: (changes: ContractChange[]) => setBasket(applyContractChanges(basket, changes)),
      empty: () => {}, total: basket.lines.reduce((n, l) => n + l.quantity * l.unit_price, 0),
      count: basket.lines.reduce((n, l) => n + l.quantity, 0),
      /* Kept-basket plumbing (spec 11): nothing kept here, nothing flagged. */
      restored: null, dismissRestored: () => {}, keepError: null,
      sync: () => Promise.resolve(ctx.basket as Basket), acceptFlag: () => Promise.resolve({ ok: true }),
      raised: () => Promise.resolve(),
    }
  },
}))

import { RequisitionPanel, PRICES_MOVED } from './RequisitionPanel'

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
const rulesOf = (rule: OffContractRule) => ({ account_id: 'ENT-1', off_contract: rule, note: null, updated_by: null, updated_on: null })

const PRICE: AccountPrice = {
  id: 'AP-1', account_id: 'ENT-1', product_id: 'SKU-9001', currency: 'INR', unit_price: 900,
  starts_on: '2020-01-01', ends_on: null, source: 'negotiated', quote_line_id: null, quote_ref: null,
  note: null, set_by: 'op', set_at: '2020-01-01', ended_by: null, ended_at: null, end_reason: null,
}

function bookWith(rule: OffContractRule, prices: AccountPrice[]): AccountBook {
  return {
    account: ACCOUNT, me: ME, policy: POLICY, centres: [{ id: 'CC-1', name: 'Ops' }],
    currencies: ['INR'], rates: [], prices, rules: rulesOf(rule), preferences: [],
  } as unknown as AccountBook
}

const LINE = {
  product_id: 'SKU-9001', name: 'Gateway', seller: 'Nimbus', partner_id: 'P-1', quantity: 2, unit_price: 1000,
  model: 'oneoff' as const, vertical: 'iot', unit: null, on_contract: false,
}

function Harness({ start }: { start: Basket['lines'] }) {
  const [basket, setBasket] = useState<Basket>({ currency: 'INR', lines: start })
  ctx.basket = basket
  ctx.setBasket = setBasket
  return <RequisitionPanel onRaised={() => {}} />
}

function freshReads(rule: OffContractRule, prices: AccountPrice[], published = 1000) {
  repo.prices.mockResolvedValue({ ok: true, value: prices })
  repo.rules.mockResolvedValue({ ok: true, value: rulesOf(rule) })
  repo.published.mockResolvedValue({ ok: true, value: new Map([['SKU-9001', { price: published, floor_price: null }]]) })
}

beforeEach(() => {
  repo.raise.mockReset()
  repo.raise.mockResolvedValue({ ok: true, note: 'Raised' })
  repo.prices.mockReset(); repo.rules.mockReset(); repo.published.mockReset()
  toasts.calls = []
  Element.prototype.scrollIntoView = vi.fn()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

async function fillDraft() {
  await userEvent.type(screen.getByLabelText('What is it for'), 'Depot gateways')
  await userEvent.type(screen.getByLabelText('Why it is needed'), 'Depot 4 opens')
  await userEvent.selectOptions(screen.getByLabelText('Cost centre'), 'CC-1')
}
const raiseButton = () => screen.getByRole('button', { name: /Raise/ })

describe('RequisitionPanel re-checks today\'s prices on Raise', () => {
  it('nothing moved: raised once, on the prices it re-read', async () => {
    repo.book = bookWith('allow', [])
    freshReads('allow', [])
    render(<Harness start={[LINE]} />)
    await screen.findByText(/no approval needed/)
    await fillDraft()
    await userEvent.click(raiseButton())
    await waitFor(() => expect(repo.raise).toHaveBeenCalledTimes(1))
    expect(repo.prices).toHaveBeenCalledWith('ENT-1')
    expect(repo.published).toHaveBeenCalledWith(['SKU-9001'], 'INR')
    expect(repo.raise.mock.calls[0][0].draft.lines[0].unit_price).toBe(1000)
    expect(screen.queryByText(PRICES_MOVED)).toBeNull()
  })

  it('a price that started while the drawer was open: nothing raised, the line shows it, focus goes to it; raised again at the new price', async () => {
    repo.book = bookWith('allow', [])
    freshReads('allow', [PRICE])
    render(<Harness start={[LINE]} />)
    await screen.findByText(/no approval needed/)
    await fillDraft()
    await userEvent.click(raiseButton())

    const note = await screen.findByText('Price now INR 900.00 (was INR 1000.00), now on your price book')
    expect(repo.raise).not.toHaveBeenCalled()
    expect(screen.getByRole('status').textContent).toBe(PRICES_MOVED)
    /* Announced once: by the status line, not by a toast as well. */
    expect(toasts.calls.some(c => c[0] === PRICES_MOVED)).toBe(false)
    const line = document.getElementById('req-line-SKU-9001')!
    await waitFor(() => expect(document.activeElement).toBe(line))
    expect(line.getAttribute('aria-describedby')).toBe(note.id)
    expect(screen.getByText(/INR 900\.00 each/)).toBeTruthy()

    await userEvent.click(raiseButton())
    await waitFor(() => expect(repo.raise).toHaveBeenCalledTimes(1))
    const args = repo.raise.mock.calls[0][0]
    expect(args.draft.lines[0].unit_price).toBe(900)
    expect(args.prices).toEqual([PRICE])
    expect(screen.queryByText(PRICES_MOVED)).toBeNull()
  })

  it("a price that ended under rule 'reason': the line goes off, its reason field appears and takes focus", async () => {
    repo.book = bookWith('reason', [PRICE])
    freshReads('reason', [{ ...PRICE, ends_on: '2020-12-31' }])
    render(<Harness start={[{ ...LINE, unit_price: 900, on_contract: true }]} />)
    await screen.findByText(/INR 900\.00 each/)
    expect(screen.queryByLabelText('Why buy Gateway off your price book')).toBeNull()
    await fillDraft()
    await userEvent.click(raiseButton())

    await screen.findByText('Price now INR 1000.00 (was INR 900.00), now off your price book')
    const field = await screen.findByLabelText('Why buy Gateway off your price book')
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(repo.raise).not.toHaveBeenCalled()

    /* Raise again without the reason: the usual refusal, at the field. */
    await userEvent.click(raiseButton())
    expect(repo.raise).not.toHaveBeenCalled()
    expect(field.getAttribute('aria-invalid')).toBe('true')

    await userEvent.type(field, 'Only seller with stock')
    await userEvent.click(raiseButton())
    await waitFor(() => expect(repo.raise).toHaveBeenCalledTimes(1))
    const sent = repo.raise.mock.calls[0][0].draft.lines[0]
    expect(sent.unit_price).toBe(1000)
    expect(sent.off_contract_reason).toBe('Only seller with stock')
  })

  it("the rule moved to 'reason' with no price moving: Raise stops at the new reason field", async () => {
    repo.book = bookWith('allow', [])
    freshReads('reason', [])
    render(<Harness start={[LINE]} />)
    await screen.findByText(/no approval needed/)
    await fillDraft()
    await userEvent.click(raiseButton())
    const field = await screen.findByLabelText('Why buy Gateway off your price book')
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect(repo.raise).not.toHaveBeenCalled()
    expect(screen.queryByText(PRICES_MOVED)).toBeNull()
  })

  it("the rule moved from 'reason' to 'allow': the missing reason is judged on today's rule, and it is raised", async () => {
    repo.book = bookWith('reason', [])
    freshReads('allow', [])
    render(<Harness start={[LINE]} />)
    await screen.findByLabelText('Why buy Gateway off your price book')
    await fillDraft()
    await userEvent.click(raiseButton())
    await waitFor(() => expect(repo.raise).toHaveBeenCalledTimes(1))
    expect(repo.raise.mock.calls[0][0].rules.off_contract).toBe('allow')
    expect('off_contract_reason' in repo.raise.mock.calls[0][0].draft.lines[0]).toBe(false)
  })

  it('the line controls are held while the prices are re-read', async () => {
    repo.book = bookWith('allow', [])
    let release: (v: unknown) => void = () => {}
    repo.prices.mockReturnValue(new Promise(r => { release = r }))
    repo.rules.mockResolvedValue({ ok: true, value: rulesOf('allow') })
    repo.published.mockResolvedValue({ ok: true, value: new Map([['SKU-9001', { price: 1000, floor_price: null }]]) })
    render(<Harness start={[LINE]} />)
    await screen.findByText(/no approval needed/)
    await fillDraft()
    await userEvent.click(raiseButton())
    expect((screen.getByLabelText('Quantity of Gateway') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Remove Gateway' }) as HTMLButtonElement).disabled).toBe(true)
    release({ ok: true, value: [] })
    await waitFor(() => expect(repo.raise).toHaveBeenCalledTimes(1))
  })

  it('the re-read failing raises as before, on the figures shown (the database still checks the price)', async () => {
    repo.book = bookWith('allow', [])
    repo.prices.mockResolvedValue({ ok: false, error: 'Failed to fetch' })
    repo.rules.mockResolvedValue({ ok: true, value: rulesOf('allow') })
    repo.published.mockResolvedValue({ ok: true, value: new Map() })
    render(<Harness start={[LINE]} />)
    await screen.findByText(/no approval needed/)
    await fillDraft()
    await userEvent.click(raiseButton())
    await waitFor(() => expect(repo.raise).toHaveBeenCalledTimes(1))
    expect(repo.raise.mock.calls[0][0].draft.lines[0].unit_price).toBe(1000)
    expect(console.warn).toHaveBeenCalled()
  })

  it('a read that throws is treated the same way', async () => {
    repo.book = bookWith('allow', [])
    repo.prices.mockImplementation(() => { throw new Error('offline') })
    repo.rules.mockResolvedValue({ ok: true, value: rulesOf('allow') })
    repo.published.mockResolvedValue({ ok: true, value: new Map() })
    render(<Harness start={[LINE]} />)
    await screen.findByText(/no approval needed/)
    await fillDraft()
    await userEvent.click(raiseButton())
    await waitFor(() => expect(repo.raise).toHaveBeenCalledTimes(1))
  })
})
