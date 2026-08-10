/* The settlement run has never been able to create a statement.
 *
 * Its INSERT omits `payout_net`, `fx_rate` and `fx_as_of`. All three are NOT
 * NULL with no default, so the first partner a real run had anything to settle
 * for would fail on the not-null constraint and take the whole run with it.
 *
 * Nothing caught it because nothing ever reached the insert. The suite's
 * idempotency test calls `run_settlements` with today's date, every settleable
 * period has already been settled by a seed, so every partner hits the
 * "already settled" branch and the run reports `settled: 0` and passes. Fifty-
 * five of the fifty-nine statements on file carry a `run_id` and none of them
 * came from this function — they were written by migrations that filled in the
 * columns by hand and stamped "Settlement scheduler" on the run. A green test
 * over a path that is never taken.
 *
 * Found while making the rolling reserve real, because a reserve the run
 * withholds cannot be demonstrated by a run that cannot write.
 *
 * The rate is the fix in force when the period CLOSED, not today's: a statement
 * gets reprinted years later and has to show what was actually paid. A partner
 * with no rate on file for their payout currency is skipped with that as the
 * reason rather than settled at an invented conversion.
 *
 * And the payout leg is where the reserve lands. `net` stays what the period
 * earned — every reconciliation in the suite checks it against the deduction
 * stack and should go on doing so — while `payout_net` is what reaches the
 * bank, which is the net less what is retained and plus what has matured.
 */
CREATE OR REPLACE FUNCTION public.run_settlements_core(p_as_of date DEFAULT CURRENT_DATE, p_actor text DEFAULT 'Settlement scheduler'::text, p_kind text DEFAULT 'scheduled'::text, p_only text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  run_id     text;
  t          public.partner_settlement_terms;
  pt         public.partners;
  bank       public.partner_bank;
  per        record;
  agg        record;
  d          record;
  carried    numeric;
  held       numeric;
  payable    numeric;
  wht        numeric;
  wht_detail jsonb;
  res        record;
  after_wht  numeric;
  stmt_id    text;
  v_rate     numeric;
  v_as_of    date;
  v_paid     numeric;
  considered integer := 0;
  settled    integer := 0;
  skips      jsonb := '[]'::jsonb;
  note       text;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace runs settlement.';
  end if;
  if p_kind not in ('scheduled','manual','catch-up') then
    raise exception 'A run is scheduled, manual or catch-up, not %.', p_kind;
  end if;
  if p_as_of > current_date then
    raise exception
      'A run cannot be dated %. Settlement follows the calendar: a period that has not closed has trade still to come, and a refund next week would change what was paid.',
      p_as_of;
  end if;

  run_id := 'RUN-' || to_char(p_as_of, 'YYYYMMDD')
            || case when p_kind = 'scheduled' then '' else '-' || upper(left(p_kind, 1)) end
            || case when p_only is not null then '-' || right(p_only, 4) else '' end;

  insert into public.settlement_run (id, ran_on, kind, ran_by, status, considered, settled)
  values (run_id, p_as_of, p_kind, p_actor, 'complete', 0, 0)
  on conflict (id) do update set ran_by = excluded.ran_by, started_at = now();

  for t in
    select * from public.partner_settlement_terms
     where p_only is null or partner_id = p_only
     order by partner_id
  loop
    considered := considered + 1;
    select * into pt from public.partners where id = t.partner_id;

    if pt.status <> 'live' then
      skips := skips || jsonb_build_object(
        'partner_id', t.partner_id, 'partner', pt.name, 'reason',
        format('%s is %s, not live. Nothing is settled to a seller who is not trading; the period stays open until they are.',
               pt.name, pt.status));
      continue;
    end if;

    select * into per from public.settlement_period(
      t.frequency, t.align, t.starts_on, t.closes_on_day, p_as_of);

    if per.closed_on is null then
      skips := skips || jsonb_build_object(
        'partner_id', t.partner_id, 'partner', pt.name, 'reason',
        format('No %s period has closed yet. The contract starts %s and the first close is %s.',
               t.frequency, t.starts_on, coalesce(public.next_settlement_close(t.partner_id, p_as_of)::text, 'not yet determined')));
      continue;
    end if;

    select id into stmt_id from public.settlement_statements
     where partner_id = t.partner_id and period_start = per.period_start
       and period_end = per.period_end;
    if stmt_id is not null then
      skips := skips || jsonb_build_object(
        'partner_id', t.partner_id, 'partner', pt.name, 'reason',
        format('%s to %s was already settled as %s.', per.period_start, per.period_end, stmt_id),
        'statement_id', stmt_id, 'already', true);
      continue;
    end if;

    select
      coalesce(sum(gross), 0) gross, coalesce(sum(commission), 0) commission,
      coalesce(sum(fees), 0) fees, coalesce(sum(refunds), 0) refunds,
      coalesce(sum(net), 0) net, count(*) lines,
      case when coalesce(sum(gross), 0) > 0
           then round(sum(commission_rate * gross) / sum(gross), 2) else 0 end rate,
      coalesce(sum(net) filter (
        where t.hold_days > 0 and occurred_on > per.closed_on - t.hold_days), 0) held
      into agg
      from public.settlement_lines
     where partner_id = t.partner_id
       and occurred_on between per.period_start and per.period_end
       and statement_id is null;

    select coalesce(carried_out, 0) into carried
      from public.settlement_statements
     where partner_id = t.partner_id and period_end < per.period_start
     order by period_end desc limit 1;
    carried := coalesce(carried, 0);

    if agg.lines = 0 and carried = 0 then
      skips := skips || jsonb_build_object(
        'partner_id', t.partner_id, 'partner', pt.name, 'reason',
        format('Nothing to settle for %s to %s — no unsettled sales in the period and nothing carried forward.',
               per.period_start, per.period_end));
      continue;
    end if;

    /* Tax deducted at source, on the day the period closed rather than today —
       a rate that changed since is not the rate this period was earned under.
       Residence against the paying entity's market decides which rate applies;
       the treaty certificate only ever reduces a non-resident one. */
    select * into bank from public.partner_bank where partner_id = t.partner_id;
    wht := 0;
    wht_detail := '[]'::jsonb;
    for d in
      select * from public.withholding_on(
        pt.market, 'partner-payout',
        coalesce(bank.tax_residence, pt.market), coalesce(bank.treaty_on_file, false),
        agg.gross, agg.commission, agg.gross - agg.commission - agg.fees - agg.refunds,
        per.closed_on)
    loop
      if d.amount > 0 then
        wht := wht + d.amount;
        wht_detail := wht_detail || jsonb_build_object(
          'rule_id', d.rule_id, 'statute', d.statute, 'label', d.label,
          'basis', d.basis, 'rate', d.rate, 'amount', d.amount);
      end if;
    end loop;

    /* The deduction comes out of the stack before anything is held or carried.
       Holding back money that has already gone to the revenue authority would
       carry a figure the marketplace does not have. */
    after_wht := round(agg.net - wht, 2);
    held      := round(agg.held, 2);
    payable   := round(after_wht - held + carried, 2);

    /* The rolling reserve, retained against refunds and chargebacks that land
       after the returns window the holdback covers. A percentage of gross,
       because a refund is against the sale price rather than the seller's
       margin — and bounded by what this period has, because holding more than
       is payable would carry a figure the marketplace is not holding.

       Matured tranches come back in the same movement. Before the minimum is
       tested, so the test is against what is actually going to be paid. */
    select * into res from public.reserve_on(t.partner_id, agg.gross, payable, per.closed_on);
    payable := round(payable + res.released - res.withheld, 2);

    if payable > 0 and payable < t.minimum_payout then
      note := format('Carried forward: %s is below the %s %s minimum payout agreed in %s.',
                     payable, t.minimum_payout, t.payout_currency, coalesce(t.contract_ref, 'the contract'));
      held := round(held + payable, 2);
      payable := 0;
    else
      note := null;
    end if;

    stmt_id := format('ss-%s-%s', right(t.partner_id, 4), to_char(per.period_start, 'YYYYMM'));

    /* The payout leg. Omitted from this insert since the day the columns were
       made NOT NULL, which made every real run fail on the first partner it
       had anything to settle for — and went unseen because the only path the
       suite ever reached was "already settled, skipped".

       The fix in force when the period CLOSED, not today's. A statement is
       reprinted years later and has to show what was actually paid. */
    if t.payout_currency = 'USD' then
      v_rate := 1; v_as_of := per.closed_on;
    else
      select f.rate, f.as_of into v_rate, v_as_of
        from public.fx_rates f
       where f.base = 'USD' and f.quote = t.payout_currency and f.as_of <= per.closed_on
       order by f.as_of desc limit 1;
      if v_rate is null then
        skips := skips || jsonb_build_object(
          'partner_id', t.partner_id, 'partner', pt.name, 'reason',
          format('No USD to %s rate on file on or before %s. Settling would invent a conversion.',
                 t.payout_currency, per.closed_on));
        continue;
      end if;
    end if;

    /* What actually reaches the bank: what the period earned, less what is
       retained against later refunds, plus whatever matured and came back. */
    v_paid := round(after_wht - res.withheld + res.released, 2);

    insert into public.settlement_statements
      (id, partner_id, partner_name, plan_id, period, period_start, period_end,
       frequency, closed_on, due_on,
       gross, commission, commission_rate, fees, refunds,
       withholding, withholding_rate, withholding_detail, net,
       held_back, carried_in, carried_out, reserve_withheld, reserve_released,
       order_count, currency, payout_currency, fx_rate, fx_as_of, payout_net,
       status, run_id, sort_order, note)
    values
      (stmt_id, t.partner_id, pt.name, pt.plan_id,
       case t.frequency
         when 'quarterly'   then 'Q' || to_char(per.period_start, 'Q') || ' ' || to_char(per.period_start, 'YYYY')
         when 'half-yearly' then 'H' || (case when extract(month from per.period_start) <= 6 then '1' else '2' end)
                                 || ' ' || to_char(per.period_start, 'YYYY')
         when 'yearly'      then to_char(per.period_start, 'YYYY')
         else to_char(per.period_start, 'Mon YYYY') end,
       per.period_start, per.period_end, t.frequency, per.closed_on,
       (per.closed_on + (t.pay_within_days || ' days')::interval)::date,
       agg.gross, agg.commission, agg.rate, agg.fees, agg.refunds,
       wht,
       case when agg.gross > 0 then round(wht / agg.gross * 100, 3) else 0 end,
       wht_detail,
       after_wht, held, carried, held, res.withheld, res.released,
       agg.lines, 'USD', t.payout_currency, v_rate, v_as_of, round(v_paid * v_rate, 2),
       'pending', run_id, 0, note);

    /* One tranche per statement, with the date it comes back on it. A seller
       asks when, not how much, and a single balance cannot answer that. */
    if res.withheld > 0 then
      insert into public.partner_reserve_tranche
        (id, partner_id, statement_id, amount, currency, basis, rate, held_on, matures_on)
      select format('RSV-%s-%s', right(t.partner_id, 4), to_char(per.period_start, 'YYYYMM')),
             t.partner_id, stmt_id, res.withheld, 'USD', agg.gross, res.rate,
             per.closed_on, (per.closed_on + (s.reserve_days || ' days')::interval)::date
        from public.partner_security s where s.partner_id = t.partner_id
      on conflict (partner_id, statement_id) do nothing;
    end if;

    if res.released > 0 then
      update public.partner_reserve_tranche
         set released_on = per.closed_on, released_by = stmt_id
       where partner_id = t.partner_id and released_on is null
         and matures_on <= per.closed_on;
    end if;

    update public.settlement_lines
       set statement_id = stmt_id
     where partner_id = t.partner_id
       and occurred_on between per.period_start and per.period_end
       and statement_id is null;

    /* The certificate the seller files with. Accrued against the statutory
       quarter, which is the cadence both authorities issue on whatever cycle
       the partner settles on. A deduction the payee cannot prove is a
       deduction they cannot claim, and the marketplace loses that dispute. */
    for d in select * from jsonb_array_elements(wht_detail) as e(value) loop
      insert into public.withholding_certificate
        (id, partner_id, market, rule_id, form, period_start, period_end,
         amount, currency, status, note)
      values (
        format('WHT-%s-%s-%s', right(t.partner_id, 4),
               to_char(date_trunc('quarter', per.closed_on), 'YYYY"Q"Q'),
               right(d.value ->> 'rule_id', 4)),
        t.partner_id, pt.market, d.value ->> 'rule_id',
        case when pt.market = 'IN' and (d.value ->> 'rule_id') = 'WHT-IN-194O' then 'Form 16A'
             when pt.market = 'IN' then 'GSTR-8 statement'
             when pt.market = 'KE' then 'KRA WHT certificate'
             else 'Statement' end,
        date_trunc('quarter', per.closed_on)::date,
        (date_trunc('quarter', per.closed_on) + interval '3 months' - interval '1 day')::date,
        (d.value ->> 'amount')::numeric, 'USD',
        case when (date_trunc('quarter', per.closed_on) + interval '3 months')::date > current_date
             then 'accruing' else 'filed' end,
        format('Accrued by %s.', run_id))
      on conflict (partner_id, rule_id, period_start, period_end)
      do update set amount = public.withholding_certificate.amount + excluded.amount;
    end loop;

    settled := settled + 1;
  end loop;

  if settled = 0 then
    delete from public.settlement_run where id = run_id;
  else
    update public.settlement_run
       set considered = considered, settled = settled, skipped = skips,
           finished_at = now(),
           note = format('%s of %s partners settled on %s.', settled, considered, p_as_of)
     where id = run_id;
  end if;

  return jsonb_build_object(
    'run_id', case when settled > 0 then run_id end,
    'ran_on', p_as_of, 'considered', considered,
    'settled', settled, 'skipped', skips);
end $function$
;

/* The other writer of `payout_net`, kept in step. A note or a wholesale charge
   moves `net`, and the payout has to move with it — still less whatever this
   statement retained. */
create or replace function public.apply_settlement_adjustments(p_statement text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st        public.settlement_statements;
  n         public.settlement_note;
  c         public.partner_charge;
  adj       numeric := 0;
  det       jsonb := '[]'::jsonb;
  notes     int := 0;
  charged   int := 0;
  raised    int := 0;
  base      numeric;
  room      numeric;
  take      numeric;
  taken     numeric := 0;
  held_off  boolean := false;
begin
  select * into st from public.settlement_statements where id = p_statement;
  if st.id is null then return jsonb_build_object('ok', false, 'why', 'No such statement.'); end if;
  if st.status in ('approved', 'paid') then
    return jsonb_build_object('ok', false, 'why',
      format('%s is %s. A note cannot be added to a statement that has been signed off.', p_statement, st.status));
  end if;

  update public.settlement_note
     set state = 'issued', statement_id = null, applied_on = null
   where statement_id = p_statement and state = 'applied';
  delete from public.partner_charge_recovery where statement_id = p_statement;

  for n in
    select * from public.settlement_note
     where partner_id = st.partner_id and state = 'issued'
     order by raised_on, id
  loop
    adj := adj + case n.kind when 'credit' then n.amount else -n.amount end;
    det := det || jsonb_build_object(
      'note_id', n.id, 'kind', n.kind, 'reason', n.reason_id,
      'amount', n.amount, 'detail', n.detail, 'ref', n.ref);
    update public.settlement_note set
      state = 'applied', statement_id = p_statement, applied_on = current_date
     where id = n.id;
    notes := notes + 1;
  end loop;

  if st.period_start is not null and st.period_end is not null then
    raised := public.raise_partner_charges(st.partner_id, st.period_start, st.period_end);
  end if;

  base := round(st.gross - st.commission - st.fees - st.refunds - st.withholding + adj, 2);
  room := round(base - st.held_back + st.carried_in, 2);

  if coalesce(st.disputed, false) then
    held_off := true;
    room := 0;
  end if;

  for c in
    select * from public.partner_charge
     where partner_id = st.partner_id
       and recovered < gross
       and period_start <= coalesce(st.period_end, period_start)
     order by period_start, id
  loop
    exit when room <= 0;
    take := least(round(c.gross - c.recovered, 2), room);
    if take <= 0 then continue; end if;

    adj   := adj - take;
    room  := round(room - take, 2);
    taken := round(taken + take, 2);
    det := det || jsonb_build_object(
      'charge_id', c.id, 'kind', 'debit', 'reason', 'wholesale',
      'amount', take, 'gross', c.gross, 'outstanding', round(c.gross - c.recovered - take, 2),
      'product', c.product_name, 'quantity', c.quantity,
      'period', to_char(c.period_start, 'Mon YYYY'),
      'detail', format('%s × %s%s', c.product_name, c.quantity,
        case when c.days_charged < c.days_in_period
             then format(', %s of %s days', c.days_charged, c.days_in_period) else '' end));

    insert into public.partner_charge_recovery (charge_id, statement_id, amount)
    values (c.id, p_statement, take);
    charged := charged + 1;
  end loop;

  update public.settlement_statements set
    adjustments = adj,
    adjustment_detail = det,
    net = round(gross - commission - fees - refunds - withholding + adj, 2),
    payout_net = round(
      (gross - commission - fees - refunds - withholding + adj
       - reserve_withheld + reserve_released) * fx_rate, 2)
   where id = p_statement;

  if notes = 0 and charged = 0 then
    return jsonb_build_object('ok', true, 'applied', 0, 'charges', 0, 'raised', raised,
      'held_off', held_off,
      'why', case when held_off
                  then format('%s is under dispute. Wholesale is not taken off a figure the seller is challenging; it waits for the next statement.', p_statement)
                  else 'No issued notes for that seller.' end);
  end if;

  return jsonb_build_object('ok', true, 'applied', notes, 'adjustment', adj,
    'charges', charged, 'raised', raised, 'recovered', taken, 'held_off', held_off);
end $$;

/* The insert the run performs, tried. Rolled back by raising — the point is
   that it reaches the constraint rather than what it leaves behind. */
do $$
begin
  begin
    insert into public.settlement_statements
      (id, partner_id, partner_name, period, period_start, period_end,
       frequency, closed_on, due_on, gross, commission, commission_rate, fees, refunds,
       withholding, withholding_rate, withholding_detail, net,
       held_back, carried_in, carried_out, reserve_withheld, reserve_released,
       order_count, currency, payout_currency, fx_rate, fx_as_of, payout_net,
       status, sort_order)
    values
      ('ss-SELFTEST-1', 'PTR-1011', 'TrackWise Telematics', 'Jun 2025', '2025-06-01', '2025-06-30',
       'monthly', '2025-06-30', '2025-07-30', 100, 10, 10, 0, 0,
       0, 0, '[]'::jsonb, 90, 0, 0, 0, 9, 0,
       1, 'USD', 'USD', 1, '2025-06-30', 81,
       'pending', 0);
    raise exception 'selftest-rollback';
  exception when others then
    if sqlerrm <> 'selftest-rollback' then
      raise exception 'The run''s insert still cannot write a statement: %', sqlerrm;
    end if;
  end;
end $$;
