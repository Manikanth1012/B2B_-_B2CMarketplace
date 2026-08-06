/* The desk says it is fixed. The person who raised it says whether it is.
 *
 * `support_tickets.status` has had 'resolved' and 'closed' as separate states
 * since the table was written, and nothing has ever reached 'closed'. The
 * desk's action set 'resolved' and the toast said "closed. Reopening it means
 * raising a new one" — so the ladder existed, the top rung was never used, and
 * the requester was told the matter was over by the party who decided it was.
 *
 * That is the loop this closes. The two rungs now mean two different things:
 *
 *   resolved — the desk believes it is fixed, and is waiting to be told
 *   closed   — the person who raised it agrees, or the window ran out
 *
 * Between them sits a window. Inside it the requester has exactly two answers,
 * and both are real: confirm, and the ticket closes with their name on it; or
 * say it is not fixed, and it goes back to the desk with the reopen counted.
 * A ticket that bounces twice is a ticket that was cleared from a queue rather
 * than answered, and now the queue can see that.
 *
 * Three ways to close, kept apart on purpose, because "closed" with the
 * customer's agreement and "closed" because nobody replied are not the same
 * fact and a desk measured on the total will always prefer the second:
 *
 *   confirmed — the requester pressed it themselves
 *   offline   — the desk recorded an agreement given by phone or email, and
 *               has to name who gave it
 *   auto      — the window ran out with no answer
 *
 * The operator keeps every other power it had. What it loses is the ability to
 * move a ticket to 'closed' as if the requester had agreed.
 */

begin;

/* ---- How long the requester gets ---------------------------------------- */

/* On support_sla rather than in a policy table of its own: it is already
   "how long, for what priority", it is already loaded by loadSupport, and so
   every screen that can quote a resolution target can quote this one without a
   second query. A P1 window is shorter because a P1 requester is waiting by
   the phone; a P4 window is longer because nobody is. */
alter table support_sla add column if not exists confirm_days int not null default 3;

update support_sla set confirm_days = case priority
  when 'P1' then 2 when 'P2' then 2 when 'P3' then 3 else 5 end
where confirm_days = 3;

/* ---- What the ticket remembers about being closed ------------------------ */

alter table support_tickets add column if not exists confirm_due   timestamptz;
alter table support_tickets add column if not exists confirmed_by  text;
alter table support_tickets add column if not exists confirmed_at  timestamptz;
alter table support_tickets add column if not exists closed_how    text;
alter table support_tickets add column if not exists reopened      int not null default 0;

alter table support_tickets drop constraint if exists support_tickets_closed_how_check;
alter table support_tickets add constraint support_tickets_closed_how_check
  check (closed_how is null or closed_how in ('confirmed', 'offline', 'auto'));

/* A closed ticket says how it closed, and one closed on somebody's word names
   whose word it was. Without this, "closed" is a status with no author. */
alter table support_tickets drop constraint if exists support_tickets_closed_says_how;
alter table support_tickets add constraint support_tickets_closed_says_how check (
  status <> 'closed'
  or (closed_how = 'auto')
  or (closed_how in ('confirmed', 'offline') and coalesce(confirmed_by, '') <> '')
);

create index if not exists support_tickets_awaiting_idx
  on support_tickets (confirm_due) where status = 'resolved';

/* ---- The rules ----------------------------------------------------------- */

create or replace function guard_ticket_closure() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  days int;
  who  text;
  mine boolean;
begin
  if new.status is not distinct from old.status then
    /* Not a move between rungs. Nobody may quietly rewrite how a closed ticket
       came to be closed, though — that is the record of the consent. */
    if old.status = 'closed' then
      new.closed_how   := old.closed_how;
      new.confirmed_by := old.confirmed_by;
      new.confirmed_at := old.confirmed_at;
    end if;
    new.reopened := old.reopened;
    return new;
  end if;

  who := coalesce(current_persona(), 'service');

  /* Whether the caller is the party that raised this ticket. A ticket raised by
     a company belongs to the company, not to whoever happened to click — the
     colleague picking it up next week has to be able to answer it. */
  mine := (old.user_id is not null and old.user_id = auth.uid())
       or (old.account_id is not null and old.account_id = current_account_id())
       or (old.partner_id is not null and old.partner_id = current_partner_id());

  /* --- the desk says it is fixed --- */
  if new.status = 'resolved' then
    select confirm_days into days from support_sla where priority = old.priority;
    new.resolved_at  := now();
    new.confirm_due  := now() + make_interval(days => coalesce(days, 3));
    /* A second pass at resolving clears any earlier answer, so the window that
       is running is the one the requester is actually being asked about. */
    new.confirmed_by := null;
    new.confirmed_at := null;
    new.closed_how   := null;
    new.reopened     := old.reopened;
    return new;
  end if;

  /* --- somebody says it is over --- */
  if new.status = 'closed' then
    if old.status <> 'resolved' then
      raise exception 'a ticket is closed from resolved, not from %. The desk answers it first, then the person who raised it agrees', old.status;
    end if;

    if new.closed_how = 'auto' then
      /* The clock, not a person. It cannot be wound forward. */
      if old.confirm_due is null or now() < old.confirm_due then
        raise exception 'the confirmation window has not run out — % still has until % to answer', old.opened_by, old.confirm_due;
      end if;
      new.confirmed_by := null;
      new.confirmed_at := now();

    elsif new.closed_how = 'offline' then
      /* The desk recording an agreement given somewhere this system cannot
         see. Allowed, because real desks take phone calls — but it has to name
         who agreed, so it reads as somebody's word rather than as consent. */
      if who not in ('operator', 'partner') then
        raise exception 'only the desk records an agreement given offline';
      end if;
      if coalesce(new.confirmed_by, '') = '' then
        raise exception 'name who agreed to this — an offline close with no name is a close with no consent';
      end if;
      new.confirmed_at := now();

    else
      /* The requester pressing it themselves. This is the only path that means
         what "closed" is supposed to mean, and only they can take it. */
      if not mine then
        raise exception 'only % can confirm this is resolved. The desk can record an agreement given offline, or wait for the window to run out', old.opened_by;
      end if;
      new.closed_how   := 'confirmed';
      new.confirmed_by := coalesce(nullif(new.confirmed_by, ''), old.opened_by);
      new.confirmed_at := now();
    end if;

    new.reopened := old.reopened;
    return new;
  end if;

  /* --- it was not fixed --- */
  if old.status = 'resolved' and new.status in ('open', 'escalated') then
    if not mine and who not in ('operator', 'partner') then
      raise exception 'only % or the desk can reopen this', old.opened_by;
    end if;
    new.reopened        := old.reopened + 1;
    new.resolved_at     := null;
    new.confirm_due     := null;
    new.resolution_note := null;
    new.confirmed_by    := null;
    new.confirmed_at    := null;
    new.closed_how      := null;
    return new;
  end if;

  /* Nothing reopens a closed ticket. The answer to a closed ticket that turned
     out to be wrong is a new ticket, which keeps the thread honest about when
     each thing was actually raised. */
  if old.status = 'closed' then
    raise exception 'this ticket was closed on % — raise a new one rather than reopening it', old.confirmed_at;
  end if;

  new.reopened := old.reopened;
  return new;
end $fn$;

/* Fires after guard_ticket, which returns early for the operator — these rules
   apply to the operator too, so they need a trigger of their own. Postgres runs
   BEFORE triggers in name order, and 'z_' puts this last. */
drop trigger if exists z_guard_ticket_closure on support_tickets;
create trigger z_guard_ticket_closure
  before update on support_tickets
  for each row execute function guard_ticket_closure();

/* ---- Closing the ones nobody answered ----------------------------------- */

/* Run by the marketplace's own console rather than by a cron this prototype
   does not have. Returns what it closed, so the screen can say so rather than
   report a number nobody can check. */
create or replace function close_unanswered_tickets()
returns table (id text, subject text, opened_by text, resolved_at timestamptz)
language plpgsql security definer set search_path = public as $fn$
begin
  if coalesce(current_persona(), '') <> 'operator' then
    raise exception 'only the marketplace closes the ones nobody answered';
  end if;

  return query
  update support_tickets t
     set status = 'closed', closed_how = 'auto'
   where t.status = 'resolved'
     and t.confirm_due is not null
     and now() >= t.confirm_due
  returning t.id, t.subject, t.opened_by, t.resolved_at;
end $fn$;

grant execute on function close_unanswered_tickets() to authenticated;

/* ---- What this asserts --------------------------------------------------- */

do $$
declare
  n int;
begin
  select count(*) into n from support_sla where confirm_days is null or confirm_days < 1;
  if n <> 0 then raise exception 'every priority needs a confirmation window'; end if;

  /* A closed ticket that does not say how it closed is refused. This is the
     constraint that stops "closed" from being a status with no author. */
  begin
    update support_tickets set status = 'closed', closed_how = null
     where id = (select id from support_tickets limit 1);
    raise exception 'a ticket closed with no closed_how was accepted';
  exception when check_violation or raise_exception then
    null;
  end;

  select count(*) into n from pg_trigger
   where tgrelid = 'public.support_tickets'::regclass and tgname = 'z_guard_ticket_closure';
  if n <> 1 then raise exception 'the closure trigger is not attached'; end if;

  /* It has to sort after guard_ticket, or the operator's early return in that
     function would not matter — but these rules would still never see an
     operator's update. */
  if 'z_guard_ticket_closure' <= (
      select tgname from pg_trigger
       where tgrelid = 'public.support_tickets'::regclass and tgname like '%guard_ticket'
       limit 1) then
    raise exception 'the closure trigger would run before guard_ticket';
  end if;
end $$;

commit;
