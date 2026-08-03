/* An amount and the currency it is in, which are one thing and not two.
 *
 * This marketplace had forty-five tables of bare numbers and six formatters
 * that each stuck a dollar sign on the front. That works exactly as long as
 * there is one currency, and fails silently the moment there are four: the
 * numbers keep adding up, they just stop meaning anything.
 *
 * So `Money` is a pair, and the operations that would lose the currency are
 * the ones this module refuses to perform. Three rules, all of them the sort
 * that are obvious until three in the afternoon:
 *
 *   1. Amounts in different currencies do not add. Not with a warning, not
 *      with a default — `add` returns null and `sumOf` refuses a mixed list.
 *      Converting first is a decision with a rate and a date attached, and it
 *      has to be made deliberately.
 *   2. A rate is looked up *as of a date*, and that date is the document's,
 *      not today's. A bill issued in July is a July bill forever.
 *   3. Rates are held one way and inverted on read, so a pair can never
 *      disagree with itself.
 *
 * Pure — no Supabase import. The rows come from `moneyRepo.ts`.
 */

export interface Currency {
  code: string
  name: string
  symbol: string
  minor_units: number
  symbol_first: boolean
  locale: string
  is_reporting: boolean
  sort_order: number
}

export interface Rate {
  base: string
  quote: string
  rate: number
  as_of: string
  pegged: boolean
  source?: string
}

export interface Market {
  code: string
  /* The currency a shopper is quoted in before choosing otherwise. A market may
     accept more than one — see `MarketCurrency` — and this is the default, kept
     in step with it by a database trigger rather than set alongside it. */
  currency: string
  name: string
  tax_label: string
  tax_rate: number
  tax_note: string
  is_default: boolean
  sort_order: number
}

/**
 * A currency a market will take money in.
 *
 * Kenya trades in shillings and dollars, the UAE in dirhams and dollars, India
 * in rupees alone. The tax does not follow the currency — a Kenyan sale is VAT
 * at 16% whether it is priced in shillings or dollars — so this says only what
 * a customer may be charged in, never at what rate.
 */
export interface MarketCurrency {
  market_code: string
  currency: string
  is_default: boolean
  sort_order: number
}

/** The currencies a market accepts, default first. */
export function currenciesOf(
  code: string, accepted: readonly MarketCurrency[],
): string[] {
  return accepted
    .filter(a => a.market_code === code)
    .sort((a, b) => Number(b.is_default) - Number(a.is_default) || a.sort_order - b.sort_order)
    .map(a => a.currency)
}

export const marketTakes = (
  code: string, currency: string, accepted: readonly MarketCurrency[],
): boolean => accepted.some(a => a.market_code === code && a.currency === currency)

/**
 * The markets that take a currency — the inverse of `currenciesOf`.
 *
 * A price editor row is headed by a currency, and a dollar price is not a
 * market: it is on sale in Nairobi and in Dubai at once. Naming only the first
 * market found with that currency would have quietly told a seller their dollar
 * price was a UAE price.
 */
export function marketsTaking(
  currency: string, accepted: readonly MarketCurrency[], markets: readonly Market[] = [],
): string[] {
  const codes = accepted.filter(a => a.currency === currency).map(a => a.market_code)
  if (!markets.length) return [...new Set(codes)].sort()
  /* Ordered as the markets themselves are, so "India · Kenya" reads the same
     way wherever markets are listed. */
  return markets.filter(m => codes.includes(m.code)).map(m => m.code)
}

/** An amount is never separated from the currency it is in. */
export interface Money {
  amount: number
  currency: string
}

export const money = (amount: number, currency: string): Money => ({ amount, currency })

/* ------------------------------------------------------------ rounding --- */

/**
 * Round to the currency's own precision.
 *
 * Half away from zero, which is what invoices do — a refund of -0.005 and a
 * charge of 0.005 should land the same distance from zero, and JavaScript's
 * `Math.round` sends -0.005 to -0 and 0.005 to 1.
 *
 * `minor_units` is read rather than assumed. Every currency in this
 * marketplace happens to have two, and code written around that assumption is
 * code that rounds a three-decimal dinar wrong the day one is added.
 */
export function roundMinor(amount: number, minorUnits: number): number {
  const factor = 10 ** minorUnits
  const scaled = amount * factor
  /* The epsilon nudges values that binary floating point put a hair below the
     midpoint — 1.005 is stored as 1.00499999… and would otherwise round down,
     which on a tax line is a cent that never balances. */
  const rounded = Math.sign(scaled) * Math.round(Math.abs(scaled) + Number.EPSILON * Math.abs(scaled))
  const out = rounded / factor
  /* -0 formats as "-0.00", which on a statement reads as a debt of nothing. */
  return out === 0 ? 0 : out
}

export const round = (m: Money, currencies: readonly Currency[]): Money =>
  money(roundMinor(m.amount, minorUnitsOf(m.currency, currencies)), m.currency)

export function minorUnitsOf(code: string, currencies: readonly Currency[]): number {
  return currencies.find(c => c.code === code)?.minor_units ?? 2
}

/* --------------------------------------------------------- arithmetic --- */

/**
 * Two amounts, added — or null, when they are in different currencies.
 *
 * Null rather than a throw because the caller is usually a component, and a
 * screen that renders "—" where a total belongs is recoverable while one that
 * has thrown is not. The refusal still has to be handled; it just cannot take
 * the page down.
 */
export function add(a: Money, b: Money): Money | null {
  return a.currency === b.currency ? money(a.amount + b.amount, a.currency) : null
}

export const negate = (m: Money): Money => money(-m.amount, m.currency)

/** Every currency present in a list, in no particular order. */
export function currenciesIn(list: readonly Money[]): string[] {
  return [...new Set(list.map(m => m.currency))]
}

export const isMixed = (list: readonly Money[]): boolean => currenciesIn(list).length > 1

/**
 * The total of a list that is all one currency.
 *
 * Returns null for a mixed list. That is the whole point of the function: the
 * operator's gross-sales tile added rupees to dirhams to shillings and printed
 * the result next to a dollar sign, and no amount of care downstream detects
 * that, because the sum is a perfectly ordinary number.
 */
export function sumOf(list: readonly Money[]): Money | null {
  if (list.length === 0) return null
  if (isMixed(list)) return null
  return money(list.reduce((n, m) => n + m.amount, 0), list[0].currency)
}

/** A list split into one bucket per currency, so a mixed total can at least be shown honestly. */
export function byCurrency(list: readonly Money[]): { currency: string; total: Money; count: number }[] {
  const buckets = new Map<string, Money[]>()
  for (const m of list) {
    const held = buckets.get(m.currency)
    if (held) held.push(m); else buckets.set(m.currency, [m])
  }
  return [...buckets.entries()]
    .map(([currency, ms]) => ({ currency, total: sumOf(ms)!, count: ms.length }))
    .sort((a, b) => b.total.amount - a.total.amount)
}

/**
 * Several currencies, said as several figures.
 *
 * The counterpart to `byCurrency`: that one refuses to add them, this one
 * writes what it got. "₹89,980 · AED 2,547" is longer than a single number and
 * it is the only honest thing to put in a box labelled "at stake" — the sum
 * would be a quantity of nothing, and it would look entirely reasonable on the
 * screen, which is what makes it worth a function of its own rather than a
 * `.join` written out at each call site with a different fallback.
 */
export function formatGroups(
  groups: readonly { currency: string; total: Money }[],
  fmt: (amount: number, currency: string) => string,
  empty = '—',
): string {
  if (groups.length === 0) return empty
  return groups.map(g => fmt(g.total.amount, g.currency)).join(' · ')
}

/* ---------------------------------------------------------- exchange --- */

/**
 * The rate to use for a conversion on a given day.
 *
 * The most recent rate *at or before* the date — not the nearest, and
 * emphatically not the newest. A document dated the 15th of July is converted
 * at the rate that was in force on the 15th of July, which is the 1 July fix.
 * Using the newest rate is how a reprint of an old invoice comes out different
 * from the original, and it is the single most common way currency handling
 * goes wrong.
 *
 * Returns null when there is no rate that old, rather than falling back to the
 * closest one: a conversion nobody has a rate for is a conversion that should
 * not silently happen.
 */
export function rateOn(
  rates: readonly Rate[], base: string, quote: string, asOf: string,
): { rate: number; as_of: string; pegged: boolean; inverted: boolean } | null {
  if (base === quote) return { rate: 1, as_of: asOf, pegged: false, inverted: false }

  const usable = (r: Rate) => r.as_of <= asOf
  const newest = (a: Rate, b: Rate) => (a.as_of > b.as_of ? a : b)

  const direct = rates.filter(r => r.base === base && r.quote === quote && usable(r))
  if (direct.length) {
    const r = direct.reduce(newest)
    return { rate: r.rate, as_of: r.as_of, pegged: r.pegged, inverted: false }
  }

  /* Held one way, so the other way is derived. Deriving beats storing both:
     a stored inverse is rounded, and a rounded inverse means converting there
     and back does not return the amount you started with. */
  const reverse = rates.filter(r => r.base === quote && r.quote === base && usable(r))
  if (reverse.length) {
    const r = reverse.reduce(newest)
    return { rate: 1 / r.rate, as_of: r.as_of, pegged: r.pegged, inverted: true }
  }

  return null
}

export interface Converted {
  money: Money
  /* What was used, so a screen or a document can say so. A converted figure
     presented without its rate and date is a figure nobody can check. */
  rate: number
  as_of: string
  from: string
}

/**
 * Convert, at a rate the caller has already chosen.
 *
 * The rate is a parameter rather than a lookup inside, because the choice of
 * *which day's* rate applies belongs to the thing being converted — a bill
 * knows its own issue date and this function does not.
 */
export function convert(
  m: Money, to: string, rate: number, asOf: string, currencies: readonly Currency[] = [],
): Converted {
  const raw = m.currency === to ? m.amount : m.amount * rate
  const amount = currencies.length ? roundMinor(raw, minorUnitsOf(to, currencies)) : raw
  return { money: money(amount, to), rate: m.currency === to ? 1 : rate, as_of: asOf, from: m.currency }
}

/**
 * A mixed list expressed in one currency, at one date's rates.
 *
 * The honest version of what the operator's dashboard was doing. Returns the
 * total *and* what it took to get there — the rate date, and any currency that
 * could not be converted, because a total quietly computed over four of five
 * currencies is worse than no total.
 */
export function totalIn(
  list: readonly Money[], target: string, rates: readonly Rate[], asOf: string,
  currencies: readonly Currency[] = [],
): { total: Money; asOf: string; missing: string[] } {
  const missing: string[] = []
  let sum = 0
  for (const m of list) {
    const r = rateOn(rates, m.currency, target, asOf)
    if (!r) { if (!missing.includes(m.currency)) missing.push(m.currency); continue }
    sum += m.currency === target ? m.amount : m.amount * r.rate
  }
  const amount = currencies.length ? roundMinor(sum, minorUnitsOf(target, currencies)) : sum
  return { total: money(amount, target), asOf, missing }
}

/* --------------------------------------------------------- formatting --- */

/**
 * An amount as somebody in that market would write it.
 *
 * The number is grouped by the currency's own locale — en-IN groups by lakh,
 * so a hundred thousand rupees is ₹1,00,000 and not ₹100,000 — and the symbol
 * comes from the currency row so the operator controls the mark rather than
 * whatever the browser's ICU data happens to carry.
 */
export function format(
  m: Money, currencies: readonly Currency[],
  opts: { decimals?: boolean; code?: boolean } = {},
): string {
  const cur = currencies.find(c => c.code === m.currency)
  const digits = opts.decimals === false ? 0 : (cur?.minor_units ?? 2)
  const rounded = roundMinor(m.amount, cur?.minor_units ?? 2)

  const body = Math.abs(rounded).toLocaleString(cur?.locale ?? 'en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  })

  const symbol = cur?.symbol ?? m.currency
  /* The sign goes outside the symbol. "$-1,893.44" is not how anybody writes a
     negative amount, and it turned up on a seller statement. */
  const sign = rounded < 0 ? '-' : ''
  const marked = (cur?.symbol_first ?? true)
    /* A multi-letter mark needs a space: "AED1,200" is unreadable, "$1,200"
       is not. An ordinary space, deliberately — a non-breaking space is the
       better typography and the worse decision here, because finance people
       paste these figures into spreadsheets and U+00A0 stops Excel reading the
       result as a number. */
    ? `${symbol}${symbol.length > 1 ? ' ' : ''}${body}`
    : `${body} ${symbol}`

  return `${sign}${marked}${opts.code ? ` ${m.currency}` : ''}`
}

/**
 * Just the mark, for a column header, an axis label or a document.
 *
 * Falls back to the ISO code, which is not a compromise — "AED 757.28" is
 * unambiguous and is how a cross-border invoice is usually written anyway. What
 * must never happen is a bare number, or somebody else's symbol.
 */
export const symbolOf = (code: string, currencies: readonly Currency[] = []): string =>
  currencies.find(c => c.code === code)?.symbol ?? code

/**
 * The mark with the gap already in it, for somewhere that concatenates rather
 * than formats — a document line, a PDF column.
 *
 * The same rule `format` applies, in one place, so the storefront's
 * "AED 1,200.00" and a bill's "AED757.28" cannot disagree about whether a
 * three-letter mark takes a space.
 */
export const markFor = (code: string, currencies: readonly Currency[] = []): string => {
  const mark = symbolOf(code, currencies)
  return mark.length > 1 ? `${mark} ` : mark
}

/* ------------------------------------------------------------- pricing --- */

/**
 * What a converted price should actually be listed at.
 *
 * Telecom prices are chosen, not computed. A plan is ₹999 or AED 49 or
 * KSh 1,500 — nobody in any market lists a plan at ₹1,082.67, which is what
 * $12.39 converts to. Seeding a price book by straight conversion produces a
 * catalogue that is instantly recognisable as fake.
 *
 * So a converted price is pulled to the nearest price a human would have
 * picked: a round step appropriate to the magnitude, minus one minor step, in
 * the local idiom. The steps get coarser as the number gets bigger, because
 * ₹999 and ₹49,999 are both plausible and ₹1,08,267 is not.
 */
export function charmPrice(amount: number, currency: string): number {
  if (amount <= 0) return 0

  /* Roughly "how many digits", so the same rule works for a 1.40 dollar add-on
     and a 400,000 rupee fleet contract. */
  const steps = currency === 'INR' ? [10, 50, 100, 500, 1000, 5000]
    : currency === 'KES' ? [10, 50, 100, 500, 1000, 5000]
    : [1, 5, 10, 50, 100, 500]

  /* The largest step that is still no more than a tenth of the amount, so the
     price never moves far. Choosing the step by digit count instead looks
     right and is not: ₹122 sits in the same bracket as ₹999, gets a step of
     50, and lands on ₹99 — a fifth of the price gone. */
  const step = [...steps].reverse().find(s => s <= amount / 10) ?? steps[0]

  const nearest = Math.round(amount / step) * step
  if (nearest <= 0) return step

  /* The trailing 9. Only where it leaves the number recognisable — knocking 1
     off a 10-step price gives 999, which is the point; knocking 1 off a
     5000-step price gives 44,999, which is also how these are priced. */
  const charmed = nearest - (step >= 10 ? 1 : 0.01)
  return roundMinor(charmed, 2)
}

/**
 * The struck-through price, if there is honestly one to show.
 *
 * Rounding a price and its "was" figure independently can land them on the
 * same number: $11.52 down from $12.00 is a 4% saving, and in rupees both
 * become ₹999. A strikethrough showing the price it is struck through against
 * is not a discount — it is a claim about a saving that was not made, which is
 * the one pricing error that is also an advertising offence.
 *
 * So a "was" that does not exceed the price is dropped rather than shown.
 */
export function wasPriceFor(price: number, was: number | null | undefined): number | null {
  return was != null && was > price ? was : null
}

/** Whether a price book row is internally consistent: floor <= price <= list. */
export function priceBandOk(
  row: { price: number; floor_price?: number | null; list_price?: number | null },
): boolean {
  if (row.floor_price != null && row.floor_price > row.price) return false
  if (row.list_price != null && row.list_price < row.price) return false
  return true
}
