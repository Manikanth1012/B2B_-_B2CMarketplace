/* The rules the media step prints beside itself. They were printed and not
   applied — these are the assertions that make them true. */
import { describe, it, expect } from 'vitest'
import {
  MIN_EDGE, MAX_IMAGES, MAX_VIDEOS, IMAGE_MAX_BYTES, VIDEO_MAX_BYTES,
  kindOf, validateAddition, validateDimensions, safeName, mediaPath,
  roleFor, mediaOutstanding, ordered,
} from './listingMedia'
import type { MediaItem } from './listingMedia'

const img = (over: Partial<MediaItem> = {}): MediaItem => ({
  path: 'PTR-1004/LST-1/01-front.jpg', url: 'https://x/01-front.jpg',
  kind: 'image', name: 'front.jpg', bytes: 900_000, alt: 'The sensor, front on', ...over,
})
const vid = (over: Partial<MediaItem> = {}): MediaItem =>
  img({ kind: 'video', name: 'demo.mp4', path: 'PTR-1004/LST-1/07-demo.mp4', alt: 'Fitting it to a wall', ...over })

const file = (over: Partial<{ name: string; type: string; size: number }> = {}) => ({
  name: 'front.jpg', type: 'image/jpeg', size: 900_000, ...over,
})

describe('what may be attached', () => {
  it('knows an image from a video and refuses anything else', () => {
    expect(kindOf('image/png')).toBe('image')
    expect(kindOf('video/mp4')).toBe('video')
    expect(kindOf('application/pdf')).toBeNull()
    expect(kindOf('')).toBeNull()
  })

  it('refuses a type the bucket would not take, naming it', () => {
    const r = validateAddition(file({ name: 'spec.pdf', type: 'application/pdf' }), [])
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.reason).toContain('spec.pdf')
      expect(r.reason).toMatch(/JPEG, PNG or WebP/)
    }
  })

  it('says what a file with no type at all is', () => {
    const r = validateAddition(file({ type: '' }), [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/unknown type/)
  })

  it('holds images to 5 MB and says the size in the refusal', () => {
    expect(validateAddition(file({ size: IMAGE_MAX_BYTES }), []).ok).toBe(true)
    const r = validateAddition(file({ size: IMAGE_MAX_BYTES + 1 }), [])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/5\.0 MB/)
  })

  it('holds video to its own larger limit rather than the image one', () => {
    const big = file({ name: 'demo.mp4', type: 'video/mp4', size: 20 * 1024 * 1024 })
    /* Well over the image limit, and fine — the two limits are different
       numbers and a shared one would refuse every video worth having. */
    expect(validateAddition(big, []).ok).toBe(true)
    expect(validateAddition({ ...big, size: VIDEO_MAX_BYTES + 1 }, []).ok).toBe(false)
  })

  it('refuses an empty file', () => {
    expect(validateAddition(file({ size: 0 }), []).ok).toBe(false)
  })

  it('stops at six images, and counts only images', () => {
    const six = Array.from({ length: MAX_IMAGES }, (_, i) => img({ path: `p${i}` }))
    const r = validateAddition(file(), six)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/more than 6 images/)

    /* A video alongside six images is still allowed — the limits are separate. */
    expect(validateAddition(file({ name: 'demo.mp4', type: 'video/mp4' }), six).ok).toBe(true)
  })

  it('stops at one video, and counts only videos', () => {
    const have = [img(), vid()]
    const r = validateAddition(file({ name: 'other.mp4', type: 'video/mp4' }), have)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/one video/)
    expect(MAX_VIDEOS).toBe(1)
    /* And another image is still fine. */
    expect(validateAddition(file(), have).ok).toBe(true)
  })
})

describe('how big the picture has to be', () => {
  it('measures the shorter edge, not the longer one', () => {
    /* The rule this exists for: a wide banner clears an 800px test written
       against the longest side and is useless as a product photograph. */
    expect(validateDimensions('banner.jpg', 2000, 400).ok).toBe(false)
    expect(validateDimensions('square.jpg', MIN_EDGE, MIN_EDGE).ok).toBe(true)
    expect(validateDimensions('tall.jpg', 800, 2000).ok).toBe(true)
  })

  it('is inclusive at the limit', () => {
    expect(validateDimensions('a.jpg', MIN_EDGE, MIN_EDGE).ok).toBe(true)
    expect(validateDimensions('a.jpg', MIN_EDGE - 1, MIN_EDGE).ok).toBe(false)
  })

  it('says the size it found, so the seller can check their file', () => {
    const r = validateDimensions('small.png', 640, 480)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toContain('640×480')
  })
})

describe('naming and placing the file', () => {
  it('keeps enough of the name to be recognisable', () => {
    expect(safeName('Front view.JPG')).toBe('front-view.jpg')
    expect(safeName('sensor_(2).png')).toBe('sensor-2.png')
  })

  it('survives a name that is all punctuation', () => {
    expect(safeName('###.png')).toBe('file.png')
    expect(safeName('.hidden')).toBe('hidden')
  })

  it('does not run away with a very long name', () => {
    const out = safeName(`${'a'.repeat(300)}.jpeg`)
    expect(out.length).toBeLessThan(60)
    expect(out.endsWith('.jpeg')).toBe(true)
  })

  it('puts the partner id first, because that is what the storage policy reads', () => {
    const path = mediaPath('PTR-1004', 'LST-abc', 1, 'Front view.jpg')
    expect(path.split('/')[0]).toBe('PTR-1004')
    expect(path).toBe('PTR-1004/LST-abc/01-front-view.jpg')
  })

  it('pads the index so the order survives being sorted as text', () => {
    const paths = [1, 2, 10].map(n => mediaPath('P', 'D', n, 'a.jpg'))
    expect([...paths].sort()).toEqual(paths)
  })
})

describe('what each one becomes on the product', () => {
  it('makes the first image the hero and the rest gallery', () => {
    expect(roleFor(img(), 0)).toBe('hero')
    expect(roleFor(img(), 1)).toBe('gallery')
    expect(roleFor(img(), 5)).toBe('gallery')
  })

  it('makes a video a video wherever it sits', () => {
    expect(roleFor(vid(), 0)).toBe('video')
    expect(roleFor(vid(), 3)).toBe('video')
  })

  it('orders images first so the hero is a photograph, never the video', () => {
    const out = ordered([vid(), img({ path: 'a' }), img({ path: 'b' })])
    expect(out.map(m => m.kind)).toEqual(['image', 'image', 'video'])
    expect(roleFor(out[0], 0)).toBe('hero')
  })
})

describe('what is still missing', () => {
  it('is nothing once there is a described photograph', () => {
    expect(mediaOutstanding([img()])).toEqual([])
  })

  it('asks for a photograph when there is none', () => {
    expect(mediaOutstanding([])).toEqual(['at least one photograph'])
  })

  it('does not count a video as the photograph', () => {
    /* A listing whose only media is a video has no card image. */
    expect(mediaOutstanding([vid()])).toContain('at least one photograph')
  })

  it('asks for the descriptions that are missing, and counts them', () => {
    const out = mediaOutstanding([img(), img({ path: 'b', alt: '' }), img({ path: 'c', alt: '   ' })])
    expect(out).toEqual(['descriptions of 2 of them'])
  })

  it('reads singular for one', () => {
    expect(mediaOutstanding([img({ alt: '' })])).toContain('a description of one of them')
  })
})
