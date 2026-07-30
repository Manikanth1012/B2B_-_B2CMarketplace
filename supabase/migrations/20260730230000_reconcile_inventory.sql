-- Inventory, reconciled with the catalogue it is supposed to be counting.
--
-- `operator_inventory` described its stock entirely in free text, and none of it
-- resolved. It counted 450 units of "K9 Pro 5G Smartphone" from "TechDyne
-- Devices" — neither of which exists. The catalogue's phone is "Kestrel K9 Pro
-- 256 GB" from Kestrel Devices, and the two records had no way of knowing they
-- were about the same object. Every column that pointed at something pointed at
-- it by name:
--
--   product_name   → nothing. Eight rows, none of them a catalogue product.
--   partner_name   → nothing. "TechDyne Devices", "Nimbus IoT Solutions" and
--                    "Sentinel Cyber Systems" are not partners.
--   category       → 'Device', where the categories table says 'device'.
--   warehouse      → matched operator_warehouses.name by luck, not by key.
--
-- Four more disagreements underneath those:
--
--   `available` was stored independently of on_hand − reserved, so the two could
--   drift and the screen recomputed it in a form handler rather than reading it.
--
--   `unit_cost` held the only cost figures in the database, while
--   `products.cost` was 0 for all 41 products. One fact, two places, one empty.
--
--   `products.stock` ('in' / 'low' / 'out') is what a buyer sees, and nothing
--   connected it to the numbers the warehouse holds. A product could be 'in
--   stock' on the storefront and zero in the ledger.
--
--   Rows existed for things that have no warehouse stock at all: two eSIM plans,
--   a provisioned firewall, and "StreamNova Access Codes" in a "Digital
--   (virtual)" warehouse that is not in operator_warehouses. A physical count of
--   an eSIM is not a number anybody can take.
--
-- The rows are rebuilt from the catalogue rather than repaired, because there
-- was nothing to repair them against — the eight names do not map onto SKUs, and
-- inventing a mapping would preserve the fiction with a foreign key on top.

/* ------------------------------------------------- warehouses first ------- */

-- `categories` on a warehouse is which marketplaces it serves, and it was free
-- text that had already drifted ('Device' against the catalogue's 'device').
-- Held as category ids so the two cannot disagree, and checked below.
update operator_warehouses set categories = (
  select coalesce(array_agg(c.id order by c.sort_order), '{}')
  from categories c
  where lower(c.name) = any (select lower(x) from unnest(operator_warehouses.categories) x)
     or lower(c.name) || 's' = any (select lower(x) from unnest(operator_warehouses.categories) x)
     or lower(c.id) = any (select lower(x) from unnest(operator_warehouses.categories) x)
);

do $$
declare bad text;
begin
  select string_agg(w.name || ' → ' || x, ', ') into bad
  from operator_warehouses w, unnest(w.categories) x
  where not exists (select 1 from categories c where c.id = x);
  if bad is not null then
    raise exception 'warehouse serves a category that does not exist: %', bad;
  end if;
end $$;

/* ------------------------------------------------------- inventory -------- */

alter table operator_inventory
  add column if not exists product_id   text references products(id) on delete cascade,
  add column if not exists warehouse_id text references operator_warehouses(id) on delete restrict;

-- Nothing survives the rebuild: the eight rows name products and sellers that do
-- not exist, so there is no row to carry forward.
delete from operator_inventory;

alter table operator_inventory
  drop column if exists product_name,
  drop column if exists partner_name,
  drop column if exists category,
  drop column if exists warehouse;

alter table operator_inventory
  alter column product_id   set not null,
  alter column warehouse_id set not null;

/* One line per product per warehouse. Two lines for the same SKU in the same
   place are two answers to "how many have we got". */
create unique index if not exists operator_inventory_product_warehouse_idx
  on operator_inventory(product_id, warehouse_id);

/* Available is not a third number to keep in step — it is the other two,
   subtracted. Generated, so the ledger and the form cannot hold different
   opinions about it and no write can set it wrong. */
alter table operator_inventory drop column if exists available;
alter table operator_inventory
  add column available integer generated always as (on_hand - reserved) stored;

/* Reserving stock nobody has is the arithmetic this table exists to prevent. */
alter table operator_inventory drop constraint if exists operator_inventory_reserved_ck;
alter table operator_inventory
  add constraint operator_inventory_reserved_ck
  check (reserved >= 0 and on_hand >= 0 and reserved <= on_hand);

-- Every shippable SKU, in a warehouse that serves its category.
--
-- Costs are a plausible fraction of price rather than the old figures, two of
-- which were impossible: the 25-sensor cold-chain pack was costed at $890 while
-- 25 individual sensors cost $1,400, so the marketplace was recorded as making a
-- loss on every single sensor it sold loose.
insert into operator_inventory (
  id, product_id, warehouse_id, on_hand, reserved, reorder_point,
  inbound, inbound_due, unit_cost, last_count, sort_order
)
values
  -- Devices
  ('inv-4001', 'SKU-4001', 'wh-001', 450, 120, 100,  200, '2026-08-05',  520.00, '2026-07-20',  1),
  ('inv-4002', 'SKU-4002', 'wh-001', 620, 140, 150,    0, null,          232.00, '2026-07-20',  2),
  -- Low: 65 available against a reorder point of 80. The storefront badge below
  -- is derived from exactly this, rather than set beside it.
  ('inv-4003', 'SKU-4003', 'wh-001',  95,  30,  80,  300, '2026-08-14',  108.00, '2026-07-20',  3),
  ('inv-4004', 'SKU-4004', 'wh-003', 310,  60,  80,    0, null,          152.00, '2026-07-15',  4),
  ('inv-4005', 'SKU-4005', 'wh-001', 890, 210, 200,    0, null,          180.00, '2026-07-20',  5),
  ('inv-4006', 'SKU-4006', 'wh-001', 240,  55,  60,    0, null,          186.00, '2026-07-20',  6),
  -- A listing still in catalogue review. Stock arrives before approval does, so
  -- the line exists; nothing is on sale until the listing clears.
  ('inv-4007', 'SKU-4007', 'wh-001', 120,   0,  40,    0, null,           92.00, '2026-07-24',  7),
  -- Out: nothing on hand, and the inbound date is what the storefront's
  -- "waiting for stock" alerts resolve against.
  ('inv-4008', 'SKU-4008', 'wh-001',   0,   0, 200, 2000, '2026-08-08',   17.00, '2026-07-22',  8),
  -- IoT
  ('inv-5003', 'SKU-5003', 'wh-002', 480,  90, 120,    0, null,           56.00, '2026-07-18',  9),
  ('inv-5004', 'SKU-5004', 'wh-002', 350,  60, 100,    0, null,           34.00, '2026-07-18', 10),
  ('inv-5005', 'SKU-5005', 'wh-002', 260,  40,  80,    0, null,           62.00, '2026-07-18', 11),
  ('inv-5006', 'SKU-5006', 'wh-002', 120,  45,  50,  100, '2026-08-10', 1640.00, '2026-07-18', 12),
  ('inv-5007', 'SKU-5007', 'wh-002',  68,  20,  60,  150, '2026-08-06',  124.00, '2026-07-18', 13),
  ('inv-5008', 'SKU-5008', 'wh-002',  45,  12,  15,    0, null,         3200.00, '2026-07-18', 14)
on conflict (id) do nothing;

/* --------------------------------------------- one fact, one place -------- */

-- The only cost figures in the database were on the inventory line, and
-- `products.cost` was zero everywhere — which made the catalogue's margin column
-- read 100% on every row. Cost belongs to the product; the inventory line is
-- where it was measured.
update products p
set cost = i.unit_cost
from operator_inventory i
where i.product_id = p.id;

-- The badge a buyer reads, derived from the numbers the warehouse holds rather
-- than set alongside them. Out when there is none; low when what is left would
-- trigger a reorder; in otherwise.
update products p
set stock = case
  when i.available = 0 then 'out'
  when i.available <= i.reorder_point then 'low'
  else 'in'
end
from operator_inventory i
where i.product_id = p.id;

/* --------------------------------------------------------- assertions ----- */

do $$
declare bad text; n integer;
begin
  -- A warehouse count of something that is never shipped is a number nobody can
  -- take. eSIMs, provisioned services and instant digital goods have no stock.
  select string_agg(p.id || ' (' || p.fulfil || ')', ', ') into bad
  from operator_inventory i join products p on p.id = i.product_id
  where p.fulfil <> 'shipped';
  if bad is not null then
    raise exception 'inventory holds a line for something that is not shipped: %', bad;
  end if;

  -- …and every shipped product a buyer can order has one, or the storefront is
  -- selling something no warehouse is counting.
  select string_agg(p.id, ', ') into bad
  from products p
  where p.fulfil = 'shipped' and p.status = 'live'
    and not exists (select 1 from operator_inventory i where i.product_id = p.id);
  if bad is not null then
    raise exception 'shipped product on sale with no stock line: %', bad;
  end if;

  -- Stock is held where the warehouse actually serves that marketplace.
  select string_agg(p.id || ' in ' || w.name, ', ') into bad
  from operator_inventory i
  join products p on p.id = i.product_id
  join operator_warehouses w on w.id = i.warehouse_id
  where not (p.category_id = any (w.categories));
  if bad is not null then
    raise exception 'stock held in a warehouse that does not serve its category: %', bad;
  end if;

  -- Forward stock does not sit in a returns centre.
  select string_agg(i.id, ', ') into bad
  from operator_inventory i join operator_warehouses w on w.id = i.warehouse_id
  where w.type = 'returns';
  if bad is not null then
    raise exception 'forward stock held in a returns centre: %', bad;
  end if;

  -- The badge on the storefront and the ledger agree, by construction.
  select string_agg(p.id || ': ' || p.stock, ', ') into bad
  from products p join operator_inventory i on i.product_id = p.id
  where p.stock <> case
    when i.available = 0 then 'out'
    when i.available <= i.reorder_point then 'low'
    else 'in' end;
  if bad is not null then
    raise exception 'storefront stock badge contradicts the ledger: %', bad;
  end if;

  -- Nothing is stocked at or above what it sells for.
  select string_agg(p.id, ', ') into bad
  from products p join operator_inventory i on i.product_id = p.id
  where p.cost >= p.price;
  if bad is not null then
    raise exception 'product costs at least as much as it sells for: %', bad;
  end if;

  select count(*) into n from operator_inventory;
  if n <> 14 then
    raise exception 'expected 14 stock lines, found %', n;
  end if;
end $$;
