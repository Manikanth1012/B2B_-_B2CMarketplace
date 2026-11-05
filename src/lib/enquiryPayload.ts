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
