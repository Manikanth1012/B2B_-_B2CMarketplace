/* A basket with two sellers has no one seller.
 *
 * `20260809210000` set `orders.seller` on a mixed basket to whichever line was
 * dearest, with a comment calling the column "a convenience rather than the
 * record". That was reasoning from first principles about a question the
 * codebase had already answered.
 *
 * `20260802380000` gave the column its meaning: NULL where an order genuinely
 * spans sellers. `catalogueIntegrity.integration` enforces it, and its comment
 * says what the rule is for — the original defect was an order that "said Aegis
 * Assurance while the SKU it pointed at was sold by Kestrel Devices", and the
 * checkout's first attempt at a fix wrote a joined list into the field.
 *
 * A half-true name is worse than no name. "Kestrel Devices" on a basket that is
 * two-thirds Kestrel and one-third Aegis reads, on every screen that shows it,
 * as a fact about the whole order. Null reads as "look at the lines", which is
 * where the answer is.
 *
 * Worth recording that I found this by writing a rule rather than by reading
 * for one. The column had a documented meaning, a migration that set it and a
 * test that guards it, and none of that was visible from the insert statement I
 * was copying.
 */

/* Every order, not only the ones written today.
 *
 * Scoping this to my own rows was the first draft, and the assertion below
 * immediately found two that predate it: ORD-881441 (Kestrel and PlayForge in
 * one consumer basket) and ORD-881118 (Aventa and Nimbus on an enterprise
 * account). Both name one of their two sellers. Applying a rule to the rows I
 * happened to touch and leaving the others is how a book ends up with two
 * conventions and a test that passes on a subset.
 */
update public.orders o
   set seller = case
     when (select count(distinct p.seller)
             from public.order_items i
             join public.products p on p.id = i.product_id
            where i.order_id = o.id) > 1
     then null
     else (select min(p.seller)
             from public.order_items i
             join public.products p on p.id = i.product_id
            where i.order_id = o.id) end
 where exists (select 1 from public.order_items i where i.order_id = o.id);

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text; n int;
begin
  /* ASSERT-1: no order names one seller while its lines name another. The rule
     `catalogueIntegrity` enforces, asserted here so the seed cannot break it
     between test runs. */
  select string_agg(format('%s says %s, line %s is %s',
                           o.order_ref, o.seller, i.product_id, p.seller), '; ') into bad
    from public.orders o
    join public.order_items i on i.order_id = o.id
    join public.products p on p.id = i.product_id
   where o.seller is not null and o.seller is distinct from p.seller;
  if bad is not null then raise exception 'orders naming a seller their lines do not: %', bad; end if;

  /* ASSERT-2: and none of them names several at once, which is the other way
     this has been got wrong here. */
  select string_agg(order_ref, ', ') into bad from public.orders
   where seller like '%, %';
  if bad is not null then raise exception 'orders with a joined list of sellers: %', bad; end if;

  /* ASSERT-3: the cross-seller baskets still exist and are still null-sellered,
     so the case stays exercised rather than being tidied out of existence. */
  select count(*) into n from public.orders o
   where o.seller is null
     and (select count(distinct p.seller) from public.order_items i
            join public.products p on p.id = i.product_id where i.order_id = o.id) > 1;
  if n < 5 then raise exception 'only % orders span sellers with no single name on them', n; end if;

  /* ASSERT-4: and a single-seller order still names it — null is for the mixed
     case, not a way of avoiding the question. */
  select string_agg(o.order_ref, ', ') into bad from public.orders o
   where o.seller is null
     and (select count(distinct p.seller) from public.order_items i
            join public.products p on p.id = i.product_id where i.order_id = o.id) = 1;
  if bad is not null then
    raise exception 'single-seller orders that do not name their seller: %', bad;
  end if;
end $$;
