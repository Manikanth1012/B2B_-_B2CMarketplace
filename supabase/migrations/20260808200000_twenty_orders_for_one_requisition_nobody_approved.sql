/* Twenty orders for one requisition nobody approved.
 *
 * Looking for something an operator order register would have to show, the
 * order book turned out to be carrying ₹996,000 of one order placed twenty
 * times. Every copy is ENT-2007, REQ-5514, EU-2007-03, "Sentinel MDR — 60
 * additional endpoints", ₹49,800, spread across three days with a random hex
 * suffix on the reference. No other requisition in the book has more than one
 * order against it.
 *
 * And REQ-5514 is `pending`. Nobody approved it. Nothing on the enterprise
 * approvals screen has been decided, and twenty orders went to Sentinel Cyber.
 *
 * WHY IT WAS POSSIBLE
 *
 * `place_requisition_order` is careful. It refuses unless the requisition is
 * approved, and it will not place a second order — but it decides that by
 * asking the requisition:
 *
 *     if req.order_ref is not null and exists (select 1 from orders ...)
 *       then return req.order_ref;
 *
 * `order_ref` is a nullable pointer on the requisition, written at the very end
 * of the function and clearable by anything that touches the row. The moment it
 * is null the guard is inert — and the code immediately below it does not stop,
 * it mints a fresh reference:
 *
 *     while exists (select 1 from orders where order_ref = ref) loop
 *       ref := ... || '-' || substr(md5(clock_timestamp()::text), 1, 3);
 *
 * So a collision on the reference, which is the symptom of the order already
 * existing, was handled by making a different order. The safety check asked the
 * requisition whether it had an order, and the requisition is not the thing that
 * knows. The orders table is.
 *
 * THREE CHANGES
 *
 * The function asks `orders` instead. A partial unique index says the same thing
 * at a level no code path can talk its way around — the check and the constraint
 * are deliberately both here, because a check gives a readable refusal and a
 * constraint makes the refusal true.
 *
 * And the twenty go. Not nineteen: the requisition says pending and no order
 * should exist against it at all. Restoring one would mean inventing an approval
 * and an approver, and REQ-5514 sitting in the queue awaiting a decision is both
 * the honest state and the better demonstration — somebody can approve it and
 * watch exactly one order appear.
 */

/* ---- 1. What is actually there ------------------------------------------------ */

do $$
declare n int; v numeric; st text;
begin
  select count(*), coalesce(sum(total), 0) into n, v
    from public.orders where requisition_id = 'REQ-5514';
  select state into st from public.enterprise_requisitions where id = 'REQ-5514';
  raise notice 'REQ-5514 is % and carries % orders worth %', st, n, v;
end $$;

/* ---- 2. Take them out ---------------------------------------------------------- */

do $$
declare gone int;
begin
  /* Nothing else points at them — no com_order, no refund, no payment attempt,
     no settlement line, no stock unit, no number. Checked before writing this;
     the assertion below checks it again at run time rather than trusting the
     note. */
  if exists (
    select 1 from public.com_order where order_ref in (
      select order_ref from public.orders where requisition_id = 'REQ-5514')
    union all
    select 1 from public.refunds where order_ref in (
      select order_ref from public.orders where requisition_id = 'REQ-5514')
    union all
    select 1 from public.settlement_lines where order_ref in (
      select order_ref from public.orders where requisition_id = 'REQ-5514')
    union all
    select 1 from public.payment_attempts where order_ref in (
      select order_ref from public.orders where requisition_id = 'REQ-5514')
  ) then
    raise exception 'something downstream depends on these orders — deleting them would orphan it';
  end if;

  delete from public.order_items where order_id in (
    select id from public.orders where requisition_id = 'REQ-5514');
  delete from public.orders where requisition_id = 'REQ-5514';
  get diagnostics gone = row_count;
  raise notice 'removed % duplicate orders', gone;
end $$;

/* The requisition already says pending and already points at nothing. Said out
   loud rather than assumed, because the whole defect was a pointer that was
   null when something depended on it not being. */
update public.enterprise_requisitions
   set order_ref = null
 where id = 'REQ-5514' and order_ref is not null;

/* ---- 3. One order per requisition, as a constraint ----------------------------- */

/* Partial, because most orders have no requisition and null is not a duplicate
   of null. This is the version that holds whatever writes the row. */
create unique index if not exists orders_one_per_requisition
  on public.orders (requisition_id) where requisition_id is not null;

/* ---- 4. And as a readable refusal --------------------------------------------- */

/* The function again, with the idempotency check asking the table that holds
 * the answer. Everything else is as it was: the same reference format, the same
 * tax split out of the agreed amount, the same line.
 */
create or replace function public.place_requisition_order(p_req_id text)
returns text language plpgsql security definer
set search_path to 'public', 'extensions' as $$
declare
  req    record;
  prod   record;
  acct   record;
  rate   numeric;
  ref    text;
  oid    uuid;
  sub    numeric;
  tax    numeric;
  extant text;
begin
  select * into req from enterprise_requisitions where id = p_req_id;
  if req.id is null then raise exception 'No such requisition.'; end if;
  if req.state <> 'approved' then
    raise exception '% is %, so there is nothing to order.', req.id, req.state;
  end if;
  if req.product_id is null then
    raise exception '% does not say what it is buying, so no order line can be written for it.', req.id;
  end if;

  /* Ask the orders table, not the requisition's pointer at it. A pointer can be
     null while the thing it points at exists, and that gap is how one approval
     became twenty orders: the check went quiet and the reference-collision loop
     below happily minted a new reference for each one. */
  select order_ref into extant from orders where requisition_id = req.id limit 1;
  if extant is not null then
    /* Repair the pointer on the way past, so the requisition and the order
       agree again without anybody having to notice they had stopped. */
    update enterprise_requisitions set order_ref = extant
     where id = req.id and order_ref is distinct from extant;
    return extant;
  end if;

  select * into prod from products where id = req.product_id;
  select * into acct from enterprise_accounts where id = req.account_id;

  select m.tax_rate into rate from markets m where m.code = coalesce(acct.market, 'IN');
  rate := coalesce(rate, 0);

  sub := round(req.amount / (1 + rate / 100), 2);
  tax := round(req.amount - sub, 2);

  ref := 'ORD-8821' || right(regexp_replace(req.id, '\D', '', 'g'), 2);
  /* A reference clash is now only a clash of references — two requisitions
     whose digits end the same way — because the "this requisition already has
     an order" case returned above. */
  while exists (select 1 from orders where order_ref = ref) loop
    ref := 'ORD-8821' || right(regexp_replace(req.id, '\D', '', 'g'), 2)
           || '-' || substr(md5(clock_timestamp()::text), 1, 3);
  end loop;

  oid := gen_random_uuid();
  insert into orders (
    id, order_ref, status, total, subtotal, tax, discount, payment_method,
    buyer_name, buyer_email, created_at, placed_date, seller, vertical,
    failed, stage, stages, account_id, requisition_id, ordered_by,
    cost_centre, po_ref, currency, market, tax_rate)
  values (
    oid, ref, 'placed', req.amount, sub, tax, 0, 'On account — Net 30',
    acct.company, (select u.email from enterprise_users u where u.id = req.raised_by),
    now(), to_char(now(), 'DD Mon YYYY'),
    prod.seller, req.vertical,
    false, 1, array['Ordered', 'Approved', 'Packed', 'In transit', 'Delivered'],
    req.account_id, req.id, req.raised_by,
    req.cost_centre, req.po_ref, req.currency, coalesce(acct.market, 'IN'), rate);

  insert into order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status)
  values (gen_random_uuid(), oid, prod.id, req.title,
          round(req.amount / greatest(req.quantity, 1), 2), req.quantity, 'pending', 'placed');

  update enterprise_requisitions set order_ref = ref where id = req.id;
  return ref;
end $$;

grant execute on function public.place_requisition_order(text) to authenticated;

/* ---- 5. Which convention a line price is quoted in ----------------------------- */

/* A second thing the investigation turned up, and the reason an order register
 * cannot simply add up the lines and compare.
 *
 * Seventy-seven orders store tax-INCLUSIVE line prices — the shelf price the
 * buyer saw, so the lines sum to the total. Two store tax-EXCLUSIVE ones, so
 * they sum to the subtotal. Both are internally consistent and nothing on the
 * row says which, so any screen adding up an order has to guess, and a check
 * comparing lines to subtotal reports seventy-seven perfectly good orders as
 * broken. That is not a defect in the data, it is a missing fact about it.
 *
 * The majority convention is also the right one: it is what the buyer was
 * quoted, and it is what `place_requisition_order` writes. The two outliers are
 * restated into it rather than a flag being added for them — one convention with
 * two exceptions is how you get a third.
 */
do $$
declare r record; moved int := 0;
begin
  for r in
    select o.id, o.order_ref, o.tax_rate, o.subtotal, o.total,
           sum(i.price * i.quantity) as lines
      from public.orders o join public.order_items i on i.order_id = o.id
     group by o.id
    having abs(sum(i.price * i.quantity) - o.subtotal) <= 0.02
       and abs(sum(i.price * i.quantity) - (o.total + o.discount)) > 0.02
  loop
    update public.order_items
       set price = round(price * (1 + r.tax_rate / 100), 2)
     where order_id = r.id;
    moved := moved + 1;
    raise notice '% restated to tax-inclusive line prices at %%%', r.order_ref, r.tax_rate;
  end loop;
  raise notice '% orders restated', moved;
end $$;

/* ---- 6. What has to be true now ------------------------------------------------ */

do $$
declare n int; bad text;
begin
  /* ASSERT-1: the duplicates are gone and REQ-5514 is back to being a decision
     somebody has to make. */
  select count(*) into n from public.orders where requisition_id = 'REQ-5514';
  if n <> 0 then raise exception 'REQ-5514 still carries % orders', n; end if;

  select count(*) into n from public.enterprise_requisitions
   where id = 'REQ-5514' and state = 'pending' and order_ref is null;
  if n <> 1 then raise exception 'REQ-5514 is not a clean pending requisition'; end if;

  /* ASSERT-2: no requisition anywhere has more than one order. */
  select string_agg(x.requisition_id || ' (' || x.n || ')', ', ') into bad from (
    select requisition_id, count(*) n from public.orders
     where requisition_id is not null group by requisition_id having count(*) > 1
  ) x;
  if bad is not null then raise exception 'requisitions with more than one order: %', bad; end if;

  /* ASSERT-3: an approved requisition points at an order that exists, and the
     order points back. This is the pair whose disagreement was the whole bug. */
  select string_agg(r.id, ', ') into bad
    from public.enterprise_requisitions r
   where r.state = 'approved'
     and (r.order_ref is null
          or not exists (select 1 from public.orders o
                          where o.order_ref = r.order_ref and o.requisition_id = r.id));
  if bad is not null then
    raise exception 'approved requisitions whose order does not agree with them: %', bad;
  end if;

  /* And nothing unapproved has one. */
  select string_agg(r.id || ' is ' || r.state, ', ') into bad
    from public.enterprise_requisitions r
   where r.state <> 'approved' and exists (select 1 from public.orders o where o.requisition_id = r.id);
  if bad is not null then raise exception 'orders against undecided requisitions: %', bad; end if;

  /* ASSERT-4: one line-price convention across the whole book. Tax-inclusive:
     the lines sum to what the buyer was charged before any order-level
     discount. */
  select string_agg(x.order_ref, ', ') into bad from (
    select o.order_ref from public.orders o join public.order_items i on i.order_id = o.id
     group by o.id, o.order_ref, o.total, o.discount
    having abs(sum(i.price * i.quantity) - (o.total + o.discount)) > 0.02
  ) x;
  if bad is not null then raise exception 'orders whose lines do not sum to what was charged: %', bad; end if;

  /* ASSERT-5: and the header still holds together on its own terms. */
  select string_agg(o.order_ref, ', ') into bad from public.orders o
   where abs(o.total - (o.subtotal + o.tax - o.discount)) > 0.02;
  if bad is not null then raise exception 'orders whose total is not its own parts: %', bad; end if;

  select count(*) into n from public.orders;
  raise notice 'order book: % orders, all one-per-requisition and all quoting lines the same way', n;
end $$;
