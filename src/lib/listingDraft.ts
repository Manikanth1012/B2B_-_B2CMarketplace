/**
 * What a listing has to say for itself, per kind.
 *
 * The wizard asked one set of questions for all three kinds. A bundle was a
 * single product with a different word on the radio button — nothing asked what
 * was in it — and a subscription was never asked how often it bills, so a
 * yearly licence and a monthly SIM plan came out as the same row. It also asked
 * for one price in dollars while the seller was approved to trade in three
 * markets taking three currencies, and said nothing at all about where the
 * thing could be bought.
 *
 * These are the rules for all of that, kept here so the form and the write
 * agree rather than each having an opinion.
 */
import type { Check } from './enterprise'

export type ListingKind = 'single' | 'bundle' | 'subscription'

export const LISTING_KINDS: { id: ListingKind; label: string; blurb: string }[] = [
  { id: 'single', label: 'Single product', blurb: 'One SKU, one price' },
  { id: 'bundle', label: 'Bundle', blurb: 'Several of your listings sold as one' },
  { id: 'subscription', label: 'Subscription', blurb: 'Recurring, cancellable' },
]

export type BillingPeriod = 'monthly' | 'quarterly' | 'half-yearly' | 'yearly'

/* `months` is what makes these comparable. A quarterly price and a monthly one
   are not the same number, and anything that totals them has to know by how
   much — an annual figure divided by the wrong count is the mistake this exists
   to make impossible. */
export const BILLING_PERIODS: { id: BillingPeriod; label: string; months: number; suffix: string }[] = [
  { id: 'monthly', label: 'Monthly', months: 1, suffix: '/mo' },
  { id: 'quarterly', label: 'Quarterly', months: 3, suffix: '/qtr' },
  { id: 'half-yearly', label: 'Half-yearly', months: 6, suffix: '/6 mo' },
  { id: 'yearly', label: 'Yearly', months: 12, suffix: '/yr' },
]

export function periodOf(id: string | null): typeof BILLING_PERIODS[number] | null {
  return BILLING_PERIODS.find(p => p.id === id) ?? null
}

/** What a price in this period comes to a month, for comparing like with like. */
export function monthlyEquivalent(amount: number, period: BillingPeriod): number {
  const p = periodOf(period)
  if (!p) return amount
  return Math.round((amount / p.months) * 100) / 100
}

/** `products.model` — recurring or not. The period says how often. */
export function modelFor(kind: ListingKind): 'oneoff' | 'monthly' {
  return kind === 'subscription' ? 'monthly' : 'oneoff'
}

/* ------------------------------------------------------------- markets --- */

export interface MarketOption {
  code: string
  name: string
  /* Every currency that market takes, its default first. A seller pricing for
     the UAE has to give a dirham figure and may give a dollar one. */
  currencies: string[]
  /* The market's own tax, which is the market's fact and not the seller's.
     India charges 18% GST, Kenya 16% VAT, the UAE 5% VAT — the wizard used to
     ask a seller to type one number for a listing sold in all three, and it
     defaulted to 18. */
  taxRate: number
  taxLabel: string
}

/**
 * What each market this listing is sold in charges, and what that means for the
 * price given in that market's currency.
 *
 * One row per market rather than one rate for the listing: the seller declares
 * a basis — whether their figure includes tax or not — and the rate that then
 * applies is the buyer's market's. Those are different kinds of fact and only
 * one of them is the seller's to state.
 */
export function taxPerMarket(
  chosen: readonly string[],
  markets: readonly MarketOption[],
  prices: readonly PriceRow[],
  includesTax: boolean,
): { code: string; name: string; label: string; rate: number; currency: string; gross: number; net: number; tax: number }[] {
  return chosen.flatMap(code => {
    const m = markets.find(x => x.code === code)
    if (!m) return []
    /* The market's own currency — its first — is what a buyer there is quoted
       in, so that is the row whose figure this splits. */
    const currency = m.currencies[0]
    const row = prices.find(r => r.currency === currency)
    const price = parseFloat(row?.price ?? '') || 0
    const rate = m.taxRate / 100
    const net = includesTax ? (rate === 0 ? price : price / (1 + rate)) : price
    const gross = includesTax ? price : price * (1 + rate)
    return [{
      code, name: m.name, label: m.taxLabel, rate: m.taxRate, currency,
      gross: Math.round(gross * 100) / 100,
      net: Math.round(net * 100) / 100,
      tax: Math.round((gross - net) * 100) / 100,
    }]
  })
}

/**
 * The currencies a listing must carry a price in, given where it is sold.
 *
 * The union rather than the intersection: a listing sold in India and the UAE
 * needs rupees *and* dirhams, because a buyer in each is quoted in their own
 * market's money and neither is converted from the other.
 */
export function currenciesFor(chosen: readonly string[], markets: readonly MarketOption[]): string[] {
  const out: string[] = []
  for (const code of chosen) {
    const m = markets.find(x => x.code === code)
    if (!m) continue
    for (const c of m.currencies) if (!out.includes(c)) out.push(c)
  }
  return out
}

export function validateMarkets(chosen: readonly string[], approved: readonly MarketOption[]): Check {
  if (!chosen.length) {
    return { ok: false, reason: 'Say where this is sold. A listing in no market cannot be bought anywhere.' }
  }
  const stranger = chosen.find(c => !approved.some(m => m.code === c))
  if (stranger) {
    return { ok: false, reason: `You are not approved to trade in ${stranger}, so nothing can be listed there.` }
  }
  return { ok: true }
}

/* -------------------------------------------------------------- prices --- */

export interface PriceRow {
  currency: string
  price: string
  floor: string
  list: string
}

export function blankPrices(currencies: readonly string[]): PriceRow[] {
  return currencies.map(currency => ({ currency, price: '', floor: '', list: '' }))
}

/** Keeps what has been typed while following a change of market. */
export function reconcilePrices(rows: readonly PriceRow[], currencies: readonly string[]): PriceRow[] {
  return currencies.map(c => rows.find(r => r.currency === c) ?? { currency: c, price: '', floor: '', list: '' })
}

const num = (s: string) => {
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : 0
}

/**
 * Every currency priced, and each one's band coherent on its own terms.
 *
 * Per currency rather than once: these are chosen figures, not conversions of
 * one another, so a floor above a price in dirhams is wrong however sensible
 * the rupee row is.
 */
export function validatePrices(rows: readonly PriceRow[]): Check {
  if (!rows.length) return { ok: false, reason: 'There are no currencies to price in yet — choose where it is sold first.' }

  for (const r of rows) {
    const price = num(r.price)
    if (price <= 0) return { ok: false, reason: `Give the price in ${r.currency}. A market it is sold in with no price is one nobody can buy in.` }

    const floor = num(r.floor) || price
    const list = num(r.list) || price
    if (floor > price) {
      return { ok: false, reason: `In ${r.currency} the floor (${r.floor}) is above the asking price (${r.price}).` }
    }
    if (list < price) {
      return { ok: false, reason: `In ${r.currency} the list price (${r.list}) is below the asking price, so the saving would be negative.` }
    }
  }
  return { ok: true }
}

/* ------------------------------------------------------------- bundles --- */

export interface BundleComponent {
  product_id: string
  name: string
  quantity: number
  /* What it sells for on its own, in the listing's first currency — what makes
     the bundle's saving a real number rather than a claim. */
  unit_price: number
}

export interface BundleRules {
  min_components: number
  max_components: number
  /* Percent. A bundle cheaper than this against its parts is not a discount, it
     is a mispriced listing — usually a component quantity somebody mistyped. */
  max_discount: number
}

export function componentsTotal(items: readonly BundleComponent[]): number {
  return Math.round(items.reduce((s, c) => s + c.quantity * c.unit_price, 0) * 100) / 100
}

/** What the bundle saves against buying its parts separately, as a percentage. */
export function bundleSaving(price: number, items: readonly BundleComponent[]): number {
  const parts = componentsTotal(items)
  if (parts <= 0) return 0
  return Math.round(((parts - price) / parts) * 1000) / 10
}

export function validateBundle(
  items: readonly BundleComponent[], price: number, rules: BundleRules,
): Check {
  if (items.length < rules.min_components) {
    return {
      ok: false,
      reason: `A bundle holds at least ${rules.min_components} of your listings. This one has ${items.length}.`,
    }
  }
  if (items.length > rules.max_components) {
    return { ok: false, reason: `A bundle holds at most ${rules.max_components} listings.` }
  }
  if (items.some(c => c.quantity < 1)) {
    return { ok: false, reason: 'Every item in a bundle needs a quantity of at least one.' }
  }
  const parts = componentsTotal(items)
  if (price > parts) {
    return {
      ok: false,
      reason: `The bundle costs more than its parts bought separately (${parts.toFixed(2)}). Nobody would buy it.`,
    }
  }
  const saving = bundleSaving(price, items)
  if (saving > rules.max_discount) {
    return {
      ok: false,
      reason: `That is ${saving}% off the parts, above the ${rules.max_discount}% a bundle may discount. Check the quantities.`,
    }
  }
  return { ok: true }
}

/* --------------------------------------------------------- the whole of it */

export interface DraftShape {
  kind: ListingKind
  name: string
  markets: readonly string[]
  prices: readonly PriceRow[]
  billingPeriod: BillingPeriod | null
  components: readonly BundleComponent[]
}

/**
 * What is still missing, in the order the wizard asks for it, so the first
 * thing named is the first thing to go back to.
 */
export function draftOutstanding(draft: DraftShape): string[] {
  const out: string[] = []
  if (!draft.name.trim()) out.push('a name')
  if (!draft.markets.length) out.push('at least one market to sell it in')
  if (draft.kind === 'subscription' && !draft.billingPeriod) out.push('how often it bills')
  if (draft.kind === 'bundle' && draft.components.length < 2) {
    out.push('the listings this bundle is made of')
  }
  const unpriced = draft.prices.filter(r => num(r.price) <= 0).map(r => r.currency)
  if (unpriced.length) {
    out.push(unpriced.length === 1 ? `a price in ${unpriced[0]}` : `prices in ${unpriced.join(', ')}`)
  }
  return out
}
