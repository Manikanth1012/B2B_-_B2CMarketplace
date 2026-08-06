/* Saying "it is not fixed" was the one answer the older trigger refused.
 *
 * The closure trigger added a moment ago gives the requester two real answers:
 * confirm, or send it back. The second one never worked. `guard_ticket` was
 * written when 'resolved' was the end of the road, and its transition rule
 * reads:
 *
 *     if new.status not in (old.status, 'resolved', 'closed') then
 *       raise exception 'a requester can add to a ticket or accept the
 *                        resolution, not move it to %', new.status;
 *
 * A requester moving a resolved ticket back to 'open' is exactly that
 * exception. So the button rendered, the customer typed why it was not fixed,
 * pressed it, and the row did not change — two triggers on one table
 * disagreeing about what the second rung means. Found by pressing it.
 *
 * The rule was right when it was written: a requester should not be able to
 * pick a ticket up off the queue and set it to 'open' or 'escalated' whenever
 * they like, because 'escalated' in particular is a promise the marketplace
 * makes rather than one a customer takes. What it needs is the one transition
 * the loop depends on — resolved back to open, by the person being asked to
 * agree. Everything else it refused, it still refuses.
 */

begin;

create or replace function guard_ticket() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare sla record;
begin
  /* Clamped to actual requesters. A null persona is a migration or a service
     role, and treating it as a requester means this trigger silently rewrites
     the seed it is meant to protect — which is exactly what happened the first
     time it ran. */
  if current_persona() is null or current_persona() = 'operator' then return new; end if;

  if tg_op = 'INSERT' then
    select * into sla from support_sla where priority = new.priority;
    if sla is null then raise exception 'no such priority: %', new.priority; end if;
    if new.status <> 'new' then
      raise exception 'a ticket starts as new — it cannot be raised already open or resolved';
    end if;
    /* The targets come from the policy, never from the client. */
    new.sla_mins := sla.resolve_mins;
    new.response_mins := null;
    new.first_response_mins := null;
    new.breached := false;
    new.escalated := false;
    new.waiting_minutes := 0;
    new.resolution_mins := null;
    new.opened_at := now();
    return new;
  end if;

  /* Numbers the desk is measured on stay as they were. */
  new.sla_mins := old.sla_mins;
  new.response_mins := old.response_mins;
  new.first_response_mins := old.first_response_mins;
  new.resolution_mins := old.resolution_mins;
  new.breached := old.breached;
  new.escalated := old.escalated;
  new.escalated_at := old.escalated_at;
  new.owner := old.owner;
  new.opened_at := old.opened_at;
  new.priority := old.priority;
  new.waiting_minutes := old.waiting_minutes;

  /* Replying clears "waiting on the requester" and banks the paused time —
     that is the whole point of the pause. */
  if old.waiting_on_customer and jsonb_array_length(new.messages) > jsonb_array_length(old.messages) then
    new.waiting_on_customer := false;
    new.waiting_minutes := old.waiting_minutes
      + coalesce(extract(epoch from (now() - old.waiting_since)) / 60, 0)::integer;
    new.waiting_since := null;
  end if;

  /* What a requester may do with the status.
     Unchanged except for the last branch: a resolved ticket may be sent back to
     'open' by the person who is being asked whether it is fixed. That is the
     "no" half of the consent loop, and without it the only answer they can
     give is yes. 'escalated' stays out of reach on purpose — escalation is a
     promise the marketplace makes, not one a customer can take for itself. */
  if new.status not in (old.status, 'resolved', 'closed')
     and not (old.status = 'resolved' and new.status = 'open') then
    raise exception 'a requester can add to a ticket, accept the resolution or send it back — not move it to %', new.status;
  end if;

  /* The note is required to *reach* resolved or closed. Leaving them clears it,
     which is what sending it back does, so this only checks the arriving side. */
  if new.status in ('resolved', 'closed') and coalesce(new.resolution_note, '') = '' then
    raise exception 'say what resolved it — a ticket closed with no note is one somebody cleared from a queue';
  end if;
  if new.status in ('resolved', 'closed') and old.status not in ('resolved', 'closed') then
    new.resolved_at := now();
  end if;

  return new;
end $fn$;

do $$
declare src text;
begin
  select prosrc into src from pg_proc where proname = 'guard_ticket';
  if position('send it back' in src) = 0 then
    raise exception 'guard_ticket was not replaced';
  end if;
  /* The transitions it still refuses. If this branch ever loses the
     'escalated' case, a customer can escalate their own ticket and the SLA
     stops being a promise the marketplace made. */
  if position('old.status = ''resolved'' and new.status = ''open''' in src) = 0 then
    raise exception 'the send-back transition is not the narrow one intended';
  end if;
end $$;

commit;
