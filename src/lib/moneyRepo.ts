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
