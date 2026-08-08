/* Help for the note screen, and the seller's side of it.
 *
 * Two things a credit note model is not finished without.
 *
 * The article, because the last screen shipped without one and the coverage
 * check found it inside an hour. Adding it with the screen rather than after it
 * is cheaper and is the actual policy.
 *
 * And the seller's own view. A note is raised against somebody: they are the
 * one whose payout changes, they are the one who disputes it, and a model where
 * the marketplace can see all of it and the seller can see none of it is not an
 * adjustment process, it is a deduction. The row policies for that already
 * exist — what was missing is an article telling the seller what they are
 * looking at and what they can do about it.
 *
 * The ids are computed rather than typed. Two migrations ago a hardcoded
 * `KB-O24` silently replaced the Refunds article, and the first draft of this
 * one reached for `KB-P11`, which is "Chasing your own customers". Twice is a
 * pattern, and the fix is to stop guessing: take the next free number in that
 * persona's series and fail loudly if it is somehow occupied.
 */

do $$
declare op_id text; pt_id text;
begin
  select 'KB-O' || (coalesce(max(substring(id from 'KB-O(\d+)')::int), 0) + 1)
    into op_id from public.kb_articles where id ~ '^KB-O\d+$';
  select 'KB-P' || (coalesce(max(substring(id from 'KB-P(\d+)')::int), 0) + 1)
    into pt_id from public.kb_articles where id ~ '^KB-P\d+$';

  if exists (select 1 from public.kb_articles where id in (op_id, pt_id)) then
    raise exception 'the next free ids are not free: %, %', op_id, pt_id;
  end if;

  /* Computed ids mean re-running would mint a second copy rather than collide,
     which is a quieter failure than the one this replaced. Keyed on what the
     articles are rather than what they are called. */
  if exists (select 1 from public.kb_articles where view = 'op-notes') then
    raise notice 'the note articles are already in place';
    return;
  end if;

insert into public.kb_articles
  (id, persona, personas, kind, title, mins, updated, view, roles, tags, summary, body, status, sort_order)
values
  (op_id, 'operator', array['operator'], 'howto',
   'Raise a credit or debit note', 5, current_date, 'op-notes',
   array['OR-ADMIN', 'OR-FIN'], array['settlement', 'money', 'policy'],
   'How to pay a seller differently without misstating what the sale was, and who has to sign for it.',
   jsonb_build_array(
     jsonb_build_array(
       'Why a note rather than an adjustment',
       'A statement is derived from trade. When the marketplace owes a seller something that is not about a sale — commission charged at the wrong rate, a promotion we agreed to fund, a fee billed twice, a penalty in the contract — there is nowhere on the statement to put it. Adjusting the commission rate makes the seller''s own reconciliation fail against a rate nobody changed. Netting it into fees makes it something they cannot query, appeal or reverse. A note is a document: a reason, evidence, a signature and a right of appeal.'),
     jsonb_build_array(
       'It does not move money',
       'Raising a note changes what the next settlement run pays or collects. Nothing leaves until that run, which is why a note has to be raised before the run closes, and why an issued note shows on this screen as committed and not yet settled.'),
     jsonb_build_array(
       'What a signature is worth is the threshold''s answer, not yours',
       'Under the auto-approval floor a note needs nobody. Above it, one approver. At or above the ceiling, two — and all three people have to be different. You cannot approve a note you raised, and the person who gave the first signature cannot give the second. The buttons are disabled with the reason on them rather than failing when you press them.'),
     jsonb_build_array(
       'Evidence and references are not paperwork',
       'A chargeback without an order reference is an assertion. An SLA penalty without the contract clause is a number the seller has no way to check, and it comes straight back as a dispute. The form asks for whatever the reason you picked demands, in that reason''s own words.'),
     jsonb_build_array(
       'Credit or debit',
       'A credit pays the seller more; a debit recovers from them. The amount is always positive and the direction is the kind — so read the sign on the screen rather than the number in your head.'),
     jsonb_build_array(
       'Voiding, and when you cannot',
       'A note that has not settled can be voided inside the window, with a reason, and it is kept either way. Once it has landed on a statement it cannot be voided — reverse it with a note the other way, so both movements are on the record.'),
     jsonb_build_array(
       'When the seller disputes one',
       'It stops settling immediately and stays out of every run until it is resolved. That is deliberate: a seller who is being charged something they say is wrong should not have it taken while the argument is open.')
   ),
   'published', 34),

  (pt_id, 'partner', array['partner'], 'concept',
   'Credit and debit notes on your statement', 4, current_date, null,
   array['PR-OWNER', 'PR-FIN'], array['settlement', 'money'],
   'What a note is, why it is not part of the commission line, and how to challenge one.',
   jsonb_build_array(
     jsonb_build_array(
       'What it is',
       'An adjustment the marketplace has made to what you are paid, which is not about a sale. A credit note pays you more; a debit note recovers from you. It appears on your statement as its own line with its own reason, rather than being folded into commission or fees.'),
     jsonb_build_array(
       'Why it is separate',
       'So that your own reconciliation still works. If we corrected a commission error by changing the rate on the statement, your figures would disagree with your contract and you would have no way to tell a correction from a rate change. The commission line always says what was charged; the note says what was put right.'),
     jsonb_build_array(
       'When it affects your payout',
       'At your next settlement run. A note you can see but which has not settled yet is one the marketplace has committed to and not paid; it will appear on the next statement for your cycle.'),
     jsonb_build_array(
       'If you think it is wrong',
       'Dispute it, and say why. It stops settling straight away and stays out of every run until it is resolved — nothing is taken from you while the argument is open. A dispute with no reason cannot be investigated, so name the order, the period or the clause you are relying on.'),
     jsonb_build_array(
       'What you cannot do',
       'Change what a note says. Disputing it flags it and records your reason; the amount, the direction and the reason on it stay as raised, so there is one version of the document and both of us are arguing about the same thing.')
   ),
   'published', 25);

  raise notice 'operator article %, partner article %', op_id, pt_id;
end $$;

do $$
declare n int; bad text;
begin
  select count(*) into n from public.kb_articles
   where view = 'op-notes' and status = 'published' and jsonb_array_length(body) >= 5;
  if n <> 1 then raise exception 'the notes screen has no usable article'; end if;

  /* Both sides. A model the seller cannot read about is a deduction. */
  select count(*) into n from public.kb_articles
   where persona = 'partner' and status = 'published'
     and title = 'Credit and debit notes on your statement';
  if n <> 1 then raise exception 'the seller has nothing to read about notes raised against them'; end if;

  /* And nothing was overwritten on the way in. */
  select count(*) into n from public.kb_articles where id = 'KB-P11' and title = 'Chasing your own customers';
  if n <> 1 then raise exception 'KB-P11 is no longer the article it was'; end if;
  select count(*) into n from public.kb_articles where id = 'KB-O24' and title = 'Refunds';
  if n <> 1 then raise exception 'KB-O24 is no longer the refunds article'; end if;

  /* A screen may genuinely have more than one article worth reading — the
   * consumer account screen carries both "a payment failed" and "who else can
   * get into this account", and neither is wrong. `articleForView` takes the
   * lowest `sort_order`, so what matters is not that the pairs exist but that
   * the tiebreak decides: two published articles for one screen sharing a
   * sort_order would resolve to whichever the planner returned first.
   *
   * The first draft of this assertion demanded one article per screen and
   * failed on two pairs that have been correct since the knowledge base was
   * seeded. The check was wrong, not the data. */
  select string_agg(x.persona || '/' || x.view || ' at ' || x.sort_order, '; ') into bad from (
    select persona, view, sort_order from public.kb_articles
     where view is not null and status = 'published'
     group by persona, view, sort_order having count(*) > 1
  ) x;
  if bad is not null then
    raise exception 'help articles that resolve arbitrarily, sharing a sort order: %', bad;
  end if;

  raise notice 'articles: % operator, % partner',
    (select count(*) from public.kb_articles where persona = 'operator' and status = 'published'),
    (select count(*) from public.kb_articles where persona = 'partner' and status = 'published');
end $$;
