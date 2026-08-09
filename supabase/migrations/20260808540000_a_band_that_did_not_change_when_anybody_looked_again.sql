/* A band that did not change when anybody looked again.
 *
 * `credit.ts` tells the operator, on the screen, what a band means:
 *
 *     high   Held at the limit and reviewed quarterly. Security may be required.
 *     medium Buys on terms and is watched.
 *     low    Buys on terms without a hold. Reviewed annually.
 *
 * The seed gave every buyer `reviewed_on + 1 year` and every seller
 * `reviewed_on + 6 months`, whatever the band. So Cadence Health is high risk,
 * new, unfiled and holding a deposit — and nobody is due to look at it again
 * until August 2027. TrackWise is seven months old with eight disputes and is
 * on the same cadence as Kestrel, who have traded cleanly for years.
 *
 * The band decided how much they could have and then decided nothing else. A
 * risk rating that does not change what happens next is a label.
 *
 * ENT-2007 is the exception that shows it: it reads 92 days, and only because
 * `20260808520000` re-assessed it by hand and typed a quarter in. One row is
 * right because somebody remembered, which is not a rule.
 *
 * So the cadence moves into the database beside the band, as one function both
 * sides read, and a trigger stamps it. The screen keeps its sentence and the
 * sentence becomes true.
 *
 * WHY A TRIGGER RATHER THAN A COLUMN DEFAULT. `next_review` depends on two
 * other columns of the same row, and a default cannot see them. Doing it in the
 * client instead would put the cadence in whichever screen happened to write
 * the review — and there will be more than one screen.
 */

/* The rule, in one place. Quarterly for anything that worries us, six months
 * for the middle, a year for the ones that have earned it.
 *
 * The seller side is the same shape for a reason: a seller's exposure is their
 * refunds and chargebacks, and those move faster than a buyer's balance sheet,
 * not slower. There is no case for looking at a risky seller less often than a
 * risky buyer.
 */
create or replace function public.credit_review_months(p_band text)
returns int language sql immutable as $$
  select case p_band
    when 'refused' then 3
    when 'high'    then 3
    when 'medium'  then 6
    else 12
  end;
$$;

grant execute on function public.credit_review_months(text) to authenticated;

create or replace function public.stamp_credit_review_due()
returns trigger language plpgsql as $$
begin
  new.next_review := new.reviewed_on
                   + make_interval(months => public.credit_review_months(new.band));
  return new;
end $$;

/* `z_` so it sorts last among BEFORE triggers. Postgres runs them in name
   order, and this has to see the band whatever else adjusted it. */
drop trigger if exists z_stamp_credit_review_due on public.credit_assessment;
create trigger z_stamp_credit_review_due
  before insert or update of band, reviewed_on on public.credit_assessment
  for each row execute function public.stamp_credit_review_due();

/* ---- The file as it stands ------------------------------------------------------ */

/* Restated rather than left with a note saying the next one will be right. A
   review date is the date somebody will actually be asked to look; leaving the
   wrong ones in place means nobody looks at Cadence Health for a year. */
update public.credit_assessment
   set next_review = reviewed_on
                   + make_interval(months => public.credit_review_months(band))
 where superseded_by is null;

/* And the buyer's billing row carries the same date, because that is the copy
   the account's own screens read. Two dates for one review is how they drift. */
update public.enterprise_billing b
   set credit_review_due = c.next_review
  from public.credit_assessment c
 where c.account_id = b.account_id
   and c.superseded_by is null
   and b.credit_review_due is distinct from c.next_review;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text; n int; v_due date;
begin
  /* ASSERT-1: every live review is on its band's cadence, to the day. */
  select string_agg(format('%s (%s, %s)', id, band, next_review), ', ') into bad
    from public.credit_assessment
   where superseded_by is null
     and next_review is distinct from
         (reviewed_on + make_interval(months => public.credit_review_months(band)))::date;
  if bad is not null then
    raise exception 'reviews that are not on their band''s cadence: %', bad;
  end if;

  /* ASSERT-2: and the cadence actually separates the bands — no high-risk party
     is looked at less often than a low-risk one. This is the check that would
     have failed before this migration, on both sides at once. */
  select count(*) into n
    from public.credit_assessment h
    join public.credit_assessment l on l.superseded_by is null and l.band = 'low'
   where h.superseded_by is null and h.band = 'high'
     and (h.next_review - h.reviewed_on) >= (l.next_review - l.reviewed_on);
  if n <> 0 then
    raise exception '% high-risk reviews are no sooner than a low-risk one', n;
  end if;

  /* ASSERT-3: the account with a deposit and no filed accounts is now inside a
     quarter, which is the case that made this worth doing. */
  select next_review into v_due from public.credit_assessment
   where account_id = 'ENT-2015' and superseded_by is null;
  if v_due is null or v_due > current_date + 100 then
    raise exception 'ENT-2015 is high risk, holds a deposit, and is next reviewed on %', v_due;
  end if;

  /* ASSERT-4: the two copies of the date agree. */
  select string_agg(b.account_id, ', ') into bad
    from public.enterprise_billing b
    join public.credit_assessment c on c.account_id = b.account_id and c.superseded_by is null
   where b.credit_review_due is distinct from c.next_review;
  if bad is not null then
    raise exception 'the billing row and the assessment disagree on when to look again: %', bad;
  end if;

  /* ASSERT-5: and the trigger is what keeps it that way, rather than this
     migration having tidied up once. Written and read back, then put back. */
  update public.credit_assessment set reviewed_on = reviewed_on where id = 'CRA-2015-01';
  select next_review into v_due from public.credit_assessment where id = 'CRA-2015-01';
  if v_due is distinct from (date '2026-08-08' + interval '3 months')::date then
    raise exception 'the trigger did not stamp the review date: %', v_due;
  end if;
end $$;
