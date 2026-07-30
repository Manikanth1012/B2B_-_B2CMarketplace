-- Link the operator's review queue to the catalogue it feeds.
--
-- `operator_listings` and `products` looked like two disagreeing catalogues — the same
-- product under different names, prices and sellers ("Aventa Freedom 50GB Plan" at
-- $29.99 from "Aventa (First-party)" against "Aventa Freedom 50 GB" at $18.00 from
-- "Aventa Telecom"). They are not two catalogues, and neither is wrong:
--
--   * `operator_listings` is the **review queue** — 12 rows, 7 approved, 4 pending,
--     1 rejected. A row is a seller's *submission*, with a cost, a version and a
--     reviewer. It is a workflow record.
--   * `products` is the **live catalogue** — 39 rows, what a visitor can buy.
--
-- So the fix is a link, not a merge. `products` stays the source of truth for what is
-- for sale; `operator_listings` gains a nullable `product_id` saying which catalogue
-- row a submission became.
--
-- **A null `product_id` is the normal case, not missing data.** A pending listing has
-- not been approved, and a rejected one never will be — neither should have a
-- catalogue row, and that is the queue working correctly.
--
-- The submitted price and name are deliberately left alone. A submission records what
-- the seller asked for, which is the point of reviewing it; the operator's own margin
-- view depends on `cost` against that submitted price.

alter table operator_listings add column if not exists product_id text references products(id) on delete set null;
alter table operator_listings add column if not exists partner_id text references partners(id);

comment on column operator_listings.product_id is
  'The catalogue row this submission became. Null for pending and rejected listings, and for approved ones the catalogue has no equivalent of.';

create index if not exists operator_listings_product_id_idx on operator_listings (product_id);
create index if not exists operator_listings_partner_id_idx on operator_listings (partner_id);

-- ---------------------------------------------------------------------------
-- Which approved submission is which catalogue row
-- ---------------------------------------------------------------------------
-- Curated, matched on product identity rather than price — a submitted price is what
-- the seller asked for and need not be what ended up on the shelf.
--
--   ol-001 Aventa Freedom 50GB Plan        -> SKU-2001  same plan, name variant
--   ol-002 Aventa Unlimited Plan           -> SKU-2002  "Aventa Freedom Unlimited"
--   ol-003 K9 Pro 5G Smartphone            -> SKU-4001  the K9 Pro is unmistakable,
--                                                       though the queue credits
--                                                       TechDyne and the catalogue
--                                                       credits Kestrel Devices
--   ol-004 Nimbus NB-IoT Sensor Pack (25)  -> SKU-5006  both the 25-sensor Nimbus pack
--   ol-005 Sentinel Managed Firewall       -> SKU-6001  "— Standard"; $899 submitted
--                                                       against $24 listed reads as
--                                                       annual against monthly
--
-- Two approved listings get **no** product_id, deliberately:
--   ol-010 TechDyne CPE Router X1  — the catalogue has no TechDyne router. The nearest
--                                    thing is a Volta CPE, which is a different
--                                    product from a different seller.
--   ol-011 Aventa Halo Family Plan — nothing in the catalogue is this. "Halo Music
--                                    Family" is a music subscription from Halo Audio,
--                                    not an Aventa family plan.
-- Pointing those two at an approximate row would assert something untrue about what
-- is on sale, which is worse than leaving the link empty.

update operator_listings l set product_id = m.sku
from (values
  ('ol-001', 'SKU-2001'),
  ('ol-002', 'SKU-2002'),
  ('ol-003', 'SKU-4001'),
  ('ol-004', 'SKU-5006'),
  ('ol-005', 'SKU-6001')
) as m(listing_id, sku)
where l.id = m.listing_id and l.product_id is null;

-- ---------------------------------------------------------------------------
-- Which submission belongs to which partner
-- ---------------------------------------------------------------------------
-- The same free-text seller names, and therefore the same curated mapping, already
-- recorded for settlement_statements in
-- docs/superpowers/plans/2026-07-29-rls-live-audit.md. Kept identical on purpose: one
-- decision about who these sellers are, applied everywhere, rather than two.
--
--   Nimbus IoT Solutions   -> PTR-1004 (Nimbus Sensors)
--   Sentinel Cyber Systems -> PTR-1003 (Sentinel Cyber)
--   StreamNova Media       -> PTR-1001 exact
--   TechDyne Devices, CloudSync Labs -> no partner row exists; left null
--   Aventa (First-party)             -> not a partner at all — the operator's own
--                                       entity. Null is the correct answer, not a gap.

update operator_listings l set partner_id = m.partner_id
from (values
  ('StreamNova Media',       'PTR-1001'),
  ('Sentinel Cyber Systems', 'PTR-1003'),
  ('Nimbus IoT Solutions',   'PTR-1004')
) as m(partner_name, partner_id)
where l.partner_name = m.partner_name and l.partner_id is null;
