-- `orders.seller` holds one name, and two orders on the marketplace span two.
--
-- ORD-882091 is SmartBuild's retail-estate rollout: ninety Nimbus occupancy
-- sensors and four Volta gateways, one requisition, one order. The column says
-- "Nimbus Sensors", so half the order is attributed to a seller who did not
-- sell it — and the refund against it, RFN-3240, is recovered from that seller's
-- settlement.
--
-- ORD-62583026 is worse and newer: the checkout wrote
-- "Aventa Telecom, ClearVault Cloud" into the column, which is not a seller at
-- all. The comment above that line said "every basket here is single-seller in
-- practice", which was true of the seeded data and false of the first basket
-- anybody actually filled. `catalogueIntegrity.integration.test.ts` caught it
-- the same afternoon.
--
-- Two different problems with one shape. The retail one is fixed in
-- `Checkout.tsx`, which now places one order per seller — settlement is per
-- seller, a refund is recovered from the seller whose product it was, and a
-- statement is one seller's lines, so an order spanning two is not a thing the
-- rest of the marketplace can act on.
--
-- A business requisition genuinely can span sellers, though: "ninety sensors
-- and four gateways" is one purchase and one approval, and splitting it would
-- split the approval too. So the column means what it says and admits it cannot
-- always say it: one seller, or NULL where the order spans several. NULL is the
-- honest answer; a name that is only half true is not.

comment on column orders.seller is
  'The single seller this order is against, or NULL where it spans several — which a business requisition can. Never a joined list: settlement, refunds and statements are all per seller, and none of them can act on "A, B".';

/* The business order that really does span sellers. */
update orders o set seller = null
 where exists (
   select 1 from order_items i join products p on p.id = i.product_id
    where i.order_id = o.id
    group by i.order_id having count(distinct p.seller) > 1);

/* And any order left naming a seller that is not the one who sold its lines —
   the half-true case, which is the one nothing downstream can detect. */
update orders o set seller = x.only
  from (
    select i.order_id, min(p.seller) as only
      from order_items i join products p on p.id = i.product_id
     group by i.order_id having count(distinct p.seller) = 1
  ) x
 where x.order_id = o.id and o.seller is distinct from x.only;

/* --------------------------------------------------------------- the guard -- */

/* Written on `order_items` rather than on `orders`, because the order is
   inserted first and empty — at that moment there is nothing to disagree with.
   The lines are what make an order multi-seller, so the lines are where it is
   caught. */
create or replace function guard_order_seller()
returns trigger language plpgsql security definer set search_path = public as $$
declare named text; sold text;
begin
  if current_persona() is null then return new; end if;

  select o.seller into named from orders o where o.id = new.order_id;
  /* NULL is the marketplace saying "this one spans sellers", which is allowed
     and is exactly what the column above is for. */
  if named is null then return new; end if;

  select p.seller into sold from products p where p.id = new.product_id;
  if sold is null then return new; end if;

  if named is distinct from sold then
    raise exception 'This order is against %, so a line sold by % cannot go on it. Place it as its own order.', named, sold;
  end if;
  return new;
end $$;

drop trigger if exists guard_order_seller_trg on order_items;
create trigger guard_order_seller_trg before insert or update on order_items
  for each row execute function guard_order_seller();

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* An order naming a seller is an order every line of which that seller sold. */
  select string_agg(o.order_ref || ' says ' || o.seller || ', lines sold by ' || x.sellers, '; ') into s
    from orders o
    join lateral (
      select string_agg(distinct p.seller, ' and ') as sellers
        from order_items i join products p on p.id = i.product_id
       where i.order_id = o.id
    ) x on true
   where o.seller is not null and x.sellers is not null and x.sellers <> o.seller;
  if s is not null then raise exception 'these orders name the wrong seller: %', s; end if;

  /* And nothing holds a joined list, which is the failure that started this. */
  select string_agg(order_ref || ': ' || seller, '; ') into s
    from orders where seller like '%, %';
  if s is not null then raise exception 'these orders name several sellers in one field: %', s; end if;

  /* A NULL seller is a claim that the order really does span sellers. An order
     with one seller and NULL in the column is not honest, it is empty. */
  select string_agg(o.order_ref, ', ') into s
    from orders o
    join lateral (
      select count(distinct p.seller) as n
        from order_items i join products p on p.id = i.product_id
       where i.order_id = o.id
    ) x on true
   where o.seller is null and x.n = 1;
  if s is not null then raise exception 'these orders have one seller but do not name them: %', s; end if;

  /* It had orders with lines to check. An order with no items passes every
     assertion above by having nothing to disagree with. */
  select count(*) into n from orders o
   where exists (select 1 from order_items i where i.order_id = o.id);
  if n < 10 then raise exception 'only % orders have any lines, so this checked almost nothing', n; end if;
end $$;
