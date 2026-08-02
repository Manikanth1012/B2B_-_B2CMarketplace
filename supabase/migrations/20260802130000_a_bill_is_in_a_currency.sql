-- A bill said 18% GST and a dollar sign.
--
-- `consumer_bills` and `enterprise_invoices` carry a tax rate and four money
-- columns and say nothing about what currency any of it is in. The renderer
-- put a `$` in front. So a customer in Nairobi and a customer in Bengaluru
-- received the same document, in dollars, taxed at the Indian rate — and the
-- storefront had just started charging them in shillings and rupees.
--
-- A bill is a document about a transaction that already happened. Three things
-- have to travel with it, and all three have to be frozen at the moment it is
-- raised:
--
--   the market      — because that decides the tax and who levies it,
--   the currency    — because an amount without one is not a figure,
--   the rate used   — because the operator reports in dollars, and a bill
--                     re-converted at today's rate stops matching the payment
--                     that settled it.
--
-- The rate is stored on the row rather than looked up when the bill is opened.
-- That is the entire reason `fx_rates` has dates: `rateOn` finds the rate in
-- force on the issue date, and pinning it here means even that lookup cannot
-- drift once the row exists.

/* =================================================== what a bill is in === */

alter table consumer_bills
  add column if not exists market      text references markets(code),
  add column if not exists currency    text references currencies(code),
  add column if not exists fx_rate     numeric,
  add column if not exists fx_as_of    date;

alter table enterprise_invoices
  add column if not exists market      text references markets(code),
  add column if not exists currency    text references currencies(code),
  add column if not exists fx_rate     numeric,
  add column if not exists fx_as_of    date;

/* ------------------------------------------------------ what they were -- */

/* Every existing bill and invoice was raised under Indian GST at 18% — that is
   what `20260801870000` set and what `20260802100000` asserted the default
   market still charges. So they are Indian bills, and their amounts are
   rupees. Restating them as anything else would rewrite what was charged. */
update consumer_bills set
  market   = (select code from markets where is_default),
  currency = (select currency from markets where is_default)
 where market is null;

update enterprise_invoices set
  market   = (select code from markets where is_default),
  currency = (select currency from markets where is_default)
 where market is null;

/* The rate in force when each was issued, from the table, by date — the same
   rule `rateOn` applies in the client. `issued` is prose ("01 Apr 2026"), so it
   is parsed rather than cast — while `enterprise_invoices.issued` is a real
   date column and is used directly. Two tables that record the same fact in two
   types is its own small mess, and not one to clean up in a migration about
   currency.

   One deliberate difference from `rateOn`: a bill issued before the earliest
   recorded rate takes that earliest rate instead of nothing. In the client a
   missing rate means "do not silently convert"; here it would mean a NOT NULL
   column that cannot be filled and a bill the operator can never report on. The
   history predates the rate table, which is a fact about the seeding rather
   than about the bills. */
update consumer_bills b set
  fx_rate  = coalesce(
    (select f.rate from fx_rates f
      where f.base = 'USD' and f.quote = b.currency
        and f.as_of <= to_date(b.issued, 'DD Mon YYYY')
      order by f.as_of desc limit 1),
    (select f.rate from fx_rates f
      where f.base = 'USD' and f.quote = b.currency
      order by f.as_of asc limit 1)),
  fx_as_of = coalesce(
    (select f.as_of from fx_rates f
      where f.base = 'USD' and f.quote = b.currency
        and f.as_of <= to_date(b.issued, 'DD Mon YYYY')
      order by f.as_of desc limit 1),
    (select f.as_of from fx_rates f
      where f.base = 'USD' and f.quote = b.currency
      order by f.as_of asc limit 1))
 where b.fx_rate is null;

update enterprise_invoices i set
  fx_rate  = coalesce(
    (select f.rate from fx_rates f
      where f.base = 'USD' and f.quote = i.currency
        and f.as_of <= coalesce(i.issued, current_date)
      order by f.as_of desc limit 1),
    (select f.rate from fx_rates f
      where f.base = 'USD' and f.quote = i.currency
      order by f.as_of asc limit 1)),
  fx_as_of = coalesce(
    (select f.as_of from fx_rates f
      where f.base = 'USD' and f.quote = i.currency
        and f.as_of <= coalesce(i.issued, current_date)
      order by f.as_of desc limit 1),
    (select f.as_of from fx_rates f
      where f.base = 'USD' and f.quote = i.currency
      order by f.as_of asc limit 1))
 where i.fx_rate is null;

/* Now they can never be null again. A money row with no currency is the state
   this whole migration exists to end. */
alter table consumer_bills
  alter column market set not null,
  alter column currency set not null,
  alter column fx_rate set not null,
  alter column fx_as_of set not null;

alter table enterprise_invoices
  alter column market set not null,
  alter column currency set not null,
  alter column fx_rate set not null,
  alter column fx_as_of set not null;

/* ============================================== the tax follows the market == */

/* The rate was already 18 on every row; this ties it to the market that levies
   it rather than leaving the number floating. From here a Kenyan bill takes
   Kenyan VAT because it is a Kenyan bill, not because somebody remembered. */
create or replace function guard_bill_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare m record;
begin
  select * into m from markets where code = new.market;
  if m is null then raise exception 'A bill has to be raised in a market.'; end if;

  if new.currency is distinct from m.currency then
    raise exception 'A % bill is in %, not %.', m.name, m.currency, new.currency;
  end if;

  /* Tax is the market's, always. A bill carrying a rate the jurisdiction does
     not charge is a bill that cannot be filed. */
  if new.tax_rate is distinct from m.tax_rate then
    raise exception 'A % bill is taxed at %%% (%), not %%%.',
      m.name, m.tax_rate, m.tax_label, new.tax_rate;
  end if;

  if new.fx_rate is null or new.fx_rate <= 0 then
    raise exception 'A bill records the rate it was converted at.';
  end if;

  return new;
end $$;

drop trigger if exists guard_consumer_bill_currency on consumer_bills;
create trigger guard_consumer_bill_currency before insert or update on consumer_bills
  for each row execute function guard_bill_currency();

drop trigger if exists guard_enterprise_invoice_currency on enterprise_invoices;
create trigger guard_enterprise_invoice_currency before insert or update on enterprise_invoices
  for each row execute function guard_bill_currency();

/* ============================ something to look at in another currency === */

/* One customer's bills cannot demonstrate multi-currency billing while every
   one of them is a rupee bill. These are the same account's history moved on
   into the UAE — the customer relocated, which is an ordinary thing a telecom
   customer does, and it is the only way a single demo login can show a rupee
   bill and a dirham bill side by side.

   The amounts are converted at the rate in force and re-taxed at the UAE rate,
   because that is what the bill would have said. */
do $$
declare
  ae       record;
  usdinr   numeric;
  aed_rate numeric;
  b        record;
  np numeric; ns numeric; no_ numeric; ntax numeric;
  n integer := 0;
begin
  select * into ae from markets where code = 'AE';
  select f.rate into usdinr from fx_rates f
   where f.base = 'USD' and f.quote = 'INR' and f.as_of = '2026-08-01';
  select f.rate into aed_rate from fx_rates f
   where f.base = 'USD' and f.quote = 'AED' and f.as_of = '2026-08-01';

  for b in
    select * from consumer_bills
     where currency = (select currency from markets where is_default)
     order by to_date(issued, 'DD Mon YYYY') desc limit 2
  loop
    /* Each component is rounded first and the tax and total are computed from
       the rounded figures. Deriving them from the unrounded ones instead leaves
       a bill whose parts do not sum to its total by a cent — which the table's
       own check constraint refuses, correctly. */
    np   := round((b.plan_charge   / usdinr) * aed_rate, 2);
    ns   := round((b.subscriptions / usdinr) * aed_rate, 2);
    no_  := round((b.oneoff        / usdinr) * aed_rate, 2);
    ntax := round((np + ns + no_) * ae.tax_rate / 100, 2);

    update consumer_bills set
      market = 'AE', currency = ae.currency,
      fx_rate = aed_rate, fx_as_of = '2026-08-01',
      plan_charge = np, subscriptions = ns, oneoff = no_,
      tax_rate = ae.tax_rate, tax = ntax, total = np + ns + no_ + ntax
     where id = b.id;
    n := n + 1;
  end loop;

  if n = 0 then raise exception 'no consumer bill was moved to a second currency'; end if;
end $$;

/* And one business invoice, for the same reason on the enterprise side. */
do $$
declare
  ke       record;
  usdinr   numeric;
  kes_rate numeric;
  inv      record;
  nr numeric; no_ numeric; ntax numeric;
begin
  select * into ke from markets where code = 'KE';
  select f.rate into usdinr from fx_rates f where f.base='USD' and f.quote='INR' and f.as_of='2026-08-01';
  select f.rate into kes_rate from fx_rates f where f.base='USD' and f.quote='KES' and f.as_of='2026-08-01';

  select * into inv from enterprise_invoices
   where currency = (select currency from markets where is_default)
   order by issued desc limit 1;

  if inv is null then raise exception 'no business invoice to move to a second currency'; end if;

  nr   := round((inv.recurring / usdinr) * kes_rate, 2);
  no_  := round((inv.oneoff    / usdinr) * kes_rate, 2);
  ntax := round((nr + no_) * ke.tax_rate / 100, 2);

  update enterprise_invoices set
    market = 'KE', currency = ke.currency, fx_rate = kes_rate, fx_as_of = '2026-08-01',
    recurring = nr, oneoff = no_,
    tax_rate = ke.tax_rate, tax = ntax, total = nr + no_ + ntax
   where id = inv.id;
end $$;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every bill knows its currency, its market and the rate it was struck at. */
  select count(*) into n from consumer_bills
   where currency is null or market is null or fx_rate is null;
  if n > 0 then raise exception '% consumer bills are missing currency, market or rate', n; end if;

  select count(*) into n from enterprise_invoices
   where currency is null or market is null or fx_rate is null;
  if n > 0 then raise exception '% business invoices are missing currency, market or rate', n; end if;

  /* The currency is the market's, everywhere. */
  select string_agg(b.id, ', ') into s from consumer_bills b
    join markets m on m.code = b.market where b.currency <> m.currency;
  if s is not null then raise exception 'these bills are in the wrong currency for their market: %', s; end if;

  select string_agg(i.id, ', ') into s from enterprise_invoices i
    join markets m on m.code = i.market where i.currency <> m.currency;
  if s is not null then raise exception 'these invoices are in the wrong currency for their market: %', s; end if;

  /* The tax is the market's, everywhere. */
  select string_agg(b.id, ', ') into s from consumer_bills b
    join markets m on m.code = b.market where b.tax_rate <> m.tax_rate;
  if s is not null then raise exception 'these bills are taxed at a rate their market does not charge: %', s; end if;

  select string_agg(i.id, ', ') into s from enterprise_invoices i
    join markets m on m.code = i.market where i.tax_rate <> m.tax_rate;
  if s is not null then raise exception 'these invoices are taxed at a rate their market does not charge: %', s; end if;

  /* Every bill still adds up. Re-taxing at a new rate is exactly the operation
     most likely to leave a total that does not equal its parts. */
  select string_agg(id, ', ') into s from consumer_bills
   where abs((plan_charge + subscriptions + oneoff + tax) - total) > 0.02;
  if s is not null then raise exception 'these bills no longer add up: %', s; end if;

  select string_agg(id, ', ') into s from enterprise_invoices
   where abs((recurring + oneoff + tax) - total) > 0.02;
  if s is not null then raise exception 'these invoices no longer add up: %', s; end if;

  /* And the tax on each is the stated percentage of the net, or the rate on the
     face of the bill is decoration. */
  select string_agg(id, ', ') into s from consumer_bills
   where abs(tax - (plan_charge + subscriptions + oneoff) * tax_rate / 100) > 0.02;
  if s is not null then raise exception 'the tax on these is not what their own rate says: %', s; end if;

  /* There is more than one currency to look at, on both sides. That is the
     whole point of the exercise. */
  select count(distinct currency) into n from consumer_bills;
  if n < 2 then raise exception 'every consumer bill is still in one currency'; end if;
  select count(distinct currency) into n from enterprise_invoices;
  if n < 2 then raise exception 'every business invoice is still in one currency'; end if;
end $$;
