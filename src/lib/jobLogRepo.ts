// The only module that reads scheduled_job_log: what the nightly run did.
// Read-only; an operator can read it under row-level security. A failed read
// says so rather than looking like a night that never ran.

import { supabase } from './supabase'
import { settle } from './loaded'
import type { Loaded } from './loaded'
import type { JobLogRow } from './jobLog'

const DAYS = 15

export async function loadJobLog(now: Date = new Date()): Promise<Loaded<JobLogRow[]>> {
  try {
    const since = new Date(now.getTime() - DAYS * 86_400_000).toISOString().slice(0, 10)
    const { data, error } = await supabase
      .from('scheduled_job_log')
      .select('id, job, ran_on, started_at, finished_at, ok, result, error')
      .gte('ran_on', since)
      .order('started_at', { ascending: false })
      .limit(1000)
    return settle<JobLogRow[]>((data ?? null) as JobLogRow[] | null, error, [])
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The read failed.' }
  }
}
