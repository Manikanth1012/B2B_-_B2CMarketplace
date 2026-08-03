-- A third function writes the ledger, and the last migration did not know it.
--
-- `20260802250000_redeeming_in_the_members_own_money.sql` fixed `redeem_points`
-- and `apply_redemption` and then asserted that both of them name a currency —
-- by listing them. `reverse_movement` was never in the list, so the check passed
-- on a set I had chosen rather than on the set that exists, and the operator's
-- "reverse this movement" tool went on writing a NULL currency into a NOT NULL
-- column.
--
-- That is the same mistake as a test that finds nothing to check, wearing a
-- different coat: an assertion is only worth what the thing it ranges over is
-- worth, and I gave it a hand-written range. The check at the foot of this file
-- ranges over every function in the schema that inserts into `loyalty_ledger`,
-- so the next one somebody writes is covered before it is written.
--
-- It also left damage. The integration suites reverse what they spend, and with
-- the reversal refused the spending stood:
--
--   LM-4104  SmartBuild Ltd  46,630 rather than 86,630 — two 20,000-point
--                            releases of RDX-1101 that could not be undone
--   LM-4001  Priya Raman      2,400 rather than  2,500 — one 100-point wallet
--                            redemption
--
-- Removed rather than reversed, on the precedent set in
-- `20260802200000_a_test_fixture_is_not_a_customers_history.sql`: a reversal is
-- a movement, and a demo customer's history should not carry a pair of them
-- explaining that a test ran. `rebalance_member` recomputes the balance on the
-- delete; `lifetime_redeemed` is recomputed here the same way `apply_redemption`
-- does it, because that one is not a trigger's job.

/* ================================================ the reversal, in currency === */

create or replace function reverse_movement(p_movement text, p_why text)
returns table(ledger_id text, new_balance numeric)
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

  /* The original's currency, carried rather than looked up. A reversal is the
     same money going the other way; deriving it from the member again would let
     the two disagree if a member were ever re-denominated. */
  insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id,
                              funder, seller_id, value, note, user_id, currency)
  values (txid, orig.member, to_char(current_date, 'DD Mon YYYY'), 'reverse',
          -orig.points, orig.id, orig.rule_id, orig.funder, orig.seller_id,
          orig.value, 'Reversal of ' || orig.id || ' — ' || btrim(p_why), orig.user_id,
          orig.currency);

  return query
    select txid, (select balance from loyalty_members where id = orig.member);
end $$;

/* ====================================== putting the demo accounts back ====== */

do $$
declare gone integer;
begin
  /* Written by a suite that then could not undo them. Matched on what they are
     rather than on their ids, so re-running this after another failed run
     clears that one too. */
  delete from loyalty_ledger
   where type = 'redeem'
     and when_date = to_char(date '2026-08-03', 'DD Mon YYYY')
     and (id like 'LTX-RDX-1101-%' or note = 'Redeemed for wallet credit — ₹100');
  get diagnostics gone = row_count;
  raise notice 'removed % redemptions the suite could not reverse', gone;

  /* `apply_redemption` maintains this and no trigger does, so a deleted
     redemption leaves it overstated. Recomputed exactly as that function
     computes it: every redemption, less any a reversal has since undone. */
  update loyalty_members m
     set lifetime_redeemed = (
           select coalesce(-sum(l.points), 0) from loyalty_ledger l
            where l.member = m.id
              and l.type = 'redeem'
              and not exists (select 1 from loyalty_ledger r
                               where r.type = 'reverse' and r.ref = l.id));
end $$;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare s text; n integer;
begin
  /* The assertion the last migration should have been. Every function that
     writes the ledger, found rather than listed. */
  select string_agg(p.proname, ', ') into s
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
   where ns.nspname = 'public' and l.lanname in ('plpgsql', 'sql') and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ~ 'insert into loyalty_ledger'
     and pg_get_functiondef(p.oid) !~ 'insert into loyalty_ledger[^;]*currency';
  if s is not null then
    raise exception 'these write a ledger row with no currency on it: %', s;
  end if;

  /* And that there is more than one to find — a search that matches nothing
     passes for the wrong reason, which is how this got missed. */
  select count(*) into n
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
    join pg_language l on l.oid = p.prolang
   where ns.nspname = 'public' and l.lanname in ('plpgsql', 'sql') and p.prokind = 'f'
     and pg_get_functiondef(p.oid) ~ 'insert into loyalty_ledger';
  if n < 3 then
    raise exception 'only % function(s) write the ledger — the search is not finding them', n;
  end if;

  /* Every balance is the sum of its own movements. This is the check the
     integration suite makes and could not complete. */
  select string_agg(m.id || ' says ' || m.balance || ', ledger says ' || x.total, '; ') into s
    from loyalty_members m
    join lateral (select coalesce(sum(l.points), 0) as total
                    from loyalty_ledger l where l.member = m.id) x on true
   where m.balance <> x.total;
  if s is not null then raise exception 'these balances disagree with their ledger: %', s; end if;

  /* And the two accounts the suite left short are back where they started.
     Stated as figures rather than derived, because deriving them from the
     ledger is what the check above already does — this one is about the
     numbers a person would recognise on the demo. */
  select m.balance into n from loyalty_members m where m.id = 'LM-4104';
  if n <> 86630 then raise exception 'SmartBuild is on % points, not 86,630', n; end if;
  select m.balance into n from loyalty_members m where m.id = 'LM-4001';
  if n <> 2500 then raise exception 'Priya is on % points, not 2,500', n; end if;

  /* Nothing left in the ledger that is a test rather than a customer. */
  select string_agg(id, ', ') into s from loyalty_ledger where note ilike '%integration test%';
  if s is not null then raise exception 'these movements are test debris: %', s; end if;
end $$;
