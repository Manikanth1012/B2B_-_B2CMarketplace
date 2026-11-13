/**
 * The only module that reads and writes kept baskets: the business buyer's
 * requisition basket, the stock flags on it and on the shopper's cart, and the
 * operator's view of both (migration 20261113200000).
 *
 * The tables have no write policies; every write is a function call. Before
 * the migration is applied every call fails with "does not exist" (or
 * PostgREST's "could not find … in the schema cache"), and `missing` says so,
 * so a caller can carry on exactly as before — the basket in memory, no flags,
 * the operator screen saying it is not set up yet. Rules live in baskets.ts.
 */
import { supabase } from './supabase'
import type { BasketLine } from './requisitionBasket'
import { lineToSave } from './baskets'
import type { KeptBasket, KeptLine } from './baskets'

export type Kept<T> = { ok: true; value: T } | { ok: false; missing: boolean; error: string }

type PgError = { message?: string; code?: string } | null | undefined

/** Whether an error means the baskets migration is not applied yet. */
export function isMissing(error: PgError): boolean {
  if (!error) return false
  const m = (error.message ?? '').toLowerCase()
  return error.code === '42P01' || error.code === '42883' || error.code === '42703'
    || error.code === 'PGRST202' || error.code === 'PGRST205' || error.code === 'PGRST200'
    || m.includes('does not exist') || m.includes('schema cache')
}

const fail = <T>(error: PgError | unknown): Kept<T> => {
  if (error && typeof error === 'object' && 'message' in (error as object)) {
    const e = error as { message?: string; code?: string }
    return { ok: false, missing: isMissing(e), error: e.message ?? 'The request failed.' }
  }
  return { ok: false, missing: false, error: error instanceof Error ? error.message : 'The request failed.' }
}

const KEPT_LINE = 'id, product_id, name, seller, partner_id, quantity, unit_price, model, vertical, unit, quote_line_id, bundle_selection_id, bundle, on_contract, off_contract_reason, stock_note, was_quantity, flagged_at, sort_order'

/* ------------------------------------------------- the buyer's basket -- */

/** The signed-in business buyer's kept basket; null when they have none. */
export async function loadRequisitionBasket(): Promise<Kept<KeptBasket | null>> {
  try {
    const { data: session } = await supabase.auth.getSession()
    const uid = session.session?.user.id
    if (!uid) return { ok: true, value: null }
    const { data, error } = await supabase.from('requisition_baskets')
      .select(`id, account_id, currency, updated_at, reminded_at, lines:requisition_basket_lines(${KEPT_LINE})`)
      .eq('user_id', uid)
      .maybeSingle()
    if (error) return fail(error)
    return { ok: true, value: (data as unknown as KeptBasket | null) ?? null }
  } catch (e) {
    return fail(e)
  }
}

/** Replace the buyer's kept basket with these lines (none deletes it). Returns what the database kept. */
export async function saveRequisitionBasket(currency: string, lines: readonly BasketLine[]): Promise<Kept<KeptBasket | null>> {
  try {
    const { data, error } = await supabase.rpc('save_requisition_basket', {
      p_currency: currency || null, p_lines: lines.map(lineToSave),
    })
    if (error) return fail(error)
    const basket = (data as { basket?: KeptBasket | null } | null)?.basket ?? null
    return { ok: true, value: basket }
  } catch (e) {
    return fail(e)
  }
}

/** After a requisition is raised: the kept basket goes. */
export async function clearRequisitionBasket(): Promise<Kept<number>> {
  try {
    const { data, error } = await supabase.rpc('clear_requisition_basket')
    if (error) return fail(error)
    return { ok: true, value: Number((data as { deleted?: number } | null)?.deleted ?? 0) }
  } catch (e) {
    return fail(e)
  }
}

/** Accept a stock flag: the line keeps the quantity it was cut to. Refused while it still cannot be bought. */
export async function acceptBasketFlag(kind: 'cart' | 'requisition', lineId: string): Promise<Kept<{ quantity: number }>> {
  try {
    const { data, error } = await supabase.rpc('accept_basket_flag', { p_kind: kind, p_line_id: lineId })
    if (error) return fail(error)
    return { ok: true, value: { quantity: Number((data as { quantity?: number } | null)?.quantity ?? 0) } }
  } catch (e) {
    return fail(e)
  }
}

/* ------------------------------------------------- the operator's view -- */

export interface WatchedLine {
  id: string
  product_id: string
  name: string
  quantity: number
  unit_price: number | null
  stock_note: string | null
  was_quantity: number | null
  bundle_selection_id: string | null
}

export interface BusinessBasketRow {
  id: string
  user_id: string
  owner: string
  email: string | null
  account: string
  currency: string
  updated_at: string
  reminded_at: string | null
  lines: WatchedLine[]
}

export interface ShopperCartLine extends WatchedLine {
  user_id: string | null
  saved: boolean
  updated_at: string | null
  created_at: string | null
}

export interface ShopperOwner { name: string; email: string | null; currency: string | null }

export interface WatchedBaskets {
  business: BusinessBasketRow[]
  /** Every cart line, flat; group with `cartsByUser`. */
  cartLines: ShopperCartLine[]
  shoppers: Map<string, ShopperOwner>
  /** When each shopper was last reminded. */
  cartReminders: Map<string, string>
}

const str = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const num = (v: unknown): number | null => (v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v))

/** Every kept basket, for the operator: business baskets with their owners, and shoppers' carts. */
export async function loadWatchedBaskets(): Promise<Kept<WatchedBaskets>> {
  try {
    const [bk, members, accounts, cart, reminders, profiles] = await Promise.all([
      supabase.from('requisition_baskets')
        .select('id, account_id, user_id, currency, updated_at, reminded_at, lines:requisition_basket_lines(id, product_id, name, quantity, unit_price, stock_note, was_quantity, bundle_selection_id, sort_order)')
        .order('updated_at', { ascending: false }),
      supabase.from('enterprise_users').select('user_id, account_id, name, email'),
      supabase.from('enterprise_accounts').select('id, company'),
      supabase.from('cart_items')
        .select('id, user_id, product_id, quantity, saved, created_at, updated_at, stock_note, was_quantity, bundle_selection_id, product:products(name, price, currency)'),
      supabase.from('cart_reminders').select('user_id, reminded_at'),
      supabase.from('consumer_profile').select('user_id, name, email, currency'),
    ])
    const first = [bk.error, cart.error, reminders.error].find(Boolean)
    if (first) return fail(first)

    const people = new Map<string, { name: string; email: string | null }>()
    for (const m of (members.data ?? []) as Record<string, unknown>[]) {
      if (m.user_id) people.set(`${m.user_id}|${m.account_id}`, { name: String(m.name ?? ''), email: str(m.email) })
    }
    const company = new Map<string, string>()
    for (const a of (accounts.data ?? []) as Record<string, unknown>[]) company.set(String(a.id), String(a.company ?? a.id))

    const business: BusinessBasketRow[] = ((bk.data ?? []) as Record<string, unknown>[]).map(b => {
      const who = people.get(`${b.user_id}|${b.account_id}`)
      const lines = ((b.lines ?? []) as Record<string, unknown>[])
        .sort((x, y) => Number(x.sort_order ?? 0) - Number(y.sort_order ?? 0))
        .map(l => ({
          id: String(l.id), product_id: String(l.product_id), name: String(l.name ?? l.product_id),
          quantity: Number(l.quantity), unit_price: num(l.unit_price), stock_note: str(l.stock_note),
          was_quantity: num(l.was_quantity), bundle_selection_id: str(l.bundle_selection_id),
        }))
      return {
        id: String(b.id), user_id: String(b.user_id), owner: who?.name || 'Unknown buyer', email: who?.email ?? null,
        account: company.get(String(b.account_id)) ?? String(b.account_id), currency: String(b.currency),
        updated_at: String(b.updated_at), reminded_at: str(b.reminded_at), lines,
      }
    })

    const shoppers = new Map<string, ShopperOwner>()
    for (const p of (profiles.data ?? []) as Record<string, unknown>[]) {
      if (p.user_id && !shoppers.has(String(p.user_id))) {
        shoppers.set(String(p.user_id), { name: String(p.name ?? ''), email: str(p.email), currency: str(p.currency) })
      }
    }

    /* Each line priced in its owner's money: the product_prices row for that
       currency, else the listing's base price when the base is in it. */
    const rows = (cart.data ?? []) as Record<string, unknown>[]
    const ids = [...new Set(rows.map(r => String(r.product_id)))]
    const prices = new Map<string, number>()
    if (ids.length) {
      const pp = await supabase.from('product_prices').select('product_id, currency, price').in('product_id', ids)
      for (const r of (pp.data ?? []) as Record<string, unknown>[]) prices.set(`${r.product_id}|${r.currency}`, Number(r.price))
    }
    const cartLines: ShopperCartLine[] = rows.map(r => {
      const product = (r.product ?? null) as Record<string, unknown> | null
      const owner = r.user_id ? shoppers.get(String(r.user_id)) : undefined
      const cur = owner?.currency ?? str(product?.currency) ?? null
      const own = cur ? prices.get(`${r.product_id}|${cur}`) : undefined
      const base = product && str(product.currency) === cur ? num(product.price) : null
      return {
        id: String(r.id), user_id: str(r.user_id), product_id: String(r.product_id),
        name: String(product?.name ?? r.product_id), quantity: Number(r.quantity),
        unit_price: own ?? base, stock_note: str(r.stock_note), was_quantity: num(r.was_quantity),
        bundle_selection_id: str(r.bundle_selection_id), saved: !!r.saved,
        updated_at: str(r.updated_at), created_at: str(r.created_at),
      }
    })

    const cartReminders = new Map<string, string>()
    for (const r of (reminders.data ?? []) as Record<string, unknown>[]) {
      const at = str(r.reminded_at)
      /* A row is made at '-infinity' while the first reminder is being written. */
      if (r.user_id && at && !at.startsWith('-')) cartReminders.set(String(r.user_id), at)
    }

    return { ok: true, value: { business, cartLines, shoppers, cartReminders } }
  } catch (e) {
    return fail(e)
  }
}

/** The operator's in-app reminder to a basket's owner. Refused within 24 hours of the last one. */
export async function remindBasketOwner(kind: 'cart' | 'requisition', id: string):
  Promise<Kept<{ reminded_at: string; lines: number }>> {
  try {
    const { data, error } = await supabase.rpc('remind_basket_owner', { p_kind: kind, p_id: id })
    if (error) return fail(error)
    const d = (data ?? {}) as { reminded_at?: string; lines?: number }
    return { ok: true, value: { reminded_at: String(d.reminded_at ?? new Date().toISOString()), lines: Number(d.lines ?? 0) } }
  } catch (e) {
    return fail(e)
  }
}

export type { KeptBasket, KeptLine }
