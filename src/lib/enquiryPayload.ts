// The pure edges of enquiryRepo: what goes to the database and what comes back
// from it. Kept apart because enquiryRepo imports supabase, which cannot load
// in a Node unit test.

import type { EnquiryLine } from './enquiries'

/** The jsonb `raise_quote` takes. Name, seller and routing are worked out by the
    database from the catalogue, so they are deliberately not sent. */
export function quoteLinesPayload(
  lines: readonly { product_id: string; quantity: number; target_unit_price?: number | null }[],
): { product_id: string; quantity: number; target_unit_price: number | null }[] {
  return lines.map(l => ({
    product_id: l.product_id,
    quantity: l.quantity,
    target_unit_price: l.target_unit_price ?? null,
  }))
}

/** The arguments `send_quote` takes. Prices go as numbers keyed by line id;
    a blank note is sent as null so nothing empty reaches the conversation. */
export function sendQuotePayload(
  id: string, prices: Record<string, number>, valid_until: string, note?: string | null,
): { p_id: string; p_prices: Record<string, number>; p_valid_until: string; p_note: string | null } {
  const p_prices: Record<string, number> = {}
  for (const [line, price] of Object.entries(prices)) p_prices[line] = Number(price)
  const trimmed = note?.trim()
  return { p_id: id, p_prices, p_valid_until: valid_until, p_note: trimmed ? trimmed : null }
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)

/** A line as the database returns it. `numeric` can arrive as a string. */
export function asLine(r: Record<string, unknown>): EnquiryLine {
  return {
    ...(r as unknown as EnquiryLine),
    quantity: Number(r.quantity),
    target_unit_price: num(r.target_unit_price),
    quoted_unit_price: num(r.quoted_unit_price),
    sort_order: Number(r.sort_order ?? 0),
  }
}

/** On a desk quote, what the seller of a line told the desk it would charge
    (`enquiry_line_proposals`, 20261112200000). Its own table, not columns on
    the line, so the buyer — who reads every column of its lines — never sees
    it. The desk reads them all; a seller reads its own. */
export interface LineProposal {
  line_id: string; enquiry_id: string; partner_id: string
  unit_price: number; note: string | null; proposed_at: string; proposed_by: string
}

export function asProposal(r: Record<string, unknown>): LineProposal {
  return {
    line_id: String(r.line_id), enquiry_id: String(r.enquiry_id), partner_id: String(r.partner_id ?? ''),
    unit_price: Number(r.unit_price), note: str(r.note),
    proposed_at: String(r.proposed_at ?? ''), proposed_by: String(r.proposed_by ?? ''),
  }
}

/** True when a read failed because the table is not on this database yet. */
export function isMissingTable(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === '42P01' || error.code === 'PGRST205') return true
  return /could not find the table|relation .* does not exist|schema cache/i.test(error.message ?? '')
}

/** The arguments `propose_line_price` takes. A blank note is sent as null,
    which clears any note proposed before. */
export function proposeLinePricePayload(
  lineId: string, price: number, note?: string | null,
): { p_line_id: string; p_price: number; p_note: string | null } {
  const trimmed = note?.trim()
  return { p_line_id: lineId, p_price: Number(price), p_note: trimmed ? trimmed : null }
}

/** One of the seller's own lines on a desk quote, as `my_desk_quote_lines()`
    returns it: the line, the few facts about the quote the seller needs to
    price it, and the seller's own floor in the quote's currency. */
export interface DeskQuoteLine {
  line_id: string; enquiry_id: string; subject: string; status: string; currency: string
  needed_by: string | null; raised_at: string; product_id: string; name: string; quantity: number
  target_unit_price: number | null; floor_price: number | null; sort_order: number
  /** The seller's own proposal on this line, if it has made one. */
  seller_unit_price: number | null; seller_note: string | null; seller_priced_at: string | null
}

export function asDeskQuoteLine(r: Record<string, unknown>): DeskQuoteLine {
  return {
    line_id: String(r.line_id), enquiry_id: String(r.enquiry_id), subject: String(r.subject ?? ''),
    status: String(r.status ?? ''), currency: String(r.currency ?? ''),
    needed_by: str(r.needed_by), raised_at: String(r.raised_at ?? ''),
    product_id: String(r.product_id), name: String(r.name ?? ''), quantity: Number(r.quantity),
    target_unit_price: num(r.target_unit_price), floor_price: num(r.floor_price),
    sort_order: Number(r.sort_order ?? 0),
    seller_unit_price: num(r.seller_unit_price), seller_note: str(r.seller_note),
    seller_priced_at: str(r.seller_priced_at),
  }
}

/** True when an rpc failed because the function is not on this database yet:
    the migration that adds it has not been applied. */
export function isMissingFunction(error: { message?: string; code?: string } | null | undefined): boolean {
  if (!error) return false
  if (error.code === 'PGRST202' || error.code === '42883') return true
  return /could not find the function|function .* does not exist/i.test(error.message ?? '')
}
