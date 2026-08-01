-- Three corrections to the ledger, all consequences of the last two files.
--
-- ONE. `redeem_points()` checks the step before the balance; the screen checks
-- the balance first. Both refuse the same redemptions, but they name a
-- different reason for the same one, which is the drift the module's own
-- comment promised would not happen. A customer 200 points short should hear
-- that, not a lecture about step sizes on a total they could never reach.
--
-- TWO. `20260801510000` recomputed every balance from the ledger and asserted
-- the two agreed. They agree now — because that migration made them, by moving
-- five consumer balances down to match. The consumer ledgers were never a whole
-- history: the seed holds a few weeks of recent movements and a balance that
-- had been accruing since 2024. Priya Raman went from 2,500 points to 180
-- without anybody spending them.
--
-- The invariant was right and the direction was wrong. A ledger that does not
-- explain the balance is fixed by completing the ledger, not by lowering the
-- balance — so every member gets the opening movement that was always implied,
-- carrying the history from before the window. The figures come back and
-- `balance = sum(ledger)` still holds.
--
-- THREE. Nothing can correct a movement. `20260801600000` closed the last write
-- policy on `loyalty_ledger`, which was the point, but it left the marketplace
-- with a ledger it cannot fix — and a mis-posted movement is not hypothetical,
-- there is one in the seed being corrected by hand. A ledger is corrected the
-- way every ledger is corrected: by posting the opposite entry, never by
-- rubbing one out. That is `reverse_movement()`.

/* =============================================== one: the same order === */

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

  if p_points is null or p_points <= 0 then
    raise exception 'Choose how many points to redeem.';
  end if;

  /* Balance first, in the same order as `validateRedemption` in loyalty.ts.
     Two layers refusing the same thing for different stated reasons is two
     rules wearing one name. */
  if p_points > me.balance then
    raise exception 'That is more than your balance — % points available.', me.balance;
  end if;
  if p_points < prog.min_redeem then
    raise exception 'You need at least % points before anything can be redeemed.', prog.min_redeem;
  end if;
  if p_points < opt.min then
    raise exception '% starts at % points.', opt.name, opt.min;
  end if;
  if opt.step > 0 and (p_points % opt.step) <> 0 then
    raise exception '% goes up in steps of % points.', opt.name, opt.step;
  end if;

  cash := round((p_points / prog.per_unit) * opt.value_per, 2);
  txid := 'LTX-' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS') || '-' || substr(md5(random()::text), 1, 4);

  insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id,
                              funder, seller_id, value, note, user_id)
  values (txid, me.id, to_char(current_date, 'DD Mon YYYY'), 'redeem', -p_points,
          opt.id, null, opt.cost, null, cash,
          'Redeemed for ' || lower(opt.name) || ' — ' || to_char(cash, 'FM999,999,990.00'),
          me.user_id);

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

/* ================================= two: the history before the window === */

/* What each member's balance was always meant to be. Taken from the seed in
   `20260728115129_create_rewards_schema.sql`, less the 680-point reversal that
   `20260731200000_seller_rewards.sql` applied to Priya on purpose.
   LM-4104 is absent deliberately: the enterprise programme built its ledger
   from the invoices it actually billed, so that one already reconciles. */
create temporary table _intended (member text primary key, balance numeric) on commit drop;
insert into _intended values
  ('LM-4001', 2500),   -- 3,180 seeded, less the ORD-881044 reversal
  ('LM-4002', 1145),
  ('LM-4003', 11840),
  ('LM-4004', 260),
  ('LM-4005', 1890),
  /* And the organisation members, from the same seed. Their ledgers are a
     window too, and the recompute took the same points off them. */
  ('LM-4101', 74250),
  ('LM-4102', 21630),
  ('LM-4103', 6480);

/* One movement per member, for the difference between what the window explains
   and what the balance is. Dated the day before the oldest movement on file, so
   it reads as what it is — the position carried forward — rather than as
   something that happened last week. */
insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id,
                            funder, seller_id, value, note, user_id)
select
  'LTX-OPEN-' || replace(i.member, 'LM-', ''),
  i.member,
  '01 Jun 2026',
  'adjust',
  i.balance - coalesce((select sum(l.points) from loyalty_ledger l where l.member = i.member), 0),
  null, null, 'operator', null, 0,
  'Opening balance — points earned before this statement period. The movements below are the current window; this is everything before it.',
  (select user_id from loyalty_members m where m.id = i.member)
from _intended i
where i.balance <> coalesce((select sum(l.points) from loyalty_ledger l where l.member = i.member), 0)
  and not exists (select 1 from loyalty_ledger o where o.id = 'LTX-OPEN-' || replace(i.member, 'LM-', ''))
on conflict (id) do nothing;

/* ================================= three: the way to correct a mistake === */

/**
 * Reverse a movement, as the marketplace.
 *
 * Posts the opposite entry rather than removing the original. That is not
 * ceremony: the original happened, somebody was told about it, and a ledger
 * that can forget is a ledger nobody can reconcile against. The pair stays
 * visible and the balance follows both.
 *
 * Operator only. A customer correcting their own points is the hole
 * `20260801600000` closed, and this must not quietly reopen it.
 */
create or replace function reverse_movement(p_movement text, p_why text)
returns table (ledger_id text, new_balance numeric)
language plpgsql security definer set search_path = public as $$
declare
  orig record;
  txid text;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace can reverse a movement.';
  end if;
  if coalesce(btrim(p_why), '') = '' then
    raise exception 'Say why it is being reversed. An unexplained correction to somebody''s points is the one nobody can defend afterwards.';
  end if;

  select * into orig from loyalty_ledger where id = p_movement;
  if orig is null then raise exception 'No such movement: %', p_movement; end if;

  if exists (select 1 from loyalty_ledger where ref = p_movement and type = 'reverse') then
    raise exception '% has already been reversed.', p_movement;
  end if;

  txid := 'LTX-REV-' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS');

  insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id,
                              funder, seller_id, value, note, user_id)
  values (txid, orig.member, to_char(current_date, 'DD Mon YYYY'), 'reverse',
          -orig.points, orig.id, orig.rule_id, orig.funder, orig.seller_id,
          orig.value, 'Reversal of ' || orig.id || ' — ' || btrim(p_why), orig.user_id);

  return query
    select txid, (select balance from loyalty_members where id = orig.member);
end $$;

revoke all on function reverse_movement(text, text) from public;
grant execute on function reverse_movement(text, text) to authenticated;

/* ------------------------------------------------------- sanity checks -- */
do $$
declare n integer; b numeric; s text;
begin
  /* The figures are back, and the ledger explains every one of them. */
  select count(*) into n from loyalty_members m
   where m.balance is distinct from (select coalesce(sum(points), 0) from loyalty_ledger where member = m.id);
  if n > 0 then raise exception '% members hold a balance their ledger does not support', n; end if;

  select balance into b from loyalty_members where id = 'LM-4001';
  if b <> 2500 then
    raise exception 'the demo customer holds % points, not the 2,500 the seed gives them', b;
  end if;

  /* Nobody is in the red. A negative points balance is not a state the
     programme has any rule for, and it is what the recompute left behind. */
  select string_agg(id || ' (' || balance || ')', ', ') into s
    from loyalty_members where balance < 0;
  if s is not null then raise exception 'these members hold a negative balance: %', s; end if;

  /* An opening movement is a one-off. Running this file twice must not hand
     anybody a second one. */
  select count(*) into n from loyalty_ledger where id like 'LTX-OPEN-%'
   group by member having count(*) > 1 limit 1;
  if n is not null then raise exception 'somebody has more than one opening balance'; end if;

  /* And the doors are still shut — this file adds two functions, not a policy. */
  select string_agg(policyname, ', ') into s from pg_policies
   where tablename in ('loyalty_ledger', 'loyalty_members') and cmd <> 'SELECT';
  if s is not null then
    raise exception 'these policies let a client write points directly again: %', s;
  end if;
end $$;
