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

/* ------------------------------------------------------------- captions --- */

/**
 * A slide: a picture and the two or three words it is there to say.
 *
 * The paths come from `assets.ts`, which is generated from the files in
 * `images/` — so the captions cannot live there or the next `npm run assets`
 * would erase them. They are editorial, they are written by hand, and this is
 * where they are kept.
 */
export interface Slide {
  src: string
  /* Two or three words. Any more and it is read after the slide has moved on. */
  caption: string
}

/**
 * What each picture is for.
 *
 * A value proposition rather than a label: "Live in minutes" is a reason to
 * buy here, "Mobile plans" is a category heading the page already has three of.
 */
export const CAPTIONS: readonly string[] = [
  'Live in minutes',
  'Entertainment, bundled',
  'Fleets, connected',
  'Security, built in',
  'One checkout',
]

/**
 * Pair the pictures with the captions.
 *
 * Tolerant of the two lists disagreeing, because one of them is generated:
 * dropping an image into `images/` and re-running the build adds a slide here
 * with no caption written for it, and that slide should still appear rather
 * than the page throwing or the picture silently vanishing.
 */
export function withCaptions(
  srcs: readonly string[], captions: readonly string[] = CAPTIONS,
): Slide[] {
  return srcs.map((src, i) => ({ src, caption: captions[i] ?? '' }))
}
