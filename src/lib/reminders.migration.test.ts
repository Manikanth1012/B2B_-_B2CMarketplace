// 20261127400000, checked without a database: basket windows are operator
// settings per market, rules on dated events have steps (n−x / n+x), the
// night's eleventh job sends them once, and nothing starts sending by itself.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

const dir = new URL('../../supabase/migrations/', import.meta.url)
const strip = (s: string) => s.replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').toLowerCase()
const read = (f: string) => strip(readFileSync(new URL(f, dir), 'utf8'))
const code = read('20261127400000_reminders_on_a_schedule_and_basket_windows.sql')
const billing = read('20261126100000_subscriptions_billed_monthly_and_invoices_go_overdue.sql')
const baskets = read('20261113200000_a_basket_is_kept_and_watched.sql')

function fn(src: string, name: string): string {
  const at = src.indexOf(`create or replace function public.${name}(`)
  expect(at, `${name} is not defined here`).toBeGreaterThanOrEqual(0)
  const rest = src.slice(at)
  const open = rest.indexOf('$$')
  const close = rest.indexOf('$$', open + 2)
  return rest.slice(0, close + 2)
}
const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

describe('reminders on a schedule and basket windows, as a migration', () => {
  it('is one transaction that checks itself last, as the schedule, with rolled-back cases', () => {
    const c = code.trim()
    expect(c.startsWith('begin;')).toBe(true)
    expect(c.endsWith('commit;')).toBe(true)
    expect(code.match(/^begin;$/gm)?.length).toBe(1)
    expect(code.match(/^commit;$/gm)?.length).toBe(1)
    const last = code.slice(code.lastIndexOf('do $$'))
    expect(last).toContain('if not public.is_scheduler() then')
    expect(last.indexOf('if not public.is_scheduler() then')).toBeLessThan(last.indexOf('to_regclass'))
    expect(last).toContain("raise exception using errcode = 'zz999', message = 'rolling the reminders check back'")
    expect(last).toContain("raise exception using errcode = 'zz999', message = 'rolling the basket rules check back'")
    expect(last).toContain("exception when sqlstate 'zz999' then")
    expect(last).toContain("jsonb_array_length(dry -> 'jobs') <> 11")
    expect(last).toContain("(dry -> 'jobs' -> 10 ->> 'job') is distinct from 'reminders'")
    /* n−1 of clearing: one row, then none again, and none while off. */
    expect(last).toContain("l.step_id = 'nrs-b-bsk-clearing-m1' and l.subject_id = v_basket and l.anchor_date = current_date + 1")
    expect(last).toContain("if v_n <> 1 then")
    expect(last).toContain("(v_res ->> 'sent')::integer <> 0 or (v_res ->> 'already_sent')::integer < 1")
    expect(last).toContain("a step that is off sent something")
    expect(last).toContain("a step on a rule that is off sent something")
    /* Personas the way earlier self-checks do them. */
    expect(last).toContain("perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);")
    expect(last).toContain('set local role authenticated;')
    expect(last).toContain('reset role;')
    expect(last).toContain('exception when check_violation then')
  })

  it('keeps basket windows per market, 1 to 365 days, in order, seeded at 7, 7 and 90', () => {
    expect(code).toContain('create table if not exists public.basket_settings')
    for (const col of ['pending_days', 'abandoned_after_days', 'clear_after_days']) {
      expect(code).toMatch(new RegExp(`${col}\\s+integer not null default \\d+ check \\(${col} between 1 and 365\\)`))
    }
    expect(code).toContain('check (abandoned_after_days >= pending_days)')
    expect(code).toContain('check (clear_after_days > abandoned_after_days)')
    /* Named so as not to collide with postgres's `<table>_<col>_check`. */
    expect(code).not.toMatch(/constraint basket_settings_[a-z_]+_days_check/)
    expect(squash(code)).toContain("select 'default', 7, 7, 90, 'seeded by 20261127400000' union all select m.code, 7, 7, 90, 'seeded by 20261127400000' from public.markets m on conflict (market) do nothing")
    expect(code).toContain('create policy "read_basket_settings" on public.basket_settings for select to authenticated')
    expect(squash(code)).toContain(`create policy "operator_all_basket_settings" on public.basket_settings for all to authenticated using (current_persona() = 'operator') with check (current_persona() = 'operator')`)
  })

  it('audits every change to the basket windows in the operator audit log', () => {
    const a = squash(fn(code, 'audit_basket_settings'))
    expect(a).toContain('insert into public.operator_audit_log')
    expect(a).toContain("'basket_settings:' || ab.v_market, 'configuration'")
    expect(code).toContain('create trigger basket_settings_audit after insert or update or delete on public.basket_settings')
    const g = squash(fn(code, 'guard_basket_settings'))
    expect(g).toContain("if old.market = 'default' then")
    expect(g).toContain('not exists (select 1 from public.markets m where m.code = new.market)')
  })

  it('reads a market’s window, else the default', () => {
    const w = squash(fn(code, 'basket_window'))
    expect(w).toContain('returns public.basket_settings')
    expect(w).toContain("where s.market = p_market or s.market = 'default' order by (s.market = 'default'), s.market limit 1")
    const anchor = squash(fn(code, 'basket_anchor'))
    expect(anchor).toContain("when 'basket.abandoned' then ((p_last + make_interval(days => p_abandoned)) at time zone 'utc')::date")
    expect(anchor).toContain("when 'basket.clearing' then (p_last at time zone 'utc')::date + p_clear + 1")
  })

  it('clears baskets by the settings, and changes nothing else in run_baskets_night', () => {
    const now = squash(fn(code, 'run_baskets_night'))
    expect(now).not.toContain('p_as_of - 90')
    expect(now).toContain('(p_as_of - (public.basket_window(a.market)).clear_after_days)::timestamptz')
    expect(now).toContain('(p_as_of - (public.basket_window(m.market)).clear_after_days)::timestamptz')
    expect(now).toContain('select cp.market from public.consumer_profile cp where cp.user_id = s.user_id')
    const was = squash(fn(baskets, 'run_baskets_night'))
    /* Same guard, same flag loop, same return. */
    for (const part of [
      "if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then",
      'v_flagged := v_flagged + public.flag_basket_stock(v_product);',
      "return jsonb_build_object('ran_on', p_as_of, 'flagged', v_flagged, 'cleared', v_baskets + v_carts, 'cleared_baskets', v_baskets, 'cleared_carts', v_carts);",
      'delete from public.cart_items c where c.user_id = any (v_owners) and not c.saved;',
    ]) {
      expect(was).toContain(part)
      expect(now).toContain(part)
    }
  })

  it('adds the six dated events with an anchor', () => {
    expect(code).toContain('alter table public.notification_events add column if not exists anchor text;')
    for (const e of ['basket.abandoned', 'basket.clearing', 'invoice.due', 'subscription.renewal', 'agreement.notice', 'quote.expiry']) {
      expect(code).toMatch(new RegExp(`\\('${e.replace('.', '\\.')}',`))
    }
    expect(code).toContain('anchor = excluded.anchor')
  })

  it('puts steps on rules, ±30 days, on the rule’s channels, with a template per step and channel', () => {
    expect(code).toContain('create table if not exists public.notification_rule_steps')
    expect(code).toContain('offset_days integer not null check (offset_days between -30 and 30)')
    expect(code).toContain('enabled     boolean not null default false')
    const g = squash(fn(code, 'guard_rule_step'))
    expect(g).toContain('if not (new.kinds <@ v_kinds) then')
    expect(g).toContain('if v_anchor is null then')
    expect(code).toContain('create table if not exists public.notification_step_templates')
    expect(code).toContain('unique (step_id, kind_id)')
    expect(squash(fn(code, 'guard_step_template'))).toContain('if not (new.kind_id = any (v_kinds)) then')
    /* RLS as notification_rules and notification_templates. */
    expect(code).toContain('create policy "persona_read_notification_rule_steps" on public.notification_rule_steps')
    expect(code).toContain('create policy "operator_all_notification_rule_steps" on public.notification_rule_steps for all to authenticated')
    expect(code).toContain('create policy "operator_all_notification_step_templates" on public.notification_step_templates for all to authenticated')
  })

  it('logs each step, subject and anchor date once, and lets nobody write the log', () => {
    expect(code).toContain('create table if not exists public.notification_schedule_log')
    expect(code).toContain('unique (step_id, subject_id, anchor_date)')
    expect(code).toContain('revoke insert, update, delete on public.notification_schedule_log from authenticated;')
    expect(code).not.toMatch(/create policy "[^"]+" on public\.notification_schedule_log for (insert|update|delete|all)/)
  })

  it('sends each due step once, as the event path logs, respecting preferences and throttle', () => {
    const r = squash(fn(code, 'run_reminders'))
    expect(r).toContain("if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then")
    expect(r).toContain('where s.enabled and r.enabled and e.anchor is not null')
    expect(r).toContain('v_anchor := p_as_of - st.offset_days;')
    expect(r).toContain('l.step_id = st.id and l.subject_id = sub.s_subject and l.anchor_date = rr.v_anchor')
    expect(r).toContain('n_already := n_already + 1;')
    expect(r).toContain('from public.notification_preferences p where p.rule_id = st.rule_id')
    expect(r).toContain('if not v_pref.enabled and not st.mandatory then')
    expect(r).toContain("when 'at most once a day' then interval '1 day'")
    /* The columns enquiry_send writes, and its states. */
    expect(r).toContain('insert into public.notification_log (id, rule_id, kind_id, channel_id, persona, recipient, user_id, partner_id, subject, body, sent_at, state, detail, cost, ref)')
    expect(r).toContain("case when v_k = 'inapp' then 'delivered' else 'suppressed' end")
    expect(r).toContain("'no gateway is connected for ' || v_k")
    expect(r).toContain('on conflict (step_id, subject_id, anchor_date) do nothing')
    expect(r).toContain("'sent', n_sent, 'already_sent', n_already, 'skipped', n_pref + n_throttle + n_template")
    expect(code).toContain('revoke all on function public.run_reminders(date) from public, anon, authenticated;')
  })

  it('finds every dated event’s subjects from the columns that hold the dates', () => {
    const s = squash(fn(code, 'reminder_subjects'))
    expect(s).toContain('where i.due = p_anchor')
    expect(s).toContain('s.next_renewal = p_anchor')
    expect(s).toContain('es.renews = p_anchor')
    expect(s).toContain('(c.ends_on - c.notice_days) = p_anchor')
    expect(s).toContain("q.type = 'quote' and q.status = 'quoted' and q.valid_until = p_anchor")
    expect(s).toContain('public.basket_anchor(p_event, c.last_change, w.abandoned_after_days, w.clear_after_days) = p_anchor')
    expect(s).toContain('public.basket_anchor(p_event, b.updated_at, w.abandoned_after_days, w.clear_after_days) = p_anchor')
  })

  it('uses labelled blocks in its plpgsql functions', () => {
    for (const [name, label] of [['run_reminders', 'rr'], ['reminder_subjects', 'rs'], ['reminder_fill', 'rf'],
      ['guard_rule_step', 'gs'], ['guard_step_template', 'gt'], ['guard_basket_settings', 'gb'],
      ['audit_basket_settings', 'ab'], ['run_baskets_night', 'nt']]) {
      expect(fn(code, name), name).toContain(`<<${label}>>`)
    }
  })

  it('adds `reminders` to the night as the eleventh job, and changes nothing else in run_nightly', () => {
    const now = squash(fn(code, 'run_nightly'))
    const jobs = now.match(/foreach j in array array\[([^\]]+)\]/)
    expect(jobs![1].split(',').map(x => x.trim().replace(/'/g, ''))).toEqual([
      'agreements', 'enterprise subscriptions', 'subscriptions', 'documents', 'payments',
      'bundle selections', 'baskets', 'invoices', 'risk', 'settlements', 'reminders'])
    expect(now).toContain("when 'reminders' then public.run_reminders(p_as_of)")
    const was = squash(fn(billing, 'run_nightly'))
    expect(now
      .replace("'settlements', 'reminders']", "'settlements']")
      .replace(" when 'reminders' then public.run_reminders(p_as_of)", '')).toBe(was)
    expect(now).toContain('insert into public.scheduled_job_log (job, ran_on, started_at, finished_at, ok, result, error)')
  })

  it('seeds one rule per basket event and persona, with the spec’s steps and templates, all off', () => {
    const rules = code.slice(code.indexOf('insert into public.notification_rules'), code.indexOf('on conflict (id) do nothing;', code.indexOf('insert into public.notification_rules')))
    for (const id of ['nr-c-bsk-abandoned', 'nr-c-bsk-clearing', 'nr-b-bsk-abandoned', 'nr-b-bsk-clearing']) {
      expect(rules).toContain(`('${id}'`)
    }
    expect(rules).not.toMatch(/'(low|normal|high)', true,/)
    const steps = squash(code.slice(code.indexOf('insert into public.notification_rule_steps')))
    expect(steps).toContain("('nrs-c-bsk-abandoned-0', 'nr-c-bsk-abandoned', 0, array['inapp'], false, 1)")
    expect(steps).toContain("('nrs-c-bsk-clearing-m7', 'nr-c-bsk-clearing', -7, array['email'], false, 1)")
    expect(steps).toContain("('nrs-c-bsk-clearing-m1', 'nr-c-bsk-clearing', -1, array['email', 'whatsapp'], false, 2)")
    expect(steps).toContain("('nrs-b-bsk-clearing-m1', 'nr-b-bsk-clearing', -1, array['email', 'whatsapp'], false, 2)")
    expect(code).toContain("'nrs-c-bsk-clearing-m1-whatsapp', 'nrs-c-bsk-clearing-m1', 'whatsapp'")
  })

  it('tells the help the windows are settings and the night has eleven jobs', () => {
    expect(code).toContain("where view = 'op-baskets'")
    expect(code).toContain('basket rules on this screen')
    expect(code).toContain("'runs eleven jobs, one after the other'")
    expect(code).toContain('reminders: every scheduled step')
  })
})
