/*
 * A business is invoiced for what it ordered.
 *
 * Spec 12 (docs/superpowers/specs/2026-11-13-business-invoices-and-recent-trade-design.md).
 * Applies after 20261113300000.
 *
 * Until now no code wrote an enterprise invoice: every one on file is demo
 * data, and `orders.invoice_id` waited for something to fill it. So a refund
 * could not be traced from an invoice line back to the requisition, and a
 * bundle's parts could not be grouped on the refund form.
 *
 *   1. `bill_account_orders(p_as_of)`: one invoice per business account and
 *      currency for the month before `p_as_of`, holding every order of that
 *      account that is delivered (on the last rung of its ladder), not
 *      failed, cancelled or refunded, not yet invoiced, and placed before the
 *      month of `p_as_of` (and on or after 1 Aug 2026, when this run takes
 *      over from the invoices on file). One line per order line, carrying the
 *      order's requisition and cost centre, net of the tax the order carried;
 *      tax at the market's rate, or none with the reason printed for an
 *      account on reverse charge or holding an exemption. Issued on
 *      `p_as_of`, due after the account's terms ("Net 30" is 30 days). The
 *      orders are stamped with the invoice. An account and currency that
 *      already has that month's invoice waits for the next month: an
 *      invoice is never changed after it is raised.
 *
 *   2. The night gains `invoices` (after `baskets`, before `settlements`):
 *      nine jobs. On the 1st it raises last month's invoices; on other nights
 *      it raises one only for an account that had nothing delivered by the
 *      1st and has now.
 *
 *   3. The Scheduled jobs help article is told about the ninth job.
 *
 * Idempotent, one transaction, self-check last (with a rolled-back invoice).
 */

begin;

/* ============================================== 1. what can be billed -- */

/* An order the run may put on an invoice raised for orders placed before
   `p_before`. */
create or replace function public.order_is_billable(p_order public.orders, p_before timestamptz)
returns boolean language sql stable set search_path = public as $$
  select p_order.account_id is not null
     and p_order.invoice_id is null
     and p_order.created_at >= timestamptz '2026-08-01 00:00:00+00'
     and p_order.created_at < p_before
     and not coalesce(p_order.failed, false)
     and coalesce(p_order.status, '') not in ('cancelled', 'refunded', 'failed')
     and array_length(p_order.stages, 1) is not null
     and coalesce(p_order.stage, 0) >= array_length(p_order.stages, 1) - 1
$$;

comment on function public.order_is_billable(public.orders, timestamptz) is
  'A business order delivered, not failed, cancelled or refunded, not yet invoiced, and placed between 1 Aug 2026 and p_before.';

revoke all on function public.order_is_billable(public.orders, timestamptz) from public, anon, authenticated;

/* ===================================================== 2. the billing -- */

create or replace function public.bill_account_orders(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
<<bl>>
declare
  v_period date := (date_trunc('month', p_as_of) - interval '1 month')::date;
  v_before timestamptz := (date_trunc('month', p_as_of)::timestamp at time zone 'UTC');
  g        record;
  a        record;
  m        record;
  v_id     text;
  v_rate   numeric;
  v_note   text;
  v_days   integer;
  v_fx     numeric;
  v_fx_at  date;
  v_po     text;
  v_net    numeric;
  v_sort   integer;
  v_n      integer;
  n_inv    integer := 0;
  n_ord    integer := 0;
  n_lines  integer := 0;
  skips    jsonb := '[]'::jsonb;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, raises invoices.';
  end if;
  if p_as_of is null or p_as_of > current_date then
    raise exception 'An invoice cannot be raised on %. A month that has not ended has not been delivered.',
      coalesce(p_as_of::text, 'no date');
  end if;

  for g in
    select o.account_id, o.currency
      from public.orders o
     where public.order_is_billable(o, bl.v_before)
     group by o.account_id, o.currency
     order by o.account_id, o.currency
  loop
    v_id := format('INV-%s-%s-%s', replace(g.account_id, 'ENT-', ''), to_char(v_period, 'YYYYMM'), g.currency);
    if exists (select 1 from public.enterprise_invoices i where i.id = v_id) then
      skips := skips || jsonb_build_object('account', g.account_id, 'currency', g.currency,
        'reason', format('%s is already raised for %s; what was delivered since goes on next month''s.',
                         v_id, to_char(v_period, 'Mon YYYY')));
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
      v_note := format('Orders delivered by %s and not invoiced before.',
                       to_char((v_before - interval '1 day') at time zone 'UTC', 'DD Mon YYYY'));
    end if;
    v_days := coalesce(nullif(substring(coalesce(a.terms, '') from '(\d+)'), '')::integer, 30);

    select case when count(*) = count(o.po_ref) and count(distinct o.po_ref) = 1 then min(o.po_ref) end
      into v_po
      from public.orders o
     where o.account_id = g.account_id and o.currency = g.currency
       and public.order_is_billable(o, bl.v_before);

    select coalesce(max(i.sort_order), 0) + 1 into v_sort
      from public.enterprise_invoices i where i.account_id = g.account_id;

    insert into public.enterprise_invoices
      (id, account_id, period, kind, issued, due, recurring, oneoff, tax_rate, tax, total,
       status, paid_on, po_ref, note, sort_order, market, currency, fx_rate, fx_as_of)
    values
      (v_id, g.account_id, to_char(v_period, 'Mon YYYY'), 'oneoff', p_as_of, p_as_of + v_days,
       0, 0, v_rate, 0, 0, 'open', null, v_po, v_note, v_sort, a.market, g.currency, v_fx, v_fx_at);

    /* One line per order line, net of the tax the order carried. */
    insert into public.enterprise_invoice_lines
      (id, invoice_id, kind, description, seller, partner_id, cost_centre, subscription_id,
       requisition_id, quantity, unit_price, amount, sort_order, vertical)
    select format('%s-L%s', v_id, x.n), v_id, 'oneoff', x.product_name, x.seller, x.partner_id,
           x.cost_centre, null, x.requisition_id, x.quantity,
           round(x.price / x.gross, 2), round(x.price * x.quantity / x.gross, 2), x.n, x.vertical
      from (
        select i.product_name, coalesce(p.seller, o.seller, 'Aventa Telecom') as seller, p.partner_id,
               o.cost_centre, o.requisition_id, coalesce(i.quantity, 1) as quantity, i.price, o.vertical,
               1 + coalesce(o.tax_rate, m.tax_rate, 0) / 100.0 as gross,
               row_number() over (order by o.created_at, o.order_ref, i.id) as n
          from public.orders o
          join public.order_items i on i.order_id = o.id
          left join public.products p on p.id = i.product_id
         where o.account_id = g.account_id and o.currency = g.currency
           and public.order_is_billable(o, bl.v_before)
      ) x;
    get diagnostics v_n = row_count;
    n_lines := n_lines + v_n;

    select coalesce(sum(l.amount), 0) into v_net from public.enterprise_invoice_lines l where l.invoice_id = v_id;
    update public.enterprise_invoices i
       set oneoff = v_net, tax = round(v_net * v_rate / 100, 2), total = v_net + round(v_net * v_rate / 100, 2)
     where i.id = v_id;

    update public.orders o set invoice_id = v_id
     where o.account_id = g.account_id and o.currency = g.currency
       and public.order_is_billable(o, bl.v_before);
    get diagnostics v_n = row_count;
    n_ord := n_ord + v_n;
    n_inv := n_inv + 1;
  end loop;

  return jsonb_build_object('ran_on', p_as_of, 'period', to_char(v_period, 'Mon YYYY'),
                            'invoices', n_inv, 'orders', n_ord, 'lines', n_lines, 'skipped', skips);
end $$;

comment on function public.bill_account_orders(date) is
  'Raises last month''s invoice for each business account and currency from its delivered, uninvoiced orders. Run by the night (job "invoices") or the operator.';

revoke all on function public.bill_account_orders(date) from public, anon, authenticated;

/* ======================================================== 3. the night -- */

/* `run_nightly`, copied from 20261113200000 (its latest definition). Changed
   only: the `invoices` job, after `baskets` and before `settlements`, so
   nine. */
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

  foreach j in array array['agreements', 'enterprise subscriptions', 'subscriptions', 'documents', 'payments', 'bundle selections', 'baskets', 'invoices', 'settlements'] loop
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
        when 'invoices'                 then public.bill_account_orders(p_as_of)
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

/* ================================================================= help === */

update kb_articles
   set body = jsonb_set(
                jsonb_set(body, '{0,text}', to_jsonb('Every night at 00:30 UTC (06:00 in India, 03:30 in Kenya) the marketplace runs nine jobs, one after the other. Each one is listed here for each night: whether it finished OK or failed, a short summary of what it did, and the error in full when it failed. A job that fails changes nothing, and the jobs after it still run.'::text)),
                '{1}', jsonb_build_object('kind', 'prose', 'heading', 'The nine jobs',
                  'text', 'Agreements: an agreement with auto-renew on whose notice deadline has passed is renewed for a like term. Enterprise subscriptions: a business subscription renews for a year on its date, or ends there if auto-renew is off or it is suspended. Subscriptions: a shopper subscription the marketplace sells is charged for the cycle that starts and its date moves on; a bundle part keeps the bundle price for 12 months, then the published price. Documents: a seller document past its expiry stops counting as accepted. Payments: a payment nobody answered for 15 minutes expires, and the unpaid orders behind it are removed. Bundle selections: a priced bundle whose hold ended more than 7 days ago and that is on no basket, requisition or order is deleted. Baskets: every basket line is checked against stock again and flagged where it no longer fits, and baskets nobody has touched for 90 days are cleared. Invoices: on the 1st, each business account is invoiced for last month''s delivered orders, one line per order line with the requisition it came from. Settlements: every closed period not yet settled is settled, oldest first.')),
       updated = to_char(current_date, 'DD Mon YYYY')
 where view = 'op-jobs'
   and jsonb_typeof(body) = 'array' and jsonb_array_length(body) >= 3
   and body::text not like '%Invoices: on the 1st%';

/* ============================================================ self-check === */

do $$
<<chk>>
declare
  dry      jsonb;
  j        jsonb;
  v_sig    text;
  v_res    jsonb;
  v_inv    record;
  v_line   record;
  v_order  uuid := gen_random_uuid();
  v_acct   record;
  v_prod   record;
  v_month  date := (date_trunc('month', current_date) - interval '1 month')::date;
  v_id     text;
begin
  if not public.is_scheduler() then
    raise exception 'This session (%) is not one the schedule runs as, so the dry run below would be refused.', session_user;
  end if;

  foreach v_sig in array array['public.order_is_billable(public.orders,timestamptz)',
                               'public.bill_account_orders(date)', 'public.run_nightly(date)'] loop
    if to_regprocedure(v_sig) is null then raise exception '% is missing', v_sig; end if;
    if has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '% is callable through the API', v_sig;
    end if;
  end loop;

  if exists (select 1 from kb_articles where view = 'op-jobs' and body::text not like '%Invoices: on the 1st%') then
    raise exception 'the Scheduled jobs article does not mention the invoices job';
  end if;

  /* An invoice, rolled back: a delivered order for an account on standard
     tax, placed last month, one line. It is invoiced once, with the
     requisition and cost centre on the line, net of the order's tax; a
     second run raises nothing. */
  begin
    select ea.id, ea.market, ea.currency, ea.terms, mk.tax_rate into v_acct
      from public.enterprise_accounts ea join public.markets mk on mk.code = ea.market
     where not coalesce(ea.reverse_charge, false) and not coalesce(ea.tax_exempt, false)
       and not exists (select 1 from public.enterprise_invoices i
                        where i.id = format('INV-%s-%s-%s', replace(ea.id, 'ENT-', ''), to_char(v_month, 'YYYYMM'), ea.currency))
     order by ea.id limit 1;
    if not found then raise exception 'no account on standard tax to check an invoice against'; end if;
    select p.id, p.name, p.seller, p.partner_id into v_prod
      from public.products p
     where 'enterprise' = any (p.audiences) and coalesce(p.fulfilment_route, 'seller') = 'seller'
     order by p.id limit 1;

    insert into public.orders (id, order_ref, status, total, subtotal, tax, discount, payment_method,
                               buyer_name, created_at, placed_date, seller, vertical, failed, stage, stages,
                               account_id, cost_centre, po_ref, currency, market, tax_rate)
    values (v_order, 'ORD-SELFCHECK-INV', 'delivered', 1180, 1000, 180, 0, 'On account',
            'Self-check', v_month + 14, to_char(v_month + 14, 'DD Mon YYYY'), v_prod.seller, 'iot', false, 4,
            array['Ordered', 'Approved', 'Packed', 'In transit', 'Delivered'],
            v_acct.id, null, 'PO-SELFCHECK', v_acct.currency, v_acct.market, v_acct.tax_rate);
    insert into public.order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status)
    values (gen_random_uuid(), v_order, v_prod.id, v_prod.name, round(1180.0 / 2, 2), 2, 'shipped', 'delivered');

    v_res := public.bill_account_orders(current_date);
    v_id := format('INV-%s-%s-%s', replace(v_acct.id, 'ENT-', ''), to_char(v_month, 'YYYYMM'), v_acct.currency);
    select * into v_inv from public.enterprise_invoices i where i.id = v_id;
    if not found then raise exception 'no invoice % was raised for a delivered order (%)', v_id, v_res; end if;
    if (select o.invoice_id from public.orders o where o.id = v_order) is distinct from v_id then
      raise exception 'the order was not stamped with its invoice';
    end if;
    select * into v_line from public.enterprise_invoice_lines l
     where l.invoice_id = v_id and l.description = v_prod.name and l.quantity = 2;
    if not found then raise exception 'the invoice has no line for the order''s line'; end if;
    if v_line.amount is distinct from round(1180.0 / (1 + v_acct.tax_rate / 100.0), 2) then
      raise exception 'the line is % net, not %', v_line.amount, round(1180.0 / (1 + v_acct.tax_rate / 100.0), 2);
    end if;
    if v_inv.total is distinct from v_inv.oneoff + v_inv.tax or v_inv.tax_rate is distinct from v_acct.tax_rate
       or v_inv.status <> 'open' or v_inv.kind <> 'oneoff' or v_inv.issued <> current_date then
      raise exception 'the invoice reads total %, net %, tax % at %, %', v_inv.total, v_inv.oneoff, v_inv.tax, v_inv.tax_rate, v_inv.status;
    end if;
    if v_inv.due <> current_date + coalesce(nullif(substring(coalesce(v_acct.terms, '') from '(\d+)'), '')::integer, 30) then
      raise exception 'the invoice is due %, not after the account''s terms (%)', v_inv.due, v_acct.terms;
    end if;

    v_res := public.bill_account_orders(current_date);
    if (v_res ->> 'orders')::integer <> 0 then
      raise exception 'a second run billed % orders again', v_res ->> 'orders';
    end if;

    raise exception using errcode = 'ZZ999', message = 'rolling the invoice check back';
  exception when sqlstate 'ZZ999' then
    null;
  end;

  /* A run dated in the future is refused. */
  begin
    perform public.bill_account_orders(current_date + 1);
    raise exception 'a billing run dated tomorrow was not refused';
  exception when raise_exception then
    if sqlerrm not like 'An invoice cannot be raised on%' then raise; end if;
  end;

  /* The night, now with nine jobs, dry-run and rolled back. */
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
  if jsonb_array_length(dry -> 'jobs') <> 9 then
    raise exception 'the dry run ran % jobs, not 9', jsonb_array_length(dry -> 'jobs');
  end if;
  if (dry -> 'jobs' -> 7 ->> 'job') is distinct from 'invoices' then
    raise exception 'the eighth job of the night is %, not invoices', dry -> 'jobs' -> 7 ->> 'job';
  end if;
end $$;

commit;
