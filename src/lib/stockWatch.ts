/* Restock alerts, pure. */

export interface Watch {
  id: string
  product_id: string
  channel: string
  to_address: string
  since: string
  notified_at: string | null
}

export const CHANNELS = ['Email', 'SMS'] as const
export type Channel = typeof CHANNELS[number]

export function isOutOfStock(product: { stock: string }): boolean {
  return product.stock.trim().toLowerCase() === 'out'
}

/** An open watch is one that has not been sent yet. Once it has, the promise is
    kept and the row is history. */
export function isOpen(w: Watch): boolean {
  return w.notified_at === null
}

export function openWatchFor(watches: readonly Watch[], productId: string): Watch | undefined {
  return watches.find(w => w.product_id === productId && isOpen(w))
}

/** Only worth asking about something you cannot buy, and only once. */
export function canWatch(product: { stock: string }, watches: readonly Watch[], productId: string): boolean {
  return isOutOfStock(product) && !openWatchFor(watches, productId)
}

export type WatchState = 'told' | 'waiting' | 'back'

/**
 * Three states, and the difference between the last two matters: an open watch on a
 * product that is back in stock means the alert has not gone out *yet* but the thing
 * is buyable now. Showing that as "still waiting" would hide a product the shopper
 * asked for and can have.
 */
export function watchState(w: Watch, product: { stock: string } | undefined): WatchState {
  if (!isOpen(w)) return 'told'
  if (product && isOutOfStock(product)) return 'waiting'
  return 'back'
}

export function watchStateLabel(state: WatchState, notifiedOn?: string | null): string {
  if (state === 'told') return notifiedOn ? `Told ${notifiedOn}` : 'Told'
  return state === 'waiting' ? 'Still out of stock' : 'Back in stock'
}

/* Open watches first — those are the live promises — then most recently asked. A
   closed one is a record and belongs underneath. */
export function orderWatches(watches: readonly Watch[]): Watch[] {
  return [...watches].sort((a, b) =>
    Number(isOpen(b)) - Number(isOpen(a)) ||
    b.since.localeCompare(a.since) ||
    a.id.localeCompare(b.id))
}

/** The same promise the basket makes about saved items, for the same reason. */
export const WATCH_CAVEAT = 'An alert never reserves stock or holds a price.'

/** Where to send it, defaulted from the profile but overridable per watch. */
export function defaultAddressFor(
  channel: Channel,
  profile: { email?: string | null; msisdn?: string | null },
): string {
  return (channel === 'SMS' ? profile.msisdn : profile.email) ?? ''
}

export function validateDestination(channel: Channel, to: string): string | null {
  const v = to.trim()
  if (!v) return channel === 'SMS' ? 'Enter a mobile number.' : 'Enter an email address.'
  if (channel === 'Email' && !v.includes('@')) return 'That does not look like an email address.'
  if (channel === 'SMS' && !/[0-9]{6,}/.test(v.replace(/\s/g, ''))) return 'That does not look like a mobile number.'
  return null
}

/* ------------------------------------------------------- operator demand */

export interface Demand {
  productId: string
  waiting: number
}

/**
 * How many people are waiting on each product, open watches only. This is the
 * reorder signal — a product nobody is waiting for and a product twelve people are
 * waiting for should not look the same on the inventory screen.
 */
export function demandByProduct(watches: readonly Watch[]): Demand[] {
  const counts = new Map<string, number>()
  for (const w of watches) {
    if (!isOpen(w)) continue
    counts.set(w.product_id, (counts.get(w.product_id) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([productId, waiting]) => ({ productId, waiting }))
    .sort((a, b) => b.waiting - a.waiting || a.productId.localeCompare(b.productId))
}
