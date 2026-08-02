/* What the operator may do to a market's currencies, and to who sells where.
 *
 * The database is the authority: `guard_market_currency` keeps exactly one
 * default per market, `guard_market_currency_removal` refuses to leave a market
 * with nothing to trade in or to orphan bills already raised in a currency. This
 * module states the same rules in front of the screen, so an operator is told
 * "Kenya has bills in dollars" before clicking rather than after.
 *
 * It also answers the question the operator screen exists for and the per-seller
 * tab cannot: across the whole marketplace, who is approved where, and what does
 * each grant leave unpriced.
 *
 * Pure. No Supabase import.
 */
import { currenciesOf } from './money'
import type { Market, MarketCurrency } from './money'
import type { PartnerMarket } from './marketPricing'

/* ------------------------------------------------- adding and removing --- */

/** The currencies a market does not yet take, and so could be given. */
export function addableTo(
  code: string, accepted: readonly MarketCurrency[], all: readonly { code: string }[],
): string[] {
  const have = new Set(currenciesOf(code, accepted))
  return all.map(c => c.code).filter(c => !have.has(c))
}

export interface RemovalCheck {
  ok: boolean
  /** Why not, in a sentence somebody can act on. */
  reason?: string
  /**
   * What the removal would take off the shelf even though it is allowed.
   *
   * Distinct from `reason`: this does not block. A listing priced in a currency
   * the market stops taking is not corrupt data, it is a price nobody will be
   * quoted — worth saying out loud, not worth refusing over.
   */
  warning?: string
}

/**
 * Whether a currency can come off a market.
 *
 * Three questions, and only two of them are refusals. A market must keep
 * something to trade in, and money already billed in a currency cannot be left
 * pointing at a market that no longer takes it — those are the guard's rules,
 * repeated here. Listings priced in it are a warning, because withdrawing a
 * price is a thing the operator may well mean to do.
 */
export function canRemove(
  code: string, currency: string,
  accepted: readonly MarketCurrency[],
  counts: { bills: number; listings: number },
): RemovalCheck {
  const takes = currenciesOf(code, accepted)
  if (!takes.includes(currency)) {
    return { ok: false, reason: `This market does not take ${currency}.` }
  }
  if (takes.length <= 1) {
    return { ok: false, reason: 'A market has to accept at least one currency.' }
  }
  if (counts.bills > 0) {
    return {
      ok: false,
      reason: `${counts.bills} bill${counts.bills === 1 ? ' has' : 's have'} already been raised in ${currency} here. Removing it would leave ${counts.bills === 1 ? 'it' : 'them'} in a currency this market does not trade in.`,
    }
  }
  const isDefault = takes[0] === currency
  if (isDefault) {
    return {
      ok: false,
      reason: `${currency} is what shoppers here are quoted by default. Make another currency the default first.`,
    }
  }
  /* Not "will stop being on sale" — the market keeps its default currency, so
     those listings are still on the shelf there. What goes is the option of
     paying in this one. And the count is every listing priced in the currency
     anywhere, because a price row belongs to a currency and not to a market. */
  return {
    ok: true,
    warning: counts.listings > 0
      ? `${counts.listings} listing${counts.listings === 1 ? ' is' : 's are'} priced in ${currency}; shoppers here will no longer be able to pay in it.`
      : undefined,
  }
}

/** Whether making a currency the default would change anything. */
export const canMakeDefault = (
  code: string, currency: string, accepted: readonly MarketCurrency[],
): RemovalCheck => {
  const takes = currenciesOf(code, accepted)
  if (!takes.includes(currency)) return { ok: false, reason: `This market does not take ${currency}.` }
  if (takes[0] === currency) return { ok: false, reason: `${currency} is already the default here.` }
  return { ok: true }
}

/* --------------------------------------------------- who sells where --- */

export type GrantState = 'approved' | 'requested' | 'suspended' | 'none'

export interface Cell {
  partner_id: string
  market_code: string
  state: GrantState
  note: string
}

/**
 * Every seller against every market, including the pairs with no row.
 *
 * The absent pairs are the point. A grid built only from the grants that exist
 * shows where sellers *are* approved and is silent about where nobody has
 * asked — which is exactly the gap an operator opening this screen is looking
 * for.
 */
export function grid(
  partners: readonly { id: string }[],
  markets: readonly Market[],
  grants: readonly PartnerMarket[],
): Cell[] {
  const at = new Map(grants.map(g => [`${g.partner_id}|${g.market_code}`, g]))
  return partners.flatMap(p => markets.map(m => {
    const g = at.get(`${p.id}|${m.code}`)
    return {
      partner_id: p.id,
      market_code: m.code,
      state: (g?.state ?? 'none') as GrantState,
      note: g?.note ?? '',
    }
  }))
}

/** How many sellers are in each state in one market. */
export function tallyFor(
  code: string, cells: readonly Cell[],
): Record<GrantState, number> {
  const out: Record<GrantState, number> = { approved: 0, requested: 0, suspended: 0, none: 0 }
  for (const c of cells) if (c.market_code === code) out[c.state] += 1
  return out
}

/**
 * The requests waiting on the operator, oldest market order first.
 *
 * This is the screen's only actionable list — everything else on it is a
 * standing arrangement, and a request is somebody blocked from trading.
 */
export const outstanding = (cells: readonly Cell[]): Cell[] =>
  cells.filter(c => c.state === 'requested')

/**
 * Whether a market can be closed to a seller who is currently trading there.
 *
 * Suspending is not refused — a market is closed for reasons that outrank a
 * tidy catalogue — but the operator is told what goes off the shelf.
 */
export const suspensionCost = (
  market: Market, priced: number,
): string | null =>
  priced > 0
    ? `${priced} listing${priced === 1 ? '' : 's'} will come off the shelf in ${market.name}.`
    : null
