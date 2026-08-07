import { describe, it, expect } from 'vitest'
import {
  COMPARE_CAP, toggleCompare, capHint, canCompare, compareRows, oneCurrency,
  differingOnly, sameCount, highlightNote,
} from './compare'
import type { Comparable } from './compare'

const money = (n: number, c: string) => `${c} ${n.toFixed(2)}`

const p = (over: Partial<Comparable> = {}): Comparable => ({
  id: 'SKU-1', name: 'A thing', seller: 'Nimbus Sensors', price: 1000, currency: 'INR',
  rating: 4.5, reviews: 100, stock: 'in', fulfil: 'shipped', model: 'oneoff',
  price_includes_tax: true, specs: { Term: '12 months' }, ...over,
})

const rowFor = (label: string, items: Comparable[]) =>
  compareRows(items, money).find(r => r.label === label)!

describe('the tray', () => {
  it('adds and removes', () => {
    const a = toggleCompare([], 'SKU-1')
    expect(a.ok && a.ids).toEqual(['SKU-1'])
    const b = toggleCompare(['SKU-1'], 'SKU-1')
    expect(b.ok && b.ids).toEqual([])
  })

  it('refuses a fourth, and says what to do about it', () => {
    const r = toggleCompare(['a', 'b', 'c'], 'd')
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain('Remove one')
      /* The refusal must not quietly drop one to make room. */
      expect(r.ids).toEqual(['a', 'b', 'c'])
    }
  })

  it('lets the third in and says it is the last', () => {
    const r = toggleCompare(['a', 'b'], 'c')
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.note).toContain('the most')
  })

  it('removing still works at the cap', () => {
    const r = toggleCompare(['a', 'b', 'c'], 'b')
    expect(r.ok && r.ids).toEqual(['a', 'c'])
  })

  it('says how much room is left before the cap is hit', () => {
    expect(capHint(0)).toContain(`up to ${COMPARE_CAP}`)
    expect(capHint(1)).toContain('Add another')
    expect(capHint(2)).toContain('1 more')
    expect(capHint(3)).toContain('the most')
  })

  it('needs two before there is anything to compare', () => {
    expect(canCompare([])).toBe(false)
    expect(canCompare(['a'])).toBe(false)
    expect(canCompare(['a', 'b'])).toBe(true)
  })
})

describe('what can be judged', () => {
  it('marks the cheapest when they share a currency', () => {
    const row = rowFor('Price', [p({ id: '1', price: 1299 }), p({ id: '2', price: 999 })])
    expect(row.best).toEqual([1])
  })

  it('refuses to pick a cheaper one across currencies', () => {
    /* 999 KES against 1299 INR is two numbers, not a saving. */
    const items = [p({ id: '1', price: 1299, currency: 'INR' }), p({ id: '2', price: 999, currency: 'KES' })]
    expect(oneCurrency(items)).toBeNull()
    const row = rowFor('Price', items)
    expect(row.best).toEqual([])
    expect(row.note).toContain('different currencies')
  })

  it('marks the highest rating', () => {
    const row = rowFor('Rating', [p({ id: '1', rating: 4.2 }), p({ id: '2', rating: 4.8 })])
    expect(row.best).toEqual([1])
  })

  it('highlights nothing when every column ties', () => {
    /* Everything winning is nothing winning. */
    const row = rowFor('Price', [p({ id: '1', price: 999 }), p({ id: '2', price: 999 })])
    expect(row.best).toEqual([])
  })

  it('does not judge a row the marketplace cannot fill in for everyone', () => {
    const row = rowFor('Rating', [p({ id: '1', rating: 4.8 }), p({ id: '2', rating: null, reviews: 0 })])
    expect(row.best).toEqual([])
    expect(row.note).toContain('does not hold this')
  })

  it('shows an unrated product as unrated, not as zero', () => {
    const row = rowFor('Rating', [p({ id: '1', rating: null, reviews: 0 })])
    expect(row.cells[0].text).toBeNull()
    expect(row.cells[0].value).toBeUndefined()
  })

  it('treats a rating with no reviews behind it as no rating', () => {
    const row = rowFor('Rating', [p({ id: '1', rating: 5, reviews: 0 })])
    expect(row.cells[0].text).toBeNull()
  })

  it('leaves the rows that are not contests alone', () => {
    for (const label of ['Availability', 'Fulfilment', 'Sold by', 'How you pay', 'Tax']) {
      expect(rowFor(label, [p({ id: '1' }), p({ id: '2', price: 1 })]).best).toEqual([])
    }
  })
})

describe('the rows themselves', () => {
  it('says whether tax is in the price, because the two are not comparable otherwise', () => {
    const row = rowFor('Tax', [p({ price_includes_tax: true }), p({ id: '2', price_includes_tax: false })])
    expect(row.cells[0].text).toContain('Included')
    expect(row.cells[1].text).toContain('checkout')
  })

  it('names a monthly price as monthly', () => {
    expect(rowFor('Price', [p({ model: 'monthly' })]).cells[0].text).toContain('a month')
  })

  it('carries every specification any of them declares', () => {
    const rows = compareRows([
      p({ id: '1', specs: { Screens: 'Four', Quality: '4K' } }),
      p({ id: '2', specs: { Screens: 'Two' } }),
    ], money)
    const quality = rows.find(r => r.label === 'Quality')!
    expect(quality.cells[0].text).toBe('4K')
    /* The one that does not have it shows a gap rather than being dropped. */
    expect(quality.cells[1].text).toBeNull()
  })

  it('leaves out the was-price row when nobody is discounted', () => {
    expect(compareRows([p(), p({ id: '2' })], money).some(r => r.label === 'Was')).toBe(false)
    expect(compareRows([p({ was_price: 1500 }), p({ id: '2' })], money)
      .some(r => r.label === 'Was')).toBe(true)
  })
})

describe('hiding what is the same', () => {
  it('keeps only the rows that differ', () => {
    const rows = compareRows([
      p({ id: '1', price: 999, seller: 'Nimbus Sensors' }),
      p({ id: '2', price: 1299, seller: 'Nimbus Sensors' }),
    ], money)
    const differ = differingOnly(rows)
    expect(differ.some(r => r.label === 'Price')).toBe(true)
    expect(differ.some(r => r.label === 'Sold by')).toBe(false)
    expect(sameCount(rows)).toBeGreaterThan(0)
  })

  it('counts two blanks as the same rather than as a difference', () => {
    const rows = compareRows([
      p({ id: '1', rating: null, reviews: 0 }), p({ id: '2', rating: null, reviews: 0 }),
    ], money)
    expect(differingOnly(rows).some(r => r.label === 'Rating')).toBe(false)
  })
})

describe('the note under the table', () => {
  it('says a highlight is arithmetic and not advice', () => {
    const rows = compareRows([p({ id: '1', price: 999 }), p({ id: '2', price: 1299 })], money)
    const note = highlightNote(rows)
    expect(note).toContain('not a recommendation')
    expect(note).toContain('price')
  })

  it('says so plainly when nothing could be judged', () => {
    const rows = compareRows([
      p({ id: '1', price: 999, currency: 'INR', rating: null, reviews: 0 }),
      p({ id: '2', price: 999, currency: 'KES', rating: null, reviews: 0 }),
    ], money)
    expect(highlightNote(rows)).toContain('Nothing is highlighted')
  })
})
