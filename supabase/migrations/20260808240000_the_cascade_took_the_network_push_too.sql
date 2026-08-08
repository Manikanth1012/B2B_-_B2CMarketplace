/* The cascade took the network push too.
 *
 * Following the last one. When the buggy `removeOrder` stripped ORD-13013607-1
 * of its line, `com_order.order_item_id` cascaded and the push went with it —
 * and that push was in `in-progress`, the one state the COM screen draws that
 * nothing else in the book was in. `com.integration.test.ts` says so directly:
 *
 *     nothing is in-progress, so that case is drawn against nothing
 *
 * Restoring the line then made it worse in a quiet way. `queue_com_on_order_item`
 * fired and minted a fresh push in `queued`, so the row was back and the state
 * was not. A repair that leaves the right number of rows in the wrong states is
 * the kind that passes a count and fails a screen.
 *
 * This puts it back where it was: sent, acknowledged, and being provisioned by
 * the Indian order manager, which is what the order's own status of "delivered"
 * was contradicting — the case that put this order at the top of the register's
 * exception queue in the first place, and the reason it is worth keeping rather
 * than tidying away.
 */

do $$
declare c record; itm record;
begin
  select * into c from public.com_order where order_ref = 'ORD-13013607-1';
  if c.id is null then
    raise exception 'ORD-13013607-1 has no network push at all';
  end if;
  if c.state = 'in-progress' then
    raise notice 'already in-progress';
    return;
  end if;
  if c.state <> 'queued' then
    /* Anything else means somebody has worked it since, and overwriting that
       would be this migration inventing a state rather than restoring one. */
    raise notice 'ORD-13013607-1 is %, which is not the state this repairs', c.state;
    return;
  end if;

  select * into itm from public.order_items where order_id =
    (select id from public.orders where order_ref = 'ORD-13013607-1');

  update public.com_order set
    state            = 'in-progress',
    com_order_id     = coalesce(com_order_id, 'PO-' || upper(substr(md5(c.id), 1, 10))),
    attempts         = greatest(attempts, 1),
    /* The order was placed on 5 August and the push has been running since. The
       timestamps are the order's, not today's — a repair that stamps itself
       with `now()` turns a three-day-old stall into a fresh one and takes it
       off every queue that sorts by age. */
    sent_at          = (select created_at + interval '2 minutes' from public.orders where order_ref = 'ORD-13013607-1'),
    last_attempt_at  = (select created_at + interval '2 minutes' from public.orders where order_ref = 'ORD-13013607-1'),
    acknowledged_at  = (select created_at + interval '4 minutes' from public.orders where order_ref = 'ORD-13013607-1'),
    completed_at     = null,
    failure_code     = null,
    failure_reason   = null,
    note             = 'Accepted by Aventa COM — India and still provisioning. The eSIM profile has '
                       || 'not been released to the handset.'
   where id = c.id;

  raise notice 'ORD-13013607-1 push restored to in-progress';
end $$;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text; n int;
begin
  /* ASSERT-1: the states the COM screen must always be able to draw. This is
     the check that caught the loss, and it is the list `com.integration.test.ts`
     already keeps.
   *
   * `queued` and `acknowledged` are deliberately not on it. They are moments a
   * push passes through on its way somewhere — a queue that permanently holds
   * something queued is a stalled queue, and demanding one here would have made
   * this migration's own repair fail, since the row it restores to `in-progress`
   * was the only queued one. The first draft did exactly that. */
  select string_agg(s, ', ') into bad from unnest(
    array['sent', 'in-progress', 'completed', 'rejected', 'cancelled']) s
   where not exists (select 1 from public.com_order c where c.state = s);
  if bad is not null then
    raise exception 'states with nothing in them, so those cases are drawn against nothing: %', bad;
  end if;

  /* ASSERT-2: and the contradiction the order register leads on is still there —
     an order telling the customer it is done while the network is not. Losing it
     would make the worst row on that screen disappear, which reads as the
     problem being fixed rather than the evidence being deleted. */
  select count(*) into n
    from public.orders o join public.com_order c on c.order_ref = o.order_ref
   where o.status in ('delivered', 'active')
     and c.state not in ('completed', 'cancelled');
  if n = 0 then
    raise exception 'no order claims to be finished while its network fulfilment is not';
  end if;

  /* ASSERT-3: an in-progress push has been sent and acknowledged. A state with
     no timestamps behind it is a label. */
  select string_agg(c.id, ', ') into bad from public.com_order c
   where c.state = 'in-progress' and (c.sent_at is null or c.acknowledged_at is null);
  if bad is not null then raise exception 'in-progress with nothing behind it: %', bad; end if;
end $$;
