/* A refusal that had already done the damage.
 *
 * The previous migration gave the operator a narrow delete on `orders` and a
 * guard that refuses anything money has touched. The client function I wrote to
 * use it deleted the lines first and the order second:
 *
 *     await supabase.from('order_items').delete().eq('order_id', o.id)
 *     await supabase.from('orders').delete().eq('id', o.id)
 *
 * On the refusal path — which is the whole point of the guard — the first
 * statement succeeds and the second is refused, so the order survives with no
 * lines behind it. That is worse than either outcome the guard was choosing
 * between: the order is neither removed nor intact, and "an order with no lines"
 * is one of the contradictions the register itself reports.
 *
 * The integration test caught it by asserting the lines were still there after a
 * refusal, and it caught it the way these things are caught — by doing the
 * damage. ORD-13013607-1 lost its line, and it is put back below.
 *
 * TWO FIXES, AND THE SECOND IS THE REAL ONE
 *
 * `order_items.order_id` is already `ON DELETE CASCADE`. The lines were never
 * mine to delete — removing the order removes them, atomically, inside the same
 * statement the guard is attached to. The client function now deletes the order
 * alone.
 *
 * And `operator_delete_order_items` goes. It was added on the assumption that
 * the cascade would not fire, which was wrong, and it is precisely the grant
 * that let a screen strip an order's lines without touching the order. A
 * permission that exists only to enable a mistake is not a permission.
 */

drop policy if exists operator_delete_order_items on public.order_items;

/* ---- Put ORD-13013607-1 back --------------------------------------------------- */

do $$
declare oid uuid;
begin
  select id into oid from public.orders where order_ref = 'ORD-13013607-1';
  if oid is null then
    raise notice 'ORD-13013607-1 is not in this database';
    return;
  end if;
  if exists (select 1 from public.order_items where order_id = oid) then
    raise notice 'ORD-13013607-1 already has its line';
    return;
  end if;

  /* One eSIM plan at the price the order was charged. The order total is 1599
     and line prices are tax-inclusive, so the line is the total — which is also
     what makes it checkable: the register's own arithmetic has to accept it. */
  insert into public.order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status, user_id)
  select gen_random_uuid(), oid, 'SKU-2001', p.name, o.total, 1, 'esim', 'placed', o.user_id
    from public.orders o join public.products p on p.id = 'SKU-2001'
   where o.id = oid;

  raise notice 'ORD-13013607-1 line restored';
end $$;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text; n int;
begin
  /* ASSERT-1: nothing in the book is an order with no lines. This is the state
     the bug created and the state the register reports as `wrong`. */
  select string_agg(o.order_ref, ', ') into bad
    from public.orders o
   where not exists (select 1 from public.order_items i where i.order_id = o.id);
  if bad is not null then raise exception 'orders with no lines behind them: %', bad; end if;

  /* ASSERT-2: and the restored one adds up the way every other order does —
     lines summing to what was charged before discount. */
  select string_agg(x.order_ref, ', ') into bad from (
    select o.order_ref from public.orders o join public.order_items i on i.order_id = o.id
     group by o.id, o.order_ref, o.total, o.discount
    having abs(sum(i.price * i.quantity) - (o.total + o.discount)) > 0.02
  ) x;
  if bad is not null then raise exception 'orders whose lines do not sum to what was charged: %', bad; end if;

  /* ASSERT-3: the operator cannot delete order lines on their own any more.
     Only the cascade from the order removes them. */
  select count(*) into n from pg_policies
   where tablename = 'order_items' and cmd = 'DELETE' and policyname = 'operator_delete_order_items';
  if n <> 0 then raise exception 'the operator can still strip an order of its lines'; end if;

  /* ASSERT-4: and the cascade the fix relies on is really there. */
  select count(*) into n from pg_constraint con
    join pg_class c on c.oid = con.conrelid
   where c.relname = 'order_items' and con.conname = 'order_items_order_id_fkey'
     and pg_get_constraintdef(con.oid) like '%ON DELETE CASCADE%';
  if n <> 1 then
    raise exception 'order_items does not cascade from orders, so removing an order would orphan its lines';
  end if;
end $$;
