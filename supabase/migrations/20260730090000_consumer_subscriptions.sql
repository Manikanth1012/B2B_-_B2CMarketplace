-- Priya's subscriptions — prototype parity, step one.
--
-- `subscriptions` was empty, so the consumer console's Subscriptions screen showed
-- its "No subscriptions" empty state while the prototype (`_src/mp_data.js`, `SUBS`)
-- has six. All six SKUs already exist in `products` with matching names, sellers and
-- prices, so this is the prototype's own data rather than anything invented.
--
-- Four columns first, because the prototype models states the schema could not hold:
--
--   * `seller` and `cycle` are on every prototype row and shown on the card.
--   * A **cancelled** subscription runs to a date and then stops — the prototype
--     carries `ends`. Without it a cancelled row cannot say when access lapses.
--   * A **paused** one restarts on a date, and the prototype is explicit that "a
--     paused subscription still occupies the slot and still bills on resume". That
--     is `resumes`, and it is not the same fact as `next_renewal`; folding the two
--     together would claim a paused subscription is about to charge.
--
-- All four are nullable, and `cycle` defaults, so Checkout.tsx keeps inserting the
-- five columns it already inserts without change.

alter table subscriptions add column if not exists ref        text;
alter table subscriptions add column if not exists seller     text;
alter table subscriptions add column if not exists cycle      text default 'Monthly';
alter table subscriptions add column if not exists ends_at    date;
alter table subscriptions add column if not exists resumes_at date;

comment on column subscriptions.ends_at    is 'Cancelled: access runs until this date, then stops.';
comment on column subscriptions.resumes_at is 'Paused: billing restarts on this date. Not a renewal.';

-- `ref` is the human-facing id the prototype and the rest of this schema use
-- (orders.order_ref, settlement ids). The primary key stays a uuid.
create unique index if not exists subscriptions_ref_key on subscriptions (ref) where ref is not null;

-- The six rows, owned by the consumer persona. Seeded against `profiles` rather than
-- a hard-coded uuid so this survives the auth users being reseeded.
insert into subscriptions
  (ref, product_id, product_name, seller, cycle, price, status, auto_renew,
   started_at, next_renewal, ends_at, resumes_at, user_id)
select v.ref, v.product_id, v.product_name, v.seller, v.cycle, v.price, v.status, v.auto_renew,
       v.started_at::timestamptz, v.next_renewal::date, v.ends_at::date, v.resumes_at::date,
       (select id from profiles where persona = 'consumer' order by created_at limit 1)
from (values
  ('SUB-9101', 'SKU-3001', 'StreamNova Premium 4K',             'StreamNova Media', 'Monthly', 12.99, 'active',    true,  '2024-11-02', '2026-08-02', null,         null),
  ('SUB-9102', 'SKU-3005', 'Halo Music Family',                 'Halo Audio',       'Monthly', 14.99, 'active',    true,  '2025-03-11', '2026-08-11', null,         null),
  ('SUB-9103', 'SKU-2001', 'Aventa Freedom 50 GB',              'Aventa Telecom',   'Monthly', 18.00, 'active',    true,  '2024-06-14', '2026-08-01', null,         null),
  ('SUB-9104', 'SKU-2004', 'Device Protect — screen and theft', 'Aegis Assurance',  'Monthly',  6.90, 'active',    true,  '2025-01-14', '2026-08-14', null,         null),
  ('SUB-9105', 'SKU-3003', 'PlayForge Cloud Gaming',            'PlayForge Games',  'Monthly',  9.99, 'cancelled', false, '2026-02-20', null,         '2026-08-19', null),
  ('SUB-9106', 'SKU-3007', 'ClearVault Personal 2 TB',          'ClearVault Cloud', 'Monthly',  6.49, 'paused',    false, '2026-01-08', null,         null,         '2026-09-01')
) as v(ref, product_id, product_name, seller, cycle, price, status, auto_renew,
       started_at, next_renewal, ends_at, resumes_at)
where not exists (select 1 from subscriptions s where s.ref = v.ref);
