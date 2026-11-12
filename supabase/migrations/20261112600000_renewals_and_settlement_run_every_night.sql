/*
 * Renewals and the settlement run, every night.
 *
 * Nothing in this build ran on a schedule. Every job below existed or was
 * promised, and each one happened only when somebody pressed a button or a test
 * called it, so the dates went stale behind them:
 *
 *   - Six enterprise subscriptions with auto-renew on were past their renewal
 *     date (SUB-7781 since 12 Aug), and no code anywhere moves that date. The
 *     enterprise console promises that one with auto-renew off "runs to that
 *     date and then stops"; nothing stopped it.
 *   - Two agreements carry an auto-renewal clause (CTR-2014-01, CTR-2011-01).
 *     Nothing would have renewed them: on 1 Feb 2027 ENT-2014 would have lost
 *     purchasing on account under an agreement that says it renews.
 *   - Nobody had run settlement since July, so no seller had been paid for
 *     October. And it could not have run: see 2 below.
 *
 * So:
 *
 * 1. `is_scheduler()`: a session with no signed-in user, connected straight to
 *    the database as postgres (pg_cron, or the SQL editor). It reads
 *    `session_user`, which a security-definer function does not change and which
 *    is `authenticator` for anything arriving through the API, so no app user
 *    can become the scheduler. The operator-only entry points accept it too.
 *
 * 2. `run_settlements_core` gets the one change a real run needs. Its last
 *    statement, `update settlement_run set considered = considered, settled =
 *    settled`, names two columns that are also variables (42702: ambiguous).
 *    Only a run that settled somebody reaches that statement, and none ever had.
 *    The body is now labelled `core` and the two right-hand sides read
 *    `core.considered` / `core.settled`. Otherwise it is 20260810180000's text.
 *
 * 3. `renew_subscriptions` and `renew_contract`: unchanged except the guard.
 *
 * 4. `renew_enterprise_subscriptions`: an active subscription with auto-renew on
 *    renews for a year on its date, keeping its day, provided the account has an
 *    agreement in force (without one it waits and says why). One with auto-renew
 *    off, or suspended, runs to its date and then ends: suspension stops the
 *    renewal, not the billing to term.
 *
 * 5. `auto_renew_contracts`: an agreement with auto-renew still on once its
 *    notice deadline (ends_on less notice_days) has passed is renewed for a like
 *    term, starting the day after it ends, through `renew_contract`. So the
 *    account is never without an agreement for a day. The renewal points at the
 *    original signed copy, which holds the clause that renews it.
 *
 * 6. `run_nightly()` runs the four jobs in that order (agreements before the
 *    subscriptions that need one in force), each in its own sub-transaction so
 *    one failing does not stop the rest, and writes every outcome to
 *    `scheduled_job_log`, which the operator can read. pg_cron calls it at 00:30
 *    UTC (06:00 in India, 03:30 in Kenya).
 *
 * Seller-sold shopper subscriptions are still the seller's to renew and report.
 * The run lists them as awaiting, as before.
 *
 * Idempotent, one transaction. The self-check dry-runs the whole night, rolls
 * it back and refuses the migration if any job fails.
 */

begin;

create extension if not exists pg_cron with schema pg_catalog;

/* ------------------------------------------------------------ 1. who runs -- */

create or replace function public.is_scheduler()
returns boolean language sql stable set search_path = public as $$
  select auth.uid() is null and session_user::text in ('postgres', 'supabase_admin')
$$;

comment on function public.is_scheduler() is
  'True for a direct database session with nobody signed in: pg_cron, or the SQL editor. Never true through the API, whose session user is authenticator.';

revoke all on function public.is_scheduler() from public, anon, authenticated;

/* ------------------------------------------------ 2. the settlement run -- */

CREATE OR REPLACE FUNCTION public.run_settlements_core(p_as_of date DEFAULT CURRENT_DATE, p_actor text DEFAULT 'Settlement scheduler'::text, p_kind text DEFAULT 'scheduled'::text, p_only text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
<<core>>
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
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
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
       set considered = core.considered, settled = core.settled, skipped = skips,
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

/* ------------------------------------------- 3. the two existing renewals -- */

create or replace function public.renew_subscriptions(
  p_as_of date default current_date, p_actor text default 'Renewal scheduler')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s        record;
  months   integer;
  p_start  date;
  p_end    date;
  vendor   text;
  vname    text;
  charged  integer := 0;
  already  integer := 0;
  rolled   integer := 0;
  skips    jsonb := '[]'::jsonb;
  waits    jsonb := '[]'::jsonb;
  new_id   text;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the marketplace runs renewals.';
  end if;

  if p_as_of > current_date then
    raise exception
      'A renewal run cannot be dated %. A period that has not started has not been used, and charging for it is charging for nothing.',
      p_as_of;
  end if;

  for s in
    select * from public.subscriptions
     where status = 'active' and next_renewal is not null and next_renewal <= p_as_of
     order by next_renewal, ref
  loop
    months := public.cycle_length(s.cycle);

    /* A subscription that ends before its next renewal does not renew. It ends,
       and saying so is better than charging somebody for a cycle they had
       already cancelled out of. Before the ownership question, because a lapsed
       subscription is nobody's to renew. */
    if s.ends_at is not null and s.ends_at <= s.next_renewal then
      skips := skips || jsonb_build_object(
        'ref', s.ref, 'product', s.product_name, 'reason',
        format('Ends on %s, before the renewal on %s. Nothing renewed and nothing charged.',
               s.ends_at, s.next_renewal));
      continue;
    end if;

    if not s.auto_renew then
      skips := skips || jsonb_build_object(
        'ref', s.ref, 'product', s.product_name, 'reason',
        format('Auto-renew is off. It lapses on %s rather than renewing, and the customer has to take it again.',
               s.next_renewal));
      continue;
    end if;

    /* Not ours to renew. */
    vendor := public.renewal_vendor(s.product_id);
    if vendor is not null then
      select name into vname from public.partners where id = vendor;
      waits := waits || jsonb_build_object(
        'ref', s.ref, 'product', s.product_name,
        'vendor_id', vendor, 'vendor', coalesce(vname, vendor),
        'due', s.next_renewal, 'days_late', (p_as_of - s.next_renewal),
        'reason', format(
          '%s renews this one and has not reported the cycle due on %s. The marketplace does not roll a date it does not own — chase the vendor.',
          coalesce(vname, vendor), s.next_renewal));
      continue;
    end if;

    /* The cycle that starts on the renewal date. */
    p_start := s.next_renewal;
    p_end   := (p_start + make_interval(months => months) - interval '1 day')::date;
    new_id  := format('SC-%s-%s', s.ref, to_char(p_start, 'YYYYMM'));

    insert into public.subscription_charge
      (id, subscription_id, ref, user_id, product_id, product_name, seller,
       period_start, period_end, period_label, amount, currency, source)
    values
      (new_id, s.id, s.ref, s.user_id, s.product_id, s.product_name, s.seller,
       p_start, p_end, to_char(p_start, 'Mon YYYY'), s.price, s.currency, 'marketplace')
    on conflict (subscription_id, period_start) do nothing;

    if found then charged := charged + 1; else already := already + 1; end if;

    /* Forward by whole cycles from the agreed date, so somebody billed on the
       9th stays on the 9th. "Today plus a month" would walk the billing day
       every time a run was late. */
    while p_start < p_as_of or p_start = s.next_renewal loop
      p_start := (p_start + make_interval(months => months))::date;
      exit when p_start > p_as_of;
    end loop;

    update public.subscriptions set next_renewal = p_start where id = s.id;
    rolled := rolled + 1;
  end loop;

  return jsonb_build_object(
    'ran_on', p_as_of, 'ran_by', p_actor,
    'charged', charged, 'already', already, 'rolled', rolled,
    'skipped', skips, 'awaiting', waits);
end $$;

create or replace function public.renew_contract(
  p_from text, p_id text, p_signed_on date, p_starts_on date, p_ends_on date,
  p_terms text, p_auto_renew boolean, p_notice_days int, p_term_value numeric,
  p_signed_by text, p_signed_title text, p_countersigned_by text,
  p_title text, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare old record;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the marketplace renews an agreement.';
  end if;

  select * into old from public.enterprise_contract where id = p_from;
  if old.id is null then
    return jsonb_build_object('ok', false, 'why', format('There is no agreement %s.', p_from));
  end if;
  if old.state <> 'active' then
    return jsonb_build_object('ok', false, 'why',
      format('%s is %s, so there is nothing to renew. Write a new agreement instead.', p_from, old.state));
  end if;
  if old.superseded_by is not null then
    return jsonb_build_object('ok', false, 'why',
      format('%s has already been renewed into %s.', p_from, old.superseded_by));
  end if;
  if exists (select 1 from public.enterprise_contract where id = p_id) then
    return jsonb_build_object('ok', false, 'why', format('%s already exists.', p_id));
  end if;

  if p_starts_on <= old.ends_on then
    return jsonb_build_object('ok', false, 'why', format(
      '%s runs to %s. A term starting %s would overlap it, and two agreements in force '
      'at once is two sets of payment terms.', p_from, old.ends_on, p_starts_on));
  end if;

  insert into public.enterprise_contract (
    id, account_id, title, signed_on, starts_on, ends_on, terms, currency,
    auto_renew, notice_days, term_value, signed_by, signed_title, countersigned_by,
    state, note, sort_order)
  values (
    p_id, old.account_id, p_title, p_signed_on, p_starts_on, p_ends_on, p_terms, old.currency,
    coalesce(p_auto_renew, false), coalesce(p_notice_days, 30), p_term_value,
    p_signed_by, p_signed_title, p_countersigned_by,
    'active', p_note, coalesce(old.sort_order, 0) + 1);

  /* The pointer always; the state only once the old term is actually over.
     Renewing inside the notice period is the behaviour the register asks for,
     and marking the current agreement superseded on the spot took the account
     off account-purchasing until the new term began. */
  update public.enterprise_contract
     set superseded_by = p_id,
         state = case when current_date > ends_on then 'superseded' else state end
   where id = p_from;

  return jsonb_build_object(
    'ok', true, 'id', p_id,
    'why', case
      when p_starts_on > current_date then format(
        '%s runs from %s to %s. %s keeps running until %s, so nothing is interrupted.',
        p_id, p_starts_on, p_ends_on, p_from, old.ends_on)
      else format('%s runs from %s to %s. %s is superseded.', p_id, p_starts_on, p_ends_on, p_from)
    end);
end $$;

/* ------------------------------------------ 4. enterprise subscriptions -- */

create or replace function public.renew_enterprise_subscriptions(
  p_as_of date default current_date, p_actor text default 'Renewal scheduler')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s       record;
  nxt     date;
  renewed jsonb := '[]'::jsonb;
  ended   jsonb := '[]'::jsonb;
  waiting jsonb := '[]'::jsonb;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the marketplace runs renewals.';
  end if;
  if p_as_of > current_date then
    raise exception 'A renewal run cannot be dated %. A term that has not started has not been used.', p_as_of;
  end if;

  /* Runs to its date and stops: auto-renew off, or suspended. */
  for s in
    select * from public.enterprise_subscriptions
     where status in ('active', 'suspended') and renews < p_as_of
       and (not auto_renew or status = 'suspended')
     order by renews, id
  loop
    update public.enterprise_subscriptions set status = 'cancelled' where id = s.id;
    ended := ended || jsonb_build_object(
      'id', s.id, 'account_id', s.account_id, 'name', s.name, 'ended_on', s.renews,
      'reason', case when s.status = 'suspended'
        then format('Suspended (%s). Suspension stops the renewal, so it ran to %s and ended.',
                    coalesce(s.why_suspended, 'no reason recorded'), s.renews)
        else format('Auto-renew was off, so it ran to %s and ended.', s.renews) end);
  end loop;

  /* Renews on its date, for a year, keeping its day. */
  for s in
    select * from public.enterprise_subscriptions
     where status = 'active' and auto_renew and renews <= p_as_of
     order by renews, id
  loop
    if public.contract_in_force(s.account_id) is null then
      waiting := waiting || jsonb_build_object(
        'id', s.id, 'account_id', s.account_id, 'name', s.name, 'due', s.renews,
        'reason', format('%s has no agreement in force, so nothing renews under it. It renews the night one is.',
                         s.account_id));
      continue;
    end if;
    nxt := s.renews;
    while nxt <= p_as_of loop
      nxt := (nxt + interval '1 year')::date;
    end loop;
    update public.enterprise_subscriptions set renews = nxt where id = s.id;
    renewed := renewed || jsonb_build_object(
      'id', s.id, 'account_id', s.account_id, 'name', s.name, 'was', s.renews, 'renews', nxt);
  end loop;

  return jsonb_build_object('ran_on', p_as_of, 'ran_by', p_actor,
    'renewed', renewed, 'ended', ended, 'waiting', waiting);
end $$;

revoke all on function public.renew_enterprise_subscriptions(date, text) from public, anon, authenticated;

/* ---------------------------------------------------------- 5. agreements -- */

create or replace function public.auto_renew_contracts(
  p_as_of date default current_date, p_actor text default 'Renewal scheduler')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c       public.enterprise_contract;
  s_on    date;
  e_on    date;
  stem    text;
  digits  text;
  n       integer;
  new_id  text;
  res     jsonb;
  renewed jsonb := '[]'::jsonb;
  skips   jsonb := '[]'::jsonb;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the marketplace renews an agreement.';
  end if;
  if p_as_of > current_date then
    raise exception 'A renewal run cannot be dated %.', p_as_of;
  end if;

  /* Past the notice deadline with auto-renew still on: the renewal is certain,
     so it is recorded now and starts the day after the term ends. */
  for c in
    select * from public.enterprise_contract
     where state = 'active' and auto_renew and superseded_by is null
       and p_as_of >= ends_on - notice_days
     order by ends_on, id
  loop
    if not exists (select 1 from public.enterprise_accounts a
                    where a.id = c.account_id and a.status = 'active') then
      skips := skips || jsonb_build_object('id', c.id, 'account_id', c.account_id,
        'reason', format('%s is not a trading account, so its agreement is not renewed.', c.account_id));
      continue;
    end if;

    s_on := c.ends_on + 1;
    e_on := (s_on + age(s_on, c.starts_on))::date - 1;

    /* The next free number: CTR-2014-01 renews into CTR-2014-02. */
    digits := substring(c.id from '([0-9]+)$');
    if digits is null then
      stem := c.id || '-R'; n := 0; digits := '0';
    else
      stem := left(c.id, length(c.id) - length(digits)); n := digits::integer;
    end if;
    loop
      n := n + 1;
      new_id := stem || lpad(n::text, length(digits), '0');
      exit when not exists (select 1 from public.enterprise_contract where id = new_id);
    end loop;

    res := public.renew_contract(
      c.id, new_id, p_as_of, s_on, e_on, c.terms, true, c.notice_days, c.term_value,
      c.signed_by, c.signed_title, c.countersigned_by,
      regexp_replace(c.title, '[0-9]{4}–[0-9]{4}', to_char(s_on, 'YYYY') || '–' || to_char(e_on, 'YYYY')),
      format('Renewed automatically. %s renews unless either side gives notice %s days before it ends, and none was given by %s. Same terms; the signed copy is %s''s.',
             c.id, c.notice_days, c.ends_on - c.notice_days, c.id));
    if not coalesce((res ->> 'ok')::boolean, false) then
      skips := skips || jsonb_build_object('id', c.id, 'account_id', c.account_id, 'reason', res ->> 'why');
      continue;
    end if;

    update public.enterprise_contract
       set document_name = c.document_name, document_path = c.document_path
     where id = new_id;
    renewed := renewed || jsonb_build_object('id', c.id, 'into', new_id, 'account_id', c.account_id,
      'starts_on', s_on, 'ends_on', e_on);
  end loop;

  return jsonb_build_object('ran_on', p_as_of, 'ran_by', p_actor, 'renewed', renewed, 'skipped', skips);
end $$;

revoke all on function public.auto_renew_contracts(date, text) from public, anon, authenticated;

/* ---------------------------------------------------------- 6. the night -- */

create table if not exists public.scheduled_job_log (
  id          bigint generated always as identity primary key,
  job         text not null,
  ran_on      date not null,
  started_at  timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  ok          boolean not null,
  result      jsonb,
  error       text
);

comment on table public.scheduled_job_log is
  'One row per job per night: what run_nightly ran, what it did, and the error if it failed. A failed job writes nothing else.';

create index if not exists scheduled_job_log_ran_idx on public.scheduled_job_log (started_at desc);

alter table public.scheduled_job_log enable row level security;
drop policy if exists operator_read_job_log on public.scheduled_job_log;
create policy operator_read_job_log on public.scheduled_job_log
  for select to authenticated using (public.current_persona() = 'operator');

create or replace function public.run_nightly(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  j    text;
  res  jsonb;
  err  text;
  t0   timestamptz;
  outs jsonb := '[]'::jsonb;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, runs the night.';
  end if;

  foreach j in array array['agreements', 'enterprise subscriptions', 'subscriptions', 'settlements'] loop
    t0 := clock_timestamp(); res := null; err := null;
    begin
      res := case j
        when 'agreements'               then public.auto_renew_contracts(p_as_of, 'Nightly schedule')
        when 'enterprise subscriptions' then public.renew_enterprise_subscriptions(p_as_of, 'Nightly schedule')
        when 'subscriptions'            then public.renew_subscriptions(p_as_of, 'Nightly schedule')
        when 'settlements'              then public.run_settlements(p_as_of, 'Nightly schedule', 'scheduled', null)
      end;
    exception when others then
      err := format('%s (%s)', sqlerrm, sqlstate);
    end;
    insert into public.scheduled_job_log (job, ran_on, started_at, finished_at, ok, result, error)
    values (j, p_as_of, t0, clock_timestamp(), err is null, res, err);
    outs := outs || jsonb_build_object('job', j, 'ok', err is null, 'error', err);
  end loop;

  return jsonb_build_object('ran_on', p_as_of, 'jobs', outs);
end $$;

revoke all on function public.run_nightly(date) from public, anon, authenticated;

select cron.schedule('nightly-renewals-and-settlement', '30 0 * * *',
                     $cron$select public.run_nightly()$cron$);

/* ============================================================ self-check === */

do $$
declare
  dry jsonb;
  j   jsonb;
begin
  if not public.is_scheduler() then
    raise exception 'This session (%) is not one the schedule runs as, so every nightly job would be refused.', session_user;
  end if;

  if not exists (select 1 from cron.job
                  where jobname = 'nightly-renewals-and-settlement' and schedule = '30 0 * * *'
                    and command like '%public.run_nightly()%' and active) then
    raise exception 'The nightly job is not scheduled';
  end if;

  if pg_get_functiondef('public.run_settlements_core(date,text,text,text)'::regprocedure)
       not like '%set considered = core.considered, settled = core.settled%' then
    raise exception 'run_settlements_core still names considered and settled ambiguously';
  end if;
  if exists (select 1 from unnest(array[
                'public.run_settlements_core(date,text,text,text)', 'public.renew_subscriptions(date,text)',
                'public.renew_contract(text,text,date,date,date,text,boolean,integer,numeric,text,text,text,text,text)',
                'public.renew_enterprise_subscriptions(date,text)', 'public.auto_renew_contracts(date,text)',
                'public.run_nightly(date)']) f(sig)
              where pg_get_functiondef(f.sig::regprocedure) not like '%not public.is_scheduler()%') then
    raise exception 'An entry point still refuses the scheduler';
  end if;
  if has_function_privilege('authenticated', 'public.run_nightly(date)', 'execute')
     or has_function_privilege('anon', 'public.run_nightly(date)', 'execute') then
    raise exception 'run_nightly is callable through the API';
  end if;

  /* The whole night, for real, then rolled back. A job that fails here would
     fail at 00:30 with nobody watching. */
  begin
    dry := public.run_nightly(current_date);
    raise exception using errcode = 'ZZ999', message = 'rolling the dry run back';
  exception when sqlstate 'ZZ999' then
    null;
  end;
  for j in select value from jsonb_array_elements(dry -> 'jobs') loop
    if not (j ->> 'ok')::boolean then
      raise exception 'A dry run of the nightly "%" job fails: %', j ->> 'job', j ->> 'error';
    end if;
  end loop;
  if jsonb_array_length(dry -> 'jobs') <> 4 then
    raise exception 'The dry run ran % jobs, not 4', jsonb_array_length(dry -> 'jobs');
  end if;
end $$;

commit;
