import { useEffect, useMemo, useState } from 'react'
import { loadMoneyBook, loadPriceBook } from '../../lib/moneyRepo'
import type { PriceRow } from '../../lib/moneyRepo'
import { useMarket } from '../../lib/MarketContext'
import { Callout } from '../OnboardingJourney'
import { previewConfiguration } from './previewPrices'
import type { PreviewKind, PreviewResult, PreviewSlot } from './previewPrices'

const KINDS: { kind: PreviewKind; label: string }[] = [
  { kind: 'default', label: 'Starting point' },
  { kind: 'cheapest', label: 'Cheapest' },
  { kind: 'dearest', label: 'Dearest' },
]

type Books = { currency: string; book: Map<string, PriceRow> }[]

/** The price book of every currency a market takes, read once per builder. */
function usePriceBooks() {
  const [books, setBooks] = useState<Books | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let live = true
    ;(async () => {
      try {
        const money = await loadMoneyBook()
        if (money.loadError) throw new Error(money.loadError)
        const currencies = [...new Set(money.accepted.map(a => a.currency))].sort()
        const loaded = await Promise.all(currencies.map(async currency => ({ currency, book: await loadPriceBook(currency) })))
        if (live) setBooks(loaded)
      } catch (err) {
        if (live) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => { live = false }
  }, [])
  return { books, error }
}

export function TemplatePreview({ slots, discountPct, nameOf }: {
  slots: PreviewSlot[]; discountPct: number; nameOf: (productId: string) => string
}) {
  const { fmtIn } = useMarket()
  const { books, error } = usePriceBooks()
  const [shown, setShown] = useState(false)

  const rows = useMemo(() => (books ?? []).map(b => ({
    currency: b.currency,
    results: KINDS.map(k => ({
      ...k,
      result: previewConfiguration(slots, k.kind, discountPct, b.book, nameOf) as PreviewResult,
    })),
  })), [books, slots, discountPct, nameOf])

  return (
    <section className="tb-preview" aria-labelledby="tb-preview-h">
      <h3 id="tb-preview-h" className="tb-h">What it would cost</h3>
      <p className="tb-hint">
        An estimate in every currency a market takes, at {discountPct || 0}% off, never below a seller&apos;s floor.
        The database makes the final call when you publish.
      </p>
      {error && <Callout tone="warning" title="Prices did not load">{error}</Callout>}
      {!books && !error && <p className="tb-hint" role="status">Reading the price book...</p>}
      {books && books.length === 0 && <p className="tb-hint">No market takes any currency yet, so there is nothing to price.</p>}
      {books && books.length > 0 && (
        <>
          <button type="button" className="c-btn c-btn--secondary tb-btn" aria-expanded={shown} onClick={() => setShown(s => !s)}>
            {shown ? 'Hide the preview' : 'Show the preview'}
          </button>
          {shown && (
            <div className="tb-scroll">
              <table className="tb-table">
                <caption className="sr-only">Estimated bundle price by currency</caption>
                <thead>
                  <tr><th scope="col">Currency</th>{KINDS.map(k => <th key={k.kind} scope="col">{k.label}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.map(r => (
                    <tr key={r.currency}>
                      <th scope="row">{r.currency}</th>
                      {r.results.map(c => (
                        <td key={c.kind}>
                          {c.result.kind === 'empty' && <span className="tb-muted">Nothing to price yet</span>}
                          {c.result.kind === 'missing' && (
                            <span className="tb-bad">No {r.currency} price for {c.result.names.join(', ')}</span>
                          )}
                          {c.result.kind === 'ok' && (
                            <>
                              <strong>{fmtIn(c.result.total, r.currency)}</strong>
                              <span className="tb-muted"> saves {fmtIn(c.result.saving, r.currency)}</span>
                              {c.result.atFloor.length > 0
                                ? <span className="tb-warn">At its floor: {c.result.atFloor.join(', ')}</span>
                                : c.result.tightest && (
                                  <span className="tb-muted">Least room: {c.result.tightest.name} ({c.result.tightest.roomPct}%)</span>
                                )}
                            </>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  )
}
