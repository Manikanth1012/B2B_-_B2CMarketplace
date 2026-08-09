/* A rate schedule nothing computed from.
 *
 * `loyalty_point_rates`, `loyalty_earn_rules` and `loyalty_tiers` between them
 * describe exactly what an order earns: a currency rate, a rule rate, a tier
 * multiplier, a per-order cap and a per-month cap. Three tables, well shaped,
 * with a `why` on every rule. Nothing anywhere multiplied them together. Every
 * one of the 413 movements in the ledger was a figure somebody wrote down.
 *
 * WHAT I FIRST REPORTED, AND WHY IT WAS WRONG
 *
 * "Thirteen of forty-four order-linked earn rows record three times or more what
 * the rate tables allow." That comparison used the currency rate alone —
 * `total × earn_per_unit` — and ignored the two multipliers sitting beside it.
 * On that arithmetic a Gold customer on a triple-points launch weekend looks
 * like a four-and-a-half-times fraud, and the rows flagged loudest were the ones
 * where the promotion was doing its job.
 *
 * The full formula reproduces the old rows almost exactly. What it exposes is
 * two different things, neither of which was what I said:
 *
 * THE OLD ROWS ARE RIGHT ABOUT AN AMOUNT THAT IS NOT THEIR ORDER'S.
 * LTX-70112 says "Kestrel K7 handset — ₹39,000 at 1.5x Gold" and carries 585
 * points. 39,000 × 0.01 × 1.5 = 585 exactly. Its order totals ₹14,999. The
 * points were computed correctly and then the `ref` was pointed somewhere else —
 * LTX-70139's note admits it in passing, "(Re-referenced: this and Daniel...)".
 * So the ledger is internally consistent with amounts that appear nowhere.
 *
 * AND MY OWN FOURTEEN ROWS IGNORE THE TIER.
 * Written this morning as `floor(total × earn_per_unit)`, with no rule rate and
 * no tier multiplier, because I read one of the three tables. Priya is Gold and
 * has been under-credited on every order I gave her.
 *
 * WHAT THIS DOES
 *
 * Puts the formula in the database as one function, so the tables are read
 * rather than admired, and restates every order-linked earn row from the order
 * it actually points at. The notes are rewritten too — a note describing
 * ₹39,000 beside a ₹14,999 order is the thing that made this discoverable, and
 * leaving it would leave the next person the same puzzle.
 *
 * Monthly caps are applied in date order within a member, rule and month,
 * because that is what a cap means: the first orders earn and the later ones
 * hit the ceiling. Doing it any other way makes the answer depend on the order
 * rows happen to come back in.
 */

/* ---- 1. The formula, in one place ------------------------------------------------ */

create or replace function public.loyalty_points_for(
  p_amount numeric, p_currency text, p_rule text, p_member text, p_on date default current_date)
returns int language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_unit numeric;
  v_rule record;
  v_mult numeric;
  v_pts  numeric;
  v_mcur text;
  v_fx   numeric;
  v_amt  numeric := p_amount;
begin
  /* Points are earned in the member's money, not the order's.
   *
     Wanjiru banks in shillings and three of her orders are priced in dollars —
     the marketplace lets a Kenyan buyer transact in either. Her ledger, her
     balance and what a point is worth to her are all KES, and
     `guard_ledger_currency` enforces that from the other side. It caught the
     first version of this file computing 9.99 dollars at the shilling rate and
     crediting thirteen points for what is really about 1,283 shillings.
   *
     Converted at the fix in force on the day of the order, not today's: points
     awarded last July must not move when the rate does. */
  select currency into v_mcur from public.loyalty_members where id = p_member;
  v_mcur := coalesce(v_mcur, p_currency);

  if v_mcur <> p_currency then
    select f.rate into v_fx from public.fx_rates f
     where f.base = p_currency and f.quote = v_mcur and f.as_of <= p_on
     order by f.as_of desc limit 1;
    if v_fx is null then
      raise exception
        'There is no %→% rate on file at or before %, so this order cannot be credited in the money the member earns in.',
        p_currency, v_mcur, p_on;
    end if;
    v_amt := p_amount * v_fx;
  end if;

  select earn_per_unit into v_unit from public.loyalty_point_rates where currency = v_mcur;
  if v_unit is null then
    /* Refused rather than defaulted. A member in a currency nobody has priced a
       point in must not be credited at somebody else's rate — the same
       reasoning `redeem_points` already applies at the other end. */
    raise exception 'Points have no value set in % yet, so nothing can be earned in it.', v_mcur;
  end if;

  select * into v_rule from public.loyalty_earn_rules where id = p_rule;
  if v_rule.id is null then
    raise exception 'There is no earn rule %.', p_rule;
  end if;

  select t.multiplier into v_mult
    from public.loyalty_members m join public.loyalty_tiers t on t.id = m.tier
   where m.id = p_member;
  v_mult := coalesce(v_mult, 1.0);

  v_pts := v_amt * v_unit * v_rule.rate * v_mult + coalesce(v_rule.bonus, 0);

  /* Floor, not round. A point is indivisible and the marketplace does not give
     away a fraction it did not earn — and the existing rows were floored, which
     is how the formula was recovered from them at all. */
  v_pts := floor(v_pts);

  if v_rule.cap_per_order is not null then
    v_pts := least(v_pts, v_rule.cap_per_order);
  end if;
  return greatest(v_pts, 0)::int;
end $$;

grant execute on function public.loyalty_points_for(numeric, text, text, text, date) to authenticated;

/* ---- 2. Restate every earn row against the order it points at -------------------- */

do $$
declare r record; v_raw int; v_capped int; v_used numeric; v_per numeric;
begin
  for r in
    select l.id, l.member, l.rule_id, l.ref, l.when_date, o.total, o.currency,
           o.created_at, e.cap_per_month, e.name as rule_name, m.tier, t.name as tier_name
      from public.loyalty_ledger l
      join public.orders o on o.order_ref = l.ref
      join public.loyalty_earn_rules e on e.id = l.rule_id
      join public.loyalty_members m on m.id = l.member
      join public.loyalty_tiers t on t.id = m.tier
     where l.type = 'earn'
     order by o.created_at, l.id
  loop
    v_raw := public.loyalty_points_for(
      r.total, r.currency, r.rule_id, r.member, r.created_at::date);
    v_capped := v_raw;

    /* The monthly ceiling, filled in date order. A cap applied to whichever row
       a query happened to reach first is not a cap, it is a lottery. */
    if r.cap_per_month is not null then
      select coalesce(sum(l2.points), 0) into v_used
        from public.loyalty_ledger l2
        join public.orders o2 on o2.order_ref = l2.ref
       where l2.member = r.member and l2.rule_id = r.rule_id and l2.type = 'earn'
         and date_trunc('month', o2.created_at) = date_trunc('month', r.created_at)
         and (o2.created_at, l2.id) < (r.created_at, r.id);
      v_capped := greatest(0, least(v_raw, r.cap_per_month - v_used))::int;
    end if;

    /* And what those points are worth. `guard_ledger_currency` refuses a
       movement whose `value` is not the points converted at the member's own
       rate — which caught the first version of this file changing points and
       leaving the money behind. Two figures for one fact, kept in step by a
       guard rather than by whoever is editing. */
    select p.per_unit into v_per
      from public.loyalty_members m
      join public.loyalty_point_rates p on p.currency = m.currency
     where m.id = r.member;

    update public.loyalty_ledger
       set points = v_capped,
           value = round(v_capped::numeric / v_per, 2),
           /* The note says what it is a note about: this order, this rule, this
              tier, and whether a ceiling bit. The old ones described amounts
              that were not their order's, which is what made the whole thing
              findable. */
           note = format('%s on %s — %s at %s%s',
                    r.rule_name, r.ref, r.tier_name,
                    money_text(r.total, r.currency),
                    case when v_capped < v_raw then ', capped' else '' end)
     where id = r.id;
  end loop;
end $$;

/* ---- 2a. A reversal is worth exactly what it reverses ---------------------------- */

/* Restating an earn without restating the reversal that undoes it leaves a pair
 * that no longer nets to nothing. ORD-881044 was refunded inside the fourteen
 * days: LTX-70175 earned 680 and LTX-70176 took 680 back. The earn is 168 on the
 * published schedule; the reversal was left at 680, so the pair now costs the
 * customer 512 points for an order she was refunded for.
 *
 * It surfaced from an unexpected direction — the customer's own rewards screen
 * stopped adding up to her balance — because both rows carry no `user_id` and
 * are invisible to her under `owner_read_loyalty_ledger`. Two defects stacked:
 * a reversal that no longer matched its earn, and a pair of movements on her
 * membership that she cannot see.
 */
update public.loyalty_ledger r
   set points = -e.points,
       /* `value` is the cash the points come to, and it is a magnitude: a
          redemption carries negative points and a positive value, which is what
          `redeem_points` writes and what `guard_ledger_currency` enforces.
          Negating it alongside the points was the obvious symmetry and the
          wrong one. */
       value = abs(e.value),
       note = format('Reversed: %s', e.note)
  from public.loyalty_ledger e
 where r.type = 'reverse'
   and e.type = 'earn'
   and e.member = r.member
   and e.ref = r.ref
   and r.points is distinct from -e.points;

/* And a movement on a membership belongs to whoever holds it. These two were
 * written with a null `user_id`, so the customer could not see the earn or its
 * reversal on her own history — the balance moved and the reason for it was
 * hidden. Backfilled here; the policy that made a null invisible is widened
 * below so the next one cannot hide either.
 */
update public.loyalty_ledger l
   set user_id = m.user_id
  from public.loyalty_members m
 where m.id = l.member and l.user_id is null and m.user_id is not null;

/* Visibility follows the membership, not a column somebody has to remember to
 * fill. `owner_read_loyalty_ledger` matched on `loyalty_ledger.user_id`, which
 * two of the seeded rows do not carry — and a customer who cannot see a
 * movement cannot see why their balance changed. The membership already knows
 * whose it is. */
drop policy if exists owner_read_loyalty_ledger on public.loyalty_ledger;
create policy owner_read_loyalty_ledger on public.loyalty_ledger
  for select using (
    user_id = auth.uid()
    or exists (select 1 from public.loyalty_members m
                where m.id = loyalty_ledger.member and m.user_id = auth.uid()));

/* ---- 2b. Nobody is left owing points they have already spent --------------------- */

/* Restating the old rows downward took LM-4001 to minus forty-five, and the
 * arithmetic behind that is worth stating plainly: she has redeemed 11,500
 * points and, on the published schedule, ever earned 2,620. The inflated rows
 * were not a rounding problem, they were the only thing making her redemption
 * history look affordable.
 *
 * She redeemed against a balance the marketplace showed her and stood behind.
 * Correcting our own arithmetic afterwards does not make her spending
 * retrospectively unaffordable — and a negative balance is not a state anything
 * downstream is built for: `redeem_points` compares against it, the screen
 * prints it, and the tier thresholds count from it.
 *
 * HELD HARMLESS MEANS THE BALANCE SHE HAD, NOT ZERO
 *
 * The first version of this brought her to nought, which is still worse off
 * than before the correction and still not what "we got it wrong" ought to cost
 * the customer. She was shown 2,500 for as long as this seed has existed; that
 * is the figure the marketplace stood behind and it is the figure she keeps.
 *
 * Written as a movement rather than by nudging a balance, so the ledger stays
 * the only place a balance comes from and somebody reading it in a year can see
 * that the marketplace got it wrong and ate the difference.
 */
insert into public.loyalty_ledger (
  id, member, when_date, type, points, ref, rule_id, funder, value, note, user_id, currency)
select 'LTX-ADJ-' || m.id || '-RECON',
       m.id, to_char(current_date, 'DD Mon YYYY'), 'adjust', (2500 - m.balance)::int,
       null, null, 'operator',
       round((2500 - m.balance)::numeric / p.per_unit, 2),
       format('Goodwill correction. Restating earnings against the published rate schedule '
              'left this account %s points short of what it had already redeemed — the points '
              'were spent against a balance we showed and stood behind. The difference is '
              'written off rather than clawed back, and the balance is restored to the 2,500 '
              'displayed before the correction.', -m.balance),
       m.user_id, m.currency
  from public.loyalty_members m
  join public.loyalty_point_rates p on p.currency = m.currency
 where m.balance < 0
   and not exists (select 1 from public.loyalty_ledger l
                    where l.id = 'LTX-ADJ-' || m.id || '-RECON');

/* ---- 3. A tier benefit that promises something CR-008 refuses -------------------- */

/* "Contract pricing reviewed at every renewal" sits in the Business Plus
 * benefits. There is no contract pricing here — CR-008 records that every
 * account pays the published price for its market — so the benefit promises an
 * arrangement the marketplace does not operate. It was written before the
 * contracts work said so out loud.
 */
update public.loyalty_tiers
   set benefits = array_replace(benefits,
         'Contract pricing reviewed at every renewal',
         'Commercial review with the marketplace at every renewal')
 where 'Contract pricing reviewed at every renewal' = any(benefits);

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text; n int; v_row record;
begin
  /* ASSERT-1: every order-linked earn row is what the schedule produces. The
     whole point: three tables that describe an answer, and a ledger that now
     agrees with it. */
  for v_row in
    select l.id, l.points, l.member, l.rule_id, l.ref, o.total, o.currency, o.created_at,
           e.cap_per_month
      from public.loyalty_ledger l
      join public.orders o on o.order_ref = l.ref
      join public.loyalty_earn_rules e on e.id = l.rule_id
     where l.type = 'earn'
  loop
    declare v_raw int; v_used numeric; v_expect int;
    begin
      v_raw := public.loyalty_points_for(
        v_row.total, v_row.currency, v_row.rule_id, v_row.member, v_row.created_at::date);
      v_expect := v_raw;
      if v_row.cap_per_month is not null then
        select coalesce(sum(l2.points), 0) into v_used
          from public.loyalty_ledger l2
          join public.orders o2 on o2.order_ref = l2.ref
         where l2.member = v_row.member and l2.rule_id = v_row.rule_id and l2.type = 'earn'
           and date_trunc('month', o2.created_at) = date_trunc('month', v_row.created_at)
           and (o2.created_at, l2.id) < (v_row.created_at, v_row.id);
        v_expect := greatest(0, least(v_raw, v_row.cap_per_month - v_used))::int;
      end if;
      if v_row.points <> v_expect then
        raise exception '% earned % on %, and the schedule produces %',
          v_row.id, v_row.points, v_row.ref, v_expect;
      end if;
    end;
  end loop;

  /* ASSERT-2: no per-order cap is exceeded anywhere. Checked separately from
     the recomputation, because a formula that applies its own cap and then
     checks its own output would agree with itself whatever it did. */
  select string_agg(format('%s has % against a cap of %s', l.id, l.points, e.cap_per_order), '; ')
    into bad
    from public.loyalty_ledger l
    join public.loyalty_earn_rules e on e.id = l.rule_id
   where l.type = 'earn' and e.cap_per_order is not null and l.points > e.cap_per_order;
  if bad is not null then raise exception 'earnings over their per-order cap: %', bad; end if;

  /* ASSERT-3: nor a monthly one, summed across the month it belongs to. */
  select string_agg(format('%s/%s in %s: %s against %s',
                           t.member, t.rule_id, t.mon, t.total_points, t.cap_per_month), '; ')
    into bad from (
    select l.member, l.rule_id, date_trunc('month', o.created_at) mon,
           sum(l.points) total_points, e.cap_per_month
      from public.loyalty_ledger l
      join public.orders o on o.order_ref = l.ref
      join public.loyalty_earn_rules e on e.id = l.rule_id
     where l.type = 'earn' and e.cap_per_month is not null
     group by l.member, l.rule_id, date_trunc('month', o.created_at), e.cap_per_month
    having sum(l.points) > e.cap_per_month) t;
  if bad is not null then raise exception 'earnings over their monthly cap: %', bad; end if;

  /* ASSERT-4: no note describes an amount that is not its order's. This is the
     defect that made the whole thing visible — "₹39,000 at 1.5x Gold" against a
     ₹14,999 order — and it is worth a check of its own, because the points and
     the note went wrong together and could go wrong together again. */
  select string_agg(l.id, ', ') into bad
    from public.loyalty_ledger l
    join public.orders o on o.order_ref = l.ref
   where l.type = 'earn' and l.note !~ ('\m' || replace(o.order_ref, '-', '\-') || '\M');
  if bad is not null then raise exception 'earn notes that do not name their own order: %', bad; end if;

  /* ASSERT-5: and the tier multiplier is actually being applied, which my own
     fourteen rows were not. A Gold member's base earn must exceed a Bronze
     member's on the same money. */
  if public.loyalty_points_for(10000, 'INR', 'ERN-01', 'LM-4001', current_date)
     <= floor(10000 * 0.01)::int then
    raise exception 'the tier multiplier is not reaching the calculation';
  end if;

  /* ASSERT-6: every balance still equals its own ledger after all of this. The
     rebalance trigger does it; this is the check that it did. */
  select string_agg(format('%s holds %s and its ledger sums to %s', m.id, m.balance, s.total), '; ')
    into bad
    from public.loyalty_members m
    join lateral (select coalesce(sum(points), 0) total
                    from public.loyalty_ledger where member = m.id) s on true
   where m.balance <> s.total;
  if bad is not null then raise exception 'balances that are not their ledger: %', bad; end if;

  /* ASSERT-6b: and nobody is in the red. A negative balance is not a smaller
     number, it is a state `redeem_points`, the tier thresholds and the screen
     were none of them built for. */
  select string_agg(format('%s holds %s', id, balance), ', ') into bad
    from public.loyalty_members where balance < 0;
  if bad is not null then raise exception 'members with a negative balance: %', bad; end if;

  /* ASSERT-6c: and the demo customer can still redeem something, so the
     redemption tests do not quietly turn into no-ops. Both of them begin
     `if (before < points) return`, which is a silent pass — the balance going
     to nought would have retired the only test that proves a customer can spend
     points at all. */
  select balance into n from public.loyalty_members where id = 'LM-4001';
  if n < (select min_redeem from public.loyalty_programme limit 1) then
    raise exception
      'LM-4001 holds % points and the programme minimum is %, so the redemption tests would skip',
      n, (select min_redeem from public.loyalty_programme limit 1);
  end if;

  /* ASSERT-6d: every reversal is worth exactly what it reverses. A pair that
     does not net to nothing charges the customer for an order they were
     refunded for. */
  select string_agg(format('%s is %s and reverses %s which is %s',
                           r.id, r.points, e.id, e.points), '; ') into bad
    from public.loyalty_ledger r
    join public.loyalty_ledger e
      on e.type = 'earn' and e.member = r.member and e.ref = r.ref
   where r.type = 'reverse' and r.points <> -e.points;
  if bad is not null then raise exception 'reversals that do not undo their movement: %', bad; end if;

  /* ASSERT-6e: and a customer can see every movement on their own membership.
     A balance that moves for a reason the holder cannot read is worse than a
     wrong balance, because there is nothing to query. */
  select string_agg(l.id, ', ') into bad
    from public.loyalty_ledger l
    join public.loyalty_members m on m.id = l.member
   where m.user_id is not null and l.user_id is null;
  if bad is not null then raise exception 'movements a member cannot see on their own history: %', bad; end if;

  /* ASSERT-7: nothing promises contract pricing, which is not operated here. */
  select string_agg(id, ', ') into bad from public.loyalty_tiers
   where array_to_string(benefits, ' ') ilike '%contract pricing%';
  if bad is not null then raise exception 'tiers promising contract pricing: %', bad; end if;

  select count(*) into n from public.loyalty_ledger l join public.orders o on o.order_ref = l.ref
   where l.type = 'earn';
  raise notice 'reconciled % order-linked earn movements', n;
end $$;
