import { describe, expect, it } from 'vitest'
import { nights, health, summarise } from './jobLog'
import type { JobLogRow } from './jobLog'

const row = (job: string, ran_on: string, over: Partial<JobLogRow> = {}): JobLogRow => ({
  id: 1, job, ran_on, started_at: `${ran_on}T00:30:02Z`, finished_at: `${ran_on}T00:30:03.5Z`,
  ok: true, result: null, error: null, ...over,
})

describe('nights', () => {
  it('groups by night, newest first, and keeps the latest row per job', () => {
    const rows = [
      row('a', '2026-11-12', { id: 1 }),
      row('a', '2026-11-13', { id: 2, started_at: '2026-11-13T00:30:00Z' }),
      row('a', '2026-11-13', { id: 3, started_at: '2026-11-13T09:00:00Z', ok: false, error: 'boom' }),
      row('b', '2026-11-13', { id: 4 }),
    ]
    const n = nights(rows)
    expect(n.map(x => x.ranOn)).toEqual(['2026-11-13', '2026-11-12'])
    expect(n[0].jobs.map(j => j.job).sort()).toEqual(['a', 'b'])
    const a = n[0].jobs.find(j => j.job === 'a')!
    expect(a.ok).toBe(false)
    expect(a.error).toBe('boom')
  })
  it('works out milliseconds and survives a missing finish', () => {
    const n = nights([row('a', '2026-11-13'), row('b', '2026-11-13', { finished_at: null })])
    expect(n[0].jobs.find(j => j.job === 'a')!.ms).toBe(1500)
    expect(n[0].jobs.find(j => j.job === 'b')!.ms).toBeNull()
  })
  it('is empty for no rows', () => { expect(nights([])).toEqual([]) })
})

describe('health', () => {
  const now = new Date('2026-11-13T08:00:00Z')
  it('never ran', () => {
    expect(health([], now)).toEqual({ tone: 'danger', says: 'The night has never run' })
  })
  it('stale beyond 26 hours', () => {
    const h = health([row('a', '2026-11-11')], now)
    expect(h.tone).toBe('danger')
    expect(h.says).toBe('The night has not run since 11 Nov')
  })
  it('warns with failures', () => {
    const h = health([row('a', '2026-11-13'), row('b', '2026-11-13', { ok: false, error: 'x' }), row('c', '2026-11-13')], now)
    expect(h).toEqual({ tone: 'warning', says: '1 of 3 jobs failed on 13 Nov' })
  })
  it('succeeds', () => {
    const h = health([row('a', '2026-11-13'), row('b', '2026-11-13')], now)
    expect(h).toEqual({ tone: 'success', says: 'Last night ran at 00:30 UTC on 13 Nov — 2 jobs, all succeeded' })
  })
})

describe('summarise', () => {
  it('says Done for unknown jobs and shapes', () => {
    expect(summarise('mystery', { a: 1 })).toBe('Done')
    expect(summarise('agreements', null)).toBe('Done')
    expect(summarise('agreements', 'x')).toBe('Done')
  })
  it('agreements', () => {
    expect(summarise('agreements', { renewed: [{}, {}], skipped: [{}] })).toBe('2 renewed, 1 skipped')
    expect(summarise('agreements', { renewed: [], skipped: [] })).toBe('Nothing to renew')
  })
  it('enterprise subscriptions', () => {
    expect(summarise('enterprise subscriptions', { renewed: [{}], ended: [{}, {}], waiting: [] })).toBe('1 renewed, 2 ended')
  })
  it('subscriptions', () => {
    expect(summarise('subscriptions', { charged: 3, already: 1, rolled: 0, skipped: [{}], awaiting: [] })).toBe('3 charged, 1 already done, 1 skipped')
  })
  it('documents', () => {
    expect(summarise('documents', { lapsed: [{}, {}] })).toBe('2 documents lapsed')
    expect(summarise('documents', { lapsed: [{}] })).toBe('1 document lapsed')
    expect(summarise('documents', { lapsed: [] })).toBe('No documents lapsed')
  })
  it('settlements', () => {
    expect(summarise('settlements', { closed: [{}], caught_up: [{ settled: 2 }], today: { settled: 3 } }))
      .toBe('3 partners settled, 1 statement closed, 1 month caught up')
    expect(summarise('settlements', { closed: [], caught_up: [], today: { settled: 0 } })).toBe('No partners settled')
  })
  it('payments and bundle selections', () => {
    expect(summarise('payments', { expired: 4 })).toBe('4 stale payments expired')
    expect(summarise('payments', { expired: 0 })).toBe('No stale payments')
    expect(summarise('bundle selections', { deleted: 1 })).toBe('1 unused bundle selection deleted')
    expect(summarise('bundle selections', { deleted: 0 })).toBe('No unused bundle selections')
  })
  it('baskets', () => {
    expect(summarise('baskets', { ran_on: '2026-11-13', flagged: 3, cleared: 2, cleared_baskets: 1, cleared_carts: 1 }))
      .toBe('3 basket lines flagged, 2 untouched baskets cleared')
    expect(summarise('baskets', { flagged: 1, cleared: 0 })).toBe('1 basket line flagged')
    expect(summarise('baskets', { flagged: 0, cleared: 0 })).toBe('No baskets to flag or clear')
    expect(summarise('baskets', {})).toBe('Done')
  })
  it('skips keys that are missing', () => {
    expect(summarise('payments', {})).toBe('Done')
    expect(summarise('enterprise subscriptions', { renewed: [{}] })).toBe('1 renewed')
  })
})
