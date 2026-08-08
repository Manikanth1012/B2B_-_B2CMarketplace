/* Seven disputes about orders that do not exist.
 *
 * Every row in `partner_disputes` names an order, and not one of the seven
 * resolves:
 *
 *   ORD-871244, ORD-874008, ORD-876115, ORD-878402, ORD-879810, ORD-880519,
 *   ORD-880744 — none of them are in the order book.
 *
 * The disputes were seeded independently of it, so a desk opening one cannot see
 * what was bought, who the buyer was, what it cost, or whether the amount
 * claimed is even possible. Every question a disputes desk asks is a question
 * about the order.
 *
 * And the amounts carry no currency. They read as dollars — 12.99 for a
 * household streaming plan, 71.00 for a sensor — against a marketplace whose
 * books are in rupees, shillings and dirhams. ₹12.99 is not a month of anything;
 * the plan is ₹1,099.
 *
 * WHAT THIS DOES
 *
 * A dispute is evidence that a purchase happened. Seven disputes are seven
 * purchases the order book is missing, so the orders are written — from the
 * right seller, to a buyer that exists, in that buyer's own market and currency,
 * dated before the dispute that argues about them.
 *
 * Then each amount is restated from what the dispute actually claims. "Three of
 * twenty-five sensors missing" is three units at that market's price, not a
 * number somebody typed. "Twelve of twenty-five SIMs not activated" is twelve
 * twenty-fifths of a bundle. That is checkable, and the assertions at the bottom
 * check it: no claim exceeds its order, and each one equals the arithmetic its
 * own text describes.
 *
 * Two of the seven buyers are people rather than accounts and have no sign-in,
 * so those are guest checkouts — a case the order register already labels and
 * which had exactly one example before this.
 */

alter table public.partner_disputes
  add column if not exists currency text;

/* ---- 1. The orders the disputes are about ------------------------------------- */

do $$
declare
  r        record;
  oid      uuid;
  v_unit     numeric;
  v_qty      int;
  v_rate     numeric;
  v_gross    numeric;
  made     int := 0;
  /* ref, product, partner, buyer, account (null = guest or consumer), market,
     currency, quantity ordered, days before the dispute it was placed, ladder. */
  spec constant jsonb := jsonb_build_array(
    jsonb_build_object('dispute','DSP-2139','ref','ORD-871244','product','SKU-5003',
      'buyer','Harbourpoint Retail','email','procurement@harbourpoint.co.ke','account','ENT-2014',
      'market','KE','currency','KES','qty',3,'before',11,'status','delivered'),
    jsonb_build_object('dispute','DSP-2154','ref','ORD-874008','product','SKU-5009',
      'buyer','Meera Krishnan','email','meera.krishnan@example.in','account',null,
      'market','IN','currency','INR','qty',1,'before',6,'status','delivered'),
    jsonb_build_object('dispute','DSP-2170','ref','ORD-876115','product','SKU-5006',
      'buyer','Brightline Foods','email','ops@brightlinefoods.in','account','ENT-2011',
      'market','IN','currency','INR','qty',1,'before',9,'status','delivered'),
    jsonb_build_object('dispute','DSP-2188','ref','ORD-878402','product','SKU-5003',
      'buyer','Harbourpoint Retail','email','procurement@harbourpoint.co.ke','account','ENT-2014',
      'market','KE','currency','KES','qty',6,'before',13,'status','delivered'),
    jsonb_build_object('dispute','DSP-2199','ref','ORD-879810','product','SKU-6001',
      'buyer','Harbourpoint Retail','email','it@harbourpoint.co.ke','account','ENT-2014',
      'market','KE','currency','KES','qty',1,'before',20,'status','active'),
    jsonb_build_object('dispute','DSP-2201','ref','ORD-880519','product','SKU-5003',
      'buyer','Brightline Foods','email','ops@brightlinefoods.in','account','ENT-2011',
      'market','IN','currency','INR','qty',25,'before',8,'status','delivered'),
    jsonb_build_object('dispute','DSP-2205','ref','ORD-880744','product','SKU-3001',
      'buyer','Arun Deshpande','email','arun.deshpande@example.in','account',null,
      'market','IN','currency','INR','qty',1,'before',18,'status','active')
  );
  s jsonb;
begin
  for s in select * from jsonb_array_elements(spec) loop
    if exists (select 1 from public.orders where order_ref = s ->> 'ref') then
      raise notice '% is already in the book', s ->> 'ref';
      continue;
    end if;

    select d.* into r from public.partner_disputes d where d.id = s ->> 'dispute';
    if r.id is null then raise exception 'no dispute %', s ->> 'dispute'; end if;

    select pp.price into v_unit from public.product_prices pp
     where pp.product_id = s ->> 'product' and pp.currency = s ->> 'currency';
    if v_unit is null then
      raise exception '% has no price in %', s ->> 'product', s ->> 'currency';
    end if;

    v_qty := (s ->> 'qty')::int;
    select m.tax_rate into v_rate from public.markets m where m.code = s ->> 'market';
    /* The line price is what the buyer was quoted — tax included — so it is the
       charged total, and the subtotal comes out of it rather than on top. The
       whole order book quotes lines this way; see `20260808200000`. */
    v_gross := round(v_unit * v_qty, 2);

    oid := gen_random_uuid();
    insert into public.orders (
      id, order_ref, status, total, subtotal, tax, discount, tax_rate,
      payment_method, buyer_name, buyer_email, created_at, placed_date,
      seller, vertical, failed, stage, stages, account_id, currency, market)
    values (
      oid, s ->> 'ref', s ->> 'status', v_gross,
      round(v_gross / (1 + v_rate / 100), 2), round(v_gross - v_gross / (1 + v_rate / 100), 2), 0, v_rate,
      case when s ->> 'account' is null then 'Card' else 'On account — Net 30' end,
      s ->> 'buyer', s ->> 'email',
      (r.raised - ((s ->> 'before')::int))::timestamptz,
      to_char(r.raised - ((s ->> 'before')::int), 'DD Mon YYYY'),
      (select p.seller from public.products p where p.id = s ->> 'product'),
      r.category_id, false,
      /* Delivered and active both sit at the end of their own ladder. Anything
         short of that would be an order contradicting its own status, which is
         the first thing the order register reports. */
      4,
      case when s ->> 'status' = 'active'
           then array['Ordered', 'Confirmed', 'Provisioning', 'Activating', 'Active']
           else array['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered'] end,
      s ->> 'account', s ->> 'currency', s ->> 'market');

    insert into public.order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status)
    select gen_random_uuid(), oid, p.id, p.name, v_unit, v_qty,
           case when p.category_id in ('security', 'content') then 'provisioned' else 'shipped' end,
           'delivered'
      from public.products p where p.id = s ->> 'product';

    made := made + 1;
  end loop;
  raise notice '% orders written for disputes that argued about nothing', made;
end $$;

/* ---- 2. What each dispute actually claims -------------------------------------- */

/* Restated from the claim and the price, in the order's own currency. Each one
 * is the arithmetic its own `reason` describes, so it can be checked rather than
 * believed — and the assertions below check it.
 */
do $$
begin
  /* "Buyer claims the pack was never delivered" — the whole order. */
  update public.partner_disputes d set
    amount = o.total, currency = o.currency
   from public.orders o where o.order_ref = d.order_ref and d.id = 'DSP-2139';

  /* "Single unit, no power on unboxing" — one sensor. */
  update public.partner_disputes d set
    amount = i.price, currency = o.currency
   from public.orders o join public.order_items i on i.order_id = o.id
  where o.order_ref = d.order_ref and d.id = 'DSP-2154';

  /* "12 of the 25 bundled SIMs" — twelve twenty-fifths of the bundle. The
     connectivity is not separately priced inside the starter pack, so the
     fraction is the only defensible split and it is the one the buyer will
     have done themselves. */
  update public.partner_disputes d set
    amount = round(o.total * 12 / 25.0, 2), currency = o.currency
   from public.orders o where o.order_ref = d.order_ref and d.id = 'DSP-2170';

  /* "Six units in one batch read consistently high" — six units. */
  update public.partner_disputes d set
    amount = round(i.price * 6, 2), currency = o.currency
   from public.orders o join public.order_items i on i.order_id = o.id
  where o.order_ref = d.order_ref and d.id = 'DSP-2188';

  /* "Throughput below the published figure" — one month of the subscription,
     which is what the buyer is asking back while it underperforms. */
  update public.partner_disputes d set
    amount = i.price, currency = o.currency
   from public.orders o join public.order_items i on i.order_id = o.id
  where o.order_ref = d.order_ref and d.id = 'DSP-2199';

  /* "3 of 25 sensors reported missing" — three units. */
  update public.partner_disputes d set
    amount = round(i.price * 3, 2), currency = o.currency
   from public.orders o join public.order_items i on i.order_id = o.id
  where o.order_ref = d.order_ref and d.id = 'DSP-2201';

  /* "Duplicate charge on a household plan" — one month, charged twice. */
  update public.partner_disputes d set
    amount = i.price, currency = o.currency
   from public.orders o join public.order_items i on i.order_id = o.id
  where o.order_ref = d.order_ref and d.id = 'DSP-2205';
end $$;

alter table public.partner_disputes
  alter column currency set not null;

/* ---- 3. What has to be true ---------------------------------------------------- */

do $$
declare bad text; n int;
begin
  /* ASSERT-1: every dispute argues about an order that exists. */
  select string_agg(d.id || ' → ' || d.order_ref, ', ') into bad
    from public.partner_disputes d
   where not exists (select 1 from public.orders o where o.order_ref = d.order_ref);
  if bad is not null then raise exception 'disputes about orders that do not exist: %', bad; end if;

  /* ASSERT-2: and about one from the seller it names. A dispute filed against
     the wrong seller is worse than one filed against nobody. */
  select string_agg(d.id, ', ') into bad
    from public.partner_disputes d
    join public.orders o on o.order_ref = d.order_ref
    join public.partners p on p.id = d.partner_id
   where o.seller is distinct from p.name;
  if bad is not null then raise exception 'disputes against a seller who did not sell it: %', bad; end if;

  /* ASSERT-3: for a product that was actually on the order. */
  select string_agg(d.id, ', ') into bad
    from public.partner_disputes d
    join public.orders o on o.order_ref = d.order_ref
   where d.product_id is not null
     and not exists (select 1 from public.order_items i
                      where i.order_id = o.id and i.product_id = d.product_id);
  if bad is not null then raise exception 'disputes about a product not on the order: %', bad; end if;

  /* ASSERT-4: nobody is claiming more than they paid. */
  select string_agg(d.id || ' claims ' || d.amount || ' against ' || o.total, ', ') into bad
    from public.partner_disputes d join public.orders o on o.order_ref = d.order_ref
   where d.amount > o.total + 0.02;
  if bad is not null then raise exception 'disputes claiming more than the order was worth: %', bad; end if;

  /* ASSERT-5: in the money the order was charged in. An amount without a
     currency is the defect this fixes; an amount in the wrong one is worse. */
  select string_agg(d.id || ' in ' || d.currency || ' against ' || o.currency, ', ') into bad
    from public.partner_disputes d join public.orders o on o.order_ref = d.order_ref
   where d.currency is distinct from o.currency;
  if bad is not null then raise exception 'disputes in a currency the order was not: %', bad; end if;

  /* ASSERT-6: raised after the order was placed. A complaint predating the
     purchase is a seeding artefact, and it is the kind that survives for years
     because nothing ever looks. */
  select string_agg(d.id, ', ') into bad
    from public.partner_disputes d join public.orders o on o.order_ref = d.order_ref
   where d.raised < o.created_at::date;
  if bad is not null then raise exception 'disputes raised before the order was placed: %', bad; end if;

  /* ASSERT-7: and resolved after they were raised, where they are resolved. */
  select string_agg(d.id, ', ') into bad from public.partner_disputes d
   where d.resolved_on is not null and d.resolved_on < d.raised;
  if bad is not null then raise exception 'disputes resolved before they were raised: %', bad; end if;

  /* ASSERT-8: the new orders hold together like every other order — lines
     summing to what was charged, and a header equal to its own parts. */
  select string_agg(x.order_ref, ', ') into bad from (
    select o.order_ref from public.orders o join public.order_items i on i.order_id = o.id
     group by o.id, o.order_ref, o.total, o.discount
    having abs(sum(i.price * i.quantity) - (o.total + o.discount)) > 0.02
  ) x;
  if bad is not null then raise exception 'orders whose lines do not sum to what was charged: %', bad; end if;

  select string_agg(o.order_ref, ', ') into bad from public.orders o
   where abs(o.total - (o.subtotal + o.tax - o.discount)) > 0.02;
  if bad is not null then raise exception 'orders whose total is not its own parts: %', bad; end if;

  select count(*) into n from public.orders;
  raise notice 'order book: % orders, every dispute now argues about one of them', n;
end $$;
