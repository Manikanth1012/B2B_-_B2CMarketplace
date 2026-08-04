-- Priya Raman is registered in Bengaluru and can place a dollar order in Kenya.
--
-- I did exactly that in a browser while testing `20260802430000`, and the order
-- was accepted: market KE, currency USD, taxed at Kenya's 16%. That migration
-- replaced "the currency of your last bill" with "a currency this market takes",
-- which was the right fix for the rule it was about — a market trading in two
-- currencies — and it left the other half unstated.
--
-- Both halves are needed and they are different questions:
--
--   which market may this buyer buy in?   the one they are registered in. A
--                                         customer in India is billed under
--                                         Indian GST by an Indian entity; they
--                                         do not become a Kenyan customer by
--                                         changing a dropdown.
--   which currency, within it?            any the market trades in. Kenya takes
--                                         shillings and dollars, so a Kenyan
--                                         customer may pay in either.
--
-- The first was never asked. `consumer_profile` holds a city and no market, and
-- `enterprise_accounts` holds "Karnataka, India" as prose — a place of supply
-- for the invoice, which no query can join on.
--
-- So a home market goes on both, derived from what the marketplace already
-- bills them under, and the order guard asks both questions instead of one.

/* ============================== where a buyer is registered === */

alter table consumer_profile   add column if not exists market text references markets(code);
alter table enterprise_accounts add column if not exists market text references markets(code);

comment on column consumer_profile.market is
  'Where this customer is registered. Decides which market they buy in and therefore which tax they pay — not a preference, and not changed by the storefront picker.';
comment on column enterprise_accounts.market is
  'Where this account contracts. Its place_of_supply in a form a query can join on; the invoices are raised under this market''s tax.';

/* From what they are already billed under, which is the fact that decides it —
   a customer invoiced under Indian GST is an Indian customer. */
update consumer_profile p set market = coalesce(
  (select b.market from consumer_bills b where b.user_id = p.user_id
    order by to_date(b.issued, 'DD Mon YYYY') desc limit 1),
  (select code from markets where is_default));

/* `place_of_supply` is prose — "Karnataka, India", "Dubai, UAE", "Nairobi,
   Kenya". Matched on the country at the end of it rather than parsed, and the
   assertion below refuses if any account is left without a market. */
update enterprise_accounts a set market = m.code
  from markets m
 where a.place_of_supply like '%' || m.name
    or (m.code = 'AE' and a.place_of_supply like '%UAE');

alter table consumer_profile   alter column market set not null;
alter table enterprise_accounts alter column market set not null;

/* ============================== the guard asks both questions === */

create or replace function guard_order_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare home text; owed text;
begin
  if current_persona() is null then return new; end if;

  if new.account_id is not null then
    select a.market, a.currency into home, owed from enterprise_accounts a where a.id = new.account_id;

    /* A company contracts in one place and is invoiced under its tax. Buying
       "in Kenya" would mean a Kenyan invoice, which is not what this account
       signed. */
    if home is not null and new.market is distinct from home then
      raise exception 'This account contracts in %, so an order cannot be placed in the % market.', home, new.market;
    end if;
    if owed is not null and new.currency is distinct from owed then
      raise exception 'This account is invoiced in %, so an order cannot be placed in %.', owed, new.currency;
    end if;
    return new;
  end if;

  /* An order that predates `20260802330000` has no market and is left alone
     rather than guessed at. */
  if new.market is null then return new; end if;

  select p.market into home from consumer_profile p where p.user_id = new.user_id;

  /* Nobody registered is a signed-out basket or a new account, not a conflict. */
  if home is not null and new.market is distinct from home then
    raise exception 'This customer is registered in %, so an order cannot be placed in the % market.', home, new.market;
  end if;

  /* And within their own market, any currency it trades in. */
  if not market_takes(new.market, new.currency) then
    raise exception 'The % market does not trade in %. It takes %.',
      new.market, new.currency,
      (select string_agg(mc.currency, ' or ' order by mc.sort_order)
         from market_currencies mc where mc.market_code = new.market);
  end if;
  return new;
end $$;

/* ---------------------------------------------- what a buyer may be quoted -- */

/* Asked by the screens as well as by the guard, so the picker can offer exactly
   what checkout will accept rather than offering more and failing later. That
   mismatch is the bug `20260802430000` fixed in the other direction, and one
   function both sides read is how it stops recurring. */
create or replace function currencies_for_market(market_code text)
returns table (currency text, is_default boolean) language sql stable
set search_path = public as $$
  select mc.currency, mc.is_default
    from market_currencies mc
   where mc.market_code = currencies_for_market.market_code
   order by mc.is_default desc, mc.sort_order;
$$;

comment on function currencies_for_market(text) is
  'What a buyer registered in this market may pay in. The picker offers these and the order guard accepts these — one answer, so the two cannot drift.';

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every buyer has a market, and it is one that exists. */
  select string_agg(id, ', ') into s from consumer_profile
   where market is null or not exists (select 1 from markets m where m.code = market);
  if s is not null then raise exception 'these customers have no usable market: %', s; end if;

  select string_agg(id || ' (' || place_of_supply || ')', '; ') into s
    from enterprise_accounts
   where market is null or not exists (select 1 from markets m where m.code = market);
  if s is not null then raise exception 'these accounts have no usable market: %', s; end if;

  /* And it agrees with the prose it was derived from — the check that catches a
     `like` pattern matching the wrong row. */
  select string_agg(a.id || ': ' || a.place_of_supply || ' became ' || m.name, '; ') into s
    from enterprise_accounts a join markets m on m.code = a.market
   where a.place_of_supply not like '%' || m.name
     and not (m.code = 'AE' and a.place_of_supply like '%UAE');
  if s is not null then raise exception 'these accounts were placed in the wrong market: %', s; end if;

  /* A buyer's market trades in the currency they are billed in. An account
     invoiced in dirhams whose market does not take dirhams cannot be billed. */
  select string_agg(a.id || ' billed in ' || a.currency || ' from ' || a.market, '; ') into s
    from enterprise_accounts a where not market_takes(a.market, a.currency);
  if s is not null then raise exception 'these accounts are billed in money their market does not take: %', s; end if;

  select string_agg(p.id || ' billed in ' || p.currency || ' from ' || p.market, '; ') into s
    from consumer_profile p where not market_takes(p.market, p.currency);
  if s is not null then raise exception 'these customers are billed in money their market does not take: %', s; end if;

  /* Every order already on file was placed in its buyer's own market. If this
     fires, the guard is about to start refusing something that exists. */
  select string_agg(o.order_ref || ': ' || o.market || ' vs ' || x.home, '; ') into s
    from orders o
    join lateral (
      select coalesce(
        (select a.market from enterprise_accounts a where a.id = o.account_id),
        (select p.market from consumer_profile p where p.user_id = o.user_id)) as home
    ) x on true
   where x.home is not null and o.market is distinct from x.home;
  if s is not null then raise exception 'these orders were placed outside their buyer''s market: %', s; end if;

  /* The picker and the guard agree, asked the same way. */
  select string_agg(m.code || ': picker offers ' || coalesce(x.offered, 'nothing'), '; ') into s
    from markets m
    join lateral (select string_agg(currency, ',') as offered from currencies_for_market(m.code)) x on true
   where x.offered is null;
  if s is not null then raise exception 'these markets offer a buyer nothing to pay in: %', s; end if;

  /* Floors. */
  select count(*) into n from consumer_profile;
  if n = 0 then raise exception 'no customers were found, so this checked nothing'; end if;
  select count(distinct market) into n from enterprise_accounts;
  if n < 3 then raise exception 'the accounts sit in only % markets, so this checked almost nothing', n; end if;
end $$;
