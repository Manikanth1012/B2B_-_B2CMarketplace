// 20261112700000, checked without a database: the demo catches up with the
// calendar, and two jobs join the night so it does not fall behind again.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync(
  new URL('../../supabase/migrations/20261112700000_the_demo_catches_up_with_the_calendar.sql', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n')
const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').toLowerCase()

function fn(name: string): string {
  const at = code.indexOf(`create or replace function public.${name}(`)
  expect(at, `${name} is not defined here`).toBeGreaterThanOrEqual(0)
  const rest = code.slice(at)
  const open = rest.indexOf('$$')
  return rest.slice(0, rest.indexOf('$$', open + 2) + 2)
}

describe('the demo catches up with the calendar, as a migration', () => {
  it('is one transaction that checks itself last, dry-running the night with five jobs', () => {
    expect(code.trim().startsWith('begin;')).toBe(true)
    expect(code.trim().endsWith('commit;')).toBe(true)
    const last = code.slice(code.lastIndexOf('do $$'))
    expect(last).toContain('dry := public.run_nightly(current_date);')
    expect(last).toContain("jsonb_array_length(dry -> 'jobs') <> 5")
  })

  it('runs documents and the full settlement in the night', () => {
    const body = fn('run_nightly')
    expect(body).toContain("array['agreements', 'enterprise subscriptions', 'subscriptions', 'documents', 'settlements']")
    expect(body).toContain("when 'documents'                then public.lapse_expired_documents(p_as_of)")
    expect(body).toContain("when 'settlements'              then public.settle_to_date(p_as_of)")
  })

  it('closes open statements, then settles every missed month oldest first, then today', () => {
    const body = fn('settle_to_date')
    const close = body.indexOf('public.close_open_statements(p_as_of)')
    const catchUp = body.indexOf("public.run_settlements(me, 'nightly schedule', 'catch-up', null)")
    const today = body.indexOf("public.run_settlements(p_as_of, 'nightly schedule', 'scheduled', null)")
    expect(close).toBeGreaterThan(0)
    expect(catchUp).toBeGreaterThan(close)
    expect(today).toBeGreaterThan(catchUp)
  })

  it('closes a statement the way the run does: reserve out of what is payable, rate at close', () => {
    const body = fn('close_open_statements')
    expect(body).toContain('public.reserve_on(st.partner_id, st.gross, st.net, st.closed_on)')
    expect(body).toContain('f.as_of <= st.closed_on')
    expect(body).toContain("status = 'pending'")
    expect(body).toContain('insert into public.partner_reserve_tranche')
  })

  it('lapses an expired document the way the seed already records one', () => {
    const body = fn('lapse_expired_documents')
    expect(body).toContain("set state = 'submitted'")
    expect(body).toContain("where state = 'accepted' and expires_on < p_as_of")
    expect(body).toContain('renewal requested from the seller')
  })

  it('moves open work forward by the gap, once, and leaves finished work alone', () => {
    expect(code).toMatch(/update public\.refunds\s+set requested\s+= requested \+ 97,\s+sla_due\s+= sla_due \+ 97,\s+escalated_on = escalated_on \+ 97\s+where decided_on is null and requested <= date '2026-08-07';/)
    expect(code).toMatch(/where resolved_on is null and raised <= date '2026-08-07';/)
    expect(code).toMatch(/where status in \('open', 'overdue'\) and asked_on <= date '2026-08-07';/)
    expect(code).not.toMatch(/update public\.(consumer_bills|enterprise_invoices|gl_postings|gl_periods|orders)\b/)
  })

  it('takes a review out of the live set before inserting the one that supersedes it', () => {
    const at = code.indexOf('insert into public.credit_assessment')
    expect(code.lastIndexOf('update public.credit_assessment set superseded_by = a.id where id = a.id;', at)).toBeGreaterThan(0)
    expect(code.indexOf('update public.credit_assessment set superseded_by = new_id where id = a.id;')).toBeGreaterThan(at)
  })

  it('leaves Beacon one cycle late, so the chase list still has a seller on it', () => {
    expect(code).toMatch(/stop := case when vendor = 'ptr-1009'\s+then \(current_date - make_interval\(months => months\)\)::date/)
  })
})
