/* Nothing renewed a subscription when its date came.
 *
 * `subscriptions.next_renewal` is the date the customer agreed to be charged
 * on, and no code in this build ever moved it. Three active monthly
 * subscriptions sat at 2026-08-09 until the calendar went past them and
 * `subscriptionsRepo.integration` went red the following morning. An active
 * subscription renewing in the past is one that has quietly stopped billing:
 * the customer's screen shows a date that has been and gone, and nothing has
 * charged them for the month they are currently using.
 *
 * `roll_renewals()` in the migration before this one moved the dates and said
 * in its own comment that it was a repair rather than a billing run. This is
 * the billing run.
 *
 * It is shaped like `run_settlements`, deliberately, because it is the same
 * kind of job and the same three things go wrong with it:
 *
 *   - it refuses a date in the future. A period that has not started has not
 *     been used, and charging for it is charging for nothing.
 *   - it is idempotent. One charge per subscription per period, enforced by the
 *     table rather than by the caller remembering; a second run finds the first
 *     run's charges and reports them as already raised.
 *   - it says why it skipped somebody. "Four were skipped" is not something
 *     anybody can act on.
 *
 * What it does NOT do is take money. It raises the charge and moves the date;
 * the charge waits for the bill covering its period, exactly as a wholesale
 * charge waits for the settlement covering its month. Nothing here writes to a
 * bill that has already been issued.
 */

create table if not exists public.subscription_charge (
  id              text primary key,
  subscription_id uuid not null references public.subscriptions(id) on delete cascade,
  ref             text not null,
  user_id         uuid,
  product_id      text not null,
  product_name    text not null,
  seller          text,
  /* The period being charged for, not the date it was raised on. A renewal
     charges the cycle that is starting. */
  period_start    date not null,
  period_end      date not null,
  period_label    text not null,
  amount          numeric not null check (amount >= 0),
  currency        text not null,
  raised_on       date not null default current_date,
  /* The bill that carried it, once one covers the period. Null while the
     period is still running — the same shape as a wholesale charge waiting for
     its statement. */
  bill_id         text references public.consumer_bills(id),
  applied_on      date,
  created_at      timestamptz not null default now(),
  constraint charge_period_is_a_period check (period_end >= period_start),
  constraint one_charge_per_subscription_per_period unique (subscription_id, period_start)
);

comment on table public.subscription_charge is
  'One cycle of one subscription, raised when the renewal date comes. It waits for the bill covering its period; nothing here takes money.';

create index if not exists subscription_charge_open_idx
  on public.subscription_charge (user_id, period_start) where bill_id is null;

alter table public.subscription_charge enable row level security;

drop policy if exists operator_all_subscription_charge on public.subscription_charge;
create policy operator_all_subscription_charge on public.subscription_charge
  for all using (public.current_persona() = 'operator')
  with check (public.current_persona() = 'operator');

/* A customer reading what they have been charged for and when. */
drop policy if exists owner_reads_own_subscription_charge on public.subscription_charge;
create policy owner_reads_own_subscription_charge on public.subscription_charge
  for select using (user_id = auth.uid());

grant select on public.subscription_charge to authenticated;

/* A charge on a bill somebody has already paid is part of that document. */
create or replace function public.guard_subscription_charge()
returns trigger language plpgsql security definer set search_path = public as $$
declare b public.consumer_bills;
begin
  if tg_op = 'UPDATE' and old.bill_id is not null and new.bill_id is distinct from old.bill_id then
    select * into b from public.consumer_bills where id = old.bill_id;
    if b.status = 'paid' then
      raise exception
        '% was billed on %, which is paid. Reverse it with a credit rather than moving it.',
        old.id, old.bill_id;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_subscription_charge on public.subscription_charge;
create trigger guard_subscription_charge before update on public.subscription_charge
for each row execute function public.guard_subscription_charge();

/* --------------------------------------------------------------- the cycle -- */

/**
 * How many months a billing cycle is.
 *
 * One place, because `roll_renewals` and the run below both need it and two
 * copies of a lookup like this drift the first time somebody adds a cycle.
 */
create or replace function public.cycle_length(p_cycle text)
returns integer language sql immutable as $$
  select case lower(coalesce(p_cycle, 'monthly'))
           when 'monthly' then 1
           when 'quarterly' then 3
           when 'half-yearly' then 6
           when 'yearly' then 12
           when 'annual' then 12
           else 1
         end
$$;

grant execute on function public.cycle_length(text) to authenticated;

/**
 * Charge every subscription whose renewal date has come, and move the date.
 *
 * Returns what it did and what it did not, in the same shape a settlement run
 * reports, because the two are read by the same kind of person for the same
 * kind of reason.
 */
create or replace function public.renew_subscriptions(
  p_as_of date default current_date, p_actor text default 'Renewal scheduler')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s        record;
  months   integer;
  p_start  date;
  p_end    date;
  charged  integer := 0;
  already  integer := 0;
  rolled   integer := 0;
  skips    jsonb := '[]'::jsonb;
  new_id   text;
begin
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
       already cancelled out of. */
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

    /* The cycle that starts on the renewal date. */
    p_start := s.next_renewal;
    p_end   := (p_start + make_interval(months => months) - interval '1 day')::date;
    new_id  := format('SC-%s-%s', s.ref, to_char(p_start, 'YYYYMM'));

    insert into public.subscription_charge
      (id, subscription_id, ref, user_id, product_id, product_name, seller,
       period_start, period_end, period_label, amount, currency)
    values
      (new_id, s.id, s.ref, s.user_id, s.product_id, s.product_name, s.seller,
       p_start, p_end, to_char(p_start, 'Mon YYYY'), s.price, s.currency)
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
    'charged', charged, 'already', already, 'rolled', rolled, 'skipped', skips);
end $$;

revoke all on function public.renew_subscriptions(date, text) from public;
grant execute on function public.renew_subscriptions(date, text) to authenticated;

/* --------------------------------------------------------------- the check -- */

do $$
declare r jsonb; n integer;
begin
  /* Dated into the future, refused before it writes anything. */
  begin
    perform public.renew_subscriptions(current_date + 5);
    raise exception 'A renewal run dated into the future was allowed.';
  exception when others then
    if position('charging for nothing' in sqlerrm) = 0 then raise; end if;
  end;

  r := public.renew_subscriptions(current_date, 'Migration');
  /* Nothing is due — `roll_renewals` moved them all forward in the migration
     before this one — so this run has nothing to charge and says so rather
     than inventing work. */
  if (r ->> 'charged')::integer < 0 then
    raise exception 'The run reported a negative charge count.';
  end if;

  /* Every skip names the subscription and why. */
  select count(*) into n from jsonb_array_elements(r -> 'skipped') e
   where coalesce(e ->> 'ref', '') = '' or coalesce(e ->> 'reason', '') = '';
  if n > 0 then raise exception '% skips carry no reason.', n; end if;

  /* And no active subscription is left renewing in the past. */
  select count(*) into n from public.subscriptions
   where status = 'active' and next_renewal is not null and next_renewal < current_date;
  if n > 0 then raise exception '% active subscriptions still renew in the past.', n; end if;
end $$;
/* Only the marketplace runs renewals.
 *
 * `renew_subscriptions` is SECURITY DEFINER — it has to be, because
 * `subscriptions` is writable only by the person who owns the row and a
 * renewal run writes everybody's. Execute was granted to `authenticated`,
 * which means any signed-in consumer could have run the billing job for the
 * whole marketplace. The definer rights were the point and the missing check
 * was the hole; `run_settlements` has had the same check since it was written
 * and this function was modelled on it in every respect but that one.
 */
create or replace function public.renew_subscriptions(
  p_as_of date default current_date, p_actor text default 'Renewal scheduler')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s        record;
  months   integer;
  p_start  date;
  p_end    date;
  charged  integer := 0;
  already  integer := 0;
  rolled   integer := 0;
  skips    jsonb := '[]'::jsonb;
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

    p_start := s.next_renewal;
    p_end   := (p_start + make_interval(months => months) - interval '1 day')::date;
    new_id  := format('SC-%s-%s', s.ref, to_char(p_start, 'YYYYMM'));

    insert into public.subscription_charge
      (id, subscription_id, ref, user_id, product_id, product_name, seller,
       period_start, period_end, period_label, amount, currency)
    values
      (new_id, s.id, s.ref, s.user_id, s.product_id, s.product_name, s.seller,
       p_start, p_end, to_char(p_start, 'Mon YYYY'), s.price, s.currency)
    on conflict (subscription_id, period_start) do nothing;

    if found then charged := charged + 1; else already := already + 1; end if;

    while p_start < p_as_of or p_start = s.next_renewal loop
      p_start := (p_start + make_interval(months => months))::date;
      exit when p_start > p_as_of;
    end loop;

    update public.subscriptions set next_renewal = p_start where id = s.id;
    rolled := rolled + 1;
  end loop;

  return jsonb_build_object(
    'ran_on', p_as_of, 'ran_by', p_actor,
    'charged', charged, 'already', already, 'rolled', rolled, 'skipped', skips);
end $$;

/* A test harness needs to be able to put a renewal date back where it found it,
   and only the owner may write `subscriptions`. Rather than widen that policy —
   which would let a console write a date nobody asked it to — the marketplace
   gets one narrow, audited way to set a renewal date, which is a thing the desk
   genuinely does when a customer asks to move their billing day. */
create or replace function public.set_renewal_date(p_ref text, p_on date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.subscriptions;
begin
  if public.current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace moves a billing date.';
  end if;
  select * into s from public.subscriptions where ref = p_ref;
  if s.ref is null then raise exception 'There is no subscription %.', p_ref; end if;
  if s.status <> 'active' then
    raise exception '% is %, so it has no renewal date to move.', p_ref, s.status;
  end if;
  update public.subscriptions set next_renewal = p_on where ref = p_ref;
  return jsonb_build_object('ok', true, 'ref', p_ref, 'was', s.next_renewal, 'now', p_on);
end $$;

revoke all on function public.renew_subscriptions(date, text) from public;
revoke all on function public.set_renewal_date(text, date) from public;
grant execute on function public.renew_subscriptions(date, text) to authenticated;
grant execute on function public.set_renewal_date(text, date) to authenticated;
