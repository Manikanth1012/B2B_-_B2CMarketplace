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
import { wasPriceFor } from './money'
import type { Currency, Rate, Market } from './money'
import type { Product } from '../types'
import type { BookRow, PartnerMarket } from './marketPricing'

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
  loadError: string | null
}

export const EMPTY_BOOK: MoneyBook = { currencies: [], rates: [], markets: [], loadError: null }

/** The reference data, in one round trip. Readable signed out — the storefront is public. */
export async function loadMoneyBook(): Promise<MoneyBook> {
  const [cur, fx, mkt] = await Promise.all([
    supabase.from('currencies').select('*').order('sort_order'),
    supabase.from('fx_rates').select('*').order('as_of'),
    supabase.from('markets').select('*').order('sort_order'),
  ])
  const failed = [cur.error, fx.error, mkt.error].find(Boolean)
  return {
    currencies: (cur.data ?? []) as Currency[],
    /* PostgREST hands numerics back as strings. A rate that is a string
       multiplies as NaN and silently prices everything at nothing. */
    rates: ((fx.data ?? []) as Rate[]).map(r => ({ ...r, rate: Number(r.rate) })),
    markets: ((mkt.data ?? []) as Market[]).map(m => ({ ...m, tax_rate: Number(m.tax_rate) })),
    loadError: failed ? failed.message : null,
  }
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
 * One product, priced in the given currency.
 *
 * A product with no row in the book keeps its base price and base currency
 * rather than being converted on the spot. Converting here would put an
 * unrounded figure on a shelf next to seven chosen ones, which is worse than
 * showing the dollar price and saying so — and the migration asserts the book
 * is complete, so this is a fallback that should never fire.
 */
export function reprice(product: Product, book: Map<string, PriceRow>, currency: string): Product {
  const row = book.get(product.id)
  if (!row) return { ...product, currency: product.currency ?? 'USD' }
  return {
    ...product,
    price: row.price,
    was_price: wasPriceFor(row.price, row.was_price),
    floor_price: row.floor_price ?? undefined,
    list_price: row.list_price ?? undefined,
    currency,
  }
}

export const repriceAll = (products: readonly Product[], book: Map<string, PriceRow>, currency: string): Product[] =>
  products.map(p => reprice(p, book, currency))

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

/* A guard trigger raises with a sentence written for a person; Postgres wraps
   it in its own noise. This keeps the sentence and drops the wrapper. */
function tidy(message: string): string {
  return message.replace(/^.*?violates row-level security policy.*$/i,
    'You are not allowed to change that.')
}
