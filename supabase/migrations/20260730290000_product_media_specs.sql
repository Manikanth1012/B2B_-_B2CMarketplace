-- Pictures and a specification, so a catalogue review is a review of something.
--
-- `products.specs` was `{}` on all forty-one rows, and there was one image per
-- SKU with nothing recording its alt text. A reviewer opening a listing saw a
-- name, a price and a paragraph — which is not enough to approve a radio device
-- for sale in three markets, and it is not enough for a buyer either.
--
-- The category policy already carries a media rule in spirit ("alt text missing
-- on two images" is one of the findings the queue is meant to raise); without a
-- media table there was nothing for it to be about.

create table if not exists product_media (
  id         text primary key,
  product_id text not null references products(id) on delete cascade,
  url        text not null,
  /* The hero is what a tile and a search result show. Everything else is
     gallery, in order. */
  role       text not null check (role in ('hero', 'gallery')),
  /* Null is a real state, not an empty string: "nobody wrote one" is what the
     accessibility check looks for, and '' would look like somebody had. */
  alt        text,
  sort_order integer not null default 0
);

create index if not exists product_media_product_idx on product_media(product_id, sort_order);

/* Exactly one hero per product — two heroes is two answers to "what does this
   look like". */
create unique index if not exists product_media_hero_idx
  on product_media(product_id) where role = 'hero';

alter table product_media enable row level security;

drop policy if exists "public_read_product_media"    on product_media;
drop policy if exists "operator_write_product_media" on product_media;
drop policy if exists "partner_write_product_media"  on product_media;

/* Same reach as the catalogue: a shopper who is not signed in still has to see
   the picture. */
create policy "public_read_product_media" on product_media
  for select to anon, authenticated using (true);
create policy "operator_write_product_media" on product_media
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
/* A seller manages the imagery on their own listings — it is their product.
   The operator still decides whether the listing goes live. */
create policy "partner_write_product_media" on product_media
  for all to authenticated
  using (exists (select 1 from products p where p.id = product_id and p.partner_id = current_partner_id()))
  with check (exists (select 1 from products p where p.id = product_id and p.partner_id = current_partner_id()));

/* -------------------------------------------------------------- specs ---- */

-- A specification per sub-category, because that is the level at which two
-- products are actually comparable: every phone has storage and a screen, no
-- plan does, and a table of columns that half the rows leave blank is worse
-- than no table.
update products set specs = s.spec
from (values
  ('Phones', '{"Network":"5G SA/NSA","Screen":"6.7 in AMOLED, 120 Hz","Battery":"5000 mAh","Charging":"45 W wired","Warranty":"24 months","SIM":"Dual eSIM + nano"}'::jsonb),
  ('Tablets', '{"Network":"LTE Cat-12 + Wi-Fi 6","Screen":"11 in IPS, 90 Hz","Battery":"7700 mAh","Warranty":"24 months","SIM":"Nano + eSIM"}'::jsonb),
  ('Routers', '{"Standard":"Wi-Fi 6 (802.11ax)","Coverage":"Up to 510 m² with 3 units","Ports":"2× 2.5 GbE per unit","Backhaul":"Dedicated 5 GHz","Warranty":"24 months"}'::jsonb),
  ('CPE', '{"Network":"5G SA/NSA, LTE fallback","Throughput":"Up to 3.4 Gbps down","Ports":"1× 2.5 GbE, 3× GbE","Antenna":"4×4 MIMO","Warranty":"24 months"}'::jsonb),
  ('Accessories', '{"Output":"45 W USB-C PD 3.0","Ports":"1× USB-C, 1× USB-A","Technology":"GaN","Warranty":"12 months"}'::jsonb),
  ('Wearables', '{"Display":"1.4 in AMOLED","Battery":"9 days typical","Water rating":"5 ATM","Sensors":"HR, SpO2, GPS","Warranty":"12 months"}'::jsonb),
  ('Sensors', '{"Connectivity":"NB-IoT / LTE-M","Battery":"5 years at 15-minute reporting","Ingress":"IP54","Range":"-30 °C to 60 °C","Warranty":"36 months"}'::jsonb),
  ('Trackers', '{"Connectivity":"LTE-M with 2G fallback","Battery":"18 months at hourly reporting","Ingress":"IP67","Positioning":"GNSS + cell ID","Warranty":"24 months"}'::jsonb),
  ('Gateways', '{"Uplink":"LTE-M / NB-IoT","Downlink":"LoRaWAN, 500 nodes","Power":"PoE or 12 V DC","Ingress":"IP65","Warranty":"36 months"}'::jsonb),
  ('Mobile plans', '{"Network":"5G where available","Fair use":"Unlimited at 5 Mbps after allowance","Roaming":"India, UAE and Kenya included","Contract":"30-day rolling","Tethering":"Included"}'::jsonb),
  ('IoT SIM plans', '{"Network":"NB-IoT / LTE-M","Coverage":"India, UAE, Kenya","Activation":"API or portal","Pooling":"Across all lines on the account","Contract":"12 months"}'::jsonb),
  ('Insurance', '{"Excess":"$29 per claim","Claims":"Two in twelve months","Cover":"Accidental damage and theft","Cooling-off":"14 days","Underwriter":"Aegis Assurance"}'::jsonb),
  ('Streaming', '{"Quality":"Up to 4K HDR","Screens":"Four at once","Downloads":"Yes, 30 titles","Profiles":"Six","Contract":"30-day rolling"}'::jsonb),
  ('Gaming', '{"Library":"Over 400 titles","Streaming":"Up to 1080p60","Devices":"Console, PC, mobile","Contract":"30-day rolling"}'::jsonb),
  ('Music', '{"Quality":"Lossless up to 24-bit","Seats":"Six","Offline":"Unlimited downloads","Contract":"30-day rolling"}'::jsonb),
  ('Cloud storage', '{"Capacity":"2 TB","Versioning":"30 days","Encryption":"AES-256 at rest","Devices":"Unlimited","Contract":"30-day rolling"}'::jsonb),
  ('Managed firewall', '{"Throughput":"1 Gbps inspected","Deployment":"Cloud or on-premise","Support":"24/7","Reporting":"Weekly and on demand","Contract":"12 months"}'::jsonb),
  ('MDR', '{"Coverage":"24/7/365","Response":"15-minute acknowledgement","Sources":"Endpoint, firewall, identity","Contract":"12 months"}'::jsonb),
  ('VPN / ZTNA', '{"Model":"Zero trust network access","Identity":"SAML, OIDC","Devices":"Managed and unmanaged","Contract":"12 months"}'::jsonb),
  ('Endpoint', '{"Platforms":"Windows, macOS, Linux","Detection":"Behavioural + signature","Rollback":"Yes","Contract":"12 months"}'::jsonb),
  ('Email security', '{"Filtering":"Inbound and outbound","Sandboxing":"Yes","Retention":"90 days","Contract":"12 months"}'::jsonb),
  ('Reseller packs', '{"Branding":"White label","Provisioning":"Partner API","Support":"Tier 1 by the reseller","Contract":"12 months"}'::jsonb),
  ('Enablement', '{"Environments":"Sandbox and production","Rate limit":"600 requests per minute","Auth":"HMAC-SHA256","Support":"Business hours"}'::jsonb),
  ('Bundles', '{"Composition":"See what is included below","Term":"12 months","Billing":"One line on one invoice","Support":"Single point of contact"}'::jsonb)
) as s(sub, spec)
where products.sub_category = s.sub;

/* ------------------------------------------------------------- images ---- */

-- The hero is the curated photograph the storefront already uses; the gallery
-- shot is the category image. Two is thin for a real catalogue and generous for
-- a demo — the point is that the media record exists and carries alt text, so
-- the accessibility rule has something to check.
insert into product_media (id, product_id, url, role, alt, sort_order)
select
  'pm-' || p.id || '-1', p.id, m.hero, 'hero',
  p.name || ' — product photograph', 1
from products p
join (values
  ('SKU-2001','https://images.pexels.com/photos/47261/pexels-photo-47261.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-2002','https://images.pexels.com/photos/4226140/pexels-photo-4226140.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-2003','https://images.pexels.com/photos/5763034/pexels-photo-5763034.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-2004','https://images.pexels.com/photos/4370375/pexels-photo-4370375.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-2005','https://images.pexels.com/photos/5380642/pexels-photo-5380642.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-2006','https://images.pexels.com/photos/3784221/pexels-photo-3784221.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-3001','https://images.pexels.com/photos/2881229/pexels-photo-2881229.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-3002','https://images.pexels.com/photos/3165335/pexels-photo-3165335.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-3003','https://images.pexels.com/photos/4348404/pexels-photo-4348404.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-3004','https://images.pexels.com/photos/1181271/pexels-photo-1181271.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-3005','https://images.pexels.com/photos/1334597/pexels-photo-1334597.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-3006','https://images.pexels.com/photos/1647946/pexels-photo-1647946.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-3007','https://images.pexels.com/photos/5474028/pexels-photo-5474028.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-3008','https://images.pexels.com/photos/274506/pexels-photo-274506.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-3009','https://images.pexels.com/photos/4348404/pexels-photo-4348404.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-4001','https://images.pexels.com/photos/699122/pexels-photo-699122.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-4002','https://images.pexels.com/photos/47261/pexels-photo-47261.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-4003','https://images.pexels.com/photos/356056/pexels-photo-356056.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-4004','https://images.pexels.com/photos/4226140/pexels-photo-4226140.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-4005','https://images.pexels.com/photos/3483098/pexels-photo-3483098.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-4006','https://images.pexels.com/photos/1334597/pexels-photo-1334597.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-4007','https://images.pexels.com/photos/437037/pexels-photo-437037.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-4008','https://images.pexels.com/photos/4526407/pexels-photo-4526407.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-5001','https://images.pexels.com/photos/7994435/pexels-photo-7994435.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-5002','https://images.pexels.com/photos/7994435/pexels-photo-7994435.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-5003','https://images.pexels.com/photos/2569842/pexels-photo-2569842.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-5004','https://images.pexels.com/photos/2569842/pexels-photo-2569842.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-5005','https://images.pexels.com/photos/1213294/pexels-photo-1213294.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-5006','https://images.pexels.com/photos/7994435/pexels-photo-7994435.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-5007','https://images.pexels.com/photos/3483098/pexels-photo-3483098.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-5008','https://images.pexels.com/photos/1213294/pexels-photo-1213294.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-5009','https://images.pexels.com/photos/2569842/pexels-photo-2569842.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-6001','https://images.pexels.com/photos/60504/security-protection-anti-virus-software-60504.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-6002','https://images.pexels.com/photos/5380642/pexels-photo-5380642.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-6003','https://images.pexels.com/photos/60504/security-protection-anti-virus-software-60504.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-6004','https://images.pexels.com/photos/5380642/pexels-photo-5380642.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-6005','https://images.pexels.com/photos/60504/security-protection-anti-virus-software-60504.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-6006','https://images.pexels.com/photos/3784221/pexels-photo-3784221.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-7001','https://images.pexels.com/photos/5380642/pexels-photo-5380642.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-7002','https://images.pexels.com/photos/7994435/pexels-photo-7994435.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-7003','https://images.pexels.com/photos/1181271/pexels-photo-1181271.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('SKU-7004','https://images.pexels.com/photos/5380642/pexels-photo-5380642.jpeg?auto=compress&cs=tinysrgb&w=600')
) as m(sku, hero) on m.sku = p.id
on conflict (id) do nothing;

insert into product_media (id, product_id, url, role, alt, sort_order)
select
  'pm-' || p.id || '-2', p.id, c.url, 'gallery',
  /* Two listings under review are missing alt text on their second image. The
     accessibility check in the category policy is a real finding, and a rule
     that never fires on any listing is a rule nobody believes. */
  case when p.id in ('SKU-3009', 'SKU-7004') then null
       else p.name || ' — in use' end,
  2
from products p
join (values
  ('consumer','https://images.pexels.com/photos/47261/pexels-photo-47261.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('partner', 'https://images.pexels.com/photos/5380642/pexels-photo-5380642.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('iot',     'https://images.pexels.com/photos/7994435/pexels-photo-7994435.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('security','https://images.pexels.com/photos/3784221/pexels-photo-3784221.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('device',  'https://images.pexels.com/photos/699122/pexels-photo-699122.jpeg?auto=compress&cs=tinysrgb&w=600'),
  ('content', 'https://images.pexels.com/photos/2881229/pexels-photo-2881229.jpeg?auto=compress&cs=tinysrgb&w=600')
) as c(cat, url) on c.cat = p.category_id
on conflict (id) do nothing;

do $$
declare bad text;
begin
  -- Every product a buyer can reach has a picture.
  select string_agg(id, ', ') into bad
  from products p where p.status in ('live', 'pending')
    and not exists (select 1 from product_media m where m.product_id = p.id and m.role = 'hero');
  if bad is not null then
    raise exception 'product on sale or in review with no hero image: %', bad;
  end if;

  -- And a specification. A comparison table with a blank column is a table
  -- nobody can compare on.
  select string_agg(id, ', ') into bad
  from products where status in ('live', 'pending') and specs = '{}'::jsonb;
  if bad is not null then
    raise exception 'product on sale or in review with no specification: %', bad;
  end if;

  -- The alt-text gap is deliberate and bounded. If it spreads, the policy check
  -- stops being a demonstration and becomes a defect.
  select count(*)::text into bad from product_media where alt is null;
  if bad::int <> 2 then
    raise exception 'expected exactly 2 images without alt text, found %', bad;
  end if;
end $$;
