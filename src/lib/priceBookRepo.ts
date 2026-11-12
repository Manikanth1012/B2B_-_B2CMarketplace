// The only module that reads or writes account prices, buying rules and
// preferences.
//
// Every rule lives in the database (guard_account_price, set_account_price and
// friends); nothing here decides whether a change is allowed. It asks, and
// hands back the database's own words when the answer is no. No function
// throws, and none reports success it did not see — a write that changes no row
// (row-level security hides rows it will not let you touch) is an error.
//
// Until the price-book migration is applied the tables and functions do not
// exist. A read then answers as an account with no prices would — no rows, the
// default rules ('allow'), no preferences — so the shelf and the requisition
// behave exactly as they did. A write says the feature is not set up.

import { supabase } from './supabase'
import type {
  AccountPrice, BuyingRules, OffContractRule, Preference, PriceDraft, QuoteLineForPromotion,
} from './accountPrices'
import {
  toAccountPrice, toPreference, toSellerAccountPrice, toPromotable, settleRows, settleRules,
  setPriceArgs, endPriceArgs, promoteArgs, isMissing, friendly, NOT_SET_UP,
} from './priceBookPayload'
import type { SellerAccountPrice, WireError } from './priceBookPayload'

export type { SellerAccountPrice }

type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }
type Row = Record<string, unknown>
type Res = { data: unknown; error: WireError | null; status?: number }

const NOTHING = 'Nothing changed — you are not allowed to make that change on this account, or it no longer exists.'

const errorText = (e: unknown): string => (e instanceof Error ? e.message : 'The request failed.')
const fail = (error: WireError | null | undefined, status?: number): { ok: false; error: string } =>
  ({ ok: false, error: isMissing(error, status) ? NOT_SET_UP : friendly(error?.message ?? 'The request failed.') })

/** A read: rows mapped, a missing table read as no rows. */
async function readRows<T>(q: PromiseLike<Res>, map: (r: Row) => T | null): Promise<Result<T[]>> {
  try {
    return settleRows(await q, map)
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

/* ----------------------------------------------------------------- prices -- */

/** RLS scopes the rows: a buyer reads its own account's, a seller its listings'. The operator passes an id. */
export function loadAccountPrices(accountId?: string): Promise<Result<AccountPrice[]>> {
  let q = supabase.from('account_prices').select('*')
  if (accountId) q = q.eq('account_id', accountId)
  return readRows(q.order('starts_on', { ascending: false }), toAccountPrice)
}

export async function setAccountPrice(d: PriceDraft): Promise<Result<string>> {
  try {
    const { data, error, status } = await supabase.rpc('set_account_price', setPriceArgs(d))
    if (error) return fail(error, status)
    if (data === null || data === undefined) return { ok: false, error: NOTHING }
    return { ok: true, value: String(data) }
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

export async function endAccountPrice(id: string, reason: string): Promise<Result> {
  try {
    const { error, status } = await supabase.rpc('end_account_price', endPriceArgs(id, reason))
    if (error) return fail(error, status)
    return { ok: true, value: undefined }
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

export async function promoteQuoteLine(
  quoteLineId: string, starts_on: string, ends_on: string | null, note: string,
): Promise<Result<string>> {
  try {
    const { data, error, status } = await supabase.rpc('promote_quote_line', promoteArgs(quoteLineId, starts_on, ends_on, note))
    if (error) return fail(error, status)
    if (data === null || data === undefined) return { ok: false, error: NOTHING }
    return { ok: true, value: String(data) }
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

/** The account's accepted quote lines, for turning into standing prices. */
export function loadPromotable(accountId: string): Promise<Result<QuoteLineForPromotion[]>> {
  return readRows(
    supabase.from('enquiry_lines')
      .select('id, enquiry_id, product_id, name, quoted_unit_price, enquiries!inner(account_id, status, type, currency)')
      .eq('enquiries.account_id', accountId)
      .eq('enquiries.status', 'accepted')
      .eq('enquiries.type', 'quote')
      .order('enquiry_id'),
    toPromotable,
  )
}

/** A seller's listings sold at account prices; the company name comes through the function. */
export function loadSellerAccountPrices(): Promise<Result<SellerAccountPrice[]>> {
  return readRows(supabase.rpc('seller_account_prices'), toSellerAccountPrice)
}

/* ------------------------------------------------------------------ rules -- */

/** A missing row — or a missing table — reads as DEFAULT_RULES. */
export async function loadBuyingRules(accountId?: string): Promise<Result<BuyingRules>> {
  try {
    let q = supabase.from('enterprise_buying_rules').select('*')
    if (accountId) q = q.eq('account_id', accountId)
    return settleRules(await q.limit(1).maybeSingle(), accountId ?? '')
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

/** updated_by and updated_on are stamped by guard_buying_rules. */
export async function saveBuyingRules(r: { account_id: string; off_contract: OffContractRule; note: string | null }): Promise<Result> {
  try {
    const note = r.note === null ? null : r.note.trim() || null
    const { data, error, status } = await supabase.from('enterprise_buying_rules')
      .upsert({ account_id: r.account_id, off_contract: r.off_contract, note }, { onConflict: 'account_id' })
      .select('account_id')
    if (error) return fail(error, status)
    if (!data?.length) return { ok: false, error: NOTHING }
    return { ok: true, value: undefined }
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

/* ------------------------------------------------------------ preferences -- */

export function loadPreferences(accountId?: string): Promise<Result<Preference[]>> {
  let q = supabase.from('account_preferences').select('*')
  if (accountId) q = q.eq('account_id', accountId)
  return readRows(q.order('added_on'), toPreference)
}

/** added_by and added_on are stamped by guard_account_preference. */
export async function addPreference(p: {
  account_id: string; kind: 'seller' | 'product'; partner_id?: string; product_id?: string; note?: string
}): Promise<Result<Preference>> {
  try {
    const note = p.note?.trim() || null
    const { data, error, status } = await supabase.from('account_preferences').insert({
      account_id: p.account_id, kind: p.kind,
      partner_id: p.kind === 'seller' ? p.partner_id ?? null : null,
      product_id: p.kind === 'product' ? p.product_id ?? null : null,
      note,
    }).select('*')
    if (error) return fail(error, status)
    const row = (data ?? [])[0] as Row | undefined
    if (!row) return { ok: false, error: NOTHING }
    return { ok: true, value: toPreference(row) }
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

/** A product the account has a price on: its name, and its published price and floor per
    currency. Read by id, independent of the live shelf, so a paused or delisted
    product still has a name beside its earlier prices. A product the account
    may not read is simply absent; the caller says so. */
export interface PricedProduct { id: string; name: string; published: Record<string, number>; floors: Record<string, number | null> }

export async function loadProductsByIds(ids: readonly string[]): Promise<Result<PricedProduct[]>> {
  const want = Array.from(new Set(ids))
  if (want.length === 0) return { ok: true, value: [] }
  try {
    const [p, pp] = await Promise.all([
      supabase.from('products').select('id, name').in('id', want),
      supabase.from('product_prices').select('product_id, currency, price, floor_price').in('product_id', want),
    ])
    if (p.error) return { ok: false, error: p.error.message }
    if (pp.error) return { ok: false, error: pp.error.message }
    const published = new Map<string, Record<string, number>>()
    const floors = new Map<string, Record<string, number | null>>()
    for (const r of (pp.data ?? []) as Row[]) {
      const id = String(r.product_id)
      published.set(id, { ...(published.get(id) ?? {}), [String(r.currency)]: Number(r.price) })
      floors.set(id, { ...(floors.get(id) ?? {}), [String(r.currency)]: r.floor_price === null || r.floor_price === undefined ? null : Number(r.floor_price) })
    }
    return {
      ok: true,
      value: ((p.data ?? []) as Row[]).map(r => ({
        id: String(r.id), name: String(r.name), published: published.get(String(r.id)) ?? {}, floors: floors.get(String(r.id)) ?? {},
      })),
    }
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}

export async function removePreference(id: string): Promise<Result> {
  try {
    const { data, error, status } = await supabase.from('account_preferences').delete().eq('id', id).select('id')
    if (error) return fail(error, status)
    if (!data?.length) return { ok: false, error: NOTHING }
    return { ok: true, value: undefined }
  } catch (e) {
    return { ok: false, error: errorText(e) }
  }
}
