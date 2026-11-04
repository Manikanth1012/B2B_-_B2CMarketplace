import { useEffect, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { Category, Product } from '../../types'
import type { PublicPage } from '../../types/view'
import { loadCategories, loadCatalogue } from '../../lib/storefrontRepo'
import { categoryDestination } from '../../lib/storefront'
import { tileCount } from '../../lib/home'
import { categoryIcon } from '../ui/categoryIcons'

/* The header's category panel. Read on first open rather than on every page,
   because most visitors never open it. Empty categories hide the panel's
   contents rather than showing a box with nothing in it. */
export function DiscoverMenu({ onNavigate, onDone }: {
  onNavigate: (p: PublicPage) => void
  onDone?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [categories, setCategories] = useState<Category[] | null>(null)
  const [catalogue, setCatalogue] = useState<Product[]>([])
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || categories) return
    loadCategories().then(setCategories)
    loadCatalogue().then(setCatalogue)
  }, [open, categories])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const go = (c: Category) => { setOpen(false); onDone?.(); onNavigate(categoryDestination(c)) }

  return (
    <div className="discover" ref={root}>
      <button className="site-nav__item" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(o => !o)}>
        Discover <ChevronDown size={14} aria-hidden />
      </button>
      {open && categories && categories.length > 0 && (
        <div className="discover__panel" role="menu" aria-label="Categories">
          {categories.map(c => {
            const Icon = categoryIcon(c.id)
            const n = catalogue.length ? tileCount(c, catalogue) : null
            return (
              <button key={c.id} className="discover__item" role="menuitem" onClick={() => go(c)}>
                <span className="discover__icon"><Icon size={18} aria-hidden /></span>
                <span>
                  <span className="discover__name">{c.name}</span>
                  <span className="discover__meta" style={{ display: 'block' }}>
                    {n !== null ? `${n} ${n === 1 ? 'product' : 'products'} · ` : ''}{c.audience}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
