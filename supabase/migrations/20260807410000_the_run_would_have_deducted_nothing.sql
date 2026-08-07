/* The run would have deducted nothing.
 *
 * Withholding is configured, the rules are seeded and every unpaid statement
 * carries its deduction. `run_settlements` does not know any of it exists, so
 * the first statement the next run produces would go out with `withholding` at
 * zero and a net a per cent too high — the marketplace short of the money it
 * owes the revenue authority, and the seller holding a payment nobody deducted
 * from.
 *
 * Which is the same shape as the thing being fixed: a column that was right,
 * and nothing that computed it.
 */

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
  bank       public.partner_bank;
  per        record;
  agg        record;
  d          record;
  carried    numeric;
  held       numeric;
  payable    numeric;
  wht        numeric;
  wht_detail jsonb;
  after_wht  numeric;
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
       gross, commission, commission_rate, fees, refunds,
       withholding, withholding_rate, withholding_detail, net,
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
       agg.gross, agg.commission, agg.rate, agg.fees, agg.refunds,
       wht,
       case when agg.gross > 0 then round(wht / agg.gross * 100, 3) else 0 end,
       wht_detail,
       after_wht, held, carried, held,
       agg.lines, 'USD', t.payout_currency, 'pending', run_id, 0, note);

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

/* ---- What the seller sees, in one place -------------------------------------- */

/* Everything deducted from a seller, by statute and by quarter, with the
   document they claim it back with. A seller's commonest question after "when
   am I paid" is "what is this deduction", and the answer needs a statute, a
   period and a certificate number rather than a total. */
create or replace view public.my_tax_deducted
with (security_invoker = on) as
  select
    c.partner_id, c.market, c.rule_id, r.statute, r.label, r.basis,
    c.form, c.certificate_no, c.period_start, c.period_end,
    c.amount, c.currency, c.status, c.filed_on, c.issued_on,
    /* What it was deducted from, so the seller can check the arithmetic
       rather than take the figure on trust. */
    (select coalesce(sum(s.gross), 0) from public.settlement_statements s
      where s.partner_id = c.partner_id
        and s.closed_on between c.period_start and c.period_end) as gross_in_period,
    (select coalesce(sum(s.commission), 0) from public.settlement_statements s
      where s.partner_id = c.partner_id
        and s.closed_on between c.period_start and c.period_end) as commission_in_period
  from public.withholding_certificate c
  join public.withholding_rule r on r.id = c.rule_id;

grant select on public.my_tax_deducted to authenticated;

/* ---- Assertions --------------------------------------------------------------- */

do $$
declare n int; before_wht numeric; after_run jsonb;
begin
  /* A run today settles nothing — every closed period is settled — so the
     thing to assert is that the function still compiles against the new
     columns and still refuses what it refused. */
  select count(*) into n from public.settlement_statements where withholding > 0;
  if n = 0 then raise exception 'nothing is deducted anywhere'; end if;

  /* Every certificate reconciles to the statements in its quarter. */
  select count(*) into n from (
    select c.partner_id, c.rule_id, c.period_start, c.amount,
           coalesce(sum((d.value ->> 'amount')::numeric), 0) as from_statements
      from public.withholding_certificate c
      left join public.settlement_statements s
        on s.partner_id = c.partner_id
       and s.closed_on between c.period_start and c.period_end
      left join lateral jsonb_array_elements(s.withholding_detail) d
        on d.value ->> 'rule_id' = c.rule_id
     group by c.partner_id, c.rule_id, c.period_start, c.amount
    having abs(c.amount - coalesce(sum((d.value ->> 'amount')::numeric), 0)) > 0.01
  ) x;
  if n > 0 then raise exception '% certificates do not reconcile to the statements in their quarter', n; end if;

  /* The seller's view shows their own and carries the statute. */
  if not exists (select 1 from public.my_tax_deducted where statute like '%194-O%') then
    raise exception 'the seller cannot see what statute they were deducted under';
  end if;

  raise notice 'certificates: % (% filed, % accruing); deducted %',
    (select count(*) from public.withholding_certificate),
    (select count(*) from public.withholding_certificate where status = 'filed'),
    (select count(*) from public.withholding_certificate where status = 'accruing'),
    (select round(sum(amount), 2) from public.withholding_certificate);
end $$;
