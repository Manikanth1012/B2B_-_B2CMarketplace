/* A market with an account in it and no billing.
 *
 * Meridian Foods has been an Emirati enterprise customer since the account was
 * seeded. It has cost centres, an approval policy, a wallet and a reverse-charge
 * tax position — and no subscriptions and no invoices. Twelve invoices exist
 * across India and Kenya and none in the Emirates.
 *
 * That is the shape this build keeps finding: a screen built, a rule written,
 * and the data that would exercise it never made. Three things in particular
 * have never been run against a real document:
 *
 *   The UAE tax rate. Five per cent, configured since markets were added, and
 *   applied to nothing.
 *
 *   Reverse charge. `enterprise_accounts.reverse_charge` is true on this
 *   account alone. Under it the supplier charges no VAT and states that the
 *   recipient accounts for it — so an invoice that quietly adds 5% would be
 *   wrong in a way the customer's own return would catch.
 *
 *   And, from the migration that follows this one, the Emirati e-invoicing
 *   regime, which went live in July 2026 and would otherwise have had nothing
 *   to clear.
 */

/* ---- The guard that made reverse charge impossible to express ---------------- */

/* `guard_bill_currency` refuses any tax rate but the market's standard one. It
 * is a good rule and it was too strong: it makes every legitimate zero-rating
 * unrepresentable — reverse charge, an exemption certificate, an export. The
 * account has carried `reverse_charge` since it was created and the guard would
 * not let an invoice honour it.
 *
 * Nil is allowed where the account's own tax position says nil, and only then.
 * Anything else is still refused, because a rate typed by hand is how a whole
 * market's VAT quietly goes missing.
 */
create or replace function public.guard_bill_currency()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare m record; ok boolean; a record;
begin
  select * into m from markets where code = new.market;
  if m is null then raise exception 'A bill has to be raised in a market.'; end if;

  select exists (
    select 1 from market_currencies mc
     where mc.market_code = new.market and mc.currency = new.currency
  ) into ok;
  if not ok then
    raise exception 'A % bill cannot be in % — that market does not trade in it.', m.name, new.currency;
  end if;

  if new.tax_rate is distinct from m.tax_rate then
    /* The only rate other than the standard one that a document may carry, and
       only where the customer's recorded position says so. */
    if tg_table_name = 'enterprise_invoices' and new.tax_rate = 0 then
      select * into a from enterprise_accounts where id = new.account_id;
      if a.id is null or not (a.reverse_charge or a.tax_exempt) then
        raise exception
          'A % invoice is taxed at % percent (%). Nil is only for an account on reverse charge or holding an exemption, and this one is on neither.',
          m.name, m.tax_rate, m.tax_label;
      end if;
      /* And it has to say so on the face of the document, or the customer
         cannot account for the tax they have just been made responsible for. */
      if coalesce(new.note, '') !~* '(reverse charge|exempt)' then
        raise exception
          'An invoice charging no % has to say why on the document. The recipient accounts for the tax and needs to be told that they are.',
          m.tax_label;
      end if;
    else
      raise exception 'A % bill is taxed at % percent (%), not % percent.',
        m.name, m.tax_rate, m.tax_label, new.tax_rate;
    end if;
  end if;

  if new.fx_rate is null or new.fx_rate <= 0 then
    raise exception 'A bill records the rate it was converted at.';
  end if;

  return new;
end $$;

insert into public.enterprise_subscriptions
  (id, account_id, product_id, name, seller, partner_id, vertical, quantity, seats_used,
   unit_price, unit, monthly, cost_centre, started, renews, status, auto_renew,
   contract_ref, sort_order, currency) values
  ('ESUB-2012-01', 'ENT-2012', 'SKU-6002', 'Sentinel MDR — 24/7', 'Sentinel Cyber', 'PTR-1003',
   'security', 180, 174, 34.90, 'per seat/mo', 6282.00, 'CC-2012-IT',
   '2025-09-01', '2026-09-01', 'active', true, 'MF-SEC-2025-01', 1, 'AED'),
  ('ESUB-2012-02', 'ENT-2012', 'SKU-6005', 'ClearVault Mail Defence', 'ClearVault Cloud', 'PTR-1010',
   'security', 180, 180, 12.50, 'per seat/mo', 2250.00, 'CC-2012-IT',
   '2025-09-01', '2026-09-01', 'active', true, 'MF-SEC-2025-02', 2, 'AED'),
  /* The cold chain is why they are a customer at all — a food distributor
     with three hundred and twenty refrigerated units to keep inside a
     temperature band. */
  ('ESUB-2012-03', 'ENT-2012', 'SKU-5002', 'IoT Connect 2 GB', 'Aventa Telecom', null,
   'iot', 320, 314, 11.40, 'per SIM/mo', 3648.00, 'CC-2012-COLD',
   '2025-10-15', '2026-10-15', 'active', true, 'MF-IOT-2025-01', 3, 'AED')
on conflict (id) do nothing;

/* Three months of invoices, in dirhams, with no VAT charged and the reason
 * printed. Under reverse charge the supplier states the taxable amount and the
 * recipient accounts for the tax on their own return; an invoice that added 5%
 * would be collected twice and disallowed once.
 */
do $$
declare
  m record;
  inv_id text;
  net numeric := 12180.00;
begin
  for m in
    select * from (values
      ('May 2026', date '2026-06-01', date '2026-06-15', 'paid',    date '2026-06-11', 'PO-MF-2026-05', 1),
      ('Jun 2026', date '2026-07-01', date '2026-07-15', 'paid',    date '2026-07-09', 'PO-MF-2026-06', 2),
      ('Jul 2026', date '2026-08-01', date '2026-08-15', 'open',    null,              'PO-MF-2026-07', 3)
    ) as t(period, issued, due, status, paid_on, po_ref, ord)
  loop
    inv_id := format('INV-AE-2026-%s', lpad((m.ord + 4)::text, 2, '0'));

    insert into public.enterprise_invoices
      (id, account_id, period, kind, issued, due, recurring, oneoff,
       tax_rate, tax, total, status, paid_on, po_ref, note, sort_order,
       market, currency, fx_rate, fx_as_of)
    values (inv_id, 'ENT-2012', m.period, 'recurring', m.issued, m.due,
            net, 0.00,
            /* Nil, and the note says which article makes it nil. A zero with
               no explanation reads as a bug on an invoice. */
            0.00, 0.00, net, m.status, m.paid_on, m.po_ref,
            'Reverse charge — VAT to be accounted for by the recipient under Article 48 of the UAE VAT Law. No VAT has been charged on this invoice.',
            m.ord, 'AE', 'AED',
            (select rate from public.fx_rates where base = 'USD' and quote = 'AED'
              and as_of <= m.issued order by as_of desc limit 1),
            (select as_of from public.fx_rates where base = 'USD' and quote = 'AED'
              and as_of <= m.issued order by as_of desc limit 1))
    on conflict (id) do nothing;

    insert into public.enterprise_invoice_lines
      (id, invoice_id, kind, description, seller, partner_id, cost_centre,
       subscription_id, quantity, unit_price, amount, sort_order, vertical) values
      (inv_id || '-L1', inv_id, 'subscription', 'Sentinel MDR — 24/7, 180 seats',
       'Sentinel Cyber', 'PTR-1003', 'CC-2012-IT', 'ESUB-2012-01', 180, 34.90, 6282.00, 1, 'security'),
      (inv_id || '-L2', inv_id, 'subscription', 'ClearVault Mail Defence, 180 seats',
       'ClearVault Cloud', 'PTR-1010', 'CC-2012-IT', 'ESUB-2012-02', 180, 12.50, 2250.00, 2, 'security'),
      (inv_id || '-L3', inv_id, 'subscription', 'IoT Connect 2 GB — 320 cold-chain SIMs',
       'Aventa Telecom', null, 'CC-2012-COLD', 'ESUB-2012-03', 320, 11.40, 3648.00, 3, 'iot')
    on conflict (id) do nothing;
  end loop;
end $$;

/* ---- Assertions --------------------------------------------------------------- */

do $$
declare n int; t numeric; bad text;
begin
  /* All three markets now issue invoices, which is what makes the tax model
     testable rather than merely configured. */
  select count(distinct market) into n from public.enterprise_invoices;
  if n < 3 then raise exception 'only % markets issue enterprise invoices', n; end if;

  /* Reverse charge charges nothing, and says why. An invoice with no tax and
     no explanation reads as a bug. */
  select count(*) into n from public.enterprise_invoices i
    join public.enterprise_accounts a on a.id = i.account_id
   where a.reverse_charge and (i.tax <> 0 or i.note is null or i.note not ilike '%reverse charge%');
  if n > 0 then raise exception '% reverse-charge invoices charge tax or do not say they do not', n; end if;

  /* And every invoice equals the lines behind it. */
  select string_agg(x.id, ', ') into bad from (
    select i.id from public.enterprise_invoices i
      join public.enterprise_invoice_lines l on l.invoice_id = i.id
     where i.id like 'INV-AE-%'
     group by i.id, i.recurring
    having abs(i.recurring - sum(l.amount)) > 0.01
  ) x;
  if bad is not null then raise exception 'Emirati invoices that do not equal their lines: %', bad; end if;

  /* The total is the net plus the tax, which under reverse charge is the net. */
  select count(*) into n from public.enterprise_invoices
   where id like 'INV-AE-%' and abs(total - (recurring + oneoff + tax)) > 0.01;
  if n > 0 then raise exception '% Emirati invoices do not add up', n; end if;

  /* Frozen at a rate that was on file when they were issued. */
  select count(*) into n from public.enterprise_invoices
   where id like 'INV-AE-%' and (fx_rate is null or fx_as_of is null);
  if n > 0 then raise exception '% Emirati invoices carry no dated rate', n; end if;

  /* The guard still refuses a rate nobody is entitled to. Nil where the
     account is not on reverse charge is a whole market's VAT going missing. */
  begin
    update public.enterprise_invoices set tax_rate = 0, tax = 0
     where id = 'INV-KE-2026-06';
    raise exception 'a Kenyan invoice zero-rated itself';
  exception when others then
    if sqlerrm not like '%on neither%' then
      raise exception 'the zero-rating failed on % rather than the guard', sqlerrm;
    end if;
  end;

  /* And refuses a nil that does not say why. */
  begin
    update public.enterprise_invoices set note = 'Monthly billing'
     where id = 'INV-AE-2026-05';
    raise exception 'a reverse-charge invoice dropped its explanation';
  exception when others then
    if sqlerrm not like '%has to say why%' then
      raise exception 'dropping the note failed on % rather than the guard', sqlerrm;
    end if;
  end;

  select sum(total) into t from public.enterprise_invoices where market = 'AE';
  raise notice 'Emirati invoices: % totalling AED %',
    (select count(*) from public.enterprise_invoices where market = 'AE'), t;
end $$;
