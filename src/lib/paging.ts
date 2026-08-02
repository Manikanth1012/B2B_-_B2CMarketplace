/* Paging, as arithmetic rather than as a component.
 *
 * A long table is not made usable by being scrollable. Nineteen loyalty
 * movements, forty listings, two hundred orders — a reader who has to scroll to
 * find out how much there is has already lost their place, and a screenshot of
 * row forty tells nobody where row forty is.
 *
 * The arithmetic lives here because every off-by-one in paging is the same
 * off-by-one, and a page counter that says "showing 11–20 of 19" is the sort of
 * thing nobody notices until a customer does.
 */

export const PAGE_SIZES = [5, 10, 25, 50] as const
export type PageSize = (typeof PAGE_SIZES)[number]
export const DEFAULT_PAGE_SIZE: PageSize = 10

export interface Page<T> {
  rows: T[]
  /* 1-based, and clamped: a filter that shrinks the list under your feet
     leaves you on the last page rather than on an empty one. */
  page: number
  pages: number
  size: number
  total: number
  /* 1-based inclusive bounds of what is on screen. Both are 0 when nothing is. */
  from: number
  to: number
  hasPrev: boolean
  hasNext: boolean
}

/**
 * One page of a list.
 *
 * `page` is clamped rather than validated, because the caller holding a stale
 * page number is the normal case: somebody on page 4 types into the search box
 * and there are now six rows. Refusing would be correct and useless; landing
 * them on the last page that exists is what they meant.
 */
export function paginate<T>(rows: readonly T[], page: number, size: number): Page<T> {
  const total = rows.length
  const perPage = Math.max(1, Math.floor(size) || 1)
  const pages = Math.max(1, Math.ceil(total / perPage))
  const current = Math.min(Math.max(1, Math.floor(page) || 1), pages)
  const start = (current - 1) * perPage

  return {
    rows: rows.slice(start, start + perPage),
    page: current,
    pages,
    size: perPage,
    total,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(start + perPage, total),
    hasPrev: current > 1,
    hasNext: current < pages,
  }
}

/**
 * "Showing 11–20 of 47 orders".
 *
 * The noun is passed in because "1–10 of 19" alone makes the reader work out
 * what they are looking at, and a table that already has a heading is not
 * excused from labelling its own footer.
 */
export function pageLabel(p: Pick<Page<unknown>, 'from' | 'to' | 'total'>, noun: string): string {
  if (p.total === 0) return `No ${noun}`
  if (p.total <= p.to && p.from === 1) {
    return `${p.total} ${p.total === 1 ? noun.replace(/s$/, '') : noun}`
  }
  return `Showing ${p.from}–${p.to} of ${p.total} ${noun}`
}

/**
 * The page numbers to offer, with gaps.
 *
 * First and last are always reachable, the current page keeps a neighbour
 * either side, and everything else collapses to `null` — a gap the caller
 * renders as an ellipsis. Forty pages of buttons is the same problem as forty
 * rows of scrolling.
 */
export function pageNumbers(page: number, pages: number, window = 1): (number | null)[] {
  if (pages <= 1) return [1]
  const wanted = new Set<number>([1, pages])
  for (let p = page - window; p <= page + window; p++) {
    if (p >= 1 && p <= pages) wanted.add(p)
  }
  const sorted = [...wanted].sort((a, b) => a - b)

  const out: (number | null)[] = []
  let previous = 0
  for (const n of sorted) {
    if (previous && n - previous > 1) out.push(null)
    out.push(n)
    previous = n
  }
  return out
}

/**
 * Where a page-size change should land you.
 *
 * Keeps the first row you were looking at on screen. Resetting to page 1
 * instead is easier and loses your place — the whole reason somebody widens a
 * page is to see more of where they already are.
 */
export function pageAfterResize(from: number, size: number): number {
  if (from <= 0) return 1
  return Math.max(1, Math.floor((from - 1) / Math.max(1, size)) + 1)
}
