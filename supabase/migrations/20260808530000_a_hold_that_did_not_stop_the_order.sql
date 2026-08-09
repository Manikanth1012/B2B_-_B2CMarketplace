/* A hold that did not stop the order.
 *
 * `20260808500000` added the credit hold and said, in its own comment:
 *
 *     And a held requisition does not become an order until somebody releases it.
 *
 * It does not. The hold sets `credit_hold` on the requisition and leaves `state`
 * as `approved`, and `place_requisition_order` — which `decideRequisition` calls
 * in the same breath as the approval — never looks at it. So an account past its
 * limit gets its order placed, goes to the seller, and the hold sits on the row
 * as a flag nobody consulted.
 *
 * This is exactly the defect the migration that introduced it was written to fix,
 * and I wrote the sentence describing the control in the same file as the code
 * that fails to implement it. Two days of finding controls that turned out to be
 * comments, and then one of my own.
 *
 * The fix is one condition in the right place. The reason it belongs in
 * `place_requisition_order` rather than in the approval is that approving is not
 * the thing that costs money — an approval past a limit is a decision the
 * account is entitled to make and finance is entitled to be told about. Sending
 * the order is what commits the marketplace, so that is where the hold has to
 * bite.
 */

create or replace function public.place_requisition_order(p_req_id text)
returns text language plpgsql security definer
set search_path to 'public', 'extensions' as $$
declare
  req    record;
  prod   record;
  acct   record;
  rate   numeric;
  ref    text;
  oid    uuid;
  sub    numeric;
  tax    numeric;
  extant text;
begin
  select * into req from enterprise_requisitions where id = p_req_id;
  if req.id is null then raise exception 'No such requisition.'; end if;
  if req.state <> 'approved' then
    raise exception '% is %, so there is nothing to order.', req.id, req.state;
  end if;

  /* The hold, where it costs something. An approval past the limit is a decision
     the account may make; sending the order is what commits us. */
  if coalesce(req.credit_hold, false) then
    raise exception
      '% is held on credit and cannot go to the seller yet. %',
      req.id, coalesce(req.credit_note, 'Finance can release it against an early payment.');
  end if;

  if req.product_id is null then
    raise exception '% does not say what it is buying, so no order line can be written for it.', req.id;
  end if;

  /* Ask the orders table, not the requisition's pointer at it. */
  select order_ref into extant from orders where requisition_id = req.id limit 1;
  if extant is not null then
    update enterprise_requisitions set order_ref = extant
     where id = req.id and order_ref is distinct from extant;
    return extant;
  end if;

  select * into prod from products where id = req.product_id;
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
    prod.seller, req.vertical,
    false, 1, array['Ordered', 'Approved', 'Packed', 'In transit', 'Delivered'],
    req.account_id, req.id, req.raised_by,
    req.cost_centre, req.po_ref, req.currency, coalesce(acct.market, 'IN'), rate);

  insert into order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status)
  values (gen_random_uuid(), oid, prod.id, req.title,
          round(req.amount / greatest(req.quantity, 1), 2), req.quantity, 'pending', 'placed');

  update enterprise_requisitions set order_ref = ref where id = req.id;
  return ref;
end $$;

grant execute on function public.place_requisition_order(text) to authenticated;

/* And releasing the hold places the order that was waiting on it, so a release
 * is a complete act rather than a flag change somebody has to follow up.
 */
create or replace function public.release_credit_hold(p_req text, p_who text, p_why text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare req record; v_ref text;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace releases a credit hold.';
  end if;
  if coalesce(trim(p_why), '') = '' then
    return jsonb_build_object('ok', false, 'why',
      'Say what the release is against. A hold lifted for no recorded reason is a limit that does not exist.');
  end if;

  update public.enterprise_requisitions
     set credit_hold = false,
         credit_note = coalesce(credit_note, '')
                       || format(' Released by %s on %s: %s', p_who, current_date, p_why)
   where id = p_req and credit_hold
   returning * into req;

  if req.id is null then
    return jsonb_build_object('ok', false, 'why', 'No such requisition, or it is not held.');
  end if;

  /* The order the hold was stopping. Only for an approval that already happened
     — releasing a hold is not an approval and must not become one. */
  if req.state = 'approved' then
    v_ref := public.place_requisition_order(p_req);
    return jsonb_build_object('ok', true, 'order_ref', v_ref,
      'why', format('%s released and %s has gone to the seller.', p_req, v_ref));
  end if;

  return jsonb_build_object('ok', true,
    'why', format('%s released. It still needs approving before anything is ordered.', p_req));
end $$;

grant execute on function public.release_credit_hold(text, text, text) to authenticated;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare v_body text; n int;
begin
  /* ASSERT-1: the order function actually consults the hold. Checking the source
     rather than the behaviour because the behaviour needs an over-limit account
     and a pending requisition to exist, and this has to hold whether or not one
     does today. */
  select pg_get_functiondef(p.oid) into v_body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'place_requisition_order';
  if v_body not like '%credit_hold%' then
    raise exception 'place_requisition_order still does not look at the credit hold';
  end if;

  /* ASSERT-2: and nothing already in the book slipped through — no order exists
     against a requisition that is currently held. */
  select count(*) into n
    from public.orders o join public.enterprise_requisitions r on r.id = o.requisition_id
   where r.credit_hold;
  if n <> 0 then
    raise exception '% orders were placed against requisitions that are held on credit', n;
  end if;

  /* ASSERT-3: the release still demands a reason, and is still the operator's
     alone.
   *
     Checked in the source rather than by calling it. This migration runs as the
     migration role, which has no persona, so invoking it raises "Only the
     marketplace releases a credit hold" — which is the guard working, and the
     first draft of this assertion mistook it for a failure. */
  select pg_get_functiondef(p.oid) into v_body
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'release_credit_hold';
  if v_body not like '%Only the marketplace releases a credit hold%' then
    raise exception 'anybody can release a credit hold';
  end if;
  if v_body not like '%a limit that does not exist%' then
    raise exception 'a hold can be released with no reason recorded';
  end if;
end $$;
