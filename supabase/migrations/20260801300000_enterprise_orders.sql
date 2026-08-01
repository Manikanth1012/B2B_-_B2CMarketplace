-- The orders an enterprise account actually placed.
--
-- The Orders screen was five constants in `data.ts`, which meant the approvals
-- work had nowhere to land: a requisition approved on Monday produced an order
-- reference that existed on the requisition and nowhere else. Refunds pointed
-- at ORD-882090 and ORD-882091, the notification log at ORD-881517, and a
-- support ticket at the same — none of which was an order anybody could open.
--
-- So: the orders those references have been promising all along, tied back to
-- the requisition that authorised each one. What makes a business order
-- different from a consumer's is the chain in front of it and behind it —
-- somebody asked, somebody approved, it was provisioned or delivered, it was
-- invoiced, and sometimes it came back. This is the middle of that chain, and
-- the assertions at the bottom are what keep the ends attached.

alter table orders add column if not exists account_id text references enterprise_accounts(id) on delete cascade;
alter table orders add column if not exists requisition_id text references enterprise_requisitions(id) on delete set null;
alter table orders add column if not exists invoice_id text references enterprise_invoices(id) on delete set null;
alter table orders add column if not exists failed_reason text;
alter table orders add column if not exists ordered_by text references enterprise_users(id);
alter table orders add column if not exists cost_centre text references enterprise_cost_centres(id);
alter table orders add column if not exists po_ref text;

create index if not exists orders_account_idx on orders(account_id, placed_date);

/* A failure that does not say what failed is a status nobody can act on. The
   one order already carrying the flag had no reason on it, which is the point:
   the screen could show a customer that something failed and nothing anywhere
   could say what. */
update orders set failed_reason =
  'Device insurance was cancelled after the cooling-off period and the order was refunded in full.'
 where failed and coalesce(failed_reason, '') = '' and status = 'refunded';

update orders set failed_reason = 'Recorded as failed on the old queue with no reason attached.'
 where failed and coalesce(failed_reason, '') = '';

alter table orders drop constraint if exists orders_failed_reason_check;
alter table orders add constraint orders_failed_reason_check
  check (not failed or coalesce(failed_reason, '') <> '');

/* ============================================================== orders === */

/* Provisioning and delivery are different journeys and always have been —
   a subscription is never "in transit" and a pallet of sensors is never
   "activated". Storing the stage names per order rather than assuming one
   ladder is what lets both be shown honestly. */
do $$
declare
  u_ent uuid := (select id from auth.users where email = 'vikram.shah@smartbuild.in');
  HW  text[] := array['Ordered', 'Approved', 'Packed', 'In transit', 'Delivered'];
  SVC text[] := array['Ordered', 'Approved', 'Provisioning', 'Activated', 'In service'];
begin
  delete from order_items where order_id in (select id from orders where account_id = 'ENT-2007');
  delete from orders where account_id = 'ENT-2007';

  insert into orders (id, order_ref, status, total, subtotal, tax, discount, payment_method,
                      buyer_name, buyer_email, shipping_address, created_at, tracking_ref, carrier,
                      placed_date, seller, vertical, failed, failed_reason, stage, stages, user_id,
                      account_id, requisition_id, invoice_id, ordered_by, cost_centre, po_ref) values

  /* The one everything else has been pointing at. Thirty of 250 endpoints
     never provisioned — a partial failure, which is why the order is not
     simply "failed" and the refund is for 30 rather than the lot. */
  ('e0000000-0000-0000-0000-000000881517', 'ORD-881517', 'partly-failed',
   2375.00, 2012.71, 362.29, 0, 'On account — Net 30',
   'SmartBuild Ltd', 'vikram.shah@smartbuild.in', '{"site":"Four retail sites","city":"Bengaluru, Hyderabad, Pune, Kochi","note":"See the rollout schedule"}'::jsonb,
   '2026-07-18 09:00+00', null, 'Digital', '18 Jul 2026', 'Sentinel Cyber', 'security',
   true, 'Thirty endpoints across four retail sites were never provisioned — the tenant identifier was rejected by the seller. The remaining 220 came up normally.',
   2, SVC, u_ent, 'ENT-2007', null, 'INV-2026-0779', 'EU-2007-03', 'CC-2200', null),

  /* What the approved requisitions produced. */
  ('e0000000-0000-0000-0000-000000882090', 'ORD-882090', 'failed',
   2295.00, 1944.92, 350.08, 0, 'On account — Net 30',
   'SmartBuild Ltd', 'vikram.shah@smartbuild.in', '{"line1":"Pune depot, Hinjawadi Phase 2","city":"Pune","pin":"411057"}'::jsonb,
   '2026-06-22 10:00+00', 'TRK-884120', 'BlueDart', '22 Jun 2026', 'Nimbus Sensors', 'iot',
   true, 'Marked delivered to the Pune depot on 24 Jun. Nothing arrived and the depot has no signature on file. A refund is open — RFN-3241.',
   3, HW, u_ent, 'ENT-2007', 'REQ-5501', 'INV-2026-0762', 'EU-2007-05', 'CC-4100', 'PO-SB-2026-0377'),

  ('e0000000-0000-0000-0000-000000882091', 'ORD-882091', 'delivered',
   5432.00, 4603.39, 828.61, 0, 'On account — Net 30',
   'SmartBuild Ltd', 'vikram.shah@smartbuild.in', '{"site":"Retail estate — 14 sites","city":"Karnataka and Maharashtra","note":"See the rollout schedule"}'::jsonb,
   '2026-07-12 11:00+00', 'TRK-885003', 'BlueDart', '12 Jul 2026', 'Nimbus Sensors', 'iot',
   false, null, 4, HW, u_ent, 'ENT-2007', 'REQ-5487', 'INV-2026-0779', 'EU-2007-04', 'CC-RETAIL', 'PO-SB-2026-0409'),

  ('e0000000-0000-0000-0000-000000882092', 'ORD-882092', 'active',
   1240.00, 1050.85, 189.15, 0, 'On account — Net 30',
   'SmartBuild Ltd', 'vikram.shah@smartbuild.in', '{"site":"Digital — SIM estate","note":"No physical delivery"}'::jsonb,
   '2026-07-30 09:00+00', null, 'Digital', '30 Jul 2026', 'Aventa Telecom', 'iot',
   false, null, 4, SVC, u_ent, 'ENT-2007', 'REQ-5498', null, 'EU-2007-04', 'CC-4100', 'PO-SB-2026-0428'),

  ('e0000000-0000-0000-0000-000000882093', 'ORD-882093', 'delivered',
   192.00, 162.71, 29.29, 0, 'On account — Net 30',
   'SmartBuild Ltd', 'vikram.shah@smartbuild.in', '{"line1":"Logistics yard, Hosur Road","city":"Bengaluru","pin":"560068"}'::jsonb,
   '2026-07-02 14:00+00', 'TRK-884776', 'BlueDart', '02 Jul 2026', 'TrackWise Telematics', 'iot',
   false, null, 4, HW, u_ent, 'ENT-2007', null, 'INV-2026-0779', 'EU-2007-05', 'CC-4100', null),

  ('e0000000-0000-0000-0000-000000882088', 'ORD-882088', 'active',
   1736.00, 1471.19, 264.81, 0, 'On account — Net 30',
   'SmartBuild Ltd', 'vikram.shah@smartbuild.in', '{"site":"Digital — 280 users","note":"No physical delivery"}'::jsonb,
   '2026-04-30 12:00+00', null, 'Digital', '30 Apr 2026', 'Sentinel Cyber', 'security',
   false, null, 4, SVC, u_ent, 'ENT-2007', 'REQ-5462', 'INV-2026-0744', 'EU-2007-03', 'CC-2200', 'PO-SB-2026-0341'),

  ('e0000000-0000-0000-0000-000000882080', 'ORD-882080', 'active',
   2375.00, 2012.71, 362.29, 0, 'On account — Net 30',
   'SmartBuild Ltd', 'vikram.shah@smartbuild.in', '{"site":"Digital — 250 endpoints","note":"No physical delivery"}'::jsonb,
   '2025-08-08 10:00+00', null, 'Digital', '08 Aug 2025', 'Sentinel Cyber', 'security',
   false, null, 4, SVC, u_ent, 'ENT-2007', 'REQ-5388', null, 'EU-2007-03', 'CC-2200', 'PO-SB-2025-0912'),

  /* In flight right now, so the screen has something moving on it. */
  ('e0000000-0000-0000-0000-000000882095', 'ORD-882095', 'in-transit',
   1128.00, 955.93, 172.07, 0, 'On account — Net 30',
   'SmartBuild Ltd', 'vikram.shah@smartbuild.in', '{"site":"Six depots without fibre","city":"Karnataka","note":"See the rollout schedule"}'::jsonb,
   '2026-07-29 16:00+00', 'TRK-885417', 'Delhivery', '29 Jul 2026', 'Volta Routers', 'iot',
   false, null, 3, HW, u_ent, 'ENT-2007', null, 'INV-2026-0781', 'EU-2007-05', 'CC-4100', 'PO-SB-2026-0428');

  insert into order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status, user_id) values
    ('e1000000-0000-0000-0001-000000881517', 'e0000000-0000-0000-0000-000000881517', 'SKU-6002', 'Sentinel MDR — 24/7', 9.50, 250, 'digital', 'partly-failed', u_ent),
    ('e1000000-0000-0000-0001-000000882090', 'e0000000-0000-0000-0000-000000882090', 'SKU-5006', 'Cold-chain starter — 25 sensors + connectivity', 2295.00, 1, 'shipped', 'failed', u_ent),
    ('e1000000-0000-0000-0001-000000882091', 'e0000000-0000-0000-0000-000000882091', 'SKU-5004', 'Nimbus Occupancy sensor', 52.00, 90, 'shipped', 'delivered', u_ent),
    ('e1000000-0000-0000-0002-000000882091', 'e0000000-0000-0000-0000-000000882091', 'SKU-5007', 'Volta IoT Gateway LTE-M', 188.00, 4, 'shipped', 'delivered', u_ent),
    ('e1000000-0000-0000-0001-000000882092', 'e0000000-0000-0000-0000-000000882092', 'SKU-5002', 'IoT Connect 2 GB', 3.10, 400, 'digital', 'active', u_ent),
    ('e1000000-0000-0000-0001-000000882093', 'e0000000-0000-0000-0000-000000882093', 'SKU-5005', 'TrackWise Asset Tracker Pro', 96.00, 2, 'shipped', 'delivered', u_ent),
    ('e1000000-0000-0000-0001-000000882088', 'e0000000-0000-0000-0000-000000882088', 'SKU-6003', 'Sentinel Secure Access (ZTNA)', 6.20, 280, 'digital', 'active', u_ent),
    ('e1000000-0000-0000-0001-000000882080', 'e0000000-0000-0000-0000-000000882080', 'SKU-6002', 'Sentinel MDR — 24/7', 9.50, 250, 'digital', 'active', u_ent),
    ('e1000000-0000-0000-0001-000000882095', 'e0000000-0000-0000-0000-000000882095', 'SKU-5007', 'Volta IoT Gateway LTE-M', 188.00, 6, 'shipped', 'in-transit', u_ent);
end $$;

/* ================================================================= RLS === */

drop policy if exists "account_read_orders" on orders;
drop policy if exists "account_read_order_items" on order_items;

create policy "account_read_orders" on orders
  for select to authenticated using (account_id = current_account_id());
create policy "account_read_order_items" on order_items
  for select to authenticated using (
    exists (select 1 from orders o
             where o.id = order_items.order_id and o.account_id = current_account_id()));

/* ------------------------------------------------------ sanity checks -- */
do $$
declare n integer; v numeric;
begin
  /* Every approved requisition's order actually exists. This is the assertion
     the whole migration is for — the approvals screen has been writing order
     references into a table nothing else could resolve. */
  select count(*) into n from enterprise_requisitions r
   where r.state = 'approved' and r.order_ref is not null
     and not exists (select 1 from orders o where o.order_ref = r.order_ref);
  if n > 0 then
    raise exception '% approved requisitions name an order that does not exist', n;
  end if;

  /* And the order agrees with the requisition about who is selling what for
     how much. A one-off requisition becomes an order for the same money; a
     monthly one becomes a subscription billed monthly, so only the first
     period matches. */
  select count(*) into n from orders o
    join enterprise_requisitions r on r.id = o.requisition_id
   where o.total <> r.amount;
  if n > 0 then
    raise exception '% orders disagree with the requisition that authorised them about the amount', n;
  end if;

  /* Every refund on the account points at an order on the account. */
  select count(*) into n from refunds f
   where f.account_id = 'ENT-2007'
     and not exists (select 1 from orders o where o.order_ref = f.order_ref and o.account_id = f.account_id);
  if n > 0 then
    raise exception '% refunds name an order this account never placed', n;
  end if;

  /* And a refund exists only against something that went wrong or was
     returnable — not against an order still being provisioned. */
  select count(*) into n from refunds f
    join orders o on o.order_ref = f.order_ref
   where f.account_id = 'ENT-2007' and o.stage < 2;
  if n > 0 then
    raise exception '% refunds are against an order that has not been fulfilled yet', n;
  end if;

  /* Every ticket and message that names an order names one that exists. */
  select count(*) into n from support_tickets t
   where t.account_id = 'ENT-2007' and t.ref like 'ORD-%'
     and not exists (select 1 from orders o where o.order_ref = t.ref);
  if n > 0 then raise exception '% tickets name an order that does not exist', n; end if;

  select count(*) into n from notification_log l
   where l.persona = 'enterprise' and l.ref like 'ORD-%'
     and not exists (select 1 from orders o where o.order_ref = l.ref);
  if n > 0 then raise exception '% messages name an order that does not exist', n; end if;

  /* An order equals the lines on it. */
  select count(*) into n from orders o
   where o.account_id = 'ENT-2007'
     and o.total <> (select coalesce(sum(round(i.price * i.quantity, 2)), -1)
                       from order_items i where i.order_id = o.id);
  if n > 0 then raise exception '% orders do not equal the sum of their items', n; end if;

  /* Tax and subtotal add to the total. */
  select count(*) into n from orders
   where account_id = 'ENT-2007' and round(subtotal + tax, 2) <> total;
  if n > 0 then raise exception '% orders do not add up before and after tax', n; end if;

  /* A failed order says what failed. */
  select count(*) into n from orders
   where account_id = 'ENT-2007' and failed and coalesce(failed_reason, '') = '';
  if n > 0 then raise exception '% failed orders do not say why', n; end if;

  /* The stage is somewhere on its own ladder. */
  select count(*) into n from orders
   where account_id = 'ENT-2007' and (stage < 0 or stage > array_length(stages, 1) - 1);
  if n > 0 then raise exception '% orders are at a stage their own journey does not have', n; end if;

  /* The screen needs one of each to be worth looking at. */
  select count(*) into n from orders where account_id = 'ENT-2007' and failed;
  if n < 1 then raise exception 'the demo account has no failed order'; end if;
  select count(*) into n from orders
   where account_id = 'ENT-2007' and not failed and stage < array_length(stages, 1) - 1;
  if n < 1 then raise exception 'the demo account has nothing in flight'; end if;
  select count(distinct requisition_id) into n from orders
   where account_id = 'ENT-2007' and requisition_id is not null;
  if n < 3 then raise exception 'only % orders trace back to a requisition', n; end if;
end $$;
