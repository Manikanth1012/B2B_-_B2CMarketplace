/* The Accounts screen, explained.
 *
 * `helpCoverage.integration.test.ts` fails a screen that ships without an
 * article, which is exactly what it is for — it caught `pt-wholesale` the same
 * way. The screen and its explanation arrive together or the check goes red.
 *
 * KB-O39: the next free number in the operator set, checked rather than
 * assumed. The last time I took "the next one that looked free" I overwrote the
 * partner onboarding article and only found out because the coverage check
 * started reporting a different screen.
 */

do $$
declare taken boolean;
begin
  select exists (select 1 from public.kb_articles where id = 'KB-O39') into taken;
  if taken then
    raise exception 'KB-O39 already exists. Pick a free id rather than replacing somebody else''s article.';
  end if;
end $$;

insert into public.kb_articles
  (id, persona, kind, title, mins, updated, view, roles, tags, summary,
   body, status, sort_order, personas, audience_note, audience_ids)
values (
  'KB-O39', 'operator', 'howto', 'Reading the customer book', 4, '10 Aug 2026', 'op-accounts',
  array['OP-ADMIN', 'OP-FINANCE'], array['accounts', 'onboarding', 'credit'],
  'Who buys from this marketplace, how far through onboarding each company is, and where the decisions are made.',
  jsonb_build_array(
    jsonb_build_object('kind', 'prose', 'heading', 'Two kinds of customer',
      'text', 'Companies buy on account, against terms and a credit limit, and pass six onboarding steps before they can. People buy at the storefront and pass none. Both are on this screen because "who are our customers" is one question, and it had no answer here at all before.'),
    jsonb_build_object('kind', 'prose', 'heading', 'The order the list is in',
      'text', 'Whoever needs something doing about them, first: anything overdue, then anything part-way through, then everybody else alphabetically. A directory sorted by name is a directory you have to read all of to find the work in it.'),
    jsonb_build_object('kind', 'prose', 'heading', 'The six steps',
      'text', 'Company verification, tax registration, credit assessment, direct debit mandate, purchase order policy, and an annual credit review that opens as a diary entry rather than as something to do now. The credit assessment is ours — filed accounts and two trade references, and its outcome is the limit and the terms the account opens on. Open the Journey to see who did each step and when.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Overdue means the date, not the label',
      'text', 'A step counts as overdue when its date has passed, whatever the row was last marked. A ladder that only goes overdue when somebody marks it overdue never does.'),
    jsonb_build_object('kind', 'prose', 'heading', 'Applications are not accounts',
      'text', 'A company that has applied and not been decided has no account, no gates and nothing to onboard. They are counted here and decided on Onboarding, in the same queue as the seller applications, because it is the same desk doing it. This screen deliberately does not grow a second queue that would drift from the first.'),
    jsonb_build_object('kind', 'prose', 'heading', 'No assessment',
      'text', 'An account trading without a credit assessment is shown in red. It means somebody opened it without the gate that decides its limit, and the limit is what stops an order going out beyond what we are willing to be owed.')
  ),
  'published', 39, array['operator'], '', array[]::text[]
);

do $$
declare n integer;
begin
  select count(*) into n from public.kb_articles
   where view = 'op-accounts' and status = 'published' and 'operator' = any(personas);
  if n = 0 then
    raise exception 'The Accounts screen opens a help dialog with nothing in it.';
  end if;

  /* And nobody else's article moved to make room for it. */
  select count(*) into n from public.kb_articles where view = 'pt-onboarding' and status = 'published';
  if n = 0 then raise exception 'The partner onboarding article went missing again.'; end if;
end $$;
