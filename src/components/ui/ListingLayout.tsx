import { useEffect, useId, useRef, useState } from 'react'
import { Search, SlidersHorizontal, X, ChevronRight } from 'lucide-react'

export interface FilterOption { value: string; label: string; count?: number }
export interface FilterGroupDef {
  id: string
  title: string
  options: FilterOption[]
  selected: string | null
  onSelect: (v: string | null) => void
}

function FilterGroups({ filters }: { filters: FilterGroupDef[] }) {
  return (
    <>
      {filters.filter(g => g.options.length > 0).map(g => (
        <fieldset key={g.id} className="filter-group">
          <legend className="filter-group__title">{g.title}</legend>
          <label className="filter-option">
            <input type="radio" name={g.id} checked={g.selected === null} onChange={() => g.onSelect(null)} />
            <span>All</span>
          </label>
          {g.options.map(o => (
            <label key={o.value} className="filter-option">
              <input type="radio" name={g.id} checked={g.selected === o.value} onChange={() => g.onSelect(o.value)} />
              <span>{o.label}</span>
              {o.count !== undefined && <span className="filter-option__count">{o.count}</span>}
            </label>
          ))}
        </fieldset>
      ))}
    </>
  )
}

/* The same skeleton for every shop listing: who it is for decides the cards,
   not the furniture around them. Filters sit in a side panel on a wide screen
   and behind a button on a narrow one, where a side panel would leave the grid
   one card wide. */
export function ListingLayout({
  title, subtitle, breadcrumb, count, total, search, sort, filters, onClear, above, children,
}: {
  title: string
  subtitle?: string
  breadcrumb?: { label: string; onClick?: () => void }[]
  count: number
  total?: number
  search: { value: string; onChange: (v: string) => void; placeholder: string }
  sort: { value: string; options: readonly { value: string; label: string }[]; onChange: (v: string) => void }
  filters: FilterGroupDef[]
  onClear?: () => void
  above?: React.ReactNode
  children: React.ReactNode
}) {
  const [sheet, setSheet] = useState(false)
  const opener = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const headingId = useId()
  const active = search.value !== '' || filters.some(g => g.selected !== null)

  useEffect(() => {
    if (!sheet) return
    panel.current?.querySelector<HTMLElement>('input, button')?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSheet(false); opener.current?.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [sheet])

  return (
    <section className="container listing" aria-labelledby={headingId}>
      {breadcrumb && breadcrumb.length > 0 && (
        <nav className="listing__crumbs" aria-label="Breadcrumb">
          {breadcrumb.map((b, i) => (
            <span key={b.label}>
              {i > 0 && <ChevronRight size={12} aria-hidden />}
              {b.onClick ? <button className="ui-link" onClick={b.onClick}>{b.label}</button> : <span aria-current="page">{b.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <div className="listing__head">
        <div>
          <h1 className="listing__title" id={headingId}>{title}</h1>
          {subtitle && <p className="listing__sub">{subtitle}</p>}
        </div>
      </div>

      {above}

      <div className="listing__body">
        <aside className="listing__panel" aria-label="Filters">
          <div className="listing__panel-head">
            <span>Filters</span>
            {onClear && active && <button className="ui-link" onClick={onClear}>Clear all</button>}
          </div>
          <FilterGroups filters={filters} />
        </aside>

        <div className="listing__main">
          <div className="listing__toolbar">
            <label className="listing__search">
              <Search size={16} aria-hidden />
              <input type="search" value={search.value} placeholder={search.placeholder}
                aria-label={search.placeholder} onChange={e => search.onChange(e.target.value)} />
            </label>
            <button ref={opener} className="btn btn-sm btn-secondary listing__filters-btn"
              aria-expanded={sheet} onClick={() => setSheet(true)}>
              <SlidersHorizontal size={14} aria-hidden /> Filters
            </button>
            <label className="listing__sort">
              <span>Sort</span>
              <select value={sort.value} onChange={e => sort.onChange(e.target.value)}>
                {sort.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <span className="listing__count" aria-live="polite">
              {total !== undefined && total !== count ? `${count} of ${total}` : count} {count === 1 ? 'result' : 'results'}
            </span>
          </div>
          {children}
        </div>
      </div>

      {sheet && (
        <div className="sheet-backdrop" onClick={() => { setSheet(false); opener.current?.focus() }}>
          <div ref={panel} className="sheet" role="dialog" aria-modal="true" aria-label="Filters" onClick={e => e.stopPropagation()}>
            <div className="listing__panel-head">
              <span>Filters</span>
              <button className="btn btn-sm btn-ghost" aria-label="Close filters"
                onClick={() => { setSheet(false); opener.current?.focus() }}><X size={16} /></button>
            </div>
            <FilterGroups filters={filters} />
            <div className="sheet__foot">
              {onClear && active && <button className="btn btn-secondary" onClick={onClear}>Clear all</button>}
              <button className="btn btn-cyan" onClick={() => { setSheet(false); opener.current?.focus() }}>
                Show {count} {count === 1 ? 'result' : 'results'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}

export function ListingGrid({ children }: { children: React.ReactNode }) {
  return <div className="listing__grid">{children}</div>
}

export function EmptyListing({ title, text, onClear }: { title: string; text: string; onClear?: () => void }) {
  return (
    <div className="listing__empty">
      <h2>{title}</h2>
      <p>{text}</p>
      {onClear && <button className="btn btn-secondary" onClick={onClear}>Clear all</button>}
    </div>
  )
}
