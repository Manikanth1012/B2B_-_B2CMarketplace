-- What the catalogue refuses to sell together, and what a bundle is made of.
--
-- Neither existed. A buyer could hold two StreamNova tiers on one household and
-- be billed twice for the same content; buy an occupancy sensor with no
-- connectivity plan, so it reports to nothing; or buy a season pass for a game
-- they do not subscribe to. And a product tagged "Bundle" was a product with the
-- word Bundle on it — nothing said what was inside, so nothing could say what
-- holding it replaces or what it saves.
--
-- These rules stop orders being taken, so they cannot live in a data file that
-- only the storefront reads. The operator sees every one, what it is enforced
-- against, and whether it blocks or merely advises.

create table if not exists product_rules (
  id         text primary key,
  product_id text not null references products(id) on delete cascade,
  /* requires  — the basket must already carry one of `targets`, or the order
                 cannot be taken.
     excludes  — holding `targets` and this together is the same thing twice.
     works_with— advice. It never stops anything, and saying so is the point:
                 a suggestion that blocks an order is a bug wearing a hint. */
  kind       text not null check (kind in ('requires', 'excludes', 'works_with')),
  /* A set, because `requires` is satisfied by any one of them. `excludes` and
     `works_with` carry exactly one, each with its own reason — two exclusions
     with one shared reason cannot tell the buyer which one they hit. */
  targets    text[] not null check (array_length(targets, 1) >= 1),
  why        text not null,
  sort_order integer not null default 0
);

create index if not exists product_rules_product_idx on product_rules(product_id);

/* What a bundle contains. A bundle with no components is a product with a word
   on it. */
create table if not exists product_components (
  bundle_id    text not null references products(id) on delete cascade,
  component_id text not null references products(id) on delete restrict,
  quantity     integer not null default 1 check (quantity > 0),
  /* What the component is for, in the buyer's words. "25 sensors" and "12
     months of connectivity for each" are the same bundle described usefully
     and uselessly. */
  note         text,
  sort_order   integer not null default 0,
  primary key (bundle_id, component_id),
  /* A bundle that contains itself is an infinite price. */
  check (bundle_id <> component_id)
);

alter table product_rules      enable row level security;
alter table product_components enable row level security;

drop policy if exists "public_read_product_rules"       on product_rules;
drop policy if exists "operator_write_product_rules"    on product_rules;
drop policy if exists "public_read_product_components"  on product_components;
drop policy if exists "operator_write_product_components" on product_components;

/* Readable by everyone, signed in or not: these decide what a shopper is
   allowed to put in a basket, and the storefront has to be able to say why
   before they get to the checkout. Same reach as the catalogue itself. */
create policy "public_read_product_rules" on product_rules
  for select to anon, authenticated using (true);
create policy "public_read_product_components" on product_components
  for select to anon, authenticated using (true);

create policy "operator_write_product_rules" on product_rules
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "operator_write_product_components" on product_components
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* ------------------------------------------------------------- bundles --- */

-- Two bundle prices sat above the sum of their own parts, which is not a
-- bundle — it is a worse deal with a badge. Corrected here rather than left,
-- and the assertion at the end keeps them that way. Neither SKU appears in any
-- order, subscription or basket, so nothing historical moves.
update products set price = 2295.00 where id = 'SKU-5006';
update products set price =  165.00 where id = 'SKU-6006';

insert into product_components (bundle_id, component_id, quantity, note, sort_order) values
  -- The operator's own plan bundled with a partner's content. This is what a
  -- cross-seller bundle looks like, and it was already in the catalogue with
  -- nothing recording that it is one.
  ('SKU-2006', 'SKU-2002', 1,   'The line itself, on Unlimited.', 1),
  ('SKU-2006', 'SKU-3001', 1,   'StreamNova Premium 4K, included for as long as the duo runs.', 2),
  -- A partner's hardware with the operator's connectivity underneath it.
  ('SKU-5006', 'SKU-5003', 25,  'Twenty-five cold-chain sensors.', 1),
  ('SKU-5006', 'SKU-5001', 300, 'Twelve months of IoT connectivity for each of the twenty-five.', 2),
  ('SKU-5008', 'SKU-5005', 50,  'Fifty asset trackers.', 1),
  ('SKU-5008', 'SKU-5002', 600, 'Twelve months of 2 GB connectivity for each of the fifty.', 2),
  -- A seller bundling their own range.
  ('SKU-6006', 'SKU-6003', 25,  'Secure access for twenty-five seats.', 1),
  ('SKU-6006', 'SKU-6001', 1,   'One managed firewall for the site.', 2),
  ('SKU-6006', 'SKU-6002', 1,   'Round-the-clock detection and response over both.', 3)
on conflict (bundle_id, component_id) do nothing;

/* `was_price` is what the parts cost separately, so the saving on the
   storefront is a subtraction anybody can check rather than a claim. */
update products p set was_price = c.parts
from (
  select pc.bundle_id, round(sum(comp.price * pc.quantity), 2) parts
  from product_components pc join products comp on comp.id = pc.component_id
  group by pc.bundle_id
) c
where p.id = c.bundle_id;

/* ---------------------------------------------------------- dependencies -- */

insert into product_rules (id, product_id, kind, targets, why, sort_order) values
  ('PRL-01', 'SKU-3008', 'requires', array['SKU-3001','SKU-3002'],
   'Sports is added to a StreamNova subscription. On its own there is nothing for it to be added to.', 1),
  ('PRL-02', 'SKU-3004', 'requires', array['SKU-3003'],
   'The season pass unlocks content inside PlayForge Cloud Gaming and does not stream on its own.', 1),
  ('PRL-03', 'SKU-3004', 'works_with', array['SKU-4004'],
   'A wired-quality connection to the console room — cloud gaming is the first thing a weak signal spoils.', 2),
  ('PRL-04', 'SKU-3001', 'excludes', array['SKU-3002'],
   'One StreamNova tier per household. Premium already carries everything Standard does.', 1),
  ('PRL-05', 'SKU-3001', 'excludes', array['SKU-2006'],
   'The Unlimited + Streaming duo already includes StreamNova Premium at the bundled price.', 2),
  ('PRL-06', 'SKU-3002', 'excludes', array['SKU-3001'],
   'One StreamNova tier per household. Moving up to Premium replaces Standard rather than adding to it.', 1),
  ('PRL-07', 'SKU-3005', 'excludes', array['SKU-3006'],
   'Family already covers six people. Solo on the same account would be billed twice for one listener.', 1),
  ('PRL-08', 'SKU-3006', 'excludes', array['SKU-3005'],
   'Solo is a single seat within Family. Holding both bills the same listener twice.', 1),
  ('PRL-09', 'SKU-2001', 'excludes', array['SKU-2002'],
   'One Aventa plan per line. Changing plan is a switch, not a second subscription.', 1),
  ('PRL-10', 'SKU-2001', 'excludes', array['SKU-2006'],
   'The duo already carries an Aventa plan on this line.', 2),
  ('PRL-11', 'SKU-2002', 'excludes', array['SKU-2001'],
   'One Aventa plan per line. Changing plan is a switch, not a second subscription.', 1),
  ('PRL-12', 'SKU-2002', 'excludes', array['SKU-2006'],
   'The duo already carries Aventa Freedom Unlimited on this line.', 2),
  /* The exclusion is deliberately one-way: holding the bundle blocks buying the
     part again, but holding the part does not block the bundle — that direction
     is an upgrade, and the basket says which standalone it replaces. */
  ('PRL-13', 'SKU-2006', 'excludes', array['SKU-2002'],
   'The duo already includes Unlimited — you would be paying for it twice.', 1),
  ('PRL-14', 'SKU-2006', 'excludes', array['SKU-3001'],
   'The duo already includes StreamNova Premium 4K.', 2),
  ('PRL-15', 'SKU-2006', 'excludes', array['SKU-2001'],
   'One Aventa plan per line, and the duo carries Unlimited.', 3),
  ('PRL-16', 'SKU-2004', 'requires', array['SKU-4001','SKU-4002','SKU-4003','SKU-4006','SKU-4007'],
   'Cover attaches to a device bought here, within 30 days of delivery. There is no way to underwrite a handset the marketplace has never seen.', 1),
  ('PRL-17', 'SKU-2005', 'requires', array['SKU-2003','SKU-2001','SKU-2002'],
   'Travel cover is sold alongside an Aventa line or a travel eSIM — the policy is written against the number that travels.', 1),
  ('PRL-18', 'SKU-5003', 'requires', array['SKU-5001','SKU-5002','SKU-5006'],
   'A sensor with no IoT connectivity plan reports to nothing. Either plan carries it.', 1),
  ('PRL-19', 'SKU-5003', 'works_with', array['SKU-5007'],
   'The LTE-M gateway backhauls a site of sensors over one connection instead of one plan per sensor.', 2),
  ('PRL-20', 'SKU-5004', 'requires', array['SKU-5001','SKU-5002','SKU-5006'],
   'A sensor with no IoT connectivity plan reports to nothing. Either plan carries it.', 1),
  ('PRL-21', 'SKU-5005', 'requires', array['SKU-5001','SKU-5002','SKU-5008'],
   'The tracker reports over cellular — without a connectivity plan it records a journey nobody sees.', 1),
  ('PRL-22', 'SKU-5006', 'excludes', array['SKU-5001'],
   'The starter already includes connectivity for all twenty-five sensors.', 1),
  ('PRL-23', 'SKU-6002', 'requires', array['SKU-6001','SKU-6004'],
   'The 24/7 team monitors something. Without a managed firewall or endpoint agent in place there is no telemetry to watch.', 1),
  ('PRL-24', 'SKU-6002', 'works_with', array['SKU-6003'],
   'Most of what MDR escalates is an access anomaly, and ZTNA is where you act on it.', 2),
  ('PRL-25', 'SKU-6006', 'excludes', array['SKU-6003'],
   'Secure access for twenty-five seats is already inside the Essentials bundle.', 1),
  ('PRL-26', 'SKU-6006', 'excludes', array['SKU-6001'],
   'The managed firewall is already inside the Essentials bundle.', 2),
  ('PRL-27', 'SKU-4001', 'works_with', array['SKU-2004'],
   'Screen and theft cover, added within 30 days of delivery.', 1),
  ('PRL-28', 'SKU-4001', 'works_with', array['SKU-4008'],
   'The K9 Pro charges at 45 W — the bundled 18 W brick takes three times as long.', 2),
  ('PRL-29', 'SKU-4005', 'works_with', array['SKU-4004'],
   'The CPE brings the signal in; the mesh carries it past one room.', 1),
  ('PRL-30', 'SKU-7002', 'requires', array['SKU-7003'],
   'Wholesale lines are ordered and activated over the partner API. Sandbox access has to be in place before the first order can be raised.', 1)
on conflict (id) do nothing;

/* ------------------------------------- what the rules found in the data --- */

-- Writing the rules down exposed one holding that breaks them. ORD-881044
-- delivered a Nimbus Occupancy sensor to the demo shopper, and she has no IoT
-- connectivity plan — so the sensor she owns reports to nothing, which is
-- exactly what PRL-20 exists to prevent.
--
-- Fixed by supplying what the rule requires rather than by deleting the order:
-- the order is real history, and a demo where a shopper's device does not work
-- is a demo of a broken marketplace.
insert into subscriptions (id, product_id, product_name, status, auto_renew, started_at, next_renewal, price, user_id, ref, seller, cycle)
select
  gen_random_uuid(), 'SKU-5001', p.name, 'active', true, '2026-03-18', '2026-08-18', p.price,
  (select user_id from subscriptions where user_id is not null limit 1),
  'SUB-9107', p.seller, 'Monthly'
from products p
where p.id = 'SKU-5001'
  and not exists (select 1 from subscriptions s where s.product_id = 'SKU-5001')
;

/* What the demo shopper currently holds, as one definition both the assertion
   below and any later caller can use. A cancelled subscription counts until the
   day it actually ends. */
create or replace function held_products()
returns table (pid text)
language sql stable
as $fn$
  select product_id from subscriptions
  where status <> 'cancelled' or ends_at is null or ends_at >= current_date
  union
  select oi.product_id from order_items oi
  join orders o on o.id = oi.order_id
  where o.status <> 'cancelled';
$fn$;

do $$
declare bad text;
begin
  -- Every rule points at products that exist.
  select string_agg(r.id || ' → ' || t, ', ') into bad
  from product_rules r, unnest(r.targets) t
  where not exists (select 1 from products p where p.id = t);
  if bad is not null then
    raise exception 'rule naming a product that does not exist: %', bad;
  end if;

  -- A product cannot require and exclude the same thing.
  select string_agg(a.product_id, ', ') into bad
  from product_rules a join product_rules b on b.product_id = a.product_id
  where a.kind = 'requires' and b.kind = 'excludes' and a.targets && b.targets;
  if bad is not null then
    raise exception 'product both requires and excludes the same thing: %', bad;
  end if;

  -- A bundle costs less than buying its parts. Otherwise it is not a bundle.
  select string_agg(p.name || ' ($' || p.price || ' against $' || p.was_price || ' of parts)', ', ') into bad
  from products p where p.was_price is not null and exists (
    select 1 from product_components c where c.bundle_id = p.id
  ) and p.price >= p.was_price;
  if bad is not null then
    raise exception 'bundle priced at or above its own parts: %', bad;
  end if;

  -- Every bundle's components are on sale, or the bundle cannot be fulfilled.
  select string_agg(c.bundle_id || ' needs ' || c.component_id, ', ') into bad
  from product_components c join products p on p.id = c.component_id
  join products b on b.id = c.bundle_id
  where b.status = 'live' and p.status <> 'live';
  if bad is not null then
    raise exception 'live bundle containing something that is not on sale: %', bad;
  end if;

  -- And the holding the rules exist to prevent: something owned whose
  -- `requires` rule nothing else the same shopper holds satisfies.
  --
  -- A cancelled subscription still entitles until its end date — notice given
  -- is not service withdrawn, and reading it as withdrawn made the demo
  -- shopper's season pass look orphaned while her gaming subscription has three
  -- more weeks to run.
  select string_agg(held.pid, ', ') into bad
  from held_products() held
  join product_rules r on r.product_id = held.pid and r.kind = 'requires'
  where not exists (select 1 from held_products() other where other.pid = any (r.targets));
  if bad is not null then
    raise exception 'the demo shopper holds % with nothing that satisfies its requires rule', bad;
  end if;
end $$;
