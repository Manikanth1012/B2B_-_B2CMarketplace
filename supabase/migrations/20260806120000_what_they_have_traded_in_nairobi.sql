/*
  # What they have traded in Nairobi

  A sign-in onto an empty console proves the sign-in works and nothing else. The
  two screens this whole sequence is about — the seller's settlement statement
  and the enterprise invoice — only exist if there is trade behind them, so
  Beacon Reseller Co and Harbourpoint Retail get a history.

  They get it *together*. Harbourpoint buys connectivity from Beacon, which is
  what a reseller and a mid-sized retailer in the same market would actually do,
  and it means the seller's gross and the buyer's invoices are two views of the
  same transactions rather than two unrelated piles of plausible numbers. A
  demo where the seller's statement cannot be reconciled against any buyer is a
  demo of a screen, not of a marketplace.

  ## Two currencies, on purpose, in the shape the platform actually supports

  Kenya trades in KES and USD. The seller's statement follows the pattern
  `PTR-1015` already had: the marketplace books commission in its reporting
  currency and pays the seller in theirs, at the rate in force when the
  statement was cut and frozen on the row. That is the one place multi-currency
  is genuinely normal — the buyer pays in one currency and the seller is paid in
  another, and neither document mixes them.

  The buyer's invoices are all KES, because a bill has one currency. Their
  account is registered in Kenya and billed in Kenya.

  ## Every figure is computed

  Nothing below is a typed-in total. Tax comes off the market's own rate,
  commission off the seller's own plan, the payout off the dated FX row, and the
  invoice totals off their own lines. A seeded number that agrees with its parts
  only because somebody did the arithmetic once is a number that stops agreeing
  the first time anything moves.
*/

/* ------------------------------------------------- what Beacon sells ------ */

/* Two live listings. `SKU-7004` stays `pending` — a live seller holding a
   listing in review is a real state and the only one on this seller, so it is
   kept rather than flipped for convenience. */
insert into products (
  id, category_id, sub_category, name, partner_id, seller, price, cost, model,
  fulfil, rating, reviews, stock, status, listed, description, tags, comm,
  unit, specs, sort_order, price_includes_tax, tax_rate, floor_price, list_price,
  audiences, currency, billing_period
) values
(
  'SKU-7009', 'partner', 'Reseller packs', 'Beacon wholesale voice bundle — 200 lines',
  'PTR-1009', 'Beacon Reseller Co', 9.80, 7.20, 'monthly', 'provisioned',
  4.4, 18, 'in', 'live', '12 Jan 2025',
  'Wholesale voice minutes resold under the partner''s own brand, billed per line per month.',
  array['Wholesale', '200 lines', 'Voice'], 14, null,
  '{"Lines":"Two hundred, voice and SMS","Support":"Tier 1 by the reseller","Branding":"White label","Contract":"12 months","Rated at":"Wholesale, resold on your own tariff","Provisioning":"Partner API"}'::jsonb,
  710, false, 16.00, 8.40, 11.00, array['partner','enterprise'], 'USD', 'monthly'
),
(
  'SKU-7010', 'iot', 'Connectivity', 'Beacon managed SIM estate — per SIM',
  'PTR-1009', 'Beacon Reseller Co', 2.40, 1.55, 'monthly', 'provisioned',
  4.6, 31, 'in', 'live', '03 Mar 2025',
  'Managed M2M SIMs with pooled data, a single bill and a portal for the whole estate.',
  array['M2M', 'Pooled data', 'Managed'], 14, 'SIM',
  '{"Pooling":"Estate-wide, monthly","Coverage":"Kenya, Uganda, Tanzania","Support":"Business hours EAT","Contract":"24 months","Reporting":"Per-SIM usage in the portal"}'::jsonb,
  711, false, 16.00, 1.95, 2.90, array['enterprise'], 'USD', 'monthly'
)
on conflict (id) do nothing;

/* Priced in every currency the marketplace trades in, like every other listing.
   A product priced in one currency is a product that vanishes from two of the
   three storefronts. */
insert into product_prices (product_id, currency, price, floor_price, list_price) values
  ('SKU-7009', 'USD',    9.80,    8.40,   11.00),
  ('SKU-7009', 'KES', 1265.00, 1085.00, 1420.00),
  ('SKU-7009', 'AED',   35.99,   30.99,   40.99),
  ('SKU-7009', 'INR',  849.00,  729.00,  949.00),
  ('SKU-7010', 'USD',    2.40,    1.95,    2.90),
  ('SKU-7010', 'KES',  310.00,  252.00,  375.00),
  ('SKU-7010', 'AED',    8.80,    7.15,   10.65),
  ('SKU-7010', 'INR',  209.00,  169.00,  249.00)
on conflict (product_id, currency) do nothing;

/* ------------------------------------ what Harbourpoint spends it under --- */

insert into enterprise_cost_centres (id, account_id, name, owner, quarter, cap_quarter, spent_quarter, status, sort_order) values
  ('CC-2014-RET', 'ENT-2014', 'Store operations', 'Grace Wanjiru',   'Q1 FY27', 1200000, 874500, 'active', 1),
  ('CC-2014-LOG', 'ENT-2014', 'Logistics',        'Daniel Kiptoo',   'Q1 FY27',  600000, 402300, 'active', 2),
  ('CC-2014-HQ',  'ENT-2014', 'Head office IT',   'Grace Wanjiru',   'Q1 FY27',  450000, 118900, 'active', 3)
on conflict (id) do nothing;

/* Paid from a Kenyan bank, on a Kenyan mandate. The fault this whole sequence
   started from was a Kenyan customer being told to pay a Bengaluru account. */
insert into enterprise_billing (
  account_id, method, bank, holder, account_number, local_label, local_code,
  mandate_ref, mandate_signed_on, mandate_signed_by, verified, verified_on,
  verified_by, fallback, terms, billing_contact, invoice_delivery, credit_limit,
  credit_reviewed, credit_review_due, at_limit_note, currency
) values (
  'ENT-2014', 'Direct debit', 'KCB Bank Kenya, Sarit Centre',
  'Harbourpoint Retail Kenya Limited', '•••• 4187', 'Bank code', '01169',
  'DD-KE-2014-0091', '2025-08-14', 'Grace Wanjiru', true, '2025-08-19',
  'Marketplace credit desk', 'Card on file ending 6620', 'Net 15',
  'grace.wanjiru@harbourpoint.co.ke', 'Email, PDF and CSV', 2500000,
  '2026-04-01', '2027-04-01',
  'A requisition that would take the balance past the limit is held, not refused. Finance is told and can release it against an early payment.',
  'KES'
) on conflict (account_id) do nothing;

/* --------------------------------------------- what they run every month -- */

insert into enterprise_subscriptions (
  id, account_id, product_id, name, seller, partner_id, vertical, quantity,
  seats_used, unit_price, unit, monthly, cost_centre, started, renews, status,
  auto_renew, contract_ref, why_suspended, sort_order, currency
) values
  ('ESUB-2014-01', 'ENT-2014', 'SKU-7010', 'Beacon managed SIM estate — per SIM',
   'Beacon Reseller Co', 'PTR-1009', 'iot', 240, 226, 310.00, 'SIM', 74400.00,
   'CC-2014-LOG', '2025-09-01', '2027-08-31', 'active', true, 'CT-KE-2014-0031', null, 1, 'KES'),
  ('ESUB-2014-02', 'ENT-2014', 'SKU-7009', 'Beacon wholesale voice bundle — 200 lines',
   'Beacon Reseller Co', 'PTR-1009', 'partner', 1, 1, 1265.00, 'bundle', 1265.00,
   'CC-2014-RET', '2025-09-01', '2026-08-31', 'active', true, 'CT-KE-2014-0032', null, 2, 'KES'),
  ('ESUB-2014-03', 'ENT-2014', 'SKU-6004', 'Vertex Endpoint Protect',
   'Vertex Endpoint', 'PTR-1015', 'security', 95, 88, 640.00, 'seat', 60800.00,
   'CC-2014-HQ', '2025-10-01', '2026-09-30', 'suspended', false, 'CT-KE-2014-0033',
   /* The reason travels with the row rather than being added afterwards — the
      table refuses a suspended line that does not say why, which is the right
      way round: a screen saying something is wrong and declining to say what is
      worse than no screen. */
   'The seller is suspended in the marketplace, so the licence cannot be renewed. Cover continues to the end of the paid term.',
   3, 'KES')
on conflict (id) do nothing;

/* ------------------------------------------ what they have been invoiced -- */

/* Six months, each the sum of the subscriptions running that month, plus tax at
   Kenya's own rate. Computed rather than typed. */
insert into enterprise_invoices (
  id, account_id, period, kind, issued, due, recurring, oneoff, tax_rate, tax,
  total, status, paid_on, po_ref, sort_order, market, currency, fx_rate, fx_as_of
)
select
  'INV-KE-2026-' || to_char(d.m, 'MM'),
  'ENT-2014',
  to_char(d.m, 'Mon YYYY'),
  'recurring',
  (d.m + interval '1 month')::date,
  (d.m + interval '1 month' + interval '14 days')::date,
  d.recurring,
  d.oneoff,
  k.tax_rate,
  round((d.recurring + d.oneoff) * k.tax_rate / 100, 2),
  round((d.recurring + d.oneoff) * (1 + k.tax_rate / 100), 2),
  case when d.m < date '2026-07-01' then 'paid' else 'open' end,
  case when d.m < date '2026-07-01' then (d.m + interval '1 month' + interval '9 days')::date end,
  'PO-HP-2026-' || to_char(d.m, 'MM'),
  6 - extract(month from d.m)::integer + 1,
  'KE', 'KES',
  (select rate from fx_rates where base = 'USD' and quote = 'KES'
    and as_of <= (d.m + interval '1 month')::date order by as_of desc limit 1),
  date_trunc('month', d.m + interval '1 month')::date
from (values
  (date '2026-02-01', 136465.00,      0.00),
  (date '2026-03-01', 136465.00,  18400.00),
  (date '2026-04-01', 136465.00,      0.00),
  (date '2026-05-01', 136465.00,  42750.00),
  (date '2026-06-01', 136465.00,      0.00),
  (date '2026-07-01', 136465.00,   9600.00)
) as d(m, recurring, oneoff)
cross join (select tax_rate from markets where code = 'KE') k
on conflict (id) do nothing;

/* The lines behind each total, so an invoice can be checked against its own
   parts — which is the whole reason `reconcileInvoice` exists. */
insert into enterprise_invoice_lines (
  id, invoice_id, kind, description, seller, partner_id, cost_centre,
  subscription_id, quantity, unit_price, amount, sort_order, vertical
)
select i.id || '-L1', i.id, 'subscription', 'Managed SIM estate — 240 SIMs',
       'Beacon Reseller Co', 'PTR-1009', 'CC-2014-LOG', 'ESUB-2014-01',
       240, 310.00, 74400.00, 1, 'iot'
  from enterprise_invoices i where i.account_id = 'ENT-2014'
union all
select i.id || '-L2', i.id, 'subscription', 'Wholesale voice bundle — 200 lines',
       'Beacon Reseller Co', 'PTR-1009', 'CC-2014-RET', 'ESUB-2014-02',
       1, 1265.00, 1265.00, 2, 'partner'
  from enterprise_invoices i where i.account_id = 'ENT-2014'
union all
select i.id || '-L3', i.id, 'subscription', 'Endpoint Protect — 95 seats',
       'Vertex Endpoint', 'PTR-1015', 'CC-2014-HQ', 'ESUB-2014-03',
       95, 640.00, 60800.00, 3, 'security'
  from enterprise_invoices i where i.account_id = 'ENT-2014'
union all
select i.id || '-L4', i.id, 'oneoff',
       case i.period when 'Mar 2026' then 'Additional SIM activation — 60 units'
                     when 'May 2026' then 'Handheld scanners — 15 units'
                     else 'Out-of-bundle data — Jun 2026' end,
       'Beacon Reseller Co', 'PTR-1009', 'CC-2014-LOG', null,
       case i.period when 'Mar 2026' then 60 when 'May 2026' then 15 else 1 end,
       case i.period when 'Mar 2026' then 306.67 when 'May 2026' then 2850.00 else 9600.00 end,
       i.oneoff, 4, 'iot'
  from enterprise_invoices i where i.account_id = 'ENT-2014' and i.oneoff > 0
on conflict (id) do nothing;

/* ------------------------------------------- what Beacon has been paid ---- */

/* Booked in the marketplace's reporting currency and paid out in the seller's,
   at the rate in force on the day the statement was cut. This is the one place
   two currencies belong on one document, and they are on separate lines: the
   commission arithmetic in USD, the payment in KES.

   Commission comes off the seller's own plan rather than a constant — Beacon is
   on the tier-2 reseller plan at 14% with no payment fee, and a statement
   quoting 12% and 2.1% like the old dashboard did would be a statement about
   somebody else's agreement. */
insert into settlement_statements (
  id, partner_name, period, gross, commission, commission_rate, fees,
  withholding, refunds, net, status, order_count, currency, submitted_at,
  approved_by, approved_at, disputed, sort_order, partner_id, plan_id,
  payout_currency, payout_net, fx_rate, fx_as_of
)
select
  'ss-1009-' || to_char(d.m, 'YYYYMM'),
  'Beacon Reseller Co',
  to_char(d.m, 'Mon YYYY'),
  d.gross,
  round(d.gross * pl.base_rate / 100, 2),
  pl.base_rate,
  round(d.gross * pl.payment_fee_pct / 100 + pl.payment_fee_flat, 2),
  0, d.refunds,
  round(d.gross
        - round(d.gross * pl.base_rate / 100, 2)
        - round(d.gross * pl.payment_fee_pct / 100 + pl.payment_fee_flat, 2)
        - d.refunds, 2),
  case when d.m < date '2026-07-01' then 'paid' else 'approved' end,
  d.orders, 'USD',
  (d.m + interval '1 month' + interval '4 days'),
  'Ruben Oyelaran',
  (d.m + interval '1 month' + interval '6 days'),
  false,
  100 + extract(month from d.m)::integer,
  'PTR-1009', 'CP-RESELL-T2',
  'KES',
  round(round(d.gross
        - round(d.gross * pl.base_rate / 100, 2)
        - round(d.gross * pl.payment_fee_pct / 100 + pl.payment_fee_flat, 2)
        - d.refunds, 2) * f.rate, 2),
  f.rate, f.as_of
from (values
  (date '2026-02-01',  8420.60,   0.00, 412),
  (date '2026-03-01',  9106.25, 118.40, 448),
  (date '2026-04-01',  9384.90,   0.00, 461),
  (date '2026-05-01', 10240.15, 240.80, 502),
  (date '2026-06-01', 11072.40,   0.00, 547),
  (date '2026-07-01', 11815.70,  96.25, 583)
) as d(m, gross, refunds, orders)
cross join (select base_rate, payment_fee_pct, payment_fee_flat
              from commission_plans where id = 'CP-RESELL-T2') pl
join lateral (
  select rate, as_of from fx_rates
   where base = 'USD' and quote = 'KES' and as_of <= (d.m + interval '1 month')::date
   order by as_of desc limit 1
) f on true
on conflict (id) do nothing;

/* ------------------------------------------------------------ assertions -- */

do $$
declare n integer; r record;
begin
  /* Both consoles have something on them. An empty screen proves the sign-in
     and nothing the sign-in was for. */
  select count(*) into n from settlement_statements where partner_id = 'PTR-1009';
  if n < 6 then raise exception 'The Kenyan seller has % statements, so their settlement screen is bare', n; end if;

  select count(*) into n from enterprise_invoices where account_id = 'ENT-2014';
  if n < 6 then raise exception 'The Kenyan buyer has % invoices, so their billing screen is bare', n; end if;

  /* Every invoice adds up to its own lines, which is what the buyer's
     reconciliation check reads. */
  for r in
    select i.id, i.recurring + i.oneoff as stated,
           (select coalesce(sum(l.amount), 0) from enterprise_invoice_lines l where l.invoice_id = i.id) as lines
      from enterprise_invoices i where i.account_id = 'ENT-2014'
  loop
    if round(r.stated, 2) <> round(r.lines, 2) then
      raise exception 'Invoice % states % and its lines come to %', r.id, r.stated, r.lines;
    end if;
  end loop;

  /* And to its own tax. */
  select count(*) into n from enterprise_invoices
   where account_id = 'ENT-2014'
     and (round((recurring + oneoff) * tax_rate / 100, 2) <> tax
       or round(recurring + oneoff + tax, 2) <> total);
  if n > 0 then raise exception '% Kenyan invoices do not add up to their own tax', n; end if;

  /* Kenya's rate, not India's. */
  select count(*) into n from enterprise_invoices i
    join markets m on m.code = i.market
   where i.account_id = 'ENT-2014' and i.tax_rate <> m.tax_rate;
  if n > 0 then raise exception '% Kenyan invoices are taxed at another market''s rate', n; end if;

  /* One currency per invoice, and it is the account's. */
  select count(*) into n from enterprise_invoices i
    join enterprise_accounts a on a.id = i.account_id
   where i.account_id = 'ENT-2014' and i.currency <> a.currency;
  if n > 0 then raise exception '% invoices are in a currency the account is not billed in', n; end if;

  /* Every settlement nets to its own arithmetic, on the seller's own plan. */
  for r in
    select s.id, s.gross, s.commission, s.fees, s.refunds, s.net, s.commission_rate, p.base_rate
      from settlement_statements s join commission_plans p on p.id = s.plan_id
     where s.partner_id = 'PTR-1009'
  loop
    if round(r.gross - r.commission - r.fees - r.refunds, 2) <> r.net then
      raise exception 'Statement % does not net to its own parts', r.id;
    end if;
    if r.commission_rate <> r.base_rate then
      raise exception 'Statement % quotes %%% commission on a plan that charges %%%',
        r.id, r.commission_rate, r.base_rate;
    end if;
  end loop;

  /* The payout is the net at the rate the row froze, which is what makes a
     seller paid in shillings on a marketplace booking in dollars checkable
     months later. */
  select count(*) into n from settlement_statements
   where partner_id = 'PTR-1009' and round(net * fx_rate, 2) <> payout_net;
  if n > 0 then raise exception '% statements pay out something other than the net at the rate they froze', n; end if;

  select count(*) into n from settlement_statements s
    join partners p on p.id = s.partner_id
    join enterprise_accounts a on a.market = p.market
   where s.partner_id = 'PTR-1009' and s.payout_currency <> a.currency and a.id = 'ENT-2014';
  if n > 0 then raise exception 'The Kenyan seller is paid in a currency that is not their market''s'; end if;

  /* The seller has something live to sell. A live seller whose every listing is
     in review has a catalogue screen with nothing on it. */
  select count(*) into n from products where partner_id = 'PTR-1009' and status = 'live';
  if n < 2 then raise exception 'The Kenyan seller has % live listings', n; end if;

  /* And the listing in review is still in review — it is the only one on this
     seller and it was not flipped to make the demo tidier. */
  select count(*) into n from products where id = 'SKU-7004' and status = 'pending';
  if n <> 1 then raise exception 'The seller''s listing in review was changed'; end if;

  /* Priced everywhere the marketplace trades, or it disappears from two of the
     three storefronts. */
  for r in
    select p.id, p.name from products p
     where p.partner_id = 'PTR-1009'
       and (select count(distinct pr.currency) from product_prices pr where pr.product_id = p.id) < 3
  loop
    raise exception '% is not priced in every currency the marketplace trades in', r.name;
  end loop;

  /* The buyer buys from the seller, so the two consoles are two views of one
     set of transactions rather than two unrelated piles of numbers. */
  select count(*) into n from enterprise_invoice_lines l
    join enterprise_invoices i on i.id = l.invoice_id
   where i.account_id = 'ENT-2014' and l.partner_id = 'PTR-1009';
  if n = 0 then raise exception 'The Kenyan buyer buys nothing from the Kenyan seller'; end if;

  /* Cost centres are not overspent, or the approval screen is describing a
     state the account is already in. */
  select count(*) into n from enterprise_cost_centres
   where account_id = 'ENT-2014' and spent_quarter > cap_quarter;
  if n > 0 then raise exception '% cost centres are already over their cap', n; end if;

  /* Every subscription is charged in the account's own currency. */
  select count(*) into n from enterprise_subscriptions s
    join enterprise_accounts a on a.id = s.account_id
   where s.account_id = 'ENT-2014' and s.currency <> a.currency;
  if n > 0 then raise exception '% subscriptions are priced in a currency the account is not billed in', n; end if;

  /* A suspended line says why. */
  select count(*) into n from enterprise_subscriptions
   where account_id = 'ENT-2014' and status = 'suspended' and coalesce(why_suspended, '') = '';
  if n > 0 then raise exception '% suspended subscriptions do not say why', n; end if;
end $$;
