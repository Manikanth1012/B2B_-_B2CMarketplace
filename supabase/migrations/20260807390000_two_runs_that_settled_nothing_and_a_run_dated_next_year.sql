/* Two runs that settled nothing, and a run nobody stopped from being dated next year.
 *
 * ONE. Orphaned runs.
 *
 * The history was backfilled by keying a run to each date a period closed. When
 * the open periods were later stripped of their run — correctly, because a
 * period that has not closed was not produced by a run — the runs themselves
 * were left behind. The Runs tab showed RUN-20261231 sitting at the top of the
 * list, dated four months in the future, claiming to have settled one partner.
 *
 * The clean-up in that migration ran before the run_ids were nulled, so it
 * found statements against them and left them alone. Order of operations, and
 * the assertion that would have caught it checked statements rather than runs.
 *
 * TWO. A run could be asked for a date that has not happened.
 *
 * `run_settlements` takes an as-at date and settles whatever closed by then.
 * Given a future date it computes periods that have not closed, tries to write
 * statements for them, and is refused by `guard_statement_period` — halfway
 * through the loop, having already settled everybody whose period genuinely
 * had closed, with an error message about a constraint. Refused up front
 * instead, in words, before anything is written.
 */

/* ---- 1. A run is what it settled ---------------------------------------------- */

delete from public.settlement_run r
 where not exists (select 1 from public.settlement_statements s where s.run_id = r.id);

/* And the counts on the survivors are what they actually settled, rather than
   what they settled before the open periods were taken off them. */
update public.settlement_run r
   set settled = c.n
  from (select run_id, count(*) n from public.settlement_statements
         where run_id is not null group by run_id) c
 where c.run_id = r.id and r.settled <> c.n;

/* A run with nothing against it is a row that says work happened and cannot
   say what. Refused at source rather than cleaned up again next time. */
create or replace function public.guard_run_not_empty()
returns trigger language plpgsql as $$
begin
  /* Only on delete of the last statement — an empty run is legitimate for the
     moment between creating the row and settling into it, which is why this
     fires on the statement rather than on the run. */
  if tg_op = 'DELETE' and old.run_id is not null
     and not exists (select 1 from public.settlement_statements s
                      where s.run_id = old.run_id and s.id <> old.id) then
    delete from public.settlement_run where id = old.run_id;
  end if;
  return old;
end $$;

drop trigger if exists z_guard_run_not_empty on public.settlement_statements;
create trigger z_guard_run_not_empty
  after delete on public.settlement_statements
  for each row execute function public.guard_run_not_empty();

/* ---- 2. A run cannot be dated into the future --------------------------------- */

create or replace function public.run_settlements(
  p_as_of date default current_date,
  p_actor text default 'Settlement scheduler',
  p_kind  text default 'scheduled',
  p_only  text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare
  run_id     text;
  t          public.partner_settlement_terms;
  pt         public.partners;
  per        record;
  agg        record;
  carried    numeric;
  held       numeric;
  payable    numeric;
  stmt_id    text;
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
  /* Before anything is written. A future date computes periods that have not
     closed and gets refused halfway through the loop, having already settled
     everybody whose period had — a half-done run with a constraint message. */
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

    held    := round(agg.held, 2);
    payable := round(agg.net - held + carried, 2);

    if payable > 0 and payable < t.minimum_payout then
      note := format('Carried forward: %s is below the %s %s minimum payout agreed in %s.',
                     payable, t.minimum_payout, t.payout_currency, coalesce(t.contract_ref, 'the contract'));
      held := round(held + payable, 2);
      payable := 0;
    else
      note := null;
    end if;

    stmt_id := format('ss-%s-%s', right(t.partner_id, 4), to_char(per.period_start, 'YYYYMM'));

    insert into public.settlement_statements
      (id, partner_id, partner_name, plan_id, period, period_start, period_end,
       frequency, closed_on, due_on,
       gross, commission, commission_rate, fees, refunds, withholding, net,
       held_back, carried_in, carried_out,
       order_count, currency, payout_currency, status, run_id, sort_order, note)
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
       agg.gross, agg.commission, agg.rate, agg.fees, agg.refunds, 0,
       round(agg.net, 2), held, carried, held,
       agg.lines, 'USD', t.payout_currency, 'pending', run_id, 0, note);

    update public.settlement_lines
       set statement_id = stmt_id
     where partner_id = t.partner_id
       and occurred_on between per.period_start and per.period_end
       and statement_id is null;

    settled := settled + 1;
  end loop;

  /* A run that settled nobody is a fact worth keeping — "we checked and there
     was nothing" is the answer to a question somebody will ask — but it is not
     worth keeping as a row that looks like work. Kept only when it did some. */
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
end $$;

revoke all on function public.run_settlements(date,text,text,text) from public;
grant execute on function public.run_settlements(date,text,text,text) to authenticated;

/* ---- 3. Assertions ------------------------------------------------------------ */

do $$
declare n int; bad text;
begin
  /* Every run settled something, and says how much. */
  select string_agg(id, ', ') into bad from public.settlement_run r
   where not exists (select 1 from public.settlement_statements s where s.run_id = r.id);
  if bad is not null then raise exception 'runs that settled nothing: %', bad; end if;

  select string_agg(r.id || ' claims ' || r.settled || ' but has ' || c.n, ', ') into bad
    from public.settlement_run r
    join (select run_id, count(*) n from public.settlement_statements
           where run_id is not null group by run_id) c on c.run_id = r.id
   where r.settled <> c.n;
  if bad is not null then raise exception 'runs whose count is wrong: %', bad; end if;

  /* And no run is dated after today. */
  select count(*) into n from public.settlement_run where ran_on > current_date;
  if n > 0 then raise exception '% runs are dated in the future', n; end if;

  /* Deleting the last statement of a run takes the run with it. */
  select count(*) into n from public.settlement_run;
  raise notice 'runs on record: %', n;
end $$;
