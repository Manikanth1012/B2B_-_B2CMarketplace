import { useEffect, useMemo, useState } from 'react'
import { BentoCard } from '../ui/BentoCard'
import { StatusBadge } from '../ui/StatusBadge'
import { Btn, DateRangeFilter, EmptyState, FilterBar, PageHeader, Select } from './shared'
import { loadJobLog } from '../../lib/jobLogRepo'
import { ALL_JOBS, DEFAULT_NIGHTS, JOB_LOG_LIMIT, JOB_NAMES, filterNights, filterSummary, nights, health, shortDate, utcTime } from '../../lib/jobLog'
import type { JobFilters, JobLogRow } from '../../lib/jobLog'

/* The nightly run, on screen. Read-only: the app cannot start the night, so the
   footnote says how to do it by hand. Times are UTC, the clock the schedule keeps.
   The filters narrow the list below; the health line is always about the latest night. */

const duration = (ms: number | null) => (ms === null ? '—' : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

/* No bounds: the screen shows the newest 14 nights the log holds, however long ago
   the newest was, so it agrees with the health line. Quick picks count back from
   that newest night (ran_on is a UTC date, the clock this screen keeps). */
const defaults = (): JobFilters => ({ from: '', to: '', job: ALL_JOBS, status: 'all' })

export function OperatorJobs() {
  const [rows, setRows] = useState<JobLogRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filters, setFilters] = useState<JobFilters>(defaults)

  useEffect(() => {
    let live = true
    loadJobLog().then(r => {
      if (!live) return
      if (r.ok) setRows(r.value); else setError(r.error)
    })
    return () => { live = false }
  }, [])

  const h = rows ? health(rows, new Date()) : null
  const all = useMemo(() => (rows ? nights(rows) : []), [rows])
  const matched = useMemo(() => filterNights(all, filters), [all, filters])
  const bounded = filters.from !== '' || filters.to !== ''
  const list = bounded ? matched : matched.slice(0, DEFAULT_NIGHTS)
  const newest = all[0]?.ranOn
  const capped = (rows?.length ?? 0) >= JOB_LOG_LIMIT
  const jobNames = useMemo(() => {
    const extra = [...new Set((rows ?? []).map(r => r.job))].filter(j => !(JOB_NAMES as readonly string[]).includes(j)).sort()
    return [...JOB_NAMES, ...extra]
  }, [rows])
  const set = (patch: Partial<JobFilters>) => setFilters(f => ({ ...f, ...patch }))

  return (
    <div className="op-jobs">
      <PageHeader title="Scheduled jobs"
        description="What the nightly run did. The log keeps up to 90 days; filter to look back. All times are UTC." />

      {error && <div role="alert" className="op-jobs__error">The job log could not be read: {error}</div>}
      {!error && !rows && <p role="status" className="op-jobs__note">Loading the job log…</p>}

      {h && (
        <p className="op-jobs__health" role="status">
          <StatusBadge tone={h.tone}>{h.tone === 'success' ? 'Healthy' : h.tone === 'warning' ? 'Needs a look' : 'Not running'}</StatusBadge>
          <span>{h.says}</span>
        </p>
      )}

      {rows && all.length > 0 && (
        <FilterBar ariaLabel="Job filters" summary={<>
          {filterSummary(list)}
          {!bounded && matched.length > list.length && ` · the newest ${DEFAULT_NIGHTS} nights; set a date range for more`}
          {capped && ` · the log is capped, showing the newest ${rows?.length} runs`}
        </>}>
          <DateRangeFilter from={filters.from} to={filters.to} onChange={r => set(r)}
            today={newest} quickLabel={n => `${n} nights`} />
          <Select aria-label="Job" value={filters.job} onChange={e => set({ job: e.target.value })}>
            <option value={ALL_JOBS}>All jobs</option>
            {jobNames.map(j => <option key={j} value={j}>{j}</option>)}
          </Select>
          <Select aria-label="Status" value={filters.status}
            onChange={e => set({ status: e.target.value as JobFilters['status'] })}>
            <option value="all">All statuses</option>
            <option value="ok">OK</option>
            <option value="failed">Failed</option>
          </Select>
        </FilterBar>
      )}

      {rows && all.length === 0 && <EmptyState message="No nightly run has been recorded yet." />}
      {rows && all.length > 0 && list.length === 0 && (
        <EmptyState message="No runs match these filters."
          action={<Btn variant="secondary" onClick={() => setFilters(defaults())}>Clear filters</Btn>} />
      )}

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
