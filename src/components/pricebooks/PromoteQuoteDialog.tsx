import { Modal, Btn, Table, Td, EmptyState } from '../operator/shared'
import { useMarket } from '../../lib/MarketContext'
import { priceText } from '../../lib/priceText'
import type { QuoteLineForPromotion } from '../../lib/accountPrices'
import type { PriceRow } from '../../lib/moneyRepo'

/* The account's accepted quote lines that are not already its price in force,
   each with its quoted price beside today's floor. Picking one opens the Set
   dialog, prefilled and locked to the quote. A line the database would refuse
   is shown with its refusal and cannot be picked. */

/** Why promote_quote_line (and the guard it calls) would refuse this line today, in its own
 *  words; null when it can be picked. A missing price-book row is left to the database, which
 *  may fall back to the listing's own price. */
export function promoteProblem(
  l: QuoteLineForPromotion, row: PriceRow | null, name: string,
): string | null {
  const quoted = l.quoted_unit_price
  if (quoted === null) return `${l.enquiry_id} has not been accepted, so its prices cannot become the account's.`
  if (quoted <= 0) {
    return `${l.enquiry_id} quoted that line at ${quoted.toFixed(2)}, and an account price is more than nothing. Agree a price with the account and set it on Price books instead.`
  }
  if (row && quoted > row.price) {
    return `That is above the published price of ${l.currency} ${row.price.toFixed(2)} for ${name}. An account price is at or below it.`
  }
  if (row && row.floor_price !== null && quoted < row.floor_price) {
    return `That is below the floor of ${l.currency} ${row.floor_price.toFixed(2)} that the seller of ${name} agreed. An account price never goes under it.`
  }
  return null
}

export function PromoteQuoteDialog({ open, onClose, company, lines, books, names, onPick }: {
  open: boolean
  onClose: () => void
  company: string
  /** Already filtered by `promotable`. */
  lines: readonly QuoteLineForPromotion[]
  /** Today's published prices and floors, by currency. */
  books: Readonly<Record<string, Map<string, PriceRow>>>
  /** products.name by id. */
  names?: Readonly<Record<string, string>>
  onPick: (line: QuoteLineForPromotion) => void
}) {
  const { book } = useMarket()
  const fmt = (n: number, c: string) => priceText(n, c, book?.currencies ?? [], true)
  return (
    <Modal open={open} onClose={onClose} title={`Promote a quote for ${company}`}
      footer={<Btn variant="secondary" className="pb-target" onClick={onClose}>Close</Btn>}>
      <p style={{ marginTop: 0, fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        Accepted quote lines that are not already this account's price. Promoting one makes the
        quoted price the account's standing price for that listing and currency. A quote under the
        seller's floor was one deal, not a standing price, so it cannot be promoted.
      </p>
      {lines.length === 0 ? (
        <EmptyState message={`${company} has no accepted quote lines waiting to become prices.`} />
      ) : (
        <Table headers={['Quote', 'Listing', 'Quoted', 'Floor today', '']}>
          {lines.map(l => {
            const row = books[l.currency]?.get(l.product_id) ?? null
            const floor = row?.floor_price ?? null
            const name = names?.[l.product_id] ?? l.name
            const problem = promoteProblem(l, row, name)
            return (
              <tr key={l.id}>
                <Td>{l.enquiry_id}</Td>
                <Td style={{ maxWidth: '24ch' }}>{name}</Td>
                <Td right>{l.quoted_unit_price === null ? '—' : fmt(l.quoted_unit_price, l.currency)}</Td>
                <Td right>{floor === null ? 'None set' : fmt(floor, l.currency)}</Td>
                <Td style={{ maxWidth: '32ch' }}>
                  {problem
                    ? <span style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)' }}>{problem}</span>
                    : <Btn size="sm" className="pb-target" onClick={() => onPick(l)}
                        aria-label={`Promote ${l.enquiry_id} ${name}`}>Promote</Btn>}
                </Td>
              </tr>
            )
          })}
        </Table>
      )}
    </Modal>
  )
}
