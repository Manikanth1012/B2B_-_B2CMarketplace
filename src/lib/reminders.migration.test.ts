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
    expect(last).toContain("(dry -> 'jobs' -> 0 ->> 'job') is distinct from 'reminders'")
    /* Throttle by day: deferred, then sent; history kept; the guard's limits; every subjects branch run. */
    expect(last).toContain("is distinct from 'deferred' then")
    expect(last).toContain('a deferred reminder was not sent once the throttle allowed it')
    expect(last).toContain('removing a step took its schedule history with it')
    expect(last).toContain('a deferred reminder whose step is off did not expire')
    /* The proof runs on a rule and step of its own, never on the seeded ones. */
    expect(last).toContain("values ('nr-selfcheck-b-clr', 'enterprise', 'basket.clearing'")
    expect(last).toContain("values ('nrs-selfcheck-m1', 'nr-selfcheck-b-clr', -1, array['email', 'whatsapp'], true, 1);")
    expect(last).not.toContain("'nrs-b-bsk-clearing-m1'")
    expect(last).not.toMatch(/update public\.notification_rule_steps s set enabled = false where s\.enabled;/)
    expect(last).toContain("if sqlerrm not like '%can only be scheduled up to the day itself%' then raise; end if;")
    expect(last).toContain("if sqlerrm not like '%no seller is on an agreement%' then raise; end if;")
    expect(last).toContain('perform count(*) from public.reminder_subjects(v_pair[1], v_pair[2], current_date);')
    for (const pair of ["array['basket.abandoned', 'consumer']", "array['basket.abandoned', 'enterprise']",
      "array['basket.clearing', 'consumer']", "array['basket.clearing', 'enterprise']", "array['invoice.due', 'enterprise']",
      "array['subscription.renewal', 'consumer']", "array['subscription.renewal', 'enterprise']",
      "array['agreement.notice', 'enterprise']", "array['quote.expiry', 'enterprise']"]) {
      expect(last).toContain(pair)
    }
    /* n−1 of clearing: one row, then none again, and none while off. */
    expect(last).toContain("l.step_id = 'nrs-selfcheck-m1' and l.subject_id = v_basket and l.anchor_date = current_date + 1")
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
    expect(squash(code)).toContain("select v.market, 7, 7, 90, 'seeded by 20261127400000' from (select 'default'::text as market union all select m.code from public.markets m) v where not exists (select 1 from public.basket_settings s) on conflict do nothing;")
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
    expect(anchor).toContain("when 'basket.abandoned' then (p_last at time zone 'utc')::date + p_abandoned + 1")
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
    expect(g).toContain("if new.offset_days > 0 and v_event in ('subscription.renewal', 'agreement.notice', 'basket.clearing') then")
    expect(g).toContain("if v_event = 'agreement.notice' and v_persona = 'partner' then")
    expect(code).toContain('create table if not exists public.notification_step_templates')
    expect(code).toContain('unique (step_id, kind_id)')
    expect(squash(fn(code, 'guard_step_template'))).toContain('if not (new.kind_id = any (v_kinds)) then')
    /* RLS as notification_rules and notification_templates. */
    expect(code).toContain('create policy "persona_read_notification_rule_steps" on public.notification_rule_steps')
    expect(code).toContain('create policy "operator_all_notification_rule_steps" on public.notification_rule_steps for all to authenticated')
    expect(code).toContain('create policy "operator_all_notification_step_templates" on public.notification_step_templates for all to authenticated')
  })

  it('logs each step, subject and anchor date once, keeps it when the step goes, and lets nobody write the log', () => {
    expect(code).toContain('create table if not exists public.notification_schedule_log')
    expect(code).toContain('step_id          text references public.notification_rule_steps(id) on delete set null,')
    expect(code).toContain('step_label       text not null,')
    expect(code).toContain('due_on           date not null,')
    expect(code).toContain("check (outcome in ('claimed', 'sent', 'deferred', 'expired', 'skipped_preference', 'skipped_no_template'))")
    expect(code).toContain('unique (step_id, subject_id, anchor_date)')
    expect(code).toContain('revoke insert, update, delete on public.notification_schedule_log from authenticated;')
    expect(code).not.toMatch(/create policy "[^"]+" on public\.notification_schedule_log for (insert|update|delete|all)/)
  })

  it('sends each due step once, as the event path logs, respecting preferences and throttle', () => {
    const r = squash(fn(code, 'run_reminders'))
    expect(r).toContain("if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then")
    expect(r).toContain('where s.enabled and r.enabled and e.anchor is not null')
    expect(r).toContain('v_anchor := p_as_of - st.offset_days;')
    /* Claimed first, then sent: a second run, or one alongside, finds the row. */
    expect(r).toContain("c.s_subject, c.anchor, c.anchor + st.offset_days, p_as_of, 'claimed', c.s_recipient, c.s_user, c.s_partner, c.s_ref) on conflict do nothing returning id into v_log;")
    expect(r.indexOf("'claimed', c.s_recipient")).toBeLessThan(r.indexOf('insert into public.notification_log'))
    expect(r).toContain('if v_log is null then n_already := n_already + 1; continue; end if;')
    expect(r).toContain("set outcome = 'claimed', updated_at = now() where h.id = c.log_id and h.outcome = 'deferred' returning h.id into v_log;")
    expect(r).toContain('from public.notification_preferences p where p.rule_id = st.rule_id')
    expect(r).toContain('if not v_pref.enabled and not st.mandatory then')
    /* The throttle by day, per rule and subject, counting only what went. */
    expect(r).toContain("when 'at most once a day' then 1")
    expect(r).toContain("when 'digest — weekly' then 7")
    expect(r).toContain("and h.subject_id = c.s_subject and h.user_id is not distinct from c.s_user")
    expect(r).toContain("and l.state in ('delivered', 'sent', 'queued') and (l.sent_at at time zone 'utc')::date > p_as_of - rr.v_days) then v_outcome := 'deferred';")
    /* Deferred rows expire when their step goes or is off, when they are more than 7 days past due (kept on the
       row), or when a reminder before the date meets the date. */
    expect(r).toContain('c.s_subject, c.anchor, c.anchor + st.offset_days, p_as_of')
    expect(r).toContain("where h.outcome = 'deferred' and (h.step_id is null or not exists (select 1 from public.notification_rule_steps s join public.notification_rules r on r.id = s.rule_id where s.id = h.step_id and s.enabled and r.enabled) or (h.offset_days < 0 and h.anchor_date <= p_as_of) or h.due_on < p_as_of - 7);")
    /* The columns enquiry_send writes, and its states. */
    expect(r).toContain('insert into public.notification_log (id, rule_id, kind_id, channel_id, persona, recipient, user_id, partner_id, subject, body, sent_at, state, detail, cost, ref)')
    expect(r).toContain("case when v_k = 'inapp' then 'delivered' else 'suppressed' end")
    expect(r).toContain("'no gateway is connected for ' || v_k")
    expect(r).toContain("'sent', n_sent, 'already_sent', n_already, 'skipped', n_pref + n_template")
    expect(r).toContain("'deferred', n_deferred, 'expired', n_expired, 'messages', n_messages, 'delivered', n_delivered, 'suppressed', n_suppress")
    expect(r).toContain("'days_left', public.reminder_days_left(c.anchor - p_as_of)")
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
    /* Money in the money it is billed in. */
    expect(s).toContain("'amount', public.money_text(i.total, coalesce(i.currency, a.currency))")
    expect(s).toContain("'amount', public.money_text(es.monthly, coalesce(es.currency, a.currency))")
  })

  it('uses labelled blocks in its plpgsql functions', () => {
    for (const [name, label] of [['run_reminders', 'rr'], ['reminder_subjects', 'rs'], ['reminder_fill', 'rf'],
      ['guard_rule_step', 'gs'], ['guard_step_template', 'gt'], ['guard_basket_settings', 'gb'],
      ['audit_basket_settings', 'ab'], ['run_baskets_night', 'nt']]) {
      expect(fn(code, name), name).toContain(`<<${label}>>`)
    }
  })

  it('adds `reminders` to the night first, as the eleventh job, and changes nothing else in run_nightly', () => {
    const now = squash(fn(code, 'run_nightly'))
    const jobs = now.match(/foreach j in array array\[([^\]]+)\]/)
    expect(jobs![1].split(',').map(x => x.trim().replace(/'/g, ''))).toEqual([
      'reminders', 'agreements', 'enterprise subscriptions', 'subscriptions', 'documents', 'payments',
      'bundle selections', 'baskets', 'invoices', 'risk', 'settlements'])
    expect(now).toContain("when 'reminders' then public.run_reminders(p_as_of)")
    const was = squash(fn(billing, 'run_nightly'))
    expect(now
      .replace("array['reminders', 'agreements'", "array['agreements'")
      .replace(" when 'reminders' then public.run_reminders(p_as_of)", '')).toBe(was)
    expect(now).toContain('insert into public.scheduled_job_log (job, ran_on, started_at, finished_at, ok, result, error)')
  })

  it('seeds one rule per basket event and persona, with the spec\u2019s steps and templates, all off, once', () => {
    const seed = squash(code.slice(code.indexOf('insert into public.notification_rules (id, persona'), code.indexOf('update kb_articles')))
    for (const id of ['nr-c-bsk-abandoned', 'nr-c-bsk-clearing', 'nr-b-bsk-abandoned', 'nr-b-bsk-clearing']) {
      expect(seed).toContain(`('${id}'`)
    }
    expect(seed).toContain("select v.id, v.persona, v.event_id, v.name, v.audience, v.kinds, 'every time', v.severity, false, false, v.why, null, v.sort_order")
    expect(seed).toContain("('nrs-c-bsk-abandoned-0', 'nr-c-bsk-abandoned', 0, array['inapp'], 1)")
    expect(seed).toContain("('nrs-c-bsk-clearing-m7', 'nr-c-bsk-clearing', -7, array['email'], 1)")
    expect(seed).toContain("('nrs-c-bsk-clearing-m1', 'nr-c-bsk-clearing', -1, array['email', 'whatsapp'], 2)")
    expect(seed).toContain("('nrs-b-bsk-clearing-m1', 'nr-b-bsk-clearing', -1, array['email', 'whatsapp'], 2)")
    expect(seed).toContain('select v.id, v.rule_id, v.offset_days, v.kinds, false, v.sort_order')
    expect(seed).toContain("'nrs-c-bsk-clearing-m1-whatsapp', 'nrs-c-bsk-clearing-m1', 'whatsapp'")
    /* Not leaning on ON CONFLICT, whose target a BEFORE INSERT guard runs ahead of; nothing removed comes back. */
    expect(seed).not.toMatch(/on conflict \(/)
    expect(seed.match(/on conflict do nothing;/g)?.length).toBe(4)
    expect(seed).toContain("where coalesce(current_setting('aventa.seed_basket_rules', true), '') = 'on' and not exists (select 1 from public.notification_rules r where r.id = v.id or (r.persona = v.persona and r.event_id = v.event_id))")
    expect(seed).toContain("where coalesce(current_setting('aventa.seed_basket_rules', true), '') = 'on' and exists (select 1 from public.notification_rules r where r.id = v.rule_id and v.kinds <@ r.kinds) and not exists (select 1 from public.notification_rule_steps s where s.rule_id = v.rule_id)")
    expect(seed).toContain('where s.id = v.step_id and s.created_at = now() and v.kind_id = any (s.kinds))')
    expect(seed).toContain('or (t.step_id = v.step_id and t.kind_id = v.kind_id)')
    expect(code).toContain("select set_config('aventa.seed_basket_rules',")
    expect(code.indexOf("select set_config('aventa.seed_basket_rules',")).toBeLessThan(code.indexOf('insert into public.notification_events'))
  })

  it('tells the help the windows are settings and the night has eleven jobs', () => {
    expect(code).toContain("where view = 'op-baskets'")
    expect(code).toContain('basket rules on this screen')
    expect(code).toContain("'runs eleven jobs, one after the other'")
    expect(code).toContain('reminders, first, before any job below moves a date')
    expect(code).toContain('only set how this screen describes pending')
  })
})
