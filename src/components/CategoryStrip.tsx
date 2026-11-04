import { useState, useEffect, useId, type CSSProperties } from 'react'
import { supabase } from '../lib/supabase'
import type { Category, Product } from '../types'
import { categoryVisual } from '../lib/home'
import { SectionHeader, CategoryTile, categoryIcon } from './ui'
import { categoriesFor } from '../lib/storefront'

import type { View } from '../types/view'

interface CategoryStripProps {
  onNavigate: (view: View, opts?: { category?: string }) => void
}

export function CategoryStrip({ onNavigate }: CategoryStripProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const headingId = useId()

  /* Only the shelves a retail customer can actually buy from. Partner sells
     white-label storefronts and wholesale packs of 500 lines to resellers; it
     was on this grid with a Browse button, which is an invitation to a page
     nothing on it can be bought from. */
  useEffect(() => {
    supabase.from('categories').select('*').order('sort_order').then(({ data }) => {
      if (data) setCategories(categoriesFor(data as Category[], 'consumer'))
    })
    /* Live rows only. The count under a tile is a promise about what is behind
       it, and drafts and delisted rows are not behind it. */
    supabase.from('products').select('category_id').eq('status', 'live').then(({ data }) => {
      if (data) {
        const c: Record<string, number> = {}
        ;(data as Pick<Product, 'category_id'>[]).forEach((p) => {
          c[p.category_id] = (c[p.category_id] || 0) + 1
        })
        setCounts(c)
      }
    })
  }, [])

  return (
    <section className="container home-band" aria-labelledby={headingId}>
      <SectionHeader
        id={headingId}
        title="Shop by category"
        subtitle={`${categories.length} marketplaces, one checkout. Find exactly what you need.`}
      />
      <div className="cat-row" style={{ '--cat-cols': Math.min(categories.length, 6) } as CSSProperties}>
        {categories.map((cat) => (
          <CategoryTile
            key={cat.id}
            name={cat.name}
            count={counts[cat.id] || 0}
            visual={categoryVisual(cat.id)}
            icon={categoryIcon(cat.id)}
            onClick={() => onNavigate('category', { category: cat.id })}
          />
        ))}
      </div>
    </section>
  )
}
