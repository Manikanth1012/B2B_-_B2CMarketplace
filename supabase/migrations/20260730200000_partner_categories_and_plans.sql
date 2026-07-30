-- Which marketplaces a partner may sell in, and what they settle on.
--
-- Two facts the schema was missing entirely. `partners` knew a seller's name,
-- country and tier but not the one thing that decides what they are allowed to
-- list, and `products.comm` carried a per-SKU rate with nothing behind it — no
-- plan, no ladder, no cycle, nothing anybody agreed to.
--
-- The prototype holds both on the partner record (`verticals`, `plan`). A text
-- array would have copied that shape; a join table is used instead because a
-- category is a real row here and an approval is a fact with a date on it. It
-- also means the eligibility question — "may this seller list in security?" —
-- is a join rather than an array scan against strings nothing validates.

/* ------------------------------------------------------- commission plans -- */

create table if not exists commission_plans (
  id          text primary key,
  name        text not null,
  category_id text references categories(id) on delete restrict,
  /* How the split works, in the seller's language rather than a rate alone.
     "18%" means something different for a revenue share and for a wholesale
     discount off list, and a seller reading only the number gets it wrong. */
  model       text not null,
  base_rate   numeric not null,
  /* [{from, rate}] ascending. Held as JSON because a tier is only ever read as
     the whole ladder — no query filters or joins on a single step, so a child
     table would buy nothing and cost a join on every read. */
  tiers       jsonb not null default '[]'::jsonb,
  fees        text not null,
  cycle       text not null,
  hold        text not null,
  sort_order  integer not null default 0
);

alter table commission_plans enable row level security;

/* Readable by any signed-in persona: a seller has to be able to read the plan
   they settle on, and the operator has to be able to compare them. Writable by
   the operator alone — a seller who could edit their own rate is not a seller. */
drop policy if exists "auth_read_commission_plans" on commission_plans;
drop policy if exists "operator_write_commission_plans" on commission_plans;

create policy "auth_read_commission_plans" on commission_plans
  for select to authenticated using (true);
create policy "operator_write_commission_plans" on commission_plans
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

insert into commission_plans (id, name, category_id, model, base_rate, tiers, fees, cycle, hold, sort_order)
values
  ('CP-CONTENT-STD', 'Digital content — standard', 'content', 'Revenue share', 22,
   '[{"from":0,"rate":22},{"from":50000,"rate":19},{"from":150000,"rate":16}]',
   'Payment processing 1.9% + $0.20', 'Monthly, net 15', '7 days', 1),
  ('CP-DEVICE-VOL', 'Device — volume', 'device', 'Commission on sale', 9,
   '[{"from":0,"rate":9},{"from":250000,"rate":7.5},{"from":750000,"rate":6}]',
   'Payment processing 1.9% + $0.20 · logistics at cost', 'Monthly, net 30', '14 days (returns window)', 2),
  ('CP-DEVICE-STD', 'Device — standard', 'device', 'Commission on sale', 12,
   '[{"from":0,"rate":12}]',
   'Payment processing 1.9% + $0.20 · logistics at cost', 'Monthly, net 30', '14 days (returns window)', 3),
  ('CP-SEC-SAAS', 'Security — subscription', 'security', 'Recurring revenue share', 18,
   '[{"from":0,"rate":18},{"from":100000,"rate":15}]',
   'Payment processing 1.9%', 'Monthly, net 15', 'None', 4),
  ('CP-IOT-STD', 'IoT — hardware + connectivity', 'iot', 'Split: hardware commission, connectivity wholesale', 11,
   '[{"from":0,"rate":11},{"from":200000,"rate":9}]',
   'Payment processing 1.9% + $0.20', 'Monthly, net 30', '14 days', 5),
  ('CP-INS-STD', 'Insurance — introducer', 'consumer', 'Introducer commission on premium', 15,
   '[{"from":0,"rate":15}]',
   'None', 'Monthly, net 30', 'Cooling-off 14 days', 6),
  ('CP-RESELL-T2', 'Reseller — tier 2', 'partner', 'Wholesale discount off list', 14,
   '[{"from":0,"rate":14},{"from":120000,"rate":17}]',
   'None — the reseller invoices the end customer', 'Monthly, net 30', 'None', 7),
  ('CP-RESELL-T3', 'Reseller — tier 3 (entry)', 'partner', 'Wholesale discount off list', 10,
   '[{"from":0,"rate":10},{"from":60000,"rate":12}]',
   'None — the reseller invoices the end customer', 'Monthly, net 30', 'None', 8)
on conflict (id) do nothing;

/* ---------------------------------------------------- partner categories -- */

create table if not exists partner_categories (
  partner_id  text not null references partners(id)   on delete cascade,
  category_id text not null references categories(id) on delete cascade,
  /* Approval is granted at a gate, so it has a date and somebody's name on it.
     Null for a seller still in flight — applied for, not yet approved. */
  approved_at timestamptz,
  approved_by text,
  primary key (partner_id, category_id)
);

alter table partner_categories enable row level security;

drop policy if exists "auth_read_partner_categories" on partner_categories;
drop policy if exists "operator_write_partner_categories" on partner_categories;

/* Readable by anyone signed in — a buyer's product page names the seller, and
   the seller's own console has to show what they were approved for. The grant
   is what a listing is checked against, so only the operator may change it. */
create policy "auth_read_partner_categories" on partner_categories
  for select to authenticated using (true);
create policy "operator_write_partner_categories" on partner_categories
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* The plan a partner settles on. Nullable and `on delete set null`: a rejected
   seller has no plan, and retiring a plan must not delete the sellers on it. */
alter table partners add column if not exists plan_id text
  references commission_plans(id) on delete set null;

-- The prototype's declared verticals, which are a superset of where each seller
-- actually has stock today. That direction matters: approved-but-empty is a
-- seller who has not listed yet, whereas listed-but-unapproved would be a
-- listing nothing ever agreed to. The check at the end of this file asserts the
-- catalogue stays on the right side of it.
insert into partner_categories (partner_id, category_id, approved_at, approved_by)
values
  ('PTR-1001', 'content',  '2024-04-12', 'Lena Fischer'),
  ('PTR-1002', 'device',   '2024-03-02', 'Lena Fischer'),
  ('PTR-1002', 'consumer', '2024-03-02', 'Lena Fischer'),
  ('PTR-1003', 'security', '2024-06-18', 'Lena Fischer'),
  ('PTR-1004', 'iot',      '2024-09-27', 'Lena Fischer'),
  ('PTR-1004', 'device',   '2024-09-27', 'Lena Fischer'),
  ('PTR-1005', 'content',  '2024-11-05', 'Lena Fischer'),
  ('PTR-1006', 'consumer', '2025-01-14', 'Lena Fischer'),
  ('PTR-1007', 'content',  '2025-02-22', 'Lena Fischer'),
  ('PTR-1008', 'device',   '2025-04-09', 'Lena Fischer'),
  ('PTR-1008', 'iot',      '2025-04-09', 'Lena Fischer'),
  ('PTR-1009', 'partner',  '2025-05-30', 'Lena Fischer'),
  ('PTR-1010', 'security', '2025-08-11', 'Lena Fischer'),
  ('PTR-1010', 'content',  '2025-08-11', 'Lena Fischer'),
  ('PTR-1011', 'iot',      '2026-01-19', 'Lena Fischer'),
  ('PTR-1015', 'security', '2024-12-03', 'Lena Fischer'),
  -- Still in flight: applied for, not yet approved, so no date and no name.
  ('PTR-1012', 'partner',  null, null),
  ('PTR-1012', 'consumer', null, null),
  ('PTR-1013', 'device',   null, null),
  ('PTR-1014', 'iot',      null, null)
on conflict (partner_id, category_id) do nothing;

update partners set plan_id = v.plan from (values
  ('PTR-1001', 'CP-CONTENT-STD'), ('PTR-1002', 'CP-DEVICE-VOL'),  ('PTR-1003', 'CP-SEC-SAAS'),
  ('PTR-1004', 'CP-IOT-STD'),     ('PTR-1005', 'CP-CONTENT-STD'), ('PTR-1006', 'CP-INS-STD'),
  ('PTR-1007', 'CP-CONTENT-STD'), ('PTR-1008', 'CP-DEVICE-VOL'),  ('PTR-1009', 'CP-RESELL-T2'),
  ('PTR-1010', 'CP-SEC-SAAS'),    ('PTR-1011', 'CP-IOT-STD'),     ('PTR-1012', 'CP-RESELL-T3'),
  ('PTR-1013', 'CP-DEVICE-STD'),  ('PTR-1015', 'CP-SEC-SAAS')
  -- PTR-1014 is deliberately absent. It failed KYC, so nothing was ever agreed.
) as v(id, plan) where partners.id = v.id;

-- A listing in a category its seller was never approved for is the defect this
-- table exists to prevent. Fail the migration rather than record one.
do $$
declare bad integer;
begin
  select count(*) into bad
  from products p
  where p.partner_id is not null
    and not exists (
      select 1 from partner_categories pc
      where pc.partner_id = p.partner_id and pc.category_id = p.category_id
    );
  if bad > 0 then
    raise exception 'eligibility check failed: % product(s) sit in a category their seller is not approved for', bad;
  end if;
end $$;
