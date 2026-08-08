/* An assessment that flattered an account already over its limit.
 *
 * The limits went in and SmartBuild came out 772,746 rupees over theirs on the
 * day it was set. My first instinct was that the sizing rule was wrong. It was
 * not. The account really is over-extended, and the review I had written for it
 * said the opposite:
 *
 *     band: low
 *     "Trades steadily and pays inside terms."
 *
 * What the book actually says about ENT-2007:
 *
 *   invoiced over twelve months   ₹3,975,272
 *   owed right now                ₹1,398,596   including INV-2026-0781, overdue
 *   approved and not yet invoiced ₹1,041,150
 *
 * So ₹2.4m of live exposure against ₹4m of annual trade — more than seven months
 * of their own turnover outstanding at once, with an invoice past due inside it.
 * That is precisely the account a credit review exists to find, and mine had
 * filed it as the safest name on the book because it is the busiest.
 *
 * TWO THINGS WERE WRONG AND ONLY ONE WAS THE NUMBER
 *
 * The band and the rationale were written from an impression of the account
 * rather than from its ledger. That is the more embarrassing half: a limit can be
 * re-sized in a line, but a review that reads the evidence backwards will size
 * the next one wrongly too.
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not raise the limit until the red goes away. An account over its limit
 * is a fact about the account, and the control working is what it looks like. The
 * limit is re-sized to three months of ACTUAL trade rather than of a stated
 * budget the account has never come close to, which makes it smaller, not
 * larger — and the requisition hold now bites on their next purchase, which is
 * the point.
 *
 * What it does add is the rule that being over is never silent: an account past
 * its limit must carry an assessment that says so, and the assertion below
 * refuses the alternative.
 */

/* ---- 1. Re-assess, from the ledger this time ---------------------------------- */

do $$
declare v_trade numeric; v_owed numeric; v_committed numeric; v_limit numeric; e record;
begin
  select coalesce(sum(i.total), 0) into v_trade
    from public.enterprise_invoices i
   where i.account_id = 'ENT-2007' and i.issued >= current_date - interval '12 months';

  select * into e from public.account_exposure('ENT-2007');
  v_owed := e.owed; v_committed := e.committed;

  /* Three months of what they actually buy, rounded to the nearest ten thousand.
     Their stated budget is ₹10m and they have invoiced ₹4m against it, so sizing
     off the budget would have granted two and a half times the credit their
     trade supports. */
  v_limit := round(v_trade / 4, -4);

  update public.credit_assessment set
    band      = 'high',
    evidence  = format(
      'Twelve months invoiced: %s INR across six invoices. Currently owed %s including '
      'INV-2026-0781, past due. Approved and not yet invoiced: %s. Live exposure is %s, '
      'which is more than seven months of their own turnover outstanding at once.',
      round(v_trade), round(v_owed), round(v_committed), round(v_owed + v_committed)),
    rationale = format(
      'The busiest account on the book and the most exposed. Sized at three months of actual '
      'trade rather than of a stated budget they have never reached — %s against a limit that '
      'was %s. They are over it by %s today and the hold applies to their next requisition; '
      'that is the control working rather than a fault. Reviewed again in three months, or '
      'sooner if the overdue invoice is not settled.',
      round(v_limit), 1667000, round(v_owed + v_committed - v_limit)),
    limit_granted = v_limit,
    next_review   = current_date + interval '3 months'
   where account_id = 'ENT-2007' and superseded_by is null;

  update public.enterprise_billing set
    credit_limit      = v_limit,
    credit_review_due = current_date + interval '3 months'
   where account_id = 'ENT-2007';

  raise notice 'ENT-2007 re-assessed: limit %, exposure %', v_limit, v_owed + v_committed;
end $$;

/* ---- 2. Being over is never silent -------------------------------------------- */

/* A view rather than a column, because "over the limit" is a fact about two
 * moving numbers and storing it means storing something that goes stale between
 * an invoice and a payment.
 */
create or replace view public.account_credit_position as
  select b.account_id,
         a.company,
         b.currency,
         b.credit_limit,
         b.deposit_held,
         e.owed,
         e.committed,
         e.total as exposure,
         round(b.credit_limit - e.total, 2) as headroom,
         (e.total > b.credit_limit) as over_limit,
         c.band,
         c.next_review
    from public.enterprise_billing b
    join public.enterprise_accounts a on a.id = b.account_id
    left join public.credit_assessment c
           on c.account_id = b.account_id and c.superseded_by is null
    cross join lateral public.account_exposure(b.account_id) e;

alter view public.account_credit_position set (security_invoker = on);
grant select on public.account_credit_position to authenticated;

/* ---- 3. What has to be true ---------------------------------------------------- */

do $$
declare bad text; n int;
begin
  /* ASSERT-1: nobody is over their limit without an assessment that says so.
     This is the check the flattering review would have failed. */
  select string_agg(p.account_id || ' (' || p.company || ', ' || p.band || ')', ', ') into bad
    from public.account_credit_position p
   where p.over_limit
     and (p.band not in ('high', 'refused')
          or not exists (select 1 from public.credit_assessment c
                          where c.account_id = p.account_id and c.superseded_by is null
                            and (c.rationale ilike '%over it%' or c.rationale ilike '%over their%'
                                 or c.evidence ilike '%exposure%')));
  if bad is not null then
    raise exception 'accounts over their limit with a review that does not say so: %', bad;
  end if;

  /* ASSERT-2: and the case exists, so the screen and the hold are drawn against
     something real. An assertion that passes because nothing is over is an
     assertion about an empty set. */
  select count(*) into n from public.account_credit_position where over_limit;
  if n = 0 then
    raise exception 'no account is over its limit, so the hold and the warning are unexercised';
  end if;

  /* ASSERT-3: a limit is still never below what a review granted. */
  select string_agg(b.account_id, ', ') into bad
    from public.enterprise_billing b
    join public.credit_assessment c on c.account_id = b.account_id and c.superseded_by is null
   where b.credit_limit is distinct from c.limit_granted;
  if bad is not null then raise exception 'the limit applied is not the limit granted: %', bad; end if;

  /* ASSERT-4: nobody was re-banded upwards to make a red figure disappear. The
     account that is over is the one carrying the worst band. */
  select string_agg(p.account_id, ', ') into bad
    from public.account_credit_position p
   where p.over_limit and p.band = 'low';
  if bad is not null then raise exception 'an over-limit account is banded low: %', bad; end if;

  raise notice 'accounts over their limit: %, and each says so',
    (select count(*) from public.account_credit_position where over_limit);
end $$;
