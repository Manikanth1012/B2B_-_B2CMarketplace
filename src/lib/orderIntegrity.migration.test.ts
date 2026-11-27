// 20261127100000, checked without a database: an order is a record once paid
// (a shopper may not update one, nor delete one past awaiting payment), and
// the risk follow-ups of spec 13 (spec 17).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const dir = new URL('../../supabase/migrations/', import.meta.url)
const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').toLowerCase()
const read = (name: string) => strip(readFileSync(new URL(name, dir), 'utf8'))

const mig = read('20261127100000_orders_are_records_once_paid.sql')
const risk = read('20261113600000_orders_and_accounts_are_scored_for_risk.sql')
const cleanup = read('20260808220000_the_cleanup_that_could_not_clean_up.sql')
const currency = read('20260802470000_a_business_may_pay_in_any_currency_its_market_takes.sql')

/** The text of one function, from `create or replace function` to the end of
    its dollar-quoted body, whatever the tag. Schema-qualified or not. */
function fn(src: string, name: string): string {
  const re = new RegExp(`create or replace function (public\\.)?${name}\\(`)
  const m = re.exec(src)
  expect(m, `${name} is not defined here`).not.toBeNull()
  const rest = src.slice(m!.index)
  const tag = /as (\$[a-z_]*\$)/.exec(rest)
  expect(tag, `${name} has no dollar-quoted body`).not.toBeNull()
  const open = rest.indexOf(tag![1])
  const close = rest.indexOf(tag![1], open + tag![1].length)
  return rest.slice(0, close + tag![1].length)
}
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()
/** Only the body: from the opening dollar tag on. */
function body(src: string, name: string): string {
  const f = fn(src, name)
  return f.slice(f.search(/as \$[a-z_]*\$/))
}
/** The migration's statements, without the self-check at the end. */
const head = mig.slice(0, mig.lastIndexOf('do $$'))
const check = mig.slice(mig.lastIndexOf('do $$'))

describe('orders are records once paid, as a migration', () => {
  it('is one transaction that checks itself last, rolled back, as the scheduler, with a ten-job dry run', () => {
    expect(mig.trim().startsWith('begin;')).toBe(true)
    expect(mig.trim().endsWith('commit;')).toBe(true)
    expect(mig.match(/^begin;$/gm)?.length).toBe(1)
    expect(mig.match(/^commit;$/gm)?.length).toBe(1)
    expect(check).toContain('if not public.is_scheduler() then')
    expect(check).toContain("raise exception using errcode = 'zz999'")
    expect(check).toContain("exception when sqlstate 'zz999' then")
    expect(check).toContain('dry := public.run_nightly(current_date);')
    expect(check).toContain("jsonb_array_length(dry -> 'jobs') <> 10")
    expect(check).toContain("(dry -> 'jobs' -> 8 ->> 'job') is distinct from 'risk'")
  })

  it('takes away the shopper update policies and the shopper delete of order lines, and keeps the shopper delete of orders', () => {
    expect(head).toContain('drop policy if exists "owner_update_orders" on public.orders;')
    expect(head).toContain('drop policy if exists "owner_update_order_items" on public.order_items;')
    expect(head).toContain('drop policy if exists "owner_delete_order_items" on public.order_items;')
    expect(head).not.toMatch(/create policy "?owner_update_orders/)
    expect(head).not.toMatch(/create policy "?owner_update_order_items/)
    expect(head).not.toMatch(/create policy "?owner_delete_order_items/)
    /* Checkout's undo still needs it; the guard below is what narrows it. */
    expect(head).not.toContain('drop policy if exists "owner_delete_orders"')
    /* Nothing else is opened on either table. */
    expect(head).not.toMatch(/create policy [^;]* on public\.(orders|order_items)\b/)
  })

  it('refuses a non-operator delete of anything but an unscored order awaiting payment, and keeps the operator rules', () => {
    const was = body(cleanup, 'guard_order_delete')
    const now = body(head, 'guard_order_delete')
    expect(fn(head, 'guard_order_delete')).toContain('security definer')
    const flat = squash(now)
    expect(flat).toContain('if public.current_persona() is null then return old; end if;')
    expect(flat).toContain("if public.current_persona() is distinct from 'operator' then")
    expect(flat).toContain("old.status is distinct from 'awaiting_payment'")
    expect(flat).toContain('exists (select 1 from public.order_risk r where r.order_id = old.id)')
    /* The operator half, copied from 20260808220000 unchanged. */
    for (const s of ["('a payment attempt', exists (select 1 from public.payment_attempts where order_ref = old.order_ref))",
                     "('a seller dispute', exists (select 1 from public.partner_disputes where order_ref = old.order_ref))",
                     "if old.invoice_id is not null then",
                     "if old.status in ('delivered', 'active', 'refunded', 'in-transit', 'shipped') then"]) {
      expect(squash(was)).toContain(s)
      expect(flat).toContain(s)
    }
    expect(head).toContain('drop trigger if exists z_guard_order_delete on public.orders;')
    expect(squash(head)).toContain('create trigger z_guard_order_delete before delete on public.orders for each row execute function public.guard_order_delete();')
  })

  it('lets a risk decision through the currency guard when neither market nor currency changes, and nothing else', () => {
    const was = squash(body(currency, 'guard_order_currency'))
    const now = squash(body(head, 'guard_order_currency'))
    expect(now).toContain("tg_op = 'update'")
    expect(now).toContain("coalesce(current_setting('aventa.risk_decision', true), '') = 'on'")
    expect(now).toContain('new.market is not distinct from old.market')
    expect(now).toContain('new.currency is not distinct from old.currency')
    expect(now).toContain('new.account_id is not distinct from old.account_id')
    expect(now).toContain('new.user_id is not distinct from old.user_id')
    /* The rest of the guard, copied from 20260802470000 unchanged. */
    const rest = was.slice(was.indexOf('if current_persona() is null then return new; end if;'))
    expect(now).toContain(rest)
    expect(squash(head)).toContain('create trigger guard_order_currency_trg before insert or update on public.orders for each row execute function public.guard_order_currency();')
  })

  it('rescores every account it can and reports the ones it could not', () => {
    const now = squash(body(head, 'refresh_account_risk'))
    expect(now).toMatch(/^as \$\$ <<ra>> declare/)
    expect(now).toContain('n_failed integer := 0;')
    expect(now).toContain("v_failures jsonb := '[]'::jsonb;")
    expect(now).toContain('exception when others then')
    expect(now).toContain('n_failed := n_failed + 1;')
    expect(now).toContain('if jsonb_array_length(v_failures) < 20 then')
    expect(now).toContain("jsonb_build_object('kind', v_acct.acct_kind, 'id', v_acct.acct_id, 'reason', sqlerrm)")
    expect(now).toContain("'failed', n_failed, 'failures', v_failures")
    /* The guard and the account list, copied unchanged. */
    const was = squash(body(risk, 'refresh_account_risk'))
    const cut = (s: string) => s.slice(s.indexOf('begin if public.current_persona()'), s.indexOf('order by 1, 2 loop'))
    expect(cut(now).length).toBeGreaterThan(100)
    expect(cut(now)).toBe(cut(was))
    /* Each account in its own block, so one fault rolls back that account alone. */
    expect(now).toContain('order by 1, 2 loop begin v_s := public.score_account_on(v_acct.acct_kind, v_acct.acct_id, p_as_of);')
    /* Still the operator's "Rescore now" and the night's job, nobody else's. */
    expect(head).toContain('revoke all on function public.refresh_account_risk(date) from public, anon;')
    expect(head).toContain('grant execute on function public.refresh_account_risk(date) to authenticated;')
  })

  it('does not count an earlier held order as a purchase in the first-order and usual-order history', () => {
    const was = body(risk, 'score_order')
    const now = body(head, 'score_order')
    const old = "e.status not in ('awaiting_payment', 'cancelled', 'failed')"
    const neu = "e.status not in ('held', 'awaiting_payment', 'cancelled', 'failed')"
    /* The earlier-order count, the median and the address history; the
       burst (orders in an hour) still counts a held one, as before. */
    expect(was.split(old).length - 1).toBe(4)
    expect(now.split(neu).length - 1).toBe(3)
    expect(now.split(old).length - 1).toBe(1)
    expect(squash(now)).toContain(`and (e.id = v_o.id or (e.created_at > v_at - interval '1 hour' and e.created_at <= v_at and ${old}))`)
    /* Otherwise the function as it was. */
    expect(squash(now.split(neu).join(old))).toBe(squash(was))
    expect(head).toContain('revoke all on function public.score_order(uuid) from public, anon, authenticated;')
  })

  it('checks each decision on rolled-back rows, as the persona it is about', () => {
    expect(check).toContain('set local role authenticated;')
    expect(check).toContain('reset role;')
    expect(check).toMatch(/set_config\('request\.jwt\.claims', json_build_object\('sub', v_user, 'role', 'authenticated'\)::text, true\)/)
    expect(check).toMatch(/set_config\('request\.jwt\.claims', json_build_object\('sub', v_seller, 'role', 'authenticated'\)::text, true\)/)
    expect(check).toMatch(/set_config\('request\.jwt\.claims', json_build_object\('sub', v_op, 'role', 'authenticated'\)::text, true\)/)
    for (const s of [
      'a shopper could not remove their own unpaid order',
      'a shopper removed their own placed order',
      'a shopper removed their own held order',
      'a shopper removed their own scored order',
      'a shopper updated their own order',
      'a shopper updated a line of their own order',
      'a shopper removed a line of their own order',
      'a seller could not move their own part',
      'the operator could not move an order a stage',
      'a held order whose shopper moved market could not be released',
      'one bad account failed the rescore',
      'an earlier held order counted as an earlier purchase',
    ]) expect(check).toContain(s)
    /* The fault is made and unmade inside the rolled-back block. */
    expect(check).toContain('create or replace function public.zz_selfcheck_oi_fault()')
    expect(check).toContain('drop function public.zz_selfcheck_oi_fault();')
  })
})
