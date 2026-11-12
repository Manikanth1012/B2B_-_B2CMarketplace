// 20261112600000, checked without a database: the nightly schedule, who may run
// it, and the settlement run's one fix.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync(
  new URL('../../supabase/migrations/20261112600000_renewals_and_settlement_run_every_night.sql', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n')
const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').toLowerCase()

/** The text of one `create or replace function` statement. */
function fn(name: string): string {
  const at = code.indexOf(`create or replace function public.${name}(`)
  expect(at, `${name} is not defined here`).toBeGreaterThanOrEqual(0)
  const rest = code.slice(at)
  const tag = rest.includes('as $function$') && rest.indexOf('as $function$') < rest.indexOf('as $$') ? '$function$' : '$$'
  const open = rest.indexOf(tag)
  const close = rest.indexOf(tag, open + tag.length)
  return rest.slice(0, close + tag.length)
}

describe('renewals and settlement every night, as a migration', () => {
  it('is one transaction that checks itself last, with a rolled-back dry run of the night', () => {
    expect(code.trim().startsWith('begin;')).toBe(true)
    expect(code.trim().endsWith('commit;')).toBe(true)
    const last = code.slice(code.lastIndexOf('do $$'))
    expect(last).toContain('dry := public.run_nightly(current_date);')
    expect(last).toContain("errcode = 'zz999'")
    expect(last).toContain("exception when sqlstate 'zz999' then")
  })

  it('schedules run_nightly once a night with pg_cron', () => {
    expect(code).toContain('create extension if not exists pg_cron')
    expect(code).toMatch(/cron\.schedule\('nightly-renewals-and-settlement', '30 0 \* \* \*',\s+\$cron\$select public\.run_nightly\(\)\$cron\$\)/)
  })

  it('recognises the scheduler by session user and no sign-in, never through the API', () => {
    const body = fn('is_scheduler')
    expect(body).toContain('auth.uid() is null')
    expect(body).toContain("session_user::text in ('postgres', 'supabase_admin')")
    expect(body).not.toContain('authenticator')
  })

  it('lets the scheduler or the operator into every entry point, and nobody else', () => {
    for (const name of ['run_settlements_core', 'renew_subscriptions', 'renew_contract',
                        'renew_enterprise_subscriptions', 'auto_renew_contracts', 'run_nightly']) {
      expect(fn(name), name).toMatch(/if public\.current_persona\(\) is distinct from 'operator' and not public\.is_scheduler\(\) then\s+raise exception/)
    }
  })

  it('keeps the new jobs off the API', () => {
    for (const sig of ['renew_enterprise_subscriptions(date, text)', 'auto_renew_contracts(date, text)', 'run_nightly(date)']) {
      expect(code).toContain(`revoke all on function public.${sig} from public, anon, authenticated;`)
    }
  })

  it('names the run counts through the block label, so they are no longer ambiguous', () => {
    const body = fn('run_settlements_core')
    expect(body).toMatch(/as \$function\$\n<<core>>\ndeclare/)
    expect(body).toContain('set considered = core.considered, settled = core.settled, skipped = skips,')
    expect(body).not.toMatch(/set considered = considered/)
  })

  it('runs agreements before the subscriptions that need one, each job on its own', () => {
    const body = fn('run_nightly')
    expect(body).toContain("array['agreements', 'enterprise subscriptions', 'subscriptions', 'settlements']")
    expect(body).toMatch(/begin\s+res := case j[\s\S]*exception when others then\s+err :=/)
    expect(body).toContain('insert into public.scheduled_job_log')
  })

  it('renews an enterprise subscription only under an agreement in force, and ends the ones that do not renew', () => {
    const body = fn('renew_enterprise_subscriptions')
    expect(body).toContain('public.contract_in_force(s.account_id) is null')
    expect(body).toContain("(not auto_renew or status = 'suspended')")
    expect(body).toContain("set status = 'cancelled'")
    expect(body).toContain("interval '1 year'")
  })

  it('renews an agreement once its notice deadline passes, from the day after it ends, through renew_contract', () => {
    const body = fn('auto_renew_contracts')
    expect(body).toContain('p_as_of >= ends_on - notice_days')
    expect(body).toContain('s_on := c.ends_on + 1;')
    expect(body).toContain('public.renew_contract(')
  })
})
