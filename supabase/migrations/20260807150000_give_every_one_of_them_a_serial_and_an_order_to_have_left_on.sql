/* The units themselves.
 *
 * Order of work matters here. Units that have already left the building are
 * created first, from the orders that took them — a delivered order is
 * evidence that a specific number of specific units went somewhere, and
 * inventing free stock first and despatching from it afterwards would put the
 * despatch date after the receipt date on half of them.
 *
 *   1  every serialised order line becomes units, in the state its order implies
 *   2  the rest of each stock line is minted as free stock
 *   3  a few deliberate holds, so "reserved" is not only ever "on an order"
 *   4  operator_inventory.on_hand and .reserved are recomputed from the rows
 *
 * Step 4 is the point. `on_hand` was a number somebody typed; it is now a count
 * of things that exist, and `serial_consistency` reports the day they diverge.
 */

/* First, a correction to the serial format. The sequence has to be readable
   back out of the serial, and `^.*[^0-9]` cannot find it in a string whose
   prefix is hex — md5 output ending in a digit moves where the prefix stops.
   A fixed-width sequence at the end is read with `right()` and cannot be
   ambiguous. */
create or replace function public.mint_serial(p_product text, p_seq bigint)
returns text language sql immutable as $$
  select case
    /* Fifteen digits in the shape of an IMEI for anything with a modem in it:
       a two-digit reporting-body prefix, a six-digit type allocation derived
       from the SKU, then seven digits of sequence. It is not checksum-valid
       and is not claimed to be — a demo project minting valid IMEIs would be
       minting identifiers that collide with real handsets. */
    when p_product in ('SKU-4001','SKU-4002','SKU-4003','SKU-4006')
      then '35' || lpad((abs(hashtext(p_product)) % 1000000)::text, 6, '0')
           || lpad(p_seq::text, 7, '0')
    else upper(substr(regexp_replace(p_product, '[^A-Za-z0-9]', '', 'g'), 1, 7))
         || '-' || lpad(p_seq::text, 7, '0')
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

  /* The sequence is the last seven characters, always. */
  select coalesce(max(right(serial, 7)::bigint), 0) into seq
    from public.stock_unit where product_id = p_product;

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

/* ---- 1. Units that have already gone --------------------------------------- */

/* Every order line for a serialised product becomes that many units, in the
   state the order it belongs to implies. A delivered order delivered
   something; an order still processing has stock allocated to it and not yet
   picked, which is exactly what a reservation is. */
with line as (
  select oi.id as order_item_id, oi.order_id, oi.product_id, oi.quantity,
         o.order_ref, o.buyer_name, o.status,
         /* `placed_date` is prose ("19 Jun 2026") on the older rows, so it is
            parsed where it parses and falls back to the created timestamp. */
         coalesce(
           case when o.placed_date ~ '^\d{2} [A-Za-z]{3} \d{4}$'
                then to_date(o.placed_date, 'DD Mon YYYY') end,
           o.created_at::date, current_date) as placed,
         i.warehouse_id,
         pt.id as supplier_id,
         row_number() over (order by oi.id) as line_no
    from public.order_items oi
    join public.orders o on o.id = oi.order_id
    join public.products p on p.id = oi.product_id and p.serialised
    join public.operator_inventory i on i.product_id = oi.product_id
    left join public.partners pt on pt.name = p.seller
),
unit as (
  select l.*, g as n,
         row_number() over (partition by l.product_id order by l.placed, l.order_item_id, g) as seq
    from line l, generate_series(1, l.quantity) g
)
insert into public.stock_unit
  (serial, product_id, warehouse_id, state, hold_reason, received_on, grn_ref,
   supplier_id, batch_ref, order_id, order_item_id, order_ref, customer,
   despatched_on, delivered_on, returned_on, note)
select
  public.mint_serial(u.product_id, u.seq),
  u.product_id, u.warehouse_id,
  case u.status
    when 'delivered'  then 'delivered'
    when 'in-transit' then 'despatched'
    when 'refunded'   then 'returned'
    when 'failed'     then 'returned'
    else 'reserved' end,
  case when u.status in ('delivered','in-transit','refunded','failed') then null
       else 'order' end,
  /* Received before it could be sold. Three weeks is a plausible time on a
     shelf and keeps every receipt earlier than its despatch. */
  u.placed - 21,
  'GRN-' || to_char(u.placed - 21, 'YYYYMM') || '-' || lpad((u.line_no % 40 + 1)::text, 3, '0'),
  u.supplier_id,
  'BATCH-' || to_char(u.placed - 21, 'YYYYMM') || '-' || upper(substr(u.product_id, 5, 4)),
  u.order_id, u.order_item_id, u.order_ref, u.buyer_name,
  case when u.status in ('delivered','in-transit','refunded','failed') then u.placed + 1 end,
  case when u.status in ('delivered','refunded','failed') then u.placed + 4 end,
  case when u.status in ('refunded','failed') then u.placed + 11 end,
  case u.status
    when 'refunded' then 'Returned after refund; inspected and back on the shelf pending regrade'
    when 'failed'   then 'Delivery failed and the consignment came back'
    else null end
from unit u
on conflict (serial) do nothing;

/* ---- 2. The rest of the shelf ----------------------------------------------- */

/* Whatever the ledger said was on hand, less what step 1 already accounted for.
   Minted as free stock across a spread of receipt dates and batches, because a
   warehouse that received four hundred units on one day did not. */
do $$
declare
  l record;
  seq bigint;
  want integer;
begin
  for l in
    select i.product_id, i.warehouse_id, i.on_hand,
           coalesce((select count(*) from public.stock_unit u
                      where u.product_id = i.product_id
                        and u.warehouse_id = i.warehouse_id
                        and u.state in ('in_stock','reserved')), 0) as already
      from public.operator_inventory i
     order by i.sort_order
  loop
    want := greatest(l.on_hand - l.already, 0);
    continue when want = 0;

    select coalesce(max(right(serial, 7)::bigint), 0) into seq
      from public.stock_unit where product_id = l.product_id;

    insert into public.stock_unit
      (serial, product_id, warehouse_id, state, received_on, grn_ref, supplier_id, batch_ref)
    select
      public.mint_serial(l.product_id, seq + g),
      l.product_id, l.warehouse_id, 'in_stock',
      /* Spread back over roughly a year, oldest first, so FIFO picking has
         something to be first about. */
      current_date - ((want - g) * 330 / greatest(want, 1)) - 5,
      'GRN-' || to_char(current_date - ((want - g) * 330 / greatest(want, 1)) - 5, 'YYYYMM')
        || '-' || lpad((((g - 1) / 60) + 1)::text, 3, '0'),
      (select pt.id from public.products p join public.partners pt on pt.name = p.seller
        where p.id = l.product_id),
      'BATCH-' || to_char(current_date - ((want - g) * 330 / greatest(want, 1)) - 5, 'YYYYMM')
        || '-' || upper(substr(l.product_id, 5, 4))
      from generate_series(1, want) g
    on conflict (serial) do nothing;
  end loop;
end $$;

/* ---- 3. Reservations that are not orders ------------------------------------ */

/* A warehouse holds stock back for reasons that are not an order, and a console
   that only ever shows "reserved: against an order" has never shown anybody the
   state they will actually have to explain. Three real ones. */
with held as (
  select serial,
         case
           when product_id = 'SKU-4001' then 'demo'
           when product_id = 'SKU-5003' then 'quarantine'
           else 'allocation' end as why,
         row_number() over (partition by product_id order by received_on desc) as rn
    from public.stock_unit
   where state = 'in_stock'
     and product_id in ('SKU-4001','SKU-5003','SKU-5005')
)
update public.stock_unit u
   set state = 'reserved', hold_reason = h.why,
       note = case h.why
         when 'demo' then 'Demo pool for the Mumbai flagship store'
         when 'quarantine' then 'Batch held pending a cold-chain calibration certificate'
         else 'Committed to the Q3 enterprise framework agreement' end
  from held h
 where u.serial = h.serial
   and h.rn <= case h.why when 'demo' then 12 when 'quarantine' then 40 else 25 end;

/* ---- 4. The ledger stops asserting and starts counting ---------------------- */

update public.operator_inventory i
   set on_hand  = coalesce(r.on_hand, 0),
       reserved = coalesce(r.reserved, 0)
  from public.stock_unit_rollup r
 where r.product_id = i.product_id and r.warehouse_id = i.warehouse_id;

/* A line with no units at all counts zero rather than keeping whatever number
   was on it. SKU-4008 is out of stock with 2,000 inbound, and that is a real
   state the panel is built to show. */
update public.operator_inventory i
   set on_hand = 0, reserved = 0
 where not exists (select 1 from public.stock_unit u
                    where u.product_id = i.product_id and u.warehouse_id = i.warehouse_id
                      and u.state in ('in_stock','reserved'));

/* ---- 5. Assertions ---------------------------------------------------------- */

do $$
declare
  bad text;
  n int;
  r record;
begin
  /* The whole point. Every stored count agrees with the units under it. */
  select string_agg(line_id || ' (ledger ' || ledger_on_hand || ', counted ' || counted_on_hand || ')', ', ')
    into bad from public.serial_consistency where not agrees;
  if bad is not null then raise exception 'the ledger disagrees with the units: %', bad; end if;

  /* Every unit that left has an order behind it. */
  select count(*) into n from public.stock_unit
   where state in ('despatched','delivered') and order_id is null;
  if n > 0 then raise exception '% units left without an order', n; end if;

  /* And every reservation says why it is one. */
  select count(*) into n from public.stock_unit where state = 'reserved' and hold_reason is null;
  if n > 0 then raise exception '% reservations do not say why', n; end if;

  /* Both kinds of reservation must exist, or the distinction is decoration. */
  select count(*) into n from public.stock_unit where state = 'reserved' and hold_reason = 'order';
  if n = 0 then raise exception 'nothing is reserved against an order'; end if;
  select count(*) into n from public.stock_unit where state = 'reserved' and hold_reason <> 'order';
  if n = 0 then raise exception 'nothing is held back, so the hold reasons are untested'; end if;

  /* A serial cannot have been despatched before it was received. */
  select count(*) into n from public.stock_unit where despatched_on < received_on;
  if n > 0 then raise exception '% units went out before they arrived', n; end if;
  select count(*) into n from public.stock_unit where delivered_on < despatched_on;
  if n > 0 then raise exception '% units arrived before they left', n; end if;

  /* A known order has to be traceable to its units, which is the question the
     whole table exists to answer. */
  select count(*) into n from public.stock_unit where order_ref = 'ORD-882091';
  if n <> 94 then raise exception 'ORD-882091 shipped 94 units and % are traceable', n; end if;

  /* And every unit has a history rather than only a current state. */
  select count(*) into n from public.stock_unit u
   where not exists (select 1 from public.stock_unit_event e where e.serial = u.serial);
  if n > 0 then raise exception '% units have no history', n; end if;

  select count(*) into n from public.stock_unit;
  raise notice 'units: %, events: %, on orders: %', n,
    (select count(*) from public.stock_unit_event),
    (select count(*) from public.stock_unit where order_id is not null);
end $$;
