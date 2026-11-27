/* Accounts and Credit show an account's risk band in words ("High"), never the
   raw value ("high") (spec 17, decision 6). */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
vi.mock('../../lib/MarketContext', () => ({
  useMarket: () => ({ fmtIn: (n: number, c: string) => `${c} ${n.toFixed(2)}` }),
}))
vi.mock('../../lib/riskRepo', () => ({
  accountBands: async () => new Map([['ENT-1', { score: 75, band: 'high' }]]),
}))
vi.mock('../../lib/accountsRepo', () => ({
  loadAccountBook: async () => ({
    accounts: [{
      id: 'ENT-1', company: 'Acme Logistics', market: 'IN', segment: 'Mid-market', industry: null,
      status: 'active', terms: 'Net 30', currency: 'INR',
    }],
    steps: [], credit: [], shoppers: [], waiting: 0, waitingApps: [],
  }),
}))
vi.mock('../../lib/creditRepo', () => ({
  loadCreditBook: async () => ({
    positions: [{
      account_id: 'ENT-1', company: 'Acme Logistics', currency: 'INR', credit_limit: 100000, deposit_held: 0,
      owed: 1000, committed: 0, exposure: 1000, headroom: 99000, over_limit: false, band: null, next_review: null,
    }],
    assessments: [], security: [], sellers: [], held: [],
  }),
  releaseHold: vi.fn(),
}))

import { OperatorAccounts } from './OperatorAccounts'
import { OperatorCredit } from './OperatorCredit'

afterEach(cleanup)

describe('an account risk band, in words', () => {
  it('reads "Risk: High" on Accounts', async () => {
    render(<OperatorAccounts />)
    expect(await screen.findByText('Risk: High')).toBeTruthy()
    expect(screen.queryByText('Risk: high')).toBeNull()
  })

  it('reads "Risk: High" on Credit', async () => {
    render(<OperatorCredit />)
    expect(await screen.findByText('Risk: High')).toBeTruthy()
    expect(screen.queryByText('Risk: high')).toBeNull()
  })
})
