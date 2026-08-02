-- Priya Raman had 3,180 points on her profile and 2,500 in the loyalty ledger.
--
-- Found while building the bill preview, which needs a reward figure to print
-- and had two to choose from. Only one of them is defensible: `loyalty_members`
-- is maintained by `rebalance_member()` against the ledger, so its balance is
-- the sum of movements anybody can audit. `consumer_profile.points` is a
-- number that was typed in once and has been drifting ever since.
--
-- It is not on screen today, which is the only reason nobody has complained.
-- That makes now the cheap moment to fix it, before a bill prints one figure
-- and the rewards page prints the other.

update consumer_profile cp
   set points = lm.balance
  from loyalty_members lm
 where lm.user_id = cp.user_id
   and lm.kind = 'consumer'
   and cp.points is distinct from lm.balance;

/* ------------------------------------------------------- sanity checks -- */
do $$
declare n integer;
begin
  select count(*) into n
    from consumer_profile cp
    join loyalty_members lm on lm.user_id = cp.user_id and lm.kind = 'consumer'
   where cp.points is distinct from lm.balance;
  if n > 0 then
    raise exception '% customers still hold two different points balances', n;
  end if;

  /* And the ledger still supports the figure both of them now show. */
  select count(*) into n from loyalty_members m
   where m.balance is distinct from (select coalesce(sum(points), 0) from loyalty_ledger where member = m.id);
  if n > 0 then raise exception '% members hold a balance their ledger does not support', n; end if;
end $$;
