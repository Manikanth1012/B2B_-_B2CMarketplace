/* One order cannot be posted and downloaded at once.
 *
 * ORD-77130502 put a Kestrel tablet and a Travel eSIM in the same basket. Both
 * things people buy, and buy together — a tablet and the data plan for it is
 * about as natural a pair as this catalogue has.
 *
 * It cannot be represented. An order carries one `stages` ladder, and the two
 * journeys are different all the way down: a tablet is confirmed, dispatched,
 * in transit, delivered; an eSIM is confirmed, provisioning, activating, active.
 * Whichever ladder the order takes, half of what the buyer bought is being
 * described by the wrong one. The previous migration chose the parcel ladder
 * for mixed baskets on the grounds that something really is being posted, and
 * that is defensible right up to the point where the buyer's own screen tells
 * them their eSIM is in transit.
 *
 * The com integration test says so directly, and it is right: "is an eSIM order
 * tracked like a parcel".
 *
 * WHAT THE REAL ANSWER IS, AND WHY IT IS NOT HERE
 *
 * Shipments. A basket is one order and one payment; what leaves the warehouse
 * and what is provisioned are separate fulfilments underneath it, each with its
 * own state. Every marketplace of any size ends up there. It is a schema change
 * touching orders, the order screens, the tracking rail and the com push — a
 * feature, and a sizeable one, not something to slip into a migration whose job
 * was to deepen the seed.
 *
 * So the boundary is recorded as CR-009 and the seed stops writing baskets the
 * model cannot describe. ORD-77130502 keeps its tablet and its second seller —
 * it swaps the eSIM for the travel cover, which is instant rather than posted
 * and does not claim a delivery journey of its own.
 *
 * The assertion is the useful part: it fails the next time anybody writes a
 * basket mixing a posted line with an eSIM, which is a thing that will
 * otherwise look entirely reasonable to whoever writes it.
 */

/* ---- 1. The basket the model can describe --------------------------------------- */

do $$
declare v_order uuid; v_rate numeric; v_lines numeric; v_sub numeric; v_tax numeric;
begin
  select o.id, m.tax_rate into v_order, v_rate
    from public.orders o join public.markets m on m.code = o.market
   where o.order_ref = 'ORD-77130502';
  if v_order is null then
    raise notice 'ORD-77130502 is not here; nothing to correct';
    return;
  end if;

  /* The eSIM out, the travel cover in. Still two sellers — Kestrel and Aegis —
     so the cross-seller basket this order was written for survives. */
  delete from public.order_items where order_id = v_order and product_id = 'SKU-2003';

  insert into public.order_items (
    id, order_id, product_id, product_name, price, quantity, fulfil, status, user_id)
  select gen_random_uuid(), v_order, pr.id, pr.name, pp.price, 1, pr.fulfil, o.status, o.user_id
    from public.orders o
    join public.products pr on pr.id = 'SKU-2005'
    join public.product_prices pp on pp.product_id = pr.id and pp.currency = o.currency
   where o.id = v_order
     and not exists (select 1 from public.order_items i
                      where i.order_id = v_order and i.product_id = 'SKU-2005');

  /* The total follows the lines. Leaving it where it was would be the exact
     defect every arithmetic assertion in this repo exists to catch. */
  select coalesce(sum(i.price * i.quantity), 0) into v_lines
    from public.order_items i where i.order_id = v_order;
  v_sub := round(v_lines / (1 + v_rate / 100), 2);
  v_tax := round(v_lines - v_sub, 2);

  update public.orders
     set total = v_lines, subtotal = v_sub, tax = v_tax, discount = 0
   where id = v_order;

  /* And what it earned, because the total moved. */
  update public.loyalty_ledger l
     set points = floor(o.total * r.earn_per_unit)::int,
         value = round(floor(o.total * r.earn_per_unit)::numeric / r.per_unit, 2)
    from public.orders o
    join public.loyalty_point_rates r on r.currency = o.currency
   where o.id = v_order and l.ref = o.order_ref and l.type = 'earn';
end $$;

/* Any provisioning request for the line that is gone goes with it. */
delete from public.com_event e
 where e.com_order in (
   select c.id from public.com_order c
    where c.order_ref = 'ORD-77130502' and c.product_id = 'SKU-2003');
delete from public.com_order
 where order_ref = 'ORD-77130502' and product_id = 'SKU-2003';

/* ---- 2. The boundary, written down ----------------------------------------------- */

insert into public.channel_rule (id, what, label, decision, sold_through, reason, effective_from, agreed_by, sort_order)
values (
  'CR-009', 'fulfilment', 'A basket mixing posted goods and provisioned service',
  'not operated here',
  'Separate orders, one per fulfilment journey',
  'An order carries one tracking ladder and the two journeys have no rungs in common — a '
  'parcel is dispatched and delivered, a service is provisioned and activated. A basket '
  'holding both would have to describe half of itself wrongly, and the half it gets wrong is '
  'shown to the buyer. Splitting an order into per-fulfilment shipments is the real answer '
  'and is a schema change across orders, the tracking rail and the order manager; until then '
  'a shopper buying a handset and an eSIM together places two orders and pays twice, which is '
  'worse for them and honest on every screen.',
  current_date, 'Ruben Oyelaran', 9)
on conflict (id) do nothing;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text; n int; v_row record;
begin
  /* ASSERT-1: no basket mixes a posted line with an eSIM. The assertion this
     file exists for — it fails on the next one somebody writes, which a fix to
     ORD-77130502 alone would not. */
  select string_agg(o.order_ref, ', ') into bad
    from public.orders o
   where exists (select 1 from public.order_items i
                  where i.order_id = o.id and i.fulfil = 'esim')
     and exists (select 1 from public.order_items i
                  where i.order_id = o.id and i.fulfil in ('shipped', 'ship'));
  if bad is not null then
    raise exception 'baskets mixing a parcel and an eSIM, which one ladder cannot track: %', bad;
  end if;

  /* ASSERT-2: and no eSIM anywhere is on a ladder with a delivery rung on it. */
  select string_agg(o.order_ref, ', ') into bad
    from public.orders o
   where ('In transit' = any(o.stages) or 'Dispatched' = any(o.stages))
     and exists (select 1 from public.order_items i
                  where i.order_id = o.id and i.fulfil = 'esim');
  if bad is not null then raise exception 'eSIMs tracked like parcels: %', bad; end if;

  /* ASSERT-3: the corrected order still adds up, and still spans two sellers —
     the thing it was written to exercise. */
  for v_row in
    select o.order_ref, o.total, o.subtotal, o.tax, o.discount, o.tax_rate,
           (select coalesce(sum(i.price * i.quantity), 0)
              from public.order_items i where i.order_id = o.id) as lines,
           (select count(distinct p.seller) from public.order_items i
              join public.products p on p.id = i.product_id where i.order_id = o.id) as sellers
      from public.orders o where o.order_ref = 'ORD-77130502'
  loop
    if abs(v_row.lines - (v_row.total + v_row.discount)) > 0.01 then
      raise exception '% lines are % and total plus discount is %',
        v_row.order_ref, v_row.lines, v_row.total + v_row.discount;
    end if;
    if abs((v_row.subtotal + v_row.tax) - v_row.lines) > 0.01 then
      raise exception '% subtotal plus tax is %, its lines are %',
        v_row.order_ref, v_row.subtotal + v_row.tax, v_row.lines;
    end if;
    if v_row.sellers < 2 then
      raise exception '% no longer spans two sellers, which is what it was for', v_row.order_ref;
    end if;
  end loop;

  /* ASSERT-4: there are still cross-seller baskets to exercise the split. */
  select count(*) into n from (
    select o.id from public.orders o
      join public.order_items i on i.order_id = o.id
      join public.products p on p.id = i.product_id
     where o.account_id is null
     group by o.id having count(distinct p.seller) > 1) t;
  if n < 5 then raise exception 'only % consumer baskets span more than one seller', n; end if;

  /* ASSERT-5: nothing was orphaned by removing the line — no provisioning
     request survives for an order line that is gone. */
  select string_agg(c.id, ', ') into bad from public.com_order c
   where c.order_item_id is not null
     and not exists (select 1 from public.order_items i where i.id = c.order_item_id);
  if bad is not null then raise exception 'provisioning requests for lines that no longer exist: %', bad; end if;

  /* ASSERT-6: and the boundary is on file. */
  select count(*) into n from public.channel_rule where id = 'CR-009';
  if n <> 1 then raise exception 'the mixed-fulfilment boundary is not written down'; end if;
end $$;
