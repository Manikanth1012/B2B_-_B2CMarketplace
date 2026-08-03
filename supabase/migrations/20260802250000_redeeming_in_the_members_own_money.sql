-- Redeeming still pays out in dollars — and, as of two migrations ago, does not
-- pay out at all.
--
-- Two functions write `loyalty_ledger`, and neither was told about currency:
--
--   `redeem_points()`     the customer's Redeem button
--   `apply_redemption()`  the trigger that posts an organisation's release
--
-- `loyalty_ledger.currency` became NOT NULL in
-- `20260802230000_a_point_is_worth_different_money_in_different_places.sql`, so
-- from that migration onwards both raise a not-null violation. Every redemption
-- on the marketplace is broken, in both personas. That is mine, and it is the
-- shape of break that hides: every read path still works, so the screens look
-- right and only pressing the button finds it.
--
-- Worth is the other half. Both computed `points / loyalty_programme.per_unit` —
-- one rate for the whole marketplace, 100 points to the dollar — which is
-- exactly what made a point worth $0.01 to a customer billed in rupees. It comes
-- from `loyalty_point_rates` now, by the member's own currency, which is the
-- same table the screens read.
--
-- `enterprise_redemptions.currency` is left nullable by that migration too. A
-- redemption is money the account is being promised; it is not a number until it
-- says what it is in.

/* ================================================ money, written out here === */

/* A second formatter, deliberately.
 *
 * `format()` in `money.ts` is the one the screens use and it is not reachable
 * from a trigger. These functions write prose that is *stored* — a ledger note
 * is what somebody read at the time, not a render — so the database has to be
 * able to write an amount, and writing one its own way is how "$15.00" ended up
 * on a rupee row.
 *
 * So the two rules that make a figure look local are stated here as well: the
 * mark takes a space when it is longer than one character (AED 1,200, not
 * AED1,200), and en-IN groups by lakh (₹1,87,127, not ₹187,127). The assertions
 * at the foot check this agrees with what the client would have written for
 * every note already on the ledger.
 */
create or replace function group_digits(n numeric, indian boolean)
returns text language plpgsql immutable as $$
declare s text; head text; tail text; out text := '';
begin
  s := to_char(trunc(abs(n)), 'FM999999999999990');
  if not indian or length(s) <= 3 then
    return to_char(trunc(abs(n)), 'FM999,999,999,999,990');
  end if;
  /* Last three, then pairs: 18712788 -> 1,87,12,788. */
  tail := right(s, 3);
  head := left(s, length(s) - 3);
  while length(head) > 2 loop
    out  := ',' || right(head, 2) || out;
    head := left(head, length(head) - 2);
  end loop;
  return head || out || ',' || tail;
end $$;

create or replace function money_text(amount numeric, cur text)
returns text language plpgsql stable as $$
declare c record; mark text; body text;
begin
  select symbol, symbol_first, locale into c from currencies where code = cur;
  if c is null then return cur || ' ' || to_char(round(amount), 'FM999,999,999,990'); end if;

  body := group_digits(amount, c.locale = 'en-IN');
  mark := case when length(c.symbol) > 1 then c.symbol || ' ' else c.symbol end;

  /* The sign goes outside the mark. "$-1,893" is not how anybody writes a
     negative amount, and it has already turned up once on a seller statement. */
  return case when amount < 0 then '-' else '' end
      || case when c.symbol_first then mark || body else body || ' ' || c.symbol end;
end $$;

/* ====================================== a redemption is in somebody's money === */

update enterprise_redemptions e set currency = m.currency
  from loyalty_members m where m.id = e.member_id and e.currency is null;

alter table enterprise_redemptions alter column currency set not null;

comment on column enterprise_redemptions.currency is
  'What the credit is worth in. Follows the member''s currency — a release is a movement on their ledger.';

/* The same rule `guard_ledger_currency` applies to the ledger. RLS cannot say
   it: it filters rows, it does not compare a row being written against another
   table. */
create or replace function guard_redemption_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare theirs text;
begin
  if current_persona() is null then return new; end if;
  select currency into theirs from loyalty_members where id = new.member_id;
  if theirs is null then return new; end if;

  /* Filled in rather than refused. A caller that names no currency is not
     asserting a wrong one, and the member's is the only answer there is. */
  if new.currency is null then new.currency := theirs; return new; end if;

  if new.currency is distinct from theirs then
    raise exception 'This account''s rewards are held in %, so a redemption cannot be worth %.',
      theirs, new.currency;
  end if;
  return new;
end $$;

drop trigger if exists guard_redemption_currency_trg on enterprise_redemptions;
create trigger guard_redemption_currency_trg before insert or update on enterprise_redemptions
  for each row execute function guard_redemption_currency();

/* ============================================== the customer's own redeem === */

create or replace function redeem_points(p_option text, p_points numeric)
returns table(ledger_id text, worth numeric, new_balance numeric)
language plpgsql security definer set search_path = public as $$
declare
  me   record;
  opt  record;
  prog record;
  rate record;
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

  /* What a point is worth where this member is. Refused rather than defaulted:
     a member in a currency nobody has priced a point in must not be paid out at
     somebody else's rate. */
  select * into rate from loyalty_point_rates where currency = me.currency;
  if rate is null then
    raise exception 'Points have no value set in % yet, so nothing can be redeemed against them.', me.currency;
  end if;

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

  cash := round((p_points / rate.per_unit) * opt.value_per, 2);
  txid := 'LTX-' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS') || '-' || substr(md5(random()::text), 1, 4);

  insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id,
                              funder, seller_id, value, note, user_id, currency)
  values (txid, me.id, to_char(current_date, 'DD Mon YYYY'), 'redeem', -p_points,
          opt.id, null, opt.cost, null, cash,
          'Redeemed for ' || lower(opt.name) || ' — ' || money_text(cash, me.currency),
          me.user_id, me.currency);

  update loyalty_members
     set lifetime_redeemed = lifetime_redeemed + p_points,
         expiring_soon = greatest(0, expiring_soon - p_points),
         last_activity = to_char(current_date, 'DD Mon YYYY')
   where id = me.id;

  return query
    select txid, cash, (select balance from loyalty_members where id = me.id);
end $$;

/* ============================================ the organisation's release === */

create or replace function apply_redemption()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  opt  text;
  who  text;
  cur  text;
  txid text;
begin
  if new.state not in ('released', 'applied') or old.state = new.state then
    return new;
  end if;

  select name into opt from loyalty_redeem_options where id = new.option_id;
  select name into who from enterprise_users where id = new.released_by;

  /* The member's, not the redemption's. They agree — `guard_redemption_currency`
     sees to that — and reading the member is what makes the ledger insert
     satisfy `guard_ledger_currency` even on a row written before that guard
     existed. */
  select currency into cur from loyalty_members where id = new.member_id;

  /* Unique to this posting. `ledger_ref` still wins when the caller has already
     chosen one, which is how a release that is being replayed keeps its
     original row rather than growing a second. */
  txid := coalesce(
    new.ledger_ref,
    'LTX-RDX-' || regexp_replace(new.id, '\D', '', 'g')
                || '-' || to_char(clock_timestamp(), 'YYMMDDHH24MISSMS'));

  insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id, funder,
                              seller_id, value, note, user_id, currency)
  values (txid,
          new.member_id, to_char(coalesce(new.released_on, current_date), 'DD Mon YYYY'),
          'redeem', -new.points, new.option_id, null, 'operator', null, new.value,
          coalesce(opt, 'Reward credit') || ' — ' || money_text(new.value, cur) ||
          coalesce(', released by ' || who, ''), null, cur);

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

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text; got text;
begin
  /* The formatter, against figures somebody has already read. Every money
     amount written into a ledger note by the previous migration must be one
     `money_text` would produce — otherwise a note posted today reads differently
     from the hundred above it. */
  select string_agg(l.id || ' says ' || l.note, '; ') into s
    from loyalty_ledger l
   where l.type = 'redeem' and l.note ~ '[0-9]'
     and position(money_text(l.value, l.currency) in l.note) = 0;
  if s is not null then
    raise exception 'these notes are not what money_text would write: %', s;
  end if;

  /* The two rules that make the mark local, exercised rather than assumed. */
  got := money_text(187127, 'INR');
  if got <> '₹1,87,127' then raise exception 'rupees are not grouped by lakh: %', got; end if;
  got := money_text(1200, 'AED');
  if got <> 'AED 1,200' then raise exception 'a multi-letter mark lost its space: %', got; end if;
  got := money_text(-1893, 'USD');
  if got <> '-$1,893' then raise exception 'the sign is inside the mark: %', got; end if;
  got := money_text(12000, 'KES');
  if got <> 'KSh 12,000' then raise exception 'shillings came out as %', got; end if;

  /* Both write paths now name a currency. Checked against the function bodies
     rather than by running them, because running a redemption here would spend
     a demo customer's points to prove a point. */
  /* Named rather than searched, which is the flaw the next migration fixes:
     `reverse_movement` writes the ledger too and is not on this list, so this
     passed over a set I chose rather than the set that exists. */
  select string_agg(p.proname, ', ') into s
    from pg_proc p
    join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.prokind = 'f'
     and p.proname in ('redeem_points', 'apply_redemption')
     and pg_get_functiondef(p.oid) !~ 'insert into loyalty_ledger[^;]*currency';
  if s is not null then
    raise exception 'these still write a ledger row with no currency on it: %', s;
  end if;

  /* And neither still divides by the programme's single global rate. */
  if pg_get_functiondef('redeem_points(text,numeric)'::regprocedure) ~ 'prog\.per_unit' then
    raise exception 'redeem_points still pays out at one rate for the whole marketplace';
  end if;

  /* Nothing is left unpriced. */
  select string_agg(distinct m.currency, ', ') into s from loyalty_members m
   where not exists (select 1 from loyalty_point_rates r where r.currency = m.currency);
  if s is not null then raise exception 'these members hold points nobody has priced: %', s; end if;

  select count(*) into n from enterprise_redemptions where currency is null;
  if n > 0 then raise exception '% redemptions still say nothing about what they are worth in', n; end if;

  /* Every redemption agrees with its member, which is what the new guard is
     for — asserted on the data as it stands, not only on the next write. */
  select string_agg(e.id || ' (' || e.currency || ' vs ' || m.currency || ')', '; ') into s
    from enterprise_redemptions e join loyalty_members m on m.id = e.member_id
   where e.currency <> m.currency;
  if s is not null then raise exception 'these redemptions are in the wrong money: %', s; end if;
end $$;
