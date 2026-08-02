-- Who an article is written for, and the questions people actually ask.
--
-- Two problems, and the second is the one the operator kept hitting.
--
-- An article belonged to exactly one persona. "How a refund works" is the same
-- article for a retail customer and a business buyer, and the only way to have
-- it appear for both was to write it twice — which is how two copies of one
-- policy drift apart, and how the copy nobody remembers to update becomes the
-- one somebody reads. Audience is a set, not a field.
--
-- And there were no FAQs. An article is four hundred words with a title, a
-- summary and a reading time; a frequently asked question is one sentence and
-- its answer. Filing the second as the first produces a page of four-hundred-
-- word articles called "Can I change my plan mid-month?" — so they are their
-- own table, with their own tab.
--
-- The operator could also read all of this and change none of it. There was no
-- authoring path at all: the knowledge base was seeded and then frozen.

/* ================================ an article can be for more than one === */

alter table kb_articles add column if not exists personas text[] not null default '{}';

/* Backfill from the single column before anything reads the new one. */
update kb_articles set personas = array[persona] where personas = '{}';

/* Two of these genuinely are the same article for two audiences, and were
   written once each because there was nowhere to say so. Widened rather than
   duplicated, which is the whole point of the column. */
update kb_articles set personas = array['consumer', 'enterprise']
 where id in ('KB-C04')                 -- A payment failed
   and 'consumer' = any (personas);

alter table kb_articles add column if not exists audience_note text not null default '';

/* `persona` stays as the article's home — which console it was written from and
   where it sorts — but it is no longer what a reader is matched on. Keeping it
   readable and unauthoritative is deliberate: dropping it would rewrite every
   seed and every contextual-help lookup for no gain, and leaving it
   authoritative would be two answers to one question. */
comment on column kb_articles.persona is
  'The console this article was written for. Not the audience — see personas.';
comment on column kb_articles.personas is
  'Every persona this article is published to. This is what a reader is matched on.';

/* ============================================================== FAQs ==== */

create table if not exists kb_faqs (
  id        text primary key,
  question  text not null,
  answer    text not null,
  /* Same set-not-field rule. "Where do I find my invoice?" is a question a
     retail customer and a business buyer both ask, and the answer differs by a
     sentence rather than by a document. */
  personas  text[] not null default '{}',
  topic     text not null default 'General',
  status    text not null default 'published' check (status in ('published', 'held')),
  /* A question nobody asks is clutter, and a question everybody asks is an
     article waiting to be written. Both are worth knowing. */
  asked     integer not null default 0,
  helpful   integer not null default 0,
  /* Set when the answer is really an article and the FAQ is the doorway. */
  article_id text references kb_articles(id) on delete set null,
  updated   text not null default '',
  updated_by text,
  sort_order integer not null default 0
);

insert into kb_faqs (id, question, answer, personas, topic, article_id, updated, updated_by, asked, helpful, sort_order) values
  /* --- everybody --- */
  ('FAQ-001', 'Where do I find my bill or invoice?',
   'Under Bills on your account. Every document is there from the date it was issued, viewable on screen and downloadable as a file. The two are the same document — what you see is what the file says.',
   array['consumer','enterprise','partner'], 'Billing', null, '01 Aug 2026', 'Anika Sharma', 412, 388, 1),

  ('FAQ-002', 'Why does my bill look different this month?',
   'The marketplace issues bills on a template, and the operator can change which sections appear. Nothing already issued changes when a template does — a bill is a snapshot, not a live render — so a difference between two months is a change made between them.',
   array['consumer','enterprise'], 'Billing', null, '01 Aug 2026', 'Anika Sharma', 96, 71, 2),

  ('FAQ-003', 'What happens if I pay late?',
   'A reminder first, not a suspension. How long you have depends on the account: retail service is not interrupted before day 14, a business account not before day 60, and a seller is never suspended at all. A promise to pay pauses the process where it stands.',
   array['consumer','enterprise','partner'], 'Billing', null, '01 Aug 2026', 'Anika Sharma', 233, 205, 3),

  ('FAQ-004', 'Can I query one line without holding up the whole payment?',
   'Yes, and you should. Raising a query on one line does not suspend the obligation to pay the rest, and paying the rest does not weaken the query.',
   array['consumer','enterprise'], 'Billing', null, '01 Aug 2026', 'Anika Sharma', 61, 58, 4),

  /* --- retail --- */
  ('FAQ-010', 'Can I change my plan in the middle of a month?',
   'Yes. The change takes effect immediately and the next bill is pro-rated across both plans, so you pay for what you actually had.',
   array['consumer'], 'Plans and subscriptions', null, '01 Aug 2026', 'Anika Sharma', 178, 160, 10),

  ('FAQ-011', 'My payment failed. What now?',
   'Most failures are a card that has expired rather than a refusal. Update the card on file and the marketplace re-presents it automatically — no need to pay twice.',
   array['consumer'], 'Payments', 'KB-C04', '01 Aug 2026', 'Anika Sharma', 305, 274, 11),

  ('FAQ-012', 'How long do reward points last?',
   'Twenty-four months from the day they were earned, and the oldest are always spent first. Anything close to expiring is shown on the Rewards page before it goes.',
   array['consumer'], 'Rewards', null, '01 Aug 2026', 'Anika Sharma', 144, 131, 12),

  ('FAQ-013', 'Can I return something I bought here?',
   'Within the window shown on the order. The seller handles the return and the marketplace holds the money until it is resolved, so you are not chasing them for a refund they have already been paid for.',
   array['consumer'], 'Orders and returns', null, '01 Aug 2026', 'Anika Sharma', 267, 240, 13),

  ('FAQ-014', 'Why can I not buy some of the things I can see?',
   'Some listings are sold to business accounts only — bulk packs, per-seat licences, anything priced per site. They appear in search because they exist, and the basket will say so if you try.',
   array['consumer'], 'Shopping', null, '01 Aug 2026', 'Anika Sharma', 52, 44, 14),

  /* --- business --- */
  ('FAQ-020', 'Why does my order need approval?',
   'Because your account sets a threshold and your requisition is over it. Who approves what is on the Approvals screen, and the person who raised a requisition can never be the person who approves it.',
   array['enterprise'], 'Approvals', null, '01 Aug 2026', 'Anika Sharma', 189, 171, 20),

  ('FAQ-021', 'Can I put a purchase order number on an invoice?',
   'Yes, and on most business accounts you must — the account is set to require one, and a requisition without a PO reference will not clear approval.',
   array['enterprise'], 'Billing', null, '01 Aug 2026', 'Anika Sharma', 121, 110, 21),

  ('FAQ-022', 'How do I add a whole department at once?',
   'Bulk upload from the Team screen, using the template it offers. Roles are set per person on import, so nobody arrives with more access than they need.',
   /* No article link: KB-B04 covers this and is still a held draft, and a
      published FAQ pointing at an unpublished article is a door to a wall.
      The assertion below caught it. */
   array['enterprise'], 'Users and roles', null, '01 Aug 2026', 'Anika Sharma', 74, 66, 22),

  ('FAQ-023', 'One invoice covers several sellers. Who do I chase?',
   'Us. The marketplace bills you once across every seller and settles each of them separately — that reconciliation is ours, not yours.',
   array['enterprise'], 'Billing', 'KB-B05', '01 Aug 2026', 'Anika Sharma', 88, 84, 23),

  /* --- sellers --- */
  ('FAQ-030', 'When do I get paid?',
   'On the settlement run for the period, once the statement is approved. The statement shows gross, commission, fees and refunds, and the net is what reaches your account.',
   array['partner'], 'Settlement', null, '01 Aug 2026', 'Anika Sharma', 341, 318, 30),

  ('FAQ-031', 'My listing was rejected. What do I do?',
   'Read the decision — it names the rule the listing failed rather than saying no. Fix that and resubmit; the review queue keeps the history, so nobody starts from scratch.',
   array['partner'], 'Listings', null, '01 Aug 2026', 'Anika Sharma', 156, 142, 31),

  ('FAQ-032', 'Can my listings be taken down if I owe the marketplace money?',
   'No. A seller is never suspended, because taking listings down strands buyers who are mid-order. A debt is recovered from the settlement instead.',
   array['partner'], 'Settlement', null, '01 Aug 2026', 'Anika Sharma', 97, 95, 32),

  ('FAQ-033', 'Why can I not list in a category I applied for?',
   'The category has document requirements and one of them is outstanding or expired. The onboarding screen names which, and the category opens by itself once it is satisfied.',
   array['partner'], 'Onboarding', null, '01 Aug 2026', 'Anika Sharma', 112, 99, 33)
on conflict (id) do update set
  question = excluded.question, answer = excluded.answer,
  personas = excluded.personas, topic = excluded.topic;

/* ================================================================= RLS == */

alter table kb_faqs enable row level security;

drop policy if exists "operator_all_kb_faqs" on kb_faqs;
drop policy if exists "read_kb_faqs" on kb_faqs;

create policy "operator_all_kb_faqs" on kb_faqs for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "read_kb_faqs" on kb_faqs for select to anon, authenticated using (true);

/* The operator could read the articles and change none of them. */
drop policy if exists "operator_write_kb_articles" on kb_articles;
create policy "operator_write_kb_articles" on kb_articles for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/**
 * What a published piece may not be.
 *
 * Published to nobody is the one that matters. It reads as live on the
 * operator's list and appears on no reader's screen, which is a withdrawal
 * wearing the costume of a publication — and the author finds out when
 * somebody asks why the article they wrote is missing.
 */
create or replace function guard_kb() returns trigger
language plpgsql security definer set search_path = public as $$
declare bad text;
begin
  if current_persona() is null then return new; end if;

  if new.status = 'published' and coalesce(array_length(new.personas, 1), 0) = 0 then
    raise exception 'This is published to nobody, so nobody can read it. Choose at least one audience, or hold it as a draft instead.';
  end if;

  select string_agg(p, ', ') into bad from unnest(new.personas) p
   where p not in ('consumer', 'enterprise', 'partner', 'operator');
  if bad is not null then
    raise exception '% is not an audience this marketplace has.', bad;
  end if;

  return new;
end $$;

drop trigger if exists kb_articles_guard on kb_articles;
create trigger kb_articles_guard before insert or update on kb_articles
  for each row execute function guard_kb();

drop trigger if exists kb_faqs_guard on kb_faqs;
create trigger kb_faqs_guard before insert or update on kb_faqs
  for each row execute function guard_kb();

/* ------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Nothing published to nobody. */
  select count(*) into n from kb_articles
   where status = 'published' and coalesce(array_length(personas, 1), 0) = 0;
  if n > 0 then raise exception '% published articles are addressed to nobody', n; end if;

  select count(*) into n from kb_faqs
   where status = 'published' and coalesce(array_length(personas, 1), 0) = 0;
  if n > 0 then raise exception '% published FAQs are addressed to nobody', n; end if;

  /* Every article still reaches the audience it used to. Widening is fine;
     losing a reader in a migration about audiences is not. */
  select string_agg(id, ', ') into s from kb_articles where not (persona = any (personas));
  if s is not null then raise exception 'these articles no longer reach their original audience: %', s; end if;

  /* Every reader-facing persona has something to read, and questions to
     browse. An empty tab is worse than no tab. */
  foreach s in array array['consumer', 'enterprise', 'partner'] loop
    select count(*) into n from kb_articles where status = 'published' and s = any (personas);
    if n = 0 then raise exception 'the % knowledge base is empty', s; end if;
    select count(*) into n from kb_faqs where status = 'published' and s = any (personas);
    if n = 0 then raise exception 'the % FAQ tab is empty', s; end if;
  end loop;

  /* A FAQ that points at an article points at one the same reader can open. */
  select string_agg(f.id, ', ') into s
    from kb_faqs f join kb_articles a on a.id = f.article_id
   where f.status = 'published'
     and not (f.personas && a.personas);
  if s is not null then
    raise exception 'these FAQs link to an article their own readers cannot open: %', s;
  end if;

  /* And an article a FAQ points at is not a draft. */
  select string_agg(f.id, ', ') into s
    from kb_faqs f join kb_articles a on a.id = f.article_id
   where f.status = 'published' and a.status <> 'published';
  if s is not null then
    raise exception 'these published FAQs link to a held article: %', s;
  end if;

  /* The one article deliberately widened is widened. */
  if not (select 'enterprise' = any (personas) and 'consumer' = any (personas)
            from kb_articles where id = 'KB-C04') then
    raise exception 'the payment-failure article did not widen to both audiences';
  end if;
end $$;
