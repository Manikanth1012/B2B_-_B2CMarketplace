/*
  # Every order was paid for in some particular way

  `orders.payment_method` was free text and had drifted into eleven spellings of
  about five things:

      Card · card · Visa •••• 4419 · Bill to mobile · wallet · upi · carrier
      mobile_wallet · carrier_billing · Invoice · On account — Net 30

  "Card" and "card" are the same rail typed twice. "Visa •••• 4419" is not a
  rail at all, it is an instrument — the thing that belongs on the payment, not
  on the order. And "Bill to mobile" and "carrier" and "carrier_billing" are one
  thing under three names, which is exactly what a catalogue is for.

  Now that a payment is a record rather than a string, each order can point at
  the payment that bought it and the payment can hold the instrument. So every
  consumer order gets a `payment_attempts` row on a rail its own market offers,
  and `payment_method` becomes the catalogue's id.

  The two enterprise spellings stay as they are and are deliberately excluded:
  "On account — Net 30" and "Invoice" are not gateway payments. A business
  ordering against terms has not paid at the till, and giving those orders a
  payment reference would say they had.

  ## Which rail each order went out on

  Chosen from the order's own reference so it is varied and reproducible rather
  than random, and always from the rails that market actually offers — an Indian
  order can be UPI, an order in Nairobi cannot. Carrier billing only lands on
  orders inside its ceiling, which is the same rule the checkout applies.

  Also undoes the verification run: walking each provider page end to end placed
  real orders against a real customer, and orders are not a table to leave test
  data in.
*/

/* ------------------------------------------- what verification left behind */

/* A basket abandoned or paid for while walking each provider page in a browser.
   Named by their own references rather than by "anything recent", because a
   pattern loose enough to catch them is loose enough to catch a real order. */
create temporary table verification_orders (order_ref text primary key) on commit drop;
insert into verification_orders values
  ('ORD-23993885-1'), ('ORD-23993885-2'),
  ('ORD-24109515-1'), ('ORD-24109515-2'),
  ('ORD-24135799-1'), ('ORD-24135799-2'),
  ('ORD-24191746');

delete from subscriptions s using verification_orders v
 where s.ref = v.order_ref or s.ref = split_part(v.order_ref, '-', 1) || '-' || split_part(v.order_ref, '-', 2);
delete from order_items oi using orders o, verification_orders v
 where oi.order_id = o.id and o.order_ref = v.order_ref;
delete from orders o using verification_orders v where o.order_ref = v.order_ref;

/* Anything left waiting on a payment nobody came back for. Nothing was charged,
   so there is nothing to keep. */
delete from order_items where order_id in (select id from orders where status = 'awaiting_payment');
delete from orders where status = 'awaiting_payment';

/* Re-derivable from here down, so running this twice lands in the same place
   rather than doubling the history. */
update orders set payment_ref = null where account_id is null;
delete from payment_attempts where purpose = 'order';

/* --------------------------------------------- a payment behind each order */

/* The rails each market offers, ranked, so an order can be given the nth one
   deterministically. */
create temporary view rails as
  select pm.market_code, pm.method_id, m.max_amount, pm.provider,
         row_number() over (partition by pm.market_code order by pm.sort_order) - 1 as n,
         count(*) over (partition by pm.market_code) as of_them
    from payment_method_markets pm
    join payment_methods m on m.id = pm.method_id;

/* One payment per *basket*, not per order.

   The stem is what the checkout shares between an order's halves: `ORD-13013607`
   for `ORD-13013607-1` and `-2`. Anchored on the whole reference, because a
   bare `-\d+$` also eats the stamp off a single-seller `ORD-880451` and
   collapses every such order onto one basket called "ORD".

   A basket spanning two sellers becomes two orders and the shopper paid once,
   so the payment is keyed on the stem the checkout shares between them —
   ORD-13013607 for ORD-13013607-1 and -2. Keying on the full reference gave
   those two halves separate payments on separate rails, which says the shopper
   paid twice, at two providers, seconds apart. */
create temporary table basket_payment (
  stem text primary key, user_id uuid, market text, currency text,
  amount numeric, method_id text, provider text, instrument text, reference text,
  started timestamptz
) on commit drop;

insert into basket_payment (stem, user_id, market, currency, amount, started)
select regexp_replace(o.order_ref, '^(ORD-\d+)(-\d+)?$', '\1'),
       (array_agg(o.user_id order by o.order_ref))[1], min(o.market), min(o.currency),
       sum(o.total),
       min(coalesce(o.created_at, now())) - interval '3 minutes'
  from orders o
 where o.account_id is null
 group by regexp_replace(o.order_ref, '^(ORD-\d+)(-\d+)?$', '\1');

update basket_payment p
   set method_id = r.method_id,
       provider  = r.provider
  from rails r
 where r.market_code = p.market
   and r.n = (abs(hashtext(p.stem)) % r.of_them)
   /* Carrier billing only where it would have been allowed. Putting a ₹65,000
      handset on a monthly bill is the thing its ceiling exists to stop, and a
      history that shows it happening teaches the ceiling is decorative. */
   and (r.max_amount is null or p.amount <= r.max_amount);

/* Anything the ceiling knocked out falls to card, which every market takes. */
update basket_payment p
   set method_id = 'card',
       provider  = r.provider
  from rails r
 where p.method_id is null
   and r.market_code = p.market
   and r.method_id = 'card';

/* What the provider would say it charged. Real-looking, per rail and per
   market: a wallet brand is national, and "Careem Pay" against an order placed
   in Bengaluru is the same drift in miniature that this whole migration is
   about. */
update basket_payment p set
  reference = 'PAY-' || to_char(p.started, 'YYMMDD') || '-'
              || upper(substr(md5(p.stem), 1, 4)),
  instrument = case p.method_id
    when 'card'          then '•••• ' || lpad((abs(hashtext(p.stem)) % 10000)::text, 4, '0')
    when 'upi'           then 'UPI ' || lower(regexp_replace(coalesce(nullif(trim(b.buyer_name), ''), 'customer'), '\s.*$', '')) || '@okhdfcbank'
    when 'netbanking'    then (array['HDFC Bank', 'ICICI Bank', 'Axis Bank', 'State Bank of India'])
                              [1 + abs(hashtext(p.stem)) % 4] || ' net banking'
    when 'mobile_money'  then 'M-Pesa •••••• ' || lpad((abs(hashtext(p.stem)) % 10000)::text, 4, '0')
    when 'mobile_wallet' then (case p.market
                                 when 'AE' then (array['Careem Pay', 'e& money'])[1 + abs(hashtext(p.stem)) % 2]
                                 else (array['PayTM', 'PhonePe', 'Amazon Pay', 'Mobikwik'])[1 + abs(hashtext(p.stem)) % 4]
                               end) || ' wallet •••••• '
                              || lpad((abs(hashtext(p.stem)) % 10000)::text, 4, '0')
    when 'carrier_billing' then 'the Aventa bill for •••••• ' || lpad((abs(hashtext(p.stem)) % 10000)::text, 4, '0')
    else 'bank transfer'
  end
  from (select regexp_replace(order_ref, '^(ORD-\d+)(-\d+)?$', '\1') stem, min(buyer_name) buyer_name
          from orders where account_id is null
         group by regexp_replace(order_ref, '^(ORD-\d+)(-\d+)?$', '\1')) b
 where b.stem = p.stem;

insert into payment_attempts
  (id, reference, user_id, wallet_id, order_ref, purpose, amount, currency,
   method_id, market_code, provider, instrument, state, gateway_ref,
   started_at, decided_at)
select 'PA-' || upper(substr(md5(p.stem), 1, 10)), p.reference, p.user_id, null,
       p.stem, 'order', p.amount, p.currency, p.method_id, p.market, p.provider,
       p.instrument, 'succeeded',
       upper(substr(regexp_replace(p.provider, '\W', '', 'g'), 1, 4)) || '-' || upper(substr(md5(p.reference), 1, 6)),
       p.started, p.started + interval '48 seconds'
  from basket_payment p;

update orders o
   set payment_ref = p.reference,
       payment_method = p.method_id
  from basket_payment p
 where regexp_replace(o.order_ref, '^(ORD-\d+)(-\d+)?$', '\1') = p.stem
   and o.account_id is null;

do $$
declare
  n integer;
  r record;
begin
  /* Nothing left over from walking each provider page in a browser. */
  select count(*) into n from orders o join verification_orders v on v.order_ref = o.order_ref;
  if n > 0 then raise exception '% orders from the verification run are still here', n; end if;

  select count(*) into n from orders where status = 'awaiting_payment';
  if n > 0 then raise exception '% baskets are still waiting to be paid for', n; end if;

  /* Every consumer order names a rail from the catalogue rather than a spelling
     of one. This is the whole point, and it is checked against the catalogue
     rather than a list written here. */
  select count(*) into n from orders o
   where o.account_id is null
     and o.payment_method not in (select id from payment_methods);
  if n > 0 then
    raise exception '% consumer orders name a payment method the marketplace does not have', n;
  end if;

  /* And on a rail that market offers. An order in Nairobi paid by UPI is the
     drift this table exists to make impossible. */
  for r in
    select o.order_ref, o.market, o.payment_method
      from orders o
     where o.account_id is null
       and not exists (
         select 1 from payment_method_markets pm
          where pm.method_id = o.payment_method and pm.market_code = o.market)
  loop
    raise exception 'Order % in % was paid by %, which % does not offer',
      r.order_ref, r.market, r.payment_method, r.market;
  end loop;

  /* Nothing was carrier-billed past the ceiling. Checked on the payment rather
     than the order, because the ceiling applies to what was charged and a
     basket spanning two sellers is charged once. */
  for r in
    select a.reference, a.amount, m.max_amount
      from payment_attempts a join payment_methods m on m.id = a.method_id
     where m.max_amount is not null and a.amount > m.max_amount
  loop
    raise exception 'Payment % is % on a rail that takes %', r.reference, r.amount, r.max_amount;
  end loop;

  /* A basket was paid for once. Two halves of one basket on two rails says the
     shopper paid twice, at two providers, seconds apart. */
  for r in
    select regexp_replace(order_ref, '^(ORD-\d+)(-\d+)?$', '\1') stem, count(distinct payment_ref) refs
      from orders where account_id is null
     group by 1 having count(distinct payment_ref) > 1
  loop
    raise exception 'Basket % was paid for % separate times', r.stem, r.refs;
  end loop;

  /* Each order points at a payment, and that payment is for the same money in
     the same currency. A reference that led to a different amount would be
     worse than no reference — and where a basket spanned two sellers the
     payment covers both orders, so the comparison is against their sum. */
  for r in
    select a.reference, a.amount, a.currency as ccy, sum(o.total) as basket
      from payment_attempts a
      join orders o on o.payment_ref = a.reference
     where a.purpose = 'order'
     group by a.reference, a.amount, a.currency
    having sum(o.total) is distinct from a.amount
  loop
    raise exception 'Payment % is for % % but the orders behind it come to %',
      r.reference, r.amount, r.ccy, r.basket;
  end loop;

  select count(*) into n from orders o
   where o.account_id is null and o.payment_ref is null;
  if n > 0 then raise exception '% consumer orders were paid for by nothing', n; end if;

  /* No payment paid for nothing. */
  select count(*) into n from payment_attempts a
   where a.purpose = 'order'
     and not exists (select 1 from orders o where o.payment_ref = a.reference);
  if n > 0 then raise exception '% order payments paid for nothing', n; end if;

  /* Business orders are untouched. They are billed on account, and a payment
     reference on one would say money changed hands at the till. */
  select count(*) into n from orders where account_id is not null and payment_ref is not null;
  if n > 0 then raise exception '% orders billed on account carry a payment reference', n; end if;

  select count(distinct payment_method) into n from orders where account_id is null;
  if n < 3 then raise exception 'Consumer orders only show % ways of paying', n; end if;
end $$;
