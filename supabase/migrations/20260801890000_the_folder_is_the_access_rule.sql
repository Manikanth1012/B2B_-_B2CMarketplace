-- The evidence bucket keys access on the first path segment, and only two of
-- the four personas had a rule.
--
-- The operator could read everything and a seller could read their own folder.
-- A business account's onboarding pack and a customer's own records sat in the
-- bucket with nobody entitled to open them — the console would ask for a signed
-- URL and be told the object does not exist, which is what a storage policy
-- says when it means no.
--
-- And the customer's files were filed under a literal `CUS/`, shared by every
-- customer there will ever be. There is one customer in this prototype so
-- nothing leaks today, but a folder that is the access rule cannot be a
-- constant: the second customer would read the first one's identity
-- certificate. So the folder becomes the customer's own id, and the rule
-- becomes true rather than merely harmless.

/* ============================================ who a signed-in customer is === */

create or replace function current_customer_id()
returns text language sql stable security definer set search_path = public as $$
  select customer_id from consumer_profile where user_id = auth.uid()
$$;

/* ============================================== re-file what is misfiled === */

update consumer_documents d set path =
  (select cp.customer_id from consumer_profile cp where cp.user_id = d.user_id)
  || '/' || split_part(d.path, '/', 2)
 where split_part(d.path, '/', 1) = 'CUS'
   and exists (select 1 from consumer_profile cp where cp.user_id = d.user_id);

/* =========================================================== the policies === */

drop policy if exists "evidence_account_read" on storage.objects;
drop policy if exists "evidence_customer_read" on storage.objects;

/* Each of these compares the folder against a helper that is null for everybody
   the rule is not about, and null never equals a folder name — so a persona
   with no business here fails closed rather than matching everything. */

create policy "evidence_account_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'evidence'
    and (storage.foldername(name))[1] = current_account_id()
  );

create policy "evidence_customer_read" on storage.objects for select to authenticated
  using (
    bucket_id = 'evidence'
    and (storage.foldername(name))[1] = current_customer_id()
  );

/* --------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* No document is filed under a constant any longer. A folder that is the
     same for two parties is not an access rule. */
  select count(*) into n from consumer_documents where split_part(path, '/', 1) = 'CUS';
  if n > 0 then raise exception '% customer documents are still in the shared CUS folder', n; end if;

  select string_agg(d.id, ', ') into s
    from consumer_documents d
    join consumer_profile cp on cp.user_id = d.user_id
   where split_part(d.path, '/', 1) <> cp.customer_id;
  if s is not null then raise exception 'these customer documents are filed under the wrong customer: %', s; end if;

  /* Still unique after the move — re-filing that collides overwrites. */
  select count(*) into n from (
    select path from onboarding_documents
    union all select path from partner_category_evidence where path is not null
    union all select path from consumer_documents
  ) x group by path having count(*) > 1;
  if n > 0 then raise exception '% paths are used by more than one document', n; end if;

  /* Every persona that has documents in the bucket has a policy that reaches
     them. Four rules for four folders; three would mean a console that shows a
     row it can never open. */
  select count(*) into n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('evidence_operator_all', 'evidence_owner_read',
                        'evidence_account_read', 'evidence_customer_read');
  if n <> 4 then raise exception 'expected 4 evidence policies, found %', n; end if;
end $$;
