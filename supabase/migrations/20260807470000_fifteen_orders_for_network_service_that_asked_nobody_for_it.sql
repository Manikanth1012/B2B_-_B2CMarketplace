/* Fifteen orders for network service that asked nobody to provision it.
 *
 * `order_items.fulfil` is meant to say how a line gets to the buyer. What it
 * actually holds, across fifty-odd rows, is:
 *
 *   'shipped', 'ship' and 'Shipped'; 'instant' and 'Instant' — three spellings
 *   of one thing and two of another, so every count of them is wrong.
 *
 *   'digital' on seven lines, four of which are for provisioned connectivity.
 *
 *   'pending' on sixteen. Pending is not a fulfilment method, it is a status,
 *   and fifteen of those sixteen are for network service that the marketplace
 *   sold, took money for, and never asked anybody to provision.
 *
 * `products.fulfil` is clean — five values, no variants, and it disagrees with
 * the order line in fourteen places. The order line is the copy, and it is the
 * wrong one, so it stops being a copy: it is derived from the product on the
 * way in and constrained to the five real values.
 *
 * The second thing, and the reason this migration comes before the Customer
 * Order Management one: HOW a line is delivered does not say WHO delivers it.
 * A managed firewall and an IoT SIM are both `provisioned`, and one is
 * provisioned by Sentinel's own platform while the other has to be provisioned
 * by the network before a single byte moves. Only the second goes to the
 * telco's order management, and nothing in the schema could tell them apart.
 */

/* ---- 1. Who delivers it ------------------------------------------------------- */

alter table public.products
  add column if not exists fulfilment_route text not null default 'seller';

do $$ begin
  alter table public.products add constraint products_route_check
    check (fulfilment_route in ('telco-com', 'marketplace', 'seller'));
exception when duplicate_object then null; end $$;

comment on column public.products.fulfilment_route is
  'Who executes fulfilment. telco-com: the network provisions it and the order is pushed to Customer Order Management. marketplace: the marketplace''s own platform does it. seller: the seller ships or activates it on their own systems.';

/* Named per SKU rather than derived from a category, because the categories do
   not divide this way and a rule that guessed would be wrong about six of them.
   `partner`, for instance, holds both wholesale connectivity — which is
   network — and the white-label storefront, which is a marketplace platform
   service the telco has nothing to do with. */
update public.products set fulfilment_route = 'telco-com' where id in (
  /* Consumer connectivity: plans, eSIMs, data and roaming add-ons, and the
     network-side VAS behind the family packs. Every one of these ends in a
     subscriber record on the network. */
  'SKU-2001', 'SKU-2002', 'SKU-2003', 'SKU-2006', 'SKU-2007', 'SKU-2008',
  'SKU-2009', 'SKU-2010', 'SKU-FP9501', 'SKU-FP9502', 'SKU-FP9503',
  'SKU-FP9506', 'SKU-FP9507',
  /* IoT connectivity — the SIM estate, the pooled data, the per-SIM managed
     estate a reseller sells on top of it. */
  'SKU-5001', 'SKU-5002', 'SKU-7010', 'SKU-FP9504',
  /* Wholesale: lines provisioned in bulk for a reseller to sell on. */
  'SKU-7002', 'SKU-7004', 'SKU-7009', 'SKU-FP9505'
);

update public.products set fulfilment_route = 'marketplace' where id in (
  /* Neither of these touches the network. The marketplace stands up the
     storefront and mints the sandbox credentials itself. */
  'SKU-7001', 'SKU-7003'
);

/* ---- 2. One spelling, and the product's own ---------------------------------- */

/* Derived rather than corrected once, because a value copied at checkout drifts
   again the next time somebody adds a code path that writes an order. */
update public.order_items i set fulfil = p.fulfil
  from public.products p
 where p.id = i.product_id and i.fulfil is distinct from p.fulfil;

/* A line whose product has since been deleted keeps what it had, lower-cased
   and de-duplicated, because there is nothing left to derive it from. */
update public.order_items set fulfil = case lower(fulfil)
    when 'ship' then 'shipped'
    when 'digital' then 'instant'
    when 'pending' then 'instant'
    else lower(fulfil) end
 where not exists (select 1 from public.products p where p.id = order_items.product_id);

do $$ begin
  alter table public.order_items add constraint order_items_fulfil_check
    check (fulfil in ('shipped', 'esim', 'provisioned', 'activation', 'instant'));
exception when duplicate_object then null; end $$;

create or replace function public.fill_order_item_fulfil()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare p public.products;
begin
  select * into p from public.products where id = new.product_id;
  if p.id is null then
    /* Not an error: an order line may outlive a delisted product, and a
       checkout that failed here would fail for a reason the buyer cannot act
       on. What it must not do is invent a method. */
    if new.fulfil is null then new.fulfil := 'instant'; end if;
    return new;
  end if;
  /* The product decides, always. How a thing is delivered is a property of the
     thing, not of the order, and a caller that thinks otherwise is the caller
     that put 'pending' on fifteen connectivity lines. */
  new.fulfil := p.fulfil;
  return new;
end $$;

drop trigger if exists z_fill_order_item_fulfil on public.order_items;
create trigger z_fill_order_item_fulfil
  before insert or update of product_id, fulfil on public.order_items
  for each row execute function public.fill_order_item_fulfil();

/* ---- 3. Assertions ------------------------------------------------------------ */

do $$
declare n int; bad text;
begin
  /* One spelling each. */
  select string_agg(distinct fulfil, ', ') into bad from public.order_items
   where fulfil not in ('shipped', 'esim', 'provisioned', 'activation', 'instant');
  if bad is not null then raise exception 'order lines still carry: %', bad; end if;

  /* And the same one the product uses. */
  select count(*) into n from public.order_items i
    join public.products p on p.id = i.product_id
   where i.fulfil is distinct from p.fulfil;
  if n > 0 then raise exception '% order lines disagree with their product about fulfilment', n; end if;

  /* The trigger holds the line against a caller who insists. */
  declare v_item uuid; v_before text;
  begin
    select i.id, i.fulfil into v_item, v_before from public.order_items i
      join public.products p on p.id = i.product_id where p.fulfil = 'provisioned' limit 1;
    update public.order_items set fulfil = 'shipped' where id = v_item;
    if (select fulfil from public.order_items where id = v_item) <> v_before then
      raise exception 'a caller rewrote a line''s fulfilment method to something the product does not use';
    end if;
  end;

  /* Every route is used, and the two that are not "seller" are the ones the
     next migration acts on. */
  select count(*) into n from public.products where fulfilment_route = 'telco-com';
  if n < 15 then raise exception 'only % products route to the network', n; end if;
  select count(*) into n from public.products where fulfilment_route = 'marketplace';
  if n = 0 then raise exception 'nothing is fulfilled by the marketplace itself'; end if;

  /* Nothing that has no business on the network is routed to it. A managed
     firewall pushed to a telco order manager is a ticket nobody can close. */
  select string_agg(id, ', ') into bad from public.products
   where fulfilment_route = 'telco-com' and category_id in ('security', 'content', 'device');
  if bad is not null then raise exception 'routed to the network with no network in them: %', bad; end if;

  /* And nothing with a telco component is routed away from it. */
  select string_agg(p.id, ', ') into bad from public.products p
   where exists (select 1 from public.product_telco_components c where c.product_id = p.id)
     and p.fulfilment_route <> 'telco-com';
  if bad is not null then raise exception 'draws on the rate card and is not provisioned by the network: %', bad; end if;

  raise notice 'routes — telco-com %, marketplace %, seller %; order lines re-derived %',
    (select count(*) from public.products where fulfilment_route = 'telco-com'),
    (select count(*) from public.products where fulfilment_route = 'marketplace'),
    (select count(*) from public.products where fulfilment_route = 'seller'),
    (select count(*) from public.order_items);
end $$;
