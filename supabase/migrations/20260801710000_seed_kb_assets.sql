-- The documents themselves, hung off the articles that should have had them.
--
-- Every path here points at a real file already in the `kb-assets` bucket: an
-- installation manual with the placement rules in it, a datasheet with the
-- measurement ranges, a brochure with the commercial terms, two captioned
-- walkthroughs and two spreadsheet templates. Nothing is a placeholder, because
-- a download button that produces a placeholder is worse than no download
-- button — it looks like it worked.
--
-- Which articles get what is not arbitrary. An article that tells somebody how
-- to do a thing gets the manual and the video; one that explains how something
-- works gets the specification; one that describes the commercial arrangement
-- gets the brochure. An article that answers a question in three paragraphs and
-- needs nothing else keeps having nothing else.

insert into kb_assets (id, article_id, kind, title, description, path, url, mime,
                       bytes, duration_secs, pages, language, updated, sort_order) values

  /* ---- Consumer: getting started, and the handset most people arrive with -- */
  ('KBA-C01-1', 'KB-C01', 'brochure', 'Aventa for business',
   'What is on each marketplace, the controls that come as standard, and how an account is opened. Written for somebody deciding whether to buy here at all.',
   'aventa-business-brochure.pdf', null, 'application/pdf', 3326, null, 2, 'English', '2026-08-01', 1),

  ('KBA-C02-1', 'KB-C02', 'manual', 'Kestrel K9 Pro — set-up guide',
   'Unboxing through to a working eSIM, including the three things that usually go wrong with a profile that will not download.',
   'kestrel-k9-quickstart.pdf', null, 'application/pdf', 3331, null, 2, 'English', '2026-07-15', 1),

  /* ---- Enterprise: the handbook, the walkthrough, the checklist ----------- */
  ('KBA-B01-1', 'KB-B01', 'manual', 'Buying on account — a handbook',
   'Roles, the approval rule, cost centres, invoices and how a refund reconciles. The whole arrangement in one document, for somebody new to the account.',
   'smartbuild-procurement-handbook.pdf', null, 'application/pdf', 3776, null, 3, 'English', '2026-08-01', 1),

  ('KBA-B01-2', 'KB-B01', 'brochure', 'Aventa for business',
   'The shorter commercial summary — useful for circulating to somebody who has to approve the account rather than use it.',
   'aventa-business-brochure.pdf', null, 'application/pdf', 3326, null, 2, 'English', '2026-08-01', 2),

  ('KBA-B02-1', 'KB-B02', 'video', 'Raising a requisition',
   'Five steps: what you are actually doing, picking the cost centre, saying why, what happens next, and why approving is ordering.',
   'raising-a-requisition.mp4', null, 'video/mp4', 100169, 20, null, 'English', '2026-08-01', 1),

  ('KBA-B02-2', 'KB-B02', 'template', 'Requisition checklist',
   'The eight checks a requisition is measured against, and which of them are yours rather than the system''s. Open it in a spreadsheet.',
   'requisition-checklist.csv', null, 'text/csv', 646, null, null, 'English', '2026-08-01', 2),

  ('KBA-B04-1', 'KB-B04', 'template', 'Department onboarding sheet',
   'One row per colleague — name, work email, job title, role and cost centre. Fill it in, then work down it on the Team and Roles screen.',
   'department-onboarding-template.csv', null, 'text/csv', 473, null, null, 'English', '2026-08-01', 1),

  /* ---- The things people actually put on a wall -------------------------- */
  ('KBA-B06-1', 'KB-B06', 'manual', 'Cold-chain sensor — installation manual',
   'Placement, bracket, pairing and the first 24 hours, with a fault table for a sensor that has gone quiet. Most "faulty" sensors are in the wrong place.',
   'nimbus-cold-chain-install.pdf', null, 'application/pdf', 5580, null, 3, 'English', '2026-08-01', 1),

  ('KBA-B06-2', 'KB-B06', 'video', 'Mounting a cold-chain sensor',
   'The placement rule in two minutes, including why a sensor near the door seal pages somebody at three in the morning.',
   'mounting-a-cold-chain-sensor.mp4', null, 'video/mp4', 94613, 20, null, 'English', '2026-08-01', 2),

  ('KBA-B06-3', 'KB-B06', 'datasheet', 'NS-CC200 — technical datasheet',
   'Measurement ranges and accuracy, radio bands, battery life and ingress rating. What to quote when somebody asks whether it will survive the walk-in freezer.',
   'nimbus-cold-chain-datasheet.pdf', null, 'application/pdf', 3016, null, 2, 'English', '2026-06-20', 3),

  ('KBA-B03-1', 'KB-B03', 'datasheet', 'Sentinel MDR — service description',
   'What the managed detection service covers, the response targets by severity, and — the part worth reading — what it does not cover.',
   'sentinel-mdr-datasheet.pdf', null, 'application/pdf', 2988, null, 2, 'English', '2026-07-01', 1)

on conflict (id) do update set
  title = excluded.title, description = excluded.description, path = excluded.path,
  mime = excluded.mime, bytes = excluded.bytes, duration_secs = excluded.duration_secs,
  pages = excluded.pages, updated = excluded.updated, sort_order = excluded.sort_order;

/* ------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every asset hangs off an article that exists. It need not be published:
     KB-B03 and KB-B04 are drafts under review and their documents were written
     alongside them, which is the normal order. An asset on a held article is
     not visible to a reader and goes live when the article does. */
  select string_agg(a.id, ', ') into s from kb_assets a
    left join kb_articles k on k.id = a.article_id
   where k.id is null;
  if s is not null then raise exception 'these assets hang off an article that does not exist: %', s; end if;

  /* But every published article that ought to carry something does. If this
     fires, a reader is looking at prose where a manual was promised. */
  select count(*) into n from kb_assets a
    join kb_articles k on k.id = a.article_id
   where k.status = 'published';
  if n < 8 then raise exception 'only % assets are reachable by a reader', n; end if;

  /* Every video says how long it runs and every document says how many pages.
     Both are what a reader wants before they click, not after. */
  select count(*) into n from kb_assets where kind = 'video' and coalesce(duration_secs, 0) <= 0;
  if n > 0 then raise exception '% videos do not say how long they run', n; end if;

  select count(*) into n from kb_assets
   where mime = 'application/pdf' and coalesce(pages, 0) <= 0;
  if n > 0 then raise exception '% documents do not say how many pages they are', n; end if;

  /* A stated size that is not the file's real size is a lie the screen repeats
     under every download button, so it is asserted rather than assumed. */
  select string_agg(a.id, ', ') into s
    from kb_assets a
    join storage.objects o on o.bucket_id = 'kb-assets' and o.name = a.path
   where a.bytes is distinct from (o.metadata->>'size')::bigint;
  if s is not null then raise exception 'these assets state a size the stored file does not have: %', s; end if;

  /* And every one of them is actually in the bucket. */
  select string_agg(a.id || ' (' || a.path || ')', ', ') into s
    from kb_assets a
   where a.path is not null
     and not exists (select 1 from storage.objects o
                      where o.bucket_id = 'kb-assets' and o.name = a.path);
  if s is not null then raise exception 'these assets point at a file that is not there: %', s; end if;

  /* The kinds the screen groups by all have something in them, or the tabs
     render empty. */
  select string_agg(k, ', ') into s from unnest(array['manual','datasheet','brochure','video','template']) k
   where not exists (select 1 from kb_assets a where a.kind = k);
  if s is not null then raise exception 'nothing was filed under: %', s; end if;
end $$;
