/* When a screen's code fails to load, the usual cause is a deploy: the page
 * still names the old hashed files and the server no longer has them. One
 * reload fetches the new names and fixes it. A second failure straight after
 * means the reload did not help (offline, server down), and reloading again
 * would only loop, so the error boundary's message is left to say so.
 *
 * The guard is a timestamp rather than a flag, so a tab left open across two
 * deploys an hour apart still gets its one reload the second time. */

export const CHUNK_RELOAD_KEY = 'aventa:chunk-reload-at'
export const CHUNK_RELOAD_WINDOW_MS = 10_000

/** Whether to reload, given when this tab last reloaded for a chunk failure. */
export function shouldReloadForChunkError(lastReloadAt: number | null, now: number): boolean {
  if (lastReloadAt === null || !Number.isFinite(lastReloadAt)) return true
  return now - lastReloadAt > CHUNK_RELOAD_WINDOW_MS || now < lastReloadAt
}

type Store = Pick<Storage, 'getItem' | 'setItem'>

/** Reads and records the guard. Storage that cannot be read or written (a
 *  private window, blocked site data) answers "do not reload": without a
 *  record of the last attempt there is no way to stop a loop. */
export function claimChunkReload(store: Store | null | undefined, now: number): boolean {
  try {
    if (!store) return false
    const raw = store.getItem(CHUNK_RELOAD_KEY)
    const last = raw === null ? null : Number(raw)
    if (!shouldReloadForChunkError(last, now)) return false
    store.setItem(CHUNK_RELOAD_KEY, String(now))
    return true
  } catch {
    return false
  }
}
