/* A July order that was still queued in August.
 *
 * ORD-881118 is Cadence Health's connectivity renewal, written in the previous
 * migration because the loyalty ledger had recorded points earned on it on
 * 18 and 19 July. Writing the order fired `queue_com_on_order_item`, which is
 * correct — a connectivity line goes to the order manager — and left the push in
 * `queued`.
 *
 * So the order sits at "Active", the last rung of its ladder, with a network
 * fulfilment that has never been sent. `com.integration.test.ts` caught it
 * immediately, in the words of the rule it exists to enforce:
 *
 *     ORD-881118 is shown on its last rung and its service is queued
 *
 * The order is not wrong and the trigger is not wrong. What is missing is the
 * three weeks in between: a service bought in July, and earning points in July,
 * was provisioned in July. Seeding an order into the past means seeding what
 * happened to it, and the queue is a record of work rather than a list of
 * intentions.
 *
 * The alternative was to put the order back a rung and call it still
 * provisioning. That would be a July renewal that has not connected after three
 * weeks — a much louder claim than the one being made, and one nothing else in
 * the data supports.
 */

do $$
declare c record; n int := 0;
begin
  for c in
    select x.id, x.order_ref, o.created_at
      from public.com_order x
      join public.orders o on o.order_ref = x.order_ref
     where x.state = 'queued'
       and o.status in ('active', 'delivered')
       and o.created_at < now() - interval '7 days'
  loop
    update public.com_order set
      state           = 'completed',
      com_order_id    = coalesce(com_order_id, 'PO-' || upper(substr(md5(c.id), 1, 10))),
      attempts        = greatest(attempts, 1),
      /* Timestamps from the order, not from today. A push stamped `now()` on a
         three-week-old order reads as a renewal that took three weeks to
         connect — the register sorts by age and would put it at the top. */
      sent_at         = c.created_at + interval '3 minutes',
      last_attempt_at = c.created_at + interval '3 minutes',
      acknowledged_at = c.created_at + interval '6 minutes',
      completed_at    = c.created_at + interval '22 minutes',
      failure_code    = null,
      failure_reason  = null,
      note            = 'Provisioned on the day it was ordered.'
     where id = c.id;
    n := n + 1;
  end loop;
  raise notice '% historical pushes completed', n;
end $$;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text; n int;
begin
  /* ASSERT-1: nothing claims to be finished while its network fulfilment is
     not. This is `guard_order_completion`'s rule, checked across the book
     rather than at the moment of one write. */
  select string_agg(o.order_ref || ' (' || c.state || ')', ', ') into bad
    from public.orders o join public.com_order c on c.order_ref = o.order_ref
   where o.status in ('active', 'delivered')
     and o.stage >= array_length(o.stages, 1) - 1
     and c.state not in ('completed', 'cancelled');
  if bad is not null then
    raise exception 'orders shown as finished whose service was never provisioned: %', bad;
  end if;

  /* ASSERT-2: and the one deliberate contradiction survives. ORD-13013607-1 is
     delivered at stage 0 with an in-progress push — it is the worst row on the
     order register and the reason that screen leads with exceptions. A repair
     that tidied it away would have removed the evidence rather than the
     defect. */
  select count(*) into n
    from public.orders o join public.com_order c on c.order_ref = o.order_ref
   where o.order_ref = 'ORD-13013607-1' and c.state = 'in-progress';
  if n <> 1 then
    raise exception 'the order register''s worst case has been tidied away';
  end if;

  /* ASSERT-3: a completed push has the timestamps to show for it, and they are
     the order's rather than this migration's. */
  select string_agg(c.id, ', ') into bad
    from public.com_order c join public.orders o on o.order_ref = c.order_ref
   where c.state = 'completed'
     and (c.sent_at is null or c.completed_at is null
          or c.completed_at < o.created_at
          or c.sent_at < o.created_at);
  if bad is not null then
    raise exception 'completed pushes with nothing behind them, or dated before their order: %', bad;
  end if;
end $$;
