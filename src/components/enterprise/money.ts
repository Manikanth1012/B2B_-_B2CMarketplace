import { useMarket } from '../../lib/MarketContext'

/**
 * The two formatters every screen in this persona draws with, bound to the
 * currency the account is actually invoiced in.
 *
 * `money` and `money0` in `enterprise.ts` wrote a `$` and there was nothing
 * else they could say. Not one business account on this marketplace is invoiced
 * in dollars — SmartBuild is in rupees, Harbourpoint in shillings, Meridian in
 * dirhams — so every figure in the persona was marked wrong, and the Billing
 * screen compared a rupee spend against a dollar budget and reported 2,273%
 * of it used.
 *
 * A hook rather than a prop threaded through forty call sites: the currency is
 * one fact about the account, the screens already hold the account, and the
 * shape lets each screen keep writing `money(x)` exactly as it did.
 *
 * `USD` while the account is still loading, because a formatter cannot return
 * nothing — the figures it would mark are not on screen yet either.
 */
export function useAccountMoney(currency: string | null | undefined): {
  money: (n: number) => string
  money0: (n: number) => string
} {
  const { fmtIn } = useMarket()
  const c = currency ?? 'USD'
  return {
    money: n => fmtIn(n, c),
    money0: n => fmtIn(n, c, { decimals: false }),
  }
}
