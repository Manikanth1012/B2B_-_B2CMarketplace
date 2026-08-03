-- Priya Raman is billed in rupees, dirhams and dollars, all at once.
--
-- Her bill history runs INR, INR, INR, INR, INR, then AED for June and July.
-- Her subscriptions are in USD. She lives in Bengaluru, her rewards are
-- Indian, her tax registration is Indian, and her plan is an Indian plan.
--
-- Both halves of that are mine.
--
-- The dirhams: `20260802130000_a_bill_is_in_a_currency.sql` moved her two most
-- recent bills into the UAE market to demonstrate multi-currency billing, and
-- wrote a comment claiming "the customer relocated". That story does not
-- survive the rest of her record. A relocation is one-way; this is June and
-- July in Dubai with May in India and nothing after. It also re-taxed those
-- two bills at 5% UAE VAT, so an Indian consumer's account carries two bills
-- charged under a tax authority she has never been registered with.
--
-- Multi-currency billing does need demonstrating, but not from the only retail
-- customer on the system. A business account with sites in two countries is a
-- coherent story and the enterprise side already carries it — one invoice in
-- Kenya, on an account that has Kenyan sites. That is where the demonstration
-- belongs.
--
-- The dollars: `subscriptions` has a `price` column and no currency column at
-- all, so it holds the catalogue's USD list price. The price book has had the
-- rupee price for every one of these products since
-- `20260802110000_prices_are_chosen_not_converted.sql` — the subscription rows
-- were simply never told to use it.

/* ============================================ her bills come home to India === */

do $$
declare
  inm      record;
  usdinr   numeric;
  aed_rate numeric;
  b        record;
  np numeric; ns numeric; no_ numeric; ntax numeric;
  moved integer := 0;
begin
  select * into inm from markets where code = 'IN';
  select f.rate into usdinr from fx_rates f
   where f.base = 'USD' and f.quote = 'INR' and f.as_of = '2026-08-01';
  select f.rate into aed_rate from fx_rates f
   where f.base = 'USD' and f.quote = 'AED' and f.as_of = '2026-08-01';

  for b in select * from consumer_bills where market = 'AE' loop
    /* The exact reverse of the conversion that put them there: back through
       dirhams to dollars, out to rupees. Each component is rounded first and
       the tax and total computed from the rounded figures — deriving them from
       the unrounded ones leaves a bill whose parts do not sum to its total by a
       paisa, which the table's own check constraint refuses, correctly. */
    np   := round((b.plan_charge   / aed_rate) * usdinr, 2);
    ns   := round((b.subscriptions / aed_rate) * usdinr, 2);
    no_  := round((b.oneoff        / aed_rate) * usdinr, 2);
    ntax := round((np + ns + no_) * inm.tax_rate / 100, 2);

    update consumer_bills set
      market = 'IN', currency = inm.currency,
      fx_rate = usdinr, fx_as_of = '2026-08-01',
      plan_charge = np, subscriptions = ns, oneoff = no_,
      tax_rate = inm.tax_rate, tax = ntax, total = np + ns + no_ + ntax
     where id = b.id;
    moved := moved + 1;
  end loop;

  raise notice 'brought % bills back to the Indian market', moved;
end $$;

/* ====================================== a subscription has a currency too === */

alter table subscriptions add column if not exists currency text references currencies(code);

comment on column subscriptions.currency is
  'What the customer is charged in. Must match the currency of their bills — a subscription is a line on one.';

/* Priced from the book rather than converted here. That is the whole rule of
   `product_prices`: a rupee price is one somebody chose, not one arrived at by
   multiplying a dollar figure by today''s rate. */
update subscriptions s set
  currency = b.currency,
  price = coalesce(
    (select pp.price from product_prices pp
      where pp.product_id = s.product_id and pp.currency = b.currency),
    s.price)
  from (
    select distinct on (user_id) user_id, currency
      from consumer_bills order by user_id, to_date(issued, 'DD Mon YYYY') desc
  ) b
 where b.user_id = s.user_id;

/* A customer with no bills yet still needs a currency, or the column is null
   on exactly the accounts a new customer would be looking at. The default
   market's is the honest answer for an account nobody has billed. */
update subscriptions set currency = (select currency from markets where is_default)
 where currency is null;

alter table subscriptions alter column currency set not null;

/* --------------------------------------------------------------- the guard -- */

/* A subscription in a currency the customer is not billed in cannot appear on
   their bill. RLS cannot express this — it filters rows, it does not compare a
   row being written against another table — so it is a trigger. */
create or replace function guard_subscription_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare billed text;
begin
  if current_persona() is null then return new; end if;

  select b.currency into billed from consumer_bills b
   where b.user_id = new.user_id
   order by to_date(b.issued, 'DD Mon YYYY') desc limit 1;

  /* Nothing billed yet is not a conflict — it is a new account. */
  if billed is null then return new; end if;

  if new.currency is distinct from billed then
    raise exception 'This account is billed in %, so a subscription cannot be priced in %.',
      billed, new.currency;
  end if;
  return new;
end $$;

drop trigger if exists guard_subscription_currency_trg on subscriptions;
create trigger guard_subscription_currency_trg before insert or update on subscriptions
  for each row execute function guard_subscription_currency();

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* The thing that was actually wrong: one account, more than one currency. */
  select string_agg(x.user_id::text || ' is billed in ' || x.currencies, '; ') into s
    from (
      select user_id, string_agg(distinct currency, ', ' order by currency) as currencies,
             count(distinct currency) as kinds
        from consumer_bills group by user_id
    ) x where x.kinds > 1;
  if s is not null then raise exception 'these customers are billed in more than one currency: %', s; end if;

  /* And every subscription agrees with the bills it will appear on. */
  select string_agg(sub.id || ' (' || sub.currency || ' vs ' || sub.billed || ')', '; ') into s
    from (
      select s2.id, s2.currency,
             (select b.currency from consumer_bills b where b.user_id = s2.user_id
               order by to_date(b.issued, 'DD Mon YYYY') desc limit 1) as billed
        from subscriptions s2
    ) sub
   where sub.billed is not null and sub.currency <> sub.billed;
  if s is not null then raise exception 'these subscriptions are priced against the wrong bill: %', s; end if;

  /* Priced from the book, so the figures are the ones somebody chose. A
     subscription still sitting on its dollar list price would fail this. */
  select string_agg(s2.id || ' ' || s2.product_name || ' = ' || s2.price, '; ') into s
    from subscriptions s2
    join product_prices pp on pp.product_id = s2.product_id and pp.currency = s2.currency
   where s2.price <> pp.price;
  if s is not null then raise exception 'these subscriptions disagree with the price book: %', s; end if;

  /* A plausibility check, not a self-consistent one. The rupee price of a
     mobile plan is in the hundreds or thousands; if these were still dollar
     figures relabelled INR they would be single or double digits, and every
     assertion above would still pass because each compares a row to itself. */
  select count(*) into n from subscriptions where currency = 'INR' and price < 50;
  if n > 0 then
    raise exception '% rupee subscriptions cost under 50 — these look like dollar prices wearing a rupee label', n;
  end if;

  /* Multi-currency billing is still demonstrated, on the side of the
     marketplace where it makes sense. Removing the retail excursion must not
     have removed the capability from the demo. */
  select count(distinct currency) into n from enterprise_invoices;
  if n < 2 then
    raise exception 'no business account is invoiced in a second currency, so multi-currency billing is no longer shown anywhere';
  end if;

  /* Every bill is still internally consistent after the conversion back. */
  select string_agg(b.id, ', ') into s from consumer_bills b
   where round(b.plan_charge + b.subscriptions + b.oneoff + b.tax, 2) <> round(b.total, 2);
  if s is not null then raise exception 'these bills no longer add up: %', s; end if;
end $$;
