/**
 * What a seller may do to an order they are fulfilling. Pure.
 *
 * The Orders screen ran on `PARTNER_ORDERS` in `data.ts` and moved a number in
 * React state: the stage button worked until the page was reloaded, and "Bulk
 * dispatch" was a toast because there was nothing to dispatch. These are the
 * rules the screen and the write now share, so a refusal is the same refusal
 * whichever way an order is moved on.
 */

export interface SellerOrder {
  id: string
  order_ref: string
  status: string
  buyer_name: string
  placed_date: string | null
  created_at: string
  seller: string | null
  vertical: string
  stage: number
  stages: string[]
  failed: boolean
  failed_reason: string | null
  tracking_ref: string | null
  carrier: string | null
  total: number
  currency: string
  account_id: string | null
  cost_centre: string | null
  ordered_by: string | null
}

export interface SellerLine {
  order_id: string
  product_id: string
  product_name: string
  price: number
  quantity: number
  fulfil: string | null
}

export type Check = { ok: true; note?: string } | { ok: false; reason: string }

/* A stage list ends in the state where nothing more is owed. Anything short of
   that is work somebody has to do. */
export function isOpen(o: SellerOrder): boolean {
  return !o.failed && o.stage < o.stages.length - 1
}

export function isDone(o: SellerOrder): boolean {
  return !o.failed && o.stage >= o.stages.length - 1
}

/** What this order is waiting for, in the words its own stage list uses. */
export function nextStep(o: SellerOrder): string | null {
  if (o.failed) return 'Resolve the failure'
  return o.stages[o.stage + 1] ?? null
}

/**
 * Whether a physical order still needs a tracking number.
 *
 * Only where something moves. A licence that provisions instantly has no
 * carrier and never will, and asking a seller for a tracking number on one is
 * a field they have to invent something for.
 */
export function needsTracking(o: SellerOrder, lines: readonly SellerLine[]): boolean {
  if (!isOpen(o)) return false
  const ships = lines.some(l => l.fulfil === 'shipped')
  return ships && !o.tracking_ref
}

/** How far through, as a percentage, for a progress rail. */
export function progress(o: SellerOrder): number {
  const last = Math.max(1, o.stages.length - 1)
  return Math.round((Math.min(o.stage, last) / last) * 100)
}

/**
 * Whether this seller may move the order on at all.
 *
 * The shared-basket case is the one worth stating: an order carrying two
 * sellers' lines is not one seller's to mark delivered, because doing so would
 * tell the buyer the other seller's goods had arrived too. The database refuses
 * it as well — this exists so the button can be disabled with a reason rather
 * than failing after the click.
 */
export function canAdvance(o: SellerOrder, lines: readonly SellerLine[], mine: ReadonlySet<string>): Check {
  const onIt = lines.filter(l => l.order_id === o.id)
  if (!onIt.some(l => mine.has(l.product_id))) {
    return { ok: false, reason: `You supply nothing on ${o.order_ref}.` }
  }
  if (onIt.some(l => !mine.has(l.product_id))) {
    return {
      ok: false,
      reason: `${o.order_ref} carries another seller's lines as well as yours. The marketplace moves it on when every seller has.`,
    }
  }
  if (o.failed) {
    return { ok: false, reason: `${o.order_ref} failed and has to be resolved before it moves on.` }
  }
  if (o.stage >= o.stages.length - 1) {
    return { ok: false, reason: `${o.order_ref} is already at "${o.stages[o.stages.length - 1]}".` }
  }
  return { ok: true, note: `Marks it ${(o.stages[o.stage + 1] ?? '').toLowerCase()}.` }
}

/* ------------------------------------------------------ bulk dispatch --- */

export interface DispatchRow {
  order_ref: string
  carrier: string
  tracking_ref: string
}

/** The header the export writes and the import expects back. */
export const DISPATCH_HEADER = ['order_ref', 'carrier', 'tracking_ref'] as const

/**
 * The orders a bulk dispatch would cover, as rows to hand to a warehouse.
 *
 * Exported with the carrier and tracking columns blank rather than omitted: the
 * file that comes back is the file that went out, which is the only version of
 * this a warehouse will reliably return.
 */
export function dispatchExport(orders: readonly SellerOrder[], lines: readonly SellerLine[]): string[][] {
  const rows: string[][] = [[...DISPATCH_HEADER, 'buyer', 'placed', 'items', 'value', 'currency', 'stage']]
  for (const o of orders) {
    if (!isOpen(o)) continue
    const onIt = lines.filter(l => l.order_id === o.id)
    if (!onIt.some(l => l.fulfil === 'shipped')) continue
    rows.push([
      o.order_ref,
      o.carrier ?? '',
      o.tracking_ref ?? '',
      o.buyer_name,
      o.placed_date ?? '',
      onIt.map(l => `${l.quantity}× ${l.product_name}`).join('; '),
      o.total.toFixed(2),
      o.currency,
      o.stages[o.stage] ?? '',
    ])
  }
  return rows
}

export interface ParsedDispatch {
  rows: DispatchRow[]
  /* One line per row that could not be used, naming the row. A bulk import that
     reports "3 of 40 failed" and not which three is an import nobody can fix. */
  problems: string[]
}

/**
 * Reading a dispatch file back.
 *
 * Deliberately forgiving about the shape and strict about the content: a
 * warehouse will send back the export with extra columns, reordered columns, a
 * BOM, and semicolons instead of commas, and none of that is a reason to refuse
 * the tracking numbers. A row naming an order that is not yours, or missing the
 * number it exists to carry, is.
 */
export function parseDispatch(text: string, known: readonly SellerOrder[]): ParsedDispatch {
  const clean = text.replace(/^﻿/, '').trim()
  if (!clean) return { rows: [], problems: ['The file is empty.'] }

  const lines = clean.split(/\r?\n/).filter(l => l.trim())
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const split = (line: string) => line.split(delimiter).map(c => c.trim().replace(/^"|"$/g, ''))

  const head = split(lines[0]).map(h => h.toLowerCase().replace(/\s+/g, '_'))
  const at = (name: string) => head.indexOf(name)
  const iRef = at('order_ref') >= 0 ? at('order_ref') : at('order')
  const iCarrier = at('carrier')
  const iTrack = at('tracking_ref') >= 0 ? at('tracking_ref') : at('tracking')

  if (iRef < 0 || iTrack < 0) {
    return {
      rows: [],
      problems: [`The first row has to name the columns. Expected ${DISPATCH_HEADER.join(', ')} — found ${head.join(', ') || 'nothing'}.`],
    }
  }

  const byRef = new Map(known.map(o => [o.order_ref.toUpperCase(), o]))
  const rows: DispatchRow[] = []
  const problems: string[] = []
  const seen = new Set<string>()

  for (let n = 1; n < lines.length; n++) {
    const cells = split(lines[n])
    const ref = (cells[iRef] ?? '').toUpperCase()
    const tracking = (cells[iTrack] ?? '').trim()
    const carrier = (iCarrier >= 0 ? cells[iCarrier] ?? '' : '').trim()

    if (!ref) { problems.push(`Row ${n + 1}: no order reference.`); continue }
    const order = byRef.get(ref)
    if (!order) { problems.push(`Row ${n + 1}: ${ref} is not one of your orders.`); continue }
    if (!tracking) {
      /* Not a problem worth reporting: the export writes a blank tracking
         column, and a warehouse that has not filled a row in yet is telling us
         the truth about it. */
      continue
    }
    if (seen.has(ref)) { problems.push(`Row ${n + 1}: ${ref} appears twice, with different numbers.`); continue }
    if (!isOpen(order)) {
      problems.push(`Row ${n + 1}: ${ref} is ${order.failed ? 'failed' : 'already ' + (order.stages[order.stage] ?? 'closed').toLowerCase()}.`)
      continue
    }
    if (!carrier) { problems.push(`Row ${n + 1}: ${ref} has a tracking number and no carrier.`); continue }

    seen.add(ref)
    rows.push({ order_ref: order.order_ref, carrier, tracking_ref: tracking })
  }

  if (!rows.length && !problems.length) {
    problems.push('Nothing in the file had a tracking number in it.')
  }
  return { rows, problems }
}

/** What a dispatch import will do, said before it does it. */
export function dispatchSummary(rows: readonly DispatchRow[], orders: readonly SellerOrder[]): string {
  if (!rows.length) return 'Nothing to apply.'
  const refs = new Set(rows.map(r => r.order_ref))
  const moving = orders.filter(o => refs.has(o.order_ref))
  const carriers = [...new Set(rows.map(r => r.carrier))]
  return `${rows.length} order${rows.length === 1 ? '' : 's'} marked ${
    [...new Set(moving.map(o => (o.stages[o.stage + 1] ?? '').toLowerCase()))].filter(Boolean).join(' or ')
  }, with ${carriers.length === 1 ? carriers[0] : `${carriers.length} carriers`}.`
}
