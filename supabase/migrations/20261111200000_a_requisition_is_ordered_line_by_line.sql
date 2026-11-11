/* An ordinary requisition is ordered line by line.
 *
 * A business buyer raises a requisition from the requisition basket, and
 * `raiseRequisition` (src/lib/enterpriseRepo.ts) writes it as a header and its
 * lines: what is being bought is on `enterprise_requisition_lines`, one row a
 * product, and the header's `amount` is their sum. The header's own
 * `product_id` is never set — a basket of two products has no one product to
 * name there.
 *
 * `place_requisition_order` read only the header. Outside a bundle it ordered
 * one line from `req.product_id` and `req.quantity`, so every such requisition
 * was approved and then refused its order:
 *
 *   "REQ-… does not say what it is buying, so no order line can be written
 *    for it."
 *
 * The approval stood, the requester was told it had gone through, and nothing
 * went to a seller. Released from a credit hold it was worse: the release was
 * refused whole, so the hold could not be lifted at all.
 *
 * 20261105200000 already orders a bundle requisition line by line. This takes
 * that same path for a requisition whose header names no product and which has
 * lines, and changes nothing else:
 *
 *   - the same checks, in the same order: approved, not held on credit, says
 *     what it is buying, not already ordered;
 *   - no line without a listing, and the lines sum to the approved amount, or
 *     it is refused in a sentence rather than ordered for a different figure;
 *   - each line at the unit price it was approved at, named after its product;
 *     a line with no bundle carries a null `bundle_selection_id`, which is what
 *     every non-bundle order line carries;
 *   - the order names a seller only when one seller covers every line.
 *
 * A requisition whose header names a product (the seeded ones, say)
 * keeps the single-line path byte for byte. Those were ordered correctly and
 * their header product, quantity and amount are what was approved; reading
 * their lines instead would change what an already-working approval orders.
 * A requisition with neither a product nor lines is still refused with the
 * sentence it always got.
 *
 * Only the branch condition changes. `v_bundle` is renamed `v_by_line`
 * because it no longer means only "a bundle is on it"; the bundle behaviour is
 * identical. 20261105200000 is applied and is not edited. Re-runnable: the
 * function is replaced, and the check at the end reads back what was
 * installed.
 */

/* ============================================ the order a requisition becomes === */

create or replace function public.place_requisition_order(p_req_id text)
returns text language plpgsql security definer
set search_path to 'public', 'extensions' as $$
declare
  req      record;
  prod     record;
  acct     record;
  rate     numeric;
  ref      text;
  oid      uuid;
  sub      numeric;
  tax      numeric;
  extant   text;
  v_by_line boolean;
  v_sum    numeric;
  v_seller text;
  v_bad    text;
begin
  select * into req from enterprise_requisitions where id = p_req_id;
  if req.id is null then raise exception 'No such requisition.'; end if;
  if req.state <> 'approved' then
    raise exception '% is %, so there is nothing to order.', req.id, req.state;
  end if;

  if coalesce(req.credit_hold, false) then
    raise exception
      '% is held on credit and cannot go to the seller yet. %',
      req.id, coalesce(req.credit_note, 'Finance can release it against an early payment.');
  end if;

  /* Line by line when a bundle is on it (20261105200000), or when the header
     names no product and the lines say what is being bought. */
  v_by_line := exists (select 1 from enterprise_requisition_lines l
                        where l.requisition_id = req.id and l.bundle_selection_id is not null)
               or (req.product_id is null
                   and exists (select 1 from enterprise_requisition_lines l
                                where l.requisition_id = req.id));

  if not v_by_line and req.product_id is null then
    raise exception '% does not say what it is buying, so no order line can be written for it.', req.id;
  end if;

  select order_ref into extant from orders where requisition_id = req.id limit 1;
  if extant is not null then
    update enterprise_requisitions set order_ref = extant
     where id = req.id and order_ref is distinct from extant;
    return extant;
  end if;

  if v_by_line then
    select string_agg(l.name, ', ' order by l.sort_order) into v_bad
      from enterprise_requisition_lines l
     where l.requisition_id = req.id and l.product_id is null;
    if v_bad is not null then
      raise exception '% has lines that name no listing (%), so no order line can be written for them.', req.id, v_bad;
    end if;
    select coalesce(sum(l.line_total), 0) into v_sum
      from enterprise_requisition_lines l where l.requisition_id = req.id;
    if v_sum is distinct from req.amount then
      raise exception '% was approved for % but its lines add up to %, so it cannot be ordered as it stands.',
        req.id, req.amount, v_sum;
    end if;
    select case when count(distinct p.seller) = 1 then min(p.seller) end into v_seller
      from enterprise_requisition_lines l join products p on p.id = l.product_id
     where l.requisition_id = req.id;
  else
    select * into prod from products where id = req.product_id;
    v_seller := prod.seller;
  end if;

  select * into acct from enterprise_accounts where id = req.account_id;

  select m.tax_rate into rate from markets m where m.code = coalesce(acct.market, 'IN');
  rate := coalesce(rate, 0);

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
    v_seller, req.vertical,
    false, 1, array['Ordered', 'Approved', 'Packed', 'In transit', 'Delivered'],
    req.account_id, req.id, req.raised_by,
    req.cost_centre, req.po_ref, req.currency, coalesce(acct.market, 'IN'), rate);

  if v_by_line then
    /* Every line, in one insert, at the price the requisition was approved
       at; the product's own name, as every order line carries. */
    insert into order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status,
                             bundle_selection_id)
    select gen_random_uuid(), oid, l.product_id, p.name, l.unit_price, l.quantity, 'pending', 'placed',
           l.bundle_selection_id
      from enterprise_requisition_lines l join products p on p.id = l.product_id
     where l.requisition_id = req.id
     order by l.sort_order, l.id;
  else
    /* The product's name, not the requisition's title (20260809250000). */
    insert into order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status)
    values (gen_random_uuid(), oid, prod.id, prod.name,
            round(req.amount / greatest(req.quantity, 1), 2), req.quantity, 'pending', 'placed');
  end if;

  update enterprise_requisitions set order_ref = ref where id = req.id;
  return ref;
end $$;

grant execute on function public.place_requisition_order(text) to authenticated;

/* ===================================================== what has to be true === */

/* The installed function takes the line-by-line path for a requisition with
   no header product, and still has every check it had before. */
do $$
declare t text;
begin
  select pg_get_functiondef(p.oid) into t from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'place_requisition_order';
  if t is null then
    raise exception 'place_requisition_order is not installed';
  end if;
  if t not like '%req.product_id is null%and exists (select 1 from enterprise_requisition_lines l%' then
    raise exception 'place_requisition_order does not order a requisition with no header product line by line';
  end if;
  if t not like '%l.bundle_selection_id is not null%' or t not like '%l.bundle_selection_id%from enterprise_requisition_lines l join products p%' then
    raise exception 'place_requisition_order no longer carries bundle lines onto the order';
  end if;
  if t not like '%credit_hold%' or t not like '%oid, prod.id, prod.name%'
     or t not like '%does not say what it is buying%' or t not like '%from orders where requisition_id = req.id%' then
    raise exception 'place_requisition_order lost a check it had before';
  end if;
  if t not like '%but its lines add up to%' or t not like '%that name no listing%' then
    raise exception 'place_requisition_order orders lines without checking them';
  end if;
  if t like '%v_bundle%' then
    raise exception 'place_requisition_order is still the version that orders only bundles line by line';
  end if;
end $$;
