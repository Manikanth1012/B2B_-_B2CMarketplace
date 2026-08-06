/* A line price multiplied by its own quantity.
 *
 * `place_requisition_order` wrote the requisition's full amount into
 * `order_items.price` and its quantity beside it. Every reader of an order
 * multiplies those together, so REQ-5516 — six gateways for ₹98,610 — produced
 * an order whose line came to ₹5,91,660 against a total of ₹98,610. The order
 * disagreed with itself by a factor of six, and only on requisitions for more
 * than one of something, which is why the first one looked right.
 *
 * `price` is the unit price. The amount on the requisition is the line total.
 */

begin;

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
     order total and the market's rate comes out of it rather than on top. */
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

  /* Unit price. Every reader multiplies by quantity, so the amount goes in
     divided rather than whole. */
  insert into order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status)
  values (gen_random_uuid(), oid, prod.id, req.title,
          round(req.amount / greatest(req.quantity, 1), 2), req.quantity, 'pending', 'placed');

  update enterprise_requisitions set order_ref = ref where id = req.id;
  return ref;
end $fn$;

/* The order already written with the wrong line.
 *
 * Scoped to orders that disagree *in total* and carry exactly one line. The
 * first version of this compared each line against the whole order, which is
 * only the same thing when there is one line — and ORD-882091 has two, each
 * correctly less than the total, so it rewrote a line that was right. Being
 * caught by this migration's own check rather than by a screen is the argument
 * for the check. */
update order_items i
   set price = round(o.total / greatest(i.quantity, 1), 2)
  from orders o
 where o.id = i.order_id
   and o.requisition_id is not null
   and (select count(*) from order_items x where x.order_id = o.id) = 1
   and round(i.price * i.quantity, 2) <> round(o.total, 2);

do $$
declare bad text;
begin
  select string_agg(x.order_ref, ', ') into bad
    from (
      select o.order_ref
        from orders o join order_items i on i.order_id = o.id
       group by o.order_ref, o.total
      having round(sum(i.price * i.quantity), 2) <> round(o.total, 2)
    ) x;
  if bad is not null then
    raise exception 'these orders disagree with the sum of their own lines: %', bad;
  end if;
end $$;

commit;
