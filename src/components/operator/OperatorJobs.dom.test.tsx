import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { JobLogRow } from '../../lib/jobLog'

vi.mock('../../lib/supabase', () => ({ supabase: {} }))
const load = vi.hoisted(() => vi.fn())
vi.mock('../../lib/jobLogRepo', () => ({ loadJobLog: load }))

import { OperatorJobs } from './OperatorJobs'

const NOW = new Date('2026-11-13T08:00:00Z')
const row = (job: string, over: Partial<JobLogRow> = {}): JobLogRow => ({
  id: Math.floor(Math.random() * 1e9), job, ran_on: '2026-11-13', started_at: '2026-11-13T00:30:01Z',
  finished_at: '2026-11-13T00:30:02Z', ok: true, result: null, error: null, ...over,
})

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { cleanup(); vi.useRealTimers(); load.mockReset() })

describe('OperatorJobs', () => {
  it('says the night is healthy', async () => {
    load.mockResolvedValue({ ok: true, value: [row('agreements', { result: { renewed: [{}], skipped: [] } }), row('payments', { result: { expired: 2 } })] })
    render(<OperatorJobs />)
    expect(await screen.findByText(/Last night ran at 00:30 UTC on 13 Nov — 2 jobs, all succeeded/)).toBeTruthy()
    expect(screen.getByText('1 renewed')).toBeTruthy()
    expect(screen.getByText('2 stale payments expired')).toBeTruthy()
    expect(screen.getByText(/select public\.run_nightly\(\);/)).toBeTruthy()
  })

  it('shows a failed job with its full error', async () => {
    load.mockResolvedValue({ ok: true, value: [row('agreements'), row('settlements', { ok: false, error: 'deadlock detected (40P01)' })] })
    render(<OperatorJobs />)
    expect(await screen.findByText('1 of 2 jobs failed on 13 Nov')).toBeTruthy()
    expect(screen.getByText('deadlock detected (40P01)')).toBeTruthy()
    expect(screen.getByText('Failed')).toBeTruthy()
  })

  it('warns when the night is stale', async () => {
    load.mockResolvedValue({ ok: true, value: [row('agreements', { ran_on: '2026-11-11', started_at: '2026-11-11T00:30:00Z', finished_at: null })] })
    render(<OperatorJobs />)
    expect(await screen.findByText('The night has not run since 11 Nov')).toBeTruthy()
  })

  it('says so when nothing has run', async () => {
    load.mockResolvedValue({ ok: true, value: [] })
    render(<OperatorJobs />)
    expect(await screen.findByText('The night has never run')).toBeTruthy()
    expect(screen.getByText('No nightly run has been recorded yet.')).toBeTruthy()
  })

  it('shows a failed read rather than an empty screen', async () => {
    load.mockResolvedValue({ ok: false, error: 'permission denied' })
    render(<OperatorJobs />)
    expect(await screen.findByRole('alert')).toBeTruthy()
    expect(screen.getByText(/permission denied/)).toBeTruthy()
    expect(screen.queryByText('The night has never run')).toBeNull()
  })
})
