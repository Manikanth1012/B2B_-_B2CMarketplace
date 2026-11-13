/*
 * A basket is kept, watched, and kept honest.
 *
 * Spec 11, section 2 (docs/superpowers/specs/2026-11-13-loose-ends-ii-design.md,
 * decisions 1, 2, 2a to 2c). Applies after 20261113100000.
 *
 *   1. The business requisition basket is kept in the database, one per buyer:
 *      `requisition_baskets` and `requisition_basket_lines` (the client's
 *      `BasketLine` fields, plus the stock flag). The owner reads their own,
 *      the operator reads all, and nobody writes them except through
 *      `save_requisition_basket`, `clear_requisition_basket` and
 *      `accept_basket_flag`.
 *
 *   2. The shopper basket (`cart_items`, already in the database) gains the
 *      same stock flag and an `updated_at` that a buyer's change stamps and the
 *      marketplace's flag does not. Its policies are unchanged: the owner reads
 *      and writes their own as a shopper (20260729130300), and the operator's
 *      read (`operator_read_cart_items`, from the same migration) is kept.
 *
 *   3. Flag and cap. When a product's listing status or stock badge changes
 *      (`products.status`, `products.stock`), or the warehouse count behind it
 *      does (`operator_inventory.on_hand` / `reserved`, whose `available` is
 *      the number left), `flag_basket_stock` marks every basket line of it:
 *      "Only N left — we reduced this from M" with the quantity cut to N, or
 *      "No longer available" with the quantity left as it was. Never cleared
 *      by the marketplace; only the buyer clears a flag, by accepting it or by
 *      changing the quantity of a business line to one that fits.
 *
 *   4. While a line is flagged the database refuses to buy it: a shopper's
 *      order line for a product whose basket line is flagged
 *      (`guard_flagged_cart_order_line` on `order_items`), and a business
 *      buyer's requisition line for a product whose basket line is flagged
 *      (`guard_flagged_basket_requisition_line` on
 *      `enterprise_requisition_lines`). A business order from an approved
 *      requisition is never touched.
 *
 *   5. The operator may remind an owner (`remind_basket_owner`), in-app, at
 *      most once a day per basket. The operator never deletes a basket.
 *
 *   6. The night gains `baskets` (`run_baskets_night`): the stock flag again
 *      over every basket line, and baskets untouched for 90 days cleared.
 *      Eight jobs. `delete_unused_bundle_selections` now leaves a selection
 *      that is on a kept basket alone.
 *
 * And the help article for the operator's Baskets screen (`op-baskets`), and
 * the Scheduled jobs article told about the eighth job.
 *
 * Idempotent, one transaction, self-check last.
 */

begin;

/* ======================================================= 1. the tables -- */

create table if not exists public.requisition_baskets (
  id          text primary key default gen_random_uuid()::text,
  account_id  text not null references public.enterprise_accounts(id) on delete cascade,
  user_id     uuid not null unique references auth.users(id) on delete cascade,
  currency    text not null references public.currencies(code),
  created_at  timestamptz not null default now(),
  /* The buyer's last change. A stock flag does not move it: the buyer did not
     touch the basket. Pending under 7 days old, abandoned after, cleared by
     the night after 90. */
  updated_at  timestamptz not null default now(),
  reminded_at timestamptz
);

comment on table public.requisition_baskets is
  'A business buyer''s requisition basket, kept between visits and devices. One per buyer. Written only by save_requisition_basket, clear_requisition_basket and accept_basket_flag; read by its owner and the operator.';

create index if not exists requisition_baskets_account_idx on public.requisition_baskets(account_id);
create index if not exists requisition_baskets_updated_idx on public.requisition_baskets(updated_at);

create table if not exists public.requisition_basket_lines (
  id                  text primary key default gen_random_uuid()::text,
  basket_id           text not null references public.requisition_baskets(id) on delete cascade,
  product_id          text not null references public.products(id) on delete cascade,
  name                text not null,
  seller              text not null default '',
  partner_id          text references public.partners(id) on delete set null,
  quantity            integer not null check (quantity > 0),
  unit_price          numeric(10,2) not null check (unit_price >= 0),
  model               text not null check (model in ('oneoff', 'monthly')),
  vertical            text,
  unit                text,
  quote_line_id       text,
  bundle_selection_id text references public.bundle_selections(id) on delete cascade,
  /* The client's BundleMeta, kept as it sent it so the drawer can show the
     bundle's name and hold without another read. */
  bundle              jsonb,
  on_contract         boolean,
  off_contract_reason text,
  stock_note          text,
  was_quantity        integer,
  flagged_at          timestamptz,
  sort_order          integer not null default 0
);

comment on column public.requisition_basket_lines.stock_note is
  'Set by flag_basket_stock: "Only N left — we reduced this from M" or "No longer available". While set, the buyer cannot raise a requisition with this product. Cleared only by the buyer.';
comment on column public.requisition_basket_lines.was_quantity is
  'What the buyer asked for before the marketplace cut the quantity to what is left. Null unless capped.';

create index if not exists requisition_basket_lines_basket_idx on public.requisition_basket_lines(basket_id, sort_order);
create index if not exists requisition_basket_lines_product_idx on public.requisition_basket_lines(product_id);
create index if not exists requisition_basket_lines_selection_idx on public.requisition_basket_lines(bundle_selection_id)
  where bundle_selection_id is not null;

/* A shopper's basket has no header row, so its reminder is kept here. */
create table if not exists public.cart_reminders (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  reminded_at timestamptz not null,
  reminded_by uuid references auth.users(id) on delete set null
);

comment on table public.cart_reminders is
  'When the operator last reminded a shopper about their basket. At most one a day (remind_basket_owner).';

alter table public.cart_items add column if not exists stock_note   text;
alter table public.cart_items add column if not exists was_quantity integer;
alter table public.cart_items add column if not exists flagged_at   timestamptz;
/* Existing lines start from today: when they were last touched is not known,
   and backfilling `created_at` would have the first night clear every demo
   basket older than 90 days. */
alter table public.cart_items add column if not exists updated_at   timestamptz not null default now();

comment on column public.cart_items.stock_note is
  'Set by flag_basket_stock: "Only N left — we reduced this from M" or "No longer available". While set, checkout cannot order this product. Cleared only by the buyer (accept_basket_flag).';
comment on column public.cart_items.updated_at is
  'The shopper''s last change to this line. Stamped by stamp_cart_line; a stock flag does not move it.';

create index if not exists cart_items_updated_idx on public.cart_items(user_id, updated_at);

/* ------------------------------------------------------------ policies -- */

alter table public.requisition_baskets      enable row level security;
alter table public.requisition_basket_lines enable row level security;
alter table public.cart_reminders           enable row level security;

drop policy if exists "owner_read_requisition_baskets"         on public.requisition_baskets;
drop policy if exists "operator_read_requisition_baskets"      on public.requisition_baskets;
drop policy if exists "owner_read_requisition_basket_lines"    on public.requisition_basket_lines;
drop policy if exists "operator_read_requisition_basket_lines" on public.requisition_basket_lines;
drop policy if exists "owner_read_cart_reminders"              on public.cart_reminders;
drop policy if exists "operator_read_cart_reminders"           on public.cart_reminders;

create policy "owner_read_requisition_baskets" on public.requisition_baskets for select to authenticated
  using (user_id = auth.uid());
create policy "operator_read_requisition_baskets" on public.requisition_baskets for select to authenticated
  using (current_persona() = 'operator');
create policy "owner_read_requisition_basket_lines" on public.requisition_basket_lines for select to authenticated
  using (exists (select 1 from public.requisition_baskets b
                  where b.id = requisition_basket_lines.basket_id and b.user_id = auth.uid()));
create policy "operator_read_requisition_basket_lines" on public.requisition_basket_lines for select to authenticated
  using (current_persona() = 'operator');
create policy "owner_read_cart_reminders" on public.cart_reminders for select to authenticated
  using (user_id = auth.uid());
create policy "operator_read_cart_reminders" on public.cart_reminders for select to authenticated
  using (current_persona() = 'operator');

/* No write policy on any of the three: the functions below write them. */
revoke all on public.requisition_baskets      from anon;
revoke all on public.requisition_basket_lines from anon;
revoke all on public.cart_reminders           from anon;
revoke insert, update, delete on public.requisition_baskets      from authenticated;
revoke insert, update, delete on public.requisition_basket_lines from authenticated;
revoke insert, update, delete on public.cart_reminders           from authenticated;
grant select on public.requisition_baskets, public.requisition_basket_lines, public.cart_reminders to authenticated;

/* The operator's read of shopper baskets, as 20260729130300 wrote it. Recreated
   here only so this migration can rely on it; nothing for anybody else moves. */
drop policy if exists "operator_read_cart_items" on public.cart_items;
create policy "operator_read_cart_items" on public.cart_items for select to authenticated
  using (current_persona() = 'operator');

/* ==================================================== 2. what is left -- */

/* The units left of a product: the warehouse's `available` (on hand less
   reserved), summed over its warehouses. Null when no warehouse counts it
   (digital goods, services, eSIMs), or it is on pre-order: then only the
   listing's status and stock badge can make it unavailable. */
create or replace function public.basket_stock_left(p_product text)
returns integer language sql stable security definer set search_path = public as $$
  select case when p.stock = 'preorder' then null
              else (select sum(i.available)::integer from public.operator_inventory i where i.product_id = p.id) end
    from public.products p
   where p.id = p_product
$$;

revoke all on function public.basket_stock_left(text) from public, anon, authenticated;

/* What a basket line of `p_quantity` of `p_product` should say now, or null
   when it can be bought as it is. `p_was` is what the buyer asked for before
   an earlier cut, so the note keeps naming the buyer's own number.
     {note, quantity, was}: the flag to write. A bundle part is never cut (its
     quantity is the bundle's, and guard_bundle_cart_line holds it there), so
     it is flagged at its quantity and can only be removed with its bundle. */
create or replace function public.basket_line_stock_flag(
  p_product text, p_quantity integer, p_bundle boolean, p_was integer)
returns jsonb language plpgsql stable security definer set search_path = public as $$
<<fl>>
declare
  v_status text;
  v_stock  text;
  v_left   integer;
  v_asked  integer := coalesce(p_was, p_quantity);
begin
  if p_product is null then return null; end if;

  select p.status, p.stock into v_status, v_stock from public.products p where p.id = p_product;
  if not found or v_status is distinct from 'live' or v_stock = 'out' then
    return jsonb_build_object('note', 'No longer available', 'quantity', p_quantity, 'was', null);
  end if;

  v_left := public.basket_stock_left(p_product);
  if v_left is null or v_left >= p_quantity then
    return null;
  end if;
  if v_left <= 0 then
    return jsonb_build_object('note', 'No longer available', 'quantity', p_quantity, 'was', null);
  end if;
  if p_bundle then
    return jsonb_build_object('note', format('Only %s left — this bundle needs %s', v_left, p_quantity),
                              'quantity', p_quantity, 'was', null);
  end if;
  return jsonb_build_object('note', format('Only %s left — we reduced this from %s', v_left, v_asked),
                            'quantity', v_left, 'was', v_asked);
end $$;

revoke all on function public.basket_line_stock_flag(text, integer, boolean, integer) from public, anon, authenticated;

/* ================================================= 3. flag and cap -- */

/* Every cart and business basket line of `p_product`, flagged (and capped)
   where it no longer fits. A flag already there is cleared only by the buyer,
   never here. Returns how many lines it changed; a line already saying the
   same is not counted again, so the night can run it over and over. The
   session setting `aventa.basket_flag` tells `stamp_cart_line` this write is
   the marketplace's, so the shopper's `updated_at` stays where it was. */
create or replace function public.flag_basket_stock(p_product text)
returns integer language plpgsql security definer set search_path = public as $$
<<fb>>
declare
  v_line  record;
  v_flag  jsonb;
  v_n     integer := 0;
  v_prior text := coalesce(current_setting('aventa.basket_flag', true), '');
begin
  if p_product is null then return 0; end if;
  perform set_config('aventa.basket_flag', 'on', true);

  for v_line in
    select c.id, c.quantity, c.was_quantity, c.stock_note, c.bundle_selection_id
      from public.cart_items c
     where c.product_id = p_product
     order by c.id
       for update
  loop
    v_flag := public.basket_line_stock_flag(p_product, v_line.quantity, v_line.bundle_selection_id is not null, v_line.was_quantity);
    continue when v_flag is null;
    if v_line.stock_note is distinct from (v_flag ->> 'note')
       or v_line.quantity is distinct from (v_flag ->> 'quantity')::integer then
      update public.cart_items c
         set stock_note   = v_flag ->> 'note',
             quantity     = (v_flag ->> 'quantity')::integer,
             was_quantity = (v_flag ->> 'was')::integer,
             flagged_at   = now()
       where c.id = v_line.id;
      v_n := v_n + 1;
    end if;
  end loop;

  for v_line in
    select l.id, l.quantity, l.was_quantity, l.stock_note, l.bundle_selection_id
      from public.requisition_basket_lines l
     where l.product_id = p_product
     order by l.id
       for update
  loop
    v_flag := public.basket_line_stock_flag(p_product, v_line.quantity, v_line.bundle_selection_id is not null, v_line.was_quantity);
    continue when v_flag is null;
    if v_line.stock_note is distinct from (v_flag ->> 'note')
       or v_line.quantity is distinct from (v_flag ->> 'quantity')::integer then
      update public.requisition_basket_lines l
         set stock_note   = v_flag ->> 'note',
             quantity     = (v_flag ->> 'quantity')::integer,
             was_quantity = (v_flag ->> 'was')::integer,
             flagged_at   = now()
       where l.id = v_line.id;
      v_n := v_n + 1;
    end if;
  end loop;

  perform set_config('aventa.basket_flag', fb.v_prior, true);
  return v_n;
end $$;

revoke all on function public.flag_basket_stock(text) from public, anon, authenticated;

/* The triggers. A listing paused by its seller, or a count taken in the
   warehouse, must not fail because a basket could not be flagged: the
   failure is reported as a warning and the night's `baskets` job flags it
   instead. */
create or replace function public.products_flag_baskets() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform public.flag_basket_stock(new.id);
  exception when others then
    raise warning 'Baskets holding % were not flagged: % (%). The night will flag them.', new.id, sqlerrm, sqlstate;
  end;
  return null;
end $$;

revoke all on function public.products_flag_baskets() from public, anon, authenticated;

drop trigger if exists z_products_flag_baskets on public.products;
create trigger z_products_flag_baskets
  after update of stock, status on public.products
  for each row
  when (old.stock is distinct from new.stock or old.status is distinct from new.status)
  execute function public.products_flag_baskets();

create or replace function public.inventory_flag_baskets() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_product text;
begin
  if tg_op = 'DELETE' then
    v_product := old.product_id;
  else
    v_product := new.product_id;
  end if;
  begin
    perform public.flag_basket_stock(v_product);
  exception when others then
    raise warning 'Baskets holding % were not flagged: % (%). The night will flag them.', v_product, sqlerrm, sqlstate;
  end;
  return null;
end $$;

revoke all on function public.inventory_flag_baskets() from public, anon, authenticated;

drop trigger if exists z_inventory_flag_baskets on public.operator_inventory;
create trigger z_inventory_flag_baskets
  after insert or update of on_hand, reserved, product_id or delete on public.operator_inventory
  for each row execute function public.inventory_flag_baskets();

/* ------------------------------------------- the shopper's line stamps -- */

/* `cart_items.updated_at`, and who may write the flag. Not security definer,
   on purpose: `current_user` is then `authenticated` (or `anon`) for a write
   straight from the app, and the function's owner inside the marketplace's
   own functions. Straight from the app the flag columns cannot be written at
   all (a new line starts unflagged; accepting is `accept_basket_flag`). The
   marketplace's flag write keeps `updated_at`; every other change stamps it. */
create or replace function public.stamp_cart_line() returns trigger
language plpgsql set search_path = public as $$
declare
  v_api boolean := current_user::text in ('anon', 'authenticated');
begin
  if tg_op = 'INSERT' then
    if v_api then
      new.stock_note := null;
      new.was_quantity := null;
      new.flagged_at := null;
      new.updated_at := now();
    else
      new.updated_at := coalesce(new.updated_at, now());
    end if;
    return new;
  end if;

  if not v_api and coalesce(current_setting('aventa.basket_flag', true), '') = 'on' then
    new.updated_at := old.updated_at;
    return new;
  end if;

  if v_api and (new.stock_note is distinct from old.stock_note
                or new.was_quantity is distinct from old.was_quantity
                or new.flagged_at is distinct from old.flagged_at) then
    raise exception 'The stock note on a basket line is the marketplace''s. Accept the change, or remove the line.';
  end if;

  new.updated_at := now();
  return new;
end $$;

revoke all on function public.stamp_cart_line() from public, anon, authenticated;

drop trigger if exists cart_items_basket_stamp on public.cart_items;
create trigger cart_items_basket_stamp before insert or update on public.cart_items
  for each row execute function public.stamp_cart_line();

/**
 * `guard_shoppable`, copied from 20260801840000 (its latest definition).
 * Changed only: on `cart_items`, an update that keeps the product and the
 * owner returns at once. It puts nothing new in the basket, and without it a
 * seller pausing their own listing would be refused here, because the stock
 * flag it sets on a shopper's line would be judged as the seller shopping.
 *
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

  /* Nothing new goes in the basket: a quantity, a saved flag or a stock flag. */
  if tg_op = 'UPDATE' and tg_table_name = 'cart_items'
     and new.product_id is not distinct from old.product_id
     and new.user_id is not distinct from old.user_id then
    return new;
  end if;

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

/* =========================================== 4. refused while flagged -- */

/* A shopper's checkout writes `orders` and then `order_items` straight from
   the app (src/components/Checkout.tsx), carrying no cart line id. So the
   refusal is on the order line: a shopper's order (no account) may not take a
   product whose line in the same shopper's basket (not saved for later, same
   bundle or none) is flagged. A business order (account set), written when a
   requisition is approved, is not touched. */
create or replace function public.guard_flagged_cart_order_line() returns trigger
language plpgsql security definer set search_path = public as $$
<<g>>
declare
  v_user    uuid;
  v_account text;
  v_note    text;
  v_name    text;
begin
  if public.current_persona() is distinct from 'consumer' then return new; end if;
  if tg_op = 'UPDATE'
     and new.product_id is not distinct from old.product_id
     and new.order_id is not distinct from old.order_id
     and new.bundle_selection_id is not distinct from old.bundle_selection_id then
    return new;
  end if;

  select o.user_id, o.account_id into v_user, v_account from public.orders o where o.id = new.order_id;
  if v_account is not null or v_user is null then return new; end if;

  select c.stock_note, p.name into v_note, v_name
    from public.cart_items c
    left join public.products p on p.id = c.product_id
   where c.user_id = v_user
     and not c.saved
     and c.product_id = new.product_id
     and c.bundle_selection_id is not distinct from new.bundle_selection_id
     and c.stock_note is not null
   order by c.flagged_at desc nulls last
   limit 1;

  if v_note is not null then
    raise exception '% in your basket: %. Accept the change or remove it before checking out.',
      coalesce(v_name, new.product_id), v_note;
  end if;
  return new;
end $$;

revoke all on function public.guard_flagged_cart_order_line() from public, anon, authenticated;

drop trigger if exists z_flagged_cart_order_line on public.order_items;
create trigger z_flagged_cart_order_line
  before insert or update of product_id, order_id, bundle_selection_id on public.order_items
  for each row execute function public.guard_flagged_cart_order_line();

/* Raising a requisition is two inserts straight from the app
   (`raiseRequisition` in src/lib/enterpriseRepo.ts): the header, then its
   lines; a refused line makes the app delete the header again. So the refusal
   is on the line: a business buyer may not write a requisition line for a
   product whose line in their own kept basket (same bundle or none) is
   flagged. Only the business buyer's own writes are judged; an approval, the
   operator and the schedule are not. */
create or replace function public.guard_flagged_basket_requisition_line() returns trigger
language plpgsql security definer set search_path = public as $$
<<g>>
declare
  v_note text;
  v_name text;
begin
  if public.current_persona() is distinct from 'enterprise' or auth.uid() is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.product_id is not distinct from old.product_id
     and new.requisition_id is not distinct from old.requisition_id
     and new.bundle_selection_id is not distinct from old.bundle_selection_id then
    return new;
  end if;

  select l.stock_note, l.name into v_note, v_name
    from public.requisition_basket_lines l
    join public.requisition_baskets b on b.id = l.basket_id
   where b.user_id = auth.uid()
     and l.product_id = new.product_id
     and l.bundle_selection_id is not distinct from new.bundle_selection_id
     and l.stock_note is not null
   order by l.flagged_at desc nulls last
   limit 1;

  if v_note is not null then
    raise exception '% in your requisition basket: %. Accept the change or remove it before raising the requisition.',
      coalesce(v_name, new.product_id), v_note;
  end if;
  return new;
end $$;

revoke all on function public.guard_flagged_basket_requisition_line() from public, anon, authenticated;

drop trigger if exists z_flagged_basket_requisition_line on public.enterprise_requisition_lines;
create trigger z_flagged_basket_requisition_line
  before insert or update of product_id, requisition_id, bundle_selection_id on public.enterprise_requisition_lines
  for each row execute function public.guard_flagged_basket_requisition_line();

/* ================================================ 5. the buyer's calls -- */

/* One basket as the app reads it. */
create or replace function public.requisition_basket_json(p_basket text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
           'id', b.id, 'account_id', b.account_id, 'currency', b.currency,
           'updated_at', b.updated_at, 'reminded_at', b.reminded_at,
           'lines', coalesce((
             select jsonb_agg(jsonb_build_object(
                      'id', l.id, 'product_id', l.product_id, 'name', l.name, 'seller', l.seller,
                      'partner_id', l.partner_id, 'quantity', l.quantity, 'unit_price', l.unit_price,
                      'model', l.model, 'vertical', l.vertical, 'unit', l.unit,
                      'quote_line_id', l.quote_line_id, 'bundle_selection_id', l.bundle_selection_id,
                      'bundle', l.bundle, 'on_contract', l.on_contract,
                      'off_contract_reason', l.off_contract_reason,
                      'stock_note', l.stock_note, 'was_quantity', l.was_quantity,
                      'flagged_at', l.flagged_at, 'sort_order', l.sort_order)
                    order by l.sort_order, l.id)
               from public.requisition_basket_lines l where l.basket_id = b.id), '[]'::jsonb))
    from public.requisition_baskets b
   where b.id = p_basket
$$;

revoke all on function public.requisition_basket_json(text) from public, anon, authenticated;

/**
 * The signed-in business buyer's basket, replaced in one go.
 *
 * `p_lines` is a JSON array of the client's BasketLine: product_id, name,
 * seller, partner_id, quantity, unit_price, model, vertical, unit,
 * quote_line_id, bundle_selection_id, bundle, on_contract,
 * off_contract_reason. An empty array deletes the basket.
 *
 * A line keeps its id, and its stock flag while its product, bundle, quote
 * and quantity are what they were. Any other line (new, or with a quantity
 * the buyer changed) is judged afresh: no flag if it fits what is left, which
 * is the buyer accepting a flag by changing the quantity; flagged, and cut to
 * what is left, if it does not.
 *
 * Returns {basket: <basket json> | null}.
 */
create or replace function public.save_requisition_basket(p_currency text, p_lines jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
<<sv>>
declare
  v_uid     uuid := auth.uid();
  v_account text;
  v_basket  text;
  v_old     jsonb;
  v_used    text[] := array[]::text[];
  v_line    jsonb;
  v_prev    jsonb;
  v_flag    jsonb;
  v_n       integer := 0;
  v_pid     text;
  v_qty     integer;
  v_price   numeric;
  v_model   text;
  v_sel     text;
  v_quote   text;
  v_pname   text;
  v_aud     text[];
  v_note    text;
  v_was     integer;
  v_at      timestamptz;
  v_lid     text;
begin
  if public.current_persona() is distinct from 'enterprise' or v_uid is null then
    raise exception 'Only a signed-in business buyer keeps a requisition basket.';
  end if;
  v_account := public.current_account_id();
  if v_account is null or not exists (
       select 1 from public.enterprise_users u
        where u.user_id = v_uid and u.account_id = v_account and u.status = 'active') then
    raise exception 'You are not an active member of a business account, so there is no basket to keep for you.';
  end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then
    raise exception 'The basket''s lines must be a list.';
  end if;

  if jsonb_array_length(p_lines) = 0 then
    delete from public.requisition_baskets b where b.user_id = v_uid;
    return jsonb_build_object('basket', null);
  end if;
  if jsonb_array_length(p_lines) > 500 then
    raise exception 'A basket holds at most 500 lines, not %.', jsonb_array_length(p_lines);
  end if;
  if p_currency is null or not exists (select 1 from public.currencies c where c.code = p_currency) then
    raise exception 'A basket is priced in a currency, and % is not one.', coalesce(p_currency, 'nothing');
  end if;

  insert into public.requisition_baskets as b (account_id, user_id, currency, updated_at)
  values (v_account, v_uid, p_currency, now())
  on conflict (user_id) do update
    set account_id = excluded.account_id, currency = excluded.currency, updated_at = now()
  returning b.id into v_basket;

  select coalesce(jsonb_agg(to_jsonb(l) order by l.sort_order, l.id), '[]'::jsonb) into v_old
    from public.requisition_basket_lines l where l.basket_id = v_basket;
  delete from public.requisition_basket_lines l where l.basket_id = v_basket;

  for v_line in select value from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'Line % of the basket is not a line.', v_n;
    end if;

    v_pid   := nullif(trim(v_line ->> 'product_id'), '');
    v_sel   := nullif(trim(v_line ->> 'bundle_selection_id'), '');
    v_quote := nullif(trim(v_line ->> 'quote_line_id'), '');
    v_model := v_line ->> 'model';

    if v_pid is null then
      raise exception 'Line % of the basket names no listing.', v_n;
    end if;
    select p.name, p.audiences into v_pname, v_aud from public.products p where p.id = v_pid;
    if not found then
      raise exception 'There is no listing % (line % of the basket).', v_pid, v_n;
    end if;
    if not ('enterprise' = any (coalesce(v_aud, array[]::text[]))) then
      raise exception '% is not sold to business accounts.', v_pname;
    end if;

    if coalesce(v_line ->> 'quantity', '') !~ '^\s*[0-9]{1,9}\s*$' then
      raise exception 'Ask for a whole number of %, at least one.', v_pname;
    end if;
    v_qty := (v_line ->> 'quantity')::integer;
    if v_qty < 1 then
      raise exception 'Ask for a whole number of %, at least one.', v_pname;
    end if;

    if coalesce(v_line ->> 'unit_price', '') !~ '^\s*[0-9]+(\.[0-9]+)?\s*$' then
      raise exception '% has no price in the basket.', v_pname;
    end if;
    v_price := (v_line ->> 'unit_price')::numeric;

    if v_model is null or v_model not in ('oneoff', 'monthly') then
      raise exception '% is bought one-off or monthly, not %.', v_pname, coalesce(v_model, 'neither');
    end if;

    if v_sel is not null and not exists (
         select 1 from public.bundle_selections bs where bs.id = v_sel and bs.account_id = v_account) then
      raise exception 'That bundle was not configured for your account (line % of the basket).', v_n;
    end if;

    /* The same line as before: same product, bundle and quote, not already matched. */
    v_prev := null;
    select o.value into v_prev
      from jsonb_array_elements(v_old) as o(value)
     where o.value ->> 'product_id' = v_pid
       and (o.value ->> 'bundle_selection_id') is not distinct from v_sel
       and (o.value ->> 'quote_line_id') is not distinct from v_quote
       and not ((o.value ->> 'id') = any (sv.v_used))
     order by (o.value ->> 'sort_order')::integer
     limit 1;

    v_note := null; v_was := null; v_at := null; v_lid := null;
    if v_prev is not null then
      v_lid := v_prev ->> 'id';
      v_used := v_used || v_lid;
    end if;

    if v_prev is not null and (v_prev ->> 'stock_note') is not null
       and (v_prev ->> 'quantity')::integer = v_qty then
      v_note := v_prev ->> 'stock_note';
      v_was  := (v_prev ->> 'was_quantity')::integer;
      v_at   := (v_prev ->> 'flagged_at')::timestamptz;
    else
      v_flag := public.basket_line_stock_flag(v_pid, v_qty, v_sel is not null, null);
      if v_flag is not null then
        v_note := v_flag ->> 'note';
        v_qty  := (v_flag ->> 'quantity')::integer;
        v_was  := (v_flag ->> 'was')::integer;
        v_at   := now();
      end if;
    end if;

    insert into public.requisition_basket_lines
      (id, basket_id, product_id, name, seller, partner_id, quantity, unit_price, model, vertical, unit,
       quote_line_id, bundle_selection_id, bundle, on_contract, off_contract_reason,
       stock_note, was_quantity, flagged_at, sort_order)
    values
      (coalesce(v_lid, gen_random_uuid()::text), v_basket, v_pid,
       coalesce(nullif(trim(v_line ->> 'name'), ''), v_pname),
       coalesce(v_line ->> 'seller', ''),
       nullif(trim(v_line ->> 'partner_id'), ''),
       v_qty, v_price, v_model,
       v_line ->> 'vertical', v_line ->> 'unit',
       v_quote, v_sel,
       case when jsonb_typeof(v_line -> 'bundle') = 'object' then v_line -> 'bundle' end,
       case when jsonb_typeof(v_line -> 'on_contract') = 'boolean' then (v_line ->> 'on_contract')::boolean end,
       nullif(trim(v_line ->> 'off_contract_reason'), ''),
       v_note, v_was, v_at, v_n);
  end loop;

  return jsonb_build_object('basket', public.requisition_basket_json(v_basket));
end $$;

revoke all on function public.save_requisition_basket(text, jsonb) from public, anon;
grant execute on function public.save_requisition_basket(text, jsonb) to authenticated;

/* The caller's business basket, gone: after a requisition is raised from it,
   or when they empty it. Returns {deleted: 0 | 1}. */
create or replace function public.clear_requisition_basket()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in to clear your basket.';
  end if;
  delete from public.requisition_baskets b where b.user_id = auth.uid();
  get diagnostics v_n = row_count;
  return jsonb_build_object('deleted', v_n);
end $$;

revoke all on function public.clear_requisition_basket() from public, anon;
grant execute on function public.clear_requisition_basket() to authenticated;

/**
 * The buyer accepting a stock flag: the note goes, the (cut) quantity stays.
 * Allowed only when the line can be bought as it now is; a line that is no
 * longer available, or a bundle part short of stock, can only be removed.
 *
 * p_kind 'cart' (p_line_id a `cart_items.id`, the caller's, as a shopper) or
 * 'requisition' (a `requisition_basket_lines.id` in the caller's basket).
 * Returns {kind, line_id, quantity, accepted: true}.
 */
create or replace function public.accept_basket_flag(p_kind text, p_line_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
<<ac>>
declare
  v_uid     uuid := auth.uid();
  v_product text;
  v_qty     integer;
  v_note    text;
  v_bundle  boolean;
  v_basket  text;
  v_name    text;
  v_flag    jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in to change your basket.';
  end if;

  if p_kind = 'cart' then
    if public.current_persona() is distinct from 'consumer' then
      raise exception 'Only a shopper has a shopping basket.';
    end if;
    select c.product_id, c.quantity, c.stock_note, c.bundle_selection_id is not null
      into v_product, v_qty, v_note, v_bundle
      from public.cart_items c
     where c.id::text = p_line_id and c.user_id = v_uid
       for update;
    if not found then
      raise exception 'That line is not in your basket.';
    end if;
  elsif p_kind = 'requisition' then
    if public.current_persona() is distinct from 'enterprise' then
      raise exception 'Only a business buyer has a requisition basket.';
    end if;
    select l.product_id, l.quantity, l.stock_note, l.bundle_selection_id is not null, l.basket_id
      into v_product, v_qty, v_note, v_bundle, v_basket
      from public.requisition_basket_lines l
      join public.requisition_baskets b on b.id = l.basket_id
     where l.id = p_line_id and b.user_id = v_uid
       for update of l;
    if not found then
      raise exception 'That line is not in your requisition basket.';
    end if;
  else
    raise exception 'A basket is a cart or a requisition basket, not %.', coalesce(p_kind, 'nothing');
  end if;

  if v_note is null then
    return jsonb_build_object('kind', p_kind, 'line_id', p_line_id, 'quantity', v_qty, 'accepted', true);
  end if;

  v_flag := public.basket_line_stock_flag(v_product, v_qty, v_bundle, null);
  if v_flag is not null then
    select p.name into v_name from public.products p where p.id = v_product;
    if v_flag ->> 'note' = 'No longer available' then
      raise exception '% is no longer available. Remove it from your basket.', coalesce(v_name, v_product);
    end if;
    if v_bundle then
      raise exception '% does not have enough left for this bundle (%). Remove the bundle instead.',
        coalesce(v_name, v_product), v_flag ->> 'note';
    end if;
    raise exception '% has less left than this line asks for (%). Remove it, or lower the quantity.',
      coalesce(v_name, v_product), v_flag ->> 'note';
  end if;

  if p_kind = 'cart' then
    update public.cart_items c
       set stock_note = null, was_quantity = null, flagged_at = null
     where c.id::text = p_line_id;
  else
    update public.requisition_basket_lines l
       set stock_note = null, was_quantity = null, flagged_at = null
     where l.id = p_line_id;
    update public.requisition_baskets b set updated_at = now() where b.id = v_basket;
  end if;

  return jsonb_build_object('kind', p_kind, 'line_id', p_line_id, 'quantity', v_qty, 'accepted', true);
end $$;

revoke all on function public.accept_basket_flag(text, text) from public, anon;
grant execute on function public.accept_basket_flag(text, text) to authenticated;

/* ====================================================== 6. a reminder -- */

/**
 * The operator reminding an owner about their basket: one in-app entry in
 * `notification_log` (kind `inapp`, delivered), and `reminded_at` stamped.
 * At most once in 24 hours per basket.
 *
 * p_kind 'requisition' (p_id a `requisition_baskets.id`) or 'cart' (p_id the
 * shopper's user id). Returns {kind, id, notification_id, reminded_at, lines}.
 */
create or replace function public.remind_basket_owner(p_kind text, p_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
<<rm>>
declare
  v_user      uuid;
  v_account   text;
  v_last      timestamptz;
  v_lines     integer;
  v_who       text;
  v_persona   text;
  v_subject   text;
  v_body      text;
  v_ref       text;
  v_note_id   text := 'NL-BSK-' || replace(gen_random_uuid()::text, '-', '');
  v_now       timestamptz := now();
begin
  if public.current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace reminds somebody about their basket.';
  end if;

  if p_kind = 'requisition' then
    select b.user_id, b.account_id, b.reminded_at into v_user, v_account, v_last
      from public.requisition_baskets b where b.id = p_id for update;
    if not found then
      raise exception 'There is no requisition basket %.', coalesce(p_id, 'with no id');
    end if;
    select count(*) into v_lines from public.requisition_basket_lines l where l.basket_id = p_id;
    select u.name into v_who from public.enterprise_users u
     where u.user_id = v_user and u.account_id = v_account order by u.id limit 1;
    v_persona := 'enterprise';
    v_subject := 'Your requisition basket is waiting';
    v_body := format('You left %s %s in your requisition basket. Open it to raise the requisition, or clear it.',
                     v_lines, case when v_lines = 1 then 'item' else 'items' end);
    v_ref := p_id;
  elsif p_kind = 'cart' then
    if p_id is null or p_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'A shopper''s basket is named by its owner''s user id, and % is not one.', coalesce(p_id, 'nothing');
    end if;
    v_user := p_id::uuid;
    select count(*) into v_lines from public.cart_items c where c.user_id = v_user and not c.saved;
    perform 1 from auth.users au where au.id = v_user;
    if not found then
      raise exception 'There is no shopper %.', p_id;
    end if;
    insert into public.cart_reminders as r (user_id, reminded_at)
    values (v_user, '-infinity')
    on conflict (user_id) do nothing;
    select r.reminded_at into v_last from public.cart_reminders r where r.user_id = v_user for update;
    if v_last = '-infinity'::timestamptz then v_last := null; end if;
    select cp.name into v_who from public.consumer_profile cp where cp.user_id = v_user order by cp.id limit 1;
    v_persona := 'consumer';
    v_subject := 'Your basket is waiting';
    v_body := format('You left %s %s in your basket. Check out when you are ready, or remove what you no longer want.',
                     v_lines, case when v_lines = 1 then 'item' else 'items' end);
    v_ref := 'BASKET';
  else
    raise exception 'A basket is a cart or a requisition basket, not %.', coalesce(p_kind, 'nothing');
  end if;

  if v_lines = 0 then
    raise exception 'That basket is empty, so there is nothing to remind them about.';
  end if;
  if v_last is not null and v_last > v_now - interval '24 hours' then
    raise exception 'A reminder went on % UTC. One a day at most: the next can go after % UTC.',
      to_char(v_last at time zone 'UTC', 'DD Mon YYYY HH24:MI'),
      to_char((v_last + interval '24 hours') at time zone 'UTC', 'DD Mon YYYY HH24:MI');
  end if;

  if v_who is null then
    select au.email into v_who from auth.users au where au.id = v_user;
  end if;

  insert into public.notification_log
    (id, rule_id, kind_id, channel_id, persona, recipient, user_id, partner_id,
     subject, body, sent_at, state, detail, cost, ref)
  values
    (v_note_id, null, 'inapp', null, v_persona, coalesce(v_who, 'Basket owner'), v_user, null,
     left(v_subject, 200), left(v_body, 240), v_now, 'delivered', null, 0, v_ref);

  if p_kind = 'requisition' then
    update public.requisition_baskets b set reminded_at = v_now where b.id = p_id;
  else
    update public.cart_reminders r set reminded_at = v_now, reminded_by = auth.uid() where r.user_id = v_user;
  end if;

  return jsonb_build_object('kind', p_kind, 'id', p_id, 'notification_id', v_note_id,
                            'reminded_at', v_now, 'lines', v_lines);
end $$;

revoke all on function public.remind_basket_owner(text, text) from public, anon;
grant execute on function public.remind_basket_owner(text, text) to authenticated;

/* ========================================================= 7. the night -- */

/* The stock flag again over every product on any basket line (a safety net
   for a write that went around the triggers), then the baskets nobody has
   touched for 90 days: a business basket by its `updated_at`, a shopper's by
   the newest `updated_at` among its lines that are not saved for later (those
   lines go; what was saved for later stays). Returns
   {ran_on, flagged, cleared, cleared_baskets, cleared_carts}. */
create or replace function public.run_baskets_night(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
<<nt>>
declare
  v_product text;
  v_flagged integer := 0;
  v_baskets integer := 0;
  v_carts   integer := 0;
  v_owners  uuid[];
  v_cut     timestamptz := (p_as_of - 90)::timestamptz;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, looks after the baskets.';
  end if;

  for v_product in
    select c.product_id from public.cart_items c where c.product_id is not null
    union
    select l.product_id from public.requisition_basket_lines l
    order by 1
  loop
    v_flagged := v_flagged + public.flag_basket_stock(v_product);
  end loop;

  delete from public.requisition_baskets b where b.updated_at < nt.v_cut;
  get diagnostics v_baskets = row_count;

  select array_agg(s.user_id) into v_owners
    from (select c.user_id
            from public.cart_items c
           where c.user_id is not null and not c.saved
           group by c.user_id
          having max(c.updated_at) < nt.v_cut) s;
  v_carts := coalesce(array_length(v_owners, 1), 0);
  if v_carts > 0 then
    delete from public.cart_items c where c.user_id = any (v_owners) and not c.saved;
  end if;

  return jsonb_build_object('ran_on', p_as_of, 'flagged', v_flagged, 'cleared', v_baskets + v_carts,
                            'cleared_baskets', v_baskets, 'cleared_carts', v_carts);
end $$;

revoke all on function public.run_baskets_night(date) from public, anon, authenticated;

/* `delete_unused_bundle_selections`, copied from 20261113100000 (its only
   definition). Changed only: a selection on a kept business basket line is
   in use too, now that the basket outlives the page.

   A selection whose price hold ended more than 7 days before `p_as_of` and
   that nothing refers to: no basket line, requisition line, order line or
   subscription. Nothing else ever removes one. Its lines go with it. */
create or replace function public.delete_unused_bundle_selections(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  n_gone integer;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, clears unused bundles.';
  end if;

  delete from public.bundle_selections bs
   where bs.valid_until < (p_as_of - 7)
     and not exists (select 1 from public.cart_items c where c.bundle_selection_id = bs.id)
     and not exists (select 1 from public.requisition_basket_lines rb where rb.bundle_selection_id = bs.id)
     and not exists (select 1 from public.enterprise_requisition_lines l where l.bundle_selection_id = bs.id)
     and not exists (select 1 from public.order_items oi where oi.bundle_selection_id = bs.id)
     and not exists (select 1 from public.subscriptions sb where sb.bundle_selection_id = bs.id);
  get diagnostics n_gone = row_count;

  return jsonb_build_object('ran_on', p_as_of, 'deleted', n_gone);
end $$;

revoke all on function public.delete_unused_bundle_selections(date) from public, anon, authenticated;

/* `run_nightly`, copied from 20261113100000 (its latest definition). Changed
   only: the `baskets` job, after `bundle selections` and before
   `settlements`, so eight. */
create or replace function public.run_nightly(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  j    text;
  res  jsonb;
  err  text;
  t0   timestamptz;
  outs jsonb := '[]'::jsonb;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, runs the night.';
  end if;

  foreach j in array array['agreements', 'enterprise subscriptions', 'subscriptions', 'documents', 'payments', 'bundle selections', 'baskets', 'settlements'] loop
    t0 := clock_timestamp(); res := null; err := null;
    begin
      res := case j
        when 'agreements'               then public.auto_renew_contracts(p_as_of, 'Nightly schedule')
        when 'enterprise subscriptions' then public.renew_enterprise_subscriptions(p_as_of, 'Nightly schedule')
        when 'subscriptions'            then public.renew_subscriptions(p_as_of, 'Nightly schedule')
        when 'documents'                then public.lapse_expired_documents(p_as_of)
        when 'payments'                 then jsonb_build_object('expired', public.expire_stale_payments())
        when 'bundle selections'        then public.delete_unused_bundle_selections(p_as_of)
        when 'baskets'                  then public.run_baskets_night(p_as_of)
        when 'settlements'              then public.settle_to_date(p_as_of)
      end;
    exception when others then
      err := format('%s (%s)', sqlerrm, sqlstate);
    end;
    insert into public.scheduled_job_log (job, ran_on, started_at, finished_at, ok, result, error)
    values (j, p_as_of, t0, clock_timestamp(), err is null, res, err);
    outs := outs || jsonb_build_object('job', j, 'ok', err is null, 'error', err);
  end loop;

  return jsonb_build_object('ran_on', p_as_of, 'jobs', outs);
end $$;

revoke all on function public.run_nightly(date) from public, anon, authenticated;

/* ================================================================= help === */

/* The operator's Baskets screen (`op-baskets`), seeded the way
   20261113100000 seeds `op-jobs`: the next KB-O number, once. And the
   Scheduled jobs article told about the eighth job, once. */
do $$
declare
  v_op text;
  n_op int;
begin
  select coalesce(max(substring(id from '^KB-O(\d+)$')::int), 0) + 1 into n_op
    from kb_articles where id ~ '^KB-O\d+$';
  v_op := 'KB-O' || lpad(n_op::text, 2, '0');

  if not exists (select 1 from kb_articles where view = 'op-baskets') then
    insert into kb_articles
      (id, persona, kind, title, mins, updated, view, roles, tags, summary,
       body, status, sort_order, personas, audience_note, audience_ids)
    values (
      v_op, 'operator', 'howto', 'Baskets', 4, to_char(current_date, 'DD Mon YYYY'), 'op-baskets',
      array['OR-ADMIN', 'OR-SUPPORT'], array['baskets', 'carts', 'requisitions', 'stock'],
      'Who has something waiting in a basket, what has changed under it, and how to remind them.',
      jsonb_build_array(
        jsonb_build_object('kind', 'prose', 'heading', 'What this screen shows',
          'text', 'Every basket that is waiting to be bought: business requisition baskets on one tab, shopper baskets on the other. Each row is one owner, with their lines, what the basket is worth in its currency, when they last changed it, any stock flags, and when they were last reminded. A basket is Pending while it has been changed in the last 7 days, and Abandoned once nobody has touched it for 7 days or more.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Stock flags',
          'text', 'When a listing is paused or withdrawn, or its stock runs short, every basket holding it is flagged rather than quietly changed. If some is left, the line is cut to what is left and says "Only 3 left — we reduced this from 5". If none is left, or the listing is not live, it says "No longer available" and its quantity stays as it was. Until the owner accepts the change or removes the line, the basket cannot be checked out or raised as a requisition. A bundle with a flagged part is held up as a whole. Flags are never taken off by the marketplace; only the owner clears them.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Reminders',
          'text', 'Send reminder puts one in-app message in front of the owner ("You left 3 items in your basket"). At most one a day per basket: a second within 24 hours is refused, and the screen says when the next may go.'),
        jsonb_build_object('kind', 'prose', 'heading', 'What you cannot do',
          'text', 'Operators never delete or edit a basket; it is the owner''s. The night clears a basket nobody has touched for 90 days (for a shopper, the lines not saved for later), and runs the stock flags again over every basket in case a change went around them. Both show on Scheduled jobs as the baskets job.')
      ),
      'published', n_op, array['operator'], '', array[]::text[]);
  end if;

  update kb_articles
     set body = jsonb_set(
                  jsonb_set(body, '{0,text}', to_jsonb('Every night at 00:30 UTC (06:00 in India, 03:30 in Kenya) the marketplace runs eight jobs, one after the other. Each one is listed here for each night: whether it finished OK or failed, a short summary of what it did, and the error in full when it failed. A job that fails changes nothing, and the jobs after it still run.'::text)),
                  '{1}', jsonb_build_object('kind', 'prose', 'heading', 'The eight jobs',
                    'text', 'Agreements: an agreement with auto-renew on whose notice deadline has passed is renewed for a like term. Enterprise subscriptions: a business subscription renews for a year on its date, or ends there if auto-renew is off or it is suspended. Subscriptions: a shopper subscription the marketplace sells is charged for the cycle that starts and its date moves on; a bundle part keeps the bundle price for 12 months, then the published price. Documents: a seller document past its expiry stops counting as accepted. Payments: a payment nobody answered for 15 minutes expires, and the unpaid orders behind it are removed. Bundle selections: a priced bundle whose hold ended more than 7 days ago and that is on no basket, requisition or order is deleted. Baskets: every basket line is checked against stock again and flagged where it no longer fits, and baskets nobody has touched for 90 days are cleared. Settlements: every closed period not yet settled is settled, oldest first.')),
         updated = to_char(current_date, 'DD Mon YYYY')
   where view = 'op-jobs'
     and jsonb_typeof(body) = 'array' and jsonb_array_length(body) >= 3
     and body::text not like '%Baskets: every basket line%';
end $$;

/* ============================================================ self-check === */

do $$
<<chk>>
declare
  dry      jsonb;
  j        jsonb;
  v_n      int;
  v_sig    text;
  v_p      record;
  v_cart   uuid;
  v_when   timestamptz := now() - interval '10 days';
  v_row    record;
  v_ent    record;
  v_basket text;
  v_line   text;
  v_inv    text;
begin
  if not public.is_scheduler() then
    raise exception 'This session (%) is not one the schedule runs as, so the dry run below would be refused.', session_user;
  end if;

  /* The tables and columns. */
  if to_regclass('public.requisition_baskets') is null
     or to_regclass('public.requisition_basket_lines') is null
     or to_regclass('public.cart_reminders') is null then
    raise exception 'a basket table is missing';
  end if;
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'cart_items'
     and column_name in ('stock_note', 'was_quantity', 'flagged_at', 'updated_at');
  if v_n <> 4 then raise exception 'cart_items has % of its four basket columns', v_n; end if;
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'requisition_basket_lines'
     and column_name in ('product_id', 'quantity', 'unit_price', 'model', 'unit', 'bundle_selection_id',
                         'quote_line_id', 'stock_note', 'was_quantity', 'flagged_at', 'sort_order');
  if v_n <> 11 then raise exception 'requisition_basket_lines has % of its 11 named columns', v_n; end if;
  select count(*) into v_n from information_schema.columns
   where table_schema = 'public' and table_name = 'requisition_baskets'
     and column_name in ('account_id', 'user_id', 'currency', 'updated_at', 'reminded_at');
  if v_n <> 5 then raise exception 'requisition_baskets has % of its five named columns', v_n; end if;

  /* RLS on, owner and operator reads, and no write policy on the kept baskets. */
  select count(*) into v_n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname in ('requisition_baskets', 'requisition_basket_lines', 'cart_reminders')
     and c.relrowsecurity;
  if v_n <> 3 then raise exception 'row level security is on for % of the three basket tables', v_n; end if;
  select count(*) into v_n from pg_policies
   where schemaname = 'public' and tablename in ('requisition_baskets', 'requisition_basket_lines', 'cart_reminders')
     and cmd <> 'SELECT';
  if v_n <> 0 then raise exception 'the basket tables have % write policies; the functions write them', v_n; end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cart_items'
                    and policyname = 'operator_read_cart_items' and cmd = 'SELECT') then
    raise exception 'the operator cannot read shopper baskets';
  end if;

  /* The functions and triggers. */
  foreach v_sig in array array[
      'public.basket_stock_left(text)',
      'public.basket_line_stock_flag(text,integer,boolean,integer)',
      'public.flag_basket_stock(text)',
      'public.products_flag_baskets()', 'public.inventory_flag_baskets()',
      'public.stamp_cart_line()', 'public.guard_shoppable()',
      'public.guard_flagged_cart_order_line()', 'public.guard_flagged_basket_requisition_line()',
      'public.requisition_basket_json(text)',
      'public.save_requisition_basket(text,jsonb)', 'public.clear_requisition_basket()',
      'public.accept_basket_flag(text,text)', 'public.remind_basket_owner(text,text)',
      'public.run_baskets_night(date)', 'public.delete_unused_bundle_selections(date)',
      'public.run_nightly(date)'] loop
    if to_regprocedure(v_sig) is null then raise exception '% is missing', v_sig; end if;
  end loop;

  select count(*) into v_n from pg_trigger t
   where not t.tgisinternal and (
         (t.tgrelid = 'public.products'::regclass and t.tgname = 'z_products_flag_baskets')
      or (t.tgrelid = 'public.operator_inventory'::regclass and t.tgname = 'z_inventory_flag_baskets')
      or (t.tgrelid = 'public.cart_items'::regclass and t.tgname = 'cart_items_basket_stamp')
      or (t.tgrelid = 'public.order_items'::regclass and t.tgname = 'z_flagged_cart_order_line')
      or (t.tgrelid = 'public.enterprise_requisition_lines'::regclass and t.tgname = 'z_flagged_basket_requisition_line'));
  if v_n <> 5 then raise exception '% of the five basket triggers are in place', v_n; end if;

  if pg_get_functiondef('public.delete_unused_bundle_selections(date)'::regprocedure)
       not like '%requisition_basket_lines%' then
    raise exception 'delete_unused_bundle_selections would delete a selection on a kept basket';
  end if;

  /* Who may call what: the four the app calls, signed in only; the rest, nobody. */
  foreach v_sig in array array[
      'public.save_requisition_basket(text,jsonb)', 'public.clear_requisition_basket()',
      'public.accept_basket_flag(text,text)', 'public.remind_basket_owner(text,text)'] loop
    if not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '% is not callable by a signed-in user', v_sig;
    end if;
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception '% is callable without signing in', v_sig;
    end if;
  end loop;
  foreach v_sig in array array[
      'public.basket_stock_left(text)',
      'public.basket_line_stock_flag(text,integer,boolean,integer)',
      'public.flag_basket_stock(text)',
      'public.products_flag_baskets()', 'public.inventory_flag_baskets()', 'public.stamp_cart_line()',
      'public.guard_flagged_cart_order_line()', 'public.guard_flagged_basket_requisition_line()',
      'public.requisition_basket_json(text)',
      'public.run_baskets_night(date)', 'public.delete_unused_bundle_selections(date)',
      'public.run_nightly(date)'] loop
    if has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute')
       or exists (select 1 from pg_proc p,
                         aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x
                   where p.oid = v_sig::regprocedure and x.grantee = 0 and x.privilege_type = 'EXECUTE') then
      raise exception '% is callable through the API', v_sig;
    end if;
  end loop;

  /* The help for the new screen, and the Scheduled jobs article's eighth job. */
  select count(*) into v_n from kb_articles
   where view = 'op-baskets' and 'operator' = any(personas) and status = 'published';
  if v_n <> 1 then raise exception 'the Baskets screen has % help articles, not 1', v_n; end if;
  if exists (select 1 from kb_articles where view = 'op-jobs' and body::text not like '%Baskets: every basket line%') then
    raise exception 'the Scheduled jobs article does not mention the baskets job';
  end if;

  /* Flag and cap, rolled back: a temporary shopper line of 3 (and, where a
     business buyer has no basket yet, a temporary business line of 3) for a
     live product a warehouse counts; its stock taken down to 1, then the
     listing marked out of stock. */
  begin
    select p.id, p.name into v_p
      from public.products p
     where p.status = 'live' and p.stock in ('in', 'low')
       and exists (select 1 from public.operator_inventory i where i.product_id = p.id and i.on_hand >= 1)
       /* One warehouse line, so taking the stock down passes through no
          in-between count that would change the note. */
       and (select count(*) from public.operator_inventory i where i.product_id = p.id) = 1
     order by p.id
     limit 1;
    if not found then
      raise exception 'no live product with counted stock to check a stock flag against';
    end if;

    insert into public.cart_items (product_id, quantity, user_id, updated_at)
    values (v_p.id, 3, null, v_when)
    returning id into v_cart;

    select eu.user_id, eu.account_id, a.currency into v_ent
      from public.enterprise_users eu
      join public.enterprise_accounts a on a.id = eu.account_id
     where eu.user_id is not null and eu.status = 'active'
       and not exists (select 1 from public.requisition_baskets b where b.user_id = eu.user_id)
     order by eu.id
     limit 1;
    if found then
      insert into public.requisition_baskets (account_id, user_id, currency, updated_at)
      values (v_ent.account_id, v_ent.user_id, v_ent.currency, v_when)
      returning id into v_basket;
      insert into public.requisition_basket_lines (basket_id, product_id, name, quantity, unit_price, model)
      values (v_basket, v_p.id, v_p.name, 3, 1, 'oneoff')
      returning id into v_line;
    end if;

    /* Nothing left, then one. */
    update public.operator_inventory i set reserved = i.on_hand where i.product_id = v_p.id;
    select i.id into v_inv from public.operator_inventory i
     where i.product_id = v_p.id and i.on_hand >= 1 order by i.id limit 1;
    update public.operator_inventory i set reserved = i.on_hand - 1 where i.id = v_inv;

    if public.basket_stock_left(v_p.id) is distinct from 1 then
      raise exception 'the self-check could not leave exactly one % in stock (it left %)', v_p.id, public.basket_stock_left(v_p.id);
    end if;

    select c.quantity, c.was_quantity, c.stock_note, c.flagged_at, c.updated_at into v_row
      from public.cart_items c where c.id = v_cart;
    if v_row.quantity is distinct from 1 or v_row.was_quantity is distinct from 3
       or v_row.stock_note is distinct from 'Only 1 left — we reduced this from 3' or v_row.flagged_at is null then
      raise exception 'a shopper line of 3 with 1 left reads quantity %, was %, note "%"',
        v_row.quantity, v_row.was_quantity, v_row.stock_note;
    end if;
    if v_row.updated_at is distinct from v_when then
      raise exception 'the stock flag moved the shopper''s updated_at (to %)', v_row.updated_at;
    end if;

    if v_line is not null then
      select l.quantity, l.was_quantity, l.stock_note into v_row
        from public.requisition_basket_lines l where l.id = v_line;
      if v_row.quantity is distinct from 1 or v_row.was_quantity is distinct from 3
         or v_row.stock_note is distinct from 'Only 1 left — we reduced this from 3' then
        raise exception 'a business line of 3 with 1 left reads quantity %, was %, note "%"',
          v_row.quantity, v_row.was_quantity, v_row.stock_note;
      end if;
      if (select b.updated_at from public.requisition_baskets b where b.id = v_basket) is distinct from v_when then
        raise exception 'the stock flag moved the business basket''s updated_at';
      end if;
    end if;

    /* Run again with nothing changed: nothing is counted. */
    if public.flag_basket_stock(v_p.id) <> 0 then
      raise exception 'flagging % a second time changed lines that already said so', v_p.id;
    end if;

    /* Out of stock on the listing. */
    update public.products p set stock = 'out' where p.id = v_p.id;
    select c.quantity, c.was_quantity, c.stock_note into v_row from public.cart_items c where c.id = v_cart;
    if v_row.stock_note is distinct from 'No longer available' or v_row.quantity is distinct from 1
       or v_row.was_quantity is not null then
      raise exception 'a shopper line of a listing out of stock reads quantity %, was %, note "%"',
        v_row.quantity, v_row.was_quantity, v_row.stock_note;
    end if;
    if v_line is not null then
      select l.stock_note into v_row from public.requisition_basket_lines l where l.id = v_line;
      if v_row.stock_note is distinct from 'No longer available' then
        raise exception 'a business line of a listing out of stock reads "%"', v_row.stock_note;
      end if;
    end if;

    raise exception using errcode = 'ZZ999', message = 'rolling the stock-flag check back';
  exception when sqlstate 'ZZ999' then
    null;
  end;

  /* The night, now with eight jobs, dry-run and rolled back. */
  begin
    dry := public.run_nightly(current_date);
    raise exception using errcode = 'ZZ999', message = 'rolling the dry run back';
  exception when sqlstate 'ZZ999' then
    null;
  end;
  for j in select value from jsonb_array_elements(dry -> 'jobs') loop
    if not (j ->> 'ok')::boolean then
      raise exception 'A dry run of the nightly "%" job fails: %', j ->> 'job', j ->> 'error';
    end if;
  end loop;
  if jsonb_array_length(dry -> 'jobs') <> 8 then
    raise exception 'the dry run ran % jobs, not 8', jsonb_array_length(dry -> 'jobs');
  end if;
  if (dry -> 'jobs' -> 6 ->> 'job') is distinct from 'baskets' then
    raise exception 'the seventh job of the night is %, not baskets', dry -> 'jobs' -> 6 ->> 'job';
  end if;
end $$;

commit;
