/* A buyer builds the bundle.
 *
 * Until now a bundle was fixed. The operator composed it in Catalogue Review
 * (`product_components`) and the buyer took it or left it. Nobody fitting out
 * an office wants exactly twenty-five of one sensor and one of one firewall;
 * they want "about this many of something like this", priced as one.
 *
 * So a bundle can now be a template with slots. The operator says what each
 * slot offers, how many picks it takes and in what quantities, and how much
 * off the whole is (never more than the published rule, `bundle_rules`). The
 * buyer picks. `price_bundle` prices the picks from the price book of the
 * buyer's currency; `configure_bundle` writes the result down as a
 * *selection* — the price, the parts and their share of it — held for seven
 * days.
 *
 * A selection settles as its parts. Its lines go into the basket, the
 * requisition and the order as ordinary lines carrying `bundle_selection_id`,
 * each at its share of the price, so every seller is paid, refunded and
 * settled for its own parts exactly as before. The guards below hold those
 * lines to the selection: same products, same quantities, the selection's
 * prices, the same buyer and money, inside the seven days, every part still
 * on sale. A line with no `bundle_selection_id` is untouched by any of it.
 *
 * The arithmetic, once (and identically in `priceBundle`, src/lib/bundles.ts):
 *
 *   unit_price  = max(round(list × (1 − discount_pct/100), 2), floor ?? 0)
 *   quantity    = picked quantity × bundle quantity
 *   line_total  = round(unit_price × quantity, 2)
 *   total       = Σ line_total            (each line rounded, then summed)
 *   parts_total = Σ round(list × quantity, 2)
 *   saving      = parts_total − total
 *
 * `list` and `floor` are `product_prices.price` and `.floor_price` for the
 * currency — the row the shop shows, the floor taken to 2 dp. No seller is
 * priced below its floor as it stood when the bundle was priced; a floor
 * raised during the seven-day hold does not reprice a held selection.
 *
 * The rules of a configuration are mirrored in `validateChoices` and
 * `defaultChoices`, so a screen never offers what this file refuses. This file
 * is the one that decides.
 */

/* ============================================================ the tables === */

create sequence if not exists bundle_template_seq start with 1001;

create table if not exists bundle_templates (
  /* `BT-` and a number. The seed's `BT-SEED-` ids are not numbers, so the
     sequence can never produce one and a re-seed never touches a real one. */
  id           text primary key default ('BT-' || nextval('bundle_template_seq')),
  name         text not null check (char_length(btrim(name)) between 1 and 80),
  description  text,
  image        text,
  status       text not null default 'draft' check (status in ('draft', 'live', 'paused')),
  /* Who may configure it. Not empty, and only the two buying personas. */
  audiences    text[] not null check (cardinality(audiences) >= 1
                                      and audiences <@ array['consumer', 'enterprise']::text[]),
  /* Above nothing and below everything; the published cap is checked by
     `guard_bundle_template`, because it lives in another table. */
  discount_pct numeric(5,2) not null check (discount_pct > 0 and discount_pct < 100),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists bundle_slots (
  id          text primary key default gen_random_uuid()::text,
  template_id text not null references bundle_templates(id) on delete cascade,
  label       text not null check (char_length(btrim(label)) between 1 and 60),
  /* Nought makes the slot optional. */
  min_pick    integer not null check (min_pick >= 0),
  max_pick    integer not null,
  qty_min     integer not null check (qty_min >= 1),
  qty_max     integer not null,
  qty_default integer not null,
  sort_order  integer not null default 0,
  constraint bundle_slots_max_pick_check check (max_pick >= greatest(1, min_pick)),
  constraint bundle_slots_qty_max_check check (qty_max >= qty_min and qty_max <= 999),
  constraint bundle_slots_qty_default_check check (qty_default between qty_min and qty_max)
);

create index if not exists bundle_slots_template_idx on bundle_slots(template_id, sort_order);

create table if not exists bundle_options (
  id         text primary key default gen_random_uuid()::text,
  slot_id    text not null references bundle_slots(id) on delete cascade,
  product_id text not null references products(id),
  /* What a required slot starts with. How many, on a live template, is the
     publish check's question (`bundle_template_problem`). */
  is_default boolean not null default false,
  sort_order integer not null default 0,
  constraint bundle_options_slot_product_key unique (slot_id, product_id)
);

create index if not exists bundle_options_product_idx on bundle_options(product_id);

/* A configured, priced bundle. Written only by `configure_bundle`; nobody
   edits one afterwards — a new price is a new selection. */
create table if not exists bundle_selections (
  id          text primary key default gen_random_uuid()::text,
  /* No cascade: a template somebody has bought from is paused, not deleted. */
  template_id text not null references bundle_templates(id),
  account_id  text references enterprise_accounts(id) on delete cascade,
  user_id     uuid references auth.users(id) on delete cascade,
  currency    text not null references currencies(code),
  choices     jsonb not null,
  quantity    integer not null check (quantity between 1 and 999),
  total       numeric(12,2) not null check (total >= 0),
  parts_total numeric(12,2) not null check (parts_total >= 0),
  priced_at   timestamptz not null default now(),
  /* priced_at + 7 days, set by configure_bundle. */
  valid_until timestamptz not null,
  /* A business or a person, never both and never neither. */
  constraint bundle_selections_owner_check check ((account_id is null) <> (user_id is null)),
  constraint bundle_selections_valid_until_check check (valid_until > priced_at),
  constraint bundle_selections_total_within_parts check (total <= parts_total)
);

create index if not exists bundle_selections_account_idx on bundle_selections(account_id) where account_id is not null;
create index if not exists bundle_selections_user_idx on bundle_selections(user_id) where user_id is not null;
create index if not exists bundle_selections_template_idx on bundle_selections(template_id);

/* The parts, each at its share of the price. Same precision as the
   requisition line each becomes, so "equal to the selection's price" is
   exact. */
create table if not exists bundle_selection_lines (
  id               text primary key default gen_random_uuid()::text,
  selection_id     text not null references bundle_selections(id) on delete cascade,
  product_id       text not null references products(id),
  name             text not null,
  partner_id       text references partners(id),
  seller           text not null,
  /* Per the whole selection: picked quantity × bundle quantity. */
  quantity         integer not null check (quantity > 0),
  list_unit_price  numeric(10,2) not null check (list_unit_price >= 0),
  unit_price       numeric(10,2) not null check (unit_price >= 0),
  floor_unit_price numeric(10,2),
  sort_order       integer not null default 0,
  /* One line per product, so a basket, requisition or order line names its
     selection line by product alone. */
  constraint bundle_selection_lines_product_key unique (selection_id, product_id),
  /* The floor holds. */
  constraint bundle_selection_lines_floor_check check (floor_unit_price is null or unit_price >= floor_unit_price),
  /* A floor is never above the price (`product_prices`), so neither is a
     price held at it. */
  constraint bundle_selection_lines_discount_check check (unit_price <= list_unit_price)
);

/* ================================================ the lines that carry one === */

alter table cart_items
  add column if not exists bundle_selection_id text references bundle_selections(id) on delete cascade;
alter table enterprise_requisition_lines
  add column if not exists bundle_selection_id text references bundle_selections(id) on delete set null;
alter table order_items
  add column if not exists bundle_selection_id text references bundle_selections(id) on delete set null;

comment on column cart_items.bundle_selection_id is
  'The configured bundle this basket line is a part of. When set, guard_bundle_cart_line holds the line to it (product, quantity, owner, within its seven days, every part still on sale) and removing any part removes the whole bundle. Null for every ordinary line.';
comment on column enterprise_requisition_lines.bundle_selection_id is
  'The configured bundle this line is a part of. When set, guard_bundle_requisition_line holds it to the selection: product, quantity, the selection''s unit price, the same account and currency, inside the seven days when raised, every part still on sale. Null for every line priced from the catalogue.';
comment on column order_items.bundle_selection_id is
  'The configured bundle this order line is a part of, at its share of the bundle price. When set, guard_bundle_order_line holds it to the selection. Null for every ordinary line.';

/* One product of a selection once per container; "whole" is then a count. */
create unique index if not exists cart_items_bundle_part_key
  on cart_items(bundle_selection_id, product_id) where bundle_selection_id is not null;
create unique index if not exists enterprise_requisition_lines_bundle_part_key
  on enterprise_requisition_lines(requisition_id, bundle_selection_id, product_id) where bundle_selection_id is not null;
create unique index if not exists order_items_bundle_part_key
  on order_items(order_id, bundle_selection_id, product_id) where bundle_selection_id is not null;

/* ============================================================== helpers === */

/* The starting configuration, as `defaultChoices` builds it: a required slot
   (min_pick ≥ 1) takes its default options in their order, up to max_pick, at
   the slot's default quantity; an optional slot starts empty. Invoker, so a
   buyer sees the defaults of what they can already see. */
create or replace function bundle_default_choices(p_template text) returns jsonb
language sql stable set search_path = public as $$
  select coalesce(jsonb_object_agg(s.id, coalesce(d.picks, '[]'::jsonb)), '{}'::jsonb)
    from bundle_slots s
    left join lateral (
      select jsonb_agg(jsonb_build_object('product_id', o.product_id, 'quantity', s.qty_default)
                       order by o.sort_order, o.id) as picks
        from (select o2.id, o2.product_id, o2.sort_order,
                     row_number() over (order by o2.sort_order, o2.id) as rn
                from bundle_options o2
               where o2.slot_id = s.id and o2.is_default) o
       where o.rn <= s.max_pick and s.min_pick >= 1
    ) d on true
   where s.template_id = p_template
$$;

/* The first part of a selection that can no longer be sold as configured —
   paused, delisted, out of stock or unpriced in the selection's money — by
   name, or null when every part still can. */
create or replace function bundle_part_unavailable(p_selection text, p_currency text) returns text
language sql stable security definer set search_path = public as $$
  select l.name
    from bundle_selection_lines l
    left join products p on p.id = l.product_id
   where l.selection_id = p_selection
     and (p.id is null or p.status <> 'live' or p.stock = 'out'
          or not exists (select 1 from product_prices pp
                          where pp.product_id = l.product_id and pp.currency = p_currency))
   order by l.sort_order
   limit 1
$$;

/**
 * Why a template may not go on sale, in a sentence, or null when it may.
 *
 *   parts      between bundle_rules.min_components and max_components slots
 *              that can be filled, and every slot offering at least as many
 *              options as it asks for (one, if optional)
 *   enough     the required picks add up to at least min_components, so no
 *              configuration a buyer can make is a single product
 *   defaults   each required slot has between min_pick and max_pick defaults
 *              (exactly one, for a pick-one slot) — so the default
 *              configuration `defaultChoices` builds is itself valid
 *   once       a product is an option in one slot of a template, never two
 *   on sale    every option is live and sold to everyone the bundle is for
 *   priced     the default configuration has a price, and no part out of
 *              stock, in every currency any market trades in
 *              (`market_currencies`). The simplest rule that is right for
 *              every buyer: whichever currency a buyer is kept in, it is one
 *              a market takes.
 */
create or replace function bundle_template_problem(p_template text, p_audiences text[]) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_rule bundle_rules;
  v_n    integer;
  v_s    text;
begin
  select * into v_rule from bundle_rules where id = 'standard';
  if v_rule.id is null then
    return 'there is no published composition rule to price it against.';
  end if;

  select count(*) into v_n from bundle_slots s
   where s.template_id = p_template
     and exists (select 1 from bundle_options o where o.slot_id = s.id);
  if v_n < v_rule.min_components then
    return format('a bundle needs at least %s parts that can be filled, and this one has %s.', v_rule.min_components, v_n);
  end if;
  if v_n > v_rule.max_components then
    return format('a bundle can have at most %s parts, and this one has %s.', v_rule.max_components, v_n);
  end if;

  select string_agg(s.label, ', ' order by s.sort_order) into v_s from bundle_slots s
   where s.template_id = p_template
     and (select count(*) from bundle_options o where o.slot_id = s.id) < greatest(s.min_pick, 1);
  if v_s is not null then
    return 'these parts offer fewer options than they ask the buyer to pick: ' || v_s || '.';
  end if;

  select coalesce(sum(s.min_pick), 0) into v_n from bundle_slots s where s.template_id = p_template;
  if v_n < v_rule.min_components then
    return format('whatever the buyer picks it has to come to at least %s products, and the required picks come to %s.', v_rule.min_components, v_n);
  end if;

  select string_agg(s.label, ', ' order by s.sort_order) into v_s from bundle_slots s
   where s.template_id = p_template and s.min_pick >= 1
     and (select count(*) from bundle_options o where o.slot_id = s.id and o.is_default)
         not between s.min_pick and s.max_pick;
  if v_s is not null then
    return 'each required part needs a default to start from (one, where the buyer picks one): ' || v_s || '.';
  end if;

  select string_agg(x.name, ', ') into v_s from (
    select p.name from bundle_options o
      join bundle_slots s on s.id = o.slot_id
      join products p on p.id = o.product_id
     where s.template_id = p_template
     group by p.id, p.name having count(*) > 1) x;
  if v_s is not null then
    return 'these are offered in more than one part — offer each in one: ' || v_s || '.';
  end if;

  select string_agg(p.name, ', ' order by p.name) into v_s
    from bundle_options o
    join bundle_slots s on s.id = o.slot_id
    join products p on p.id = o.product_id
   where s.template_id = p_template
     and (p.status <> 'live' or not (p_audiences <@ p.audiences));
  if v_s is not null then
    return 'these options are not on sale to everyone the bundle is for: ' || v_s || '.';
  end if;

  /* The default configuration is the one `bundle_default_choices` builds —
     the same rule as `defaultChoices`. Every value in it is an array. */
  select string_agg(p.name, ', ' order by p.name) into v_s
    from (select x ->> 'product_id' as product_id
            from jsonb_each(bundle_default_choices(p_template)) as e(slot_id, picks)
            cross join lateral jsonb_array_elements(e.picks) as x) d
    join products p on p.id = d.product_id
   where p.stock = 'out';
  if v_s is not null then
    return 'the default configuration has a part that is out of stock: ' || v_s || '.';
  end if;

  select string_agg(p.name || ' in ' || c.currency, ', ' order by p.name, c.currency) into v_s
    from (select x ->> 'product_id' as product_id
            from jsonb_each(bundle_default_choices(p_template)) as e(slot_id, picks)
            cross join lateral jsonb_array_elements(e.picks) as x) d
    join products p on p.id = d.product_id
    cross join (select distinct mc.currency from market_currencies mc) c
   where not exists (select 1 from product_prices pp
                      where pp.product_id = d.product_id and pp.currency = c.currency);
  if v_s is not null then
    return 'the default configuration has no price for ' || v_s || '.';
  end if;

  return null;
end $$;

/* ============================================================== pricing === */

/**
 * Price a configuration. Pure: reads the template and the price book, writes
 * nothing.
 *
 * `p_choices` is `{ "<slot id>": [{ "product_id": "SKU-5003", "quantity": 20 }] }`;
 * a slot left out is a slot with nothing picked. The checks run in the order
 * `validateChoices` runs them and say what it says.
 *
 * A buyer (consumer, enterprise) may price only a live template sold to them.
 * The operator, and a migration or the service role, may price any template —
 * that is the preview and the self-check, and buys nothing.
 *
 * Returns { template_id, currency, quantity, discount_pct, choices, lines,
 * parts_total, total, saving }, each line { slot_id, product_id, name,
 * partner_id, seller, per_bundle, quantity, list_unit_price, unit_price,
 * floor_unit_price, line_total, at_floor, sort_order }. `choices` is the
 * configuration as priced, every slot named.
 */
create or replace function price_bundle(p_template text, p_choices jsonb, p_currency text, p_quantity integer)
returns jsonb language plpgsql stable set search_path = public as $$
declare
  v_persona    text := current_persona();
  v_t          bundle_templates;
  v_slot       record;
  v_product    record;
  v_picks      jsonb;
  v_pick       jsonb;
  v_key        text;
  v_count      integer;
  v_bad        integer;
  v_pick_qty   integer;
  v_line_qty   integer;
  v_all        text[] := array[]::text[];
  v_norm       jsonb;
  v_choices    jsonb := '{}'::jsonb;
  v_lines      jsonb := '[]'::jsonb;
  v_list       numeric;
  v_floor      numeric;
  v_disc       numeric;
  v_unit       numeric;
  v_line_total numeric;
  v_total      numeric := 0;
  v_parts      numeric := 0;
  v_n          integer := 0;
begin
  select * into v_t from bundle_templates where id = p_template;
  if v_t.id is null then
    raise exception 'There is no bundle %.', coalesce(p_template, '(none)');
  end if;
  if v_persona = 'consumer' or v_persona = 'enterprise' then
    if v_t.status <> 'live' then
      raise exception '% is not on sale at the moment.', v_t.name;
    end if;
    if not (v_persona = any(v_t.audiences)) then
      raise exception '% is not sold to % buyers.', v_t.name, v_persona;
    end if;
  elsif v_persona is not null and v_persona <> 'operator' then
    raise exception 'Only a buyer or the marketplace can price a bundle.';
  end if;

  if p_currency is null or not exists (select 1 from currencies where code = p_currency) then
    raise exception 'Say which currency to price the bundle in.';
  end if;
  if p_quantity is null or p_quantity < 1 or p_quantity > 999 then
    raise exception 'A bundle quantity must be a whole number, at least 1 and at most 999.';
  end if;
  if jsonb_typeof(p_choices) is distinct from 'object' then
    raise exception 'Say what was chosen for each part of the bundle.';
  end if;

  select string_agg(k, ', ') into v_key
    from jsonb_object_keys(p_choices) k
   where not exists (select 1 from bundle_slots s where s.id = k and s.template_id = v_t.id);
  if v_key is not null then
    raise exception 'There is no such slot in this bundle: %', v_key;
  end if;

  for v_slot in
    select * from bundle_slots where template_id = v_t.id order by sort_order, id
  loop
    v_picks := coalesce(p_choices -> v_slot.id, '[]'::jsonb);
    if jsonb_typeof(v_picks) is distinct from 'array' then
      raise exception 'The choice for % has to be a list of picks.', v_slot.label;
    end if;
    v_count := jsonb_array_length(v_picks);

    if v_count < v_slot.min_pick then
      raise exception 'Pick at least % %', v_slot.min_pick, v_slot.label;
    end if;
    if v_count > v_slot.max_pick then
      raise exception 'Pick at most % %', v_slot.max_pick, v_slot.label;
    end if;

    select count(*) into v_bad from jsonb_array_elements(v_picks) x
     where jsonb_typeof(x) is distinct from 'object'
        or jsonb_typeof(x -> 'product_id') is distinct from 'string';
    if v_bad > 0 then
      raise exception 'Each pick for % names a product.', v_slot.label;
    end if;

    select count(*) into v_bad from jsonb_array_elements(v_picks) x
     where not exists (select 1 from bundle_options o
                        where o.slot_id = v_slot.id and o.product_id = x ->> 'product_id');
    if v_bad > 0 then
      raise exception 'A product picked for % is not an option there', v_slot.label;
    end if;

    select count(distinct x ->> 'product_id') into v_bad from jsonb_array_elements(v_picks) x;
    if v_bad <> v_count then
      raise exception 'Pick each % product only once', v_slot.label;
    end if;

    /* A whole number in range. The cast is inside the CASE so a string is
       reported as a bad quantity, not as a failed cast. */
    select count(*) into v_bad from jsonb_array_elements(v_picks) x
     where case when jsonb_typeof(x -> 'quantity') = 'number'
                then (x ->> 'quantity')::numeric <> trunc((x ->> 'quantity')::numeric)
                     or (x ->> 'quantity')::numeric < v_slot.qty_min
                     or (x ->> 'quantity')::numeric > v_slot.qty_max
                else true end;
    if v_bad > 0 then
      raise exception 'Choose % to % of each % (% unit% at most)',
        v_slot.qty_min, v_slot.qty_max, v_slot.label, v_slot.qty_max,
        case when v_slot.qty_max = 1 then '' else 's' end;
    end if;

    v_norm := '[]'::jsonb;
    for v_pick in
      select x.value from jsonb_array_elements(v_picks) with ordinality as x(value, ord) order by x.ord
    loop
      v_key := v_pick ->> 'product_id';
      v_pick_qty := (v_pick ->> 'quantity')::numeric::integer;   -- 20.0 is twenty

      if v_key = any(v_all) then
        raise exception '% is chosen in two parts of this bundle. Choose it once.', v_key;
      end if;
      v_all := array_append(v_all, v_key);

      select p.id, p.name, p.partner_id, p.seller, p.status, p.stock, p.audiences,
             pp.price as list, pp.floor_price as floor
        into v_product
        from products p
        left join product_prices pp on pp.product_id = p.id and pp.currency = p_currency
       where p.id = v_key;
      if not found then
        raise exception 'There is no listing %.', v_key;
      end if;
      if v_product.status is distinct from 'live' then
        raise exception '% is not on sale at the moment, so it cannot be part of the bundle.', v_product.name;
      end if;
      if v_product.stock = 'out' then
        raise exception '% is out of stock, so it cannot be part of the bundle.', v_product.name;
      end if;
      if (v_persona = 'consumer' or v_persona = 'enterprise') and not (v_persona = any(v_product.audiences)) then
        raise exception '% is not sold to % buyers.', v_product.name, v_persona;
      end if;
      if v_product.list is null then
        raise exception '% has no price in %, so the bundle cannot be priced in it.', v_product.name, p_currency;
      end if;

      /* The arithmetic in the header, line for line with `priceBundle`. */
      v_list       := v_product.list;
      v_floor      := round(coalesce(v_product.floor, 0), 2);
      v_line_qty   := v_pick_qty * p_quantity;
      v_disc       := round(v_list * (1 - v_t.discount_pct / 100), 2);
      v_unit       := greatest(v_disc, v_floor);
      v_line_total := round(v_unit * v_line_qty, 2);
      if v_list > 99999999.99 or v_line_total > 9999999999.99 then
        raise exception 'The line for % is larger than a bundle can carry. Choose fewer.', v_product.name;
      end if;
      v_total := v_total + v_line_total;
      v_parts := v_parts + round(v_list * v_line_qty, 2);
      v_n     := v_n + 1;

      v_lines := v_lines || jsonb_build_array(jsonb_build_object(
        'slot_id',          v_slot.id,
        'product_id',       v_product.id,
        'name',             v_product.name,
        'partner_id',       v_product.partner_id,
        'seller',           coalesce(v_product.seller, ''),
        'per_bundle',       v_pick_qty,
        'quantity',         v_line_qty,
        'list_unit_price',  v_list,
        'unit_price',       v_unit,
        'floor_unit_price', round(v_product.floor, 2),
        'line_total',       v_line_total,
        'at_floor',         v_disc < v_floor,
        'sort_order',       v_n));
      v_norm := v_norm || jsonb_build_array(jsonb_build_object('product_id', v_product.id, 'quantity', v_pick_qty));
    end loop;

    v_choices := v_choices || jsonb_build_object(v_slot.id, v_norm);
  end loop;

  if v_n = 0 then
    raise exception 'Choose at least one part.';
  end if;
  if v_parts > 9999999999.99 then
    raise exception 'This bundle is larger than one selection can carry. Choose fewer.';
  end if;

  return jsonb_build_object(
    'template_id',  v_t.id,
    'currency',     p_currency,
    'quantity',     p_quantity,
    'discount_pct', v_t.discount_pct,
    'choices',      v_choices,
    'lines',        v_lines,
    'parts_total',  v_parts,
    'total',        v_total,
    'saving',       v_parts - v_total);
end $$;

/**
 * Price a configuration and write it down for the caller, held seven days.
 * Returns the selection id.
 *
 * The owner and the money come from who is asking, never from the client: a
 * business buyer configures for their account, in the account's currency; a
 * shopper for themselves, in the currency their profile is kept in (what
 * `loadHome` in src/lib/moneyRepo.ts reads). `p_currency` must be that
 * currency — it is passed so a screen that priced in something else is told,
 * not silently corrected.
 */
create or replace function configure_bundle(p_template text, p_choices jsonb, p_currency text, p_quantity integer)
returns text language plpgsql security definer set search_path = public as $$
declare
  v_persona text := current_persona();
  v_uid     uuid := auth.uid();
  v_account text;
  v_user    uuid;
  v_home    text;
  v_price   jsonb;
  v_id      text;
  v_now     timestamptz := now();
begin
  if v_persona = 'consumer' then
    if v_uid is null then
      raise exception 'Sign in to configure a bundle.';
    end if;
    select p.currency into v_home from consumer_profile p where p.user_id = v_uid order by p.id limit 1;
    if v_home is null then
      raise exception 'Your account has no home currency yet, so a bundle cannot be priced for you. Finish setting up your profile first.';
    end if;
    v_user := v_uid;
  elsif v_persona = 'enterprise' then
    v_account := current_account_id();
    if v_account is null or not exists (
         select 1 from enterprise_users u
          where u.user_id = v_uid and u.account_id = v_account and u.status = 'active') then
      raise exception 'You are not an active member of a business account, so you cannot configure a bundle on its behalf.';
    end if;
    select a.currency into v_home from enterprise_accounts a where a.id = v_account;
    if v_home is null then
      raise exception 'Your account has no currency, so a bundle cannot be priced for it.';
    end if;
  else
    raise exception 'Only a signed-in shopper or business buyer can configure a bundle.';
  end if;

  if p_currency is distinct from v_home then
    raise exception 'Your account is kept in %, so the bundle is priced in %, not %.',
      v_home, v_home, coalesce(p_currency, 'nothing');
  end if;

  v_price := price_bundle(p_template, p_choices, p_currency, p_quantity);

  insert into bundle_selections (template_id, account_id, user_id, currency, choices, quantity,
                                 total, parts_total, priced_at, valid_until)
  values (p_template, v_account, v_user, p_currency, v_price -> 'choices', p_quantity,
          (v_price ->> 'total')::numeric, (v_price ->> 'parts_total')::numeric,
          v_now, v_now + interval '7 days')
  returning id into v_id;

  insert into bundle_selection_lines (selection_id, product_id, name, partner_id, seller, quantity,
                                      list_unit_price, unit_price, floor_unit_price, sort_order)
  select v_id, l ->> 'product_id', l ->> 'name', l ->> 'partner_id', l ->> 'seller',
         (l ->> 'quantity')::integer, (l ->> 'list_unit_price')::numeric,
         (l ->> 'unit_price')::numeric, (l ->> 'floor_unit_price')::numeric,
         (l ->> 'sort_order')::integer
    from jsonb_array_elements(v_price -> 'lines') l;

  return v_id;
end $$;

/* ================================================== the template guards === */

/**
 * A template within the published rule, and on sale only when it can be sold.
 *
 * The discount cap is checked on every write, whoever writes it — it is a
 * fact about the data, not about who is asking. Whenever the row is (or
 * becomes) `live`, `bundle_template_problem` must have nothing to say, so a
 * template is built as a draft, given its slots, and then published.
 */
create or replace function guard_bundle_template() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_rule    bundle_rules;
  v_problem text;
begin
  select * into v_rule from bundle_rules where id = 'standard';
  if v_rule.id is null then
    raise exception 'There is no published composition rule (bundle_rules ''standard''), so no bundle can be priced against it.';
  end if;
  if new.discount_pct > v_rule.max_discount then
    raise exception 'A bundle can take at most % off under the published rule, not %.',
      v_rule.max_discount || '%', new.discount_pct || '%';
  end if;

  new.name := btrim(new.name);
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();

  if new.status = 'live' then
    v_problem := bundle_template_problem(new.id, new.audiences);
    if v_problem is not null then
      raise exception '% cannot go on sale: %', new.name, v_problem;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists bundle_templates_guard on bundle_templates;
create trigger bundle_templates_guard before insert or update on bundle_templates
  for each row execute function guard_bundle_template();

/* What a buyer may be choosing from right now does not change under them.
   Pause the template, change it, publish it again — and the publish check
   looks at it afresh. */
create or replace function guard_bundle_slot() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if tg_op = 'DELETE' then
    select t.status into v_status from bundle_templates t where t.id = old.template_id;
    if v_status = 'live' then
      raise exception 'Pause the bundle before taking a part out of it.';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.template_id is distinct from old.template_id then
    raise exception 'A part stays in the bundle it was made for.';
  end if;
  select t.status into v_status from bundle_templates t where t.id = new.template_id;
  if v_status = 'live' then
    raise exception 'Pause the bundle before changing its parts — a buyer may be choosing from them right now.';
  end if;
  new.label := btrim(new.label);
  return new;
end $$;

drop trigger if exists bundle_slots_guard on bundle_slots;
create trigger bundle_slots_guard before insert or update or delete on bundle_slots
  for each row execute function guard_bundle_slot();

create or replace function guard_bundle_option() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_status text;
begin
  if tg_op = 'DELETE' then
    select t.status into v_status
      from bundle_slots s join bundle_templates t on t.id = s.template_id where s.id = old.slot_id;
    if v_status = 'live' then
      raise exception 'Pause the bundle before taking an option out of it.';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.slot_id is distinct from old.slot_id then
    raise exception 'An option stays in the part it was offered in. Remove it and add it to the other.';
  end if;
  select t.status into v_status
    from bundle_slots s join bundle_templates t on t.id = s.template_id where s.id = new.slot_id;
  if v_status = 'live' then
    raise exception 'Pause the bundle before changing its options — a buyer may be choosing from them right now.';
  end if;
  return new;
end $$;

drop trigger if exists bundle_options_guard on bundle_options;
create trigger bundle_options_guard before insert or update or delete on bundle_options
  for each row execute function guard_bundle_option();

/* ============================================= the guards on the lines === */

/**
 * A basket line that says it is part of a bundle has to be.
 *
 * Only acts when `bundle_selection_id` is set. The selection is the caller's;
 * the line is one of its products at its quantity; the selection is inside its
 * seven days and every part is still on sale. A basket line carries no price —
 * checkout takes it from the selection, and `guard_bundle_order_line` holds
 * the order to it. Toggling "saved" or anything else the guard did not vouch
 * for goes straight through.
 */
create or replace function guard_bundle_cart_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_s    bundle_selections;
  v_l    bundle_selection_lines;
  v_gone text;
begin
  if current_persona() is null then return new; end if;
  /* Detaching is refused — except the foreign key's own `set null` once the
     selection itself has been deleted (`operator_delete_bundle_selections`). */
  if tg_op = 'UPDATE' and old.bundle_selection_id is not null
     and new.bundle_selection_id is distinct from old.bundle_selection_id
     and exists (select 1 from bundle_selections x where x.id = old.bundle_selection_id) then
    raise exception 'A part of a bundle stays part of it. Remove the bundle and add it again instead.';
  end if;
  if new.bundle_selection_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.bundle_selection_id is not distinct from old.bundle_selection_id
     and new.product_id is not distinct from old.product_id
     and new.quantity is not distinct from old.quantity
     and new.user_id is not distinct from old.user_id then
    return new;
  end if;

  select * into v_s from bundle_selections where id = new.bundle_selection_id;
  if v_s.id is null then
    raise exception 'There is no configured bundle %.', new.bundle_selection_id;
  end if;
  if v_s.user_id is null or v_s.user_id is distinct from new.user_id then
    raise exception 'That bundle was configured by somebody else, so it cannot go in this basket.';
  end if;
  select * into v_l from bundle_selection_lines where selection_id = v_s.id and product_id = new.product_id;
  if v_l.id is null then
    raise exception '% is not part of that bundle.', new.product_id;
  end if;
  if new.quantity is distinct from v_l.quantity then
    raise exception 'That bundle has % of %, not %. Change the bundle quantity by configuring it again.',
      v_l.quantity, v_l.name, new.quantity;
  end if;
  if v_s.valid_until < now() then
    raise exception 'The price of that bundle was held until %. Re-price it to add it to the basket.',
      to_char(v_s.valid_until, 'DD Mon YYYY');
  end if;
  v_gone := bundle_part_unavailable(v_s.id, v_s.currency);
  if v_gone is not null then
    raise exception '% is no longer available as it was configured, so the bundle cannot be bought. Edit the bundle to continue.', v_gone;
  end if;
  return new;
end $$;

drop trigger if exists cart_items_bundle_guard on cart_items;
create trigger cart_items_bundle_guard before insert or update on cart_items
  for each row execute function guard_bundle_cart_line();

/* A bundle moves as one: removing any part removes the rest, and saving one
   part for later saves the rest. */
create or replace function bundle_cart_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.bundle_selection_id is not null then
      delete from cart_items
       where bundle_selection_id = old.bundle_selection_id
         and user_id is not distinct from old.user_id;
    end if;
    return null;
  end if;
  if new.bundle_selection_id is not null and new.saved is distinct from old.saved then
    update cart_items set saved = new.saved
     where bundle_selection_id = new.bundle_selection_id
       and user_id is not distinct from new.user_id
       and saved is distinct from new.saved;
  end if;
  return null;
end $$;

drop trigger if exists cart_items_bundle_follow on cart_items;
create trigger cart_items_bundle_follow after update or delete on cart_items
  for each row execute function bundle_cart_follow();

/**
 * A requisition line that says it is part of a bundle has to be — and is
 * priced from it.
 *
 * Only acts when `bundle_selection_id` is set. Same account and the same
 * money as the requisition; one of the selection's products, at its quantity
 * and its unit price; inside the seven days when it goes onto the
 * requisition (that is when a requisition is raised); every part still on
 * sale. The existing `guard_requisition_line` still decides whether the
 * requisition can take lines at all.
 */
create or replace function guard_bundle_requisition_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_s    bundle_selections;
  v_l    bundle_selection_lines;
  v_req  record;
  v_gone text;
begin
  if current_persona() is null then return new; end if;
  /* Detaching is refused — except the foreign key's own `set null` once the
     selection itself has been deleted (`operator_delete_bundle_selections`). */
  if tg_op = 'UPDATE' and old.bundle_selection_id is not null
     and new.bundle_selection_id is distinct from old.bundle_selection_id
     and exists (select 1 from bundle_selections x where x.id = old.bundle_selection_id) then
    raise exception 'A part of a bundle stays part of it. Remove the bundle and add it again instead.';
  end if;
  if new.bundle_selection_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.bundle_selection_id is not distinct from old.bundle_selection_id
     and new.requisition_id is not distinct from old.requisition_id
     and new.product_id is not distinct from old.product_id
     and new.quantity is not distinct from old.quantity
     and new.unit_price is not distinct from old.unit_price
     and new.line_total is not distinct from old.line_total then
    return new;
  end if;

  select * into v_s from bundle_selections where id = new.bundle_selection_id;
  if v_s.id is null then
    raise exception 'There is no configured bundle %.', new.bundle_selection_id;
  end if;
  select r.account_id, r.currency into v_req from enterprise_requisitions r where r.id = new.requisition_id;
  if v_req.account_id is null then
    raise exception 'There is no requisition %.', new.requisition_id;
  end if;
  if v_s.account_id is null or v_s.account_id is distinct from v_req.account_id then
    raise exception 'That bundle was configured for another account.';
  end if;
  if v_s.currency is distinct from v_req.currency then
    raise exception 'That bundle is priced in % and this requisition is in %.', v_s.currency, v_req.currency;
  end if;
  select * into v_l from bundle_selection_lines where selection_id = v_s.id and product_id = new.product_id;
  if v_l.id is null then
    raise exception '% is not part of that bundle.', coalesce(new.name, new.product_id, 'That line');
  end if;
  if new.quantity is distinct from v_l.quantity then
    raise exception 'That bundle has % of %, not %. Change the bundle quantity by configuring it again.',
      v_l.quantity, v_l.name, new.quantity;
  end if;
  if new.unit_price is distinct from v_l.unit_price then
    raise exception '% is priced at % in that bundle, not %.', v_l.name, v_l.unit_price, new.unit_price;
  end if;
  if v_s.valid_until < now() then
    raise exception 'The price of that bundle was held until %. Re-price it to raise it.',
      to_char(v_s.valid_until, 'DD Mon YYYY');
  end if;
  v_gone := bundle_part_unavailable(v_s.id, v_s.currency);
  if v_gone is not null then
    raise exception '% is no longer available as it was configured, so the bundle cannot be raised. Edit the bundle to continue.', v_gone;
  end if;
  return new;
end $$;

drop trigger if exists enterprise_requisition_lines_bundle_guard on enterprise_requisition_lines;
create trigger enterprise_requisition_lines_bundle_guard
  before insert or update on enterprise_requisition_lines
  for each row execute function guard_bundle_requisition_line();

/* Removing a part of a bundle from a pending requisition removes the rest. A
   decided requisition is a record and keeps its lines (`guard_requisition_line`
   refuses to touch them anyway). */
create or replace function bundle_requisition_follow() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if old.bundle_selection_id is not null
     and exists (select 1 from enterprise_requisitions r where r.id = old.requisition_id and r.state = 'pending') then
    delete from enterprise_requisition_lines
     where requisition_id = old.requisition_id
       and bundle_selection_id = old.bundle_selection_id;
  end if;
  return null;
end $$;

drop trigger if exists enterprise_requisition_lines_bundle_follow on enterprise_requisition_lines;
create trigger enterprise_requisition_lines_bundle_follow after delete on enterprise_requisition_lines
  for each row execute function bundle_requisition_follow();

/**
 * An order line that says it is part of a bundle has to be — at its price.
 *
 * Only acts when `bundle_selection_id` is set. The order belongs to the
 * selection's owner (the account for a business order, the shopper
 * otherwise) and is in the selection's money; the line is one of its
 * products at its quantity and unit price. A shopper's order is the moment of
 * purchase, so it must also be inside the seven days with every part on sale.
 * A business order comes from an approved requisition, whose lines were held
 * to the same when it was raised; refusing it now would make the approval one
 * nobody can act on.
 */
create or replace function guard_bundle_order_line() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_s    bundle_selections;
  v_l    bundle_selection_lines;
  v_o    record;
  v_gone text;
begin
  if current_persona() is null then return new; end if;
  /* Detaching is refused — except the foreign key's own `set null` once the
     selection itself has been deleted (`operator_delete_bundle_selections`). */
  if tg_op = 'UPDATE' and old.bundle_selection_id is not null
     and new.bundle_selection_id is distinct from old.bundle_selection_id
     and exists (select 1 from bundle_selections x where x.id = old.bundle_selection_id) then
    raise exception 'A part of a bundle stays part of it.';
  end if;
  if new.bundle_selection_id is null then return new; end if;
  if tg_op = 'UPDATE'
     and new.bundle_selection_id is not distinct from old.bundle_selection_id
     and new.order_id is not distinct from old.order_id
     and new.product_id is not distinct from old.product_id
     and new.quantity is not distinct from old.quantity
     and new.price is not distinct from old.price then
    return new;
  end if;

  select * into v_s from bundle_selections where id = new.bundle_selection_id;
  if v_s.id is null then
    raise exception 'There is no configured bundle %.', new.bundle_selection_id;
  end if;
  select o.id, o.user_id, o.account_id, o.currency into v_o from orders o where o.id = new.order_id;
  if v_o.id is null then
    raise exception 'There is no order %.', new.order_id;
  end if;
  if v_o.account_id is not null then
    if v_s.account_id is distinct from v_o.account_id then
      raise exception 'That bundle was configured for another account.';
    end if;
  elsif v_s.user_id is null or v_s.user_id is distinct from v_o.user_id then
    raise exception 'That bundle was configured by somebody else, so it cannot be on this order.';
  end if;
  if v_s.currency is distinct from v_o.currency then
    raise exception 'That bundle is priced in % and this order is in %.', v_s.currency, coalesce(v_o.currency, 'no currency');
  end if;
  select * into v_l from bundle_selection_lines where selection_id = v_s.id and product_id = new.product_id;
  if v_l.id is null then
    raise exception '% is not part of that bundle.', coalesce(new.product_name, new.product_id);
  end if;
  if new.quantity is distinct from v_l.quantity then
    raise exception 'That bundle has % of %, not %.', v_l.quantity, v_l.name, new.quantity;
  end if;
  if new.price is distinct from v_l.unit_price then
    raise exception '% is priced at % in that bundle, not %.', v_l.name, v_l.unit_price, new.price;
  end if;
  /* Each part of a selection is bought once. Without this, a request written
     by hand could order the discounted part again and again, at the bundle's
     price, for as long as the selection's price is held. The selection row is
     locked first so two orders placed at the same moment are counted one after
     the other. An order undone after a failed payment takes its items with it,
     so a retry is not refused. */
  perform 1 from bundle_selections where id = v_s.id for update;
  if exists (select 1 from order_items oi
              where oi.bundle_selection_id = v_s.id
                and oi.product_id = new.product_id
                and oi.id is distinct from new.id) then
    raise exception '% from that bundle has already been ordered. Configure the bundle again to buy it again.', v_l.name;
  end if;
  if v_o.account_id is null then
    if v_s.valid_until < now() then
      raise exception 'The price of that bundle was held until %. Re-price it before checking out.',
        to_char(v_s.valid_until, 'DD Mon YYYY');
    end if;
    v_gone := bundle_part_unavailable(v_s.id, v_s.currency);
    if v_gone is not null then
      raise exception '% is no longer available as it was configured, so the bundle cannot be bought. Edit the bundle to continue.', v_gone;
    end if;

    /* Bought whole, for a shopper. Checkout places one order per seller, each
       in its own request, and `guard_order_seller` keeps an order to one
       seller — so a bundle whose parts come from three sellers arrives as
       three orders, and no single order can hold it. Instead, at the moment
       each part is ordered, every other part of the selection must be either
       still in this shopper's basket (same product and quantity) or already
       ordered by them.

       Accepted residual risk: a shopper who removes the rest of the bundle
       from their basket between two of checkout's requests buys part of a
       bundle at its bundle price. No seller is below its floor (every price
       on the selection was held at or above it), so what is exposed is the
       marketplace's discount on that part, nothing a seller agreed not to
       give. */
    select string_agg(l.name, ', ' order by l.sort_order) into v_gone
      from bundle_selection_lines l
     where l.selection_id = v_s.id
       and l.product_id is distinct from new.product_id
       and not exists (select 1 from cart_items c
                        where c.bundle_selection_id = v_s.id and c.user_id = v_s.user_id
                          and c.product_id = l.product_id and c.quantity = l.quantity)
       and not exists (select 1 from order_items oi join orders o on o.id = oi.order_id
                        where oi.bundle_selection_id = v_s.id and o.user_id = v_s.user_id
                          and o.account_id is null
                          and oi.product_id = l.product_id and oi.quantity = l.quantity);
    if v_gone is not null then
      raise exception 'A bundle is bought whole, and these parts of it are neither in the basket nor ordered: %. Add the bundle again.', v_gone;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists order_items_bundle_guard on order_items;
create trigger order_items_bundle_guard before insert or update on order_items
  for each row execute function guard_bundle_order_line();

/* ---------------------------------------------------- bought whole -- */

/* A bundle goes in whole or not at all. Checked when the transaction commits,
   so the parts can arrive in one insert (each PostgREST request is one
   transaction): every part of the selection is there, once. A selection whose
   lines were all removed again in the same transaction has nothing to check. */
create or replace function bundle_cart_complete() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_have integer; v_need integer;
begin
  if new.bundle_selection_id is null or current_persona() is null then return null; end if;
  select count(*) into v_have from cart_items
   where bundle_selection_id = new.bundle_selection_id and user_id is not distinct from new.user_id;
  if v_have = 0 then return null; end if;
  select count(*) into v_need from bundle_selection_lines where selection_id = new.bundle_selection_id;
  if v_have <> v_need then
    raise exception 'A bundle goes into the basket whole: % of its % parts are there. Add it again from the bundle.', v_have, v_need;
  end if;
  return null;
end $$;

drop trigger if exists cart_items_bundle_whole on cart_items;
create constraint trigger cart_items_bundle_whole
  after insert or update of bundle_selection_id, product_id, user_id on cart_items
  deferrable initially deferred
  for each row when (new.bundle_selection_id is not null)
  execute function bundle_cart_complete();

create or replace function bundle_requisition_complete() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_have integer; v_need integer;
begin
  if new.bundle_selection_id is null or current_persona() is null then return null; end if;
  select count(*) into v_have from enterprise_requisition_lines
   where requisition_id = new.requisition_id and bundle_selection_id = new.bundle_selection_id;
  if v_have = 0 then return null; end if;
  select count(*) into v_need from bundle_selection_lines where selection_id = new.bundle_selection_id;
  if v_have <> v_need then
    raise exception 'A bundle goes onto a requisition whole: % of its % parts are there.', v_have, v_need;
  end if;
  return null;
end $$;

drop trigger if exists enterprise_requisition_lines_bundle_whole on enterprise_requisition_lines;
create constraint trigger enterprise_requisition_lines_bundle_whole
  after insert or update of bundle_selection_id, product_id, requisition_id on enterprise_requisition_lines
  deferrable initially deferred
  for each row when (new.bundle_selection_id is not null)
  execute function bundle_requisition_complete();

/* Per order only where one order holds the whole bundle: a business order,
   which `place_requisition_order` writes from the requisition in one insert. A
   shopper's bundle spans one order per seller and is checked line by line in
   `guard_bundle_order_line` instead. */
create or replace function bundle_order_complete() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_have integer; v_need integer;
begin
  if new.bundle_selection_id is null or current_persona() is null then return null; end if;
  if not exists (select 1 from orders o where o.id = new.order_id and o.account_id is not null) then
    return null;
  end if;
  select count(*) into v_have from order_items
   where order_id = new.order_id and bundle_selection_id = new.bundle_selection_id;
  if v_have = 0 then return null; end if;
  select count(*) into v_need from bundle_selection_lines where selection_id = new.bundle_selection_id;
  if v_have <> v_need then
    raise exception 'A bundle is ordered whole: % of its % parts are on the order.', v_have, v_need;
  end if;
  return null;
end $$;

drop trigger if exists order_items_bundle_whole on order_items;
create constraint trigger order_items_bundle_whole
  after insert or update of bundle_selection_id, product_id, order_id on order_items
  deferrable initially deferred
  for each row when (new.bundle_selection_id is not null)
  execute function bundle_order_complete();

/* ============================================ the order a requisition becomes === */

/**
 * `place_requisition_order`, as `20260809250000` left it, plus one branch.
 *
 * A requisition carrying a bundle is ordered line by line: every line of the
 * requisition goes onto the order at its own unit price, and a bundle line
 * keeps its `bundle_selection_id`, so the order says what was bought as a
 * bundle and each seller settles its own parts at their share. The order
 * names a seller only when every line is that seller's (`guard_order_seller`
 * reads null as "spans sellers"). The whole bundle is on one order, so
 * `bundle_order_complete` checks it whole at commit.
 *
 * A requisition with no bundle line goes down exactly the path it always did:
 * the same checks in the same order, the header's product and quantity, the
 * line named after the product. Only the test for "is there a bundle on it"
 * comes before the product check, because a bundle requisition names no
 * single product.
 */
create or replace function public.place_requisition_order(p_req_id text)
returns text language plpgsql security definer
set search_path to 'public', 'extensions' as $$
declare
  req      record;
  prod     record;
  acct     record;
  rate     numeric;
  ref      text;
  oid      uuid;
  sub      numeric;
  tax      numeric;
  extant   text;
  v_bundle boolean;
  v_sum    numeric;
  v_seller text;
  v_bad    text;
begin
  select * into req from enterprise_requisitions where id = p_req_id;
  if req.id is null then raise exception 'No such requisition.'; end if;
  if req.state <> 'approved' then
    raise exception '% is %, so there is nothing to order.', req.id, req.state;
  end if;

  if coalesce(req.credit_hold, false) then
    raise exception
      '% is held on credit and cannot go to the seller yet. %',
      req.id, coalesce(req.credit_note, 'Finance can release it against an early payment.');
  end if;

  v_bundle := exists (select 1 from enterprise_requisition_lines l
                       where l.requisition_id = req.id and l.bundle_selection_id is not null);

  if not v_bundle and req.product_id is null then
    raise exception '% does not say what it is buying, so no order line can be written for it.', req.id;
  end if;

  select order_ref into extant from orders where requisition_id = req.id limit 1;
  if extant is not null then
    update enterprise_requisitions set order_ref = extant
     where id = req.id and order_ref is distinct from extant;
    return extant;
  end if;

  if v_bundle then
    select string_agg(l.name, ', ' order by l.sort_order) into v_bad
      from enterprise_requisition_lines l
     where l.requisition_id = req.id and l.product_id is null;
    if v_bad is not null then
      raise exception '% has lines that name no listing (%), so no order line can be written for them.', req.id, v_bad;
    end if;
    select coalesce(sum(l.line_total), 0) into v_sum
      from enterprise_requisition_lines l where l.requisition_id = req.id;
    if v_sum is distinct from req.amount then
      raise exception '% was approved for % but its lines add up to %, so it cannot be ordered as it stands.',
        req.id, req.amount, v_sum;
    end if;
    select case when count(distinct p.seller) = 1 then min(p.seller) end into v_seller
      from enterprise_requisition_lines l join products p on p.id = l.product_id
     where l.requisition_id = req.id;
  else
    select * into prod from products where id = req.product_id;
    v_seller := prod.seller;
  end if;

  select * into acct from enterprise_accounts where id = req.account_id;

  select m.tax_rate into rate from markets m where m.code = coalesce(acct.market, 'IN');
  rate := coalesce(rate, 0);

  sub := round(req.amount / (1 + rate / 100), 2);
  tax := round(req.amount - sub, 2);

  ref := 'ORD-8821' || right(regexp_replace(req.id, '\D', '', 'g'), 2);
  while exists (select 1 from orders where order_ref = ref) loop
    ref := 'ORD-8821' || right(regexp_replace(req.id, '\D', '', 'g'), 2)
           || '-' || substr(md5(clock_timestamp()::text), 1, 3);
  end loop;

  oid := gen_random_uuid();
  insert into orders (
    id, order_ref, status, total, subtotal, tax, discount, payment_method,
    buyer_name, buyer_email, created_at, placed_date, seller, vertical,
    failed, stage, stages, account_id, requisition_id, ordered_by,
    cost_centre, po_ref, currency, market, tax_rate)
  values (
    oid, ref, 'placed', req.amount, sub, tax, 0, 'On account — Net 30',
    acct.company, (select u.email from enterprise_users u where u.id = req.raised_by),
    now(), to_char(now(), 'DD Mon YYYY'),
    v_seller, req.vertical,
    false, 1, array['Ordered', 'Approved', 'Packed', 'In transit', 'Delivered'],
    req.account_id, req.id, req.raised_by,
    req.cost_centre, req.po_ref, req.currency, coalesce(acct.market, 'IN'), rate);

  if v_bundle then
    /* Every line, in one insert, at the price the requisition was approved
       at; the product's own name, as every order line carries. */
    insert into order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status,
                             bundle_selection_id)
    select gen_random_uuid(), oid, l.product_id, p.name, l.unit_price, l.quantity, 'pending', 'placed',
           l.bundle_selection_id
      from enterprise_requisition_lines l join products p on p.id = l.product_id
     where l.requisition_id = req.id
     order by l.sort_order, l.id;
  else
    /* The product's name, not the requisition's title (20260809250000). */
    insert into order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status)
    values (gen_random_uuid(), oid, prod.id, prod.name,
            round(req.amount / greatest(req.quantity, 1), 2), req.quantity, 'pending', 'placed');
  end if;

  update enterprise_requisitions set order_ref = ref where id = req.id;
  return ref;
end $$;

grant execute on function public.place_requisition_order(text) to authenticated;

/* ================================================================= RLS === */

alter table bundle_templates       enable row level security;
alter table bundle_slots           enable row level security;
alter table bundle_options         enable row level security;
alter table bundle_selections      enable row level security;
alter table bundle_selection_lines enable row level security;

/* Supabase grants everything to anon and authenticated by default, so these
   narrow it: the storefront reads templates signed out; only the operator
   (through the policies) writes them; selections are read, never written,
   by anybody but `configure_bundle`. */
grant select on bundle_templates, bundle_slots, bundle_options to anon, authenticated;
grant insert, update, delete on bundle_templates, bundle_slots, bundle_options to authenticated;
revoke insert, update, delete, truncate on bundle_templates, bundle_slots, bundle_options from anon;
revoke truncate on bundle_templates, bundle_slots, bundle_options from authenticated;
revoke all on bundle_selections, bundle_selection_lines from anon;
grant select on bundle_selections, bundle_selection_lines to authenticated;
revoke insert, update, delete, truncate on bundle_selections, bundle_selection_lines from authenticated;
/* Delete, for the operator alone (the policy below): cleaning up after a test
   or a mistake. Lines go with it; basket lines go too; requisition and order
   lines keep their price and lose the link (`on delete set null`, which the
   detach guards let through once the selection is gone). */
grant delete on bundle_selections to authenticated;
grant usage on sequence bundle_template_seq to authenticated;

drop policy if exists "operator_all_bundle_templates"      on bundle_templates;
drop policy if exists "shop_read_bundle_templates"         on bundle_templates;
drop policy if exists "owner_read_bundle_templates"        on bundle_templates;
drop policy if exists "operator_all_bundle_slots"          on bundle_slots;
drop policy if exists "shop_read_bundle_slots"             on bundle_slots;
drop policy if exists "operator_all_bundle_options"        on bundle_options;
drop policy if exists "shop_read_bundle_options"           on bundle_options;
drop policy if exists "operator_read_bundle_selections"    on bundle_selections;
drop policy if exists "owner_read_bundle_selections"       on bundle_selections;
drop policy if exists "operator_delete_bundle_selections"  on bundle_selections;
drop policy if exists "operator_read_bundle_selection_lines" on bundle_selection_lines;
drop policy if exists "owner_read_bundle_selection_lines"  on bundle_selection_lines;

/* The operator authors templates, and only the operator. */
create policy "operator_all_bundle_templates" on bundle_templates for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "operator_all_bundle_slots" on bundle_slots for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "operator_all_bundle_options" on bundle_options for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* The shop: a live template, to the audience it is for. Signed out is a
   shopper who has not signed in yet, so sees the consumer ones. */
create policy "shop_read_bundle_templates" on bundle_templates for select to anon, authenticated
  using (status = 'live'
         and ((auth.uid() is null and 'consumer' = any(audiences))
              or coalesce(current_persona() = any(audiences), false)));
/* And whatever a buyer already configured from, paused since or not — the
   basket still has to say what the bundle was. (Authenticated only: anon has
   no right to read selections, and a policy that asked would fail.) */
create policy "owner_read_bundle_templates" on bundle_templates for select to authenticated
  using (exists (select 1 from bundle_selections s where s.template_id = bundle_templates.id));

/* Slots and options follow the template, through its own policies. */
create policy "shop_read_bundle_slots" on bundle_slots for select to anon, authenticated
  using (exists (select 1 from bundle_templates t where t.id = bundle_slots.template_id));
create policy "shop_read_bundle_options" on bundle_options for select to anon, authenticated
  using (exists (select 1 from bundle_slots s where s.id = bundle_options.slot_id));

/* Selections: the buyer's own, and the operator's view of all. No insert or
   update policy for anybody — `configure_bundle` writes them — and only the
   operator may delete one. */
create policy "operator_read_bundle_selections" on bundle_selections for select to authenticated
  using (current_persona() = 'operator');
create policy "operator_delete_bundle_selections" on bundle_selections for delete to authenticated
  using (current_persona() = 'operator');
create policy "owner_read_bundle_selections" on bundle_selections for select to authenticated
  using ((current_persona() = 'consumer' and user_id = auth.uid())
      or (current_persona() = 'enterprise' and account_id = current_account_id()));
create policy "operator_read_bundle_selection_lines" on bundle_selection_lines for select to authenticated
  using (current_persona() = 'operator');
create policy "owner_read_bundle_selection_lines" on bundle_selection_lines for select to authenticated
  using (exists (select 1 from bundle_selections s where s.id = bundle_selection_lines.selection_id));

/* ------------------------------------------------------ function grants -- */

/* Pricing and configuring are for signed-in buyers (and the operator's
   preview). A signed-out shopper sees the estimate `priceBundle` works out on
   the page; the server price is shown once they sign in to buy, so there is
   nothing to gain from opening the database's pricing to anon. */
revoke all on function price_bundle(text, jsonb, text, integer) from public, anon;
revoke all on function configure_bundle(text, jsonb, text, integer) from public, anon;
revoke all on function bundle_default_choices(text) from public, anon;
grant execute on function price_bundle(text, jsonb, text, integer) to authenticated;
grant execute on function configure_bundle(text, jsonb, text, integer) to authenticated;
grant execute on function bundle_default_choices(text) to authenticated;

/* Internal. Definer functions that read past RLS; the guards call them. */
revoke all on function bundle_part_unavailable(text, text) from public, anon, authenticated;
revoke all on function bundle_template_problem(text, text[]) from public, anon, authenticated;

/* ================================================================ seed === */

/* Two templates from listings on sale today, so both shops have a
 * configurable bundle on first run.
 *
 *   Smart office starter kit (business)   climate sensors or trackers ·
 *                                         connectivity · a gateway or a
 *                                         firewall (optional)
 *   Home security bundle (shopper)        a tracker · device protection ·
 *                                         cloud backup (optional)
 *
 * Not the occupancy sensor (SKU-5004): it has been paused since
 * 20260805040000 while its cell supplier is late.
 *
 * The listings are checked first and the block stops with their names if any
 * is not live or is out of stock — a seed built from what is not on sale would
 * be refused by the publish check further down anyway, with a less useful
 * sentence. Publishing goes through `guard_bundle_template`, so the seed
 * passes the same check the operator's templates do.
 *
 * Re-runnable without losing anybody's selection: the templates are upserted
 * and set back to draft, their slots (and with them their options) deleted
 * and written again by their `BS-SEED-`/`BO-SEED-` ids, then published.
 */
do $$
declare
  v_missing text;
begin
  select string_agg(x.id || coalesce(' (' || p.status || ', stock ' || p.stock || ')', ' (no such listing)'), ', ')
    into v_missing
    from unnest(array['SKU-5003', 'SKU-5005', 'SKU-5001', 'SKU-5002', 'SKU-5007', 'SKU-6001',
                      'SKU-2004', 'SKU-3007']) as x(id)
    left join products p on p.id = x.id
   where p.id is null or p.status <> 'live' or p.stock = 'out';
  if v_missing is not null then
    raise exception 'The bundle seed is built from listings on sale today, and these are not: %. Choose others in this block before applying it.', v_missing;
  end if;

  update bundle_templates set status = 'draft' where id like 'BT-SEED-%' and status <> 'draft';
  delete from bundle_slots where template_id like 'BT-SEED-%';

  insert into bundle_templates (id, name, description, image, status, audiences, discount_pct) values
    ('BT-SEED-OFFICE', 'Smart office starter kit',
     'Climate sensors or asset trackers for the floor, the SIMs to connect them, and a gateway or a managed firewall if the site needs one. Choose how many of each.',
     'https://images.pexels.com/photos/2569842/pexels-photo-2569842.jpeg?auto=compress&cs=tinysrgb&w=600',
     'draft', array['enterprise'], 8.00),
    ('BT-SEED-HOME', 'Home security bundle',
     'A tracker for the car or the bike, cover against theft and accidental damage for your phones, and cloud backup if you want it. One price for the lot.',
     'https://images.pexels.com/photos/1213294/pexels-photo-1213294.jpeg?auto=compress&cs=tinysrgb&w=600',
     'draft', array['consumer'], 10.00)
  on conflict (id) do update set
    name = excluded.name, description = excluded.description, image = excluded.image,
    audiences = excluded.audiences, discount_pct = excluded.discount_pct, status = 'draft';

  insert into bundle_slots (id, template_id, label, min_pick, max_pick, qty_min, qty_max, qty_default, sort_order) values
    ('BS-SEED-OFFICE-1', 'BT-SEED-OFFICE', 'Sensors and trackers', 1, 2, 5, 100, 20, 1),
    ('BS-SEED-OFFICE-2', 'BT-SEED-OFFICE', 'Connectivity',        1, 1, 5, 100, 20, 2),
    ('BS-SEED-OFFICE-3', 'BT-SEED-OFFICE', 'Gateway or security', 0, 1, 1,   5,  1, 3),
    ('BS-SEED-HOME-1',   'BT-SEED-HOME',   'Tracker',             1, 1, 1,   3,  1, 1),
    ('BS-SEED-HOME-2',   'BT-SEED-HOME',   'Device protection',   1, 1, 1,   4,  1, 2),
    ('BS-SEED-HOME-3',   'BT-SEED-HOME',   'Cloud backup',        0, 1, 1,   1,  1, 3);

  insert into bundle_options (id, slot_id, product_id, is_default, sort_order) values
    ('BO-SEED-OFFICE-1-1', 'BS-SEED-OFFICE-1', 'SKU-5003', true,  1),
    ('BO-SEED-OFFICE-1-2', 'BS-SEED-OFFICE-1', 'SKU-5005', false, 2),
    ('BO-SEED-OFFICE-2-1', 'BS-SEED-OFFICE-2', 'SKU-5001', true,  1),
    ('BO-SEED-OFFICE-2-2', 'BS-SEED-OFFICE-2', 'SKU-5002', false, 2),
    ('BO-SEED-OFFICE-3-1', 'BS-SEED-OFFICE-3', 'SKU-5007', false, 1),
    ('BO-SEED-OFFICE-3-2', 'BS-SEED-OFFICE-3', 'SKU-6001', false, 2),
    ('BO-SEED-HOME-1-1',   'BS-SEED-HOME-1',   'SKU-5005', true,  1),
    ('BO-SEED-HOME-2-1',   'BS-SEED-HOME-2',   'SKU-2004', true,  1),
    ('BO-SEED-HOME-3-1',   'BS-SEED-HOME-3',   'SKU-3007', false, 1);

  /* Through the publish check, like any other. */
  update bundle_templates set status = 'live' where id in ('BT-SEED-OFFICE', 'BT-SEED-HOME');
end $$;

/* ================================================================ help === */

/* No new screen, so no new article: the builder is a section of Catalogue
 * Review and the configurator opens inside the shops' existing views. The
 * Catalogue Review article (view `op-catalogue`) gains a "Configurable
 * bundles" section. Written by heading, so running this again replaces the
 * section rather than adding a second; skipped with a notice if there is no
 * such article or its body is not a list of blocks.
 */
do $$
declare
  v_id      text;
  v_body    jsonb;
  v_section jsonb := jsonb_build_object('kind', 'prose', 'heading', 'Configurable bundles',
    'text', 'Beside Compose a bundle, Configurable bundles lets you build a bundle the buyer finishes: give it parts, say which listings each part offers, how many picks it takes and in what quantities, which option it starts with, and how much off the whole is — never more than the published bundle rule allows. A draft can be changed freely. Publishing checks that it has between the rule''s fewest and most parts, that every option is live and sold to everyone the bundle is for, and that the starting configuration has a price in every currency a market trades in; if anything is missing it says what. To change a live bundle, pause it first. A buyer''s configured price is held for seven days, and no seller is ever priced below their agreed floor — a part that would be is held at it.');
begin
  select a.id, a.body into v_id, v_body from public.kb_articles a
   where a.view = 'op-catalogue' and 'operator' = any(a.personas)
   order by a.sort_order, a.id limit 1;
  if v_id is null then
    raise notice 'no Catalogue Review article to add the bundles section to';
    return;
  end if;
  if jsonb_typeof(v_body) is distinct from 'array' then
    raise notice 'the Catalogue Review article % has a body that is not a list of blocks; left as it is', v_id;
    return;
  end if;
  update public.kb_articles
     set body = (select coalesce(jsonb_agg(x.b order by x.i), '[]'::jsonb)
                   from jsonb_array_elements(v_body) with ordinality as x(b, i)
                  where x.b ->> 'heading' is distinct from 'Configurable bundles')
                || jsonb_build_array(v_section)
   where id = v_id;
  raise notice 'Catalogue Review article % has a Configurable bundles section', v_id;
end $$;

/* --------------------------------------------------------- what is true -- */

do $$
declare
  n       integer;
  t       text;
  c       text;
  v_price jsonb;
  v_sum   numeric;
begin
  /* RLS is on at all. A policy on a table with RLS off is decoration. */
  foreach t in array array['bundle_templates', 'bundle_slots', 'bundle_options',
                           'bundle_selections', 'bundle_selection_lines'] loop
    select count(*) into n from pg_class where oid = t::regclass and relrowsecurity;
    if n <> 1 then raise exception 'row level security is off on %', t; end if;
  end loop;

  /* Nobody writes a selection but configure_bundle. */
  if has_table_privilege('anon', 'bundle_selections', 'delete') then
    raise exception 'anon can delete selections';
  end if;
  foreach t in array array['anon', 'authenticated'] loop
    if has_table_privilege(t, 'bundle_selections', 'insert')
       or has_table_privilege(t, 'bundle_selections', 'update')
       or has_table_privilege(t, 'bundle_selection_lines', 'insert')
       or has_table_privilege(t, 'bundle_selection_lines', 'update')
       or has_table_privilege(t, 'bundle_selection_lines', 'delete') then
      raise exception '% can still write selections directly', t;
    end if;
  end loop;
  if has_table_privilege('anon', 'bundle_templates', 'insert') then
    raise exception 'anon can still write bundle templates';
  end if;
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename in ('bundle_selections', 'bundle_selection_lines')
     and cmd in ('INSERT', 'UPDATE', 'ALL');
  if n <> 0 then raise exception '% write policies on selections; there should be none', n; end if;
  /* The one delete policy is the operator's. */
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename in ('bundle_selections', 'bundle_selection_lines') and cmd = 'DELETE';
  if n <> 1 then raise exception 'expected one delete policy on selections, found %', n; end if;
  select count(*) into n from pg_policies
   where schemaname = 'public' and tablename = 'bundle_selections'
     and policyname = 'operator_delete_bundle_selections' and cmd = 'DELETE';
  if n <> 1 then raise exception 'the operator cannot delete selections'; end if;

  /* The functions are callable by whom they are for, and by nobody else. */
  if has_function_privilege('anon', 'configure_bundle(text, jsonb, text, integer)', 'execute')
     or has_function_privilege('anon', 'price_bundle(text, jsonb, text, integer)', 'execute') then
    raise exception 'anon can call price_bundle or configure_bundle';
  end if;
  if not has_function_privilege('authenticated', 'configure_bundle(text, jsonb, text, integer)', 'execute')
     or not has_function_privilege('authenticated', 'price_bundle(text, jsonb, text, integer)', 'execute') then
    raise exception 'a signed-in buyer cannot call price_bundle or configure_bundle';
  end if;
  if has_function_privilege('authenticated', 'bundle_template_problem(text, text[])', 'execute')
     or has_function_privilege('authenticated', 'bundle_part_unavailable(text, text)', 'execute') then
    raise exception 'the internal bundle helpers are callable from the API';
  end if;

  /* Every guard is attached. */
  select count(*) into n from pg_trigger
   where not tgisinternal and tgname in (
     'bundle_templates_guard', 'bundle_slots_guard', 'bundle_options_guard',
     'cart_items_bundle_guard', 'cart_items_bundle_follow', 'cart_items_bundle_whole',
     'enterprise_requisition_lines_bundle_guard', 'enterprise_requisition_lines_bundle_follow',
     'enterprise_requisition_lines_bundle_whole',
     'order_items_bundle_guard', 'order_items_bundle_whole');
  if n <> 11 then raise exception 'expected 11 bundle triggers, found %', n; end if;

  /* And the ones already there are still there beside them. */
  select count(*) into n from pg_trigger
   where not tgisinternal and tgname in ('enterprise_requisition_lines_guard', 'enterprise_requisition_lines_quoted_guard',
                                         'cart_items_shoppable_guard', 'order_items_shoppable_guard');
  if n <> 4 then raise exception 'an existing line guard went missing (found % of 4)', n; end if;

  /* The seed: two live templates of three parts each. */
  select count(*) into n from bundle_templates where id like 'BT-SEED-%' and status = 'live';
  if n <> 2 then raise exception 'expected 2 live seeded bundles, found %', n; end if;
  select count(*) into n from bundle_slots where template_id like 'BT-SEED-%';
  if n <> 6 then raise exception 'expected 6 seeded bundle parts, found %', n; end if;

  /* Every live template is within the rule and publishable as it stands. */
  select count(*) into n from bundle_templates t
   where t.status = 'live' and bundle_template_problem(t.id, t.audiences) is not null;
  if n > 0 then raise exception '% live bundles would not pass the publish check', n; end if;

  /* Each seeded bundle prices in every currency a market trades in, through
     the same function a buyer calls: total is the sum of its lines, no line
     is below its floor, and the saving is real. */
  for t in select id from bundle_templates where id like 'BT-SEED-%' order by id loop
    for c in select distinct currency from market_currencies order by 1 loop
      v_price := price_bundle(t, bundle_default_choices(t), c, 1);
      select coalesce(sum((l ->> 'line_total')::numeric), 0) into v_sum
        from jsonb_array_elements(v_price -> 'lines') l;
      if v_sum <> (v_price ->> 'total')::numeric then
        raise exception '% in %: the total % is not the sum of its lines %', t, c, v_price ->> 'total', v_sum;
      end if;
      select count(*) into n from jsonb_array_elements(v_price -> 'lines') l
       where (l ->> 'unit_price')::numeric < coalesce((l ->> 'floor_unit_price')::numeric, 0);
      if n > 0 then raise exception '% in % prices % parts below their floor', t, c, n; end if;
      if (v_price ->> 'saving')::numeric <= 0 then
        raise exception '% in % saves the buyer nothing', t, c;
      end if;
      select count(*) into n from jsonb_array_elements(v_price -> 'lines') l;
      if n < 2 then raise exception '% in % prices % parts; a bundle has at least two', t, c, n; end if;
    end loop;
  end loop;

  /* A requisition carrying a bundle is ordered line by line, and every check
     the order path had before is still in it. */
  select pg_get_functiondef(p.oid) into t from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'place_requisition_order';
  if t not like '%l.bundle_selection_id%' then
    raise exception 'place_requisition_order does not carry bundle lines onto the order';
  end if;
  if t not like '%credit_hold%' or t not like '%oid, prod.id, prod.name%'
     or t not like '%does not say what it is buying%' or t not like '%from orders where requisition_id = req.id%' then
    raise exception 'place_requisition_order lost a check it had before';
  end if;

  /* The Catalogue Review article, if there is one, explains them once. */
  /* The CASE keeps jsonb_array_elements away from a body that is not a list,
     whatever order the planner applies the filters in. */
  select count(*) into n
    from public.kb_articles a
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(a.body) = 'array' then a.body else '[]'::jsonb end) b
   where a.view = 'op-catalogue' and b ->> 'heading' = 'Configurable bundles';
  if n > 1 then raise exception 'the Catalogue Review help has % Configurable bundles sections', n; end if;
end $$;
