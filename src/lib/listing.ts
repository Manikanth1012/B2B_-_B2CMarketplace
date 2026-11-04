/* How a shop listing narrows and orders its products. Lifted out of the
   signed-in grid so the public pages search and sort by the same rule. */

export type SortKey = 'featured' | 'price-low' | 'price-high' | 'rating' | 'reviews'

/* Labels copied from the signed-in grid's sort <select>, so both listings say the same thing. */
export const SORT_OPTIONS: readonly { value: SortKey; label: string }[] = [
  { value: 'featured', label: 'Featured' },
  { value: 'price-low', label: 'Price: Low to High' },
  { value: 'price-high', label: 'Price: High to Low' },
  { value: 'rating', label: 'Top rated' },
  { value: 'reviews', label: 'Most reviewed' },
]

export interface ListingFilters {
  search: string
  sub: string | null
  stock: string | null
  sort: SortKey
}

export interface FilterableProduct {
  name: string
  description: string
  tags?: string[] | null
  sub_category: string | null
  stock: string
  price: number
  rating: number | null
  reviews: number
}

export function filterProducts<T extends FilterableProduct>(products: readonly T[], f: ListingFilters): T[] {
  let result = [...products]
  if (f.search) {
    const q = f.search.toLowerCase()
    result = result.filter(p =>
      p.name.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      (p.tags ?? []).some(t => t.toLowerCase().includes(q)))
  }
  if (f.sub) result = result.filter(p => p.sub_category === f.sub)
  if (f.stock) result = result.filter(p => p.stock === f.stock)
  switch (f.sort) {
    case 'price-low': result.sort((a, b) => a.price - b.price); break
    case 'price-high': result.sort((a, b) => b.price - a.price); break
    case 'rating': result.sort((a, b) => (b.rating || 0) - (a.rating || 0)); break
    case 'reviews': result.sort((a, b) => b.reviews - a.reviews); break
  }
  return result
}

/** Where the public header's search goes. Blank is no search at all. */
export function searchTarget(text: string): { page: 'retail'; q: string } | null {
  const q = text.trim()
  return q ? { page: 'retail', q } : null
}
