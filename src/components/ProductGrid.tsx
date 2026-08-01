import { useState, useEffect, useMemo } from 'react'
import { Star, Plus, Search, SlidersHorizontal } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Product, Category } from '../types'
import { categoriesFor } from '../lib/storefront'
import { ProductCard } from './ProductCard'

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
  const [products, setProducts] = useState<Product[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortBy, setSortBy] = useState('featured')
  const [subFilter, setSubFilter] = useState<string | null>(null)
  const [stockFilter, setStockFilter] = useState<string | null>(null)

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
      .order('sort_order')

    query = categoryFilter
      ? query.eq('category_id', categoryFilter).in('category_id', mine)
      : query.in('category_id', mine)

    query.then(({ data }) => {
      if (data) setProducts(data as Product[])
      setLoading(false)
    })
  }, [categoryFilter, categories])

  const subCategories = useMemo(() => {
    const subs = new Set(products.map((p) => p.sub_category))
    return Array.from(subs).sort()
  }, [products])

  const filtered = useMemo(() => {
    let result = products

    if (search) {
      const q = search.toLowerCase()
      result = result.filter((p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.tags.some((t) => t.toLowerCase().includes(q))
      )
    }

    if (subFilter) {
      result = result.filter((p) => p.sub_category === subFilter)
    }

    if (stockFilter) {
      result = result.filter((p) => p.stock === stockFilter)
    }

    switch (sortBy) {
      case 'price-low':
        result = [...result].sort((a, b) => a.price - b.price)
        break
      case 'price-high':
        result = [...result].sort((a, b) => b.price - a.price)
        break
      case 'rating':
        result = [...result].sort((a, b) => (b.rating || 0) - (a.rating || 0))
        break
      case 'reviews':
        result = [...result].sort((a, b) => b.reviews - a.reviews)
        break
    }

    return result
  }, [products, search, sortBy, subFilter, stockFilter])

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

  return (
    <section style={{ padding: categoryFilter ? '32px 0 64px' : '48px 0' }}>
      <div className="container">
        {/* Header */}
        {activeCategory ? (
          <div style={{ marginBottom: '24px' }}>
            <button onClick={() => onNavigate('home')} style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: '8px' }}>
              ← All categories
            </button>
            <h1 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, marginBottom: '4px' }}>
              {activeCategory.name} Marketplace
            </h1>
            <p style={{ color: 'var(--text-secondary)' }}>{activeCategory.blurb}</p>
          </div>
        ) : (
          <h2 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, marginBottom: '24px' }}>
            Featured products
          </h2>
        )}

        {/* Toolbar */}
        <div style={{
          display: 'flex',
          gap: '16px',
          marginBottom: '24px',
          flexWrap: 'wrap',
          alignItems: 'center',
        }}>
          <div style={{ position: 'relative', flex: '1', minWidth: '220px' }}>
            <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search products..."
              style={{
                width: '100%',
                padding: '10px 12px 10px 38px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'white',
                fontSize: 'var(--text-sm)',
                outline: 'none',
              }}
            />
          </div>

          {subCategories.length > 1 && (
            <select
              value={subFilter || ''}
              onChange={(e) => setSubFilter(e.target.value || null)}
              style={{
                padding: '10px 12px',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                background: 'white',
                fontSize: 'var(--text-sm)',
                cursor: 'pointer',
              }}
            >
              <option value="">All types</option>
              {subCategories.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          )}

          <select
            value={stockFilter || ''}
            onChange={(e) => setStockFilter(e.target.value || null)}
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'white',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
            }}
          >
            <option value="">All stock</option>
            <option value="in">In stock</option>
            <option value="low">Low stock</option>
            <option value="out">Out of stock</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius)',
              border: '1px solid var(--border)',
              background: 'white',
              fontSize: 'var(--text-sm)',
              cursor: 'pointer',
            }}
          >
            <option value="featured">Featured</option>
            <option value="price-low">Price: Low to High</option>
            <option value="price-high">Price: High to Low</option>
            <option value="rating">Top rated</option>
            <option value="reviews">Most reviewed</option>
          </select>
        </div>

        {/* Results count */}
        <div style={{ marginBottom: '16px', fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
          {loading ? 'Loading...' : `${filtered.length} product${filtered.length !== 1 ? 's' : ''}`}
        </div>

        {/* Grid */}
        {loading ? (
          <div style={{ textAlign: 'center', padding: '64px' }}>
            <div className="spinner" style={{ margin: '0 auto' }} />
          </div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '64px', color: 'var(--text-tertiary)' }}>
            <SlidersHorizontal size={32} style={{ margin: '0 auto 16px', opacity: 0.5 }} />
            <p>No products match your filters.</p>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '20px',
          }}>
            {filtered.map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                onClick={() => onNavigate('product', { product })}
                onAddToCart={() => onAddToCart(product)}
                watching={watching?.has(product.id)}
                onNotifyMe={onNotifyMe ? () => onNotifyMe(product) : undefined}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
