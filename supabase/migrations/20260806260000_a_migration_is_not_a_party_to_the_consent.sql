/* A migration is not a party to the consent.
 *
 * `guard_ticket_closure` applies its rules to everybody, which is the point —
 * the operator is not exempt from needing the requester's word. But it also
 * applied them to connections that are not a party to anything: a migration, a
 * seed, the service role. The first time that mattered was immediately. Putting
 * a ticket back the way the seed had it after a verification run came back
 *
 *     this ticket was closed on 2026-08-06 08:52:21 — raise a new one rather
 *     than reopening it
 *
 * which is the right answer to give a person and the wrong one to give a
 * migration. A rule that cannot be corrected by the thing that wrote it makes
 * the seed unmaintainable, and the next person hits it while trying to fix
 * something worse.
 *
 * `guard_ticket` already made this call, in a comment worth repeating: "A null
 * persona is a migration or a service role, and treating it as a requester
 * means this trigger silently rewrites the seed it is meant to protect."
 * `current_persona()` reads `profiles`, and every signed-in persona has a row
 * there — so null means nobody is signed in, not that somebody is hiding.
 *
 * The operator is deliberately *not* given this escape. An operator is signed
 * in, is a party, and is the one whose word this whole change says is not
 * enough on its own.
 */

begin;

create or replace function guard_ticket_closure() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare
  days int;
  who  text;
  mine boolean;
begin
  /* The one exemption: nobody is signed in, so this is a migration, a seed or
     the service role fixing data rather than a party taking a decision. */
  if current_persona() is null then return new; end if;

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

  who := current_persona();

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
      if old.confirm_due is null or now() < old.confirm_due then
        raise exception 'the confirmation window has not run out — % still has until % to answer', old.opened_by, old.confirm_due;
      end if;
      new.confirmed_by := null;
      new.confirmed_at := now();

    elsif new.closed_how = 'offline' then
      if who not in ('operator', 'partner') then
        raise exception 'only the desk records an agreement given offline';
      end if;
      if coalesce(new.confirmed_by, '') = '' then
        raise exception 'name who agreed to this — an offline close with no name is a close with no consent';
      end if;
      new.confirmed_at := now();

    else
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

  if old.status = 'closed' then
    raise exception 'this ticket was closed on % — raise a new one rather than reopening it', old.confirmed_at;
  end if;

  new.reopened := old.reopened;
  return new;
end $fn$;

do $$
declare src text;
begin
  select prosrc into src from pg_proc where proname = 'guard_ticket_closure';
  if position('current_persona() is null then return new' in src) = 0 then
    raise exception 'the migration escape is not there';
  end if;
  /* The operator must NOT have been given the same escape — it is a party. */
  if position('current_persona() = ''operator'' then return new' in src) > 0 then
    raise exception 'the operator was exempted, which is the thing this trigger exists to prevent';
  end if;
end $$;

commit;
