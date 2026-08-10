/* A renewal run for subscriptions the marketplace does not own.
 *
 * `renew_subscriptions()` charged and rolled every active subscription on file.
 * It should never have touched most of them: a subscription sold by a seller is
 * renewed by that seller. Halo Audio decides whether a Halo Music Family
 * subscription renews on the 11th, takes the money for it, and tells us. The
 * marketplace's job is to hold the record, not to drive the cycle — and a run
 * that rolled Halo's date on Halo's behalf was quietly asserting a renewal that
 * may never have happened.
 *
 * The split is `products.partner_id`:
 *
 *   - null — Aventa is the seller. Aventa Freedom, Family Safety, Digital Life,
 *     IoT Connect. The marketplace renews these because the marketplace is the
 *     one billing for them.
 *   - a seller — the vendor renews it and reports it. StreamNova, PlayForge,
 *     Halo, Aegis, ClearVault, Beacon. These are the digital, one-off and
 *     resold-telco lines, which is exactly the shape that is vendor-maintained.
 *
 * Not `fulfilment_route`: Beacon resells telco services that Aventa provisions,
 * and the renewal is still Beacon's. Who fulfils and who renews are different
 * questions, and the second one is answered by who sold it.
 *
 * So the run gains two things and loses one. It loses the right to renew what it
 * does not own. It gains `awaiting` — the vendor-maintained subscriptions whose
 * date has come with no report — because the difference between "renewed" and
 * "nobody has told us" is the whole point, and silence is what the old run was
 * manufacturing. And it gains an inbound path, `report_renewal`, for a vendor to
 * say what they charged and when, which is the only thing that may move a
 * vendor-maintained date.
 */

/* ------------------------------------------------------ who owns the date -- */

/**
 * The seller who maintains this product's renewals, or null when we do.
 *
 * One place, because the run, the report, the vendor's book and the chase list
 * all ask it and four copies of a rule drift the first time it changes.
 */
create or replace function public.renewal_vendor(p_product_id text)
returns text language sql stable set search_path = public as $$
  select partner_id from public.products where id = p_product_id
$$;

comment on function public.renewal_vendor(text) is
  'The seller who renews this product, or null when the marketplace is the seller and renews it itself.';

grant execute on function public.renewal_vendor(text) to authenticated;

/* ------------------------------------------ where a vendor report is kept -- */

/* A charge now records who raised it. Every row already on file was raised by
   the run, which at the time could only mean the marketplace. */
alter table public.subscription_charge
  add column if not exists source      text not null default 'marketplace',
  add column if not exists vendor_id   text references public.partners(id),
  add column if not exists vendor_ref  text,
  add column if not exists reported_by text,
  add column if not exists reported_at timestamptz;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'charge_source_is_known') then
    alter table public.subscription_charge add constraint charge_source_is_known
      check (source in ('marketplace', 'vendor'));
  end if;
  /* A vendor charge that cannot say which vendor, or carries no reference back
     to the vendor's own record of it, is not a report — it is an assertion. And
     a marketplace charge carrying a vendor is a contradiction. */
  if not exists (select 1 from pg_constraint where conname = 'vendor_charge_names_its_vendor') then
    alter table public.subscription_charge add constraint vendor_charge_names_its_vendor
      check (
        (source = 'vendor'      and vendor_id is not null and coalesce(vendor_ref, '') <> '')
        or
        (source = 'marketplace' and vendor_id is null     and vendor_ref is null)
      );
  end if;
end $$;

comment on column public.subscription_charge.source is
  'Who raised it: the marketplace''s own run, or a vendor reporting a renewal they took.';
comment on column public.subscription_charge.vendor_ref is
  'The vendor''s own reference for the renewal, so a dispute can be traced back to their record of it.';

create index if not exists subscription_charge_vendor_idx
  on public.subscription_charge (vendor_id, period_start);

/* A seller reads the renewals they reported. Not the customer behind them —
   that is on the subscription, not here, and a seller who needs to chase a
   customer does it through the marketplace. */
drop policy if exists vendor_reads_own_subscription_charge on public.subscription_charge;
create policy vendor_reads_own_subscription_charge on public.subscription_charge
  for select using (vendor_id is not null and vendor_id = public.current_partner_id());

/* ------------------------------------------------------------- the report -- */

/**
 * A vendor telling us they renewed a subscription.
 *
 * This is the only thing that moves a vendor-maintained renewal date. It records
 * what they charged, for which cycle, against their own reference, and then
 * rolls the date by exactly one cycle — one report, one cycle. A vendor three
 * cycles behind reports three times, and the gap stays visible until they do.
 *
 * The operator may file one on a vendor's behalf, which is what happens when a
 * vendor reports by email or on a call, and the row says so rather than
 * pretending the vendor filed it.
 */
create or replace function public.report_renewal(
  p_ref text, p_period_start date, p_vendor_ref text, p_amount numeric default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s        public.subscriptions;
  vendor   text;
  vname    text;
  persona  text := public.current_persona();
  mine     text := public.current_partner_id();
  months   integer;
  p_end    date;
  amount   numeric;
  new_id   text;
  actor    text;
begin
  select * into s from public.subscriptions where ref = p_ref;
  if s.ref is null then raise exception 'There is no subscription %.', p_ref; end if;

  vendor := public.renewal_vendor(s.product_id);
  if vendor is null then
    raise exception
      '% is sold by the marketplace, so there is no vendor renewal to report. The renewal run raises it.',
      p_ref;
  end if;
  select name into vname from public.partners where id = vendor;

  if persona = 'partner' then
    if mine is distinct from vendor then
      raise exception '% is renewed by %, not by you.', p_ref, coalesce(vname, vendor);
    end if;
    actor := coalesce(vname, vendor);
  elsif persona = 'operator' then
    actor := format('Operator, on behalf of %s', coalesce(vname, vendor));
  else
    raise exception 'Only the seller who renews a subscription, or the marketplace on their behalf, may report a renewal.';
  end if;

  /* Before anything about whether this cycle is due: a report we already hold is
     a retry, and a retry is answered rather than refused. Asked after the due
     check it would never be reached — the first report moves the date, so the
     second one arrives about a cycle that is no longer due and would come back
     as an error to a vendor who had done nothing wrong. */
  if exists (select 1 from public.subscription_charge
              where subscription_id = s.id and period_start = p_period_start) then
    return jsonb_build_object('ok', true, 'already', true, 'ref', p_ref,
      'period', p_period_start, 'renews_next', s.next_renewal,
      'note', 'This cycle was already reported. Nothing was raised twice and the date did not move again.');
  end if;

  if s.status <> 'active' then
    raise exception '% is %, so nothing renewed.', p_ref, s.status;
  end if;
  if not s.auto_renew then
    raise exception
      'Auto-renew is off on %. It lapses on % rather than renewing, and a renewal reported against it would contradict what the customer was told.',
      p_ref, s.next_renewal;
  end if;
  if s.ends_at is not null and s.ends_at <= s.next_renewal then
    raise exception '% ends on %, before the renewal on %. Nothing renewed.', p_ref, s.ends_at, s.next_renewal;
  end if;
  if p_period_start > current_date then
    raise exception
      'A renewal cannot be reported for a cycle starting %. A period that has not started has not been used, and charging for it is charging for nothing.',
      p_period_start;
  end if;
  /* The cycle that is due, not whichever one the caller names. Reporting out of
     order would leave a gap nothing would ever chase. */
  if p_period_start is distinct from s.next_renewal then
    raise exception 'The cycle due on % is the one to report for %, not %.',
      s.next_renewal, p_ref, p_period_start;
  end if;

  amount := round(coalesce(p_amount, s.price), 2);
  if amount < 0 then
    raise exception 'A renewal of % cannot be a negative amount. Reverse it with a credit note.', p_ref;
  end if;

  months := public.cycle_length(s.cycle);
  p_end  := (p_period_start + make_interval(months => months) - interval '1 day')::date;
  new_id := format('SC-%s-%s', s.ref, to_char(p_period_start, 'YYYYMM'));

  insert into public.subscription_charge
    (id, subscription_id, ref, user_id, product_id, product_name, seller,
     period_start, period_end, period_label, amount, currency,
     source, vendor_id, vendor_ref, reported_by, reported_at)
  values
    (new_id, s.id, s.ref, s.user_id, s.product_id, s.product_name, s.seller,
     p_period_start, p_end, to_char(p_period_start, 'Mon YYYY'), amount, s.currency,
     'vendor', vendor, p_vendor_ref, actor, now())
  on conflict (subscription_id, period_start) do nothing;

  if not found then
    return jsonb_build_object('ok', true, 'already', true, 'ref', p_ref,
      'period', p_period_start, 'note', 'This cycle was already reported. Nothing was raised twice.');
  end if;

  /* One report, one cycle. */
  update public.subscriptions
     set next_renewal = (p_period_start + make_interval(months => months))::date
   where id = s.id;

  return jsonb_build_object(
    'ok', true, 'already', false, 'ref', p_ref, 'vendor', coalesce(vname, vendor),
    'reported_by', actor, 'period', p_period_start, 'period_end', p_end,
    'amount', amount, 'currency', s.currency,
    'renews_next', (p_period_start + make_interval(months => months))::date);
end $$;

revoke all on function public.report_renewal(text, date, text, numeric) from public;
grant execute on function public.report_renewal(text, date, text, numeric) to authenticated;

/* ---------------------------------------------------------------- the run -- */

/**
 * Renew what the marketplace sells, and report what it is waiting on.
 *
 * `awaiting` is the half that did not exist. A vendor-maintained subscription
 * whose date has come is not skipped work — it is somebody else's work that has
 * not arrived, and the only useful thing a run can do with it is name the vendor
 * and say how late they are.
 */
create or replace function public.renew_subscriptions(
  p_as_of date default current_date, p_actor text default 'Renewal scheduler')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s        record;
  months   integer;
  p_start  date;
  p_end    date;
  vendor   text;
  vname    text;
  charged  integer := 0;
  already  integer := 0;
  rolled   integer := 0;
  skips    jsonb := '[]'::jsonb;
  waits    jsonb := '[]'::jsonb;
  new_id   text;
begin
  if public.current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace runs renewals.';
  end if;

  if p_as_of > current_date then
    raise exception
      'A renewal run cannot be dated %. A period that has not started has not been used, and charging for it is charging for nothing.',
      p_as_of;
  end if;

  for s in
    select * from public.subscriptions
     where status = 'active' and next_renewal is not null and next_renewal <= p_as_of
     order by next_renewal, ref
  loop
    months := public.cycle_length(s.cycle);

    /* A subscription that ends before its next renewal does not renew. It ends,
       and saying so is better than charging somebody for a cycle they had
       already cancelled out of. Before the ownership question, because a lapsed
       subscription is nobody's to renew. */
    if s.ends_at is not null and s.ends_at <= s.next_renewal then
      skips := skips || jsonb_build_object(
        'ref', s.ref, 'product', s.product_name, 'reason',
        format('Ends on %s, before the renewal on %s. Nothing renewed and nothing charged.',
               s.ends_at, s.next_renewal));
      continue;
    end if;

    if not s.auto_renew then
      skips := skips || jsonb_build_object(
        'ref', s.ref, 'product', s.product_name, 'reason',
        format('Auto-renew is off. It lapses on %s rather than renewing, and the customer has to take it again.',
               s.next_renewal));
      continue;
    end if;

    /* Not ours to renew. */
    vendor := public.renewal_vendor(s.product_id);
    if vendor is not null then
      select name into vname from public.partners where id = vendor;
      waits := waits || jsonb_build_object(
        'ref', s.ref, 'product', s.product_name,
        'vendor_id', vendor, 'vendor', coalesce(vname, vendor),
        'due', s.next_renewal, 'days_late', (p_as_of - s.next_renewal),
        'reason', format(
          '%s renews this one and has not reported the cycle due on %s. The marketplace does not roll a date it does not own — chase the vendor.',
          coalesce(vname, vendor), s.next_renewal));
      continue;
    end if;

    /* The cycle that starts on the renewal date. */
    p_start := s.next_renewal;
    p_end   := (p_start + make_interval(months => months) - interval '1 day')::date;
    new_id  := format('SC-%s-%s', s.ref, to_char(p_start, 'YYYYMM'));

    insert into public.subscription_charge
      (id, subscription_id, ref, user_id, product_id, product_name, seller,
       period_start, period_end, period_label, amount, currency, source)
    values
      (new_id, s.id, s.ref, s.user_id, s.product_id, s.product_name, s.seller,
       p_start, p_end, to_char(p_start, 'Mon YYYY'), s.price, s.currency, 'marketplace')
    on conflict (subscription_id, period_start) do nothing;

    if found then charged := charged + 1; else already := already + 1; end if;

    /* Forward by whole cycles from the agreed date, so somebody billed on the
       9th stays on the 9th. "Today plus a month" would walk the billing day
       every time a run was late. */
    while p_start < p_as_of or p_start = s.next_renewal loop
      p_start := (p_start + make_interval(months => months))::date;
      exit when p_start > p_as_of;
    end loop;

    update public.subscriptions set next_renewal = p_start where id = s.id;
    rolled := rolled + 1;
  end loop;

  return jsonb_build_object(
    'ran_on', p_as_of, 'ran_by', p_actor,
    'charged', charged, 'already', already, 'rolled', rolled,
    'skipped', skips, 'awaiting', waits);
end $$;

revoke all on function public.renew_subscriptions(date, text) from public;
grant execute on function public.renew_subscriptions(date, text) to authenticated;

/* `roll_renewals` moves a date without charging anybody, which is a repair the
   marketplace may make to its own book and may not make to a vendor's. Left in
   place, narrowed to what we sell. */
create or replace function public.roll_renewals(p_on date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  s record;
  next date;
  n integer := 0;
begin
  for s in
    select sub.ref, sub.next_renewal, sub.cycle from public.subscriptions sub
     where sub.status = 'active' and sub.next_renewal is not null and sub.next_renewal < p_on
       and public.renewal_vendor(sub.product_id) is null
  loop
    next := s.next_renewal;
    while next < p_on loop
      next := (next + make_interval(months => public.cycle_length(s.cycle)))::date;
    end loop;
    update public.subscriptions set next_renewal = next where ref = s.ref;
    n := n + 1;
  end loop;
  return n;
end $$;

comment on function public.roll_renewals(date) is
  'Moves an overdue renewal forward by whole cycles, for subscriptions the marketplace sells. A repair, not a billing run — nothing here charges anybody, and it will not touch a date a vendor owns.';

/* ------------------------------------------------------------ the vendor's -- */

/**
 * What a vendor has to report, and what they have already reported.
 *
 * A function rather than a view because a seller may not read `subscriptions` —
 * that table carries the customer behind every row, and a seller's answer to
 * "which renewals are mine" should not come with the marketplace's customer
 * list attached. This returns the subscription, not the subscriber.
 */
create or replace function public.vendor_renewal_book(
  p_partner text default null, p_as_of date default current_date)
returns table (
  ref text, product_id text, product_name text, cycle text,
  price numeric, currency text, due date, days_late integer,
  reported boolean, last_reported date, vendor_ref text)
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if public.current_persona() = 'partner' then
    who := public.current_partner_id();
  elsif public.current_persona() = 'operator' then
    who := p_partner;
    if who is null then raise exception 'Which seller''s book?'; end if;
  else
    raise exception 'A renewal book belongs to the seller who maintains it.';
  end if;
  if who is null then raise exception 'You are not signed in as a seller.'; end if;

  return query
    select s.ref, s.product_id, s.product_name, s.cycle, s.price, s.currency,
           s.next_renewal,
           greatest(0, (p_as_of - s.next_renewal))::integer,
           c.id is not null,
           last.period_start,
           last.vendor_ref
      from public.subscriptions s
      left join public.subscription_charge c
             on c.subscription_id = s.id and c.period_start = s.next_renewal
      left join lateral (
             select x.period_start, x.vendor_ref from public.subscription_charge x
              where x.subscription_id = s.id
              order by x.period_start desc limit 1) last on true
     where s.status = 'active'
       and s.next_renewal is not null
       and public.renewal_vendor(s.product_id) = who
     order by s.next_renewal, s.ref;
end $$;

revoke all on function public.vendor_renewal_book(text, date) from public;
grant execute on function public.vendor_renewal_book(text, date) to authenticated;

/* ------------------------------------------------------------- the chase -- */

/**
 * Vendor-maintained renewals whose date has come with nothing reported.
 *
 * The thing the old run was hiding. It rolled these dates itself, so the gap
 * never existed to be looked at; now it does, and somebody has to ring the
 * vendor about it.
 */
drop view if exists public.renewal_watch;
create view public.renewal_watch
with (security_invoker = on) as
  select s.ref,
         s.product_id,
         s.product_name,
         p.partner_id                       as vendor_id,
         coalesce(pt.name, s.seller)        as vendor,
         s.cycle,
         s.price,
         s.currency,
         s.user_id,
         cp.name                            as customer,
         s.next_renewal                     as due,
         (current_date - s.next_renewal)    as days_late,
         case
           when current_date - s.next_renewal >= 30 then 'escalate'
           when current_date - s.next_renewal >= 7  then 'chase'
           else 'watch'
         end                                as band
    from public.subscriptions s
    join public.products p on p.id = s.product_id
    left join public.partners pt on pt.id = p.partner_id
    left join public.consumer_profile cp on cp.user_id = s.user_id
    left join public.subscription_charge c
           on c.subscription_id = s.id and c.period_start = s.next_renewal
   where s.status = 'active'
     and s.auto_renew
     and s.next_renewal is not null
     and s.next_renewal <= current_date
     and p.partner_id is not null
     and c.id is null
     and (s.ends_at is null or s.ends_at > s.next_renewal);

comment on view public.renewal_watch is
  'Subscriptions a seller renews, whose date has passed with no report from them. The marketplace does not roll these — it chases them.';

grant select on public.renewal_watch to authenticated;

/* ------------------------------------------------- something to chase for -- */

/* `ref` is how every screen, `set_renewal_date` and now `report_renewal` name a
   subscription, and `subscriptions_ref_key` already guarantees it is unique
   where it is set. The inserts below name that predicate rather than the bare
   column, because a partial index only answers for the rows it covers. */

/* Beacon Reseller Co resells connectivity to Kenyan consumers, and the renewal
   is theirs. It gives the vendor path a seller who actually signs in: Beacon is
   approved in Kenya and the UAE and eligible in IoT, so this sits inside the
   agreement it already has rather than widening it. No rupee price — Beacon is
   suspended in India, and a seller holds no price in a currency none of their
   approved markets take. */
insert into public.products
  (id, category_id, sub_category, name, partner_id, seller, price, cost, model,
   fulfil, rating, reviews, stock, status, listed, description, tags, comm, unit,
   specs, sort_order, price_includes_tax, tax_rate, floor_price, list_price,
   audiences, currency, billing_period, serialised, fulfilment_route)
values
  ('SKU-7011', 'iot', 'Connectivity', 'Beacon IoT Care — 5 devices', 'PTR-1009',
   'Beacon Reseller Co', 4.99, 3.10, 'monthly', 'provisioned', 4.5, 18, 'in',
   'live', '06 Feb 2026',
   'Connectivity and cover for up to five home devices — trackers, cameras and sensors — on one monthly plan, managed by Beacon.',
   array['Home IoT', 'Managed', '5 devices'], '14', 'plan',
   jsonb_build_object(
     'Devices', 'Up to 5',
     'Coverage', 'Kenya, on the Aventa network',
     'Support', 'Beacon, 08:00–20:00 EAT',
     'Renewals', 'Maintained by Beacon Reseller Co',
     'Contract', 'Monthly, cancel any time'),
   712, false, 16.00, 4.49, 5.49,
   array['consumer'], 'USD', 'monthly', false, 'seller')
on conflict (id) do nothing;

insert into public.product_prices (product_id, currency, price, floor_price, list_price)
values ('SKU-7011', 'USD', 4.99, 4.49, 5.49),
       ('SKU-7011', 'KES', 649.00, 585.00, 715.00),
       ('SKU-7011', 'AED', 18.99, 16.99, 20.99)
on conflict (product_id, currency) do nothing;

insert into public.product_media (id, product_id, url, role, alt, sort_order)
values ('pm-SKU-7011-1', 'SKU-7011',
        'https://images.pexels.com/photos/1034812/pexels-photo-1034812.jpeg?auto=compress&cs=tinysrgb&w=600',
        'hero', 'Beacon IoT Care — connected home devices', 1)
on conflict (id) do nothing;

/* Two subscribers, one of whom Beacon has kept up to date and one of whom they
   have not. Without the second the chase list is a screen that has never had a
   row on it, which is how a control becomes a sentence. */
insert into public.subscriptions
  (product_id, product_name, status, auto_renew, started_at, next_renewal,
   price, user_id, ref, seller, cycle, currency)
values
  ('SKU-7011', 'Beacon IoT Care — 5 devices', 'active', true,
   '2026-03-04 00:00:00+00', '2026-08-04', 4.99,
   'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81', 'SUB-KE-450121',
   'Beacon Reseller Co', 'Monthly', 'USD'),
  ('SKU-7011', 'Beacon IoT Care — 5 devices', 'active', true,
   '2026-02-06 00:00:00+00', '2026-09-06', 649.00,
   '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'SUB-KE-770920',
   'Beacon Reseller Co', 'Monthly', 'KES')
on conflict (ref) where ref is not null do nothing;

/* ------------------------------------------------------------ the history -- */

/* Every active subscription has been renewing all along — the cycle before the
   one now due was taken by somebody. `subscription_charge` was empty, which said
   the opposite. One cycle back for each, attributed to whoever owns it, so the
   customer's charge history and the vendor's reported book are not blank pages.
   Beacon's overdue row gets its previous cycle and not its current one, which is
   what being overdue means. */
insert into public.subscription_charge
  (id, subscription_id, ref, user_id, product_id, product_name, seller,
   period_start, period_end, period_label, amount, currency, raised_on,
   source, vendor_id, vendor_ref, reported_by, reported_at)
select
  format('SC-%s-%s', s.ref, to_char(prev.start, 'YYYYMM')),
  s.id, s.ref, s.user_id, s.product_id, s.product_name, s.seller,
  prev.start,
  (s.next_renewal - interval '1 day')::date,
  to_char(prev.start, 'Mon YYYY'),
  s.price, s.currency, prev.start,
  case when v.vendor is null then 'marketplace' else 'vendor' end,
  v.vendor,
  case when v.vendor is null then null
       else format('%s-RN-%s', upper(left(regexp_replace(coalesce(pt.name, v.vendor), '[^A-Za-z]', '', 'g'), 3)),
                   to_char(prev.start, 'YYYYMM')) end,
  case when v.vendor is null then 'Renewal run' else coalesce(pt.name, v.vendor) end,
  case when v.vendor is null then null else (prev.start + interval '1 day')::timestamptz end
from public.subscriptions s
cross join lateral (select public.renewal_vendor(s.product_id) as vendor) v
cross join lateral (
  select (s.next_renewal - make_interval(months => public.cycle_length(s.cycle)))::date as start) prev
left join public.partners pt on pt.id = v.vendor
where s.status = 'active' and s.auto_renew and s.next_renewal is not null
  and prev.start <= current_date
on conflict (subscription_id, period_start) do nothing;

/* --------------------------------------------------------------- the check -- */

do $$
declare
  r        jsonb;
  n        integer;
  operator uuid;
begin
  select id into operator from auth.users where email = 'anika.sharma@aventa.com';
  if operator is null then raise exception 'No operator to run the check as.'; end if;
  /* The run and the report both refuse a caller who is not who they say they
     are, so the checks have to sign in rather than assert from outside. */
  perform set_config('request.jwt.claims', json_build_object('sub', operator)::text, true);

  /* Dated into the future, refused before it writes anything. */
  begin
    perform public.renew_subscriptions(current_date + 5);
    raise exception 'A renewal run dated into the future was allowed.';
  exception when others then
    if position('charging for nothing' in sqlerrm) = 0 then raise; end if;
  end;

  r := public.renew_subscriptions(current_date, 'Migration');

  /* The defect, restated: nothing the marketplace does not own was rolled. */
  select count(*) into n
    from public.subscriptions s
   where s.status = 'active' and s.next_renewal is not null
     and public.renewal_vendor(s.product_id) is null
     and s.next_renewal < current_date;
  if n > 0 then raise exception '% subscriptions we sell still renew in the past.', n; end if;

  select count(*) into n from public.subscription_charge c
    join public.subscriptions s on s.id = c.subscription_id
   where c.source = 'marketplace' and public.renewal_vendor(s.product_id) is not null;
  if n > 0 then raise exception 'The run raised % charges against subscriptions a vendor renews.', n; end if;

  /* And what it is waiting on is named, with a vendor and a reason on every
     one. "Four were skipped" is not something anybody can act on, and neither
     is "four are late". */
  if jsonb_array_length(r -> 'awaiting') = 0 then
    raise exception 'Nothing is awaiting a vendor, so the new half of the run proved nothing.';
  end if;
  select count(*) into n from jsonb_array_elements(r -> 'awaiting') e
   where coalesce(e ->> 'ref', '') = '' or coalesce(e ->> 'vendor', '') = ''
      or coalesce(e ->> 'reason', '') = '';
  if n > 0 then raise exception '% awaiting entries do not say who or why.', n; end if;

  select count(*) into n from jsonb_array_elements(r -> 'skipped') e
   where coalesce(e ->> 'ref', '') = '' or coalesce(e ->> 'reason', '') = '';
  if n > 0 then raise exception '% skips carry no reason.', n; end if;

  /* The chase list agrees with the run about who is late. */
  select count(*) into n from public.renewal_watch;
  if n <> jsonb_array_length(r -> 'awaiting') then
    raise exception 'The run is waiting on % and the chase list shows %.',
      jsonb_array_length(r -> 'awaiting'), n;
  end if;

  /* A vendor renewal reported by the operator on their behalf lands, moves the
     date by one cycle, and is idempotent. Then it goes back, because a
     migration is not a place to take somebody's money. */
  declare
    late   record;
    before date;
    out1   jsonb;
    out2   jsonb;
  begin
    select * into late from public.renewal_watch order by days_late desc limit 1;
    before := late.due;
    out1 := public.report_renewal(late.ref, late.due, 'MIGRATION-CHECK');
    if (out1 ->> 'already')::boolean then
      raise exception 'The first report of % was treated as a repeat.', late.ref;
    end if;
    if (select next_renewal from public.subscriptions where ref = late.ref) <= before then
      raise exception 'Reporting a renewal for % did not move its date.', late.ref;
    end if;

    /* Reported cycles are gone from the chase list. */
    if exists (select 1 from public.renewal_watch w where w.ref = late.ref and w.due = before) then
      raise exception '% is still being chased for a cycle its vendor reported.', late.ref;
    end if;

    out2 := public.report_renewal(late.ref, before, 'MIGRATION-CHECK');
    if not (out2 ->> 'already')::boolean then
      /* A second report for a cycle already on file must not raise a second
         charge, and must not roll the date a second time. */
      raise exception 'A repeated report of % was raised again.', late.ref;
    end if;

    delete from public.subscription_charge where vendor_ref = 'MIGRATION-CHECK';
    update public.subscriptions set next_renewal = before where ref = late.ref;
  end;

  /* A subscription the marketplace sells has no vendor renewal to report. */
  begin
    perform public.report_renewal('SUB-9103', current_date, 'NOPE');
    raise exception 'A vendor renewal was reported against a marketplace subscription.';
  exception when others then
    if position('sold by the marketplace' in sqlerrm) = 0 then raise; end if;
  end;

  perform set_config('request.jwt.claims', null, true);
end $$;
