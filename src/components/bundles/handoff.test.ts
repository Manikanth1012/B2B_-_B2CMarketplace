import { describe, it, expect } from 'vitest'
import { registerBundleSink, sendBundleTo, hasBundleSink } from './handoff'

describe('bundle handoff', () => {
  it('says it is not available until a sink registers, then uses it', async () => {
    expect(hasBundleSink('basket')).toBe(false)
    expect(await sendBundleTo('basket', 's1')).toEqual({ ok: false, error: 'Adding a bundle to your basket is not available yet.' })
    const seen: [string, string | undefined][] = []
    const off = registerBundleSink('basket', async (id, replace) => { seen.push([id, replace]); return { ok: true } })
    expect(hasBundleSink('basket')).toBe(true)
    expect(await sendBundleTo('basket', 's2', 'old')).toEqual({ ok: true })
    expect(seen).toEqual([['s2', 'old']])
    off()
    expect(hasBundleSink('basket')).toBe(false)
  })

  it('turns a throwing sink into a sentence, and an old unregister leaves a newer sink', async () => {
    const offOld = registerBundleSink('requisition', async () => { throw new Error('boom') })
    expect(await sendBundleTo('requisition', 's')).toEqual({ ok: false, error: 'boom' })
    const offNew = registerBundleSink('requisition', async () => ({ ok: true }))
    offOld()
    expect(hasBundleSink('requisition')).toBe(true)
    offNew()
  })
})
