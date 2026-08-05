/*
  # A point is the member's own unit, not the currency they paid in

  Wanjiru Kamau's rewards ledger showed two movements side by side:

      -39   KSh 39.00   Kestrel 45 W GaN charger refunded
      +15   $15.00      Travel eSIM — 10 GB, 30 days

  One point cannot be worth a shilling and a dollar at once. At the August rate
  that reads as one point being worth KSh 1 in one row and KSh 129 in the next,
  in the same balance, on the same screen.

  Two separate faults produced it, and it is worth being precise about which is
  which because only one of them is about currencies.

  ## Fault one: `value` held the point count, not the money

  `loyalty_ledger.value` is what the points are worth in money — that is what
  `redeem_points()` writes into it (`points / per_unit * value_per`) and what
  every screen renders with a currency symbol in front. It is only equal to the
  point count where `per_unit = 1`, which is true in INR and KES and nowhere
  else.

      AED  earn_per_unit 0.25   per_unit 25    →  1.0000%
      INR  earn_per_unit 0.01   per_unit 1     →  1.0000%
      KES  earn_per_unit 0.01   per_unit 1     →  1.0000%
      USD  earn_per_unit 1      per_unit 100   →  1.0000%

  The per-currency rates were never wrong. A point being worth KSh 1 and $0.01
  is the same point, because you earn a hundred times more of them per shilling
  — every currency returns exactly 1% of spend, which is what `returnRate` in
  `loyalty.ts` exists to state.

  What was wrong is that `20260806010000` wrote `value` as the point count. In
  KES that is invisible, because `per_unit` is 1 and the two numbers coincide.
  In USD, where `per_unit` is 100, 15 points printed as `$15.00` instead of
  `$0.15` — a hundredfold overstatement, and the number on the screen.

  Four rows on the whole platform are affected. All four are hers, and all four
  are USD. Every AED row already carries `points / 25`.

  ## Fault two: her ledger was denominated in two currencies at once

  The deeper problem, and the one the first fault was hiding. `LM-4030` is the
  only member on the marketplace holding ledger rows in a currency other than
  her own — a KES member with four USD movements — because she is the only
  customer who has ever bought in two currencies.

      member    member_ccy   row_ccy   n
      LM-4030   KES          USD       4

  A balance is a single number. `worthIn()` values the whole of it at the
  member's own rate, so points earned on a dollar purchase were being redeemed
  at the shilling rate — 15 points earned on $12.50 came back as KSh 15 rather
  than the KSh 20 that spend was worth. The ledger looked itemised and was
  actually incoherent.

  ## The rule: the spend converts, the points do not

  Points are a unit the marketplace issues to a member, and a member has one
  programme in one currency. So a purchase made in another currency is
  converted to the member's currency *before* points are computed, at the FX
  rate in force on the day, and the movement is recorded in the member's
  currency like every other movement.

  Converting the other way round — earning in USD and then converting the
  points — gives a different and wrong answer, which is worth showing:

      $12.50 net, Silver 1.25x
        spend converts:   12.50 x 128.45 = KES 1,605.63 → 20 points, worth KSh 20
        points convert:   floor(12.50 x 1 x 1.25) = 15 points → and then what?
                          15 points in a KES programme is KSh 15, not KSh 20

  The second is the bug. The point count carries no currency with it, so the
  moment it is written into a KES member's balance it *means* KES — converting
  the money is the only step at which the exchange rate can honestly apply.

  A reversal is the exception, and deliberately: it returns exactly the points
  that were given, never a recomputation at today's rate. Otherwise a customer
  who buys in dollars and returns the item after the shilling weakens keeps the
  difference, and one who returns it after the shilling strengthens is short.

  ## What is enforced afterwards

  `guard_ledger_currency` already refused a movement in the wrong currency —
  but it opened with `if current_persona() is null then return new`, so it
  applied to signed-in users and waved through anything written by a migration.
  The four bad rows walked in through that door. It closes here: the rule is
  about the member's money, not about who is holding the pen.

  The same trigger now also checks `value` against the point count, so the
  hundredfold error cannot be written again in any currency where `per_unit`
  is not 1 — which is to say, in the two currencies where nobody would notice.
*/

/* --------------------------------------------------------------- the fix -- */

/* Her three USD earns, converted. The spend is the net of VAT — points are
   earned on the value of the goods, not on the tax collected on behalf of the
   revenue authority, which is how every other earn row on the platform was
   computed. The rate is the one in force on the day of the movement, not
   today's: an earn is a fact about a moment. */
with converted as (
  select
    l.id,
    round(o.total / (1 + o.tax_rate / 100.0), 2)                            as net_paid,
    f.rate                                                                   as fx,
    round(round(o.total / (1 + o.tax_rate / 100.0), 2) * f.rate, 2)          as net_home
  from loyalty_ledger l
  join loyalty_members mem on mem.id = l.member
  join orders o            on o.order_ref = l.ref
  join lateral (
    select x.rate from fx_rates x
     where x.base = l.currency and x.quote = mem.currency
       and x.as_of <= to_date(l.when_date, 'DD Mon YYYY')
     order by x.as_of desc limit 1
  ) f on true
  where l.member = 'LM-4030' and l.currency = 'USD' and l.type = 'earn'
)
update loyalty_ledger l
   set currency = 'KES',
       /* floor, not round: a point that was not earned is not awarded. This is
          the convention every seeded Kenyan row already follows. */
       points   = floor(c.net_home * r.earn_per_unit * 1.25),
       value    = round(floor(c.net_home * r.earn_per_unit * 1.25) / r.per_unit, 2),
       note     = regexp_replace(l.note, ' — USD [0-9.]+ at ', ' — USD '
                    || to_char(c.net_paid, 'FM999990.00') || ' converted at '
                    || to_char(c.fx, 'FM999990.00') || ' to KES '
                    || to_char(c.net_home, 'FM999,999,990.00') || ', earned at ')
  from converted c, loyalty_point_rates r
 where l.id = c.id and r.currency = 'KES';

/* The reversal mirrors its earn rather than being recomputed. Same points back,
   same currency, whatever the rate has done since. */
update loyalty_ledger l
   set currency = 'KES',
       points   = -e.points,
       value    = e.value
  from loyalty_ledger e
 where l.member = 'LM-4030' and l.type = 'reverse' and l.currency = 'USD'
   and e.member = l.member and e.type = 'earn' and e.ref = l.ref;

/* `balance` is maintained by `rebalance_member`, so the four updates above have
   already moved it. These three are not, and are recomputed from the rows
   rather than adjusted by a delta — a delta is a second place to be wrong. */
update loyalty_members m
   set lifetime_earned   = (select coalesce(sum(l.points), 0) from loyalty_ledger l
                             where l.member = m.id and l.points > 0),
       lifetime_redeemed = (select coalesce(sum(-l.points), 0) from loyalty_ledger l
                             where l.member = m.id and l.type = 'redeem')
 where m.id = 'LM-4030';

/* Twelve-month qualifying spend, in her own currency, counting the dollar
   orders at what they were worth in shillings when she placed them. It decides
   her tier and was being computed off the KES orders alone, so two purchases
   simply did not count towards the rung she is climbing.

   Net of tax, matching every other member on the platform — hers came to
   110,900.87 against gross KES orders of 128,645.00, which is the same figure
   divided by 1.16. A refunded order does not qualify, which is why the reversed
   charger and the reversed eSIM are absent from both sides. */
update loyalty_members m
   set qualify_12m = (
     select coalesce(sum(
       round(
         round(o.total / (1 + o.tax_rate / 100.0), 2)
         * case when o.currency = m.currency then 1
                else (select x.rate from fx_rates x
                       where x.base = o.currency and x.quote = m.currency
                         and x.as_of <= o.created_at::date
                       order by x.as_of desc limit 1) end
       , 2)), 0)
     from orders o
     where o.user_id = m.user_id
       and o.created_at::date > current_date - interval '12 months'
       and o.status not in ('refunded', 'failed', 'cancelled', 'awaiting_payment'))
 where m.id = 'LM-4030';

/* ----------------------------------------------------------- the guards --- */

/* The escape hatch closes. A movement belongs to a member and is denominated in
   that member's money; nothing about that depends on whether the writer is a
   signed-in customer or a migration, and the exemption is exactly how the four
   rows above were written. */
create or replace function guard_ledger_currency() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  theirs text;
  rate   record;
  worth  numeric;
begin
  select currency into theirs from loyalty_members where id = new.member;
  /* A row for a member who does not exist yet is left to the foreign key to
     refuse, in its own words. */
  if theirs is null then return new; end if;

  if new.currency is distinct from theirs then
    raise exception 'This member''s rewards are held in %, so a movement cannot be worth %. Convert the spend before the points are computed — a point is a unit of their programme, not of the currency they paid in.',
      theirs, new.currency;
  end if;

  /* `value` is the money the points are worth, not a second copy of the point
     count. The two coincide wherever `per_unit` is 1 — INR and KES — which is
     why writing the count worked everywhere anybody looked. */
  select * into rate from loyalty_point_rates where currency = new.currency;
  if rate is null or rate.per_unit <= 0 then return new; end if;

  worth := round(abs(new.points) / rate.per_unit, 2);

  if new.type = 'redeem' then
    /* A redemption is worth `value_per` of the base rate and the options run
       from 1.00 to 1.30, so it may exceed the base worth — but never fall short
       of it, and never by the hundredfold that a raw point count would. */
    if new.value < worth - 0.01 or new.value > worth * 2 then
      raise exception 'A redemption of % points is worth about % %, not %.',
        abs(new.points), worth, new.currency, new.value;
    end if;
  elsif new.value is distinct from worth then
    raise exception '% points are worth % %, not %. `value` is the money the points come to at % points per unit, not the point count.',
      abs(new.points), worth, new.currency, new.value, rate.per_unit;
  end if;

  return new;
end $$;

/* ------------------------------------------------------------- assertions -- */

do $$
declare
  n integer;
  rung record;
begin
  /* The rule the whole file is about: one member, one currency. */
  select count(*) into n
    from loyalty_ledger l join loyalty_members m on m.id = l.member
   where l.currency is distinct from m.currency;
  if n > 0 then
    raise exception '% ledger rows are denominated in a currency their member does not hold', n;
  end if;

  /* And `value` is money, everywhere, not just where per_unit hides the
     difference. */
  select count(*) into n
    from loyalty_ledger l join loyalty_point_rates r on r.currency = l.currency
   where l.type <> 'redeem'
     and l.value is distinct from round(abs(l.points) / r.per_unit, 2);
  if n > 0 then
    raise exception '% ledger rows record the point count where the money should be', n;
  end if;

  /* The invariant that makes a point mean one thing across four currencies. If
     this ever stops holding, a market has quietly become more generous than the
     others and the conversion above stops being neutral. */
  for rung in select currency, (earn_per_unit / per_unit) * 100 as pct
             from loyalty_point_rates where per_unit > 0
  loop
    if round(rung.pct, 4) <> 1.0000 then
      raise exception 'Points in % return %%% of spend, not 1%% — a point is not the same thing there as everywhere else',
        rung.currency, round(rung.pct, 4);
    end if;
  end loop;

  /* Her four rows in particular, since they are what somebody will look at. */
  select count(*) into n from loyalty_ledger where member = 'LM-4030' and currency <> 'KES';
  if n > 0 then raise exception '% of the Kenyan shopper''s movements are still in dollars', n; end if;

  /* The reversal gives back exactly what the earn gave, which is the one place
     the FX rate must NOT be applied a second time. */
  select count(*) into n
    from loyalty_ledger rev join loyalty_ledger e
      on e.member = rev.member and e.ref = rev.ref and e.type = 'earn'
   where rev.type = 'reverse' and rev.points <> -e.points;
  if n > 0 then raise exception '% reversals return a different number of points than the earn they reverse', n; end if;

  /* Aggregates come from the rows. */
  select count(*) into n from loyalty_members m
   where m.balance is distinct from
     (select coalesce(sum(points), 0) from loyalty_ledger where member = m.id);
  if n > 0 then raise exception '% members hold a balance their ledger does not add up to', n; end if;

  /* The multiplier used above is Silver's 1.25x, so it is worth confirming that
     counting the dollar orders has not moved her off Silver — if it had, the
     recomputation would be using a rate she is no longer on. Kenya's rungs are
     75,000 to 225,000. */
  select count(*) into n from loyalty_members m
    join loyalty_tier_thresholds lo on lo.tier_id = m.tier and lo.currency = m.currency
   where m.id = 'LM-4030'
     and (m.tier <> 'silver' or m.qualify_12m < lo.qualify_spend
          or m.qualify_12m >= (select t.qualify_spend from loyalty_tier_thresholds t
                                where t.currency = m.currency and t.tier_id = 'gold'));
  if n > 0 then
    raise exception 'Counting the dollar orders moved the Kenyan shopper off the Silver rung her points were computed at';
  end if;

  /* Nobody else moved. This migration is about four rows. */
  select count(*) into n from loyalty_members
   where id = 'LM-4001' and (balance <> 2500 or lifetime_earned <> 9420 or lifetime_redeemed <> 7200);
  if n > 0 then raise exception 'The Indian shopper''s rewards were changed'; end if;
end $$;
