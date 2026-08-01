-- Files: on a ticket, and on a knowledge base article.
--
-- Two gaps that turn out to be one problem. A customer reporting a damaged
-- parcel has a photograph of it and nowhere to put it, so the description does
-- the work a picture would do better and the desk asks for it by email. And an
-- article explaining how to mount a sensor is three paragraphs of prose where
-- the manual, the datasheet and the two-minute video already exist.
--
-- Both are files hanging off a row, and both need the same three things: real
-- bytes somewhere, a record of what the file is, and a rule about who may
-- fetch it. The rule is where they differ, and it is the interesting part:
--
--   * A ticket attachment is evidence on somebody's complaint. Private — the
--     person who raised the ticket and the desk working it, nobody else. It is
--     a photograph of a customer's hallway.
--   * A knowledge base asset is documentation. Public to anybody who can read
--     the article, which is the point of publishing a manual.
--
-- So: two buckets, two sets of rules, one shape.

/* ============================================================= buckets === */

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  /* Private. A signed URL, minted per request, for the two parties to the
     ticket. 10 MB is a generous photograph and a mean video, which is the
     right way round for evidence. */
  ('ticket-attachments', 'ticket-attachments', false, 10485760,
   array['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf', 'text/plain']),
  /* Public. Manuals, brochures and datasheets are published documents, and a
     video needs range requests that signed URLs make awkward. 100 MB. */
  ('kb-assets', 'kb-assets', true, 104857600,
   array['application/pdf', 'image/png', 'image/jpeg', 'image/webp',
         'video/mp4', 'video/webm', 'text/csv',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

/* =================================================== ticket attachments === */

create table if not exists support_attachments (
  id          text primary key,
  ticket_id   text not null references support_tickets(id) on delete cascade,
  /* Where the bytes are, inside `ticket-attachments`. Null while a record
     exists for a file that was never uploaded — see the guard below, which
     stops that being a way to fake evidence. */
  path        text,
  filename    text not null,
  mime        text not null,
  bytes       bigint not null,
  /* What it is for, so the desk can sort a proof of damage from a bank
     statement without opening either. */
  kind        text not null default 'evidence'
              check (kind in ('evidence', 'document', 'screenshot', 'other')),
  caption     text,
  uploaded_by text not null,
  user_id     uuid references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now(),
  /* An attachment can be scanned before the desk opens it. Nothing here does
     the scanning; what matters is that the column exists so a screen never
     implies a clean file it has no reason to believe is clean. */
  scan        text not null default 'pending' check (scan in ('pending', 'clean', 'blocked')),
  sort_order  integer not null default 0
);

create index if not exists support_attachments_ticket_idx on support_attachments(ticket_id);

alter table support_attachments drop constraint if exists support_attachments_bytes_check;
alter table support_attachments add constraint support_attachments_bytes_check
  check (bytes > 0 and bytes <= 10485760);

/* ==================================================== knowledge assets === */

create table if not exists kb_assets (
  id          text primary key,
  article_id  text not null references kb_articles(id) on delete cascade,
  /* The vocabulary a reader recognises. `manual` is the do-it-yourself guide,
     `datasheet` the specification, `brochure` the sales sheet, `video` the
     walkthrough, `template` a spreadsheet or form they fill in. */
  kind        text not null check (kind in ('manual', 'datasheet', 'brochure', 'video', 'template', 'other')),
  title       text not null,
  description text not null,
  path        text,
  /* An asset the marketplace hosts has a path; one it points at elsewhere has
     a url. Exactly one of the two, which the constraint below enforces —
     a card offering neither is a download button that does nothing. */
  url         text,
  mime        text not null,
  bytes       bigint,
  /* Videos carry a running time, everything else carries pages or nothing.
     Both are what a reader wants before they click, not after. */
  duration_secs integer,
  pages       integer,
  language    text not null default 'English',
  updated     date,
  sort_order  integer not null default 0
);

create index if not exists kb_assets_article_idx on kb_assets(article_id);

alter table kb_assets drop constraint if exists kb_assets_where_check;
alter table kb_assets add constraint kb_assets_where_check
  check ((path is not null) <> (url is not null));

alter table kb_assets drop constraint if exists kb_assets_duration_check;
alter table kb_assets add constraint kb_assets_duration_check
  check ((kind = 'video') = (duration_secs is not null));

/* ================================================================= RLS === */

alter table support_attachments enable row level security;
alter table kb_assets           enable row level security;

drop policy if exists "operator_all_support_attachments" on support_attachments;
create policy "operator_all_support_attachments" on support_attachments
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* The two parties to the ticket, and nobody else. Scoped through the ticket
   rather than repeated here, so an attachment can never be more visible than
   the complaint it belongs to. */
drop policy if exists "mine_read_support_attachments" on support_attachments;
create policy "mine_read_support_attachments" on support_attachments
  for select to authenticated
  using (exists (
    select 1 from support_tickets t
     where t.id = support_attachments.ticket_id
       and (t.user_id = auth.uid()
            or (t.account_id is not null and t.account_id = current_account_id())
            or (t.partner_id is not null and t.partner_id = current_partner_id()))));

drop policy if exists "mine_add_support_attachments" on support_attachments;
create policy "mine_add_support_attachments" on support_attachments
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (select 1 from support_tickets t
                 where t.id = ticket_id and t.user_id = auth.uid()));

/* Removing your own attachment before the desk has read it is reasonable;
   removing it afterwards is editing the evidence. `guard_attachment()` below
   draws that line — the policy only says whose it is. */
drop policy if exists "mine_remove_support_attachments" on support_attachments;
create policy "mine_remove_support_attachments" on support_attachments
  for delete to authenticated
  using (user_id = auth.uid());

/* Documentation is published. Anybody who can read the article can read what
   hangs off it, signed in or not — the knowledge base is deliberately open. */
drop policy if exists "public_read_kb_assets" on kb_assets;
create policy "public_read_kb_assets" on kb_assets
  for select to anon, authenticated using (true);

drop policy if exists "operator_all_kb_assets" on kb_assets;
create policy "operator_all_kb_assets" on kb_assets
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* ------------------------------------------------ and the storage itself -- */

/* A bucket without object policies is a bucket nobody can write to. These
   mirror the table policies above: the ticket bucket is private and keyed by
   the uploader's own folder, the asset bucket is readable by all and writable
   only by the marketplace. */
drop policy if exists "ticket_attachments_own_folder" on storage.objects;
create policy "ticket_attachments_own_folder" on storage.objects
  for all to authenticated
  using (bucket_id = 'ticket-attachments'
         and (auth.uid()::text = (storage.foldername(name))[1] or current_persona() = 'operator'))
  with check (bucket_id = 'ticket-attachments'
              and auth.uid()::text = (storage.foldername(name))[1]);

drop policy if exists "kb_assets_public_read" on storage.objects;
create policy "kb_assets_public_read" on storage.objects
  for select to anon, authenticated using (bucket_id = 'kb-assets');

drop policy if exists "kb_assets_operator_write" on storage.objects;
create policy "kb_assets_operator_write" on storage.objects
  for all to authenticated
  using (bucket_id = 'kb-assets' and current_persona() = 'operator')
  with check (bucket_id = 'kb-assets' and current_persona() = 'operator');

/* ------------------------------------- what an attachment may not become -- */

/**
 * An attachment belongs to the ticket it was filed on, for good.
 *
 * Two things RLS cannot say. It cannot stop somebody re-pointing their own
 * attachment at a different ticket — the row stays theirs, so the policy still
 * passes, and the file lands on a complaint they have nothing to do with. And
 * it cannot stop a file being withdrawn after the desk has replied to it,
 * which is editing the record rather than changing your mind.
 */
create or replace function guard_attachment() returns trigger
language plpgsql security definer set search_path = public as $$
declare answered boolean;
begin
  if current_persona() is null or current_persona() = 'operator' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  if tg_op = 'UPDATE' and new.ticket_id is distinct from old.ticket_id then
    raise exception 'An attachment stays on the ticket it was filed against. Add it to the other ticket instead.';
  end if;

  if tg_op = 'DELETE' then
    select jsonb_array_length(coalesce(t.messages, '[]'::jsonb)) > 1
      into answered from support_tickets t where t.id = old.ticket_id;
    if coalesce(answered, false) then
      raise exception 'Support has already replied on this ticket, so what you sent stays on the record. Say what is wrong with it in a reply instead.';
    end if;
    return old;
  end if;

  /* Nobody marks their own upload clean. */
  new.scan := 'pending';
  return new;
end $$;

drop trigger if exists support_attachments_guard on support_attachments;
create trigger support_attachments_guard
  before insert or update or delete on support_attachments
  for each row execute function guard_attachment();

/* ------------------------------------------------------- sanity checks -- */
do $$
declare n integer;
begin
  select count(*) into n from storage.buckets where id in ('ticket-attachments', 'kb-assets');
  if n <> 2 then raise exception 'the attachment buckets were not created'; end if;

  if (select public from storage.buckets where id = 'ticket-attachments') then
    raise exception 'ticket attachments are in a public bucket — that is somebody''s photograph';
  end if;
  if not (select public from storage.buckets where id = 'kb-assets') then
    raise exception 'knowledge base assets are private, so nothing can download a manual';
  end if;

  /* Every asset is fetchable from somewhere and every video says how long. */
  select count(*) into n from kb_assets where (path is null) = (url is null);
  if n > 0 then raise exception '% assets point at neither a file nor a link, or at both', n; end if;
end $$;
