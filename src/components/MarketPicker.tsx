/* Choosing the market, which is really choosing what you pay in.
 *
 * It sits in the utility bar where "India · UAE · Kenya" used to be printed as
 * a plain span — three markets named and none of them selectable, above a site
 * whose every price was in dollars.
 *
 * The currency is shown next to the market name rather than left implied.
 * Switching from India to Kenya changes ₹1,099 to KSh 1,599, and a shopper who
 * cannot see which currency they are looking at has to work that out from the
 * magnitude.
 */
import { useState, useRef, useEffect } from 'react'
import { Globe, ChevronDown, Check } from 'lucide-react'
import { useMarket } from '../lib/MarketContext'

export function MarketPicker({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const { book, market, currency, setMarket, ready } = useMarket()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    /* Bound on the document so a click anywhere else dismisses it, and removed
       on close so a shut menu is not still listening. */
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const ink = tone === 'dark' ? 'rgba(255,255,255,0.7)' : 'var(--text-secondary)'

  /* Before the tables load there is no market to name. Showing the three
     markets as static text keeps the bar the same height and says the same
     thing the old span did, rather than collapsing and pushing the page up. */
  if (!ready || !market) {
    return <span style={{ color: ink }}>India · UAE · Kenya</span>
  }

  return (
    <div ref={box} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Market: ${market.name}, paying in ${currency?.name ?? market.currency}`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          background: 'none', border: 'none', cursor: 'pointer',
          color: ink, fontSize: 'var(--text-xs)', padding: 0,
        }}
      >
        <Globe size={13} />
        <span>{market.name}</span>
        <span style={{ opacity: 0.75 }}>· {market.currency}</span>
        <ChevronDown size={12} style={{ opacity: 0.6 }} />
      </button>

      {open && (
        <div
          role="listbox"
          style={{
            position: 'absolute', top: '100%', left: 0, marginTop: '6px',
            background: 'white', borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)', border: '1px solid var(--border)',
            minWidth: '250px', zIndex: 300, overflow: 'hidden',
          }}
        >
          {book.markets.map(m => {
            const cur = book.currencies.find(c => c.code === m.currency)
            const active = m.code === market.code
            return (
              <button
                key={m.code}
                role="option"
                aria-selected={active}
                onClick={() => { setMarket(m.code); setOpen(false) }}
                style={{
                  display: 'flex', alignItems: 'center', gap: '10px', width: '100%',
                  padding: '10px 13px', background: active ? 'var(--bg-alt)' : 'white',
                  border: 'none', borderBottom: '1px solid var(--border-light)',
                  cursor: 'pointer', textAlign: 'left',
                }}
              >
                <span style={{ width: 14, flexShrink: 0, color: 'var(--brand-navy)' }}>
                  {active && <Check size={14} />}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 'var(--text-sm)', fontWeight: 700, color: 'var(--text)' }}>
                    {m.name}
                  </span>
                  {/* The tax is named because it is charged, and because it is
                      not the same tax in each of these three places. */}
                  <span style={{ display: 'block', fontSize: '11px', color: 'var(--text-tertiary)' }}>
                    {cur?.symbol} {cur?.name ?? m.currency} · {m.tax_label} {m.tax_rate}%
                  </span>
                </span>
              </button>
            )
          })}
          <p style={{
            margin: 0, padding: '9px 13px', fontSize: '10px',
            color: 'var(--text-tertiary)', background: 'var(--bg-alt)', lineHeight: 1.45,
          }}>
            Prices are set for each market, not converted at checkout. Changing market changes
            what you are charged and the tax you are charged it under.
          </p>
        </div>
      )}
    </div>
  )
}
