-- Kenya trades in shillings and dollars, and the database says no.
--
-- `market_currencies` has said since `20260802120000` that Kenya accepts KES
-- and USD and the UAE accepts AED and USD. `MarketPicker` renders that as a
-- second row of chips — "Kenya trades in: KSh KES, $ USD" — and switching to
-- dollars reprices the whole shelf.
--
-- Then checkout fails. `guard_order_currency` compares the order against the
-- customer's most recent bill, so a Kenyan shopper who takes the choice the
-- picker offers is told "This account is billed in KES, so an order cannot be
-- placed in USD." The picker and the guard disagree about what the marketplace
-- permits, and the picker is the one telling the truth about the data.
--
-- `guard_subscription_currency` has the same fault, from the same migration and
-- for the same reason: both were written when a market had exactly one
-- currency, and both encode that as "your last bill" rather than as "what this
-- market takes".
--
-- The rule is the market's, not the last bill's. A market accepts a set of
-- currencies and an order has to be in one of them — which is a rule about the
-- transaction rather than about the customer's history, and is the one thing
-- `market_currencies` exists to state. A business is different and stays
-- different: an enterprise account is invoiced in one currency by contract, and
-- a buyer does not get to change that from a dropdown.

/* ============================ the gap in the price book === */

/* Every market×currency pair has a complete book except USD, which is missing
   one row. SKU-7003 is the partner API, free everywhere, and it was never given
   a dollar price because nothing ever asked for one — until a market started
   accepting dollars. Priced at zero like the other three, because it is free
   and not because a conversion said so. */
insert into product_prices (product_id, currency, price, was_price, floor_price, list_price)
select 'SKU-7003', 'USD', 0, null, null, null
 where not exists (
   select 1 from product_prices where product_id = 'SKU-7003' and currency = 'USD');

/* ============================ what a market will take === */

/* Named rather than inlined three times. A currency a market accepts, which is
   what both guards below and the assertions want to ask. */
create or replace function market_takes(market_code text, cur text)
returns boolean language sql stable set search_path = public as $$
  select exists (
    select 1 from market_currencies mc
     where mc.market_code = market_takes.market_code and mc.currency = market_takes.cur);
$$;

comment on function market_takes(text, text) is
  'Whether a market trades in a currency. The authority for what a shopper may be charged in — not the currency of their last bill, which was the rule before a market could take two.';

create or replace function guard_order_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare owed text;
begin
  if current_persona() is null then return new; end if;

  /* A business is invoiced in one currency by contract. That is not a shopper's
     choice and does not come from a dropdown, so this branch is unchanged. */
  if new.account_id is not null then
    select a.currency into owed from enterprise_accounts a where a.id = new.account_id;
    if owed is not null and new.currency is distinct from owed then
      raise exception 'This account is invoiced in %, so an order cannot be placed in %.', owed, new.currency;
    end if;
    return new;
  end if;

  /* Retail: the market decides. An order with no market on it predates
     `20260802330000` and is left alone rather than guessed at. */
  if new.market is null then return new; end if;

  if not market_takes(new.market, new.currency) then
    raise exception 'The % market does not trade in %. It takes %.',
      new.market, new.currency,
      (select string_agg(mc.currency, ' or ' order by mc.sort_order)
         from market_currencies mc where mc.market_code = new.market);
  end if;
  return new;
end $$;

/* A subscription has no market column — it is a recurring charge against a
   customer, not a transaction placed somewhere. So it takes the rule from the
   markets that accept its currency at all: a subscription priced in something
   no market trades in is the failure worth catching, and "your last bill" was
   never that rule, it was a proxy for it that stopped being true. */
create or replace function guard_subscription_currency()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_persona() is null then return new; end if;

  if not exists (select 1 from market_currencies mc where mc.currency = new.currency) then
    raise exception 'No market trades in %, so a subscription cannot be priced in it.', new.currency;
  end if;
  return new;
end $$;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text; ok boolean;
begin
  /* A market that accepts a currency has to have a price in it for everything
     it sells. Offering the choice and then showing a base-row fallback is the
     shape of bug that has no symptom — a plausible number in the wrong money. */
  select string_agg(x.market_code || '/' || x.currency || ': ' || x.missing || ' unpriced', '; ') into s
    from (
      select mc.market_code, mc.currency, count(*) filter (
               where not exists (select 1 from product_prices pp
                                  where pp.product_id = p.id and pp.currency = mc.currency)) as missing
        from market_currencies mc cross join products p
       where p.status = 'live'
       group by mc.market_code, mc.currency
    ) x
   where x.missing > 0;
  if s is not null then raise exception 'these market and currency pairs have an incomplete price book: %', s; end if;

  /* The guard now permits what the picker offers. Asserted as a positive —
     every accepted pair must be allowed — because a guard is trivially correct
     if it refuses everything, and every test written for one so far has only
     checked that it refuses. */
  select string_agg(mc.market_code || '/' || mc.currency, ', ') into s
    from market_currencies mc where not market_takes(mc.market_code, mc.currency);
  if s is not null then raise exception 'the guard refuses pairs the marketplace accepts: %', s; end if;

  /* And it still refuses what no market takes. A rule that permits everything
     is not a rule. */
  select market_takes('IN', 'AED') into ok;
  if ok then raise exception 'the guard permits rupee-market orders in dirhams, so it is not guarding anything'; end if;

  /* It had more than one market with more than one currency to check. */
  select count(*) into n from (
    select market_code from market_currencies group by market_code having count(*) > 1) x;
  if n < 2 then raise exception 'only % market trades in more than one currency, so this proved almost nothing', n; end if;

  /* Every currency a market accepts is a currency that exists and can be
     formatted. A market accepting a code with no row in `currencies` would
     render as the code itself and look like a bug in the formatter. */
  select string_agg(mc.currency, ', ') into s
    from market_currencies mc
   where not exists (select 1 from currencies c where c.code = mc.currency);
  if s is not null then raise exception 'these accepted currencies do not exist: %', s; end if;

  /* And every market has exactly one default, since that is what a shopper is
     quoted before they choose. */
  select string_agg(market_code || ' has ' || d, '; ') into s
    from (select market_code, count(*) filter (where is_default) as d
            from market_currencies group by market_code) x
   where d <> 1;
  if s is not null then raise exception 'these markets do not have exactly one default currency: %', s; end if;
end $$;
