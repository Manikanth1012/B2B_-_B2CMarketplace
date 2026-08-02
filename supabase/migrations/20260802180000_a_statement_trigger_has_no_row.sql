-- `sync_market_default` has never once run its update.
--
-- It was declared `for each statement`, and in a statement-level trigger NEW and
-- OLD are always NULL. So `m.code = coalesce(new.market_code, old.market_code)`
-- was `m.code = null`, which matches nothing. Making USD the default currency
-- for a market moved `market_currencies.is_default` and left `markets.currency`
-- pointing at the old one — two sources of one fact, disagreeing, which is
-- exactly what that trigger was written to prevent.
--
-- The previous migration asserted "markets.currency is the default, and the
-- trigger keeps it so" and the assertion passed. It passed because the seeded
-- rows already agreed with each other. It compared the data to itself and never
-- once made the trigger do anything — the same shape of mistake as the bills
-- that were declared INR without being converted, where every check compared a
-- bill to itself.
--
-- So this does two things: makes the trigger row-level, where NEW and OLD are
-- populated, and asserts it by *changing a default and watching the other column
-- follow*, then putting it back. An assertion that does not disturb anything
-- cannot tell whether the thing it is checking is alive.

/* ============================================================= the fix === */

create or replace function sync_market_default()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  /* Row-level, so `new` and `old` are real. The value is read back from
     `market_currencies` rather than taken from `new` directly, because the row
     being written may be the one *losing* the default — in which case the
     market's currency is whichever other row now holds it. */
  update markets m set currency = mc.currency
    from market_currencies mc
   where mc.market_code = m.code and mc.is_default
     and m.code = coalesce(new.market_code, old.market_code)
     and m.currency is distinct from mc.currency;

  return null;
end $$;

drop trigger if exists sync_market_default_trg on market_currencies;
create trigger sync_market_default_trg after insert or update or delete on market_currencies
  for each row execute function sync_market_default();

/* ---------------------------------------------------- and repair state -- */

/* Nothing is known to be out of step — the bug meant the column was never
   moved, not that it was moved wrongly — but a column that has been derived by
   a trigger that never ran has no claim to being correct. */
update markets m set currency = mc.currency
  from market_currencies mc
 where mc.market_code = m.code and mc.is_default
   and m.currency is distinct from mc.currency;

/* ======================================================= does it work? === */

do $$
declare
  probe    text;
  spare    text;
  original text;
  after    text;
begin
  /* A market with a second currency to promote, and its current default. */
  select mc.market_code into probe
    from market_currencies mc group by mc.market_code having count(*) > 1 limit 1;
  if probe is null then
    raise exception 'no market takes two currencies, so the trigger cannot be tested';
  end if;

  select currency into original from market_currencies
   where market_code = probe and is_default;
  select currency into spare from market_currencies
   where market_code = probe and not is_default limit 1;

  /* Promote the other one and see whether `markets.currency` follows. */
  update market_currencies set is_default = true
   where market_code = probe and currency = spare;

  select currency into after from markets where code = probe;
  if after is distinct from spare then
    raise exception
      'sync_market_default still does not fire: made % the default of %, but markets.currency is %',
      spare, probe, after;
  end if;

  /* And the guard cleared the old one rather than leaving two. */
  if (select count(*) from market_currencies where market_code = probe and is_default) <> 1 then
    raise exception '% has more than one default currency after the switch', probe;
  end if;

  /* Put it back, and check the trigger fires in that direction too — a trigger
     that only works one way is a trigger that works by accident. */
  update market_currencies set is_default = true
   where market_code = probe and currency = original;

  select currency into after from markets where code = probe;
  if after is distinct from original then
    raise exception 'the default did not move back: % is still %', probe, after;
  end if;

  raise notice 'sync_market_default verified on % (% -> % -> %)', probe, original, spare, original;
end $$;

/* ------------------------------------------------------ and the state -- */

do $$
declare s text;
begin
  select string_agg(m.code || ' says ' || m.currency || ', table says ' || mc.currency, '; ')
    into s
    from markets m
    join market_currencies mc on mc.market_code = m.code and mc.is_default
   where m.currency <> mc.currency;
  if s is not null then raise exception 'markets disagree with their own default: %', s; end if;

  /* The arrangement asked for, unchanged by any of the above. */
  if (select currency from markets where code = 'IN') <> 'INR'
  then raise exception 'India is no longer quoted in rupees'; end if;
  if (select currency from markets where code = 'KE') <> 'KES'
  then raise exception 'Kenya is no longer quoted in shillings'; end if;
  if (select currency from markets where code = 'AE') <> 'AED'
  then raise exception 'the UAE is no longer quoted in dirhams'; end if;
end $$;
