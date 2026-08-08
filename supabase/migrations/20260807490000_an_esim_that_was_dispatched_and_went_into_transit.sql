/* An eSIM that was dispatched, and then went into transit.
 *
 * Three Indian orders for a mobile plan and a travel eSIM are showing their
 * buyer this ladder:
 *
 *   Ordered → Confirmed → Dispatched → In transit → Delivered
 *
 * Nothing is dispatched. Nothing is in transit. An eSIM is a profile downloaded
 * over the air, and the Kenyan orders for the same products already say so —
 * Ordered → Confirmed → Provisioning → Activating → Active. Two markets, one
 * product, two accounts of what is happening to it, and the wrong one is the
 * one that says a parcel is coming.
 *
 * All three are also sitting at stage 0, "Ordered", which is exactly right and
 * for the wrong reason: they have never moved because nothing was ever asked to
 * move them. That is what the previous migration built the push for, and this
 * one runs it against the orders already on file.
 *
 * The states it writes are not decoration. They are the four answers a customer
 * chasing an order can get, and each of them means something different:
 *
 *   queued — we have it, the network does not have it yet.
 *   acknowledged — the network has accepted the order. The service is not on.
 *   in-progress — work is happening. This is where an IoT estate sits for hours.
 *   completed — the service exists and the customer can use it.
 *
 * Plus the two that are not progress: rejected, which will not get better on
 * its own, and failed, which needed somebody and did not get them.
 */

/* ---- 1. The ladder an eSIM actually climbs ----------------------------------- */

update public.orders o set
  stages = array['Ordered', 'Confirmed', 'Provisioning', 'Activating', 'Active']
 where exists (
   select 1 from public.order_items i
     join public.products p on p.id = i.product_id
    where i.order_id = o.id and p.fulfilment_route = 'telco-com')
   and o.stages @> array['Dispatched'];

/* ---- 2. Push what was already sold ------------------------------------------- */

do $$
declare o record; res jsonb; n int := 0;
begin
  for o in
    select distinct ord.order_ref
      from public.orders ord
      join public.order_items i on i.order_id = ord.id
      join public.products p on p.id = i.product_id
     where p.fulfilment_route = 'telco-com'
     order by 1
  loop
    res := public.push_to_com(o.order_ref);
    n := n + coalesce((res ->> 'queued')::int, 0);
  end loop;
  raise notice 'queued % lines that had never been sent anywhere', n;
end $$;

/* ---- 3. Where each one has actually got to ----------------------------------- */

/* The state COM reports has to agree with the state the buyer is shown. An
 * order the storefront calls Active whose provisioning request is still sitting
 * in a queue is the marketplace telling the customer their SIM works while
 * nobody has switched it on.
 */
do $$
declare
  c    record;
  o    public.orders;
  base timestamptz;
begin
  for c in select * from public.com_order order by id loop
    select * into o from public.orders where order_ref = c.order_ref;
    base := coalesce(o.created_at, now() - interval '30 days');

    if o.status = 'refunded' then
      /* Refunded and still provisioned is a service being given away. */
      update public.com_order set
        state = 'cancelled', sent_at = base + interval '3 minutes',
        acknowledged_at = base + interval '4 minutes', attempts = 1,
        com_order_id = 'PO-' || upper(substr(md5(c.id), 1, 10)),
        payload = public.com_payload(c.order_item_id),
        note = 'Cancelled with COM when the order was refunded. A refunded order that stays provisioned is service given away.'
       where id = c.id;
      insert into public.com_event (id, com_order, kind, state, detail, occurred_at) values
        (c.id || '-A1', c.id, 'acknowledged', 'acknowledged', 'Accepted.', base + interval '4 minutes'),
        (c.id || '-S1', c.id, 'state-change', 'cancelled', 'Cancelled at the marketplace''s request following a refund.', base + interval '2 days')
      on conflict (id) do nothing;

    elsif o.stage >= array_length(o.stages, 1) - 1 then
      /* The buyer is being shown the last rung, so the service exists. */
      update public.com_order set
        state = 'completed', sent_at = base + interval '2 minutes',
        acknowledged_at = base + interval '3 minutes',
        completed_at = base + interval '26 minutes', attempts = 1,
        com_order_id = 'PO-' || upper(substr(md5(c.id), 1, 10)),
        payload = public.com_payload(c.order_item_id)
       where id = c.id;
      insert into public.com_event (id, com_order, kind, state, detail, occurred_at) values
        (c.id || '-A1', c.id, 'acknowledged', 'acknowledged', 'Accepted.', base + interval '3 minutes'),
        (c.id || '-S1', c.id, 'state-change', 'in-progress', 'Allocating resources.', base + interval '6 minutes'),
        (c.id || '-S2', c.id, 'completed', 'completed',
         case when c.fulfil = 'esim'
              then 'Profile released. Activation code sent to the customer.'
              else 'Service active on the network.' end,
         base + interval '26 minutes')
      on conflict (id) do nothing;

    else
      /* And these are the three that never went anywhere. They go now, and one
         of them lands mid-flight rather than instantly, because an IoT estate
         does not provision in a second and a screen that never shows the
         in-between state is a screen nobody can read. */
      perform public.com_send(c.id, base + interval '2 minutes');
      if c.fulfil = 'provisioned' then
        perform public.com_state(c.id, 'in-progress', 'Allocating SIMs from the estate pool.',
                                 base + interval '9 minutes');
      end if;
    end if;
  end loop;

  /* One of them lands mid-flight rather than instantly. An eSIM whose profile
     has been released and not yet installed is genuinely in progress — the
     network has done its part and the customer has not scanned the code — and
     it is the state a support agent is asked about most often. A queue that
     never shows the in-between is a queue nobody can read. */
  select * into c from public.com_order
   where state = 'acknowledged' and fulfil = 'esim' order by id limit 1;
  if c.id is not null then
    perform public.com_state(c.id, 'in-progress',
      'Profile released to the SM-DP+ and the activation code sent. Waiting for the customer to install it.',
      now() - interval '40 minutes');
  end if;
end $$;

/* ---- 4. The two failures, both real ------------------------------------------ */

/* A guest checkout. The marketplace has a buyer, an email and a payment; the
 * network has nobody to attach a service to. This is the commonest integration
 * failure between a storefront and an order manager and it is a REJECTION, not
 * a timeout: the customer reference will be just as absent on the fifth attempt
 * as on the first, so it is not retried and the reason is what somebody acts on.
 */
insert into public.orders
  (id, order_ref, status, total, subtotal, tax, discount, payment_method,
   buyer_name, buyer_email, created_at, placed_date, seller, vertical, stage, stages,
   currency, market, tax_rate)
values
  ('a0000000-0000-0000-0002-000000990311', 'ORD-990311', 'processing',
   16.20, 13.97, 2.23, 0, 'Card', 'Guest checkout', 'j.mwangi@example.com',
   now() - interval '3 hours', to_char(now() - interval '3 hours', 'DD Mon YYYY'),
   'Aventa Telecom', 'consumer', 1,
   array['Ordered', 'Confirmed', 'Provisioning', 'Activating', 'Active'],
   'USD', 'KE', 16.00)
on conflict (id) do nothing;

insert into public.order_items (id, order_id, product_id, product_name, price, quantity, status)
values ('b0000000-0000-0000-0002-000000990311', 'a0000000-0000-0000-0002-000000990311',
        'SKU-2003', 'Travel eSIM — 10 GB, 30 days', 13.97, 1, 'placed')
on conflict (id) do nothing;

/* An Emirati IoT order against an order manager that is behind. Sent, accepted,
 * and then silence — the state that quietly loses orders, and the reason
 * `ack_sla_seconds` exists. Nothing is wrong with the order; something is wrong
 * with the platform, and the difference belongs on the screen.
 */
insert into public.orders
  (id, order_ref, status, total, subtotal, tax, discount, payment_method,
   buyer_name, buyer_email, created_at, placed_date, seller, vertical, stage, stages,
   currency, market, tax_rate, account_id, ordered_by, cost_centre, po_ref)
values
  ('a0000000-0000-0000-0002-000000771903', 'ORD-771903', 'processing',
   1436.40, 1368.00, 68.40, 0, 'Invoice', 'Omar Haddad', 'omar.haddad@meridianfoods.ae',
   now() - interval '5 hours', to_char(now() - interval '5 hours', 'DD Mon YYYY'),
   'Aventa Telecom', 'iot', 1,
   array['Ordered', 'Approved', 'Provisioning', 'Activated', 'In service'],
   'AED', 'AE', 5.00, 'ENT-2012', 'EU-2012-01', 'CC-2012-COLD', 'PO-MF-2026-08')
on conflict (id) do nothing;

insert into public.order_items (id, order_id, product_id, product_name, price, quantity, status)
values ('b0000000-0000-0000-0002-000000771903', 'a0000000-0000-0000-0002-000000771903',
        'SKU-5002', 'IoT Connect 2 GB', 11.40, 120, 'placed')
on conflict (id) do nothing;

do $$
declare id_guest text; id_ae text; res jsonb;
begin
  select id into id_guest from public.com_order where order_ref = 'ORD-990311';
  select id into id_ae    from public.com_order where order_ref = 'ORD-771903';

  if id_guest is null or id_ae is null then
    raise exception 'the trigger did not queue the two new lines (guest %, ae %)', id_guest, id_ae;
  end if;

  /* Rejected on its own merits, by the same code path a real one would take. */
  res := public.com_send(id_guest, now() - interval '2 hours 55 minutes');
  if res ->> 'state' <> 'rejected' then
    raise exception 'the guest order was not rejected: %', res;
  end if;

  /* Accepted, and then nothing — the Emirati platform is twelve minutes behind
     and this one is well past that. */
  perform public.com_send(id_ae, now() - interval '4 hours 55 minutes');
  update public.com_order set
    acknowledged_at = null, state = 'sent',
    note = 'Accepted at the transport level and never acknowledged. The Emirati platform has been running behind since the 4 August upgrade.'
   where id = id_ae;
  update public.com_event set kind = 'submitted', state = 'sent',
         detail = 'Sent. No acknowledgement received.'
   where com_order = id_ae and kind = 'acknowledged';
end $$;

/* ---- 5. The rule that makes any of this matter ------------------------------- */

/* An order does not reach its last stage while the network has not finished.
 *
 * Without this the screens are decorative: a seller or a job could walk an order
 * to "Active" with the provisioning request still queued, and every one of the
 * states above would be a label rather than a fact. The refusal names the state
 * COM is actually in, because "cannot complete" with no reason is not something
 * anybody can act on.
 */
create or replace function public.guard_order_completion()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare c record;
begin
  if new.stage < array_length(new.stages, 1) - 1 then return new; end if;
  if new.stage = old.stage then return new; end if;

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

drop trigger if exists z_guard_order_completion on public.orders;
create trigger z_guard_order_completion
  before update of stage on public.orders
  for each row execute function public.guard_order_completion();

/* ---- 6. Assertions ------------------------------------------------------------ */

do $$
declare n int; bad text; c public.com_order; want text;
begin
  /* Nothing the network fulfils is unaccounted for. */
  select count(*) into n from public.order_items i
    join public.products p on p.id = i.product_id
   where p.fulfilment_route = 'telco-com'
     and not exists (select 1 from public.com_order x where x.order_item_id = i.id);
  if n > 0 then raise exception '% network lines were still never sent anywhere', n; end if;

  /* Nothing the network does NOT fulfil was sent to it. */
  select string_agg(x.product_id, ', ') into bad from public.com_order x
    join public.products p on p.id = x.product_id
   where p.fulfilment_route <> 'telco-com';
  if bad is not null then raise exception 'sent to the order manager and not its business: %', bad; end if;

  /* Every state a screen has to render exists in the data. A queue with only
     happy rows in it is a queue nobody has looked at under load. */
  foreach want in array array['completed', 'in-progress', 'rejected', 'sent', 'cancelled'] loop
    select count(*) into n from public.com_order where state = want;
    if n = 0 then raise exception 'no push is in state "%", so that case is drawn against nothing', want; end if;
  end loop;

  /* A rejection is not retried and says why. */
  select * into c from public.com_order where state = 'rejected' limit 1;
  if c.next_attempt_at is not null then
    raise exception 'a rejected push is scheduled for retry — the field will be just as empty next time';
  end if;
  if coalesce(c.failure_reason, '') !~* 'customer reference' then
    raise exception 'the rejection does not name what was missing: %', c.failure_reason;
  end if;

  /* An accepted order is not a completed one, and the two carry different
     timestamps to prove it. */
  select count(*) into n from public.com_order
   where state = 'completed' and (acknowledged_at is null or completed_at is null
                                  or completed_at <= acknowledged_at);
  if n > 0 then raise exception '% completions did not follow an acknowledgement', n; end if;

  /* The buyer's ladder and the order manager's state tell one story. */
  select string_agg(o.order_ref, ', ') into bad
    from public.orders o join public.com_order x on x.order_ref = o.order_ref
   where o.stage >= array_length(o.stages, 1) - 1
     and x.state not in ('completed', 'cancelled');
  if bad is not null then
    raise exception 'orders shown as finished whose service was never provisioned: %', bad;
  end if;

  /* And no eSIM is being posted to anybody. */
  select string_agg(distinct o.order_ref, ', ') into bad
    from public.orders o
    join public.com_order x on x.order_ref = o.order_ref
   where x.fulfil = 'esim' and o.stages @> array['In transit'];
  if bad is not null then raise exception 'eSIM orders still in transit: %', bad; end if;

  /* The guard holds. */
  begin
    update public.orders set stage = 4 where order_ref = 'ORD-990311';
    raise exception 'an order with a rejected provisioning request walked to its last stage';
  exception when others then
    if sqlerrm not like '%cannot show as%' then
      raise exception 'completing the order failed on % rather than the guard', sqlerrm;
    end if;
  end;

  raise notice 'pushes: % (% completed, % in flight, % rejected, % failed)',
    (select count(*) from public.com_order),
    (select count(*) from public.com_order where state = 'completed'),
    (select count(*) from public.com_order where state in ('queued','sent','acknowledged','in-progress')),
    (select count(*) from public.com_order where state = 'rejected'),
    (select count(*) from public.com_order where state = 'failed');
end $$;
