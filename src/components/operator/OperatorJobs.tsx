import { useEffect, useState } from 'react'
import { BentoCard } from '../ui/BentoCard'
import { StatusBadge } from '../ui/StatusBadge'
import { EmptyState } from './shared'
import { loadJobLog } from '../../lib/jobLogRepo'
import { nights, health, shortDate, utcTime } from '../../lib/jobLog'
import type { JobLogRow } from '../../lib/jobLog'

/* The nightly run, on screen. Read-only: the app cannot start the night, so the
   footnote says how to do it by hand. Times are UTC, the clock the schedule keeps. */

const duration = (ms: number | null) => (ms === null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

export function OperatorJobs() {
  const [rows, setRows] = useState<JobLogRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    loadJobLog().then(r => {
      if (!live) return
      if (r.ok) setRows(r.value); else setError(r.error)
    })
    return () => { live = false }
  }, [])

  const h = rows ? health(rows, new Date()) : null
  const list = rows ? nights(rows).slice(0, 14) : []

  return (
    <div className="op-jobs">
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Scheduled jobs</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          What the nightly run did, last 14 nights. All times are UTC.
        </p>
      </div>

      {error && <div role="alert" className="op-jobs__error">The job log could not be read: {error}</div>}
      {!error && !rows && <p role="status" className="op-jobs__note">Loading the job log…</p>}

      {h && (
        <p className="op-jobs__health" role="status">
          <StatusBadge tone={h.tone}>{h.tone === 'success' ? 'Healthy' : h.tone === 'warning' ? 'Needs a look' : 'Not running'}</StatusBadge>
          <span>{h.says}</span>
        </p>
      )}

      {rows && list.length === 0 && <EmptyState message="No nightly run has been recorded yet." />}

      {list.map(n => (
        <BentoCard key={n.ranOn} as="article" headingLevel={2} title={`${shortDate(n.ranOn)} · ran at ${utcTime(n.startedAt)} UTC`}>
          <ul className="op-jobs__list">
            {n.jobs.map(j => (
              <li key={j.job} className="op-jobs__row">
                <span className="op-jobs__name">{j.job}</span>
                <StatusBadge tone={j.ok ? 'success' : 'danger'}>{j.ok ? 'OK' : 'Failed'}</StatusBadge>
                <span className="op-jobs__ms">{duration(j.ms)}</span>
                <span className="op-jobs__summary">{j.ok ? j.summary : (j.error ?? 'Failed')}</span>
              </li>
            ))}
          </ul>
        </BentoCard>
      ))}

      <p className="op-jobs__note">
        To run the night by hand, use the SQL editor: <code>select public.run_nightly();</code>
      </p>
    </div>
  )
}
