/* The enterprise numbers screen said "A device" 103 times.
 *
 * `number_holder` resolves a device name by joining `stock_unit` to `products`,
 * and it is a `security_invoker` view — so the join runs as whoever is reading.
 * `stock_unit` had policies for the operator and for the seller who supplied
 * the unit, and none for the buyer who owns it. The subquery returned null and
 * the screen fell back to "a device", which is the least useful thing it could
 * have said on a page whose whole purpose is naming the thing.
 *
 * The right fix is the grant, not a fallback string. A buyer can already see
 * the order, the line and the product; the serial of the unit that arrived is
 * the same fact at a finer grain, and withholding it means a customer reporting
 * a fault cannot tell us which sensor they are standing in front of.
 *
 * A buyer sees the units on its own orders and nothing else — not the shelf,
 * not another account's despatches, not what is held back in quarantine.
 */

drop policy if exists account_read_own_stock_unit on public.stock_unit;
create policy account_read_own_stock_unit on public.stock_unit
  for select using (
    current_persona() = 'enterprise'
    and order_id is not null
    and exists (
      select 1 from public.orders o
       where o.id = stock_unit.order_id
         and o.account_id = current_account_id())
  );

/* And a retail customer sees the units on their own orders, for the same
   reason — "which handset is this" is a question they get asked by support. */
drop policy if exists own_stock_unit on public.stock_unit;
create policy own_stock_unit on public.stock_unit
  for select using (
    order_id is not null
    and exists (
      select 1 from public.orders o
       where o.id = stock_unit.order_id and o.user_id = auth.uid())
  );

/* The unit's history is scoped by the unit. A buyer can read the movement of a
   unit it can read, and nothing else — which is how it came to be theirs. */
drop policy if exists holder_read_stock_unit_event on public.stock_unit_event;
create policy holder_read_stock_unit_event on public.stock_unit_event
  for select using (
    exists (select 1 from public.stock_unit u where u.serial = stock_unit_event.serial)
  );

do $$
declare
  n int;
begin
  /* Every device number on file resolves to a product name for somebody. The
     check here is that the join works at all — whether a given reader can see
     a given row is what the policy decides, and the integration tests sign in
     as each persona to check that. */
  select count(*) into n from public.number_holder
   where stock_serial is not null and device is null;
  if n > 0 then raise exception '% device numbers cannot name their device even for the operator', n; end if;

  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'stock_unit'
     and policyname in ('account_read_own_stock_unit', 'own_stock_unit');
  if n <> 2 then raise exception 'the buyer policies were not created'; end if;
end $$;
