/* Every partner settles monthly, and not one of them agreed to.
 *
 * The previous migration built the cycle: `partner_settlement_terms`, the
 * period arithmetic, a runs table. Nothing was in any of it. Seventy-six
 * statements exist, all monthly, all with `period` as the string "Feb 2026" and
 * every one of the new date columns null — because the only thing that ever
 * produced them was somebody running a month.
 *
 * This puts the contracts in, backfills the dates onto the history, and
 * re-periodises the partners whose contract is not monthly.
 *
 * WHY RE-PERIODISE RATHER THAN START FROM AUGUST.
 *
 * The tempting move is to agree the new cycles today and leave the monthly
 * history alone. It is also the move that produces a screen saying "settled
 * quarterly" above six monthly statements, and a Runs tab with nothing in it
 * until October. A quarterly partner whose entire visible history is monthly
 * has a cycle nobody can check.
 *
 * So the five partners on a non-monthly contract have their monthly statements
 * folded into the periods their contract actually describes. Nothing is
 * invented and nothing is lost: three monthly statements become one quarterly
 * one carrying the sum of their gross, their commission, their fees and their
 * refunds, and the orders behind them are the same orders. What changes is the
 * boundary the money is cut on, which is the thing that was wrong.
 *
 * The six monthly partners keep their statements exactly as they are and gain
 * the dates the string "Feb 2026" was standing in for.
 */

/* ---- 1. The contracts -------------------------------------------------------- */

/* Spread across all four frequencies because all four are real, and because a
 * cadence nobody is on is a code path nobody exercises. The choices are the
 * ones these businesses would actually sign:
 *
 *   Content and digital — monthly, net 15. Small recurring revenues, and a
 *   content partner watching cash flow does not wait a quarter for them.
 *
 *   Device OEMs — monthly, net 30, holding back the returns window. A handset
 *   sold on the 29th is not settled on the 31st; it is settled after the buyer
 *   has stopped being able to send it back.
 *
 *   Security and reseller — quarterly. Wholesale discounts and subscription
 *   seats reconcile on a quarter, and both of these carry enough volume that a
 *   monthly run is administration for its own sake.
 *
 *   Insurance introducer — half-yearly, net 45, with a cooling-off hold.
 *   Commission on a policy is not earned until the policyholder has stopped
 *   being able to walk away from it.
 *
 *   A suspended seller — yearly. Not because a year is right for them, but
 *   because a run has to be able to skip somebody and say why, and a suspended
 *   partner on the longest cycle is the case that would otherwise never be hit.
 */
insert into public.partner_settlement_terms
  (partner_id, frequency, align, starts_on, closes_on_day, pay_within_days,
   hold_days, hold_reason, minimum_payout, payout_currency,
   agreed_on, agreed_by, contract_ref, note) values

  ('PTR-1001', 'monthly',     'calendar',    date '2026-02-01', 0, 15,
   7,  'Content chargeback window — a subscription cancelled in the first week is refunded in full.',
   0,      'INR', date '2024-04-12', 'Ruben Oyelaran', 'MSA-2024-1001', null),

  ('PTR-1002', 'monthly',     'calendar',    date '2026-02-01', 0, 30,
   14, 'Returns window — a handset sold on the 29th is not settled on the 31st.',
   0,      'INR', date '2024-03-02', 'Ruben Oyelaran', 'MSA-2024-1002', null),

  ('PTR-1003', 'quarterly',   'calendar',    date '2026-01-01', 0, 30,
   0,  null,
   0,      'AED', date '2024-06-18', 'Anika Sharma',  'MSA-2024-1003',
   'Quarterly on the natural calendar boundary at the seller''s request — their own revenue recognition runs on calendar quarters.'),

  ('PTR-1004', 'monthly',     'calendar',    date '2026-02-01', 0, 30,
   14, 'Returns window on hardware.',
   0,      'INR', date '2024-09-27', 'Ruben Oyelaran', 'MSA-2024-1004', null),

  ('PTR-1005', 'monthly',     'calendar',    date '2026-02-01', 0, 15,
   7,  'Content chargeback window.',
   0,      'INR', date '2024-11-05', 'Ruben Oyelaran', 'MSA-2024-1005', null),

  /* Half-yearly, and the cooling-off hold is the point of it: insurance
     commission is not earned until the policyholder has stopped being able to
     cancel and get their money back. */
  ('PTR-1006', 'half-yearly', 'calendar',    date '2026-01-01', 0, 45,
   14, 'Statutory cooling-off — commission on a policy cancelled inside 14 days is not earned.',
   0,      'INR', date '2025-01-14', 'Anika Sharma',  'MSA-2025-1006',
   'Half-yearly, matching how the underwriter reconciles introducer commission.'),

  /* Anniversary alignment: they signed in February, so their quarters run
     Feb–Apr, May–Jul, Aug–Oct. Both alignments are written into real contracts
     and a system that only does one silently pays the other partner on the
     wrong days — which is why one partner here is on each. */
  ('PTR-1007', 'quarterly',   'anniversary', date '2026-02-01', 0, 15,
   7,  'Content chargeback window.',
   0,      'AED', date '2025-02-22', 'Anika Sharma',  'MSA-2025-1007',
   'Quarters counted from the month the contract started rather than from the calendar.'),

  ('PTR-1008', 'monthly',     'calendar',    date '2026-02-01', 0, 30,
   14, 'Returns window on hardware.',
   0,      'INR', date '2025-04-09', 'Ruben Oyelaran', 'MSA-2025-1008', null),

  /* A minimum payout that will actually bite. Paying a Kenyan bank account
     costs more than a few dollars, and below this the balance carries. */
  ('PTR-1009', 'quarterly',   'calendar',    date '2026-01-01', 0, 30,
   0,  null,
   250.00, 'KES', date '2025-05-30', 'Anika Sharma',  'MSA-2025-1009',
   'Quarterly with a minimum payout — the cost of a cross-border transfer is not worth a small balance.'),

  ('PTR-1010', 'monthly',     'calendar',    date '2026-02-01', 0, 15,
   0,  null,
   0,      'AED', date '2025-08-11', 'Anika Sharma',  'MSA-2025-1010', null),

  ('PTR-1011', 'monthly',     'calendar',    date '2026-02-01', 0, 30,
   14, 'Returns window on hardware.',
   0,      'INR', date '2026-01-19', 'Ruben Oyelaran', 'MSA-2026-1011', null),

  /* The 25th rather than month end, so the invoice can be raised before the
     books close. Real, and the only reason `closes_on_day` is not a boolean. */
  ('PTR-1015', 'yearly',      'calendar',    date '2026-01-01', 25, 60,
   0,  null,
   0,      'KES', date '2024-12-03', 'Anika Sharma',  'MSA-2024-1015',
   'Annual, closing on the 25th so the invoice is raised before the seller''s year end.'),

  /* Agreed at onboarding, before a single order. A seller signs the settlement
     terms with the contract, not on the day of their first payout, and this is
     the row that says the marketplace works that way. */
  ('PTR-1012', 'quarterly',   'calendar',    date '2026-09-01', 0, 30,
   0,  null,
   0,      'AED', date '2026-08-03', 'Anika Sharma',  'MSA-2026-1012',
   'Agreed during onboarding. Nothing settles until they go live.')
on conflict (partner_id) do nothing;

/* ---- 2. The dates the string was standing in for ----------------------------- */

/* Every existing statement is monthly, whatever its partner's contract now
   says, because monthly is all that ever ran. So they are dated against
   monthly terms and stamped `frequency = 'monthly'` — a statement records the
   cycle IT was struck on, not the cycle the partner is on today. Section 3
   then re-cuts the ones whose contract disagrees. */
update public.settlement_statements s set
  period_start = to_date(s.period, 'Mon YYYY'),
  period_end   = (to_date(s.period, 'Mon YYYY') + interval '1 month' - interval '1 day')::date,
  closed_on    = (to_date(s.period, 'Mon YYYY') + interval '1 month' - interval '1 day')::date,
  frequency    = 'monthly',
  due_on       = (to_date(s.period, 'Mon YYYY') + interval '1 month' - interval '1 day'
                  + (coalesce(t.pay_within_days, 30) || ' days')::interval)::date
 from public.partner_settlement_terms t
where t.partner_id = s.partner_id
  and s.period_start is null;

/* A statement for a partner with no terms at all — there should be none, but
   dating it against a default beats leaving it undated. */
update public.settlement_statements set
  period_start = to_date(period, 'Mon YYYY'),
  period_end   = (to_date(period, 'Mon YYYY') + interval '1 month' - interval '1 day')::date,
  closed_on    = (to_date(period, 'Mon YYYY') + interval '1 month' - interval '1 day')::date,
  frequency    = 'monthly',
  due_on       = (to_date(period, 'Mon YYYY') + interval '1 month' - interval '1 day' + interval '30 days')::date
 where period_start is null;

/* ---- 3. The period a date is IN, as opposed to the last one to close --------- */

/* `settlement_period` answers "what is the most recent period to have closed on
 * or before this date", which is the question a run asks. Folding history asks
 * a different one — "which period does 12 March fall in" — and using the first
 * to answer the second walks backwards past the contract start and returns
 * nothing, which is exactly what it did on the first attempt here.
 *
 * Separate function rather than a flag, because the two are asked by different
 * callers for different reasons and a boolean argument would leave every call
 * site reading `settlement_window(..., true)`.
 */
create or replace function public.settlement_window(
  p_frequency text, p_align text, p_starts date, p_closes_day integer, p_on date
) returns table (period_start date, period_end date, closed_on date)
language plpgsql immutable as $$
declare
  months integer := public.cycle_months(p_frequency);
  anchor integer;
  cursor_start date;
  cursor_end date;
begin
  anchor := case when p_align = 'calendar'
                 then 0
                 else (extract(month from p_starts)::integer - 1) % months end;

  cursor_start := date_trunc('month', p_on)::date;
  while ((extract(month from cursor_start)::integer - 1) % months) <> anchor loop
    cursor_start := (cursor_start - interval '1 month')::date;
  end loop;

  cursor_end := (cursor_start + (months || ' months')::interval - interval '1 day')::date;

  /* The contract's start truncates its first period rather than excluding it.
     A quarterly contract signed in February has a two-month first quarter, and
     saying so beats settling January trade nobody agreed terms for. */
  if cursor_end < p_starts then return; end if;

  period_start := greatest(cursor_start, p_starts);
  period_end := cursor_end;
  closed_on := case when p_closes_day = 0 then cursor_end
                    else least(cursor_end, (cursor_start + ((p_closes_day - 1) || ' days')::interval)::date) end;
  return next;
end $$;

grant execute on function public.settlement_window(text,text,date,integer,date) to authenticated;

/* ---- 4. Re-cutting the five who are not on a monthly contract ---------------- */

/* Folded, not deleted. Three monthly statements become one quarterly statement
 * carrying the sum of what they held, keyed to the period the contract
 * describes. The orders behind them do not move; the boundary does.
 *
 * `order_count` sums for the same reason `gross` does. The commission RATE is
 * taken as the weighted average rather than summed, which is the one figure
 * here that cannot be added up.
 */
do $$
declare
  t public.partner_settlement_terms;
  p record;
  agg record;
  new_id text;
  cur date;
  stop date;
begin
  for t in
    select * from public.partner_settlement_terms
     where frequency <> 'monthly'
       and exists (select 1 from public.settlement_statements s
                    where s.partner_id = partner_settlement_terms.partner_id)
  loop
    /* Walk from the earliest statement to the latest, one contract period at a
       time, and fold whatever monthly statements fall inside each. */
    select min(period_start), max(period_end) into cur, stop
      from public.settlement_statements where partner_id = t.partner_id;

    /* Start at the boundary of the contract's own cycle, not at the first
       month — otherwise a quarterly partner's first period would be whatever
       fragment their history happened to begin on. */
    select period_start into cur
      from public.settlement_window(t.frequency, t.align, t.starts_on, t.closes_on_day, cur);

    while cur is not null and cur <= stop loop
      select * into p from public.settlement_window(
        t.frequency, t.align, t.starts_on, t.closes_on_day, cur);
      exit when p.period_start is null;

      select
        sum(gross) gross, sum(commission) commission, sum(fees) fees,
        sum(refunds) refunds, sum(withholding) withholding, sum(net) net,
        sum(order_count) orders,
        /* Weighted by gross. The average of three rates is not the rate three
           periods of trade were charged at. */
        case when sum(gross) > 0
             then round(sum(commission_rate * gross) / sum(gross), 2) else 0 end rate,
        min(currency) currency, min(payout_currency) payout_currency,
        min(partner_name) partner_name, min(plan_id) plan_id,
        /* Paid if every month in it was paid; otherwise the least settled of
           them, because a period is not paid until all of it is. */
        case when bool_and(status = 'paid') then 'paid'
             when bool_and(status in ('paid','approved')) then 'approved'
             else 'pending' end status,
        min(fx_rate) fx, min(fx_as_of) fx_as_of, sum(payout_net) payout_net,
        count(*) folded
        into agg
        from public.settlement_statements
       where partner_id = t.partner_id
         and period_start >= p.period_start and period_end <= p.period_end;

      if agg.folded > 0 then
        new_id := format('ss-%s-%s', right(t.partner_id, 4), to_char(p.period_start, 'YYYYMM'));

        /* The lines are copied out BEFORE the old statements are deleted.
           `settlement_lines.statement_id` cascades on delete, so relying on
           the fold to carry them across silently destroyed sixty-four of them
           the first time this ran — the per-order record behind five partners'
           entire settlement history, gone to make a boundary change. A
           statement with no lines behind it is a total nobody can query, which
           is the whole thing `settlement_lines` exists to prevent. */
        create temporary table if not exists _folding
          (like public.settlement_lines including defaults) on commit drop;
        delete from _folding;
        insert into _folding
        select l.* from public.settlement_lines l
          join public.settlement_statements old_s on old_s.id = l.statement_id
         where old_s.partner_id = t.partner_id
           and old_s.period_start >= p.period_start and old_s.period_end <= p.period_end;

        delete from public.settlement_statements
         where partner_id = t.partner_id
           and period_start >= p.period_start and period_end <= p.period_end;

        insert into public.settlement_statements
          (id, partner_id, partner_name, plan_id, period, period_start, period_end,
           frequency, closed_on, due_on,
           gross, commission, commission_rate, fees, refunds, withholding, net,
           order_count, currency, payout_currency, payout_net, fx_rate, fx_as_of,
           status, sort_order)
        values
          (new_id, t.partner_id, agg.partner_name, agg.plan_id,
           /* Written the way the contract reads. "Q2 2026" is what a quarterly
              seller calls it; "Apr 2026" was what the system could produce. */
           case t.frequency
             when 'quarterly'   then 'Q' || to_char(p.period_start, 'Q') || ' ' || to_char(p.period_start, 'YYYY')
             when 'half-yearly' then 'H' || (case when extract(month from p.period_start) <= 6 then '1' else '2' end)
                                     || ' ' || to_char(p.period_start, 'YYYY')
             when 'yearly'      then to_char(p.period_start, 'YYYY')
             else to_char(p.period_start, 'Mon YYYY') end,
           p.period_start, p.period_end, t.frequency, p.closed_on,
           (p.closed_on + (t.pay_within_days || ' days')::interval)::date,
           agg.gross, agg.commission, agg.rate, agg.fees, agg.refunds, agg.withholding, agg.net,
           agg.orders, agg.currency, agg.payout_currency, agg.payout_net, agg.fx, agg.fx_as_of,
           agg.status, 0);

        /* And put back against the period that replaced them. Deferred to
           here rather than re-pointing in place, because the new statement
           does not exist until the old ones are gone — `settlement_one_per_period`
           sees to that. */
        insert into public.settlement_lines
          (id, statement_id, partner_id, order_ref, product_id, product_name, category_id,
           quantity, gross, tax, commission_rate, commission, fees, refunds, net,
           occurred_on, sort_order)
        select id, new_id, partner_id, order_ref, product_id, product_name, category_id,
               quantity, gross, tax, commission_rate, commission, fees, refunds, net,
               occurred_on, sort_order
          from _folding
        on conflict (id) do update set statement_id = excluded.statement_id;

        raise notice '% : % months folded into %', t.partner_id, agg.folded, new_id;
      end if;

      cur := (p.period_end + interval '1 day')::date;
    end loop;
  end loop;
end $$;

/* ---- 5. The runs that produced the history ----------------------------------- */

/* Six months of statements arrived from nowhere. A settlement a seller can
   query is one they can ask "which run produced this" about, and the answer
   was nothing. Backfilled from the statements themselves — one run per date a
   period closed, carrying what it settled. */
insert into public.settlement_run (id, ran_on, kind, ran_by, status, considered, settled, note)
select
  'RUN-' || to_char(closed_on, 'YYYYMMDD'),
  closed_on, 'scheduled', 'Settlement scheduler', 'complete',
  (select count(*) from public.partner_settlement_terms),
  count(*),
  'Backfilled from the statements it produced. The marketplace ran monthly before the contracted cycles were configured.'
  from public.settlement_statements
 where closed_on is not null
 group by closed_on
on conflict (id) do nothing;

update public.settlement_statements
   set run_id = 'RUN-' || to_char(closed_on, 'YYYYMMDD')
 where closed_on is not null and run_id is null;

/* ---- 6. Assertions ------------------------------------------------------------ */

do $$
declare n int; bad text;
begin
  /* Every live partner has agreed terms. This is the assertion the whole
     migration exists for — a settlement cycle nobody agreed is the state it
     found. */
  select string_agg(id, ', ') into bad from public.partners p
   where p.status = 'live'
     and not exists (select 1 from public.partner_settlement_terms t where t.partner_id = p.id);
  if bad is not null then raise exception 'live partners with no agreed cycle: %', bad; end if;

  /* All four frequencies are in use, so all four are exercised. */
  select count(distinct frequency) into n from public.partner_settlement_terms;
  if n < 4 then raise exception 'only % of the four frequencies are in use', n; end if;

  /* No statement is undated any more. */
  select count(*) into n from public.settlement_statements where period_start is null;
  if n > 0 then raise exception '% statements are still undated', n; end if;

  /* And no statement contradicts its partner's contract. A quarterly partner
     with a monthly statement is the thing section 3 was for. */
  select string_agg(s.id || ' (' || s.frequency || ' vs ' || t.frequency || ')', ', ')
    into bad
    from public.settlement_statements s
    join public.partner_settlement_terms t on t.partner_id = s.partner_id
   where s.frequency <> t.frequency;
  if bad is not null then raise exception 'statements on the wrong cycle: %', bad; end if;

  /* Periods do not overlap. Folding three months into a quarter and leaving one
     of the months behind would double-pay it, and this is what catches that. */
  select string_agg(a.id || ' overlaps ' || b.id, ', ') into bad
    from public.settlement_statements a
    join public.settlement_statements b
      on b.partner_id = a.partner_id and b.id > a.id
     and a.period_start <= b.period_end and b.period_start <= a.period_end;
  if bad is not null then raise exception 'overlapping settlement periods: %', bad; end if;

  /* Every statement still adds up after being folded. */
  select count(*) into n from public.settlement_statements
   where abs(net - (gross - commission - fees - withholding - refunds)) > 0.02;
  if n > 0 then raise exception '% folded statements no longer add up', n; end if;

  /* Due dates follow the contract rather than a default. */
  select count(*) into n
    from public.settlement_statements s
    join public.partner_settlement_terms t on t.partner_id = s.partner_id
   where s.due_on <> (s.closed_on + (t.pay_within_days || ' days')::interval)::date;
  if n > 0 then raise exception '% statements are due on a date the contract does not say', n; end if;

  /* No statement lost the lines behind it. This is the assertion that was
     missing, and its absence is why a boundary change quietly destroyed
     sixty-four per-order records: every check here was about the totals, and
     the totals were fine. A statement whose lines are gone still adds up. */
  select string_agg(s.id, ', ') into bad
    from public.settlement_statements s
   where not exists (select 1 from public.settlement_lines l where l.statement_id = s.id)
     and exists (select 1 from public.settlement_lines l2 where l2.partner_id = s.partner_id);
  if bad is not null then
    raise exception 'statements whose lines went missing: %', bad;
  end if;

  /* And every statement that has lines still reconciles to them. */
  select string_agg(x.id, ', ') into bad from (
    select s.id from public.settlement_statements s
      join public.settlement_lines l on l.statement_id = s.id
     group by s.id, s.gross
    having abs(s.gross - sum(l.gross)) > 0.02
  ) x;
  if bad is not null then
    raise exception 'statements that no longer reconcile to their lines: %', bad;
  end if;

  /* Every statement came from a run. */
  select count(*) into n from public.settlement_statements where run_id is null;
  if n > 0 then raise exception '% statements have no run behind them', n; end if;

  raise notice 'terms: %; statements: %; runs: %',
    (select count(*) from public.partner_settlement_terms),
    (select count(*) from public.settlement_statements),
    (select count(*) from public.settlement_run);
end $$;
