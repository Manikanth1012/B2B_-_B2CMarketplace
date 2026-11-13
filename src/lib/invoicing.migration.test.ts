// 20261113400000 and 20261113500000, checked without a database: the billing
// run and its ninth nightly job, and the demo trade for Aug to Nov 2026.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const dir = new URL('../../supabase/migrations/', import.meta.url)
const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').toLowerCase()
const billing = strip(readFileSync(new URL('20261113400000_a_business_is_invoiced_for_what_it_ordered.sql', dir), 'utf8'))
const seed = strip(readFileSync(new URL('20261113500000_three_months_of_trade_and_this_one.sql', dir), 'utf8'))
const before = strip(readFileSync(new URL('20261113200000_a_basket_is_kept_and_watched.sql', dir), 'utf8'))

function fn(src: string, name: string): string {
  const at = src.indexOf(`create or replace function public.${name}(`)
  expect(at, `${name} is not defined here`).toBeGreaterThanOrEqual(0)
  const rest = src.slice(at)
  const open = rest.indexOf('$$')
  const close = rest.indexOf('$$', open + 2)
  return rest.slice(0, close + 2)
}
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

const oneTransaction = (code: string) => {
  expect(code.trim().startsWith('begin;')).toBe(true)
  expect(code.trim().endsWith('commit;')).toBe(true)
  expect(code.match(/^begin;$/gm)?.length).toBe(1)
  expect(code.match(/^commit;$/gm)?.length).toBe(1)
}

describe('the billing run, as a migration', () => {
  it('is one transaction that checks itself last, with a rolled-back invoice and a nine-job dry run', () => {
    oneTransaction(billing)
    const last = billing.slice(billing.lastIndexOf('do $$'))
    expect(last).toContain("raise exception using errcode = 'zz999', message = 'rolling the invoice check back'")
    expect(last).toContain('dry := public.run_nightly(current_date);')
    expect(last).toContain("jsonb_array_length(dry -> 'jobs') <> 9")
  })

  it('bills only delivered, unbilled business orders placed from 1 Aug 2026 to the start of the month', () => {
    const b = squash(fn(billing, 'order_is_billable'))
    expect(b).toContain('p_order.account_id is not null')
    expect(b).toContain('p_order.invoice_id is null')
    expect(b).toContain("p_order.created_at >= timestamptz '2026-08-01 00:00:00+00'")
    expect(b).toContain('p_order.created_at < p_before')
    expect(b).toContain("not in ('cancelled', 'refunded', 'failed')")
    expect(b).toContain('array_length(p_order.stages, 1) is not null')
    expect(b).toContain('coalesce(p_order.stage, 0) >= array_length(p_order.stages, 1) - 1')
  })

  it('raises one invoice per account, currency and month, never twice, and refuses a future date', () => {
    const b = squash(fn(billing, 'bill_account_orders'))
    expect(b).toContain("format('inv-%s-%s-%s', replace(g.account_id, 'ent-', ''), to_char(v_period, 'yyyymm'), g.currency)")
    expect(b).toContain('if exists (select 1 from public.enterprise_invoices i where i.id = v_id) then')
    expect(b).toContain('p_as_of > current_date')
    expect(b).toContain("public.current_persona() is distinct from 'operator' and not public.is_scheduler()")
  })

  it('carries the requisition and cost centre on each line, net of the order\'s tax, and stamps the orders', () => {
    const b = squash(fn(billing, 'bill_account_orders'))
    expect(b).toContain('x.cost_centre, null, x.requisition_id, x.quantity')
    expect(b).toContain('round(x.price * x.quantity / x.gross, 2)')
    expect(b).toContain('update public.orders o set invoice_id = v_id')
  })

  it('charges no tax on reverse charge or exemption, and prints why', () => {
    const b = fn(billing, 'bill_account_orders')
    expect(b).toContain("if coalesce(a.reverse_charge, false) then")
    expect(b).toContain("v_note := format('reverse charge")
    expect(b).toContain("v_note := format('exempt")
  })

  it('keeps the billing helpers off the API', () => {
    expect(billing).toContain('revoke all on function public.order_is_billable(public.orders, timestamptz) from public, anon, authenticated;')
    expect(billing).toContain('revoke all on function public.bill_account_orders(date) from public, anon, authenticated;')
    expect(billing).toContain('revoke all on function public.run_nightly(date) from public, anon, authenticated;')
  })

  it('adds `invoices` to the night after baskets, and changes nothing else in run_nightly', () => {
    const now = squash(fn(billing, 'run_nightly'))
    expect(now).toContain("'baskets', 'invoices', 'settlements'")
    expect(now).toContain("when 'invoices' then public.bill_account_orders(p_as_of)")
    const was = squash(fn(before, 'run_nightly'))
    expect(now
      .replace("'baskets', 'invoices', 'settlements'", "'baskets', 'settlements'")
      .replace(" when 'invoices' then public.bill_account_orders(p_as_of)", '')).toBe(was)
  })

  it('tells the Scheduled jobs article about the ninth job', () => {
    expect(billing).toContain("'the nine jobs'")
    expect(billing).toContain('invoices: on the 1st')
  })
})

describe('the demo trade for Aug to Nov 2026, as a migration', () => {
  it('is one transaction that checks itself last', () => {
    oneTransaction(seed)
    const last = seed.slice(seed.lastIndexOf('do $$'))
    expect(last).toContain("if v_n <> 19 then raise exception '% of the 19 seeded requisitions")
    expect(last).toContain("if v_n <> 14 then raise exception '% invoices were raised")
  })

  it('marks every row so it cannot collide with what the app mints', () => {
    const ids = [...seed.matchAll(/'(req-d26\d\d-\d\d)'/g)].map(m => m[1])
    expect(new Set(ids).size).toBe(19)
    for (const id of ids) expect(id).toMatch(/^req-d26(08|09|10|11)-0[1-5]$/)
    expect([...seed.matchAll(/'(ord-d26\d\d-s\d\d)'/g)].length).toBe(9)
  })

  it('invoices through the billing run, month by month, rather than writing invoices itself', () => {
    expect(seed).toContain("select public.bill_account_orders(date '2026-09-01');")
    expect(seed).toContain("select public.bill_account_orders(date '2026-10-01');")
    expect(seed).toContain("select public.bill_account_orders(date '2026-11-01');")
    expect(seed).not.toMatch(/insert into public\.enterprise_invoices\b/)
    expect(seed).not.toMatch(/insert into public\.enterprise_invoice_lines\b/)
  })

  it('has two configured bundles on two requisitions', () => {
    expect(seed).toContain("'bs-d2609-01'")
    expect(seed).toContain("'bs-d2610-03'")
    expect(seed).toContain("'bt-seed-office'")
  })

  it('never writes settlement, the ledger or stock', () => {
    expect(seed).not.toMatch(/insert into public\.(settlement_|ledger|gl_|operator_inventory)/)
    expect(seed).not.toMatch(/update public\.(settlement_|operator_inventory|products)\b/)
  })
})
