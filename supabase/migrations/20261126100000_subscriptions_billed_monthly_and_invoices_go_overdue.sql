/*
 * Business subscriptions are billed monthly, and invoices go overdue.
 *
 * Spec 14 (docs/superpowers/specs/2026-11-26-subscription-billing-and-overdue-design.md).
 * Applies after 20261113600000.
 *
 * Spec 12 left two things open: no run bills a business's subscriptions (the
 * recurring invoices on file stop at July 2026), and nothing moves an
 * invoice from open to overdue once its due date has passed.
 *
 *   1. `bill_account_subscriptions(p_as_of)`: one recurring invoice per
 *      business account and subscription currency for the month before
 *      `p_as_of`, id `INV-<digits>-<YYYYMM>-<currency>-S` (it cannot collide
 *      with spec 12's order invoice, which has no `-S`). One line per
 *      subscription active or suspended (a suspended one bills to contract
 *      end) and started by the month's last day; the line carries the
 *      subscription's monthly amount, net. Tax at the market's rate, or none
 *      with the reason printed for reverse charge or an exemption. Issued on
 *      `p_as_of`, due after the account's terms, FX recorded. Billing starts
 *      with August 2026; an invoice already raised is never raised again.
 *
 *   2. `mark_overdue_invoices(p_as_of)`: every business invoice `open` with
 *      its due date before `p_as_of` becomes `overdue`. Never moved back;
 *      paid, disputed and credited invoices are not touched.
 *
 *   3. `run_invoicing(p_as_of)`: orders, then subscriptions, then overdue.
 *      The night's `invoices` job calls it: still ten jobs.
 *
 *   4. Backfill: subscriptions billed as of 1 Sep, 1 Oct and 1 Nov 2026
 *      (Aug, Sep, Oct); Aug and Sep marked paid 12 days after issue (or on
 *      the due date, if sooner); Oct left open; then the sweep, which also
 *      moves the July invoices and anything else open past its due date to
 *      overdue (spec decision 7).
 *
 *   5. The Scheduled jobs help article: the invoices sentence.
 *
 * Idempotent, one transaction, self-check last (with rolled-back cases).
 */

begin;

/* ========================================= 1. billing the subscriptions -- */

create or replace function public.bill_account_subscriptions(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
<<bs>>
declare
  v_period date := (date_trunc('month', p_as_of) - interval '1 month')::date;
  v_last   date := (date_trunc('month', p_as_of) - interval '1 day')::date;
  g        record;
  a        record;
  m        record;
  v_id     text;
  v_rate   numeric;
  v_note   text;
  v_days   integer;
  v_fx     numeric;
  v_fx_at  date;
  v_net    numeric;
  v_sort   integer;
  v_n      integer;
  n_inv    integer := 0;
  n_subs   integer := 0;
  skips    jsonb := '[]'::jsonb;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, bills subscriptions.';
  end if;
  if p_as_of is null or p_as_of > current_date then
    raise exception 'A subscription invoice cannot be raised on %. A month that has not ended has not been used.',
      coalesce(p_as_of::text, 'no date');
  end if;

  /* Months before August 2026 are on file already. */
  if v_period < date '2026-08-01' then
    return jsonb_build_object('ran_on', p_as_of, 'period', to_char(v_period, 'Mon YYYY'),
                              'invoices', 0, 'subscriptions', 0, 'skipped', skips);
  end if;

  for g in
    select s.account_id, coalesce(s.currency, ea.currency) as currency
      from public.enterprise_subscriptions s
      join public.enterprise_accounts ea on ea.id = s.account_id
     where s.status in ('active', 'suspended') and s.started <= bs.v_last
     group by s.account_id, coalesce(s.currency, ea.currency)
     order by s.account_id, coalesce(s.currency, ea.currency)
  loop
    v_id := format('INV-%s-%s-%s-S', replace(g.account_id, 'ENT-', ''), to_char(v_period, 'YYYYMM'), g.currency);
    if exists (select 1 from public.enterprise_invoices i where i.id = v_id) then
      skips := skips || jsonb_build_object('account', g.account_id, 'currency', g.currency,
        'reason', format('%s is already raised for %s.', v_id, to_char(v_period, 'Mon YYYY')));
      continue;
    end if;

    select * into a from public.enterprise_accounts ea where ea.id = g.account_id;
    select * into m from public.markets mk where mk.code = a.market;
    if m.code is null then
      skips := skips || jsonb_build_object('account', g.account_id, 'currency', g.currency,
        'reason', 'The account has no market, so there is no tax to charge it under.');
      continue;
    end if;
    if not exists (select 1 from public.market_currencies mc
                    where mc.market_code = a.market and mc.currency = g.currency) then
      skips := skips || jsonb_build_object('account', g.account_id, 'currency', g.currency,
        'reason', format('The %s market does not invoice in %s.', a.market, g.currency));
      continue;
    end if;

    v_fx := null; v_fx_at := null;
    if g.currency = 'USD' then
      v_fx := 1; v_fx_at := p_as_of;
    else
      select f.rate, f.as_of into v_fx, v_fx_at
        from public.fx_rates f
       where f.base = 'USD' and f.quote = g.currency and f.as_of <= p_as_of
       order by f.as_of desc limit 1;
    end if;
    if v_fx is null or v_fx <= 0 then
      skips := skips || jsonb_build_object('account', g.account_id, 'currency', g.currency,
        'reason', format('There is no USD rate for %s on or before %s to record on the invoice.', g.currency, p_as_of));
      continue;
    end if;

    if coalesce(a.reverse_charge, false) then
      v_rate := 0;
      v_note := format('Reverse charge — %s to be accounted for by the recipient. No %s has been charged on this invoice.',
                       m.tax_label, m.tax_label);
    elsif coalesce(a.tax_exempt, false) then
      v_rate := 0;
      v_note := format('Exempt — the account holds an exemption from %s, so none has been charged.', m.tax_label);
    else
      v_rate := m.tax_rate;
      v_note := format('Subscriptions for %s, billed monthly.', to_char(v_period, 'Mon YYYY'));
    end if;
    v_days := coalesce(nullif(substring(coalesce(a.terms, '') from '(\d+)'), '')::integer, 30);

    select coalesce(max(i.sort_order), 0) + 1 into v_sort
      from public.enterprise_invoices i where i.account_id = g.account_id;

    insert into public.enterprise_invoices
      (id, account_id, period, kind, issued, due, recurring, oneoff, tax_rate, tax, total,
       status, paid_on, po_ref, note, sort_order, market, currency, fx_rate, fx_as_of)
    values
      (v_id, g.account_id, to_char(v_period, 'Mon YYYY'), 'recurring', p_as_of, p_as_of + v_days,
       0, 0, v_rate, 0, 0, 'open', null, null, v_note, v_sort, a.market, g.currency, v_fx, v_fx_at);

    /* One line per subscription, its monthly amount net. */
    insert into public.enterprise_invoice_lines
      (id, invoice_id, kind, description, seller, partner_id, cost_centre, subscription_id,
       requisition_id, quantity, unit_price, amount, sort_order, vertical)
    select format('%s-L%s', v_id, x.n), v_id, 'subscription', x.name, x.seller, x.partner_id,
           x.cost_centre, x.id, null, x.quantity, x.unit_price, x.monthly, x.n, x.vertical
      from (
        select s.id, s.name, s.seller, s.partner_id, s.cost_centre, s.quantity, s.unit_price, s.monthly, s.vertical,
               row_number() over (order by s.sort_order, s.started, s.id) as n
          from public.enterprise_subscriptions s
          join public.enterprise_accounts ea on ea.id = s.account_id
         where s.account_id = g.account_id and coalesce(s.currency, ea.currency) = g.currency
           and s.status in ('active', 'suspended') and s.started <= bs.v_last
      ) x;
    get diagnostics v_n = row_count;
    n_subs := n_subs + v_n;

    select coalesce(sum(l.amount), 0) into v_net from public.enterprise_invoice_lines l where l.invoice_id = v_id;
    update public.enterprise_invoices i
       set recurring = v_net, tax = round(v_net * v_rate / 100, 2), total = v_net + round(v_net * v_rate / 100, 2)
     where i.id = v_id;
    n_inv := n_inv + 1;
  end loop;

  return jsonb_build_object('ran_on', p_as_of, 'period', to_char(v_period, 'Mon YYYY'),
                            'invoices', n_inv, 'subscriptions', n_subs, 'skipped', skips);
end $$;

comment on function public.bill_account_subscriptions(date) is
  'Raises last month''s recurring invoice for each business account and currency from its active and suspended subscriptions. Run by the night (job "invoices") or the operator.';

revoke all on function public.bill_account_subscriptions(date) from public, anon, authenticated;

/* ============================================== 2. invoices go overdue -- */

create or replace function public.mark_overdue_invoices(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_n integer;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, marks invoices overdue.';
  end if;
  if p_as_of is null or p_as_of > current_date then
    raise exception 'Invoices cannot be marked overdue as of %. Only a day that has come can be past a due date.',
      coalesce(p_as_of::text, 'no date');
  end if;

  update public.enterprise_invoices i set status = 'overdue'
   where i.status = 'open' and i.due < p_as_of;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ran_on', p_as_of, 'overdue', v_n);
end $$;

comment on function public.mark_overdue_invoices(date) is
  'Marks every business invoice still open after its due date overdue. Never moves one back. Run by the night (job "invoices") or the operator.';

revoke all on function public.mark_overdue_invoices(date) from public, anon, authenticated;

/* ================================================ 3. the invoicing run -- */

create or replace function public.run_invoicing(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_orders  jsonb;
  v_subs    jsonb;
  v_overdue jsonb;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, runs the invoicing.';
  end if;
  if p_as_of is null or p_as_of > current_date then
    raise exception 'The invoicing cannot run as of %. A month that has not ended has not been delivered.',
      coalesce(p_as_of::text, 'no date');
  end if;

  v_orders := public.bill_account_orders(p_as_of);
  v_subs := public.bill_account_subscriptions(p_as_of);
  v_overdue := public.mark_overdue_invoices(p_as_of);

  return jsonb_build_object('ran_on', p_as_of, 'orders', v_orders, 'subscriptions', v_subs, 'overdue', v_overdue);
end $$;

comment on function public.run_invoicing(date) is
  'The night''s "invoices" job: last month''s orders, then subscriptions, then every invoice past due marked overdue.';

revoke all on function public.run_invoicing(date) from public, anon, authenticated;

/* ======================================================== 4. the night -- */

/* `run_nightly`, copied from 20261113600000 (its latest definition). Changed
   only: the `invoices` job calls `run_invoicing`. Still ten jobs. */
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

  foreach j in array array['agreements', 'enterprise subscriptions', 'subscriptions', 'documents', 'payments', 'bundle selections', 'baskets', 'invoices', 'risk', 'settlements'] loop
    t0 := clock_timestamp(); res := null; err := null;
    begin
      res := case j
        when 'agreements'               then public.auto_renew_contracts(p_as_of, 'Nightly schedule')
        when 'enterprise subscriptions' then public.renew_enterprise_subscriptions(p_as_of, 'Nightly schedule')
        when 'subscriptions'            then public.renew_subscriptions(p_as_of, 'Nightly schedule')
        when 'documents'                then public.lapse_expired_documents(p_as_of)
        when 'payments'                 then jsonb_build_object('expired', public.expire_stale_payments())
        when 'bundle selections'        then public.delete_unused_bundle_selections(p_as_of)
        when 'baskets'                  then public.run_baskets_night(p_as_of)
        when 'invoices'                 then public.run_invoicing(p_as_of)
        when 'risk'                     then public.refresh_account_risk(p_as_of)
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

/* ===================================================== 5. the backfill -- */

/* Aug, Sep and Oct 2026, through the run, as the night would have raised
   them. A month already raised is skipped, so this is safe to run again. */
select public.bill_account_subscriptions(date '2026-09-01');
select public.bill_account_subscriptions(date '2026-10-01');
select public.bill_account_subscriptions(date '2026-11-01');

/* Aug and Sep were paid: 12 days after issue, or on the due date if that
   is sooner. Oct is left open. */
update public.enterprise_invoices i
   set status = 'paid', paid_on = least(i.due, i.issued + 12)
 where i.id ~ '^INV-\d+-\d{6}-[A-Z]{3}-S$'
   and i.period in ('Aug 2026', 'Sep 2026')
   and i.status in ('open', 'overdue');

/* Everything open past its due date, the July invoices on file included. */
select public.mark_overdue_invoices(current_date);

/* ================================================================= help === */

update kb_articles
   set body = jsonb_set(body, '{1,text}', to_jsonb(replace(body #>> '{1,text}',
                'Invoices: on the 1st, each business account is invoiced for last month''s delivered orders, one line per order line with the requisition it came from.',
                'Invoices: on the 1st, each business account is invoiced for last month''s delivered orders, one line per order line with the requisition it came from, and for its subscriptions, one line per subscription active or suspended that month; then, every night, each business invoice still open after its due date is marked overdue.'))),
       updated = to_char(current_date, 'DD Mon YYYY')
 where view = 'op-jobs'
   and jsonb_typeof(body) = 'array' and jsonb_array_length(body) >= 3
   and body #>> '{1,text}' like '%Invoices: on the 1st%'
   and body::text not like '%is marked overdue%';

/* ============================================================ self-check === */

do $$
<<chk>>
declare
  dry      jsonb;
  j        jsonb;
  v_sig    text;
  v_res    jsonb;
  v_inv    record;
  v_acct   record;
  v_month  date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_last   date := (date_trunc('month', current_date) - interval '1 day')::date;
  v_id     text;
  v_rc_id  text;
  v_paid   text;
  v_n      integer;
  v_sum    numeric;
begin
  if not public.is_scheduler() then
    raise exception 'This session (%) is not one the schedule runs as, so the dry run below would be refused.', session_user;
  end if;

  foreach v_sig in array array['public.bill_account_subscriptions(date)', 'public.mark_overdue_invoices(date)',
                               'public.run_invoicing(date)', 'public.run_nightly(date)'] loop
    if to_regprocedure(v_sig) is null then raise exception '% is missing', v_sig; end if;
    if has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '% is callable through the API', v_sig;
    end if;
  end loop;

  if exists (select 1 from kb_articles where view = 'op-jobs' and body::text like '%Invoices: on the 1st%'
                                         and body::text not like '%is marked overdue%') then
    raise exception 'the Scheduled jobs article does not say that subscriptions are billed and invoices go overdue';
  end if;

  /* The backfill, kept: every subscription invoice adds up, Aug and Sep are
     paid, Oct is open or overdue, and no business invoice is open past due. */
  select count(*) into v_n
    from public.enterprise_invoices i
   where i.id ~ '^INV-\d+-\d{6}-[A-Z]{3}-S$'
     and (i.kind <> 'recurring' or i.oneoff <> 0
          or i.recurring is distinct from (select coalesce(sum(l.amount), 0) from public.enterprise_invoice_lines l where l.invoice_id = i.id)
          or i.total is distinct from i.recurring + i.tax);
  if v_n > 0 then raise exception '% subscription invoices do not add up', v_n; end if;
  if not exists (select 1 from public.enterprise_invoices i where i.id ~ '^INV-\d+-202608-[A-Z]{3}-S$') then
    raise exception 'the backfill raised no subscription invoice for Aug 2026';
  end if;
  if exists (select 1 from public.enterprise_invoices i
              where i.id ~ '^INV-\d+-2026(08|09)-[A-Z]{3}-S$' and i.status <> 'paid') then
    raise exception 'an Aug or Sep 2026 subscription invoice is not paid';
  end if;
  if exists (select 1 from public.enterprise_invoices i
              where i.id ~ '^INV-\d+-202610-[A-Z]{3}-S$' and i.status not in ('open', 'overdue')) then
    raise exception 'an Oct 2026 subscription invoice is neither open nor overdue';
  end if;
  if exists (select 1 from public.enterprise_invoices i where i.status = 'open' and i.due < current_date) then
    raise exception 'a business invoice is still open after its due date';
  end if;

  /* Rolled back: last month's subscription invoices of an account on
     standard tax and of one on reverse charge are raised afresh, each with a
     subscription of its own added; then the sweep. */
  begin
    select ea.id, ea.currency, ea.terms, mk.tax_rate into v_acct
      from public.enterprise_accounts ea join public.markets mk on mk.code = ea.market
     where not coalesce(ea.reverse_charge, false) and not coalesce(ea.tax_exempt, false)
       and exists (select 1 from public.market_currencies mc where mc.market_code = ea.market and mc.currency = ea.currency)
     order by ea.id limit 1;
    if not found then raise exception 'no account on standard tax to check a subscription invoice against'; end if;
    v_id := format('INV-%s-%s-%s-S', replace(v_acct.id, 'ENT-', ''), to_char(v_month, 'YYYYMM'), v_acct.currency);
    delete from public.enterprise_invoices i where i.id = v_id;
    insert into public.enterprise_subscriptions
      (id, account_id, name, seller, vertical, quantity, seats_used, unit_price, unit, monthly,
       started, renews, status, auto_renew, sort_order, currency)
    values ('ESUB-SELFCHECK-STD', v_acct.id, 'Self-check seats', 'Aventa Telecom', 'iot', 3, 0, 100.00, 'per seat/mo', 300.00,
            v_month, v_month + 365, 'active', true, 999, v_acct.currency);

    select ea.id, ea.currency into v_inv
      from public.enterprise_accounts ea
     where coalesce(ea.reverse_charge, false)
       and exists (select 1 from public.market_currencies mc where mc.market_code = ea.market and mc.currency = ea.currency)
     order by ea.id limit 1;
    if not found then raise exception 'no account on reverse charge to check a nil-rated subscription invoice against'; end if;
    v_rc_id := format('INV-%s-%s-%s-S', replace(v_inv.id, 'ENT-', ''), to_char(v_month, 'YYYYMM'), v_inv.currency);
    delete from public.enterprise_invoices i where i.id = v_rc_id;
    insert into public.enterprise_subscriptions
      (id, account_id, name, seller, vertical, quantity, seats_used, unit_price, unit, monthly,
       started, renews, status, auto_renew, sort_order, currency)
    values ('ESUB-SELFCHECK-RC', v_inv.id, 'Self-check seats', 'Aventa Telecom', 'iot', 2, 0, 50.00, 'per seat/mo', 100.00,
            v_month, v_month + 365, 'active', true, 999, v_inv.currency);

    v_res := public.bill_account_subscriptions(current_date);

    /* Standard tax: one line per billable subscription, the totals right. */
    select * into v_inv from public.enterprise_invoices i where i.id = v_id;
    if not found then raise exception 'no invoice % was raised (%)', v_id, v_res; end if;
    select count(*), coalesce(sum(s.monthly), 0) into v_n, v_sum
      from public.enterprise_subscriptions s
      join public.enterprise_accounts ea on ea.id = s.account_id
     where s.account_id = v_acct.id and coalesce(s.currency, ea.currency) = v_acct.currency
       and s.status in ('active', 'suspended') and s.started <= v_last;
    if (select count(*) from public.enterprise_invoice_lines l where l.invoice_id = v_id and l.kind = 'subscription'
                                                                and l.subscription_id is not null) <> v_n then
      raise exception 'the invoice does not have one line for each of the % billable subscriptions', v_n;
    end if;
    if not exists (select 1 from public.enterprise_invoice_lines l
                    where l.invoice_id = v_id and l.subscription_id = 'ESUB-SELFCHECK-STD'
                      and l.quantity = 3 and l.unit_price = 100.00 and l.amount = 300.00
                      and l.description = 'Self-check seats' and l.vertical = 'iot') then
      raise exception 'the invoice has no line for the self-check subscription';
    end if;
    if v_inv.recurring is distinct from v_sum or v_inv.oneoff <> 0
       or v_inv.tax_rate is distinct from v_acct.tax_rate
       or v_inv.tax is distinct from round(v_sum * v_acct.tax_rate / 100, 2)
       or v_inv.total is distinct from v_inv.recurring + v_inv.tax
       or v_inv.kind <> 'recurring' or v_inv.status <> 'open' or v_inv.issued <> current_date
       or v_inv.period <> to_char(v_month, 'Mon YYYY') or v_inv.fx_rate is null then
      raise exception 'the invoice reads % % net %, tax % at %, total %, %',
        v_inv.kind, v_inv.period, v_inv.recurring, v_inv.tax, v_inv.tax_rate, v_inv.total, v_inv.status;
    end if;
    if v_inv.due <> current_date + coalesce(nullif(substring(coalesce(v_acct.terms, '') from '(\d+)'), '')::integer, 30) then
      raise exception 'the invoice is due %, not after the account''s terms (%)', v_inv.due, v_acct.terms;
    end if;

    /* Reverse charge: nil, with the reason on the invoice. */
    select * into v_inv from public.enterprise_invoices i where i.id = v_rc_id;
    if not found then raise exception 'no invoice % was raised for the reverse-charge account (%)', v_rc_id, v_res; end if;
    if v_inv.tax_rate <> 0 or v_inv.tax <> 0 or v_inv.total is distinct from v_inv.recurring
       or coalesce(v_inv.note, '') !~* 'reverse charge' then
      raise exception 'the reverse-charge invoice is taxed % at % with the note "%"', v_inv.tax, v_inv.tax_rate, v_inv.note;
    end if;

    /* Never twice. */
    v_res := public.bill_account_subscriptions(current_date);
    if (v_res ->> 'invoices')::integer <> 0 then
      raise exception 'a second run raised % invoices again', v_res ->> 'invoices';
    end if;

    /* The sweep: an open invoice past due goes overdue; a paid one past due
       stays paid; an overdue one not yet due is not moved back. */
    update public.enterprise_invoices i set due = current_date - 1 where i.id = v_id;
    update public.enterprise_invoices i set status = 'overdue', due = current_date + 5 where i.id = v_rc_id;
    select i.id into v_paid from public.enterprise_invoices i
     where i.status = 'paid' and i.due < current_date order by i.id limit 1;
    v_res := public.mark_overdue_invoices(current_date);
    if (select i.status from public.enterprise_invoices i where i.id = v_id) <> 'overdue' then
      raise exception 'an open invoice past its due date was not marked overdue (%)', v_res;
    end if;
    if (select i.status from public.enterprise_invoices i where i.id = v_rc_id) <> 'overdue' then
      raise exception 'an overdue invoice not yet due was moved back';
    end if;
    if v_paid is not null and (select i.status from public.enterprise_invoices i where i.id = v_paid) <> 'paid' then
      raise exception 'the paid invoice % was moved by the sweep', v_paid;
    end if;

    raise exception using errcode = 'ZZ999', message = 'rolling the subscription check back';
  exception when sqlstate 'ZZ999' then
    null;
  end;

  /* A run dated in the future is refused, by all three. */
  begin
    perform public.bill_account_subscriptions(current_date + 1);
    raise exception 'a subscription billing run dated tomorrow was not refused';
  exception when raise_exception then
    if sqlerrm not like 'A subscription invoice cannot be raised on%' then raise; end if;
  end;
  begin
    perform public.mark_overdue_invoices(current_date + 1);
    raise exception 'an overdue sweep dated tomorrow was not refused';
  exception when raise_exception then
    if sqlerrm not like 'Invoices cannot be marked overdue as of%' then raise; end if;
  end;
  begin
    perform public.run_invoicing(current_date + 1);
    raise exception 'an invoicing run dated tomorrow was not refused';
  exception when raise_exception then
    if sqlerrm not like 'The invoicing cannot run as of%' then raise; end if;
  end;

  /* The night, still ten jobs, dry-run and rolled back; the invoices job
     reports orders, subscriptions and overdue. */
  begin
    dry := public.run_nightly(current_date);
    select l.result into v_res from public.scheduled_job_log l
     where l.job = 'invoices' and l.ran_on = current_date
     order by l.id desc limit 1;
    raise exception using errcode = 'ZZ999', message = 'rolling the dry run back';
  exception when sqlstate 'ZZ999' then
    null;
  end;
  for j in select value from jsonb_array_elements(dry -> 'jobs') loop
    if not (j ->> 'ok')::boolean then
      raise exception 'A dry run of the nightly "%" job fails: %', j ->> 'job', j ->> 'error';
    end if;
  end loop;
  if jsonb_array_length(dry -> 'jobs') <> 10 then
    raise exception 'the dry run ran % jobs, not 10', jsonb_array_length(dry -> 'jobs');
  end if;
  if (dry -> 'jobs' -> 7 ->> 'job') is distinct from 'invoices' then
    raise exception 'the eighth job of the night is %, not invoices', dry -> 'jobs' -> 7 ->> 'job';
  end if;
  if v_res is null or not (v_res ? 'orders' and v_res ? 'subscriptions' and v_res ? 'overdue') then
    raise exception 'the invoices job reported %, not orders, subscriptions and overdue', v_res;
  end if;
end $$;

commit;
