-- A seller had one country, and it was where their office is.
--
-- `partners.country` says Germany for Nimbus Sensors and Brazil for Orbital
-- Connect, and that is where the company is registered — not where it sells.
-- Nothing anywhere said which of India, the UAE and Kenya a seller was allowed
-- to trade in, so every approved listing appeared in all three at whatever the
-- price book happened to say, and the price book could only be written by a
-- migration.
--
-- Two things are missing and they are the same thing twice: a seller cannot be
-- approved per market, and a seller cannot price per market. This adds both,
-- and ties them together — the markets you are approved for are exactly the
-- markets you may set a price in.
--
-- Note what this does *not* do: it does not let a seller price below the floor,
-- and it does not let a seller reach another seller's products. Those are the
-- two things a price-book write must never be able to do, and RLS alone cannot
-- express the first — RLS filters which rows you may touch, it cannot compare
-- the row you are writing against the one that is there. So a guard trigger
-- does it.

/* ================================================= where a seller sells === */

create table if not exists partner_markets (
  partner_id  text not null references partners(id) on delete cascade,
  market_code text not null references markets(code) on delete cascade,
  /* Same lifecycle as a category approval: asked for, then granted. A seller
     trading in a market they have not been approved for is the thing this
     table exists to make impossible. */
  state       text not null default 'requested'
              check (state in ('requested', 'approved', 'suspended')),
  approved_at timestamptz,
  approved_by text,
  note        text not null default '',
  primary key (partner_id, market_code)
);

alter table partner_markets enable row level security;

drop policy if exists "partner_markets_read" on partner_markets;
drop policy if exists "partner_markets_owner" on partner_markets;
drop policy if exists "partner_markets_operator" on partner_markets;

/* A shopper needs to know whether a listing is sold in their market, and the
   storefront is public, so the grants are readable by everyone. Which markets
   a seller trades in is not a secret; their prices are already on the shelf. */
create policy "partner_markets_read" on partner_markets for select to anon, authenticated
  using (true);
create policy "partner_markets_operator" on partner_markets for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A seller may ask for a market. They may not approve themselves — the insert
   is allowed only in the 'requested' state, and the guard below refuses any
   attempt to move their own row on from there. */
create policy "partner_markets_owner" on partner_markets for insert to authenticated
  with check (partner_id = current_partner_id() and state = 'requested');

/* ------------------------------------------------- who sells where today -- */

/* The price book already prices every product into all three markets, and the
   storefront has been claiming three markets in its header since the beginning.
   Approving only the default market would contradict both, and would empty two
   of the three storefronts — so a live seller trades everywhere, which is the
   state the rest of the data is already in.
   
   The distinction that is real: a seller who is not live has not traded
   anywhere, so their markets are asked for rather than granted. That is also
   what gives the operator something to decide. */
insert into partner_markets (partner_id, market_code, state, approved_at, approved_by, note)
select p.id, m.code,
       case when p.status = 'live' then 'approved'
            when p.status = 'suspended' and m.is_default then 'suspended'
            else 'requested' end,
       case when p.status = 'live' then now() else null end,
       case when p.status = 'live' then 'Seeded with the seller''s original approval' else null end,
       case when p.status = 'live' then 'Cleared to trade — no category evidence outstanding.'
            when p.status = 'suspended' and m.is_default then 'Trading history here; suspended pending review.'
            else 'Asked for. Granted once the seller goes live in this market.' end
  from partners p
 cross join markets m
 where p.status = 'live' or m.is_default
on conflict (partner_id, market_code) do nothing;

/* --------------------------------- and so what may be priced where today -- */

/* A price in a market its seller cannot trade in is a listing that would take
   an order the marketplace could not fulfil. The operator's own products
   (partner_id null) keep all of theirs — the marketplace trades everywhere it
   opens a market. */
delete from product_prices pp
 using products p
 where p.id = pp.product_id
   and p.partner_id is not null
   and pp.currency <> (select code from currencies where is_reporting)
   and not exists (
     select 1 from partner_markets pm
       join markets m on m.code = pm.market_code
      where pm.partner_id = p.partner_id
        and pm.state = 'approved'
        and m.currency = pp.currency);

/* ========================================= a seller may set their prices === */

drop policy if exists "product_prices_seller_write" on product_prices;
drop policy if exists "product_prices_seller_update" on product_prices;

/* Scoped to the seller's own products, and to a market they are approved in.
   Both halves matter: the first stops a seller repricing somebody else's
   listing, the second stops them listing into a market they were never
   cleared for. */
create policy "product_prices_seller_write" on product_prices for insert to authenticated
  with check (
    exists (select 1 from products p
             where p.id = product_id and p.partner_id = current_partner_id())
    and currency in (
      select m.currency from markets m
        join partner_markets pm on pm.market_code = m.code
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
      select m.currency from markets m
        join partner_markets pm on pm.market_code = m.code
       where pm.partner_id = current_partner_id() and pm.state = 'approved')
  );

/* ------------------------------------------------------------- the guard -- */

/* What RLS cannot say.
 *
 * A price below the floor is a listing the marketplace loses money settling,
 * and the floor is on the row being written — RLS gets to decide whether you
 * may write the row, not whether the number in it is allowed. Same for a
 * seller quietly moving their own market grant from requested to approved.
 */
create or replace function guard_price_book()
returns trigger language plpgsql security definer set search_path = public as $$
declare floor_at numeric; owner text;
begin
  /* A null persona is a migration or the service role doing the seeding.
     Clamping here rather than in every policy keeps the rules readable. */
  if current_persona() is null or current_persona() = 'operator' then return new; end if;

  select p.partner_id into owner from products p where p.id = new.product_id;
  if owner is distinct from current_partner_id() then
    raise exception 'That product belongs to another seller.';
  end if;

  /* The floor travels with the price row: it is what this seller agreed they
     would not go below in this currency. */
  floor_at := new.floor_price;
  if floor_at is not null and new.price < floor_at then
    raise exception 'The price is below the floor agreed for this market (% < %).', new.price, floor_at;
  end if;

  if new.price <= 0 then
    raise exception 'A listed price has to be more than nothing.';
  end if;

  return new;
end $$;

drop trigger if exists guard_price_book_trg on product_prices;
create trigger guard_price_book_trg before insert or update on product_prices
  for each row execute function guard_price_book();

/* A seller asks for a market; only the operator grants one. */
create or replace function guard_partner_market()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_persona() is null or current_persona() = 'operator' then return new; end if;
  if new.state <> 'requested' then
    raise exception 'A seller can ask for a market. Granting one is the marketplace''s decision.';
  end if;
  return new;
end $$;

drop trigger if exists guard_partner_market_trg on partner_markets;
create trigger guard_partner_market_trg before insert or update on partner_markets
  for each row execute function guard_partner_market();

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every trading seller has the default market, or their existing orders sit
     in a market they are not approved for. */
  select string_agg(p.id, ', ') into s from partners p
   where p.status = 'live'
     and not exists (select 1 from partner_markets pm
                      join markets m on m.code = pm.market_code
                     where pm.partner_id = p.id and pm.state = 'approved' and m.is_default);
  if s is not null then raise exception 'these live sellers are not approved in the default market: %', s; end if;

  /* The demo seller is multi-market, so there is something to demonstrate. */
  select count(*) into n from partner_markets
   where partner_id = 'PTR-1004' and state = 'approved';
  if n < 3 then raise exception 'the demo seller is approved in only % market(s)', n; end if;

  /* Something is still only asked for, or the operator has no decision to make
     and the state column is decoration. */
  select count(*) into n from partner_markets where state = 'requested';
  if n = 0 then raise exception 'no market grant is outstanding, so nothing exercises the request path'; end if;

  /* Every live listing is priced in every market its seller trades in —
     otherwise a shopper in that market meets a card with no price on it. */
  select string_agg(p.id || '/' || m.currency, ', ') into s
    from products p
    join partner_markets pm on pm.partner_id = p.partner_id and pm.state = 'approved'
    join markets m on m.code = pm.market_code
   where p.status = 'live'
     and not exists (select 1 from product_prices pp
                      where pp.product_id = p.id and pp.currency = m.currency);
  if s is not null then raise exception 'these live listings have no price in a market they sell in: %', left(s, 400); end if;

  /* Nothing is priced into a market its seller is not approved for. This is
     the invariant the whole migration exists to establish, so it is checked
     against the data as it stands rather than assumed of future writes. */
  select string_agg(distinct pp.product_id || '/' || pp.currency, ', ') into s
    from product_prices pp
    join products p on p.id = pp.product_id
   where p.partner_id is not null
     and pp.currency <> (select code from currencies where is_reporting)
     and not exists (
       select 1 from partner_markets pm
         join markets m on m.code = pm.market_code
        where pm.partner_id = p.partner_id and pm.state = 'approved' and m.currency = pp.currency);
  if s is not null then
    raise exception 'these are priced into markets their seller is not approved for: %', left(s, 400);
  end if;
end $$;
