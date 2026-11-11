/* Where a configured bundle goes once it is priced.
 *
 * The configurator hands a selection id on; the basket (consumer) and the
 * requisition (enterprise) take it from there. They register themselves here
 * rather than being passed down as props, because the configurator is mounted
 * once per shell and the basket/requisition code lives elsewhere in the tree.
 * Until a sink is registered, sending says so instead of pretending.
 */

export type BundleSinkKind = 'basket' | 'requisition'
export type BundleSinkResult = { ok: true } | { ok: false; error: string }
export type BundleSink = (selectionId: string, replaceSelectionId?: string) => Promise<BundleSinkResult>

const sinks = new Map<BundleSinkKind, BundleSink>()

/** Register the function that adds a selection; returns an unregister. */
export function registerBundleSink(kind: BundleSinkKind, fn: BundleSink): () => void {
  sinks.set(kind, fn)
  return () => { if (sinks.get(kind) === fn) sinks.delete(kind) }
}

/** Whether anything takes bundles of this kind yet — asked before a selection is written. */
export const hasBundleSink = (kind: BundleSinkKind): boolean => sinks.has(kind)

const WHERE: Record<BundleSinkKind, string> = { basket: 'basket', requisition: 'requisition' }

export const notAvailable = (kind: BundleSinkKind): string => `Adding a bundle to your ${WHERE[kind]} is not available yet.`

export async function sendBundleTo(kind: BundleSinkKind, selectionId: string, replaceSelectionId?: string): Promise<BundleSinkResult> {
  const fn = sinks.get(kind)
  if (!fn) return { ok: false, error: notAvailable(kind) }
  try {
    return await fn(selectionId, replaceSelectionId)
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}
