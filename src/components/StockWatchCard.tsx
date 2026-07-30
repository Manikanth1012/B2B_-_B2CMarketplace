import { useState, useEffect, useCallback } from 'react'
import { Bell, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Product } from '../types'
import {
  orderWatches, watchState, watchStateLabel, isOpen, WATCH_CAVEAT, type Watch,
} from '../lib/stockWatch'
import { formatDateOnly } from '../lib/subscriptions'

/* "Waiting for stock" — what the shopper has asked to be told about, and on which
   channel. The prototype's table, with its three states kept distinct. */

export function StockWatchCard({ showToast, onAddToCart, onChanged }: {
  showToast: (m: string) => void
  onAddToCart?: (product: Product) => void
  /* Cancelling here changes what a product tile should say. Without telling the
     owner of that state, the tile keeps offering "you will be told" for a watch
     that no longer exists. */
  onChanged?: () => void
}) {
  const [watches, setWatches] = useState<Watch[]>([])
  const [products, setProducts] = useState<Record<string, Product>>({})

  const load = useCallback(async () => {
    const { data } = await supabase.from('stock_watch').select('*')
    const rows = (data ?? []) as Watch[]
    setWatches(rows)
    if (rows.length > 0) {
      const { data: prods } = await supabase.from('products').select('*')
        .in('id', rows.map(w => w.product_id))
      setProducts(Object.fromEntries(((prods ?? []) as Product[]).map(p => [p.id, p])))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const cancel = async (w: Watch) => {
    await supabase.from('stock_watch').delete().eq('id', w.id)
    await load()
    onChanged?.()
    showToast(`Alert cancelled — nothing will be sent for ${products[w.product_id]?.name ?? w.product_id}`)
  }

  /* Nothing asked for is not a state worth a card. */
  if (watches.length === 0) return <></>

  const open = watches.filter(isOpen).length

  return (
    <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: 'var(--radius-lg)', padding: '24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
        <span style={{ color: 'var(--brand-accent-dark)' }}><Bell size={18} /></span>
        <h2 style={{ fontWeight: 700, fontSize: 'var(--text-lg)' }}>Waiting for stock</h2>
      </div>
      <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginBottom: '20px' }}>
        {open} waiting · {WATCH_CAVEAT.toLowerCase()}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {orderWatches(watches).map(w => {
          const product = products[w.product_id]
          const state = watchState(w, product)
          return (
            <div key={w.id} style={{
              display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '12px',
              padding: '12px', borderRadius: 'var(--radius)',
              border: '1px solid var(--border-light)',
              background: state === 'told' ? 'var(--bg-alt)' : 'white',
            }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                  {product?.name ?? w.product_id}
                </div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                  {product?.seller}
                </div>
                {/* The channel is part of what was promised, so it is shown. */}
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
                  {w.channel} · {w.to_address} · asked {formatDateOnly(w.since)}
                </div>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flexShrink: 0 }}>
                <span style={{
                  padding: '2px 10px', borderRadius: '999px', fontSize: 'var(--text-xs)', fontWeight: 700,
                  background: state === 'back' ? '#DCFCE7' : state === 'waiting' ? '#FEF3C7' : 'var(--border-light)',
                  color: state === 'back' ? '#15803D' : state === 'waiting' ? '#92400E' : 'var(--text-tertiary)',
                }}>
                  {watchStateLabel(state, w.notified_at ? formatDateOnly(w.notified_at) : null)}
                </span>

                {/* Back in stock and not yet told: the thing they asked for is
                    buyable now, so offer it rather than making them go and find it. */}
                {state === 'back' && product && onAddToCart && (
                  <button onClick={() => onAddToCart(product)} className="btn btn-primary btn-sm">
                    Add to basket
                  </button>
                )}
                {isOpen(w) && (
                  <button
                    onClick={() => cancel(w)}
                    className="btn btn-secondary btn-sm"
                    style={{ display: 'flex', alignItems: 'center', gap: '4px' }}
                  >
                    <X size={12} /> Cancel
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
