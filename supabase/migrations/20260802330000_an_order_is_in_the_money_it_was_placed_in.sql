-- An order does not say what it is in, and a customer's are still in dollars.
--
-- `orders` has a subtotal, a tax and a total and no currency column at all. It
-- is the last money table on the marketplace without one — bills, invoices,
-- subscriptions, the reward ledger and wallets all carry theirs.
--
-- Which is how the basket ended up quoting $6.49 for a product the shelf beside
-- it prices at ₹549: the shelf reprices through `product_prices` and the basket
-- reads the base row, and nothing in between could tell that the two numbers
-- were in different money because neither number said.
--
-- `20260802290000_what_a_business_actually_spent.sql` says in a comment that the
-- consumer orders were "restated with her bills back in
-- `20260802210000_a_customer_is_billed_in_one_currency.sql`". They were not.
-- That migration moved her bills and her subscriptions and never touched
-- `orders`, and I excluded eight rows from a restatement on the strength of a
-- sentence I had written myself. They are done here.
--
-- Priced from the book, not converted. ₹14,999 for a Kestrel K7 is the figure
-- somebody chose; $389 at 87.42 is ₹34,008, which is not a price anybody lists.
-- The same rule that governs `product_prices` and, since
-- `20260802210000`, `subscriptions`.

/* ================================================== an order has a currency === */

alter table orders add column if not exists currency  text references currencies(code);
alter table orders add column if not exists market    text references markets(code);
alter table orders add column if not exists tax_rate  numeric;

comment on column orders.currency is
  'What the order was placed in. Frozen at checkout — a reprice later must not change what somebody already paid.';
comment on column orders.market is
  'Where it was placed, which decides the tax rate. Held with the order rather than looked up, for the same reason.';

/* Business orders were restated into the account's currency two migrations ago;
   they only need saying so. Retail orders belong to whoever placed them, and
   Priya is the only retail customer on the marketplace. */
update orders o set
  currency = a.currency,
  market   = case a.currency when 'INR' then 'IN' when 'KES' then 'KE' when 'AED' then 'AE' else 'IN' end
  from enterprise_accounts a
 where a.id = o.account_id and o.currency is null;

update orders o set
  currency = b.currency,
  market   = b.market
  from (
    select distinct on (user_id) user_id, currency, market
      from consumer_bills order by user_id, to_date(issued, 'DD Mon YYYY') desc
  ) b
 where b.user_id = o.user_id and o.account_id is null and o.currency is null;

/* A basket somebody left before they were billed anything still has to say what
   it is in. The default market's is the honest answer. */
update orders set
  currency = (select currency from markets where is_default),
  market   = (select code from markets where is_default)
 where currency is null;

update orders o set tax_rate = m.tax_rate from markets m where m.code = o.market and o.tax_rate is null;

alter table orders alter column currency set not null;
alter table orders alter column market   set not null;
alter table orders alter column tax_rate set not null;

/* ============================== the retail orders, priced from the book === */

do $$
declare o record; net numeric; n integer := 0;
begin
  for o in select * from orders where account_id is null loop
    /* Each line at the price the book lists in the order's own currency. A line
       naming a product the book does not price in it keeps what it had — and
       the assertion below refuses if any such line exists, so this is a
       fallback that should never fire. */
    update order_items i set price = coalesce(
      (select pp.price from product_prices pp
        where pp.product_id = i.product_id and pp.currency = o.currency),
      i.price)
     where i.order_id = o.id;

    /* Then the order from its own lines. Converting the total separately and
       rounding it is how an order stops equalling the items under it — which
       is the mistake `20260802320000_a_total_is_derived_from_its_parts.sql`
       exists to have caught once already.

       A shelf price includes tax. That is what the seeded orders say — every
       one of them has `sum(items) = total`, not `= subtotal` — and it is how a
       consumer price is quoted in all three of these markets. So the total
       comes from the lines and the split is worked back out of it.

       The one order that disagreed was written by the checkout code, which
       treats the shelf price as tax-exclusive and adds eighteen percent on top.
       Its tax came out as 40.224599999999995, which is the other half of the
       same bug. Both are fixed here and in `Checkout.tsx`. */
    select coalesce(sum(i.price * i.quantity), 0) into net
      from order_items i where i.order_id = o.id;
    if net = 0 then continue; end if;

    update orders set
      subtotal = round(net / (1 + o.tax_rate / 100), 2),
      tax      = net - round(net / (1 + o.tax_rate / 100), 2),
      discount = 0,
      total    = net
     where id = o.id;
    n := n + 1;
  end loop;

  raise notice 'repriced % retail orders from the book', n;
end $$;

/* --------------------------------------------------------------- the guard -- */

/* An order in a currency the customer is not billed in cannot become a bill.
   RLS cannot say it — it filters rows, it does not compare a row being written
   against another table. */
create or replace function guard_order_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare billed text; owed text;
begin
  if current_persona() is null then return new; end if;

  if new.account_id is not null then
    select a.currency into owed from enterprise_accounts a where a.id = new.account_id;
    if owed is not null and new.currency is distinct from owed then
      raise exception 'This account is invoiced in %, so an order cannot be placed in %.', owed, new.currency;
    end if;
    return new;
  end if;

  select b.currency into billed from consumer_bills b
   where b.user_id = new.user_id
   order by to_date(b.issued, 'DD Mon YYYY') desc limit 1;

  /* Nothing billed yet is a new customer, not a conflict. */
  if billed is null then return new; end if;

  if new.currency is distinct from billed then
    raise exception 'This account is billed in %, so an order cannot be placed in %.', billed, new.currency;
  end if;
  return new;
end $$;

drop trigger if exists guard_order_currency_trg on orders;
create trigger guard_order_currency_trg before insert or update on orders
  for each row execute function guard_order_currency();

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every order says what it is in, and agrees with what its owner is billed. */
  select string_agg(o.order_ref || ' in ' || o.currency || ', billed in ' || x.billed, '; ') into s
    from orders o
    join lateral (
      select coalesce(
        (select a.currency from enterprise_accounts a where a.id = o.account_id),
        (select b.currency from consumer_bills b where b.user_id = o.user_id
          order by to_date(b.issued, 'DD Mon YYYY') desc limit 1)) as billed
    ) x on true
   where x.billed is not null and o.currency <> x.billed;
  if s is not null then raise exception 'these orders are in the wrong money: %', s; end if;

  /* Every retail line is a price somebody chose rather than one arrived at by
     multiplying. This is the check that separates repricing from relabelling. */
  select string_agg(i.product_name || ' at ' || i.price || ' (book says '
                    || coalesce(pp.price::text, 'nothing') || ')', '; ') into s
    from order_items i
    join orders o on o.id = i.order_id
    left join product_prices pp on pp.product_id = i.product_id and pp.currency = o.currency
   where o.account_id is null and (pp.price is null or i.price <> pp.price);
  if s is not null then raise exception 'these order lines disagree with the price book: %', s; end if;

  /* And the order still equals the items under it — one convention for both
     personas now, which is the thing that was never true before: the seeded
     orders were tax-inclusive and the checkout wrote tax-exclusive ones beside
     them, and nothing compared the two. */
  select string_agg(o.order_ref || ': total ' || o.total || ' vs items ' || x.items, '; ') into s
    from orders o
    join lateral (select coalesce(sum(i.price * i.quantity), 0) as items
                    from order_items i where i.order_id = o.id) x on true
   where x.items > 0 and round(o.total, 2) <> round(x.items, 2);
  if s is not null then raise exception 'these orders disagree with their own items: %', s; end if;

  select string_agg(o.order_ref, ', ') into s from orders o
   where round(o.total, 2) <> round(o.subtotal + o.tax - o.discount, 2);
  if s is not null then raise exception 'these orders no longer add up: %', s; end if;

  /* Tax at the rate of the market it was placed in, not one rate for everybody.
     An 18% GST charged on a Kenyan order is the failure this column exists to
     make impossible. */
  select string_agg(o.order_ref || ': ' || o.tax || ' on ' || o.subtotal
                    || ' at ' || o.tax_rate || '%', '; ') into s
    from orders o
   where o.subtotal > 0 and abs(o.tax - round(o.subtotal * o.tax_rate / 100, 2)) > 1;
  if s is not null then raise exception 'these orders charge tax at a rate they do not name: %', s; end if;

  select string_agg(o.order_ref, ', ') into s
    from orders o join markets m on m.code = o.market where o.tax_rate <> m.tax_rate;
  if s is not null then raise exception 'these orders name a rate their market does not charge: %', s; end if;

  /* A plausibility check, not a self-consistent one. Every assertion above
     compares a row to itself and would pass on a dollar figure wearing a rupee
     label; a rupee order for a handset is in the thousands. */
  select count(*) into n from orders where currency = 'INR' and total < 100;
  if n > 0 then
    raise exception '% rupee orders come to under a hundred — these look like dollar figures wearing a rupee label', n;
  end if;

  /* And it had retail orders to check. Eight of them, which is the set the
     previous migration excluded on the strength of a comment. */
  select count(*) into n from orders where account_id is null;
  if n = 0 then raise exception 'no retail orders were found, so this checked nothing'; end if;
end $$;
