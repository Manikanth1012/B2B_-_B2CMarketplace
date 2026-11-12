/*
 * The demo catches up with the calendar.
 *
 * The seeded marketplace stops on 7 Aug 2026: the last order, sale, audit entry
 * and stock movement are that day. Today is 12 Nov. Ninety-seven days went by
 * with nobody working the queues, renewing what lapses or settling what closed,
 * so the screens show a business that stopped answering in August. This brings
 * the states that time has made wrong up to date. It adds no new trade: no
 * orders, bills, invoices or ledger postings are invented for the gap.
 *
 * Three rules, applied throughout:
 *
 *   - Open work keeps its age. A refund, dispute or listing query that was two
 *     days old on 7 Aug is two days old today: its dates move forward by the
 *     97 days. Inbound stock and the last stock count move with it.
 *   - Finished work keeps its date. Nothing decided, paid, settled or closed is
 *     touched.
 *   - Things with an end date end, or are renewed by whoever would renew them.
 *
 * And two jobs join the night, so the same drift does not come back:
 *
 *   - `settle_to_date` replaces the single settlement run. A run only ever
 *     looked at the latest closed period, so a month nobody ran was never
 *     settled: August and September were skipped for good. It now settles
 *     every closed month since the oldest unsettled sale, oldest first, then
 *     runs today's. August's sales (1 to 7 Aug) settle on the next night.
 *     Before that it closes any statement still "open" after its period ended
 *     (`close_open_statements`): the seed models the running period as an open
 *     statement and nothing ever closed one, so Sentinel's and Beacon's Q3
 *     statements have sat open since 30 Sep with no reserve retained. Beacon's
 *     Q3 payout was entirely taken by wholesale charges it was repaying, so
 *     there is nothing to retain from it; its reserve starts with Q4.
 *   - `lapse_expired_documents`: a seller document past its expiry stops
 *     counting as accepted, the same way PTR-1008's type approval already reads
 *     ("submitted", renewal requested, existing listings continue, new ones
 *     held). StreamNova's content licence (pce-1001-content-PR-01, 30 Oct) is
 *     the first. Kestrel's two expire on 30 Nov.
 *
 * What changes, one-off:
 *
 *   1. Open refunds (11), disputes (3), listing queries (2), inbound stock and
 *      stock counts: forward 97 days, only rows still dated on or before 7 Aug.
 *   2. Banners: a live campaign whose window closed in the gap runs on to
 *      31 Dec (otherwise the login screen, category headers and storefront
 *      slots go dark); a scheduled or paused one whose window has passed is
 *      ended. The console flags both mismatches.
 *   3. Beacon's tax-residence certificate (expired 30 Sep) is renewed to
 *      30 Sep 2027, so the treaty rate applies again.
 *   4. Four credit reviews due on 8 Nov are recorded as done today, on the same
 *      terms, superseding the August ones; the buyers' billing rows follow.
 *   5. Seller-renewed shopper subscriptions: each seller reports the cycles that
 *      fell due, as report_renewal records them, up to today. Beacon reports up
 *      to the cycle before, so the chase list still has a late seller on it.
 *   6. USD rates for 1 Sep, 1 Oct and 1 Nov (illustrative, as the seed's are).
 *
 * Left for a trade backfill, deliberately: shopper bills and enterprise invoices
 * still open from August, the ledger (last period July), promotions and earn
 * rules whose end dates have passed (they have no ended state; the dates say it).
 *
 * Idempotent, one transaction, ends with a self-check.
 */

begin;

/* ============================================================ the night -- */

/* A statement seeded "open" is the period still accruing. Nothing ever closed
   one when its period ended, so Sentinel's and Beacon's Q3 statements sat open
   from 30 Sep with no reserve retained, and the run skipped them as already
   settled. This closes it the way the run closes a period: the reserve out of
   what is payable, the payout at the rate in force on the day it closed, status
   pending (awaiting approval). And a withholding certificate whose quarter has
   ended is filed, as the run files one. */
create or replace function public.close_open_statements(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st      public.settlement_statements;
  res     record;
  v_rate  numeric;
  v_as_of date;
  closed  jsonb := '[]'::jsonb;
  filed   int;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the marketplace runs settlement.';
  end if;

  for st in
    select * from public.settlement_statements
     where status = 'open' and partner_id is not null and closed_on < p_as_of
     order by closed_on, id
  loop
    select * into res from public.reserve_on(st.partner_id, st.gross, st.net, st.closed_on);
    if st.payout_currency = 'USD' then
      v_rate := 1; v_as_of := st.closed_on;
    else
      v_rate := null;
      select f.rate, f.as_of into v_rate, v_as_of from public.fx_rates f
       where f.base = 'USD' and f.quote = st.payout_currency and f.as_of <= st.closed_on
       order by f.as_of desc limit 1;
      if v_rate is null then continue; end if;
    end if;

    update public.settlement_statements
       set reserve_withheld = res.withheld, reserve_released = res.released,
           fx_rate = v_rate, fx_as_of = v_as_of,
           payout_net = round((st.net - res.withheld + res.released) * v_rate, 2),
           status = 'pending',
           note = coalesce(note, format('Closed when the period ended on %s.', st.closed_on))
     where id = st.id;

    if res.withheld > 0 then
      insert into public.partner_reserve_tranche
        (id, partner_id, statement_id, amount, currency, basis, rate, held_on, matures_on)
      select format('RSV-%s-%s', right(st.partner_id, 4), to_char(st.period_start, 'YYYYMM')),
             st.partner_id, st.id, res.withheld, 'USD', st.gross, res.rate,
             st.closed_on, (st.closed_on + (s.reserve_days || ' days')::interval)::date
        from public.partner_security s where s.partner_id = st.partner_id
      on conflict (partner_id, statement_id) do nothing;
    end if;
    if res.released > 0 then
      update public.partner_reserve_tranche
         set released_on = st.closed_on, released_by = st.id
       where partner_id = st.partner_id and released_on is null and matures_on <= st.closed_on;
    end if;

    closed := closed || jsonb_build_object('id', st.id, 'partner_id', st.partner_id,
      'closed_on', st.closed_on, 'reserve_withheld', res.withheld);
  end loop;

  update public.withholding_certificate set status = 'filed'
   where status = 'accruing' and period_end < p_as_of;
  get diagnostics filed = row_count;

  return jsonb_build_object('closed', closed, 'certificates_filed', filed);
end $$;

revoke all on function public.close_open_statements(date) from public, anon, authenticated;

create or replace function public.settle_to_date(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  first  date;
  me     date;
  r      jsonb;
  closed jsonb;
  caught jsonb := '[]'::jsonb;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the marketplace runs settlement.';
  end if;

  closed := public.close_open_statements(p_as_of);

  /* Every month-end since the oldest unsettled sale, oldest first. A month that
     was never run is settled late rather than never. */
  select min(occurred_on) into first
    from public.settlement_lines where statement_id is null and partner_id is not null;
  if first is not null then
    me := (date_trunc('month', first) + interval '1 month' - interval '1 day')::date;
    while me < p_as_of loop
      r := public.run_settlements(me, 'Nightly schedule', 'catch-up', null);
      if coalesce((r ->> 'settled')::int, 0) > 0 then
        caught := caught || jsonb_build_object('as_of', me, 'run_id', r ->> 'run_id',
                                               'settled', (r ->> 'settled')::int);
      end if;
      me := (date_trunc('month', me) + interval '2 month' - interval '1 day')::date;
    end loop;
  end if;

  r := public.run_settlements(p_as_of, 'Nightly schedule', 'scheduled', null);
  return jsonb_build_object('closed', closed, 'caught_up', caught, 'today', r);
end $$;

revoke all on function public.settle_to_date(date) from public, anon, authenticated;

create or replace function public.lapse_expired_documents(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare lapsed jsonb;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the marketplace lapses a seller''s documents.';
  end if;

  with done as (
    update public.partner_category_evidence
       set state = 'submitted',
           note  = format('Expired on %s. Renewal requested from the seller; existing listings continue while it is outstanding, new ones are held.',
                          to_char(expires_on, 'FMDD Mon YYYY'))
     where state = 'accepted' and expires_on < p_as_of
    returning id, partner_id, category_id, rule_id, expires_on)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'partner_id', partner_id,
                    'category_id', category_id, 'rule_id', rule_id, 'expired_on', expires_on)), '[]'::jsonb)
    into lapsed from done;

  return jsonb_build_object('ran_on', p_as_of, 'lapsed', lapsed);
end $$;

revoke all on function public.lapse_expired_documents(date) from public, anon, authenticated;

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

  foreach j in array array['agreements', 'enterprise subscriptions', 'subscriptions', 'documents', 'settlements'] loop
    t0 := clock_timestamp(); res := null; err := null;
    begin
      res := case j
        when 'agreements'               then public.auto_renew_contracts(p_as_of, 'Nightly schedule')
        when 'enterprise subscriptions' then public.renew_enterprise_subscriptions(p_as_of, 'Nightly schedule')
        when 'subscriptions'            then public.renew_subscriptions(p_as_of, 'Nightly schedule')
        when 'documents'                then public.lapse_expired_documents(p_as_of)
        when 'settlements'              then public.settle_to_date(p_as_of)
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

/* ================================================== 1. open work, aged -- */

update public.refunds
   set requested    = requested + 97,
       sla_due      = sla_due + 97,
       escalated_on = escalated_on + 97
 where decided_on is null and requested <= date '2026-08-07';

update public.partner_disputes
   set raised = raised + 97, due_on = due_on + 97
 where resolved_on is null and raised <= date '2026-08-07';

update public.listing_queries
   set asked_on = asked_on + 97, due_on = due_on + 97
 where status in ('open', 'overdue') and asked_on <= date '2026-08-07';

update public.operator_inventory
   set inbound_due = inbound_due + 97
 where inbound_due is not null and inbound_due <= date '2026-08-14';

update public.operator_inventory
   set last_count = last_count + 97
 where last_count <= date '2026-08-07';

/* ============================================================ 2. banners -- */

update public.operator_banners
   set ends_at = date '2026-12-31'
 where status = 'live' and ends_at < current_date;

update public.operator_banners
   set status = 'ended'
 where status in ('scheduled', 'paused') and ends_at < current_date;

/* ======================================================= 3. the treaty -- */

update public.partner_bank
   set treaty_expires = date '2027-09-30'
 where partner_id = 'PTR-1009' and treaty_on_file and treaty_expires < current_date;

/* ===================================================== 4. credit reviews -- */

do $$
declare
  a      public.credit_assessment;
  new_id text;
  why    text;
begin
  for a in
    select * from public.credit_assessment
     where superseded_by is null and next_review < current_date
     order by id
  loop
    new_id := regexp_replace(a.id, '[0-9]+$', '')
              || lpad(((substring(a.id from '([0-9]+)$'))::int + 1)::text,
                      length(substring(a.id from '([0-9]+)$')), '0');
    if exists (select 1 from public.credit_assessment where id = new_id) then
      raise exception '% already exists; % cannot be superseded by it', new_id, a.id;
    end if;

    why := case a.side
      when 'buyer' then 'Scheduled review. No invoice has been raised on the account since the last one, so nothing on the file has moved the band; the reasons recorded then still stand.'
      else 'Scheduled review. No sales have been recorded for the seller since the last one, so nothing on the file has moved the band; the reasons recorded then still stand.'
    end;

    /* One live review per party (credit_assessment_one_live), and the pointer
       has to name a row that exists: out of the live set first, then the new
       review, then the real pointer. */
    update public.credit_assessment set superseded_by = a.id where id = a.id;

    insert into public.credit_assessment
      (id, account_id, partner_id, side, reviewed_on, reviewed_by, evidence, band, rationale,
       currency, limit_granted, deposit_required, reserve_pct, next_review)
    values
      (new_id, a.account_id, a.partner_id, a.side, current_date, a.reviewed_by,
       why || ' At the last review: ' || a.evidence, a.band,
       'Unchanged: ' || a.rationale,
       a.currency, a.limit_granted, a.deposit_required, a.reserve_pct, current_date);

    update public.credit_assessment set superseded_by = new_id where id = a.id;
  end loop;
end $$;

update public.enterprise_billing b
   set credit_reviewed = c.reviewed_on, credit_review_due = c.next_review
  from public.credit_assessment c
 where c.account_id = b.account_id and c.superseded_by is null
   and (b.credit_reviewed is distinct from c.reviewed_on or b.credit_review_due is distinct from c.next_review);

/* ============================================ 5. renewals sellers report -- */

do $$
declare
  s      public.subscriptions;
  vendor text;
  vname  text;
  months int;
  stop   date;
  p_end  date;
begin
  for s in
    select * from public.subscriptions
     where status = 'active' and auto_renew and next_renewal <= current_date
       and (ends_at is null or ends_at > next_renewal)
       and public.renewal_vendor(product_id) is not null
     order by ref
  loop
    vendor := public.renewal_vendor(s.product_id);
    select name into vname from public.partners where id = vendor;
    months := public.cycle_length(s.cycle);
    /* Beacon is the seller the chase list is about: it reports up to the cycle
       before, so one of its renewals is still late, by less than a cycle. */
    stop := case when vendor = 'PTR-1009'
                 then (current_date - make_interval(months => months))::date
                 else current_date end;

    while s.next_renewal <= stop loop
      p_end := (s.next_renewal + make_interval(months => months) - interval '1 day')::date;
      insert into public.subscription_charge
        (id, subscription_id, ref, user_id, product_id, product_name, seller,
         period_start, period_end, period_label, amount, currency,
         source, vendor_id, vendor_ref, reported_by, reported_at)
      values
        (format('SC-%s-%s', s.ref, to_char(s.next_renewal, 'YYYYMM')), s.id, s.ref, s.user_id,
         s.product_id, s.product_name, s.seller,
         s.next_renewal, p_end, to_char(s.next_renewal, 'Mon YYYY'), round(s.price, 2), s.currency,
         'vendor', vendor, format('%s-%s', upper(left(regexp_replace(coalesce(vname, vendor), '[^A-Za-z]', '', 'g'), 4)),
                                  to_char(s.next_renewal, 'YYMMDD') || right(s.ref, 4)),
         coalesce(vname, vendor), (s.next_renewal + 1)::timestamptz)
      on conflict (subscription_id, period_start) do nothing;
      s.next_renewal := (s.next_renewal + make_interval(months => months))::date;
    end loop;

    update public.subscriptions set next_renewal = s.next_renewal where id = s.id;
  end loop;
end $$;

/* ================================================================ 6. FX -- */

insert into public.fx_rates (id, base, quote, rate, as_of, source, pegged) values
  ('FX-USD-INR-20260901', 'USD', 'INR',  87.9500, '2026-09-01', 'Marketplace treasury', false),
  ('FX-USD-AED-20260901', 'USD', 'AED',   3.6725, '2026-09-01', 'Central bank peg',     true),
  ('FX-USD-KES-20260901', 'USD', 'KES', 129.0500, '2026-09-01', 'Marketplace treasury', false),
  ('FX-USD-INR-20261001', 'USD', 'INR',  88.3000, '2026-10-01', 'Marketplace treasury', false),
  ('FX-USD-AED-20261001', 'USD', 'AED',   3.6725, '2026-10-01', 'Central bank peg',     true),
  ('FX-USD-KES-20261001', 'USD', 'KES', 129.1000, '2026-10-01', 'Marketplace treasury', false),
  ('FX-USD-INR-20261101', 'USD', 'INR',  88.6200, '2026-11-01', 'Marketplace treasury', false),
  ('FX-USD-AED-20261101', 'USD', 'AED',   3.6725, '2026-11-01', 'Central bank peg',     true),
  ('FX-USD-KES-20261101', 'USD', 'KES', 129.1500, '2026-11-01', 'Marketplace treasury', false)
on conflict (id) do nothing;

/* ========================================== and the documents, today -- */

select public.lapse_expired_documents(current_date);

/* ============================================================ self-check === */

do $$
declare n int; bad text; dry jsonb; j jsonb;
begin
  select count(*) into n from public.refunds where decided_on is null and sla_due < date '2026-10-01';
  if n <> 0 then raise exception '% open refunds are still dated from before August', n; end if;
  select count(*) into n from public.partner_disputes where resolved_on is null and raised < date '2026-10-01';
  if n <> 0 then raise exception '% open disputes are still dated from before August', n; end if;
  select count(*) into n from public.listing_queries where status in ('open', 'overdue') and asked_on < date '2026-10-01';
  if n <> 0 then raise exception '% open listing queries are still dated from before August', n; end if;

  select string_agg(id, ', ') into bad from public.operator_banners
   where (status = 'live' and ends_at < current_date)
      or (status in ('scheduled', 'paused') and ends_at < current_date);
  if bad is not null then raise exception 'banners whose status contradicts their window: %', bad; end if;

  select string_agg(id, ', ') into bad from public.partner_category_evidence
   where state = 'accepted' and expires_on < current_date;
  if bad is not null then raise exception 'expired documents still accepted: %', bad; end if;

  select string_agg(partner_id, ', ') into bad from public.partner_bank
   where treaty_on_file and treaty_expires < current_date;
  if bad is not null then raise exception 'expired treaty certificates on file: %', bad; end if;

  select string_agg(id, ', ') into bad from public.credit_assessment
   where superseded_by is null and next_review < current_date;
  if bad is not null then raise exception 'credit reviews still overdue: %', bad; end if;
  select string_agg(b.account_id, ', ') into bad
    from public.enterprise_billing b join public.credit_assessment c
      on c.account_id = b.account_id and c.superseded_by is null
   where b.credit_review_due is distinct from c.next_review;
  if bad is not null then raise exception 'billing rows out of step with their review: %', bad; end if;

  select string_agg(ref, ', ') into bad from public.subscriptions s
   where status = 'active' and auto_renew and public.renewal_vendor(product_id) is not null
     and (ends_at is null or ends_at > next_renewal)
     and next_renewal < current_date - make_interval(months => public.cycle_length(cycle));
  if bad is not null then raise exception 'seller-renewed subscriptions more than a cycle late: %', bad; end if;
  if not exists (select 1 from public.subscriptions s
                  where status = 'active' and auto_renew and public.renewal_vendor(product_id) = 'PTR-1009'
                    and next_renewal <= current_date) then
    raise exception 'the chase list has nobody late on it';
  end if;

  /* The closing step works, rolled back: no statement is left open past its
     period. (The night itself closes them for real.) */
  begin
    perform public.close_open_statements(current_date);
    select string_agg(id, ', ') into bad from public.settlement_statements
     where status = 'open' and partner_id is not null and closed_on < current_date;
    if bad is not null then raise exception 'statements still open after their period: %', bad; end if;
    raise exception using errcode = 'ZZ998', message = 'rolling the close back';
  exception when sqlstate 'ZZ998' then
    null;
  end;

  if (select max(as_of) from public.fx_rates) < date '2026-11-01' then
    raise exception 'no rate for November';
  end if;

  /* The night, now with five jobs, dry-run and rolled back. */
  begin
    dry := public.run_nightly(current_date);
    raise exception using errcode = 'ZZ999', message = 'rolling the dry run back';
  exception when sqlstate 'ZZ999' then
    null;
  end;
  if jsonb_array_length(dry -> 'jobs') <> 5 then
    raise exception 'the dry run ran % jobs, not 5', jsonb_array_length(dry -> 'jobs');
  end if;
  for j in select value from jsonb_array_elements(dry -> 'jobs') loop
    if not (j ->> 'ok')::boolean then
      raise exception 'A dry run of the nightly "%" job fails: %', j ->> 'job', j ->> 'error';
    end if;
  end loop;
end $$;

commit;
