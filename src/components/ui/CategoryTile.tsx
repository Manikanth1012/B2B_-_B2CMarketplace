import { useState } from 'react'
import { ArrowRight, type LucideIcon } from 'lucide-react'
import type { Visual } from '../../lib/home'

export function CategoryTile({ name, count, visual, icon: Icon, onClick }: {
  name: string
  /** Omitted when the catalogue did not load: no count beats a wrong one. */
  count?: number
  visual: Visual | null
  icon: LucideIcon
  onClick: () => void
}) {
  const [broken, setBroken] = useState(false)
  const showImage = visual && !broken
  return (
    <button className="cat-tile" onClick={onClick}>
      <div className="cat-tile__media">
        {showImage
          ? <img src={visual.src} alt="" loading="lazy" onError={() => setBroken(true)}
              style={visual.position ? { objectPosition: visual.position } : undefined} />
          : <Icon size={40} aria-hidden />}
      </div>
      <div className="cat-tile__body">
        <div>
          <div className="cat-tile__name">{name}</div>
          {count !== undefined && (
            <div className="cat-tile__count">{count} {count === 1 ? 'product' : 'products'}</div>
          )}
        </div>
        <span className="cat-tile__arrow" aria-hidden><ArrowRight size={16} /></span>
      </div>
    </button>
  )
}
