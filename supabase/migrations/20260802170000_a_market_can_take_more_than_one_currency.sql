-- A market had exactly one currency, and that is not how these markets work.
--
-- `markets.currency` is a single column, so Kenya was KES and nothing else.
-- In practice a Kenyan customer may be quoted in shillings or in dollars, a
-- customer in the UAE in dirhams or dollars, and an Indian customer only ever
-- in rupees — Indian exchange control makes domestic dollar invoicing the
-- exception rather than the norm, so one currency there is right rather than a
-- simplification.
--
-- So which currencies a market accepts becomes a table the operator configures,
-- and `markets.currency` keeps its meaning as *the default* — what a shopper is
-- quoted before they choose otherwise.
--
-- Two sources of one fact is the thing to be careful about here: the default
-- lives both on `markets.currency` and as `is_default` in the new table. They
-- are tied together by a guard and asserted below, rather than left to be
-- remembered.
--
-- What does not change: tax. It follows the market, not the currency. A Kenyan
-- sale is VAT at 16% whether it is priced in shillings or dollars, and a bill
-- that says otherwise is a bill that cannot be filed.

/* ========================================= what a market will take money in === */

create table if not exists market_currencies (
  market_code text not null references markets(code) on delete cascade,
  currency    text not null references currencies(code),
  /* Exactly one per market — what a shopper sees before choosing. */
  is_default  boolean not null default false,
  sort_order  integer not null default 0,
  primary key (market_code, currency)
);

alter table market_currencies enable row level security;

drop policy if exists "market_currencies_read" on market_currencies;
drop policy if exists "market_currencies_operator" on market_currencies;

/* The storefront is public and has to price for a visitor who is not signed in. */
create policy "market_currencies_read" on market_currencies for select to anon, authenticated
  using (true);
create policy "market_currencies_operator" on market_currencies for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* ---------------------------------------------------- what they take today -- */

insert into market_currencies (market_code, currency, is_default, sort_order) values
  ('IN', 'INR', true,  1),
  ('AE', 'AED', true,  1),
  ('AE', 'USD', false, 2),
  ('KE', 'KES', true,  1),
  ('KE', 'USD', false, 2)
on conflict (market_code, currency) do update set
  is_default = excluded.is_default, sort_order = excluded.sort_order;

/* ============================================================= the guards === */

/* One default per market, always. Zero leaves a shopper with no price at all;
   two means the storefront picks whichever the query returned first, which is
   a price that changes between page loads. */
create or replace function guard_market_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer; code text;
begin
  code := coalesce(new.market_code, old.market_code);

  /* Setting a new default clears the old one, rather than refusing and making
     the operator do it in two steps in the right order. */
  if tg_op <> 'DELETE' and new.is_default then
    update market_currencies set is_default = false
     where market_code = new.market_code and currency <> new.currency and is_default;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end $$;

drop trigger if exists guard_market_currency_trg on market_currencies;
create trigger guard_market_currency_trg before insert or update on market_currencies
  for each row execute function guard_market_currency();

/* `markets.currency` follows the default rather than being set beside it. */
create or replace function sync_market_default()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update markets m set currency = mc.currency
    from market_currencies mc
   where mc.market_code = m.code and mc.is_default
     and m.code = coalesce(new.market_code, old.market_code);
  return null;
end $$;

drop trigger if exists sync_market_default_trg on market_currencies;
create trigger sync_market_default_trg after insert or update or delete on market_currencies
  for each statement execute function sync_market_default();

/* A market must not be left with nothing to trade in. */
create or replace function guard_market_currency_removal()
returns trigger language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  select count(*) into n from market_currencies where market_code = old.market_code;
  if n <= 1 then
    raise exception 'A market has to accept at least one currency.';
  end if;
  /* And nothing may be priced or billed in a currency the market no longer
     takes — the listings would still be on the shelf at a price nobody can
     pay. */
  select count(*) into n from consumer_bills
   where market = old.market_code and currency = old.currency;
  if n > 0 then
    raise exception 'There are % bills in % for this market. Removing the currency would orphan them.', n, old.currency;
  end if;
  return old;
end $$;

drop trigger if exists guard_market_currency_removal_trg on market_currencies;
create trigger guard_market_currency_removal_trg before delete on market_currencies
  for each row execute function guard_market_currency_removal();

/* ------------------------------------- a bill is in a currency its market takes -- */

/* Was: the bill's currency must equal the market's one currency. Now: it must
   be one the market accepts. Tax is unchanged — it follows the market, so a
   dollar-priced Kenyan sale is still VAT at 16%. */
create or replace function guard_bill_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare m record; ok boolean;
begin
  select * into m from markets where code = new.market;
  if m is null then raise exception 'A bill has to be raised in a market.'; end if;

  select exists (
    select 1 from market_currencies mc
     where mc.market_code = new.market and mc.currency = new.currency
  ) into ok;
  if not ok then
    raise exception 'A % bill cannot be in % — that market does not trade in it.', m.name, new.currency;
  end if;

  if new.tax_rate is distinct from m.tax_rate then
    raise exception 'A % bill is taxed at % percent (%), not % percent.',
      m.name, m.tax_rate, m.tax_label, new.tax_rate;
  end if;

  if new.fx_rate is null or new.fx_rate <= 0 then
    raise exception 'A bill records the rate it was converted at.';
  end if;

  return new;
end $$;

/* --------------------------------- and a seller prices in what their markets take -- */

drop policy if exists "product_prices_seller_write" on product_prices;
drop policy if exists "product_prices_seller_update" on product_prices;

create policy "product_prices_seller_write" on product_prices for insert to authenticated
  with check (
    exists (select 1 from products p
             where p.id = product_id and p.partner_id = current_partner_id())
    and currency in (
      select mc.currency from market_currencies mc
        join partner_markets pm on pm.market_code = mc.market_code
       where pm.partner_id = current_partner_id() and pm.state = 'approved')
  );

create policy "product_prices_seller_update" on product_prices for update to authenticated
  using (
    exists (select 1 from products p
             where p.id = product_id and p.partner_id = current_partner_id())
  )
  with check (
    exists (select 1 from products p
             where p.id = product_id and p.partner_id = current_partner_id())
    and currency in (
      select mc.currency from market_currencies mc
        join partner_markets pm on pm.market_code = mc.market_code
       where pm.partner_id = current_partner_id() and pm.state = 'approved')
  );

/* ================================== a dollar price for the markets that take one === */

/* Every product already carries a dollar figure on `products.price` — that is
   what the whole catalogue was seeded in. A market that accepts dollars needs
   that figure in the price book like any other, or a shopper who switches to
   USD in Nairobi meets a card with no price on it. It is the same number, so
   there is nothing to convert and nothing to charm-round. */
insert into product_prices (product_id, currency, price, was_price, floor_price, list_price)
select p.id, 'USD', p.price, p.was_price, p.floor_price, p.list_price
  from products p
 where p.price > 0
   and exists (
     select 1 from market_currencies mc
      where mc.currency = 'USD'
        and (p.partner_id is null or exists (
          select 1 from partner_markets pm
           where pm.partner_id = p.partner_id
             and pm.market_code = mc.market_code
             and pm.state = 'approved')))
on conflict (product_id, currency) do nothing;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Exactly one default per market. */
  select string_agg(x.market_code || ' (' || x.defaults || ')', ', ') into s from (
    select market_code, count(*) filter (where is_default) as defaults
      from market_currencies group by market_code
  ) x where x.defaults <> 1;
  if s is not null then raise exception 'these markets do not have exactly one default currency: %', s; end if;

  /* Every market accepts something. */
  select string_agg(m.code, ', ') into s from markets m
   where not exists (select 1 from market_currencies mc where mc.market_code = m.code);
  if s is not null then raise exception 'these markets accept no currency at all: %', s; end if;

  /* `markets.currency` is the default, and the trigger keeps it so. */
  select string_agg(m.code, ', ') into s
    from markets m
    join market_currencies mc on mc.market_code = m.code and mc.is_default
   where m.currency <> mc.currency;
  if s is not null then raise exception 'these markets disagree with their own default currency: %', s; end if;

  /* The specific arrangement asked for. Stated rather than assumed, because
     "Kenya takes dollars" is a business fact and a silent change to it would be
     a silent change to what customers can be charged. */
  if not exists (select 1 from market_currencies where market_code='KE' and currency='USD')
  then raise exception 'Kenya no longer accepts USD'; end if;
  if not exists (select 1 from market_currencies where market_code='AE' and currency='USD')
  then raise exception 'the UAE no longer accepts USD'; end if;
  if exists (select 1 from market_currencies where market_code='IN' and currency <> 'INR')
  then raise exception 'India accepts a currency other than the rupee'; end if;

  /* Every bill is in a currency its market takes — the guard enforces this
     going forward, and this is the state it inherits. */
  select string_agg(b.id, ', ') into s from consumer_bills b
   where not exists (select 1 from market_currencies mc
                      where mc.market_code = b.market and mc.currency = b.currency);
  if s is not null then raise exception 'these bills are in a currency their market does not take: %', s; end if;

  select string_agg(i.id, ', ') into s from enterprise_invoices i
   where not exists (select 1 from market_currencies mc
                      where mc.market_code = i.market and mc.currency = i.currency);
  if s is not null then raise exception 'these invoices are in a currency their market does not take: %', s; end if;

  /* Nothing is priced in a currency no market trades in. */
  select string_agg(distinct pp.currency, ', ') into s from product_prices pp
   where not exists (select 1 from market_currencies mc where mc.currency = pp.currency);
  if s is not null then raise exception 'these currencies are priced but sold nowhere: %', s; end if;

  /* A dollar-accepting market has dollar prices to show. */
  select count(*) into n from product_prices where currency = 'USD';
  if n < 20 then raise exception 'only % USD prices exist, so the USD storefront would be nearly empty', n; end if;
end $$;
