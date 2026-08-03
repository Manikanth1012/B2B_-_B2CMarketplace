-- The account is in rupees and everything it bought is still in dollars.
--
-- Two migrations ago `enterprise_accounts.currency` became INR, KES and AED —
-- derived from the invoices, which have been in those currencies since
-- `20260802130000_a_bill_is_in_a_currency.sql`. The screens follow the account
-- now, so Approvals draws a ₹2,000 threshold and Orders draws a ₹1,128 order,
-- and both of those figures are the dollar ones with a rupee mark in front.
--
-- Which is the mistake this project has already undone once, on a retail
-- customer's bills. Relabelling is not converting. So this restates what is
-- underneath:
--
--   requisitions and their lines     what somebody asked to buy
--   orders and their items           what was actually bought
--   subscriptions                    what is committed each month
--   cost centre caps and spend       what a department may spend, and has
--   the approval threshold           the figure above which finance signs
--
-- Two kinds of number, handled differently, which is the whole distinction this
-- codebase keeps returning to:
--
--   *measured* — an order total, a requisition amount, spend to date. Somebody
--   really spent this, so it converts at the rate in force and lands wherever
--   it lands.
--
--   *chosen* — an approval threshold, a quarterly cap. A finance team agrees
--   ₹2,00,000, not the ₹1,74,840 that $2,000 converts to. Written out below,
--   one per account, so each is a figure a person would recognise.
--
-- The invoices are already right and are not touched. Neither are the consumer
-- orders: seven of the fifteen rows in `orders` have no account, and those are
-- Priya's — restated with her bills back in
-- `20260802210000_a_customer_is_billed_in_one_currency.sql`.

/* =========================================== what was measured, converted === */

do $$
declare
  a    record;
  fx   numeric;
  n    integer := 0;
begin
  for a in select * from enterprise_accounts loop
    if a.currency = 'USD' then continue; end if;

    select f.rate into fx from fx_rates f
     where f.base = 'USD' and f.quote = a.currency and f.as_of <= '2026-08-01'
     order by f.as_of desc limit 1;
    if fx is null then raise exception 'no USD->% rate on file', a.currency; end if;

    /* Whole local units throughout. Nobody quotes paise on a requisition, and
       carrying two decimals of a converted figure implies a precision the
       conversion does not have.

       The lines first, then the requisition from its own lines. Converting both
       independently rounds them apart — the first attempt at this produced six
       requisitions whose stated amount was a few rupees off what they add up
       to, and the assertion at the foot caught every one. A total is derived
       from its parts or it is not a total. */
    update enterprise_requisition_lines l set
      unit_price = round(l.unit_price * fx),
      line_total = round(l.unit_price * fx) * l.quantity
      from enterprise_requisitions r
     where r.id = l.requisition_id and r.account_id = a.id;

    update enterprise_requisitions r set amount = coalesce(
      (select sum(l.line_total) from enterprise_requisition_lines l where l.requisition_id = r.id),
      round(r.amount * fx))
     where r.account_id = a.id;

    update enterprise_subscriptions s set
      currency   = a.currency,
      unit_price = round(s.unit_price * fx),
      monthly    = round(s.unit_price * fx) * s.quantity
     where s.account_id = a.id;

    update orders set
      subtotal = round(subtotal * fx),
      tax      = round(tax * fx),
      discount = round(discount * fx),
      total    = round(subtotal * fx) + round(tax * fx) - round(discount * fx)
     where account_id = a.id;

    /* `order_items` names the order by its row id rather than its reference,
       and carries one price rather than a unit price and a line total. */
    update order_items i set price = round(i.price * fx)
      from orders o
     where o.id = i.order_id and o.account_id = a.id;

    /* Spend to date is measured. The cap it is measured against is not, and is
       set below. */
    update enterprise_cost_centres c set spent_quarter = round(c.spent_quarter * fx)
     where c.account_id = a.id;

    n := n + 1;
  end loop;

  raise notice 'restated the spend of % accounts', n;
end $$;

/* ================================================ what was chosen, chosen === */

/* A department's quarterly cap. Round local figures near what the dollar ones
   came to, and every one still above what that department has already spent —
   asserted below, because a cap under its own spend is a cap nobody set. */
update enterprise_cost_centres set cap_quarter = v.cap
  from (values
    ('CC-2200', 2500000.00),  -- IT and infrastructure, ₹25 lakh  (was $30,000)
    ('CC-4100', 1500000.00),  -- Logistics,             ₹15 lakh  (was $18,000)
    ('CC-1000', 1000000.00),  -- Corporate,             ₹10 lakh  (was $12,000)
    /* Deliberately tight. Retail estate has always sat at 99% of its cap —
       it is the one `centresAtRisk` picks up, and a rounder ₹6 lakh would give
       it fifteen percent of headroom and quietly remove the thing this screen
       exists to show. */
    ('CC-RETAIL', 525000.00)  -- Retail estate,         ₹5.25 lakh (was $6,000)
  ) as v(id, cap)
 where enterprise_cost_centres.id = v.id;

/* The figure above which finance has to sign. Chosen per account, in the money
   that account is invoiced in. */
update enterprise_approval_policy set threshold = v.threshold
  from (values
    ('ENT-2007', 200000.00),  -- SmartBuild Ltd,      ₹2,00,000    (was $2,000)
    ('ENT-2011', 400000.00),  -- Brightline Foods,    ₹4,00,000    (was $5,000)
    ('ENT-2012',  10000.00),  -- Meridian Foods,      AED 10,000   (was $2,500)
    ('ENT-2013', 150000.00),  -- Greencity Estates,   ₹1,50,000    (was $1,500)
    ('ENT-2014', 130000.00)   -- Harbourpoint Retail, KSh 130,000  (was $1,000)
  ) as v(id, threshold)
 where enterprise_approval_policy.account_id = v.id;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every line still adds to the requisition above it. Converting a total and
     its lines independently is how the two stop agreeing. */
  select string_agg(r.id || ': says ' || r.amount || ', lines add to ' || x.lines, '; ') into s
    from enterprise_requisitions r
    join lateral (select coalesce(sum(l.line_total), 0) as lines
                    from enterprise_requisition_lines l where l.requisition_id = r.id) x on true
   where x.lines > 0 and round(r.amount) <> round(x.lines);
  if s is not null then raise exception 'these requisitions no longer add up: %', s; end if;

  /* And every order still equals its own parts. */
  select string_agg(o.order_ref || ': ' || o.total || ' vs ' || (o.subtotal + o.tax - o.discount), '; ') into s
    from orders o where round(o.total, 2) <> round(o.subtotal + o.tax - o.discount, 2);
  if s is not null then raise exception 'these orders no longer add up: %', s; end if;

  /* A cap below what has already been spent against it is not a cap. */
  select string_agg(c.id || ': cap ' || c.cap_quarter || ', spent ' || c.spent_quarter, '; ') into s
    from enterprise_cost_centres c where c.spent_quarter > c.cap_quarter;
  if s is not null then raise exception 'these cost centres are over their own cap: %', s; end if;

  /* A threshold above every requisition the account has ever raised means the
     approval flow this account is built to demonstrate never fires. */
  select string_agg(p.account_id || ': threshold ' || p.threshold, '; ') into s
    from enterprise_approval_policy p
    join lateral (select coalesce(max(r.amount), 0) as biggest
                    from enterprise_requisitions r where r.account_id = p.account_id) x on true
   where x.biggest > 0 and p.threshold > x.biggest;
  if s is not null then raise exception 'these thresholds are above every requisition on the account: %', s; end if;

  /* The plausibility check. A relabelled figure passes every assertion above,
     because each compares a row to itself — this one compares the row to what a
     rupee figure looks like. */
  select count(*) into n from enterprise_requisitions r
    join enterprise_accounts a on a.id = r.account_id
   where a.currency = 'INR' and r.amount < 5000;
  if n > 0 then
    raise exception '% rupee requisitions are under five thousand — these look like dollar figures wearing a rupee label', n;
  end if;

  select count(*) into n from enterprise_subscriptions s
    join enterprise_accounts a on a.id = s.account_id
   where a.currency = 'INR' and s.monthly < 1000;
  if n > 0 then
    raise exception '% rupee subscriptions cost under a thousand a month — same problem', n;
  end if;

  /* The consumer orders were not in scope and must not have moved. Seven rows
     with no account, and Priya's basket is small. */
  select count(*) into n from orders where account_id is null;
  if n <> 7 then raise exception 'the consumer orders changed count: % rather than 7', n; end if;

  select count(*) into n from orders where account_id is null and total > 10000;
  if n > 0 then raise exception '% consumer orders were restated by mistake', n; end if;

  /* And every subscription now says what it is in. */
  select string_agg(s.id, ', ') into s from enterprise_subscriptions s where s.currency is null;
  if s is not null then raise exception 'these subscriptions say nothing about their currency: %', s; end if;
end $$;
