import { Modal, Btn, Table, Td, EmptyState } from '../operator/shared'
import { useMarket } from '../../lib/MarketContext'
import type { QuoteLineForPromotion } from '../../lib/accountPrices'
import type { PriceRow } from '../../lib/moneyRepo'

/* The account's accepted quote lines that are not already its price in force,
   each with its quoted price beside today's floor. Picking one opens the Set
   dialog, prefilled and locked to the quote. A line under today's floor is
   shown but cannot be picked: promote_quote_line refuses it, because a quote
   under the floor was one deal, not consent to a standing price under it. */
export function PromoteQuoteDialog({ open, onClose, company, lines, books, onPick }: {
  open: boolean
  onClose: () => void
  company: string
  /** Already filtered by `promotable`. */
  lines: readonly QuoteLineForPromotion[]
  /** Today's published prices and floors, by currency. */
  books: Readonly<Record<string, Map<string, PriceRow>>>
  onPick: (line: QuoteLineForPromotion) => void
}) {
  const { fmtIn } = useMarket()
  const fmt = (n: number, c: string) => fmtIn(n, c, { decimals: true })
  return (
    <Modal open={open} onClose={onClose} title={`Promote a quote for ${company}`}
      footer={<Btn variant="secondary" className="pb-target" onClick={onClose}>Close</Btn>}>
      <p style={{ marginTop: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        Accepted quote lines that are not already this account's price. Promoting one makes the
        quoted price the account's standing price for that listing and currency.
      </p>
      {lines.length === 0 ? (
        <EmptyState message={`${company} has no accepted quote lines waiting to become prices.`} />
      ) : (
        <Table headers={['Quote', 'Listing', 'Quoted', 'Floor today', '']}>
          {lines.map(l => {
            const row = books[l.currency]?.get(l.product_id) ?? null
            const floor = row?.floor_price ?? null
            const quoted = l.quoted_unit_price ?? 0
            const under = floor !== null && quoted < floor
            const above = row !== null && quoted > row.price
            return (
              <tr key={l.id}>
                <Td>{l.enquiry_id}</Td>
                <Td style={{ maxWidth: '24ch' }}>{l.name}</Td>
                <Td right>{fmt(quoted, l.currency)}</Td>
                <Td right>{floor === null ? 'None set' : fmt(floor, l.currency)}</Td>
                <Td>
                  {under
                    ? <span style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)' }}>Under today's floor, so it cannot become a standing price.</span>
                    : (
                      <>
                        <Btn size="sm" className="pb-target" onClick={() => onPick(l)}
                          aria-label={`Promote ${l.enquiry_id} ${l.name}`}>Promote</Btn>
                        {above && row && (
                          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-secondary)', marginTop: '4px' }}>
                            Above today's published price of {fmt(row.price, l.currency)}.
                          </div>
                        )}
                      </>
                    )}
                </Td>
              </tr>
            )
          })}
        </Table>
      )}
    </Modal>
  )
}
