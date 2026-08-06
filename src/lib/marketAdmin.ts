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

/* ------------------------------------------------- holes in the book --- */

/**
 * A market×currency pair a shopper can choose but the catalogue cannot serve.
 *
 * Adding a currency to a market is one click, and it opens a shelf the price
 * book may not cover. `reprice` falls back to the product's base row when the
 * book has no price in the chosen currency, so the shopper is shown a plausible
 * number in the wrong money — the failure with no symptom, and the one nothing
 * on the operator's screen could see.
 *
 * `20260802430000` found exactly one such hole (a free product never given a
 * dollar price, because nothing had asked for one until a market started taking
 * dollars) and asserts against it in the database. This is the same question
 * asked in front of the operator, so the gap is visible before somebody buys
 * through it rather than after.
 */
export interface BookGap {
  market_code: string
  currency: string
  missing: number
  of: number
}

export function bookGaps(
  markets: readonly Market[],
  accepted: readonly MarketCurrency[],
  products: readonly { id: string }[],
  prices: readonly { product_id: string; currency: string }[],
): BookGap[] {
  const priced = new Set(prices.map(p => `${p.product_id}|${p.currency}`))
  const out: BookGap[] = []
  for (const m of markets) {
    for (const currency of currenciesOf(m.code, accepted)) {
      const missing = products.filter(p => !priced.has(`${p.id}|${currency}`)).length
      if (missing > 0) out.push({ market_code: m.code, currency, missing, of: products.length })
    }
  }
  /* Worst first: an operator with one afternoon should fix the shelf that is
     emptiest, and a market quoted in that currency by default before one where
     it is a second choice. */
  return out.sort((a, b) => b.missing - a.missing || a.market_code.localeCompare(b.market_code))
}

/* ------------------------------------------------- rates on file --- */

/**
 * Whether the marketplace can settle into a currency at all.
 *
 * Since `20260802420000` a seller is paid in the money their bank takes, and
 * that conversion needs a rate at or before the period end. A currency a market
 * accepts but the treasury has no rate for is a currency the marketplace can
 * charge in and cannot pay out of — which is a state worth naming on the screen
 * that grants it, not one to discover when a settlement run refuses.
 */
export function unsettleable(
  accepted: readonly MarketCurrency[],
  rates: readonly { base: string; quote: string }[],
  reporting: string,
): string[] {
  const pairs = new Set(rates.map(r => `${r.base}|${r.quote}`))
  return [...new Set(accepted.map(a => a.currency))]
    .filter(c => c !== reporting && !pairs.has(`${reporting}|${c}`))
    .sort()
}

/** The most recent fix on file for each currency the marketplace trades in. */
export function latestFixes(
  rates: readonly { base: string; quote: string; rate: number; as_of: string }[],
  reporting: string,
): { currency: string; rate: number; as_of: string }[] {
  const best = new Map<string, { rate: number; as_of: string }>()
  for (const r of rates) {
    if (r.base !== reporting) continue
    const held = best.get(r.quote)
    if (!held || r.as_of > held.as_of) best.set(r.quote, { rate: Number(r.rate), as_of: r.as_of })
  }
  return [...best.entries()]
    .map(([currency, v]) => ({ currency, ...v }))
    .sort((a, b) => a.currency.localeCompare(b.currency))
}

/* --------------------------------------------- what the audit view found -- */

export interface Finding {
  finding: string
  subject: string
  detail: string
}

export interface FindingGroup {
  finding: string
  rows: Finding[]
  /* Whether this kind of drift means somebody is currently being quoted, paid
     or billed wrongly, or whether it is a record that reads oddly. Both are
     worth fixing; only one is worth interrupting somebody for. */
  live: boolean
}

/* The findings that describe money moving now, rather than a record that reads
   oddly after the fact. A listing priced into a market its seller cannot sell
   in is a thing a shopper can buy today; a settlement raised in a currency no
   linked market trades is last quarter's paperwork.

   Matched on the phrase the view emits. If a finding is added to the view and
   not named here it is treated as not live, which errs towards not shouting. */
const LIVE = [
  'listing priced into a market its seller cannot sell in',
  'listed in a market it has no price for',
  'live listing behind a seller that is not live',
  'consumer order in a currency their market does not trade',
  'enterprise invoice in a currency their market does not take',
]

export const isLive = (finding: string): boolean => LIVE.includes(finding)

/**
 * The view's rows, gathered by kind.
 *
 * One row per broken fact is the right shape for a query and the wrong shape
 * for a screen: forty listings behind one suspended seller is one problem, and
 * printing it forty times buries the other three. Live kinds sort first, then
 * the largest, so the thing to do next is at the top.
 */
export function groupFindings(rows: readonly Finding[]): FindingGroup[] {
  const by = new Map<string, Finding[]>()
  for (const r of rows) {
    const held = by.get(r.finding)
    if (held) held.push(r)
    else by.set(r.finding, [r])
  }
  return [...by.entries()]
    .map(([finding, rs]) => ({ finding, rows: rs, live: isLive(finding) }))
    .sort((a, b) =>
      Number(b.live) - Number(a.live)
      || b.rows.length - a.rows.length
      || a.finding.localeCompare(b.finding))
}

/**
 * What to say above the list.
 *
 * An empty audit is the normal state and deserves a sentence that means
 * something rather than a blank panel — "nothing to answer for" reads as a
 * result, "no results" reads as a query that has not run.
 */
export function auditSummary(groups: readonly FindingGroup[]): {
  tone: 'ok' | 'warn' | 'bad'; text: string
} {
  const rows = groups.reduce((a, g) => a + g.rows.length, 0)
  if (rows === 0) {
    return {
      tone: 'ok',
      text: 'Every listing is priced in a currency its market trades, every seller earns and is paid where it is approved to sell, and no bill or order is in a currency its market does not take.',
    }
  }
  const live = groups.filter(g => g.live).reduce((a, g) => a + g.rows.length, 0)
  return {
    tone: live > 0 ? 'bad' : 'warn',
    text: live > 0
      ? `${live} of ${rows} ${rows === 1 ? 'fact' : 'facts'} affect what somebody can buy or is being charged right now.`
      : `${rows} ${rows === 1 ? 'record reads' : 'records read'} oddly. Nothing here changes what anybody is quoted or paid today.`,
  }
}
