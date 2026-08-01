-- Who may shop a category, said in a column rather than guessed from prose.
--
-- The Partner category is reseller enablement — a white-label storefront, a
-- wholesale connectivity pack of 500 lines, sandbox access to the partner API,
-- a reseller starter of 100 lines. It is how somebody sets up as a reseller,
-- not something a retail customer buys. It was appearing on the consumer home
-- page under "Shop by category" with a Browse button, in the consumer header
-- nav, and its products were landing in "Featured products" beside a charger.
--
-- The reason it leaked is that the only thing recording who a category is for
-- was `audience`, which is display prose — 'B2C', 'Enterprise', 'B2B2X',
-- 'Consumer & Enterprise'. Every screen that needed the answer did its own
-- substring match on it, and a rule spelled differently in four places is four
-- rules. `shoppable_by` says it once, as data.
--
-- Note what this is not. It is not "who may see it": the public Partner page is
-- the shop window for prospective resellers and has to show exactly these
-- products, and the operator runs all six. It is who may put one in a basket
-- and pay for it, which is a different question and the one that was wrong.

/* ================================================== who may buy from it === */

alter table categories add column if not exists shoppable_by text[] not null default '{}';

alter table categories drop constraint if exists categories_shoppable_by_check;
alter table categories add constraint categories_shoppable_by_check
  check (shoppable_by <@ array['consumer', 'enterprise', 'partner']::text[]);

/* A category nobody can buy from is a category nobody should be shown, and
   there is no "visible but unbuyable" state any screen would honour. */
alter table categories drop constraint if exists categories_shoppable_by_nonempty;
alter table categories add constraint categories_shoppable_by_nonempty
  check (array_length(shoppable_by, 1) >= 1);

/* Set from what each shelf is actually reachable by today, not from a tidier
   idea of what it ought to be. IoT and Security read 'Enterprise' and are
   promoted on the enterprise rail, but they are also on the retail shop and a
   retail customer has bought, reviewed and refunded a sensor from IoT — so
   they stay reachable by both. Narrowing those two is a commercial decision
   for the operator, not a side effect of fixing Partner. */
update categories set shoppable_by = case id
  when 'consumer' then array['consumer']
  when 'content'  then array['consumer']
  when 'device'   then array['consumer', 'enterprise']
  when 'iot'      then array['consumer', 'enterprise']
  when 'security' then array['consumer', 'enterprise']
  /* The one this migration exists for. Bought by a reseller to run a reselling
     business; sold to them by the marketplace; browsable by a prospective one
     on the public partner page; not on a retail shelf. */
  when 'partner'  then array['partner']
  else shoppable_by end
 where shoppable_by = '{}';

/* `audience` stays. It is the line printed on a category tile — "B2B2X",
   "Consumer & Enterprise" — written for a person to read, and it still decides
   which rail the public landing page promotes a category on. What it stops
   being is the thing a permission branches on. */
comment on column categories.audience is
  'Display prose, and which rail the public landing promotes this on. Never branch a permission on it — use shoppable_by.';
comment on column categories.shoppable_by is
  'The personas that may put a product from this category in a basket and pay for it. Not who may see it: the public partner page shows the partner category to anyone.';

/* ============================================== and the rule with teeth === */

/**
 * A basket, and then an order, cannot cross the line the column draws.
 *
 * RLS cannot express this. It filters rows by ownership, and every one of these
 * rows genuinely belongs to the person adding it — what makes the line wrong is
 * the *category of the product* against the *persona of the buyer*, which is a
 * comparison between the row being written and the person writing it. So it is
 * a trigger, and it sits under the screens rather than inside them: a rule only
 * the client enforces is a rule the API does not have.
 */
create or replace function guard_shoppable() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  who text;
  cat record;
begin
  who := current_persona();
  /* A null persona is a migration or the service role, and the operator runs
     the whole marketplace — neither is a shopper being kept to a shelf. */
  if who is null or who = 'operator' then return new; end if;

  select c.id, c.name, c.shoppable_by into cat
    from products p join categories c on c.id = p.category_id
   where p.id = new.product_id;
  if cat is null then return new; end if;   -- no such product; let the FK say so

  if not (who = any (cat.shoppable_by)) then
    raise exception '% is filed under %, which is not sold to %. It is for %.',
      new.product_id, cat.name, who, array_to_string(cat.shoppable_by, ' and ');
  end if;

  return new;
end $$;

drop trigger if exists cart_items_shoppable_guard on cart_items;
create trigger cart_items_shoppable_guard before insert or update on cart_items
  for each row execute function guard_shoppable();

drop trigger if exists order_items_shoppable_guard on order_items;
create trigger order_items_shoppable_guard before insert or update on order_items
  for each row execute function guard_shoppable();

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every category says who it is for. */
  select count(*) into n from categories where array_length(shoppable_by, 1) is null;
  if n > 0 then raise exception '% categories say nobody may buy from them', n; end if;

  /* The partner shelf is not a retail shelf. That is the whole point of this
     migration, so it is asserted rather than assumed. */
  if exists (select 1 from categories where id = 'partner' and 'consumer' = any (shoppable_by)) then
    raise exception 'the partner category is still shoppable by retail customers';
  end if;

  /* And nothing else quietly moved out from under a shopper who has one today.
     A category that used to be reachable and no longer is empties a shelf, and
     that is a decision somebody makes on purpose, not a migration side effect. */
  select string_agg(distinct c.id, ', ') into s
    from order_items i
    join products p on p.id = i.product_id
    join categories c on c.id = p.category_id
    join orders o on o.id = i.order_id
   where o.account_id is null and not ('consumer' = any (c.shoppable_by));
  if s is not null then
    raise exception 'retail has already bought from %, which this would make unshoppable', s;
  end if;

  select string_agg(distinct c.id, ', ') into s
    from order_items i
    join products p on p.id = i.product_id
    join categories c on c.id = p.category_id
    join orders o on o.id = i.order_id
   where o.account_id is not null and not ('enterprise' = any (c.shoppable_by));
  if s is not null then
    raise exception 'an enterprise has already bought from %, which this would make unshoppable', s;
  end if;

  /* Nothing sitting in a basket either, or the next checkout fails on a line
     somebody added a fortnight ago. */
  select string_agg(distinct c.id, ', ') into s
    from cart_items ct
    join products p on p.id = ct.product_id
    join categories c on c.id = p.category_id
   where not ('consumer' = any (c.shoppable_by));
  if s is not null then
    raise exception 'baskets already hold products from %, which this would make unshoppable', s;
  end if;

  /* Every live product sits somewhere somebody can buy it. A listing nobody can
     reach gets reported as a bug eventually. */
  select count(*) into n from products p join categories c on c.id = p.category_id
   where p.status = 'live' and array_length(c.shoppable_by, 1) is null;
  if n > 0 then raise exception '% live products sit in a category nobody can buy from', n; end if;

  /* The partner category still has something in it. If this fires, the shop
     window we just pointed prospective resellers at is empty. */
  select count(*) into n from products where category_id = 'partner' and status = 'live';
  if n = 0 then raise exception 'the partner category has no live products to show a prospective reseller'; end if;
end $$;
