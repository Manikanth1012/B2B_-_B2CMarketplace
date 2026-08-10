/* Two screens about who renews what, explained.
 *
 * `helpCoverage.integration.test.ts` reads the screen list out of the union
 * types in `src/types/view.ts` rather than a list kept by hand, so adding
 * `op-renewals` and `pt-renewals` to the app added them to the coverage check
 * in the same commit. A screen ships with its explanation or the check goes red,
 * which is exactly what it is for.
 *
 * KB-O40 and KB-P27: the next free numbers in each set, checked rather than
 * assumed. The last time I took "the next one that looked free" I overwrote the
 * partner onboarding article and only found out because the coverage check
 * started reporting a different screen.
 */

do $$
declare taken text;
begin
  select string_agg(id, ', ') into taken from public.kb_articles where id in ('KB-O40', 'KB-P27');
  if taken is not null then
    raise exception '% already exists. Pick a free id rather than replacing somebody else''s article.', taken;
  end if;
end $$;

/* ---------------------------------------------------------- the operator -- */

insert into public.kb_articles
  (id, persona, kind, title, mins, updated, view, roles, tags, summary,
   body, status, sort_order, personas, audience_note, audience_ids)
values (
  'KB-O40', 'operator', 'howto', 'Running renewals, and chasing the ones you cannot run', 5,
  '10 Aug 2026', 'op-renewals',
  array['OP-ADMIN', 'OP-FINANCE'], array['renewals', 'subscriptions', 'sellers', 'billing'],
  'What the renewal run does, what it deliberately leaves alone, and what to do about a seller who has gone quiet.',
  jsonb_build_array(
    jsonb_build_object('kind', 'image', 'heading', 'The screen this is about',
      'src', 'https://playukebhnkrdrcsorhj.supabase.co/storage/v1/object/public/kb-assets/screens/op-renewals.png',
      'alt', 'The Renewals desk in the operator console, showing the run, the chase list and the cycles raised.',
      'caption', 'Renewals — the operator console.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Two kinds of renewal',
      'text', 'Aventa''s own lines — Freedom, Family Safety, Digital Life, IoT Connect — are billed by the marketplace, so the run raises the cycle and moves the date. Everything a seller sells is renewed by that seller: they take the money on their own system and tell us. The split is who sold it, not who fulfils it, so a telco line resold by a partner is still the partner''s to renew.'),
    jsonb_build_object('kind', 'prose', 'heading', 'What the run will do before you press it',
      'text', 'The four figures above the button are what a run today would raise, how many dates it would move, what it refuses and what is not ours. A button that says "run" and reports afterwards is one nobody presses twice.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Three things it refuses',
      'text', 'A date in the future — a period that has not started has not been used, and charging for it is charging for nothing. A subscription ending before its renewal, which ends rather than renewing. And auto-renew off, which lapses. Every refusal names the subscription and the reason, because "four were skipped" is not something anybody can act on.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Run it twice and nothing happens twice',
      'text', 'One charge per subscription per period, enforced by the table rather than by whoever pressed the button remembering. A second run finds the first run''s charges and reports them as already raised.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Waiting on a vendor',
      'text', 'A seller''s renewal date has come and they have not reported it. The marketplace does not move a date it does not own, so the row sits here until they do — watch under a week, chase at a week, escalate at a month. This list existing at all is the point: the old run rolled those dates itself, so a seller could go quiet for a year and nothing on any screen would have said so.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Recording a report they gave you on a call',
      'text', 'Sellers report their own renewals from their console. Use "Record their report" when one tells us by email or on the phone — you need their own reference for it, so a query later can be traced back to their record, and the row says the marketplace filed it on their behalf rather than pretending they did. It moves the subscription on by exactly one cycle; a seller three cycles behind needs three reports, and the gap stays visible until they are all in.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Nothing here takes money',
      'text', 'A raised cycle waits for the bill covering its period, the same way a wholesale charge waits for its settlement. "On a bill" says which bill carried it, or that it is still waiting for one.'),
    jsonb_build_object('kind', 'video', 'heading', 'Watch it done',
      'url', 'https://player.vimeo.com/video/76979871',
      'caption', 'Walkthrough: running renewals and chasing a seller. Placeholder footage for now — the recorded version replaces it in place.')
  ),
  'published', 40, array['operator'], '', array[]::text[]
);

/* ------------------------------------------------------------ the seller -- */

insert into public.kb_articles
  (id, persona, kind, title, mins, updated, view, roles, tags, summary,
   body, status, sort_order, personas, audience_note, audience_ids)
values (
  'KB-P27', 'partner', 'howto', 'Reporting the renewals that are yours', 4,
  '10 Aug 2026', 'pt-renewals',
  array['PT-ADMIN', 'PT-FINANCE'], array['renewals', 'subscriptions', 'billing'],
  'Your subscriptions renew on your system, not ours. This is where you tell us, one cycle at a time.',
  jsonb_build_array(
    jsonb_build_object('kind', 'image', 'heading', 'The screen this is about',
      'src', 'https://playukebhnkrdrcsorhj.supabase.co/storage/v1/object/public/kb-assets/screens/pt-renewals.png',
      'alt', 'The Renewals page in the seller console, showing outstanding cycles and what has been reported.',
      'caption', 'Renewals — the seller console.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Why this is yours',
      'text', 'A subscription somebody bought from you is renewed by you. You decide whether it runs on, you take the money, and the marketplace holds the record. The marketplace used to move these dates itself, which meant its book claimed renewals you may never have taken. It has stopped: the date only moves when you say it has.'),
    jsonb_build_object('kind', 'prose', 'heading', 'One cycle at a time',
      'text', 'Report the cycle that is due. A later one cannot be reported before it, so nothing is skipped over — if you are three cycles behind, report three times. Until a cycle is in, it stays outstanding here and on the marketplace''s desk, which is what stops a quiet month from disappearing.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Your own reference',
      'text', 'Whatever your system calls the renewal. It is required, because a charge a customer queries in four months has to be traceable back to your record of it and "the seller said so" is not a record.'),
    jsonb_build_object('kind', 'prose', 'heading', 'If the amount changed',
      'text', 'The field is filled with the price on file. Change it if you took something different this cycle — a price rise, a promotional month — and what you report is what the marketplace holds.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Reporting the same cycle twice',
      'text', 'Nothing happens twice. A repeat is answered rather than refused, which matters if you are posting these from your own system and it retries: you get told the cycle was already on file, no second charge is raised and the date does not move again.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Why you cannot see who the customer is',
      'text', 'This page shows the subscription, never the subscriber. Who bought it is the marketplace''s to hold, and what you need to renew it is the reference, the cycle and the price. If you need something done with a customer, raise it under Disputes and support.'),
    jsonb_build_object('kind', 'video', 'heading', 'Watch it done',
      'url', 'https://player.vimeo.com/video/76979871',
      'caption', 'Walkthrough: reporting a renewal. Placeholder footage for now — the recorded version replaces it in place.')
  ),
  'published', 27, array['partner'], '', array[]::text[]
);

/* --------------------------------------------------------------- the check -- */

do $$
declare n integer;
begin
  select count(*) into n from public.kb_articles
   where view = 'op-renewals' and status = 'published' and 'operator' = any(personas);
  if n = 0 then raise exception 'The operator Renewals screen opens a help dialog with nothing in it.'; end if;

  select count(*) into n from public.kb_articles
   where view = 'pt-renewals' and status = 'published' and 'partner' = any(personas);
  if n = 0 then raise exception 'The seller Renewals screen opens a help dialog with nothing in it.'; end if;

  /* And nobody else's article moved to make room for them. */
  select count(*) into n from public.kb_articles where view = 'pt-onboarding' and status = 'published';
  if n = 0 then raise exception 'The partner onboarding article went missing again.'; end if;
  select count(*) into n from public.kb_articles where view = 'op-accounts' and status = 'published';
  if n = 0 then raise exception 'The Accounts article went missing.'; end if;

  /* Both carry a picture of the screen they describe, which is what the media
     pass added to the other ninety-six. */
  select count(*) into n from public.kb_articles
   where id in ('KB-O40', 'KB-P27') and body @> '[{"kind":"image"}]';
  if n <> 2 then raise exception 'A new article shipped without a picture of the screen it is about.'; end if;
end $$;
