/* Counting the units instead of asserting a number found the number wrong.
 *
 * `operator_inventory.reserved` read 120 K9 Pro, 140 K9 Lite, 210 Volta CPE and
 * so on — 882 units across the ledger, spoken for by nothing. There were 14
 * units of open order demand in the whole database. The rest was decoration
 * that had been sitting in an availability calculation, and every "available"
 * figure on the screen was that much too low.
 *
 * The recount corrected them to what is actually reserved, which is the right
 * answer and leaves most lines at zero. This migration puts back the holds that
 * are real, each with the reason that makes it one. A warehouse does hold stock
 * back — a batch in quarantine, a block committed to a channel, a demo pool —
 * and those are states worth showing. What it does not do is reserve two
 * hundred units against nothing.
 *
 * The three lines below their reorder point are the three with stock already on
 * order, which is not a coincidence: somebody reordered because they were low.
 */

/* Clear the holds seeded in the previous migration so this one is the single
   statement of what is held and why, rather than a second layer on top. */
update public.stock_unit
   set state = 'in_stock', hold_reason = null, note = null
 where state = 'reserved' and hold_reason <> 'order';

do $$
declare
  h record;
  n int;
begin
  for h in
    select * from (values
      /* Kestrel K7 is the outgoing model. Thirty units are committed to a
         retail channel for August and cannot be sold from the marketplace,
         which is why the line reads low while 300 are inbound. */
      ('SKU-4003','wh-001','allocation', 30,
       'Committed to the Airtel retail channel for August'),

      /* A cold-chain sensor batch cannot ship without its calibration
         certificate. The units are in the building and are not sellable. */
      ('SKU-5003','wh-002','quarantine', 40,
       'Batch held pending a cold-chain calibration certificate'),

      /* The gateway line is short because a framework agreement took a block
         of it. Twelve, against the eight already on open orders. */
      ('SKU-5007','wh-002','allocation', 12,
       'Committed to the Q3 enterprise framework agreement'),

      /* Every flagship store needs handsets nobody can buy. */
      ('SKU-4001','wh-001','demo', 12,
       'Demo pool for the Mumbai flagship store'),

      /* And a tracker batch failed inspection and is waiting on the supplier. */
      ('SKU-5005','wh-002','quarantine', 18,
       'Failed goods-in inspection; awaiting a supplier decision')
    ) as t(product, warehouse, why, qty, reason)
  loop
    with pick as (
      select serial from public.stock_unit
       where product_id = h.product and warehouse_id = h.warehouse and state = 'in_stock'
       /* Newest first for a hold — the oldest units should still be the ones
          that ship, or a hold quietly ages the shelf behind it. */
       order by received_on desc, serial
       limit h.qty
    )
    update public.stock_unit u
       set state = 'reserved', hold_reason = h.why, note = h.reason
      from pick where u.serial = pick.serial;

    get diagnostics n = row_count;
    if n < h.qty then
      raise exception 'wanted % of % to hold and only % were free', h.qty, h.product, n;
    end if;
  end loop;
end $$;

/* Recount. The ledger follows the units; it never leads them. */
update public.operator_inventory i
   set on_hand  = coalesce(r.on_hand, 0),
       reserved = coalesce(r.reserved, 0)
  from public.stock_unit_rollup r
 where r.product_id = i.product_id and r.warehouse_id = i.warehouse_id;

do $$
declare
  bad text;
  n int;
begin
  select string_agg(line_id, ', ') into bad from public.serial_consistency where not agrees;
  if bad is not null then raise exception 'ledger and units disagree on %', bad; end if;

  /* Every hold names itself. */
  select count(*) into n from public.stock_unit where state = 'reserved' and note is null and hold_reason <> 'order';
  if n > 0 then raise exception '% holds do not say why they are held', n; end if;

  /* The three lines with stock on order are the three below their reorder
     point — and each is covered by what is inbound, which is the state the
     decision panel is built to show. */
  select string_agg(i.id, ', ') into bad
    from public.operator_inventory i
   where i.available < i.reorder_point and i.inbound = 0;
  if bad is not null then
    raise exception 'lines below the reorder point with nothing on order: %', bad;
  end if;

  select count(*) into n from public.operator_inventory where available < reorder_point;
  if n < 3 then raise exception 'only % lines are below the reorder point', n; end if;

  raise notice 'held back: %, on orders: %, below reorder point: %',
    (select count(*) from public.stock_unit where state = 'reserved' and hold_reason <> 'order'),
    (select count(*) from public.stock_unit where state = 'reserved' and hold_reason = 'order'),
    n;
end $$;
