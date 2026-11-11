import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AccountPrice } from '../../lib/accountPrices'

const repo = vi.hoisted(() => ({ setAccountPrice: vi.fn(), promoteQuoteLine: vi.fn() }))
vi.mock('../../lib/priceBookRepo', () => repo)
vi.mock('../../lib/moneyRepo', () => ({
  loadProductPrices: vi.fn(async () => [
    { product_id: 'SKU-4006', currency: 'INR', price: 23999, was_price: null, floor_price: 19999, list_price: null },
  ]),
}))
vi.mock('../../lib/MarketContext', () => ({
  /* fmtIn converts; the screens must never call it. */
  useMarket: () => ({ book: { currencies: [] }, fmtIn: () => 'CONVERTED' }),
}))

import { SetPriceDialog, replacementSentences } from './SetPriceDialog'
import { endSentence } from './EndPriceDialog'
import { promoteProblem } from './PromoteQuoteDialog'

afterEach(() => { cleanup(); vi.clearAllMocks() })

const TODAY = '2026-11-12'
const account = { id: 'ENT-2007', company: 'SmartBuild Ltd', market: 'IN' }
const listings = [{ id: 'SKU-4006', name: 'Edge Gateway', seller: 'Nimbus Sensors' }]
const price = (over: Partial<AccountPrice>): AccountPrice => ({
  id: 'AP-1004', account_id: 'ENT-2007', product_id: 'SKU-4006', currency: 'INR',
  unit_price: 21999, starts_on: '2026-11-01', ends_on: null, source: 'negotiated',
  quote_line_id: null, quote_ref: null, note: null, set_by: 'Anika Sharma', set_at: '2026-11-01',
  ended_by: null, ended_at: null, end_reason: null, ...over,
})

function open(prices: AccountPrice[] = []) {
  render(<SetPriceDialog open onClose={() => {}} onSaved={() => {}} account={account}
    currencies={['INR', 'USD']} listings={listings} prices={prices} today={TODAY} />)
}

describe('SetPriceDialog', () => {
  it('says a price under the floor is refused, in the database\'s words, and will not submit', async () => {
    open()
    fireEvent.change(screen.getByLabelText(/Listing/), { target: { value: 'SKU-4006' } })
    await screen.findByText(/Published today ₹23,999.00/)
    const input = screen.getByLabelText(/Account price/)
    fireEvent.change(input, { target: { value: '19000' } })
    const said = await screen.findByText(
      'That is below the floor of INR 19999.00 that the seller of Edge Gateway agreed. An account price never goes under it.')
    expect(input.getAttribute('aria-describedby')).toContain(said.id)
    expect(input.getAttribute('aria-invalid')).toBe('true')
    const submit = screen.getByRole('button', { name: 'Set the price' }) as HTMLButtonElement
    expect(submit.disabled).toBe(true)
    fireEvent.click(submit)
    expect(repo.setAccountPrice).not.toHaveBeenCalled()
  })

  it('submits a price between floor and published, and shows the database\'s refusal as a sentence', async () => {
    repo.setAccountPrice.mockResolvedValue({ ok: false, error: 'Price books are not set up on this database yet, so nothing was changed.' })
    open()
    fireEvent.change(screen.getByLabelText(/Listing/), { target: { value: 'SKU-4006' } })
    await screen.findByText(/Published today/)
    fireEvent.change(screen.getByLabelText(/Account price/), { target: { value: '21999' } })
    const submit = screen.getByRole('button', { name: 'Set the price' }) as HTMLButtonElement
    await waitFor(() => expect(submit.disabled).toBe(false))
    fireEvent.click(submit)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/not set up on this database yet/)).toBeTruthy()
    expect(repo.setAccountPrice.mock.calls[0][0]).toMatchObject({ account_id: 'ENT-2007', product_id: 'SKU-4006', currency: 'INR', unit_price: 21999, starts_on: TODAY, ends_on: null })
  })

  it('says before submit that a bounded price inside an open-ended one ends it for good', async () => {
    open([price({})])
    fireEvent.change(screen.getByLabelText(/Listing/), { target: { value: 'SKU-4006' } })
    await screen.findByText(/Published today/)
    fireEvent.change(screen.getByLabelText(/Ends on/), { target: { value: '2026-11-30' } })
    expect(screen.getByText(/AP-1004 .* ends on 11 Nov 2026\. It does not come back when the new price ends on 30 Nov 2026: from 01 Dec 2026/)).toBeTruthy()
  })
})

describe('replacementSentences', () => {
  const fmt = (n: number, c: string) => `${c} ${n}`
  const draft = { account_id: 'ENT-2007', product_id: 'SKU-4006', currency: 'INR', unit_price: 21000, starts_on: '2026-11-20', ends_on: null, note: '' }
  it('a scheduled price the new one starts on or before is withdrawn', () => {
    const s = replacementSentences([price({ starts_on: '2026-11-25' })], draft, TODAY, fmt)
    expect(s[0]).toMatch(/so it will be withdrawn/)
  })
  it('an open-ended new price just ends the old one the day before', () => {
    const s = replacementSentences([price({})], draft, TODAY, fmt)
    expect(s).toEqual(['AP-1004 (INR 21999, from 01 Nov 2026) ends on 19 Nov 2026.'])
  })
  it('a price that started today and is replaced today is withdrawn, but said to have applied', () => {
    const s = replacementSentences([price({ starts_on: TODAY })], { ...draft, starts_on: TODAY }, TODAY, fmt)
    expect(s[0]).toMatch(/started today, so replacing it today withdraws it/)
    expect(s[0]).toMatch(/requisitions already raised at it keep it/)
    expect(s[0]).not.toMatch(/never applies/)
  })
  it('nothing in another currency is touched', () => {
    expect(replacementSentences([price({ currency: 'USD' })], draft, TODAY, fmt)).toEqual([])
  })
})

describe('endSentence', () => {
  it('names the day an in-force price ends', () => {
    expect(endSentence({ starts_on: '2026-11-01' }, TODAY)).toBe('It will end on 11 Nov 2026.')
  })
  it('says a price that started today is withdrawn, and that what was raised at it keeps it', () => {
    expect(endSentence({ starts_on: TODAY }, TODAY)).toMatch(/^It started today, so ending it today withdraws it.*requisitions already raised at it keep it\.$/)
  })
  it('says a scheduled price is withdrawn', () => {
    expect(endSentence({ starts_on: '2026-12-01' }, TODAY)).toBe('It has not started, so it will be withdrawn: it never applies.')
  })
})

describe('promoteProblem', () => {
  const line = { id: 'EL-1', enquiry_id: 'ENQ-1012', account_id: 'ENT-2007', status: 'accepted', currency: 'INR', product_id: 'SKU-4006', name: 'Gateway (quoted)', quoted_unit_price: 21000 }
  const row = { product_id: 'SKU-4006', currency: 'INR', price: 23999, was_price: null, floor_price: 19999, list_price: null }
  it('a 0.00 quote cannot be promoted, in the database\'s words', () => {
    expect(promoteProblem({ ...line, quoted_unit_price: 0 }, null, 'Edge Gateway')).toBe(
      'ENQ-1012 quoted that line at 0.00, and an account price is more than nothing. Agree a price with the account and set it on Price books instead.')
  })
  it('under the floor or over the published price is refused; between is fine', () => {
    expect(promoteProblem({ ...line, quoted_unit_price: 19000 }, row, 'Edge Gateway')).toMatch(/below the floor of INR 19999.00/)
    expect(promoteProblem({ ...line, quoted_unit_price: 25000 }, row, 'Edge Gateway')).toMatch(/above the published price of INR 23999.00/)
    expect(promoteProblem(line, row, 'Edge Gateway')).toBeNull()
    expect(promoteProblem(line, null, 'Edge Gateway')).toBeNull()
  })
})
