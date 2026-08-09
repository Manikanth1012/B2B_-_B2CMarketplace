/* A catalogue nobody browsed.
 *
 * Twelve of eighty-six orders carry more than one line, and four of those twelve
 * were written an hour ago. Eight multi-line baskets out of eighty is not a
 * marketplace, it is a series of single-item tests — every shopper arrived
 * knowing exactly what they wanted, bought precisely that, and left.
 *
 * The reason it matters beyond looking thin: almost everything downstream is
 * exercised differently by a basket than by a single line. An order with two
 * sellers in it splits across two settlement statements. Tax on a mixed basket
 * is the sum of the lines and not a figure computed once. A refund takes a line
 * rather than an order. A review has to know which line it is about — which is
 * the next task on the list. A book of single-line orders passes all of that
 * without ever testing it.
 *
 * So these are the baskets people actually put together: a handset with the
 * charger and the cover, a router with the mesh pack, a tablet with a data
 * plan for it. Two of them deliberately span two sellers, because a basket
 * that splits across sellers is the case the settlement side has never seen
 * from the consumer end.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not add lines to the orders already on the book. That was the first
 * idea and it is wrong: those orders have settlement statements, loyalty rows
 * and refunds hanging off their totals, and quietly growing a total that other
 * records were computed from is how a reconciliation breaks six screens away
 * from the edit.
 */

do $$
declare
  o record;
  v_order uuid;
  v_lines numeric;
  v_sub numeric;
  v_tax numeric;
  v_rate numeric;
  v_seller text;
  it jsonb;
begin
  for o in
    select * from (values
      /* A handset with the two things sold beside a handset. */
      ('ORD-77130501', 'd5a4012b-56dc-4ade-ab33-a00b55a5f32e', 'IN', 'INR',
       'card', 'delivered', 4, 61,
       '[{"p":"SKU-4002","q":1},{"p":"SKU-4008","q":1},{"p":"SKU-2005","q":1}]'::jsonb),

      /* Two sellers in one basket: the tablet is Kestrel's, the data plan is
         the marketplace's own. This is the split the settlement side has never
         been given from the consumer end. */
      ('ORD-77130502', 'd5a4012b-56dc-4ade-ab33-a00b55a5f32e', 'IN', 'INR',
       'emi', 'delivered', 4, 47,
       '[{"p":"SKU-4006","q":1},{"p":"SKU-2003","q":1}]'::jsonb),

      ('ORD-77130503', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'KE', 'KES',
       'mpesa', 'delivered', 4, 38,
       '[{"p":"SKU-4004","q":1},{"p":"SKU-4008","q":2}]'::jsonb),

      /* Somebody kitting out for a trip. */
      ('ORD-77130504', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'KE', 'KES',
       'card', 'delivered', 4, 22,
       '[{"p":"SKU-2003","q":1},{"p":"SKU-2005","q":1},{"p":"SKU-FP9503","q":1}]'::jsonb),

      ('ORD-77130505', 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81', 'KE', 'KES',
       'mpesa', 'delivered', 4, 30,
       '[{"p":"SKU-4003","q":1},{"p":"SKU-2005","q":1}]'::jsonb),

      /* The second cross-seller basket, and a games pass bought with the
         charger it will drain. */
      ('ORD-77130506', 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81', 'KE', 'KES',
       'card', 'delivered', 4, 14,
       '[{"p":"SKU-3004","q":1},{"p":"SKU-4008","q":1}]'::jsonb),

      ('ORD-77130507', 'd5a4012b-56dc-4ade-ab33-a00b55a5f32e', 'IN', 'INR',
       'upi', 'in transit', 2, 5,
       '[{"p":"SKU-2003","q":2},{"p":"SKU-2007","q":1}]'::jsonb),

      /* One still on its way, so the multi-line case is not exclusively a
         history of things that all went right. */
      ('ORD-77130508', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'KE', 'KES',
       'mpesa', 'packed', 3, 3,
       '[{"p":"SKU-4008","q":1},{"p":"SKU-2008","q":1}]'::jsonb)
    ) as t(ref, uid, mkt, ccy, pay, status, stage, days_ago, items)
  loop
    select tax_rate into v_rate from public.markets where code = o.mkt;

    select coalesce(sum(round(pp.price * (i ->> 'q')::int, 2)), 0) into v_lines
      from jsonb_array_elements(o.items) i
      join public.product_prices pp
        on pp.product_id = (i ->> 'p') and pp.currency = o.ccy;
    if v_lines = 0 then raise exception '% has no priced lines in %', o.ref, o.ccy; end if;

    /* The seller on the order header is the one that sells the dearest line —
       the order is "from" whoever the basket is mostly about. Where a basket
       spans sellers the header cannot be the whole truth, which is what the
       lines are for, and `orders.seller` has always been a convenience rather
       than the record. */
    select pr.seller into v_seller
      from jsonb_array_elements(o.items) i
      join public.products pr on pr.id = (i ->> 'p')
      join public.product_prices pp on pp.product_id = pr.id and pp.currency = o.ccy
     order by pp.price * (i ->> 'q')::int desc limit 1;

    v_sub := round(v_lines / (1 + v_rate / 100), 2);
    v_tax := round(v_lines - v_sub, 2);
    v_order := gen_random_uuid();

    insert into public.orders (
      id, order_ref, status, total, subtotal, tax, discount, payment_method,
      buyer_name, buyer_email, created_at, placed_date, seller, vertical,
      failed, stage, stages, user_id, currency, market, tax_rate)
    select
      v_order, o.ref, o.status, v_lines, v_sub, v_tax, 0, o.pay,
      p.name, p.email,
      now() - (o.days_ago || ' days')::interval,
      to_char(now() - (o.days_ago || ' days')::interval, 'DD Mon YYYY'),
      v_seller, 'consumer',
      false, o.stage, array['Ordered', 'Approved', 'Packed', 'In transit', 'Delivered'],
      o.uid::uuid, o.ccy, o.mkt, v_rate
      from public.consumer_profile p where p.user_id = o.uid::uuid;

    for it in select * from jsonb_array_elements(o.items) loop
      insert into public.order_items (
        id, order_id, product_id, product_name, price, quantity, fulfil, status, user_id)
      select gen_random_uuid(), v_order, pr.id, pr.name, pp.price, (it ->> 'q')::int,
             case when pr.model = 'oneoff' and pr.unit is null then 'ship' else 'provision' end,
             o.status, o.uid::uuid
        from public.products pr
        join public.product_prices pp on pp.product_id = pr.id and pp.currency = o.ccy
       where pr.id = (it ->> 'p');
    end loop;
  end loop;
end $$;

/* What they earned, from the rate schedule as before. */
insert into public.loyalty_ledger (
  id, member, when_date, type, points, ref, rule_id, funder, value, note, user_id, currency)
select 'LTX-' || right(o.order_ref, 6),
       m.id, o.created_at::date, 'earn',
       floor(o.total * r.earn_per_unit)::int,
       o.order_ref, 'ERN-01', 'marketplace',
       round(floor(o.total * r.earn_per_unit)::numeric / r.per_unit, 2),
       format('%s at %s point per %s %s', o.seller,
              r.earn_per_unit, round(1 / r.earn_per_unit), o.currency),
       o.user_id, o.currency
  from public.orders o
  join public.loyalty_members m on m.user_id = o.user_id
  join public.loyalty_point_rates r on r.currency = o.currency
 where o.order_ref like 'ORD-771305%'
   and not exists (select 1 from public.loyalty_ledger l where l.ref = o.order_ref and l.type = 'earn');

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text; n int; v_row record;
begin
  /* ASSERT-1: the arithmetic, again, for the new ones. */
  for v_row in
    select o.order_ref, o.total, o.subtotal, o.tax, o.discount, o.tax_rate,
           (select coalesce(sum(i.price * i.quantity), 0)
              from public.order_items i where i.order_id = o.id) as lines
      from public.orders o where o.order_ref like 'ORD-771305%'
  loop
    if abs(v_row.lines - (v_row.total + v_row.discount)) > 0.01 then
      raise exception '% lines are % and total plus discount is %',
        v_row.order_ref, v_row.lines, v_row.total + v_row.discount;
    end if;
    if abs((v_row.subtotal + v_row.tax) - v_row.lines) > 0.01 then
      raise exception '% subtotal plus tax is %, its lines are %',
        v_row.order_ref, v_row.subtotal + v_row.tax, v_row.lines;
    end if;
  end loop;

  /* ASSERT-2: every one of them actually has more than one line. A migration
     called "multi-line baskets" that wrote single-line orders would pass every
     other check in this file. */
  select string_agg(o.order_ref, ', ') into bad from public.orders o
   where o.order_ref like 'ORD-771305%'
     and (select count(*) from public.order_items i where i.order_id = o.id) < 2;
  if bad is not null then raise exception 'baskets with one line: %', bad; end if;

  /* ASSERT-3: and at least two of them span two sellers, which is the case the
     settlement side has never met from the consumer end. */
  select count(*) into n from (
    select o.id from public.orders o
      join public.order_items i on i.order_id = o.id
      join public.products p on p.id = i.product_id
     where o.order_ref like 'ORD-771305%'
     group by o.id having count(distinct p.seller) > 1) t;
  if n < 2 then raise exception 'only % of the new baskets span two sellers', n; end if;

  /* ASSERT-4: the book is no longer overwhelmingly single-line. Not a round
     number for its own sake — below about a fifth, the multi-line path is
     exercised by so few rows that a query which silently drops them still
     looks right. */
  select count(*) into n from public.orders o
   where (select count(*) from public.order_items i where i.order_id = o.id) > 1;
  if n * 5 < (select count(*) from public.orders) then
    raise exception 'only % of % orders carry more than one line',
      n, (select count(*) from public.orders);
  end if;

  /* ASSERT-5: every line is at the published price for the order's market. */
  select string_agg(format('%s %s at %s', o.order_ref, i.product_id, i.price), '; ') into bad
    from public.orders o
    join public.order_items i on i.order_id = o.id
    left join public.product_prices pp
      on pp.product_id = i.product_id and pp.currency = o.currency
   where o.order_ref like 'ORD-771305%'
     and (pp.price is null or abs(pp.price - i.price) > 0.01);
  if bad is not null then raise exception 'lines not at the published price: %', bad; end if;

  /* ASSERT-6: and they earned what the schedule says, not what looked right. */
  select string_agg(format('%s earned %s, schedule allows %s',
                           l.ref, l.points, floor(o.total * r.earn_per_unit)), '; ') into bad
    from public.loyalty_ledger l
    join public.orders o on o.order_ref = l.ref
    join public.loyalty_point_rates r on r.currency = o.currency
   where l.ref like 'ORD-771305%' and l.type = 'earn'
     and l.points <> floor(o.total * r.earn_per_unit)::int;
  if bad is not null then raise exception 'earnings the rate schedule does not produce: %', bad; end if;
end $$;
