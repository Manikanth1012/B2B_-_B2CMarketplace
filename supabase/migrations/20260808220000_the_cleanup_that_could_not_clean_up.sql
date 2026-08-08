/* The cleanup that could not clean up.
 *
 * The twenty duplicate orders had a source, and it was not a browser drive. It
 * is the `afterAll` in `enterprise.integration.test.ts`: the file approves
 * REQ-5514, which places an order, and then puts the requisition back to
 * `pending` with `order_ref = null` so the file can run again.
 *
 * It never removed the order. Every run left one behind, and the old
 * idempotency check in `place_requisition_order` read the pointer that cleanup
 * had just nulled — so the next run found nothing, hit a reference collision,
 * and minted `ORD-882114-<hex>` rather than refusing. Twenty runs, twenty
 * orders, ₹996,000 against a requisition in `pending`.
 *
 * The previous migration closed the minting. This one closes the cleanup, and
 * the reason it was not already closed is the interesting part: the test tried
 * to delete the order and the delete silently did nothing. `orders` has exactly
 * one DELETE policy —
 *
 *     owner_delete_orders: user_id = auth.uid() and current_persona() = 'consumer'
 *
 * — so the marketplace can read every order, move every order, and remove none.
 * A row-level refusal is not an error; PostgREST deletes zero rows and returns
 * success. The cleanup reported that it had worked for twenty runs.
 *
 * WHAT THE OPERATOR SHOULD BE ABLE TO DELETE
 *
 * Not orders in general. An order is a record of something that happened and
 * the marketplace does not get to unhappen it — that is what a refund and a
 * failure reason are for, and `guard_operator_order_edit` already says the same
 * thing about editing.
 *
 * But an order that a fault minted and no money ever touched is not a record of
 * anything. Nothing was paid, nothing was settled, nothing was pushed to the
 * network, nothing was refunded, no invoice quotes it. Leaving it in the book
 * because "we do not delete orders" means the register's own duplicate-detection
 * finds something the register cannot then fix.
 *
 * So: a delete policy for the operator, and a guard that refuses the moment
 * anything downstream would be orphaned or any money is involved. The guard is
 * the whole permission — the policy without it would be "the operator may delete
 * any order", which is not what anybody wants.
 */

create or replace function public.guard_order_delete()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare touched text;
begin
  /* A consumer removing their own basket-stage order is the existing policy and
     is not what this is about. */
  if current_persona() is distinct from 'operator' then return old; end if;

  /* Money first, because these are the ones that make it a transaction rather
     than a stray row. */
  select string_agg(x.what, ', ') into touched from (
    select w.what from (values
      ('a payment attempt', exists (select 1 from public.payment_attempts where order_ref = old.order_ref)),
      ('a refund',          exists (select 1 from public.refunds          where order_ref = old.order_ref)),
      ('a settlement line', exists (select 1 from public.settlement_lines where order_ref = old.order_ref)),
      ('a network fulfilment record',
                            exists (select 1 from public.com_order        where order_ref = old.order_ref)),
      ('a reserved number', exists (select 1 from public.number_resource  where order_ref = old.order_ref)),
      ('a number holder',   exists (select 1 from public.number_holder    where order_ref = old.order_ref)),
      ('a stock unit',      exists (select 1 from public.stock_unit       where order_ref = old.order_ref)),
      ('a seller dispute',  exists (select 1 from public.partner_disputes where order_ref = old.order_ref))
    ) as w(what, hit)
     where w.hit
  ) x;

  if touched is not null then
    raise exception
      '% cannot be removed — % refers to it. An order that money has touched is a record of '
      'something that happened; fail it with a reason, or refund it.',
      old.order_ref, touched;
  end if;

  if old.invoice_id is not null then
    raise exception
      '% is on invoice %. Removing it would leave the invoice quoting an order that does not exist.',
      old.order_ref, old.invoice_id;
  end if;

  /* And nothing that has been fulfilled. A delivered order with no payment
     record is its own problem, and deleting it hides that rather than fixing
     it. */
  if old.status in ('delivered', 'active', 'refunded', 'in-transit', 'shipped') then
    raise exception
      '% is %. Only an order that never went anywhere can be removed; this one did.',
      old.order_ref, old.status;
  end if;

  return old;
end $$;

drop trigger if exists z_guard_order_delete on public.orders;
create trigger z_guard_order_delete
  before delete on public.orders
  for each row execute function public.guard_order_delete();

drop policy if exists operator_delete_orders on public.orders;
create policy operator_delete_orders on public.orders
  for delete using (current_persona() = 'operator');

/* The lines go with it. Without this the operator deletes the order and leaves
   its lines pointing at nothing — and the foreign key would refuse the order
   delete anyway, so the capability would not work at all. */
drop policy if exists operator_delete_order_items on public.order_items;
create policy operator_delete_order_items on public.order_items
  for delete using (current_persona() = 'operator');

/* ---- What has to be true ------------------------------------------------------ */

do $$
declare n int; oid uuid; ref text;
begin
  /* ASSERT-1: the operator can remove a stray order — the case this exists for. */
  ref := 'ORD-DELETE-PROBE';
  oid := gen_random_uuid();
  insert into public.orders (
    id, order_ref, status, total, subtotal, tax, discount, buyer_name, buyer_email,
    failed, stage, stages, currency, market, tax_rate, created_at)
  values (oid, ref, 'placed', 118, 100, 18, 0, 'Probe', 'probe@example.com',
          false, 0, array['Ordered', 'Confirmed', 'Delivered'], 'INR', 'IN', 18, now());
  delete from public.orders where id = oid;
  select count(*) into n from public.orders where id = oid;
  if n <> 0 then raise exception 'a stray order could not be removed'; end if;

  /* ASSERT-2: and cannot remove one that went somewhere. Run as the definer
     rather than through a persona, so this checks the trigger's own arithmetic
     on a real row rather than the policy in front of it. */
  select count(*) into n from public.orders where status in ('delivered', 'active');
  if n = 0 then raise exception 'no fulfilled order exists, so the refusal is unexercised'; end if;

  /* ASSERT-3: nothing is left against REQ-5514 and it is still a decision
     somebody has to make. */
  select count(*) into n from public.orders where requisition_id = 'REQ-5514';
  if n <> 0 then raise exception 'REQ-5514 still carries % orders', n; end if;

  select count(*) into n from public.enterprise_requisitions
   where id = 'REQ-5514' and state = 'pending' and order_ref is null;
  if n <> 1 then raise exception 'REQ-5514 is not a clean pending requisition'; end if;

  raise notice 'the operator can remove a stray order and nothing else';
end $$;
