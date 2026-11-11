/* A business bundle is billed one way.
 *
 * A requisition is approved as one commitment: a one-off purchase or a
 * monthly subscription, never both (`addBundleToBasket`, src/lib/bundleLines.ts).
 * The seeded office kit asked for a sensor (one-off) and a SIM (monthly) in
 * every configuration, so no business buyer could ever put it on a
 * requisition — each attempt wrote a selection and was then refused.
 *
 * So, from now on:
 *
 *   1. A template sold to business buyers (`'enterprise' = any(audiences)`)
 *      has one billing model across every option it offers: all its option
 *      products share `products.model`. `bundle_template_problem` says so, and
 *      the publish guard (`guard_bundle_template`) refuses such a template.
 *      A template sold only to shoppers is not restricted; the shopper's
 *      basket takes one-off and monthly parts together.
 *
 *   2. The office kit is rebuilt one-off only: sensors and trackers, and the
 *      gateway they report through. No SIMs (the gateway carries its own
 *      LTE-M), no managed firewall (monthly).
 *
 * The rule is mirrored in `draftProblems` (the operator's builder) and in
 * `requisitionBillingBlock` (the business configurator, said before
 * `configure_bundle` writes anything). This file is the one that decides.
 *
 * 20261105200000 is applied and is not edited. Re-runnable: the function is
 * replaced, and the office kit is set back to draft, its slots (and with them
 * their options) deleted and written again by their `BS-SEED-OFFICE-` /
 * `BO-SEED-OFFICE-` ids, then published through the guard. A selection
 * already made of the office kit stays: it names the template, not the slots.
 */

/* ============================================== the publish check, again === */

/**
 * Why a template may not go on sale, in a sentence, or null when it may.
 * Every check of 20261105200000, in its order and its words, and one more:
 *
 *   billed     a template sold to business buyers offers parts of one billing
 *              model only (`products.model`), because a requisition is
 *              approved as one commitment
 */
create or replace function bundle_template_problem(p_template text, p_audiences text[]) returns text
language plpgsql stable security definer set search_path = public as $$
declare
  v_rule bundle_rules;
  v_n    integer;
  v_s    text;
  v_m    text;
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

  /* Billed one way, for business buyers: every option, not just the defaults,
     since the buyer may pick any of them. */
  if 'enterprise' = any(p_audiences) then
    select count(distinct p.model) into v_n
      from bundle_options o
      join bundle_slots s on s.id = o.slot_id
      join products p on p.id = o.product_id
     where s.template_id = p_template;
    if v_n > 1 then
      select string_agg(x.label, ' and ' order by x.label) into v_m
        from (select distinct (case p.model when 'oneoff' then 'one-off' else p.model end) as label
                from bundle_options o
                join bundle_slots s on s.id = o.slot_id
                join products p on p.id = o.product_id
               where s.template_id = p_template) x;
      select string_agg(p.name || ' (' || (case p.model when 'oneoff' then 'one-off' else p.model end) || ')',
                        ', ' order by p.model, p.name) into v_s
        from bundle_options o
        join bundle_slots s on s.id = o.slot_id
        join products p on p.id = o.product_id
       where s.template_id = p_template;
      return 'a bundle for business buyers is billed one way, and this one mixes ' || v_m || ' parts: ' || v_s || '.';
    end if;
  end if;

  return null;
end $$;

/* Still internal: the guards call it, nobody else. */
revoke all on function bundle_template_problem(text, text[]) from public, anon, authenticated;

/* ================================================== the office kit, again === */

/* One-off only: sensors or trackers for the floor, and the gateway they
 * report through.
 *
 *   Sensors and trackers   SKU-5003 (default), SKU-5005   pick 1–2, 5–100 each, 20
 *   Gateway                SKU-5007 (default)             pick 1,   1–5,        1
 *
 * The listings are checked first and the block stops with their names if any
 * is not live, is out of stock, or is not one-off.
 */
do $$
declare
  v_missing text;
begin
  select string_agg(x.id || coalesce(' (' || p.status || ', stock ' || p.stock || ', ' || p.model || ')', ' (no such listing)'), ', ')
    into v_missing
    from unnest(array['SKU-5003', 'SKU-5005', 'SKU-5007']) as x(id)
    left join products p on p.id = x.id
   where p.id is null or p.status <> 'live' or p.stock = 'out' or p.model <> 'oneoff';
  if v_missing is not null then
    raise exception 'The office kit is rebuilt from one-off listings on sale today, and these are not: %. Choose others in this block before applying it.', v_missing;
  end if;

  update bundle_templates set status = 'draft' where id = 'BT-SEED-OFFICE' and status <> 'draft';
  delete from bundle_slots where template_id = 'BT-SEED-OFFICE';

  insert into bundle_templates (id, name, description, image, status, audiences, discount_pct) values
    ('BT-SEED-OFFICE', 'Smart office starter kit',
     'Climate sensors or asset trackers for the floor, and the LTE-M gateway they report through. Choose how many of each; everything is bought outright.',
     'https://images.pexels.com/photos/2569842/pexels-photo-2569842.jpeg?auto=compress&cs=tinysrgb&w=600',
     'draft', array['enterprise'], 8.00)
  on conflict (id) do update set
    name = excluded.name, description = excluded.description,
    audiences = excluded.audiences, discount_pct = excluded.discount_pct, status = 'draft';

  insert into bundle_slots (id, template_id, label, min_pick, max_pick, qty_min, qty_max, qty_default, sort_order) values
    ('BS-SEED-OFFICE-1', 'BT-SEED-OFFICE', 'Sensors and trackers', 1, 2, 5, 100, 20, 1),
    ('BS-SEED-OFFICE-2', 'BT-SEED-OFFICE', 'Gateway',              1, 1, 1,   5,  1, 2);

  insert into bundle_options (id, slot_id, product_id, is_default, sort_order) values
    ('BO-SEED-OFFICE-1-1', 'BS-SEED-OFFICE-1', 'SKU-5003', true,  1),
    ('BO-SEED-OFFICE-1-2', 'BS-SEED-OFFICE-1', 'SKU-5005', false, 2),
    ('BO-SEED-OFFICE-2-1', 'BS-SEED-OFFICE-2', 'SKU-5007', true,  1);

  /* Through the publish check, like any other. */
  update bundle_templates set status = 'live' where id = 'BT-SEED-OFFICE';
end $$;

/* --------------------------------------------------------- what is true -- */

do $$
declare
  n       integer;
  c       text;
  v_price jsonb;
  v_sum   numeric;
  v_names text;
begin
  /* The rule is in the function. */
  if pg_get_functiondef('bundle_template_problem(text, text[])'::regprocedure)
       not like '%a bundle for business buyers is billed one way%' then
    raise exception 'bundle_template_problem does not check that a business bundle is billed one way';
  end if;
  if has_function_privilege('authenticated', 'bundle_template_problem(text, text[])', 'execute') then
    raise exception 'bundle_template_problem is callable from the API';
  end if;

  /* Every live template passes the publish check as it stands, the new rule
     with it; and no live business template mixes models. */
  select string_agg(t.id, ', ' order by t.id) into v_names from bundle_templates t
   where t.status = 'live' and bundle_template_problem(t.id, t.audiences) is not null;
  if v_names is not null then
    raise exception 'these live bundles would not pass the publish check: %', v_names;
  end if;
  select string_agg(x.id, ', ' order by x.id) into v_names from (
    select t.id from bundle_templates t
      join bundle_slots s on s.template_id = t.id
      join bundle_options o on o.slot_id = s.id
      join products p on p.id = o.product_id
     where t.status = 'live' and 'enterprise' = any(t.audiences)
     group by t.id having count(distinct p.model) > 1) x;
  if v_names is not null then
    raise exception 'these live business bundles mix billing models: %', v_names;
  end if;

  /* The office kit: live, two parts, three options. */
  select count(*) into n from bundle_templates where id = 'BT-SEED-OFFICE' and status = 'live';
  if n <> 1 then raise exception 'the office kit is not live'; end if;
  select count(*) into n from bundle_slots where template_id = 'BT-SEED-OFFICE';
  if n <> 2 then raise exception 'expected 2 parts in the office kit, found %', n; end if;
  select count(*) into n from bundle_options o join bundle_slots s on s.id = o.slot_id
   where s.template_id = 'BT-SEED-OFFICE';
  if n <> 3 then raise exception 'expected 3 options in the office kit, found %', n; end if;

  /* It prices in every currency a market trades in, through the function a
     buyer calls, and its default parts are all billed one way. */
  for c in select distinct currency from market_currencies order by 1 loop
    v_price := price_bundle('BT-SEED-OFFICE', bundle_default_choices('BT-SEED-OFFICE'), c, 1);
    select coalesce(sum((l ->> 'line_total')::numeric), 0) into v_sum
      from jsonb_array_elements(v_price -> 'lines') l;
    if v_sum <> (v_price ->> 'total')::numeric then
      raise exception 'the office kit in %: the total % is not the sum of its lines %', c, v_price ->> 'total', v_sum;
    end if;
    select count(*) into n from jsonb_array_elements(v_price -> 'lines') l
     where (l ->> 'unit_price')::numeric < coalesce((l ->> 'floor_unit_price')::numeric, 0);
    if n > 0 then raise exception 'the office kit in % prices % parts below their floor', c, n; end if;
    if (v_price ->> 'saving')::numeric <= 0 then
      raise exception 'the office kit in % saves the buyer nothing', c;
    end if;
    select count(*) into n from jsonb_array_elements(v_price -> 'lines') l;
    if n < 2 then raise exception 'the office kit in % prices % parts; a bundle has at least two', c, n; end if;
    select count(distinct p.model) into n
      from jsonb_array_elements(v_price -> 'lines') l
      join products p on p.id = l ->> 'product_id';
    if n <> 1 then raise exception 'the office kit in %: its default parts are billed % ways', c, n; end if;
  end loop;
end $$;
