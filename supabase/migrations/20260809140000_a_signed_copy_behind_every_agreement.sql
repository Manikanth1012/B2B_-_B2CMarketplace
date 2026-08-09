/* A signed copy behind every agreement.
 *
 * Seven agreements and three amendments, each with a real two-page document in
 * the evidence bucket: the parties, the term, the payment terms, what governs
 * the price, and two signature blocks. Generated and uploaded alongside this
 * file rather than described by it.
 *
 * This is the same rule as `20260808...` gave the knowledge base and the
 * onboarding gates, and the contract is where breaking it would matter most. An
 * account clicking "signed copy" on its own agreement and getting a placeholder
 * learns something about how seriously the rest of the record is meant.
 *
 * Clause 3 of each one says out loud what CR-008 records: the customer is
 * charged the published price for its market, no rate card forms part of the
 * agreement, and no stated term value alters what anything costs. The document
 * and the database say the same thing, which is the point of writing the
 * document from the row.
 */

update public.enterprise_contract set
  document_name = id || '.pdf',
  document_path = account_id || '/contracts/' || id || '.pdf'
 where document_path is null or document_path is distinct from (account_id || '/contracts/' || id || '.pdf');

update public.enterprise_contract_amendment a set
  document_name = a.id || '.pdf',
  document_path = c.account_id || '/contracts/' || a.id || '.pdf'
 from public.enterprise_contract c
where c.id = a.contract_id
  and (a.document_path is null
       or a.document_path is distinct from (c.account_id || '/contracts/' || a.id || '.pdf'));

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text; n int;
begin
  /* ASSERT-1: every agreement names a file and a path. */
  select string_agg(id, ', ') into bad from public.enterprise_contract
   where document_path is null or document_name is null;
  if bad is not null then raise exception 'agreements with no signed copy: %', bad; end if;

  /* ASSERT-2: and every amendment does too. An amendment is the half of a
     contract most likely to exist only as an email. */
  select string_agg(id, ', ') into bad from public.enterprise_contract_amendment
   where document_path is null or document_name is null;
  if bad is not null then raise exception 'amendments with no signed copy: %', bad; end if;

  /* ASSERT-3: the path is under the account that owns it, because the bucket's
     access rules are read off the first segment. A document filed under the
     wrong account is one the wrong buyer could ask for. */
  select string_agg(c.id, ', ') into bad from public.enterprise_contract c
   where c.document_path not like c.account_id || '/%';
  if bad is not null then raise exception 'agreements filed under the wrong account: %', bad; end if;

  select string_agg(a.id, ', ') into bad
    from public.enterprise_contract_amendment a
    join public.enterprise_contract c on c.id = a.contract_id
   where a.document_path not like c.account_id || '/%';
  if bad is not null then raise exception 'amendments filed under the wrong account: %', bad; end if;

  /* ASSERT-4: no two records point at one file. A shared path means one
     account's page shows another's paper. */
  select count(*) into n from (
    select document_path from public.enterprise_contract
     union all select document_path from public.enterprise_contract_amendment) t
   group by document_path having count(*) > 1;
  if n > 0 then raise exception '% documents are referenced by more than one record', n; end if;

  /* ASSERT-5: and the files are actually in the bucket. The check that separates
     "a path was written" from "a document exists", which is the whole difference
     between this and a placeholder. */
  select string_agg(c.id, ', ') into bad from public.enterprise_contract c
   where not exists (
     select 1 from storage.objects o
      where o.bucket_id = 'evidence' and o.name = c.document_path);
  if bad is not null then raise exception 'agreements whose signed copy is not in the bucket: %', bad; end if;

  select string_agg(a.id, ', ') into bad from public.enterprise_contract_amendment a
   where not exists (
     select 1 from storage.objects o
      where o.bucket_id = 'evidence' and o.name = a.document_path);
  if bad is not null then raise exception 'amendments whose signed copy is not in the bucket: %', bad; end if;
end $$;
