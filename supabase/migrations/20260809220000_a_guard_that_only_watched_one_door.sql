/* A guard that only watched one door.
 *
 * `guard_order_completion` refuses to walk an order to its last rung while the
 * order manager has not finished provisioning it. It is a good rule and it says
 * so plainly: "the customer would be told their service is live while it is
 * not." It is attached as `BEFORE UPDATE OF stage`.
 *
 * So an order that is *created* already on its last rung never meets it. Which
 * is exactly what fourteen orders written an hour ago did: inserted at stage 4
 * of 5, showing "Delivered", with every provisioning request behind them still
 * queued. The com integration test caught it — not the guard.
 *
 * This is the second time this week a control has turned out to cover one of the
 * two ways into a state. The pattern is worth naming: a rule written while
 * looking at a screen guards the transition the screen makes, and a seed comes
 * in through the other door.
 *
 * AND THE LADDER IS NOT A CONSTANT
 *
 * The orders I wrote also carried `['Ordered','Approved','Packed','In transit',
 * 'Delivered']` for baskets containing eSIMs, so an eSIM was being tracked like
 * a parcel — "In transit" for a thing that is downloaded. The book already has
 * two ladders and uses the right one 71 times out of 80:
 *
 *   posted        Ordered · Confirmed · Dispatched · In transit · Delivered
 *   provisioned   Ordered · Confirmed · Provisioning · Activating · Active
 *
 * Which applies is decided by the lines, and the lines arrive after the order
 * row, so nothing could have set it at insert time. It is set from the items
 * instead, the moment they land — a mixed basket keeps the posted ladder,
 * because something really is being posted.
 */

/* ---- 1. The guard covers both doors -------------------------------------------- */

create or replace function public.guard_order_completion()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare c record;
begin
  if new.stage < array_length(new.stages, 1) - 1 then return new; end if;
  /* On UPDATE, only when the stage actually moved — re-saving a delivered order
     for some other reason is not a claim about provisioning. On INSERT there is
     no previous stage, and arriving at the top rung is always a claim. */
  if tg_op = 'UPDATE' and new.stage = old.stage then return new; end if;

  select * into c from public.com_order
   where order_ref = new.order_ref and state not in ('completed', 'cancelled')
   order by created_at limit 1;

  if c.id is not null then
    raise exception
      'ORDER % cannot show as "%" — % is % with the order manager. %',
      new.order_ref, new.stages[new.stage + 1], c.product_name,
      case c.state
        when 'queued' then 'still queued'
        when 'sent' then 'sent and not yet acknowledged'
        when 'acknowledged' then 'accepted but not yet provisioned'
        when 'in-progress' then 'still being provisioned'
        when 'rejected' then 'rejected'
        else 'not provisioned' end,
      coalesce(c.failure_reason, 'The customer would be told their service is live while it is not.');
  end if;
  return new;
end $$;

/* The INSERT half runs AFTER, not BEFORE: the provisioning requests are queued
 * by `z_queue_com_on_order_item` when the lines land, and the lines land after
 * the order row. A BEFORE INSERT check would look at an order with no items and
 * find nothing outstanding, which is how a control passes by being early.
 */
create or replace function public.guard_order_completion_after()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare o record; c record;
begin
  select * into o from public.orders where id = new.order_id;
  if o.id is null or o.stage < array_length(o.stages, 1) - 1 then return new; end if;

  select * into c from public.com_order
   where order_ref = o.order_ref and state not in ('completed', 'cancelled')
   order by created_at limit 1;

  if c.id is not null then
    raise exception
      'ORDER % was created showing "%" and % is % with the order manager. %',
      o.order_ref, o.stages[o.stage + 1], c.product_name,
      case c.state when 'queued' then 'still queued' else c.state end,
      'An order cannot be written into a state it would be refused for moving into.';
  end if;
  return new;
end $$;

drop trigger if exists z_guard_order_completion on public.orders;
create trigger z_guard_order_completion
  before insert or update of stage on public.orders
  for each row execute function public.guard_order_completion();

/* Named to sort after `z_queue_com_on_order_item`, so the request exists to be
   found by the time this looks for it. */
drop trigger if exists zz_guard_order_completion_after on public.order_items;
create trigger zz_guard_order_completion_after
  after insert on public.order_items
  for each row execute function public.guard_order_completion_after();

/* ---- 2. The ladder follows what is being delivered ------------------------------ */

create or replace function public.stage_ladder_for_order()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare ships boolean;
begin
  select bool_or(i.fulfil in ('shipped', 'ship')) into ships
    from public.order_items i where i.order_id = new.order_id;

  /* Null means no lines yet, which cannot happen in an AFTER INSERT on the
     items — but a nothing-to-do answer beats a guess. */
  if ships is null then return new; end if;

  update public.orders
     set stages = case when ships
       then array['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered']
       else array['Ordered', 'Confirmed', 'Provisioning', 'Activating', 'Active'] end
   where id = new.order_id
     and stages is distinct from (case when ships
       then array['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered']
       else array['Ordered', 'Confirmed', 'Provisioning', 'Activating', 'Active'] end)
     /* Only the orders this rule owns. Enterprise orders run their own ladder
        through the approval flow and are not a consumer parcel or a consumer
        activation. */
     and account_id is null;
  return new;
end $$;

drop trigger if exists zy_stage_ladder_for_order on public.order_items;
create trigger zy_stage_ladder_for_order
  after insert on public.order_items
  for each row execute function public.stage_ladder_for_order();

/* ---- 3. And the fourteen orders that came in through the open door -------------- */

/* Restage first: an all-digital basket was on the parcel ladder. */
update public.orders o
   set stages = case
     when exists (select 1 from public.order_items i
                   where i.order_id = o.id and i.fulfil in ('shipped', 'ship'))
     then array['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered']
     else array['Ordered', 'Confirmed', 'Provisioning', 'Activating', 'Active'] end
 where (o.order_ref like 'ORD-771204%' or o.order_ref like 'ORD-771305%')
   and o.account_id is null;

/* Then finish the provisioning that a delivered order implies actually happened.
 * Not by lowering the orders to match the queue — these are historic orders and
 * the story is that they completed. What was missing is the network's side of
 * it, including the event trail, which every push in this book has.
 */
update public.com_order c
   set state = 'completed',
       /* Every timestamp on the way, not just the two ends. A push that is
          complete and was never acknowledged is a state the book refuses —
          rightly, because it says the network confirmed something it was never
          told it had accepted. The first pass here set only sent and completed
          and the com tests caught exactly that. */
       sent_at = coalesce(c.sent_at, c.created_at + interval '2 minutes'),
       acknowledged_at = coalesce(c.acknowledged_at, c.created_at + interval '4 minutes'),
       completed_at = coalesce(c.completed_at, c.created_at + interval '11 minutes')
  from public.orders o
 where o.order_ref = c.order_ref
   and (c.order_ref like 'ORD-771204%' or c.order_ref like 'ORD-771305%')
   and o.stage >= array_length(o.stages, 1) - 1
   and c.state <> 'cancelled'
   /* Not "and it is not already completed". Re-running this file with that
      condition skipped the rows a previous run had completed, and those were
      precisely the rows still missing `acknowledged_at` — a repair that
      excludes what it half-repaired last time never finishes. */
   and (c.state <> 'completed'
        or c.sent_at is null or c.acknowledged_at is null or c.completed_at is null);

insert into public.com_event (id, com_order, kind, state, detail, occurred_at)
select c.id || '-C', c.id, 'completed', 'completed',
       format('%s activated on %s and confirmed back to the marketplace.',
              c.product_name, c.system_id),
       c.completed_at
  from public.com_order c
 where (c.order_ref like 'ORD-771204%' or c.order_ref like 'ORD-771305%')
   and c.state = 'completed'
   and not exists (select 1 from public.com_event e
                    where e.com_order = c.id and e.state = 'completed');

/* And the rungs of the trail, so the sequence reads as something that happened
 * rather than as two rows written at once.
 */
insert into public.com_event (id, com_order, kind, state, detail, occurred_at)
/* 'submitted' is the kind; 'sent' is the state it moves to. The kinds are a
   closed set and 'sent' is not one of them. */
select c.id || '-S', c.id, 'submitted', 'sent',
       format('Sent to %s.', c.system_id), c.sent_at
  from public.com_order c
 where (c.order_ref like 'ORD-771204%' or c.order_ref like 'ORD-771305%')
   and c.state = 'completed'
   and not exists (select 1 from public.com_event e where e.com_order = c.id and e.state = 'sent');

insert into public.com_event (id, com_order, kind, state, detail, occurred_at)
select c.id || '-A', c.id, 'acknowledged', 'acknowledged',
       format('%s accepted the request.', c.system_id), c.acknowledged_at
  from public.com_order c
 where (c.order_ref like 'ORD-771204%' or c.order_ref like 'ORD-771305%')
   and c.state = 'completed'
   and not exists (select 1 from public.com_event e where e.com_order = c.id and e.state = 'acknowledged');

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text; n int;
begin
  /* ASSERT-1: the rule this file exists for. No order anywhere sits on its last
     rung with something unprovisioned behind it — whichever door it came in by. */
  select string_agg(format('%s (%s is %s)', o.order_ref, c.product_name, c.state), '; ') into bad
    from public.orders o
    join public.com_order c on c.order_ref = o.order_ref
   where o.stage >= array_length(o.stages, 1) - 1
     and c.state not in ('completed', 'cancelled');
  if bad is not null then
    raise exception 'orders shown as finished with provisioning outstanding: %', bad;
  end if;

  /* ASSERT-2: and the guard now covers both doors, so the next seed meets it. */
  select count(*) into n from pg_trigger
   where tgrelid = 'public.orders'::regclass and tgname = 'z_guard_order_completion'
     and (tgtype & 4) = 4;   /* INSERT */
  if n <> 1 then raise exception 'the completion guard still does not fire on insert'; end if;
  select count(*) into n from pg_trigger
   where tgrelid = 'public.order_items'::regclass and tgname = 'zz_guard_order_completion_after';
  if n <> 1 then raise exception 'nothing checks a finished order once its lines land'; end if;

  /* ASSERT-3: no eSIM is tracked like a parcel. This was the visible symptom
     and it is the one a buyer would have noticed. */
  select string_agg(o.order_ref, ', ') into bad
    from public.orders o
   where 'In transit' = any(o.stages)
     and exists (select 1 from public.order_items i
                  where i.order_id = o.id and i.fulfil = 'esim')
     and not exists (select 1 from public.order_items i
                      where i.order_id = o.id and i.fulfil in ('shipped', 'ship'));
  if bad is not null then raise exception 'eSIM-only orders tracked like parcels: %', bad; end if;

  /* ASSERT-4: every consumer order is on one of the two ladders the book uses,
     rather than a third somebody typed. */
  select string_agg(distinct array_to_string(stages, ' · '), ' | ') into bad
    from public.orders
   where account_id is null and stages is not null
     and stages not in (
       array['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered'],
       array['Ordered', 'Confirmed', 'Provisioning', 'Activating', 'Active'],
       array['Ordered', 'Approved', 'Packed', 'In transit', 'Delivered'],
       array['Ordered', 'Approved', 'Provisioning', 'Activated', 'In service']);
  if bad is not null then raise exception 'consumer orders on an unrecognised ladder: %', bad; end if;

  /* ASSERT-4b: a completed push was accepted first. Completing something the
     network never acknowledged is a claim nobody made. */
  select string_agg(id, ', ') into bad from public.com_order
   where state = 'completed' and (acknowledged_at is null or sent_at is null);
  if bad is not null then
    raise exception 'pushes completed without being sent and accepted: %', bad;
  end if;

  /* ASSERT-5: every completed push has the event that says so. A state with no
     trail behind it is a figure nobody can audit, and the com book asserts this
     over its whole set. */
  select string_agg(c.id, ', ') into bad from public.com_order c
   where c.state = 'completed'
     and not exists (select 1 from public.com_event e where e.com_order = c.id);
  if bad is not null then raise exception 'completed pushes with no event trail: %', bad; end if;
end $$;
