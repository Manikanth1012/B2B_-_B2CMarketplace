/* Reading the statutory clearance behind a document, and asking for one.
 *
 * Clearing is `clear_einvoice` in the database and not here. It writes a row,
 * stamps a status and mints the identifiers the authority returns, and it has
 * to be one write — a browser that inserted a row and then filled in the IRN
 * could leave a document registered with no proof of it.
 */

import { supabase } from './supabase'
import type { Regime, ClearanceRecord, DocKind, Audience } from './einvoice'

const num = <T extends Record<string, unknown>>(row: T, keys: string[]): T => {
  const out: Record<string, unknown> = { ...row }
  for (const k of keys) if (out[k] != null) out[k] = Number(out[k])
  return out as T
}

/** A document in the clearance queue, with enough of itself to be acted on. */
export interface ClearanceDoc {
  record: ClearanceRecord
  /* Null where the document behind a clearance row has been deleted — which
     should not happen, and the screen says so rather than rendering a blank
     row. */
  doc: {
    id: string
    kind: DocKind
    issued: string
    total: number
    currency: string
    status: string
    /* Who it was issued to, for an operator scanning a queue. */
    party: string
  } | null
}

export interface ClearanceBook {
  regimes: Regime[]
  docs: ClearanceDoc[]
  loadError?: string
}

/**
 * The operator's view: every regime, every clearance row, and the document
 * behind each one.
 *
 * The documents are fetched whole rather than joined through PostgREST because
 * a clearance row points at one of two tables by `doc_kind`, and a schema that
 * forked into two nullable foreign keys to make that join possible would fork
 * everything downstream of it.
 */
export async function loadClearanceBook(): Promise<ClearanceBook> {
  const [r, c, ei, cb, ea] = await Promise.all([
    supabase.from('tax_regime').select('*').order('sort_order'),
    supabase.from('einvoice_clearance').select('*'),
    supabase.from('enterprise_invoices').select('id,issued,total,currency,status,account_id'),
    supabase.from('consumer_bills').select('id,issued,total,currency,status,user_id'),
    /* `company` is the trading name — the column is not `name`, and asking for
       one that does not exist makes PostgREST fail the whole select, which is
       how the queue came to print account ids at somebody scanning it. */
    supabase.from('enterprise_accounts').select('id,company'),
  ])

  const errors: string[] = []
  if (r.error) errors.push(`the regimes: ${r.error.message}`)
  if (c.error) errors.push(`the clearance records: ${c.error.message}`)

  if (ea.error) errors.push(`the account names: ${ea.error.message}`)
  const accounts = new Map(((ea.data ?? []) as { id: string; company: string }[]).map(a => [a.id, a.company]))
  type Src = { id: string; issued: string; total: number; currency: string; status: string; account_id?: string }
  const invoices = new Map(((ei.data ?? []) as unknown as Src[]).map(i => [i.id, i]))
  const bills = new Map(((cb.data ?? []) as unknown as Src[]).map(b => [b.id, b]))

  const docs: ClearanceDoc[] = ((c.data ?? []) as ClearanceRecord[])
    .map(x => num(x as unknown as Record<string, unknown>, ['attempts']) as unknown as ClearanceRecord)
    .map(record => {
      const src = record.doc_kind === 'consumer_bill' ? bills.get(record.doc_id) : invoices.get(record.doc_id)
      return {
        record,
        doc: src
          ? {
              id: record.doc_id,
              kind: record.doc_kind,
              issued: String(src.issued),
              total: Number(src.total),
              currency: String(src.currency),
              status: String(src.status),
              party: record.doc_kind === 'consumer_bill'
                ? 'Retail customer'
                : accounts.get(String(src.account_id ?? '')) ?? String(src.account_id ?? '—'),
            }
          : null,
      }
    })
    .sort((a, b) => (a.doc?.issued ?? '') < (b.doc?.issued ?? '') ? 1 : -1)

  return {
    regimes: ((r.data ?? []) as Regime[]).map(x =>
      num(x as unknown as Record<string, unknown>, ['cancel_hours', 'sort_order']) as unknown as Regime),
    docs,
    ...(errors.length ? { loadError: `Some of the clearance record did not load (${errors.join('; ')}).` } : {}),
  }
}

/**
 * The clearance on one document, for the customer looking at their own bill.
 *
 * Returns null rather than throwing where there is none: a document raised in a
 * market with no regime configured has no clearance and never will, and that is
 * a rendering decision rather than an error.
 */
export async function loadClearanceFor(
  kind: DocKind, docId: string,
): Promise<{ record: ClearanceRecord | null; regime: Regime | null }> {
  const [c, r] = await Promise.all([
    supabase.from('einvoice_clearance').select('*')
      .eq('doc_kind', kind).eq('doc_id', docId).maybeSingle(),
    supabase.from('tax_regime').select('*'),
  ])
  const record = (c.data ?? null) as ClearanceRecord | null
  const regimes = (r.data ?? []) as Regime[]
  return {
    record,
    regime: record ? regimes.find(x => x.market === record.market) ?? null : null,
  }
}

/** The clearance on many documents at once, keyed by document id. */
export async function loadClearanceMap(
  kind: DocKind, ids: readonly string[],
): Promise<Map<string, ClearanceRecord>> {
  if (ids.length === 0) return new Map()
  const { data } = await supabase.from('einvoice_clearance').select('*')
    .eq('doc_kind', kind).in('doc_id', ids as string[])
  return new Map(((data ?? []) as ClearanceRecord[]).map(r => [r.doc_id, r]))
}

/** Send a document to the authority. Idempotent — a cleared one comes back as it was. */
export async function clearDocument(
  kind: DocKind, docId: string, market: string, audience: Audience,
): Promise<{ ok: boolean; status?: string; why?: string }> {
  const { data, error } = await supabase.rpc('clear_einvoice', {
    p_kind: kind, p_doc: docId, p_market: market, p_audience: audience,
  })
  if (error) return { ok: false, why: error.message }
  return (data ?? { ok: false, why: 'The portal returned nothing.' }) as
    { ok: boolean; status?: string; why?: string }
}
