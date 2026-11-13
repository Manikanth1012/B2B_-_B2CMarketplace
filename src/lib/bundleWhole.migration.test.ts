// 20261113100000, checked without a database: a bundle is bought whole, a
// bundle part renews at the bundle price for 12 months, one selection goes on
// one live requisition, and the night has seven jobs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync(
  new URL('../../supabase/migrations/20261113100000_a_bundle_is_bought_whole.sql', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n')
const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').toLowerCase()

/** The text of one `create or replace function` statement. */
function fn(name: string): string {
  const at = code.indexOf(`create or replace function public.${name}(`)
  expect(at, `${name} is not defined here`).toBeGreaterThanOrEqual(0)
  const rest = code.slice(at)
  const fnTag = rest.indexOf('as $function$')
  const tag = fnTag >= 0 && (rest.indexOf('as $$') < 0 || fnTag < rest.indexOf('as $$')) ? '$function$' : '$$'
  const open = rest.indexOf(tag)
  const close = rest.indexOf(tag, open + tag.length)
  return rest.slice(0, close + tag.length)
}

describe('a bundle is bought whole, as a migration', () => {
  it('is one transaction that checks itself last, dry-running the night with seven jobs', () => {
    expect(code.trim().startsWith('begin;')).toBe(true)
    expect(code.trim().endsWith('commit;')).toBe(true)
    expect(code.match(/^begin;$/gm)?.length).toBe(1)
    expect(code.match(/^commit;$/gm)?.length).toBe(1)
    const last = code.slice(code.lastIndexOf('do $$'))
    expect(last).toContain("raise exception using errcode = 'zz999'")
    expect(last).toContain("exception when sqlstate 'zz999' then")
    expect(last).toContain('dry := public.run_nightly(current_date);')
    expect(last).toContain("jsonb_array_length(dry -> 'jobs') <> 7")
    expect(last).toContain("if not (j ->> 'ok')::boolean then")
  })

  it('runs seven jobs in order, payments and bundle selections among them', () => {
    const body = fn('run_nightly')
    const jobs = body.match(/foreach j in array array\[([^\]]+)\]/)
    expect(jobs).not.toBeNull()
    expect(jobs![1].split(',').map(s => s.trim().replace(/'/g, ''))).toEqual(
      ['agreements', 'enterprise subscriptions', 'subscriptions', 'documents', 'payments', 'bundle selections', 'settlements'])
    expect(body).toContain("when 'payments'                 then jsonb_build_object('expired', public.expire_stale_payments())")
    expect(body).toContain("when 'bundle selections'        then public.delete_unused_bundle_selections(p_as_of)")
    expect(body).toContain("when 'settlements'              then public.settle_to_date(p_as_of)")
    expect(body).toContain("if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then")
  })

  it('fails a payment whose bundle is not whole, and removes only this reference\'s unpaid orders', () => {
    const body = fn('settle_payment_attempt')
    const check = body.indexOf('a bundle was not bought whole, so nothing was charged.')
    const placed = body.indexOf("set status = 'placed'")
    expect(check).toBeGreaterThan(0)
    expect(placed).toBeGreaterThan(check)
    const failed = body.slice(body.indexOf('if v_broken is not null then'), placed)
    expect(failed).toContain("set state = 'failed'")
    expect(failed).toContain('failure_reason = v_why')
    expect(failed).toMatch(/delete from order_items oi\s+using orders o\s+where oi\.order_id = o\.id\s+and o\.payment_ref = a\.reference\s+and o\.status = 'awaiting_payment';/)
    expect(failed).toMatch(/delete from orders\s+where payment_ref = a\.reference\s+and status = 'awaiting_payment';/)
    expect(failed).toContain("'state', 'failed'")
    /* Whole across this reference's orders, and not ordered on any order that is not waiting to be paid. */
    expect(body).toContain("and o.status <> 'awaiting_payment'")
    expect(body).toContain('for update;')
    /* Same signature and grant as 20260807330000. */
    expect(code).toContain('grant execute on function public.settle_payment_attempt(text,text,text,text,text,integer,numeric,text)')
  })

  it('does not count a part on another reference\'s unpaid order as ordered, and no longer checks the basket', () => {
    const body = fn('guard_bundle_order_line')
    expect(body).toContain('o.payment_ref into v_o')
    expect(body).toMatch(/and not \(o2\.status = 'awaiting_payment'\s+and o2\.payment_ref is distinct from v_o\.payment_ref\)/)
    expect(sql.toLowerCase()).not.toContain('accepted residual risk')
    expect(body).not.toContain('cart_items')
    expect(body).toContain('v_s.valid_until < now()')
    expect(body).toContain('bundle_part_unavailable(v_s.id, v_s.currency)')
  })

  it('renews a bundle part at its price until bundle_price_until, then the published price, floored', () => {
    expect(code).toContain('add column if not exists bundle_selection_id text references public.bundle_selections(id) on delete set null')
    expect(code).toContain('add column if not exists bundle_price_until date')
    const price = fn('subscription_renewal_price')
    expect(price).toContain('p_on < p_sub.bundle_price_until')
    expect(price).toContain('greatest(pp.price, coalesce(pp.floor_price, 0))')
    expect(price).toContain('coalesce(v_published, p_sub.price)')
    const renew = fn('renew_subscriptions')
    expect(renew).toContain('v_amount := public.subscription_renewal_price(s, p_start);')
    expect(renew).toContain('price = v_amount')
    expect(renew).toMatch(/s\s+public\.subscriptions;/)
  })

  it('refuses a selection already on another live requisition', () => {
    const body = fn('guard_one_requisition_per_selection')
    expect(body).toContain('l.requisition_id is distinct from new.requisition_id')
    expect(body).toContain("r.state not in ('declined', 'withdrawn')")
    expect(body).toContain('raise exception')
    expect(code).toMatch(/create trigger z_one_requisition_per_selection\s+before insert or update on public\.enterprise_requisition_lines/)
  })

  it('lets a business price a bundle in any currency its market takes, with the same signature', () => {
    const body = fn('configure_bundle')
    expect(body).toContain('create or replace function public.configure_bundle(p_template text, p_choices jsonb, p_currency text, p_quantity integer)')
    expect(body).toContain('mc.market_code = v_market and mc.currency = p_currency')
    expect(code).toContain('grant execute on function public.configure_bundle(text, jsonb, text, integer) to authenticated;')
  })

  it('deletes only selections nothing refers to, a week after their hold', () => {
    const body = fn('delete_unused_bundle_selections')
    expect(body).toContain('bs.valid_until < (p_as_of - 7)')
    for (const t of ['cart_items', 'enterprise_requisition_lines', 'order_items']) expect(body).toContain(`from public.${t} `)
    expect(body).toContain("'deleted', n_gone")
  })

  it('revokes every new function from the API', () => {
    for (const sig of [
      'subscription_renewal_price(public.subscriptions, date)',
      'delete_unused_bundle_selections(date)',
      'guard_one_requisition_per_selection()',
      'run_nightly(date)',
    ]) {
      expect(code).toContain(`revoke all on function public.${sig} from public, anon, authenticated;`)
    }
  })

  it('seeds one help article for the Scheduled jobs screen, and checks it', () => {
    expect(code).toContain("if not exists (select 1 from kb_articles where view = 'op-jobs') then")
    expect(code).toContain("'scheduled jobs'")
    expect(code).toContain('select public.run_nightly();')
    for (const job of ['agreements:', 'enterprise subscriptions:', 'subscriptions:', 'documents:', 'payments:', 'bundle selections:', 'settlements:']) {
      expect(code).toContain(job)
    }
    const last = code.slice(code.lastIndexOf('do $$'))
    expect(last).toContain("where view = 'op-jobs'")
  })
})
