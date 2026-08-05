/*
  # One points balance, and one place that holds it

  The account menu said "Silver member · 0 pts" while the rewards screen two
  clicks away said 760.

  Both are reading a real column. `loyalty_members.balance` is the ledger's own
  sum, recomputed by `rebalance_member` on every movement. `consumer_profile`
  carries `points` and `tier` as well — a second copy of the same two facts,
  maintained by nothing.

      profile                 ledger
      Priya Raman   Gold  2500     gold    2500
      Wanjiru Kamau Silver   0     silver   760

  Priya's agree because `20260801820000_one_points_balance_per_customer.sql`
  reconciled them by hand, which is a repair rather than a fix — it made the two
  numbers equal on that day and left them free to diverge on the next one. They
  diverged the moment a second customer existed, because the seed that gave her
  a ledger had no reason to know a copy of its total lived somewhere else.

  Nobody maintains the copy: no trigger, no function, and neither of the two
  screens that read it ever writes it. A redemption through `redeem_points()`
  moves the balance and leaves the profile untouched, so Priya's would have gone
  stale the first time she spent anything.

  So the copy goes. `points` and `tier` are dropped from `consumer_profile` and
  the two readers ask `loyalty_members`, which is where the answer is computed.
  This is the same rule as the ledger currency fix that precedes it: a number
  means one thing, and one place holds it.

  `consumer_profile.currency` and `.market` stay. Those are facts about the
  customer rather than about their rewards, and nothing else holds them.
*/

do $$
declare n integer;
begin
  /* Before dropping anything, check the copy was only ever a copy. If a profile
     held a balance the ledger cannot account for, dropping it would lose
     something — so the two are compared first, and the only permitted
     difference is the one this migration exists to remove. */
  select count(*) into n
    from consumer_profile p
    join loyalty_members m on m.user_id = p.user_id
   where p.points <> m.balance and p.points <> 0;
  if n > 0 then
    raise exception '% profiles hold a points balance the ledger does not explain — that is not a stale copy, it is a number with no movements behind it', n;
  end if;
end $$;

alter table consumer_profile drop column if exists points;
alter table consumer_profile drop column if exists tier;

do $$
declare n integer;
begin
  /* Every customer who can be shown a balance has one to show. A profile with
     no membership row is the state the header would have had to render as
     "0 pts" again. */
  select count(*) into n
    from consumer_profile p
   where not exists (select 1 from loyalty_members m where m.user_id = p.user_id);
  if n > 0 then
    raise exception '% customers have a profile and no rewards membership, so their balance has nowhere to come from', n;
  end if;

  /* And the surviving number adds up to its own movements. */
  select count(*) into n from loyalty_members m
   where m.balance is distinct from
     (select coalesce(sum(points), 0) from loyalty_ledger where member = m.id);
  if n > 0 then raise exception '% members hold a balance their ledger does not add up to', n; end if;
end $$;
