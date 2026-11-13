/* Today's prices and rules for a requisition basket, read again.
 *
 * Raise does this before it writes (spec 10), and a kept basket does it when it
 * is loaded (spec 11, decision 2): a basket left last week holds last week's
 * prices, and an approver must not be shown them. One reading, so the drawer
 * and the restore cannot disagree about what moved.
 */
import { loadAccountPrices, loadBuyingRules, loadPublishedPrices } from './priceBookRepo'
import { contractChanges } from './requisitionBasket'
import type { Basket, ContractChange } from './requisitionBasket'
import type { AccountPrice, BuyingRules } from './accountPrices'

export interface Recheck {
  prices: AccountPrice[]
  rules: BuyingRules
  changes: ContractChange[]
  /** Each listing's published price in the basket's currency, as the price guard reads it. */
  published: ReadonlyMap<string, { price: number; floor_price: number | null }>
}

/**
 * Null when any read fails: the caller then goes on the figures it holds, and
 * the database's price guard still refuses a line whose price has moved, in its
 * own words.
 */
export async function recheck(account_id: string, basket: Basket, today: string): Promise<Recheck | null> {
  try {
    const [ap, br, pb] = await Promise.all([
      loadAccountPrices(account_id), loadBuyingRules(account_id),
      /* Each listing's published price as the database's price guard reads it,
         base row included (publishedIn). */
      loadPublishedPrices(basket.lines.map(l => l.product_id), basket.currency),
    ])
    if (!ap.ok || !br.ok || !pb.ok) {
      console.warn(`Today's prices could not be re-read, so the requisition goes on the figures shown (${
        [ap, br, pb].map(r => (r.ok ? '' : r.error)).filter(Boolean).join('; ')}).`)
      return null
    }
    const rules = br.value.account_id ? br.value : { ...br.value, account_id }
    return {
      prices: ap.value, rules, published: pb.value,
      changes: contractChanges(basket, { prices: ap.value, published: pb.value }, account_id, today),
    }
  } catch (e) {
    console.warn(`Today's prices could not be re-read (${e instanceof Error ? e.message : 'the request failed'}).`)
    return null
  }
}
