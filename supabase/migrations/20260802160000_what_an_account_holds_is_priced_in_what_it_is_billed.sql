-- The invoice lines moved and the subscriptions behind them did not.
--
-- `enterprise_subscriptions.unit_price` is what the account holds; the invoice
-- lines are what it was charged for holding it. They are the same commitment
-- seen twice, and the integration suite has always asserted they agree — it
-- caught this within a minute of the lines being converted: the invoice billed
-- 865,640 for what the subscription record priced at 6,700.
--
-- The account is billed in the currency of its most recent invoice, so that is
-- what its holdings are priced in, converted at that invoice's own rate.

alter table enterprise_subscriptions
  add column if not exists currency text references currencies(code);

do $$
declare a record; latest record;
begin
  for a in select distinct account_id from enterprise_subscriptions loop
    /* The latest *recurring* invoice, not the latest invoice. A one-off raised
       afterwards is not what the account's holdings are billed on, and taking
       it converted the subscriptions at the wrong market's rate — the numbers
       then missed by exactly the ratio of the two currencies. */
    select currency, fx_rate into latest
      from enterprise_invoices
     where account_id = a.account_id and kind = 'recurring'
     order by issued desc limit 1;

    if latest is null then continue; end if;

    /* `monthly` is a stored derivation of unit_price × quantity and the table
       checks it, so it moves in the same statement. Converting one and not the
       other is the same mistake as converting a header and not its lines, one
       table further down. */
    update enterprise_subscriptions s set
      unit_price = round(s.unit_price * latest.fx_rate, 2),
      monthly    = round(round(s.unit_price * latest.fx_rate, 2) * s.quantity, 2),
      currency   = latest.currency
     where s.account_id = a.account_id and s.currency is null;
  end loop;
end $$;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare s text;
begin
  /* What the account holds is priced in what it is billed in. */
  select string_agg(sub.account_id, ', ') into s
    from (
      select distinct s2.account_id, s2.currency,
             (select i.currency from enterprise_invoices i
               where i.account_id = s2.account_id and i.kind = 'recurring'
               order by i.issued desc limit 1) as billed_in
        from enterprise_subscriptions s2
    ) sub
   where sub.currency is distinct from sub.billed_in;
  if s is not null then raise exception 'these accounts hold and are billed in different currencies: %', s; end if;

  /* And the two records of the same commitment agree — on the *current*
     recurring invoice only. Older invoices billed what the account held at the
     time, in the currency of the time, and are not expected to match today's
     holdings; asserting over all of them compares a July invoice to an August
     subscription list and fails for a reason that is not a fault. */
  select string_agg(x.id, ', ') into s
    from (
      select i.id, i.account_id,
             (select round(sum(l.amount), 2) from enterprise_invoice_lines l
               where l.invoice_id = i.id and l.kind = 'subscription') as billed,
             (select round(sum(s2.unit_price * s2.quantity), 2)
                from enterprise_subscriptions s2
               /* Every subscription on the account, not only the active ones —
                  the recurring invoice bills the lot, and filtering to active
                  here misses by exactly the inactive one's value. */
               where s2.account_id = i.account_id) as held,
             row_number() over (partition by i.account_id order by i.issued desc) as rn
        from enterprise_invoices i
       where i.kind = 'recurring'
    ) x
   where x.rn = 1 and x.billed is not null and x.held is not null
     and abs(x.billed - x.held) > 1.0;
  if s is not null then
    raise exception 'the current recurring invoice bills something other than what the account holds: %', s;
  end if;
end $$;
