-- Every proof in this marketplace was a filename.
--
-- Two hundred and twelve onboarding documents, each with a name, a kind and a
-- size — "Certificate of incorporation, PDF, 1.4 MB" — and no file. The
-- operator's document tab listed them and its View button opened a panel that
-- described the document instead of showing it. A compliance record you cannot
-- open is a claim, not evidence.
--
-- So the rows get a path, a private bucket gets the files, and the screens get
-- a link that resolves to the actual document.
--
-- Private, not public. These are certificates of incorporation, bank
-- verification letters, tax residency certificates and beneficial ownership
-- declarations. They are read through a short-lived signed URL by the operator
-- who is reviewing them and by the seller who submitted them, and by nobody
-- else — which is a different rule from the knowledge base's manuals, where
-- published means published.

/* ============================================================= the bucket === */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('evidence', 'evidence', false, 20971520,
   array['application/pdf', 'text/plain', 'text/csv',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'image/png', 'image/jpeg'])
on conflict (id) do update set
  public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

/* Keyed on the first path segment, which is the counterparty the document
   belongs to: `PTR-1004/kyc/incorporation.pdf`, `ENT-2007/…`, `CUS-…/…`. */

drop policy if exists "evidence_operator_all" on storage.objects;
drop policy if exists "evidence_owner_read" on storage.objects;
drop policy if exists "evidence_owner_write" on storage.objects;

create policy "evidence_operator_all" on storage.objects for all to authenticated
  using (bucket_id = 'evidence' and current_persona() = 'operator')
  with check (bucket_id = 'evidence' and current_persona() = 'operator');

/* A seller reads their own folder and nobody else's. `current_partner_id()`
   is null for everybody who is not a seller, and null never equals a folder
   name, so the comparison fails closed. */
create policy "evidence_owner_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'evidence'
    and (storage.foldername(name))[1] = current_partner_id()
  );

create policy "evidence_owner_write" on storage.objects for insert to authenticated
  with check (
    bucket_id = 'evidence'
    and (storage.foldername(name))[1] = current_partner_id()
  );

/* ============================================== where each document lives === */

alter table onboarding_documents      add column if not exists path text;
alter table partner_category_evidence add column if not exists path text;

/* The business account's onboarding steps carry their documents as a jsonb
   array of names. Rather than reshape that for one screen, each step gains the
   paths alongside, in the same order. */
alter table enterprise_onboarding add column if not exists document_paths text[] not null default '{}';

/* A customer's own proofs — what they were shown and agreed to. There was
   nowhere for these at all, which is why a retail account could produce no
   evidence of anything. */
create table if not exists consumer_documents (
  id          text primary key,
  user_id     uuid references auth.users(id) on delete cascade,
  name        text not null,
  kind        text not null default 'PDF',
  category    text not null default 'Account',
  issued      text not null default '',
  detail      text not null default '',
  path        text,
  size        text not null default '',
  sort_order  integer not null default 0
);

alter table consumer_documents enable row level security;

drop policy if exists "consumer_documents_owner" on consumer_documents;
drop policy if exists "consumer_documents_operator" on consumer_documents;

create policy "consumer_documents_owner" on consumer_documents for select to authenticated
  using (user_id = auth.uid());
create policy "consumer_documents_operator" on consumer_documents for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* ------------------------------------------------- what a customer holds -- */

insert into consumer_documents (id, user_id, name, kind, category, issued, detail, size, sort_order)
select v.id, cp.user_id, v.name, 'PDF', v.category, v.issued, v.detail, v.size, v.sort_order
  from consumer_profile cp,
       (values
         ('CD-001', 'Customer agreement', 'Account', '14 Mar 2024',
          'The terms this account was opened under, countersigned. Names the plan, the notice period and what happens to the number if the account closes.', '0.4 MB', 1),
         ('CD-002', 'Proof of identity — verified', 'Account', '14 Mar 2024',
          'The identity check the regulator requires before a line is activated. The document itself is held by the verification agent; this is the certificate they issued.', '0.2 MB', 2),
         ('CD-003', 'Number portability authorisation', 'Account', '16 Mar 2024',
          'The authority given to port the number in, and the losing operator''s release.', '0.2 MB', 3),
         ('CD-004', 'Direct debit mandate', 'Payments', '14 Mar 2024',
          'The mandate signed for the account on file, with the reference the bank quotes.', '0.1 MB', 4),
         ('CD-005', 'Plan change confirmation — Fibre 500', 'Account', '02 Feb 2026',
          'What changed, when it took effect, and the pro-rating applied to the bill that followed.', '0.2 MB', 5),
         ('CD-006', 'Device protection certificate', 'Cover', '12 May 2026',
          'Cover taken with the handset: what is covered, the excess, and how to claim.', '0.3 MB', 6),
         ('CD-007', 'Privacy and marketing preferences', 'Account', '30 Jul 2026',
          'What this account has consented to and what it has refused, as at the date shown.', '0.1 MB', 7)
       ) as v(id, name, category, issued, detail, size, sort_order)
 where cp.id = 'me' and cp.user_id is not null
on conflict (id) do update set name = excluded.name, detail = excluded.detail;

/* ------------------------------------------------ where the files will go -- */

/* Derived from what each row already says it is, so the path and the name
   cannot drift: a document renamed without its file moving is a broken link
   that nothing detects. */
update onboarding_documents set path =
  partner_id || '/gates/' || lower(regexp_replace(id, '[^A-Za-z0-9]+', '-', 'g'))
  || '.' || lower(kind)
 where path is null;

update partner_category_evidence set path =
  partner_id || '/categories/' || lower(regexp_replace(id, '[^A-Za-z0-9]+', '-', 'g'))
  || '.' || lower(coalesce(kind, 'pdf'))
 where path is null and document is not null;

update consumer_documents set path =
  'CUS/' || lower(regexp_replace(id, '[^A-Za-z0-9]+', '-', 'g')) || '.pdf'
 where path is null;

update enterprise_onboarding e set document_paths = (
  select coalesce(array_agg(
    e.account_id || '/onboarding/' || lower(regexp_replace(e.id, '[^A-Za-z0-9]+', '-', 'g'))
    || '-' || ord || '.pdf' order by ord), '{}')
  from jsonb_array_elements_text(coalesce(e.documents, '[]'::jsonb)) with ordinality as d(name, ord))
 where document_paths = '{}';

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every document knows where its file is. */
  select count(*) into n from onboarding_documents where path is null;
  if n > 0 then raise exception '% onboarding documents have nowhere to keep a file', n; end if;

  select count(*) into n from consumer_documents where path is null;
  if n > 0 then raise exception '% customer documents have nowhere to keep a file', n; end if;

  /* Evidence that has been submitted has a path; evidence still outstanding
     does not, and should not — there is nothing to keep yet. */
  select count(*) into n from partner_category_evidence where document is not null and path is null;
  if n > 0 then raise exception '% submitted category evidence rows have no path', n; end if;
  select count(*) into n from partner_category_evidence where document is null and path is not null;
  if n > 0 then raise exception '% outstanding evidence rows point at a file that cannot exist', n; end if;

  /* Every path begins with the counterparty it belongs to, because that first
     segment is the whole access rule. */
  select string_agg(id, ', ') into s from onboarding_documents
   where split_part(path, '/', 1) <> partner_id;
  if s is not null then raise exception 'these documents would be readable by the wrong seller: %', s; end if;

  select string_agg(id, ', ') into s from partner_category_evidence
   where path is not null and split_part(path, '/', 1) <> partner_id;
  if s is not null then raise exception 'these evidence files would be readable by the wrong seller: %', s; end if;

  /* No two documents share a path, or one overwrites the other on upload. */
  select count(*) into n from (
    select path from onboarding_documents
    union all select path from partner_category_evidence where path is not null
    union all select path from consumer_documents
  ) x group by path having count(*) > 1;
  if n > 0 then raise exception '% paths are used by more than one document', n; end if;

  /* The demo seller, business account and customer each have something to
     show — this whole migration is for the moment somebody clicks View. */
  select count(*) into n from onboarding_documents where partner_id = 'PTR-1004';
  if n = 0 then raise exception 'the demo seller has no documents at all'; end if;
  select count(*) into n from enterprise_onboarding
   where account_id = 'ENT-2007' and array_length(document_paths, 1) > 0;
  if n = 0 then raise exception 'the demo business account has no documents at all'; end if;
  select count(*) into n from consumer_documents;
  if n = 0 then raise exception 'the demo customer has no documents at all'; end if;
end $$;
