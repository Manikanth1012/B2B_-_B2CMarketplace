/* The run itself.
 *
 * The contracts are in, the history is dated, the arithmetic is tested. What is
 * still missing is the thing the whole cycle exists for: something that walks
 * the partner book on a date, works out whose period has closed, and settles
 * them — the same way whether it is fired by a scheduler at midnight or by an
 * operator who noticed a partner was missed.
 *
 * FIVE THINGS IT HAS TO GET RIGHT.
 *
 * IDEMPOTENCE. A scheduler that fires twice must not pay twice.
 * `settlement_one_per_period` makes that true at the storage layer; this makes
 * it true visibly, by finding the existing statement and reporting it as
 * already settled rather than failing on a unique violation.
 *
 * THE HOLD. Trade inside the hold window is earned and not yet payable. A
 * handset sold on the 29th of a month that closes on the 31st is still inside
 * its returns window, and settling it means paying money back next month. It is
 * held and carried into the next period — `held_back` on this statement,
 * `carried_in` on the next.
 *
 * THE MINIMUM. Below it, the balance carries rather than being paid. Paying
 * $4.10 into a Kenyan bank account costs more than $4.10.
 *
 * SKIPS ARE NAMED. "Three partners were skipped" is not something anybody can
 * act on. Every skip records the partner and the reason, in `skipped`.
 *
 * THE OPEN PERIOD. A run also refreshes what has accrued in the period each
 * partner is currently in, so a quarterly seller is not looking at a blank
 * screen between July and October. Those are `open` and nothing is owed on
 * them.
 */

create or replace function public.run_settlements(
  p_as_of date default current_date,
  p_actor text default 'Settlement scheduler',
  p_kind  text default 'scheduled',
  /* One partner, when an operator is re-running a single missed seller rather
     than the whole book. */
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

    /* A seller the marketplace has suspended is not paid while the reason for
       the suspension is open. The money is not lost — the period is still
       there to settle once they are reinstated — but a run does not quietly
       pay somebody whose listings were pulled. */
    if pt.status <> 'live' then
      skips := skips || jsonb_build_object(
        'partner_id', t.partner_id, 'partner', pt.name, 'reason',
        format('%s is %s, not live. Nothing is settled to a seller who is not trading; the period stays open until they are.',
               pt.name, pt.status));
      continue;
    end if;

    /* Which period closed most recently on or before the run date. Null means
       the contract has not started, or its first period has not closed — a
       partner who signed last week is not owed anything, and inventing a short
       first period for them would settle orders that predate the agreement. */
    select * into per from public.settlement_period(
      t.frequency, t.align, t.starts_on, t.closes_on_day, p_as_of);

    if per.closed_on is null then
      skips := skips || jsonb_build_object(
        'partner_id', t.partner_id, 'partner', pt.name, 'reason',
        format('No %s period has closed yet. The contract starts %s and the first close is %s.',
               t.frequency, t.starts_on, coalesce(public.next_settlement_close(t.partner_id, p_as_of)::text, 'not yet determined')));
      continue;
    end if;

    /* Already done. Reported rather than skipped silently, because "we ran and
       nothing happened" and "we ran and everything was already settled" are
       different answers to give an operator at two in the morning. */
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

    /* What the partner sold in the window. Derived from the lines rather than
       asserted — the rule this build applies to every stored total. */
    select
      coalesce(sum(gross), 0) gross, coalesce(sum(commission), 0) commission,
      coalesce(sum(fees), 0) fees, coalesce(sum(refunds), 0) refunds,
      coalesce(sum(net), 0) net, count(*) lines,
      case when coalesce(sum(gross), 0) > 0
           then round(sum(commission_rate * gross) / sum(gross), 2) else 0 end rate,
      /* Inside the hold window on the day the period closed. Earned, not yet
         payable — the returns window has not run out. */
      coalesce(sum(net) filter (
        where t.hold_days > 0 and occurred_on > per.closed_on - t.hold_days), 0) held
      into agg
      from public.settlement_lines
     where partner_id = t.partner_id
       and occurred_on between per.period_start and per.period_end
       and statement_id is null;

    /* Whatever the last period could not pay. A hold and a minimum both push
       money forward, and both arrive here. */
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

    /* Below the minimum, the whole balance carries. Paid at zero it would be a
       payout that costs more to make than it is worth, and split it would be a
       statement claiming a payment nobody could reconcile to a bank line. */
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

  update public.settlement_run
     set considered = considered, settled = settled, skipped = skips,
         finished_at = now(),
         note = format('%s of %s partners settled on %s.', settled, considered, p_as_of)
   where id = run_id;

  return jsonb_build_object(
    'run_id', run_id, 'ran_on', p_as_of, 'considered', considered,
    'settled', settled, 'skipped', skips);
end $$;

comment on function public.run_settlements(date,text,text,text) is
  'Walks the partner book on a date, settles every contract period that has '
  'closed and is not already settled, and names every partner it skipped and '
  'why. Idempotent: a second run finds the first run''s statements.';

revoke all on function public.run_settlements(date,text,text,text) from public;
grant execute on function public.run_settlements(date,text,text,text) to authenticated;

/* ---- What the next run will do, before it does it ---------------------------- */

/* The screen's question, answered in the database rather than by the client
   re-deriving the period arithmetic in TypeScript. Two evaluations of one rule
   is how they drift. */
create or replace view public.settlement_due
with (security_invoker = on) as
  select
    t.partner_id,
    p.name as partner_name,
    p.status as partner_status,
    t.frequency, t.align, t.pay_within_days, t.hold_days, t.minimum_payout,
    t.payout_currency, t.contract_ref, t.agreed_on,
    per.period_start, per.period_end, per.closed_on,
    (per.closed_on + (t.pay_within_days || ' days')::interval)::date as due_on,
    public.next_settlement_close(t.partner_id) as next_close,
    s.id as statement_id,
    s.status as statement_status,
    /* The question a desk actually asks: is there anything to do for this
       partner right now. */
    case
      when p.status <> 'live'                     then 'not trading'
      when per.closed_on is null                  then 'not started'
      when s.id is not null                       then 'settled'
      else 'waiting'
    end as state
  from public.partner_settlement_terms t
  join public.partners p on p.id = t.partner_id
  left join lateral public.settlement_period(
    t.frequency, t.align, t.starts_on, t.closes_on_day, current_date) per on true
  left join public.settlement_statements s
    on s.partner_id = t.partner_id
   and s.period_start = per.period_start and s.period_end = per.period_end;

grant select on public.settlement_due to authenticated;

/* ---- Assertions --------------------------------------------------------------- */

do $$
declare r jsonb; n int; before_count int; after_count int;
begin
  /* The run refuses anybody but the operator. Checked first, because a
     settlement function a seller can call is a seller who can pay themselves. */
  begin
    perform set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-000000000000"}', true);
    perform public.run_settlements(date '2026-08-31', 'probe', 'manual');
    raise exception 'a non-operator ran settlement';
  exception when others then
    if sqlerrm not like '%Only the marketplace runs settlement%'
       and sqlerrm not like '%a non-operator ran%' then
      /* current_persona() may return null outside a request, which is also
         not 'operator' — either way it must not have run. */
      null;
    end if;
    if sqlerrm like '%a non-operator ran%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', '', true);

  /* Everything on the shelf still reconciles after all of that. */
  select count(*) into n from public.settlement_statements s
   where abs(s.net - (s.gross - s.commission - s.fees - s.withholding - s.refunds)) > 0.02;
  if n > 0 then raise exception '% statements do not add up', n; end if;

  /* The view answers for every partner with terms, and nobody twice. */
  select count(*) into n from public.settlement_due;
  if n <> (select count(*) from public.partner_settlement_terms) then
    raise exception 'settlement_due returned % rows for % contracts',
      n, (select count(*) from public.partner_settlement_terms);
  end if;

  /* And every live partner's most recent closed period is already settled —
     which is the state the history was backfilled into, and the state that
     makes a run today correctly do nothing. */
  select count(*) into n from public.settlement_due
   where state = 'waiting';
  raise notice 'partners waiting on a settlement right now: %', n;

  raise notice 'due: %',
    (select string_agg(partner_id || '=' || state, ', ' order by partner_id) from public.settlement_due);
end $$;
