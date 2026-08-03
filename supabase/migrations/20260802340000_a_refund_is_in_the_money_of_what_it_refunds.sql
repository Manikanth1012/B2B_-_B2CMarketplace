-- A refund is in the money of the thing it refunds.
--
-- `refunds.currency` exists and says 'USD' on all twenty-three rows, including
-- the five against Priya Raman's orders — which, since
-- `20260802330000_an_order_is_in_the_money_it_was_placed_in.sql`, are in rupees.
-- So the marketplace currently holds a $389 refund against a ₹14,999 order and
-- nothing anywhere disagrees with itself loudly enough to notice.
--
-- The same is true of the enterprise side: RFN-3243 refunds two asset trackers
-- from ORD-882093, an order whose two lines come to ₹16,784, and the refund
-- says $192.
--
-- Restated by counting units, not by converting money. Every one of these
-- amounts is a whole number of somethings at a listed price — $624 is twelve
-- occupancy sensors at $52 — so the unit count survives the change of currency
-- and the price is looked up rather than multiplied. Converting $624 at 87.42
-- would give ₹54,550.08, which is twelve sensors at a price nobody lists.
--
-- Where the refund names an order we hold, the price comes from that order's
-- own line, not the book: an enterprise pays ₹4,546 for a sensor the shelf
-- prices at ₹4,499, and refunding the shelf price would hand back money that
-- was never taken.

/* ==================================================== what it is in === */

alter table refunds
  add constraint refunds_currency_fkey foreign key (currency) references currencies(code);

comment on column refunds.currency is
  'The money the refund is in — the order''s if we hold the order, otherwise the account''s or the member''s. Never converted at render.';

/* Four sources, most specific first. The order is the best answer because it is
   the transaction being unwound; the account and the loyalty member are what is
   left when the order predates the tables we keep. */
update refunds r set currency = coalesce(
    (select o.currency from orders o where o.order_ref = r.order_ref),
    (select a.currency from enterprise_accounts a where a.id = r.account_id),
    (select m.currency from loyalty_members m where m.name = r.customer),
    (select currency from markets where is_default));

alter table refunds alter column currency set not null;

/* ============================================ restated by the unit === */

do $$
declare
  r record;
  usd numeric;        -- what the line cost in the currency the row was written in
  unit numeric;       -- what one costs in the currency it is being restated to
  cap integer;        -- how many the order actually had, where we hold the order
  units integer;
  back integer;
  n integer := 0;
begin
  for r in select * from refunds order by id loop
    select pp.price into usd from product_prices pp
     where pp.product_id = r.product_id and pp.currency = 'USD';

    /* The order's own line first — a contract price is what was charged. */
    select i.price, i.quantity into unit, cap
      from order_items i
      join orders o on o.id = i.order_id
     where o.order_ref = r.order_ref and i.product_id = r.product_id
     limit 1;

    /* Otherwise the book, in the currency the refund is now in. */
    if unit is null then
      select pp.price into unit from product_prices pp
       where pp.product_id = r.product_id and pp.currency = r.currency;
      cap := null;
    end if;

    /* Nothing to price it from. The assertions below refuse if this leaves any
       row still holding a dollar figure, so this is a skip that should never
       fire rather than a silent pass. */
    if usd is null or usd = 0 or unit is null then continue; end if;

    units := greatest(round(r.amount / usd)::integer, 1);
    if cap is not null then units := least(units, cap); end if;

    if r.refunded is null then
      back := null;
    elsif r.state = 'refunded' then
      /* The check constraint says a refunded row returns the whole amount, so
         this is not a second calculation — it is the same one. */
      back := units;
    else
      back := greatest(round(r.refunded / usd)::integer, 1);
      /* A partial refund that came out equal to the whole would break
         `refunds_amount_check`, which is the constraint saying "partial" means
         something. Rounding is what could do that, so it is clamped here. */
      back := least(back, greatest(units - 1, 1));
    end if;

    update refunds set
      amount   = units * unit,
      refunded = case when back is null then null else back * unit end
     where id = r.id;
    n := n + 1;
  end loop;

  raise notice 'restated % refunds by the unit', n;
end $$;

/* ------------------------------------------------------------ the guard -- */

/* A refund cannot be raised in money the order was not placed in. RLS cannot
   say this — it narrows which rows a statement can see, it does not compare a
   row being written against another table. */
create or replace function guard_refund_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare owed text;
begin
  /* A null persona is a migration or the service role, which is allowed to
     restate history. */
  if current_persona() is null then return new; end if;

  select o.currency into owed from orders o where o.order_ref = new.order_ref;
  if owed is null and new.account_id is not null then
    select a.currency into owed from enterprise_accounts a where a.id = new.account_id;
  end if;
  if owed is null then return new; end if;

  if new.currency is distinct from owed then
    raise exception 'That order was placed in %, so it cannot be refunded in %.', owed, new.currency;
  end if;
  return new;
end $$;

drop trigger if exists guard_refund_currency_trg on refunds;
create trigger guard_refund_currency_trg before insert or update on refunds
  for each row execute function guard_refund_currency();

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every refund agrees with what it refunds. */
  select string_agg(r.id || ' in ' || r.currency || ', order in ' || o.currency, '; ') into s
    from refunds r join orders o on o.order_ref = r.order_ref
   where r.currency <> o.currency;
  if s is not null then raise exception 'these refunds are in the wrong money: %', s; end if;

  select string_agg(r.id || ' in ' || r.currency || ', account invoiced in ' || a.currency, '; ') into s
    from refunds r join enterprise_accounts a on a.id = r.account_id
   where r.currency <> a.currency;
  if s is not null then raise exception 'these refunds are not in their account''s money: %', s; end if;

  /* Every amount is a whole number of somethings at a price somebody chose —
     the check that separates restating from relabelling. A converted figure
     will not divide evenly into a listed price. */
  select string_agg(r.id || ': ' || r.amount || ' ' || r.currency
                    || ' at a unit of ' || x.unit, '; ') into s
    from refunds r
    join lateral (
      select coalesce(
        (select i.price from order_items i join orders o on o.id = i.order_id
          where o.order_ref = r.order_ref and i.product_id = r.product_id limit 1),
        (select pp.price from product_prices pp
          where pp.product_id = r.product_id and pp.currency = r.currency)) as unit
    ) x on true
   where x.unit is null or x.unit = 0
      or abs(r.amount - round(r.amount / x.unit) * x.unit) > 0.005;
  if s is not null then raise exception 'these refunds are not a whole number of units at a listed price: %', s; end if;

  /* Nothing is refunding more than the order came to. */
  select string_agg(r.id || ': ' || r.amount || ' against an order of ' || o.total, '; ') into s
    from refunds r join orders o on o.order_ref = r.order_ref
   where r.amount > o.total + 0.005;
  if s is not null then raise exception 'these refunds exceed the order they are against: %', s; end if;

  /* And the constraint that gives "partial" a meaning still holds. Written out
     rather than left to the CHECK because a migration that violates it fails
     with Postgres's sentence, not one that says which row and why. */
  select string_agg(r.id || ' is ' || r.state || ' with ' || coalesce(r.refunded::text, 'nothing')
                    || ' of ' || r.amount, '; ') into s
    from refunds r
   where (r.state = 'refunded' and r.refunded is distinct from r.amount)
      or (r.state = 'partial'  and not (r.refunded > 0 and r.refunded < r.amount))
      or (r.state not in ('refunded', 'partial') and r.refunded is not null);
  if s is not null then raise exception 'these refunds no longer say what state they are in: %', s; end if;

  /* A plausibility check. Every assertion above compares a row to itself and
     would pass on a dollar figure wearing a rupee label; a rupee refund for a
     handset is in the thousands. */
  select count(*) into n from refunds where currency = 'INR' and amount < 100;
  if n > 0 then
    raise exception '% rupee refunds come to under a hundred — these look like dollar figures wearing a rupee label', n;
  end if;

  /* And it had rows to check, in more than one currency — a sweep that finds
     one currency has not proved anything about the others. */
  select count(distinct currency) into n from refunds;
  if n < 3 then raise exception 'only % currencies among the refunds, so this checked almost nothing', n; end if;
end $$;
