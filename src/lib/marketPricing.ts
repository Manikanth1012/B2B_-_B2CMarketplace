/* Who may set which price, in which market, and what makes it acceptable.
 *
 * Distinct from `pricing.ts`, which is about what a single price *means* — the
 * tax basis and the floor-to-list band on the base listing. This is about the
 * price book: one row per product per currency, and the question of who is
 * allowed to write one.
 *
 * The database enforces all of it. RLS decides which rows a seller may touch —
 * their own products, in markets they are approved for — and
 * `guard_price_book` decides whether the number is allowed, because RLS cannot
 * compare a value against a floor on the row being written. This module states
 * the same rules in front of the form, so somebody is told "below your floor"
 * while typing rather than after a round trip that returns a Postgres
 * exception.
 *
 * A rule written twice drifts, so the integration suite reads the two against
 * each other by actually attempting the writes as a signed-in seller.
 *
 * Pure. No Supabase import.
 */
import { roundMinor, charmPrice } from './money'
import { currenciesOf } from './money'
import type { Currency, Market, MarketCurrency, Rate } from './money'

export interface PartnerMarket {
  partner_id: string
  market_code: string
  state: 'requested' | 'approved' | 'suspended'
  approved_at: string | null
  approved_by: string | null
  note: string
}

export interface BookRow {
  product_id: string
  currency: string
  price: number
  was_price: number | null
  floor_price: number | null
  list_price: number | null
}

/** A row as an editor holds it, while it is still text somebody is typing. */
export interface PriceDraft {
  currency: string
  price: string
  was_price: string
  floor_price: string
  list_price: string
}

export const emptyDraft = (currency: string): PriceDraft =>
  ({ currency, price: '', was_price: '', floor_price: '', list_price: '' })

export const draftFrom = (row: BookRow): PriceDraft => ({
  currency: row.currency,
  price: String(row.price),
  was_price: row.was_price === null ? '' : String(row.was_price),
  floor_price: row.floor_price === null ? '' : String(row.floor_price),
  list_price: row.list_price === null ? '' : String(row.list_price),
})

/* ------------------------------------------------------------- who may --- */

/** The markets a seller may actually trade in. */
export const marketsFor = (
  grants: readonly PartnerMarket[], partnerId: string | null, markets: readonly Market[],
): Market[] =>
  markets.filter(m => grants.some(g =>
    g.partner_id === partnerId && g.market_code === m.code && g.state === 'approved'))

/**
 * The currencies a given editor may write a price in.
 *
 * The operator prices in every currency the marketplace has opened a market in.
 * A seller prices only where they are approved, which is why the two consoles
 * cannot share one list.
 */
export function priceableCurrencies(
  who: { persona: string; partnerId?: string | null },
  markets: readonly Market[],
  grants: readonly PartnerMarket[],
  accepted: readonly MarketCurrency[] = [],
): string[] {
  /* Every currency of every market the party may sell in — not one per market.
     Kenya takes shillings and dollars, so a seller approved there prices in
     both or their dollar-paying customers see an empty shelf. */
  const reach = who.persona === 'operator'
    ? markets
    : marketsFor(grants, who.partnerId ?? null, markets)

  const out = reach.flatMap(m => {
    const takes = currenciesOf(m.code, accepted)
    /* Falling back to the market's default keeps every caller that has not been
       given the accepted list working, rather than silently returning nothing
       and making every price unwritable. */
    return takes.length ? takes : [m.currency]
  })
  return [...new Set(out)]
}

/* ---------------------------------------------------------- what is ok --- */

export type PriceField = 'price' | 'was_price' | 'floor_price' | 'list_price' | 'currency'

export interface PriceProblem {
  field: PriceField
  message: string
}

const parse = (s: string): number | null => {
  const t = s.trim()
  if (t === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

/**
 * Everything wrong with a draft, in the order a person would meet it.
 *
 * Every problem rather than the first: a form that reveals one fault at a time
 * makes somebody submit four times to learn four things.
 */
export function priceProblems(
  draft: PriceDraft, allowed: readonly string[], currencies: readonly Currency[],
): PriceProblem[] {
  const out: PriceProblem[] = []

  if (!allowed.includes(draft.currency)) {
    out.push({ field: 'currency', message: 'You are not approved to sell in that market.' })
  }

  const price = parse(draft.price)
  const was = parse(draft.was_price)
  const floor = parse(draft.floor_price)
  const list = parse(draft.list_price)

  if (price === null) out.push({ field: 'price', message: 'A listing needs a price.' })
  else if (Number.isNaN(price)) out.push({ field: 'price', message: 'That is not a number.' })
  else if (price <= 0) out.push({ field: 'price', message: 'A listed price has to be more than nothing.' })

  for (const [field, value] of [
    ['was_price', was], ['floor_price', floor], ['list_price', list],
  ] as [PriceField, number | null][]) {
    if (value !== null && Number.isNaN(value)) out.push({ field, message: 'That is not a number.' })
    else if (value !== null && value < 0) out.push({ field, message: 'That cannot be negative.' })
  }

  const ok = (n: number | null): n is number => n !== null && !Number.isNaN(n)

  if (ok(price) && ok(floor) && price < floor) {
    out.push({ field: 'price', message: 'Below the floor for this market — the marketplace would settle this at a loss.' })
  }
  if (ok(price) && ok(list) && list < price) {
    out.push({ field: 'list_price', message: 'The list price cannot be under what you are charging.' })
  }
  /* Flagged rather than silently dropped: in an editor somebody typed it on
     purpose, and a strikethrough that is not above the price claims a saving
     nobody gave. */
  if (ok(price) && ok(was) && was <= price) {
    out.push({ field: 'was_price', message: 'A "was" price has to be above the price, or it is not a saving.' })
  }

  /* More decimal places than the currency has cannot be charged, so it would be
     rounded on the way in without anybody being told. */
  const cur = currencies.find(c => c.code === draft.currency)
  if (cur && ok(price) && roundMinor(price, cur.minor_units) !== price) {
    out.push({
      field: 'price',
      message: `${cur.name} is charged to ${cur.minor_units} decimal place${cur.minor_units === 1 ? '' : 's'}.`,
    })
  }

  return out
}

export const problemOn = (problems: readonly PriceProblem[], field: PriceField): string | null =>
  problems.find(p => p.field === field)?.message ?? null

export const priceIsUsable = (
  draft: PriceDraft, allowed: readonly string[], currencies: readonly Currency[],
): boolean => priceProblems(draft, allowed, currencies).length === 0

/** The draft as it will be stored, once it is known to be usable. */
export function toRow(draft: PriceDraft, productId: string): BookRow {
  const n = (s: string) => { const v = parse(s); return v === null || Number.isNaN(v) ? null : v }
  return {
    product_id: productId,
    currency: draft.currency,
    price: n(draft.price)!,
    was_price: n(draft.was_price),
    floor_price: n(draft.floor_price),
    list_price: n(draft.list_price),
  }
}

/* --------------------------------------------------------- suggesting --- */

/**
 * A starting price for a market that has none.
 *
 * Offered, never applied. A converted price is a guess about a market the
 * seller knows better than the marketplace does — and the reason the price book
 * exists at all is that ₹1,082.67 is not a price anybody lists. So the
 * suggestion is charm-rounded and then sits in the field to be changed.
 */
export function suggestPrice(
  base: { amount: number; currency: string }, target: string,
  rates: readonly Rate[], asOf: string,
): { price: number; rate: number; as_of: string } | null {
  if (base.amount <= 0) return null
  if (base.currency === target) return { price: base.amount, rate: 1, as_of: asOf }

  const newest = (a: Rate, b: Rate) => (a.as_of > b.as_of ? a : b)
  const direct = rates.filter(r => r.base === base.currency && r.quote === target && r.as_of <= asOf)
  const reverse = rates.filter(r => r.base === target && r.quote === base.currency && r.as_of <= asOf)

  if (direct.length) {
    const r = direct.reduce(newest)
    return { price: charmPrice(base.amount * r.rate, target), rate: r.rate, as_of: r.as_of }
  }
  if (reverse.length) {
    const r = reverse.reduce(newest)
    return { price: charmPrice(base.amount / r.rate, target), rate: 1 / r.rate, as_of: r.as_of }
  }
  return null
}

/** Which of the allowed currencies have no price yet — the gap an editor is for. */
export function missingPrices(
  rows: readonly BookRow[], productId: string, allowed: readonly string[],
): string[] {
  const have = new Set(rows.filter(r => r.product_id === productId).map(r => r.currency))
  return allowed.filter(c => !have.has(c))
}

/**
 * Whether a listing can go on sale in a market.
 *
 * Three things, and they fail differently: the seller has to be approved there,
 * the listing has to have a price in what that market quotes by default, and —
 * where the market takes more than one currency — it ought to have a price in
 * the others too. Telling the first two apart is the difference between "ask the
 * marketplace" and "fill in a number"; the third is not a refusal at all, which
 * is why it comes back alongside `ok: true`.
 *
 * The default currency is the one that must be priced. Without it a shopper who
 * has chosen nothing is shown a card with no price on it. A missing *second*
 * currency only costs the seller the shoppers who switched.
 */
export function sellableIn(
  product: { id: string; partner_id: string | null },
  market: Market,
  grants: readonly PartnerMarket[],
  rows: readonly BookRow[],
  accepted: readonly MarketCurrency[] = [],
): { ok: true; gaps: string[] } | { ok: false; reason: string } {
  if (product.partner_id !== null) {
    const grant = grants.find(g => g.partner_id === product.partner_id && g.market_code === market.code)
    if (!grant) return { ok: false, reason: `Not selling in ${market.name}.` }
    if (grant.state === 'requested') return { ok: false, reason: `${market.name} approval not granted yet.` }
    if (grant.state === 'suspended') return { ok: false, reason: `Suspended in ${market.name}.` }
  }

  const takes = currenciesOf(market.code, accepted)
  const wanted = takes.length ? takes : [market.currency]
  const priced = new Set(rows.filter(r => r.product_id === product.id).map(r => r.currency))

  /* `wanted[0]` is the default — `currenciesOf` sorts it first. */
  if (!priced.has(wanted[0])) return { ok: false, reason: `No ${wanted[0]} price set.` }

  return { ok: true, gaps: wanted.slice(1).filter(c => !priced.has(c)) }
}
