/* Three active subscriptions renewed yesterday and nobody renewed them.
 *
 * `SUB-449100-06`, `SUB-449288-07` and `SUB-449100-09` are active, monthly, and
 * carry `next_renewal = 2026-08-09`. Today is the 10th. An active subscription
 * whose next renewal is in the past is one that has silently stopped billing —
 * the customer's screen shows a date that has been and gone, and nothing has
 * charged them for the month they are currently using.
 *
 * `subscriptionsRepo.integration` catches it, and it caught it the day after it
 * became true. Not caused by any change — caused by the calendar, which is the
 * whole point: a seeded date is a fact with a shelf life.
 *
 * `roll_renewals()` moves an overdue renewal forward by whole cycles until it
 * is in the future, which is what a renewal is: the date recurs, it does not
 * expire. Whole cycles rather than "today plus a month" so the billing day the
 * customer agreed to is preserved — somebody on the 9th stays on the 9th.
 *
 * This is a repair, not a billing run. Nothing here charges anybody, and
 * nothing in this build advances a renewal when it passes: there is no job that
 * runs this. The dates will go stale again next cycle. The real fix is a
 * renewal run that bills and then rolls, and it is logged rather than pretended
 * at here.
 */

create or replace function public.roll_renewals(p_on date default current_date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  s record;
  months integer;
  next date;
  n integer := 0;
begin
  for s in
    select ref, next_renewal, cycle from public.subscriptions
     where status = 'active' and next_renewal is not null and next_renewal < p_on
  loop
    months := case lower(s.cycle)
                when 'monthly' then 1
                when 'quarterly' then 3
                when 'half-yearly' then 6
                when 'yearly' then 12
                when 'annual' then 12
                else 1
              end;
    next := s.next_renewal;
    /* Whole cycles from the agreed date, so the billing day survives. */
    while next < p_on loop
      next := (next + make_interval(months => months))::date;
    end loop;
    update public.subscriptions set next_renewal = next where ref = s.ref;
    n := n + 1;
  end loop;
  return n;
end $$;

comment on function public.roll_renewals(date) is
  'Moves an overdue renewal forward by whole cycles. A repair, not a billing run — nothing here charges anybody.';

select public.roll_renewals();

do $$
declare bad text;
begin
  select string_agg(format('%s renews %s', ref, next_renewal), '; ') into bad
    from public.subscriptions
   where status = 'active' and next_renewal is not null and next_renewal < current_date;
  if bad is not null then
    raise exception 'Active subscriptions are still renewing in the past: %', bad;
  end if;

  /* And the billing day the customer agreed to survived the roll. */
  select string_agg(ref, ', ') into bad from public.subscriptions
   where ref in ('SUB-449100-06', 'SUB-449288-07', 'SUB-449100-09')
     and extract(day from next_renewal) <> 9;
  if bad is not null then
    raise exception 'The roll moved the billing day for: %', bad;
  end if;
end $$;
