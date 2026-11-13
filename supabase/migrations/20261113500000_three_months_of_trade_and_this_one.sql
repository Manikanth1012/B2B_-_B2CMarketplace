/*
 * Three months of trade, and this one: demo orders for Aug, Sep, Oct and
 * Nov 2026.
 *
 * Spec 12 (docs/superpowers/specs/2026-11-13-business-invoices-and-recent-trade-design.md).
 * Applies after 20261113400000, whose billing run invoices the business half.
 *
 * The demo's trade stopped on 7 Aug 2026. This adds, for the months since:
 *
 *   - Business: 19 requisitions over five accounts (SmartBuild, Brightline,
 *     Greencity, Harbourpoint, Meridian), approved and ordered, each a line
 *     by line order. Two are configured bundles (the Smart office starter
 *     kit, SmartBuild in September and Greencity in October), so a refund of
 *     a bundle part has its bundle to group under. Aug to Oct orders are
 *     delivered; November's are a mix of delivered, in transit and placed.
 *   - Invoices: `bill_account_orders` run as of 1 Sep, 1 Oct and 1 Nov, so
 *     each account is invoiced for the month's delivered orders exactly as
 *     the night will do from now on. August's and September's are marked
 *     paid; October's are open. November's orders wait for 1 Dec.
 *   - Shoppers: 9 orders for Priya Raman (INR), Wanjiru Kamau (KES) and
 *     Otieno Odhiambo (USD), devices from sellers that ship, delivered except
 *     the latest.
 *
 * Every row is marked: requisitions `REQ-D26mm-nn`, their lines `RL-D26mm-nn-k`,
 * orders `ORD-D26mm-nn` (business) and `ORD-D26mm-Snn` (shopper), bundles
 * `BS-D26mm-nn`, payments `PAY-D26mm-…`, invoices `INV-<account>-2026mm-<currency>`.
 * The app mints `REQ-` plus four digits and `ORD-` plus eight, so none can
 * collide. To take it all out again:
 *
 *   delete from enterprise_invoices i where i.id in (select distinct o.invoice_id from orders o where o.order_ref like 'ORD-D26%');
 *   delete from orders where order_ref like 'ORD-D26%';
 *   delete from enterprise_requisitions where id like 'REQ-D26%';
 *   delete from bundle_selections where id like 'BS-D26%';
 *
 * Nothing here touches settlement, the ledger or stock: seller statements are
 * built from their own records, and the months they cover are left as they
 * are. A seeded SmartBuild requisition would be held on credit as it is
 * approved (the account is over its limit, which the credit tests rely on);
 * each is recorded as released by finance, as a held one is.
 *
 * Idempotent (fixed ids, `on conflict do nothing`), one transaction,
 * self-check last.
 */

begin;

/* ===================================================== the business half == */

create temporary table d_req (
  id text, account_id text, raised_by text, decided_by text, raised_on date, decided_on date,
  title text, vertical text, cost_centre text, po_ref text, bundle text, ord_status text, ord_stage int
) on commit drop;

create temporary table d_line (
  req text, n int, product_id text, quantity int
) on commit drop;

create temporary table d_priced (
  req text, n int, product_id text, name text, seller text, partner_id text, quantity int,
  list numeric, floor numeric, unit numeric
) on commit drop;

insert into d_req values
  -- August
  ('REQ-D2608-01', 'ENT-2007', 'EU-2007-04', 'EU-2007-01', '2026-08-12', '2026-08-14', 'Kestrel K7 handsets for the depot leads', 'device', 'CC-1000',      'PO-SB-2026-08D',  null,             'delivered', 4),
  ('REQ-D2608-02', 'ENT-2011', 'EU-2011-01', 'EU-2011-01', '2026-08-18', '2026-08-19', 'Kestrel K9 Lite for the field sales team', 'device', null,          'PO-BF-2026-08D',  null,             'delivered', 4),
  ('REQ-D2608-03', 'ENT-2013', 'EU-2013-01', 'EU-2013-01', '2026-08-24', '2026-08-25', 'Asset trackers for the site equipment',   'iot',    null,          'PO-GC-2026-08D',  null,             'delivered', 4),
  ('REQ-D2608-04', 'ENT-2014', 'EU-2014-01', 'EU-2014-01', '2026-08-10', '2026-08-11', 'Kestrel K7 for store managers',          'device', 'CC-2014-RET', 'PO-HP-2026-08D',  null,             'delivered', 4),
  ('REQ-D2608-05', 'ENT-2012', 'EU-2012-01', 'EU-2012-01', '2026-08-19', '2026-08-20', 'Cold-chain sensors for the Jebel Ali store', 'iot', 'CC-2012-COLD', 'PO-MF-2026-08D', null,             'delivered', 4),
  -- September
  ('REQ-D2609-01', 'ENT-2007', 'EU-2007-05', 'EU-2007-01', '2026-09-08', '2026-09-09', 'Smart office starter kit for the Pune office', 'iot', 'CC-4100',   'PO-SB-2026-09D',  'BS-D2609-01',    'delivered', 4),
  ('REQ-D2609-02', 'ENT-2011', 'EU-2011-01', 'EU-2011-01', '2026-09-15', '2026-09-16', 'Mesh Wi-Fi for the regional offices',    'device', null,          'PO-BF-2026-09D',  null,             'delivered', 4),
  ('REQ-D2609-04', 'ENT-2014', 'EU-2014-01', 'EU-2014-01', '2026-09-21', '2026-09-22', 'Trackers for the delivery fleet',        'iot',    'CC-2014-LOG', 'PO-HP-2026-09D',  null,             'delivered', 4),
  ('REQ-D2609-05', 'ENT-2012', 'EU-2012-01', 'EU-2012-01', '2026-09-16', '2026-09-17', 'LTE gateways for the depots',            'iot',    'CC-2012-DEPOT', 'PO-MF-2026-09D', null,            'delivered', 4),
  -- October
  ('REQ-D2610-01', 'ENT-2007', 'EU-2007-04', 'EU-2007-01', '2026-10-06', '2026-10-07', 'Asset trackers for the returnable crates', 'iot',  'CC-4100',     'PO-SB-2026-10D',  null,             'delivered', 4),
  ('REQ-D2610-02', 'ENT-2011', 'EU-2011-01', 'EU-2011-01', '2026-10-20', '2026-10-21', 'Kestrel Tab 11 for the merchandisers',   'device', null,          'PO-BF-2026-10D',  null,             'delivered', 4),
  ('REQ-D2610-03', 'ENT-2013', 'EU-2013-01', 'EU-2013-01', '2026-10-12', '2026-10-13', 'Smart office starter kit for the show flat', 'iot', null,          'PO-GC-2026-10D',  'BS-D2610-03',    'delivered', 4),
  ('REQ-D2610-04', 'ENT-2014', 'EU-2014-01', 'EU-2014-01', '2026-10-14', '2026-10-15', 'Mesh Wi-Fi for head office',             'device', 'CC-2014-HQ',  'PO-HP-2026-10D',  null,             'delivered', 4),
  ('REQ-D2610-05', 'ENT-2012', 'EU-2012-01', 'EU-2012-01', '2026-10-25', '2026-10-26', '5G fixed wireless for the pop-up stores', 'device', 'CC-2012-IT', 'PO-MF-2026-10D',  null,             'delivered', 4),
  -- November
  ('REQ-D2611-01', 'ENT-2007', 'EU-2007-05', 'EU-2007-01', '2026-11-03', '2026-11-04', 'Mesh Wi-Fi for the new IT room',         'device', 'CC-2200',     'PO-SB-2026-11D',  null,             'in transit', 3),
  ('REQ-D2611-02', 'ENT-2011', 'EU-2011-01', 'EU-2011-01', '2026-11-09', '2026-11-10', '5G fixed wireless for two warehouses',   'device', null,          'PO-BF-2026-11D',  null,             'placed', 1),
  ('REQ-D2611-03', 'ENT-2013', 'EU-2013-01', 'EU-2013-01', '2026-11-05', '2026-11-06', 'Kestrel K9 Pro for the directors',       'device', null,          'PO-GC-2026-11D',  null,             'delivered', 4),
  ('REQ-D2611-04', 'ENT-2014', 'EU-2014-01', 'EU-2014-01', '2026-11-08', '2026-11-09', 'Kestrel Tab 11 for stocktaking',         'device', 'CC-2014-HQ',  'PO-HP-2026-11D',  null,             'in transit', 3),
  ('REQ-D2611-05', 'ENT-2012', 'EU-2012-01', 'EU-2012-01', '2026-11-10', '2026-11-11', 'More cold-chain sensors for Al Quoz',    'iot',    'CC-2012-COLD', 'PO-MF-2026-11D', null,             'placed', 1);

insert into d_line values
  ('REQ-D2608-01', 1, 'SKU-4003', 4),
  ('REQ-D2608-02', 1, 'SKU-4002', 10),
  ('REQ-D2608-03', 1, 'SKU-5005', 25),
  ('REQ-D2608-04', 1, 'SKU-4003', 15),
  ('REQ-D2608-05', 1, 'SKU-5003', 30),
  ('REQ-D2609-01', 1, 'SKU-5003', 20),
  ('REQ-D2609-01', 2, 'SKU-5007', 1),
  ('REQ-D2609-02', 1, 'SKU-4004', 8),
  ('REQ-D2609-04', 1, 'SKU-5005', 10),
  ('REQ-D2609-05', 1, 'SKU-5007', 4),
  ('REQ-D2610-01', 1, 'SKU-5005', 6),
  ('REQ-D2610-02', 1, 'SKU-4006', 12),
  ('REQ-D2610-03', 1, 'SKU-5005', 20),
  ('REQ-D2610-03', 2, 'SKU-5007', 1),
  ('REQ-D2610-04', 1, 'SKU-4004', 5),
  ('REQ-D2610-05', 1, 'SKU-4005', 5),
  ('REQ-D2611-01', 1, 'SKU-4004', 3),
  ('REQ-D2611-02', 1, 'SKU-4005', 6),
  ('REQ-D2611-03', 1, 'SKU-4001', 3),
  ('REQ-D2611-04', 1, 'SKU-4006', 4),
  ('REQ-D2611-05', 1, 'SKU-5003', 20);

do $$
<<biz>>
declare
  r      record;
  a      record;
  v_cur  text;
  v_rate numeric;
  v_disc numeric;
  v_amt  numeric;
  v_list numeric;
  v_oid  uuid;
  v_ref  text;
  v_at   timestamptz;
  v_sel  text;
  v_seller text;
  v_email text;
begin
  for r in select * from d_req order by id loop
    select ea.* into a from public.enterprise_accounts ea where ea.id = r.account_id;
    if a.id is null then raise exception 'there is no account % to seed', r.account_id; end if;
    v_cur := a.currency;
    select mk.tax_rate into v_rate from public.markets mk where mk.code = a.market;
    v_at := (r.decided_on + time '09:30') at time zone 'UTC';

    /* The lines at today's published price in the account's money, a bundle
       part at the template's discount (never below the seller's floor). */
    delete from d_priced where req = r.id;
    select coalesce(t.discount_pct, 0) into v_disc from public.bundle_templates t where t.id = 'BT-SEED-OFFICE';
    insert into d_priced
    select l2.req, l2.n, p.id, p.name, p.seller, p.partner_id, l2.quantity, pp.price, pp.floor_price,
           case when r.bundle is null then pp.price
                else greatest(round(pp.price * (1 - coalesce(v_disc, 0) / 100.0), 2), coalesce(pp.floor_price, 0)) end
      from d_line l2
      join public.products p on p.id = l2.product_id
      join public.product_prices pp on pp.product_id = p.id and pp.currency = v_cur
     where l2.req = r.id;
    if (select count(*) from d_priced where req = r.id) <> (select count(*) from d_line where req = r.id) then
      raise exception '% names a product with no % price', r.id, v_cur;
    end if;
    select sum(round(unit * quantity, 2)), sum(round(list * quantity, 2)) into v_amt, v_list from d_priced where req = r.id;
    select case when count(distinct seller) = 1 then min(seller) end into v_seller from d_priced where req = r.id;

    /* The bundle, configured the day it was raised. */
    v_sel := r.bundle;
    if v_sel is not null then
      insert into public.bundle_selections
        (id, template_id, account_id, user_id, currency, choices, quantity, total, parts_total, priced_at, valid_until)
      select v_sel, 'BT-SEED-OFFICE', r.account_id, null, v_cur,
             jsonb_build_object(
               'BS-SEED-OFFICE-1', jsonb_build_array(jsonb_build_object('product_id', (select product_id from d_priced where req = r.id and n = 1),
                                                                        'quantity', (select quantity from d_priced where req = r.id and n = 1))),
               'BS-SEED-OFFICE-2', jsonb_build_array(jsonb_build_object('product_id', (select product_id from d_priced where req = r.id and n = 2),
                                                                        'quantity', (select quantity from d_priced where req = r.id and n = 2)))),
             1, v_amt, v_list, (r.raised_on + time '08:00') at time zone 'UTC', (r.raised_on + 7 + time '08:00') at time zone 'UTC'
      on conflict (id) do nothing;
      insert into public.bundle_selection_lines
        (id, selection_id, product_id, name, partner_id, seller, quantity, list_unit_price, unit_price, floor_unit_price, sort_order)
      select format('%s-%s', v_sel, d.n), v_sel, d.product_id, d.name, d.partner_id, d.seller, d.quantity,
             d.list, d.unit, d.floor, d.n
        from d_priced d where d.req = r.id
      on conflict (id) do nothing;
    end if;

    select u.email into v_email from public.enterprise_users u where u.id = r.raised_by;

    insert into public.enterprise_requisitions
      (id, account_id, raised_by, raised_on, raised_at, title, vertical, cost_centre, amount, model, reason,
       need, policy_note, state, decided_by, decided_on, decision_note, order_ref, po_ref, sort_order,
       currency, product_id, quantity, credit_hold, credit_note)
    values
      (r.id, r.account_id, r.raised_by, r.raised_on, to_char(r.raised_on, 'DD Mon'), r.title, r.vertical, r.cost_centre,
       v_amt, 'oneoff', 'Demo trade for ' || to_char(r.raised_on, 'Mon YYYY') || '.',
       'none', 'Recorded and approved under the account''s buying rules', 'approved', r.decided_by, r.decided_on,
       'Approved.', null, r.po_ref, 900, v_cur, null, 1, false, null)
    on conflict (id) do nothing;

    insert into public.enterprise_requisition_lines
      (id, requisition_id, product_id, name, seller, partner_id, quantity, unit_price, line_total, sort_order,
       quote_line_id, bundle_selection_id, account_price_id, off_contract, off_contract_rule, off_contract_reason)
    select format('RL-%s-%s', replace(r.id, 'REQ-', ''), d.n), r.id, d.product_id, d.name, d.seller, d.partner_id,
           d.quantity, d.unit, round(d.unit * d.quantity, 2), d.n, null, v_sel, null, false, null, null
      from d_priced d where d.req = r.id
    on conflict (id) do nothing;

    /* Approved past SmartBuild's credit limit, a requisition is held as it
       is written; these were released by finance, as a held one is. */
    update public.enterprise_requisitions q set credit_hold = false, credit_note = null
     where q.id = r.id and q.credit_hold;

    v_ref := replace(r.id, 'REQ-', 'ORD-');
    v_oid := md5(v_ref)::uuid;
    insert into public.orders
      (id, order_ref, status, total, subtotal, tax, discount, payment_method, buyer_name, buyer_email,
       created_at, placed_date, seller, vertical, failed, stage, stages, account_id, requisition_id,
       ordered_by, cost_centre, po_ref, currency, market, tax_rate)
    values
      (v_oid, v_ref, r.ord_status, v_amt, round(v_amt / (1 + v_rate / 100), 2), v_amt - round(v_amt / (1 + v_rate / 100), 2), 0,
       'On account — ' || a.terms, a.company, v_email, v_at, to_char(r.decided_on, 'DD Mon YYYY'),
       v_seller, r.vertical, false, r.ord_stage, array['Ordered', 'Approved', 'Packed', 'In transit', 'Delivered'],
       r.account_id, r.id, r.raised_by, r.cost_centre, r.po_ref, v_cur, a.market, v_rate)
    on conflict (id) do nothing;

    insert into public.order_items
      (id, order_id, product_id, product_name, price, quantity, fulfil, status, user_id, part_id, bundle_selection_id)
    select md5(v_ref || '-' || d.n)::uuid, v_oid, d.product_id, d.name, d.unit, d.quantity, 'shipped',
           case when r.ord_stage >= 4 then 'delivered' else 'placed' end, null, format('%s-%s', v_ref, d.n), v_sel
      from d_priced d where d.req = r.id
    on conflict (id) do nothing;

    update public.enterprise_requisitions q set order_ref = v_ref where q.id = r.id and q.order_ref is null;
  end loop;
end $$;

/* The invoices, as the night will raise them, month by month. */
select public.bill_account_orders(date '2026-09-01');
select public.bill_account_orders(date '2026-10-01');
select public.bill_account_orders(date '2026-11-01');

/* August's and September's paid on time; October's open. */
update public.enterprise_invoices i
   set status = 'paid', paid_on = least(i.due, i.issued + 12)
 where i.status = 'open'
   and i.period in ('Aug 2026', 'Sep 2026')
   and i.id in (select o.invoice_id from public.orders o where o.order_ref like 'ORD-D26%');

/* ===================================================== the shopper half == */

do $$
<<shop>>
declare
  s      record;
  p      record;
  v_rate numeric;
  v_oid  uuid;
  v_amt  numeric;
  v_at   timestamptz;
begin
  for s in select * from (values
      ('ORD-D2608-S01', 'd5a4012b-56dc-4ade-ab33-a00b55a5f32e'::uuid, 'Priya Raman',     'priya.raman@example.com',    'IN', 'INR', 'upi',    date '2026-08-16', 'SKU-4004', 1, 'delivered',  4, '{"city":"Chennai","address":"12 Besant Avenue, Adyar","country":"India"}'),
      ('ORD-D2609-S01', 'd5a4012b-56dc-4ade-ab33-a00b55a5f32e'::uuid, 'Priya Raman',     'priya.raman@example.com',    'IN', 'INR', 'card',   date '2026-09-21', 'SKU-4006', 1, 'delivered',  4, '{"city":"Chennai","address":"12 Besant Avenue, Adyar","country":"India"}'),
      ('ORD-D2610-S01', 'd5a4012b-56dc-4ade-ab33-a00b55a5f32e'::uuid, 'Priya Raman',     'priya.raman@example.com',    'IN', 'INR', 'upi',    date '2026-10-09', 'SKU-5005', 2, 'delivered',  4, '{"city":"Chennai","address":"12 Besant Avenue, Adyar","country":"India"}'),
      ('ORD-D2611-S01', 'd5a4012b-56dc-4ade-ab33-a00b55a5f32e'::uuid, 'Priya Raman',     'priya.raman@example.com',    'IN', 'INR', 'emi',    date '2026-11-08', 'SKU-4005', 1, 'in transit', 3, '{"city":"Chennai","address":"12 Besant Avenue, Adyar","country":"India"}'),
      ('ORD-D2608-S02', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'::uuid, 'Wanjiru Kamau',   'wanjiru.kamau@example.com',  'KE', 'KES', 'mpesa',  date '2026-08-23', 'SKU-4003', 1, 'delivered',  4, '{"city":"Nairobi","address":"Riara Road, Kilimani — Apartment 4B","country":"Kenya"}'),
      ('ORD-D2610-S02', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'::uuid, 'Wanjiru Kamau',   'wanjiru.kamau@example.com',  'KE', 'KES', 'mpesa',  date '2026-10-04', 'SKU-4004', 1, 'delivered',  4, '{"city":"Nairobi","address":"Riara Road, Kilimani — Apartment 4B","country":"Kenya"}'),
      ('ORD-D2611-S02', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'::uuid, 'Wanjiru Kamau',   'wanjiru.kamau@example.com',  'KE', 'KES', 'mpesa',  date '2026-11-02', 'SKU-5005', 1, 'delivered',  4, '{"city":"Nairobi","address":"Riara Road, Kilimani — Apartment 4B","country":"Kenya"}'),
      ('ORD-D2609-S03', 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81'::uuid, 'Otieno Odhiambo', 'otieno.odhiambo@example.com','KE', 'USD', 'card',   date '2026-09-12', 'SKU-4002', 1, 'delivered',  4, '{"city":"Kisumu","address":"Oginga Odinga Street 21","country":"Kenya"}'),
      ('ORD-D2611-S03', 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81'::uuid, 'Otieno Odhiambo', 'otieno.odhiambo@example.com','KE', 'USD', 'card',   date '2026-11-11', 'SKU-4006', 1, 'placed',     1, '{"city":"Kisumu","address":"Oginga Odinga Street 21","country":"Kenya"}')
    ) as t(ref, uid, buyer, email, market, cur, method, on_date, sku, qty, status, stage, addr)
  loop
    if not exists (select 1 from auth.users u where u.id = s.uid) then
      raise notice 'Shopper % is not on this database; % skipped.', s.buyer, s.ref;
      continue;
    end if;
    select pr.id, pr.name, pr.seller, pp.price into p
      from public.products pr join public.product_prices pp on pp.product_id = pr.id and pp.currency = s.cur
     where pr.id = s.sku;
    if p.id is null then raise exception '% has no % price', s.sku, s.cur; end if;
    select mk.tax_rate into v_rate from public.markets mk where mk.code = s.market;
    v_amt := round(p.price * s.qty, 2);
    v_oid := md5(s.ref)::uuid;
    v_at := (s.on_date + time '11:15') at time zone 'UTC';

    insert into public.orders
      (id, order_ref, status, total, subtotal, tax, discount, payment_method, buyer_name, buyer_email,
       shipping_address, created_at, placed_date, seller, vertical, failed, stage, stages, user_id,
       currency, market, tax_rate, payment_ref)
    values
      (v_oid, s.ref, s.status, v_amt, round(v_amt / (1 + v_rate / 100), 2), v_amt - round(v_amt / (1 + v_rate / 100), 2), 0,
       s.method, s.buyer, s.email, s.addr::jsonb, v_at, to_char(s.on_date, 'DD Mon YYYY'), p.seller,
       case when s.sku like 'SKU-5%' then 'iot' else 'device' end, false, s.stage,
       array['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered'], s.uid,
       s.cur, s.market, v_rate, replace(s.ref, 'ORD-', 'PAY-'))
    on conflict (id) do nothing;

    insert into public.order_items
      (id, order_id, product_id, product_name, price, quantity, fulfil, status, user_id, part_id)
    values
      (md5(s.ref || '-1')::uuid, v_oid, p.id, p.name, p.price, s.qty, 'shipped',
       case when s.stage >= 4 then 'delivered' else 'placed' end, s.uid, s.ref || '-1')
    on conflict (id) do nothing;
  end loop;
end $$;

/* ============================================================ self-check === */

do $$
<<chk>>
declare
  v_n   int;
  v_bad text;
begin
  select count(*) into v_n from public.enterprise_requisitions where id like 'REQ-D26%' and state = 'approved';
  if v_n <> 19 then raise exception '% of the 19 seeded requisitions are there and approved', v_n; end if;
  select count(*) into v_n from public.enterprise_requisitions where id like 'REQ-D26%' and credit_hold;
  if v_n <> 0 then raise exception '% seeded requisitions are held on credit', v_n; end if;

  select string_agg(r.id, ', ') into v_bad
    from public.enterprise_requisitions r
   where r.id like 'REQ-D26%'
     and r.amount is distinct from (select sum(l.line_total) from public.enterprise_requisition_lines l where l.requisition_id = r.id);
  if v_bad is not null then raise exception 'requisitions whose lines do not add up: %', v_bad; end if;

  select count(*) into v_n from public.orders o where o.order_ref like 'ORD-D26%' and o.account_id is not null;
  if v_n <> 19 then raise exception '% of the 19 business orders are there', v_n; end if;

  /* Every delivered Aug to Oct business order is on an invoice of its month,
     November's on none. */
  select string_agg(o.order_ref, ', ') into v_bad
    from public.orders o
    left join public.enterprise_invoices i on i.id = o.invoice_id
   where o.order_ref like 'ORD-D26%' and o.account_id is not null
     and ((o.created_at < timestamptz '2026-11-01 00:00:00+00'
           and (i.id is null or i.period <> to_char(o.created_at at time zone 'UTC', 'Mon YYYY')))
       or (o.created_at >= timestamptz '2026-11-01 00:00:00+00' and o.invoice_id is not null));
  if v_bad is not null then raise exception 'orders billed in the wrong month, or not at all: %', v_bad; end if;

  select count(distinct o.invoice_id) into v_n from public.orders o where o.order_ref like 'ORD-D26%';
  if v_n <> 14 then raise exception '% invoices were raised for the seeded orders, not 14', v_n; end if;

  /* Each invoice adds up and carries the requisition on every line. */
  select string_agg(i.id, ', ') into v_bad
    from public.enterprise_invoices i
   where i.id in (select o.invoice_id from public.orders o where o.order_ref like 'ORD-D26%')
     and (abs(i.oneoff - (select sum(l.amount) from public.enterprise_invoice_lines l where l.invoice_id = i.id)) > 0.005
          or abs(i.total - i.oneoff - i.tax) > 0.005
          or exists (select 1 from public.enterprise_invoice_lines l where l.invoice_id = i.id and l.requisition_id is null));
  if v_bad is not null then raise exception 'invoices that do not add up or lose the requisition: %', v_bad; end if;

  /* Reverse charge: Meridian's invoices charge no VAT and say so. */
  select string_agg(i.id, ', ') into v_bad
    from public.enterprise_invoices i
   where i.account_id = 'ENT-2012'
     and i.id in (select o.invoice_id from public.orders o where o.order_ref like 'ORD-D26%')
     and (i.tax <> 0 or i.note not ilike '%reverse charge%');
  if v_bad is not null then raise exception 'reverse-charge invoices that charge tax: %', v_bad; end if;

  /* The two bundles: both parts on one requisition and one invoice. */
  select count(*) into v_n
    from public.enterprise_invoice_lines l
    join public.enterprise_requisition_lines rl
      on rl.requisition_id = l.requisition_id and rl.bundle_selection_id is not null
   where l.requisition_id in ('REQ-D2609-01', 'REQ-D2610-03') and l.description = rl.name;
  if v_n <> 4 then raise exception 'the bundle invoice lines are % of 4', v_n; end if;

  select count(*) into v_n from public.enterprise_invoices i
   where i.id in (select o.invoice_id from public.orders o where o.order_ref like 'ORD-D26%')
     and ((i.period in ('Aug 2026', 'Sep 2026') and i.status <> 'paid') or (i.period = 'Oct 2026' and i.status <> 'open'));
  if v_n <> 0 then raise exception '% seeded invoices are not paid (Aug, Sep) or open (Oct)', v_n; end if;

  select count(*) into v_n from public.orders o where o.order_ref like 'ORD-D26%' and o.account_id is null;
  if v_n > 9 then raise exception '% shopper orders, more than the 9 seeded', v_n; end if;
end $$;

commit;
