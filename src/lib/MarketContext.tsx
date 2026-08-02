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
import { format as formatMoney, money, currenciesOf } from './money'
import type { Currency, Market } from './money'

const STORAGE_KEY = 'aventa.market'
const CURRENCY_KEY = 'aventa.currency'

export interface MarketState {
  book: MoneyBook
  market: Market | null
  currency: Currency | null
  /* Every currency this market will take, default first — so a screen can offer
     the choice rather than assuming there is only one. */
  choices: string[]
  ready: boolean
  setMarket: (code: string) => void
  /* Choosing to be quoted in one of the market's other currencies. Refused if
     the market does not take it, because that is not a price anybody could pay. */
  setCurrency: (code: string) => void
  /** Format an amount that is already in this market's currency. */
  fmt: (amount: number, opts?: { decimals?: boolean; code?: boolean }) => string
  /** Format an amount that carries its own currency, whatever that is. */
  fmtIn: (amount: number, currency: string, opts?: { decimals?: boolean; code?: boolean }) => string
}

const FALLBACK: MarketState = {
  book: EMPTY_BOOK, market: null, currency: null, choices: [], ready: false,
  setMarket: () => {},
  setCurrency: () => {},
  fmt: n => n.toFixed(2),
  fmtIn: (n, c) => `${c} ${n.toFixed(2)}`,
}

const Ctx = createContext<MarketState>(FALLBACK)

export function MarketProvider({ children }: { children: ReactNode }) {
  const [book, setBook] = useState<MoneyBook>(EMPTY_BOOK)
  const [code, setCode] = useState<string | null>(() => {
    try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
  })
  const [wanted, setWanted] = useState<string | null>(() => {
    try { return localStorage.getItem(CURRENCY_KEY) } catch { return null }
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
    /* Switching market drops the currency choice. Carrying it over would leave
       somebody who chose dollars in Kenya being quoted dollars in India, which
       that market does not trade in. */
    setWanted(null)
    try {
      localStorage.setItem(STORAGE_KEY, next)
      localStorage.removeItem(CURRENCY_KEY)
    } catch { /* private browsing */ }
  }

  const setCurrency = (next: string) => {
    setWanted(next)
    try { localStorage.setItem(CURRENCY_KEY, next) } catch { /* private browsing */ }
  }

  const value = useMemo<MarketState>(() => {
    /* A stored code that no longer names a market falls back to the default
       rather than leaving the shopper with no currency at all. */
    const market = book.markets.find(m => m.code === code)
      ?? book.markets.find(m => m.is_default)
      ?? null

    const choices = market ? currenciesOf(market.code, book.accepted) : []
    /* A stored currency the market does not take falls back to its default
       rather than pricing in something nobody there can pay — which is what a
       shopper who chose dollars in Kenya and then switched to India would
       otherwise get. */
    const active = wanted && choices.includes(wanted) ? wanted : (choices[0] ?? market?.currency)
    const currency = book.currencies.find(c => c.code === active) ?? null

    const fmtIn = (amount: number, cur: string, opts?: { decimals?: boolean; code?: boolean }) =>
      formatMoney(money(amount, cur), book.currencies, opts)

    return {
      book, market, currency, choices, ready, setMarket, setCurrency,
      /* The chosen currency, not the market's default — that is the whole point
         of letting somebody choose. */
      fmt: (amount, opts) => fmtIn(amount, active ?? 'USD', opts),
      fmtIn,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, code, wanted, ready])

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
