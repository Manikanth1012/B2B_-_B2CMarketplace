-- Banners as a small ad server rather than a picture with a headline on it.
--
-- What was here: seven rows, every one of them 'active', with a slot column
-- holding a free-text string nothing defined, no artwork of any kind, no size
-- requirement, no draft state, and a destination that could name a page but not
-- a product. The console let you type a title and pick a slot; there was no way
-- to see what the thing would look like before it went live to everyone.
--
-- The prototype (_src/mp_data.js, BANNER_SLOTS / AD_MOTIFS) models it properly,
-- because "put a picture on the login page" becomes an ad server within a
-- quarter whether or not anybody planned for one. This brings across:
--
--   banner_slots   where an ad may run, how big the artwork has to be, how many
--                  may share the slot, and whether the slot can target a person
--                  at all — a login screen is seen before sign-in, so it cannot.
--   artwork        a real image from the marketplace's own asset library, with
--                  an accent colour behind the text so the copy stays legible
--                  over whatever the picture is doing. Every slot declares the
--                  size it wants and the console measures what it is given.
--   a real lifecycle  draft, scheduled, live, paused, ended — 'active' on every
--                  row is not a lifecycle, it is a column nobody used.
--   deeper links   a banner can point at a product, not only at a page.

/* --------------------------------------------------------------- slots --- */

create table if not exists banner_slots (
  id        text primary key,
  label     text not null,
  /* Where it renders, in the words of somebody who has to picture it. */
  surface   text not null,
  /* What the artwork has to be. A slot without a size is a slot where every
     banner arrives the wrong shape and somebody crops it by hand. */
  width     integer not null check (width  > 0),
  height    integer not null check (height > 0),
  /* How many banners may share it. They rotate by weight; past this the
     rotation is so thin nobody sees any of them twice. */
  max_banners integer not null check (max_banners > 0),
  /* Whether the slot can target an individual. Pre-login slots cannot — nobody
     has said who they are yet — and pretending otherwise produces campaigns
     that silently never match. */
  personal_targeting boolean not null default true,
  note      text not null,
  sort_order integer not null default 0
);

comment on table banner_slots is
  'Where advertising is allowed to run, and what it has to look like to run there. '
  'The operator adds banners to a slot; the slot decides the artwork size, how many '
  'may rotate, and whether the audience can be a person rather than a locale.';

insert into banner_slots (id, label, surface, width, height, max_banners, personal_targeting, note, sort_order)
values
  ('login', 'Login screen', 'The sign-in page, before anyone has identified themselves',
   1200, 267, 3, false,
   'Seen before sign-in, so no personal targeting is possible — locale and device only. Anything aimed at "existing customers" here will never match anybody.', 1),

  ('storefront_hero', 'Storefront hero', 'The first band on the retail storefront, after sign-in',
   1600, 356, 4, true,
   'The first thing after sign-in and the largest frame on the site. Personal targeting is available, so a campaign aimed at lapsed customers works here.', 2),

  ('storefront_strip', 'Storefront strip', 'Below the fold on the storefront home',
   1000, 223, 6, true,
   'A quieter frame that carries more banners. Good for a rotation of several offers where no single one needs the hero.', 3),

  ('category_header', 'Category header', 'The top of a marketplace category page',
   1280, 285, 4, true,
   'Above a category listing. The reader has already chosen a subject, so a banner that ignores it wastes the best-qualified placement on the site.', 4),

  ('bill', 'Bill insert', 'Printed on the bill itself',
   1100, 245, 3, true,
   'Read by everyone who opens their bill, which makes it the highest-attention slot and the easiest to abuse. It must be relevant to what the reader already buys — a bill is not a billboard — and it is never shown on a bill that is chasing money.', 5)
on conflict (id) do update set
  label = excluded.label, surface = excluded.surface,
  width = excluded.width, height = excluded.height,
  max_banners = excluded.max_banners, personal_targeting = excluded.personal_targeting,
  note = excluded.note, sort_order = excluded.sort_order;

/* ------------------------------------------------------------ artwork ---- */

alter table operator_banners add column if not exists name        text;
alter table operator_banners add column if not exists accent      text;
alter table operator_banners add column if not exists image_url   text;
alter table operator_banners add column if not exists alt         text;
alter table operator_banners add column if not exists orders      integer not null default 0;
alter table operator_banners add column if not exists destination_ref text;

comment on column operator_banners.name is
  'What the operator calls it internally. The title is what a reader sees; the two '
  'are different jobs and one field cannot do both.';
comment on column operator_banners.image_url is
  'The artwork. Expected at the slot''s declared size and aspect — the console measures '
  'whatever it is given and says so when it does not match. Everything seeded here comes '
  'from the marketplace''s own library under public/assets/mp.';
comment on column operator_banners.destination_ref is
  'A product id, where the call to action opens one specific thing rather than a page. '
  'Null means the destination page on its own.';

/* An accent has to be a colour the renderer can actually use. */
alter table operator_banners drop constraint if exists operator_banners_accent_check;
alter table operator_banners add constraint operator_banners_accent_check
  check (accent is null or accent ~ '^#[0-9a-fA-F]{6}$');

/* ------------------------------------------------------------ lifecycle -- */

-- 'active' on every row is not a lifecycle. A banner is written before it runs,
-- may be scheduled ahead, is paused rather than deleted when it misbehaves, and
-- ends when its window closes.
update operator_banners set status = 'live' where status = 'active';

alter table operator_banners drop constraint if exists operator_banners_status_check;
alter table operator_banners add constraint operator_banners_status_check
  check (status in ('draft', 'scheduled', 'live', 'paused', 'ended'));

/* The slot has to be one that exists. Without this the console offers five and
   the table accepts anything. */
update operator_banners set slot = 'storefront_hero' where slot not in (select id from banner_slots);
alter table operator_banners drop constraint if exists operator_banners_slot_fk;
alter table operator_banners
  add constraint operator_banners_slot_fk foreign key (slot) references banner_slots(id);

/* Measurement has to be internally possible: you cannot be clicked more often
   than you were seen, or ordered from more often than you were clicked. */
alter table operator_banners drop constraint if exists operator_banners_funnel_check;
alter table operator_banners add constraint operator_banners_funnel_check
  check (clicks <= impressions and orders <= clicks);

/* ------------------------------------------- artwork on what is there ---- */

-- Accents are picked per campaign subject rather than at random, and every one
-- is dark enough to carry white text at the size these render.
-- Artwork comes from the marketplace's own library (public/assets/mp), which is
-- already indexed in lib/assets.ts and already served by the storefront strip.
-- Every one of these is 768x171, which is the ratio every slot above asks for.
update operator_banners b set
  name      = coalesce(b.name, v.name),
  accent    = coalesce(b.accent, v.accent),
  image_url = coalesce(b.image_url, v.image_url),
  alt       = coalesce(b.alt, v.alt),
  orders    = case when b.orders = 0 then v.orders else b.orders end
from (values
  ('bn-001', 'Business 5G + Managed Firewall', '#1b3a6b', '/assets/mp/banner-03.webp', 'Business connectivity and managed security', 148),
  ('bn-002', 'StreamNova Sports promotion',    '#4a3aa7', '/assets/mp/banner-05.webp', 'Sport streaming on a large screen',          412),
  ('bn-003', 'K9 Pro launch',                  '#0f6ab4', '/assets/mp/banner-01.webp', 'The Kestrel K9 Pro handset',                 690),
  ('bn-004', 'IoT bulk pricing',               '#1baf7a', '/assets/mp/banner-07.webp', 'Sensors deployed across a logistics site',    71),
  ('bn-005', 'Sentinel MDR drive',             '#2a78d6', '/assets/mp/banner-09.webp', 'A security operations desk',                  44),
  ('bn-006', 'Halo Audio range',               '#eb6834', '/assets/mp/banner-02.webp', 'Wireless headphones from the Halo range',      0),
  ('bn-007', 'Seller recruitment',             '#1b3a6b', '/assets/mp/banner-11.webp', 'A partner storefront on the marketplace',      0)
) as v(id, name, accent, image_url, alt, orders)
where b.id = v.id;

/* Nothing renders as an empty frame. A banner with no artwork on a live slot is
   a hole on the storefront, so anything that arrived without any gets some. */
update operator_banners set image_url = '/assets/mp/banner-04.webp' where image_url is null;
update operator_banners set accent = '#1b3a6b' where accent is null;
update operator_banners set name = title where name is null;
update operator_banners set alt = 'Promotional artwork' where alt is null;

/* ------------------------------------------------- more to look at ------- */

-- The console showed seven banners, all live, none of them in the two slots the
-- old schema could not express. These fill out the states a campaign actually
-- passes through and the slots that had nothing in them.
insert into operator_banners (
  id, slot, name, title, subtitle, cta, audience, region, device, weight,
  impressions, clicks, orders, revenue, status, starts_at, ends_at,
  destination, destination_ref, accent, image_url, alt, sort_order
)
values
  -- Bill inserts. Relevant to what the reader already buys.
  ('bn-008', 'bill', 'Second line on the same bill',
   'Add a second line for $9 a month', 'Same data pool, one bill. Cancel any time.', 'Add a line',
   'consumer', 'India,UAE', 'all', 50,
   38400, 1690, 214, 1926.00, 'live', '2026-07-01', '2026-12-31',
   'retail', 'SKU-2001', '#0f6ab4', '/assets/mp/banner-04.webp', 'A second handset added to an account', 108),

  ('bn-009', 'bill', 'Device protection on the bill',
   'Cover your handset from $6.90 a month', 'Accidental damage and theft, one claim a year.', 'Add cover',
   'consumer', 'India', 'all', 40,
   31200, 998, 143, 986.70, 'live', '2026-07-01', '2026-12-31',
   'retail', 'SKU-2004', '#1baf7a', '/assets/mp/banner-06.webp', 'A handset protected against damage', 109),

  -- Written, not yet scheduled. Nothing about it is on the site.
  ('bn-010', 'storefront_hero', 'Diwali device sale',
   'Diwali device sale — up to 30% off', 'Handsets, wearables and audio, while stock lasts.', 'See the sale',
   'consumer', 'India', 'all', 90,
   0, 0, 0, 0, 'draft', null, null,
   'retail', null, '#eb6834', '/assets/mp/banner-08.webp', 'A festival device sale', 110),

  -- Booked ahead. It has a window and it has not opened yet.
  ('bn-011', 'login', 'Trade in and upgrade',
   'Trade in and upgrade', 'We will quote for your old handset before you commit.', 'Get a quote',
   'all', 'India,UAE,Kenya', 'all', 55,
   0, 0, 0, 0, 'scheduled', '2026-08-15', '2026-10-31',
   'retail', null, '#4a3aa7', '/assets/mp/banner-10.webp', 'An old handset traded for a new one', 111),

  -- Held back mid-flight. Paused is not deleted: the numbers it earned stay.
  ('bn-012', 'category_header', 'Security attestation drive',
   'Selling security? Get attested first', 'SOC 2 or ISO 27001 opens the Security marketplace.', 'What is needed',
   'partner reseller', 'India,UAE,Kenya', 'all', 35,
   9800, 402, 11, 0, 'paused', '2026-06-01', '2026-09-30',
   'partner', null, '#2a78d6', '/assets/mp/banner-12.webp', 'A security attestation certificate', 112),

  -- Finished. Kept because what it earned is the only evidence of whether the
  -- slot is worth anything.
  ('bn-013', 'storefront_strip', 'Refer a business',
   'Refer a business, both get a month free', 'Applies to any plan on a business account.', 'Refer someone',
   'enterprise', 'India,UAE', 'all', 45,
   52700, 2108, 96, 4128.00, 'ended', '2026-03-01', '2026-06-30',
   'enterprise', null, '#1b3a6b', '/assets/mp/banner-03.webp', 'Two businesses referring each other', 113)
on conflict (id) do update set
  slot = excluded.slot, name = excluded.name, title = excluded.title,
  subtitle = excluded.subtitle, cta = excluded.cta, audience = excluded.audience,
  region = excluded.region, weight = excluded.weight, status = excluded.status,
  starts_at = excluded.starts_at, ends_at = excluded.ends_at,
  destination = excluded.destination, destination_ref = excluded.destination_ref,
  accent = excluded.accent, image_url = excluded.image_url, alt = excluded.alt,
  impressions = excluded.impressions, clicks = excluded.clicks,
  orders = excluded.orders, revenue = excluded.revenue;

/* ----------------------------------------------- the public view -------- */

-- The view filtered on 'active', which no row is any more. Live plus its date
-- window is what a reader should see, and 'live' now means exactly that.
drop view if exists public_banners;
create view public_banners as
  select id, slot, title, subtitle, cta, audience, destination, destination_ref,
         weight, sort_order, accent, image_url, alt
  from operator_banners
  where status = 'live'
    and (starts_at is null or starts_at <= current_date)
    and (ends_at   is null or ends_at   >= current_date);

grant select on public_banners to anon, authenticated;

alter table banner_slots enable row level security;
drop policy if exists "auth_read_banner_slots"     on banner_slots;
drop policy if exists "operator_write_banner_slots" on banner_slots;

/* Readable by anyone signed in — a slot definition is not commercial, and the
   storefront needs the artwork size to lay a frame out. Only the operator
   decides where advertising is allowed to run. */
create policy "auth_read_banner_slots" on banner_slots
  for select to anon, authenticated using (true);
create policy "operator_write_banner_slots" on banner_slots
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* ------------------------------------------------------------ assertions - */

do $$
declare bad text; n integer;
begin
  select count(*) into n from banner_slots;
  if n <> 5 then raise exception 'expected 5 banner slots, found %', n; end if;

  -- Every banner sits in a slot that exists, with artwork that will render.
  select string_agg(id, ', ') into bad from operator_banners
  where image_url is null or accent is null or name is null or alt is null;
  if bad is not null then
    raise exception 'banner with no artwork, accent, name or alt text: %', bad;
  end if;

  -- All artwork comes from the marketplace's own library. An absolute URL here
  -- would be a request to a host nobody vetted, on a page served to everyone.
  select string_agg(id || ' -> ' || image_url, ', ') into bad from operator_banners
  where image_url not like '/assets/mp/%';
  if bad is not null then
    raise exception 'banner artwork served from outside the asset library: %', bad;
  end if;

  -- No slot is over-subscribed by banners that are actually running. Draft and
  -- ended ones do not compete for the rotation, so they do not count.
  select string_agg(x.slot || ' has ' || x.n || ' of ' || x.max_banners, ', ') into bad
  from (
    select b.slot, count(*) as n, s.max_banners
    from operator_banners b join banner_slots s on s.id = b.slot
    where b.status in ('live', 'scheduled')
    group by b.slot, s.max_banners
  ) x
  where x.n > x.max_banners;
  if bad is not null then
    raise exception 'slot over-subscribed — the rotation is too thin to be seen: %', bad;
  end if;

  -- A slot that cannot target a person is not carrying a banner that tries to.
  select string_agg(b.id || ' on ' || b.slot || ' targets ' || b.audience, ', ') into bad
  from operator_banners b join banner_slots s on s.id = b.slot
  where s.personal_targeting = false
    and lower(b.audience) in ('new customers', 'existing customers', 'lapsed customers');
  if bad is not null then
    raise exception 'personal targeting on a slot seen before sign-in: %', bad;
  end if;

  -- Scheduled means it has a window and it has not opened. Ended means it has
  -- closed. A state that contradicts its own dates is worse than no state.
  select string_agg(id, ', ') into bad from operator_banners
  where status = 'scheduled' and (starts_at is null or starts_at <= current_date);
  if bad is not null then
    raise exception 'scheduled banner with no future start: %', bad;
  end if;

  select string_agg(id, ', ') into bad from operator_banners
  where status = 'ended' and (ends_at is null or ends_at >= current_date);
  if bad is not null then
    raise exception 'ended banner whose window is still open: %', bad;
  end if;

  -- A draft has never run, so it cannot have earned anything.
  select string_agg(id, ', ') into bad from operator_banners
  where status = 'draft' and (impressions > 0 or clicks > 0 or revenue > 0);
  if bad is not null then
    raise exception 'draft banner with traffic against it: %', bad;
  end if;

  -- And a banner that points at a product points at one that exists.
  select string_agg(b.id || ' -> ' || b.destination_ref, ', ') into bad
  from operator_banners b
  where b.destination_ref is not null
    and not exists (select 1 from products p where p.id = b.destination_ref);
  if bad is not null then
    raise exception 'banner points at a product that is not in the catalogue: %', bad;
  end if;

  -- The storefront still has something to show.
  select count(*) into n from public_banners;
  if n = 0 then
    raise exception 'no banner is live — the storefront strip would be empty';
  end if;
end $$;
