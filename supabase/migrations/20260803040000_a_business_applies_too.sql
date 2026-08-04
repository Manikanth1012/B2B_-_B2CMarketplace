-- The enterprise page offers "Sign in to procure" and nothing else.
--
-- A seller can apply from the outside and a shopper can register. A company
-- cannot do either — and unlike a shopper it should not be able to register,
-- because an enterprise account is not self-service. It carries a credit limit,
-- a budget, approval thresholds and a place of supply that decides the tax on
-- every invoice raised against it. Those are terms somebody agrees, not fields
-- somebody fills in.
--
-- So a business applies, exactly as a seller does: a reference and an access
-- code, questions asked under the step that will read them, documents the desk
-- assesses, and a person who accepts it.
--
-- Which means the machinery already exists, and the only real decision here is
-- whether to copy it. It is not copied. `partner_applications` and its four
-- companions become `applications` and gain a `kind`, the functions take the
-- kind on the way in and read it off the row after that, and `accept_application`
-- branches at the end — where the two genuinely differ, because one produces a
-- partner with seven gates and the other an account with a six-step ladder.
--
-- The renames are the reason this migration is long. `partner_applications`
-- holding a business application would be a table whose name is a lie, and the
-- next person reading it would file the business rows somewhere else.

/* ============================ one set of tables === */

alter table if exists partner_applications          rename to applications;
alter table if exists partner_application_fields    rename to application_fields;
alter table if exists partner_application_answers   rename to application_answers;
alter table if exists partner_application_documents rename to application_documents;

alter sequence if exists partner_application_ref_seq rename to application_ref_seq;

comment on table applications is
  'Somebody asking to join the marketplace, before they are anything. `kind` says as what: a seller, who becomes a partner with seven gates, or a business, who becomes an account with a credit limit. Everything up to the moment of acceptance is the same for both, which is why it is one table.';

/* 'seller' or 'business'. Defaulted so every row written before today is what
   it already was, and constrained so a third kind has to be added deliberately
   rather than by a typo in a client. */
alter table applications
  add column if not exists kind_of text not null default 'seller';
alter table application_fields
  add column if not exists kind_of text not null default 'seller';
alter table application_document_kinds
  add column if not exists kind_of text not null default 'seller';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'applications_kind_of_check') then
    alter table applications add constraint applications_kind_of_check
      check (kind_of in ('seller', 'business'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'application_fields_kind_of_check') then
    alter table application_fields add constraint application_fields_kind_of_check
      check (kind_of in ('seller', 'business'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'application_document_kinds_kind_of_check') then
    alter table application_document_kinds add constraint application_document_kinds_kind_of_check
      check (kind_of in ('seller', 'business'));
  end if;
end $$;

/* `account_id` beside `partner_id`: an accepted application becomes one or the
   other and never both. */
alter table applications
  add column if not exists account_id text references enterprise_accounts(id);

/* ============================ what a business is asked === */

/* Filed under the step that reads it. `enterprise_onboarding` runs six —
   company verification, tax registration, credit assessment, direct debit,
   purchase order policy and the annual review — and the first four are the ones
   that read anything from an applicant. */
insert into application_fields (id, gate_id, label, hint, kind, options, required, sort_order, kind_of) values
  ('biz-legal',      'verify',  'Registered legal name', 'As it appears on the certificate of incorporation, if different from the trading name.', 'text', null, true, 10, 'business'),
  ('biz-industry',   'verify',  'Industry', null, 'choice', 'Construction,Retail,Logistics,Manufacturing,Healthcare,Financial services,Hospitality,Education,Public sector,Other', true, 20, 'business'),
  ('biz-regno',      'verify',  'Company registration number', 'CIN in India, trade licence number in the UAE, or the certificate of incorporation number.', 'text', null, true, 30, 'business'),
  ('biz-address',    'verify',  'Registered address', 'The registered address, not the delivery address — it is what sets the place of supply.', 'longtext', null, true, 50, 'business'),
  ('biz-sites',      'verify',  'Number of sites', null, 'number', null, true, 60, 'business'),
  ('biz-staff',      'verify',  'Number of staff', 'Sets the segment the account is opened on.', 'number', null, true, 70, 'business'),

  /* `enterprise_accounts.reg_type` is the TAX registration type — its check
     constraint allows GSTIN, VAT number, TRN or Not registered — not the
     company registration type. The two were conflated in the first version of
     this form and the insert was refused by the constraint, which is the right
     place to find that out. The company's own registration number is asked for
     at the verification step above and read by the desk rather than stored: the
     account has a column for the tax number and none for the other. */
  ('biz-regtype',    'tax',     'Tax registration type', 'What the number below is.', 'choice', 'GSTIN,VAT number,TRN,Not registered', true, 75, 'business'),
  ('biz-taxid',      'tax',     'Tax registration number', 'GSTIN, TRN or KRA PIN. Left blank only if you are not registered.', 'text', null, true, 80, 'business'),
  ('biz-supply',     'tax',     'Place of supply', 'State or emirate and country. This decides the tax rate on every invoice raised against the account.', 'text', null, true, 90, 'business'),
  ('biz-exempt',     'tax',     'Do you hold a tax exemption?', 'If yes, the desk will ask for the certificate before the first invoice.', 'boolean', null, true, 100, 'business'),
  ('biz-reverse',    'tax',     'Does reverse charge apply to you?', null, 'boolean', null, true, 110, 'business'),

  ('biz-spend',      'credit', 'Expected annual spend', 'Sets the credit limit the desk opens with. A range is fine.', 'number', null, true, 120, 'business'),
  ('biz-terms',      'credit', 'Payment terms you are asking for', 'Anything beyond Net 30 is a credit decision, not a preference.', 'choice', 'Net 15,Net 30,Net 45,Net 60', true, 130, 'business'),
  ('biz-fy',         'credit', 'When your financial year starts', 'The budget and the annual review run on it.', 'date', null, true, 140, 'business'),
  ('biz-refs',       'credit', 'Two trade references', 'Company name and a contact at each. Called before the limit is set.', 'longtext', null, true, 150, 'business'),

  ('biz-mandate',    'mandate', 'Bank the direct debit will be collected from', null, 'text', null, true, 160, 'business'),
  ('biz-signatory',  'mandate', 'Who signs the mandate', 'Name and job title of somebody with authority to bind the company.', 'text', null, true, 170, 'business'),
  ('biz-signatory-email', 'mandate', 'Signatory email', null, 'email', null, true, 180, 'business'),

  ('biz-po',         'policy', 'Do you require a purchase order on every invoice?', 'If yes, an invoice without one will be rejected by your own accounts payable, so the marketplace enforces it.', 'boolean', null, true, 190, 'business'),
  ('biz-cc',         'policy', 'Should the cost centre be printed on invoices?', null, 'boolean', null, true, 200, 'business'),
  ('biz-threshold',  'policy', 'Spend above which a purchase needs finance approval', 'In your own currency. It can be changed later by your procurement lead.', 'number', null, true, 210, 'business'),
  ('biz-admin',      'policy', 'Who will administer the account', 'Name and email of the first procurement lead. They get the first login.', 'longtext', null, true, 220, 'business')
on conflict (id) do update set
  gate_id = excluded.gate_id, label = excluded.label, hint = excluded.hint,
  kind = excluded.kind, options = excluded.options, required = excluded.required,
  sort_order = excluded.sort_order, kind_of = excluded.kind_of;

insert into application_document_kinds (id, gate_id, label, note, required, sort_order, kind_of) values
  ('bizdoc-inc',     'verify',  'Certificate of incorporation', 'Verified against the register in the country of registration.', true, 10, 'business'),
  ('bizdoc-register','verify',  'Company register extract', 'Under three months old, showing the current directors and registered address.', true, 20, 'business'),
  ('bizdoc-tax',     'tax',     'Tax registration certificate', 'GST, TRN or KRA PIN certificate. The place of supply on it is what sets the rate.', true, 30, 'business'),
  ('bizdoc-exempt',  'tax',     'Tax exemption certificate', 'Only if you declared an exemption above.', false, 40, 'business'),
  ('bizdoc-accounts','credit', 'Most recent filed accounts', 'Audited if you file them; management accounts if you do not.', true, 50, 'business'),
  ('bizdoc-refs',    'credit', 'Trade reference letters', 'On the referee''s letterhead. Two of them, in one file if that is easier.', true, 60, 'business'),
  ('bizdoc-mandate', 'mandate', 'Signed direct debit mandate', 'Signed by the person named as authorised to bind the company.', true, 70, 'business'),
  ('bizdoc-auth',    'mandate', 'Board resolution or power of attorney', 'Only if the signatory is not a director on the register.', false, 80, 'business'),
  ('bizdoc-po',      'policy', 'Purchase order policy', 'Your own, if you have one written down. It is read rather than enforced.', false, 90, 'business')
on conflict (id) do update set
  gate_id = excluded.gate_id, label = excluded.label, note = excluded.note,
  required = excluded.required, sort_order = excluded.sort_order, kind_of = excluded.kind_of;

/* The steps a business application opens with, as data, for the same reason the
   gate and task ladders are. */
create table if not exists business_onboarding_ladder (
  id          text primary key,
  name        text not null,
  detail      text not null,
  /* Which application step's answers and documents land against it. Null for a
     step nobody is asked anything for — the annual review is a diary entry, not
     a question. */
  gate_id     text,
  due_days    integer,
  sort_order  integer not null
);

alter table business_onboarding_ladder enable row level security;
drop policy if exists anyone_read_business_ladder on business_onboarding_ladder;
create policy anyone_read_business_ladder on business_onboarding_ladder for select using (true);
drop policy if exists operator_all_business_ladder on business_onboarding_ladder;
create policy operator_all_business_ladder on business_onboarding_ladder
  for all using (current_persona() = 'operator');

insert into business_onboarding_ladder (id, name, detail, gate_id, due_days, sort_order) values
  ('verify',  'Company verification', 'Verified against the company register in the country of registration. The registration number and the registered address both have to match what was declared.', 'verify', 3, 1),
  ('tax',     'Tax registration', 'Validated with the authority. The place of supply is set from the registered address rather than the delivery address, which is what decides the rate on every invoice raised.', 'tax', 3, 2),
  ('credit',  'Credit assessment', 'Filed accounts and two trade references. The outcome is the credit limit and the payment terms the account opens on.', 'credit', 7, 3),
  ('mandate', 'Direct debit mandate', 'Signed by a person with authority to bind the company. Collections run on the due date of each invoice and nothing is collected outside one.', 'mandate', 5, 4),
  ('policy',  'Purchase order policy', 'Whether a purchase order is required on every invoice, and whether the cost centre is printed on it. Enforced by the marketplace once agreed.', 'policy', 5, 5),
  ('review',  'Annual credit review', 'The limit is reviewed once a year against what the account actually spends. Opened as a diary entry, not something to do now.', null, 365, 6)
on conflict (id) do update set
  name = excluded.name, detail = excluded.detail, gate_id = excluded.gate_id,
  due_days = excluded.due_days, sort_order = excluded.sort_order;

/* ============================ the functions, taught the kind === */

create or replace function application_for(p_ref text, p_code text)
returns applications language sql stable security definer
set search_path = public as $$
  select * from applications
   where id = upper(trim(p_ref))
     and access_code = upper(trim(p_code))
     and state in ('draft', 'submitted');
$$;

/* The six-argument version is dropped rather than left beside this one. Adding
   a parameter with a default creates an OVERLOAD, not a replacement, and two
   functions of the same name is an ambiguity PostgREST resolves by its own
   rules rather than by ours — a caller omitting `p_kind_of` would reach the old
   body, which knows nothing about `kind_of` and would file every business
   application as a seller's.

   `p_kind` is the seller's trade or the company's industry; `p_kind_of` is
   whether this is a seller applying or a business. Two different words would
   have been kinder, and renaming `p_kind` now would break every caller. */
drop function if exists start_application(text, text, text, text, text, text);
create or replace function start_application(
  p_email text, p_phone text, p_company text, p_contact_name text,
  p_country text, p_kind text, p_kind_of text default 'seller'
) returns table (reference text, access_code text)
language plpgsql security definer set search_path = public as $$
declare v_ref text; v_code text; n integer;
begin
  if p_kind_of not in ('seller', 'business') then
    raise exception 'There is no such thing as a % application.', p_kind_of;
  end if;
  if coalesce(trim(p_email), '') = '' or p_email not like '%@%.%' then
    raise exception 'A working email address is needed — it is how the desk comes back to you.';
  end if;
  if coalesce(trim(p_phone), '') = '' then
    raise exception 'A contact number is needed. Due diligence is a phone call, not an email thread.';
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

  select count(*) into n from applications
   where lower(email) = lower(trim(p_email)) and state in ('draft', 'submitted');
  if n > 0 then
    raise exception 'There is already an application open for %. Resume it with the reference and access code you were given, or ask the desk to withdraw it.', trim(p_email);
  end if;

  v_ref := 'APP-' || to_char(now(), 'YYYY') || '-' ||
           lpad(nextval('application_ref_seq')::text, 4, '0');
  v_code := new_access_code();

  insert into applications (id, access_code, email, phone, company, contact_name, country, kind, kind_of)
  values (v_ref, v_code, trim(p_email), trim(p_phone), trim(p_company), trim(p_contact_name),
          p_country, p_kind, p_kind_of);

  return query select v_ref, v_code;
end $$;

/* Dropped rather than replaced: `kind_of` is a new OUT column, and Postgres
   will not change the row type of an existing function in place. */
drop function if exists resume_application(text, text);
create function resume_application(p_ref text, p_code text)
returns table (
  reference text, email text, phone text, company text, contact_name text,
  country text, kind text, state text, reached integer,
  started timestamptz, last_saved timestamptz, submitted_on timestamptz, kind_of text
) language plpgsql security definer set search_path = public as $$
declare app applications;
begin
  app := application_for(p_ref, p_code);
  if app.id is null then
    raise exception 'No open application matches that reference and access code.';
  end if;
  return query select app.id, app.email, app.phone, app.company, app.contact_name,
                      app.country, app.kind, app.state, app.reached,
                      app.started, app.last_saved, app.submitted_on, app.kind_of;
end $$;

/* Renamed off `application_answers` and `application_documents`, which are now
   table names. A function and a table can share a name in Postgres and the two
   are still told apart, but a reader cannot. */
create or replace function answers_for_application(p_ref text, p_code text)
returns table (field_id text, value text)
language plpgsql security definer set search_path = public as $$
declare app applications;
begin
  app := application_for(p_ref, p_code);
  if app.id is null then
    raise exception 'No open application matches that reference and access code.';
  end if;
  return query select a.field_id, a.value
                 from application_answers a where a.application_id = app.id;
end $$;

create or replace function documents_for_application(p_ref text, p_code text)
returns table (id text, kind_id text, name text, mime text, bytes bigint, path text, uploaded_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare app applications;
begin
  app := application_for(p_ref, p_code);
  if app.id is null then
    raise exception 'No open application matches that reference and access code.';
  end if;
  return query select d.id, d.kind_id, d.name, d.mime, d.bytes, d.path, d.uploaded_at
                 from application_documents d where d.application_id = app.id;
end $$;

drop function if exists application_answers(text, text);
drop function if exists application_documents(text, text);

create or replace function save_application_answer(
  p_ref text, p_code text, p_field text, p_value text, p_reached integer default null
) returns void language plpgsql security definer set search_path = public as $$
declare app applications;
begin
  app := application_for(p_ref, p_code);
  if app.id is null then
    raise exception 'No open application matches that reference and access code.';
  end if;
  if app.state <> 'draft' then
    raise exception 'This application was submitted on %. Ask the desk to reopen it.',
      to_char(app.submitted_on, 'DD Mon YYYY');
  end if;
  /* Asked of this kind of application. A business answering a seller's question
     would be an answer nobody ever reads and a completeness check that can
     never pass. */
  if not exists (select 1 from application_fields
                  where id = p_field and kind_of = app.kind_of) then
    raise exception 'There is no question called % on this form.', p_field;
  end if;

  if coalesce(trim(p_value), '') = '' then
    delete from application_answers
     where application_id = app.id and field_id = p_field;
  else
    insert into application_answers (application_id, field_id, value)
    values (app.id, p_field, trim(p_value))
    on conflict (application_id, field_id)
      do update set value = excluded.value, saved_at = now();
  end if;

  update applications
     set last_saved = now(),
         reached = greatest(reached, coalesce(p_reached, reached))
   where id = app.id;
end $$;

create or replace function record_application_document(
  p_ref text, p_code text, p_kind text, p_name text, p_mime text, p_bytes bigint, p_path text
) returns text language plpgsql security definer set search_path = public as $$
declare app applications; v_id text; v_old text;
begin
  app := application_for(p_ref, p_code);
  if app.id is null then
    raise exception 'No open application matches that reference and access code.';
  end if;
  if app.state <> 'draft' then
    raise exception 'This application is with the desk. Ask them to reopen it before changing anything.';
  end if;
  if not exists (select 1 from application_document_kinds
                  where id = p_kind and kind_of = app.kind_of) then
    raise exception 'The desk does not ask for a document called %.', p_kind;
  end if;
  if p_path not like app.id || '/' || app.access_code || '/%' then
    raise exception 'That file was not uploaded against this application.';
  end if;

  select d.path into v_old from application_documents d
   where d.application_id = app.id and d.kind_id = p_kind;
  delete from application_documents
   where application_id = app.id and kind_id = p_kind;

  v_id := 'APD-' || replace(app.id, 'APP-', '') || '-' || p_kind;
  insert into application_documents (id, application_id, kind_id, name, mime, bytes, path)
  values (v_id, app.id, p_kind, p_name, p_mime, p_bytes, p_path);

  update applications set last_saved = now() where id = app.id;
  return coalesce(v_old, '');
end $$;

create or replace function remove_application_document(p_ref text, p_code text, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare app applications; v_old text;
begin
  app := application_for(p_ref, p_code);
  if app.id is null then
    raise exception 'No open application matches that reference and access code.';
  end if;
  if app.state <> 'draft' then
    raise exception 'This application is with the desk. Ask them to reopen it before changing anything.';
  end if;
  select d.path into v_old from application_documents d
   where d.application_id = app.id and d.kind_id = p_kind;
  delete from application_documents
   where application_id = app.id and kind_id = p_kind;
  update applications set last_saved = now() where id = app.id;
  return coalesce(v_old, '');
end $$;

create or replace function submit_application(p_ref text, p_code text)
returns text language plpgsql security definer set search_path = public as $$
declare app applications; missing text;
begin
  app := application_for(p_ref, p_code);
  if app.id is null then
    raise exception 'No open application matches that reference and access code.';
  end if;
  if app.state <> 'draft' then
    raise exception 'This application is already with the desk.';
  end if;

  select string_agg(x.label, '; ' order by x.sort_order) into missing from (
    select f.label, f.sort_order
      from application_fields f
     where f.required and f.kind_of = app.kind_of
       and not exists (select 1 from application_answers a
                        where a.application_id = app.id and a.field_id = f.id)
    union all
    select k.label, 1000 + k.sort_order
      from application_document_kinds k
     where k.required and k.kind_of = app.kind_of
       and not exists (select 1 from application_documents d
                        where d.application_id = app.id and d.kind_id = k.id)
  ) x;
  if missing is not null then
    raise exception 'Still outstanding: %', missing;
  end if;

  update applications
     set state = 'submitted', submitted_on = now(), last_saved = now(),
         reached = (select max(sort_order) from application_fields where kind_of = app.kind_of)
   where id = app.id;
  return app.id;
end $$;

create or replace function application_upload_open(p_ref text, p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from applications
     where id = p_ref and access_code = p_code and state = 'draft');
$$;

create or replace function application_folder_partner(p_ref text)
returns text language sql stable security definer set search_path = public as $$
  select partner_id from applications where id = p_ref;
$$;

/* ============================ accepting, which is where they differ === */

create sequence if not exists account_ref_seq start 2015;

/* One answer, by field. Used a dozen times building an account out of an
   application, and a dozen scalar subqueries inline would bury the shape of the
   insert under its own plumbing. */
create or replace function answer_of(p_app text, p_field text)
returns text language sql stable security definer set search_path = public as $$
  select a.value from application_answers a
   where a.application_id = p_app and a.field_id = p_field;
$$;

create or replace function accept_application(p_ref text, p_note text default null)
returns text language plpgsql security definer set search_path = public as $$
declare
  app applications;
  v_partner text;
  v_account text;
  v_actor text;
  v_country text;
  v_markets text[];
  v_currency text;
  n integer;
  answer text;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace can accept an application.';
  end if;

  select * into app from applications where id = upper(trim(p_ref));
  if app.id is null then raise exception 'No application called %.', p_ref; end if;
  if app.state = 'accepted' then
    raise exception '% was already accepted, and is now %.', app.id,
      coalesce(app.partner_id, app.account_id);
  end if;
  if app.state <> 'submitted' then
    raise exception '% is %, so there is nothing to accept yet.', app.id, app.state;
  end if;

  select count(*) into n from application_fields f
   where f.required and f.kind_of = app.kind_of
     and not exists (select 1 from application_answers a
                      where a.application_id = app.id and a.field_id = f.id);
  if n > 0 then
    raise exception '% is missing % required answers. Send it back rather than accepting it.', app.id, n;
  end if;

  select count(*) into n from application_document_kinds k
   where k.required and k.kind_of = app.kind_of
     and not exists (select 1 from application_documents d
                      where d.application_id = app.id and d.kind_id = k.id);
  if n > 0 then
    raise exception '% is missing % required documents. Send it back rather than accepting it.', app.id, n;
  end if;

  v_actor := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'email', 'the onboarding desk');
  select m.name into v_country from markets m where m.code = app.country;
  select mc.currency into v_currency from market_currencies mc
   where mc.market_code = app.country order by mc.is_default desc, mc.sort_order limit 1;

  if app.kind_of = 'business' then
    v_account := 'ENT-' || nextval('account_ref_seq')::text;

    insert into enterprise_accounts (
      id, company, legal_name, segment, industry, sites, staff, terms, currency,
      fy_starts, budget_year, reg_type, registration, place_of_supply,
      po_required, reverse_charge, cost_centre_on_invoice, tax_exempt,
      status, sort_order, market
    ) values (
      v_account, app.company,
      coalesce(nullif(trim(answer_of(app.id, 'biz-legal')), ''), app.company),
      /* Segment from headcount rather than asked for. A company that picks its
         own segment picks the one with the best terms. */
      case when coalesce(nullif(regexp_replace(answer_of(app.id, 'biz-staff'), '\D', '', 'g'), '')::integer, 0) >= 1000 then 'large'
           when coalesce(nullif(regexp_replace(answer_of(app.id, 'biz-staff'), '\D', '', 'g'), '')::integer, 0) >= 100 then 'mid'
           else 'small' end,
      coalesce(nullif(answer_of(app.id, 'biz-industry'), ''), 'Other'),
      coalesce(nullif(regexp_replace(answer_of(app.id, 'biz-sites'), '\D', '', 'g'), '')::integer, 1),
      coalesce(nullif(regexp_replace(answer_of(app.id, 'biz-staff'), '\D', '', 'g'), '')::integer, 1),
      /* The terms they asked for are what they asked for. The credit gate is
         where that becomes a decision, so the account opens on the shortest
         terms and is moved after the assessment. */
      'Net 30', v_currency,
      coalesce(nullif(answer_of(app.id, 'biz-fy'), '')::date, date_trunc('year', now())::date),
      /* No budget until somebody sets one. Their expected spend is what they
         said, not what the marketplace has agreed to carry. */
      0,
      coalesce(nullif(answer_of(app.id, 'biz-regtype'), ''), 'Not registered'),
      /* The tax number, which is what this column holds — ENT-2007's is a
         GSTIN. The company registration number is a separate answer the desk
         reads at verification and the account has nowhere to put. */
      nullif(answer_of(app.id, 'biz-taxid'), ''),
      coalesce(nullif(answer_of(app.id, 'biz-supply'), ''), v_country),
      answer_of(app.id, 'biz-po') = 'Yes',
      answer_of(app.id, 'biz-reverse') = 'Yes',
      answer_of(app.id, 'biz-cc') = 'Yes',
      answer_of(app.id, 'biz-exempt') = 'Yes',
      /* `on-hold`, which is the only value in this column's check constraint
         that means "exists and cannot trade". There is no 'onboarding' status
         on an account the way there is on a partner, and inventing one would
         have needed the constraint widening for a state the rest of the
         screens do not understand. The ladder below is what says why it is
         held: an account that could buy before its credit assessment is an
         account with no limit. */
      'on-hold', 0, app.country
    );

    /* The steps, from the ladder, with the documents filed against the one that
       reads each. `documents` is the jsonb the screens render and
       `document_paths` is what opens them — both, because the existing rows
       carry both and a step with one and not the other renders a name that
       clicks through to nothing. */
    insert into enterprise_onboarding (id, account_id, name, detail, state, due_on,
                                       documents, document_paths, sort_order)
    select 'BO-' || replace(v_account, 'ENT-', '') || '-' || l.sort_order,
           v_account, l.name, l.detail,
           /* All due. `enterprise_onboarding.state` allows done, due or
              overdue and nothing else — there is no "in progress" on this
              table, and which step the desk is working is read off the due
              dates, which is why they are staggered rather than all the same.
              A second constraint ties `done` to having a date and a name on it,
              so nothing can be marked finished by nobody. */
           'due',
           (now() + make_interval(days => coalesce(l.due_days, 30)))::date,
           coalesce((select jsonb_agg(jsonb_build_object(
                       'kind', upper(coalesce(nullif(split_part(d.mime, '/', 2), ''), 'FILE')),
                       'name', k.label,
                       'size', case when d.bytes < 1048576
                                    then to_char(round(d.bytes / 1024.0, 0), 'FM999999') || ' KB'
                                    else to_char(round(d.bytes / 1048576.0, 1), 'FM999990.9') || ' MB' end)
                       order by k.sort_order)
                      from application_documents d
                      join application_document_kinds k on k.id = d.kind_id
                     where d.application_id = app.id and k.gate_id = l.gate_id), '[]'::jsonb),
           coalesce((select array_agg(d.path order by k.sort_order)
                       from application_documents d
                       join application_document_kinds k on k.id = d.kind_id
                      where d.application_id = app.id and k.gate_id = l.gate_id), '{}'::text[]),
           l.sort_order
      from business_onboarding_ladder l;

    /* A policy, so the approvals screen has something to read. The threshold is
       what they asked for; self-approval is off and stays off until somebody
       decides otherwise. */
    insert into enterprise_approval_policy (account_id, threshold, security_signoff,
                                            duplicate_flag, auto_approve_renewals, self_approve, note)
    values (v_account,
            coalesce(nullif(regexp_replace(answer_of(app.id, 'biz-threshold'), '\D', '', 'g'), '')::numeric, 100000),
            true, true, false, false,
            'Opened from ' || app.id || '. Asked for by the applicant and not yet reviewed.')
    on conflict (account_id) do nothing;

    update applications
       set state = 'accepted', account_id = v_account, last_saved = now()
     where id = app.id;
    return v_account;
  end if;

  /* ---- a seller, which is what this function used to only do ---- */
  v_partner := 'PTR-' || nextval('partner_ref_seq')::text;

  insert into partners (id, name, type, status, country, contact, email, joined, tier, tier_id)
  values (v_partner, app.company, app.kind, 'onboarding', v_country,
          app.contact_name, app.email, to_char(now(), 'DD Mon YYYY'), 'Bronze', 'bronze');

  perform open_partner_journey(
    v_partner,
    'Opened from ' || app.id || ' by ' || v_actor
      || case when coalesce(trim(p_note), '') = '' then '' else ': ' || trim(p_note) end,
    app.contact_name, app.submitted_on,
    array(select f.label from application_fields f
           where f.gate_id = 'apply' and f.required and f.kind_of = 'seller'
           order by f.sort_order));

  insert into onboarding_documents (id, gate_id, partner_id, name, kind, size, uploaded_by, uploaded_at, sort_order, path)
  select 'doc-' || v_partner || '-' || d.kind_id,
         'og-' || v_partner || '-' || k.gate_id,
         v_partner, k.label,
         upper(coalesce(nullif(split_part(d.mime, '/', 2), ''), 'FILE')),
         case when d.bytes < 1048576
              then to_char(round(d.bytes / 1024.0, 0), 'FM999999') || ' KB'
              else to_char(round(d.bytes / 1048576.0, 1), 'FM999990.9') || ' MB' end,
         app.contact_name, d.uploaded_at, k.sort_order, d.path
    from application_documents d
    join application_document_kinds k on k.id = d.kind_id
   where d.application_id = app.id;

  insert into onboarding_tasks (id, partner_id, gate_id, title, detail, owner, due)
  select 'OB-' || replace(v_partner, 'PTR-', '') || '-' || t.id,
         v_partner, t.gate_id, t.title, t.detail, t.owner,
         case when t.gate_id = 'apply'
              then case when t.days <= 1 then 'Today' else 'In ' || t.days || ' days' end
         end
    from onboarding_task_ladder t
   where not exists (select 1 from onboarding_tasks o
                      where o.id = 'OB-' || replace(v_partner, 'PTR-', '') || '-' || t.id);

  v_markets := string_to_array(coalesce(answer_of(app.id, 'apply-markets'), ''), ',');
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

  update applications
     set state = 'accepted', partner_id = v_partner, last_saved = now()
   where id = app.id;
  return v_partner;
end $$;

create or replace function withdraw_application(p_ref text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare app applications;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace can withdraw an application.';
  end if;
  if coalesce(trim(p_note), '') = '' then
    raise exception 'Give a reason. An application closed with no reason cannot be explained to the person who filled it in.';
  end if;
  select * into app from applications where id = upper(trim(p_ref));
  if app.id is null then raise exception 'No application called %.', p_ref; end if;
  if app.state = 'accepted' then
    raise exception '% is already %. Suspend it instead.', app.id,
      coalesce(app.partner_id, app.account_id);
  end if;
  update applications set state = 'withdrawn', last_saved = now() where id = app.id;
end $$;

/* ============================ grants === */

revoke all on function application_for(text, text)                   from public, anon, authenticated;
revoke all on function new_access_code()                             from public, anon, authenticated;
revoke all on function answer_of(text, text)                         from public, anon, authenticated;
revoke all on function start_application(text, text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function resume_application(text, text)                from public, anon, authenticated;
revoke all on function answers_for_application(text, text)           from public, anon, authenticated;
revoke all on function documents_for_application(text, text)         from public, anon, authenticated;
revoke all on function save_application_answer(text, text, text, text, integer) from public, anon, authenticated;
revoke all on function record_application_document(text, text, text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function remove_application_document(text, text, text) from public, anon, authenticated;
revoke all on function submit_application(text, text)                from public, anon, authenticated;
revoke all on function accept_application(text, text)                from public, anon, authenticated;
revoke all on function withdraw_application(text, text)              from public, anon, authenticated;
revoke all on sequence application_ref_seq                           from public, anon, authenticated;
revoke all on sequence account_ref_seq                               from public, anon, authenticated;

grant execute on function start_application(text, text, text, text, text, text, text) to anon, authenticated;
grant execute on function resume_application(text, text)             to anon, authenticated;
grant execute on function answers_for_application(text, text)        to anon, authenticated;
grant execute on function documents_for_application(text, text)      to anon, authenticated;
grant execute on function save_application_answer(text, text, text, text, integer) to anon, authenticated;
grant execute on function record_application_document(text, text, text, text, text, bigint, text) to anon, authenticated;
grant execute on function remove_application_document(text, text, text) to anon, authenticated;
grant execute on function submit_application(text, text)             to anon, authenticated;
grant execute on function application_upload_open(text, text)        to anon, authenticated;
grant execute on function accept_application(text, text)             to authenticated;
grant execute on function withdraw_application(text, text)           to authenticated;
grant execute on function application_folder_partner(text)           to authenticated;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Both kinds are asked something, and asked for paperwork. */
  for s in select unnest(array['seller', 'business']) loop
    select count(*) into n from application_fields where kind_of = s and required;
    if n = 0 then raise exception 'a % application asks no required question', s; end if;
    select count(*) into n from application_document_kinds where kind_of = s and required;
    if n = 0 then raise exception 'a % application asks for no document', s; end if;
  end loop;

  /* A business is asked about every step that reads anything, and nothing is
     asked under a step that does not exist. */
  select string_agg(l.id, ', ') into s
    from business_onboarding_ladder l
   where l.gate_id is not null
     and not exists (select 1 from application_fields f
                      where f.kind_of = 'business' and f.gate_id = l.gate_id);
  if s is not null then raise exception 'these business steps ask nothing: %', s; end if;

  select string_agg(distinct f.gate_id, ', ') into s
    from application_fields f
   where f.kind_of = 'business'
     and not exists (select 1 from business_onboarding_ladder l where l.gate_id = f.gate_id);
  if s is not null then raise exception 'these business questions sit under a step that does not exist: %', s; end if;

  select string_agg(distinct k.gate_id, ', ') into s
    from application_document_kinds k
   where k.kind_of = 'business'
     and not exists (select 1 from business_onboarding_ladder l where l.gate_id = k.gate_id);
  if s is not null then raise exception 'these business documents sit under a step that does not exist: %', s; end if;

  /* The seller form is untouched by all of this — every question that was on it
     is still on it and still filed as a seller's. */
  select count(*) into n from application_fields where kind_of = 'seller';
  if n < 30 then raise exception 'the seller form lost questions in the rename: % left', n; end if;
  select count(*) into n from application_document_kinds where kind_of = 'seller';
  if n < 12 then raise exception 'the seller document list lost entries: % left', n; end if;

  /* No application is both. */
  select count(*) into n from applications where partner_id is not null and account_id is not null;
  if n > 0 then raise exception '% applications became both a partner and an account', n; end if;

  /* An account reference is never reissued. */
  select count(*) into n from enterprise_accounts
   where id ~ '^ENT-\d+$'
     and substring(id from 5)::integer >= (select last_value from account_ref_seq);
  if n > 0 then
    raise exception '% existing accounts sit at or above the next reference the sequence will issue', n;
  end if;

  /* Anon can still do exactly what an applicant needs and nothing more. */
  select string_agg(f.fn, ', ') into s
    from (values ('start_application(text,text,text,text,text,text,text)'),
                 ('resume_application(text,text)'),
                 ('answers_for_application(text,text)'),
                 ('documents_for_application(text,text)'),
                 ('save_application_answer(text,text,text,text,integer)'),
                 ('submit_application(text,text)')) as f(fn)
   where not has_function_privilege('anon', f.fn, 'EXECUTE');
  if s is not null then raise exception 'an applicant cannot call: %', s; end if;

  select string_agg(f.fn, ', ') into s
    from (values ('accept_application(text,text)'),
                 ('withdraw_application(text,text)'),
                 ('application_for(text,text)'),
                 ('new_access_code()')) as f(fn)
   where has_function_privilege('anon', f.fn, 'EXECUTE');
  if s is not null then raise exception 'an anonymous caller can reach: %', s; end if;

  /* Exactly one of each function, so no caller can reach a stale body. Adding a
     defaulted parameter overloads rather than replaces, and the old
     `start_application` filed everything as a seller's. */
  select string_agg(x.proname || ' ×' || x.n, ', ') into s from (
    select p.proname, count(*) as n
      from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
     where ns.nspname = 'public'
       and p.proname in ('start_application', 'resume_application', 'submit_application',
                         'accept_application', 'withdraw_application', 'application_for',
                         'answers_for_application', 'documents_for_application',
                         'save_application_answer', 'record_application_document',
                         'remove_application_document')
     group by p.proname having count(*) > 1) x;
  if s is not null then raise exception 'these application functions have more than one signature: %', s; end if;

  /* The tables are still shut to everybody but the operator. */
  select count(*) into n from pg_policies
   where schemaname = 'public'
     and tablename in ('applications', 'application_answers', 'application_documents')
     and policyname not like 'operator%';
  if n > 0 then raise exception 'an application table has a policy other than the operator''s'; end if;
end $$;
