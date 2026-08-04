-- "Apply to sell" opens the sign-in screen.
--
-- The seven gates are real and they work: `onboarding_gates`, `onboarding_tasks`
-- and the clear/waive machinery have been right since `20260728...`. But every
-- one of them is scoped by `current_partner_id()`, and `partners` is invisible
-- to anon — so the whole journey starts one step after the point a prospective
-- seller actually arrives. A visitor who clicks "Apply to sell" is sent to a
-- login screen they have no credentials for, and the button does nothing a
-- stranger can act on.
--
-- What is missing is the step before the partner exists: an application.
--
--   who fills it in   somebody with no account, identified by an email address
--                     and a contact number and nothing else.
--   how they get back  a reference and an access code, issued on the first save
--                     and quoted to resume. Not a password and not pretending to
--                     be one — see the note on `access_code` below.
--   what it collects  what each of the seven gates needs, asked in gate order,
--                     because that is the order the desk will read it in.
--   what it becomes   a `partners` row, when the onboarding desk accepts it.
--                     Not before: an application is not a partner, and writing
--                     one straight into `partners` would put an unvetted
--                     stranger in the seller directory.
--
-- The fields are a table rather than a form. Three reasons, and the third is
-- the one that matters: the desk can change what it asks without a deploy; the
-- form and the completeness check read one list so they cannot disagree; and
-- the assertion that a submitted application is complete ranges over the set of
-- fields that exists rather than a list written out by hand here. A hand-written
-- list is a list that stops matching the form the first time somebody adds a
-- question to it.

/* ============================ what the desk asks === */

create table if not exists partner_application_fields (
  id          text primary key,
  gate_id     text not null,
  label       text not null,
  hint        text,
  /* `kind` drives the input: text, longtext, email, phone, number, choice,
     multichoice, boolean, date. `options` is a comma-separated list for the two
     choice kinds and null otherwise. */
  kind        text not null,
  options     text,
  required    boolean not null default true,
  sort_order  integer not null
);

comment on table partner_application_fields is
  'What an applicant is asked, per gate. A table and not a form component: the completeness check, the assertions and the screen all read this one list, so a question added here appears everywhere at once and cannot be enforced in one place and missing from another.';

alter table partner_application_fields enable row level security;

drop policy if exists anyone_read_application_fields on partner_application_fields;
create policy anyone_read_application_fields on partner_application_fields
  for select using (true);

drop policy if exists operator_all_application_fields on partner_application_fields;
create policy operator_all_application_fields on partner_application_fields
  for all using (current_persona() = 'operator');

/* ============================ the application === */

create table if not exists partner_applications (
  /* The reference. Quoted in an email, read out on the phone to the desk, and
     deliberately human-shaped — it is not the credential. */
  id            text primary key,
  /* The credential. Random, not derived from anything about the applicant, and
     paired with the email to resume.

     It is a bearer token with a weak second factor, not a password: there is no
     hashing here and no rate limiting, because this prototype has neither a
     mail sender to deliver a reset nor a way to lock an account. An application
     holds a company's registration and bank details, so that trade-off is
     written down rather than implied — before this is exposed to real
     applicants the code wants hashing, an expiry and an attempt counter. */
  access_code   text not null,
  email         text not null,
  phone         text not null,
  company       text not null,
  contact_name  text not null,
  country       text not null references markets(code),
  kind          text not null,
  /* 'draft' while the applicant is still filling it in, 'submitted' once it is
     with the desk, 'accepted' when a partner record has been made from it, and
     'withdrawn' if they stop. There is no 'declined' — a declined application
     is a decision the gates record, and it belongs on the partner. */
  state         text not null default 'draft',
  /* The furthest gate they have reached, so resuming lands where they left off
     rather than at the start. Not the same as "the gates they have finished" —
     that is derived from the answers. */
  reached       integer not null default 1,
  started       timestamptz not null default now(),
  last_saved    timestamptz not null default now(),
  submitted_on  timestamptz,
  /* Set when the desk accepts it. Null on everything else, which is what makes
     "this application has not become a partner yet" a fact rather than an
     absence somebody has to infer. */
  partner_id    text references partners(id)
);

comment on column partner_applications.access_code is
  'The credential an applicant resumes with, alongside their email. A bearer token, stored in the clear because this prototype has no mail sender to reset it with — hash it, expire it and count attempts before real applicants use this.';

create table if not exists partner_application_answers (
  application_id text not null references partner_applications(id) on delete cascade,
  field_id       text not null references partner_application_fields(id),
  value          text not null,
  saved_at       timestamptz not null default now(),
  primary key (application_id, field_id)
);

alter table partner_applications        enable row level security;
alter table partner_application_answers enable row level security;

/* No anon policy at all on either table. An applicant reaches them only through
   the functions below, which check the access code first — a `using` clause
   cannot, because an anonymous request carries nothing to check it against. */
drop policy if exists operator_all_applications on partner_applications;
create policy operator_all_applications on partner_applications
  for all using (current_persona() = 'operator');

drop policy if exists operator_all_application_answers on partner_application_answers;
create policy operator_all_application_answers on partner_application_answers
  for all using (current_persona() = 'operator');

create index if not exists partner_applications_email_idx on partner_applications (lower(email));

/* ============================ starting one === */

/* Random and unguessable, in an alphabet with no 0/O or 1/I/l — an applicant
   reads this off a screen and types it back a week later. */
create or replace function new_access_code()
returns text language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKMNPQRSTUVWXYZ23456789',
                           1 + floor(random() * 31)::integer, 1), '')
    from generate_series(1, 12);
$$;

/* A sequence rather than `count(*) + 1`, which was the first version and is
   wrong in a way that only shows up later: withdraw APP-2026-0002 out of two,
   and the next application computes 0002 again and collides with the one still
   there. A sequence never hands back a number twice, and the gap a withdrawn
   application leaves in the run is honest — that reference did exist. */
create sequence if not exists partner_application_ref_seq start 1;

create or replace function start_application(
  p_email text, p_phone text, p_company text, p_contact_name text,
  p_country text, p_kind text
) returns table (reference text, access_code text)
language plpgsql security definer set search_path = public as $$
/* `v_` prefixed because a plpgsql variable named `code` silently outranks
   `markets.code` in the existence check below — Postgres resolves the name to
   the variable and the check compares the column to itself. */
declare v_ref text; v_code text; n integer;
begin
  if coalesce(trim(p_email), '') = '' or p_email not like '%@%.%' then
    raise exception 'A working email address is needed — it is how the desk comes back to you.';
  end if;
  if coalesce(trim(p_phone), '') = '' then
    raise exception 'A contact number is needed. KYC is a phone call, not an email thread.';
  end if;
  if coalesce(trim(p_company), '') = '' then
    raise exception 'Give the registered company name.';
  end if;
  if coalesce(trim(p_contact_name), '') = '' then
    raise exception 'Give a named contact. An application with nobody on it cannot be progressed.';
  end if;
  if not exists (select 1 from markets m where m.code = p_country) then
    raise exception 'The marketplace does not trade in %. It operates in %.', p_country,
      (select string_agg(name, ', ' order by sort_order) from markets);
  end if;

  /* One open application per email. Two half-finished applications for the same
     company is how a desk ends up chasing the wrong one, and the applicant has
     no way to tell them apart — they only ever saw one form. */
  select count(*) into n from partner_applications
   where lower(email) = lower(trim(p_email)) and state in ('draft', 'submitted');
  if n > 0 then
    raise exception 'There is already an application open for %. Resume it with the reference and access code you were given, or ask the desk to withdraw it.', trim(p_email);
  end if;

  v_ref := 'APP-' || to_char(now(), 'YYYY') || '-' ||
           lpad(nextval('partner_application_ref_seq')::text, 4, '0');
  v_code := new_access_code();

  insert into partner_applications (id, access_code, email, phone, company, contact_name, country, kind)
  values (v_ref, v_code, trim(p_email), trim(p_phone), trim(p_company), trim(p_contact_name), p_country, p_kind);

  return query select v_ref, v_code;
end $$;

/* ============================ coming back to one === */

/* Both halves are checked in one place. Splitting "does this reference exist"
   from "is this the right code" is what turns a lookup into an oracle that
   confirms which references are real. */
create or replace function application_for(p_ref text, p_code text)
returns partner_applications language sql stable security definer
set search_path = public as $$
  select * from partner_applications
   where id = upper(trim(p_ref))
     and access_code = upper(trim(p_code))
     and state in ('draft', 'submitted');
$$;

create or replace function resume_application(p_ref text, p_code text)
returns table (
  reference text, email text, phone text, company text, contact_name text,
  country text, kind text, state text, reached integer,
  started timestamptz, last_saved timestamptz, submitted_on timestamptz
) language plpgsql security definer set search_path = public as $$
declare app partner_applications;
begin
  app := application_for(p_ref, p_code);
  if app.id is null then
    raise exception 'No open application matches that reference and access code.';
  end if;
  return query select app.id, app.email, app.phone, app.company, app.contact_name,
                      app.country, app.kind, app.state, app.reached,
                      app.started, app.last_saved, app.submitted_on;
end $$;

create or replace function application_answers(p_ref text, p_code text)
returns table (field_id text, value text)
language plpgsql security definer set search_path = public as $$
declare app partner_applications;
begin
  app := application_for(p_ref, p_code);
  if app.id is null then
    raise exception 'No open application matches that reference and access code.';
  end if;
  return query select a.field_id, a.value
                 from partner_application_answers a where a.application_id = app.id;
end $$;

/* ============================ saving as they go === */

create or replace function save_application_answer(
  p_ref text, p_code text, p_field text, p_value text, p_reached integer default null
) returns void language plpgsql security definer set search_path = public as $$
declare app partner_applications;
begin
  app := application_for(p_ref, p_code);
  if app.id is null then
    raise exception 'No open application matches that reference and access code.';
  end if;
  /* Once it is with the desk it stops being editable. An applicant who could
     still change the answers after submitting would be changing what somebody
     is part-way through assessing. */
  if app.state <> 'draft' then
    raise exception 'This application was submitted on %. Ask the desk to reopen it.',
      to_char(app.submitted_on, 'DD Mon YYYY');
  end if;
  if not exists (select 1 from partner_application_fields where id = p_field) then
    raise exception 'There is no question called % on this form.', p_field;
  end if;

  /* An emptied answer is deleted rather than stored as ''. Otherwise "answered"
     and "answered with nothing" are the same row and the completeness check
     passes on a blank form. */
  if coalesce(trim(p_value), '') = '' then
    delete from partner_application_answers
     where application_id = app.id and field_id = p_field;
  else
    insert into partner_application_answers (application_id, field_id, value)
    values (app.id, p_field, trim(p_value))
    on conflict (application_id, field_id)
      do update set value = excluded.value, saved_at = now();
  end if;

  update partner_applications
     set last_saved = now(),
         reached = greatest(reached, coalesce(p_reached, reached))
   where id = app.id;
end $$;

/* ============================ handing it to the desk === */

create or replace function submit_application(p_ref text, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare app partner_applications; missing text;
begin
  app := application_for(p_ref, p_code);
  if app.id is null then
    raise exception 'No open application matches that reference and access code.';
  end if;
  if app.state <> 'draft' then
    raise exception 'This application is already with the desk.';
  end if;

  /* Ranged over the fields that exist, so a question added to the form is
     enforced here the same day it appears on screen. */
  select string_agg(f.label, '; ' order by f.sort_order) into missing
    from partner_application_fields f
   where f.required
     and not exists (select 1 from partner_application_answers a
                      where a.application_id = app.id and a.field_id = f.id);
  if missing is not null then
    raise exception 'Still outstanding: %', missing;
  end if;

  update partner_applications
     set state = 'submitted', submitted_on = now(), last_saved = now(),
         reached = (select max(sort_order) from partner_application_fields)
   where id = app.id;
  return app.id;
end $$;

/* A new function is executable by a client through TWO independent paths, and
   closing one of them closes nothing:

     PUBLIC              Postgres grants EXECUTE to PUBLIC on every function it
                         creates, and anon is a member of PUBLIC like everybody.
     default privileges  Supabase additionally sets ALTER DEFAULT PRIVILEGES to
                         grant on functions to anon and authenticated, so each
                         one also arrives with its own explicit grant.

   Both were found the hard way, one after the other. `application_for` returns
   the whole application row — access code included — so a reference could be
   exchanged for the credential that opens it. It was first revoked from anon and
   authenticated, and stayed callable through PUBLIC; then revoked from PUBLIC,
   and stayed callable through the default privilege. Anything not meant for a
   client is revoked from all three.

   The assertion below is rewritten to ask `has_function_privilege` — can this
   role execute this — rather than to look for a grant row. The first version
   looked for a row with grantee = 'anon', found none, and passed on a function
   anon could call. It was not wrong about its own query; it was asking a
   question whose answer did not decide anything. */
revoke all on function start_application(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function resume_application(text, text)        from public, anon, authenticated;
revoke all on function application_answers(text, text)       from public, anon, authenticated;
revoke all on function save_application_answer(text, text, text, text, integer) from public, anon, authenticated;
revoke all on function submit_application(text, text)        from public, anon, authenticated;
/* And these two are not granted back. They hand out a credential, and the five
   above reach them as the definer rather than as the caller. */
revoke all on function application_for(text, text)           from public, anon, authenticated;
revoke all on function new_access_code()                     from public, anon, authenticated;
/* The sequence too. `start_application` advances it as the definer; a client
   able to advance it directly could burn references, and one able to reset it
   could make the next application collide with an existing one. */
revoke all on sequence partner_application_ref_seq           from public, anon, authenticated;

grant execute on function start_application(text, text, text, text, text, text) to anon, authenticated;
grant execute on function resume_application(text, text)        to anon, authenticated;
grant execute on function application_answers(text, text)       to anon, authenticated;
grant execute on function save_application_answer(text, text, text, text, integer) to anon, authenticated;
grant execute on function submit_application(text, text)        to anon, authenticated;

/* ============================ the questions themselves === */

/* Taken from `GATES[].what` in `src/lib/onboarding.ts`, which is what the
   marketplace already publishes each gate is for. The form asking for something
   the gate does not assess, or a gate assessing something the form never asked,
   are the two ways this drifts; the assertion below checks the first. */
insert into partner_application_fields (id, gate_id, label, hint, kind, options, required, sort_order) values
  ('apply-markets',    'apply',   'Marketplaces you want to sell in', 'You are approved per market, and priced in each market''s own currency.', 'multichoice', 'India,United Arab Emirates,Kenya', true, 10),
  ('apply-categories', 'apply',   'Categories you want to list in', 'Each category has its own evidence requirements at the compliance gate.', 'multichoice', 'IoT,Security,Devices,Digital Content', true, 20),
  ('apply-volume',     'apply',   'Expected orders per month', 'A range is fine. It sets the tier you start on and the settlement cycle you are offered.', 'number', null, true, 30),
  ('apply-website',    'apply',   'Company website', null, 'text', null, false, 40),
  ('apply-why',        'apply',   'What you sell, in a sentence or two', 'Read by the onboarding desk before anything else.', 'longtext', null, true, 50),

  ('kyc-regno',        'kyc',     'Company registration number', 'CIN in India, trade licence number in the UAE, or the Kenyan certificate of incorporation number.', 'text', null, true, 60),
  ('kyc-incorporated', 'kyc',     'Date of incorporation', null, 'date', null, true, 70),
  ('kyc-address',      'kyc',     'Registered address', null, 'longtext', null, true, 80),
  ('kyc-owners',       'kyc',     'Anyone owning more than 25%', 'Full name and percentage for each. Beneficial ownership is screened, not just the directors.', 'longtext', null, true, 90),
  ('kyc-directors',    'kyc',     'Directors and officers', 'Screened against sanctions and PEP lists.', 'longtext', null, true, 100),
  ('kyc-sanctions',    'kyc',     'Has the company or any owner been subject to sanctions, or refused a financial licence?', 'Declaring one is not a refusal. Not declaring one that surfaces at screening is.', 'boolean', null, true, 110),

  ('agree-signatory',  'agree',   'Who signs for the company', 'Name and job title of the person authorised to bind it.', 'text', null, true, 120),
  ('agree-signatory-email', 'agree', 'Signatory email', 'Where the marketplace terms, the DPA and the commission schedule are sent to e-sign.', 'email', null, true, 130),
  ('agree-terms',      'agree',   'You accept the marketplace terms and the commission schedule for your categories', 'The published rate for your categories, shown before you list. Countersigned at the agreements gate.', 'boolean', null, true, 140),
  ('agree-dpa',        'agree',   'You accept the data processing agreement', 'Order payloads carry buyer data. This is what governs what you may do with it.', 'boolean', null, true, 150),

  ('finance-bank',     'finance', 'Settlement bank name', null, 'text', null, true, 160),
  ('finance-account',  'finance', 'Account number or IBAN', 'Verified by micro-deposit before the first settlement runs.', 'text', null, true, 170),
  ('finance-swift',    'finance', 'SWIFT or sort code', null, 'text', null, true, 180),
  ('finance-currency', 'finance', 'Currency the account receives', 'Settlement is computed in the reporting currency and paid in this one, converted at the fix when the period closed.', 'choice', 'INR,AED,KES,USD', true, 190),
  ('finance-taxres',   'finance', 'Country of tax residency', null, 'choice', 'India,United Arab Emirates,Kenya,Other', true, 200),
  ('finance-taxid',    'finance', 'Tax registration number', 'GSTIN, TRN or KRA PIN.', 'text', null, true, 210),
  ('finance-withhold', 'finance', 'Do you claim treaty relief from withholding?', 'If yes, the desk will ask for a residency certificate.', 'boolean', null, true, 220),

  ('tech-feed',        'tech',    'How you will send your catalogue', null, 'choice', 'Portal upload,CSV feed,API feed', true, 230),
  ('tech-webhook',     'tech',    'Fulfilment webhook URL', 'Where order.created, order.cancelled and stock.update are delivered. It has to authenticate — an open endpoint is a data leak with a URL.', 'text', null, true, 240),
  ('tech-auth',        'tech',    'How that endpoint authenticates', null, 'choice', 'HMAC signature,Bearer token,mTLS', true, 250),
  ('tech-contact',     'tech',    'Technical contact', 'Name and email of whoever will run the sandbox order with platform engineering.', 'text', null, true, 260),

  ('assure-security',  'assure',  'Do you hold a current security certification?', 'ISO 27001, SOC 2 or equivalent. Not holding one does not fail the gate; the questionnaire is longer.', 'boolean', null, true, 270),
  ('assure-breach',    'assure',  'Any data breach notified to a regulator in the last three years?', 'Declared breaches are assessed. Undeclared ones that surface later stop the application.', 'boolean', null, true, 280),
  ('assure-content',   'assure',  'You accept the content policy for the categories you are listing in', null, 'boolean', null, true, 290),
  ('assure-sample',    'assure',  'A sample listing, as you would publish it', 'Title, description and price. Audited at the compliance gate against the category rules.', 'longtext', null, true, 300),

  ('golive-date',      'golive',  'When you want to be live', null, 'date', null, true, 310),
  ('golive-support',   'golive',  'Support contact for buyers', 'Name, email and hours. Shown on the storefront next to your listings.', 'longtext', null, true, 320),
  ('golive-notes',     'golive',  'Anything else the desk should know', null, 'longtext', null, false, 330)
on conflict (id) do update set
  gate_id = excluded.gate_id, label = excluded.label, hint = excluded.hint,
  kind = excluded.kind, options = excluded.options,
  required = excluded.required, sort_order = excluded.sort_order;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every question belongs to a gate the marketplace actually runs. The gate
     names are in `onboarding_gates`, which is what the operator's screens and
     the SLA are built on — a question filed under a gate that does not exist
     would be collected and never read. */
  select string_agg(distinct f.gate_id, ', ') into s
    from partner_application_fields f
   where f.gate_id not in ('apply', 'kyc', 'agree', 'finance', 'tech', 'assure', 'golive');
  if s is not null then raise exception 'these questions are filed under gates that do not exist: %', s; end if;

  /* And every gate is asked about. A gate with no questions is a gate the desk
     will reach with nothing in front of it. */
  select string_agg(g, ', ') into s from unnest(
    array['apply', 'kyc', 'agree', 'finance', 'tech', 'assure', 'golive']) g
   where not exists (select 1 from partner_application_fields f where f.gate_id = g);
  if s is not null then raise exception 'these gates ask the applicant nothing: %', s; end if;

  /* A choice question with nothing to choose from, or a free-text one carrying
     options nobody will see, are both forms that render wrong. */
  select string_agg(id || ' (' || kind || ')', ', ') into s
    from partner_application_fields
   where (kind in ('choice', 'multichoice')) <> (options is not null);
  if s is not null then raise exception 'these questions disagree with their own kind: %', s; end if;

  select string_agg(id || ': ' || kind, ', ') into s
    from partner_application_fields
   where kind not in ('text', 'longtext', 'email', 'phone', 'number', 'choice', 'multichoice', 'boolean', 'date');
  if s is not null then raise exception 'these questions use an input that does not exist: %', s; end if;

  /* The market options are the markets. A question offering a country the
     marketplace does not trade in collects an answer the desk has to refuse. */
  select string_agg(x.opt, ', ') into s
    from partner_application_fields f,
         lateral unnest(string_to_array(f.options, ',')) as x(opt)
   where f.id = 'apply-markets'
     and not exists (select 1 from markets m where m.name = trim(x.opt));
  if s is not null then raise exception 'the markets question offers places the marketplace does not trade in: %', s; end if;

  /* Nothing is asked twice. The same question under two gates is two answers
     that can disagree. */
  select string_agg(label, '; ') into s from (
    select label from partner_application_fields group by label having count(*) > 1) x;
  if s is not null then raise exception 'these questions are asked more than once: %', s; end if;

  /* Floors. Each of these passes trivially on an empty table. */
  select count(*) into n from partner_application_fields;
  if n < 20 then raise exception 'the form has only % questions, which is not a seven-gate application', n; end if;
  select count(*) into n from partner_application_fields where required;
  if n = 0 then raise exception 'nothing on the form is required, so submitting proves nothing'; end if;
  select count(distinct gate_id) into n from partner_application_fields;
  if n <> 7 then raise exception 'the form covers % gates, not seven', n; end if;

  /* The functions an anonymous applicant needs are reachable, and the two that
     would hand out a credential are not.

     Asked with `has_function_privilege`, which is what actually decides whether
     a call succeeds. The first version of this looked for a row in
     `information_schema.routine_privileges` with grantee = 'anon', found none
     for `application_for`, and passed — while anon could call it perfectly well
     through the EXECUTE that Postgres grants to PUBLIC on every function. The
     assertion was not wrong about its own query; it was asking a question whose
     answer did not decide anything. */
  select string_agg(f.fn, ', ') into s
    from (values ('start_application(text,text,text,text,text,text)'),
                 ('resume_application(text,text)'),
                 ('application_answers(text,text)'),
                 ('save_application_answer(text,text,text,text,integer)'),
                 ('submit_application(text,text)')) as f(fn)
   where not has_function_privilege('anon', f.fn, 'EXECUTE');
  if s is not null then raise exception 'an anonymous applicant cannot call: %', s; end if;

  select string_agg(f.fn || ' by ' || f.who, '; ') into s
    from (values ('application_for(text,text)', 'anon'),
                 ('application_for(text,text)', 'authenticated'),
                 ('new_access_code()', 'anon'),
                 ('new_access_code()', 'authenticated')) as f(fn, who)
   where has_function_privilege(f.who, f.fn, 'EXECUTE');
  if s is not null then
    raise exception 'these hand out a credential and are callable by a client: %', s;
  end if;

  /* A reference is never handed out twice, including across a withdrawal. Run
     rather than reasoned about: three applications, the middle one deleted, and
     a fourth started — which is exactly the sequence that made `count(*) + 1`
     collide. Rolled back at the end so this asserts without leaving anything
     behind. */
  declare a text; b text; c text; d text;
  begin
    select reference into a from start_application('assert-a@migration.test', '+91 80 0000 0001', 'Assertion A', 'A', 'IN', 'Reseller');
    select reference into b from start_application('assert-b@migration.test', '+91 80 0000 0002', 'Assertion B', 'B', 'IN', 'Reseller');
    delete from partner_applications where id = b;
    select reference into c from start_application('assert-c@migration.test', '+91 80 0000 0003', 'Assertion C', 'C', 'IN', 'Reseller');
    if c = a or c = b then
      raise exception 'the reference generator reissued % after a withdrawal', c;
    end if;

    /* And an application cannot be started twice for one address, checked here
       rather than only in a test — it is the rule that stops a desk chasing
       two half-finished copies of the same company. */
    begin
      select reference into d from start_application('assert-a@migration.test', '+91 80 0000 0001', 'Assertion A again', 'A', 'IN', 'Reseller');
      raise exception 'a second open application was accepted for one email address';
    exception when others then
      if sqlerrm not like 'There is already an application open%' then raise; end if;
    end;

    delete from partner_applications where id in (a, c);
  end;

  /* The tables themselves stay shut. The functions are security definer
     precisely so the tables do not have to be open. */
  select count(*) into n from pg_policy p join pg_class c on c.oid = p.polrelid
   where c.relname in ('partner_applications', 'partner_application_answers')
     and p.polname not like 'operator%';
  if n > 0 then raise exception 'an application table has a policy other than the operator''s'; end if;

  select count(*) into n from pg_class c
    join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relrowsecurity
     and c.relname in ('partner_applications', 'partner_application_answers', 'partner_application_fields');
  if n <> 3 then raise exception 'only % of the 3 application tables have row security on', n; end if;
end $$;
