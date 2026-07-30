-- Point the order history at the real catalogue.
--
-- Every one of the seven `order_items` rows named a product that `products` does not
-- agree with, because `product_id` was seeded without reference to the catalogue and
-- nothing enforced it:
--
--   SKU-4001  order: "Aegis Screen Cover", Aegis Assurance
--             catalogue: "Kestrel K9 Pro 256 GB", Kestrel Devices
--   SKU-5001  order: "Nimbus sensor pack" $42, Nimbus Sensors
--             catalogue: "IoT Connect 500 MB" $1.40, Aventa Telecom
--
-- Not even the seller matched. Following a product id out of an order landed on an
-- unrelated row, and the consumer's own order history named products no visitor
-- could find in the catalogue.
--
-- **What is wrong here is only `product_id`.** The order narrative itself is coherent
-- and, crucially, *shared*: `consumer_refunds` refunds the same item names for the
-- same amounts, and `loyalty_ledger` awards points against the same order refs. So
-- this migration re-points the identity and leaves every monetary figure alone.
--
-- Prices are deliberately NOT aligned to today's catalogue. `order_items.price` is a
-- historical snapshot — that is why the column exists rather than the price being
-- read through the join — and rewriting it would invalidate the order totals, the
-- refund amounts and the loyalty points already awarded against them.

-- ---------------------------------------------------------------------------
-- The mapping, curated rather than joined
-- ---------------------------------------------------------------------------
-- Matched on product identity — name and seller — not on price:
--
--   Travel Cover Lite      -> SKU-2005  exact name, exact seller (Aegis Assurance)
--   PlayForge Season Pass  -> SKU-3004  exact name, exact seller (PlayForge Games)
--   Kestrel K7 handset     -> SKU-4003  "Kestrel K7 64 GB", the K7, Kestrel Devices
--   Aegis Screen Cover     -> SKU-2004  "Device Protect — screen and theft" is the
--                                       only screen-protection product Aegis sells
--   Nimbus sensor pack     -> SKU-5004  **the one judgement call.** Nimbus sells three
--                                       sensors and none is priced $42; the Occupancy
--                                       sensor at $52 is the closest single unit. The
--                                       cold-chain starter is a 25-sensor pack at
--                                       $2450, which the order plainly is not.

create temporary table order_item_map (order_ref text, sku text) on commit drop;
insert into order_item_map values
  ('ORD-880451', 'SKU-2005'),
  ('ORD-880788', 'SKU-4003'),
  ('ORD-880912', 'SKU-2004'),
  ('ORD-881044', 'SKU-5004'),
  ('ORD-881204', 'SKU-4003'),
  ('ORD-881311', 'SKU-3004'),
  ('ORD-881433', 'SKU-2004');

-- Fail loudly rather than silently skipping a row if the catalogue moves under us.
do $$
declare missing text;
begin
  select string_agg(m.sku, ', ') into missing
  from order_item_map m where not exists (select 1 from products p where p.id = m.sku);
  if missing is not null then
    raise exception 'order item mapping points at missing products: %', missing;
  end if;
end $$;

update order_items i
   set product_id   = m.sku,
       product_name = p.name
  from orders o, order_item_map m, products p
 where o.id = i.order_id
   and o.order_ref = m.order_ref
   and p.id = m.sku;

-- `consumer_refunds` names the same items back to the consumer, so it has to follow
-- or the Refunds tab contradicts the Orders tab. The amounts are untouched — a refund
-- is for what was actually paid. The "(2nd)" qualifier distinguishes the two Kestrel
-- refunds and is preserved.
update consumer_refunds r
   set item = p.name || case when r.item like '%(2nd)%' then ' (2nd)' else '' end
  from order_item_map m, products p
 where r.order_ref = m.order_ref
   and p.id = m.sku;

-- ---------------------------------------------------------------------------
-- Stop it drifting again
-- ---------------------------------------------------------------------------
-- There was no foreign key, which is why seven rows could point at nothing in
-- particular. `on delete restrict`: a product that has been ordered is part of
-- somebody's history and must not be deletable out from under it.
-- `cart_items` already had one; `order_items` and `subscriptions` did not.
do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('order_items',   'restrict'),
      ('cart_items',    'cascade'),
      ('subscriptions', 'restrict')
    ) as v(tbl, on_delete)
  loop
    if not exists (
      select 1 from pg_constraint
      where conrelid = format('public.%I', t.tbl)::regclass
        and contype = 'f'
        and conname = format('%s_product_id_fkey', t.tbl)
    ) then
      execute format(
        'alter table public.%I add constraint %I foreign key (product_id) references products(id) on delete %s',
        t.tbl, t.tbl || '_product_id_fkey', t.on_delete);
    end if;
  end loop;
end $$;

create index if not exists order_items_product_id_idx   on order_items (product_id);
create index if not exists subscriptions_product_id_idx on subscriptions (product_id);
