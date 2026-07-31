import { describe, it, expect } from 'vitest'
import {
  canTopUp, planSpend, planRedemption, settleOnClosure, canCloseWallet,
  summariseBook, isDormant, runningBalance,
} from './wallet'
import type { Wallet, WalletPolicy, RedeemOption, LedgerEntry } from './wallet'

const POLICY: WalletPolicy = {
  max_balance: 2000, min_topup: 5, dormancy_months: 24,
  cash_refundable: '', non_refundable: '', dormancy_note: '',
}

const wallet = (over: Partial<Wallet> = {}): Wallet => {
  const cash = over.cash ?? 30.6
  const promo = over.promo ?? 12
  return {
    id: 'WAL-4100', party: 'CUS-449021', name: 'Priya Raman', kind: 'consumer',
    cash, promo, balance: Math.round((cash + promo) * 100) / 100,
    opened: '2024-06-14', last_move: '2026-07-24', state: 'active', note: null,
    ...over, ...(over.balance === undefined ? {} : { balance: over.balance }),
  }
}

const WALLET_CREDIT: RedeemOption = {
  id: 'RDM-01', name: 'Wallet credit', kind: 'wallet',
  min: 100, step: 100, value_per: 1.0, status: 'active',
}

describe('canTopUp', () => {
  it('accepts an ordinary top-up', () => {
    expect(canTopUp(wallet(), 25, POLICY)).toEqual({ ok: true })
  })

  it('refuses below the minimum', () => {
    const v = canTopUp(wallet(), 2, POLICY)
    expect(!v.ok && v.reason).toMatch(/smallest top-up is \$5\.00/)
  })

  it('refuses nothing at all', () => {
    expect(canTopUp(wallet(), 0, POLICY).ok).toBe(false)
    expect(canTopUp(wallet(), NaN, POLICY).ok).toBe(false)
  })

  it('refuses past the ceiling, and says how much room is left', () => {
    const v = canTopUp(wallet({ cash: 1900, promo: 50 }), 100, POLICY)
    expect(v.ok).toBe(false)
    expect(!v.ok && v.reason).toContain('$50.00')
  })

  it('says the wallet is full rather than offering zero room', () => {
    const v = canTopUp(wallet({ cash: 2000, promo: 0 }), 10, POLICY)
    expect(!v.ok && v.reason).toMatch(/already at the \$2000\.00 ceiling/)
  })

  it('refuses on an account that is closing — nothing more goes in', () => {
    expect(canTopUp(wallet({ state: 'closing' }), 25, POLICY).ok).toBe(false)
    expect(canTopUp(wallet({ state: 'closed' }), 25, POLICY).ok).toBe(false)
  })
})

describe('planSpend', () => {
  it('draws promotional credit first, so refundable money stays refundable', () => {
    const p = planSpend(wallet({ cash: 30, promo: 12 }), 20)
    expect(p).toMatchObject({ fromPromo: 12, fromCash: 8, ok: true, shortfall: 0 })
  })

  it('uses only promotional credit when it covers the whole thing', () => {
    expect(planSpend(wallet({ cash: 30, promo: 12 }), 10))
      .toMatchObject({ fromPromo: 10, fromCash: 0, ok: true })
  })

  it('falls back to cash when there is no promotional credit', () => {
    expect(planSpend(wallet({ cash: 30, promo: 0 }), 20))
      .toMatchObject({ fromPromo: 0, fromCash: 20, ok: true })
  })

  it('reports the shortfall rather than overdrawing', () => {
    const p = planSpend(wallet({ cash: 5, promo: 2 }), 20)
    expect(p).toMatchObject({ fromPromo: 2, fromCash: 5, shortfall: 13, ok: false })
  })

  it('spends the exact balance without rounding into a shortfall', () => {
    expect(planSpend(wallet({ cash: 30.6, promo: 12 }), 42.6))
      .toMatchObject({ fromPromo: 12, fromCash: 30.6, shortfall: 0, ok: true })
  })
})

describe('planRedemption', () => {
  const w = wallet()

  it('converts points to credit at the published rate', () => {
    const p = planRedemption(1000, 3180, WALLET_CREDIT, w, POLICY)
    expect(p).toMatchObject({ points: 1000, credit: 10, ok: true })
  })

  it('refuses more points than the member holds', () => {
    const p = planRedemption(5000, 3180, WALLET_CREDIT, w, POLICY)
    expect(!p.ok && p.reason).toMatch(/more than you hold/)
  })

  it('refuses below the minimum and off the step', () => {
    expect(planRedemption(50, 3180, WALLET_CREDIT, w, POLICY).reason).toMatch(/smallest conversion/)
    expect(planRedemption(150, 3180, WALLET_CREDIT, w, POLICY).reason).toMatch(/multiples of 100/)
  })

  it('refuses a retired option', () => {
    const retired = { ...WALLET_CREDIT, status: 'retired' }
    expect(planRedemption(1000, 3180, retired, w, POLICY).ok).toBe(false)
  })

  it('refuses when the credit would breach the ceiling', () => {
    const full = wallet({ cash: 1995, promo: 0 })
    expect(planRedemption(1000, 3180, WALLET_CREDIT, full, POLICY).reason).toMatch(/ceiling/)
  })

  it('refuses nothing at all', () => {
    expect(planRedemption(0, 3180, WALLET_CREDIT, w, POLICY).ok).toBe(false)
  })
})

describe('settleOnClosure — the two pots', () => {
  it('returns the cash and writes off the credit, separately', () => {
    const s = settleOnClosure(wallet({ cash: 30.6, promo: 12 }), 'Visa ending 4336')
    expect(s.cashReturned).toBe(30.6)
    expect(s.promoWrittenOff).toBe(12)
    expect(s.total).toBe(42.6)
  })

  it('names where the money goes', () => {
    const s = settleOnClosure(wallet({ cash: 30.6, promo: 0 }), 'Visa ending 4336')
    expect(s.lines[0]).toContain('Visa ending 4336')
    expect(s.lines[0]).toContain('$30.60')
  })

  it('says plainly that promotional credit is lost, rather than burying it', () => {
    const s = settleOnClosure(wallet({ cash: 0, promo: 12 }), 'Visa ending 4336')
    expect(s.lines[0]).toMatch(/cannot be paid out as cash and is cancelled/)
    expect(s.lines[0]).toContain('$12.00')
  })

  it('warns when there is money but nowhere to send it', () => {
    const s = settleOnClosure(wallet({ cash: 30.6, promo: 0 }), null)
    expect(s.lines[0]).toMatch(/no payment method on file/)
  })

  it('says so when the wallet is empty', () => {
    const s = settleOnClosure(wallet({ cash: 0, promo: 0 }), 'Visa ending 4336')
    expect(s.lines).toEqual(['Your wallet is empty, so there is nothing to return.'])
  })

  it('never returns promotional credit as cash, at any balance', () => {
    for (const promo of [1, 12, 500]) {
      expect(settleOnClosure(wallet({ cash: 0, promo }), 'Visa ending 4336').cashReturned).toBe(0)
    }
  })
})

describe('canCloseWallet', () => {
  it('allows closing an empty wallet with no instrument', () => {
    expect(canCloseWallet(wallet({ cash: 0, promo: 0 }), null)).toEqual({ ok: true })
  })

  it('allows closing when only promotional credit remains — nothing is owed', () => {
    expect(canCloseWallet(wallet({ cash: 0, promo: 12 }), null).ok).toBe(true)
  })

  it('refuses to close over the customer’s own money with nowhere to send it', () => {
    const v = canCloseWallet(wallet({ cash: 30.6, promo: 0 }), null)
    expect(v.ok).toBe(false)
    expect(!v.ok && v.reason).toMatch(/will not keep it/)
  })

  it('allows it once there is an instrument', () => {
    expect(canCloseWallet(wallet({ cash: 30.6 }), 'Visa ending 4336').ok).toBe(true)
  })

  it('refuses a wallet that is already closed', () => {
    expect(canCloseWallet(wallet({ state: 'closed' }), 'Visa ending 4336').ok).toBe(false)
  })
})

describe('summariseBook', () => {
  const book = [
    wallet({ id: 'W1', kind: 'consumer', cash: 30, promo: 12 }),
    wallet({ id: 'W2', kind: 'consumer', cash: 70, promo: 0, state: 'dormant', last_move: '2023-09-02' }),
    wallet({ id: 'W3', kind: 'enterprise', cash: 400, promo: 25 }),
  ]

  it('splits the liability by whose money it is', () => {
    const s = summariseBook(book)
    expect(s).toMatchObject({ accounts: 3, total: 537, cash: 500, promo: 37 })
  })

  it('counts dormancy and what it is worth', () => {
    expect(summariseBook(book)).toMatchObject({ dormant: 1, dormantValue: 70 })
  })

  it('breaks the book down by holder type, largest first', () => {
    expect(summariseBook(book).byKind[0]).toMatchObject({ kind: 'enterprise', accounts: 1, total: 425 })
  })

  it('handles an empty book', () => {
    expect(summariseBook([])).toMatchObject({ accounts: 0, total: 0, cash: 0, promo: 0 })
  })
})

describe('isDormant', () => {
  const today = new Date('2026-07-31')

  it('flags a wallet untouched for longer than the policy allows', () => {
    expect(isDormant(wallet({ last_move: '2023-09-02' }), POLICY, today)).toBe(true)
  })

  it('leaves a recently used one alone', () => {
    expect(isDormant(wallet({ last_move: '2026-07-24' }), POLICY, today)).toBe(false)
  })

  it('is exact at the boundary', () => {
    expect(isDormant(wallet({ last_move: '2024-07-31' }), POLICY, today)).toBe(true)
    expect(isDormant(wallet({ last_move: '2024-08-01' }), POLICY, today)).toBe(false)
  })
})

describe('runningBalance', () => {
  const entry = (id: string, when_date: string, amount: number, pot: 'cash' | 'promo' = 'cash'): LedgerEntry =>
    ({ id, wallet_id: 'W1', when_date, source: 'topup', what: 'x', amount, pot, ref: null })

  it('runs oldest first and lands on the current balance', () => {
    const out = runningBalance([
      entry('c', '2026-07-02', 25), entry('a', '2024-06-14', 20), entry('b', '2026-06-11', -12.99),
    ])
    expect(out.map(e => e.id)).toEqual(['a', 'b', 'c'])
    expect(out.at(-1)!.balance).toBe(32.01)
  })

  it('counts both pots into one running figure, because that is what is held', () => {
    const out = runningBalance([entry('a', '2026-01-01', 20), entry('b', '2026-02-01', 12, 'promo')])
    expect(out.at(-1)!.balance).toBe(32)
  })

  it('returns nothing for an empty ledger', () => {
    expect(runningBalance([])).toEqual([])
  })
})
