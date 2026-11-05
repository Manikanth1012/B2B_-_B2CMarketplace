/** A read that either worked or says why not. The older loaders swallow errors
 *  and hand back an empty map, which a shop cannot tell from "nothing priced". */
export type Loaded<T> = { ok: true; value: T } | { ok: false; error: string }

/** Pure: an error wins; no data and no error is a genuine empty read. */
export function settle<T>(data: T | null, error: { message: string } | null, empty: T): Loaded<T> {
  if (error) return { ok: false, error: error.message }
  return { ok: true, value: data ?? empty }
}
