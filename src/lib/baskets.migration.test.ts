// 20261113200000, checked without a database: the requisition basket is kept,
// shopper and business baskets are flagged (and capped) when stock goes, a
// flagged line cannot be bought, the operator may remind an owner once a day,
// and the night has eight jobs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const sql = readFileSync(
  new URL('../../supabase/migrations/20261113200000_a_basket_is_kept_and_watched.sql', import.meta.url),
  'utf8',
).replace(/\r\n/g, '\n')
const code = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').toLowerCase()

/** The text of one `create or replace function` statement. */
function fn(name: string, schema = 'public.'): string {
  const at = code.indexOf(`create or replace function ${schema}${name}(`)
  expect(at, `${name} is not defined here`).toBeGreaterThanOrEqual(0)
  const rest = code.slice(at)
  const open = rest.indexOf('$$')
  const close = rest.indexOf('$$', open + 2)
  return rest.slice(0, close + 2)
}

describe('a basket is kept and watched, as a migration', () => {
  it('is one transaction that checks itself last, dry-running the night with eight jobs', () => {
    expect(code.trim().startsWith('begin;')).toBe(true)
    expect(code.trim().endsWith('commit;')).toBe(true)
    expect(code.match(/^begin;$/gm)?.length).toBe(1)
    expect(code.match(/^commit;$/gm)?.length).toBe(1)
    const last = code.slice(code.lastIndexOf('do $$'))
    expect(last).toContain("raise exception using errcode = 'zz999'")
    expect(last).toContain("exception when sqlstate 'zz999' then")
    expect(last).toContain('dry := public.run_nightly(current_date);')
    expect(last).toContain("jsonb_array_length(dry -> 'jobs') <> 8")
    expect(last).toContain("if not (j ->> 'ok')::boolean then")
    /* The rolled-back stock case: capped, then unavailable. */
    expect(last).toContain("'only 1 left — we reduced this from 3'")
    expect(last).toContain("'no longer available'")
    expect(last).toContain("where view = 'op-baskets'")
  })

  it('runs eight jobs in order, baskets between bundle selections and settlements', () => {
    const body = fn('run_nightly')
    const jobs = body.match(/foreach j in array array\[([^\]]+)\]/)
    expect(jobs).not.toBeNull()
    expect(jobs![1].split(',').map(s => s.trim().replace(/'/g, ''))).toEqual(
      ['agreements', 'enterprise subscriptions', 'subscriptions', 'documents', 'payments', 'bundle selections', 'baskets', 'settlements'])
    expect(body).toContain("when 'baskets'                  then public.run_baskets_night(p_as_of)")
    expect(body).toContain("when 'bundle selections'        then public.delete_unused_bundle_selections(p_as_of)")
    expect(body).toContain("if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then")
  })

  it('keeps one business basket per buyer, read by its owner and the operator, written only by functions', () => {
    expect(code).toContain('create table if not exists public.requisition_baskets')
    expect(code).toMatch(/user_id\s+uuid not null unique references auth\.users\(id\) on delete cascade/)
    expect(code).toContain('create table if not exists public.requisition_basket_lines')
    for (const col of ['product_id', 'quantity', 'unit_price', 'model', 'unit', 'bundle_selection_id',
      'quote_line_id', 'stock_note', 'was_quantity', 'flagged_at', 'sort_order', 'bundle', 'vertical',
      'on_contract', 'off_contract_reason']) {
      expect(code).toMatch(new RegExp(`\\n\\s+${col}\\s+[a-z]`))
    }
    expect(code).toContain('create policy "owner_read_requisition_baskets" on public.requisition_baskets for select')
    expect(code).toContain('create policy "operator_read_requisition_baskets" on public.requisition_baskets for select')
    expect(code).toContain('revoke insert, update, delete on public.requisition_baskets      from authenticated;')
    expect(code).not.toMatch(/create policy "[^"]+" on public\.requisition_basket(s|_lines) for (insert|update|delete|all)/)
    /* No named constraint at all, so none can collide with `<table>_<col>_check`. */
    expect(code).not.toMatch(/constraint requisition_basket/)
  })

  it('saves the basket whole, keeping a flag only while the line is unchanged', () => {
    const body = fn('save_requisition_basket')
    expect(body).toContain('create or replace function public.save_requisition_basket(p_currency text, p_lines jsonb)')
    expect(body).toContain("public.current_persona() is distinct from 'enterprise'")
    expect(body).toContain("u.status = 'active'")
    expect(body).toContain("'enterprise' = any (coalesce(v_aud, array[]::text[]))")
    expect(body).toContain('delete from public.requisition_baskets b where b.user_id = v_uid;')
    expect(body).toContain("(v_prev ->> 'quantity')::integer = v_qty")
    expect(body).toContain('public.basket_line_stock_flag(v_pid, v_qty, v_sel is not null, null)')
    expect(body).toContain('bs.account_id = v_account')
    expect(code).toContain('grant execute on function public.save_requisition_basket(text, jsonb) to authenticated;')
    expect(code).toContain('grant execute on function public.clear_requisition_basket() to authenticated;')
  })

  it('gives cart_items the flag and an updated_at the flag does not move, and keeps the operator read', () => {
    for (const col of ['stock_note   text', 'was_quantity integer', 'flagged_at   timestamptz',
      'updated_at   timestamptz not null default now()']) {
      expect(code).toContain(`alter table public.cart_items add column if not exists ${col}`)
    }
    const stamp = fn('stamp_cart_line')
    expect(stamp).not.toContain('security definer')
    expect(stamp).toContain("current_user::text in ('anon', 'authenticated')")
    expect(stamp).toContain("current_setting('aventa.basket_flag', true)")
    expect(stamp).toContain('new.updated_at := old.updated_at;')
    expect(stamp).toContain('raise exception')
    expect(code).toMatch(/create trigger cart_items_basket_stamp before insert or update on public\.cart_items/)
    expect(code).toContain('create policy "operator_read_cart_items" on public.cart_items for select to authenticated')
  })

  it('flags and caps every basket line of a product when its stock or listing changes', () => {
    const flag = fn('basket_line_stock_flag')
    expect(flag).toContain("v_status is distinct from 'live' or v_stock = 'out'")
    expect(flag).toContain("format('only %s left — we reduced this from %s', v_left, v_asked)")
    expect(flag).toContain("'no longer available'")
    expect(fn('basket_stock_left')).toContain('sum(i.available)')
    const run = fn('flag_basket_stock')
    expect(run).toContain('from public.cart_items c')
    expect(run).toContain('from public.requisition_basket_lines l')
    expect(run).toContain("set_config('aventa.basket_flag', 'on', true)")
    expect(run).toContain('flagged_at   = now()')
    expect(code).toMatch(/create trigger z_products_flag_baskets\s+after update of stock, status on public\.products/)
    expect(code).toMatch(/create trigger z_inventory_flag_baskets\s+after insert or update of on_hand, reserved, product_id or delete on public\.operator_inventory/)
  })

  it('lets a seller pause a listing that is in a shopper\'s basket (guard_shoppable)', () => {
    const body = fn('guard_shoppable', '')
    expect(body).toContain("tg_op = 'update' and tg_table_name = 'cart_items'")
    expect(body).toContain('new.product_id is not distinct from old.product_id')
    /* The rest of 20260801840000's guard is still there. */
    expect(body).toContain('if not (who = any (prod.shoppable_by)) then')
    expect(body).toContain('if not (who = any (prod.audiences)) then')
  })

  it('refuses to order or requisition a product whose basket line is flagged', () => {
    const cart = fn('guard_flagged_cart_order_line')
    expect(cart).toContain("public.current_persona() is distinct from 'consumer'")
    expect(cart).toContain('if v_account is not null or v_user is null then return new; end if;')
    expect(cart).toContain('c.stock_note is not null')
    expect(cart).toContain('not c.saved')
    expect(code).toMatch(/create trigger z_flagged_cart_order_line\s+before insert or update of product_id, order_id, bundle_selection_id on public\.order_items/)
    const req = fn('guard_flagged_basket_requisition_line')
    expect(req).toContain("public.current_persona() is distinct from 'enterprise'")
    expect(req).toContain('b.user_id = auth.uid()')
    expect(req).toContain('l.stock_note is not null')
    expect(code).toMatch(/create trigger z_flagged_basket_requisition_line\s+before insert or update of product_id, requisition_id, bundle_selection_id on public\.enterprise_requisition_lines/)
  })

  it('accepts a flag only when the line can now be bought', () => {
    const body = fn('accept_basket_flag')
    expect(body).toContain("if p_kind = 'cart' then")
    expect(body).toContain("elsif p_kind = 'requisition' then")
    expect(body).toContain('public.basket_line_stock_flag(v_product, v_qty, v_bundle, null)')
    expect(body).toContain('set stock_note = null, was_quantity = null, flagged_at = null')
    expect(code).toContain('grant execute on function public.accept_basket_flag(text, text) to authenticated;')
  })

  it('reminds an owner in-app, at most once a day, operator only', () => {
    const body = fn('remind_basket_owner')
    expect(body).toContain("public.current_persona() is distinct from 'operator'")
    expect(body).toContain("v_last > v_now - interval '24 hours'")
    expect(body).toContain("'inapp'")
    expect(body).toContain("'delivered'")
    expect(body).toContain('insert into public.notification_log')
    expect(body).toContain('set reminded_at = v_now')
    expect(code).toContain('create table if not exists public.cart_reminders')
    expect(code).toContain('grant execute on function public.remind_basket_owner(text, text) to authenticated;')
  })

  it('clears baskets untouched for 90 days and leaves a kept basket\'s bundle alone', () => {
    const night = fn('run_baskets_night')
    expect(night).toContain('(p_as_of - 90)::timestamptz')
    expect(night).toContain('public.flag_basket_stock(v_product)')
    expect(night).toContain("'flagged', v_flagged, 'cleared', v_baskets + v_carts")
    expect(night).toContain('not c.saved')
    const unused = fn('delete_unused_bundle_selections')
    expect(unused).toContain('from public.requisition_basket_lines rb where rb.bundle_selection_id = bs.id')
    for (const t of ['cart_items', 'enterprise_requisition_lines', 'order_items', 'subscriptions']) {
      expect(unused).toContain(`from public.${t} `)
    }
  })

  it('revokes every function the app does not call from the API', () => {
    for (const sig of [
      'basket_stock_left(text)', 'basket_line_stock_flag(text, integer, boolean, integer)',
      'flag_basket_stock(text)', 'products_flag_baskets()', 'inventory_flag_baskets()', 'stamp_cart_line()',
      'guard_flagged_cart_order_line()', 'guard_flagged_basket_requisition_line()',
      'requisition_basket_json(text)', 'run_baskets_night(date)',
      'delete_unused_bundle_selections(date)', 'run_nightly(date)',
    ]) {
      expect(code).toContain(`revoke all on function public.${sig} from public, anon, authenticated;`)
    }
    for (const sig of [
      'save_requisition_basket(text, jsonb)', 'clear_requisition_basket()',
      'accept_basket_flag(text, text)', 'remind_basket_owner(text, text)',
    ]) {
      expect(code).toContain(`revoke all on function public.${sig} from public, anon;`)
    }
  })

  it('seeds one help article for the Baskets screen and tells Scheduled jobs about the eighth job', () => {
    expect(code).toContain("if not exists (select 1 from kb_articles where view = 'op-baskets') then")
    expect(code).toContain("'baskets', 4")
    for (const words of ['pending', 'abandoned', 'only 3 left', 'no longer available', 'at most one a day', '90 days', 'never delete']) {
      expect(code).toContain(words)
    }
    expect(code).toContain("where view = 'op-jobs'")
    expect(code).toContain("'the eight jobs'")
    expect(code).toContain('baskets: every basket line')
  })
})
