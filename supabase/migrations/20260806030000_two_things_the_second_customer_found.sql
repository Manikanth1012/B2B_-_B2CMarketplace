/*
  # Two things the second customer found

  Both of these were live before the Kenyan shopper existed. Neither could be
  seen, because seeing them needed an account that nobody had: one with an
  unpaid bill, and one whose wallet screen was opened by a signed-in consumer
  rather than by a script holding a management token.

  ## 1. A bill was unpaid in two different words

  `consumer_bills.status` held `paid`, `open` and `due` with no constraint
  saying which. The Bills tab counts what is outstanding with
  `bills.filter(b => b.status === 'open')`, so a bill marked `due` was not
  outstanding, was not an open bill, and contributed nothing to the total. The
  screen read "Outstanding —" and "Open bills 0" above two bills it had just
  drawn with a "due" pill on each.

  It stayed invisible because the only customer with an unpaid bill had exactly
  one and it happened to say `open`.

  `open` wins rather than `due`, because `enterprise_invoices` already uses it
  for the same idea and one vocabulary for one concept is worth more than either
  word being marginally nicer on a bill. The constraint is the point: the reason
  there were two spellings is that nothing refused the second.

  ## 2. A function no signed-in customer could call

  `expire_stale_payments()` opened with `delete from expired_now;` — a temporary
  table, unqualified. PostgREST runs client requests with `safeupdate` on, which
  refuses any DELETE without a WHERE clause, so the call returned 400 to every
  consumer whose wallet screen loaded. It worked perfectly from a management
  token, which is the only way it had ever been run.

  The consequence was quiet: the wallet's "payments that did not go through"
  never loaded, and nothing ever expired an abandoned payment from the browser
  — which is the only place it is called from.

  Rewritten without the temporary table. Every statement now has a WHERE clause,
  which is a better shape anyway: it also fixes `moved` being counted off the
  wrong statement.
*/

/* ------------------------------------------------- one word for unpaid --- */

update consumer_bills set status = 'open' where status = 'due';

alter table consumer_bills drop constraint if exists consumer_bills_status_check;
alter table consumer_bills add constraint consumer_bills_status_check
  check (status in ('paid', 'open'));

/* A paid bill says when, and an unpaid one does not pretend to. */
alter table consumer_bills drop constraint if exists consumer_bills_paid_check;
alter table consumer_bills add constraint consumer_bills_paid_check
  check ((status = 'paid') = (paid_on is not null));

/* ------------------------------------- a function a customer can call --- */

create or replace function expire_stale_payments() returns integer
language plpgsql security definer set search_path = public as $$
declare
  gone_refs text[];
  moved     integer;
begin
  /* No temporary table, and so no unqualified DELETE to clear it. PostgREST
     runs client requests with `safeupdate`, which refuses one — so the old
     shape was a function only a management token could call, called only from
     a browser. */
  with gone as (
    update payment_attempts
       set state = 'expired',
           decided_at = now(),
           failure_reason = null
     where state = 'initiated'
       and started_at < now() - interval '15 minutes'
    returning reference, purpose
  )
  select array_agg(reference) filter (where purpose = 'order'), count(*)
    into gone_refs, moved
    from gone;

  /* A basket whose payment expired is a basket nobody paid for. Nothing was
     charged, so there is nothing to keep. */
  if gone_refs is not null then
    delete from order_items oi
     using orders o
     where oi.order_id = o.id
       and o.payment_ref = any(gone_refs)
       and o.status = 'awaiting_payment';

    delete from orders
     where payment_ref = any(gone_refs)
       and status = 'awaiting_payment';
  end if;

  return coalesce(moved, 0);
end $$;

grant execute on function expire_stale_payments() to authenticated;

do $$
declare
  n integer;
begin
  select count(*) into n from consumer_bills where status not in ('paid', 'open');
  if n > 0 then raise exception '% bills are in a state a bill cannot be in', n; end if;

  select count(*) into n from consumer_bills where (status = 'paid') <> (paid_on is not null);
  if n > 0 then raise exception '% bills disagree with themselves about being paid', n; end if;

  /* The Kenyan account has unpaid bills in both currencies, which is what made
     the counter's silence visible. If that stops being true this assertion is
     the thing that notices. */
  select count(distinct currency) into n from consumer_bills
   where status = 'open' and user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13';
  if n <> 2 then
    raise exception 'The two-currency outstanding case is no longer covered by any account';
  end if;

  /* The function runs and returns a number rather than raising. It cannot be
     called here the way a customer calls it, so this only proves it parses and
     executes — the browser is what proves the rest. */
  perform expire_stale_payments();

  if to_regprocedure('public.expire_stale_payments()') is null then
    raise exception 'expire_stale_payments did not take';
  end if;
end $$;
