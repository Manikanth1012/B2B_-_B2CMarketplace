/*
 * A bundle line carries its price.
 *
 * Until now the operator composed a bundle by typing one total, and each
 * seller's floor was only a check on that total. Nothing recorded what each
 * product was sold for inside the bundle, so nobody could say how far any one
 * seller's item had been discounted (user, 2026-11-27: "I do not get the option
 * of choosing a discounted price for each product").
 *
 * Now each product in an operator-composed bundle has its own price inside the
 * bundle, `product_components.unit_price`:
 *   - never below the seller's floor (the least the seller agreed to accept),
 *     never above the product's normal price — checked on every write;
 *   - the bundle's price is the lines added up — checked once per statement,
 *     for every bundle whose lines all carry a price.
 * Null keeps the old meaning: bundles composed before this, and a seller's own
 * bundles, are priced as a whole.
 *
 * Idempotent, one transaction, self-check last (dry runs rolled back).
 */

begin;

alter table public.product_components
  add column if not exists unit_price numeric(12,2);

alter table public.product_components drop constraint if exists product_components_unit_price_positive;
alter table public.product_components add constraint product_components_unit_price_positive
  check (unit_price is null or unit_price > 0);

comment on column public.product_components.unit_price is
  'Price of one unit inside the bundle, between the component''s floor_price and price. Null: the bundle is priced as a whole.';

/* --------------------------------------------- each line inside its band - */

create or replace function public.guard_bundle_line_price()
returns trigger
language plpgsql
set search_path = public
as $$
<<g>>
declare
  v_price numeric;
  v_floor numeric;
  v_name  text;
begin
  if new.unit_price is null then
    return new;
  end if;
  /* Only the marketplace prices a bundle line by line. A seller's own bundle is
     priced as a whole: a seller who could split it would move the price onto
     whichever of its products carries the lowest commission. Sessions with no
     signed-in user (migrations, the SQL editor) are the operator's own. */
  if auth.uid() is not null and coalesce(public.current_persona(), '') <> 'operator' then
    raise exception 'Only the marketplace sets a price per line inside a bundle'
      using errcode = '42501';
  end if;
  select p.price, p.floor_price, p.name into v_price, v_floor, v_name
    from public.products p where p.id = new.component_id;
  if not found then
    raise exception 'Bundle line % is not in the catalogue', new.component_id using errcode = '23503';
  end if;
  if new.unit_price < v_floor then
    raise exception '% cannot go below its seller''s floor of % inside a bundle (asked %)',
      v_name, v_floor, new.unit_price using errcode = '23514';
  end if;
  if new.unit_price > v_price then
    raise exception '% cannot cost more inside a bundle than its normal price of % (asked %)',
      v_name, v_price, new.unit_price using errcode = '23514';
  end if;
  return new;
end g $$;

drop trigger if exists bundle_line_price_band on public.product_components;
create trigger bundle_line_price_band
  before insert or update of unit_price, component_id on public.product_components
  for each row execute function public.guard_bundle_line_price();

/* ----------------------------------- the lines add up to the bundle price - */

/* The check itself, for a set of bundles: every bundle whose lines all carry a
   price must cost those lines added up. Bundles with no lines left, or with
   any unpriced line, are priced as a whole and pass. */
create or replace function public.check_bundle_lines_total(p_bundles text[])
returns void
language plpgsql
set search_path = public
as $$
<<c>>
declare
  v_bad text;
begin
  if p_bundles is null or cardinality(p_bundles) = 0 then
    return;
  end if;
  select string_agg(format('%s (lines %s, price %s)', x.bundle_id, x.lines_total, x.price), ', ')
    into v_bad
  from (
    select l.bundle_id, round(sum(l.quantity * l.unit_price), 2) as lines_total, b.price
      from public.product_components l
      join public.products b on b.id = l.bundle_id
     where l.bundle_id = any (p_bundles)
     group by l.bundle_id, b.price
    having bool_and(l.unit_price is not null)
  ) x
  where abs(x.lines_total - x.price) > 0.01;
  if v_bad is not null then
    raise exception 'A bundle priced line by line must cost its lines added up: %', v_bad
      using errcode = '23514';
  end if;
end c $$;

/* A trigger with transition tables may name one event only, and only the
   tables that event has, so each event gets its own small function. */
create or replace function public.guard_bundle_lines_after_insert()
returns trigger language plpgsql set search_path = public as $$
<<i>>
begin
  perform public.check_bundle_lines_total(array(select distinct n.bundle_id from changed n));
  return null;
end i $$;

create or replace function public.guard_bundle_lines_after_update()
returns trigger language plpgsql set search_path = public as $$
<<u>>
begin
  /* Both sides: a line moved to another bundle changes the old one too. */
  perform public.check_bundle_lines_total(array(
    select n.bundle_id from changed n union select o.bundle_id from gone o));
  return null;
end u $$;

create or replace function public.guard_bundle_lines_after_delete()
returns trigger language plpgsql set search_path = public as $$
<<d>>
begin
  perform public.check_bundle_lines_total(array(select distinct o.bundle_id from gone o));
  return null;
end d $$;

drop function if exists public.guard_bundle_lines_total();

drop trigger if exists bundle_lines_total_on_insert on public.product_components;
create trigger bundle_lines_total_on_insert
  after insert on public.product_components
  referencing new table as changed
  for each statement execute function public.guard_bundle_lines_after_insert();

drop trigger if exists bundle_lines_total_on_update on public.product_components;
create trigger bundle_lines_total_on_update
  after update on public.product_components
  referencing old table as gone new table as changed
  for each statement execute function public.guard_bundle_lines_after_update();

drop trigger if exists bundle_lines_total_on_delete on public.product_components;
create trigger bundle_lines_total_on_delete
  after delete on public.product_components
  referencing old table as gone
  for each statement execute function public.guard_bundle_lines_after_delete();

/* And from the other side: a bundle whose lines are priced cannot have its own
   price changed away from them. */
create or replace function public.guard_bundle_price_matches_lines()
returns trigger language plpgsql set search_path = public as $$
<<p>>
begin
  perform public.check_bundle_lines_total(array(
    select n.id from changed n join gone o on o.id = n.id where n.price is distinct from o.price));
  return null;
end p $$;

drop trigger if exists bundle_price_matches_lines on public.products;
create trigger bundle_price_matches_lines
  after update on public.products
  referencing old table as gone new table as changed
  for each statement execute function public.guard_bundle_price_matches_lines();

/* ------------------------------------------------------------ self-check - */

do $$
<<chk>>
declare
  v_bundle text;
  v_part   text;
  v_floor  numeric;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'product_components' and column_name = 'unit_price'
  ) then
    raise exception 'product_components.unit_price is missing';
  end if;
  if (select count(*) from pg_trigger
       where tgrelid = 'public.product_components'::regclass
         and tgname in ('bundle_line_price_band', 'bundle_lines_total_on_insert',
                        'bundle_lines_total_on_update', 'bundle_lines_total_on_delete')
         and not tgisinternal) <> 4
     or not exists (select 1 from pg_trigger
                     where tgrelid = 'public.products'::regclass
                       and tgname = 'bundle_price_matches_lines' and not tgisinternal) then
    raise exception 'the bundle line triggers are not all in place';
  end if;

  /* Nothing existing was given a price by this migration. */
  if exists (select 1 from public.product_components where unit_price is not null) then
    raise notice 'some bundle lines already carry a price (from the app since this migration) — left as they are';
  end if;

  select c.bundle_id, c.component_id, p.floor_price into v_bundle, v_part, v_floor
    from public.product_components c join public.products p on p.id = c.component_id
   where p.floor_price > 0.01
     and not exists (select 1 from public.product_components x
                      where x.bundle_id = c.bundle_id and x.unit_price is not null)
     /* Two lines or more, so pricing one leaves the bundle priced as a whole
        (dry run 2); every part has a price, and the bundle costs less than
        its parts, so pricing all at their normal price must be refused (dry
        run 3). */
     and (select count(*) from public.product_components x where x.bundle_id = c.bundle_id) >= 2
     and not exists (select 1 from public.product_components x join public.products xp on xp.id = x.component_id
                      where x.bundle_id = c.bundle_id and xp.price <= 0)
     and (select b.price from public.products b where b.id = c.bundle_id)
         < (select sum(x.quantity * xp.price) - 0.01 from public.product_components x
              join public.products xp on xp.id = x.component_id where x.bundle_id = c.bundle_id)
   order by c.bundle_id, c.sort_order
   limit 1;
  if v_bundle is null then
    raise notice 'no bundle lines to dry-run against; structure checked only';
    return;
  end if;

  /* Dry run 1: a line below its seller's floor is refused. */
  begin
    update public.product_components set unit_price = 0.01
     where bundle_id = v_bundle and component_id = v_part;
    raise exception 'a bundle line below its seller''s floor was accepted (%/%)', v_bundle, v_part;
  exception when check_violation then
    null;
  end;

  /* Dry run 2: one line at exactly its seller's floor is accepted (the other
     lines are still unpriced, so the bundle is still priced as a whole). Any
     error here fails the migration; the ZZ999 rolls the change back. */
  begin
    update public.product_components set unit_price = v_floor
     where bundle_id = v_bundle and component_id = v_part;
    raise exception using errcode = 'ZZ999', message = 'dry run';
  exception when sqlstate 'ZZ999' then
    null;
  end;

  /* Dry run 3: every line priced at its normal price adds up to the parts
     bought separately, which is more than the bundle costs, so the total check
     must refuse it. */
  begin
    update public.product_components c set unit_price = p.price
      from public.products p
     where p.id = c.component_id and c.bundle_id = v_bundle;
    if abs((select round(sum(c.quantity * c.unit_price), 2) from public.product_components c where c.bundle_id = v_bundle)
           - (select b.price from public.products b where b.id = v_bundle)) > 0.01 then
      raise exception 'a bundle whose lines do not add up to its price was accepted (%)', v_bundle;
    end if;
    raise exception using errcode = 'ZZ999', message = 'dry run';
  exception
    when check_violation then null;
    when sqlstate 'ZZ999' then null;
  end;

  if exists (select 1 from public.product_components where bundle_id = v_bundle and unit_price is not null) then
    raise exception 'the dry runs left a price behind on %', v_bundle;
  end if;
end chk $$;

commit;
