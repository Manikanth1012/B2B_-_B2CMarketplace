-- An application arrives and there is nowhere for it to go.
--
-- `20260803000000` let a stranger apply. The desk can read what came in — the
-- operator policy on `partner_applications` says so — and can do nothing with
-- it. An application sits at 'submitted' forever, because the only thing that
-- turns one into a partner is a person deciding to, and there was no way to
-- record that decision.
--
-- Accepting is not one write. It is a partner row, seven gates with the first
-- one open, the task ladder behind those gates, the markets the applicant asked
-- to sell in, their contact details, a lifecycle event saying who let them in,
-- and the application marked accepted so it cannot be accepted twice.
--
-- That is eight tables, and the existing desk-created path does the first three
-- of them from the browser with a toast for each failure —
--
--     if (gErr) toast(`The partner was created but its gates were not: ...`)
--
-- — which is an accurate message about a partner that now exists with no gates,
-- no tasks and no way to progress. Nobody can fix that from the screen. So this
-- is one `security definer` function and one transaction: it all happens or
-- none of it does.
--
-- The task ladder moves into a table on the way past. It was written out twice
-- already — once in the migration that seeded the existing sellers and once as
-- a constant in `OperatorOnboarding.tsx` — and this function would have been
-- the third copy. Three copies of a list is three lists.

/* ============================ the asks behind each gate === */

create table if not exists onboarding_task_ladder (
  id       text primary key,
  gate_id  text not null,
  title    text not null,
  detail   text not null,
  /* 'Partner' or 'Marketplace' — who has to go and do it. A gate where every
     task is the marketplace's is a gate the seller cannot unblock, which is
     worth being able to see. */
  owner    text not null,
  /* Working days from the gate opening. Turned into the task's `due` when an
     application is accepted. */
  days     integer not null,
  sort_order integer not null
);

comment on table onboarding_task_ladder is
  'What each gate actually asks for. One list, read by `accept_application` and by the desk''s own screens — it was previously written out both in a migration and as a constant in the operator console, and a third copy was about to be added here.';

alter table onboarding_task_ladder enable row level security;

/* Readable by anyone signed in: a seller looking at their own journey is
   reading this list through their tasks, and a prospective one is told what
   each gate asks on the public application page. Writable by the operator. */
drop policy if exists anyone_read_task_ladder on onboarding_task_ladder;
create policy anyone_read_task_ladder on onboarding_task_ladder for select using (true);

drop policy if exists operator_all_task_ladder on onboarding_task_ladder;
create policy operator_all_task_ladder on onboarding_task_ladder
  for all using (current_persona() = 'operator');

insert into onboarding_task_ladder (id, gate_id, title, detail, owner, days, sort_order) values
  ('apply-form',      'apply',   'Application form submitted', 'Company details, target marketplace categories and expected monthly volume.', 'Partner', 14, 10),
  ('apply-contact',   'apply',   'Primary contact confirmed', 'A named person who can sign, with a working address on the company domain.', 'Partner', 14, 20),
  ('kyc-inc',         'kyc',     'Certificate of incorporation', 'Verified against the register in the country of registration.', 'Partner', 5, 30),
  ('kyc-ubo',         'kyc',     'Beneficial ownership declaration', 'Everyone holding over 25%, with identification for each.', 'Partner', 5, 40),
  ('kyc-screen',      'kyc',     'Sanctions and PEP screening', 'OFAC, EU, UN and HMT lists, plus adverse media.', 'Marketplace', 2, 50),
  ('agree-terms',     'agree',   'Marketplace terms e-signed', 'Version 4.2, signed by someone with authority to bind the company.', 'Partner', 5, 60),
  ('agree-dpa',       'agree',   'Data processing agreement', 'Standard contractual clauses, with sub-processors declared.', 'Partner', 5, 70),
  ('agree-sched',     'agree',   'Commission schedule counter-signed', 'The plan the seller will actually settle on, signed by both sides.', 'Marketplace', 3, 80),
  ('finance-bank',    'finance', 'Settlement bank account verified', 'Two micro-deposits are sent to the nominated account. The amounts have to be confirmed before any money moves in the other direction.', 'Partner', 3, 90),
  ('finance-tax',     'finance', 'Tax residency certificate', 'A valid certificate applies the treaty withholding rate. Without one, the statutory rate is withheld at source.', 'Partner', 3, 100),
  ('tech-feed',       'tech',    'Catalogue method agreed', 'API feed or portal upload, with the update frequency stated.', 'Partner', 5, 110),
  ('tech-hook',       'tech',    'Fulfilment webhook reachable', 'Responds to a signed test call over TLS inside the timeout.', 'Partner', 5, 120),
  ('tech-sbx',        'tech',    'Sandbox order completed end to end', 'One order placed, fulfilled and settled in sandbox before anything is sold for real.', 'Partner', 5, 130),
  ('assure-sec',      'assure',  'Security questionnaire', '52-question baseline covering data handling, retention and sub-processors.', 'Partner', 8, 140),
  ('assure-policy',   'assure',  'Content and listing policy acknowledged', 'Including the category rules that apply to what they intend to sell.', 'Partner', 8, 150),
  ('assure-audit',    'assure',  'Sample listing audit', 'Three listings reviewed against the policy before the storefront opens.', 'Marketplace', 4, 160),
  ('golive-store',    'golive',  'Storefront enabled', 'The seller becomes visible to buyers in the categories they were approved for.', 'Marketplace', 1, 170),
  ('golive-first',    'golive',  'First listings published', 'At least one live listing, so the storefront is not an empty shop.', 'Partner', 2, 180)
on conflict (id) do update set
  gate_id = excluded.gate_id, title = excluded.title, detail = excluded.detail,
  owner = excluded.owner, days = excluded.days, sort_order = excluded.sort_order;

/* ============================ the gate ladder, as data === */

/* The gates themselves were only ever a TypeScript constant plus whatever rows
   the seed migration wrote per seller. `accept_application` has to build seven
   of them from nothing, so the shape they are built from lives here rather than
   being written out inside the function body. */
create table if not exists onboarding_gate_ladder (
  id           text primary key,
  name         text not null,
  gate_order   integer not null unique,
  owner        text not null,
  target_days  integer not null,
  dual_control boolean not null,
  waivable     boolean not null
);

alter table onboarding_gate_ladder enable row level security;
drop policy if exists anyone_read_gate_ladder on onboarding_gate_ladder;
create policy anyone_read_gate_ladder on onboarding_gate_ladder for select using (true);
drop policy if exists operator_all_gate_ladder on onboarding_gate_ladder;
create policy operator_all_gate_ladder on onboarding_gate_ladder
  for all using (current_persona() = 'operator');

insert into onboarding_gate_ladder (id, name, gate_order, owner, target_days, dual_control, waivable) values
  ('apply',   'Application',         1, 'Marketplace onboarding desk', 0, false, true),
  ('kyc',     'KYC & due diligence', 2, 'Risk and compliance',         2, true,  false),
  ('agree',   'Agreements',          3, 'Legal',                       1, true,  false),
  ('finance', 'Bank & tax',          4, 'Finance',                     1, true,  true),
  ('tech',    'Technical readiness', 5, 'Platform engineering',        1, false, false),
  ('assure',  'Compliance review',   6, 'Risk and compliance',         0, true,  true),
  ('golive',  'Go-live',             7, 'Marketplace onboarding desk', 0, false, true)
on conflict (id) do update set
  name = excluded.name, gate_order = excluded.gate_order, owner = excluded.owner,
  target_days = excluded.target_days, dual_control = excluded.dual_control,
  waivable = excluded.waivable;

/* ============================ accepting one === */

create sequence if not exists partner_ref_seq start 1016;

/* The journey itself — seven gates with the first open, and the task ladder
   behind them. Shared, because there are two ways a seller starts one: accepted
   from an application, or opened by the desk on somebody's behalf. Two copies of
   this would be two ladders, and the one nobody looked at would be the one that
   drifted. */
create or replace function open_partner_journey(
  p_partner text, p_note text,
  p_submitted_by text default null, p_submitted_at timestamptz default null,
  p_evidence text[] default '{}'::text[]
) returns void language plpgsql security definer set search_path = public as $$
begin
  insert into onboarding_gates (
    id, partner_id, gate_name, gate_order, status, owner, target_days,
    dual_control, waivable, submitted_by, submitted_at, evidence, notes, sort_order)
  select 'og-' || p_partner || '-' || g.id, p_partner, g.name, g.gate_order,
         case when g.gate_order = 1 then 'current' else 'pending' end,
         g.owner, g.target_days, g.dual_control, g.waivable,
         /* Only the application gate can already be submitted, and only when
            somebody actually submitted something — a desk-opened journey passes
            nothing here, because nobody has. A gate marked submitted with no
            submitter is a queue lying about who it waits on. */
         case when g.gate_order = 1 then p_submitted_by end,
         case when g.gate_order = 1 then p_submitted_at end,
         case when g.gate_order = 1 then p_evidence else '{}'::text[] end,
         p_note, g.gate_order
    from onboarding_gate_ladder g;

  insert into onboarding_tasks (id, partner_id, gate_id, title, detail, owner, due)
  select 'OB-' || replace(p_partner, 'PTR-', '') || '-' || t.id,
         p_partner, t.gate_id, t.title, t.detail, t.owner,
         /* Only the open gate's tasks carry a date. A due date on a gate that
            has not started is a deadline nobody agreed to, and it makes the
            chase list wrong from the first day. */
         case when t.gate_id = 'apply'
              then case when t.days <= 1 then 'Today' else 'In ' || t.days || ' days' end
         end
    from onboarding_task_ladder t;
end $$;

/* The desk opening one itself, for a seller who came in by some other route —
   a conversation, an event, an existing commercial relationship.

   It exists as a function for the same reason accepting does. The screen used to
   do these three writes from the browser and report "the partner was created but
   its gates were not", which describes a seller nobody can progress and nobody
   can fix from that screen. */
create or replace function open_application_by_desk(
  p_name text, p_type text, p_contact text default null,
  p_email text default null, p_country text default null
) returns text language plpgsql security definer set search_path = public as $$
declare v_partner text; v_actor text;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace can open an application.';
  end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Give the seller a name.'; end if;
  if coalesce(trim(p_type), '') = '' then raise exception 'Say what kind of seller they are.'; end if;

  v_actor := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'email', 'the onboarding desk');
  v_partner := 'PTR-' || nextval('partner_ref_seq')::text;

  insert into partners (id, name, type, status, country, contact, email, joined, tier, tier_id)
  values (v_partner, trim(p_name), trim(p_type), 'onboarding',
          nullif(trim(coalesce(p_country, '')), ''), nullif(trim(coalesce(p_contact, '')), ''),
          nullif(trim(coalesce(p_email, '')), ''), to_char(now(), 'DD Mon YYYY'), 'Bronze', 'bronze');

  perform open_partner_journey(v_partner, 'Opened by ' || v_actor || ' for ' || trim(p_name) || '.');

  insert into partner_lifecycle_events (id, partner_id, from_status, to_status, reason, actor, at)
  values (v_partner || '-opened', v_partner, null, 'onboarding',
          'Opened at the desk rather than through an application.', v_actor, now());

  return v_partner;
end $$;

create or replace function accept_application(p_ref text, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  app partner_applications;
  v_partner text;
  v_actor text;
  v_country text;
  v_markets text[];
  n integer;
begin
  /* Only the desk. `security definer` runs as the owner, so without this the
     function would be a way for anybody at all to mint a partner — the whole
     point of the definer is to reach tables the caller cannot, and that cuts
     both ways. */
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace can accept an application.';
  end if;

  select * into app from partner_applications where id = upper(trim(p_ref));
  if app.id is null then
    raise exception 'No application called %.', p_ref;
  end if;
  if app.state = 'accepted' then
    raise exception '% was already accepted, and is now partner %.', app.id, app.partner_id;
  end if;
  if app.state <> 'submitted' then
    raise exception '% is %, so there is nothing to accept yet.', app.id, app.state;
  end if;

  /* Everything required has to be answered. `submit_application` checks this
     too — and the desk can add a question after somebody submitted, so the
     check is made again at the point it actually matters. */
  select count(*) into n
    from partner_application_fields f
   where f.required
     and not exists (select 1 from partner_application_answers a
                      where a.application_id = app.id and a.field_id = f.id);
  if n > 0 then
    raise exception '% is missing % required answers. Send it back rather than accepting it.', app.id, n;
  end if;

  v_actor := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'email', 'the onboarding desk');
  v_partner := 'PTR-' || nextval('partner_ref_seq')::text;
  select m.name into v_country from markets m where m.code = app.country;

  insert into partners (id, name, type, status, country, contact, email, joined, tier, tier_id)
  values (v_partner, app.company, app.kind, 'onboarding', v_country,
          app.contact_name, app.email, to_char(now(), 'DD Mon YYYY'), 'Bronze', 'bronze');

  /* The application gate arrives already submitted — the applicant did that, on
     a date the record keeps — and its evidence is the list of questions they
     answered, read off the form rather than written out. */
  perform open_partner_journey(
    v_partner,
    'Opened from ' || app.id || ' by ' || v_actor
      || case when coalesce(trim(p_note), '') = '' then '' else ': ' || trim(p_note) end,
    app.contact_name, app.submitted_on,
    array(select f.label from partner_application_fields f
           where f.gate_id = 'apply' and f.required order by f.sort_order));

  /* The markets they asked for, requested rather than approved — that is what
     the market gate is for, and writing them approved here would hand a
     stranger three markets on the strength of a form. Matched by name because
     that is what the question offers, and `20260803000000` asserts those
     options are market names. */
  v_markets := string_to_array(
    coalesce((select a.value from partner_application_answers a
               where a.application_id = app.id and a.field_id = 'apply-markets'), ''), ',');
  insert into partner_markets (partner_id, market_code, state, note)
  select v_partner, m.code, 'requested',
         'Asked for on ' || app.id || '. Approved at the compliance gate, not before.'
    from markets m
   where m.name = any (select trim(x) from unnest(v_markets) x)
  on conflict do nothing;

  insert into partner_contacts (id, partner_id, kind, value, purpose, label, verified, sort_order)
  values (v_partner || '-email', v_partner, 'email', app.email, 'signin', app.contact_name, false, 1),
         (v_partner || '-phone', v_partner, 'phone', app.phone, 'escalation', app.contact_name, false, 2)
  on conflict (id) do nothing;

  insert into partner_lifecycle_events (id, partner_id, from_status, to_status, reason, actor, at)
  values (v_partner || '-accepted', v_partner, null, 'onboarding',
          'Accepted from ' || app.id
            || case when coalesce(trim(p_note), '') = '' then '.' else ': ' || trim(p_note) end,
          v_actor, now());

  update partner_applications
     set state = 'accepted', partner_id = v_partner, last_saved = now()
   where id = app.id;

  return v_partner;
end $$;

/* ============================ turning one away === */

create or replace function withdraw_application(p_ref text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare app partner_applications;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace can withdraw an application.';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Give a reason. An application closed with no reason cannot be explained to the person who filled it in.';
  end if;

  select * into app from partner_applications where id = upper(trim(p_ref));
  if app.id is null then raise exception 'No application called %.', p_ref; end if;
  /* An accepted one is a partner now, and the partner's own lifecycle is where
     that gets undone — `movePartner` and `partner_lifecycle_events`. Withdrawing
     it here would leave a live seller whose application says it never happened. */
  if app.state = 'accepted' then
    raise exception '% is already partner %. Suspend the partner instead.', app.id, app.partner_id;
  end if;

  update partner_applications
     set state = 'withdrawn', last_saved = now()
   where id = app.id;
end $$;

revoke all on function accept_application(text, text)   from public, anon, authenticated;
revoke all on function withdraw_application(text, text) from public, anon, authenticated;
revoke all on function open_application_by_desk(text, text, text, text, text) from public, anon, authenticated;
/* Not granted to anybody: it writes gates for whatever partner id it is handed,
   with no persona check of its own. The three functions above call it as the
   definer, after checking. */
revoke all on function open_partner_journey(text, text, text, timestamptz, text[]) from public, anon, authenticated;

grant execute on function accept_application(text, text)   to authenticated;
grant execute on function withdraw_application(text, text) to authenticated;
grant execute on function open_application_by_desk(text, text, text, text, text) to authenticated;
/* Granted to `authenticated` rather than to a role per persona, because a
   persona is a JWT claim and not a database role — which is exactly why both
   functions check `current_persona()` in their first three lines. Never to
   anon: an anonymous caller must not be able to reach either. */
revoke all on sequence partner_ref_seq from public, anon, authenticated;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text; m integer;
begin
  /* The ladder covers the gates, and the gates are the seven the marketplace
     publishes. Ranged over the two tables against each other rather than
     against a list here — that list is what this migration exists to delete. */
  select string_agg(g.id, ', ') into s
    from onboarding_gate_ladder g
   where not exists (select 1 from onboarding_task_ladder t where t.gate_id = g.id);
  if s is not null then raise exception 'these gates ask for nothing: %', s; end if;

  select string_agg(distinct t.gate_id, ', ') into s
    from onboarding_task_ladder t
   where not exists (select 1 from onboarding_gate_ladder g where g.id = t.gate_id);
  if s is not null then raise exception 'these tasks sit behind a gate that does not exist: %', s; end if;

  select count(*) into n from onboarding_gate_ladder;
  if n <> 7 then raise exception 'the ladder has % gates, not seven', n; end if;

  /* The published SLA is the sum of the ladder. A ladder adding up to more than
     the five working days on the landing page is a promise the desk cannot
     keep, and the number on the page is computed from the same figures. */
  select sum(target_days) into n from onboarding_gate_ladder;
  if n <> 5 then raise exception 'the gate ladder sums to % days against a published SLA of 5', n; end if;

  /* And it matches what every seller already on the marketplace was given. A
     ladder that disagrees with the existing rows would give new sellers a
     different journey from the one the screens were built around. */
  select string_agg(x.gate_name || ' (' || x.gate_order || ')', '; ') into s
    from (select distinct gate_name, gate_order, owner, target_days from onboarding_gates) x
   where not exists (
     select 1 from onboarding_gate_ladder g
      where g.name = x.gate_name and g.gate_order = x.gate_order
        and g.owner = x.owner and g.target_days = x.target_days);
  if s is not null then
    raise exception 'the ladder disagrees with the gates existing sellers hold: %', s;
  end if;

  /* Neither function is reachable without a session, and both refuse anybody
     who is not the desk. Asked with `has_function_privilege` — looking for a
     grant row missed exactly this in `20260803000000`. */
  select string_agg(f.fn, ', ') into s
    from (values ('accept_application(text,text)'),
                 ('withdraw_application(text,text)'),
                 ('open_application_by_desk(text,text,text,text,text)'),
                 ('open_partner_journey(text,text,text,timestamptz,text[])')) as f(fn)
   where has_function_privilege('anon', f.fn, 'EXECUTE');
  if s is not null then raise exception 'an anonymous caller can reach: %', s; end if;

  select string_agg(f.fn, ', ') into s
    from (values ('accept_application(text,text)'),
                 ('withdraw_application(text,text)'),
                 ('open_application_by_desk(text,text,text,text,text)')) as f(fn)
   where not has_function_privilege('authenticated', f.fn, 'EXECUTE');
  if s is not null then raise exception 'the desk cannot reach: %', s; end if;

  /* And the unguarded helper is reachable by nobody. It writes gates for
     whatever partner id it is given and checks no persona of its own — the
     three above call it as the definer, having checked. */
  if has_function_privilege('authenticated', 'open_partner_journey(text,text,text,timestamptz,text[])', 'EXECUTE') then
    raise exception 'open_partner_journey is callable by a client and it checks nothing';
  end if;

  /* A partner reference is never reissued. The sequence starts past every id
     already on the marketplace — starting inside the existing range would
     collide on the first accept, and the primary key would catch it, which is
     a worse place to find out. */
  select count(*) into n from partners
   where id ~ '^PTR-\d+$'
     and substring(id from 5)::integer >= (select last_value from partner_ref_seq);
  if n > 0 then
    raise exception '% existing partners sit at or above the next reference the sequence will issue', n;
  end if;

  /* Every accepted application names a partner that exists, and every partner
     made from one is named by exactly one. Nothing has been accepted yet, so
     this is a floor for later rather than a check of now — said plainly instead
     of dressed up as a passing test. */
  select count(*) into n from partner_applications where state = 'accepted' and partner_id is null;
  if n > 0 then raise exception '% accepted applications name no partner', n; end if;

  select count(*) into n from partner_applications a
   where a.partner_id is not null
     and not exists (select 1 from partners p where p.id = a.partner_id);
  if n > 0 then raise exception '% applications name a partner that does not exist', n; end if;

  select count(*) into m from partner_application_fields where gate_id = 'apply' and required;
  if m = 0 then
    raise exception 'the application gate has no required questions, so an accepted seller would open with no evidence listed';
  end if;
end $$;
