-- The integration suite has been writing into the demo customers' reward ledger.
--
-- `enterpriseRewards.integration.test.ts` posts a movement, then puts the
-- account back the way a ledger is put back: by posting the opposite entry.
-- That reasoning is right — `loyalty_ledger` has no delete or update policy for
-- anybody, on purpose, and a ledger a console can edit is not a ledger.
--
-- What it did not account for is that a reversal is not an undo. Both entries
-- stay, for ever, and every run adds two more. The enterprise demo account was
-- showing 109 movements on "Every movement", 52 of them saying "Integration
-- test — putting the demo account back"; the retail account had 23 of 59. Half
-- of what a customer sees on their own reward history was test debris.
--
-- Deleting from the ledger here is not the contradiction it looks like. The
-- application still cannot: this runs outside it, the way the seed does. What
-- is being removed is fixture debris that was never anybody's history, not a
-- correction to something that happened.
--
-- Both sides of each pair go, never one. A reversal is +100 against an original
-- of -100, so removing the reversal alone would take 2,300 points off a
-- customer who never spent them. The pairs are matched through the id the
-- reversal names in its own note, and the whole thing is asserted to be
-- balance-neutral before and after.

do $$
declare
  before_sum jsonb;
  after_sum  jsonb;
  removed    integer;
  orphans    integer;
begin
  /* --- what the balances are now, to compare against afterwards ---------- */
  select jsonb_object_agg(member, total) into before_sum
    from (select member, sum(points) as total from loyalty_ledger group by member) x;

  /* --- the pairs: a reversal written by the suite, and what it reversed --- */
  create temporary table fixture_rows on commit drop as
  with rev as (
    select id, member, points,
           substring(note from 'Reversal of ([A-Za-z0-9-]+)') as orig
      from loyalty_ledger
     where note ilike 'Reversal of %Integration test%'
  )
  select r.id as rev_id, r.member, r.points as rev_pts,
         o.id as orig_id, o.points as orig_pts
    from rev r
    left join loyalty_ledger o on o.id = r.orig;

  /* A reversal whose original is gone cannot be removed in a balanced pair, so
     it is left alone and reported rather than quietly half-cleaned. */
  select count(*) into orphans from fixture_rows where orig_id is null;
  if orphans > 0 then
    raise notice '% reversals have no original on file and are being left in place', orphans;
  end if;

  /* Every pair must net to zero, or removing it moves somebody's balance. */
  if exists (
    select 1 from fixture_rows
     where orig_id is not null and (rev_pts + orig_pts) <> 0
  ) then
    raise exception 'some fixture pairs do not net to zero; refusing to change a customer balance';
  end if;

  /* --- take them both out ------------------------------------------------ */
  delete from loyalty_ledger l
   using fixture_rows f
   where f.orig_id is not null
     and l.id in (f.rev_id, f.orig_id);
  get diagnostics removed = row_count;

  /* --- and the balances are where they were ------------------------------ */
  select jsonb_object_agg(member, total) into after_sum
    from (select member, sum(points) as total from loyalty_ledger group by member) x;

  if before_sum is distinct from after_sum then
    raise exception 'balances moved: was % now %', before_sum, after_sum;
  end if;

  raise notice 'removed % fixture rows; every balance unchanged', removed;
end $$;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Nothing in any customer's reward history says "integration test" any more. */
  select count(*) into n from loyalty_ledger where note ilike '%Integration test%';
  if n > 0 then raise exception '% test movements are still on customer ledgers', n; end if;

  /* The members' stored balances agree with their ledgers. The rebalance
     trigger recomputes on every write; this is the assertion that it did, and
     the reason the deletes above had to be balanced. */
  select string_agg(m.id || ' says ' || m.balance || ', ledger says ' || coalesce(l.total, 0), '; ')
    into s
    from loyalty_members m
    left join (select member, sum(points) as total from loyalty_ledger group by member) l
      on l.member = m.id
   where m.balance <> coalesce(l.total, 0);
  if s is not null then raise exception 'these members disagree with their own ledger: %', s; end if;

  /* And there is still a demo history worth looking at — the point of the
     clean-up was to remove noise, not the account's story. */
  select count(*) into n from loyalty_ledger where member = 'LM-4104';
  if n < 20 then raise exception 'the enterprise demo ledger is down to % rows', n; end if;
end $$;
