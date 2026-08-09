/**
 * What a partner buys from the marketplace, and how it comes off what they are
 * owed.
 *
 * Six products carry the `partner` audience and until now nothing could buy
 * one. A partner buying is not a shopper checking out — nothing ships, no
 * gateway is called, and no money moves at the moment of purchase. The
 * marketplace already owes this partner a settlement every cycle, and the
 * wholesale nets off against it.
 *
 * Every rule here has a counterpart in SQL — `wholesale_charges`,
 * `charge_days`, `apply_settlement_adjustments`. That is the same arrangement
 * `settlementCycle.ts` has with `settlement_window`, and for the same reason:
 * the netting has to happen in one transaction with the statement it writes, so
 * it lives in the database; and a screen has to say "this cycle will cost you
 * $3,900, of which $2,017 is all this quarter can cover" for a period nobody
 * has settled yet, so it lives here too. The integration suite checks the two
 * agree on every purchase on file.
 *
 * Dates are ISO strings and every computation is UTC.
 */

export type PurchaseState = 'active' | 'cancelled'

export interface Purchase {
  id: string
  partner_id: string
  product_id: string
  product_name: string
  quantity: number
  unit_price: number
  currency: string
  billing_period: string
  state: PurchaseState
  started_on: string
  ends_on: string | null
  ordered_by: string
  cancelled_on?: string | null
  cancel_reason?: string | null
  note?: string | null
}

export interface Charge {
  id: string
  purchase_id: string
  partner_id: string
  product_id: string
  product_name: string
  period_start: string
  period_end: string
  quantity: number
  unit_price: number
  days_charged: number
  days_in_period: number
  gross: number
  currency: string
  recovered: number
}

/** One month of one standing order, before anything has been raised for it. */
export interface Projected {
  purchase_id: string
  product_id: string
  product_name: string
  month_start: string
  month_end: string
  quantity: number
  unit_price: number
  days_charged: number
  days_in_period: number
  gross: number
}

const utc = (s: string) => new Date(`${s}T00:00:00Z`)
const iso = (d: Date) => d.toISOString().slice(0, 10)
const DAY = 86_400_000

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * How much of a month a purchase was live for.
 *
 * A storefront taken on the 18th of a 31-day month is charged for 14 days, not
 * for a month. Counted inclusively at both ends: a purchase that starts and
 * ends on the same day was live for one day, not none.
 */
export function daysCharged(
  periodStart: string, periodEnd: string, startedOn: string, endsOn: string | null,
): { charged: number; inPeriod: number } {
  const from = utc(periodStart)
  const to = utc(periodEnd)
  const start = utc(startedOn)
  const end = endsOn ? utc(endsOn) : to
  const first = start > from ? start : from
  const last = end < to ? end : to
  return {
    charged: Math.max(0, Math.round((last.getTime() - first.getTime()) / DAY) + 1),
    inPeriod: Math.round((to.getTime() - from.getTime()) / DAY) + 1,
  }
}

/**
 * The calendar months a span covers, each clipped to the span.
 *
 * A month at a time, not a settlement period at a time. The partner products
 * are priced monthly and Beacon settles quarterly: one monthly price charged
 * against a quarter would bill a reseller for a third of what they used.
 */
export function monthsIn(from: string, to: string): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = []
  const last = utc(to)
  let cursor = new Date(Date.UTC(utc(from).getUTCFullYear(), utc(from).getUTCMonth(), 1))
  while (cursor <= last) {
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0))
    out.push({
      start: iso(cursor < utc(from) ? utc(from) : cursor),
      end: iso(monthEnd > last ? last : monthEnd),
    })
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
  }
  return out
}

/**
 * What a partner's standing orders come to over a span.
 *
 * Free purchases produce nothing. Sandbox access is genuinely free, and a zero
 * line on a statement is one a partner has to read past to find the ones that
 * cost something.
 */
export function chargesOver(
  purchases: readonly Purchase[], from: string, to: string,
): Projected[] {
  const out: Projected[] = []
  for (const m of monthsIn(from, to)) {
    for (const p of purchases) {
      if (p.started_on > m.end) continue
      if (p.ends_on && p.ends_on < m.start) continue
      const d = daysCharged(m.start, m.end, p.started_on, p.ends_on)
      if (d.charged <= 0) continue
      const gross = round2(p.unit_price * p.quantity * d.charged / d.inPeriod)
      if (gross <= 0) continue
      out.push({
        purchase_id: p.id, product_id: p.product_id, product_name: p.product_name,
        month_start: m.start, month_end: m.end,
        quantity: p.quantity, unit_price: p.unit_price,
        days_charged: d.charged, days_in_period: d.inPeriod, gross,
      })
    }
  }
  return out
}

export interface Recovery {
  charge_id: string
  /* What this period can actually take off it. */
  taken: number
  /* What is left on the charge afterwards, waiting for the next period. */
  outstanding: number
}

export interface NetOff {
  recovered: number
  carried: number
  taken: Recovery[]
  /* Null where the period covered everything. */
  why: string | null
}

/**
 * What a period can actually take off the charges outstanding against it.
 *
 * Bounded, and that is the whole point. A debit note can push a statement
 * negative because an operator raised it deliberately and exceptionally; a
 * wholesale charge recurs every cycle, so the same licence would make an
 * unpayable statement the normal case. You cannot net off against money that is
 * not there — the remainder stays outstanding and takes the next period.
 *
 * Oldest first. A charge that has already waited a cycle is the one with the
 * best claim on the money that has turned up.
 */
export function netOff(
  { room, charges }: { room: number; charges: readonly { id: string; gross: number; recovered: number }[] },
): NetOff {
  let left = round2(Math.max(0, room))
  let recovered = 0
  let carried = 0
  const taken: Recovery[] = []

  for (const c of charges) {
    const owing = round2(c.gross - c.recovered)
    if (owing <= 0) continue
    const take = Math.min(owing, left)
    if (take > 0) {
      taken.push({ charge_id: c.id, taken: round2(take), outstanding: round2(owing - take) })
      recovered = round2(recovered + take)
      left = round2(left - take)
    }
    carried = round2(carried + (owing - take))
  }

  return {
    recovered, carried, taken,
    why: carried > 0
      ? `${carried.toFixed(2)} could not come off this period — it is more than the period earned. It carries to the next one.`
      : null,
  }
}

/* ------------------------------------------------------- what may be bought -- */

export interface Sellable {
  id: string
  name: string
  status: string
  audiences: string[] | null
  partner_id: string | null
  seller: string | null
  billing_period: string | null
}

/**
 * Why this partner cannot take this product, or null when they can.
 *
 * The same refusals the trigger raises, in the same words, so a seller is told
 * while they are looking at the shelf rather than after they press the button.
 */
export function buyProblem(
  product: Sellable,
  partner: { id: string; name: string; status: string },
): string | null {
  if (!(product.audiences ?? []).includes('partner')) {
    return `${product.name} is not sold to partners.`
  }
  /* Ownership before status. Beacon's own pending listing is refused for both
     reasons, and "it is not published yet" invites them to wait for a product
     they could never take; "it is yours" is the one that ends the question. */
  if (product.partner_id && product.partner_id === partner.id) {
    return 'This is your own listing. A seller does not buy from themselves.'
  }
  if (product.status !== 'live') {
    return `${product.name} is ${product.status}, not live. It cannot be taken until it is published.`
  }
  if (partner.status !== 'live') {
    return `${partner.name} is ${partner.status}, not live. A commitment that settles monthly is not taken on by an account that is not trading.`
  }
  if ((product.billing_period ?? 'monthly') !== 'monthly') {
    return `${product.name} is priced ${product.billing_period}. Partner purchases are charged by the calendar month.`
  }
  return null
}

/* --------------------------------------------------------------- in words -- */

/** What one charge is for, said the way the statement says it. */
export function chargeLine(c: Pick<Charge, 'product_name' | 'quantity' | 'days_charged' | 'days_in_period'>): string {
  const part = c.days_charged < c.days_in_period
    ? `, ${c.days_charged} of ${c.days_in_period} days`
    : ''
  return `${c.product_name} × ${c.quantity}${part}`
}

/** What a standing order costs a full month, as a number. */
export function monthlyCost(p: Pick<Purchase, 'unit_price' | 'quantity'>): number {
  return round2(p.unit_price * p.quantity)
}

/** Whether a purchase is still running on a given day. */
export function running(p: Purchase, on: string): boolean {
  return p.started_on <= on && (!p.ends_on || p.ends_on >= on)
}

/** What is still owed across a set of charges. */
export function outstanding(charges: readonly Pick<Charge, 'gross' | 'recovered'>[]): number {
  return round2(charges.reduce((n, c) => n + Math.max(0, c.gross - c.recovered), 0))
}

/* --------------------------------------------- what an adjustment is made of */

export interface AdjustmentEntry {
  note_id?: string
  charge_id?: string
  kind?: string
  amount?: number | string
  detail?: string
}

/**
 * What moved a statement's net, counted by where it came from.
 *
 * `adjustments` used to mean one thing — the credit and debit notes an operator
 * raised — and the seller's statement said so in words: "a debit of $X was
 * applied by note". Wholesale now lands in the same column, so on a reseller's
 * quarter that sentence names a document that does not exist. Sentences that
 * outlive the rule they describe are the recurring defect in this build; this
 * one is counted rather than assumed.
 */
export function adjustmentSources(detail: unknown): { notes: number; charges: number } {
  const rows = Array.isArray(detail) ? (detail as AdjustmentEntry[]) : []
  return {
    notes: rows.filter(r => r && r.note_id).length,
    charges: rows.filter(r => r && r.charge_id).length,
  }
}

/** How to name an adjustment on a statement, given what it is actually made of. */
export function adjustmentNoun(detail: unknown): string {
  const { notes, charges } = adjustmentSources(detail)
  if (charges > 0 && notes > 0) return 'by note and by wholesale charge'
  if (charges > 0) return charges === 1 ? 'by a wholesale charge' : 'by wholesale charges'
  return 'by note'
}
