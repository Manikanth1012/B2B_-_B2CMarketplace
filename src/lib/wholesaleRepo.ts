/**
 * Reading and writing a partner's standing orders.
 *
 * Both writes go through functions rather than through the tables: taking a
 * product has to freeze its price at the moment it is taken, and stopping one
 * has to record a reason. A policy can refuse a write; it cannot fill one in.
 * So the tables are read-only to a partner and `buy_partner_product` and
 * `cancel_partner_purchase` are the two ways in.
 */
import { supabase } from './supabase'
import type { Purchase, Charge, Sellable } from './wholesale'

const num = (v: unknown) => Number(v ?? 0)

export interface WholesaleAccruing {
  partner_id: string
  period_start: string
  period_end: string
  closed_on: string
  /* What the period running now will cost, for a statement nobody has built. */
  this_period: number
  /* What earlier periods could not cover and this one inherits. */
  brought_forward: number
  active_purchases: number
}

/** The shelf, as this partner sees it. Everything sold to partners, live or not. */
export async function partnerShelf(): Promise<Sellable[]> {
  const { data, error } = await supabase
    .from('products')
    .select('id, name, status, audiences, partner_id, seller, billing_period, description, category_id')
    .contains('audiences', ['partner'])
    .order('sort_order')
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as Sellable[]
}

/** What one product costs in the currency settlements are denominated in. */
export async function shelfPrices(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from('product_prices').select('product_id, price, currency').eq('currency', 'USD')
  if (error) throw new Error(error.message)
  const out: Record<string, number> = {}
  for (const r of (data ?? []) as { product_id: string; price: string }[]) {
    out[r.product_id] = num(r.price)
  }
  return out
}

/** A partner's standing orders. RLS scopes this to their own. */
export async function purchases(partnerId?: string): Promise<Purchase[]> {
  let q = supabase.from('partner_purchase').select('*').order('started_on', { ascending: false })
  if (partnerId) q = q.eq('partner_id', partnerId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    ...r, quantity: num(r.quantity), unit_price: num(r.unit_price),
  })) as unknown as Purchase[]
}

/** The charges raised against them, newest period first. */
export async function charges(partnerId?: string): Promise<Charge[]> {
  let q = supabase.from('partner_charge').select('*').order('period_start', { ascending: false })
  if (partnerId) q = q.eq('partner_id', partnerId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    ...r,
    quantity: num(r.quantity), unit_price: num(r.unit_price),
    days_charged: num(r.days_charged), days_in_period: num(r.days_in_period),
    gross: num(r.gross), recovered: num(r.recovered),
  })) as unknown as Charge[]
}

/** Which statement took what off which charge. The partner's reconciliation. */
export async function recoveries(): Promise<{ charge_id: string; statement_id: string; amount: number; applied_on: string }[]> {
  const { data, error } = await supabase
    .from('partner_charge_recovery').select('*').order('applied_on', { ascending: false })
  if (error) throw new Error(error.message)
  return ((data ?? []) as Record<string, unknown>[]).map(r => ({
    charge_id: String(r.charge_id), statement_id: String(r.statement_id),
    amount: num(r.amount), applied_on: String(r.applied_on),
  }))
}

/** What the cycle running now will cost, beside what it is earning. */
export async function accruing(partnerId?: string): Promise<WholesaleAccruing | null> {
  let q = supabase.from('partner_wholesale_accruing').select('*').order('period_start')
  if (partnerId) q = q.eq('partner_id', partnerId)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  /* Not `maybeSingle`. A partner has one open cycle, but a screen that throws
     because a view returned two rows is a screen that never stops loading — and
     the operator reads this same view across every seller. */
  const r = ((data ?? []) as Record<string, unknown>[])[0]
  if (!r) return null
  return {
    partner_id: String(r.partner_id),
    period_start: String(r.period_start), period_end: String(r.period_end),
    closed_on: String(r.closed_on),
    this_period: num(r.this_period), brought_forward: num(r.brought_forward),
    active_purchases: num(r.active_purchases),
  }
}

export interface Wrote { ok: boolean; id?: string; why?: string }

/** Take a product from the partner shelf. */
export async function buy(productId: string, quantity = 1, note?: string): Promise<Wrote> {
  const { data, error } = await supabase.rpc('buy_partner_product', {
    p_product: productId, p_quantity: quantity, p_note: note ?? null,
  })
  if (error) return { ok: false, why: error.message }
  return (data ?? { ok: false, why: 'Nothing came back.' }) as Wrote
}

/** Stop one. Service runs to the end of the day, and the month is pro-rated. */
export async function cancel(id: string, reason: string): Promise<Wrote> {
  const { data, error } = await supabase.rpc('cancel_partner_purchase', {
    p_id: id, p_reason: reason,
  })
  if (error) return { ok: false, why: error.message }
  return (data ?? { ok: false, why: 'Nothing came back.' }) as Wrote
}
