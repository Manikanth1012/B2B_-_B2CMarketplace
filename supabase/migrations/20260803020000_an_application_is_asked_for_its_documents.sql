-- The application asks thirty-one questions and never asks for a document.
--
-- Every seller already on the marketplace has a shelf of them —
-- `onboarding_documents` holds a certificate of incorporation, a beneficial
-- ownership declaration, a redacted director passport, a bank verification
-- letter, the countersigned terms and the DPA. The gates are decisions *on*
-- those documents: "Registration, beneficial ownership over 25%, sanctions and
-- PEP screening" is not a text box, it is a file somebody reads.
--
-- So the public application collected prose where the desk needs evidence, and
-- an accepted applicant arrived at the KYC gate with nothing attached. The demo
-- partner shows what the finished state looks like; this is what was missing to
-- get there.
--
-- Two tables, matching the shape `20260803000000` used for the questions:
--
--   what is asked   `application_document_kinds`, one row per document the desk
--                   wants, filed under the gate that will read it. A table
--                   rather than a list in a component, so the form, the
--                   outstanding count and the submit check read one thing.
--   what came back  `partner_application_documents`, one row per uploaded file,
--                   pointing at an object in the `evidence` bucket.
--
-- The hard part is that an applicant is anonymous. Storage decides what a
-- request may write from what the request carries, and an anonymous one carries
-- nothing — so the bytes go to a path built from the reference AND the access
-- code, and the storage policy asks a `security definer` function whether that
-- pair opens a draft application. The same credential as everywhere else, and
-- the same reason it has to be a function: `partner_applications` is invisible
-- to anon, so a policy that queried it directly would refuse everybody.

/* ============================ what the desk asks for === */

create table if not exists application_document_kinds (
  id         text primary key,
  gate_id    text not null,
  label      text not null,
  note       text,
  /* Some are conditional in real life — a tax residency certificate only if
     treaty relief is claimed. Modelled as not-required rather than as a rule
     engine: the desk asks for it at the gate if the answers call for it, and a
     form that refuses to submit over a document the applicant does not need is
     a form nobody finishes. */
  required   boolean not null default true,
  sort_order integer not null
);

comment on table application_document_kinds is
  'The documents an applicant is asked to upload, filed under the gate that reads them. Mirrors `onboarding_documents`, which is what these become once the desk accepts the application.';

alter table application_document_kinds enable row level security;

drop policy if exists anyone_read_document_kinds on application_document_kinds;
create policy anyone_read_document_kinds on application_document_kinds for select using (true);

drop policy if exists operator_all_document_kinds on application_document_kinds;
create policy operator_all_document_kinds on application_document_kinds
  for all using (current_persona() = 'operator');

insert into application_document_kinds (id, gate_id, label, note, required, sort_order) values
  ('doc-apply-profile', 'apply',   'Company profile or brochure', 'What you sell, in your own words. Read by the desk before anything else.', false, 10),

  ('doc-kyc-inc',       'kyc',     'Certificate of incorporation', 'Verified against the register in the country of registration.', true, 20),
  ('doc-kyc-ubo',       'kyc',     'Beneficial ownership declaration', 'Everyone holding over 25%, with identification for each.', true, 30),
  ('doc-kyc-id',        'kyc',     'Director identification', 'Passport or national ID for at least one director. Redact anything the marketplace does not need.', true, 40),
  ('doc-kyc-address',   'kyc',     'Proof of registered address', 'A utility bill or bank statement in the company name, under three months old.', true, 50),

  ('doc-agree-terms',   'agree',   'Marketplace terms, signed', 'Signed by the person named as authorised to bind the company.', true, 60),
  ('doc-agree-dpa',     'agree',   'Data processing agreement, signed', 'Order payloads carry buyer data. This is what governs what you may do with it.', true, 70),
  ('doc-agree-auth',    'agree',   'Board resolution or power of attorney', 'Only if the signatory is not a director on the register.', false, 80),

  ('doc-finance-bank',  'finance', 'Bank verification letter or cancelled cheque', 'Shows the account name matches the company. The micro-deposit check confirms the number.', true, 90),
  ('doc-finance-tax',   'finance', 'Tax registration certificate', 'GST certificate, TRN certificate or KRA PIN certificate.', true, 100),
  ('doc-finance-res',   'finance', 'Tax residency certificate', 'Only if you claim treaty relief from withholding. Without one the statutory rate applies.', false, 110),

  ('doc-tech-arch',     'tech',    'Integration or catalogue feed specification', 'How your feed is structured and how often it updates.', false, 120),

  ('doc-assure-sec',    'assure',  'Security certification', 'ISO 27001, SOC 2 or equivalent. Not holding one does not fail the gate; the questionnaire is longer.', false, 130),
  ('doc-assure-ins',    'assure',  'Product liability or professional indemnity insurance', 'Certificate of currency, showing the sum insured and the expiry date.', true, 140)
on conflict (id) do update set
  gate_id = excluded.gate_id, label = excluded.label, note = excluded.note,
  required = excluded.required, sort_order = excluded.sort_order;

/* ============================ what came back === */

create table if not exists partner_application_documents (
  id             text primary key,
  application_id text not null references partner_applications(id) on delete cascade,
  kind_id        text not null references application_document_kinds(id),
  /* The name the applicant's own file had, kept for the desk to read. `path` is
     built from the reference, the code and a safe name, and the two are not the
     same string on purpose — a filename is theirs and a path is ours. */
  name           text not null,
  mime           text not null,
  bytes          bigint not null,
  path           text not null unique,
  uploaded_at    timestamptz not null default now()
);

/* One file per kind. Re-uploading replaces rather than accumulating, because a
   gate reading two certificates of incorporation has to work out which one
   counts, and that is not a question the desk should be asked. */
create unique index if not exists application_document_one_per_kind
  on partner_application_documents (application_id, kind_id);

alter table partner_application_documents enable row level security;

drop policy if exists operator_all_application_documents on partner_application_documents;
create policy operator_all_application_documents on partner_application_documents
  for all using (current_persona() = 'operator');

/* ============================ what opens the folder === */

/* Asked by the storage policies below, which run as the requesting role — and
   for an applicant that role is `anon`, which cannot see `partner_applications`
   at all. A policy that queried the table directly would find nothing and
   refuse every upload, which is a hard failure to diagnose from a browser. */
create or replace function application_upload_open(p_ref text, p_code text)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from partner_applications
     where id = p_ref and access_code = p_code and state = 'draft');
$$;

/* Once accepted, the folder belongs to the partner it became — so the seller can
   open the documents they themselves supplied. Without this their own KYC pack
   is visible to the marketplace and not to them. */
create or replace function application_folder_partner(p_ref text)
returns text language sql stable security definer set search_path = public as $$
  select partner_id from partner_applications where id = p_ref;
$$;

revoke all on function application_upload_open(text, text) from public;
revoke all on function application_folder_partner(text)    from public;
grant execute on function application_upload_open(text, text) to anon, authenticated;
grant execute on function application_folder_partner(text)    to authenticated;

/* Paths are `<reference>/<access code>/<safe name>` in the `evidence` bucket —
   the bucket the marketplace's other documents already live in, so the
   operator's existing `evidence_operator_all` policy reads these without a new
   grant and `openEvidence` serves them with the same signed URL.

   Insert and delete only. An applicant never reads back: they know what they
   uploaded because the row says so, and a select policy here would let anybody
   holding a reference and code enumerate the folder. */
drop policy if exists application_docs_anon_write on storage.objects;
create policy application_docs_anon_write on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'evidence'
    and array_length(storage.foldername(name), 1) >= 2
    and application_upload_open((storage.foldername(name))[1], (storage.foldername(name))[2]));

drop policy if exists application_docs_anon_delete on storage.objects;
create policy application_docs_anon_delete on storage.objects
  for delete to anon, authenticated
  using (
    bucket_id = 'evidence'
    and array_length(storage.foldername(name), 1) >= 2
    and application_upload_open((storage.foldername(name))[1], (storage.foldername(name))[2]));

drop policy if exists application_docs_partner_read on storage.objects;
create policy application_docs_partner_read on storage.objects
  for select to authenticated
  using (
    bucket_id = 'evidence'
    and array_length(storage.foldername(name), 1) >= 1
    and application_folder_partner((storage.foldername(name))[1]) = current_partner_id());

/* ============================ the applicant's side === */

create or replace function application_documents(p_ref text, p_code text)
returns table (id text, kind_id text, name text, mime text, bytes bigint, path text, uploaded_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare app partner_applications;
begin
  app := application_for(p_ref, p_code);
  if app.id is null then
    raise exception 'No open application matches that reference and access code.';
  end if;
  return query select d.id, d.kind_id, d.name, d.mime, d.bytes, d.path, d.uploaded_at
                 from partner_application_documents d
                 where d.application_id = app.id;
end $$;

create or replace function record_application_document(
  p_ref text, p_code text, p_kind text, p_name text, p_mime text, p_bytes bigint, p_path text
) returns text language plpgsql security definer set search_path = public as $$
declare app partner_applications; v_id text; v_old text;
begin
  app := application_for(p_ref, p_code);
  if app.id is null then
    raise exception 'No open application matches that reference and access code.';
  end if;
  if app.state <> 'draft' then
    raise exception 'This application is with the desk. Ask them to reopen it before changing anything.';
  end if;
  if not exists (select 1 from application_document_kinds where id = p_kind) then
    raise exception 'The desk does not ask for a document called %.', p_kind;
  end if;
  /* The path has to sit under this application's own folder. Without this a
     row could point at somebody else's file and the desk would open it
     believing it belonged here. */
  if p_path not like app.id || '/' || app.access_code || '/%' then
    raise exception 'That file was not uploaded against this application.';
  end if;

  /* One per kind: the replaced row's path comes back so the caller can remove
     the object it pointed at, rather than leaving the bucket to fill up. */
  select d.path into v_old from partner_application_documents d
   where d.application_id = app.id and d.kind_id = p_kind;
  delete from partner_application_documents
   where application_id = app.id and kind_id = p_kind;

  v_id := 'APD-' || replace(app.id, 'APP-', '') || '-' || p_kind;
  insert into partner_application_documents (id, application_id, kind_id, name, mime, bytes, path)
  values (v_id, app.id, p_kind, p_name, p_mime, p_bytes, p_path);

  update partner_applications set last_saved = now() where id = app.id;
  return coalesce(v_old, '');
end $$;

create or replace function remove_application_document(p_ref text, p_code text, p_kind text)
returns text language plpgsql security definer set search_path = public as $$
declare app partner_applications; v_old text;
begin
  app := application_for(p_ref, p_code);
  if app.id is null then
    raise exception 'No open application matches that reference and access code.';
  end if;
  if app.state <> 'draft' then
    raise exception 'This application is with the desk. Ask them to reopen it before changing anything.';
  end if;

  select d.path into v_old from partner_application_documents d
   where d.application_id = app.id and d.kind_id = p_kind;
  delete from partner_application_documents
   where application_id = app.id and kind_id = p_kind;
  update partner_applications set last_saved = now() where id = app.id;
  return coalesce(v_old, '');
end $$;

revoke all on function application_documents(text, text)       from public, anon, authenticated;
revoke all on function record_application_document(text, text, text, text, text, bigint, text) from public, anon, authenticated;
revoke all on function remove_application_document(text, text, text) from public, anon, authenticated;
grant execute on function application_documents(text, text)    to anon, authenticated;
grant execute on function record_application_document(text, text, text, text, text, bigint, text) to anon, authenticated;
grant execute on function remove_application_document(text, text, text) to anon, authenticated;

/* ============================ submitting needs them === */

/* Rewritten rather than patched: the outstanding list now spans questions and
   documents, and an applicant who is told about the questions, fixes them, and
   is then told about the documents has been made to go round twice. */
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

  select string_agg(x.label, '; ' order by x.sort_order) into missing from (
    select f.label, f.sort_order
      from partner_application_fields f
     where f.required
       and not exists (select 1 from partner_application_answers a
                        where a.application_id = app.id and a.field_id = f.id)
    union all
    select k.label, 1000 + k.sort_order
      from application_document_kinds k
     where k.required
       and not exists (select 1 from partner_application_documents d
                        where d.application_id = app.id and d.kind_id = k.id)
  ) x;
  if missing is not null then
    raise exception 'Still outstanding: %', missing;
  end if;

  update partner_applications
     set state = 'submitted', submitted_on = now(), last_saved = now(),
         reached = (select max(sort_order) from partner_application_fields)
   where id = app.id;
  return app.id;
end $$;

revoke all on function submit_application(text, text) from public, anon, authenticated;
grant execute on function submit_application(text, text) to anon, authenticated;

/* ============================ and accepting carries them over === */

/* The documents become the partner's, filed under the gate that reads them, in
   the same table the demo seller's are in — which is the whole point. The
   object is not copied: the path already resolves, and
   `application_docs_partner_read` is what lets the new seller open it. */
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

  select count(*) into n
    from partner_application_fields f
   where f.required
     and not exists (select 1 from partner_application_answers a
                      where a.application_id = app.id and a.field_id = f.id);
  if n > 0 then
    raise exception '% is missing % required answers. Send it back rather than accepting it.', app.id, n;
  end if;

  select count(*) into n
    from application_document_kinds k
   where k.required
     and not exists (select 1 from partner_application_documents d
                      where d.application_id = app.id and d.kind_id = k.id);
  if n > 0 then
    raise exception '% is missing % required documents. Send it back rather than accepting it.', app.id, n;
  end if;

  v_actor := coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'email', 'the onboarding desk');
  v_partner := 'PTR-' || nextval('partner_ref_seq')::text;
  select m.name into v_country from markets m where m.code = app.country;

  insert into partners (id, name, type, status, country, contact, email, joined, tier, tier_id)
  values (v_partner, app.company, app.kind, 'onboarding', v_country,
          app.contact_name, app.email, to_char(now(), 'DD Mon YYYY'), 'Bronze', 'bronze');

  perform open_partner_journey(
    v_partner,
    'Opened from ' || app.id || ' by ' || v_actor
      || case when coalesce(trim(p_note), '') = '' then '' else ': ' || trim(p_note) end,
    app.contact_name, app.submitted_on,
    array(select f.label from partner_application_fields f
           where f.gate_id = 'apply' and f.required order by f.sort_order));

  insert into onboarding_documents (id, gate_id, partner_id, name, kind, size, uploaded_by, uploaded_at, sort_order, path)
  select 'doc-' || v_partner || '-' || d.kind_id,
         'og-' || v_partner || '-' || k.gate_id,
         v_partner, k.label,
         /* `kind` on `onboarding_documents` is the human label the desk shows —
            "PDF", "PNG" — not the MIME type. Derived rather than stored twice. */
         upper(coalesce(nullif(split_part(d.mime, '/', 2), ''), 'FILE')),
         case when d.bytes < 1048576
              then to_char(round(d.bytes / 1024.0, 0), 'FM999999') || ' KB'
              else to_char(round(d.bytes / 1048576.0, 1), 'FM999990.9') || ' MB' end,
         app.contact_name, d.uploaded_at, k.sort_order, d.path
    from partner_application_documents d
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

revoke all on function accept_application(text, text) from public, anon, authenticated;
grant execute on function accept_application(text, text) to authenticated;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every document is asked for under a gate the marketplace runs. */
  select string_agg(distinct k.gate_id, ', ') into s
    from application_document_kinds k
   where not exists (select 1 from onboarding_gate_ladder g where g.id = k.gate_id);
  if s is not null then raise exception 'these documents are filed under gates that do not exist: %', s; end if;

  /* The gates that are decisions on paperwork ask for paperwork. Named rather
     than ranged over every gate: go-live is a switch being thrown and the
     technical gate is a sandbox order, and neither is a document. */
  select string_agg(g, ', ') into s from unnest(array['kyc', 'agree', 'finance']) g
   where not exists (select 1 from application_document_kinds k where k.gate_id = g and k.required);
  if s is not null then
    raise exception 'these gates decide on documents and ask for none: %', s;
  end if;

  /* Floors. */
  select count(*) into n from application_document_kinds;
  if n < 10 then raise exception 'the checklist has only % documents', n; end if;
  select count(*) into n from application_document_kinds where required;
  if n = 0 then raise exception 'no document is required, so submitting proves nothing'; end if;
  select count(*) into n from application_document_kinds where not required;
  if n = 0 then
    raise exception 'every document is required, so the optional case is never exercised';
  end if;

  /* What a new seller gets matches what the sellers already here have. Read off
     `onboarding_documents` rather than asserted against a list — if the demo
     partners hold a kind of document the application never asks for, the
     accepted seller arrives at that gate with a hole in the pack. */
  select string_agg(distinct x.gate, ', ') into s from (
    select substring(d.gate_id from '[^-]+$') as gate
      from onboarding_documents d
     where d.partner_id in (select id from partners where status = 'onboarding')
  ) x
   where x.gate in ('kyc', 'agree', 'finance')
     and not exists (select 1 from application_document_kinds k where k.gate_id = x.gate);
  if s is not null then
    raise exception 'existing sellers hold documents at gates the application never asks about: %', s;
  end if;

  /* Anon can put a file up and take one down, and cannot read the folder back.
     A select policy here would let anybody holding a reference enumerate it. */
  select count(*) into n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('application_docs_anon_write', 'application_docs_anon_delete');
  if n <> 2 then raise exception 'the applicant cannot upload: only % of 2 storage policies exist', n; end if;

  select count(*) into n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'application_docs_anon_write' and cmd = 'SELECT';
  if n > 0 then raise exception 'the upload policy also grants reads'; end if;

  /* The functions an applicant needs are reachable and the credential helper is
     not. Asked with `has_function_privilege`, for the reason recorded in
     `20260803000000`. */
  select string_agg(f.fn, ', ') into s
    from (values ('application_documents(text,text)'),
                 ('record_application_document(text,text,text,text,text,bigint,text)'),
                 ('remove_application_document(text,text,text)'),
                 ('submit_application(text,text)')) as f(fn)
   where not has_function_privilege('anon', f.fn, 'EXECUTE');
  if s is not null then raise exception 'an applicant cannot call: %', s; end if;

  if has_function_privilege('anon', 'accept_application(text,text)', 'EXECUTE') then
    raise exception 'an anonymous caller can accept an application';
  end if;

  /* And no document row points outside its own application's folder. */
  select string_agg(d.id, ', ') into s
    from partner_application_documents d join partner_applications a on a.id = d.application_id
   where d.path not like a.id || '/%';
  if s is not null then raise exception 'these documents sit outside their application: %', s; end if;
end $$;
