/* The template name of each bundle a list of order lines carries, for the
 * grouped heading. Lines with no bundle ask nothing of the database, so a
 * screen with none (or before the bundles migration) behaves as it did. A
 * selection the reader cannot see is named generically. */
import { useEffect, useState } from 'react'
import { loadBundleInfo } from '../../lib/bundleBasketRepo'
import { bundleIdsOf, BUNDLE_FALLBACK_NAME } from '../../lib/bundleLines'

export function useBundleNames(lines: readonly { bundle_selection_id?: string | null }[]): (id: string) => string {
  const key = bundleIdsOf(lines).join(',')
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!key) return
    let live = true
    void loadBundleInfo(key.split(',')).then(r => {
      if (!live || !r.ok) return
      setNames(Object.fromEntries([...r.value].map(([id, b]) => [id, b.name])))
    })
    return () => { live = false }
  }, [key])
  return (id: string) => names[id] ?? BUNDLE_FALLBACK_NAME
}
