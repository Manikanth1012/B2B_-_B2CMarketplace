-- A customer cannot write their own points.
--
-- The hole: `owner_insert_loyalty_ledger` and `owner_update_loyalty_members`
-- let a signed-in customer write any row they liked against their own member
-- id. The redemption screen used them honestly — subtract the points, post a
-- 'redeem' movement — but nothing made it honest. The same two calls with
-- `points: 1000000` and `type: 'earn'` mint a million points, and since
-- `loyalty_ledger_rebalance` now recomputes the balance from the ledger, the
-- second call is not even needed. A balance a client can write is not a
-- balance, and the enterprise side already knew that: organisation redemption
-- goes through `apply_redemption()` and the account has no write policy at all.
--
-- This does for the consumer what that migration did for the organisation.
-- Redemption becomes one function that checks the programme, the option and the
-- balance and then posts the movement itself; the policies that let a client do
-- it by hand are dropped. The screen keeps its own copy of the rules so it can
-- explain a refusal before asking, which is the same arrangement as everywhere
-- else — the client checks so the message is good, the database checks so the
-- message cannot be skipped.

/* ========================================================== the doorway === */

/**
 * Redeem points, as the marketplace rather than as the customer.
 *
 * SECURITY DEFINER, so it can write the ledger the caller no longer can. Every
 * figure it uses is read here rather than passed in: the option's minimum,
 * step and rate, the programme's floor, and the balance itself. A caller that
 * lies about any of them is describing a world this function does not read.
 */
create or replace function redeem_points(p_option text, p_points numeric)
returns table (ledger_id text, worth numeric, new_balance numeric)
language plpgsql security definer set search_path = public as $$
declare
  me   record;
  opt  record;
  prog record;
  cash numeric;
  txid text;
begin
  if current_persona() is distinct from 'consumer' then
    raise exception 'Only a customer redeems their own points here. An organisation redeems through its own approval, and the marketplace does not redeem on anybody''s behalf.';
  end if;

  select * into me from loyalty_members where user_id = auth.uid();
  if me is null then raise exception 'You are not on a rewards programme.'; end if;

  select * into opt from loyalty_redeem_options where id = p_option;
  if opt is null then raise exception 'No such redemption option.'; end if;
  if opt.status <> 'active' then
    raise exception '% is not available at the moment.', opt.name;
  end if;
  if opt.audience <> 'all' and opt.audience <> me.kind then
    raise exception '% is not offered on your kind of account.', opt.name;
  end if;

  select * into prog from loyalty_programme limit 1;
  if prog is null then raise exception 'No rewards programme is running.'; end if;

  /* The four ways a redemption is wrong, each said the way the screen says it
     so the two cannot drift into disagreeing about the same refusal. */
  if p_points < prog.min_redeem then
    raise exception 'You need at least % points before anything can be redeemed.', prog.min_redeem;
  end if;
  if p_points < opt.min then
    raise exception '% starts at % points.', opt.name, opt.min;
  end if;
  if opt.step > 0 and (p_points % opt.step) <> 0 then
    raise exception '% goes up in steps of % points.', opt.name, opt.step;
  end if;
  if p_points > me.balance then
    raise exception 'That is more than your balance — % points available.', me.balance;
  end if;

  cash := round((p_points / prog.per_unit) * opt.value_per, 2);
  txid := 'LTX-' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS') || '-' || substr(md5(random()::text), 1, 4);

  /* The movement is negative and the type is 'redeem'. Both are stated here
     rather than taken from the caller, which is the whole point of the file. */
  insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id,
                              funder, seller_id, value, note, user_id)
  values (txid, me.id, to_char(current_date, 'DD Mon YYYY'), 'redeem', -p_points,
          opt.id, null, opt.cost, null, cash,
          'Redeemed for ' || lower(opt.name) || ' — ' || to_char(cash, 'FM999,999,990.00'),
          me.user_id);

  /* `loyalty_ledger_rebalance` has already recomputed the balance from the
     ledger by now. What is left is the running totals, which are not derivable
     from a single movement's sign. */
  update loyalty_members
     set lifetime_redeemed = lifetime_redeemed + p_points,
         expiring_soon = greatest(0, expiring_soon - p_points),
         last_activity = to_char(current_date, 'DD Mon YYYY')
   where id = me.id;

  return query
    select txid, cash, (select balance from loyalty_members where id = me.id);
end $$;

revoke all on function redeem_points(text, numeric) from public;
grant execute on function redeem_points(text, numeric) to authenticated;

/* ======================================================= and the doors === */

/* The policies that made the doorway optional. A customer reads their own
   ledger and their own membership; they write neither. Points arrive from an
   order the marketplace settled and leave through the function above. */
drop policy if exists "owner_insert_loyalty_ledger"  on loyalty_ledger;
drop policy if exists "owner_update_loyalty_ledger"  on loyalty_ledger;
drop policy if exists "owner_delete_loyalty_ledger"  on loyalty_ledger;

drop policy if exists "owner_insert_loyalty_members" on loyalty_members;
drop policy if exists "owner_update_loyalty_members" on loyalty_members;
drop policy if exists "owner_delete_loyalty_members" on loyalty_members;

/* ------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Nobody but the marketplace writes either table. If this ever fires again,
     somebody has re-opened the door this file exists to close. */
  select string_agg(policyname, ', ') into s from pg_policies
   where tablename in ('loyalty_ledger', 'loyalty_members') and cmd <> 'SELECT';
  if s is not null then
    raise exception 'these policies still let a client write points directly: %', s;
  end if;

  /* Both tables are still readable, or the rewards screen goes blank — which
     would be a different bug wearing this one's clothes. */
  select count(*) into n from pg_policies
   where tablename = 'loyalty_ledger' and cmd = 'SELECT';
  if n = 0 then raise exception 'nobody can read the ledger any more'; end if;

  select count(*) into n from pg_policies
   where tablename = 'loyalty_members' and cmd = 'SELECT';
  if n = 0 then raise exception 'nobody can read their own membership any more'; end if;

  /* Every balance still equals its ledger, which is the invariant the whole
     arrangement exists to protect. */
  select count(*) into n from loyalty_members m
   where m.balance is distinct from (select coalesce(sum(points), 0) from loyalty_ledger where member = m.id);
  if n > 0 then raise exception '% members hold a balance their ledger does not support', n; end if;
end $$;
