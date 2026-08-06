/* Reading the currency tables, and pricing a catalogue in one of them.
 *
 * The reference data — currencies, rates, markets — is small, changes rarely,
 * and is needed by nearly every screen, so it loads once and is held. The
 * price book is applied at load rather than at render: `repriceAll` hands back
 * products whose `price` and `was_price` are already in the market's currency,
 * so the forty-nine components that print a price keep printing the field they
 * always printed and there is exactly one place where a currency is chosen.
 *
 * Threading a currency through every component instead would mean forty-nine
 * chances to forget, and forgetting looks like a correct number in the wrong
 * currency — which is the failure mode with no visible symptom.
 */
import { supabase } from './supabase'
import { wasPriceFor, describeIn } from './money'
import type { Currency, Rate, Market, MarketCurrency } from './money'
import type { Product } from '../types'
import type { BookRow, PartnerMarket } from './marketPricing'
import type { Finding } from './marketAdmin'

export interface PriceRow {
  product_id: string
  currency: string
  price: number
  was_price: number | null
  floor_price: number | null
  list_price: number | null
}

export interface MoneyBook {
  currencies: Currency[]
  rates: Rate[]
  markets: Market[]
  /* Which currencies each market will take money in. A market has one default
     and may accept others. */
  accepted: MarketCurrency[]
  loadError: string | null
}

export const EMPTY_BOOK: MoneyBook = {
  currencies: [], rates: [], markets: [], accepted: [], loadError: null,
}

/** The reference data, in one round trip. Readable signed out — the storefront is public. */
export async function loadMoneyBook(): Promise<MoneyBook> {
  const [cur, fx, mkt, acc] = await Promise.all([
    supabase.from('currencies').select('*').order('sort_order'),
    supabase.from('fx_rates').select('*').order('as_of'),
    supabase.from('markets').select('*').order('sort_order'),
    supabase.from('market_currencies').select('*').order('sort_order'),
  ])
  const failed = [cur.error, fx.error, mkt.error, acc.error].find(Boolean)
  return {
    currencies: (cur.data ?? []) as Currency[],
    /* PostgREST hands numerics back as strings. A rate that is a string
       multiplies as NaN and silently prices everything at nothing. */
    rates: ((fx.data ?? []) as Rate[]).map(r => ({ ...r, rate: Number(r.rate) })),
    markets: ((mkt.data ?? []) as Market[]).map(m => ({ ...m, tax_rate: Number(m.tax_rate) })),
    accepted: (acc.data ?? []) as MarketCurrency[],
    loadError: failed ? failed.message : null,
  }
}

/**
 * The market the signed-in buyer is registered in, or null for a visitor.
 *
 * A consumer's is on their profile, a business buyer's on the account they
 * belong to; both were derived in `20260802450000` from what the marketplace
 * already bills them under, because that is the fact that decides it — a
 * customer invoiced under Indian GST is an Indian customer.
 *
 * Both reads are RLS-scoped to the caller, so a signed-out visitor gets nothing
 * back and keeps a free choice. That is the honest state: the marketplace does
 * not know who they are yet.
 */
export async function loadHomeMarket(): Promise<string | null> {
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) return null

  const [me, account] = await Promise.all([
    supabase.from('consumer_profile').select('market').maybeSingle(),
    supabase.from('enterprise_accounts').select('market').maybeSingle(),
  ])
  return (me.data as { market?: string } | null)?.market
    ?? (account.data as { market?: string } | null)?.market
    ?? null
}

/** The whole price book for one currency. */
export async function loadPriceBook(currency: string): Promise<Map<string, PriceRow>> {
  const { data } = await supabase
    .from('product_prices').select('*').eq('currency', currency)
  const out = new Map<string, PriceRow>()
  for (const r of (data ?? []) as PriceRow[]) {
    out.set(r.product_id, {
      ...r,
      price: Number(r.price),
      was_price: r.was_price === null ? null : Number(r.was_price),
      floor_price: r.floor_price === null ? null : Number(r.floor_price),
      list_price: r.list_price === null ? null : Number(r.list_price),
    })
  }
  return out
}

/**
 * Copy for one product in one currency, or nothing.
 *
 * The counterpart to `PriceRow`. A description that quotes a figure — a sum
 * insured, an excess, an overage rate — is a price wearing prose, and is chosen
 * per market for the same reason a price is. Most products quote no figure and
 * have no rows here at all.
 */
/* Re-exported so a caller that already imports the repo does not have to reach
   into `money.ts` for the one function that pairs with `loadCopyBook`. */
export { describeIn }

export interface CopyRow {
  product_id: string
  currency: string
  description: string
}

/** Every piece of per-currency copy, keyed for `describeIn`. */
export async function loadCopyBook(): Promise<Map<string, string>> {
  const { data } = await supabase.from('product_copy').select('*')
  const out = new Map<string, string>()
  for (const r of (data ?? []) as CopyRow[]) out.set(`${r.product_id}|${r.currency}`, r.description)
  return out
}

/**
 * One product, priced in the given currency.
 *
 * A product with no row in the book keeps its base price and base currency
 * rather than being converted on the spot. Converting here would put an
 * unrounded figure on a shelf next to seven chosen ones, which is worse than
 * showing the dollar price and saying so — and the migration asserts the book
 * is complete, so this is a fallback that should never fire.
 */
export function reprice(
  product: Product, book: Map<string, PriceRow>, currency: string,
  copy?: ReadonlyMap<string, string>,
): Product {
  /* Copy is applied whether or not the price book covers the product: a
     description is right or wrong for a market independently of whether that
     market has a price on file. */
  const described = copy
    ? { ...product, description: describeIn(product, copy, currency) }
    : product
  const row = book.get(product.id)
  if (!row) return { ...described, currency: described.currency ?? 'USD' }
  return {
    ...described,
    price: row.price,
    was_price: wasPriceFor(row.price, row.was_price),
    floor_price: row.floor_price ?? undefined,
    list_price: row.list_price ?? undefined,
    currency,
  }
}

export const repriceAll = (
  products: readonly Product[], book: Map<string, PriceRow>, currency: string,
  copy?: ReadonlyMap<string, string>,
): Product[] => products.map(p => reprice(p, book, currency, copy))

/* ====================================================== writing the book === */

/** Every price row for one product, in every currency it is priced in. */
export async function loadProductPrices(productId: string): Promise<BookRow[]> {
  const { data } = await supabase
    .from('product_prices').select('*').eq('product_id', productId)
  return ((data ?? []) as BookRow[]).map(r => ({
    ...r,
    price: Number(r.price),
    was_price: r.was_price === null ? null : Number(r.was_price),
    floor_price: r.floor_price === null ? null : Number(r.floor_price),
    list_price: r.list_price === null ? null : Number(r.list_price),
  }))
}

/** Which markets each seller trades in. Readable by everyone. */
export async function loadPartnerMarkets(partnerId?: string): Promise<PartnerMarket[]> {
  let q = supabase.from('partner_markets').select('*')
  if (partnerId) q = q.eq('partner_id', partnerId)
  const { data } = await q
  return (data ?? []) as PartnerMarket[]
}

export interface WriteResult { ok: boolean; reason?: string }

/**
 * Set one product's price in one currency.
 *
 * `.select('id')` and an empty result treated as refusal, because RLS does not
 * raise on a forbidden write — it narrows the rows the statement can see, so an
 * upsert a seller is not entitled to make succeeds and changes nothing. The
 * guard trigger *does* raise, which is the other branch.
 */
export async function setPrice(row: BookRow): Promise<WriteResult> {
  const { data, error } = await supabase
    .from('product_prices')
    .upsert({
      product_id: row.product_id, currency: row.currency, price: row.price,
      was_price: row.was_price, floor_price: row.floor_price, list_price: row.list_price,
    }, { onConflict: 'product_id,currency' })
    .select('product_id')

  if (error) return { ok: false, reason: tidy(error.message) }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'That price was not saved. You may not be approved to sell in this market.' }
  }
  return { ok: true }
}

/** Withdraw a listing from one market by removing its price there. */
export async function clearPrice(productId: string, currency: string): Promise<WriteResult> {
  const { data, error } = await supabase
    .from('product_prices').delete()
    .eq('product_id', productId).eq('currency', currency)
    .select('product_id')
  if (error) return { ok: false, reason: tidy(error.message) }
  if (!data || data.length === 0) {
    return { ok: false, reason: 'Nothing was removed. That price may not be yours to change.' }
  }
  return { ok: true }
}

/** A seller asking to trade somewhere new. Granting it is the operator's. */
export async function requestMarket(partnerId: string, marketCode: string): Promise<WriteResult> {
  const { data, error } = await supabase
    .from('partner_markets')
    .insert({ partner_id: partnerId, market_code: marketCode, state: 'requested' })
    .select('partner_id')
  if (error) return { ok: false, reason: tidy(error.message) }
  if (!data || data.length === 0) return { ok: false, reason: 'The request was not recorded.' }
  return { ok: true }
}

/** The operator granting, refusing or suspending a market. */
export async function decideMarket(
  partnerId: string, marketCode: string,
  state: 'approved' | 'requested' | 'suspended',
  by: string, note: string,
): Promise<WriteResult> {
  const { data, error } = await supabase
    .from('partner_markets')
    .upsert({
      partner_id: partnerId, market_code: marketCode, state, note,
      approved_at: state === 'approved' ? new Date().toISOString() : null,
      approved_by: state === 'approved' ? by : null,
    }, { onConflict: 'partner_id,market_code' })
    .select('partner_id')
  if (error) return { ok: false, reason: tidy(error.message) }
  if (!data || data.length === 0) return { ok: false, reason: 'Nothing was changed.' }
  return { ok: true }
}

/* =========================================== configuring what a market takes === */

/** Open a market to a currency it did not take before. */
export async function addMarketCurrency(
  marketCode: string, currency: string,
): Promise<WriteResult> {
  /* Never as the default. Making it the default is a separate decision and a
     separate click — an operator adding dollars to Kenya has not thereby said
     Kenyan shoppers should be quoted in dollars. */
  const { data, error } = await supabase
    .from('market_currencies')
    .insert({ market_code: marketCode, currency, is_default: false, sort_order: 9 })
    .select('market_code')
  if (error) return { ok: false, reason: tidy(error.message) }
  if (!data || data.length === 0) return { ok: false, reason: 'That currency was not added.' }
  return { ok: true }
}

/**
 * Close a market to a currency.
 *
 * `guard_market_currency_removal` refuses to leave a market with nothing, or to
 * orphan bills already raised — those come back as raised exceptions, which is
 * why the reason is worth showing rather than swallowing.
 */
export async function removeMarketCurrency(
  marketCode: string, currency: string,
): Promise<WriteResult> {
  const { data, error } = await supabase
    .from('market_currencies').delete()
    .eq('market_code', marketCode).eq('currency', currency)
    .select('market_code')
  if (error) return { ok: false, reason: tidy(error.message) }
  if (!data || data.length === 0) return { ok: false, reason: 'Nothing was removed.' }
  return { ok: true }
}

/**
 * Make a currency the one shoppers in this market are quoted by default.
 *
 * Only the new default is written. `guard_market_currency` clears the old one
 * and `sync_market_default` moves `markets.currency` to match, so doing either
 * from here would be a second statement of a rule the database already holds.
 */
export async function setDefaultCurrency(
  marketCode: string, currency: string,
): Promise<WriteResult> {
  const { data, error } = await supabase
    .from('market_currencies')
    .update({ is_default: true })
    .eq('market_code', marketCode).eq('currency', currency)
    .select('market_code')
  if (error) return { ok: false, reason: tidy(error.message) }
  if (!data || data.length === 0) return { ok: false, reason: 'The default was not changed.' }
  return { ok: true }
}

/**
 * How much would be disturbed by dropping a currency from a market: bills
 * already raised in it there, and listings currently priced in it.
 *
 * Counted rather than fetched — the screen needs the number, not the rows.
 */
export async function currencyFootprint(
  marketCode: string, currency: string,
): Promise<{ bills: number; listings: number }> {
  const [b, i, p] = await Promise.all([
    supabase.from('consumer_bills').select('id', { count: 'exact', head: true })
      .eq('market', marketCode).eq('currency', currency),
    supabase.from('enterprise_invoices').select('id', { count: 'exact', head: true })
      .eq('market', marketCode).eq('currency', currency),
    supabase.from('product_prices').select('product_id', { count: 'exact', head: true })
      .eq('currency', currency),
  ])
  return {
    /* Bills and invoices together — both are money already demanded in that
       currency, and the guard refuses on either. */
    bills: (b.count ?? 0) + (i.count ?? 0),
    /* Not per-market: a price row is one currency across every market that
       takes it, so this over-counts where two markets share a currency. Said
       as "priced in USD" on the screen rather than "priced in Kenya". */
    listings: p.count ?? 0,
  }
}

/**
 * The market/currency audit, as the database sees it.
 *
 * `market_consistency` is a view over nine tables and it reads with the
 * caller's own rights, so what comes back here is what this operator is
 * allowed to see. An empty array is the invariant rather than a failure — the
 * screen says so in words, because a blank panel reads as a query that never
 * ran.
 *
 * A load error is returned rather than thrown: the rest of this screen is the
 * grant grid, and losing the ability to approve a market because an audit
 * panel could not load would be the wrong trade.
 */
export async function loadConsistency(): Promise<{ rows: Finding[]; error?: string }> {
  const { data, error } = await supabase
    .from('market_consistency').select('finding, subject, detail')
  if (error) return { rows: [], error: tidy(error.message) }
  return { rows: (data ?? []) as Finding[] }
}

/* A guard trigger raises with a sentence written for a person; Postgres wraps
   it in its own noise. This keeps the sentence and drops the wrapper. */
function tidy(message: string): string {
  return message.replace(/^.*?violates row-level security policy.*$/i,
    'You are not allowed to change that.')
}
