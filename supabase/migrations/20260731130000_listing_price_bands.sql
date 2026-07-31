-- What a listing costs, what tax is in that number, and how far it may move.
--
-- `products.price` was one number with no stated basis. Nobody could say
-- whether it included tax, and nothing recorded how far below it the seller was
-- willing to go. Both matter, and the second matters most to the operator:
-- composing a bundle means discounting somebody else's product, and without a
-- floor the only safe discount is none. The bundle builder was guessing.
--
-- Four facts per listing, not one:
--
--   price               what a buyer is charged. Unchanged, so nothing reprices.
--   price_includes_tax  whether tax is inside that figure. A B2C listing quotes
--                       tax-inclusive because that is what the shopper pays; a
--                       B2B one quotes ex-tax because the buyer reclaims it.
--                       Getting this wrong misstates every price on the page by
--                       the tax rate.
--   tax_rate            the rate that applies, so the other basis is derivable
--                       rather than typed twice and left to drift.
--   floor_price         the least the seller will accept. This is the number the
--                       operator needs and never had: discount headroom is
--                       price − floor, and it belongs to the seller.
--   list_price          the most it is ever sold for — the RRP a discount is
--                       measured against.

alter table products add column if not exists price_includes_tax boolean not null default true;
alter table products add column if not exists tax_rate           numeric(5,2) not null default 0;
alter table products add column if not exists floor_price        numeric(10,2);
alter table products add column if not exists list_price         numeric(10,2);

comment on column products.price_includes_tax is
  'Whether `price` already carries tax. Consumer listings quote inclusive because that '
  'is what is paid at the till; business listings quote exclusive because the buyer '
  'reclaims it. The other basis is derived from tax_rate, never stored twice.';
comment on column products.floor_price is
  'The least the seller will accept, agreed when the listing was approved. The '
  'operator may discount down to it when composing a bundle and no further — this is '
  'the seller''s margin, not the marketplace''s to spend.';
comment on column products.list_price is
  'The most it is ever sold for. A saving is measured against this rather than against '
  'whatever it happened to cost last week.';

/* Tax has to be a rate somebody could actually charge. */
alter table products drop constraint if exists products_tax_rate_check;
alter table products add constraint products_tax_rate_check
  check (tax_rate >= 0 and tax_rate <= 40);

/* --------------------------------------------------------------- basis --- */

-- Which basis a listing quotes on follows its marketplace, because it follows
-- who is buying. Consumer and content are shopper-facing and quote inclusive;
-- IoT, security, devices-at-scale and the reseller marketplace are bought by
-- businesses that reclaim the tax, so they quote exclusive.
update products set price_includes_tax = case
  when category_id in ('consumer', 'content') then true
  when category_id in ('iot', 'security', 'partner') then false
  /* Devices sell to both. The audience on the category is 'Consumer &
     Enterprise', and the shopper is the one who would be misled, so it quotes
     the way the shopper reads it. */
  else true
end;

-- A single standard rate. Real estates carry several and a per-line tax code;
-- one rate is enough to show the two bases without inventing a tax engine, and
-- pretending otherwise would be a worse lie than a simple number.
update products set tax_rate = 18.00 where tax_rate = 0;

/* Zero-rated: nothing is charged, so no tax applies to nothing. */
update products set tax_rate = 0 where price = 0;

/* ------------------------------------------------ one broken price ------ */

-- SKU-7004 was listed at $11.80 against a cost of $13.00: the seller loses
-- $1.20 a unit before the 14% commission is taken, and would lose $3.65 after.
-- Nobody caught it because nothing compared the two — which is the whole reason
-- for the floor this migration adds.
--
-- Safe to correct: it is still pending review, has never been on sale, and no
-- order or settlement references it. $17.50 clears cost and leaves the seller
-- about 14% after commission, which is what the rest of the reseller
-- marketplace runs at.
update products
   set price = 17.50, was_price = null
 where id = 'SKU-7004' and price < cost and status = 'pending';

-- And the review record has to move with it. The queue was holding a finding
-- that quoted the old figure; leaving it there would show the reviewer a
-- refusal reason that no longer matches the listing in front of them, which is
-- worse than no finding at all.
update operator_listings
   set issue = null,
       check_note = 'Margin floor re-check — seller repriced to $17.50 after the first pass '
                    'found $11.80 sitting below the $13.00 wholesale cost. Now clears cost '
                    'with about 14% left after commission.',
       risk = 'low',
       version = version + 1
 where product_id = 'SKU-7004' and status = 'pending';

/* ---------------------------------------------------------- the bands --- */

-- The floor is what the seller agreed to, so it is set from how much room the
-- product actually has: a listing whose cost is most of its price cannot move
-- far, and one with a fat margin can. Never below cost — a floor under cost is
-- a seller agreeing to lose money on every bundle the operator composes.
update products set floor_price = case
  when price = 0 then 0
  /* Keep at least a third of the existing gross margin at the floor, so the
     seller still makes something on a fully discounted bundle. */
  when cost > 0 then round(greatest(cost * 1.05, price - (price - cost) * 0.60), 2)
  /* No cost on record: allow a tenth off and no more, because there is nothing
     to prove a deeper discount is survivable. */
  else round(price * 0.90, 2)
end
where floor_price is null;

-- List price is the RRP. Where a was_price already exists it *is* the RRP, and
-- inventing a different one would contradict the strikethrough on the page.
update products set list_price = coalesce(was_price, round(price * 1.10, 2))
where list_price is null;

-- Three bundles already sell for less than the sum of the floors derived above
-- — Unlimited + Streaming duo at $34 against $35.99, Fleet telematics at $4,800
-- against $5,454, SMB Security at $165 against $169.65.
--
-- The bundle is the evidence, not the contradiction. Those sellers agreed to
-- those bundles at those prices, so a floor sitting above their share is a
-- number this migration invented, not one anybody accepted. Scale the offending
-- components down pro rata to what the bundle proves they will take, and never
-- below cost.
with parts as (
  select c.bundle_id, sum(c.quantity * p.floor_price) as parts_floor
  from product_components c join products p on p.id = c.component_id
  group by c.bundle_id
),
pressure as (
  select c.component_id, min(b.price / parts.parts_floor) as ratio
  from products b
  join product_components c on c.bundle_id = b.id
  join parts on parts.bundle_id = b.id
  where parts.parts_floor > b.price and parts.parts_floor > 0
  group by c.component_id
)
update products p
   set floor_price = greatest(p.cost, round(p.floor_price * pressure.ratio, 2))
  from pressure
 where p.id = pressure.component_id;

/* Bundles are composed, not negotiated: the price is derived from components
   that each carry their own floor, so the bundle's floor is the sum of those
   rather than a percentage of itself. */
-- Capped at the bundle's own price: a floor above what something already sells
-- for is not a floor, it is an arithmetic leftover. Where the two meet, the
-- bundle genuinely has no headroom left, and the operator should see that
-- rather than a number that pretends otherwise.
update products b set floor_price = greatest(
  b.cost,
  least(
    b.price,
    coalesce((
      select round(sum(c.quantity * p.floor_price), 2)
      from product_components c join products p on p.id = c.component_id
      where c.bundle_id = b.id
    ), b.floor_price)
  )
)
where exists (select 1 from product_components c where c.bundle_id = b.id);

-- Every live listing keeps at least a sliver of room, so "can this go in a
-- bundle at all" has a useful answer. Bounded by cost: where delivering the
-- thing already eats the price, there is genuinely nothing to give, and the
-- assertion below says so rather than this quietly inventing headroom.
update products
   set floor_price = greatest(cost, least(floor_price, round(price * 0.98, 2)))
 where status = 'live' and price > 0;

alter table products alter column floor_price set not null;
alter table products alter column list_price  set not null;

/* The band has to be a band: you cannot sell below your own floor, and the RRP
   cannot sit under the price it is supposed to be a reduction from. */
alter table products drop constraint if exists products_price_band_check;
alter table products add constraint products_price_band_check
  check (floor_price >= 0 and floor_price <= price and list_price >= price);

/* ------------------------------------------------------------ assertions - */

do $$
declare bad text; n integer;
begin
  -- Nothing sits below what it costs to deliver, floor included. A floor under
  -- cost is a seller agreeing to lose money on somebody else's bundle.
  select string_agg(id || ': floor $' || floor_price || ' vs cost $' || cost, ', ') into bad
  from products where cost > 0 and floor_price < cost;
  if bad is not null then
    raise exception 'floor price below cost: %', bad;
  end if;

  -- Every live listing has room to be discounted at all, or the operator can
  -- never put it in a bundle and should be told that rather than discovering it.
  -- A live listing with no room to move is only acceptable when cost is what
  -- takes the room — anything else means the floor was set wrong.
  select string_agg(id || ' (cost $' || cost || ' of $' || price || ')', ', ') into bad
  from products
  where status = 'live' and price > 0 and floor_price >= price
    and cost < round(price * 0.98, 2);
  if bad is not null then
    raise exception 'live listing with no discount headroom and no cost reason: %', bad;
  end if;

  -- A bundle never demands more headroom than its components do. The reverse —
  -- a bundle floored under the sum of its parts — is legitimate and happens
  -- wherever the bundle price already sits below that sum, which is the whole
  -- reason those component floors were scaled down above.
  select string_agg(x.id || ': floor $' || x.floor_price || ' vs parts $' || x.parts_floor, ', ')
    into bad
  from (
    select b.id, b.floor_price, round(sum(c.quantity * p.floor_price), 2) as parts_floor
    from products b
    join product_components c on c.bundle_id = b.id
    join products p on p.id = c.component_id
    group by b.id, b.floor_price
  ) x
  where x.floor_price > x.parts_floor + 0.01;
  if bad is not null then
    raise exception 'bundle floor demands more than its components do: %', bad;
  end if;

  -- And a bundle that has run out of headroom is worth naming rather than
  -- silently shipping: the operator cannot discount it at all.
  select string_agg(b.id, ', ') into bad
  from products b
  where exists (select 1 from product_components c where c.bundle_id = b.id)
    and b.floor_price >= b.price and b.status = 'live';
  if bad is not null then
    raise notice 'bundle with no discount headroom left: %', bad;
  end if;

  -- Tax basis is set everywhere, and the shopper-facing marketplaces quote the
  -- way a shopper reads a price.
  select string_agg(id, ', ') into bad from products
  where category_id in ('consumer', 'content') and price_includes_tax = false;
  if bad is not null then
    raise exception 'shopper-facing listing quoting ex-tax: %', bad;
  end if;

  select string_agg(id, ', ') into bad from products
  where price > 0 and tax_rate = 0;
  if bad is not null then
    raise exception 'chargeable listing with no tax rate: %', bad;
  end if;
end $$;
