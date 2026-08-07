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
import { loadMoneyBook, loadHome, EMPTY_BOOK } from './moneyRepo'
import { supabase } from './supabase'
import type { MoneyBook } from './moneyRepo'
import { format as formatMoney, money, currenciesOf, presentIn } from './money'
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
  /**
   * Format an amount that carries its own currency, whatever that is.
   *
   * Where the buyer's account is kept in a different currency, the figure is
   * ALSO shown in theirs and the original is kept beside it. A bill issued in
   * shillings was paid in shillings — the record is not rewritten, it is
   * presented, the way a bank statement presents a foreign transaction.
   *
   * `asOf` is the date the document belongs to. Converting last year's bill at
   * today's rate is the single most common way currency handling goes wrong,
   * so a caller that knows the date passes it.
   */
  fmtIn: (
    amount: number, currency: string,
    opts?: { decimals?: boolean; code?: boolean; asOf?: string; bare?: boolean },
  ) => string
  /** The currency this buyer's account is kept in, once they have signed in. */
  account: string | null
  /**
   * The market this buyer is registered in, once they have signed in.
   *
   * Null for a visitor, who has no account and so no home market — that is the
   * one case where the choice is genuinely free, and it is what the landing
   * page offers. For anybody signed in it is fixed: a customer registered in
   * India is billed under Indian GST by an Indian entity, and does not become a
   * Kenyan customer by changing a dropdown. `guard_order_currency` refuses the
   * order either way; this is so the picker stops offering what checkout will
   * reject.
   */
  home: string | null
}

const FALLBACK: MarketState = {
  book: EMPTY_BOOK, market: null, currency: null, choices: [], ready: false,
  setMarket: () => {},
  setCurrency: () => {},
  fmt: n => n.toFixed(2),
  fmtIn: (n, c) => `${c} ${n.toFixed(2)}`,
  home: null,
  account: null,
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
  const [home, setHome] = useState<string | null>(null)
  const [account, setAccount] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    loadMoneyBook().then(b => {
      if (!live) return
      setBook(b)
      setReady(true)
    })
    return () => { live = false }
  }, [])

  /* Where the signed-in buyer is registered, re-read whenever the session
     changes — signing in pins the market, signing out releases it. A visitor
     browsing before they log in keeps a free choice, which is the honest state:
     the marketplace does not know who they are yet. */
  useEffect(() => {
    let live = true
    const read = async () => {
      const where = await loadHome()
      if (live) { setHome(where.market); setAccount(where.currency) }
    }
    void read()
    const { data } = supabase.auth.onAuthStateChange(() => { void read() })
    return () => { live = false; data.subscription.unsubscribe() }
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
    /* A registered buyer's market wins over anything stored. Somebody who
       browsed as a visitor, chose Kenya, and then signed in as an Indian
       customer would otherwise be left looking at a shelf they cannot buy from
       — priced correctly, and refused at checkout.

       A stored code that no longer names a market falls back to the default
       rather than leaving the shopper with no currency at all. */
    const market = book.markets.find(m => m.code === home)
      ?? book.markets.find(m => m.code === code)
      ?? book.markets.find(m => m.is_default)
      ?? null

    const choices = market ? currenciesOf(market.code, book.accepted) : []
    /* A stored currency the market does not take falls back to its default
       rather than pricing in something nobody there can pay — which is what a
       shopper who chose dollars in Kenya and then switched to India would
       otherwise get. */
    /* A signed-in buyer is quoted in the currency their account is kept in —
       that is what they are billed in and what their wallet holds. The picker
       is still theirs, but the default is the account rather than the market's
       first currency: a Kisumu customer whose account is in dollars should not
       have to change a dropdown to see the price he will be charged. */
    const active = wanted && choices.includes(wanted) ? wanted
      : account && choices.includes(account) ? account
      : (choices[0] ?? market?.currency)
    const currency = book.currencies.find(c => c.code === active) ?? null

    const fmtIn = (
      amount: number, cur: string,
      opts?: { decimals?: boolean; code?: boolean; asOf?: string; bare?: boolean },
    ) => {
      const own = formatMoney(money(amount, cur), book.currencies, opts)
      if (!account || cur === account || opts?.bare) return own

      /* At the document's own date where the caller knows it. Null where no
         rate that old exists, and then the original stands alone rather than
         being restated at a day's rate it was never struck at. */
      const asOf = opts?.asOf ?? new Date().toISOString().slice(0, 10)
      const shown = presentIn(money(amount, cur), account, book.rates, asOf, book.currencies)
      if (!shown) return own
      /* Converted first, original second. The customer asked to see dollars;
         they are still owed the figure they were actually charged. */
      return `${formatMoney(shown.money, book.currencies, opts)} · ${own}`
    }

    return {
      book, market, currency, choices, ready, home, account,
      /* Pinned once the buyer is known. Refusing here rather than letting the
         call through keeps one answer on the screen: the picker shows the
         market as settled instead of offering a switch that silently does
         nothing. */
      setMarket: home ? () => {} : setMarket,
      setCurrency,
      /* The chosen currency, not the market's default — that is the whole point
         of letting somebody choose. */
      fmt: (amount, opts) => fmtIn(amount, active ?? 'USD', opts),
      fmtIn,
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, code, wanted, ready, home, account])

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
