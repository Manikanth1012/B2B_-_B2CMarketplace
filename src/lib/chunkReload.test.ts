import { describe, expect, it } from 'vitest'
import { CHUNK_RELOAD_KEY, CHUNK_RELOAD_WINDOW_MS, claimChunkReload, shouldReloadForChunkError } from './chunkReload'

function memory(initial: Record<string, string> = {}) {
  const data = { ...initial }
  return {
    data,
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => { data[k] = v },
  }
}

describe('shouldReloadForChunkError', () => {
  it('reloads when this tab has not reloaded for a chunk before', () => {
    expect(shouldReloadForChunkError(null, 1_000)).toBe(true)
  })
  it('does not reload again straight after a reload, so a dead network cannot loop', () => {
    expect(shouldReloadForChunkError(1_000, 1_000 + CHUNK_RELOAD_WINDOW_MS)).toBe(false)
  })
  it('reloads again for a later deploy, once the window has passed', () => {
    expect(shouldReloadForChunkError(1_000, 1_001 + CHUNK_RELOAD_WINDOW_MS)).toBe(true)
  })
  it('treats an unreadable or future record as no record', () => {
    expect(shouldReloadForChunkError(Number.NaN, 5)).toBe(true)
    expect(shouldReloadForChunkError(10_000, 5)).toBe(true)
  })
})

describe('claimChunkReload', () => {
  it('records the attempt and says reload the first time, not the second', () => {
    const s = memory()
    expect(claimChunkReload(s, 50_000)).toBe(true)
    expect(s.data[CHUNK_RELOAD_KEY]).toBe('50000')
    expect(claimChunkReload(s, 51_000)).toBe(false)
  })
  it('does not reload when storage is missing or throws', () => {
    expect(claimChunkReload(null, 1)).toBe(false)
    const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => {} }
    expect(claimChunkReload(broken, 1)).toBe(false)
    const readOnly = { getItem: () => null, setItem: () => { throw new Error('quota') } }
    expect(claimChunkReload(readOnly, 1)).toBe(false)
  })
})
