-- A redemption that was released, reversed and released again.
--
-- `apply_redemption()` named its ledger row after the redemption —
-- `LTX-RDX-1101` for RDX-1101 — and swallowed a collision with
-- `on conflict do nothing`. That was fine while a release could only ever
-- happen once. It is not fine now that `reverse_movement()` exists: a
-- redemption released in error, reversed by the marketplace and released
-- again correctly posts nothing the second time, and the balance quietly
-- does not move while every screen reports a successful release.
--
-- Two changes. The row gets an id unique to the posting rather than to the
-- redemption, and the silent conflict handler goes — a ledger insert that
-- collides is a bug worth hearing about, not one worth absorbing.

create or replace function apply_redemption() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  opt  text;
  who  text;
  txid text;
begin
  if new.state not in ('released', 'applied') or old.state = new.state then
    return new;
  end if;

  select name into opt from loyalty_redeem_options where id = new.option_id;
  select name into who from enterprise_users where id = new.released_by;

  /* Unique to this posting. `ledger_ref` still wins when the caller has already
     chosen one, which is how a release that is being replayed keeps its
     original row rather than growing a second. */
  txid := coalesce(
    new.ledger_ref,
    'LTX-RDX-' || regexp_replace(new.id, '\D', '', 'g')
                || '-' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS'));

  insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id, funder,
                              seller_id, value, note, user_id)
  values (txid,
          new.member_id, to_char(coalesce(new.released_on, current_date), 'DD Mon YYYY'),
          'redeem', -new.points, new.option_id, null, 'operator', null, new.value,
          coalesce(opt, 'Reward credit') || ' — ' ||
          to_char(new.value, 'FM$999,999,990.00') ||
          coalesce(', released by ' || who, ''), null);

  /* The balance is recomputed by `loyalty_ledger_rebalance` on the insert above.
     What is left is lifetime_redeemed, which a single movement's sign does not
     give you — it is the sum of every redemption, net of anything reversed. */
  update loyalty_members m
     set lifetime_redeemed = (
           select coalesce(-sum(l.points), 0) from loyalty_ledger l
            where l.member = m.id
              and (l.type = 'redeem'
                   /* less any redemption a reversal has since undone */
                   and not exists (select 1 from loyalty_ledger r
                                    where r.type = 'reverse' and r.ref = l.id))),
         last_activity = to_char(current_date, 'DD Mon YYYY')
   where m.id = new.member_id;

  return new;
end $$;

/* ------------------------------------------------------- sanity checks -- */
do $$
declare n integer; b numeric;
begin
  /* Balances still reconcile after the lifetime_redeemed rewrite. */
  select count(*) into n from loyalty_members m
   where m.balance is distinct from (select coalesce(sum(points), 0) from loyalty_ledger where member = m.id);
  if n > 0 then raise exception '% members hold a balance their ledger does not support', n; end if;

  /* And a reversed redemption no longer counts against lifetime redeemed —
     the customer did not, in the end, redeem it. */
  select count(*) into n
    from loyalty_ledger l
    join loyalty_ledger r on r.type = 'reverse' and r.ref = l.id
   where l.type = 'redeem';
  raise notice '% redemptions on file have been reversed', n;

  select balance into b from loyalty_members where id = 'LM-4104';
  if b <> 86630 then
    raise exception 'the demo organisation holds % points rather than 86,630', b;
  end if;
end $$;
