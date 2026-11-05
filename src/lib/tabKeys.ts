/** New tab index for a key in a horizontal-or-vertical tablist, or null if
 *  the key is not a tablist key. ArrowRight/ArrowDown next (wrap),
 *  ArrowLeft/ArrowUp previous (wrap), Home 0, End count-1.
 *
 *  Both arrow pairs are accepted whichever way the list is laid out: the
 *  account tabs are a column at desktop width and a row of chips below it,
 *  and the orientation is a CSS decision the keys should not have to know. */
export function tabKeyTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (current + 1) % count
    case 'ArrowLeft':
    case 'ArrowUp':
      return (current - 1 + count) % count
    case 'Home':
      return 0
    case 'End':
      return count - 1
    default:
      return null
  }
}
