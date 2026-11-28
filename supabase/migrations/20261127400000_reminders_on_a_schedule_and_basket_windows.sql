/*
 * Reminders on a schedule, and basket windows the operator sets.
 *
 * Spec 19, sections 1 and 2
 * (docs/superpowers/specs/2026-11-27-scheduled-reminders-and-basket-windows-design.md).
 * Applies after 20261127200000.
 *
 *   1. `basket_settings`: one row per market plus a `default` row, holding
 *      pending_days, abandoned_after_days and clear_after_days. Seeded 7, 7
 *      and 90 for the default and every market, so nothing moves. Read by
 *      anybody signed in; written by the operator only; every change is
 *      written to `operator_audit_log` by a trigger. `basket_window(market)`
 *      is the row that applies: the market's own, else the default.
 *
 *   2. The night's `baskets` job (`run_baskets_night`) clears by the setting
 *      instead of a hard-coded 90 days: a shopper's basket by the shopper's
 *      market (`consumer_profile.market`), a business basket by its
 *      account's home market (`enterprise_accounts.market`).
 *
 *   3. Dated events. `notification_events.anchor` names the date an event is
 *      measured from; six events carry one: basket.abandoned,
 *      basket.clearing, invoice.due, subscription.renewal, agreement.notice
 *      and quote.expiry.
 *
 *   4. Steps. `notification_rule_steps` puts a rule on a dated event on a
 *      schedule: an offset (n−30 … n+30), a subset of the rule's channels, on
 *      or off. What a step says is in `notification_step_templates`, one per
 *      step and channel. `notification_schedule_log` records what each step
 *      did for each subject and anchor date, once (unique).
 *
 *   5. `run_reminders(p_as_of)`: every step that is on, of a rule that is on,
 *      sent to every subject whose anchor + offset is `p_as_of`, once; the
 *      rule's throttle and mandatory flag and the recipient's preferences
 *      respected; logged in `notification_log` as the event path logs
 *      (`enquiry_send`, 20261105100000). The night's eleventh job,
 *      `reminders`.
 *
 *   6. One rule per basket event and persona (shopper, business buyer), with
 *      the spec's default steps and templates, every one of them off.
 *
 *   7. The help: the Baskets article and the Scheduled jobs article.
 *
 * Idempotent, one transaction, self-check last (with rolled-back cases).
 */

begin;

/* ================================================ 1. basket windows -- */

create table if not exists public.basket_settings (
  /* A market code, or 'default' for every market without a row of its own. */
  market               text primary key,
  /* Pending: changed within this many days. */
  pending_days         integer not null default 7 check (pending_days between 1 and 365),
  /* Abandoned: untouched for this many days or more. */
  abandoned_after_days integer not null default 7 check (abandoned_after_days between 1 and 365),
  /* Cleared by the night once untouched for longer than this. */
  clear_after_days     integer not null default 90 check (clear_after_days between 1 and 365),
  updated_at           timestamptz not null default now(),
  updated_by           text,
  constraint basket_settings_abandoned_not_before_pending check (abandoned_after_days >= pending_days),
  constraint basket_settings_clearing_after_abandoned check (clear_after_days > abandoned_after_days)
);

comment on table public.basket_settings is
  'How long a basket is pending, when it counts as abandoned, and when the night clears it, per market (or ''default''). Written by the operator only; every change is in operator_audit_log.';

/* The key is a market or 'default'; the default row is never removed, and a
   row's market never changes (remove it and add another). */
create or replace function public.guard_basket_settings() returns trigger
language plpgsql security definer set search_path = public as $$
<<gb>>
begin
  if tg_op = 'DELETE' then
    if old.market = 'default' then
      raise exception 'The default basket rules cannot be removed: every market without its own falls back to them.';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.market is distinct from old.market then
    raise exception 'Basket rules belong to one market. Remove these and add rules for % instead.', new.market;
  end if;
  if new.market is null or (new.market <> 'default'
                            and not exists (select 1 from public.markets m where m.code = new.market)) then
    raise exception 'Basket rules are set for a market or as the default, and % is neither.', coalesce(new.market, 'nothing');
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(
    (select ou.name from public.operator_users ou
       join auth.users au on lower(au.email) = lower(ou.email)
      where au.id = auth.uid() limit 1),
    (select au.email::text from auth.users au where au.id = auth.uid()),
    new.updated_by);
  return new;
end $$;

revoke all on function public.guard_basket_settings() from public, anon, authenticated;

drop trigger if exists basket_settings_guard on public.basket_settings;
create trigger basket_settings_guard before insert or update or delete on public.basket_settings
  for each row execute function public.guard_basket_settings();

/* Every change, in the operator's audit log. The migration's own seed (the
   session setting `aventa.seeding`) is not a change anybody made. */
create or replace function public.audit_basket_settings() returns trigger
language plpgsql security definer set search_path = public as $$
<<ab>>
declare
  v_actor  text;
  v_before text;
  v_after  text;
  v_market text;
begin
  if coalesce(current_setting('aventa.seeding', true), '') = 'on' then
    return null;
  end if;
  if tg_op = 'DELETE' then
    v_market := old.market;
  else
    v_market := new.market;
  end if;
  if tg_op <> 'INSERT' then
    v_before := format('pending %s, abandoned after %s, clear after %s days',
                       old.pending_days, old.abandoned_after_days, old.clear_after_days);
  end if;
  if tg_op <> 'DELETE' then
    v_after := format('pending %s, abandoned after %s, clear after %s days',
                      new.pending_days, new.abandoned_after_days, new.clear_after_days);
  end if;
  if tg_op = 'UPDATE' and v_before = v_after then
    return null;
  end if;

  v_actor := coalesce(
    (select ou.name from public.operator_users ou
       join auth.users au on lower(au.email) = lower(ou.email)
      where au.id = auth.uid() limit 1),
    (select au.email::text from auth.users au where au.id = auth.uid()),
    'Database session');

  insert into public.operator_audit_log
    (id, when_ts, actor, role, action, object, category, severity, before_val, after_val, outcome)
  values
    ('AUD-BSK-' || replace(gen_random_uuid()::text, '-', ''), now(), v_actor, 'Marketplace operations',
     case tg_op when 'INSERT' then 'Basket rules added'
                when 'UPDATE' then 'Basket rules changed'
                else 'Basket rules removed' end,
     'basket_settings:' || ab.v_market, 'Configuration', 'info', v_before, v_after, 'success');
  return null;
end $$;

revoke all on function public.audit_basket_settings() from public, anon, authenticated;

drop trigger if exists basket_settings_audit on public.basket_settings;
create trigger basket_settings_audit after insert or update or delete on public.basket_settings
  for each row execute function public.audit_basket_settings();

/* Today's numbers, for the default and every market, so nothing moves. */
select set_config('aventa.seeding', 'on', true);
insert into public.basket_settings (market, pending_days, abandoned_after_days, clear_after_days, updated_by)
select 'default', 7, 7, 90, 'Seeded by 20261127400000'
union all
select m.code, 7, 7, 90, 'Seeded by 20261127400000' from public.markets m
on conflict (market) do nothing;
select set_config('aventa.seeding', '', true);

alter table public.basket_settings enable row level security;

drop policy if exists "read_basket_settings"         on public.basket_settings;
drop policy if exists "operator_all_basket_settings" on public.basket_settings;

create policy "read_basket_settings" on public.basket_settings for select to authenticated
  using (true);
create policy "operator_all_basket_settings" on public.basket_settings for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

revoke all on public.basket_settings from anon;
grant select, insert, update, delete on public.basket_settings to authenticated;

/* The rules that apply in a market: its own row, else the default. The
   returned `market` says which ('default' when it fell back). */
create or replace function public.basket_window(p_market text)
returns public.basket_settings language sql stable security definer set search_path = public as $$
  select s.*
    from public.basket_settings s
   where s.market = p_market or s.market = 'default'
   order by (s.market = 'default'), s.market
   limit 1
$$;

revoke all on function public.basket_window(text) from public, anon;
grant execute on function public.basket_window(text) to authenticated;

/* The date a basket's event falls on, from its last change (UTC):
     basket.abandoned  the day it has been untouched for abandoned_after_days;
     basket.clearing   the night that clears it. The night clears a basket
                       whose last change is before (night − clear_after_days)
                       at 00:00, so a basket last changed on day D is cleared
                       on the night of D + clear_after_days + 1. */
create or replace function public.basket_anchor(p_event text, p_last timestamptz, p_abandoned integer, p_clear integer)
returns date language sql immutable set search_path = public as $$
  select case p_event
           when 'basket.abandoned' then ((p_last + make_interval(days => p_abandoned)) at time zone 'UTC')::date
           when 'basket.clearing'  then (p_last at time zone 'UTC')::date + p_clear + 1
         end
$$;

revoke all on function public.basket_anchor(text, timestamptz, integer, integer) from public, anon;
grant execute on function public.basket_anchor(text, timestamptz, integer, integer) to authenticated;

/* ====================================================== 2. the night -- */

/* `run_baskets_night`, copied from 20261113200000 (its latest definition).
   Changed only: the 90-day cut is each basket's market's clear_after_days
   (`basket_window`): a business basket by its account's home market, a
   shopper's by the shopper's market.

   The stock flag again over every product on any basket line (a safety net
   for a write that went around the triggers), then the baskets nobody has
   touched for their market's clear_after_days: a business basket by its
   `updated_at`, a shopper's by the newest `updated_at` among its lines that
   are not saved for later (those lines go; what was saved for later stays).
   Returns {ran_on, flagged, cleared, cleared_baskets, cleared_carts}. */
create or replace function public.run_baskets_night(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
<<nt>>
declare
  v_product text;
  v_flagged integer := 0;
  v_baskets integer := 0;
  v_carts   integer := 0;
  v_owners  uuid[];
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, looks after the baskets.';
  end if;

  for v_product in
    select c.product_id from public.cart_items c where c.product_id is not null
    union
    select l.product_id from public.requisition_basket_lines l
    order by 1
  loop
    v_flagged := v_flagged + public.flag_basket_stock(v_product);
  end loop;

  delete from public.requisition_baskets b
   using public.enterprise_accounts a
   where a.id = b.account_id
     and b.updated_at < (p_as_of - (public.basket_window(a.market)).clear_after_days)::timestamptz;
  get diagnostics v_baskets = row_count;

  select array_agg(s.user_id) into v_owners
    from (select c.user_id, max(c.updated_at) as last_change
            from public.cart_items c
           where c.user_id is not null and not c.saved
           group by c.user_id) s
    left join lateral (select cp.market from public.consumer_profile cp
                        where cp.user_id = s.user_id order by cp.id limit 1) m on true
   where s.last_change < (p_as_of - (public.basket_window(m.market)).clear_after_days)::timestamptz;
  v_carts := coalesce(array_length(v_owners, 1), 0);
  if v_carts > 0 then
    delete from public.cart_items c where c.user_id = any (v_owners) and not c.saved;
  end if;

  return jsonb_build_object('ran_on', p_as_of, 'flagged', v_flagged, 'cleared', v_baskets + v_carts,
                            'cleared_baskets', v_baskets, 'cleared_carts', v_carts);
end $$;

revoke all on function public.run_baskets_night(date) from public, anon, authenticated;

/* =================================================== 3. dated events -- */

alter table public.notification_events add column if not exists anchor text;

comment on column public.notification_events.anchor is
  'Null for an ordinary event. Otherwise the date the event is measured from, per subject, which the nightly reminders job computes: a rule on this event can have steps (notification_rule_steps) at n−30 … n+30 days.';

insert into public.notification_events (id, label, description, personas, category, sort_order, anchor) values
  ('basket.abandoned',     'A basket becomes abandoned',
   'Nobody has changed the basket for the market''s abandoned-after days (Basket rules).',
   array['consumer', 'enterprise'], 'Baskets', 100, 'abandoned_on'),
  ('basket.clearing',      'A basket is cleared',
   'The night clears a basket nobody has changed for the market''s clear-after days (Basket rules).',
   array['consumer', 'enterprise'], 'Baskets', 101, 'clears_on'),
  ('invoice.due',          'An invoice falls due',
   'The due date of a business invoice still open or overdue.',
   array['enterprise'], 'Money', 102, 'due'),
  ('subscription.renewal', 'A subscription renews',
   'The next renewal date of a subscription that renews by itself.',
   array['consumer', 'enterprise'], 'Subscriptions', 103, 'renews'),
  ('agreement.notice',     'An agreement''s notice deadline',
   'The last day to give notice on an agreement: its end date less its notice days.',
   array['enterprise', 'partner'], 'Agreements', 104, 'notice_deadline'),
  ('quote.expiry',         'A quote expires',
   'The valid-until date of a quote that has been priced and not yet decided.',
   array['enterprise'], 'Enquiries', 105, 'valid_until')
on conflict (id) do update set
  label = excluded.label, description = excluded.description, personas = excluded.personas,
  category = excluded.category, sort_order = excluded.sort_order, anchor = excluded.anchor;

/* ========================================================== 4. steps -- */

create table if not exists public.notification_rule_steps (
  id          text primary key default ('NRS-' || replace(gen_random_uuid()::text, '-', '')),
  rule_id     text not null references public.notification_rules(id) on delete cascade,
  /* n−1 is one day before the anchor, n+0 the day, n+2 two days after. */
  offset_days integer not null check (offset_days between -30 and 30),
  /* A subset of the rule's channels (guard_rule_step). */
  kinds       text[] not null,
  enabled     boolean not null default false,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.notification_rule_steps is
  'A rule on a dated event, on a schedule: each step sends on anchor + offset_days, on some of the rule''s channels. Off until the operator turns it on.';

create index if not exists notification_rule_steps_rule_idx on public.notification_rule_steps(rule_id, sort_order);

/* A step belongs to a rule on a dated event, and sends only on channels the
   rule carries. */
create or replace function public.guard_rule_step() returns trigger
language plpgsql security definer set search_path = public as $$
<<gs>>
declare
  v_kinds  text[];
  v_name   text;
  v_anchor text;
begin
  select r.kinds, r.name, e.anchor into v_kinds, v_name, v_anchor
    from public.notification_rules r
    join public.notification_events e on e.id = r.event_id
   where r.id = new.rule_id;
  if not found then
    raise exception 'There is no notification rule %.', coalesce(new.rule_id, 'with no id');
  end if;
  if v_anchor is null then
    raise exception '"%" fires when its event happens, not on a date, so it has no schedule.', v_name;
  end if;
  if new.kinds is null or cardinality(new.kinds) = 0 then
    raise exception 'A step that goes nowhere sends nothing. Pick at least one of the rule''s channels.';
  end if;
  if not (new.kinds <@ v_kinds) then
    raise exception 'A step can only send on the channels its rule uses (%).', array_to_string(v_kinds, ', ');
  end if;
  new.updated_at := now();
  return new;
end $$;

revoke all on function public.guard_rule_step() from public, anon, authenticated;

drop trigger if exists notification_rule_steps_guard on public.notification_rule_steps;
create trigger notification_rule_steps_guard before insert or update on public.notification_rule_steps
  for each row execute function public.guard_rule_step();

create table if not exists public.notification_step_templates (
  id        text primary key default ('NST-' || replace(gen_random_uuid()::text, '-', '')),
  step_id   text not null references public.notification_rule_steps(id) on delete cascade,
  kind_id   text not null references public.notification_kinds(id) on delete cascade,
  subject   text not null,
  body      text not null,
  edited_by text,
  edited_on date,
  unique (step_id, kind_id)
);

comment on table public.notification_step_templates is
  'What a step says, per channel: "Your basket clears tomorrow". Placeholders as for notification_templates, plus {anchor_date} and {days_left}.';

create index if not exists notification_step_templates_step_idx on public.notification_step_templates(step_id);

/* A template is for one of its step's channels and fits it. */
create or replace function public.guard_step_template() returns trigger
language plpgsql security definer set search_path = public as $$
<<gt>>
declare
  v_kinds text[];
  v_max   integer;
  v_label text;
begin
  select s.kinds into v_kinds from public.notification_rule_steps s where s.id = new.step_id;
  if not found then
    raise exception 'There is no schedule step %.', coalesce(new.step_id, 'with no id');
  end if;
  if not (new.kind_id = any (v_kinds)) then
    raise exception 'This step does not send on %, so a template for it would never be used.', new.kind_id;
  end if;
  select k.max_chars, k.label into v_max, v_label from public.notification_kinds k where k.id = new.kind_id;
  if v_max is not null and length(new.body) > v_max then
    raise exception '% cuts off at % characters and this is %. It would arrive half-written.', v_label, v_max, length(new.body);
  end if;
  if btrim(coalesce(new.subject, '')) = '' or btrim(coalesce(new.body, '')) = '' then
    raise exception 'A reminder needs a subject and something to say.';
  end if;
  return new;
end $$;

revoke all on function public.guard_step_template() from public, anon, authenticated;

drop trigger if exists notification_step_templates_guard on public.notification_step_templates;
create trigger notification_step_templates_guard before insert or update on public.notification_step_templates
  for each row execute function public.guard_step_template();

/* What each step did, once per subject and anchor date: a re-run of the
   night finds the row and sends nothing again. */
create table if not exists public.notification_schedule_log (
  id               bigint generated always as identity primary key,
  step_id          text not null references public.notification_rule_steps(id) on delete cascade,
  rule_id          text not null,
  event_id         text not null,
  offset_days      integer not null,
  /* What the reminder is about, for one recipient: 'cart:<user>', a basket
     id, '<invoice>/<member>', … (reminder_subjects). */
  subject_id       text not null,
  anchor_date      date not null,
  sent_on          date not null,
  outcome          text not null check (outcome in ('sent', 'skipped_preference', 'skipped_throttle', 'skipped_no_template')),
  detail           text,
  notification_ids text[] not null default array[]::text[],
  recipient        text,
  user_id          uuid references auth.users(id) on delete set null,
  partner_id       text,
  ref              text,
  created_at       timestamptz not null default now(),
  unique (step_id, subject_id, anchor_date)
);

comment on table public.notification_schedule_log is
  'One row per schedule step, subject and anchor date: sent (with the notification_log ids), or why not. Written only by run_reminders.';

create index if not exists notification_schedule_log_sent_idx on public.notification_schedule_log(sent_on desc);
create index if not exists notification_schedule_log_subject_idx on public.notification_schedule_log(subject_id, sent_on desc);

/* ------------------------------------------------------------ policies -- */

alter table public.notification_rule_steps     enable row level security;
alter table public.notification_step_templates enable row level security;
alter table public.notification_schedule_log   enable row level security;

drop policy if exists "persona_read_notification_rule_steps"     on public.notification_rule_steps;
drop policy if exists "operator_all_notification_rule_steps"     on public.notification_rule_steps;
drop policy if exists "persona_read_notification_step_templates" on public.notification_step_templates;
drop policy if exists "operator_all_notification_step_templates" on public.notification_step_templates;
drop policy if exists "operator_read_notification_schedule_log"  on public.notification_schedule_log;
drop policy if exists "own_notification_schedule_log"            on public.notification_schedule_log;

/* As notification_rules and notification_templates: a recipient reads the
   steps of rules aimed at their persona; the operator writes them. */
create policy "persona_read_notification_rule_steps" on public.notification_rule_steps
  for select to authenticated using (
    exists (select 1 from public.notification_rules r
             where r.id = notification_rule_steps.rule_id and r.persona = current_persona()));
create policy "operator_all_notification_rule_steps" on public.notification_rule_steps for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

create policy "persona_read_notification_step_templates" on public.notification_step_templates
  for select to authenticated using (
    exists (select 1 from public.notification_rule_steps s
              join public.notification_rules r on r.id = s.rule_id
             where s.id = notification_step_templates.step_id and r.persona = current_persona()));
create policy "operator_all_notification_step_templates" on public.notification_step_templates for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* History is read-only, as notification_log. */
create policy "operator_read_notification_schedule_log" on public.notification_schedule_log
  for select to authenticated using (current_persona() = 'operator');
create policy "own_notification_schedule_log" on public.notification_schedule_log
  for select to authenticated using (user_id = auth.uid());

revoke all on public.notification_rule_steps, public.notification_step_templates, public.notification_schedule_log from anon;
grant select, insert, update, delete on public.notification_rule_steps, public.notification_step_templates to authenticated;
revoke insert, update, delete on public.notification_schedule_log from authenticated;
grant select on public.notification_schedule_log to authenticated;

/* =================================================== 5. the sending -- */

/* A template's placeholders filled from `p_fields`; anything not covered is
   left as written. */
create or replace function public.reminder_fill(p_text text, p_fields jsonb)
returns text language plpgsql immutable set search_path = public as $$
<<rf>>
declare
  v_key   text;
  v_value text;
  v_text  text := p_text;
begin
  if v_text is null or p_fields is null then return v_text; end if;
  for v_key, v_value in select f.key, f.value from jsonb_each_text(p_fields) f loop
    v_text := replace(v_text, '{' || v_key || '}', coalesce(v_value, ''));
  end loop;
  return rf.v_text;
end $$;

revoke all on function public.reminder_fill(text, jsonb) from public, anon, authenticated;

/**
 * Who a dated event concerns on `p_anchor`, for a rule aimed at
 * `p_persona`: one row per subject and recipient.
 *
 *   basket.abandoned / basket.clearing
 *     consumer    a shopper's cart (lines not saved for later), from the
 *                 newest line change, by the shopper's market
 *     enterprise  a requisition basket with lines, from its updated_at, by
 *                 the account's home market
 *   invoice.due           enterprise: an open or overdue invoice's due date,
 *                         to each active finance approver on the account
 *   subscription.renewal  consumer: an active auto-renewing subscription's
 *                         next_renewal; enterprise: an active auto-renewing
 *                         business subscription's renews, to the
 *                         procurement lead(s)
 *   agreement.notice      enterprise: an active agreement's ends_on less its
 *                         notice_days, to the procurement lead(s). The
 *                         partner persona has no subjects: an
 *                         enterprise_contract has no seller on it.
 *   quote.expiry          enterprise: a priced quote's valid_until, to the
 *                         member who asked
 */
create or replace function public.reminder_subjects(p_event text, p_persona text, p_anchor date)
returns table (s_subject text, s_anchor date, s_user uuid, s_partner text,
               s_recipient text, s_ref text, s_fields jsonb)
language plpgsql stable security definer set search_path = public as $$
<<rs>>
begin
  if p_event in ('basket.abandoned', 'basket.clearing') and p_persona = 'consumer' then
    return query
    select ('cart:' || c.user_id::text)::text, p_anchor, c.user_id, null::text,
           coalesce(cp.name, au.email::text, 'Basket owner')::text, 'BASKET'::text,
           jsonb_build_object('items', c.n_lines, 'last_change', c.last_change)
      from (select ci.user_id, max(ci.updated_at) as last_change, count(*) as n_lines
              from public.cart_items ci
             where ci.user_id is not null and not ci.saved
             group by ci.user_id) c
      left join lateral (select p.name, p.market from public.consumer_profile p
                          where p.user_id = c.user_id order by p.id limit 1) cp on true
      left join auth.users au on au.id = c.user_id
     cross join lateral public.basket_window(cp.market) w
     where public.basket_anchor(p_event, c.last_change, w.abandoned_after_days, w.clear_after_days) = p_anchor;

  elsif p_event in ('basket.abandoned', 'basket.clearing') and p_persona = 'enterprise' then
    return query
    select b.id::text, p_anchor, b.user_id, null::text,
           coalesce(eu.name, au.email::text, 'Basket owner')::text, b.id::text,
           jsonb_build_object('items', (select count(*) from public.requisition_basket_lines l where l.basket_id = b.id),
                              'last_change', b.updated_at)
      from public.requisition_baskets b
      join public.enterprise_accounts a on a.id = b.account_id
      left join lateral (select u.name from public.enterprise_users u
                          where u.user_id = b.user_id and u.account_id = b.account_id order by u.id limit 1) eu on true
      left join auth.users au on au.id = b.user_id
     cross join lateral public.basket_window(a.market) w
     where exists (select 1 from public.requisition_basket_lines l where l.basket_id = b.id)
       and public.basket_anchor(p_event, b.updated_at, w.abandoned_after_days, w.clear_after_days) = p_anchor;

  elsif p_event = 'invoice.due' and p_persona = 'enterprise' then
    return query
    select (i.id || '/' || u.id)::text, p_anchor, u.user_id, null::text, u.name::text, i.id::text,
           jsonb_build_object('order', i.id, 'amount', i.total::text, 'listing', i.period)
      from public.enterprise_invoices i
      join public.enterprise_users u on u.account_id = i.account_id
     where i.due = p_anchor
       and i.status in ('open', 'overdue')
       and u.status = 'active' and u.user_id is not null
       and (u.approves_finance or u.role = 'finance-approver');

  elsif p_event = 'subscription.renewal' and p_persona = 'consumer' then
    return query
    select ('sub:' || s.id::text)::text, p_anchor, s.user_id, null::text,
           coalesce(cp.name, au.email::text, 'Subscriber')::text, coalesce(s.ref, s.id::text)::text,
           jsonb_build_object('listing', s.product_name, 'amount', s.price::text)
      from public.subscriptions s
      left join lateral (select p.name from public.consumer_profile p
                          where p.user_id = s.user_id order by p.id limit 1) cp on true
      left join auth.users au on au.id = s.user_id
     where s.status = 'active' and s.auto_renew and s.next_renewal = p_anchor and s.user_id is not null;

  elsif p_event = 'subscription.renewal' and p_persona = 'enterprise' then
    return query
    select (es.id || '/' || u.id)::text, p_anchor, u.user_id, null::text, u.name::text, es.id::text,
           jsonb_build_object('listing', es.name, 'amount', es.monthly::text)
      from public.enterprise_subscriptions es
      join public.enterprise_users u on u.account_id = es.account_id
     where es.status = 'active' and es.auto_renew and es.renews = p_anchor
       and u.status = 'active' and u.user_id is not null and u.role = 'procurement-lead';

  elsif p_event = 'agreement.notice' and p_persona = 'enterprise' then
    return query
    select (c.id || '/' || u.id)::text, p_anchor, u.user_id, null::text, u.name::text, c.id::text,
           jsonb_build_object('listing', c.title)
      from public.enterprise_contract c
      join public.enterprise_users u on u.account_id = c.account_id
     where c.state = 'active' and c.superseded_by is null
       and (c.ends_on - c.notice_days) = p_anchor
       and u.status = 'active' and u.user_id is not null and u.role = 'procurement-lead';

  elsif p_event = 'quote.expiry' and p_persona = 'enterprise' then
    return query
    select q.id::text, p_anchor, u.user_id, null::text, u.name::text, q.id::text,
           jsonb_build_object('listing', q.subject, 'order', q.id)
      from public.enquiries q
      join public.enterprise_users u on u.id = q.raised_by
     where q.type = 'quote' and q.status = 'quoted' and q.valid_until = p_anchor
       and u.user_id is not null;
  end if;
  return;
end $$;

revoke all on function public.reminder_subjects(text, text, date) from public, anon, authenticated;

/**
 * The night's reminders, as of `p_as_of` (UTC).
 *
 * For each step that is on, of a rule that is on, on a dated event: the
 * subjects whose anchor + offset is `p_as_of` (so the anchor is
 * p_as_of − offset). A subject already in notification_schedule_log for the
 * step and anchor date is skipped. Otherwise:
 *   - the channels are the step's, kept to the rule's;
 *   - the recipient's preference for the rule (their own, else their
 *     seller account's): switched off skips it, unless the rule is mandatory;
 *     its channels narrow the step's, and a mandatory rule whose channels a
 *     preference would leave empty still sends on the step's;
 *   - the rule's throttle: 'At most once an hour', '… once a day',
 *     'Digest — once a day' or 'Digest — weekly' skips a recipient this rule
 *     has told anything (any notification_log row not failed) in that
 *     window; 'Every time' never skips;
 *   - one notification_log row per channel with a step template, as
 *     enquiry_send writes them: in-app delivered, any other channel
 *     suppressed with "No gateway is connected for <kind>";
 *   - one notification_schedule_log row, whatever happened.
 *
 * Returns {ran_on, steps, sent, already_sent, skipped, skipped_preference,
 * skipped_throttle, skipped_no_template, messages}.
 */
create or replace function public.run_reminders(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
<<rr>>
declare
  st          record;
  sub         record;
  v_pref      record;
  v_has_pref  boolean;
  v_tpl       record;
  v_anchor    date;
  v_window    interval;
  v_kinds     text[];
  v_narrow    text[];
  v_k         text;
  v_ids       text[];
  v_missing   text[];
  v_outcome   text;
  v_detail    text;
  v_fields    jsonb;
  v_subject   text;
  v_body      text;
  v_max       integer;
  v_id        text;
  n_steps     integer := 0;
  n_sent      integer := 0;
  n_already   integer := 0;
  n_pref      integer := 0;
  n_throttle  integer := 0;
  n_template  integer := 0;
  n_messages  integer := 0;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, sends the reminders.';
  end if;
  if p_as_of is null or p_as_of > current_date then
    raise exception 'Reminders cannot be sent as of %: that day has not come yet.', coalesce(p_as_of::text, 'no date');
  end if;

  for st in
    select s.id, s.rule_id, s.offset_days, s.kinds, r.persona, r.event_id, r.kinds as rule_kinds,
           r.throttle, r.mandatory, r.name as rule_name
      from public.notification_rule_steps s
      join public.notification_rules r on r.id = s.rule_id
      join public.notification_events e on e.id = r.event_id
     where s.enabled and r.enabled and e.anchor is not null
     order by r.sort_order, r.id, s.sort_order, s.offset_days, s.id
  loop
    n_steps := n_steps + 1;
    v_anchor := p_as_of - st.offset_days;
    v_window := case st.throttle
                  when 'At most once an hour' then interval '1 hour'
                  when 'At most once a day'   then interval '1 day'
                  when 'Digest — once a day'  then interval '1 day'
                  when 'Digest — weekly'      then interval '7 days'
                end;

    for sub in select * from public.reminder_subjects(st.event_id, st.persona, rr.v_anchor) loop
      if exists (select 1 from public.notification_schedule_log l
                  where l.step_id = st.id and l.subject_id = sub.s_subject and l.anchor_date = rr.v_anchor) then
        n_already := n_already + 1;
        continue;
      end if;

      v_outcome := 'sent';
      v_detail  := null;
      v_ids     := array[]::text[];
      v_missing := array[]::text[];
      v_kinds   := array(select k.kind from unnest(st.kinds) with ordinality as k(kind, n)
                          where k.kind = any (st.rule_kinds) order by k.n);

      /* The recipient's preference for this rule. */
      select p.enabled, p.kinds into v_pref
        from public.notification_preferences p
       where p.rule_id = st.rule_id
         and ((sub.s_user is not null and p.user_id = sub.s_user)
              or (sub.s_partner is not null and p.scope = 'partner' and p.partner_id = sub.s_partner))
       order by (p.scope = 'user') desc, p.id
       limit 1;
      v_has_pref := found;

      if v_has_pref then
        if not v_pref.enabled and not st.mandatory then
          v_outcome := 'skipped_preference';
          v_detail  := 'The recipient switched "' || st.rule_name || '" off.';
        else
          v_narrow := array(select k.kind from unnest(v_kinds) with ordinality as k(kind, n)
                             where k.kind = any (v_pref.kinds) order by k.n);
          if cardinality(v_narrow) > 0 then
            v_kinds := v_narrow;
          elsif not st.mandatory then
            v_outcome := 'skipped_preference';
            v_detail  := 'The recipient chose none of this step''s channels (' || array_to_string(v_kinds, ', ') || ').';
          end if;
        end if;
      end if;

      if v_outcome = 'sent' and v_window is not null
         and exists (select 1 from public.notification_log l
                      where l.rule_id = st.rule_id
                        and l.state <> 'failed'
                        and l.sent_at > now() - rr.v_window
                        and ((sub.s_user is not null and l.user_id = sub.s_user)
                             or (sub.s_user is null and sub.s_partner is not null and l.partner_id = sub.s_partner))) then
        v_outcome := 'skipped_throttle';
        v_detail  := format('"%s" is sent %s, and this recipient was told within it.', st.rule_name, lower(st.throttle));
      end if;

      if v_outcome = 'sent' then
        v_fields := coalesce(sub.s_fields, '{}'::jsonb) || jsonb_build_object(
                      'recipient',   coalesce(sub.s_recipient, ''),
                      'anchor_date', to_char(rr.v_anchor, 'DD Mon YYYY'),
                      'due',         to_char(rr.v_anchor, 'DD Mon YYYY'),
                      'days_left',   (rr.v_anchor - p_as_of)::text,
                      'marketplace', 'Aventa',
                      'link',        '');

        foreach v_k in array v_kinds loop
          select t.subject, t.body into v_tpl
            from public.notification_step_templates t
           where t.step_id = st.id and t.kind_id = v_k;
          if not found then
            v_missing := v_missing || v_k;
            continue;
          end if;
          select k.max_chars into v_max from public.notification_kinds k where k.id = v_k;
          v_subject := left(public.reminder_fill(v_tpl.subject, v_fields), 200);
          v_body    := public.reminder_fill(v_tpl.body, v_fields);
          if v_max is not null then
            v_body := left(v_body, v_max);
          end if;
          v_id := 'NL-REM-' || replace(gen_random_uuid()::text, '-', '');

          insert into public.notification_log
            (id, rule_id, kind_id, channel_id, persona, recipient, user_id, partner_id,
             subject, body, sent_at, state, detail, cost, ref)
          values
            (v_id, st.rule_id, v_k, null, st.persona, coalesce(sub.s_recipient, 'Recipient'), sub.s_user, sub.s_partner,
             v_subject, v_body, now(),
             case when v_k = 'inapp' then 'delivered' else 'suppressed' end,
             case when v_k = 'inapp' then null else 'No gateway is connected for ' || v_k end,
             0, sub.s_ref);
          v_ids := v_ids || v_id;
          n_messages := n_messages + 1;
        end loop;

        if cardinality(v_kinds) = 0 then
          v_outcome := 'skipped_no_template';
          v_detail  := 'None of this step''s channels is still one of its rule''s.';
        elsif cardinality(v_ids) = 0 then
          v_outcome := 'skipped_no_template';
          v_detail  := 'No template is written for ' || array_to_string(v_missing, ', ') || ' on this step.';
        elsif cardinality(v_missing) > 0 then
          v_detail  := 'Not sent on ' || array_to_string(v_missing, ', ') || ': no template is written for it on this step.';
        end if;
      end if;

      insert into public.notification_schedule_log
        (step_id, rule_id, event_id, offset_days, subject_id, anchor_date, sent_on, outcome, detail,
         notification_ids, recipient, user_id, partner_id, ref)
      values
        (st.id, st.rule_id, st.event_id, st.offset_days, sub.s_subject, rr.v_anchor, p_as_of, v_outcome, v_detail,
         v_ids, sub.s_recipient, sub.s_user, sub.s_partner, sub.s_ref)
      on conflict (step_id, subject_id, anchor_date) do nothing;

      if v_outcome = 'sent' then
        n_sent := n_sent + 1;
      elsif v_outcome = 'skipped_preference' then
        n_pref := n_pref + 1;
      elsif v_outcome = 'skipped_throttle' then
        n_throttle := n_throttle + 1;
      else
        n_template := n_template + 1;
      end if;
    end loop;
  end loop;

  return jsonb_build_object('ran_on', p_as_of, 'steps', n_steps, 'sent', n_sent, 'already_sent', n_already,
                            'skipped', n_pref + n_throttle + n_template,
                            'skipped_preference', n_pref, 'skipped_throttle', n_throttle,
                            'skipped_no_template', n_template, 'messages', n_messages);
end $$;

revoke all on function public.run_reminders(date) from public, anon, authenticated;

/* `run_nightly`, copied from 20261126100000 (its latest definition). Changed
   only: the `reminders` job, last, so eleven. */
create or replace function public.run_nightly(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  j    text;
  res  jsonb;
  err  text;
  t0   timestamptz;
  outs jsonb := '[]'::jsonb;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, runs the night.';
  end if;

  foreach j in array array['agreements', 'enterprise subscriptions', 'subscriptions', 'documents', 'payments', 'bundle selections', 'baskets', 'invoices', 'risk', 'settlements', 'reminders'] loop
    t0 := clock_timestamp(); res := null; err := null;
    begin
      res := case j
        when 'agreements'               then public.auto_renew_contracts(p_as_of, 'Nightly schedule')
        when 'enterprise subscriptions' then public.renew_enterprise_subscriptions(p_as_of, 'Nightly schedule')
        when 'subscriptions'            then public.renew_subscriptions(p_as_of, 'Nightly schedule')
        when 'documents'                then public.lapse_expired_documents(p_as_of)
        when 'payments'                 then jsonb_build_object('expired', public.expire_stale_payments())
        when 'bundle selections'        then public.delete_unused_bundle_selections(p_as_of)
        when 'baskets'                  then public.run_baskets_night(p_as_of)
        when 'invoices'                 then public.run_invoicing(p_as_of)
        when 'risk'                     then public.refresh_account_risk(p_as_of)
        when 'settlements'              then public.settle_to_date(p_as_of)
        when 'reminders'                then public.run_reminders(p_as_of)
      end;
    exception when others then
      err := format('%s (%s)', sqlerrm, sqlstate);
    end;
    insert into public.scheduled_job_log (job, ran_on, started_at, finished_at, ok, result, error)
    values (j, p_as_of, t0, clock_timestamp(), err is null, res, err);
    outs := outs || jsonb_build_object('job', j, 'ok', err is null, 'error', err);
  end loop;

  return jsonb_build_object('ran_on', p_as_of, 'jobs', outs);
end $$;

revoke all on function public.run_nightly(date) from public, anon, authenticated;

/* ===================================================== 6. the seed -- */

/* One rule per basket event and persona, off. `do nothing` on conflict, so a
   rule, step or template the operator has since edited stays as they left
   it. */
insert into public.notification_rules (id, persona, event_id, name, audience, kinds, throttle,
                                       severity, enabled, mandatory, why, last_sent, sort_order) values
  ('NR-C-BSK-ABANDONED', 'consumer', 'basket.abandoned', 'Your basket is waiting', 'You',
   array['inapp'], 'Every time', 'low', false, false,
   'A nudge on the day a basket counts as abandoned. In-app only: it is a reminder, not a sales call.', null, 40),
  ('NR-C-BSK-CLEARING', 'consumer', 'basket.clearing', 'Your basket is about to be cleared', 'You',
   array['email', 'whatsapp'], 'Every time', 'normal', false, false,
   'Clearing a basket nobody warned you about loses what you chose. A week ahead, then the day before.', null, 41),
  ('NR-B-BSK-ABANDONED', 'enterprise', 'basket.abandoned', 'Your requisition basket is waiting', 'The basket''s owner',
   array['inapp'], 'Every time', 'low', false, false,
   'A requisition left half-built is usually a purchase somebody is still waiting on.', null, 42),
  ('NR-B-BSK-CLEARING', 'enterprise', 'basket.clearing', 'Your requisition basket is about to be cleared', 'The basket''s owner',
   array['email', 'whatsapp'], 'Every time', 'normal', false, false,
   'Lines, quotes and bundle choices go with the basket. A week ahead, then the day before.', null, 43)
on conflict (id) do nothing;

/* Every rule has a template for every channel it claims (the Rules screen
   flags one that does not), even though these rules send only by schedule. */
insert into public.notification_templates (id, rule_id, kind_id, subject, body)
select r.id || '-' || k, r.id, k, r.name,
       left(r.name || ' — ' || e.description, 240)
  from public.notification_rules r
  join public.notification_events e on e.id = r.event_id
 cross join lateral unnest(r.kinds) k
 where r.id in ('NR-C-BSK-ABANDONED', 'NR-C-BSK-CLEARING', 'NR-B-BSK-ABANDONED', 'NR-B-BSK-CLEARING')
on conflict (id) do nothing;

/* The spec's default steps: abandoned n+0 in-app; clearing n−7 email;
   clearing n−1 email and WhatsApp. All off. */
insert into public.notification_rule_steps (id, rule_id, offset_days, kinds, enabled, sort_order) values
  ('NRS-C-BSK-ABANDONED-0', 'NR-C-BSK-ABANDONED',  0, array['inapp'],             false, 1),
  ('NRS-C-BSK-CLEARING-M7', 'NR-C-BSK-CLEARING',  -7, array['email'],             false, 1),
  ('NRS-C-BSK-CLEARING-M1', 'NR-C-BSK-CLEARING',  -1, array['email', 'whatsapp'], false, 2),
  ('NRS-B-BSK-ABANDONED-0', 'NR-B-BSK-ABANDONED',  0, array['inapp'],             false, 1),
  ('NRS-B-BSK-CLEARING-M7', 'NR-B-BSK-CLEARING',  -7, array['email'],             false, 1),
  ('NRS-B-BSK-CLEARING-M1', 'NR-B-BSK-CLEARING',  -1, array['email', 'whatsapp'], false, 2)
on conflict (id) do nothing;

insert into public.notification_step_templates (id, step_id, kind_id, subject, body) values
  ('NRS-C-BSK-ABANDONED-0-inapp', 'NRS-C-BSK-ABANDONED-0', 'inapp',
   'Your basket is waiting',
   'You left {items} item(s) in your basket. Check out when you are ready, or remove what you no longer want.'),
  ('NRS-C-BSK-CLEARING-M7-email', 'NRS-C-BSK-CLEARING-M7', 'email',
   'Your basket clears in {days_left} days',
   'Hello {recipient},' || E'\n\n' ||
   'Nobody has changed your basket for a while, so it will be cleared on {anchor_date}.' || E'\n\n' ||
   'Open it before then to keep what is in it: any change keeps it for longer. Anything you saved for later stays either way.'),
  ('NRS-C-BSK-CLEARING-M1-email', 'NRS-C-BSK-CLEARING-M1', 'email',
   'Your basket clears tomorrow',
   'Hello {recipient},' || E'\n\n' ||
   'Your basket will be cleared tomorrow, {anchor_date}, because nobody has changed it for a while.' || E'\n\n' ||
   'Open it today to keep what is in it. Anything you saved for later stays either way.'),
  ('NRS-C-BSK-CLEARING-M1-whatsapp', 'NRS-C-BSK-CLEARING-M1', 'whatsapp',
   'Your basket clears tomorrow',
   'Hello {recipient}, your {marketplace} basket will be cleared tomorrow ({anchor_date}). Open it today to keep what is in it.'),
  ('NRS-B-BSK-ABANDONED-0-inapp', 'NRS-B-BSK-ABANDONED-0', 'inapp',
   'Your requisition basket is waiting',
   'You left {items} item(s) in your requisition basket. Open it to raise the requisition, or clear it.'),
  ('NRS-B-BSK-CLEARING-M7-email', 'NRS-B-BSK-CLEARING-M7', 'email',
   'Your requisition basket clears in {days_left} days',
   'Hello {recipient},' || E'\n\n' ||
   'Nobody has changed your requisition basket for a while, so it will be cleared on {anchor_date}, with its lines, quotes and bundle choices.' || E'\n\n' ||
   'Open it before then to keep it: any change keeps it for longer.'),
  ('NRS-B-BSK-CLEARING-M1-email', 'NRS-B-BSK-CLEARING-M1', 'email',
   'Your requisition basket clears tomorrow',
   'Hello {recipient},' || E'\n\n' ||
   'Your requisition basket will be cleared tomorrow, {anchor_date}, because nobody has changed it for a while.' || E'\n\n' ||
   'Open it today to raise the requisition or keep it.'),
  ('NRS-B-BSK-CLEARING-M1-whatsapp', 'NRS-B-BSK-CLEARING-M1', 'whatsapp',
   'Your requisition basket clears tomorrow',
   'Hello {recipient}, your {marketplace} requisition basket will be cleared tomorrow ({anchor_date}). Open it today to keep it.')
on conflict (id) do nothing;

/* ================================================================= help === */

/* The Baskets article: the windows are operator settings now, and reminders
   can be scheduled. Each sentence replaced once. */
update kb_articles
   set body = replace(replace(replace(body::text,
                'A basket is Pending while it has been changed in the last 7 days, and Abandoned once nobody has touched it for 7 days or more.',
                'A basket is Pending while it has been changed recently, and Abandoned once nobody has touched it for a number of days. Both numbers, and when the night clears a basket, are operator settings per market (Basket rules on this screen): 7, 7 and 90 days unless somebody changes them.'),
                'At most one a day per basket: a second within 24 hours is refused, and the screen says when the next may go.',
                'At most one a day per basket: a second within 24 hours is refused, and the screen says when the next may go. Reminders can also go by themselves: on Notifications, the basket rules have steps such as 7 days and 1 day before a basket is cleared. They are all off until somebody turns them on.'),
                'The night clears a basket nobody has touched for 90 days',
                'The night clears a basket nobody has touched for the clear-after days in Basket rules (90 unless changed)')::jsonb,
       updated = to_char(current_date, 'DD Mon YYYY')
 where view = 'op-baskets'
   and jsonb_typeof(body) = 'array'
   and body::text not like '%Basket rules on this screen%';

/* The Scheduled jobs article: eleven jobs, the baskets sentence, and the
   reminders job. */
update kb_articles
   set body = replace(replace(replace(replace(body::text,
                'runs ten jobs, one after the other',
                'runs eleven jobs, one after the other'),
                '"The ten jobs"',
                '"The eleven jobs"'),
                'baskets nobody has touched for 90 days are cleared.',
                'baskets nobody has touched for their market''s clear-after days (Basket rules, 90 unless changed) are cleared.'),
                'Settlements: every closed period not yet settled is settled, oldest first.',
                'Settlements: every closed period not yet settled is settled, oldest first. Reminders: every scheduled step of a notification rule that is switched on, such as 1 day before a basket is cleared, is sent to everyone whose date it is today, once; running the night again sends nothing twice.')::jsonb,
       updated = to_char(current_date, 'DD Mon YYYY')
 where view = 'op-jobs'
   and jsonb_typeof(body) = 'array'
   and body::text not like '%Reminders: every scheduled step%';

/* ============================================================ self-check === */

do $$
<<chk>>
declare
  dry      jsonb;
  j        jsonb;
  v_sig    text;
  v_n      integer;
  v_m      integer;
  v_res    jsonb;
  v_was    public.basket_settings;
  v_to     integer;
  v_row    record;
  v_ent    record;
  v_win    public.basket_settings;
  v_when   timestamptz;
  v_basket text;
  v_ids    text[];
  v_op     uuid;
  v_cons   uuid;
  v_prod   text;
begin
  if not public.is_scheduler() then
    raise exception 'This session (%) is not one the schedule runs as, so the dry run below would be refused.', session_user;
  end if;

  /* The tables, their row level security, and the functions. */
  foreach v_sig in array array['public.basket_settings', 'public.notification_rule_steps',
                               'public.notification_step_templates', 'public.notification_schedule_log'] loop
    if to_regclass(v_sig) is null then raise exception '% is missing', v_sig; end if;
  end loop;
  select count(*) into v_n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relrowsecurity
     and c.relname in ('basket_settings', 'notification_rule_steps', 'notification_step_templates', 'notification_schedule_log');
  if v_n <> 4 then raise exception 'row level security is on for % of the four new tables', v_n; end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'notification_schedule_log'
                                         and cmd <> 'SELECT') then
    raise exception 'the schedule log has a write policy; only run_reminders writes it';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'notification_events' and column_name = 'anchor') then
    raise exception 'notification_events has no anchor';
  end if;
  if not exists (select 1 from pg_constraint
                  where conrelid = 'public.notification_schedule_log'::regclass and contype = 'u'
                    and pg_get_constraintdef(oid) = 'UNIQUE (step_id, subject_id, anchor_date)') then
    raise exception 'the schedule log is not unique per step, subject and anchor date';
  end if;

  foreach v_sig in array array['public.basket_window(text)', 'public.basket_anchor(text,timestamp with time zone,integer,integer)',
                               'public.guard_basket_settings()', 'public.audit_basket_settings()',
                               'public.guard_rule_step()', 'public.guard_step_template()',
                               'public.reminder_fill(text,jsonb)', 'public.reminder_subjects(text,text,date)',
                               'public.run_reminders(date)', 'public.run_baskets_night(date)', 'public.run_nightly(date)'] loop
    if to_regprocedure(v_sig) is null then raise exception '% is missing', v_sig; end if;
  end loop;
  foreach v_sig in array array['public.guard_basket_settings()', 'public.audit_basket_settings()',
                               'public.guard_rule_step()', 'public.guard_step_template()',
                               'public.reminder_fill(text,jsonb)', 'public.reminder_subjects(text,text,date)',
                               'public.run_reminders(date)', 'public.run_baskets_night(date)', 'public.run_nightly(date)'] loop
    if has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '% is callable through the API', v_sig;
    end if;
  end loop;
  if pg_get_functiondef('public.run_baskets_night(date)'::regprocedure) like '%p_as_of - 90%' then
    raise exception 'the baskets night still clears at a hard-coded 90 days';
  end if;

  /* Nothing moves: the default and every market at 7, 7 and 90. */
  if not exists (select 1 from public.basket_settings s where s.market = 'default') then
    raise exception 'there are no default basket rules';
  end if;
  select count(*) into v_n from public.markets m
   where not exists (select 1 from public.basket_settings s where s.market = m.code);
  if v_n > 0 then raise exception '% markets have no basket rules', v_n; end if;
  /* Rows this run seeded (stamped with the transaction's time); a later run
     leaves the operator's numbers alone and so does not judge them. */
  select count(*) into v_n from public.basket_settings s
   where s.updated_at = now()
     and (s.pending_days, s.abandoned_after_days, s.clear_after_days) <> (7, 7, 90);
  if v_n > 0 then
    raise exception '% basket rules are not 7, 7 and 90 days; the seed must not move anything', v_n;
  end if;
  v_win := public.basket_window('NO-SUCH-MARKET');
  if v_win.market is distinct from 'default' then
    raise exception 'a market without rules of its own does not fall back to the default (got %)', v_win.market;
  end if;

  /* The six dated events, and the basket rules: seeded, and every one off. */
  select count(*) into v_n from public.notification_events e
   where e.anchor is not null
     and e.id in ('basket.abandoned', 'basket.clearing', 'invoice.due', 'subscription.renewal', 'agreement.notice', 'quote.expiry');
  if v_n <> 6 then raise exception '% of the six dated events have an anchor', v_n; end if;
  select count(*) into v_n from public.notification_rules r
   where r.id in ('NR-C-BSK-ABANDONED', 'NR-C-BSK-CLEARING', 'NR-B-BSK-ABANDONED', 'NR-B-BSK-CLEARING');
  if v_n <> 4 then raise exception '% of the four basket reminder rules are there', v_n; end if;
  /* Seeded off: a step this run added is off. (A later run of the migration
     leaves whatever the operator has since turned on alone.) */
  if exists (select 1 from public.notification_rule_steps s
              where s.id like 'NRS-_-BSK-%' and s.created_at = now() and s.enabled) then
    raise exception 'a seeded basket step is on; nothing may start sending by itself';
  end if;
  select count(*) into v_n from public.notification_rule_steps s where s.id like 'NRS-_-BSK-%';
  if v_n < 6 then raise exception 'only % of the six default basket steps are there', v_n; end if;
  select count(*) into v_n
    from public.notification_rule_steps s, unnest(s.kinds) k
   where not exists (select 1 from public.notification_step_templates t where t.step_id = s.id and t.kind_id = k);
  if v_n > 0 then raise exception '% step channels have no template, so they would send nothing', v_n; end if;
  select count(*) into v_n
    from public.notification_rules r, unnest(r.kinds) k
   where r.id like 'NR-_-BSK-%'
     and not exists (select 1 from public.notification_templates t where t.rule_id = r.id and t.kind_id = k);
  if v_n > 0 then raise exception '% basket rule channels have no rule template', v_n; end if;

  /* The help. */
  if exists (select 1 from kb_articles where view = 'op-baskets' and body::text like '%touched it for 7 days or more%') then
    raise exception 'the Baskets article still says the windows are fixed at 7 days';
  end if;
  if exists (select 1 from kb_articles where view = 'op-jobs' and body::text not like '%Reminders: every scheduled step%') then
    raise exception 'the Scheduled jobs article does not mention the reminders job';
  end if;

  /* The night, now with eleven jobs, dry-run and rolled back. Every seeded
     step is off, so the reminders job sends nothing. */
  begin
    dry := public.run_nightly(current_date);
    select l.result into v_res from public.scheduled_job_log l
     where l.job = 'reminders' and l.ran_on = current_date
     order by l.id desc limit 1;
    raise exception using errcode = 'ZZ999', message = 'rolling the dry run back';
  exception when sqlstate 'ZZ999' then
    null;
  end;
  for j in select value from jsonb_array_elements(dry -> 'jobs') loop
    if not (j ->> 'ok')::boolean then
      raise exception 'A dry run of the nightly "%" job fails: %', j ->> 'job', j ->> 'error';
    end if;
  end loop;
  if jsonb_array_length(dry -> 'jobs') <> 11 then
    raise exception 'the dry run ran % jobs, not 11', jsonb_array_length(dry -> 'jobs');
  end if;
  if (dry -> 'jobs' -> 10 ->> 'job') is distinct from 'reminders' then
    raise exception 'the eleventh job of the night is %, not reminders', dry -> 'jobs' -> 10 ->> 'job';
  end if;
  if v_res is null or not (v_res ? 'sent' and v_res ? 'already_sent' and v_res ? 'skipped') then
    raise exception 'the reminders job reported %, not sent, already_sent and skipped', v_res;
  end if;

  /* Rolled back: a business basket whose clearing night is tomorrow (n−1
     today), with only its n−1 step on. One schedule-log row; a second run,
     none; with the step off, none; and the baskets night clears it tomorrow,
     not today. */
  begin
    select eu.user_id, eu.account_id, a.currency, a.market,
           exists (select 1 from public.requisition_baskets b where b.user_id = eu.user_id) as has_basket
      into v_ent
      from public.enterprise_users eu
      join public.enterprise_accounts a on a.id = eu.account_id
     where eu.user_id is not null and eu.status = 'active'
     order by exists (select 1 from public.requisition_baskets b where b.user_id = eu.user_id), eu.id
     limit 1;
    if not found then raise exception 'no active business buyer to check a scheduled reminder against'; end if;

    v_win  := public.basket_window(v_ent.market);
    v_when := ((current_date - v_win.clear_after_days)::timestamp + interval '12 hours') at time zone 'UTC';

    if v_ent.has_basket then
      update public.requisition_baskets b set updated_at = v_when, account_id = v_ent.account_id
       where b.user_id = v_ent.user_id
      returning b.id into v_basket;
    else
      insert into public.requisition_baskets (account_id, user_id, currency, updated_at)
      values (v_ent.account_id, v_ent.user_id, v_ent.currency, v_when)
      returning id into v_basket;
    end if;
    if not exists (select 1 from public.requisition_basket_lines l where l.basket_id = v_basket) then
      select p.id into v_prod from public.products p order by p.id limit 1;
      insert into public.requisition_basket_lines (basket_id, product_id, name, quantity, unit_price, model)
      values (v_basket, v_prod, 'Self-check line', 1, 1, 'oneoff');
    end if;

    if public.basket_anchor('basket.clearing', v_when, v_win.abandoned_after_days, v_win.clear_after_days)
         is distinct from current_date + 1 then
      raise exception 'a basket last changed % clears on %, not tomorrow',
        v_when, public.basket_anchor('basket.clearing', v_when, v_win.abandoned_after_days, v_win.clear_after_days);
    end if;

    /* Only the business clearing rule and its n−1 step are on, as seeded
       (whatever the operator has since made of them). */
    update public.notification_rule_steps s set enabled = false where s.enabled;
    update public.notification_rules r set enabled = false
     where r.enabled and exists (select 1 from public.notification_events e where e.id = r.event_id and e.anchor is not null);
    update public.notification_rules r
       set enabled = true, throttle = 'Every time', mandatory = false, kinds = array['email', 'whatsapp']
     where r.id = 'NR-B-BSK-CLEARING';
    update public.notification_rule_steps s
       set enabled = true, offset_days = -1, kinds = array['email', 'whatsapp']
     where s.id = 'NRS-B-BSK-CLEARING-M1';
    insert into public.notification_step_templates (step_id, kind_id, subject, body) values
      ('NRS-B-BSK-CLEARING-M1', 'email', 'Your requisition basket clears tomorrow', 'It clears on {anchor_date}.'),
      ('NRS-B-BSK-CLEARING-M1', 'whatsapp', 'Your requisition basket clears tomorrow', 'It clears on {anchor_date}.')
    on conflict (step_id, kind_id) do nothing;
    delete from public.notification_preferences p where p.rule_id = 'NR-B-BSK-CLEARING';
    delete from public.notification_schedule_log l where l.subject_id = v_basket;

    v_res := public.run_reminders(current_date);
    select count(*) into v_n from public.notification_schedule_log l
     where l.step_id = 'NRS-B-BSK-CLEARING-M1' and l.subject_id = v_basket and l.anchor_date = current_date + 1;
    if v_n <> 1 then
      raise exception 'a basket at n−1 of clearing has % schedule-log rows, not 1 (%)', v_n, v_res;
    end if;
    select l.outcome, l.notification_ids into v_row from public.notification_schedule_log l
     where l.step_id = 'NRS-B-BSK-CLEARING-M1' and l.subject_id = v_basket;
    v_ids := v_row.notification_ids;
    if v_row.outcome <> 'sent' or cardinality(v_ids) <> 2 then
      raise exception 'the n−1 reminder was %, with % messages, not sent on email and WhatsApp', v_row.outcome, cardinality(v_ids);
    end if;
    select count(*) into v_n from public.notification_log nl
     where nl.id = any (v_ids) and nl.rule_id = 'NR-B-BSK-CLEARING' and nl.user_id = v_ent.user_id
       and nl.persona = 'enterprise' and nl.subject not like '%{%'
       and nl.body not like '%{anchor_date}%';
    if v_n <> 2 then
      raise exception '% of the two notification_log rows read as the step''s templates, filled in', v_n;
    end if;
    if (v_res ->> 'sent')::integer < 1 then
      raise exception 'the reminders run counted % sent', v_res ->> 'sent';
    end if;

    /* Again: nothing. */
    select count(*) into v_m from public.notification_log nl where nl.rule_id = 'NR-B-BSK-CLEARING';
    v_res := public.run_reminders(current_date);
    if (v_res ->> 'sent')::integer <> 0 or (v_res ->> 'already_sent')::integer < 1 then
      raise exception 'a second run sent % (already sent %)', v_res ->> 'sent', v_res ->> 'already_sent';
    end if;
    select count(*) into v_n from public.notification_schedule_log l where l.subject_id = v_basket;
    if v_n <> 1 then raise exception 'a second run left % schedule-log rows for the basket, not 1', v_n; end if;
    select count(*) into v_n from public.notification_log nl where nl.rule_id = 'NR-B-BSK-CLEARING';
    if v_n <> v_m then raise exception 'a second run wrote % messages again', v_n - v_m; end if;

    /* Off: nothing, as a step and as a rule. */
    delete from public.notification_schedule_log l where l.subject_id = v_basket;
    update public.notification_rule_steps s set enabled = false where s.id = 'NRS-B-BSK-CLEARING-M1';
    v_res := public.run_reminders(current_date);
    if (v_res ->> 'sent')::integer <> 0 or (v_res ->> 'steps')::integer <> 0
       or exists (select 1 from public.notification_schedule_log l where l.subject_id = v_basket) then
      raise exception 'a step that is off sent something (%)', v_res;
    end if;
    update public.notification_rule_steps s set enabled = true where s.id = 'NRS-B-BSK-CLEARING-M1';
    update public.notification_rules r set enabled = false where r.id = 'NR-B-BSK-CLEARING';
    v_res := public.run_reminders(current_date);
    if (v_res ->> 'sent')::integer <> 0
       or exists (select 1 from public.notification_schedule_log l where l.subject_id = v_basket) then
      raise exception 'a step on a rule that is off sent something (%)', v_res;
    end if;

    /* The night keeps it today and clears it tomorrow. */
    perform public.run_baskets_night(current_date);
    if not exists (select 1 from public.requisition_baskets b where b.id = v_basket) then
      raise exception 'the baskets night cleared a basket a day before its clearing night';
    end if;
    perform public.run_baskets_night(current_date + 1);
    if exists (select 1 from public.requisition_baskets b where b.id = v_basket) then
      raise exception 'the baskets night did not clear a basket on its clearing night';
    end if;

    raise exception using errcode = 'ZZ999', message = 'rolling the reminders check back';
  exception when sqlstate 'ZZ999' then
    null;
  end;

  /* Rolled back: a shopper reads the basket rules and cannot change them;
     the operator can, within the constraints, and the change is audited. */
  begin
    select p.id into v_cons from public.profiles p where p.persona = 'consumer' order by p.id limit 1;
    select p.id into v_op   from public.profiles p where p.persona = 'operator' order by p.id limit 1;
    if v_cons is null or v_op is null then
      raise exception 'no shopper and operator profiles to check the basket rules against';
    end if;
    /* From whatever the default is now: one day more (or less, at the cap). */
    select * into v_was from public.basket_settings s where s.market = 'default';
    if v_was.clear_after_days < 365 then
      v_to := v_was.clear_after_days + 1;
    else
      v_to := v_was.clear_after_days - 1;
    end if;

    perform set_config('request.jwt.claims', json_build_object('sub', v_cons, 'role', 'authenticated')::text, true);
    set local role authenticated;
    select count(*) into v_n from public.basket_settings;
    if v_n = 0 then reset role; raise exception 'a shopper cannot read the basket rules'; end if;
    update public.basket_settings s set clear_after_days = chk.v_to where s.market = 'default';
    get diagnostics v_n = row_count;
    if v_n <> 0 then reset role; raise exception 'a shopper changed the basket rules'; end if;
    reset role;

    perform set_config('request.jwt.claims', json_build_object('sub', v_op, 'role', 'authenticated')::text, true);
    set local role authenticated;
    update public.basket_settings s set clear_after_days = chk.v_to where s.market = 'default';
    get diagnostics v_n = row_count;
    if v_n <> 1 then reset role; raise exception 'the operator could not change the default basket rules'; end if;
    begin
      update public.basket_settings s set clear_after_days = s.abandoned_after_days where s.market = 'default';
      reset role;
      raise exception 'basket rules that clear no later than a basket is abandoned were accepted';
    exception when check_violation then
      null;
    end;
    reset role;
    perform set_config('request.jwt.claims', '', true);

    if not exists (select 1 from public.operator_audit_log a
                    where a.object = 'basket_settings:default' and a.category = 'Configuration'
                      and a.after_val = format('pending %s, abandoned after %s, clear after %s days',
                                               v_was.pending_days, v_was.abandoned_after_days, v_to)
                      and a.before_val = format('pending %s, abandoned after %s, clear after %s days',
                                                v_was.pending_days, v_was.abandoned_after_days, v_was.clear_after_days)) then
      raise exception 'the operator''s change to the basket rules is not in the audit log';
    end if;

    raise exception using errcode = 'ZZ999', message = 'rolling the basket rules check back';
  exception when sqlstate 'ZZ999' then
    null;
  end;
end $$;

commit;
