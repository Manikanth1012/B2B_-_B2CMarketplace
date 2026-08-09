/* Standing orders, so the netting has something to net.
 *
 * The tables in the previous migration are only a claim until a partner is on
 * one. Five are, chosen so that each of the cases the netting has to get right
 * exists somewhere a person can go and look at it:
 *
 *   Kestrel Devices — a wholesale pack that the month comfortably covers.
 *   TrackWise Telematics — a storefront taken mid-month, so the first charge is
 *     a fraction and the arithmetic behind it is on the row.
 *   PlayForge Games — sandbox access, which is free: a live purchase that
 *     raises no charge at all.
 *   StreamNova Media — Beacon's wholesale voice bundle. One partner buying
 *     another partner's listing, which is the case that proves this is a
 *     marketplace and not a first-party subscription list.
 *   Beacon Reseller Co — a 500-line pack on a quarterly cycle. Three monthly
 *     charges against one statement, and they come to more than the quarter
 *     earned, so the shortfall carries. This is the case worth having: it is
 *     the one where "net it off against what we owe them" runs out of money.
 *
 * Northwind Mobility is onboarding and deliberately has none — a commitment
 * that settles monthly is not taken on by an account that is not trading, and
 * the guard says so.
 */

insert into public.partner_purchase
  (id, partner_id, product_id, product_name, quantity, unit_price, currency,
   billing_period, started_on, ordered_by, note)
values
  ('PP-1002-01', 'PTR-1002', 'SKU-7002', 'Wholesale connectivity pack — 500 lines',
   1, 3900.00, 'USD', 'monthly', '2026-07-01', 'Rohan Mehta',
   'Bundled with the device range for the enterprise channel.'),
  ('PP-1011-01', 'PTR-1011', 'SKU-7001', 'White-label storefront',
   1, 249.00, 'USD', 'monthly', '2026-07-18', 'Anjali Rao',
   'Fleet customers order through our own branding.'),
  ('PP-1005-01', 'PTR-1005', 'SKU-7003', 'Partner API and sandbox access',
   1, 0.00, 'USD', 'monthly', '2026-07-01', 'Dev Sharma',
   'Sandbox for the entitlement integration.'),
  ('PP-1001-01', 'PTR-1001', 'SKU-7009', 'Beacon wholesale voice bundle — 200 lines',
   20, 9.80, 'USD', 'monthly', '2026-07-01', 'Meera Iyer',
   'Voice minutes bundled with the content plans.'),
  ('PP-1009-01', 'PTR-1009', 'SKU-7002', 'Wholesale connectivity pack — 500 lines',
   1, 3900.00, 'USD', 'monthly', '2026-07-01', 'Wanjiru Otieno',
   'The lines we resell under our own brand.')
on conflict (id) do nothing;

/* The statements these fall in, netted. Without this the seed is five rows
   nobody has settled and the shortfall case is a claim rather than a record. */
do $$
declare s text;
begin
  for s in
    select id from public.settlement_statements
     where partner_id in ('PTR-1001','PTR-1002','PTR-1005','PTR-1009','PTR-1011')
       and status not in ('approved', 'paid')
     order by partner_id, period_start
  loop
    perform public.apply_settlement_adjustments(s);
  end loop;
end $$;

/* --------------------------------------------------------------- assertions */

do $$
declare n integer; g numeric; r numeric;
begin
  select count(*) into n from public.partner_purchase;
  if n < 5 then
    raise exception 'Only % standing orders were seeded.', n;
  end if;

  /* Free means free. A zero charge on a statement is a line a partner has to
     read past. */
  select count(*) into n from public.partner_charge where gross <= 0;
  if n > 0 then raise exception '% charges were raised for nothing.', n; end if;

  /* One charge per purchase per calendar month, never per settlement period.
     Beacon settles quarterly, so a quarter has to carry three. */
  select count(*) into n from public.partner_charge
   where purchase_id = 'PP-1009-01' and period_start >= '2026-07-01' and period_start < '2026-10-01';
  if n <> 3 then
    raise exception 'Beacon''s quarter raised % monthly charges, not 3.', n;
  end if;

  /* The pro-rata is real: TrackWise started on the 18th of a 31-day month. */
  select gross into g from public.partner_charge
   where purchase_id = 'PP-1011-01' and period_start <= '2026-07-18' and period_end >= '2026-07-18';
  if g is null or g >= 249.00 then
    raise exception 'A storefront taken on the 18th was charged % for July.', coalesce(g::text, 'nothing');
  end if;

  /* And the shortfall carries rather than making a statement pay less than
     nothing. */
  select sum(gross - recovered) into r from public.partner_charge where partner_id = 'PTR-1009';
  if coalesce(r, 0) <= 0 then
    raise exception 'Beacon''s quarter covered the whole wholesale bill, so the shortfall case is not on file.';
  end if;

  select min(net) into g from public.settlement_statements
   where partner_id in ('PTR-1001','PTR-1002','PTR-1005','PTR-1009','PTR-1011');
  if g < 0 then
    raise exception 'A statement was netted to %, which is a payment the marketplace would be asking for.', g;
  end if;
end $$;
