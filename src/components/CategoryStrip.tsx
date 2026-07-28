import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Category, Product } from '../types'
import { getCategoryImage } from '../lib/images'

import type { View } from '../types/view'

interface CategoryStripProps {
  onNavigate: (view: View, opts?: { category?: string }) => void
}

const catColors: Record<string, string> = {
  consumer: '#00A6A6',
  partner: '#8B5CF6',
  iot: '#16A34A',
  security: '#2563EB',
  device: '#F5A623',
  content: '#E63946',
}

export function CategoryStrip({ onNavigate }: CategoryStripProps) {
  const [categories, setCategories] = useState<Category[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    supabase.from('categories').select('*').order('sort_order').then(({ data }) => {
      if (data) setCategories(data as Category[])
    })
    supabase.from('products').select('category_id').then(({ data }) => {
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
    <section style={{ padding: '48px 0' }}>
      <div className="container">
        <h2 style={{ fontSize: 'var(--text-3xl)', fontWeight: 700, marginBottom: '8px' }}>
          Shop by category
        </h2>
        <p style={{ color: 'var(--text-secondary)', marginBottom: '32px' }}>
          Six marketplaces, one checkout. Find exactly what you need.
        </p>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
          gap: '20px',
        }}>
          {categories.map((cat) => (
            <button
              key={cat.id}
              onClick={() => onNavigate('category', { category: cat.id })}
              style={{
                background: 'white',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-lg)',
                padding: '0',
                textAlign: 'left',
                transition: 'all 200ms ease',
                position: 'relative',
                overflow: 'hidden',
                cursor: 'pointer',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.boxShadow = 'var(--shadow-lg)'; e.currentTarget.style.transform = 'translateY(-4px)' }}
              onMouseLeave={(e) => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.transform = 'translateY(0)' }}
            >
              {/* Image header */}
              <div style={{
                height: '120px',
                overflow: 'hidden',
                position: 'relative',
              }}>
                <img
                  src={getCategoryImage(cat.id)}
                  alt={cat.name}
                  loading="lazy"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <div style={{
                  position: 'absolute',
                  inset: 0,
                  background: `linear-gradient(to bottom, transparent, ${catColors[cat.id] || '#00A6A6'}40)`,
                }} />
              </div>
              {/* Content */}
              <div style={{ padding: '20px' }}>
                <h3 style={{ fontWeight: 700, fontSize: 'var(--text-base)', marginBottom: '4px' }}>
                  {cat.name}
                </h3>
                <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginBottom: '12px', lineHeight: 1.5 }}>
                  {cat.blurb}
                </p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="pill">{counts[cat.id] || 0} products</span>
                  <span style={{ fontSize: 'var(--text-xs)', color: 'var(--brand-accent)', fontWeight: 600 }}>
                    Browse →
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </section>
  )
}
