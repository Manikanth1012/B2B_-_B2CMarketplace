/* Two things the first run of the cycle arithmetic got wrong.
 *
 * ONE. "Closes on the 25th" closed on the 25th of the wrong month.
 *
 * `closes_on_day` counts from the period's START. On a monthly cycle that is
 * indistinguishable from counting to the 25th of the month, which is why it
 * looked right. On Vertex Endpoint's yearly cycle — 1 January to 31 December,
 * closing on the 25th — it produced 25 January 2026: a period closing eleven
 * months before it ends, and a payment due in March against trade that had not
 * happened yet.
 *
 * The clause means the 25th of the month the period ends in. Every contract
 * that says it means "raise the invoice a few days before the books close",
 * and books close at the end of the period, not the start.
 *
 * TWO. A period that has not closed is not a settlement.
 *
 * Folding the monthly history onto quarterly and half-yearly boundaries
 * produced statements for periods that are still running — Q3 2026 closes on
 * 30 September and it is 7 August. They came out marked `pending` with a due
 * date, which reads as "we owe you this on 30 October" for a quarter that is
 * two-thirds unwritten. Two more months of trade will land in it, and a refund
 * next week will change it.
 *
 * It is still worth showing. Every marketplace shows a seller what has accrued
 * in the period they are in, and hiding it would mean a quarterly seller sees
 * nothing between July and October. So it is shown as what it is: `open`. Open
 * statements are what a run turns into settlements when the period closes, and
 * until then nothing is owed on them.
 */

/* ---- 1. The 25th of the month it ends in ------------------------------------- */

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
  if cursor_end < p_starts then return; end if;

  period_start := greatest(cursor_start, p_starts);
  period_end := cursor_end;
  /* The Nth day of the month the period ENDS in. Counting from the start was
     invisible on a monthly cycle and eleven months wrong on a yearly one. */
  closed_on := case when p_closes_day = 0 then cursor_end
                    else least(cursor_end,
                               (date_trunc('month', cursor_end)::date + (p_closes_day - 1))) end;
  return next;
end $$;

create or replace function public.settlement_period(
  p_frequency text, p_align text, p_starts date, p_closes_day integer, p_on date
) returns table (period_start date, period_end date, closed_on date)
language plpgsql immutable as $$
declare w record;
begin
  if p_on < p_starts then return; end if;

  /* The period p_on falls in, and then a step back if it has not closed yet.
     Expressed in terms of `settlement_window` rather than repeating the walk —
     two copies of this arithmetic is how the two of them drifted apart in the
     first place. */
  select * into w from public.settlement_window(p_frequency, p_align, p_starts, p_closes_day, p_on);
  if w.period_start is null then return; end if;

  if w.closed_on > p_on then
    select * into w from public.settlement_window(
      p_frequency, p_align, p_starts, p_closes_day,
      (w.period_start - interval '1 day')::date);
    if w.period_start is null then return; end if;
  end if;

  period_start := w.period_start;
  period_end := w.period_end;
  closed_on := w.closed_on;
  return next;
end $$;

/* ---- 2. An open period says so ----------------------------------------------- */

alter table public.settlement_statements
  drop constraint if exists settlement_statements_status_check;
alter table public.settlement_statements
  add constraint settlement_statements_status_check
  check (status in ('open', 'pending', 'approved', 'paid', 'disputed', 'void'));

comment on column public.settlement_statements.status is
  'open — the period is still running and this is what has accrued so far; '
  'nothing is owed. pending — closed, waiting on the desk. approved — signed '
  'off, not yet paid. paid — money has moved.';

/* An open statement is not owed, so it does not carry a promise to pay. The
   date the contract WOULD make it due stays, because "closes 30 Sep, payable
   30 Oct" is the useful thing to tell a seller looking at an open period. */
update public.settlement_statements
   set status = 'open'
 where closed_on > current_date and status in ('pending', 'approved');

/* And nothing that has not closed may claim to have been paid. */
create or replace function public.guard_statement_period()
returns trigger language plpgsql as $$
begin
  if new.closed_on is not null and new.closed_on > current_date
     and new.status not in ('open', 'void') then
    raise exception
      '% covers % to %, which has not closed yet. A period still running is an accrual, not a settlement — it is "open" until % .',
      new.id, new.period_start, new.period_end, new.closed_on;
  end if;
  if new.status = 'open' and new.closed_on <= current_date then
    raise exception
      '% closed on % and is still marked open. A closed period is owed or it is disputed; it is not pending arrival.',
      new.id, new.closed_on;
  end if;
  return new;
end $$;

drop trigger if exists z_guard_statement_period on public.settlement_statements;
create trigger z_guard_statement_period
  before insert or update on public.settlement_statements
  for each row execute function public.guard_statement_period();

/* ---- 3. Vertex Endpoint's year, recut ---------------------------------------- */

/* Their 2026 statement was dated by the broken arithmetic — closed 25 January,
   due 26 March, against a year that runs to 31 December. Re-dated, and it
   becomes what it always was: an open period with ten months left in it. */
update public.settlement_statements s set
  closed_on = fix.closed_on,
  due_on = (fix.closed_on + (fix.pay_within_days || ' days')::interval)::date,
  status = case when fix.closed_on > current_date then 'open' else s.status end
 from (
   select st.id, w.closed_on, t.pay_within_days
     from public.settlement_statements st
     join public.partner_settlement_terms t on t.partner_id = st.partner_id
     cross join lateral public.settlement_window(
       t.frequency, t.align, t.starts_on, t.closes_on_day, st.period_start) w
    where st.closed_on is distinct from w.closed_on
 ) fix
where fix.id = s.id;

/* A run that produced nothing but a statement nobody is owed is not a run. The
   backfilled runs were keyed on the close dates, and two of those dates moved. */
delete from public.settlement_run r
 where not exists (select 1 from public.settlement_statements s where s.run_id = r.id);

insert into public.settlement_run (id, ran_on, kind, ran_by, status, considered, settled, note)
select 'RUN-' || to_char(closed_on, 'YYYYMMDD'), closed_on, 'scheduled',
       'Settlement scheduler', 'complete',
       (select count(*) from public.partner_settlement_terms), count(*),
       'Backfilled from the statements it produced.'
  from public.settlement_statements
 where closed_on is not null and closed_on <= current_date
 group by closed_on
on conflict (id) do nothing;

update public.settlement_statements
   set run_id = case when closed_on <= current_date
                     then 'RUN-' || to_char(closed_on, 'YYYYMMDD') end
 where closed_on is not null;

/* ---- 4. Assertions ------------------------------------------------------------ */

do $$
declare n int; bad text; w record;
begin
  /* The 25th, of the right month. Checked on the frequency that exposed it. */
  select * into w from public.settlement_window('yearly', 'calendar', date '2026-01-01', 25, date '2026-08-07');
  if w.closed_on <> date '2026-12-25' then
    raise exception 'a yearly cycle closing on the 25th closes on % rather than 25 December', w.closed_on;
  end if;
  /* And is still right on the frequency that hid it. */
  select * into w from public.settlement_window('monthly', 'calendar', date '2026-01-01', 25, date '2026-08-07');
  if w.closed_on <> date '2026-08-25' then
    raise exception 'a monthly cycle closing on the 25th closes on %', w.closed_on;
  end if;
  /* A close day past the end of a short month lands on the end of it. */
  select * into w from public.settlement_window('monthly', 'calendar', date '2026-01-01', 28, date '2027-02-10');
  if w.closed_on <> date '2027-02-28' then
    raise exception 'closing on the 28th of February 2027 landed on %', w.closed_on;
  end if;

  /* `settlement_period` still answers its own question after being rebuilt on
     top of `settlement_window`. */
  select * into w from public.settlement_period('quarterly', 'calendar', date '2026-01-01', 0, date '2026-08-07');
  if w.period_start <> date '2026-04-01' or w.closed_on <> date '2026-06-30' then
    raise exception 'the last closed quarter on 7 August is % to %, closed %',
      w.period_start, w.period_end, w.closed_on;
  end if;
  /* Anniversary alignment is not calendar alignment. February start, so the
     quarter running on 7 August is May–July, closed 31 July. */
  select * into w from public.settlement_period('quarterly', 'anniversary', date '2026-02-01', 0, date '2026-08-07');
  if w.period_start <> date '2026-05-01' or w.closed_on <> date '2026-07-31' then
    raise exception 'the anniversary quarter is % to %', w.period_start, w.period_end;
  end if;

  /* Nothing claims to be settled for a period that is still running. */
  select string_agg(id || ' (' || status || ', closes ' || closed_on || ')', ', ') into bad
    from public.settlement_statements
   where closed_on > current_date and status not in ('open', 'void');
  if bad is not null then raise exception 'settled before the period closed: %', bad; end if;

  /* And nothing closed is still marked open. */
  select count(*) into n from public.settlement_statements
   where closed_on <= current_date and status = 'open';
  if n > 0 then raise exception '% closed periods are still marked open', n; end if;

  /* The guard bites, rather than being a comment about intent. */
  begin
    update public.settlement_statements set status = 'paid'
     where closed_on > current_date and status = 'open';
    raise exception 'an open period was marked paid';
  exception when others then
    if sqlerrm not like '%has not closed yet%' then
      raise exception 'marking an open period paid failed on % rather than the guard', sqlerrm;
    end if;
  end;

  /* An open statement has no run, and every closed one does. */
  select count(*) into n from public.settlement_statements
   where (closed_on <= current_date) <> (run_id is not null);
  if n > 0 then raise exception '% statements disagree with their run about whether they closed', n; end if;

  raise notice 'open: %; closed: %; runs: %',
    (select count(*) from public.settlement_statements where status = 'open'),
    (select count(*) from public.settlement_statements where status <> 'open'),
    (select count(*) from public.settlement_run);
end $$;
