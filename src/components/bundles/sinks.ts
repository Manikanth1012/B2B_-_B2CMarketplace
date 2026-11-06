/* Where a configured bundle goes once the configurator has saved it.
 *
 * Two sinks with one shape, for the configurator's hand-off registry: the
 * shopper's basket and the business buyer's requisition. Each takes the saved
 * selection's id (and, when editing, the one it replaces), puts every part in
 * at the selection's own unit prices and tells the screens to reload.
 *
 * `rebundle` is the basket and requisition's own way back in: a new quantity
 * or "Re-price" configures the same choices again and replaces the group.
 */
import { configureBundle } from '../../lib/bundleRepo'
import { loadBundleInfo, putBundleInCart } from '../../lib/bundleBasketRepo'
import { loadQuotedProducts } from '../../lib/enquiryRepo'
import { bundleBasketLines, type PartFacts } from '../../lib/bundleLines'
import { addBundleToRequisition } from '../../lib/RequisitionContext'
import type { Choices } from '../../lib/bundles'
import { bundlesChanged } from './events'

export type SinkResult = { ok: true } | { ok: false; error: string }
export type Sink = (selectionId: string, replaceSelectionId?: string) => Promise<SinkResult>

/** Into the shopper's basket (cart_items), in one insert. */
export const basketSink: Sink = async (selectionId, replaceSelectionId) => {
  const r = await putBundleInCart(selectionId, replaceSelectionId)
  if (!r.ok) return { ok: false, error: r.error }
  bundlesChanged()
  return { ok: true }
}

/** Into the requisition being built, at the selection's fixed unit prices. */
export const requisitionSink: Sink = async (selectionId, replaceSelectionId) => {
  const got = await loadBundleInfo([selectionId])
  if (!got.ok) return { ok: false, error: got.error }
  const info = got.value.get(selectionId)
  if (!info || !info.lines.length) return { ok: false, error: 'That bundle could not be read back, so nothing was added.' }
  const p = await loadQuotedProducts(info.lines.map(l => l.product_id))
  if (!p.ok) return { ok: false, error: `The bundle's products could not be read, so nothing was added. The detail: ${p.error}` }
  const { lines, unread } = bundleBasketLines(info, p.products as ReadonlyMap<string, PartFacts>)
  if (unread.length) return { ok: false, error: `${unread.join(', ')} could not be read from the catalogue, so the bundle was not added.` }
  const r = addBundleToRequisition(lines, info.selection.currency, replaceSelectionId)
  if (!r.ok) return { ok: false, error: r.reason }
  bundlesChanged()
  return { ok: true }
}

/** The same choices priced again (a new bundle quantity, or after the
    seven-day hold), replacing the old group through `sink`. */
export async function rebundle(
  old: { selectionId: string; templateId: string; choices: Choices; currency: string },
  quantity: number, sink: Sink,
): Promise<SinkResult> {
  if (!Number.isInteger(quantity) || quantity < 1) return { ok: false, error: 'A bundle quantity is a whole number, at least 1.' }
  const c = await configureBundle(old.templateId, old.choices, old.currency, quantity)
  if (!c.ok) return { ok: false, error: c.error }
  return sink(c.value.selection.id, old.selectionId)
}
