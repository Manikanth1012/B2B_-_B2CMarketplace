-- "Two claims per year, ₹4,000 excess" is right in Bengaluru and wrong in Dubai.
--
-- `20260802370000` restated three product descriptions and a telco spec out of
-- dollars because they were quoting dollars at a rupee shelf. That fixed the
-- default market and broke the other two: `products.description` is one column
-- and this marketplace sells in three places, so any figure in it is correct in
-- at most one of them. The migration's own header recorded this as the
-- compromise it was; this is the other half.
--
-- The shape is the one `product_prices` already uses, and for the same reason.
-- A price is per currency because a price is chosen per market; a sum insured,
-- an excess and an overage rate are prices wearing prose, so they are chosen the
-- same way. ₹2 crore of travel cover is not AED 1,000,000 converted — it is what
-- an insurer in each market actually writes.
--
-- Copy falls back to `products.description` when there is no row, so the
-- forty-odd products that quote no figure need nothing and stay in one place.
-- Only prose with money in it has to be said three times, which is the smallest
-- set that can be right.

create table if not exists product_copy (
  product_id  text not null references products(id) on delete cascade,
  currency    text not null references currencies(code),
  description text not null,
  primary key (product_id, currency)
);

comment on table product_copy is
  'A product description per currency, for the ones that quote a figure. Falls back to products.description, so a description with no money in it needs no row. Chosen per market like a price, never converted.';

alter table product_copy enable row level security;

drop policy if exists product_copy_read on product_copy;
create policy product_copy_read on product_copy
  for select to anon, authenticated using (true);

/* The operator maintains the catalogue's own copy. A seller writing here would
   be rewriting a first-party description. */
drop policy if exists product_copy_write on product_copy;
create policy product_copy_write on product_copy
  for all to authenticated
  using (current_persona() = 'operator')
  with check (current_persona() = 'operator');

insert into product_copy (product_id, currency, description) values
  /* Travel cover. A sum insured is a figure an insurer in each market writes,
     not one number converted three ways — two crore, a million dirhams and
     thirty million shillings are each what that cover is sold at there. */
  ('SKU-2005', 'INR', 'Single-trip medical and baggage cover up to ₹2 crore, bought alongside a travel eSIM.'),
  ('SKU-2005', 'AED', 'Single-trip medical and baggage cover up to AED 1,000,000, bought alongside a travel eSIM.'),
  ('SKU-2005', 'KES', 'Single-trip medical and baggage cover up to KSh 30,000,000, bought alongside a travel eSIM.'),
  ('SKU-2005', 'USD', 'Single-trip medical and baggage cover up to $250,000, bought alongside a travel eSIM.'),

  /* Device protection. The excess is what the customer pays per claim. */
  ('SKU-2004', 'INR', 'Accidental damage, screen repair and theft cover for one handset. Two claims per year, ₹4,000 excess.'),
  ('SKU-2004', 'AED', 'Accidental damage, screen repair and theft cover for one handset. Two claims per year, AED 185 excess.'),
  ('SKU-2004', 'KES', 'Accidental damage, screen repair and theft cover for one handset. Two claims per year, KSh 6,500 excess.'),
  ('SKU-2004', 'USD', 'Accidental damage, screen repair and theft cover for one handset. Two claims per year, $50 excess.'),

  /* Pooled data. The overage rate is a price and is set per market. */
  ('SKU-FP9504', 'INR', '50 GB of pooled data shared across the whole estate, with 200 GB of in-country storage for what it reports. Overage runs at ₹95 a GB.'),
  ('SKU-FP9504', 'AED', '50 GB of pooled data shared across the whole estate, with 200 GB of in-country storage for what it reports. Overage runs at AED 4 a GB.'),
  ('SKU-FP9504', 'KES', '50 GB of pooled data shared across the whole estate, with 200 GB of in-country storage for what it reports. Overage runs at KSh 140 a GB.'),
  ('SKU-FP9504', 'USD', '50 GB of pooled data shared across the whole estate, with 200 GB of in-country storage for what it reports. Overage runs at $1.10 a GB.')
on conflict (product_id, currency) do update set description = excluded.description;

/* The base row stays as the fallback and stops naming a currency, since it is
   what a market with no copy would show. */
update products set description =
  'Single-trip medical and baggage cover, bought alongside a travel eSIM. The sum insured is set for your market.'
 where id = 'SKU-2005';
update products set description =
  'Accidental damage, screen repair and theft cover for one handset. Two claims per year, with an excess set for your market.'
 where id = 'SKU-2004';
update products set description =
  '50 GB of pooled data shared across the whole estate, with 200 GB of in-country storage for what it reports. Overage is charged per GB at the rate for your market.'
 where id = 'SKU-FP9504';

/* A technical spec should not carry a price at all — the rate belongs in the
   price book, and only one row of this table ever quoted one. */
update telco_catalogue set spec = '50 GB shared across the estate, with per-GB overage'
 where id = 'TP-IOT-POOL';

/* ================================ a promotion runs in a market === */

alter table operator_promotions add column if not exists market_code text references markets(code);

comment on column operator_promotions.market_code is
  'Where the offer runs. A promotion quotes an amount, and an amount is only right in one market — so the offer is scoped rather than the figure being hoped to travel.';

update operator_promotions p set market_code = m.code
  from markets m
 where m.currency = p.currency and p.market_code is null;

alter table operator_promotions alter column market_code set not null;

create or replace function guard_promotion_market()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_persona() is null then return new; end if;
  if not market_takes(new.market_code, new.currency) then
    raise exception 'The % market does not trade in %, so an offer there cannot be priced in it.',
      new.market_code, new.currency;
  end if;
  return new;
end $$;

drop trigger if exists guard_promotion_market_trg on operator_promotions;
create trigger guard_promotion_market_trg before insert or update on operator_promotions
  for each row execute function guard_promotion_market();

/* ============================== a banner that quotes a price === */

/* `region` is a comma-separated list of market names and three banners quote a
   figure. bn-008 runs in India and the UAE and says ₹299 a month, which is a
   rupee price shown to somebody who pays in dirhams. Narrowed to the market
   whose money it names, with a twin raised for the other. */
update operator_banners set region = 'India' where id = 'bn-008';

insert into operator_banners (
  id, slot, name, title, subtitle, cta, audience, region, device, weight,
  impressions, clicks, revenue, status, starts_at, ends_at, sort_order,
  destination, accent, currency)
select 'bn-008-ae', b.slot, b.name || ' (UAE)',
       'Add a second line for AED 15 a month', b.subtitle, b.cta, b.audience,
       'UAE', b.device, b.weight, 0, 0, 0, b.status, b.starts_at, b.ends_at,
       b.sort_order + 1, b.destination, b.accent, b.currency
  from operator_banners b where b.id = 'bn-008'
on conflict (id) do nothing;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every product whose base description still names a figure has copy in every
     currency its markets accept. Ranged over the products that exist and the
     currencies that are accepted, not over the three I happened to fix. */
  select string_agg(x.id || ' has no ' || x.currency || ' copy', '; ') into s
    from (
      select p.id, c.currency
        from products p
        cross join (select distinct currency from market_currencies) c
       where p.status = 'live'
         and exists (select 1 from product_copy pc where pc.product_id = p.id)
         and not exists (select 1 from product_copy pc
                          where pc.product_id = p.id and pc.currency = c.currency)
    ) x;
  if s is not null then raise exception 'these products have copy in some currencies and not others: %', s; end if;

  /* And no fallback description names a currency any more — that is the whole
     point: the base row is what a market with no copy shows. */
  select string_agg(id || ': ' || left(description, 60), '; ') into s
    from products where description ~ '(₹|KSh|AED |\$) ?[0-9]';
  if s is not null then raise exception 'these fallback descriptions still quote a currency: %', s; end if;

  select string_agg(id || ': ' || spec, '; ') into s
    from telco_catalogue where spec ~ '(₹|KSh|AED |\$) ?[0-9]';
  if s is not null then raise exception 'these specs still quote a price: %', s; end if;

  /* Each piece of copy names its own currency and no other. Copy filed under
     AED that still says ₹ is the failure this table exists to prevent, and it
     is the one a careless paste produces. */
  select string_agg(pc.product_id || '/' || pc.currency || ': ' || left(pc.description, 60), '; ') into s
    from product_copy pc
    join currencies c on c.code = pc.currency
    join currencies other on other.code <> pc.currency
   where pc.description like '%' || other.symbol || '%'
     and other.symbol <> c.symbol;
  if s is not null then raise exception 'this copy names a currency it is not filed under: %', s; end if;

  /* A promotion runs where its money is spent. */
  select string_agg(p.id || ' runs in ' || p.market_code || ' in ' || p.currency, '; ') into s
    from operator_promotions p where not market_takes(p.market_code, p.currency);
  if s is not null then raise exception 'these offers are priced in money their market does not take: %', s; end if;

  /* A banner naming a figure runs in exactly one market. */
  select string_agg(b.id || ' (' || b.region || '): ' || b.title, '; ') into s
    from operator_banners b
   where (b.title ~ '(₹|KSh|AED |\$) ?[0-9]' or b.subtitle ~ '(₹|KSh|AED |\$) ?[0-9]')
     and b.region like '%,%';
  if s is not null then raise exception 'these banners quote one currency at several markets: %', s; end if;

  /* Floors. Every check above passes trivially on an empty table. */
  select count(*) into n from product_copy;
  if n < 8 then raise exception 'only % rows of copy, so this checked almost nothing', n; end if;
  select count(distinct currency) into n from product_copy;
  if n < 4 then raise exception 'copy exists in only % currencies', n; end if;
end $$;
