import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../lib/supabase'
import type { Product, Category } from '../types'
import { categoriesFor, pricedFor, cardAction } from '../lib/storefront'
import { filterProducts, SORT_OPTIONS } from '../lib/listing'
import type { SortKey } from '../lib/listing'
import { loadPriceBookResult, loadCopyBookResult, repriceAll } from '../lib/moneyRepo'
import { useMarket } from '../lib/MarketContext'
import { ProductCard, ListingLayout, ListingGrid, EmptyListing, SectionHeader } from './ui'
import { CompareTray, CompareTable } from './CompareTray'
import { toggleCompare, COMPARE_CAP, stockLabel } from '../lib/compare'
import type { Comparable } from '../lib/compare'
import { toast } from './operator/shared'

import type { View } from '../types/view'

interface ProductGridProps {
  onNotifyMe?: (product: Product) => void
  /* Product ids the shopper already has an open alert on. */
  watching?: Set<string>
  categoryFilter?: string | null
  onNavigate: (view: View, opts?: { category?: string; product?: Product }) => void
  onAddToCart: (product: Product, quantity?: number) => void
}

export function ProductGrid({ categoryFilter, onNavigate, onAddToCart, onNotifyMe, watching }: ProductGridProps) {
  const { market, currency, fmtIn } = useMarket()
  /* Named separately so the effect below depends on the code and not on the
     market object, which is rebuilt on every context render and would refetch
     the catalogue continuously. */
  /* The chosen currency, not the market's default. Reading the default here
     while the formatter reads the choice is how a shilling price ends up under
     a dollar sign — the same relabelling the bills migration had to undo. */
  const currencyCode = currency?.code ?? market?.currency ?? 'USD'
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  /* A failed price read is not "nothing priced for your market"; Retry bumps reloadKey. */
  const [priceError, setPriceError] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('featured')
  const [subFilter, setSubFilter] = useState<string | null>(null)
  const [stockFilter, setStockFilter] = useState<string | null>(null)
  /* Held by id rather than by product, so a pick survives a filter change or a
     reprice — the object is rebuilt on both and the id is not. */
  const [comparing, setComparing] = useState<string[]>([])
  const [showCompare, setShowCompare] = useState(false)

  useEffect(() => {
    supabase.from('categories').select('*').order('sort_order').then(({ data }) => {
      if (data) setCategories(categoriesFor(data as Category[], 'consumer'))
    })
  }, [])

  /* Restricted to the shelves a retail customer can buy from, on both paths.
     Unfiltered, this is "Featured products" on the home page, and a wholesale
     connectivity pack for 500 lines was appearing in it. Filtered, it is a
     category page, and the id can arrive from a bookmark or a hand-typed URL
     — so a shelf that is not this shopper's returns nothing rather than
     quietly serving it. */
  useEffect(() => {
    if (!categories.length) return
    const mine = categories.map(c => c.id)
    setLoading(true)

    let query = supabase
      .from('products')
      .select('*')
      .eq('status', 'live')
      /* The shelf being this shopper's has never meant everything on it is
         sold to them. IoT carries a $52 occupancy sensor and a fifty-unit
         fleet bundle for $4,800, and only one of those is a purchase a retail
         customer makes — so the product's own audience is asked as well. */
      .contains('audiences', ['consumer'])
      .order('sort_order')

    query = categoryFilter
      ? query.eq('category_id', categoryFilter).in('category_id', mine)
      : query.in('category_id', mine)

    /* Priced as they are loaded, in the market's own currency, rather than
       converted where they are drawn. One place decides the currency; every
       card below just prints the price it was handed. */
    setPriceError(false)
    Promise.all([query, loadPriceBookResult(currencyCode), loadCopyBookResult()]).then(([{ data }, book, copy]) => {
      setPriceError(!book.ok || !copy.ok)
      if (data) setProducts(repriceAll(data as Product[], book.ok ? book.value : new Map(), currencyCode, copy.ok ? copy.value : undefined))
      setLoading(false)
    })
  }, [categoryFilter, categories, currencyCode, reloadKey])

  /* Products the market does not price are not shown, here or in the counts. */
  const priced = useMemo(() => pricedFor(products, currencyCode), [products, currencyCode])

  const subCategories = useMemo(() => {
    const subs = new Set(priced.map((p) => p.sub_category))
    return Array.from(subs).sort()
  }, [priced])

  const stocks = useMemo(() => Array.from(new Set(priced.map((p) => p.stock))), [priced])

  /* Picks are resolved against the loaded catalogue on every render, so a
     product that has gone off sale while the tray was open drops out of it
     rather than being compared from a stale copy. */
  const picks: Comparable[] = comparing
    .map(id => products.find(p => p.id === id))
    .filter((p): p is Product => !!p)
    .map(p => ({
      id: p.id, name: p.name, seller: p.seller, price: p.price,
      currency: p.currency ?? currencyCode, was_price: p.was_price,
      rating: p.rating, reviews: p.reviews, stock: p.stock, fulfil: p.fulfil,
      model: p.model, unit: p.unit,
      category_id: p.category_id, specs: p.specs as Record<string, string> | null,
      /* Not on the client Product type; the card does not need it and the
         comparison states it as unknown rather than guessing. */
    }))

  const pick = (id: string) => {
    const r = toggleCompare(comparing, id)
    setComparing(r.ids)
    if (!r.ok) toast(r.reason, 'error')
    else if (r.note) toast(r.note, 'info')
  }

  const filtered = useMemo(
    () => filterProducts(priced, { search, sub: subFilter, stock: stockFilter, sort: sortBy as SortKey }),
    [priced, search, sortBy, subFilter, stockFilter],
  )

  const clearFilters = () => { setSearch(''); setSubFilter(null); setStockFilter(null) }

  const activeCategory = categories.find((c) => c.id === categoryFilter)

  /* A category id that is not one of ours. It reached here from a bookmark, a
     shared link or a hand-typed URL, and an empty grid under "Featured
     products" would read as the shop being broken rather than the shelf being
     somebody else's. */
  if (categoryFilter && !activeCategory && categories.length > 0) {
    return (
      <section style={{ padding: '48px 0' }}>
        <div className="container" style={{ maxWidth: '600px', textAlign: 'center' }}>
          <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 700, marginBottom: '8px' }}>
            That marketplace is not part of the retail shop
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>
            Some of our marketplaces sell to businesses and resellers rather than to retail customers —
            wholesale connectivity, white-label storefronts and the partner API are bought through a
            partner or enterprise account, not from here.
          </p>
          <button
            onClick={() => onNavigate('home')}
            style={{
              padding: '10px 18px', borderRadius: 'var(--radius)', background: 'var(--brand-navy)',
              color: 'white', border: 'none', fontWeight: 600, cursor: 'pointer',
            }}
          >
            Back to the shop
          </button>
        </div>
      </section>
    )
  }

  const cards = filtered.map((product) => (
    <ProductCard
      key={product.id}
      product={product}
      onOpen={() => onNavigate('product', { product })}
      action={{ ...cardAction('retail', product), onClick: () => onAddToCart(product) }}
      compare={{
        checked: comparing.includes(product.id),
        disabled: comparing.length >= COMPARE_CAP && !comparing.includes(product.id),
        onToggle: () => pick(product.id),
      }}
      showStock
      notify={onNotifyMe ? { watching: !!watching?.has(product.id), onNotify: () => onNotifyMe(product) } : undefined}
      priceNote={product.unit ?? undefined}
    />
  ))

  const title = activeCategory ? activeCategory.name : 'All products'

  return (
    <section style={{ padding: categoryFilter ? '32px 0 64px' : '48px 0' }}>
      <>
        {categoryFilter ? (
          <ListingLayout
            title={title}
            subtitle={activeCategory?.blurb || undefined}
            breadcrumb={[{ label: 'Home', onClick: () => onNavigate('home') }, { label: title }]}
            count={filtered.length}
            total={priced.length}
            search={{ value: search, onChange: setSearch, placeholder: 'Search this shelf' }}
            sort={{ value: sortBy, options: SORT_OPTIONS, onChange: setSortBy }}
            filters={[
              {
                id: 'sub', title: 'Type', selected: subFilter, onSelect: setSubFilter,
                options: subCategories.map((s) => ({ value: s, label: s, count: priced.filter((p) => p.sub_category === s).length })),
              },
              {
                id: 'stock', title: 'Availability', selected: stockFilter, onSelect: setStockFilter,
                options: stocks.map((v) => ({ value: v, label: stockLabel(v), count: priced.filter((p) => p.stock === v).length })),
              },
            ]}
            onClear={clearFilters}
          >
            {loading ? (
              <div style={{ textAlign: 'center', padding: '64px' }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
              </div>
            ) : priceError ? (
              <EmptyListing title="We couldn't load prices just now." text="Please check your connection and try again."
                onClear={() => setReloadKey(k => k + 1)} actionLabel="Retry" />
            ) : filtered.length === 0 ? (
              <EmptyListing title="No products match" text="Try a different search or clear the filters." onClear={clearFilters} />
            ) : (
              <ListingGrid>{cards}</ListingGrid>
            )}
          </ListingLayout>
        ) : (
          <div className="container">
            <SectionHeader title="Featured products" />
            {loading ? (
              <div style={{ textAlign: 'center', padding: '64px' }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
              </div>
            ) : priceError ? (
              <EmptyListing title="We couldn't load prices just now." text="Please check your connection and try again."
                onClear={() => setReloadKey(k => k + 1)} actionLabel="Retry" />
            ) : filtered.length === 0 ? (
              <EmptyListing title="No products yet" text="Nothing is on this shelf for your market right now." />
            ) : (
              <ListingGrid>{cards}</ListingGrid>
            )}
          </div>
        )}

      <CompareTray
        picks={picks}
        onRemove={id => setComparing(comparing.filter(x => x !== id))}
        onClear={() => { setComparing([]); setShowCompare(false) }}
        onOpen={() => setShowCompare(true)}
      />

      {showCompare && picks.length >= 2 && (
        <CompareTable
          picks={picks}
          money={(n, c) => fmtIn(n, c)}
          actionLabel="Add to basket"
          canAct={item => item.stock !== 'out'}
          onAction={item => {
            const product = products.find(p => p.id === item.id)
            if (product) { onAddToCart(product); toast(`${product.name} added to your basket.`) }
          }}
          onRemove={id => setComparing(comparing.filter(x => x !== id))}
          onClose={() => setShowCompare(false)}
        />
      )}
      </>
    </section>
  )
}
