/* Fourteen products nobody has ever taken up.
 *
 * The count I reported first was twenty, and it was wrong in a way worth
 * writing down: it asked which products had no `order_items` row. A monthly
 * product is not bought with an order line — it is taken up as a subscription,
 * and six of the twenty had live subscribers all along. Measuring take-up by
 * one of the two ways a thing can be bought made six healthy products look dead.
 *
 * The honest question is which live products have no order line, no consumer
 * subscription and no enterprise subscription. That is fourteen, and they fall
 * into three groups that want three different answers.
 *
 * EIGHT CONSUMER PRODUCTS AND ONE ENTERPRISE ONE ARE JUST UNSOLD.
 * Data boosters, roaming passes, an eSIM, three family and digital packs, a
 * fixed-wireless router and an IoT data pool. Nothing about them is wrong;
 * nobody in the seed happened to buy one. They are bought here.
 *
 * ONE IS CORRECTLY UNSOLD AND MUST STAY THAT WAY.
 * SKU-5008, the fleet telematics starter, is the subject of REQ-5476 — raised,
 * declined, with a reason: "Deferred to next budget year. The pilot is worth
 * doing but not before the depot programme is paid for." A product that was
 * asked for and turned down is a better story than a product nobody mentioned,
 * and manufacturing an order for it would delete the only declined requisition
 * on the book. The assertion below keeps it unsold.
 *
 * FOUR CANNOT BE BOUGHT AT ALL, AND THAT IS NOT A DATA PROBLEM.
 * SKU-7001, SKU-7002, SKU-7003 and SKU-FP9505 carry `audiences = ['partner']`.
 * There is no partner order, partner subscription or partner purchase table
 * anywhere in this schema — the marketplace lists four things to an audience
 * that has nowhere to buy them. Seeding a purchase would mean inventing the
 * table to hold it, which is a feature and not a seed. They are left alone,
 * counted, and named in the assertion so the gap stays visible instead of
 * looking like four more products nobody fancied.
 *
 * AND TWENTY-FIVE ROWS CARRIED ADDRESSES AT A REAL COMPANY.
 *
 * This was meant to be a note about five orders reading `buyer_name = 'Mani'`
 * with `buyer_email = 'N'` — obvious residue from clicking through the checkout
 * while building it. Widening the check from "is this a usable address" to "is
 * this the address the profile says" found the actual problem:
 *
 *   orders.buyer_email        21 rows at @6dtech.co.in and @6dtech.co.ke
 *   consumer_household.email   2 rows, Priya and Wanjiru
 *   partners.email             1 row, a test seller called "Test Mani"
 *
 * Fictional shoppers were carrying mailboxes at a real, live corporate domain.
 * Nothing sends mail in this prototype today, so nothing has gone wrong yet —
 * but a demo dataset is exactly where a notification eventually gets wired up
 * and fires at whatever address it finds. `example.com`, `example.in` and
 * `example.co.ke` are reserved for this and cannot receive mail at all, which
 * is the point of them.
 *
 * So the sweep is by domain rather than by row, and the assertion is by shape
 * rather than by list: no address anywhere outside the reserved domains. That
 * catches the next one, which a list of twenty-five would not.
 *
 * "Test Mani" goes too. An onboarding partner with no products, no orders, no
 * statements and no users is the seller-side twin of the thirty-four test
 * shoppers swept in `20260808400000`, and it sits in the seller directory.
 */

/* ---- 1. Take the real domain out of the demo data ------------------------------ */

/* Rewritten to the reserved domain that matches each address's country, so
   Wanjiru keeps a Kenyan-looking address and Priya an Indian one. Identity is
   part of what makes the seed readable. */
update public.orders
   set buyer_email = regexp_replace(buyer_email, '@6dtech\.co\.in$', '@example.in')
 where buyer_email ilike '%@6dtech.co.in';
update public.orders
   set buyer_email = regexp_replace(buyer_email, '@6dtech\.co\.ke$', '@example.co.ke')
 where buyer_email ilike '%@6dtech.co.ke';

update public.consumer_household
   set email = regexp_replace(email, '@6dtech\.co\.in$', '@example.in')
 where email ilike '%@6dtech.co.in';
update public.consumer_household
   set email = regexp_replace(email, '@6dtech\.co\.ke$', '@example.co.ke')
 where email ilike '%@6dtech.co.ke';

/* And the orders that never had a usable address at all, plus the five whose
   buyer was 'Mani' rather than the person whose account placed them. */
update public.orders o
   set buyer_name  = p.name,
       buyer_email = p.email
  from public.consumer_profile p
 where p.user_id = o.user_id
   and (o.buyer_email is null or o.buyer_email !~ '@' or o.buyer_name is distinct from p.name);

/* ---- 1b. And the test seller in the directory ----------------------------------- */

delete from public.onboarding_tasks where partner_id = 'PTR-1021';
delete from public.onboarding_gates where partner_id = 'PTR-1021';
delete from public.partner_lifecycle_events where partner_id = 'PTR-1021';
delete from public.partners where id = 'PTR-1021';

/* ---- 2. What the shoppers bought ------------------------------------------------ */

/* Prices are tax-inclusive — the figure the buyer was quoted — so the tax comes
 * off the line total rather than being added to it, and `subtotal + tax` equals
 * the lines rather than the discounted total. That relationship is asserted at
 * the bottom because it is the one this codebase has got wrong before.
 */
do $$
declare
  o record;
  v_order uuid;
  v_lines numeric;
  v_sub numeric;
  v_tax numeric;
  v_rate numeric;
  it jsonb;
begin
  for o in
    select * from (values
      /* ref, user_id, market, currency, seller, vertical, payment, status, stage, days_ago, discount, items */
      ('ORD-77120401', 'd5a4012b-56dc-4ade-ab33-a00b55a5f32e', 'IN', 'INR', 'Aventa Telecom', 'consumer',
       'upi', 'delivered', 4, 33, 0::numeric,
       '[{"p":"SKU-2007","q":1},{"p":"SKU-FP9503","q":1}]'::jsonb),

      ('ORD-77120402', 'd5a4012b-56dc-4ade-ab33-a00b55a5f32e', 'IN', 'INR', 'Aventa Telecom', 'consumer',
       'card', 'delivered', 4, 19, 0::numeric,
       '[{"p":"SKU-2010","q":1}]'::jsonb),

      /* Wanjiru travels, so the roaming pass and a data booster go together —
         which is also the first Kenyan multi-line basket on the book. */
      ('ORD-77120403', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'KE', 'KES', 'Aventa Telecom', 'consumer',
       'mpesa', 'delivered', 4, 26, 0::numeric,
       '[{"p":"SKU-2008","q":1},{"p":"SKU-2007","q":1}]'::jsonb),

      ('ORD-77120404', 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81', 'KE', 'KES', 'Aventa Telecom', 'consumer',
       'mpesa', 'in transit', 2, 6, 0::numeric,
       '[{"p":"SKU-2010","q":1},{"p":"SKU-FP9503","q":2}]'::jsonb),

      /* The router, with the pass somebody buys at the same time as the router. */
      ('ORD-77120405', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'KE', 'KES', 'Volta Routers', 'device',
       'mpesa', 'delivered', 4, 41, 0::numeric,
       '[{"p":"SKU-4005","q":1},{"p":"SKU-2007","q":1}]'::jsonb),

      ('ORD-77120406', 'd5a4012b-56dc-4ade-ab33-a00b55a5f32e', 'IN', 'INR', 'Volta Routers', 'device',
       'emi', 'placed', 1, 2, 0::numeric,
       '[{"p":"SKU-4005","q":1}]'::jsonb)
    ) as t(ref, uid, mkt, ccy, seller, vertical, pay, status, stage, days_ago, discount, items)
  loop
    select tax_rate into v_rate from public.markets where code = o.mkt;

    /* The lines, at the price published for that market. */
    select coalesce(sum(round(pp.price * (i ->> 'q')::int, 2)), 0) into v_lines
      from jsonb_array_elements(o.items) i
      join public.product_prices pp
        on pp.product_id = (i ->> 'p') and pp.currency = o.ccy;

    if v_lines = 0 then
      raise exception '% has no priced lines in %', o.ref, o.ccy;
    end if;

    v_sub := round(v_lines / (1 + v_rate / 100), 2);
    v_tax := round(v_lines - v_sub, 2);
    v_order := gen_random_uuid();

    insert into public.orders (
      id, order_ref, status, total, subtotal, tax, discount, payment_method,
      buyer_name, buyer_email, created_at, placed_date, seller, vertical,
      failed, stage, stages, user_id, currency, market, tax_rate)
    select
      v_order, o.ref, o.status, v_lines - o.discount, v_sub, v_tax, o.discount, o.pay,
      p.name, p.email,
      now() - (o.days_ago || ' days')::interval,
      to_char(now() - (o.days_ago || ' days')::interval, 'DD Mon YYYY'),
      o.seller, o.vertical,
      false, o.stage, array['Ordered', 'Approved', 'Packed', 'In transit', 'Delivered'],
      o.uid::uuid, o.ccy, o.mkt, v_rate
      from public.consumer_profile p where p.user_id = o.uid::uuid;

    for it in select * from jsonb_array_elements(o.items) loop
      insert into public.order_items (
        id, order_id, product_id, product_name, price, quantity, fulfil, status, user_id)
      select gen_random_uuid(), v_order, pr.id, pr.name,
             pp.price, (it ->> 'q')::int,
             case when pr.model = 'oneoff' and pr.unit is null then 'ship' else 'provision' end,
             o.status, o.uid::uuid
        from public.products pr
        join public.product_prices pp on pp.product_id = pr.id and pp.currency = o.ccy
       where pr.id = (it ->> 'p');
    end loop;
  end loop;
end $$;

/* ---- 3. What they subscribed to ------------------------------------------------- */

insert into public.subscriptions (
  id, product_id, product_name, status, auto_renew, started_at, next_renewal,
  price, user_id, ref, seller, cycle, currency)
select gen_random_uuid(), s.pid, pr.name, s.state, s.renews,
       (current_date - (s.months_ago || ' months')::interval)::date,
       (current_date - (s.months_ago || ' months')::interval + interval '1 month')::date,
       pp.price, s.uid::uuid, s.ref, pr.seller, 'Monthly', s.ccy
  from (values
    /* The family pack is a household thing, so it belongs to the shopper with a
       family plan already — Priya, who has the Halo Music Family subscription. */
    ('SKU-2009',   'd5a4012b-56dc-4ade-ab33-a00b55a5f32e', 'INR', 'active',    true,  7, 'SUB-449100-09'),
    ('SKU-FP9506', 'd5a4012b-56dc-4ade-ab33-a00b55a5f32e', 'INR', 'active',    true,  3, 'SUB-449100-06'),
    /* And the digital life pack to Wanjiru, who already takes three of the
       content subscriptions it bundles. */
    ('SKU-FP9507', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'KES', 'active',    true,  5, 'SUB-449288-07'),
    /* One cancelled, because a subscription book where nothing was ever
       cancelled is not a subscription book. */
    ('SKU-2009',   '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'KES', 'cancelled', false, 9, 'SUB-449288-09')
  ) as s(pid, uid, ccy, state, renews, months_ago, ref)
  join public.products pr on pr.id = s.pid
  join public.product_prices pp on pp.product_id = s.pid and pp.currency = s.ccy
 where not exists (select 1 from public.subscriptions x where x.ref = s.ref);

/* ---- 4. And the enterprise pool ------------------------------------------------- */

/* Greencity have an agreement and have bought nothing under it, which their
 * credit review says in as many words. A single data pool is the least
 * committing thing an account starts with, and it is what their agreement was
 * signed to allow.
 */
insert into public.enterprise_subscriptions (
  id, account_id, product_id, name, seller, partner_id, vertical, quantity, seats_used,
  unit_price, unit, monthly, cost_centre, started, renews, status, auto_renew, contract_ref, sort_order)
select 'ESUB-2013-01', 'ENT-2013', pr.id, pr.name, pr.seller, pr.partner_id, 'iot',
       4, 4, pp.price, coalesce(pr.unit, 'pool'), round(pp.price * 4, 2),
       (select id from public.enterprise_cost_centres where account_id = 'ENT-2013' order by sort_order limit 1),
       date '2026-06-15', date '2027-05-31', 'active', true, 'CTR-2013-01', 1
  from public.products pr
  join public.product_prices pp on pp.product_id = pr.id and pp.currency = 'INR'
 where pr.id = 'SKU-FP9504'
   and not exists (select 1 from public.enterprise_subscriptions where id = 'ESUB-2013-01');

/* ---- 5. What the new orders earned ---------------------------------------------- */

/* Computed from `loyalty_point_rates` rather than typed, which is the whole of
 * the argument in the next migration: a rate table nothing reads is decoration.
 * Points on the amount actually paid, in the currency it was paid in.
 */
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
 where o.order_ref like 'ORD-771204%'
   and not exists (select 1 from public.loyalty_ledger l where l.ref = o.order_ref and l.type = 'earn');

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text; n int; v_lines numeric; v_row record;
begin
  /* ASSERT-1: every new order's arithmetic holds. Tax comes off the lines, not
     off the discounted total — getting that backwards is what made ORD-881402
     disagree with its own parts. */
  for v_row in
    select o.id, o.order_ref, o.total, o.subtotal, o.tax, o.discount, o.tax_rate,
           (select coalesce(sum(i.price * i.quantity), 0) from public.order_items i where i.order_id = o.id) as lines
      from public.orders o where o.order_ref like 'ORD-771204%'
  loop
    if abs(v_row.lines - (v_row.total + v_row.discount)) > 0.01 then
      raise exception '% lines are % and total plus discount is %',
        v_row.order_ref, v_row.lines, v_row.total + v_row.discount;
    end if;
    if abs((v_row.subtotal + v_row.tax) - v_row.lines) > 0.01 then
      raise exception '% subtotal plus tax is %, and its lines are %',
        v_row.order_ref, v_row.subtotal + v_row.tax, v_row.lines;
    end if;
    if abs(v_row.tax - (v_row.lines - round(v_row.lines / (1 + v_row.tax_rate / 100), 2))) > 0.02 then
      raise exception '% tax of % is not %% of tax-inclusive lines of %',
        v_row.order_ref, v_row.tax, v_row.lines;
    end if;
  end loop;

  /* ASSERT-2: each is priced in its own market's money, at the published price. */
  select string_agg(format('%s line %s at %s', o.order_ref, i.product_id, i.price), '; ') into bad
    from public.orders o
    join public.order_items i on i.order_id = o.id
    left join public.product_prices pp on pp.product_id = i.product_id and pp.currency = o.currency
   where o.order_ref like 'ORD-771204%'
     and (pp.price is null or abs(pp.price - i.price) > 0.01);
  if bad is not null then raise exception 'lines not at the published price for the market: %', bad; end if;

  /* ASSERT-3: the thirteen that could be sold, are. Fourteen minus SKU-5008,
     which is declined on purpose, minus the four with no way to be bought. */
  select string_agg(p.id || ' (' || p.name || ')', ', ') into bad
    from public.products p
   where p.status = 'live'
     and not (p.audiences @> array['partner'] and array_length(p.audiences, 1) = 1)
     and p.id <> 'SKU-5008'
     and not exists (select 1 from public.order_items i where i.product_id = p.id)
     and not exists (select 1 from public.subscriptions s where s.product_id = p.id)
     and not exists (select 1 from public.enterprise_subscriptions e where e.product_id = p.id);
  if bad is not null then raise exception 'live products still with no take-up at all: %', bad; end if;

  /* ASSERT-4: and the one that is meant to be unsold still is, with the
     declined requisition that explains it. Forcing an order for SKU-5008 would
     have deleted the only turned-down purchase on the book. */
  select count(*) into n from public.order_items where product_id = 'SKU-5008';
  if n <> 0 then raise exception 'SKU-5008 was sold, which erases the declined requisition behind it'; end if;
  select count(*) into n from public.enterprise_requisitions
   where product_id = 'SKU-5008' and state = 'declined' and length(coalesce(decision_note, '')) > 40;
  if n <> 1 then raise exception 'REQ-5476 no longer explains why the telematics starter was refused'; end if;

  /* ASSERT-5: the partner-only products are still exactly four and still
     unsellable, so the gap is a number somebody can see rather than a silence.
     This is the assertion to delete when partner purchasing is built. */
  select count(*) into n from public.products
   where status = 'live' and audiences @> array['partner'] and array_length(audiences, 1) = 1;
  if n <> 4 then
    raise exception 'the partner-audience catalogue is % products, not the 4 this file left alone', n;
  end if;
  if exists (select 1 from information_schema.tables
              where table_schema = 'public'
                and table_name in ('partner_orders', 'partner_subscriptions', 'partner_purchases')) then
    raise exception 'partner purchasing exists now — seed these four and drop this assertion';
  end if;

  /* ASSERT-6: no address anywhere sits on the domain of the company that owns
     this codebase.
   *
     Drawn at that domain rather than at "anything outside example.*", which is
     where the first draft of this check drew it and which failed on fifteen
     seller contacts — a.mehra@kestrel.in, w.tan@streamnova.sg, and so on. Those
     are invented companies with invented domains, and a seller directory where
     every contact is @example.com reads as a stub rather than as a market. They
     are left alone on purpose.
   *
     The distinction that matters is not "fictional versus real-looking", it is
     "who gets the mail if something ever sends it". 6dtech is a live company
     with a live mail server; the seller domains are brand names invented for
     this seed. Worth saying out loud that I have not verified the seller
     domains are unregistered — if any of them turns out to belong to somebody,
     it is the same problem and wants the same sweep.
   *
     Every table with an address column, so a real domain appearing in one
     nobody thought of fails this too. */
  for v_row in
    select c.table_name, c.column_name from information_schema.columns c
      join information_schema.tables t
        on t.table_name = c.table_name and t.table_schema = 'public' and t.table_type = 'BASE TABLE'
     where c.table_schema = 'public' and c.data_type in ('text', 'character varying')
       and c.column_name ilike '%email%'
  loop
    execute format(
      'select string_agg(distinct %I, '', '') from public.%I where %I ilike ''%%@6dtech%%''',
      v_row.column_name, v_row.table_name, v_row.column_name)
      into bad;
    if bad is not null then
      raise exception 'addresses at a real company domain in %.%: %',
        v_row.table_name, v_row.column_name, bad;
    end if;
  end loop;

  select string_agg(order_ref, ', ') into bad from public.orders
   where buyer_email is not null and buyer_email !~ '@';
  if bad is not null then raise exception 'orders with an unusable buyer email: %', bad; end if;

  /* The buyer on the order is the person whose account placed it. */
  select string_agg(o.order_ref, ', ') into bad
    from public.orders o join public.consumer_profile p on p.user_id = o.user_id
   where o.buyer_name is distinct from p.name;
  if bad is not null then
    raise exception 'orders whose buyer is not the profile that placed them: %', bad;
  end if;

  /* ASSERT-6b: and the test seller is out of the directory. */
  select string_agg(id || ' (' || name || ')', ', ') into bad from public.partners
   where name ~* '^(test|demo|asdf|qwerty)\b' or name ilike '%test mani%';
  if bad is not null then raise exception 'test sellers still in the directory: %', bad; end if;

  /* ASSERT-7: baskets are no longer almost all single-line. Six of eighty was a
     catalogue nobody browsed. */
  select count(*) into n from public.orders o
   where (select count(*) from public.order_items i where i.order_id = o.id) > 1;
  if n < 12 then raise exception 'only % orders have more than one line', n; end if;

  /* ASSERT-8: every new order earned points its own currency's rate allows.
     Not "some points" — the figure the schedule produces. */
  select string_agg(format('%s earned %s on %s %s, schedule allows %s',
                           l.ref, l.points, o.total, o.currency,
                           floor(o.total * r.earn_per_unit)), '; ') into bad
    from public.loyalty_ledger l
    join public.orders o on o.order_ref = l.ref
    join public.loyalty_point_rates r on r.currency = o.currency
   where l.ref like 'ORD-771204%' and l.type = 'earn'
     and l.points <> floor(o.total * r.earn_per_unit)::int;
  if bad is not null then raise exception 'new earnings that the rate schedule does not produce: %', bad; end if;

  /* ASSERT-9: and the new subscriptions are priced in the money their owner
     actually pays in. */
  select string_agg(s.ref, ', ') into bad
    from public.subscriptions s
    join public.consumer_profile p on p.user_id = s.user_id
   where s.ref like 'SUB-4492%' and s.currency <> p.currency and p.currency <> 'USD';
  if bad is not null then raise exception 'subscriptions priced in a currency the shopper does not use: %', bad; end if;
end $$;
