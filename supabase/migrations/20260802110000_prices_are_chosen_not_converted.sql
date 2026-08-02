-- Prices are chosen, not converted.
--
-- Every product carried one number and it was dollars. Showing a rupee
-- shopper that number multiplied by 87.42 gives ₹1,082.67, and nobody in any
-- market has ever listed a plan at ₹1,082.67. A catalogue converted at render
-- time announces itself as a catalogue converted at render time.
--
-- So there is a price book: one row per product per currency, seeded by
-- converting and then pulling to the price a human would have picked — the
-- rule lives in `charmPrice` in src/lib/money.ts, where it is tested, and the
-- results are written out here as literals so this file records exactly what
-- was seeded rather than re-deriving it in a second language.
--
-- Two "was" prices were dropped on the way. A $12.00 item selling at $11.52 is
-- a real 4% saving, and in rupees both round to ₹999; a strikethrough showing
-- ₹999 above ₹999 claims a discount nobody gave, which is not a rounding
-- artefact but a false advertisement. `wasPriceFor` drops those.

/* products.price stays as it is and gains the currency it was always in. The
   price book carries the others, so nothing that reads products today changes
   meaning. */
alter table products add column if not exists currency text not null default 'USD'
  references currencies(code);

create table if not exists product_prices (
  product_id  text not null references products(id) on delete cascade,
  /* Keyed on currency rather than market. A price is denominated in a
     currency; a market merely selects one. Two markets sharing a currency
     would share a price, which is the behaviour wanted. */
  currency    text not null references currencies(code),
  price       numeric not null check (price >= 0),
  was_price   numeric check (was_price is null or was_price > price),
  floor_price numeric,
  list_price  numeric,
  primary key (product_id, currency),
  /* The band, enforced rather than asserted once: a floor above the price is a
     product the seller may not sell at its own listed price. */
  check (floor_price is null or floor_price <= price),
  check (list_price is null or list_price >= price)
);

alter table product_prices enable row level security;

drop policy if exists "product_prices_read" on product_prices;
drop policy if exists "product_prices_operator" on product_prices;

/* The storefront is public, so a shopper who is not signed in still has to be
   able to read a price. */
create policy "product_prices_read" on product_prices for select to anon, authenticated
  using (true);
create policy "product_prices_operator" on product_prices for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

insert into product_prices (product_id, currency, price, was_price, floor_price, list_price) values
  ('SKU-2001', 'INR', 1599.00, null, 1399.00, 1699.00),
  ('SKU-2001', 'AED', 64.99, null, 59.99, 74.99),
  ('SKU-2001', 'KES', 2299.00, null, 2099.00, 2599.00),
  ('SKU-2002', 'INR', 2399.00, null, 1999.00, 2599.00),
  ('SKU-2002', 'AED', 99.99, null, 84.99, 109.00),
  ('SKU-2002', 'KES', 3499.00, null, 2999.00, 3799.00),
  ('SKU-2003', 'INR', 1299.00, null, 1099.00, 1399.00),
  ('SKU-2003', 'AED', 54.99, null, 47.99, 59.99),
  ('SKU-2003', 'KES', 1899.00, null, 1699.00, 2099.00),
  ('SKU-2004', 'INR', 599.00, null, 549.00, 649.00),
  ('SKU-2004', 'AED', 24.99, null, 22.99, 27.99),
  ('SKU-2004', 'KES', 899.00, null, 799.00, 999.00),
  ('SKU-2005', 'INR', 949.00, null, 849.00, 1099.00),
  ('SKU-2005', 'AED', 39.99, null, 35.99, 43.99),
  ('SKU-2005', 'KES', 1399.00, null, 1299.00, 1599.00),
  ('SKU-2006', 'INR', 2999.00, 3499.00, 2899.00, 3499.00),
  ('SKU-2006', 'AED', 119.00, 149.00, 119.00, 149.00),
  ('SKU-2006', 'KES', 4399.00, 4999.00, 4299.00, 4999.00),
  ('SKU-3001', 'INR', 1099.00, null, 949.00, 1199.00),
  ('SKU-3001', 'AED', 47.99, null, 40.99, 49.99),
  ('SKU-3001', 'KES', 1699.00, null, 1399.00, 1799.00),
  ('SKU-3002', 'INR', 699.00, null, 649.00, 749.00),
  ('SKU-3002', 'AED', 28.99, null, 25.99, 31.99),
  ('SKU-3002', 'KES', 999.00, null, 949.00, 1099.00),
  ('SKU-3003', 'INR', 849.00, null, 799.00, 949.00),
  ('SKU-3003', 'AED', 36.99, null, 32.99, 39.99),
  ('SKU-3003', 'KES', 1299.00, null, 1199.00, 1399.00),
  ('SKU-3004', 'INR', 2199.00, null, 1999.00, 2399.00),
  ('SKU-3004', 'AED', 89.99, null, 84.99, 99.00),
  ('SKU-3004', 'KES', 3199.00, null, 2899.00, 3599.00),
  ('SKU-3005', 'INR', 1299.00, null, 1199.00, 1399.00),
  ('SKU-3005', 'AED', 54.99, null, 49.99, 59.99),
  ('SKU-3005', 'KES', 1899.00, null, 1699.00, 2099.00),
  ('SKU-3006', 'INR', 799.00, null, 699.00, 849.00),
  ('SKU-3006', 'AED', 32.99, null, 29.99, 35.99),
  ('SKU-3006', 'KES', 1199.00, null, 999.00, 1299.00),
  ('SKU-3007', 'INR', 549.00, null, 499.00, 599.00),
  ('SKU-3007', 'AED', 23.99, null, 20.99, 25.99),
  ('SKU-3007', 'KES', 849.00, null, 749.00, 899.00),
  ('SKU-3008', 'INR', 499.00, null, 469.00, 599.00),
  ('SKU-3008', 'AED', 21.99, null, 19.99, 23.99),
  ('SKU-3008', 'KES', 749.00, null, 699.00, 849.00),
  ('SKU-3009', 'INR', 439.00, null, 389.00, 479.00),
  ('SKU-3009', 'AED', 17.99, null, 15.99, 19.99),
  ('SKU-3009', 'KES', 649.00, null, 599.00, 699.00),
  ('SKU-4001', 'INR', 64999.00, 69999.00, 54999.00, 69999.00),
  ('SKU-4001', 'AED', 2799.00, 2999.00, 2199.00, 2999.00),
  ('SKU-4001', 'KES', 94999.00, 104999.00, 79999.00, 104999.00),
  ('SKU-4002', 'INR', 30999.00, null, 23999.00, 33999.00),
  ('SKU-4002', 'AED', 1299.00, null, 999.00, 1399.00),
  ('SKU-4002', 'KES', 44999.00, null, 35999.00, 49999.00),
  ('SKU-4003', 'INR', 14999.00, null, 11999.00, 15999.00),
  ('SKU-4003', 'AED', 599.00, null, 489.00, 699.00),
  ('SKU-4003', 'KES', 21999.00, null, 16999.00, 23999.00),
  ('SKU-4004', 'INR', 19999.00, null, 15999.00, 21999.00),
  ('SKU-4004', 'AED', 849.00, null, 649.00, 949.00),
  ('SKU-4004', 'KES', 29999.00, null, 23999.00, 32999.00),
  ('SKU-4005', 'INR', 27999.00, null, 20999.00, 30999.00),
  ('SKU-4005', 'AED', 1199.00, null, 849.00, 1299.00),
  ('SKU-4005', 'KES', 40999.00, null, 29999.00, 44999.00),
  ('SKU-4006', 'INR', 23999.00, null, 19999.00, 26999.00),
  ('SKU-4006', 'AED', 999.00, null, 799.00, 1099.00),
  ('SKU-4006', 'KES', 35999.00, null, 28999.00, 39999.00),
  ('SKU-4007', 'INR', 11999.00, null, 9499.00, 12999.00),
  ('SKU-4007', 'AED', 499.00, null, 409.00, 549.00),
  ('SKU-4007', 'KES', 17999.00, null, 13999.00, 19999.00),
  ('SKU-4008', 'INR', 2499.00, null, 1899.00, 2799.00),
  ('SKU-4008', 'AED', 109.00, null, 79.99, 119.00),
  ('SKU-4008', 'KES', 3699.00, null, 2799.00, 4099.00),
  ('SKU-5001', 'INR', 119.00, null, 109.00, 129.00),
  ('SKU-5001', 'AED', 4.99, null, 4.99, 5.99),
  ('SKU-5001', 'KES', 179.00, null, 159.00, 199.00),
  ('SKU-5002', 'INR', 269.00, null, 219.00, 299.00),
  ('SKU-5002', 'AED', 10.99, null, 8.99, 12.99),
  ('SKU-5002', 'KES', 399.00, null, 319.00, 439.00),
  ('SKU-5003', 'INR', 7499.00, null, 5999.00, 7999.00),
  ('SKU-5003', 'AED', 309.00, null, 249.00, 339.00),
  ('SKU-5003', 'KES', 10999.00, null, 8499.00, 11999.00),
  ('SKU-5004', 'INR', 4499.00, null, 3599.00, 4999.00),
  ('SKU-5004', 'AED', 189.00, null, 149.00, 209.00),
  ('SKU-5004', 'KES', 6499.00, null, 5499.00, 7499.00),
  ('SKU-5005', 'INR', 8499.00, null, 5999.00, 8999.00),
  ('SKU-5005', 'AED', 349.00, null, 239.00, 389.00),
  ('SKU-5005', 'KES', 11999.00, null, 8499.00, 13999.00),
  ('SKU-5006', 'INR', 199999.00, 219999.00, 179999.00, 219999.00),
  ('SKU-5006', 'AED', 8499.00, 9499.00, 7499.00, 9499.00),
  ('SKU-5006', 'KES', 294999.00, 324999.00, 264999.00, 324999.00),
  ('SKU-5007', 'INR', 15999.00, null, 12999.00, 17999.00),
  ('SKU-5007', 'AED', 699.00, null, 549.00, 749.00),
  ('SKU-5007', 'KES', 23999.00, null, 18999.00, 26999.00),
  ('SKU-5008', 'INR', 419999.00, 579999.00, 409999.00, 579999.00),
  ('SKU-5008', 'AED', 17499.00, 24499.00, 17499.00, 24499.00),
  ('SKU-5008', 'KES', 619999.00, 859999.00, 609999.00, 859999.00),
  ('SKU-5009', 'INR', 5999.00, null, 5499.00, 6999.00),
  ('SKU-5009', 'AED', 259.00, null, 229.00, 289.00),
  ('SKU-5009', 'KES', 8999.00, null, 8499.00, 9999.00),
  ('SKU-6001', 'INR', 2099.00, null, 1799.00, 2299.00),
  ('SKU-6001', 'AED', 89.99, null, 74.99, 94.99),
  ('SKU-6001', 'KES', 3099.00, null, 2699.00, 3399.00),
  ('SKU-6002', 'INR', 849.00, null, 749.00, 899.00),
  ('SKU-6002', 'AED', 34.99, null, 30.99, 37.99),
  ('SKU-6002', 'KES', 1199.00, null, 1099.00, 1399.00),
  ('SKU-6003', 'INR', 549.00, null, 469.00, 599.00),
  ('SKU-6003', 'AED', 22.99, null, 19.99, 24.99),
  ('SKU-6003', 'KES', 799.00, null, 699.00, 899.00),
  ('SKU-6004', 'INR', 419.00, null, 379.00, 459.00),
  ('SKU-6004', 'AED', 17.99, null, 15.99, 18.99),
  ('SKU-6004', 'KES', 599.00, null, 549.00, 699.00),
  ('SKU-6005', 'INR', 299.00, null, 269.00, 329.00),
  ('SKU-6005', 'AED', 11.99, null, 10.99, 13.99),
  ('SKU-6005', 'KES', 439.00, null, 399.00, 479.00),
  ('SKU-6006', 'INR', 13999.00, 15999.00, 13999.00, 15999.00),
  ('SKU-6006', 'AED', 599.00, 699.00, 599.00, 699.00),
  ('SKU-6006', 'KES', 20999.00, 23999.00, 20999.00, 23999.00),
  ('SKU-7001', 'INR', 21999.00, null, 19999.00, 23999.00),
  ('SKU-7001', 'AED', 899.00, null, 799.00, 999.00),
  ('SKU-7001', 'KES', 31999.00, null, 28999.00, 34999.00),
  ('SKU-7002', 'INR', 339999.00, null, 304999.00, 374999.00),
  ('SKU-7002', 'AED', 14499.00, null, 12999.00, 15999.00),
  ('SKU-7002', 'KES', 504999.00, null, 454999.00, 554999.00),
  ('SKU-7003', 'INR', 0.00, null, 0.00, 0.00),
  ('SKU-7003', 'AED', 0.00, null, 0.00, 0.00),
  ('SKU-7003', 'KES', 0.00, null, 0.00, 0.00),
  ('SKU-7004', 'INR', 1499.00, null, 1299.00, 1699.00),
  ('SKU-7004', 'AED', 64.99, null, 54.99, 69.99),
  ('SKU-7004', 'KES', 2299.00, null, 1899.00, 2499.00),
  ('SKU-FP9501', 'INR', 5999.00, 6499.00, 4599.00, 6499.00),
  ('SKU-FP9501', 'AED', 259.00, 269.00, 189.00, 269.00),
  ('SKU-FP9501', 'KES', 8999.00, 9499.00, 6999.00, 9499.00),
  ('SKU-FP9502', 'INR', 3999.00, 4499.00, 2999.00, 4499.00),
  ('SKU-FP9502', 'AED', 169.00, 189.00, 129.00, 189.00),
  ('SKU-FP9502', 'KES', 5999.00, 6499.00, 4499.00, 6499.00),
  ('SKU-FP9503', 'INR', 999.00, null, 699.00, 999.00),
  ('SKU-FP9503', 'AED', 41.99, 43.99, 28.99, 43.99),
  ('SKU-FP9503', 'KES', 1499.00, 1599.00, 999.00, 1599.00),
  ('SKU-FP9504', 'INR', 4399.00, 4599.00, 3299.00, 4599.00),
  ('SKU-FP9504', 'AED', 189.00, null, 139.00, 189.00),
  ('SKU-FP9504', 'KES', 6499.00, 6999.00, 4899.00, 6999.00),
  ('SKU-FP9505', 'INR', 94999.00, 99999.00, 69999.00, 99999.00),
  ('SKU-FP9505', 'AED', 4099.00, 4199.00, 2999.00, 4199.00),
  ('SKU-FP9505', 'KES', 144999.00, 149999.00, 104999.00, 149999.00)
on conflict (product_id, currency) do update set
  price = excluded.price, was_price = excluded.was_price,
  floor_price = excluded.floor_price, list_price = excluded.list_price;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Every product is priced in every market currency, or a shopper in that
     market meets a card with no price on it. */
  select string_agg(p.id || '/' || c.code, ', ') into s
    from products p
    cross join currencies c
   where not c.is_reporting
     and not exists (select 1 from product_prices pp where pp.product_id = p.id and pp.currency = c.code);
  if s is not null then raise exception 'these products have no price in some market: %', s; end if;

  /* Nothing is priced in a currency no market uses. */
  select count(*) into n from product_prices pp
   where pp.currency not in (select currency from markets)
     and pp.currency not in (select code from currencies where is_reporting);
  if n > 0 then raise exception '% price rows are in a currency nothing sells in', n; end if;

  /* A free product is free everywhere. Charging for something the base
     catalogue gives away is a pricing bug that looks like a rounding bug. */
  select string_agg(pp.product_id || '/' || pp.currency, ', ') into s
    from product_prices pp join products p on p.id = pp.product_id
   where p.price = 0 and pp.price <> 0;
  if s is not null then raise exception 'these are free in the base catalogue and charged for elsewhere: %', s; end if;

  /* And nothing became free by rounding. */
  select string_agg(pp.product_id || '/' || pp.currency, ', ') into s
    from product_prices pp join products p on p.id = pp.product_id
   where p.price > 0 and pp.price <= 0;
  if s is not null then raise exception 'these round to nothing in some market: %', s; end if;

  /* Every converted price should be in the same league as the base price
     converted. A factor of two out means the charm rule mis-stepped, which is
     the failure this seeding is most likely to have. */
  select string_agg(pp.product_id || '/' || pp.currency, ', ') into s
    from product_prices pp
    join products p on p.id = pp.product_id
    join fx_rates f on f.base = 'USD' and f.quote = pp.currency and f.as_of = '2026-08-01'
   where p.price > 0
     and (pp.price > p.price * f.rate * 1.5 or pp.price < p.price * f.rate * 0.6);
  if s is not null then raise exception 'these prices are nowhere near the converted base price: %', s; end if;

  select count(*) into n from product_prices;
  if n < 100 then raise exception 'only % price rows were seeded, which is too few', n; end if;
end $$;
