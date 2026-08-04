/**
 * Reading a catalogue feed a seller uploads. Pure.
 *
 * "Bulk upload — CSV or catalogue feed" was a toast. A seller with forty SKUs
 * had the same wizard forty times, and the button that acknowledged the problem
 * did nothing about it.
 *
 * Everything here reduces a file to `SellerSubmission`s and refusals. It never
 * writes: the same `submitForReview` a single listing goes through takes each
 * row, so a bulk-uploaded listing is subject to every rule a hand-typed one is
 * — approval, the cost floor, the market grants, the review queue. A separate
 * import path that skipped any of those would be a way to get a listing into
 * the catalogue that the wizard would have refused.
 */
import type { MarketOption, PriceRow } from './listingDraft'
import { currenciesFor, validateMarkets, validatePrices, LISTING_KINDS, BILLING_PERIODS, modelFor } from './listingDraft'
import type { ListingKind } from './listingDraft'

export interface FeedRow {
  /* 1-based line in the file, so a refusal can name where to look. */
  line: number
  kind: ListingKind
  name: string
  description: string
  categoryId: string
  subCategory: string
  fulfil: string
  markets: string[]
  billingPeriod: string | null
  cost: number
  tags: string[]
  prices: PriceRow[]
}

export interface FeedProblem {
  line: number
  name: string
  reason: string
}

export interface Feed {
  rows: FeedRow[]
  problems: FeedProblem[]
}

/* The columns the template writes. Price columns are named per currency —
   `price_INR`, `floor_INR`, `list_INR` — because a seller approved for three
   markets has to give a figure in each, and one `price` column would force the
   thing the per-currency price book exists to prevent. */
export const FEED_FIXED = [
  'kind', 'name', 'description', 'category', 'sub_category', 'fulfil',
  'markets', 'billing_period', 'cost', 'tags',
] as const

export function feedColumns(currencies: readonly string[]): string[] {
  return [
    ...FEED_FIXED,
    ...currencies.flatMap(c => [`price_${c}`, `floor_${c}`, `list_${c}`]),
  ]
}

/**
 * A template with one worked example in it.
 *
 * An empty header row is a file somebody has to guess the format of. The
 * example row uses the seller's own first market and category, so what they
 * open is a thing that would import if they pressed the button — which is the
 * only reliable way to document a format.
 */
export function feedTemplate(
  markets: readonly MarketOption[], categories: readonly { id: string; name: string }[],
): string[][] {
  const currencies = currenciesFor(markets.map(m => m.code), markets)
  const head = feedColumns(currencies)
  const example: Record<string, string> = {
    kind: 'single',
    name: 'Example — delete this row',
    description: 'One sentence a buyer reads before they buy it.',
    category: categories[0]?.id ?? '',
    sub_category: 'General',
    fulfil: 'shipped',
    markets: markets.map(m => m.code).join('|'),
    billing_period: '',
    cost: '0',
    tags: 'example|delete-me',
  }
  for (const c of currencies) {
    example[`price_${c}`] = '0'
    example[`floor_${c}`] = ''
    example[`list_${c}`] = ''
  }
  return [head, head.map(h => example[h] ?? '')]
}

/* Splitting a line respecting quotes, because a description with a comma in it
   is the normal case and losing half of it is not a formatting quibble — it is
   the sentence a buyer reads. */
export function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === delimiter) {
      out.push(cell); cell = ''
    } else {
      cell += ch
    }
  }
  out.push(cell)
  return out.map(c => c.trim())
}

const num = (s: string | undefined) => {
  const n = parseFloat((s ?? '').replace(/[, ]/g, ''))
  return Number.isFinite(n) ? n : 0
}

const list = (s: string | undefined) =>
  (s ?? '').split(/[|;]/).map(x => x.trim()).filter(Boolean)

/**
 * Reading the file.
 *
 * A row is refused with a reason and the rest of the file still imports. The
 * alternative — refusing the whole file for one bad row — means a seller with
 * one typo in row 34 re-uploads forty listings and gets duplicates of the
 * thirty-three that worked.
 */
export function parseFeed(
  text: string,
  { markets, categories }: { markets: readonly MarketOption[]; categories: readonly { id: string; name: string }[] },
): Feed {
  const clean = text.replace(/^﻿/, '').trim()
  if (!clean) return { rows: [], problems: [{ line: 0, name: '', reason: 'The file is empty.' }] }

  const lines = clean.split(/\r?\n/).filter(l => l.trim())
  const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ','
  const head = splitCsvLine(lines[0], delimiter).map(h => h.toLowerCase().replace(/\s+/g, '_'))

  if (!head.includes('name')) {
    return {
      rows: [],
      problems: [{
        line: 1, name: '',
        reason: `The first row has to name the columns. Expected ${FEED_FIXED.join(', ')} and a price column per currency — found ${head.join(', ') || 'nothing'}.`,
      }],
    }
  }

  const approved = markets.map(m => m.code)
  const currencies = currenciesFor(approved, markets)
  const rows: FeedRow[] = []
  const problems: FeedProblem[] = []
  const seen = new Set<string>()

  for (let n = 1; n < lines.length; n++) {
    const cells = splitCsvLine(lines[n], delimiter)
    const at = (col: string) => {
      const i = head.indexOf(col)
      return i < 0 ? undefined : cells[i]
    }
    const line = n + 1
    const name = (at('name') ?? '').trim()
    const refuse = (reason: string) => problems.push({ line, name, reason })

    if (!name) { refuse('No name.'); continue }
    if (seen.has(name.toLowerCase())) { refuse(`"${name}" appears twice in this file.`); continue }

    const kind = ((at('kind') ?? 'single').trim().toLowerCase() || 'single') as ListingKind
    if (!LISTING_KINDS.some(k => k.id === kind)) {
      refuse(`"${at('kind')}" is not a kind of listing. Use ${LISTING_KINDS.map(k => k.id).join(', ')}.`)
      continue
    }
    /* A bundle is made of other listings, and a spreadsheet cell is not where
       somebody picks them. Saying so is better than importing an empty one. */
    if (kind === 'bundle') {
      refuse('A bundle is built from your other listings, which a feed cannot express. Use New listing for these.')
      continue
    }

    const categoryId = (at('category') ?? '').trim()
    if (!categories.some(c => c.id === categoryId)) {
      refuse(`"${categoryId}" is not a marketplace. Use ${categories.map(c => c.id).join(', ')}.`)
      continue
    }

    const chosen = list(at('markets'))
    const marketCheck = validateMarkets(chosen.length ? chosen : approved, markets)
    if (!marketCheck.ok) { refuse(marketCheck.reason); continue }
    const sellIn = chosen.length ? chosen : approved

    const period = (at('billing_period') ?? '').trim() || null
    if (kind === 'subscription') {
      if (!period) { refuse('A subscription has to say how often it bills.'); continue }
      if (!BILLING_PERIODS.some(p => p.id === period)) {
        refuse(`"${period}" is not a billing period. Use ${BILLING_PERIODS.map(p => p.id).join(', ')}.`)
        continue
      }
    } else if (period) {
      refuse(`A ${kind} listing is bought once, so it cannot bill ${period}.`)
      continue
    }

    /* Only the currencies this row's own markets take. A seller selling in
       India alone should not be asked for a dirham price by the template. */
    const wanted = currenciesFor(sellIn, markets)
    const prices: PriceRow[] = wanted.map(c => ({
      currency: c,
      price: (at(`price_${c}`) ?? at(`price_${c.toLowerCase()}`) ?? '').trim(),
      floor: (at(`floor_${c}`) ?? at(`floor_${c.toLowerCase()}`) ?? '').trim(),
      list: (at(`list_${c}`) ?? at(`list_${c.toLowerCase()}`) ?? '').trim(),
    }))
    const priceCheck = validatePrices(prices)
    if (!priceCheck.ok) { refuse(priceCheck.reason); continue }

    seen.add(name.toLowerCase())
    rows.push({
      line,
      kind,
      name,
      description: (at('description') ?? '').trim(),
      categoryId,
      subCategory: (at('sub_category') ?? '').trim() || 'General',
      fulfil: (at('fulfil') ?? '').trim() || 'shipped',
      markets: sellIn,
      billingPeriod: period,
      cost: num(at('cost')),
      tags: list(at('tags')),
      prices,
    })
  }

  if (!rows.length && !problems.length) {
    problems.push({ line: 1, name: '', reason: 'The file has a header row and nothing under it.' })
  }
  /* `currencies` is computed above for the template's benefit; referencing it
     keeps the two definitions of "what this seller prices in" together. */
  void currencies

  return { rows, problems }
}

/** The first currency of the row's first market — what `products.price` holds. */
export function homePrice(row: FeedRow, markets: readonly MarketOption[]): { currency: string; price: number; floor: number; list: number } {
  const home = markets.find(m => m.code === row.markets[0])
  const currency = home?.currencies[0] ?? row.prices[0]?.currency ?? 'USD'
  const found = row.prices.find(p => p.currency === currency) ?? row.prices[0]
  const price = num(found?.price)
  return {
    currency,
    price,
    floor: num(found?.floor) || price,
    list: num(found?.list) || price,
  }
}

/** What the import is about to do, said before it does it. */
export function feedSummary(feed: Feed): string {
  if (!feed.rows.length) return 'Nothing would be submitted.'
  const kinds = feed.rows.reduce<Record<string, number>>((a, r) => {
    a[r.kind] = (a[r.kind] ?? 0) + 1
    return a
  }, {})
  const parts = Object.entries(kinds).map(([k, n]) => `${n} ${k}${n === 1 ? '' : 's'}`)
  const markets = [...new Set(feed.rows.flatMap(r => r.markets))].sort()
  return `${parts.join(' and ')} would go to the catalogue desk for review, sold in ${markets.join(', ')}.`
}

/** The shape `submitForReview` takes, built from one row. */
export function toSubmission(
  row: FeedRow, partnerId: string, markets: readonly MarketOption[],
): {
  partnerId: string; categoryId: string; subCategory: string; name: string; description: string
  price: number; cost: number; model: string; fulfil: string; tags: string[]
  floorPrice: number; listPrice: number; priceIncludesTax: boolean; taxRate: number
  billingPeriod: string | null; markets: string[]
  prices: { currency: string; price: number; floor: number; list: number }[]
  components: { product_id: string; quantity: number }[]
} {
  const home = homePrice(row, markets)
  const market = markets.find(m => m.code === row.markets[0])
  return {
    partnerId,
    categoryId: row.categoryId,
    subCategory: row.subCategory,
    name: row.name,
    description: row.description,
    price: home.price,
    cost: row.cost,
    model: modelFor(row.kind),
    fulfil: row.fulfil,
    tags: row.tags,
    floorPrice: home.floor,
    listPrice: home.list,
    /* The feed asks for a price and the market says what tax applies to it — the
       same split the wizard makes. A seller typing their own rate into a
       spreadsheet is how one listing ends up at 18% in Nairobi. */
    priceIncludesTax: true,
    taxRate: market?.taxRate ?? 0,
    billingPeriod: row.billingPeriod,
    markets: [...row.markets],
    prices: row.prices.map(p => ({
      currency: p.currency,
      price: num(p.price),
      floor: num(p.floor) || num(p.price),
      list: num(p.list) || num(p.price),
    })),
    components: [],
  }
}
