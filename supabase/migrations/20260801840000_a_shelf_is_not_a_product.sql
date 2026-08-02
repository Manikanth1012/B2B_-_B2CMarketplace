-- A retail customer was being offered fifty vehicle trackers for $4,800.
--
-- `categories.shoppable_by` decides who sees a shelf, and that was the right
-- unit for the seller shelf, which is entirely wholesale. It is the wrong unit
-- for IoT, where a $52 occupancy sensor and a fifty-unit fleet bundle sit next
-- to each other. One of those is a thing a person buys for their house and the
-- other is a procurement exercise.
--
-- So audience moves down a level. A category still says which shelves a
-- persona sees; a product now says who it is actually sold to, and the two are
-- checked together. A category is shoppable if anything on it is.
--
-- The classification below is not by price. It is by whether one of the thing
-- is a purchase a private individual could make: a tracker, an air quality
-- monitor, an occupancy sensor — yes. A per-site managed firewall, a
-- twenty-five seat security bundle, a pooled SIM plan with a twenty-five line
-- minimum, an LTE-M gateway speaking MQTT — no, and no amount of storefront
-- design makes them retail.

alter table products add column if not exists audiences text[] not null
  default array['consumer', 'enterprise'];

/* ------------------------------------------------- who each thing is for -- */

/* Security is business software, priced per site, per seat, per endpoint, per
   user and per mailbox. There is no retail edge of it, which is why the
   category itself moves below. */
update products set audiences = array['enterprise'] where category_id = 'security';

/* IoT is genuinely mixed, and this is the split. */
update products set audiences = array['enterprise'] where id in (
  'SKU-5001',    -- IoT Connect 500 MB · private APN, pooled, minimum 25 lines
  'SKU-5002',    -- IoT Connect 2 GB · per SIM, pooled
  'SKU-5003',    -- Nimbus Cold-chain sensor · a household has no cold chain
  'SKU-5006',    -- Cold-chain starter · 25 sensors
  'SKU-5007',    -- Volta IoT Gateway · LTE-M, NB-IoT, MQTT
  'SKU-5008',    -- Fleet telematics starter · 50 trackers
  'SKU-FP9504'   -- IoT Estate Pool · pooled across an estate
);

/* Everything a seller lists for other sellers stays wholesale. */
update products set audiences = array['partner'] where category_id = 'partner';

/* Retail plans and digital content are retail. 20260801500000 decided that
   deliberately, and the derivation below would otherwise hand both shelves to
   business accounts as a side effect of a default — a widening nobody asked
   for, arriving in a migration about narrowing. */
update products set audiences = array['consumer']
 where category_id in ('consumer', 'content');

/* ---------------------------------------------- and which shelves remain -- */

/* Derived rather than declared: a category is shoppable by a persona when
   something on it is sold to them. Stating it twice is how a shelf ends up
   visible with nothing on it, or hidden with something on it. */
update categories c set shoppable_by = coalesce((
  select array_agg(distinct a order by a)
    from products p, unnest(p.audiences) a
   where p.category_id = c.id and p.status <> 'archived'
), c.shoppable_by);

/* --------------------------------------------------------- the guard --- */

/**
 * What a persona may put in a basket.
 *
 * Both levels, in one place. The category check stays because a shelf nobody
 * may see should not be reachable by guessing a product id, and the product
 * check is added because a shelf being visible has never meant everything on
 * it is for sale to you.
 *
 * The refusal names the product rather than the rule. Somebody who has just
 * been stopped wants to know what they were stopped from buying.
 */
create or replace function guard_shoppable() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
  cat record;
  prod record;
begin
  who := current_persona();
  /* A null persona is a migration or the service role, and the operator runs
     the whole marketplace — neither is a shopper being kept to a shelf. */
  if who is null or who = 'operator' then return new; end if;

  select p.id, p.name, p.audiences, c.id as cat_id, c.name as cat_name, c.shoppable_by
    into prod
    from products p join categories c on c.id = p.category_id
   where p.id = new.product_id;
  if prod is null then return new; end if;   -- no such product; let the FK say so

  if not (who = any (prod.shoppable_by)) then
    raise exception '% is filed under %, which is not sold to %. It is for %.',
      new.product_id, prod.cat_name, who, array_to_string(prod.shoppable_by, ' and ');
  end if;

  if not (who = any (prod.audiences)) then
    raise exception '% is not sold to %. It is for %.',
      prod.name, who, array_to_string(prod.audiences, ' and ');
  end if;

  return new;
end $$;

/* The triggers are already on cart_items and order_items from
   20260801500000; replacing the function is enough. */

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every product says who it is for. */
  select count(*) into n from products where array_length(audiences, 1) is null;
  if n > 0 then raise exception '% products say nobody may buy them', n; end if;

  /* The thing that started this. */
  if exists (select 1 from products where id = 'SKU-5008' and 'consumer' = any (audiences)) then
    raise exception 'a retail customer is still offered fifty vehicle trackers';
  end if;

  /* No security product is retail, and the shelf went with them. */
  select count(*) into n from products where category_id = 'security' and 'consumer' = any (audiences);
  if n > 0 then raise exception '% security products are still on the retail shelf', n; end if;
  if exists (select 1 from categories where id = 'security' and 'consumer' = any (shoppable_by)) then
    raise exception 'the security shelf is still shown to retail customers';
  end if;

  /* But IoT keeps a retail edge, or the split was a category rule wearing a
     product rule's clothes. */
  select count(*) into n from products
   where category_id = 'iot' and 'consumer' = any (audiences) and status = 'live';
  if n < 2 then raise exception 'only % IoT products are left for retail; the shelf is now a pretence', n; end if;

  /* And the shelves 20260801500000 settled are where it left them. This
     migration narrows; it must not widen anything on its way past. */
  select string_agg(id, ', ') into s from categories
   where id in ('consumer', 'content') and 'enterprise' = any (shoppable_by);
  if s is not null then raise exception 'this handed % to business accounts, which is not what it is for', s; end if;
  if not exists (select 1 from categories where id = 'partner' and shoppable_by = array['partner']) then
    raise exception 'the seller shelf no longer belongs to sellers alone';
  end if;

  /* No shelf is visible to somebody with nothing on it to buy. */
  select string_agg(c.id || '/' || a, ', ') into s
    from categories c, unnest(c.shoppable_by) a
   where not exists (select 1 from products p
                      where p.category_id = c.id and a = any (p.audiences)
                        and p.status <> 'archived');
  if s is not null then raise exception 'these shelves are shown to somebody with nothing on them: %', s; end if;

  /* And nothing anybody has already bought became unbuyable. A rule about what
     may be sold now is not a rule about what was sold; but if this fires it
     means the classification above disagrees with something a real customer
     really did, and that is worth reading before it is waved through. */
  select string_agg(distinct p.name, ', ') into s
    from order_items i
    join products p on p.id = i.product_id
    join orders o on o.id = i.order_id
   where o.account_id is null and not ('consumer' = any (p.audiences));
  if s is not null then
    raise exception 'retail has already bought %, which this would make unbuyable', s;
  end if;

  select string_agg(distinct p.name, ', ') into s
    from order_items i
    join products p on p.id = i.product_id
    join orders o on o.id = i.order_id
   where o.account_id is not null and not ('enterprise' = any (p.audiences));
  if s is not null then
    raise exception 'a business account has already bought %, which this would make unbuyable', s;
  end if;

  /* Nothing sitting in a live basket becomes unbuyable at checkout either —
     that is a customer finding out at the till. */
  select string_agg(distinct p.name, ', ') into s
    from cart_items ci
    join products p on p.id = ci.product_id
    join profiles pr on pr.id = ci.user_id
   where not (pr.persona = any (p.audiences));
  if s is not null then
    raise exception 'these are in somebody''s basket and would be refused at checkout: %', s;
  end if;
end $$;
