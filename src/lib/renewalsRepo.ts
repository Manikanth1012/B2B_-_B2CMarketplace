/**
 * The only module that reads the renewal book, for either side of it.
 *
 * Two audiences, two shapes, one subject. The operator sees every subscription
 * with the ownership on it, so a run can be planned and the vendors who owe a
 * report can be chased. A seller sees the renewals that are theirs to maintain —
 * the subscription, never the subscriber, because a seller's answer to "which
 * renewals are mine" should not come with the marketplace's customer list
 * attached. That narrowing is enforced in the database, by
 * `vendor_renewal_book` and `vendor_reported_charges`, not here; this module
 * could not widen it if it tried. Both are functions rather than policies for
 * exactly that reason — row-level security restricts rows, and `user_id` is a
 * column.
 */
import { supabase } from './supabase'
import type { Subscription } from './renewals'

const num = (v: unknown) => Number(v ?? 0)

export interface WatchRow {
  ref: string
  product_id: string
  product_name: string
  vendor_id: string
  vendor: string
  cycle: string | null
  price: number
  currency: string
  customer: string | null
  due: string
  days_late: number
  band: string
}

export interface ChargeRow {
  id: string
  ref: string
  product_name: string
  period_start: string
  period_end: string
  period_label: string
  amount: number
  currency: string
  source: string
  vendor_id: string | null
  vendor_ref: string | null
  reported_by: string | null
  reported_at: string | null
  bill_id: string | null
}

export interface RenewalDesk {
  subs: Subscription[]
  watch: WatchRow[]
  charges: ChargeRow[]
  loadError?: string
}

/** The operator's view: every subscription, who renews it, and who is late. */
export async function loadRenewalDesk(): Promise<RenewalDesk> {
  const [subs, products, watch, charges] = await Promise.all([
    supabase.from('subscriptions').select('*'),
    /* The ownership is on the product, and it is the whole distinction this
       screen is about. Read once and joined here rather than per row. */
    supabase.from('products').select('id, partner_id'),
    supabase.from('renewal_watch').select('*').order('days_late', { ascending: false }),
    supabase.from('subscription_charge').select('*').order('period_start', { ascending: false }),
  ])

  const failed = [subs.error, watch.error].find(Boolean)
  const owner = new Map<string, string | null>()
  for (const p of (products.data ?? []) as { id: string; partner_id: string | null }[]) {
    owner.set(p.id, p.partner_id)
  }

  return {
    subs: ((subs.data ?? []) as Record<string, unknown>[]).map(s => ({
      ...s, price: num(s.price), vendor: owner.get(String(s.product_id)) ?? null,
    })) as unknown as Subscription[],
    watch: ((watch.data ?? []) as Record<string, unknown>[]).map(w => ({
      ...w, price: num(w.price), days_late: num(w.days_late),
    })) as unknown as WatchRow[],
    charges: ((charges.data ?? []) as Record<string, unknown>[]).map(c => ({
      ...c, amount: num(c.amount),
    })) as unknown as ChargeRow[],
    loadError: failed?.message,
  }
}

export interface BookRow {
  ref: string
  product_id: string
  product_name: string
  cycle: string | null
  price: number
  currency: string
  due: string
  days_late: number
  reported: boolean
  last_reported: string | null
  vendor_ref: string | null
}

/**
 * A cycle a seller reported, as the seller may read it.
 *
 * `ChargeRow` without `user_id`, `source` or `vendor_id`, because the function
 * behind it does not return them. A seller had a row-level policy on
 * `subscription_charge` for a day and a half, and every row on that table
 * carries the customer's id — row-level security restricts rows, not columns.
 */
export interface ReportedRow {
  id: string
  ref: string
  product_id: string
  product_name: string
  period_start: string
  period_end: string
  period_label: string
  amount: number
  currency: string
  vendor_ref: string | null
  reported_by: string | null
  reported_at: string | null
  bill_id: string | null
}

export interface VendorBook {
  rows: BookRow[]
  charges: ReportedRow[]
  loadError?: string
}

/**
 * A seller's own renewals.
 *
 * `p_partner` is left null when a seller asks — the database takes the answer
 * from who is signed in rather than from what the browser sent, which is the
 * difference between a rule and a suggestion.
 */
export async function loadVendorBook(partnerId?: string): Promise<VendorBook> {
  const [book, charges] = await Promise.all([
    supabase.rpc('vendor_renewal_book', { p_partner: partnerId ?? null }),
    supabase.rpc('vendor_reported_charges', { p_partner: partnerId ?? null }),
  ])

  return {
    rows: ((book.data ?? []) as Record<string, unknown>[]).map(r => ({
      ...r, price: num(r.price), days_late: num(r.days_late),
    })) as unknown as BookRow[],
    charges: ((charges.data ?? []) as Record<string, unknown>[]).map(c => ({
      ...c, amount: num(c.amount),
    })) as unknown as ReportedRow[],
    loadError: book.error?.message ?? charges.error?.message,
  }
}

export interface Reported {
  ok: boolean
  already: boolean
  ref?: string
  vendor?: string
  reported_by?: string
  period?: string
  period_end?: string
  amount?: number
  currency?: string
  renews_next?: string
  note?: string
}

/** A seller — or the marketplace on their behalf — saying they renewed one. */
export async function reportRenewal(
  ref: string, period: string, vendorRef: string, amount?: number,
): Promise<{ result?: Reported; error?: string }> {
  const { data, error } = await supabase.rpc('report_renewal', {
    p_ref: ref, p_period_start: period, p_vendor_ref: vendorRef,
    p_amount: amount ?? null,
  })
  if (error) return { error: error.message }
  const r = data as Record<string, unknown>
  return { result: { ...r, amount: r.amount == null ? undefined : num(r.amount) } as Reported }
}

export interface RunResult {
  ran_on: string
  ran_by: string
  charged: number
  already: number
  rolled: number
  skipped: { ref: string; product: string; reason: string }[]
  awaiting: {
    ref: string; product: string; vendor_id: string; vendor: string
    due: string; days_late: number; reason: string
  }[]
}

/** The run itself, for what the marketplace sells. */
export async function runRenewals(
  asOf: string, actor: string,
): Promise<{ result?: RunResult; error?: string }> {
  const { data, error } = await supabase.rpc('renew_subscriptions', {
    p_as_of: asOf, p_actor: actor,
  })
  if (error) return { error: error.message }
  return { result: data as RunResult }
}
