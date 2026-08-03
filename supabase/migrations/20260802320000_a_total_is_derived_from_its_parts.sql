-- Two things the last migration converted twice, and one it rounded apart.
--
-- `20260802290000_what_a_business_actually_spent.sql` restated the business
-- account's spend from dollars into rupees. Three of its results were wrong, and
-- the integration suite caught all three — which is the only reason this is a
-- correction rather than a discovery six weeks from now.
--
--   `enterprise_subscriptions` was already in rupees. The invoice lines behind
--   it have been since `20260802130000_a_bill_is_in_a_currency.sql`, and the
--   suite asserts that the recurring invoice equals what the account holds.
--   Converting again put ₹1,07,299 a seat on a service the invoice bills at
--   ₹825.55 — eighty-seven times over, on a table I never checked was still in
--   dollars before deciding it was.
--
--   `orders` and `order_items` were each converted and each rounded, so the
--   items stopped adding to the order above them — and where an order came from
--   a requisition, the order and the requisition stopped agreeing too. Fifteen
--   rupees apart on one, a hundred and twenty-two on another.
--
-- The rule both breakages come back to, and the reason the fix is shaped this
-- way: a total is derived from its parts. Convert the parts and compute the
-- total, or convert the total and apportion it. Converting both and rounding
-- each is how they drift, and it drifts silently because every figure on its own
-- still looks right.

/* ================================ subscriptions come from their own lines === */

/* Set from the recurring invoice rather than divided back out. Dividing by the
   rate would not restore what was there — the conversion rounded, and rounding
   does not have an inverse. The invoice is the record of what these actually
   cost, so it is the thing to read. */
update enterprise_subscriptions s set
  unit_price = l.unit_price,
  monthly    = l.amount
  from enterprise_invoice_lines l
  join enterprise_invoices i on i.id = l.invoice_id
  join enterprise_accounts a on a.id = i.account_id
 where l.subscription_id = s.id
   and l.kind = 'subscription'
   and i.kind = 'recurring'
   and i.currency = a.currency
   and i.issued = (select max(i2.issued) from enterprise_invoices i2
                    where i2.account_id = i.account_id and i2.kind = 'recurring'
                      and i2.currency = a.currency);

/* ===================================== an order equals the items under it === */

do $$
declare
  o    record;
  paid numeric;
  rate numeric;
  net  numeric;
begin
  for o in
    select ord.*, m.tax_rate
      from orders ord
      join enterprise_accounts a on a.id = ord.account_id
      join markets m on m.currency = a.currency and m.is_default = false or m.code = (
        case when a.currency = 'INR' then 'IN' when a.currency = 'KES' then 'KE'
             when a.currency = 'AED' then 'AE' else 'US' end)
     where ord.account_id is not null
  loop
    select coalesce(sum(i.price * i.quantity), 0) into paid
      from order_items i where i.order_id = o.id;
    if paid = 0 then continue; end if;

    /* The items are what was charged, tax included — which is what the suite
       checks them against. So the total comes from them, and the split behind it
       is worked back out at the rate that applied. */
    rate := o.tax_rate / 100.0;
    net  := round(paid / (1 + rate));

    update orders set
      subtotal = net,
      tax      = paid - net,
      discount = 0,
      total    = paid
     where id = o.id;
  end loop;
end $$;

/* And a requisition agrees with the order it became. Both are now derived from
   their own lines, and the two sets of lines are the same products at the same
   prices, so this is a check rather than a correction. */

/* -------------------------------------------------------- sanity checks -- */
do $$
declare s text; n integer; total numeric; billed numeric;
begin
  /* The one the suite failed on: the recurring invoice bills exactly what the
     account holds. */
  select coalesce(sum(s2.monthly), 0) into total
    from enterprise_subscriptions s2 where s2.account_id = 'ENT-2007';
  select i.recurring into billed from enterprise_invoices i
   where i.account_id = 'ENT-2007' and i.kind = 'recurring' and i.currency = 'INR'
   order by i.issued desc limit 1;
  if round(total, 2) <> round(billed, 2) then
    raise exception 'the account holds % a month and is invoiced % — these have to be the same number', total, billed;
  end if;

  /* Every order equals the items under it. */
  select string_agg(o.order_ref || ': total ' || o.total || ', items ' || x.items, '; ') into s
    from orders o
    join lateral (select coalesce(sum(i.price * i.quantity), 0) as items
                    from order_items i where i.order_id = o.id) x on true
   where x.items > 0 and round(o.total, 2) <> round(x.items, 2);
  if s is not null then raise exception 'these orders disagree with their own items: %', s; end if;

  /* And still equals its own parts. */
  select string_agg(o.order_ref, ', ') into s from orders o
   where round(o.total, 2) <> round(o.subtotal + o.tax - o.discount, 2);
  if s is not null then raise exception 'these orders no longer add up: %', s; end if;

  /* An order raised from a requisition costs what the requisition said. */
  select string_agg(o.order_ref || ': ' || o.total || ' against ' || r.amount, '; ') into s
    from orders o join enterprise_requisitions r on r.id = o.requisition_id
   where round(o.total, 2) <> round(r.amount, 2);
  if s is not null then raise exception 'these orders disagree with the requisition that authorised them: %', s; end if;

  /* Plausibility, on the figures this migration put back. A rupee seat price in
     the hundreds is right; one in the hundred thousands is the double
     conversion this exists to undo. */
  select count(*) into n from enterprise_subscriptions s2
    join enterprise_accounts a on a.id = s2.account_id
   where a.currency = 'INR' and s2.unit_price > 50000;
  if n > 0 then
    raise exception '% rupee subscriptions cost over fifty thousand a seat — converted twice', n;
  end if;

  /* And it had orders to check. */
  select count(*) into n from orders where account_id is not null;
  if n = 0 then raise exception 'no business orders were found, so this checked nothing'; end if;
end $$;
