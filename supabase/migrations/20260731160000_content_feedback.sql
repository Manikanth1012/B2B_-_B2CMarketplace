-- "Was this helpful?" — feedback on the marketplace's own content.
--
-- Distinct from product reviews, and worth keeping distinct. A review is a
-- buyer's opinion of something a seller sells; this is a reader's opinion of
-- something the marketplace wrote. The first is moderated and published to
-- other shoppers. The second is never published at all — it is a work queue for
-- whoever owns the words, and treating it as a review would put "this page is
-- out of date" on a product page.
--
-- It comes from every persona that reads content: shoppers on the help centre
-- and the storefront copy, sellers on the seller guides, business buyers on the
-- procurement pages. Sellers are the ones nobody usually asks, and they are the
-- ones who read the same six articles until they are fluent — so their
-- complaints are the most specific and the most actionable.

create table if not exists content_feedback (
  id       text primary key,
  /* What was being read. Polymorphic on purpose: an article, a category page
     and a product description are different tables but the same question. */
  surface  text not null check (surface in ('kb_article', 'category', 'product', 'banner', 'page')),
  /* The thing itself — KB-C03, 'security', SKU-4001. Checked below rather than
     by a foreign key, because one column cannot reference four tables. */
  ref      text not null,
  /* What the reader was looking at it as. The same article read by a seller and
     by a shopper gets different complaints, and the fix is usually different. */
  persona  text not null check (persona in ('consumer', 'partner', 'enterprise')),
  author      text not null,
  author_ref  text,
  /* The question everybody asks and almost nobody acts on. */
  helpful  boolean not null,
  /* Why, from a fixed list — free text alone cannot be counted, and a theme
     nobody can count is a theme nobody fixes. */
  reason   text not null check (reason in (
    'out_of_date', 'missing_steps', 'contradicts_screen', 'hard_to_find',
    'too_long', 'wrong_audience', 'clear_and_correct')),
  comment  text,
  submitted date not null,
  /* The operator's side. Feedback that is read and not dispositioned is a
     survey, not a queue. */
  state    text not null default 'new' check (state in ('new', 'triaged', 'actioned', 'declined')),
  reviewed_by text,
  reviewed_at date,
  /* What was actually done about it. "Actioned" with no note is a status
     somebody set to make a number go down. */
  action_taken text,
  sort_order integer not null default 0
);

comment on table content_feedback is
  'Reader feedback on the marketplace''s own words — help articles, category copy, '
  'product descriptions. Never published: it is a work queue for whoever owns the '
  'content, which is what separates it from a product review.';

create index if not exists content_feedback_surface_idx on content_feedback(surface, ref);
create index if not exists content_feedback_state_idx   on content_feedback(state);

/* A helpful verdict pairs with the one positive reason and an unhelpful one
   never does. Without this, "clear and correct" turns up on complaints and the
   theme counts stop meaning anything. */
alter table content_feedback drop constraint if exists content_feedback_verdict_check;
alter table content_feedback add constraint content_feedback_verdict_check
  check ((helpful = true and reason = 'clear_and_correct')
      or (helpful = false and reason <> 'clear_and_correct'));

/* Dispositioned means somebody decided, and a decision has an author. */
alter table content_feedback drop constraint if exists content_feedback_decision_check;
alter table content_feedback add constraint content_feedback_decision_check
  check (state = 'new' or (reviewed_by is not null and reviewed_at is not null));

/* ---------------------------------------------------------------- seed --- */

insert into content_feedback (id, surface, ref, persona, author, author_ref, helpful,
                              reason, comment, submitted, state, reviewed_by, reviewed_at,
                              action_taken, sort_order)
values
  -- Sellers on the seller guides. The most specific complaints on the board,
  -- because these six articles are read until they are memorised.
  ('CF-101', 'kb_article', 'KB-P02', 'partner', 'Katrin Boehm', 'PTR-1004', false,
   'contradicts_screen',
   'The article says the listing form asks for a cost price on step two. It is on step three now, and step two wants the marketplace and the type. I went round twice looking for it.',
   '2026-07-18', 'actioned', 'Content desk', '2026-07-21',
   'Screenshots and step numbers updated to match the six-step form.', 1),

  ('CF-102', 'kb_article', 'KB-P03', 'partner', 'Rajesh Kumar', 'PTR-1004', false,
   'missing_steps',
   'It explains commission and it explains fees, but not the order they come off in. I could not reconcile my first statement against it and had to raise a ticket to find out fees come off after commission.',
   '2026-07-20', 'actioned', 'Content desk', '2026-07-24',
   'Added a worked example showing a $100 sale down to the settled figure, in order.', 2),

  ('CF-103', 'kb_article', 'KB-P07', 'partner', 'Amara Okonkwo', 'PTR-1009', false,
   'missing_steps',
   'Tells me what a rejection means but not what to do next. There is no mention that you can resubmit the same listing, which is the only thing I wanted to know.',
   '2026-07-22', 'triaged', 'Content desk', '2026-07-25', null, 3),

  ('CF-104', 'kb_article', 'KB-P05', 'partner', 'Wei Lin Tan', 'PTR-1001', true,
   'clear_and_correct',
   'The bit about reservations versus on-hand finally made it click. We had been overselling because we were reading available as on-hand.',
   '2026-07-15', 'new', null, null, null, 4),

  ('CF-105', 'kb_article', 'KB-P10', 'partner', 'Sofia Marchetti', 'PTR-1010', false,
   'too_long',
   'Two thousand words on credit notes. I needed one line telling me whether a credit note reduces this month or next month.',
   '2026-07-19', 'triaged', 'Content desk', '2026-07-23', null, 5),

  ('CF-106', 'kb_article', 'KB-P06', 'partner', 'Daniel Osei', 'PTR-1007', false,
   'out_of_date',
   'Still refers to uploading a logo as a PNG at 400x100. The console asked for SVG when I did it last week.',
   '2026-07-24', 'new', null, null, null, 6),

  -- Shoppers on the help centre.
  ('CF-107', 'kb_article', 'KB-C04', 'consumer', 'Priya Raman', 'CUS-449021', false,
   'contradicts_screen',
   'It says a failed payment retries after three days. My retry happened the next morning, which was better, but I had already paid by card because the article told me to wait.',
   '2026-07-21', 'actioned', 'Content desk', '2026-07-26',
   'Corrected to next-day retry and added the actual dunning ladder.', 7),

  ('CF-108', 'kb_article', 'KB-C03', 'consumer', 'Arun Deshpande', 'CUS-449118', false,
   'missing_steps',
   'Covers pausing and cancelling but says nothing about what happens to the rest of the month you already paid for.',
   '2026-07-23', 'triaged', 'Content desk', '2026-07-26', null, 8),

  ('CF-109', 'kb_article', 'KB-C01', 'consumer', 'Meera Krishnan', 'CUS-449204', true,
   'clear_and_correct',
   'Short and it actually matched the screens. Rare.',
   '2026-07-17', 'new', null, null, null, 9),

  ('CF-110', 'kb_article', 'KB-C06', 'consumer', 'Sanya Kapoor', 'CUS-449512', false,
   'hard_to_find',
   'I only found this by searching for the word household. Nothing in the account menu points at it, and that is where you go when you are worried about who can see your account.',
   '2026-07-25', 'new', null, null, null, 10),

  ('CF-111', 'kb_article', 'KB-C05', 'consumer', 'Ravi Menon', 'CUS-449640', false,
   'out_of_date',
   'Says reviews appear straight away. Mine took two days and I thought it had been lost.',
   '2026-07-26', 'actioned', 'Content desk', '2026-07-29',
   'Rewritten to say every review is screened and then read by a person, usually within a working day.', 11),

  -- Business buyers on the procurement pages.
  ('CF-112', 'kb_article', 'KB-B03', 'enterprise', 'Brightline Foods procurement', 'ORG-77120', false,
   'missing_steps',
   'Explains that contract pricing exists. Does not explain who at our end can see it or how we get it applied to a requisition already in flight.',
   '2026-07-14', 'actioned', 'Content desk', '2026-07-20',
   'Added the role requirement and the in-flight requisition path.', 12),

  ('CF-113', 'kb_article', 'KB-B05', 'enterprise', 'Harbourpoint Retail finance', 'ORG-77208', false,
   'wrong_audience',
   'Written for somebody who already knows what a cost centre split is. Our AP clerk does not, and she is the one who opens this page.',
   '2026-07-22', 'triaged', 'Content desk', '2026-07-25', null, 13),

  ('CF-114', 'kb_article', 'KB-B02', 'enterprise', 'Brightline Foods procurement', 'ORG-77120', true,
   'clear_and_correct',
   'The requisition walkthrough is good. We sent it to three new starters instead of training them.',
   '2026-07-11', 'new', null, null, null, 14),

  ('CF-115', 'kb_article', 'KB-B06', 'enterprise', 'Harbourpoint Retail ops', 'ORG-77208', false,
   'contradicts_screen',
   'Says to use Track Order from the account menu. There is no Track Order in our account menu, only in the footer.',
   '2026-07-27', 'new', null, null, null, 15),

  -- Storefront copy rather than help articles. The category blurbs and product
  -- descriptions are content too, and nobody was collecting anything on them.
  ('CF-116', 'category', 'iot', 'enterprise', 'Brightline Foods procurement', 'ORG-77120', false,
   'wrong_audience',
   'The IoT page reads like a brochure for people who already buy IoT. We came here to find out whether pooled data would work across a mixed fleet and had to ask sales.',
   '2026-07-16', 'triaged', 'Content desk', '2026-07-22', null, 16),

  ('CF-117', 'category', 'security', 'partner', 'Omar Haddad', 'PTR-1003', false,
   'out_of_date',
   'The Security marketplace blurb still says attestation is optional. It has been enforced since we onboarded.',
   '2026-07-24', 'actioned', 'Content desk', '2026-07-28',
   'Blurb corrected — attestation is an enforced rule, not a recommendation.', 17),

  ('CF-118', 'category', 'consumer', 'consumer', 'Lotte Bakker', 'CUS-449771', true,
   'clear_and_correct',
   'Clear about what is a plan and what is an add-on, which is more than my last operator managed.',
   '2026-07-12', 'new', null, null, null, 18),

  ('CF-119', 'product', 'SKU-5003', 'enterprise', 'Brightline Foods procurement', 'ORG-77120', false,
   'missing_steps',
   'The cold-chain sensor description does not say what it reports over, or how often. We had to open the specification table to find NB-IoT and fifteen minutes, and most people will not.',
   '2026-07-19', 'triaged', 'Content desk', '2026-07-24', null, 19),

  ('CF-120', 'product', 'SKU-2001', 'consumer', 'Daniel Osei', 'CUS-449377', false,
   'contradicts_screen',
   'Description says activates in about two minutes. Mine took closer to twenty and I thought something had gone wrong.',
   '2026-07-25', 'new', null, null, null, 20),

  ('CF-121', 'product', 'SKU-6001', 'partner', 'Omar Haddad', 'PTR-1003', false,
   'out_of_date',
   'This is our own listing and the throughput figure is a generation behind. We updated it in the console and the storefront still shows the old one.',
   '2026-07-26', 'declined', 'Content desk', '2026-07-29',
   'Not a content defect — the listing edit was never submitted for review. Seller told how to resubmit.', 21),

  ('CF-122', 'banner', 'bn-003', 'consumer', 'Arun Deshpande', 'CUS-449118', false,
   'contradicts_screen',
   'The banner said K9 Pro now in stock. It was out of stock when I clicked through.',
   '2026-07-23', 'actioned', 'Content desk', '2026-07-27',
   'Banner now points at the product rather than the category, so stock state is visible before the click.', 22),

  ('CF-123', 'page', 'checkout', 'consumer', 'Priya Raman', 'CUS-449021', false,
   'missing_steps',
   'Nothing at checkout explains that wallet credit is used before card. I only worked it out from the statement afterwards.',
   '2026-07-28', 'new', null, null, null, 23),

  ('CF-124', 'page', 'settlement', 'partner', 'Katrin Boehm', 'PTR-1004', false,
   'hard_to_find',
   'The explanation of what a held settlement means is three clicks away from the settlement page it applies to.',
   '2026-07-27', 'new', null, null, null, 24),

  ('CF-125', 'kb_article', 'KB-P09', 'partner', 'Sofia Marchetti', 'PTR-1010', true,
   'clear_and_correct',
   'Refund decision guide is genuinely useful. The worked examples are what made it usable.',
   '2026-07-13', 'new', null, null, null, 25),

  ('CF-126', 'kb_article', 'KB-C02', 'consumer', 'Meera Krishnan', 'CUS-449204', false,
   'too_long',
   'I wanted to know how to compare two plans side by side. That is one sentence in the middle of nine paragraphs.',
   '2026-07-24', 'new', null, null, null, 26)
on conflict (id) do update set
  comment = excluded.comment, state = excluded.state, reason = excluded.reason,
  helpful = excluded.helpful, action_taken = excluded.action_taken,
  reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at;

/* ------------------------------------------------------------------ RLS -- */

alter table content_feedback enable row level security;

drop policy if exists "operator_all_content_feedback" on content_feedback;
drop policy if exists "auth_leave_content_feedback"   on content_feedback;
drop policy if exists "owner_read_content_feedback"   on content_feedback;

/* The operator reads and dispositions all of it — it is a queue for whoever
   owns the words. */
create policy "operator_all_content_feedback" on content_feedback
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* Anyone signed in may leave it, and only as new — a reader cannot mark their
   own complaint actioned. */
create policy "auth_leave_content_feedback" on content_feedback
  for insert to authenticated
  with check (state = 'new' and reviewed_by is null and reviewed_at is null);

/* ------------------------------------------------------------ assertions - */

do $$
declare bad text; n integer;
begin
  select count(*) into n from content_feedback;
  if n <> 26 then raise exception 'expected 26 pieces of content feedback, found %', n; end if;

  -- Every persona that reads content is represented, or the demo shows a
  -- one-sided board.
  select count(distinct persona) into n from content_feedback;
  if n <> 3 then
    raise exception 'content feedback is missing a persona — found % of 3', n;
  end if;

  -- Sellers in particular: they are the ones nobody usually asks.
  select count(*) into n from content_feedback where persona = 'partner';
  if n < 5 then
    raise exception 'only % pieces of seller feedback — not enough to show the seller view', n;
  end if;

  -- Every reference points at something that exists. A polymorphic column
  -- cannot carry a foreign key, so it is checked here instead of not at all.
  select string_agg(f.id || ' -> ' || f.surface || ':' || f.ref, ', ') into bad
  from content_feedback f
  where (f.surface = 'kb_article' and not exists (select 1 from kb_articles a where a.id = f.ref))
     or (f.surface = 'category'   and not exists (select 1 from categories c where c.id = f.ref))
     or (f.surface = 'product'    and not exists (select 1 from products p where p.id = f.ref))
     or (f.surface = 'banner'     and not exists (select 1 from operator_banners b where b.id = f.ref));
  if bad is not null then
    raise exception 'content feedback points at something that does not exist: %', bad;
  end if;

  -- Anything dispositioned as actioned says what was done. "Actioned" with no
  -- note is a status somebody set to make a number go down.
  select string_agg(id, ', ') into bad from content_feedback
  where state in ('actioned', 'declined') and (action_taken is null or btrim(action_taken) = '');
  if bad is not null then
    raise exception 'feedback closed with no account of what was done: %', bad;
  end if;

  -- And there is genuinely something left to do, or the queue demonstrates
  -- nothing.
  select count(*) into n from content_feedback where state = 'new';
  if n < 5 then
    raise exception 'only % new items — the queue has nothing to work', n;
  end if;
end $$;
