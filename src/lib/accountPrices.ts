/* The rules of an account's own prices and buying rules, as pure functions.
 *
 * Every rule here mirrors the database and says so beside it. The screen
 * never decides what the database would refuse, and uses the database's
 * sentences (spec 9 section 6). Mirrors, in the migration of Task 1:
 *   guard_account_price()                 - set/edit/end rules and sentences
 *   set_account_price(), end_account_price(), promote_quote_line()
 *   guard_requisition_line_price()        - the charged price
 *   guard_requisition_line_contract()     - the off-contract rule on a line
 *   guard_requisition_off_contract()      - the header may not say "none"
 *
 * The charged price is
 *     least(published, greatest(account price, floor))
 * with today's published price and today's floor, each rounded to 2 dp as
 * Postgres `round(x, 2)` does (`round2`). Nothing converts between currencies.
 *
 * Pure: the database client is never imported here.
 */
import type { Need } from './enterprise'
import { round2 } from './money'

export type OffContractRule = 'allow' | 'reason' | 'approval'
export type PriceSource = 'negotiated' | 'quote'
export type PriceStanding = 'scheduled' | 'in force' | 'ended' | 'withdrawn'

export interface AccountPrice {
  id: string; account_id: string; product_id: string; currency: string
  unit_price: number; starts_on: string; ends_on: string | null            // ISO dates, ends_on inclusive
  source: PriceSource; quote_line_id: string | null; quote_ref: string | null
  note: string | null; set_by: string; set_at: string
  ended_by: string | null; ended_at: string | null; end_reason: string | null
}
export interface BuyingRules { account_id: string; off_contract: OffContractRule; note: string | null; updated_by: string | null; updated_on: string | null }
export interface Preference { id: string; account_id: string; kind: 'seller' | 'product'; partner_id: string | null; product_id: string | null; note: string | null; added_by: string; added_on: string }

export const DEFAULT_RULES = (account_id: string): BuyingRules =>
  ({ account_id, off_contract: 'allow', note: null, updated_by: null, updated_on: null })

type Window = { starts_on: string; ends_on: string | null }

/* ISO dates compare as strings; day arithmetic goes through UTC. */
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const maxDate = (a: string, b: string) => (a >= b ? a : b)

/** A numeric(10,2) as Postgres prints it in a message. */
const num2 = (n: number) => round2(n).toFixed(2)

const isWithdrawn = (w: Window) => w.ends_on !== null && w.ends_on < w.starts_on

/** Withdrawn: ends_on < starts_on (the table allows ends_on = starts_on - 1). */
export function standingOf(p: Pick<AccountPrice, 'starts_on' | 'ends_on'>, today: string): PriceStanding {
  if (isWithdrawn(p)) return 'withdrawn'
  if (p.starts_on > today) return 'scheduled'
  if (p.ends_on !== null && p.ends_on < today) return 'ended'
  return 'in force'
}

/** Inclusive days; a null end is open; a withdrawn window never overlaps. */
export function overlaps(a: Pick<AccountPrice, 'starts_on' | 'ends_on'>, b: Pick<AccountPrice, 'starts_on' | 'ends_on'>): boolean {
  if (isWithdrawn(a) || isWithdrawn(b)) return false
  const aReachesB = a.ends_on === null || a.ends_on >= b.starts_on
  const bReachesA = b.ends_on === null || b.ends_on >= a.starts_on
  return aReachesB && bReachesA
}

/** guard_requisition_line_price: starts_on <= today and (ends_on null or >= today), latest start. */
export function inForce(
  prices: readonly AccountPrice[],
  key: { account_id: string; product_id: string; currency: string },
  today: string,
): AccountPrice | null {
  let best: AccountPrice | null = null
  for (const p of prices) {
    if (p.account_id !== key.account_id || p.product_id !== key.product_id || p.currency !== key.currency) continue
    if (standingOf(p, today) !== 'in force') continue
    if (!best || p.starts_on > best.starts_on) best = p
  }
  return best
}

/** guard_requisition_line_price: least(published, greatest(round(account, 2), coalesce(floor, 0))). */
export function effectivePrice(published: number, floor: number | null, account: number | null): number {
  const book = round2(published)
  if (account === null) return book
  return round2(Math.min(book, Math.max(round2(account), floor === null ? 0 : round2(floor))))
}

export interface ShelfPrice { price: number; published_price: number; account_price_id: string | null; on_contract: boolean; saving: number; clamp: 'none' | 'floor' | 'published' }

export function shelfPrice(published: number, floor: number | null, row: AccountPrice | null): ShelfPrice {
  const book = round2(published)
  if (!row) return { price: book, published_price: book, account_price_id: null, on_contract: false, saving: 0, clamp: 'none' }
  const agreed = round2(row.unit_price)
  const f = floor === null ? 0 : round2(floor)
  const price = effectivePrice(published, floor, row.unit_price)
  const clamp: ShelfPrice['clamp'] = agreed > book ? 'published' : agreed < f ? 'floor' : 'none'
  return { price, published_price: book, account_price_id: row.id, on_contract: true, saving: round2(book - price), clamp }
}

export interface PriceDraft { account_id: string; product_id: string; currency: string; unit_price: number; starts_on: string; ends_on: string | null; note: string; quote_line_id?: string | null }
export type PriceField = 'product_id' | 'currency' | 'unit_price' | 'starts_on' | 'ends_on' | 'note'

/** The sentences of guard_account_price (insert branch), in its order. company, market and productName
 *  only fill the database's sentences; without them a plain noun stands in. */
export function priceDraftProblems(d: PriceDraft, ctx: {
  today: string; published: number | null; floor: number | null
  currencies: readonly string[]; businessListing: boolean
  company?: string; market?: string; productName?: string
}): Partial<Record<PriceField, string>> {
  const out: Partial<Record<PriceField, string>> = {}
  const name = ctx.productName ?? 'This listing'
  if (!(d.unit_price > 0)) out.unit_price = 'Enter a price above zero.'
  if (d.starts_on < ctx.today) {
    out.starts_on = 'A price starts today or later. Requisitions already raised were checked against the price that applied then.'
  }
  if (d.ends_on !== null && d.ends_on < d.starts_on) {
    out.ends_on = 'A new price has to run for at least one day: it ends before it starts.'
  }
  if (!ctx.currencies.includes(d.currency)) {
    out.currency = `${ctx.company ?? 'This account'} buys in ${ctx.market ?? 'its market'}, which does not trade in ${d.currency}.`
  }
  if (!ctx.businessListing) {
    out.product_id = `${name} is not sold to business accounts, so it has no account price.`
  } else if (ctx.published === null) {
    out.product_id = `${name} has no published price in ${d.currency}, so there is nothing to agree a price against.`
  } else if (d.unit_price > 0) {
    const unit = round2(d.unit_price)
    if (unit > round2(ctx.published)) {
      out.unit_price = `That is above the published price of ${d.currency} ${num2(ctx.published)} for ${name}. An account price is at or below it.`
    } else if (ctx.floor !== null && unit < round2(ctx.floor)) {
      out.unit_price = `That is below the floor of ${d.currency} ${num2(ctx.floor)} that the seller of ${name} agreed. An account price never goes under it.`
    }
  }
  if (d.note.length > 300) out.note = 'A note is at most 300 characters.'
  return out
}

/** set_account_price: same key, not withdrawn, reaching d.starts_on or later, not starting after d.ends_on.
 *  New end = greatest(starts_on - 1, old.starts_on - 1); at old.starts_on - 1 the row is withdrawn. */
export function replacedBy(
  existing: readonly AccountPrice[], d: PriceDraft, today: string,
): { id: string; ends_on: string; withdrawn: boolean }[] {
  void today
  const out: { id: string; ends_on: string; withdrawn: boolean }[] = []
  for (const p of existing) {
    if (p.account_id !== d.account_id || p.product_id !== d.product_id || p.currency !== d.currency) continue
    if (isWithdrawn(p)) continue
    if (p.ends_on !== null && p.ends_on < d.starts_on) continue
    if (d.ends_on !== null && p.starts_on > d.ends_on) continue
    const ends_on = maxDate(addDays(d.starts_on, -1), addDays(p.starts_on, -1))
    out.push({ id: p.id, ends_on, withdrawn: ends_on < p.starts_on })
  }
  return out
}

/** end_account_price: ends_on = greatest(current_date - 1, starts_on - 1). */
export function endOn(p: Pick<AccountPrice, 'starts_on'>, today: string): string {
  return maxDate(addDays(today, -1), addDays(p.starts_on, -1))
}

/** Quoted, bundle and product-less lines are held by their own guards (not off contract here);
 *  an ordinary line is off contract unless a price is in force for it. */
export function lineContract(
  line: { product_id: string | null; quote_line_id?: string | null; bundle_selection_id?: string | null },
  prices: readonly AccountPrice[], account_id: string, currency: string, today: string,
): { off: boolean; account_price_id: string | null } {
  if (!line.product_id || line.quote_line_id || line.bundle_selection_id) return { off: false, account_price_id: null }
  const row = inForce(prices, { account_id, product_id: line.product_id, currency }, today)
  return row ? { off: false, account_price_id: row.id } : { off: true, account_price_id: null }
}

/** guard_requisition_line_contract: under 'approval' a requisition with an off-contract line cannot need none. */
export function needWithRules(need: Need, anyOff: boolean, rule: OffContractRule): Need {
  if (rule !== 'approval' || !anyOff) return need
  if (need === 'none') return 'finance'
  if (need === 'it') return 'both'
  return need
}

export function offContractNote(rule: OffContractRule, offCount: number): string | null {
  if (rule === 'allow' || offCount <= 0) return null
  const lines = offCount === 1 ? '1 line is' : `${offCount} lines are`
  return rule === 'reason'
    ? `${lines} off the account's price book — a reason is recorded for each`
    : `${lines} off the account's price book — finance approval required`
}

/** guard_requisition_line_contract: btrim, then at least 5; the column holds at most 300. */
export function offContractReasonProblem(reason: string | null | undefined, name?: string): string | null {
  const n = (reason ?? '').trim().length
  if (n < 5) {
    return name
      ? `${name} is not on your account's price book, and your buying rules ask for a reason when you buy off it. Say why on the line (at least 5 characters).`
      : 'Say why on the line (at least 5 characters).'
  }
  if (n > 300) return 'Keep the reason to 300 characters or fewer.'
  return null
}

export function showsOffContract(rules: Pick<BuyingRules, 'off_contract'>, prices: readonly AccountPrice[], today: string): boolean {
  return rules.off_contract !== 'allow' || prices.some(p => standingOf(p, today) === 'in force')
}

export function preferenceOf(l: { id: string; partner_id: string | null }, prefs: readonly Preference[]): 'product' | 'seller' | null {
  if (prefs.some(p => p.kind === 'product' && p.product_id === l.id)) return 'product'
  if (l.partner_id && prefs.some(p => p.kind === 'seller' && p.partner_id === l.partner_id)) return 'seller'
  return null
}

/** Preferred products, then preferred sellers' listings, then the rest; stable within each. */
export function orderShelf<T extends { id: string; partner_id: string | null }>(listings: readonly T[], prefs: readonly Preference[]): T[] {
  const rank = (l: T) => { const k = preferenceOf(l, prefs); return k === 'product' ? 0 : k === 'seller' ? 1 : 2 }
  return listings.map((l, i) => ({ l, i, r: rank(l) })).sort((a, b) => a.r - b.r || a.i - b.i).map(x => x.l)
}

export function ruleSummary(rule: OffContractRule): { title: string; buyer: string; approver: string } {
  switch (rule) {
    case 'reason':
      return {
        title: 'Buying off the price book needs a reason',
        buyer: 'Say why on each line that is not on your price book.',
        approver: 'You see the buyer\'s reason beside each off-book line.',
      }
    case 'approval':
      return {
        title: 'Buying off the price book needs approval',
        buyer: 'A requisition with a line off your price book goes to a finance approver.',
        approver: 'Every requisition with an off-book line comes to finance, however small.',
      }
    default:
      return {
        title: 'Buying off the price book is allowed',
        buyer: 'Buy any listing; your account\'s prices apply where there are some.',
        approver: 'Off-book lines are marked, and nothing more is asked.',
      }
  }
}

export interface QuoteLineForPromotion { id: string; enquiry_id: string; account_id: string; status: string; currency: string; product_id: string; name: string; quoted_unit_price: number | null }

/** Accepted, priced, and not already the in-force price for that key at that figure. */
export function promotable(lines: readonly QuoteLineForPromotion[], prices: readonly AccountPrice[], today: string): QuoteLineForPromotion[] {
  return lines.filter(l => {
    if (l.status !== 'accepted' || l.quoted_unit_price === null) return false
    const cur = inForce(prices, { account_id: l.account_id, product_id: l.product_id, currency: l.currency }, today)
    return !(cur && round2(cur.unit_price) === round2(l.quoted_unit_price))
  })
}
