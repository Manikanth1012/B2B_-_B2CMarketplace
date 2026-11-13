/* What the nightly run did, read from scheduled_job_log. Pure: no database here.
 *
 * run_nightly writes one row per job per night. These functions group them into
 * nights, say whether the night is healthy, and put each job's `result` into a
 * line. `result` shapes belong to the SQL functions and are not a contract, so
 * every key is read defensively: a missing or oddly-typed key is left out of the
 * sentence, and a job nobody wrote a sentence for is "Done". */

export interface JobLogRow {
  id: number
  job: string
  ran_on: string
  started_at: string
  finished_at: string | null
  ok: boolean
  result: unknown
  error: string | null
}

export interface JobRun { job: string; ok: boolean; ms: number | null; summary: string; error: string | null }
export interface Night { ranOn: string; startedAt: string; jobs: JobRun[] }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-11-13' (or a timestamp) → '13 Nov'. */
export function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (!m) return iso
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? ''}`.trim()
}

/** '2026-11-13T00:30:02Z' → '00:30' in UTC. */
export function utcTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toISOString().slice(11, 16)
}

const time = (iso: string) => { const t = new Date(iso).getTime(); return Number.isNaN(t) ? 0 : t }

export function nights(rows: JobLogRow[]): Night[] {
  const byNight = new Map<string, Map<string, JobLogRow>>()
  for (const r of rows) {
    const n = byNight.get(r.ran_on) ?? new Map<string, JobLogRow>()
    const was = n.get(r.job)
    if (!was || time(r.started_at) >= time(was.started_at)) n.set(r.job, r)
    byNight.set(r.ran_on, n)
  }
  return [...byNight.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : a[0] > b[0] ? -1 : 0))
    .map(([ranOn, jobs]) => {
      const list = [...jobs.values()].sort((a, b) => time(a.started_at) - time(b.started_at) || a.id - b.id)
      return {
        ranOn,
        startedAt: list.reduce((m, r) => (time(r.started_at) < time(m) ? r.started_at : m), list[0].started_at),
        jobs: list.map(r => ({
          job: r.job,
          ok: r.ok,
          ms: r.finished_at ? Math.max(0, time(r.finished_at) - time(r.started_at)) : null,
          summary: summarise(r.job, r.result),
          error: r.error,
        })),
      }
    })
}

const STALE_MS = 26 * 60 * 60 * 1000

export function health(rows: JobLogRow[], now: Date): { tone: 'success' | 'warning' | 'danger'; says: string } {
  if (rows.length === 0) return { tone: 'danger', says: 'The night has never run' }
  const newest = rows.reduce((m, r) => (time(r.started_at) > time(m.started_at) ? r : m), rows[0])
  if (now.getTime() - time(newest.started_at) > STALE_MS) {
    return { tone: 'danger', says: `The night has not run since ${shortDate(newest.ran_on)}` }
  }
  const last = nights(rows)[0]
  const failed = last.jobs.filter(j => !j.ok).length
  if (failed > 0) return { tone: 'warning', says: `${failed} of ${last.jobs.length} jobs failed on ${shortDate(last.ranOn)}` }
  return {
    tone: 'success',
    says: `Last night ran at ${utcTime(last.startedAt)} UTC on ${shortDate(last.ranOn)} — ${last.jobs.length} jobs, all succeeded`,
  }
}

/* ------------------------------------------------------------ summaries -- */

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** A count from an array (its length) or a number; null when the key is absent or another type. */
const count = (o: Record<string, unknown>, key: string): number | null => {
  const v = o[key]
  if (Array.isArray(v)) return v.length
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

const join = (parts: (string | null)[], none: string) => {
  const p = parts.filter((x): x is string => x !== null)
  return p.length === 0 ? 'Done' : p.every(x => x.startsWith('0 ')) ? none : p.filter(x => !x.startsWith('0 ')).join(', ')
}

export function summarise(job: string, result: unknown): string {
  const o = obj(result)
  if (!o) return 'Done'
  const c = (k: string, label: (n: number) => string) => { const n = count(o, k); return n === null ? null : label(n) }
  switch (job) {
    case 'agreements':
      return join([c('renewed', n => `${n} renewed`), c('skipped', n => `${n} skipped`)], 'Nothing to renew')
    case 'enterprise subscriptions':
      return join([c('renewed', n => `${n} renewed`), c('ended', n => `${n} ended`)], 'Nothing to renew')
    case 'subscriptions':
      return join([
        c('charged', n => `${n} charged`), c('already', n => `${n} already done`),
        c('rolled', n => `${n} rolled on`), c('skipped', n => `${n} skipped`),
      ], 'Nothing to renew')
    case 'documents': {
      const n = count(o, 'lapsed')
      return n === null ? 'Done' : n === 0 ? 'No documents lapsed' : `${plural(n, 'document')} lapsed`
    }
    case 'settlements': {
      const today = obj(o.today)
      const settled = today ? count(today, 'settled') : null
      const caught = Array.isArray(o.caught_up) ? o.caught_up.length : null
      const closed = count(o, 'closed')
      const parts = [
        settled === null ? null : `${plural(settled, 'partner')} settled`,
        closed === null ? null : `${plural(closed, 'statement')} closed`,
        caught === null ? null : `${plural(caught, 'month')} caught up`,
      ]
      return join(parts, 'No partners settled')
    }
    case 'payments': {
      const n = count(o, 'expired')
      return n === null ? 'Done' : n === 0 ? 'No stale payments' : `${plural(n, 'stale payment')} expired`
    }
    case 'bundle selections': {
      const n = count(o, 'deleted')
      return n === null ? 'Done' : n === 0 ? 'No unused bundle selections' : `${plural(n, 'unused bundle selection')} deleted`
    }
    case 'baskets':
      return join([
        c('flagged', n => `${plural(n, 'basket line')} flagged`),
        c('cleared', n => `${plural(n, 'untouched basket')} cleared`),
      ], 'No baskets to flag or clear')
    default:
      return 'Done'
  }
}
