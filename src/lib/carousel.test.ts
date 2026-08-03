import { describe, it, expect } from 'vitest'
import { nextIndex, prevIndex, shouldAdvance, SLIDE_MS, withCaptions, CAPTIONS } from './carousel'
import { CAROUSEL } from './assets'

const s = (index: number, count = 5, paused = false) => ({ index, count, paused })

describe('nextIndex', () => {
  it('advances', () => expect(nextIndex(s(0))).toBe(1))
  it('wraps at the end', () => expect(nextIndex(s(4))).toBe(0))
  it('handles a single slide', () => expect(nextIndex(s(0, 1))).toBe(0))
  it('returns 0 for an empty set rather than NaN', () => expect(nextIndex(s(0, 0))).toBe(0))
})

describe('prevIndex', () => {
  it('goes back', () => expect(prevIndex(s(2))).toBe(1))
  it('wraps at the start', () => expect(prevIndex(s(0))).toBe(4))
  it('returns 0 for an empty set', () => expect(prevIndex(s(0, 0))).toBe(0))
})

describe('shouldAdvance', () => {
  it('advances when running and motion is allowed', () => {
    expect(shouldAdvance(s(0), false)).toBe(true)
  })

  it('does not advance while paused — someone is reading the slide', () => {
    expect(shouldAdvance(s(0, 5, true), false)).toBe(false)
  })

  it('does not advance under reduced motion, even when unpaused', () => {
    expect(shouldAdvance(s(0), true)).toBe(false)
  })

  it('does not advance with fewer than two slides', () => {
    expect(shouldAdvance(s(0, 1), false)).toBe(false)
  })
})

describe('SLIDE_MS', () => {
  it('is a sane dwell time — long enough to read a slide', () => {
    expect(SLIDE_MS).toBeGreaterThanOrEqual(5000)
  })
})

/* ------------------------------------------------------------- captions --- */

describe('pairing pictures with what they say', () => {
  const srcs = ['a.webp', 'b.webp', 'c.webp']

  it('gives each picture its caption, in order', () => {
    expect(withCaptions(srcs, ['One', 'Two', 'Three'])).toEqual([
      { src: 'a.webp', caption: 'One' },
      { src: 'b.webp', caption: 'Two' },
      { src: 'c.webp', caption: 'Three' },
    ])
  })

  /* `assets.ts` is generated from the files on disk. Dropping a new picture in
     and re-running the build produces a slide nobody has written words for, and
     losing that slide — or throwing — would be a worse answer than showing it
     bare. */
  it('keeps a picture that has no caption written for it', () => {
    const out = withCaptions(srcs, ['One'])
    expect(out).toHaveLength(3)
    expect(out[1]).toEqual({ src: 'b.webp', caption: '' })
  })

  it('ignores captions with no picture to sit on', () => {
    expect(withCaptions(['a.webp'], ['One', 'Two'])).toEqual([{ src: 'a.webp', caption: 'One' }])
  })

  it('is empty when there are no pictures', () => {
    expect(withCaptions([])).toEqual([])
  })
})

describe('the captions themselves', () => {
  it('gives every seeded slide something to say', () => {
    expect(CAPTIONS).toHaveLength(CAROUSEL.length)
    expect(CAPTIONS.every(c => c.trim().length > 0)).toBe(true)
  })

  /* Two or three words. A fourth is read after the slide has moved on, and the
     brief was explicit about it. */
  it('keeps each to three words or fewer', () => {
    const tooLong = CAPTIONS.filter(c => c.split(/\s+/).length > 3)
    expect(tooLong).toEqual([])
  })

  it('says something different on each', () => {
    expect(new Set(CAPTIONS).size).toBe(CAPTIONS.length)
  })
})
