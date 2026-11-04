import { useEffect, useId, useRef, useState } from 'react'
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
  const trigger = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open || categories) return
    loadCategories().then(setCategories)
    loadCatalogue().then(setCatalogue)
  }, [open, categories])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); trigger.current?.focus() } }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])

  const go = (c: Category) => { setOpen(false); onDone?.(); onNavigate(categoryDestination(c)) }

  /* Categories read and came back empty: there is nothing to discover, and a
     button that opens nothing is worse than none. Before the first read
     (null) it stays, so it can be opened. */
  if (categories && categories.length === 0) return null

  return (
    <div className="discover" ref={root}>
      <button ref={trigger} className="site-nav__item" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen(o => !o)}>
        Discover <ChevronDown size={14} aria-hidden />
      </button>
      {open && categories && categories.length > 0 && (
        <ul id={panelId} className="discover__panel" aria-label="Categories">
          {categories.map(c => {
            const Icon = categoryIcon(c.id)
            const n = catalogue.length ? tileCount(c, catalogue) : null
            return (
              <li key={c.id}>
              <button className="discover__item" onClick={() => go(c)}>
                <span className="discover__icon"><Icon size={18} aria-hidden /></span>
                <span>
                  <span className="discover__name">{c.name}</span>
                  <span className="discover__meta">
                    {n !== null ? `${n} ${n === 1 ? 'product' : 'products'} · ` : ''}{c.audience}
                  </span>
                </span>
              </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
