/** Index to focus after Tab (shift=false) or Shift+Tab (shift=true) from
 *  `current` among `count` focusable elements; wraps at both ends.
 *  current = -1 means focus is outside the list. count = 0 → -1. */
export function nextFocusIndex(current: number, count: number, shift: boolean): number {
  if (count <= 0) return -1
  if (current < 0 || current >= count) return shift ? count - 1 : 0
  return shift ? (current - 1 + count) % count : (current + 1) % count
}
