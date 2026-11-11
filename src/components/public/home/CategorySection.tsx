import { useId, type CSSProperties } from 'react'
import type { Category, Product } from '../../../types'
import type { PublicPage } from '../../../types/view'
import { categoryDestination } from '../../../lib/storefront'
import { categoryVisual, tileCount } from '../../../lib/home'
import { SectionHeader, CategoryTile, categoryIcon } from '../../ui'

export function CategorySection({ categories, catalogue, onNavigate }: {
  categories: readonly Category[]
  catalogue: readonly Product[]
  onNavigate: (p: PublicPage) => void
}) {
  const headingId = useId()
  if (categories.length === 0) return null
  const sorted = [...categories].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <section className="container home-band" aria-labelledby={headingId}>
      <SectionHeader id={headingId} title="Explore by category" subtitle="Find the right solutions for your needs" />
      <div className="cat-row" style={{ '--cat-cols': Math.min(sorted.length, 6) } as CSSProperties}>
        {sorted.map(c => (
          <CategoryTile
            key={c.id}
            name={c.name}
            description={c.blurb}
            count={catalogue.length ? tileCount(c, catalogue) : undefined}
            visual={categoryVisual(c.id)}
            icon={categoryIcon(c.id)}
            onClick={() => onNavigate(categoryDestination(c))}
          />
        ))}
      </div>
    </section>
  )
}
