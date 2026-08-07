/* Three things wrong with the run, found by looking at what it would actually do.
 *
 * ONE. A sale could not exist until it had been settled.
 *
 * `settlement_lines.statement_id` is NOT NULL. Every line in the database is a
 * child of a statement, which means a sale only becomes a line at the moment it
 * is settled — and `run_settlements` builds its statements from lines where
 * `statement_id is null`, a branch that could never match a row.
 *
 * That is backwards. A line is what the marketplace recorded when the order
 * happened; the statement is what a run made of the lines afterwards. The
 * column is nullable now, and null means "sold, not yet settled" — which is
 * the state every sale is in between the order and the run.
 *
 * TWO. "Next close" was the current close.
 *
 * `next_settlement_close` found the last period to have closed, added a cycle
 * to its end date, and asked which period had closed by then — which for a
 * half-yearly partner lands one day before the next close and gets told about
 * the previous one. Aegis Assurance's next settlement read 30 June, a date six
 * weeks in the past. Rebuilt on `settlement_window`, which answers "which
 * period is this date in" directly.
 *
 * THREE. There was no trade to settle.
 *
 * Every closed period is settled, so a run today correctly does nothing — but
 * every partner's ledger also stopped on 31 July, and a marketplace with no
 * sales in the current month is not one anybody can look at. August's trade is
 * seeded as unsettled lines: real dates up to today, nothing in the future,
 * and no statement attached, because none has been run.
 */

/* ---- 1. A line exists before it is settled ----------------------------------- */

alter table public.settlement_lines
  alter column statement_id drop not null;

comment on column public.settlement_lines.statement_id is
  'The statement that settled this line, or null if it has not been settled '
  'yet. A sale is recorded when the order happens; the statement is what a run '
  'makes of the lines afterwards.';

/* A line that has been settled cannot quietly detach itself. Unsettling a sale
   after it has been paid is how a partner gets paid for it twice. */
create or replace function public.guard_settled_line()
returns trigger language plpgsql as $$
begin
  if old.statement_id is not null and new.statement_id is null then
    raise exception
      '% was settled on %. A line cannot be unsettled — reverse it with a credit rather than detaching it.',
      old.id, old.statement_id;
  end if;
  return new;
end $$;

drop trigger if exists z_guard_settled_line on public.settlement_lines;
create trigger z_guard_settled_line
  before update on public.settlement_lines
  for each row execute function public.guard_settled_line();

/* ---- 2. The next close, as opposed to the last one --------------------------- */

create or replace function public.next_settlement_close(p_partner text, p_on date default current_date)
returns date language plpgsql stable as $$
declare
  t public.partner_settlement_terms;
  w record;
begin
  select * into t from public.partner_settlement_terms where partner_id = p_partner;
  if t.partner_id is null then return null; end if;

  /* The period this date falls in. If it has not closed yet, that close IS the
     next one — which is the common case and the one the old implementation got
     wrong by starting from the last period to have closed. */
  select * into w from public.settlement_window(
    t.frequency, t.align, t.starts_on, t.closes_on_day, greatest(p_on, t.starts_on));
  if w.period_start is null then return null; end if;
  if w.closed_on > p_on then return w.closed_on; end if;

  /* It has closed, so the next one is the period after it. */
  select * into w from public.settlement_window(
    t.frequency, t.align, t.starts_on, t.closes_on_day, (w.period_end + 1)::date);
  return w.closed_on;
end $$;

/* ---- 3. August ---------------------------------------------------------------- */

/* Trade to date, at each partner's own run rate. Derived from what they did in
 * their last settled period rather than invented: a partner who settled $3,136
 * across July is doing about $101 a day, and seven days of August is what that
 * comes to. Nothing is dated after today — a marketplace that has already
 * recorded next week's sales is one nobody should trust with a number.
 */
do $$
declare
  t public.partner_settlement_terms;
  p public.partners;
  last_stmt record;
  daily numeric;
  prods text[];
  names text[];
  cats  text[];
  d date;
  seq integer := 0;
  g numeric; c numeric; f numeric; pick integer;
  rate numeric;
begin
  for t in select * from public.partner_settlement_terms order by partner_id loop
    select * into p from public.partners where id = t.partner_id;
    if p.status <> 'live' then continue; end if;

    select gross, commission_rate, fees, period_start, period_end
      into last_stmt
      from public.settlement_statements
     where partner_id = t.partner_id and status <> 'open'
     order by period_end desc limit 1;
    if last_stmt.gross is null then continue; end if;

    daily := last_stmt.gross / greatest(1, (last_stmt.period_end - last_stmt.period_start + 1));
    rate := last_stmt.commission_rate;

    select array_agg(id order by id), array_agg(name order by id), array_agg(category_id order by id)
      into prods, names, cats
      from public.products where partner_id = t.partner_id and status in ('live','paused');
    if prods is null then continue; end if;

    /* One line a day up to today. Skipping straight to a single August total
       would settle correctly and tell nobody when anything happened — and the
       hold window is a question about dates, so the dates have to be real. */
    d := date '2026-08-01';
    while d <= least(current_date, date '2026-08-31') loop
      seq := seq + 1;
      pick := 1 + ((seq - 1) % array_length(prods, 1));
      /* A little movement day to day, deterministic so a re-run does not
         produce a different August. */
      g := round(daily * (0.86 + ((extract(day from d)::int * 7) % 29) / 100.0), 2);
      c := round(g * rate / 100, 2);
      f := round(g * coalesce(last_stmt.fees, 0) / nullif(last_stmt.gross, 0), 2);

      insert into public.settlement_lines
        (id, statement_id, partner_id, order_ref, product_id, product_name, category_id,
         quantity, gross, tax, commission_rate, commission, fees, refunds, net,
         occurred_on, sort_order)
      values (
        format('SL-A%s', lpad(seq::text, 5, '0')),
        /* Unsettled. August has not closed and no run has touched it. */
        null,
        t.partner_id,
        format('ORD-A%s', lpad(seq::text, 6, '0')),
        prods[pick], names[pick], cats[pick],
        greatest(1, round(g / 40)::integer),
        g, round(g * 0.1525, 2), rate, c, f, 0,
        g - c - f,
        d, extract(day from d)::int)
      on conflict (id) do nothing;

      d := d + 1;
    end loop;
  end loop;
end $$;

/* ---- 3b. And nothing dated after today --------------------------------------- */

/* The line rebuild spread each statement's value evenly across the months of
 * its period. On a closed period that is right. On an OPEN one it dated
 * fourteen lines into September and December — sales recorded as having
 * happened next month, which would make every "trade to date" figure on every
 * screen a forecast wearing the clothes of a fact.
 *
 * The trade behind those statements is real; what was wrong is when it was said
 * to have happened. Q3's folded content is July's trade, so it belongs in July.
 * Re-dated into the elapsed part of each period, keeping the order they were
 * written in so the running totals still climb.
 */
do $$
declare
  s record;
  l record;
  elapsed_end date;
  span integer;
  n_lines integer;
  i integer;
begin
  for s in
    select st.id, st.period_start, st.period_end
      from public.settlement_statements st
     where exists (select 1 from public.settlement_lines x
                    where x.statement_id = st.id and x.occurred_on > current_date)
  loop
    elapsed_end := least(s.period_end, current_date);
    span := greatest(1, (elapsed_end - s.period_start) + 1);
    select count(*) into n_lines from public.settlement_lines where statement_id = s.id;
    i := 0;
    for l in
      select id from public.settlement_lines
       where statement_id = s.id order by sort_order
    loop
      /* Spread across the days that have actually happened, evenly, so a
         six-line half-year does not pile onto one afternoon. */
      update public.settlement_lines
         set occurred_on = s.period_start + ((i * (span - 1)) / greatest(1, n_lines - 1))::integer
       where id = l.id;
      i := i + 1;
    end loop;
  end loop;
end $$;

/* ---- 4. What has accrued in the period each partner is in now ---------------- */

/* The open period, derived rather than stored. A seller on a quarterly cycle
   between July and October is otherwise looking at a blank screen, and an
   operator cannot answer "how much is building up" without it.
 *
 * Held back is computed here too, because it is the number that makes the
 * figure honest: the accrual is not what will be paid, and the difference is
 * trade that is still inside its returns window.
 */
create or replace view public.settlement_accruing
with (security_invoker = on) as
  select
    t.partner_id,
    p.name as partner_name,
    t.frequency,
    w.period_start, w.period_end, w.closed_on,
    (w.closed_on + (t.pay_within_days || ' days')::interval)::date as due_on,
    t.hold_days, t.hold_reason, t.minimum_payout, t.payout_currency,
    coalesce(sum(l.gross), 0)      as gross,
    coalesce(sum(l.commission), 0) as commission,
    coalesce(sum(l.fees), 0)       as fees,
    coalesce(sum(l.refunds), 0)    as refunds,
    coalesce(sum(l.net), 0)        as net,
    count(l.id)                    as lines,
    /* Inside the hold window as it will stand on the day the period closes.
       Today's answer, not a promise — a sale made tomorrow moves it. */
    coalesce(sum(l.net) filter (
      where t.hold_days > 0 and l.occurred_on > w.closed_on - t.hold_days), 0) as held_back
  from public.partner_settlement_terms t
  join public.partners p on p.id = t.partner_id
  cross join lateral public.settlement_window(
    t.frequency, t.align, t.starts_on, t.closes_on_day, current_date) w
  left join public.settlement_lines l
    on l.partner_id = t.partner_id
   and l.statement_id is null
   and l.occurred_on between w.period_start and w.period_end
  where p.status = 'live'
  group by t.partner_id, p.name, t.frequency, w.period_start, w.period_end, w.closed_on,
           t.pay_within_days, t.hold_days, t.hold_reason, t.minimum_payout, t.payout_currency;

grant select on public.settlement_accruing to authenticated;

/* ---- 5. Assertions ------------------------------------------------------------ */

do $$
declare n int; bad text; d date;
begin
  /* The next close is in the future for everybody. This is the whole of bug
     two: a "next" date in the past is a screen telling an operator they are
     late for something that already happened. */
  select string_agg(partner_id || ' → ' || public.next_settlement_close(partner_id), ', ')
    into bad from public.partner_settlement_terms
   where public.next_settlement_close(partner_id) <= current_date;
  if bad is not null then raise exception 'next settlement in the past: %', bad; end if;

  /* Specifically the half-yearly one that exposed it. */
  d := public.next_settlement_close('PTR-1006', date '2026-08-07');
  if d <> date '2026-12-31' then
    raise exception 'the half-yearly next close is % rather than 31 December', d;
  end if;
  /* And the monthly and anniversary-quarterly cases, which were already right
     and must not have been broken by the rebuild. */
  if public.next_settlement_close('PTR-1001', date '2026-08-07') <> date '2026-08-31' then
    raise exception 'the monthly next close moved';
  end if;
  if public.next_settlement_close('PTR-1007', date '2026-08-07') <> date '2026-10-31' then
    raise exception 'the anniversary-quarterly next close is %',
      public.next_settlement_close('PTR-1007', date '2026-08-07');
  end if;

  /* Nothing is recorded in the future. */
  select count(*) into n from public.settlement_lines where occurred_on > current_date;
  if n > 0 then raise exception '% sales are recorded as having happened in the future', n; end if;

  /* Every live partner has trade accruing, so every screen has something on it. */
  select string_agg(partner_id, ', ') into bad from public.settlement_accruing where lines = 0;
  if bad is not null then raise exception 'live partners with nothing accruing: %', bad; end if;

  /* An unsettled line cannot be un-unsettled and then detached again. */
  begin
    update public.settlement_lines set statement_id = null
     where statement_id is not null and id = (
       select id from public.settlement_lines where statement_id is not null limit 1);
    raise exception 'a settled line was detached';
  exception when others then
    if sqlerrm not like '%cannot be unsettled%' then
      raise exception 'detaching a settled line failed on % rather than the guard', sqlerrm;
    end if;
  end;

  /* The accrual reconciles to the lines behind it. */
  select count(*) into n from public.settlement_accruing a
   where abs(a.net - (a.gross - a.commission - a.fees - a.refunds)) > 0.02;
  if n > 0 then raise exception '% accruals do not add up', n; end if;

  raise notice 'accruing: %',
    (select string_agg(partner_id || ' ' || lines || ' lines, ' || round(gross,2) || ' gross', '; ' order by partner_id)
       from public.settlement_accruing);
end $$;
