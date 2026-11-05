/* How the basket, the requisition and the shop ask for the bundle configurator.
 *
 * The configurator (BundleConfigurator) is mounted once per shell and listens;
 * anything that wants it open — a bundle card, "Edit bundle" on a basket or
 * requisition line — dispatches. A window event rather than a prop chain, the
 * way enquiries/events.ts tells the Enquiries screen to reload, because the
 * callers sit in unrelated parts of the tree.
 */
import type { Choices } from '../../lib/bundles'

export const OPEN_BUNDLE = 'aventa:open-bundle'

export interface OpenBundleDetail {
  templateId: string
  /** Start from these choices instead of the template's defaults (Edit bundle). */
  choices?: Choices
  /** Bundle quantity to start from. */
  quantity?: number
  /** When editing, the selection whose lines the new one replaces. */
  replaceSelectionId?: string
}

export function openBundleConfigurator(detail: OpenBundleDetail): void {
  window.dispatchEvent(new CustomEvent<OpenBundleDetail>(OPEN_BUNDLE, { detail }))
}

export function onOpenBundle(handler: (detail: OpenBundleDetail) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<OpenBundleDetail>).detail)
  window.addEventListener(OPEN_BUNDLE, listener)
  return () => window.removeEventListener(OPEN_BUNDLE, listener)
}

/** After a bundle is added, edited or removed, so baskets and requisitions reload. */
export const BUNDLES_CHANGED = 'aventa:bundles-changed'
export function bundlesChanged(): void {
  window.dispatchEvent(new Event(BUNDLES_CHANGED))
}
