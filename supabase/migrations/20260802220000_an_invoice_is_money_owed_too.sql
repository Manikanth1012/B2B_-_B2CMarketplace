-- `guard_market_currency_removal` counts consumer bills and not business invoices.
--
-- The rule it enforces is "do not leave money owed in a currency this market no
-- longer trades in". It looks in `consumer_bills` and stops there, so a market
-- could be closed to a currency that half a dozen business invoices are
-- denominated in, and the invoices would simply be orphaned.
--
-- `currencyFootprint` on the client already counts both, and tells the operator
-- so before they click. That is the drift the integration suite is for: the
-- form was refusing what the database would have allowed, which is the less
-- dangerous direction of the same disagreement but still a disagreement.
--
-- Found because the previous migration brought a retail customer's two UAE
-- bills home to India, which left the test with no market/currency pair
-- carrying money — and it says so and fails rather than passing vacuously.

create or replace function guard_market_currency_removal()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from market_currencies where market_code = old.market_code;
  if n <= 1 then
    raise exception 'A market has to accept at least one currency.';
  end if;

  /* Nothing may be billed in a currency the market no longer takes — retail or
     business. Both are money somebody has been asked to pay. */
  select
    (select count(*) from consumer_bills
      where market = old.market_code and currency = old.currency)
    + (select count(*) from enterprise_invoices
        where market = old.market_code and currency = old.currency)
    into n;

  if n > 0 then
    raise exception
      'There are % bills or invoices in % for this market. Removing the currency would orphan them.',
      n, old.currency;
  end if;

  return old;
end $$;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; kes_removable boolean;
begin
  /* The guard's own rule, exercised rather than assumed: Kenya is invoiced in
     shillings, so shillings must not be removable from Kenya. It is also the
     default there, which the caller checks separately — this asserts the money
     reason specifically, by counting what the guard counts. */
  select
    (select count(*) from consumer_bills where market = 'KE' and currency = 'KES')
    + (select count(*) from enterprise_invoices where market = 'KE' and currency = 'KES')
    into n;
  if n = 0 then
    raise exception 'nothing is billed in KES in Kenya, so the guard has nothing to protect there';
  end if;

  /* And the hole that was there: the same count restricted to consumer bills
     alone sees none of it, which is what the old guard was doing. */
  select count(*) into n from consumer_bills where market = 'KE' and currency = 'KES';
  if n > 0 then
    raise exception 'a consumer bill in KES now exists, so this no longer demonstrates the gap';
  end if;
end $$;
