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
