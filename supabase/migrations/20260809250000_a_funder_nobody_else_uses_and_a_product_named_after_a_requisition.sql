/* A funder nobody else uses, and a product named after a requisition.
 *
 * TWO NAMES FOR THE MARKETPLACE
 *
 * `loyalty_ledger.funder` says who paid for the points. The book uses four
 * values across 413 rows — operator, partner, seller, shared — and 369 of them
 * are `operator`, meaning the marketplace itself funded the reward.
 *
 * The fourteen rows I wrote today say `marketplace`. Same meaning, new word,
 * invented while looking at the column rather than at its contents. The rewards
 * test catches it from the other end: it skips operator-funded movements and
 * demands a named seller on everything else, so fourteen rows funded by nobody
 * identifiable appeared out of a migration that was only supposed to be adding
 * orders.
 *
 * Nothing was broken by it in the sense of a wrong figure. What was broken is
 * that "who funded this" now has two answers meaning the same thing, and every
 * query that groups by funder silently reports the marketplace twice.
 *
 * A PRODUCT NAMED AFTER THE REQUISITION THAT ASKED FOR IT
 *
 * `place_requisition_order` writes `req.title` into `order_items.product_name`.
 * A requisition is titled the way a person writes a purchase request — "Volta
 * IoT Gateway LTE-M ×6" — so ORD-882116 carries a line whose product name has
 * the quantity baked into it and does not match the product it points at.
 *
 * The line already has a `quantity` column saying six. The name is the
 * product's name; how many were bought is not part of it. Beyond the untidiness
 * it breaks the rule the catalogue test enforces across the whole book — every
 * order line resolves to a real product, named the same way — which is what
 * makes it possible to ask what a product has sold.
 */

/* ---- 1. One word for the marketplace -------------------------------------------- */

update public.loyalty_ledger
   set funder = 'operator'
 where funder = 'marketplace';

/* ---- 2. The line is named after the product ------------------------------------- */

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

  if coalesce(req.credit_hold, false) then
    raise exception
      '% is held on credit and cannot go to the seller yet. %',
      req.id, coalesce(req.credit_note, 'Finance can release it against an early payment.');
  end if;

  if req.product_id is null then
    raise exception '% does not say what it is buying, so no order line can be written for it.', req.id;
  end if;

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

  /* The product's name, not the requisition's title. A requisition is titled the
     way somebody writes a purchase request — "Volta IoT Gateway LTE-M ×6" — and
     putting that in `product_name` bakes the quantity into the name of a thing,
     beside a `quantity` column that already says six. It also breaks the rule
     that every order line resolves to a product named the same way, which is
     what makes "what has this product sold" answerable at all. */
  insert into order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status)
  values (gen_random_uuid(), oid, prod.id, prod.name,
          round(req.amount / greatest(req.quantity, 1), 2), req.quantity, 'pending', 'placed');

  update enterprise_requisitions set order_ref = ref where id = req.id;
  return ref;
end $$;

grant execute on function public.place_requisition_order(text) to authenticated;

/* And the lines already written that way. */
update public.order_items i
   set product_name = p.name
  from public.products p
 where p.id = i.product_id and i.product_name is distinct from p.name;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text; n int; v_body text;
begin
  /* ASSERT-1: one word for the marketplace, not two. */
  select string_agg(distinct funder, ', ') into bad from public.loyalty_ledger
   where funder not in ('operator', 'partner', 'seller', 'shared');
  if bad is not null then raise exception 'loyalty movements funded by something unrecognised: %', bad; end if;

  /* ASSERT-2: and anything not funded by the marketplace names who did fund it,
     which is the rule the rewards test enforces and the one the invented value
     was slipping past. */
  select string_agg(id, ', ') into bad from public.loyalty_ledger
   where funder <> 'operator' and seller_id is null;
  if bad is not null then raise exception 'non-marketplace movements with no seller named: %', bad; end if;

  /* ASSERT-3: every order line is named after the product it points at. */
  select string_agg(format('%s says "%s", product is "%s"', i.id, i.product_name, p.name), '; ') into bad
    from public.order_items i join public.products p on p.id = i.product_id
   where i.product_name is distinct from p.name;
  if bad is not null then raise exception 'order lines named differently from their product: %', bad; end if;

  /* ASSERT-4: and the function will not write another one. Checked in the
     source, because reproducing it needs an approved requisition on an account
     inside its credit limit, and this has to hold whether or not one exists
     today. */
  select pg_get_functiondef(p.oid) into v_body from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'place_requisition_order';
  if v_body like '%oid, prod.id, req.title%' then
    raise exception 'place_requisition_order still names the line after the requisition';
  end if;
  if v_body not like '%oid, prod.id, prod.name%' then
    raise exception 'place_requisition_order does not name the line after the product';
  end if;

  /* ASSERT-5: and the quantity is still recorded where it belongs, rather than
     having been the only place the ×6 was written down. */
  select count(*) into n from public.order_items where quantity is null or quantity < 1;
  if n <> 0 then raise exception '% order lines do not say how many were bought', n; end if;
end $$;
