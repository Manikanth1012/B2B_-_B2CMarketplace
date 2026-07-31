-- The operator's own BSS catalogue, federated in — and the packs built from it.
--
-- "First party" meant `products.partner_id is null` and nothing more. That is a
-- statement about who does *not* sell a thing, which is not the same as saying
-- where it came from. There was no rate card, so the bundle builder could only
-- pick from listings that were already on the marketplace, and the operator had
-- nothing of its own to compose from. Every pack on the storefront was assembled
-- out of partner products.
--
-- The prototype models this properly (_src/mp_data.js, TELCO_CATALOGUE): the
-- operator already sells plans, add-ons, value-added services and equipment in
-- its BSS, and the marketplace *pulls* from there rather than asking anyone to
-- retype a tariff. That is the federation. This migration brings it across, with
-- the standing composition rule the prototype publishes alongside it, and seeds
-- five operator packs so the feature has something to show rather than only an
-- empty form.
--
-- Three tables:
--   telco_catalogue          the federated rate card. Not products — these are
--                            tariff items, and putting them in `products` would
--                            put seventeen unbuyable rows on the storefront.
--   bundle_rules             the composition policy, as data. It is a published
--                            commercial rule, not a constant in a component.
--   product_telco_components what a first-party listing was composed from, with
--                            the rate at composition time captured on the row.

/* ------------------------------------------------ the federated rate card - */

create table if not exists telco_catalogue (
  id         text primary key,
  name       text not null,
  family     text not null,
  /* What the buyer ends up holding. A Plan bills monthly, an Add-on is bought
     against an existing plan, Hardware ships once. The distinction drives what
     a pack made from it can be. */
  kind       text not null check (kind in ('Plan', 'Service', 'Add-on', 'Hardware')),
  /* Recurring and non-recurring are separate facts, not one nullable price.
     Fibre is $26 a month *and* $35 to install; collapsing them loses one. */
  rc         numeric(10,2) not null default 0 check (rc  >= 0),
  nrc        numeric(10,2) not null default 0 check (nrc >= 0),
  unit       text not null,
  spec       text not null,
  /* What it costs the operator to deliver. Present so a pack discount can be
     floored at cost rather than at a percentage somebody felt was safe. */
  cost_rc    numeric(10,2) not null default 0 check (cost_rc  >= 0),
  cost_nrc   numeric(10,2) not null default 0 check (cost_nrc >= 0),
  /* Federation metadata. A rate card with no provenance is a second hard-coded
     list wearing the word "federated". */
  source_system text not null default 'Aventa BSS — Product Catalogue',
  synced_at     timestamptz not null default now(),
  sort_order    integer not null default 0,
  /* Something has to be chargeable. A tariff item that is free in both
     dimensions is a catalogue entry nobody can sell. */
  check (rc > 0 or nrc > 0)
);

comment on table telco_catalogue is
  'The operator''s BSS rate card, federated into the marketplace. Read-only here: '
  'the source of truth is the BSS, and a listing composed from these captures the '
  'rate at composition time so a later tariff change does not reprice it silently.';

/* ----------------------------------------------- the composition policy --- */

create table if not exists bundle_rules (
  id               text primary key,
  /* Per extra component, so two components discount by one step and not two. */
  per_component    numeric(5,2) not null check (per_component > 0),
  max_discount     numeric(5,2) not null check (max_discount > 0),
  min_components   integer not null check (min_components >= 2),
  max_components   integer not null check (max_components > min_components),
  why              text not null,
  check (max_discount >= per_component)
);

insert into bundle_rules (id, per_component, max_discount, min_components, max_components, why)
values ('standard', 4, 18, 2, 6,
  'Four percent per extra component rewards the second and third without giving '
  'the estate away at the sixth; eighteen is where the margin on a mixed pack '
  'stops covering the cost of carrying it. Below two components there is no pack '
  '— it is the product. Above six a buyer can no longer tell what they bought.')
on conflict (id) do update set
  per_component = excluded.per_component, max_discount = excluded.max_discount,
  min_components = excluded.min_components, max_components = excluded.max_components,
  why = excluded.why;

/* ------------------------------------------------------ the rate card ----- */

-- Costs are derived from the family rather than typed per row, because the
-- shape of the margin is a property of what the thing is: equipment is bought
-- in and barely marked up, value-added services are mostly margin, add-ons sit
-- between, and network services carry the cost of the network.
insert into telco_catalogue (id, name, family, kind, rc, nrc, unit, spec, cost_rc, cost_nrc, sort_order)
select t.id, t.name, t.family, t.kind, t.rc, t.nrc, t.unit, t.spec,
       round(t.rc  * s.share, 2),
       round(t.nrc * s.share, 2),
       t.ord
from (values
  ('TP-MOB-050', 'Freedom 50 GB',            'Mobile postpaid',  'Plan',     22.00,   0.00, 'per line/mo',    '50 GB, unlimited voice and SMS, 5G', 1),
  ('TP-MOB-100', 'Freedom 100 GB',           'Mobile postpaid',  'Plan',     29.00,   0.00, 'per line/mo',    '100 GB, unlimited voice and SMS, 5G, roaming pass', 2),
  ('TP-MOB-UNL', 'Freedom Unlimited',        'Mobile postpaid',  'Plan',     39.00,   0.00, 'per line/mo',    'Unlimited data, fair-use 300 GB, 5G SA', 3),
  ('TP-MOB-PRE', 'Prepaid 20 GB pack',       'Mobile prepaid',   'Plan',      9.00,   0.00, 'per 28 days',    '20 GB, 300 minutes, 28-day validity', 4),
  ('TP-ESM-TRV', 'Travel eSIM — 10 GB',      'eSIM',             'Plan',     14.00,   0.00, 'per 30 days',    '10 GB across 62 countries, GSMA SGP.22 profile', 5),
  ('TP-FBB-300', 'Fibre 300 Mbps',           'Fixed broadband',  'Plan',     26.00,  35.00, 'per month',      '300/100 Mbps, unlimited, router included', 6),
  ('TP-FBB-1G',  'Fibre 1 Gbps',             'Fixed broadband',  'Plan',     41.00,  35.00, 'per month',      '1000/300 Mbps, unlimited, Wi-Fi 6 router', 7),
  ('TP-IOT-SIM', 'IoT data SIM — 500 MB',    'IoT connectivity', 'Plan',      1.10,   2.00, 'per SIM/mo',     '500 MB, NB-IoT and LTE-M, private APN', 8),
  ('TP-IOT-POOL','IoT pooled data — 50 GB',  'IoT connectivity', 'Plan',     48.00,   0.00, 'per pool/mo',    '50 GB shared across the estate, overage $1.10/GB', 9),
  ('TP-VAS-CLD', 'Cloud backup 200 GB',      'Value added',      'Service',   4.50,   0.00, 'per account/mo', '200 GB, versioned, in-country storage', 10),
  ('TP-VAS-SEC', 'Mobile security',          'Value added',      'Service',   2.50,   0.00, 'per line/mo',    'Malware and phishing protection on mobile', 11),
  ('TP-VAS-INS', 'Device protection',        'Value added',      'Service',   6.00,   0.00, 'per device/mo',  'Accidental damage and theft, one claim a year', 12),
  ('TP-ADD-ROM', 'Roaming day pass',         'Add-on',           'Add-on',    0.00,   5.00, 'per day',        'Use your home allowance abroad for 24 hours', 13),
  ('TP-ADD-DAT', 'Data top-up 10 GB',        'Add-on',           'Add-on',    0.00,   7.00, 'one-off',        '10 GB added to the current cycle', 14),
  ('TP-ADD-INT', 'International minutes 100','Add-on',           'Add-on',    4.00,   0.00, 'per month',      '100 minutes to 40 destinations', 15),
  ('TP-EQP-RTR', 'Wi-Fi 6 mesh router',      'Equipment',        'Hardware',  0.00,  79.00, 'one-off',        'Dual-band mesh, two nodes', 16),
  ('TP-EQP-CPE', '5G fixed-wireless CPE',    'Equipment',        'Hardware',  0.00, 189.00, 'one-off',        'Outdoor 5G CPE with PoE injector', 17)
) as t(id, name, family, kind, rc, nrc, unit, spec, ord)
join (values
  ('Equipment', 0.80), ('Value added', 0.38), ('Add-on', 0.45),
  ('Mobile postpaid', 0.58), ('Mobile prepaid', 0.58), ('eSIM', 0.58),
  ('Fixed broadband', 0.58), ('IoT connectivity', 0.58)
) as s(fam, share) on s.fam = t.family
on conflict (id) do update set
  name = excluded.name, family = excluded.family, kind = excluded.kind,
  rc = excluded.rc, nrc = excluded.nrc, unit = excluded.unit, spec = excluded.spec,
  cost_rc = excluded.cost_rc, cost_nrc = excluded.cost_nrc, sort_order = excluded.sort_order;

/* ------------------------------------------------------- composition ------ */

create table if not exists product_telco_components (
  product_id text not null references products(id) on delete cascade,
  telco_id   text not null references telco_catalogue(id) on delete restrict,
  quantity   integer not null default 1 check (quantity > 0),
  /* Per-component discount, applied before the pack discount. Capped at the
     component's own cost by the composer, never through it. */
  discount   numeric(5,2) not null default 0 check (discount >= 0 and discount <= 100),
  /* The rate when this was composed. The BSS is free to reprice tomorrow; a
     listing that silently follows it reprices a live contract. */
  rc_at      numeric(10,2) not null check (rc_at  >= 0),
  nrc_at     numeric(10,2) not null check (nrc_at >= 0),
  /* The name at composition too, and for the same reason — what the buyer was
     told is in the pack is part of what they bought. It also means the
     storefront can list the contents from this table alone: the rate card
     carries what each item costs the operator to deliver, so it stays shut to
     everyone but the operator, and a join to it would leak that. */
  name_at    text not null,
  note       text,
  sort_order integer not null default 0,
  primary key (product_id, telco_id)
);

create index if not exists ptc_product_idx on product_telco_components(product_id, sort_order);

alter table telco_catalogue          enable row level security;
alter table bundle_rules             enable row level security;
alter table product_telco_components enable row level security;

drop policy if exists "operator_read_telco_catalogue"  on telco_catalogue;
drop policy if exists "operator_write_telco_catalogue" on telco_catalogue;
drop policy if exists "operator_read_bundle_rules"     on bundle_rules;
drop policy if exists "operator_write_bundle_rules"    on bundle_rules;
drop policy if exists "public_read_ptc"                on product_telco_components;
drop policy if exists "operator_write_ptc"             on product_telco_components;

/* The rate card is the operator's own commercial data — what it pays to deliver
   each item is on these rows. Sellers and shoppers have no business reading it,
   and only the operator composes from it. */
create policy "operator_read_telco_catalogue" on telco_catalogue
  for select to authenticated using (current_persona() = 'operator');
create policy "operator_write_telco_catalogue" on telco_catalogue
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

create policy "operator_read_bundle_rules" on bundle_rules
  for select to authenticated using (current_persona() = 'operator');
create policy "operator_write_bundle_rules" on bundle_rules
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* What a pack contains is not a secret — it is the reason to buy it, and the
   storefront lists it on the product page. The rate card behind it stays shut. */
create policy "public_read_ptc" on product_telco_components
  for select to anon, authenticated using (true);
create policy "operator_write_ptc" on product_telco_components
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* --------------------------------------------- clear the test residue ----- */

-- Left behind by a browser walk-through of the bundle builder. It has no
-- imagery and no specification, so it would fail the media rules the catalogue
-- already enforces, and "Test" on a demo storefront is worse than nothing.
delete from operator_listings        where product_id = 'SKU-BB8TE8';
delete from product_components       where bundle_id  = 'SKU-BB8TE8';
delete from product_rules            where product_id = 'SKU-BB8TE8';
delete from products                 where id         = 'SKU-BB8TE8';

/* ------------------------------------- link what was already federated ---- */

-- These listings are the marketplace face of a rate-card item that already
-- existed. Recording which one closes the loop: the operator can now see that
-- Freedom 50 GB sells at $18 against a $22 rate card, and that the difference
-- is a channel discount rather than a different product.
--
-- Prices are untouched. The storefront reads `products.price`, and rewriting it
-- to the rate card would reprice five live listings to make a join look tidy.
insert into product_telco_components (product_id, telco_id, quantity, discount, rc_at, nrc_at, name_at, note, sort_order)
select l.product_id, t.id, l.qty, 0, t.rc, t.nrc, t.name, l.note, 1
from (values
  ('SKU-2001', 'TP-MOB-050',   1, 'Sold direct at $18 against a $22 rate card — the marketplace channel discount.'),
  ('SKU-2002', 'TP-MOB-UNL',   1, 'Sold direct at $27 against a $39 rate card. The steepest channel discount on the shelf.'),
  ('SKU-2003', 'TP-ESM-TRV',   1, 'Travel eSIM at the rate card plus 50c of digital fulfilment.'),
  ('SKU-5001', 'TP-IOT-SIM',   1, 'The 500 MB IoT SIM as the BSS sells it, at a 27% marketplace uplift for self-service provisioning.'),
  ('SKU-7002', 'TP-MOB-PRE', 500, 'Five hundred prepaid lines at wholesale — $3,900 against a $4,500 rate card.')
) as l(product_id, telco_id, qty, note)
join telco_catalogue t on t.id = l.telco_id
join products p on p.id = l.product_id
on conflict (product_id, telco_id) do nothing;

/* --------------------------------------------------- the operator packs --- */

-- Five packs the operator sells itself, each composed from the rate card above.
-- Nothing here is priced by hand: the components are inserted first and the
-- price is then *derived* from them by the same rule the composer applies, so
-- the seeded data cannot contradict the policy it is meant to demonstrate.
--
-- Every one is free of non-recurring components on the recurring packs and vice
-- versa. That is deliberate: `products` carries one price and one billing model,
-- so a pack that was $54 a month *and* $114 up front could only be told half
-- truthfully on a product page and would be charged half correctly at checkout.
-- Mixed packs need a price model this schema does not have yet.
insert into products (id, category_id, sub_category, name, partner_id, seller,
                      price, was_price, cost, model, fulfil, rating, reviews,
                      stock, status, listed, description, tags, comm, badge, specs, sort_order)
values
  ('SKU-FP9501', 'consumer', 'Operator packs', 'Family Mobile Trio', null, 'Aventa Telecom',
   0, null, 0, 'monthly', 'esim', null, 0, 'in', 'live', '31 Jul 2026',
   'Three Freedom 50 GB lines with malware and phishing protection on every one of them, billed as a single line on one invoice.',
   array['Bundle','First party','Family'], 0, 'Bundle', '{}'::jsonb, 910),

  ('SKU-FP9502', 'consumer', 'Operator packs', 'Everything Unlimited', null, 'Aventa Telecom',
   0, null, 0, 'monthly', 'esim', null, 0, 'in', 'live', '31 Jul 2026',
   'Freedom Unlimited with device protection, mobile security and 200 GB of cloud backup. One line, one bill, nothing else to buy.',
   array['Bundle','First party','Unlimited'], 0, 'Bundle', '{}'::jsonb, 911),

  ('SKU-FP9503', 'consumer', 'Operator packs', 'Traveller''s Day Pack', null, 'Aventa Telecom',
   0, null, 0, 'oneoff', 'instant', null, 0, 'in', 'live', '31 Jul 2026',
   'A roaming day pass and a 10 GB top-up, bought together the day before you fly. Both land on the current cycle immediately.',
   array['Bundle','First party','Travel'], 0, 'Bundle', '{}'::jsonb, 912),

  ('SKU-FP9504', 'iot', 'Operator packs', 'IoT Estate Pool — 50 GB', null, 'Aventa Telecom',
   0, null, 0, 'monthly', 'provisioned', null, 0, 'in', 'live', '31 Jul 2026',
   '50 GB of pooled data shared across the whole estate, with 200 GB of in-country storage for what it reports. Overage runs at $1.10 a GB.',
   array['Bundle','First party','Pooled'], 0, 'Bundle', '{}'::jsonb, 913),

  ('SKU-FP9505', 'partner', 'Reseller packs', 'Reseller Starter — 100 lines', null, 'Aventa Telecom',
   0, null, 0, 'monthly', 'provisioned', null, 0, 'in', 'live', '31 Jul 2026',
   'A hundred prepaid lines with mobile security on each, provisioned through the partner API. The entry pack for a reseller who has cleared onboarding.',
   array['Bundle','First party','Wholesale'], 0, 'Bundle', '{}'::jsonb, 914)
on conflict (id) do update set
  category_id = excluded.category_id, sub_category = excluded.sub_category,
  name = excluded.name, description = excluded.description, model = excluded.model,
  fulfil = excluded.fulfil, tags = excluded.tags, badge = excluded.badge,
  status = excluded.status, listed = excluded.listed, sort_order = excluded.sort_order;

insert into product_telco_components (product_id, telco_id, quantity, discount, rc_at, nrc_at, name_at, note, sort_order)
select c.product_id, t.id, c.qty, 0, t.rc, t.nrc, t.name, c.note, c.ord
from (values
  ('SKU-FP9501', 'TP-MOB-050',   3, 'Three lines on Freedom 50 GB.', 1),
  ('SKU-FP9501', 'TP-VAS-SEC',   3, 'Mobile security on each of the three.', 2),

  ('SKU-FP9502', 'TP-MOB-UNL',   1, 'The line itself, on Freedom Unlimited.', 1),
  ('SKU-FP9502', 'TP-VAS-INS',   1, 'Device protection — one claim a year.', 2),
  ('SKU-FP9502', 'TP-VAS-SEC',   1, 'Malware and phishing protection on the line.', 3),
  ('SKU-FP9502', 'TP-VAS-CLD',   1, '200 GB of versioned in-country backup.', 4),

  ('SKU-FP9503', 'TP-ADD-ROM',   1, 'One roaming day pass.', 1),
  ('SKU-FP9503', 'TP-ADD-DAT',   1, '10 GB added to the current cycle.', 2),

  ('SKU-FP9504', 'TP-IOT-POOL',  1, '50 GB shared across the estate.', 1),
  ('SKU-FP9504', 'TP-VAS-CLD',   1, 'In-country storage for the telemetry the estate reports.', 2),

  ('SKU-FP9505', 'TP-MOB-PRE', 100, 'A hundred prepaid lines.', 1),
  ('SKU-FP9505', 'TP-VAS-SEC', 100, 'Mobile security on every line.', 2)
) as c(product_id, telco_id, qty, note, ord)
join telco_catalogue t on t.id = c.telco_id
on conflict (product_id, telco_id) do update set
  quantity = excluded.quantity, rc_at = excluded.rc_at, nrc_at = excluded.nrc_at,
  name_at = excluded.name_at, note = excluded.note, sort_order = excluded.sort_order;

-- The price, derived. `was_price` is the rate card total — what the same
-- components cost bought separately — which is what makes the saving on the
-- product page a real number rather than a marketing one.
update products p set
  was_price = d.list,
  price     = d.derived,
  cost      = d.cost
from (
  select c.product_id,
         round(sum(case when p2.model = 'oneoff' then c.nrc_at else c.rc_at end * c.quantity), 2) as list,
         round(sum(case when p2.model = 'oneoff' then t.cost_nrc else t.cost_rc end * c.quantity), 2) as cost,
         round(
           sum(case when p2.model = 'oneoff' then c.nrc_at else c.rc_at end * c.quantity)
           * (1 - least(r.max_discount, (count(*) - 1) * r.per_component) / 100), 2) as derived
  from product_telco_components c
  join telco_catalogue t on t.id = c.telco_id
  join products p2 on p2.id = c.product_id
  cross join bundle_rules r
  where r.id = 'standard'
  group by c.product_id, r.max_discount, r.per_component
) as d
where p.id = d.product_id and p.id like 'SKU-FP95%';

/* --------------------------------------------------------- what it is ----- */

-- Keyed on the packs themselves rather than on the sub-category. The reseller
-- pack sits under 'Reseller packs' alongside listings that are not packs at
-- all, and a sub-category-wide update would either miss it or rewrite them.
update products p set specs = s.spec
from (values
  ('SKU-FP9501', '{"Composition":"Federated from the operator catalogue — components listed below","Lines":"Three","Term":"30-day rolling","Billing":"One line on one invoice","Sold by":"Aventa Telecom (first party)","Support":"Operator, single point of contact"}'::jsonb),
  ('SKU-FP9502', '{"Composition":"Federated from the operator catalogue — components listed below","Lines":"One","Term":"30-day rolling","Billing":"One line on one invoice","Sold by":"Aventa Telecom (first party)","Support":"Operator, single point of contact"}'::jsonb),
  ('SKU-FP9503', '{"Composition":"Federated from the operator catalogue — components listed below","Applies to":"The current billing cycle","Term":"One-off","Billing":"Added to the next invoice","Sold by":"Aventa Telecom (first party)","Support":"Operator, single point of contact"}'::jsonb),
  ('SKU-FP9504', '{"Composition":"Federated from the operator catalogue — components listed below","Pooling":"Across every line on the account","Overage":"$1.10 per GB","Term":"30-day rolling","Billing":"One line on one invoice","Sold by":"Aventa Telecom (first party)","Support":"Operator, single point of contact"}'::jsonb),
  ('SKU-FP9505', '{"Composition":"Federated from the operator catalogue — components listed below","Lines":"One hundred","Branding":"White label","Provisioning":"Partner API","Support":"Tier 1 by the reseller","Term":"12 months","Sold by":"Aventa Telecom (first party)"}'::jsonb)
) as s(pid, spec)
where p.id = s.pid;

/* Imagery, on the same footing as everything else on the shelf. */
insert into product_media (id, product_id, url, role, alt, sort_order)
select 'pm-' || m.pid || '-1', m.pid, m.url, 'hero', m.alt, 1
from (values
  ('SKU-FP9501', 'https://images.pexels.com/photos/3184465/pexels-photo-3184465.jpeg?auto=compress&cs=tinysrgb&w=600',
   'A family of three at a kitchen table, each on their own phone'),
  ('SKU-FP9502', 'https://images.pexels.com/photos/4226140/pexels-photo-4226140.jpeg?auto=compress&cs=tinysrgb&w=600',
   'A phone showing full signal on a 5G network'),
  ('SKU-FP9503', 'https://images.pexels.com/photos/5763034/pexels-photo-5763034.jpeg?auto=compress&cs=tinysrgb&w=600',
   'A traveller checking their phone at an airport gate'),
  ('SKU-FP9504', 'https://images.pexels.com/photos/7994435/pexels-photo-7994435.jpeg?auto=compress&cs=tinysrgb&w=600',
   'An industrial sensor gateway mounted on a wall'),
  ('SKU-FP9505', 'https://images.pexels.com/photos/3183197/pexels-photo-3183197.jpeg?auto=compress&cs=tinysrgb&w=600',
   'A reseller reviewing line provisioning on a laptop')
) as m(pid, url, alt)
on conflict (id) do update set url = excluded.url, alt = excluded.alt;

insert into product_media (id, product_id, url, role, alt, sort_order)
select 'pm-' || m.pid || '-2', m.pid, m.url, 'gallery', m.alt, 2
from (values
  ('SKU-FP9501', 'https://images.pexels.com/photos/47261/pexels-photo-47261.jpeg?auto=compress&cs=tinysrgb&w=600',
   'The Freedom 50 GB plan card'),
  ('SKU-FP9502', 'https://images.pexels.com/photos/60504/security-protection-anti-virus-software-60504.jpeg?auto=compress&cs=tinysrgb&w=600',
   'The security and backup services included in the pack'),
  ('SKU-FP9503', 'https://images.pexels.com/photos/1334597/pexels-photo-1334597.jpeg?auto=compress&cs=tinysrgb&w=600',
   'A data top-up confirmation on a handset'),
  ('SKU-FP9504', 'https://images.pexels.com/photos/2569842/pexels-photo-2569842.jpeg?auto=compress&cs=tinysrgb&w=600',
   'Sensors reporting into a pooled data plan'),
  ('SKU-FP9505', 'https://images.pexels.com/photos/1181271/pexels-photo-1181271.jpeg?auto=compress&cs=tinysrgb&w=600',
   'A partner API console showing provisioned lines')
) as m(pid, url, alt)
on conflict (id) do update set url = excluded.url, alt = excluded.alt;

/* A listing on the marketplace with no review behind it is a listing nobody can
   account for later — first party included. The operator is its own reviewer
   here, and the record says so rather than pretending somebody else checked. */
insert into operator_listings (id, product_id, partner_id, status, risk, check_note,
                               submitted_by, submitted_at, reviewed_by, reviewed_at,
                               decision_reason, version, sort_order)
select 'ol-' || right(p.id, 4) || '-fp', p.id, null, 'approved', 'low',
       'First party — composed from the federated operator catalogue',
       'Anika Sharma', '2026-07-31T09:00:00Z'::timestamptz,
       'Anika Sharma', '2026-07-31T09:00:00Z'::timestamptz,
       'Composed from ' || (select count(*) from product_telco_components c where c.product_id = p.id)
         || ' rate-card components at $' || to_char(p.was_price, 'FM999999990.00')
         || ', published at $' || to_char(p.price, 'FM999999990.00')
         || '. No partner, no commission, no settlement.',
       1, 520
from products p
where p.id like 'SKU-FP95%'
on conflict (id) do update set
  decision_reason = excluded.decision_reason, check_note = excluded.check_note;

/* Holding a pack blocks buying the line inside it a second time. Only where the
   pack genuinely duplicates a standalone entitlement — pooled IoT data is not
   the same thing as a per-SIM plan, and a hundred wholesale lines is not the
   same purchase as five hundred. */
insert into product_rules (id, product_id, kind, targets, why, sort_order)
values
  ('PRL-FP9501-1', 'SKU-FP9501', 'excludes', array['SKU-2001'],
   'Family Mobile Trio already carries three Freedom 50 GB lines. Adding a fourth as a standalone is a separate line, not part of the pack — buy it on its own account.', 1),
  ('PRL-FP9502-1', 'SKU-FP9502', 'excludes', array['SKU-2002'],
   'Everything Unlimited is Freedom Unlimited with services on top. Holding the standalone plan as well bills the same line twice.', 1),
  ('PRL-FP9502-2', 'SKU-FP9502', 'excludes', array['SKU-2006'],
   'Unlimited + Streaming duo is the same Unlimited line. One account cannot hold both.', 2)
on conflict (id) do update set
  targets = excluded.targets, why = excluded.why, kind = excluded.kind;

/* ------------------------------------------------------------ assertions -- */

do $$
declare bad text; n integer; v numeric;
begin
  -- The rate card came across whole.
  select count(*) into n from telco_catalogue;
  if n <> 17 then
    raise exception 'expected 17 federated rate-card items, found %', n;
  end if;

  select count(distinct family) into n from telco_catalogue;
  if n <> 8 then
    raise exception 'expected 8 rate-card families, found %', n;
  end if;

  -- Nothing is delivered at or above what it is sold for. This is the floor the
  -- composer enforces; if the seed data breaks it, the rule is decoration.
  select string_agg(id, ', ') into bad from telco_catalogue
  where (rc > 0 and cost_rc >= rc) or (nrc > 0 and cost_nrc >= nrc);
  if bad is not null then
    raise exception 'rate-card item costs at least as much as it charges: %', bad;
  end if;

  -- Every pack is a pack: at least the minimum number of components, no more
  -- than the maximum, and composed only of things the rate card still carries.
  select string_agg(x.product_id || ' (' || x.n || ')', ', ') into bad
  from (
    select c.product_id, count(*) as n from product_telco_components c
    join products p on p.id = c.product_id
    where p.sub_category in ('Operator packs', 'Reseller packs') and p.badge = 'Bundle'
    group by c.product_id
  ) x, bundle_rules r
  where r.id = 'standard' and (x.n < r.min_components or x.n > r.max_components);
  if bad is not null then
    raise exception 'pack has a component count the rule forbids: %', bad;
  end if;

  -- A pack never costs more than its parts. This is the whole promise.
  select string_agg(p.id || ': $' || p.price || ' vs $' || p.was_price, ', ') into bad
  from products p where p.id like 'SKU-FP95%' and p.price >= p.was_price;
  if bad is not null then
    raise exception 'pack priced at or above the sum of its parts: %', bad;
  end if;

  -- And never below what its components cost to deliver.
  select string_agg(p.id || ': $' || p.price || ' vs cost $' || p.cost, ', ') into bad
  from products p where p.id like 'SKU-FP95%' and p.price <= p.cost;
  if bad is not null then
    raise exception 'pack priced at or below the cost of its components: %', bad;
  end if;

  -- The derived price is the rule's answer, not a number that merely looks
  -- plausible. Checked against a fresh evaluation rather than the one that
  -- wrote it, so a mistake in the update above cannot pass unnoticed.
  select string_agg(d.product_id || ': stored $' || d.stored || ', rule says $' || d.want, ', ')
    into bad
  from (
    select c.product_id, p.price as stored,
           round(sum(case when p.model = 'oneoff' then c.nrc_at else c.rc_at end * c.quantity)
                 * (1 - least(r.max_discount, (count(*) - 1) * r.per_component) / 100), 2) as want
    from product_telco_components c
    join products p on p.id = c.product_id
    cross join bundle_rules r
    where r.id = 'standard' and p.id like 'SKU-FP95%'
    group by c.product_id, p.price, p.model, r.max_discount, r.per_component
  ) d
  where d.stored <> d.want;
  if bad is not null then
    raise exception 'pack price does not match the composition rule: %', bad;
  end if;

  -- A recurring pack made of one-off components, or the reverse, would be
  -- charged wrongly at checkout — see the note above the insert.
  select string_agg(p.id, ', ') into bad
  from products p join product_telco_components c on c.product_id = p.id
  join telco_catalogue t on t.id = c.telco_id
  where p.id like 'SKU-FP95%'
    and ((p.model = 'oneoff' and t.rc > 0) or (p.model <> 'oneoff' and t.nrc > 0));
  if bad is not null then
    raise exception 'pack mixes recurring and one-off components: %', bad;
  end if;

  -- Everything on the shelf still has a review record, imagery and a spec.
  select string_agg(p.id, ', ') into bad from products p
  where p.id like 'SKU-FP95%'
    and (not exists (select 1 from operator_listings l where l.product_id = p.id)
      or not exists (select 1 from product_media m where m.product_id = p.id and m.role = 'hero')
      or p.specs = '{}'::jsonb);
  if bad is not null then
    raise exception 'pack on sale without a review record, a hero image or a spec: %', bad;
  end if;

  -- The test bundle is gone, and took its dependents with it.
  select count(*) into n from products where id = 'SKU-BB8TE8';
  if n <> 0 then
    raise exception 'the test bundle is still on the shelf';
  end if;

  -- Federation actually reaches the existing shelf rather than only the new
  -- packs: the five listings that were already rate-card items now say so.
  select count(distinct product_id) into n from product_telco_components
  where product_id not like 'SKU-FP95%';
  if n <> 5 then
    raise exception 'expected 5 pre-existing listings linked to the rate card, found %', n;
  end if;

  -- Sanity on the headline the operator will read: the five packs together
  -- discount the rate card by a figure inside the published cap.
  select round((1 - sum(price) / sum(was_price)) * 100, 1) into v
  from products where id like 'SKU-FP95%';
  if v <= 0 or v > (select max_discount from bundle_rules where id = 'standard') then
    raise exception 'aggregate pack discount of %%% is outside the published rule', v;
  end if;
end $$;
