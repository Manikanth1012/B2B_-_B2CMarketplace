/*
  # Evidence can be attached to a dispute

  "Upload evidence" on a seller's dispute raised `toast('Evidence upload
  opened')`. Nothing opened. On a screen whose whole subject is a disagreement
  about what was delivered, that is the one control that decides the outcome:
  the seller with the photograph of the sealed carton wins the argument, and the
  one who was told a file picker had opened does not.

  `support_attachments` already carries exactly this — a path, a filename, a
  size, a scan state, who uploaded it — but only against a ticket. A dispute is
  not a ticket: it is raised by a buyer against an order, has its own SLA and
  its own owner, and lives in `partner_disputes`.

  1. `dispute_id` beside `ticket_id`, exactly one of them set
     Rather than a second attachments table. The two kinds of attachment have
     identical facts, identical scanning, identical size limits, and one storage
     bucket; splitting them would mean maintaining both and forgetting one. The
     check constraint is what keeps the column honest — an attachment against
     both a ticket and a dispute belongs to neither.

  2. Security
     A seller may attach evidence to their own dispute and read what has been
     attached to it, including what the marketplace attached in reply. They may
     delete only their own upload, and only while the dispute is open: evidence
     withdrawn after a decision is evidence the decision was made on.
*/

alter table support_attachments
  add column if not exists dispute_id text references partner_disputes(id) on delete cascade;

alter table support_attachments drop constraint if exists support_attachments_belongs_to_one;
alter table support_attachments add constraint support_attachments_belongs_to_one
  check (num_nonnulls(ticket_id, dispute_id) = 1);

create index if not exists support_attachments_dispute_idx on support_attachments (dispute_id);

/* A seller reads everything attached to their own dispute — theirs and the
   marketplace's. An argument where one side cannot see the other side's
   evidence is not a process. */
drop policy if exists partner_read_dispute_evidence on support_attachments;
create policy partner_read_dispute_evidence on support_attachments
  for select to authenticated
  using (
    dispute_id is not null
    and exists (
      select 1 from partner_disputes d
      where d.id = support_attachments.dispute_id and d.partner_id = current_partner_id()
    )
  );

drop policy if exists partner_add_dispute_evidence on support_attachments;
create policy partner_add_dispute_evidence on support_attachments
  for insert to authenticated
  with check (
    dispute_id is not null
    and user_id = auth.uid()
    and exists (
      select 1 from partner_disputes d
      where d.id = support_attachments.dispute_id
        and d.partner_id = current_partner_id()
        and d.status not in ('resolved', 'rejected')
    )
  );

/* Their own upload, and only while it is still open. */
drop policy if exists partner_remove_dispute_evidence on support_attachments;
create policy partner_remove_dispute_evidence on support_attachments
  for delete to authenticated
  using (
    dispute_id is not null
    and user_id = auth.uid()
    and exists (
      select 1 from partner_disputes d
      where d.id = support_attachments.dispute_id
        and d.partner_id = current_partner_id()
        and d.status not in ('resolved', 'rejected')
    )
  );

/* The bucket the ticket attachments already use. One bucket, one set of storage
   policies, one place a file can be. The path opens with the dispute id, which
   is what the policy matches on — the path is the permission. */
drop policy if exists partner_read_dispute_files on storage.objects;
create policy partner_read_dispute_files on storage.objects
  for select to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and exists (
      select 1 from partner_disputes d
      where d.partner_id = current_partner_id()
        and (storage.foldername(name))[1] = d.id
    )
  );

drop policy if exists partner_write_dispute_files on storage.objects;
create policy partner_write_dispute_files on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'ticket-attachments'
    and exists (
      select 1 from partner_disputes d
      where d.partner_id = current_partner_id()
        and d.status not in ('resolved', 'rejected')
        and (storage.foldername(name))[1] = d.id
    )
  );

drop policy if exists partner_delete_dispute_files on storage.objects;
create policy partner_delete_dispute_files on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'ticket-attachments'
    and owner = auth.uid()
    and exists (
      select 1 from partner_disputes d
      where d.partner_id = current_partner_id()
        and d.status not in ('resolved', 'rejected')
        and (storage.foldername(name))[1] = d.id
    )
  );

do $$
declare
  n integer;
begin
  /* Every existing attachment still belongs to exactly one thing. */
  select count(*) into n from support_attachments where num_nonnulls(ticket_id, dispute_id) <> 1;
  if n > 0 then
    raise exception '% attachments belong to neither a ticket nor a dispute, or to both', n;
  end if;

  select count(*) into n from pg_policies
   where tablename = 'support_attachments'
     and policyname in ('partner_read_dispute_evidence', 'partner_add_dispute_evidence', 'partner_remove_dispute_evidence');
  if n <> 3 then
    raise exception 'Only % of the three dispute-evidence policies took', n;
  end if;

  select count(*) into n from pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname in ('partner_read_dispute_files', 'partner_write_dispute_files', 'partner_delete_dispute_files');
  if n <> 3 then
    raise exception 'Only % of the three storage policies took, so a seller could write a row pointing at a file they cannot upload', n;
  end if;

  /* A dispute the demo seller can attach to, or the flow cannot be checked. */
  select count(*) into n from partner_disputes
   where partner_id = 'PTR-1004' and status not in ('resolved', 'rejected');
  if n = 0 then
    raise exception 'The demo seller has no open dispute to attach evidence to';
  end if;

  /* The policies above decide "still open" by naming the settled statuses. A
     status nobody listed would silently be treated as open, so the set is
     checked rather than assumed. */
  select count(*) into n from partner_disputes
   where status not in ('open', 'awaiting_seller', 'awaiting_marketplace', 'resolved', 'rejected');
  if n > 0 then
    raise exception '% disputes have a status the evidence policies do not account for', n;
  end if;
end $$;
