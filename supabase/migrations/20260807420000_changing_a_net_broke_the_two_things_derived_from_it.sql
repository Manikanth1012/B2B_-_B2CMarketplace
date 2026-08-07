/* Changing a net broke the two things derived from it.
 *
 * Withholding was applied to every statement not yet paid, and the settlement
 * suite caught what that did:
 *
 *   `payout_net` is `net × fx_rate`, frozen when the period closed so that a
 *   reprint next year matches what was paid. Twenty statements now had a net
 *   that no longer multiplied out to their payout — the exact drift
 *   `payoutAgrees` exists to catch, and it caught it.
 *
 *   The general ledger posts `settle.approved` against what the settlement
 *   register approved. Changing the net of an approved statement leaves the
 *   ledger claiming a payable that the register no longer says.
 *
 * And a third, from re-cutting five partners onto their contracted cycles two
 * migrations earlier: the ledger's postings reference statement ids that were
 * deleted in the fold, and February 2026 reconciles out by 41,467.73 because
 * three months of postings now have a quarterly statement behind them that the
 * reconciliation cannot match to a month.
 *
 * WHAT IS CORRECTED AND WHAT IS NOT.
 *
 * An APPROVED statement has been signed off by the desk and posted to the
 * books. A deduction configured today does not reach back through an approval;
 * it applies to what has not yet been approved for payment, which is what a
 * finance desk would do on the day. So withholding comes off the approved
 * statements and stays on the pending and open ones.
 *
 * The payout leg is recomputed wherever the net moved, because it is derived
 * and a derived figure that disagrees with its source is not frozen, it is
 * wrong.
 *
 * The postings are rebuilt from the statements as they now stand. A ledger that
 * gets rewritten is not a ledger — but postings pointing at rows that no longer
 * exist are not a ledger either, and the fold made them that.
 */

/* ---- 1. Withholding stops at the approval ------------------------------------ */

update public.settlement_statements set
  withholding = 0,
  withholding_rate = 0,
  withholding_detail = '[]'::jsonb,
  net = round(gross - commission - fees - refunds, 2)
 where status = 'approved' and withholding > 0;

/* The certificates built from those quarters have to lose the same amounts, or
   a seller claims relief against a deduction that was never taken. Rebuilt
   from what the statements now say rather than adjusted. */
delete from public.withholding_certificate;

insert into public.withholding_certificate
  (id, partner_id, market, rule_id, form, period_start, period_end,
   amount, currency, status, note)
select
  format('WHT-%s-%s-%s', right(x.partner_id, 4), to_char(x.q, 'YYYY"Q"Q'), right(x.rule_id, 4)),
  x.partner_id, x.market, x.rule_id,
  case when x.market = 'IN' and x.rule_id = 'WHT-IN-194O' then 'Form 16A'
       when x.market = 'IN' then 'GSTR-8 statement'
       when x.market = 'KE' then 'KRA WHT certificate'
       else 'Statement' end,
  x.q, (x.q + interval '3 months' - interval '1 day')::date,
  x.amount, 'USD',
  case when (x.q + interval '3 months')::date > current_date then 'accruing' else 'filed' end,
  'Built from the settlement statements falling in the quarter.'
from (
  select s.partner_id, p.market, (d.value ->> 'rule_id') as rule_id,
         date_trunc('quarter', s.closed_on)::date as q,
         sum((d.value ->> 'amount')::numeric) as amount
    from public.settlement_statements s
    join public.partners p on p.id = s.partner_id
    cross join lateral jsonb_array_elements(s.withholding_detail) d
   where s.closed_on is not null
   group by s.partner_id, p.market, d.value ->> 'rule_id', date_trunc('quarter', s.closed_on)
) x
where x.amount > 0;

/* ---- 2. The payout leg follows the net --------------------------------------- */

/* `payout_net` is derived and frozen, in that order. The fold produced its
   statements by summing monthly payouts struck at three different rates and
   taking the lowest of those rates as the statement's own, so those never
   multiplied out either. Both are recomputed at the rate in force on the day
   the period closed, which is the rule this build has applied since currencies
   were added. */
update public.settlement_statements s set
  fx_rate = fix.rate,
  fx_as_of = fix.as_of,
  payout_net = round(s.net * fix.rate, 2)
 from (
   select st.id, f.rate, f.as_of
     from public.settlement_statements st
     cross join lateral (
       select r.rate, r.as_of from public.fx_rates r
        where r.base = st.currency and r.quote = st.payout_currency
          and r.as_of <= coalesce(st.closed_on, st.period_end)
        order by r.as_of desc limit 1
     ) f
    where st.payout_currency <> st.currency
      and abs(st.payout_net - round(st.net * st.fx_rate, 2)) > 0.01
 ) fix
where fix.id = s.id;

/* Same currency both sides: the rate is 1 and the payout is the net. Written
   as 1 rather than left null so every statement reads the same way instead of
   half of them being a case to notice. */
update public.settlement_statements set
  fx_rate = 1, payout_net = net,
  fx_as_of = coalesce(fx_as_of, closed_on, period_end)
 where payout_currency = currency
   and (payout_net is distinct from net or fx_rate is distinct from 1);

/* ---- 3. The ledger against the register it was built from -------------------- */

/* Order matters here, and it bit: a posting was corrected into September
   before the row that no longer belonged in the books at all was removed, and
   the foreign key refused a period nothing had opened.

   Stale first, then no-longer-approved, then open the periods, then post, then
   correct what survived. */

/* Every `settle.approved` posting whose statement no longer exists. The fold
   deleted the monthly statements and left their postings behind pointing at
   nothing — which is why February reconciles out by forty-one thousand. */
delete from public.gl_postings p
 where p.charge_id = 'settle.approved'
   and not exists (select 1 from public.settlement_statements s where s.id = p.ref);

/* A posting for a statement that is no longer approved. A payable the register
   does not claim is a payable the books should not carry. */
delete from public.gl_postings p
 using public.settlement_statements s
 where p.charge_id = 'settle.approved' and p.ref = s.id
   and s.status not in ('approved', 'paid');

/* The GL period a posting sits in has to exist, or the foreign key refuses the
   posting — which is the right refusal and the wrong moment to meet it. */
insert into public.gl_periods (id, label, status)
select distinct to_char(s.closed_on, 'YYYY-MM'), to_char(s.closed_on, 'Mon YYYY'), 'open'
  from public.settlement_statements s
 where s.closed_on is not null and s.status in ('approved','paid')
   and not exists (select 1 from public.gl_periods g where g.id = to_char(s.closed_on, 'YYYY-MM'))
on conflict (id) do nothing;

/* One posting per statement the register now says was approved, in the period
   it closed in. The GL period is a month and a quarterly statement closes in
   one of them — the payable is recognised when the statement is approved, not
   spread back across the quarter it covers. */
insert into public.gl_postings
  (id, charge_id, amount, dr, cr, ref, when_date, period, source, memo, partner_id)
select
  s.id || '-AP', 'settle.approved', s.net, '2010', '2020', s.id,
  s.closed_on, to_char(s.closed_on, 'YYYY-MM'), 'automatic',
  format('%s settlement for %s', s.partner_name, s.period), s.partner_id
  from public.settlement_statements s
 where s.status in ('approved', 'paid')
   and s.closed_on is not null
   and not exists (select 1 from public.gl_postings p
                    where p.charge_id = 'settle.approved' and p.ref = s.id)
on conflict (id) do nothing;

/* An amount, a date or a period that moved on a statement still holding its
   posting. The folded statements kept the id of the first month they swallowed
   — `ss-1007-202602` was February's and is now Q1's — so their postings
   survived pointing at a real statement with February's period on them,
   against a period that now closes at the end of April. */
update public.gl_postings p set
  amount = s.net,
  when_date = s.closed_on,
  period = to_char(s.closed_on, 'YYYY-MM'),
  memo = format('%s settlement for %s', s.partner_name, s.period)
  from public.settlement_statements s
 where p.charge_id = 'settle.approved' and p.ref = s.id
   and (p.amount <> s.net
     or p.when_date is distinct from s.closed_on
     or p.period is distinct from to_char(s.closed_on, 'YYYY-MM'));

/* ---- 4. Assertions ------------------------------------------------------------ */

do $$
declare n int; bad text;
begin
  /* Nothing approved or paid carries a deduction that was configured after it
     was signed off. */
  select count(*) into n from public.settlement_statements
   where status in ('approved', 'paid') and withholding <> 0;
  if n > 0 then raise exception '% signed-off statements were rewritten', n; end if;

  /* And the pending ones still do — otherwise the whole thing was reverted. */
  select count(*) into n from public.settlement_statements
   where status = 'pending' and withholding > 0;
  if n = 0 then raise exception 'nothing pending is deducted from any more'; end if;

  /* Every statement reproduces its own conversion. This is `payoutAgrees` in
     SQL, and it is the check the settlement suite runs against the same rows. */
  select string_agg(id || ': ' || net || ' × ' || fx_rate || ' ≠ ' || payout_net, ', ')
    into bad from public.settlement_statements
   where abs(payout_net - round(net * fx_rate, 2)) > 0.01;
  if bad is not null then raise exception 'statements that no longer reproduce their conversion: %', bad; end if;

  /* Every statement still adds up. */
  select count(*) into n from public.settlement_statements
   where abs(net - (gross - commission - fees - withholding - refunds)) > 0.02;
  if n > 0 then raise exception '% statements do not add up', n; end if;

  /* No posting points at a statement that is not there. */
  select count(*) into n from public.gl_postings p
   where p.charge_id = 'settle.approved'
     and not exists (select 1 from public.settlement_statements s where s.id = p.ref);
  if n > 0 then raise exception '% settlement postings reference nothing', n; end if;

  /* And nothing approved is missing from the books. */
  select string_agg(s.id, ', ') into bad from public.settlement_statements s
   where s.status in ('approved','paid')
     and not exists (select 1 from public.gl_postings p
                      where p.charge_id = 'settle.approved' and p.ref = s.id);
  if bad is not null then raise exception 'approved settlements never posted: %', bad; end if;

  /* The ledger and the register agree, month by month — the reconciliation the
     integration suite runs, done here so the migration cannot leave it broken. */
  select string_agg(x.period || ' out by ' || x.diff, ', ') into bad from (
    select r.period, round(r.owed - r.posted, 2) as diff from (
      select coalesce(a.period, b.period) as period,
             coalesce(a.owed, 0) as owed, coalesce(b.posted, 0) as posted
        from (select to_char(closed_on, 'YYYY-MM') as period, sum(net) as owed
                from public.settlement_statements
               where status in ('approved','paid') and closed_on is not null
               group by 1) a
        full join (select period, sum(amount) as posted
                     from public.gl_postings where charge_id = 'settle.approved'
                    group by 1) b on b.period = a.period
    ) r
     where abs(r.owed - r.posted) > 0.02
  ) x;
  if bad is not null then raise exception 'the ledger and the register disagree: %', bad; end if;

  raise notice 'deducted from % pending statements; postings: %; certificates: %',
    (select count(*) from public.settlement_statements where withholding > 0),
    (select count(*) from public.gl_postings where charge_id = 'settle.approved'),
    (select count(*) from public.withholding_certificate);
end $$;
