/* Carousel state, pure. No React, no timers — the component owns those, so
   the rules can be tested without a DOM. */

export interface CarouselState {
  index: number
  count: number
  paused: boolean
}

/* Six seconds. Long enough to read a slide; short enough that a visitor sees
   more than one. */
export const SLIDE_MS = 6000

export function nextIndex(s: CarouselState): number {
  if (s.count <= 0) return 0
  return (s.index + 1) % s.count
}

export function prevIndex(s: CarouselState): number {
  if (s.count <= 0) return 0
  return (s.index - 1 + s.count) % s.count
}

/* Auto-advance is refused outright under reduced motion, not merely made
   faster. Motion a person cannot stop is the accessibility failure carousels
   are known for; they can still use the arrows and dots. */
export function shouldAdvance(s: CarouselState, reducedMotion: boolean): boolean {
  if (reducedMotion) return false
  if (s.paused) return false
  return s.count > 1
}
