-- A balance that is the sum of the ledger, in both directions.
--
-- `apply_redemption()` recomputes `loyalty_members.balance` when it writes a
-- ledger row, which is right: the balance is the ledger, not a number somebody
-- types. But it only recomputed on the way in. Take a ledger row back out —
-- reversing a movement, correcting a mis-posted earn, tidying up after a
-- release that should not have happened — and the balance stayed where the
-- insert had left it, so the member's stated balance and their own ledger
-- disagreed with nobody watching.
--
-- Nothing else can put it right either. `loyalty_members` has no UPDATE policy
-- for the operator, deliberately, because a balance a console can type is not
-- a balance. That leaves the trigger as the only place this can live.

create or replace function rebalance_member() returns trigger
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  who := coalesce(new.member, old.member);
  update loyalty_members m
     set balance = (select coalesce(sum(points), 0) from loyalty_ledger where member = m.id)
   where m.id = who;
  return coalesce(new, old);
end $$;

/* AFTER, so the row is in or out before the sum is taken. On delete and on a
   points change as well as on insert — an edit that moves a figure is the same
   problem as a removal, and this is the last place the two can be kept in step. */
drop trigger if exists loyalty_ledger_rebalance on loyalty_ledger;
create trigger loyalty_ledger_rebalance
  after insert or delete or update of points, member on loyalty_ledger
  for each row execute function rebalance_member();

/* Whatever has already drifted, put right once from the ledger itself. */
update loyalty_members m
   set balance = (select coalesce(sum(points), 0) from loyalty_ledger where member = m.id)
 where m.balance is distinct from (select coalesce(sum(points), 0) from loyalty_ledger where member = m.id);

/* ------------------------------------------------------- sanity checks -- */
do $$
declare n integer; b numeric;
begin
  /* Every member's balance is their ledger. */
  select count(*) into n from loyalty_members m
   where m.balance is distinct from (select coalesce(sum(points), 0) from loyalty_ledger where member = m.id);
  if n > 0 then raise exception '% members hold a balance their ledger does not support', n; end if;

  /* And the trigger actually fires both ways. Proved rather than assumed:
     post a movement, check it moved, take it back, check it moved back. */
  select balance into b from loyalty_members where id = 'LM-4104';

  insert into loyalty_ledger (id, member, when_date, type, points, ref, funder, value, note)
  values ('LTX-REBALANCE-PROBE', 'LM-4104', to_char(current_date, 'DD Mon YYYY'), 'adjust', 1,
          'PROBE', 'operator', 0, 'Migration probe — removed in the same transaction');
  if (select balance from loyalty_members where id = 'LM-4104') <> b + 1 then
    raise exception 'the balance did not follow a ledger row in';
  end if;

  delete from loyalty_ledger where id = 'LTX-REBALANCE-PROBE';
  if (select balance from loyalty_members where id = 'LM-4104') <> b then
    raise exception 'the balance did not follow a ledger row back out';
  end if;
end $$;
