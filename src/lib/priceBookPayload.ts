/* What crosses the wire for price books, both ways, as pure functions.
 *
 * Rows come back from PostgREST with numerics as strings, so every figure
 * goes through `Number` here, once. RPC arguments are named exactly as the
 * migration names them (`set_account_price(p_account, p_product, ...)`).
 *
 * A database the migration has not reached yet answers "no such table" or "no
 * such function". `isMissing` recognises that answer, so the repo can read it
 * as "this account has no prices, the default rules and no preferences" and
 * the catalogue and requisition behave exactly as they did before.
 *
 * Pure: the database client is never imported here.
 */
import type {
  AccountPrice, BuyingRules, Preference, OffContractRule, PriceDraft, PriceSource,
  QuoteLineForPromotion,
} from './accountPrices'
import { DEFAULT_RULES } from './accountPrices'

type Row = Record<string, unknown>

const str = (v: unknown): string => (v === null || v === undefined ? '' : String(v))
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v))
const numOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
/** A date column, as its ISO day; timestamps keep only the day. */
const day = (v: unknown): string => str(v).slice(0, 10)
const dayOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : day(v))

const RULES: readonly OffContractRule[] = ['allow', 'reason', 'approval']
const asRule = (v: unknown): OffContractRule =>
  (RULES as readonly unknown[]).includes(v) ? (v as OffContractRule) : 'allow'
const asSource = (v: unknown): PriceSource => (v === 'quote' ? 'quote' : 'negotiated')

export function toAccountPrice(r: Row): AccountPrice {
  return {
    id: str(r.id), account_id: str(r.account_id), product_id: str(r.product_id), currency: str(r.currency),
    unit_price: numOrNull(r.unit_price) ?? 0,
    starts_on: day(r.starts_on), ends_on: dayOrNull(r.ends_on),
    source: asSource(r.source), quote_line_id: strOrNull(r.quote_line_id), quote_ref: strOrNull(r.quote_ref),
    note: strOrNull(r.note), set_by: str(r.set_by), set_at: str(r.set_at),
    ended_by: strOrNull(r.ended_by), ended_at: strOrNull(r.ended_at), end_reason: strOrNull(r.end_reason),
  }
}

/** A missing row reads as 'allow', as the database reads it. */
export function toRules(r: Row | null | undefined, accountId: string): BuyingRules {
  if (!r) return DEFAULT_RULES(accountId)
  return {
    account_id: str(r.account_id) || accountId,
    off_contract: asRule(r.off_contract),
    note: strOrNull(r.note),
    updated_by: strOrNull(r.updated_by),
    updated_on: dayOrNull(r.updated_on),
  }
}

export function toPreference(r: Row): Preference {
  return {
    id: str(r.id), account_id: str(r.account_id),
    kind: r.kind === 'seller' ? 'seller' : 'product',
    partner_id: strOrNull(r.partner_id), product_id: strOrNull(r.product_id),
    note: strOrNull(r.note), added_by: str(r.added_by), added_on: day(r.added_on),
  }
}

export interface SellerAccountPrice {
  id: string; company: string; product_id: string; product_name: string; currency: string
  unit_price: number; starts_on: string; ends_on: string | null; source: PriceSource
}

export function toSellerAccountPrice(r: Row): SellerAccountPrice {
  return {
    id: str(r.id), company: str(r.company), product_id: str(r.product_id), product_name: str(r.product_name),
    currency: str(r.currency), unit_price: numOrNull(r.unit_price) ?? 0,
    starts_on: day(r.starts_on), ends_on: dayOrNull(r.ends_on), source: asSource(r.source),
  }
}

/** An `enquiry_lines` row with its enquiry embedded (`enquiries!inner(...)`).
 *  Null when the line names no listing: there is nothing to price. */
export function toPromotable(r: Row): QuoteLineForPromotion | null {
  const e = (Array.isArray(r.enquiries) ? r.enquiries[0] : r.enquiries) as Row | null | undefined
  if (!e || r.product_id === null || r.product_id === undefined) return null
  return {
    id: str(r.id), enquiry_id: str(r.enquiry_id), account_id: str(e.account_id), status: str(e.status),
    currency: str(e.currency), product_id: str(r.product_id), name: str(r.name),
    quoted_unit_price: numOrNull(r.quoted_unit_price),
  }
}

/** set_account_price(p_account, p_product, p_currency, p_unit_price, p_starts_on, p_ends_on, p_note, p_quote_line). */
export function setPriceArgs(d: PriceDraft) {
  const note = d.note.trim()
  return {
    p_account: d.account_id, p_product: d.product_id, p_currency: d.currency, p_unit_price: d.unit_price,
    p_starts_on: d.starts_on, p_ends_on: d.ends_on,
    p_note: note === '' ? null : note,
    p_quote_line: d.quote_line_id ?? null,
  }
}

/** end_account_price(p_id, p_reason). */
export const endPriceArgs = (id: string, reason: string) => ({ p_id: id, p_reason: reason.trim() })

/** promote_quote_line(p_quote_line, p_starts_on, p_ends_on, p_note). */
export function promoteArgs(quoteLineId: string, starts_on: string, ends_on: string | null, note: string) {
  const n = note.trim()
  return { p_quote_line: quoteLineId, p_starts_on: starts_on, p_ends_on: ends_on, p_note: n === '' ? null : n }
}

/* ------------------------------------------------- the migration not there -- */

export interface WireError { code?: string | null; message?: string | null }

/**
 * Whether the database is answering "that table, or that function, does not
 * exist" — a database the price-book migration has not reached.
 *   42P01     undefined_table, from Postgres
 *   PGRST202  no such function in the schema cache
 *   PGRST205  no such table in the schema cache
 *   404       PostgREST's status for either
 */
export function isMissing(error: WireError | null | undefined, status?: number | null): boolean {
  if (!error) return false
  const code = error.code ?? ''
  if (code === '42P01' || code === 'PGRST202' || code === 'PGRST205' || code === '42883') return true
  if (status === 404) return true
  const m = error.message ?? ''
  return /relation .* does not exist|could not find the (table|function)/i.test(m)
}

type Settled<T> = { ok: true; value: T } | { ok: false; error: string }

/** A read of rows: mapped; a missing table or function reads as no rows; any other error is reported. */
export function settleRows<T>(
  res: { data: unknown; error: WireError | null; status?: number | null },
  map: (r: Row) => T | null,
): Settled<T[]> {
  if (res.error) return isMissing(res.error, res.status) ? { ok: true, value: [] } : { ok: false, error: friendly(res.error.message ?? '') }
  const out: T[] = []
  for (const r of (res.data ?? []) as Row[]) { const m = map(r); if (m !== null) out.push(m) }
  return { ok: true, value: out }
}

/** A read of the rules row: a missing row, or a missing table, reads as DEFAULT_RULES. */
export function settleRules(
  res: { data: unknown; error: WireError | null; status?: number | null }, accountId: string,
): Settled<BuyingRules> {
  if (res.error) {
    return isMissing(res.error, res.status) ? { ok: true, value: DEFAULT_RULES(accountId) } : { ok: false, error: friendly(res.error.message ?? '') }
  }
  return { ok: true, value: toRules((res.data ?? null) as Row | null, accountId) }
}

export const NOT_SET_UP ='Price books are not set up on this database yet, so nothing was changed.'

/** The database refuses in its own words; this strips the Postgres wrapper, as enterpriseRepo does. */
export function friendly(message: string): string {
  const m = message.replace(/^.*?\bERROR:\s*/i, '').trim()
  if (/row-level security/i.test(m)) return 'You are not allowed to change that on this account.'
  if (/duplicate key/i.test(m)) return 'That already exists.'
  return m
}

/** Two sentences of a policy note, the second only when there is one. */
export function joinNote(note: string, extra: string | null): string {
  if (!extra) return note
  if (!note) return extra
  return `${note.replace(/[.\s]+$/, '')}. ${extra}`
}
