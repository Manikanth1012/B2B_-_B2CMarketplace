/* A renewal date four months in the past.
 *
 * Three subscriptions written an hour ago carry `next_renewal` before today,
 * because I computed it as "a month after it started" rather than as the next
 * anniversary still to come. Two more were already like it. A live monthly
 * subscription whose next renewal was in April is a billing run that did not
 * happen: nothing charged, nothing chased, and the customer's own screen
 * telling them the next payment is four months ago.
 *
 * It is the sort of wrong date that never fails anything. The subscription
 * lists, the total is right, the status says active. The only thing that
 * notices is a person reading the row.
 *
 * The right figure is not "a month from now" either — a subscription taken out
 * on the 9th bills on the 9th, and moving it to today's date would quietly
 * change the billing day of somebody who has been on the 9th for a year. It is
 * the next anniversary of the start date that has not yet passed.
 *
 * AND A CANCELLED SUBSCRIPTION HAS TO SAY WHEN ACCESS ENDS
 *
 * `SUB-449288-09` was cancelled with `ends_at` null, which the subscription
 * tests assert against and which I wrote anyway. Cancelled is not "off": a
 * monthly service that has been paid to the end of its period runs to that
 * date, and the customer is entitled to know which date. Cancelled with no end
 * is a support call.
 */

/* ---- 1. The next anniversary that has not gone by ------------------------------- */

/* Back to the start date, then forward a month at a time until it is ahead of
 * today. Deliberately a loop rather than a closed-form expression: the closed
 * form needs month-length arithmetic to land on the right anniversary, and the
 * first attempt at it here divided days by an average month and was wrong by a
 * day on two rows. Adding a month at a time is what `+ interval '1 month'`
 * already knows how to do, including clamping the 31st into February, and it
 * stops on exactly the condition the assertion below tests.
 */
update public.subscriptions
   set next_renewal = started_at::date
 where status in ('active', 'paused') and next_renewal < current_date;

do $$
declare n int := 0;
begin
  loop
    update public.subscriptions
       set next_renewal = (next_renewal + interval '1 month')::date
     where status in ('active', 'paused') and next_renewal < current_date;
    exit when not found;
    n := n + 1;
    if n > 240 then raise exception 'a renewal date will not move forward'; end if;
  end loop;
end $$;

/* ---- 1b. And the one the checkout billed thirty days out ------------------------ */

/* `ORD-14800252-2` starts on the 7th and renews on the 6th, and it is not seed
 * data — the ref is an order reference, so it came from a real trip through the
 * checkout, which computed `Date.now() + 30 * 86400000`. Thirty days is a month
 * in four of them; in the other eight it lands early and compounds, so a
 * subscription bought on the 7th renews on the 6th, then the 5th, and walks a
 * fortnight backwards over a year. The checkout is fixed alongside this — the
 * row is the symptom, `nextRenewalFrom` is the cure.
 */
update public.subscriptions
   set next_renewal = (started_at::date + interval '1 month')::date
 where ref = 'ORD-14800252-2'
   and extract(day from started_at) <> extract(day from next_renewal);

/* ---- 2. When a cancelled subscription stops working ----------------------------- */

/* To the end of the period already paid for. Not the cancellation date: the
 * customer paid for the month and keeps it.
 */
update public.subscriptions
   set ends_at = coalesce(ends_at, next_renewal)
 where status = 'cancelled' and ends_at is null;

/* And three that ended before they began.
 *
 * `ORD-13013607-1`, `ORD-13093022-1` and `ORD-13327384` were bought on 5 August
 * and cancelled with `ends_at = 2026-08-01`. The cancel path in
 * `SubscriptionsView` sets `ends_at` from `next_renewal`, which is right — the
 * customer keeps what they paid for — and these rows had a `next_renewal`
 * already in the past, so cancelling handed them an end date before their own
 * start. The stale renewal dates above were the cause; this is the damage they
 * did before it was fixed, and with those gone the cancel path cannot produce
 * it again.
 *
 * A subscription cancelled inside its first period runs to the end of that
 * period, which is a month from the day it started.
 */
update public.subscriptions
   set ends_at = (started_at::date + interval '1 month')::date
 where status = 'cancelled' and ends_at is not null and ends_at < started_at::date;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text;
begin
  /* ASSERT-1: nothing live is waiting on a renewal that has already gone by. */
  select string_agg(format('%s (%s, renews %s)', ref, status, next_renewal), '; ') into bad
    from public.subscriptions
   where status in ('active', 'paused') and next_renewal < current_date;
  if bad is not null then
    raise exception 'live subscriptions whose next renewal is in the past: %', bad;
  end if;

  /* ASSERT-2: and the billing day did not move. This is the one that matters
     more than the date being in the future — a subscription that has billed on
     the 9th for a year must go on billing on the 9th, and a naive "a month from
     today" would have moved five customers' billing days to suit a migration. */
  select string_agg(format('%s starts %s and renews %s', ref,
                           to_char(started_at, 'DD'), to_char(next_renewal, 'DD')), '; ') into bad
    from public.subscriptions
   where status in ('active', 'paused')
     and extract(day from started_at) <> extract(day from next_renewal)
     /* Except where the start day does not exist in the renewal month — the
        31st renewing in a 30-day month is the last day of it, not a fault. */
     and extract(day from next_renewal)
         <> extract(day from (date_trunc('month', next_renewal) + interval '1 month - 1 day'))
     /* And except calendar-month billing, where the renewal is the 1st
        whatever day the subscription began. SUB-9103 has been on that footing
        since 2024 and it is a choice rather than a drift — sixteen of twenty
        subscriptions renew on their start day, one renews on the 1st, and the
        only one that was neither was the checkout's thirty-day bug. */
     and extract(day from next_renewal) <> 1;
  if bad is not null then raise exception 'subscriptions whose billing day moved: %', bad; end if;

  /* ASSERT-3: every cancelled subscription says when access ends. */
  select string_agg(ref, ', ') into bad
    from public.subscriptions where status = 'cancelled' and ends_at is null;
  if bad is not null then
    raise exception 'cancelled subscriptions that do not say when access ends: %', bad;
  end if;

  /* ASSERT-4: and none of them ends before it started, which is the way this
     kind of repair usually goes wrong. */
  select string_agg(ref, ', ') into bad
    from public.subscriptions where ends_at is not null and ends_at < started_at::date;
  if bad is not null then raise exception 'subscriptions that ended before they began: %', bad; end if;
end $$;
