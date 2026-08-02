import { useState, useMemo, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { paginate, pageLabel, pageNumbers, pageAfterResize, PAGE_SIZES, DEFAULT_PAGE_SIZE } from '../lib/paging'
import type { Page } from '../lib/paging'

/* The bar that goes under a long table.
 *
 * Scrolling a long list is not reading it. It gives no sense of how much there
 * is, no way to say where you are, and no way to come back to the same place —
 * so anything that can grow gets a page size, a count and a next button.
 *
 * The arithmetic is in `lib/paging.ts` and tested there. What is here is the
 * bar and the hook that holds the page number, because the two are always used
 * together and a screen that keeps its own `page` state gets the reset-on-
 * filter case wrong every time.
 */

/**
 * A page of rows, and the state to move through them.
 *
 * THIS IS A HOOK. It has to be called above every early return in the
 * component — the `if (loading) return <spinner/>` that most of these screens
 * open with included. Below one it runs on some renders and not others, and
 * React blanks the whole screen the moment `loading` flips. That is not a
 * hypothetical: it took out the operator's ticket queue, and the symptom is a
 * white page rather than an error anybody would connect to paging.
 *
 * `resetKey` is the thing that should send the reader back to page 1 — a
 * search string, a tab, a status filter. Changing what the list *is* while
 * leaving somebody on page 6 shows them an empty table and no reason for it.
 * Changing the list's *contents* under the same filter does not reset, because
 * `paginate` clamps, and being bumped to the last page is friendlier than being
 * bumped to the first.
 */
export function usePaging<T>(
  rows: readonly T[],
  { initialSize = DEFAULT_PAGE_SIZE, resetKey = '' }: { initialSize?: number; resetKey?: string } = {},
): Page<T> & { setPage: (n: number) => void; setSize: (n: number) => void } {
  const [page, setPage] = useState(1)
  const [size, setSizeRaw] = useState<number>(initialSize)

  useEffect(() => { setPage(1) }, [resetKey])

  const view = useMemo(() => paginate(rows, page, size), [rows, page, size])

  const setSize = (n: number) => {
    setPage(pageAfterResize(view.from, n))
    setSizeRaw(n)
  }

  return { ...view, setPage, setSize }
}

export function Pager<T>(
  { page, noun = 'records', compact }: {
    page: Page<T> & { setPage: (n: number) => void; setSize: (n: number) => void }
    noun?: string
    /* Drops the page-size chooser. For a panel narrow enough that the count and
       the arrows are all that fit. */
    compact?: boolean
  },
) {
  /* Nothing to page and nothing to choose — a bar saying "3 orders" with a
     dead arrow either side is noise. */
  if (page.total <= PAGE_SIZES[0] && page.pages === 1) {
    return page.total === 0 ? null : (
      <div style={barStyle}><span style={countStyle}>{pageLabel(page, noun)}</span></div>
    )
  }

  return (
    <div style={barStyle}>
      <span style={countStyle}>{pageLabel(page, noun)}</span>

      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginLeft: 'auto', flexWrap: 'wrap' }}>
        {!compact && (
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', ...countStyle }}>
            Show
            <select
              value={page.size}
              onChange={e => page.setSize(Number(e.target.value))}
              style={{
                padding: '3px 6px', borderRadius: 'var(--radius)',
                border: '1px solid var(--border)', background: 'white',
                fontSize: 'var(--text-xs)', color: 'var(--text)', cursor: 'pointer',
              }}
            >
              {PAGE_SIZES.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <Arrow label="Previous page" disabled={!page.hasPrev} onClick={() => page.setPage(page.page - 1)}>
            <ChevronLeft size={14} />
          </Arrow>

          {pageNumbers(page.page, page.pages).map((n, i) =>
            n === null
              ? <span key={`gap${i}`} style={{ ...countStyle, padding: '0 2px' }}>…</span>
              : (
                <button
                  key={n}
                  onClick={() => page.setPage(n)}
                  aria-current={n === page.page ? 'page' : undefined}
                  style={{
                    minWidth: 26, height: 26, padding: '0 6px',
                    borderRadius: 'var(--radius)', cursor: 'pointer',
                    fontSize: 'var(--text-xs)', fontWeight: n === page.page ? 700 : 500,
                    fontVariantNumeric: 'tabular-nums',
                    border: `1px solid ${n === page.page ? 'var(--brand-navy)' : 'var(--border)'}`,
                    background: n === page.page ? 'var(--brand-navy)' : 'white',
                    color: n === page.page ? 'white' : 'var(--text-secondary)',
                  }}
                >{n}</button>
              ))}

          <Arrow label="Next page" disabled={!page.hasNext} onClick={() => page.setPage(page.page + 1)}>
            <ChevronRight size={14} />
          </Arrow>
        </div>
      </div>
    </div>
  )
}

function Arrow(
  { label, disabled, onClick, children }: {
    label: string; disabled: boolean; onClick: () => void; children: React.ReactNode
  },
) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: 26, height: 26, borderRadius: 'var(--radius)',
        border: '1px solid var(--border)', background: 'white',
        color: 'var(--text-secondary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.4 : 1,
      }}
    >{children}</button>
  )
}

const barStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
  padding: '10px 2px 2px', borderTop: '1px solid var(--border-light)', marginTop: '10px',
}

const countStyle: React.CSSProperties = {
  fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', whiteSpace: 'nowrap',
}
