/* Touches the live Supabase project. Reads only.
 *
 * The night runs at 00:30 UTC (pg_cron, `run_nightly`). This checks that it did,
 * that every job in it succeeded, and that nothing it is there to handle has
 * been left behind: a subscription past a renewal date it should have moved, one
 * that should have ended and is still running, an agreement past its notice
 * deadline with auto-renew on and no renewal recorded.
 *
 * A day's grace throughout, because the run is at 00:30 UTC and a test can run
 * in the half hour before it.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { signIn, signOut } from './authRepo'
import { supabase } from './supabase'

const DAY = 86_400_000
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const YESTERDAY = iso(Date.now() - DAY)
const TODAY = iso(Date.now())

type Contract = { id: string; account_id: string; state: string; starts_on: string; ends_on: string;
                  auto_renew: boolean; notice_days: number; superseded_by: string | null }
let contracts: Contract[] = []

beforeAll(async () => {
  await signIn('anika.sharma@aventa.com', 'operator123')
  const { data, error } = await supabase.from('enterprise_contract')
    .select('id, account_id, state, starts_on, ends_on, auto_renew, notice_days, superseded_by')
  expect(error).toBeNull()
  contracts = (data ?? []) as Contract[]
}, 30000)
afterAll(async () => { await signOut() }, 30000)

const inForce = (account: string) => contracts.some(c =>
  c.account_id === account && c.state === 'active' && c.starts_on <= TODAY && TODAY <= c.ends_on)

describe('the night', () => {
  it('ran in the last day and a bit, and every job in it succeeded', async () => {
    const since = new Date(Date.now() - 26 * 3600_000).toISOString()
    const { data, error } = await supabase.from('scheduled_job_log')
      .select('job, ran_on, ok, error, started_at').gte('started_at', since).order('started_at', { ascending: false })
    expect(error).toBeNull()
    const rows = (data ?? []) as { job: string; ok: boolean; error: string | null }[]
    const latest = new Map<string, { ok: boolean; error: string | null }>()
    for (const r of rows) if (!latest.has(r.job)) latest.set(r.job, r)
    expect([...latest.keys()].sort(), 'the night has not run, or ran only some of its jobs')
      .toEqual(['agreements', 'enterprise subscriptions', 'settlements', 'subscriptions'])
    for (const [job, r] of latest) expect(r.ok, `${job} failed: ${r.error}`).toBe(true)
  })

  it('leaves no auto-renewing enterprise subscription behind its date', async () => {
    const { data } = await supabase.from('enterprise_subscriptions')
      .select('id, account_id, renews').eq('status', 'active').eq('auto_renew', true).lt('renews', YESTERDAY)
    const late = (data ?? []).filter(s => inForce(s.account_id)).map(s => `${s.id} renews ${s.renews}`)
    expect(late).toEqual([])
  })

  it('ends an enterprise subscription that was not going to renew once its date has gone', async () => {
    const { data } = await supabase.from('enterprise_subscriptions')
      .select('id, status, auto_renew, renews').in('status', ['active', 'suspended']).lt('renews', YESTERDAY)
    const running = (data ?? []).filter(s => !s.auto_renew || s.status === 'suspended')
      .map(s => `${s.id} (${s.status}) ran to ${s.renews}`)
    expect(running).toEqual([])
  })

  it('records the renewal of every agreement whose notice deadline has passed with auto-renew on', () => {
    const deadline = (c: Contract) => iso(Date.parse(`${c.ends_on}T00:00:00Z`) - c.notice_days * DAY)
    const missed = contracts
      .filter(c => c.state === 'active' && c.auto_renew && !c.superseded_by && deadline(c) < YESTERDAY)
      .map(c => `${c.id} (notice deadline ${deadline(c)})`)
    expect(missed).toEqual([])
  })
})
