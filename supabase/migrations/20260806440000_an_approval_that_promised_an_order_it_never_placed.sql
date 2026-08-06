/* An approval that promised an order it never placed.
 *
 * Approving a requisition wrote an order reference onto it and told the
 * approver "the order has gone to the seller and ₹98,610 is committed". No
 * order was created. The reference was minted in the browser from the
 * requisition's own id, so it looked plausible on every screen that printed it
 * and resolved to nothing anywhere.
 *
 * Every approval made through the interface produced one. REQ-5516 is the one
 * that survived long enough to be noticed, and it was noticed by a test
 * approving a requisition rather than by anybody looking — which is the same
 * shape as the twelve subscriptions billing against orders that did not exist,
 * and the same shape as a stored total with no ledger beneath it. A record
 * asserting that something happened, and nothing that happened.
 *
 * The reason it was never fixed properly is visible in the data: a requisition
 * says what it costs and describes what it is for in prose, and never said
 * *what it was buying*. There was nothing to make an order line out of. So:
 *
 *   - `product_id` and `quantity` join the requisition, because a purchase
 *     order that cannot name the thing being purchased is not one
 *   - `place_requisition_order` builds the order and its line in the database,
 *     under the approver's own rights, and returns the reference it actually
 *     created
 *
 * Tax follows the rule the rest of the marketplace settled on: the requisition
 * amount is the figure the approver agreed to, so it is the order total and the
 * market's rate comes out of it rather than on top. Adding tax on top would be
 * the cart bug this marketplace already fixed once, moved to procurement where
 * the numbers are larger.
 */

begin;

/* ---- A requisition names what it is buying ------------------------------- */

alter table enterprise_requisitions
  add column if not exists product_id text references products(id),
  add column if not exists quantity   int not null default 1;

alter table enterprise_requisitions drop constraint if exists requisition_quantity_is_positive;
alter table enterprise_requisitions add constraint requisition_quantity_is_positive
  check (quantity >= 1);

/* Backfilled by matching the phrase before the em-dash, which is how these
   titles were written: the catalogue name, then what makes this purchase of it
   different. Nine of the ten resolve that way. */
update enterprise_requisitions r
   set product_id = (
     select p.id from products p
      where 'enterprise' = any(p.audiences)
        and split_part(r.title, ' — ', 1) ilike '%' || split_part(p.name, ' — ', 1) || '%'
      order by length(p.name) desc limit 1),
       quantity = coalesce((regexp_match(r.title, '[x×]\s*(\d+)\s*$'))[1]::int, 1)
 where r.product_id is null;

/* The tenth is a rollout of two things at once — ninety sensors and four
   gateways. The sensor is what the line is for and the title says the rest. */
update enterprise_requisitions set product_id = 'SKU-5004'
 where id = 'REQ-5487' and product_id is null;

/* ---- Approving places the order ------------------------------------------ */

create or replace function place_requisition_order(p_req_id text)
returns text language plpgsql security definer set search_path = public, extensions as $fn$
declare
  req    record;
  prod   record;
  acct   record;
  rate   numeric;
  ref    text;
  oid    uuid;
  sub    numeric;
  tax    numeric;
begin
  select * into req from enterprise_requisitions where id = p_req_id;
  if req.id is null then raise exception 'No such requisition.'; end if;
  if req.state <> 'approved' then
    raise exception '% is %, so there is nothing to order.', req.id, req.state;
  end if;
  if req.product_id is null then
    raise exception '% does not say what it is buying, so no order line can be written for it.', req.id;
  end if;

  /* Already placed. Returning the existing reference rather than a second
     order is what makes a half-failed approval safe to retry. */
  if req.order_ref is not null and exists (select 1 from orders where order_ref = req.order_ref) then
    return req.order_ref;
  end if;

  select * into prod from products where id = req.product_id;
  select * into acct from enterprise_accounts where id = req.account_id;

  select m.tax_rate into rate from markets m where m.code = coalesce(acct.market, 'IN');
  rate := coalesce(rate, 0);

  /* The requisition amount is the figure the approver agreed to, so it is the
     total and the tax comes out of it — not on top. That holds whether or not
     the catalogue lists the product tax-inclusive: an approver who signed off
     ₹98,610 did not agree to ₹1,16,360, and an order that charged the second
     would be the cart bug this marketplace already fixed once, moved to
     procurement where the numbers are larger. REQ-5501 was seeded this way and
     the arithmetic here reproduces it exactly. */
  sub := round(req.amount / (1 + rate / 100), 2);
  tax := round(req.amount - sub, 2);

  ref := 'ORD-8821' || right(regexp_replace(req.id, '\D', '', 'g'), 2);
  while exists (select 1 from orders where order_ref = ref) loop
    ref := 'ORD-8821' || right(regexp_replace(req.id, '\D', '', 'g'), 2)
           || '-' || substr(md5(clock_timestamp()::text), 1, 3);
  end loop;

  oid := gen_random_uuid();
  insert into orders (
    id, order_ref, status, total, subtotal, tax, discount, payment_method,
    buyer_name, buyer_email, created_at, placed_date, seller, vertical,
    failed, stage, stages, account_id, requisition_id, ordered_by,
    cost_centre, po_ref, currency, market, tax_rate)
  values (
    oid, ref, 'placed', req.amount, sub, tax, 0, 'On account — Net 30',
    acct.company, (select u.email from enterprise_users u where u.id = req.raised_by),
    now(), to_char(now(), 'DD Mon YYYY'),
    prod.seller, req.vertical,
    false, 1, array['Ordered', 'Approved', 'Packed', 'In transit', 'Delivered'],
    req.account_id, req.id, req.raised_by,
    req.cost_centre, req.po_ref, req.currency, coalesce(acct.market, 'IN'), rate);

  insert into order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status)
  values (gen_random_uuid(), oid, prod.id, req.title, req.amount, req.quantity, 'pending', 'placed');

  update enterprise_requisitions set order_ref = ref where id = req.id;
  return ref;
end $fn$;

grant execute on function place_requisition_order(text) to authenticated;

/* ---- The one already approved with nothing behind it --------------------- */

do $$
declare made text;
begin
  if exists (select 1 from enterprise_requisitions r
              where r.id = 'REQ-5516'
                and not exists (select 1 from orders o where o.order_ref = r.order_ref)) then
    /* Clear the reference that pointed at nothing so the function mints a real
       one rather than adopting a ghost. */
    update enterprise_requisitions set order_ref = null where id = 'REQ-5516';
    made := place_requisition_order('REQ-5516');
    raise notice 'REQ-5516 now has a real order: %', made;
  end if;
end $$;

do $$
declare n int;
begin
  select count(*) into n from enterprise_requisitions r
   where r.order_ref is not null
     and not exists (select 1 from orders o where o.order_ref = r.order_ref);
  if n > 0 then raise exception '% approved requisitions still point at an order that does not exist', n; end if;

  select count(*) into n from enterprise_requisitions where product_id is null;
  if n > 0 then raise exception '% requisitions still do not say what they are buying', n; end if;

  /* And an order made this way has to be complete enough to render. */
  select count(*) into n from orders o
   where o.requisition_id is not null
     and not exists (select 1 from order_items i where i.order_id = o.id);
  if n > 0 then raise exception '% requisition orders have no lines', n; end if;
end $$;

commit;
