/*
  # A seller can see the orders they have to fulfil

  `orders` has six policies. The consumer who placed it may read it, the
  enterprise account it belongs to may read it, the operator may read all of
  them. The seller who has to pack the box has no policy at all.

  That is why the seller's Orders screen renders `PARTNER_ORDERS` from
  `data.ts`: six invented orders in dollars, whose stage buttons move a number
  in React state and are gone on reload. "Bulk dispatch" on the same screen is a
  toast, because there was nothing to dispatch.

  1. Reading is by line, not by a seller column
     `orders.seller` is free text and one order — ORD-882091 — has it set to
     null, because it carries lines from two sellers. A seller sees an order
     because they supply a line on it, which is the true relation and the only
     one that works for a mixed basket. Order items are scoped the same way, so
     a seller reads their own lines on a shared order and not the other
     seller's.

  2. Writing is fulfilment, and only fulfilment
     A seller may move `stage`, set `tracking_ref` and `carrier`, mark a failure
     and give its reason, and set `status`. `guard_order_fulfilment` refuses
     everything else from a seller — total, tax, buyer, address, currency,
     account. A seller who can edit `total` has repriced a sale after it was
     paid for.

     They may not touch an order carrying another seller's lines: half the
     order being packed is not the same fact as the order being packed, and one
     seller marking a shared order delivered would tell the buyer their other
     seller's goods had arrived.

  3. Stage may only go forward, and never past the end
     A stage that can be typed backwards is an audit problem — "in transit"
     reverting to "packed" after a customer complained is exactly the edit
     nobody should be able to make quietly. Reversing a stage is the operator's,
     with their audit trail behind it.

  4. Data
     Nimbus Sensors had two orders in the table against six on the screen, and
     none of them awaiting dispatch — so a screen headed "orders to fulfil"
     would have been empty and the dispatch flow untestable. Twelve orders are
     added across the live sellers, in their buyers' own currencies, at stages
     that give every console something true to show: some to pack, some in
     transit, one failed.
*/

/* ---------------------------------------------------------- read access --- */

create policy partner_read_own_orders on orders
  for select to authenticated
  using (
    exists (
      select 1 from order_items i
      join products p on p.id = i.product_id
      where i.order_id = orders.id and p.partner_id = current_partner_id()
    )
  );

create policy partner_read_own_order_items on order_items
  for select to authenticated
  using (
    exists (select 1 from products p where p.id = order_items.product_id and p.partner_id = current_partner_id())
  );

/* --------------------------------------------------------- write access --- */

create or replace function guard_order_fulfilment() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  mine integer;
  theirs integer;
begin
  /* The operator and the buyer have their own policies and their own reasons;
     this guard is about the seller. */
  if current_persona() <> 'partner' then
    return new;
  end if;

  select count(*) filter (where p.partner_id = current_partner_id()),
         count(*) filter (where p.partner_id is distinct from current_partner_id())
    into mine, theirs
    from order_items i join products p on p.id = i.product_id
   where i.order_id = new.id;

  if mine = 0 then
    raise exception 'You supply nothing on %, so it is not yours to fulfil.', old.order_ref;
  end if;
  if theirs > 0 then
    raise exception '% carries another seller''s lines as well as yours. Marking the whole order would speak for them too — the marketplace moves a shared order on when every seller has.',
      old.order_ref;
  end if;

  if new.total is distinct from old.total
     or new.subtotal is distinct from old.subtotal
     or new.tax is distinct from old.tax
     or new.discount is distinct from old.discount
     or new.currency is distinct from old.currency
     or new.market is distinct from old.market
     or new.tax_rate is distinct from old.tax_rate
     or new.buyer_name is distinct from old.buyer_name
     or new.buyer_email is distinct from old.buyer_email
     or new.shipping_address is distinct from old.shipping_address
     or new.account_id is distinct from old.account_id
     or new.user_id is distinct from old.user_id
     or new.order_ref is distinct from old.order_ref
     or new.stages is distinct from old.stages
     or new.payment_method is distinct from old.payment_method
     or new.requisition_id is distinct from old.requisition_id
     or new.invoice_id is distinct from old.invoice_id
  then
    raise exception 'Only how far % has got is yours to change. The money and the buyer are what was agreed at checkout.',
      old.order_ref;
  end if;

  if new.stage < old.stage then
    raise exception '% is already at "%". A stage is not moved backwards — ask the marketplace, which records who did it and why.',
      old.order_ref, old.stages[old.stage + 1];
  end if;
  if new.stage > array_length(new.stages, 1) - 1 then
    raise exception '% has % stages and cannot go past the last of them.',
      old.order_ref, array_length(new.stages, 1);
  end if;

  /* A failure that does not say why is a support ticket somebody else has to
     open to ask. */
  if new.failed and not old.failed and coalesce(trim(new.failed_reason), '') = '' then
    raise exception 'Say what went wrong with %. "Failed" on its own cannot be acted on by anybody.', old.order_ref;
  end if;

  return new;
end $$;

drop trigger if exists guard_order_fulfilment on orders;
create trigger guard_order_fulfilment
  before update on orders
  for each row execute function guard_order_fulfilment();

create policy partner_fulfil_own_orders on orders
  for update to authenticated
  using (
    exists (
      select 1 from order_items i
      join products p on p.id = i.product_id
      where i.order_id = orders.id and p.partner_id = current_partner_id()
    )
  )
  with check (
    exists (
      select 1 from order_items i
      join products p on p.id = i.product_id
      where i.order_id = orders.id and p.partner_id = current_partner_id()
    )
  );

/* ----------------------------------------------------------------- data --- */

/* Twelve orders across the live sellers. Buyers are the people and accounts
   that already exist — a marketplace whose orders name nobody is a marketplace
   with no customers. Every amount is in the buyer's own market currency at that
   market's tax rate: SmartBuild and the retail shopper in rupees at 18% GST,
   Meridian Foods in dirhams at 5% VAT. Converting one to the other would be the
   mistake the per-market price book exists to prevent. */
insert into orders (order_ref, status, total, subtotal, tax, discount, payment_method,
                    buyer_name, buyer_email, created_at, placed_date, seller, vertical,
                    stage, stages, failed, failed_reason, tracking_ref, carrier,
                    currency, market, tax_rate, account_id, ordered_by, cost_centre)
values
  ('ORD-883101', 'processing', 20997, 17794.07, 3202.93, 0, 'Invoice',
   'SmartBuild Ltd', 'vikram.shah@smartbuild.in', now() - interval '2 days', '02 Aug 2026', 'Nimbus Sensors', 'iot',
   1, array['Ordered','Approved','Packed','In transit','Delivered'], false, null, null, null,
   'INR', 'IN', 18, 'ENT-2007', 'EU-2007-01', 'CC-2200'),
  ('ORD-883102', 'processing', 8998, 7625.42, 1372.58, 0, 'Card',
   'Priya Raman', 'priya.raman@example.com', now() - interval '1 days', '03 Aug 2026', 'Nimbus Sensors', 'iot',
   1, array['Ordered','Confirmed','Dispatched','In transit','Delivered'], false, null, null, null,
   'INR', 'IN', 18, null, null, null),
  ('ORD-883103', 'in-transit', 199999, 169490.68, 30508.32, 0, 'Invoice',
   'SmartBuild Ltd', 'vikram.shah@smartbuild.in', now() - interval '6 days', '29 Jul 2026', 'Nimbus Sensors', 'iot',
   3, array['Ordered','Approved','Packed','In transit','Delivered'], false, null, 'TRK-886201', 'Delhivery',
   'INR', 'IN', 18, 'ENT-2007', 'EU-2007-04', 'CC-2200'),
  ('ORD-883104', 'failed', 1156, 1100.95, 55.05, 0, 'Invoice',
   'Meridian Foods', 'omar.haddad@meridianfoods.ae', now() - interval '4 days', '31 Jul 2026', 'Nimbus Sensors', 'iot',
   2, array['Ordered','Approved','Packed','In transit','Delivered'], true, 'Cold-chain sensors were packed without the calibration certificate the buyer''s auditor requires. Repacking.', null, null,
   'AED', 'AE', 5, 'ENT-2012', 'EU-2012-01', 'CC-2012-COLD'),
  ('ORD-883105', 'delivered', 4499, 3812.71, 686.29, 0, 'Card',
   'Priya Raman', 'priya.raman@example.com', now() - interval '20 days', '15 Jul 2026', 'Nimbus Sensors', 'iot',
   4, array['Ordered','Confirmed','Dispatched','In transit','Delivered'], false, null, 'TRK-886044', 'BlueDart',
   'INR', 'IN', 18, null, null, null),
  ('ORD-883106', 'processing', 64999, 55083.9, 9915.1, 0, 'Card',
   'Priya Raman', 'priya.raman@example.com', now() - interval '1 days', '03 Aug 2026', 'Kestrel Devices', 'device',
   1, array['Ordered','Confirmed','Dispatched','In transit','Delivered'], false, null, null, null,
   'INR', 'IN', 18, null, null, null),
  ('ORD-883107', 'in-transit', 30999, 26270.34, 4728.66, 0, 'Card',
   'Priya Raman', 'priya.raman@example.com', now() - interval '5 days', '30 Jul 2026', 'Kestrel Devices', 'device',
   3, array['Ordered','Confirmed','Dispatched','In transit','Delivered'], false, null, 'TRK-886310', 'BlueDart',
   'INR', 'IN', 18, null, null, null),
  ('ORD-883108', 'processing', 31998, 27116.95, 4881.05, 0, 'Invoice',
   'SmartBuild Ltd', 'vikram.shah@smartbuild.in', now() - interval '3 days', '01 Aug 2026', 'Volta Routers', 'iot',
   1, array['Ordered','Approved','Packed','In transit','Delivered'], false, null, null, null,
   'INR', 'IN', 18, 'ENT-2007', 'EU-2007-05', 'CC-4100'),
  ('ORD-883109', 'active', 4198.8, 3998.86, 199.94, 0, 'Invoice',
   'Meridian Foods', 'omar.haddad@meridianfoods.ae', now() - interval '9 days', '26 Jul 2026', 'Sentinel Cyber', 'security',
   4, array['Ordered','Approved','Provisioning','Activated','In service'], false, null, null, 'Digital',
   'AED', 'AE', 5, 'ENT-2012', 'EU-2012-01', 'CC-2012-IT'),
  ('ORD-883110', 'processing', 98820, 83745.76, 15074.24, 0, 'Invoice',
   'SmartBuild Ltd', 'vikram.shah@smartbuild.in', now() - interval '2 days', '02 Aug 2026', 'Sentinel Cyber', 'security',
   2, array['Ordered','Approved','Provisioning','Activated','In service'], false, null, null, 'Digital',
   'INR', 'IN', 18, 'ENT-2007', 'EU-2007-01', 'CC-2200'),
  ('ORD-883111', 'delivered', 1099, 931.36, 167.64, 0, 'Card',
   'Priya Raman', 'priya.raman@example.com', now() - interval '11 days', '24 Jul 2026', 'StreamNova Media', 'content',
   4, array['Ordered','Confirmed','Dispatched','In transit','Delivered'], false, null, null, 'Digital',
   'INR', 'IN', 18, null, null, null),
  ('ORD-883112', 'delivered', 2199, 1863.56, 335.44, 0, 'Card',
   'Priya Raman', 'priya.raman@example.com', now() - interval '16 days', '19 Jul 2026', 'PlayForge Games', 'content',
   4, array['Ordered','Confirmed','Dispatched','In transit','Delivered'], false, null, null, 'Digital',
   'INR', 'IN', 18, null, null, null)
on conflict (order_ref) do nothing;

/* The lines behind them. These are what the seller reads the order through, so
   an order with no line is an order its seller cannot see. */
insert into order_items (order_id, product_id, product_name, price, quantity, fulfil, status)
select o.id, x.product_id, p.name, x.price, x.quantity, p.fulfil, 'ok'
from (values
  ('ORD-883101', 'SKU-5003', 7499::numeric, 2),
  ('ORD-883101', 'SKU-5009', 5999::numeric, 1),
  ('ORD-883102', 'SKU-5004', 4499::numeric, 2),
  ('ORD-883103', 'SKU-5006', 199999::numeric, 1),
  ('ORD-883104', 'SKU-5003', 299::numeric, 3),
  ('ORD-883104', 'SKU-5009', 259::numeric, 1),
  ('ORD-883105', 'SKU-5004', 4499::numeric, 1),
  ('ORD-883106', 'SKU-4001', 64999::numeric, 1),
  ('ORD-883107', 'SKU-4002', 30999::numeric, 1),
  ('ORD-883108', 'SKU-5007', 15999::numeric, 2),
  ('ORD-883109', 'SKU-6002', 34.99::numeric, 120),
  ('ORD-883110', 'SKU-6003', 549::numeric, 180),
  ('ORD-883111', 'SKU-3001', 1099::numeric, 1),
  ('ORD-883112', 'SKU-3004', 2199::numeric, 1)
) as x(ref, product_id, price, quantity)
join orders o on o.order_ref = x.ref
join products p on p.id = x.product_id
where not exists (select 1 from order_items i where i.order_id = o.id and i.product_id = x.product_id);

do $$
declare
  n integer;
  r record;
begin
  /* Every order's seller has to be a seller who supplies a line on it, or the
     seller column and the lines are telling two stories.

     First-party orders are the exception and a real one: `products.partner_id`
     is null on the marketplace's own connectivity, which Aventa Telecom sells
     under its own name with no partner behind it. Those have no seller row to
     match and no seller who could read them either — which is correct, because
     there is none. */
  for r in select o.id, o.order_ref, o.seller from orders o where o.seller is not null loop
    select count(*) into n
      from order_items i join products p on p.id = i.product_id
      left join partners pt on pt.id = p.partner_id
     where i.order_id = r.id
       and (pt.name = r.seller or p.partner_id is null);
    if n = 0 then
      raise exception 'Order % names % as its seller and carries no line of theirs', r.order_ref, r.seller;
    end if;
  end loop;

  /* No order may exist that nobody can see: every one has at least one line. */
  select count(*) into n from orders o
   where not exists (select 1 from order_items i where i.order_id = o.id);
  if n > 0 then
    raise exception '% orders have no lines, so no seller can see them', n;
  end if;

  /* The demo seller needs something to dispatch, or the screen the dispatch
     flow lives on is empty and nothing about it can be checked. */
  select count(*) into n
    from orders o join order_items i on i.order_id = o.id
    join products p on p.id = i.product_id
   where p.partner_id = 'PTR-1004' and not o.failed and o.stage < array_length(o.stages, 1) - 1;
  if n < 2 then
    raise exception 'The demo seller has % orders awaiting dispatch', n;
  end if;

  /* Stage has to be inside the stage list, everywhere. An order at stage 7 of
     5 renders as a blank rail. */
  select count(*) into n from orders
   where stage < 0 or stage > array_length(stages, 1) - 1;
  if n > 0 then
    raise exception '% orders sit at a stage their own stage list does not have', n;
  end if;

  /* A failed order says why. */
  select count(*) into n from orders where failed and coalesce(trim(failed_reason), '') = '';
  if n > 0 then
    raise exception '% failed orders do not say what went wrong', n;
  end if;
end $$;
