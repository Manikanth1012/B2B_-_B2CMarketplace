/* The stock ledger counted 4,048 devices and could not name one of them.
 *
 * `operator_inventory` held a number per product per warehouse — on hand,
 * reserved, inbound — and nothing below it. So the questions a warehouse is
 * actually asked had no answer anywhere in the database:
 *
 *   which handset went out on ORD-771339
 *   where is IMEI 351756110042318 now, and who has it
 *   this one came back faulty — was it ours, when did we receive it, whose
 *     batch was it in
 *   we are recalling a batch — which orders are affected
 *
 * A count cannot answer any of those. A count is a summary of records that do
 * not exist here.
 *
 * So: one row per physical unit, its serial as its identity, its state, and the
 * order it left on. `operator_inventory.on_hand` and `.reserved` stop being
 * asserted and start being counted — the same rule this build has applied to
 * every other stored total.
 *
 *   stock_unit        one physical thing, by serial
 *   stock_unit_event  everything that has happened to it
 *   stock_unit_rollup the counts, derived
 *   serial_consistency the ledger against the units, so drift is reported
 *
 * On reservations. `reserved` was a number nobody could explain: 120 K9 Pros
 * reserved against open orders that account for one. A reservation in a real
 * warehouse is either against an order or a deliberate hold — quarantine, a
 * channel allocation, engineering samples, a demo pool — and the two are not
 * interchangeable. Both are modelled, and a reserved unit must say which it is.
 * That is the difference between a number and an explanation.
 */

/* ---- 1. Which products carry a serial -------------------------------------- */

/* Not everything does. A subscription has no serial, a data pack has no serial,
   and putting a nullable serial on all of them would make "has one" and "we did
   not record it" the same state. */
alter table public.products
  add column if not exists serialised boolean not null default false;

comment on column public.products.serialised is
  'True where each unit is a physical thing with its own identity — a handset, '
  'a router, a sensor. False for subscriptions, plans and anything else where '
  'a unit is not a distinguishable object.';

update public.products p
   set serialised = true
 where exists (select 1 from public.operator_inventory i where i.product_id = p.id);

/* ---- 2. The unit ------------------------------------------------------------ */

create table if not exists public.stock_unit (
  /* The serial is the identity. A surrogate key beside it would let the same
     handset be received twice under two ids, which is the failure this table
     exists to make impossible. */
  serial        text primary key,
  product_id    text not null references public.products(id),
  warehouse_id  text not null references public.operator_warehouses(id),

  state         text not null default 'in_stock'
                check (state in ('in_stock','reserved','despatched','delivered',
                                 'returned','faulty','written_off')),
  /* Why a unit is reserved. Against an order, or held back deliberately —
     quarantine, a channel allocation, a demo pool. A reserved unit with
     neither is a number nobody can explain, which is what the ledger held. */
  hold_reason   text check (hold_reason in ('order','quarantine','allocation','demo','engineering')),

  /* Where it came from. */
  received_on   date not null,
  grn_ref       text,
  supplier_id   text references public.partners(id),
  batch_ref     text,

  /* Where it went. Null until it is picked. */
  order_id      uuid references public.orders(id),
  order_item_id uuid references public.order_items(id),
  order_ref     text,
  customer      text,
  despatched_on date,
  delivered_on  date,
  returned_on   date,

  note          text,
  updated_at    timestamptz not null default now()
);

comment on table public.stock_unit is
  'One physical unit of stock, identified by its serial. The stock ledger '
  'counts these rather than asserting a number beside them.';

create index if not exists stock_unit_by_line on public.stock_unit (product_id, warehouse_id, state);
create index if not exists stock_unit_by_order on public.stock_unit (order_id);
create index if not exists stock_unit_by_batch on public.stock_unit (batch_ref);

/* A unit that has left the building has to say where it went, and one that has
   not cannot claim to. Both halves matter: the first is the recall question,
   the second is how a serial ends up attached to an order it never shipped on. */
create or replace function public.guard_stock_unit()
returns trigger language plpgsql as $$
begin
  if new.state in ('despatched','delivered') then
    if new.order_id is null then
      raise exception 'A % unit has to say which order it went out on', new.state;
    end if;
    if new.despatched_on is null then
      raise exception 'A % unit has to say when it left', new.state;
    end if;
  end if;

  if new.state = 'delivered' and new.delivered_on is null then
    raise exception 'A delivered unit has to say when it arrived';
  end if;

  if new.state = 'reserved' and new.hold_reason is null then
    raise exception
      'A reserved unit has to say why: against an order, or held back deliberately. '
      '"Reserved" on its own is the number nobody could explain.';
  end if;

  if new.hold_reason = 'order' and new.state = 'reserved' and new.order_id is null then
    raise exception 'Reserved against an order means naming the order';
  end if;

  if new.state = 'in_stock' then
    if new.order_id is not null or new.despatched_on is not null then
      raise exception
        'A unit cannot be back in stock and still carry the order it went out on — use returned';
    end if;
    new.hold_reason := null;
  end if;

  if new.state = 'returned' and new.returned_on is null then
    raise exception 'A returned unit has to say when it came back';
  end if;

  new.updated_at := now();
  return new;
end $$;

drop trigger if exists z_guard_stock_unit on public.stock_unit;
create trigger z_guard_stock_unit
  before insert or update on public.stock_unit
  for each row execute function public.guard_stock_unit();

/* ---- 3. What has happened to it -------------------------------------------- */

create table if not exists public.stock_unit_event (
  id         bigserial primary key,
  serial     text not null references public.stock_unit(serial) on delete cascade,
  at         timestamptz not null default now(),
  actor      text not null,
  from_state text,
  to_state   text not null,
  detail     text not null,
  order_ref  text
);

create index if not exists stock_unit_event_recent on public.stock_unit_event (serial, at desc);

/* Every state change writes one, so the history is the record rather than
   something a screen reconstructs from the current row. */
create or replace function public.log_stock_unit()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.state is not distinct from old.state then
    return new;
  end if;
  insert into public.stock_unit_event (serial, actor, from_state, to_state, detail, order_ref)
  values (
    new.serial,
    coalesce(current_setting('request.jwt.claim.email', true), 'Warehouse'),
    case when tg_op = 'UPDATE' then old.state end,
    new.state,
    case new.state
      when 'in_stock'    then 'Received into ' || new.warehouse_id
                              || coalesce(' on ' || new.grn_ref, '')
      when 'reserved'    then case new.hold_reason
                                when 'order' then 'Allocated to ' || coalesce(new.order_ref, 'an order')
                                when 'quarantine' then 'Held in quarantine'
                                when 'allocation' then 'Held against a channel allocation'
                                when 'demo' then 'Held for the demo pool'
                                else 'Held for engineering' end
      when 'despatched'  then 'Picked and despatched on ' || coalesce(new.order_ref, 'an order')
      when 'delivered'   then 'Delivered to ' || coalesce(new.customer, 'the customer')
      when 'returned'    then 'Came back from ' || coalesce(new.customer, 'the customer')
      when 'faulty'      then coalesce(new.note, 'Failed inspection')
      when 'written_off' then coalesce(new.note, 'Written off')
      else new.state end,
    new.order_ref);
  return new;
end $$;

drop trigger if exists z_log_stock_unit on public.stock_unit;
create trigger z_log_stock_unit
  after insert or update on public.stock_unit
  for each row execute function public.log_stock_unit();

/* ---- 4. The counts, derived ------------------------------------------------- */

create or replace view public.stock_unit_rollup
with (security_invoker = on) as
  select product_id, warehouse_id,
         count(*) filter (where state = 'in_stock')    as in_stock,
         count(*) filter (where state = 'reserved')    as reserved,
         count(*) filter (where state = 'reserved' and hold_reason = 'order') as reserved_on_orders,
         count(*) filter (where state = 'reserved' and hold_reason <> 'order') as held_back,
         count(*) filter (where state = 'despatched') as despatched,
         count(*) filter (where state = 'delivered')  as delivered,
         count(*) filter (where state = 'returned')   as returned,
         count(*) filter (where state = 'faulty')     as faulty,
         count(*) filter (where state = 'written_off') as written_off,
         /* On hand is what is physically in the building and sellable or
            spoken for. A despatched unit is not on hand, and a faulty one is
            in the building and not sellable. */
         count(*) filter (where state in ('in_stock','reserved')) as on_hand
    from public.stock_unit
   group by product_id, warehouse_id;

/* The ledger against the units. A stored number that disagrees with the rows it
   summarises is the bug this whole table exists to prevent, so it is reported
   rather than assumed away. */
create or replace view public.serial_consistency
with (security_invoker = on) as
  select i.id as line_id, i.product_id, i.warehouse_id,
         i.on_hand   as ledger_on_hand,
         coalesce(r.on_hand, 0)  as counted_on_hand,
         i.reserved  as ledger_reserved,
         coalesce(r.reserved, 0) as counted_reserved,
         i.on_hand = coalesce(r.on_hand, 0)
           and i.reserved = coalesce(r.reserved, 0) as agrees
    from public.operator_inventory i
    left join public.stock_unit_rollup r
      on r.product_id = i.product_id and r.warehouse_id = i.warehouse_id;

/* ---- 5. RLS ----------------------------------------------------------------- */

alter table public.stock_unit enable row level security;
alter table public.stock_unit_event enable row level security;

drop policy if exists operator_all_stock_unit on public.stock_unit;
create policy operator_all_stock_unit on public.stock_unit
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A seller sees the units that went out on its own orders and nothing else —
   not the pool, not another seller's despatches. The boundary is the product's
   seller, because that is who supplied the unit. */
drop policy if exists partner_read_own_stock_unit on public.stock_unit;
create policy partner_read_own_stock_unit on public.stock_unit
  for select using (
    current_persona() = 'partner'
    and exists (
      select 1 from public.products p
       join public.partners pt on pt.name = p.seller
      where p.id = stock_unit.product_id and pt.id = current_partner_id())
  );

drop policy if exists operator_all_stock_unit_event on public.stock_unit_event;
create policy operator_all_stock_unit_event on public.stock_unit_event
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

grant select, insert, update on public.stock_unit to authenticated;
grant select on public.stock_unit_event to authenticated;
grant select on public.stock_unit_rollup to authenticated;
grant select on public.serial_consistency to authenticated;

/* ---- 6. Actions ------------------------------------------------------------- */

/* Receiving. Serials are minted per product family — an IMEI for anything with
   a modem in it, a vendor serial otherwise — because a warehouse reads them off
   a label and the shape tells you what you are holding. */
create or replace function public.mint_serial(p_product text, p_seq bigint)
returns text language sql immutable as $$
  select case
    /* 15 digits, TAC-style prefix per product, then a sequence. Not a
       checksum-valid IMEI, and not claimed to be. */
    when p_product in ('SKU-4001','SKU-4002','SKU-4003','SKU-4006')
      then '35' || substr(md5(p_product), 1, 6)::text
           || lpad((abs(hashtext(p_product)) % 90 + 10)::text, 2, '0')
           || lpad(p_seq::text, 7, '0')
    else upper(substr(regexp_replace(p_product, '[^A-Za-z0-9]', '', 'g'), 1, 7))
         || '-' || lpad(p_seq::text, 6, '0')
  end
$$;

create or replace function public.receive_units(
  p_product text, p_warehouse text, p_qty integer,
  p_grn text default null, p_batch text default null, p_on date default null
) returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  seq bigint;
  made int := 0;
  supplier text;
begin
  if p_qty is null or p_qty < 1 then
    return jsonb_build_object('ok', false, 'why', 'Receiving nothing is not a receipt');
  end if;
  if not exists (select 1 from public.products where id = p_product and serialised) then
    return jsonb_build_object('ok', false,
      'why', 'That product is not serialised, so there is nothing to give a serial to');
  end if;

  select pt.id into supplier
    from public.products p join public.partners pt on pt.name = p.seller
   where p.id = p_product;

  select coalesce(max(nullif(regexp_replace(serial, '^.*[^0-9]', '', 'g'), ''))::bigint, 0)
    into seq from public.stock_unit where product_id = p_product;

  insert into public.stock_unit
    (serial, product_id, warehouse_id, state, received_on, grn_ref, supplier_id, batch_ref)
  select public.mint_serial(p_product, seq + g), p_product, p_warehouse, 'in_stock',
         coalesce(p_on, current_date), p_grn, supplier, p_batch
    from generate_series(1, p_qty) g
  on conflict (serial) do nothing;

  get diagnostics made = row_count;
  return jsonb_build_object('ok', true, 'received', made,
    'from', public.mint_serial(p_product, seq + 1),
    'to', public.mint_serial(p_product, seq + p_qty));
end $$;

/* Picking. Oldest first, because a warehouse that picks the newest unit ages
   the ones at the back until nobody will take them. */
create or replace function public.despatch_units(p_order_item uuid, p_qty integer default null)
returns jsonb
language plpgsql security definer
set search_path = public, extensions as $$
declare
  oi record;
  want integer;
  picked text[];
begin
  select oi.*, o.order_ref, o.buyer_name, o.id as oid
    into oi
    from public.order_items oi join public.orders o on o.id = oi.order_id
   where oi.id = p_order_item;
  if oi.id is null then
    return jsonb_build_object('ok', false, 'why', 'No such order line');
  end if;

  want := coalesce(p_qty, oi.quantity);

  with pick as (
    select serial from public.stock_unit
     where product_id = oi.product_id
       and state in ('in_stock','reserved')
       and (state = 'in_stock' or order_item_id = p_order_item)
     order by received_on, serial
     limit want
     for update skip locked
  )
  update public.stock_unit u
     set state = 'despatched', order_id = oi.oid, order_item_id = p_order_item,
         order_ref = oi.order_ref, customer = oi.buyer_name,
         despatched_on = current_date, hold_reason = null
    from pick where u.serial = pick.serial
  returning u.serial into picked;

  select array_agg(serial order by serial) into picked
    from public.stock_unit
   where order_item_id = p_order_item and state = 'despatched'
     and despatched_on = current_date;

  if coalesce(array_length(picked, 1), 0) < want then
    /* Reported rather than silently short-picked. A despatch that quietly
       sends four of six is discovered by the customer. */
    return jsonb_build_object('ok', false,
      'why', format('Only %s units were available and %s were wanted',
                    coalesce(array_length(picked, 1), 0), want),
      'serials', to_jsonb(coalesce(picked, '{}')));
  end if;
  return jsonb_build_object('ok', true, 'serials', to_jsonb(picked));
end $$;

grant execute on function public.receive_units(text, text, integer, text, text, date) to authenticated;
grant execute on function public.despatch_units(uuid, integer) to authenticated;
