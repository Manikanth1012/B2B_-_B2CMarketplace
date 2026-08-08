/* Help for the dispute desk.
 *
 * Ids computed rather than typed, for the third time and the same reason: a
 * hardcoded `KB-O24` once silently replaced the Refunds article.
 */

do $$
declare op_id text;
begin
  select 'KB-O' || (coalesce(max(substring(id from 'KB-O(\d+)')::int), 0) + 1)
    into op_id from public.kb_articles where id ~ '^KB-O\d+$';

  if exists (select 1 from public.kb_articles where id = op_id) then
    raise exception 'the next free id is not free: %', op_id;
  end if;
  if exists (select 1 from public.kb_articles where view = 'op-disputes') then
    raise notice 'the dispute article is already in place';
    return;
  end if;

  insert into public.kb_articles
    (id, persona, personas, kind, title, mins, updated, view, roles, tags, summary, body, status, sort_order)
  values
    (op_id, 'operator', array['operator'], 'howto',
     'Working a dispute', 6, current_date, 'op-disputes',
     array['OR-ADMIN', 'OR-FIN', 'OR-SUPPORT'], array['disputes', 'money', 'settlement'],
     'The four kinds, why the queue is ordered on who is not being paid, and what deciding one actually does at the source.',
     jsonb_build_array(
       jsonb_build_array(
         'A dispute is not a ticket',
         'A ticket is a question, and the worst case is that somebody is annoyed. A dispute holds money — somebody is not being paid, or has paid for something they say they did not get — and it has a clock on it. They are ranked completely differently, which is why they are two screens: put them together and every question starts to look like a claim.'),
       jsonb_build_array(
         'Four kinds, and who is arguing with whom',
         'An ORDER dispute is a buyer against a seller and we hold the ring. An INVOICE dispute is an account against us — we are the ones being disputed, not refereeing. A STATEMENT dispute is a seller saying we have got their payout wrong. An ADJUSTMENT dispute is a seller challenging a credit or debit note we raised on them. The last three are all arguments with the marketplace, so the marketplace owns the answer by default.'),
       jsonb_build_array(
         'Why the queue is ordered the way it is',
         'On who is out of pocket while it runs — not on age and not on amount. A seller whose settlement statement is disputed is being paid nothing at all until somebody decides. An account disputing an invoice is holding its own money: uncomfortable, not bleeding. An order dispute we own means we are sitting on the seller''s money, and that one is the one people forget. Anybody unpaid comes above anybody merely late.'),
       jsonb_build_array(
         'The clock',
         'Every open case has a date somebody promised. It moves when you hand the case on — to the seller, back to us, or to the buyer — and the days differ because what each of them has to do differs. A case with no date is one nobody can be late on, which is how a dispute sits for a year.'),
       jsonb_build_array(
         'Deciding one, and what it does at the source',
         'Closing a case releases whatever was being held. An invoice goes back to payable — settling the argument is not the same as settling the invoice, and the balance is unchanged. A statement stops being disputed and can be approved and paid on its cycle. An adjustment is the one to read carefully: if the seller wins it is voided with your resolution as the reason, and if they do not it goes back to issued and applies at their next run. The screen tells you which before you press it.'),
       jsonb_build_array(
         'You have to say which way it went, and why',
         'Both are refused without them, here and in the database. Without an outcome nobody can tell who paid — not the seller reading it a month later, and not the next person who gets the same claim from the same buyer. Without an answer, the person who raised it has been filed rather than replied to.'),
       jsonb_build_array(
         'When the case and the source disagree',
         'A red banner at the top means something is marked disputed with no case open on it, or a case is open against something the source no longer thinks is disputed. Either way somebody is looking at one of the two and believing it. That should never appear — the triggers keep them in step — so treat it as a defect rather than as work.')
     ),
     'published', 19);

  raise notice 'dispute desk article %', op_id;
end $$;

do $$
declare n int; bad text;
begin
  select count(*) into n from public.kb_articles
   where view = 'op-disputes' and status = 'published' and jsonb_array_length(body) >= 5;
  if n <> 1 then raise exception 'the dispute desk has no usable article'; end if;

  select count(*) into n from public.kb_articles where id = 'KB-O24' and title = 'Refunds';
  if n <> 1 then raise exception 'KB-O24 is no longer the refunds article'; end if;

  select string_agg(x.persona || '/' || x.view || ' at ' || x.sort_order, '; ') into bad from (
    select persona, view, sort_order from public.kb_articles
     where view is not null and status = 'published'
     group by persona, view, sort_order having count(*) > 1
  ) x;
  if bad is not null then
    raise exception 'help articles that resolve arbitrarily, sharing a sort order: %', bad;
  end if;
end $$;
