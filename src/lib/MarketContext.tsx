/* Which market the shopper is buying in, and therefore what they pay in.
 *
 * "India · UAE · Kenya" sat in the header as a plain span and in the footer as
 * three more, and in the hero copy as prose. Three markets named four times
 * and selectable nowhere, while every price on the site was in dollars.
 *
 * The market is the single choice that decides three things — the currency,
 * the tax rate and the tax's name — so it is held in one place rather than
 * derived separately wherever each is needed. A screen that reads the currency
 * from here and the tax rate from somewhere else is a screen that will one day
 * charge Kenyan VAT on a rupee price.
 *
 * Persisted, because a shopper who picks Kenya and then reloads into Indian
 * prices has not been given a choice, they have been given a flicker.
 */
import { createContext, useContext, useEffect, useState, useMemo } from 'react'
import type { ReactNode } from 'react'
import { loadMoneyBook, EMPTY_BOOK } from './moneyRepo'
import type { MoneyBook } from './moneyRepo'
import { format as formatMoney, money } from './money'
import type { Currency, Market } from './money'

const STORAGE_KEY = 'aventa.market'

export interface MarketState {
  book: MoneyBook
  market: Market | null
  currency: Currency | null
  ready: boolean
  setMarket: (code: string) => void
  /** Format an amount that is already in this market's currency. */
  fmt: (amount: number, opts?: { decimals?: boolean; code?: boolean }) => string
  /** Format an amount that carries its own currency, whatever that is. */
  fmtIn: (amount: number, currency: string, opts?: { decimals?: boolean; code?: boolean }) => string
}

const FALLBACK: MarketState = {
  book: EMPTY_BOOK, market: null, currency: null, ready: false,
  setMarket: () => {},
  fmt: n => n.toFixed(2),
  fmtIn: (n, c) => `${c} ${n.toFixed(2)}`,
}

const Ctx = createContext<MarketState>(FALLBACK)

export function MarketProvider({ children }: { children: ReactNode }) {
  const [book, setBook] = useState<MoneyBook>(EMPTY_BOOK)
  const [code, setCode] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
  })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let live = true
    loadMoneyBook().then(b => {
      if (!live) return
      setBook(b)
      setReady(true)
    })
    return () => { live = false }
  }, [])

  const setMarket = (next: string) => {
    setCode(next)
    try { localStorage.setItem(STORAGE_KEY, next) } catch { /* private browsing */ }
  }

  const value = useMemo<MarketState>(() => {
    /* A stored code that no longer names a market falls back to the default
       rather than leaving the shopper with no currency at all. */
    const market = book.markets.find(m => m.code === code)
      ?? book.markets.find(m => m.is_default)
      ?? null
    const currency = book.currencies.find(c => c.code === market?.currency) ?? null

    const fmtIn = (amount: number, cur: string, opts?: { decimals?: boolean; code?: boolean }) =>
      formatMoney(money(amount, cur), book.currencies, opts)

    return {
      book, market, currency, ready, setMarket,
      fmt: (amount, opts) => fmtIn(amount, market?.currency ?? 'USD', opts),
      fmtIn,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, code, ready])

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

/**
 * The market, its currency, and the two formatters.
 *
 * Safe to call before the tables have loaded: `ready` is false and `fmt` falls
 * back to a bare number rather than throwing, so a card that renders during
 * the first paint shows an unmarked figure for a moment instead of an empty
 * space that reflows when the price arrives.
 */
export const useMarket = (): MarketState => useContext(Ctx)
