/* Side by side, ending in a decision rather than a spreadsheet.
 *
 * The rules a comparison has to obey, none of which are obvious and all of
 * which the naive version gets wrong:
 *
 *   - Three at once. Not because three is magic, but because a fourth column
 *     makes the table scroll sideways on a laptop, and a comparison you have
 *     to scroll is one you cannot compare.
 *   - Missing data is declared, never rendered as zero. A product with no
 *     rating is not a product rated nought, and "—" beside "4.6" reads
 *     correctly where "0.0" reads as bad.
 *   - "Best" is only marked where best is arithmetic on one number, and the
 *     table says so. Cheapest is a fact. Best is a judgement, and a
 *     marketplace that quietly makes it for you is steering you.
 *   - Nothing is compared across currencies. Two products priced in different
 *     money have no cheaper one, and a table that picks a winner anyway is
 *     comparing the numerals rather than the prices.
 *
 * No Supabase client here — this is the arithmetic and the prose, tested on
 * the cases that matter.
 */

export const COMPARE_CAP = 3

export interface Comparable {
  id: string
  name: string
  seller: string
  price: number
  currency?: string | null
  was_price?: number | null
  rating?: number | null
  reviews?: number | null
  stock: string
  fulfil?: string | null
  model?: string | null
  billing_period?: string | null
  unit?: string | null
  category_id?: string
  specs?: Record<string, string> | null
  price_includes_tax?: boolean | null
}

/* ---- The tray ------------------------------------------------------------- */

export type ToggleResult =
  | { ok: true; ids: string[]; note?: string }
  | { ok: false; ids: string[]; reason: string }

export function toggleCompare(ids: readonly string[], id: string, cap = COMPARE_CAP): ToggleResult {
  if (ids.includes(id)) {
    return { ok: true, ids: ids.filter(x => x !== id) }
  }
  if (ids.length >= cap) {
    /* Naming what to drop is the difference between a refusal and a dead end. */
    return {
      ok: false, ids: [...ids],
      reason: `You can compare ${cap} at a time. Remove one to add another.`,
    }
  }
  const next = [...ids, id]
  return {
    ok: true, ids: next,
    note: next.length === cap ? `That is ${cap} — the most you can compare at once.` : undefined,
  }
}

/* Said before the cap is hit rather than only when it is. */
export function capHint(count: number, cap = COMPARE_CAP): string {
  if (count === 0) return `Pick up to ${cap} to compare them side by side.`
  if (count === 1) return `One picked. Add another to compare — up to ${cap}.`
  if (count >= cap) return `${count} picked, which is the most you can compare at once.`
  return `${count} picked. Room for ${cap - count} more.`
}

export const canCompare = (ids: readonly string[]): boolean => ids.length >= 2

/* ---- The table ------------------------------------------------------------ */

export interface Cell {
  /* What the shopper reads. `null` means the marketplace does not hold this
     for that product and the table must say so rather than print a zero. */
  text: string | null
  /* What "best" is judged on, where best is arithmetic. Absent otherwise. */
  value?: number
}

export interface Row {
  label: string
  cells: Cell[]
  /* 'low' — smaller wins, 'high' — larger wins, undefined — not a contest.
     A row with no direction is never highlighted, which is most of them. */
  better?: 'low' | 'high'
  /* Which columns win. Empty when the row cannot be judged: missing data, a
     tie across every column, or prices in different currencies. */
  best: number[]
  note?: string
}

const STOCK_TEXT: Record<string, string> = {
  in: 'In stock', low: 'Low stock', out: 'Out of stock', preorder: 'Pre-order',
}

const MODEL_TEXT: Record<string, string> = {
  monthly: 'Monthly subscription', annual: 'Annual subscription',
  oneoff: 'One-off purchase', usage: 'Pay per use',
}

/* Whether these can be compared on price at all. Two prices in different
   currencies are two numbers, not a cheaper and a dearer. */
export function oneCurrency(items: readonly Comparable[]): string | null {
  const set = new Set(items.map(i => i.currency ?? 'USD'))
  return set.size === 1 ? [...set][0] : null
}

/* And whether they are bought the same way. ₹1,099 a month is a smaller
   number than ₹64,999 once, and it is not cheaper — it is a subscription
   beside a handset. Marking the subscription "best value" is the comparison
   telling a shopper something false with a tick beside it. */
export function onePaymentModel(items: readonly Comparable[]): string | null {
  const set = new Set(items.map(i => i.model ?? 'oneoff'))
  return set.size === 1 ? [...set][0] : null
}

export function priceComparable(items: readonly Comparable[]): { ok: true } | { ok: false; why: string } {
  if (!oneCurrency(items)) {
    return { ok: false, why: 'These are priced in different currencies, so there is no cheaper one to point at.' }
  }
  if (!onePaymentModel(items)) {
    return {
      ok: false,
      why: 'One of these is a recurring charge and another is paid once, so the smaller number is not the cheaper thing.',
    }
  }
  return { ok: true }
}

function judge(row: Omit<Row, 'best'>): Row {
  if (!row.better) return { ...row, best: [] }
  const values = row.cells.map(c => c.value)
  /* Every column has to have a number, or the winner is only the winner among
     the ones that happened to be filled in. */
  if (values.some(v => v === undefined)) {
    return { ...row, best: [], note: 'Not compared — the marketplace does not hold this for every one of these.' }
  }
  const nums = values as number[]
  const target = row.better === 'low' ? Math.min(...nums) : Math.max(...nums)
  const winners = nums.map((n, i) => (n === target ? i : -1)).filter(i => i >= 0)
  /* Everything winning is nothing winning. */
  return { ...row, best: winners.length === nums.length ? [] : winners }
}

export function compareRows(
  items: readonly Comparable[],
  money: (n: number, currency: string) => string,
): Row[] {
  const priceable = priceComparable(items)
  const rows: Row[] = []

  rows.push(judge({
    label: 'Price',
    better: priceable.ok ? 'low' : undefined,
    cells: items.map(i => ({
      text: money(i.price, i.currency ?? 'USD')
        + (i.model === 'monthly' ? ' a month' : i.model === 'annual' ? ' a year' : ''),
      value: i.price,
    })),
    note: priceable.ok ? undefined : priceable.why,
  }))

  /* Only where somebody is actually discounted — a row of dashes teaches
     nothing and costs a line. */
  if (items.some(i => i.was_price && i.was_price > i.price)) {
    rows.push(judge({
      label: 'Was',
      cells: items.map(i => ({
        text: i.was_price && i.was_price > i.price
          ? money(i.was_price, i.currency ?? 'USD')
          : null,
      })),
    }))
  }

  /* Only where the marketplace actually knows. A row of "Not stated" across
     every column is a line of noise, and the shopper learns the same nothing
     from its absence. */
  if (items.some(i => i.price_includes_tax != null)) {
    rows.push({
      label: 'Tax',
      best: [],
      cells: items.map(i => ({
        text: i.price_includes_tax === true ? 'Included in the price'
          : i.price_includes_tax === false ? 'Added at checkout' : null,
      })),
    })
  }

  rows.push(judge({
    label: 'Rating',
    better: 'high',
    cells: items.map(i => ({
      /* A product nobody has rated is not a product rated zero. */
      text: i.rating != null && (i.reviews ?? 0) > 0
        ? `${i.rating.toFixed(1)} from ${(i.reviews ?? 0).toLocaleString('en-US')} review${i.reviews === 1 ? '' : 's'}`
        : null,
      value: i.rating != null && (i.reviews ?? 0) > 0 ? i.rating : undefined,
    })),
  }))

  rows.push({
    label: 'Availability',
    best: [],
    cells: items.map(i => ({ text: STOCK_TEXT[i.stock] ?? i.stock ?? null })),
  })

  rows.push({
    label: 'Fulfilment',
    best: [],
    cells: items.map(i => ({ text: i.fulfil ? sentence(i.fulfil) : null })),
  })

  rows.push({
    label: 'How you pay',
    best: [],
    cells: items.map(i => ({ text: i.model ? MODEL_TEXT[i.model] ?? sentence(i.model) : null })),
  })

  rows.push({
    label: 'Sold by',
    best: [],
    cells: items.map(i => ({ text: i.seller || null })),
  })

  /* Every specification any of them declares, so a feature one has and another
     does not shows up as a gap rather than being dropped from the table. */
  const specNames = [...new Set(items.flatMap(i => Object.keys(i.specs ?? {})))].sort()
  for (const name of specNames) {
    rows.push({
      label: name,
      best: [],
      cells: items.map(i => ({ text: i.specs?.[name] ?? null })),
    })
  }

  /* Drop anything nobody could fill in. A specification row where every column
     reads "Not stated" is the union of specs doing its job badly. */
  return rows.filter(r => r.cells.some(c => c.text !== null))
}

/* Rows where every column says the same thing tell a shopper nothing about
   which to buy. Hiding them is optional, so the toggle needs both halves. */
export function differingOnly(rows: readonly Row[]): Row[] {
  return rows.filter(r => new Set(r.cells.map(c => c.text ?? '—')).size > 1)
}

export const sameCount = (rows: readonly Row[]): number => rows.length - differingOnly(rows).length

/* The sentence under the table. It has to say that a highlight is arithmetic
   rather than advice, or the highlight reads as the marketplace choosing. */
export function highlightNote(rows: readonly Row[]): string {
  const judged = rows.filter(r => r.better && r.best.length > 0)
  if (judged.length === 0) {
    return 'Nothing is highlighted: on the rows that can be measured, these are level or the marketplace does not hold the figure for all of them.'
  }
  return `Highlighted on ${judged.map(r => r.label.toLowerCase()).join(' and ')} — that is arithmetic on one number, not a recommendation.`
}

function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).replace(/[-_]/g, ' ')
}
