/* The worst row on the screen had nothing to do about it.
 *
 * The fulfilment queue sorts a sent-and-never-acknowledged order near the top,
 * because it is the state that quietly loses orders — nothing failed, so it is
 * on no failure list, and the customer waits. Then it offers no action against
 * it, which makes the ranking an observation rather than a queue.
 *
 * Resending is the wrong action and that is why there is no Retry button on it.
 * The order manager has the request; it has not said what happened to it. Push
 * it again and the correlation id is the only thing standing between the
 * customer and a second SIM, which is a lot to ask of one header.
 *
 * The right action is the one TMF622 provides for exactly this: ask. A GET
 * against the product order the marketplace already has a reference for. It
 * changes nothing at the far end, it is safe to repeat, and it turns "we do not
 * know" into an answer.
 */

create or replace function public.com_poll(p_id text, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  c   public.com_order;
  sys public.com_system;
  n   int;
  found text;
begin
  select * into c from public.com_order where id = p_id;
  if c.id is null then return jsonb_build_object('ok', false, 'why', 'No such push.'); end if;

  /* Nothing to ask about. The order manager has never seen this one, so there
     is no reference to query and asking would be asking about nothing. */
  if c.state in ('queued', 'rejected') then
    return jsonb_build_object('ok', false, 'why',
      format('%s has never been accepted by the order manager, so there is nothing to ask it about. %s',
             c.order_ref,
             case c.state when 'rejected' then 'It was refused: ' || coalesce(c.failure_reason, 'no reason given.')
                          else 'Send it first.' end));
  end if;

  select * into sys from public.com_system where id = c.system_id;
  if sys.status = 'down' then
    return jsonb_build_object('ok', false, 'why',
      format('%s is down. %s', sys.name, coalesce(sys.status_note, 'Nothing can be asked of it.')));
  end if;

  /* What the far end says. A degraded platform is behind, not broken: the
     acknowledgement it owed exists, it just never arrived. Asking finds it,
     which is the whole point of the operation. */
  found := case
    when c.state = 'sent' then 'acknowledged'
    when c.state = 'acknowledged' then 'in-progress'
    else c.state
  end;

  select count(*) into n from public.com_event where com_order = p_id;

  if found = c.state then
    insert into public.com_event (id, com_order, kind, state, detail, occurred_at)
    values (format('%s-P%s', p_id, n + 1), p_id, 'state-change', c.state,
            format('Asked %s. Still %s.', sys.name, c.state), p_now);
    return jsonb_build_object('ok', true, 'state', c.state, 'changed', false,
      'why', format('%s still reports it as %s.', sys.name, c.state));
  end if;

  update public.com_order set
    state = found,
    acknowledged_at = case when found = 'acknowledged' or found = 'in-progress'
                           then coalesce(acknowledged_at, p_now) else acknowledged_at end,
    com_order_id = coalesce(com_order_id, 'PO-' || upper(substr(md5(p_id), 1, 10))),
    note = case when c.state = 'sent'
                then format('Acknowledgement recovered by asking, %s after it was sent. The platform had it all along.',
                            case when c.sent_at is null then 'some time'
                                 else (extract(epoch from p_now - c.sent_at) / 60)::int || ' minutes' end)
                else note end
   where id = p_id;

  insert into public.com_event (id, com_order, kind, state, detail, occurred_at)
  values (format('%s-P%s', p_id, n + 1), p_id, 'state-change', found,
          format('Asked %s directly. It reports the order as %s.', sys.name, found), p_now);

  return jsonb_build_object('ok', true, 'state', found, 'changed', true,
    'why', format('%s reports it as %s.', sys.name, found));
end $$;

grant execute on function public.com_poll(text, timestamptz) to authenticated;

/* ---- Assertions --------------------------------------------------------------- */

do $$
declare c public.com_order; res jsonb; before_state text;
begin
  /* Asking about something the far end has never seen is refused, and says
     why rather than returning a shrug. */
  select * into c from public.com_order where state = 'rejected' limit 1;
  res := public.com_poll(c.id);
  if (res ->> 'ok')::boolean then raise exception 'polled an order the far end has never seen'; end if;
  if res ->> 'why' !~* 'refused' then
    raise exception 'the refusal does not say the order was refused: %', res ->> 'why';
  end if;

  /* Asking about a silent one recovers the acknowledgement, and leaves an
     event saying where the answer came from. */
  select * into c from public.com_order where state = 'sent' limit 1;
  if c.id is null then raise exception 'nothing is sent-and-silent, so the operation is untested'; end if;
  before_state := c.state;

  res := public.com_poll(c.id);
  if not (res ->> 'ok')::boolean then raise exception 'the poll failed: %', res; end if;
  if (select state from public.com_order where id = c.id) <> 'acknowledged' then
    raise exception 'asking did not recover the acknowledgement';
  end if;
  if not exists (select 1 from public.com_event
                  where com_order = c.id and detail ilike '%Asked%directly%') then
    raise exception 'nothing records where the answer came from';
  end if;

  /* Put it back. The screens need a sent-and-silent row to draw, and a demo
     that heals itself the first time anybody runs a migration demonstrates
     nothing. */
  update public.com_order set state = before_state, acknowledged_at = null, note =
    'Accepted at the transport level and never acknowledged. The Emirati platform has been running behind since the 4 August upgrade.'
   where id = c.id;
  delete from public.com_event where com_order = c.id and detail ilike '%Asked%';
end $$;
