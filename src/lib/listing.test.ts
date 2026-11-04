import { describe, it, expect } from 'vitest'
import { filterProducts, searchTarget, SORT_OPTIONS, type ListingFilters } from './listing'

const p = (o: Partial<Parameters<typeof filterProducts>[0][number]> & { name: string }) => ({
  description: '', tags: [], sub_category: null, stock: 'In stock', price: 10, rating: null, reviews: 0, ...o,
})
const none: ListingFilters = { search: '', sub: null, stock: null, sort: 'featured' }

describe('filterProducts', () => {
  const rows = [
    p({ name: 'Kestrel phone', price: 300, rating: 4.1, reviews: 9, sub_category: 'Phones' }),
    p({ name: 'Router', description: 'Mesh wifi', price: 90, rating: 4.8, reviews: 2, sub_category: 'Routers', stock: 'Low stock' }),
    p({ name: 'Case', tags: ['Kestrel'], price: 15, rating: null, reviews: 40, sub_category: 'Accessories' }),
  ]
  it('leaves the catalogue order alone when nothing is set', () => {
    expect(filterProducts(rows, none).map(r => r.name)).toEqual(['Kestrel phone', 'Router', 'Case'])
  })
  it('searches name, description and tags, ignoring case', () => {
    expect(filterProducts(rows, { ...none, search: 'kestrel' }).map(r => r.name)).toEqual(['Kestrel phone', 'Case'])
    expect(filterProducts(rows, { ...none, search: 'MESH' }).map(r => r.name)).toEqual(['Router'])
  })
  it('filters by sub-category and by stock', () => {
    expect(filterProducts(rows, { ...none, sub: 'Routers' }).map(r => r.name)).toEqual(['Router'])
    expect(filterProducts(rows, { ...none, stock: 'Low stock' }).map(r => r.name)).toEqual(['Router'])
  })
  it('sorts the four ways the grid offers', () => {
    expect(filterProducts(rows, { ...none, sort: 'price-low' }).map(r => r.price)).toEqual([15, 90, 300])
    expect(filterProducts(rows, { ...none, sort: 'price-high' }).map(r => r.price)).toEqual([300, 90, 15])
    expect(filterProducts(rows, { ...none, sort: 'rating' }).map(r => r.name)).toEqual(['Router', 'Kestrel phone', 'Case'])
    expect(filterProducts(rows, { ...none, sort: 'reviews' }).map(r => r.name)).toEqual(['Case', 'Kestrel phone', 'Router'])
  })
  it('does not reorder the array it was given', () => {
    const copy = [...rows]
    filterProducts(rows, { ...none, sort: 'price-low' })
    expect(rows).toEqual(copy)
  })
  it('offers exactly the sorts it implements', () => {
    expect(SORT_OPTIONS.map(o => o.value)).toEqual(['featured', 'price-low', 'price-high', 'rating', 'reviews'])
  })
})

describe('searchTarget', () => {
  it('sends a search to the retail page, trimmed', () => {
    expect(searchTarget('  router ')).toEqual({ page: 'retail', q: 'router' })
  })
  it('ignores an empty search', () => {
    expect(searchTarget('   ')).toBeNull()
  })
})
