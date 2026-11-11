import { useEffect, useState } from 'react'
import { loadSellerAccountPrices } from '../../lib/priceBookRepo'
import type { SellerAccountPrice } from '../../lib/priceBookPayload'
import { standingOf } from '../../lib/accountPrices'
import { priceStandingStatus } from '../../lib/consoleTone'
import { StatusPill, fmtDate } from '../operator/shared'
import { PriceTag } from './PriceTag'

const today = () => new Date().toISOString().slice(0, 10)

/* The account prices this seller's listing is sold at. Read-only. Before the
   price books exist on the database, or when the read fails, there is nothing
   to show and nothing is drawn. */
export function SellerAccountPrices({ productId }: { productId: string }) {
  const [rows, setRows] = useState<SellerAccountPrice[]>([])

  useEffect(() => {
    let live = true
    void loadSellerAccountPrices().then(r => { if (live) setRows(r.ok ? r.value : []) }).catch(() => { if (live) setRows([]) })
    return () => { live = false }
  }, [productId])

  const mine = rows.filter(r => r.product_id === productId)
  if (mine.length === 0) return null
  const now = today()

  return (
    <section aria-labelledby="sap-title" style={{ marginTop: 20 }}>
      <h3 id="sap-title" style={{ fontSize: 15, margin: '0 0 6px' }}>Account prices on this listing</h3>
      <p style={{ margin: '0 0 10px', fontSize: 13 }}>
        Agreed by the marketplace with each account, never below your floor. Orders from these accounts settle at these prices.
      </p>
      <div className="c-table-wrap">
        <table className="c-table">
          <caption className="sr-only">Account prices on this listing</caption>
          <thead>
            <tr>
              <th scope="col">Company</th>
              <th scope="col">Currency</th>
              <th scope="col" style={{ textAlign: 'right' }}>Price</th>
              <th scope="col">From – to</th>
              <th scope="col">Standing</th>
            </tr>
          </thead>
          <tbody>
            {mine.map(r => {
              const standing = standingOf(r, now)
              return (
                <tr key={r.id}>
                  <td className="c-td">{r.company}</td>
                  <td className="c-td">{r.currency}</td>
                  <td className="c-td" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <PriceTag price={r.unit_price} published={r.unit_price} currency={r.currency} />
                  </td>
                  <td className="c-td">{fmtDate(r.starts_on)} – {r.ends_on ? fmtDate(r.ends_on) : 'open'}</td>
                  <td className="c-td"><StatusPill status={priceStandingStatus(standing)} label={standing} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
