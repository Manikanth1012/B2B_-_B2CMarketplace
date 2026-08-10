/* A seller could read the id of everyone who bought from them.
 *
 * `vendor_renewal_book` was written to return the subscription and never the
 * subscriber, and the seller's screen shows exactly that. Then the same
 * migration gave sellers a row-level policy on `subscription_charge` so they
 * could see what they had reported — and every row on that table carries
 * `user_id`. Row-level security restricts rows, not columns, and the table
 * grant is on the whole table, so `select user_id from subscription_charge`
 * answered.
 *
 * Nothing a seller can read joins that id to a person: `consumer_profile` is
 * closed to them. It is still a customer list handed over by a screen that says
 * in its own help text that it does not hand one over, which is the shape of
 * problem this build keeps finding — a control that is a sentence rather than a
 * rule.
 *
 * The fix is the one already used for the book: a function that returns the
 * columns a seller needs, rather than a policy on a table that has more columns
 * than that. The policy goes; the function names its own output.
 */

drop policy if exists vendor_reads_own_subscription_charge on public.subscription_charge;

/**
 * The cycles a seller has reported, without the customers behind them.
 *
 * Same authorisation as `vendor_renewal_book`: a seller gets their own and the
 * marketplace may ask for anybody's, and there is no third answer.
 */
create or replace function public.vendor_reported_charges(
  p_partner text default null)
returns table (
  id text, ref text, product_id text, product_name text,
  period_start date, period_end date, period_label text,
  amount numeric, currency text, vendor_ref text, reported_by text,
  reported_at timestamptz, bill_id text)
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if public.current_persona() = 'partner' then
    who := public.current_partner_id();
  elsif public.current_persona() = 'operator' then
    who := p_partner;
    if who is null then raise exception 'Which seller''s cycles?'; end if;
  else
    raise exception 'Reported cycles belong to the seller who reported them.';
  end if;
  if who is null then raise exception 'You are not signed in as a seller.'; end if;

  return query
    select c.id, c.ref, c.product_id, c.product_name,
           c.period_start, c.period_end, c.period_label,
           c.amount, c.currency, c.vendor_ref, c.reported_by,
           c.reported_at, c.bill_id
      from public.subscription_charge c
     where c.source = 'vendor' and c.vendor_id = who
     order by c.period_start desc, c.ref;
end $$;

revoke all on function public.vendor_reported_charges(text) from public;
grant execute on function public.vendor_reported_charges(text) to authenticated;

/* --------------------------------------------------------------- the check -- */

do $$
declare
  beacon uuid;
  n      integer;
begin
  select p.id into beacon from public.profiles p
   where p.partner_id = 'PTR-1009' and p.persona = 'partner' limit 1;
  if beacon is null then raise exception 'No seller to check as.'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', beacon)::text, true);
  /* Both halves, or this proves nothing. The claim decides who `auth.uid()`
     says we are; the role decides whether row-level security applies at all,
     and it does not apply to the role a migration runs as. A check written with
     only the first half counts every row on the table and reports the hole it
     was meant to prove closed. */
  set local role authenticated;

  /* The door that was open. */
  select count(*) into n from public.subscription_charge;
  if n > 0 then
    raise exception 'A seller can still read % rows of subscription_charge directly.', n;
  end if;

  /* And the one that replaced it, which answers with no customer on it. */
  select count(*) into n from public.vendor_reported_charges();
  if n = 0 then
    raise exception 'The seller cannot read the cycles they reported, so this closed the wrong door.';
  end if;

  select count(*) into n
    from information_schema.columns
   where table_schema = 'public' and table_name = 'subscription_charge'
     and column_name = 'user_id';
  if n <> 1 then raise exception 'user_id is no longer on subscription_charge; this check is stale.'; end if;

  reset role;
  perform set_config('request.jwt.claims', null, true);
end $$;

/* The operator's own reading of the table is untouched — the operator policy
   was always separate, and the desk that chases a vendor is the desk that
   holds the customer record anyway. */
do $$
declare operator uuid; n integer;
begin
  select id into operator from auth.users where email = 'anika.sharma@aventa.com';
  perform set_config('request.jwt.claims', json_build_object('sub', operator)::text, true);
  set local role authenticated;
  select count(*) into n from public.subscription_charge;
  if n = 0 then raise exception 'The operator lost their read on subscription_charge.'; end if;
  reset role;
  perform set_config('request.jwt.claims', null, true);
end $$;
