/* Help for the order register.
 *
 * Ids computed rather than typed. Twice now a hardcoded `KB-O24`/`KB-P11` has
 * silently replaced an article that was already there, so the rule is: take the
 * next free number in that persona's series and fail loudly if it is somehow
 * occupied.
 */

do $$
declare op_id text;
begin
  select 'KB-O' || (coalesce(max(substring(id from 'KB-O(\d+)')::int), 0) + 1)
    into op_id from public.kb_articles where id ~ '^KB-O\d+$';

  if exists (select 1 from public.kb_articles where id = op_id) then
    raise exception 'the next free id is not free: %', op_id;
  end if;
  if exists (select 1 from public.kb_articles where view = 'op-orders') then
    raise notice 'the order register article is already in place';
    return;
  end if;

  insert into public.kb_articles
    (id, persona, personas, kind, title, mins, updated, view, roles, tags, summary, body, status, sort_order)
  values
    (op_id, 'operator', array['operator'], 'howto',
     'Working somebody else''s order', 6, current_date, 'op-orders',
     array['OR-ADMIN', 'OR-SUPPORT'], array['orders', 'fulfilment', 'support'],
     'What the marketplace may and may not change on an order, how the exception queue is ranked, and why the last step is sometimes refused.',
     jsonb_build_array(
       jsonb_build_array(
         'What this screen is for',
         'Every persona could see its own orders and nobody could see all of them. A buyer rings up with a reference, a seller says the marketplace never sent theirs, a business account says they were charged twice — and there was nowhere those three accounts of the same order could be put beside each other. This is that place, and it is the only screen in the console that reads the whole order book.'),
       jsonb_build_array(
         'What you may change, and what you may not',
         'You may move an order along its ladder, fail it, reverse a failure, and record where the parcel is. You may not change what it cost, what tax it carried, what currency it was in, who bought it, or what payment it was taken on. Those were agreed at checkout and the way to change them is a refund — an order rewritten after the fact is a receipt that no longer matches the money.'),
       jsonb_build_array(
         'Why the queue is ranked the way it is',
         'Not by age. An order sitting in "processing" for nine days is slow, and slow is a chase. An order showing "Delivered" to the customer while the network has not provisioned is *wrong*, and somebody has already been told something untrue. Anything untrue comes above everything slow, however old the slow one is.'),
       jsonb_build_array(
         'Why the last step is sometimes refused',
         'The final stage on a ladder is the one that tells the customer their service is live. While a line is still queued, sent, unacknowledged or being provisioned with the order manager, that step is refused — by this screen, with the reason on the button, and by the database, so it stays refused however the write arrives. The steps before it are not blocked: packed and in transit are true whatever the network is doing.'),
       jsonb_build_array(
         'Failing an order',
         'You have to say what went wrong. "Failed" on its own leaves the customer with a dead order and support with nothing to tell them, and the database will not accept it. Reversing a failure keeps the reason: a failure that was investigated and put right is still worth being able to read about.'),
       jsonb_build_array(
         'Reading the money on an order',
         'Line prices are what the buyer was quoted — tax included — so the lines sum to what was charged before any order-level discount, not to the subtotal. If a line column adds up to the total rather than the subtotal, that is correct. An order where it adds up to neither is on the exception queue, because one of the two figures is wrong and the customer has already paid one of them.'),
       jsonb_build_array(
         'Searching',
         'One box. A caller does not know which field they are holding, so it matches the reference, the buyer''s name or email, the seller, the business account, the requisition, the purchase order, the cost centre, the tracking reference and the name of the thing they bought.')
     ),
     'published', 18);

  raise notice 'order register article %', op_id;
end $$;

do $$
declare n int; bad text;
begin
  select count(*) into n from public.kb_articles
   where view = 'op-orders' and status = 'published' and jsonb_array_length(body) >= 5;
  if n <> 1 then raise exception 'the order register has no usable article'; end if;

  /* Nothing was overwritten on the way in — the check that caught the last two. */
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
