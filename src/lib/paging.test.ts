import { describe, it, expect } from 'vitest'
import { paginate, pageLabel, pageNumbers, pageAfterResize, PAGE_SIZES, DEFAULT_PAGE_SIZE } from './paging'

const rows = (n: number) => Array.from({ length: n }, (_, i) => i + 1)

describe('one page of a list', () => {
  it('takes the first page', () => {
    const p = paginate(rows(19), 1, 5)
    expect(p.rows).toEqual([1, 2, 3, 4, 5])
    expect(p.page).toBe(1)
    expect(p.pages).toBe(4)
    expect([p.from, p.to]).toEqual([1, 5])
    expect(p.hasPrev).toBe(false)
    expect(p.hasNext).toBe(true)
  })

  it('takes a page in the middle', () => {
    const p = paginate(rows(19), 3, 5)
    expect(p.rows).toEqual([11, 12, 13, 14, 15])
    expect([p.from, p.to]).toEqual([11, 15])
    expect(p.hasPrev).toBe(true)
    expect(p.hasNext).toBe(true)
  })

  /* The last page is short, and its bounds have to say so. "Showing 16–20 of
     19" is the classic version of this bug. */
  it('does not run past the end on a short last page', () => {
    const p = paginate(rows(19), 4, 5)
    expect(p.rows).toEqual([16, 17, 18, 19])
    expect([p.from, p.to]).toEqual([16, 19])
    expect(p.hasNext).toBe(false)
  })

  /* Somebody on page 4 types into the search box and six rows survive. */
  it('clamps a page number the list has outgrown rather than showing nothing', () => {
    const p = paginate(rows(6), 9, 5)
    expect(p.page).toBe(2)
    expect(p.rows).toEqual([6])
  })

  it('clamps a page number below one', () => {
    expect(paginate(rows(6), 0, 5).page).toBe(1)
    expect(paginate(rows(6), -3, 5).page).toBe(1)
  })

  it('survives an empty list without claiming a row', () => {
    const p = paginate([], 1, 10)
    expect(p.rows).toEqual([])
    expect(p.pages).toBe(1)
    expect([p.from, p.to]).toEqual([0, 0])
    expect(p.hasPrev).toBe(false)
    expect(p.hasNext).toBe(false)
  })

  it('survives a nonsense page size', () => {
    expect(paginate(rows(6), 1, 0).size).toBe(1)
    expect(paginate(rows(6), 1, -5).size).toBe(1)
    expect(paginate(rows(6), 1, 2.7).size).toBe(2)
  })

  it('fits a whole short list on one page', () => {
    const p = paginate(rows(3), 1, 10)
    expect(p.pages).toBe(1)
    expect(p.rows).toHaveLength(3)
    expect(p.hasNext).toBe(false)
  })

  it('offers the sizes the screens use, with a sensible default among them', () => {
    expect(PAGE_SIZES).toContain(5)
    expect(PAGE_SIZES).toContain(10)
    expect(PAGE_SIZES).toContain(DEFAULT_PAGE_SIZE)
  })

  /* Every row appears exactly once across the pages. Anything else is a row a
     reader can never reach, which is worse than a long list. */
  it('covers the whole list across its pages, without repeats', () => {
    for (const size of [1, 3, 5, 10, 25]) {
      const seen: number[] = []
      const pages = paginate(rows(47), 1, size).pages
      for (let n = 1; n <= pages; n++) seen.push(...paginate(rows(47), n, size).rows)
      expect(seen, `size ${size}`).toEqual(rows(47))
    }
  })
})

describe('the label under the table', () => {
  it('counts the range when there is more than one page', () => {
    expect(pageLabel(paginate(rows(47), 2, 10), 'orders')).toBe('Showing 11–20 of 47 orders')
  })

  it('just counts when everything fits', () => {
    expect(pageLabel(paginate(rows(3), 1, 10), 'orders')).toBe('3 orders')
  })

  it('says the noun in the singular for one', () => {
    expect(pageLabel(paginate(rows(1), 1, 10), 'orders')).toBe('1 order')
  })

  it('says nothing rather than zero of zero', () => {
    expect(pageLabel(paginate([], 1, 10), 'orders')).toBe('No orders')
  })
})

describe('which page numbers to offer', () => {
  it('offers them all when there are few', () => {
    expect(pageNumbers(1, 1)).toEqual([1])
    expect(pageNumbers(2, 4)).toEqual([1, 2, 3, 4])
  })

  /* Forty buttons is the same problem as forty rows. */
  it('collapses the middle, keeping the ends and the neighbours', () => {
    expect(pageNumbers(10, 40)).toEqual([1, null, 9, 10, 11, null, 40])
  })

  it('does not open a gap of one', () => {
    expect(pageNumbers(3, 6)).toEqual([1, 2, 3, 4, null, 6])
  })

  it('keeps the first and last reachable from anywhere', () => {
    for (const p of [1, 7, 20, 40]) {
      const ns = pageNumbers(p, 40)
      expect(ns).toContain(1)
      expect(ns).toContain(40)
      expect(ns).toContain(p)
    }
  })
})

describe('changing the page size', () => {
  /* Widening the page is how somebody asks to see more of where they already
     are. Sending them back to row one answers a question they did not ask. */
  it('keeps the row you were looking at on screen', () => {
    expect(pageAfterResize(11, 25)).toBe(1)
    expect(pageAfterResize(26, 25)).toBe(2)
    expect(pageAfterResize(11, 5)).toBe(3)
  })

  it('lands on the first page from an empty list', () => {
    expect(pageAfterResize(0, 10)).toBe(1)
  })

  it('keeps the first row of a page as the first row of a page', () => {
    const p = paginate(rows(100), 3, 10)     // rows 21–30
    const after = paginate(rows(100), pageAfterResize(p.from, 5), 5)
    expect(after.rows[0]).toBe(21)
  })
})
