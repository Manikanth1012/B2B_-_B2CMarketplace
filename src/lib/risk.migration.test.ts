// 20261113600000, checked without a database: orders and accounts scored for
// risk, a held order hidden from its seller and frozen until the marketplace
// decides it, and the tenth nightly job (spec 13).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const dir = new URL('../../supabase/migrations/', import.meta.url)
const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').toLowerCase()
const read = (name: string) => strip(readFileSync(new URL(name, dir), 'utf8'))

const risk = read('20261113600000_orders_and_accounts_are_scored_for_risk.sql')
const bundle = read('20261113100000_a_bundle_is_bought_whole.sql')
const billing = read('20261113400000_a_business_is_invoiced_for_what_it_ordered.sql')
const fulfil = read('20260804160000_a_guard_that_asks_who_you_are_has_to_handle_nobody.sql')
const opEdit = read('20260807500000_the_marketplace_could_read_every_order_and_move_none.sql')
const policies = read('20260804150000_the_seller_order_policy_must_not_ask_a_question_that_asks_it_back.sql')

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
/** `s` without the first stretch that starts with `from` and ends with `to`. */
function cut(s: string, from: string, to: string): string {
  const i = s.indexOf(from)
  expect(i, `no "${from}"`).toBeGreaterThanOrEqual(0)
  const j = s.indexOf(to, i)
  expect(j, `no "${to}" after "${from}"`).toBeGreaterThan(i)
  return s.slice(0, i) + s.slice(j + to.length)
}

describe('risk scoring, as a migration', () => {
  it('is one transaction that checks itself last, rolled back, as the scheduler, with a ten-job dry run', () => {
    expect(risk.trim().startsWith('begin;')).toBe(true)
    expect(risk.trim().endsWith('commit;')).toBe(true)
    expect(risk.match(/^begin;$/gm)?.length).toBe(1)
    expect(risk.match(/^commit;$/gm)?.length).toBe(1)
    const last = risk.slice(risk.lastIndexOf('do $$'))
    expect(last).toContain('if not public.is_scheduler() then')
    expect(last).toContain("raise exception using errcode = 'zz999'")
    expect(last).toContain("exception when sqlstate 'zz999' then")
    expect(last).toContain('dry := public.run_nightly(current_date);')
    expect(last).toContain("jsonb_array_length(dry -> 'jobs') <> 10")
    expect(last).toContain("(dry -> 'jobs' -> 8 ->> 'job') is distinct from 'risk'")
  })

  it('creates the five tables with RLS, an operator read and no write policy', () => {
    for (const t of ['risk_rules', 'risk_settings', 'order_risk', 'account_risk', 'risk_rule_changes']) {
      expect(risk).toContain(`create table if not exists public.${t} (`)
      expect(risk).toContain(`alter table public.${t} enable row level security;`)
      expect(risk).toMatch(new RegExp(`create policy "operator_read_${t}" on public\\.${t} for select to authenticated\\s+using \\(public\\.current_persona\\(\\) = 'operator'\\)`))
      expect(risk).not.toMatch(new RegExp(`on public\\.${t} for (insert|update|delete|all)`))
    }
    const flat = squash(risk)
    expect(flat).toContain("applies text not null check (applies in ('order', 'account'))")
    expect(flat).toContain("kind text primary key check (kind in ('order', 'account'))")
    expect(flat).toContain('check (review_at < hold_at)')
    expect(flat).toContain('order_id uuid primary key references public.orders(id) on delete cascade')
    expect(flat).toContain("band text not null check (band in ('low', 'review', 'hold'))")
    expect(flat).toContain("band text not null check (band in ('low', 'review', 'high'))")
    expect(flat).toContain("decision text check (decision in ('released', 'cancelled'))")
    expect(flat).toContain("kind text not null check (kind in ('shopper', 'business'))")
    expect(flat).toContain('primary key (kind, id)')
    // never a hand-named <table>_<col>_check
    expect(risk).not.toMatch(/constraint (risk_rules|risk_settings|order_risk|account_risk|risk_rule_changes)_[a-z_]+_check\b/)
  })

  it('seeds every rule once, with stable ids, its points and thresholds, and the bands at 40 and 70', () => {
    const seeds: [string, number, string][] = [
      ['o-account-review', 15, 'null'], ['o-account-high', 30, 'null'], ['o-new-account', 20, '7'],
      ['o-first-order', 10, 'null'], ['o-big-order', 25, '3'], ['o-sim-line', 15, 'null'],
      ['o-sim-new-address', 30, 'null'], ['o-guest', 15, 'null'], ['o-failed-payments', 25, '2'],
      ['o-burst', 20, '3'], ['o-carrier-emi', 10, '200'],
      ['a-refunds', 10, '30'], ['a-disputes', 25, 'null'], ['a-failed-payments', 5, '20'],
      ['a-bursts', 15, '5'], ['a-over-credit', 20, 'null'], ['a-overdue', 15, 'null'],
    ]
    for (const [id, points, threshold] of seeds) {
      const applies = id.startsWith('o-') ? 'order' : 'account'
      expect(squash(risk)).toMatch(new RegExp(`\\('${id}', '${applies}', '[^']+', ${points}, true, ${threshold}, `))
    }
    expect(risk).toContain("('order', 40, 70)")
    expect(risk).toContain("('account', 40, 70)")
    expect(risk.match(/on conflict \(id\) do nothing;/g)?.length).toBeGreaterThanOrEqual(1)
    expect(risk).toContain('on conflict (kind) do nothing;')
  })

  it('scores an order from enabled rules only, with the buyer\'s account band, and a guest has none', () => {
    const s = squash(fn(risk, 'score_order'))
    expect(s).toContain('returns jsonb language plpgsql stable security definer')
    expect(s).toContain("where r.applies = 'order' and r.enabled")
    expect(s).toContain("ar.kind = 'shopper' and ar.id = v_o.user_id::text")
    expect(s).toContain("if v_band_acct = 'review' then")
    expect(s).toContain("if v_band_acct = 'high' then")
    expect(s).toContain('if v_o.user_id is null then')
    expect(s).toContain("e.status not in ('awaiting_payment', 'cancelled', 'failed')")
    expect(s).toContain('percentile_cont(0.5) within group (order by e.total)')
    expect(s).toContain("i.fulfil = 'esim'")
    expect(s).toContain('e.shipping_address = v_o.shipping_address')
    expect(s).toContain("pa.state = 'failed'")
    expect(s).toContain("v_o.payment_method in ('carrier_billing', 'emi')")
    expect(s).toContain("f.base = 'usd' and f.quote = v_o.currency")
    expect(s).toContain("'score', v_score, 'band', v_band, 'reasons', v_reasons")
    expect(s).toContain("jsonb_build_object('rule', rr.id, 'label', rr.label, 'points', v_pts)")
  })

  it('scores an account from enabled rules only, the business rules only for a business', () => {
    const s = squash(fn(risk, 'score_account_on'))
    expect(s).toContain('returns jsonb language plpgsql stable security definer')
    expect(s).toContain("where r.applies = 'account' and r.enabled")
    expect(s).toContain('from public.refunds f')
    expect(s).toContain('from public.disputes d')
    expect(s).toContain('p_as_of - 90')
    expect(s).toContain('p_as_of - 180')
    expect(s).toContain('p_as_of - 30')
    expect(s).toContain('least(v_pts, rr.threshold::integer)')
    expect(s).toContain("p_kind = 'business' and exists (select 1 from public.account_exposure(p_id) x")
    expect(s).toContain('x.total > b.credit_limit')
    expect(s).toContain("i.status = 'overdue' or (i.status = 'open' and i.due < p_as_of)")
    expect(squash(fn(risk, 'score_account'))).toContain('public.score_account_on(p_kind, p_id, current_date)')
  })

  it('rescores every account for the operator or the schedule, and says how many in each band', () => {
    const s = squash(fn(risk, 'refresh_account_risk'))
    expect(s).toContain("public.current_persona() is distinct from 'operator' and not public.is_scheduler()")
    expect(s).toContain('p_as_of > current_date')
    expect(s).toContain('from public.enterprise_accounts ea')
    expect(s).toContain('from public.payment_attempts pa')
    expect(s).toContain('on conflict (kind, id) do update')
    expect(s).toContain("jsonb_build_object('ran_on', p_as_of, 'scored', n_scored, 'review', n_review, 'high', n_high)")
  })

  it('scores each shopper order when its payment settles, holds the hold band, and changes nothing else', () => {
    const now = squash(fn(risk, 'settle_payment_attempt'))
    const block = now.slice(now.indexOf('<<risk>>'), now.indexOf('end risk;'))
    expect(block).toContain("o.payment_ref = a.reference and o.status = 'placed' and o.account_id is null")
    expect(block).toContain('v_s := public.score_order(v_o.id);')
    expect(block).toContain('insert into public.order_risk')
    expect(block).toContain("if v_s ->> 'band' = 'hold' then")
    expect(block).toContain("update public.orders set status = 'held' where id = v_o.id and status = 'placed';")
    expect(block).toContain('exception when others then raise warning')
    expect(now).toContain("'tenure_months', p_tenure, 'held', to_jsonb(v_held));")
    // The latest copy, with only the scoring added.
    const was = squash(fn(bundle, 'settle_payment_attempt'))
    const back = cut(now, ' <<risk>>', 'end risk;')
      .replace(" v_held text[] := '{}';", '')
      .replace("'tenure_months', p_tenure, 'held', to_jsonb(v_held));", "'tenure_months', p_tenure);")
    expect(back).toBe(was)
  })

  it('lets the operator release or cancel a held order, with a note, refunding each line on cancel', () => {
    const s = squash(fn(risk, 'decide_held_order'))
    expect(s).toContain("public.current_persona() is distinct from 'operator'")
    expect(s).toContain("p_decision not in ('release', 'cancel')")
    expect(s).toContain('if v_note is null then')
    expect(s).toContain("if o.status is distinct from 'held' then")
    expect(s).toContain("perform set_config('aventa.risk_decision', 'on', true);")
    expect(s).toContain("perform set_config('aventa.risk_decision', 'off', true);")
    expect(s).toContain("set status = 'placed'")
    expect(s).toContain("set status = 'cancelled'")
    expect(s).toContain('insert into public.refunds')
    expect(s).toContain("'cancelled', 'cancelled by the marketplace after a fraud review.',")
    expect(s).toContain("current_date, 'marketplace', current_date, 'approved', current_date, v_by, 'cancelled after a fraud review: ' || v_note")
    expect(s).toContain("'consumer'")
    expect(s).toContain('round(i.price * i.quantity, 2)')
    expect(s).toContain('o.user_id')
    expect(s).toContain('o.currency')
    expect(s).toContain('on conflict (order_id) do update')
  })

  it('checks a rule edit and a band edit as the screen does, and audits both', () => {
    const r = squash(fn(risk, 'update_risk_rule'))
    expect(r).toContain("public.current_persona() is distinct from 'operator'")
    expect(r).toContain('p_points < -50 or p_points > 100')
    expect(r).toContain("p_threshold::text in ('nan', 'infinity', '-infinity')")
    expect(r).toContain('p_threshold <= 0')
    expect(r).toContain('insert into public.risk_rule_changes')
    const b = squash(fn(risk, 'set_risk_bands'))
    expect(b).toContain("public.current_persona() is distinct from 'operator'")
    expect(b).toContain('p_review_at < 1 or p_review_at > 100')
    expect(b).toContain('p_review_at >= p_hold_at')
    expect(b).toContain('insert into public.risk_rule_changes')
  })

  it('hides a held order from its seller (latest policies, held added)', () => {
    expect(policies).toContain('using (partner_supplies_order(id));')
    expect(policies).toContain('using (partner_supplies_order(order_id));')
    expect(squash(risk)).toContain("create policy partner_read_own_orders on orders for select to authenticated using (partner_supplies_order(id) and status <> 'held');")
    expect(squash(risk)).toContain('create policy partner_read_own_order_items on order_items for select to authenticated using (partner_supplies_order(order_id) and not public.order_is_held(order_id));')
    expect(squash(risk)).toContain('create policy partner_read_order_part on order_part for select using (public.partner_supplies_order(order_id) and not public.order_is_held(order_id));')
  })

  it('freezes a held order in both guards (latest copies, held check added) and for everybody else', () => {
    const held = " if old.status = 'held'"
    for (const [name, src] of [['guard_order_fulfilment', fulfil], ['guard_operator_order_edit', opEdit]] as const) {
      const now = squash(fn(risk, name))
      expect(now).toContain("coalesce(current_setting('aventa.risk_decision', true), '') <> 'on'")
      expect(now).toContain('new.stage is distinct from old.stage')
      expect(cut(now, held, ' end if;')).toBe(squash(fn(src, name)))
    }
    const g = squash(fn(risk, 'guard_held_order'))
    expect(g).toContain("if public.current_persona() in ('partner', 'operator') then return new; end if;")
    expect(g).toContain("coalesce(current_setting('aventa.risk_decision', true), '') <> 'on'")
    expect(risk).toContain('create trigger z_guard_held_order before update on public.orders')
  })

  it('adds `risk` to the night after invoices, and changes nothing else in run_nightly', () => {
    const now = squash(fn(risk, 'run_nightly'))
    expect(now).toContain("'invoices', 'risk', 'settlements'")
    expect(now).toContain("when 'risk' then public.refresh_account_risk(p_as_of)")
    const was = squash(fn(billing, 'run_nightly'))
    expect(now
      .replace("'invoices', 'risk', 'settlements'", "'invoices', 'settlements'")
      .replace(" when 'risk' then public.refresh_account_risk(p_as_of)", '')).toBe(was)
  })

  it('keeps the scoring off the API and grants only what the Risk screen calls', () => {
    for (const sig of ['score_order(uuid)', 'score_account(text, text)', 'score_account_on(text, text, date)',
      'risk_operator_name()', 'guard_held_order()', 'run_nightly(date)']) {
      expect(risk).toContain(`revoke all on function public.${sig} from public, anon, authenticated;`)
    }
    for (const sig of ['decide_held_order(text, text, text)', 'update_risk_rule(text, integer, boolean, numeric)',
      'set_risk_bands(text, integer, integer)', 'refresh_account_risk(date)', 'order_is_held(uuid)']) {
      expect(risk).toContain(`revoke all on function public.${sig} from public, anon;`)
      expect(risk).toContain(`grant execute on function public.${sig} to authenticated;`)
    }
  })

  it('writes the Risk help article once and tells the Scheduled jobs article about ten jobs', () => {
    expect(risk).toContain("if not exists (select 1 from kb_articles where view = 'op-risk') then")
    expect(risk).toContain("'op-risk'")
    expect(risk).toContain("'the ten jobs'")
    expect(risk).toContain('risk: every')
    expect(risk).toContain("body::text not like '%risk: every%'")
  })
})
