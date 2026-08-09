/* Every screen carries a help button, and Wholesale was a new one with nothing
 * behind it.
 *
 * `helpCoverage.integration.test.ts` exists precisely so that shipping a screen
 * without an article fails rather than quietly widening a gap, and it caught
 * this one. The article is here rather than in a seed script because the screen
 * and its explanation arrive together or the check goes red.
 *
 * It is a partner article. Nobody else can reach the screen, and an article
 * published to an audience that cannot see what it describes is noise in three
 * other knowledge bases.
 *
 * KB-P26, not KB-P12. The first draft of this migration took the next number
 * that looked free by reading the highest one in the file that seeded the
 * partner set, and KB-P12 was already the onboarding article — the upsert
 * replaced it, and the coverage check went from reporting one uncovered screen
 * to reporting a different one. The restore below is that article, put back;
 * it is in the block format the body has taken since media blocks landed rather
 * than the heading/text pairs it was originally written in.
 */

insert into public.kb_articles
  (id, persona, kind, title, mins, updated, view, roles, tags, summary,
   body, status, sort_order, personas, audience_note, audience_ids)
values (
  'KB-P26', 'partner', 'concept', 'Buying from Aventa, and how it is paid for',
  4, '10 Aug 2026', 'pt-wholesale',
  array['PR-OWNER', 'PR-FIN'], array['wholesale', 'settlement', 'money'],
  'What the partner shelf is, how a standing order is charged, and why nothing is invoiced.',
  jsonb_build_array(
    jsonb_build_object('kind', 'prose', 'heading', 'What the shelf is',
      'text', 'Aventa sells a small number of products to its partners rather than to the public — wholesale connectivity, a white-label storefront, sandbox access to the partner API. They are priced in dollars, which is the currency your settlement statements are computed in.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Nothing is invoiced',
      'text', 'You are not asked for a card and you do not receive a bill. The marketplace already owes you a settlement each cycle, and what you have taken comes off it. That is also why there is no credit check and no deposit: the charge is secured by the payment it comes out of.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Charged by the calendar month',
      'text', 'One charge per standing order per month, pro-rated for the month you take one and the month you stop it. A storefront taken on the 18th of a 31-day month is charged for 14 days, and the row shows the fraction so you can check it. If you settle quarterly, your statement carries three monthly charges rather than one.'),
    jsonb_build_object('kind', 'prose', 'heading', 'When a period cannot cover it',
      'text', 'A charge only comes off what the period actually earned. If your wholesale is more than that, the balance is not written off and it is not invoiced — it stays outstanding and comes off the next settlement that has room for it. Your Wholesale screen shows what is still to come off, and each charge row shows which statement took what.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Stopping one',
      'text', 'Service runs to the end of the day you stop it and that month is charged to that date. Charges already raised stand — a month you have used is a month you are billed for. Say why: the reason is what gets read back if you query the charge later.'),
    jsonb_build_object('kind', 'prose', 'heading', 'What you cannot take',
      'text', 'Your own listings, because a commission line and a charge line on one statement for one supply nets to something nobody can reconcile; anything the marketplace has not published yet; and anything at all while your account is not live.')
  ),
  'published', 26, array['partner'], '', array[]::text[]
)
on conflict (id) do update set
  title = excluded.title, body = excluded.body, view = excluded.view,
  summary = excluded.summary, personas = excluded.personas,
  status = excluded.status, updated = excluded.updated;

/* Put the onboarding article back. */
insert into public.kb_articles
  (id, persona, kind, title, mins, updated, view, roles, tags, summary,
   body, status, sort_order, personas, audience_note, audience_ids)
values (
  'KB-P12', 'partner', 'start', 'Getting through onboarding', 4, '04 Aug 2026', 'pt-onboarding',
  array['PR-OWNER'], array['onboarding'],
  'The seven gates, what each needs, and what is holding yours up.',
  jsonb_build_array(
    jsonb_build_object('kind', 'prose', 'heading', 'Seven gates, in order',
      'text', 'Each one has to be passed before the next opens. The rail shows where you are and what the next gate wants.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Documents',
      'text', 'Each gate names the documents it needs. An uploaded document is checked by the desk, and a rejection says what was wrong rather than only that it was refused.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Categories',
      'text', 'Some categories need more than the base set — the extra documents appear once you ask for that category.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Five working days',
      'text', 'The published target from a complete submission. Incomplete submissions do not start the clock, which is why the rail shows what is outstanding.')
  ),
  'published', 12, array['partner'], '', array[]::text[]
)
on conflict (id) do update set
  kind = excluded.kind, title = excluded.title, body = excluded.body,
  view = excluded.view, roles = excluded.roles, tags = excluded.tags,
  summary = excluded.summary, personas = excluded.personas,
  status = excluded.status, sort_order = excluded.sort_order,
  updated = excluded.updated;

do $$
declare missing text[];
begin
  select array_agg(v) into missing from unnest(array['pt-wholesale', 'pt-onboarding']) v
   where not exists (
     select 1 from public.kb_articles
      where view = v and status = 'published' and 'partner' = any(personas));
  if missing is not null then
    raise exception 'These screens still open a help dialog with nothing in it: %', missing;
  end if;
end $$;
