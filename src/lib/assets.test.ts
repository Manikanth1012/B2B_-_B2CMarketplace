import { describe, it, expect } from 'vitest'
import { statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { HERO, CAROUSEL, BANNERS, DEVICE_THUMBS, RETAIL_PRODUCTS, ENTERPRISE_PRODUCTS } from './assets'

const onDisk = (p: string) => join('public', p.replace(/^\//, ''))
const all = [HERO, ...CAROUSEL, ...BANNERS, ...DEVICE_THUMBS,
             ...RETAIL_PRODUCTS.map(p => p.src), ...ENTERPRISE_PRODUCTS.map(p => p.src)]

describe('asset manifest', () => {
  it('has the expected counts', () => {
    expect(CAROUSEL).toHaveLength(5)
    expect(BANNERS).toHaveLength(12)
    expect(DEVICE_THUMBS).toHaveLength(42)
    expect(RETAIL_PRODUCTS).toHaveLength(12)
    expect(ENTERPRISE_PRODUCTS).toHaveLength(12)
  })

  it('names only files that exist on disk', () => {
    const missing = all.filter(p => !existsSync(onDisk(p)))
    expect(missing).toEqual([])
  })

  it('ships nothing over 250 KB', () => {
    const heavy = all
      .map(p => ({ p, kb: Math.round(statSync(onDisk(p)).size / 1024) }))
      .filter(x => x.kb > 250)
    expect(heavy).toEqual([])
  })

  it('keeps the whole set under 2 MB', () => {
    const totalKb = all.reduce((n, p) => n + statSync(onDisk(p)).size, 0) / 1024
    expect(Math.round(totalKb)).toBeLessThan(2048)
  })

  it('gives every product tile real alt text, not a truncated filename', () => {
    /* The source filenames are cut mid-word, so a length check alone would
       accept "compact GPS t". Require a whole final word. */
    const bad = [...RETAIL_PRODUCTS, ...ENTERPRISE_PRODUCTS].filter(t => {
      const a = (t.alt || '').trim()
      const lastWord = a.split(' ').pop() ?? ''
      return a.length < 6 || lastWord.length < 3
    })
    expect(bad).toEqual([])
  })

  it('serves everything as WebP', () => {
    expect(all.filter(p => !p.endsWith('.webp'))).toEqual([])
  })
})
