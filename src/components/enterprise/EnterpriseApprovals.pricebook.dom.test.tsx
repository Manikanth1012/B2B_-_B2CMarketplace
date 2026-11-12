/* Approvals and the account's price book (spec 9): what each line was charged at,
   the card's count, and decision 20's visibility. The repo is mocked; nothing
   reaches the network. */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import type { AccountPrice, OffContractRule } from '../../lib/accountPrices'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))

const repo = vi.hoisted(() => ({ book: null as unknown }))
vi.mock('../../lib/enterpriseRepo', () => ({
  loadAccount: async () => repo.book,
  decideRequisition: async () => ({ ok: true }),
  savePolicy: async () => ({ ok: true }),
}))
vi.mock('../../lib/MarketContext', () => ({
  useMarket: () => ({ fmtIn: (n: number, c: string) => `${c} ${Number(n).toFixed(2)}`, book: null }),
}))

import { EnterpriseApprovals } from './EnterpriseApprovals'

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
const member = (id: string, over: Record<string, unknown> = {}) => ({
  id, account_id: 'ENT-1', user_id: null, name: id === 'EU-1' ? 'Vera' : 'Raj', email: `${id}@x`, title: 'Lead',
  role: 'procurement-lead', can_raise: true, approves_finance: true, approves_it: false, approve_limit: null,
  cost_centre: null, phone: null, mfa: false, status: 'active', sort_order: 0, ...over,
})
const REQ = {
  id: 'REQ-1', account_id: 'ENT-1', raised_by: 'EU-2', raised_on: '2026-11-10', raised_at: '2 days ago',
  title: 'Depot gateways', vertical: 'iot', cost_centre: null, amount: 3700, currency: 'INR', model: 'oneoff',
  reason: 'Depot 4 opens', need: 'finance', policy_note: 'Below the threshold', state: 'pending',
  decided_by: null, decided_on: null, decision_note: null, order_ref: null, po_ref: null, sort_order: 0,
}
const line = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  id, requisition_id: 'REQ-1', product_id: `SKU-${id}`, name, seller: 'Nimbus', partner_id: 'P-1',
  quantity: 1, unit_price: 900, line_total: 900, sort_order: 0, ...over,
})
const LINES = [
  line('1', 'Gateway', { off_contract: false, account_price_id: 'AP-1' }),
  line('2', 'Sensor', { off_contract: true, off_contract_reason: 'Only seller with stock', unit_price: 1000, line_total: 1000 }),
  line('3', 'Bracket', { off_contract: true, off_contract_reason: null, unit_price: 1000, line_total: 1000 }),
  /* A line from a database without price books: says nothing. */
  line('4', 'Cable', { unit_price: 800, line_total: 800 }),
]
const IN_FORCE: AccountPrice = {
  id: 'AP-1', account_id: 'ENT-1', product_id: 'SKU-1', currency: 'INR', unit_price: 900,
  starts_on: '2020-01-01', ends_on: null, source: 'negotiated', quote_line_id: null, quote_ref: null,
  note: null, set_by: 'op', set_at: '2020-01-01', ended_by: null, ended_at: null, end_reason: null,
}

function bookWith(rule: OffContractRule, prices: AccountPrice[], lines = LINES) {
  return {
    account: ACCOUNT, me: member('EU-1'), members: [member('EU-1'), member('EU-2')], roles: [], centres: [],
    policy: POLICY, requisitions: [REQ], lines, subscriptions: [], invoices: [], invoiceLines: [],
    currencies: ['INR'], rates: [], credit: null, prices,
    rules: { account_id: 'ENT-1', off_contract: rule, note: null, updated_by: null, updated_on: null },
    preferences: [],
  }
}

/* The card's line table: one row per line, found by the line's name. */
const rowOf = (name: string) => screen.getByText(name).closest('tr') as HTMLElement

afterEach(cleanup)

describe('EnterpriseApprovals and the price book', () => {
  it('each line says "Your price" or "Off your price book" with the reason, and the card counts the off lines', async () => {
    repo.book = bookWith('reason', [IN_FORCE])
    render(<EnterpriseApprovals />)
    await screen.findByText('Depot gateways')

    expect(within(rowOf('Gateway')).getByText('Your price')).toBeTruthy()
    expect(within(rowOf('Gateway')).queryByText('Off your price book')).toBeNull()

    expect(within(rowOf('Sensor')).getByText('Off your price book')).toBeTruthy()
    expect(within(rowOf('Sensor')).getByText('Only seller with stock')).toBeTruthy()

    expect(within(rowOf('Bracket')).getByText('Off your price book')).toBeTruthy()

    expect(within(rowOf('Cable')).queryByText('Your price')).toBeNull()
    expect(within(rowOf('Cable')).queryByText('Off your price book')).toBeNull()

    expect(screen.getByText('2 lines off your price book')).toBeTruthy()
  })

  it('one off line: the count is singular', async () => {
    repo.book = bookWith('approval', [IN_FORCE], LINES.slice(0, 2))
    render(<EnterpriseApprovals />)
    await screen.findByText('Depot gateways')
    expect(screen.getByText('1 line off your price book')).toBeTruthy()
  })

  it("decision 20: rule 'allow' and no price in force hides the bare off marker, but a line with a reason still shows it", async () => {
    repo.book = bookWith('allow', [{ ...IN_FORCE, ends_on: '2020-12-31' }])
    render(<EnterpriseApprovals />)
    await screen.findByText('Depot gateways')
    expect(within(rowOf('Bracket')).queryByText('Off your price book')).toBeNull()
    expect(within(rowOf('Sensor')).getByText('Off your price book')).toBeTruthy()
    expect(within(rowOf('Sensor')).getByText('Only seller with stock')).toBeTruthy()
    /* "Your price" is what the line was charged at, stored on it; it does not hide. */
    expect(within(rowOf('Gateway')).getByText('Your price')).toBeTruthy()
    expect(screen.getByText('1 line off your price book')).toBeTruthy()
  })

  it("decision 20: rule 'allow' with a price in force shows every off line", async () => {
    repo.book = bookWith('allow', [IN_FORCE])
    render(<EnterpriseApprovals />)
    await screen.findByText('Depot gateways')
    expect(within(rowOf('Bracket')).getByText('Off your price book')).toBeTruthy()
    expect(screen.getByText('2 lines off your price book')).toBeTruthy()
  })

  it('a database without price books: no line says anything and there is no count', async () => {
    repo.book = bookWith('allow', [], [line('4', 'Cable')])
    render(<EnterpriseApprovals />)
    await screen.findByText('Depot gateways')
    expect(screen.queryByText('Your price')).toBeNull()
    expect(screen.queryByText(/off your price book/i)).toBeNull()
  })
})
