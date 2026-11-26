// 20261126100000, checked without a database: business subscriptions billed
// monthly by the run, invoices past due marked overdue, and the `invoices`
// job of the night running both after the order billing.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const dir = new URL('../../supabase/migrations/', import.meta.url)
const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').toLowerCase()
const read = (f: string) => strip(readFileSync(new URL(f, dir), 'utf8'))
const subs = read('20261126100000_subscriptions_billed_monthly_and_invoices_go_overdue.sql')
const before = read('20261113600000_orders_and_accounts_are_scored_for_risk.sql')

function fn(src: string, name: string): string {
  const at = src.indexOf(`create or replace function public.${name}(`)
  expect(at, `${name} is not defined here`).toBeGreaterThanOrEqual(0)
  const rest = src.slice(at)
  const open = rest.indexOf('$$')
  const close = rest.indexOf('$$', open + 2)
  return rest.slice(0, close + 2)
}
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

describe('subscription billing and overdue, as a migration', () => {
  it('is one transaction that checks itself last, with rolled-back cases and a ten-job dry run', () => {
    const code = subs.trim()
    expect(code.startsWith('begin;')).toBe(true)
    expect(code.endsWith('commit;')).toBe(true)
    expect(code.match(/^begin;$/gm)?.length).toBe(1)
    expect(code.match(/^commit;$/gm)?.length).toBe(1)
    const last = subs.slice(subs.lastIndexOf('do $$'))
    expect(last).toContain('if not public.is_scheduler() then')
    expect(last).toContain("raise exception using errcode = 'zz999', message = 'rolling the subscription check back'")
    expect(last).toContain('dry := public.run_nightly(current_date);')
    expect(last).toContain("jsonb_array_length(dry -> 'jobs') <> 10")
    expect(last).toContain("not (v_res ? 'orders' and v_res ? 'subscriptions' and v_res ? 'overdue')")
  })

  it('raises one recurring invoice per account and currency for last month, never twice, from Aug 2026', () => {
    const b = squash(fn(subs, 'bill_account_subscriptions'))
    expect(b).toContain("format('inv-%s-%s-%s-s', replace(g.account_id, 'ent-', ''), to_char(v_period, 'yyyymm'), g.currency)")
    expect(b).toContain('if exists (select 1 from public.enterprise_invoices i where i.id = v_id) then')
    expect(b).toContain("if v_period < date '2026-08-01' then")
    expect(b).toContain("s.status in ('active', 'suspended') and s.started <= bs.v_last")
    expect(b).toContain("to_char(v_period, 'mon yyyy'), 'recurring', p_as_of, p_as_of + v_days")
    expect(b).toContain("where f.base = 'usd' and f.quote = g.currency and f.as_of <= p_as_of")
  })

  it('refuses a future date and anyone but the operator or the schedule, in all three', () => {
    for (const name of ['bill_account_subscriptions', 'mark_overdue_invoices', 'run_invoicing']) {
      const b = squash(fn(subs, name))
      expect(b, name).toContain("public.current_persona() is distinct from 'operator' and not public.is_scheduler()")
      expect(b, name).toContain('p_as_of is null or p_as_of > current_date')
    }
  })

  it('puts one subscription line per subscription, its monthly amount net, tax on top', () => {
    const b = squash(fn(subs, 'bill_account_subscriptions'))
    expect(b).toContain("select format('%s-l%s', v_id, x.n), v_id, 'subscription', x.name, x.seller, x.partner_id, x.cost_centre, x.id, null, x.quantity, x.unit_price, x.monthly, x.n, x.vertical")
    expect(b).toContain('set recurring = v_net, tax = round(v_net * v_rate / 100, 2), total = v_net + round(v_net * v_rate / 100, 2)')
  })

  it('charges no tax on reverse charge or exemption, and prints why', () => {
    const b = fn(subs, 'bill_account_subscriptions')
    expect(b).toContain('if coalesce(a.reverse_charge, false) then')
    expect(b).toContain("v_note := format('reverse charge")
    expect(b).toContain("v_note := format('exempt")
    expect(b).toContain('v_rate := m.tax_rate;')
  })

  it('moves open invoices past due to overdue, and nothing back', () => {
    const b = squash(fn(subs, 'mark_overdue_invoices'))
    expect(b).toContain("update public.enterprise_invoices i set status = 'overdue' where i.status = 'open' and i.due < p_as_of")
    expect(b).not.toMatch(/set status = 'open'/)
  })

  it('runs orders, then subscriptions, then overdue, and returns all three', () => {
    const b = squash(fn(subs, 'run_invoicing'))
    const o = b.indexOf('v_orders := public.bill_account_orders(p_as_of);')
    const s = b.indexOf('v_subs := public.bill_account_subscriptions(p_as_of);')
    const d = b.indexOf('v_overdue := public.mark_overdue_invoices(p_as_of);')
    expect(o).toBeGreaterThan(0)
    expect(s).toBeGreaterThan(o)
    expect(d).toBeGreaterThan(s)
    expect(b).toContain("jsonb_build_object('ran_on', p_as_of, 'orders', v_orders, 'subscriptions', v_subs, 'overdue', v_overdue)")
  })

  it('keeps the three functions and the night off the API', () => {
    for (const name of ['bill_account_subscriptions', 'mark_overdue_invoices', 'run_invoicing', 'run_nightly'])
      expect(subs).toContain(`revoke all on function public.${name}(date) from public, anon, authenticated;`)
    expect(subs).not.toMatch(/grant execute on function public\.(bill_account_subscriptions|mark_overdue_invoices|run_invoicing)/)
  })

  it('changes run_nightly only to call run_invoicing for `invoices`: still ten jobs', () => {
    const now = squash(fn(subs, 'run_nightly'))
    expect(now).toContain("when 'invoices' then public.run_invoicing(p_as_of)")
    const was = squash(fn(before, 'run_nightly'))
    expect(was).toContain("when 'invoices' then public.bill_account_orders(p_as_of)")
    expect(now.replace("when 'invoices' then public.run_invoicing(p_as_of)", "when 'invoices' then public.bill_account_orders(p_as_of)")).toBe(was)
  })

  it('backfills Aug to Oct through the run, marks Aug and Sep paid, then sweeps', () => {
    const sep = subs.indexOf("select public.bill_account_subscriptions(date '2026-09-01');")
    const oct = subs.indexOf("select public.bill_account_subscriptions(date '2026-10-01');")
    const nov = subs.indexOf("select public.bill_account_subscriptions(date '2026-11-01');")
    const paid = subs.indexOf("set status = 'paid', paid_on = least(i.due, i.issued + 12)")
    const sweep = subs.indexOf('select public.mark_overdue_invoices(current_date);')
    expect(sep).toBeGreaterThan(0)
    expect(oct).toBeGreaterThan(sep)
    expect(nov).toBeGreaterThan(oct)
    expect(paid).toBeGreaterThan(nov)
    expect(sweep).toBeGreaterThan(paid)
    expect(subs.slice(paid, sweep)).toContain("i.period in ('aug 2026', 'sep 2026')")
    expect(subs.slice(sep, sweep)).not.toMatch(/insert into public\.enterprise_invoice/)
  })

  it('tells the Scheduled jobs article that subscriptions are billed and invoices go overdue', () => {
    const help = subs.slice(subs.indexOf('update kb_articles'), subs.indexOf('do $$', subs.indexOf('update kb_articles')))
    expect(help).toContain("where view = 'op-jobs'")
    expect(help).toContain('and for its subscriptions')
    expect(help).toContain('is marked overdue')
    expect(help).toContain("body::text not like '%is marked overdue%'")
  })
})
