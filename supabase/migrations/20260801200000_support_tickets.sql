-- One support queue, four personas.
--
-- There were two ticket tables that did not know about each other.
-- `operator_tickets` held the marketplace's queue, with an `org` column of
-- free text; `consumer_tickets` held a customer's own, keyed on `user_id`.
-- A ticket a customer raised in the self-care portal therefore never reached
-- the queue the support desk actually works, and an enterprise buyer had no
-- way to raise one at all.
--
-- Merged into `support_tickets`, keyed on whoever raised it rather than on
-- which screen it came from. The thing that makes the SLA honest is the
-- waiting clock: time spent waiting on the requester does not count against
-- the resolution target. Without that exclusion the queue metric stops
-- measuring support and starts measuring how quickly customers reply to us,
-- and every desk learns to close tickets rather than answer them.

/* ============================================================ the table === */

do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'operator_tickets') then
    alter table operator_tickets rename to support_tickets;
  end if;
end $$;

/* Dropped up front and recreated at the end. The guard below refuses anything
   a requester may not do, and a re-run of this file is not a requester — with
   the trigger live from a previous apply, the seed cannot re-seed itself. */
drop trigger if exists support_tickets_guard on support_tickets;

alter table support_tickets add column if not exists persona text;
alter table support_tickets add column if not exists account_id text references enterprise_accounts(id) on delete cascade;
alter table support_tickets add column if not exists partner_id text references partners(id) on delete cascade;
alter table support_tickets add column if not exists user_id uuid references auth.users(id) on delete set null;
alter table support_tickets add column if not exists raised_by_member text references enterprise_users(id);
alter table support_tickets add column if not exists ref text;
alter table support_tickets add column if not exists channel text;
alter table support_tickets add column if not exists first_response_mins integer;
/* Minutes the clock has been stopped because we are waiting on them. */
alter table support_tickets add column if not exists waiting_minutes integer not null default 0;
alter table support_tickets add column if not exists waiting_since timestamptz;
alter table support_tickets add column if not exists resolved_at timestamptz;
alter table support_tickets add column if not exists resolution_note text;

/* `response_mins` was the first-response measure under its old name. */
update support_tickets set first_response_mins = response_mins where first_response_mins is null;

update support_tickets set persona = case
  when org ilike 'enterprise%' then 'enterprise'
  when org ilike 'partner%' or org ilike 'seller%' then 'partner'
  when org ilike 'consumer%' or org ilike 'retail%' then 'consumer'
  else 'operator' end
 where persona is null;

update support_tickets set channel = coalesce(channel, 'Operator console');
update support_tickets set waiting_since = opened_at
 where waiting_on_customer and waiting_since is null;

/* ------------------------------------------------------ the vocabulary -- */

/* States, spelled the same way everywhere. `inprogress` and `open` meant the
   same thing in two tables. */
update support_tickets set status = 'open' where status = 'inprogress';

alter table support_tickets drop constraint if exists support_tickets_status_check;
alter table support_tickets add constraint support_tickets_status_check
  check (status in ('new', 'open', 'waiting', 'escalated', 'resolved', 'closed'));

alter table support_tickets drop constraint if exists support_tickets_persona_check;
alter table support_tickets add constraint support_tickets_persona_check
  check (persona in ('operator', 'partner', 'enterprise', 'consumer'));

alter table support_tickets drop constraint if exists support_tickets_priority_check;
alter table support_tickets add constraint support_tickets_priority_check
  check (priority in ('P1', 'P2', 'P3', 'P4'));

create index if not exists support_tickets_account_idx on support_tickets(account_id, status);
create index if not exists support_tickets_partner_idx on support_tickets(partner_id, status);
create index if not exists support_tickets_user_idx on support_tickets(user_id, status);

/* ========================================================= the SLA rules === */

/* Targets per priority, one row each, so a screen quoting an SLA and a queue
   measuring against one cannot disagree. */
create table if not exists support_sla (
  priority        text primary key check (priority in ('P1', 'P2', 'P3', 'P4')),
  label           text not null,
  meaning         text not null,
  respond_mins    integer not null check (respond_mins > 0),
  resolve_mins    integer not null check (resolve_mins > 0),
  /* Business Plus and above get the first response target halved. Written
     here rather than in code so the tier benefit and the queue agree. */
  priority_queue_multiplier numeric(3,2) not null default 1.00,
  sort_order      integer not null
);

insert into support_sla (priority, label, meaning, respond_mins, resolve_mins, priority_queue_multiplier, sort_order) values
  ('P1', 'Critical', 'A service somebody is paying for is down, or nothing can be bought.', 30, 240, 0.50, 1),
  ('P2', 'High', 'Something important is broken but there is a way round it.', 120, 480, 0.50, 2),
  ('P3', 'Normal', 'A fault or a question that is not stopping work.', 480, 1440, 0.75, 3),
  ('P4', 'Low', 'A request for information, or something cosmetic.', 1440, 4320, 1.00, 4)
on conflict (priority) do update set
  label = excluded.label, meaning = excluded.meaning, respond_mins = excluded.respond_mins,
  resolve_mins = excluded.resolve_mins,
  priority_queue_multiplier = excluded.priority_queue_multiplier;

create table if not exists support_categories (
  id         text primary key,
  label      text not null,
  personas   text[] not null,
  hint       text not null,
  default_priority text not null references support_sla(priority),
  sort_order integer not null
);

insert into support_categories (id, label, personas, hint, default_priority, sort_order) values
  ('provisioning', 'Provisioning and activation', array['operator','partner','enterprise','consumer'],
   'Something was bought but never came on.', 'P1', 1),
  ('service', 'A service is down', array['operator','partner','enterprise','consumer'],
   'It worked and now it does not.', 'P1', 2),
  ('delivery', 'Delivery', array['operator','partner','enterprise','consumer'],
   'Hardware that has not arrived, or arrived damaged.', 'P3', 3),
  ('billing', 'Billing and invoices', array['operator','partner','enterprise','consumer'],
   'A charge that looks wrong, or an invoice that needs explaining.', 'P2', 4),
  ('licensing', 'Licences and seats', array['operator','enterprise'],
   'Seats that will not assign, or a count that does not match the contract.', 'P2', 5),
  ('security', 'Security incident', array['operator','enterprise'],
   'Anything that needs somebody looking at it now.', 'P1', 6),
  ('account', 'Account and access', array['operator','partner','enterprise','consumer'],
   'Sign-in, roles, or somebody who needs adding or removing.', 'P3', 7),
  ('contract', 'Contract and pricing', array['operator','enterprise'],
   'Renewal terms, contract pricing, or a quote.', 'P4', 8),
  ('other', 'Something else', array['operator','partner','enterprise','consumer'],
   'When none of the above fits.', 'P4', 9)
on conflict (id) do update set
  label = excluded.label, personas = excluded.personas, hint = excluded.hint,
  default_priority = excluded.default_priority, sort_order = excluded.sort_order;

/* Existing categories were free text in two different vocabularies. */
update support_tickets set category = case lower(category)
  when 'provisioning' then 'provisioning'
  when 'billing'      then 'billing'
  when 'logistics'    then 'delivery'
  when 'delivery'     then 'delivery'
  when 'product'      then 'delivery'
  when 'technical'    then 'service'
  when 'network'      then 'service'
  when 'account'      then 'account'
  else 'other' end
 where category not in (select id from support_categories);

/* ===================================================== what came across === */

do $$
declare c record; n integer;
begin
  /* Only on the first run — the table is dropped at the end of this block. */
  if not exists (select 1 from information_schema.tables
                  where table_schema = 'public' and table_name = 'consumer_tickets') then
    return;
  end if;

  for c in select * from consumer_tickets loop
    insert into support_tickets (
      id, subject, category, priority, status, opened_by, org, owner, opened_at,
      sla_mins, response_mins, first_response_mins, resolution_mins, breached, escalated,
      waiting_on_customer, messages, sort_order, persona, user_id, ref, channel,
      resolution_note)
    values (
      c.id, c.subject,
      case lower(c.category)
        when 'delivery' then 'delivery' when 'product' then 'delivery'
        when 'billing' then 'billing' when 'technical' then 'service' else 'other' end,
      c.severity,
      case c.status when 'inprogress' then 'open' else c.status end,
      c.opened_by, 'Consumer', c.owner,
      /* The old table stored "2 d ago" rather than a timestamp, so the clock
         could not be worked out at all. Reconstructed from the label. */
      now() - (case
        when c.opened like '%d ago' then (split_part(c.opened, ' ', 1) || ' days')::interval
        when c.opened like '%w ago' then (split_part(c.opened, ' ', 1) || ' weeks')::interval
        when c.opened like '%h ago' then (split_part(c.opened, ' ', 1) || ' hours')::interval
        else interval '1 day' end),
      c.sla_mins, null, null, c.resolution_mins, c.breached, c.escalated,
      false, c.messages, 100, 'consumer', c.user_id, c.order_ref, c.channel,
      /* Filled below from the last thing the desk actually said, rather than
         invented here. */
      null)
    on conflict (id) do nothing;
  end loop;
  select count(*) into n from support_tickets where persona = 'consumer';
  raise notice 'consumer tickets now in the shared queue: %', n;
end $$;

/* A resolved ticket has to say what the resolution was. The old tables did not
   carry one, so it is taken from the last thing the desk said on the thread —
   which is what a resolution note is, written down. */
update support_tickets t set resolution_note = (
  select m ->> 'text'
    from jsonb_array_elements(t.messages) with ordinality as x(m, n)
   where m ->> 'who' is distinct from t.opened_by
   order by n desc limit 1)
 where t.status in ('resolved', 'closed') and coalesce(t.resolution_note, '') = '';

update support_tickets set resolution_note = 'Closed without a note on the old queue. Reconstructed on migration.'
 where status in ('resolved', 'closed') and coalesce(resolution_note, '') = '';

drop table if exists consumer_tickets;

/* Added only now: the rows above had no resolution note until the backfill
   just above gave them one, so declaring it earlier would refuse the very
   data it is meant to protect. */
alter table support_tickets drop constraint if exists support_tickets_resolved_check;
alter table support_tickets add constraint support_tickets_resolved_check
  check (status not in ('resolved', 'closed') or coalesce(resolution_note, '') <> '');

/* --------------------------------------- the queue it inherited ---------- */

/* The operator's queue named organisations that exist nowhere else in the
   database — "Acme Logistics", "TechDyne Devices", "CloudSync Labs". A support
   desk whose tickets cannot be opened against a seller record or an account is
   a support desk that can only read them. Re-pointed at parties that exist, so
   every ticket can be traced back to somebody the marketplace actually deals
   with. */
update support_tickets set
  persona = 'consumer', org = 'Consumer',
  user_id = (select id from auth.users where email = 'priya.raman@example.com'),
  ref = 'ORD-880788'
 where id = 'tk-001';

update support_tickets set
  persona = 'partner', org = 'Nimbus Sensors', partner_id = 'PTR-1004',
  opened_by = 'Rajesh Kumar'
 where id in ('tk-002', 'tk-008');

update support_tickets set
  persona = 'enterprise', org = 'Brightline Foods', account_id = 'ENT-2011',
  opened_by = 'Farida Qureshi'
 where id = 'tk-003';

update support_tickets set
  persona = 'partner', org = 'Kestrel Devices', partner_id = 'PTR-1002',
  opened_by = 'Kestrel Devices admin'
 where id = 'tk-004';

update support_tickets set
  persona = 'partner', org = 'ClearVault Cloud', partner_id = 'PTR-1010',
  opened_by = 'ClearVault Cloud admin'
 where id = 'tk-005';

update support_tickets set
  persona = 'partner', org = 'StreamNova Media', partner_id = 'PTR-1001',
  opened_by = 'StreamNova Media admin'
 where id = 'tk-006';

update support_tickets set
  persona = 'enterprise', org = 'Harbourpoint Retail', account_id = 'ENT-2014',
  opened_by = 'Grace Wanjiru'
 where id = 'tk-007';

/* ================================================ the enterprise queue === */

do $$
declare u_ent uuid := (select id from auth.users where email = 'vikram.shah@smartbuild.in');
begin
  delete from support_tickets where id like 'SUP-9%';

  insert into support_tickets (id, subject, category, priority, status, opened_by, org, owner,
                               opened_at, sla_mins, response_mins, first_response_mins,
                               resolution_mins, breached, escalated, escalated_at,
                               waiting_on_customer, waiting_minutes, waiting_since, messages,
                               sort_order, persona, account_id, user_id, raised_by_member, ref,
                               channel, resolved_at, resolution_note) values

  ('SUP-9001', 'Sentinel MDR will not provision on four retail sites', 'provisioning', 'P1', 'escalated',
   'Karthik Nair', 'SmartBuild Ltd', 'Marketplace — Tier 2',
   '2026-07-31 08:05+00', 240, 22, 22, null, true, true, '2026-07-31 12:20+00',
   false, 0, null,
   '[{"who":"Karthik Nair","text":"Thirty endpoints across four retail sites are not provisioning. The seller console says the tenant identifier was rejected. These sites have no cover at all right now.","when":"31 Jul 08:05"},
     {"who":"Marketplace — Tier 1","text":"Confirmed on our side — the tenant was created under the wrong parent. Passing to Tier 2 with Sentinel on the call.","when":"31 Jul 08:27"},
     {"who":"System","text":"Past the four-hour resolution target. Escalated automatically.","when":"31 Jul 12:20"}]'::jsonb,
   1, 'enterprise', 'ENT-2007', u_ent, 'EU-2007-03', 'ORD-881517', 'Enterprise portal', null, null),

  ('SUP-9002', 'Invoice INV-2026-0781 — card declined, need to pay by transfer', 'billing', 'P2', 'waiting',
   'Vikram Shah', 'SmartBuild Ltd', 'Marketplace — Billing',
   '2026-07-30 09:40+00', 480, 46, 46, null, false, false, null,
   true, 1180, '2026-07-30 14:10+00',
   '[{"who":"Vikram Shah","text":"The card on file has expired and the July rollout invoice was declined. We would rather settle this one by bank transfer — can you send remittance details?","when":"30 Jul 09:40"},
     {"who":"Marketplace — Billing","text":"Of course. Bank details are on the invoice PDF, and I have put a note on the account so no dunning goes out while we wait. Can you confirm the payment reference you will use?","when":"30 Jul 10:26"},
     {"who":"System","text":"Waiting on the requester since 30 Jul 14:10. The resolution clock is paused.","when":"30 Jul 14:10"}]'::jsonb,
   2, 'enterprise', 'ENT-2007', u_ent, 'EU-2007-01', 'INV-2026-0781', 'Enterprise portal', null, null),

  ('SUP-9003', 'Twelve occupancy sensors will not pair with the gateway', 'delivery', 'P3', 'open',
   'Anita Desai', 'SmartBuild Ltd', 'Nimbus Sensors — Support',
   '2026-07-30 11:15+00', 1440, 95, 95, null, false, false, null,
   false, 0, null,
   '[{"who":"Anita Desai","text":"Twelve of the ninety sensors from the retail rollout will not pair. The other 78 came up first time so it is the units rather than the install. A refund request is already open — RFN-3240.","when":"30 Jul 11:15"},
     {"who":"Nimbus Sensors — Support","text":"Thanks — the pairing logs point at a firmware batch we shipped in June. We are checking the serial range now and will come back with either a firmware push or replacements.","when":"30 Jul 12:50"}]'::jsonb,
   3, 'enterprise', 'ENT-2007', u_ent, 'EU-2007-04', 'RFN-3240', 'Enterprise portal', null, null),

  ('SUP-9004', 'Add Sunita Rao as a finance viewer', 'account', 'P4', 'resolved',
   'Vikram Shah', 'SmartBuild Ltd', 'Marketplace — Tier 1',
   '2026-07-22 09:00+00', 4320, 38, 38, 190, false, false, null,
   false, 0, null,
   '[{"who":"Vikram Shah","text":"Please add sunita.rao@smartbuild.in as a viewer. She needs the invoices and nothing else.","when":"22 Jul 09:00"},
     {"who":"Marketplace — Tier 1","text":"Invitation sent. She has read access to billing and the audit log, and cannot raise or approve anything.","when":"22 Jul 09:38"},
     {"who":"Vikram Shah","text":"Perfect, thank you.","when":"22 Jul 12:10"}]'::jsonb,
   4, 'enterprise', 'ENT-2007', u_ent, 'EU-2007-01', null, 'Enterprise portal', '2026-07-22 12:10+00',
   'Sunita Rao invited as a viewer with read access to billing and the audit log only. She cannot raise or approve anything.'),

  ('SUP-9005', 'Contract pricing review before the Sentinel renewal', 'contract', 'P4', 'resolved',
   'Vikram Shah', 'SmartBuild Ltd', 'Marketplace — Account team',
   '2026-07-08 14:00+00', 4320, 210, 210, 2760, false, false, null,
   false, 0, null,
   '[{"who":"Vikram Shah","text":"Sentinel MDR renews on 12 Aug at 250 endpoints. We are only using 231. Can we review the rate before it rolls?","when":"08 Jul 14:00"},
     {"who":"Marketplace — Account team","text":"Business Plus includes a pricing review at every renewal, so yes. I have asked Sentinel for a 220-endpoint quote and will come back before the end of the month.","when":"08 Jul 17:30"},
     {"who":"Marketplace — Account team","text":"Sentinel will hold the current per-endpoint rate at 220. That saves $285 a month against renewing as-is. Reduce the count on the subscription before 12 Aug and it takes effect at renewal.","when":"10 Jul 12:00"}]'::jsonb,
   5, 'enterprise', 'ENT-2007', u_ent, 'EU-2007-01', 'SUB-7781', 'Enterprise portal', '2026-07-10 12:00+00',
   'Sentinel will hold the current per-endpoint rate at 220 endpoints, saving $285 a month against renewing at 250. The count has to be reduced before 12 Aug to take effect at renewal.');
end $$;

/* An escalation that does not say when it happened cannot be measured, and the
   migrated rows had the flag without the moment. Taken as the point the
   resolution target ran out, which is when the escalation would have fired. */
update support_tickets set escalated_at = opened_at + (sla_mins || ' minutes')::interval
 where escalated and escalated_at is null;

/* The target a ticket is held to comes from the policy, not from whatever was
   typed into the row when it was raised. Both old queues carried their own
   numbers, so the same P2 was measured against 480 minutes on one screen and
   1,440 on another. */
update support_tickets t set sla_mins = s.resolve_mins
  from support_sla s where s.priority = t.priority and t.sla_mins <> s.resolve_mins;

/* ================================================================= RLS === */

alter table support_tickets    enable row level security;
alter table support_sla        enable row level security;
alter table support_categories enable row level security;

drop policy if exists "operator_all_operator_tickets" on support_tickets;
drop policy if exists "operator_all_support_tickets" on support_tickets;
drop policy if exists "account_read_support_tickets" on support_tickets;
drop policy if exists "account_write_support_tickets" on support_tickets;
drop policy if exists "own_support_tickets" on support_tickets;
drop policy if exists "partner_support_tickets" on support_tickets;
drop policy if exists "read_support_sla" on support_sla;
drop policy if exists "read_support_categories" on support_categories;

create policy "read_support_sla" on support_sla for select to authenticated using (true);
create policy "read_support_categories" on support_categories for select to authenticated using (true);

/* The desk sees everything, because it is the desk. */
create policy "operator_all_support_tickets" on support_tickets for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* An account sees every ticket raised by anybody on it — support is a shared
   inbox, not a private one. A colleague picking up somebody's ticket while
   they are away is the normal case, not an edge case. */
create policy "account_read_support_tickets" on support_tickets
  for select to authenticated using (account_id = current_account_id());
create policy "account_write_support_tickets" on support_tickets
  for all to authenticated
  using (account_id = current_account_id()) with check (account_id = current_account_id());

create policy "own_support_tickets" on support_tickets
  for all to authenticated
  using (user_id = auth.uid() and account_id is null)
  with check (user_id = auth.uid() and account_id is null);

create policy "partner_support_tickets" on support_tickets
  for select to authenticated using (partner_id = current_partner_id());

/* -------------------------------------------------- what a requester may -- */

/**
 * What somebody outside the marketplace may change on a ticket.
 *
 * They may raise one, add to the thread, and say it is resolved. They may not
 * move the SLA, reassign it, un-escalate it or mark it resolved on the desk's
 * behalf with the clock still running — those are the numbers the desk is
 * measured on, and a queue whose customers can edit its own metrics is not a
 * measurement.
 */
create or replace function guard_ticket() returns trigger
language plpgsql security definer set search_path = public as $$
declare sla record;
begin
  /* Clamped to actual requesters. A null persona is a migration or a service
     role, and treating it as a requester means this trigger silently rewrites
     the seed it is meant to protect — which is exactly what happened the first
     time it ran. */
  if current_persona() is null or current_persona() = 'operator' then return new; end if;

  if tg_op = 'INSERT' then
    select * into sla from support_sla where priority = new.priority;
    if sla is null then raise exception 'no such priority: %', new.priority; end if;
    if new.status <> 'new' then
      raise exception 'a ticket starts as new — it cannot be raised already open or resolved';
    end if;
    /* The targets come from the policy, never from the client. */
    new.sla_mins := sla.resolve_mins;
    new.response_mins := null;
    new.first_response_mins := null;
    new.breached := false;
    new.escalated := false;
    new.waiting_minutes := 0;
    new.resolution_mins := null;
    new.opened_at := now();
    return new;
  end if;

  /* Numbers the desk is measured on stay as they were. */
  new.sla_mins := old.sla_mins;
  new.response_mins := old.response_mins;
  new.first_response_mins := old.first_response_mins;
  new.resolution_mins := old.resolution_mins;
  new.breached := old.breached;
  new.escalated := old.escalated;
  new.escalated_at := old.escalated_at;
  new.owner := old.owner;
  new.opened_at := old.opened_at;
  new.priority := old.priority;
  new.waiting_minutes := old.waiting_minutes;

  /* Replying clears "waiting on the requester" and banks the paused time —
     that is the whole point of the pause. */
  if old.waiting_on_customer and jsonb_array_length(new.messages) > jsonb_array_length(old.messages) then
    new.waiting_on_customer := false;
    new.waiting_minutes := old.waiting_minutes
      + coalesce(extract(epoch from (now() - old.waiting_since)) / 60, 0)::integer;
    new.waiting_since := null;
  end if;

  if new.status not in (old.status, 'resolved', 'closed') then
    raise exception 'a requester can add to a ticket or accept the resolution, not move it to %', new.status;
  end if;
  if new.status in ('resolved', 'closed') and coalesce(new.resolution_note, '') = '' then
    raise exception 'say what resolved it — a ticket closed with no note is one somebody cleared from a queue';
  end if;
  if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
    new.resolved_at := now();
  end if;

  return new;
end $$;

drop trigger if exists support_tickets_guard on support_tickets;
create trigger support_tickets_guard before insert or update on support_tickets
  for each row execute function guard_ticket();

/* ------------------------------------------------------ sanity checks -- */
do $$
declare n integer;
begin
  /* Every ticket belongs to somebody, or nobody can see it. */
  select count(*) into n from support_tickets
   where account_id is null and user_id is null and partner_id is null and persona <> 'operator';
  if n > 0 then raise exception '% tickets belong to nobody', n; end if;

  /* Every one names a category and a priority the policy knows. */
  select count(*) into n from support_tickets t
   where not exists (select 1 from support_categories c where c.id = t.category);
  if n > 0 then raise exception '% tickets are in a category that does not exist', n; end if;

  select count(*) into n from support_tickets t
   where not exists (select 1 from support_sla s where s.priority = t.priority);
  if n > 0 then raise exception '% tickets have a priority the SLA does not cover', n; end if;

  /* A ticket's target is the one its priority actually carries. */
  select count(*) into n from support_tickets t
    join support_sla s on s.priority = t.priority
   where t.sla_mins <> s.resolve_mins;
  if n > 0 then raise exception '% tickets are held to a target their priority does not set', n; end if;

  /* Anything closed says what closed it. */
  select count(*) into n from support_tickets
   where status in ('resolved', 'closed') and coalesce(resolution_note, '') = '';
  if n > 0 then raise exception '% resolved tickets have no resolution on them', n; end if;

  /* A paused clock has a time it was paused at, or the pause cannot be
     measured and becomes an excuse rather than a rule. */
  select count(*) into n from support_tickets
   where waiting_on_customer and waiting_since is null;
  if n > 0 then raise exception '% tickets are waiting on the requester with no clock', n; end if;

  /* An escalation has a moment it happened. */
  select count(*) into n from support_tickets where escalated and escalated_at is null;
  if n > 0 then raise exception '% escalated tickets do not say when', n; end if;

  /* Every persona has something in the queue, or one of the screens is empty. */
  select count(distinct persona) into n from support_tickets;
  if n < 3 then raise exception 'only % personas have tickets', n; end if;

  /* The demo account has the three cases its screen exists to explain. */
  select count(*) into n from support_tickets where account_id = 'ENT-2007' and status = 'escalated';
  if n < 1 then raise exception 'the demo account has nothing escalated'; end if;
  select count(*) into n from support_tickets where account_id = 'ENT-2007' and status = 'waiting';
  if n < 1 then raise exception 'the demo account has nothing waiting on it'; end if;
  select count(*) into n from support_tickets where account_id = 'ENT-2007' and status in ('resolved', 'closed');
  if n < 2 then raise exception 'the demo account has no resolved tickets to look back on'; end if;

  /* Every reference on a ticket points at something real. */
  select count(*) into n from support_tickets t
   where t.ref like 'INV-%' and not exists (select 1 from enterprise_invoices i where i.id = t.ref);
  if n > 0 then raise exception '% tickets name an invoice that does not exist', n; end if;
  select count(*) into n from support_tickets t
   where t.ref like 'RFN-%' and not exists (select 1 from refunds r where r.id = t.ref);
  if n > 0 then raise exception '% tickets name a refund that does not exist', n; end if;
  select count(*) into n from support_tickets t
   where t.ref like 'SUB-7%' and not exists (select 1 from enterprise_subscriptions s where s.id = t.ref);
  if n > 0 then raise exception '% tickets name a subscription that does not exist', n; end if;
end $$;
