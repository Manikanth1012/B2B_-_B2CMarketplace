-- Row ownership — the prerequisite Task 5 turned out to need.
--
-- docs/superpowers/plans/2026-07-29-rls-live-audit.md found that no table carried an
-- owner: settlement_statements had `partner_name` (free text), orders had `buyer_email`,
-- consumer_profile was a single shared row. "Owner reads own rows" had nothing to
-- resolve `own` against. This adds the columns and applies the curated backfill the
-- audit recorded.
--
-- Two design points that keep the consoles working unchanged:
--
--   * `default auth.uid()` — every existing INSERT in src/ omits user_id (App.tsx
--     cart, Checkout.tsx orders/order_items/subscriptions, AccountView.tsx audit
--     rows, RewardsView.tsx ledger rows). The default stamps the owner server-side,
--     so no component query changes.
--   * The column is nullable. A null owner is not a hole: under Task 5 a null-owner
--     row is invisible to every consumer and visible only to the operator, which is
--     exactly what the audit decided should happen to the rows that have no owner.
--
-- ON DELETE differs by what the row means. Personal state dies with the account;
-- financial and audit records outlive it and fall back to operator-only.

-- ---------------------------------------------------------------------------
-- Consumer-owned tables
-- ---------------------------------------------------------------------------

-- Personal state — meaningless once the account is gone.
alter table cart_items                add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();
alter table subscriptions             add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();
alter table consumer_profile          add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();
alter table consumer_household        add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();
alter table consumer_notifications    add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();
alter table consumer_payment_methods  add column if not exists user_id uuid references auth.users(id) on delete cascade default auth.uid();

-- Records the operator has to keep. Deleting the account orphans them rather than
-- destroying the settlement, billing and audit trail that references them.
alter table orders                    add column if not exists user_id uuid references auth.users(id) on delete set null default auth.uid();
alter table order_items               add column if not exists user_id uuid references auth.users(id) on delete set null default auth.uid();
alter table consumer_bills            add column if not exists user_id uuid references auth.users(id) on delete set null default auth.uid();
alter table consumer_refunds          add column if not exists user_id uuid references auth.users(id) on delete set null default auth.uid();
alter table consumer_tickets          add column if not exists user_id uuid references auth.users(id) on delete set null default auth.uid();
alter table consumer_audit_log        add column if not exists user_id uuid references auth.users(id) on delete set null default auth.uid();
alter table loyalty_members           add column if not exists user_id uuid references auth.users(id) on delete set null default auth.uid();
alter table loyalty_ledger            add column if not exists user_id uuid references auth.users(id) on delete set null default auth.uid();

create index if not exists cart_items_user_id_idx               on cart_items (user_id);
create index if not exists subscriptions_user_id_idx            on subscriptions (user_id);
create index if not exists consumer_profile_user_id_idx         on consumer_profile (user_id);
create index if not exists consumer_household_user_id_idx       on consumer_household (user_id);
create index if not exists consumer_notifications_user_id_idx   on consumer_notifications (user_id);
create index if not exists consumer_payment_methods_user_id_idx on consumer_payment_methods (user_id);
create index if not exists orders_user_id_idx                   on orders (user_id);
create index if not exists order_items_user_id_idx              on order_items (user_id);
create index if not exists consumer_bills_user_id_idx           on consumer_bills (user_id);
create index if not exists consumer_refunds_user_id_idx         on consumer_refunds (user_id);
create index if not exists consumer_tickets_user_id_idx         on consumer_tickets (user_id);
create index if not exists consumer_audit_log_user_id_idx       on consumer_audit_log (user_id);
create index if not exists loyalty_members_user_id_idx          on loyalty_members (user_id);
create index if not exists loyalty_ledger_user_id_idx           on loyalty_ledger (user_id);

-- ---------------------------------------------------------------------------
-- Backfill: the consumer persona
-- ---------------------------------------------------------------------------
-- Audit decision 1. `orders.buyer_email` is priya.raman@6dtech.co.in on all seven
-- rows while DEMO_CREDENTIALS signs in as priya.raman@example.com — a seeding
-- inconsistency, not a second buyer. Matching on text would orphan every order and
-- blank the consumer console, so the seeded consumer data is assigned wholesale.

do $$
declare consumer_uid uuid;
begin
  select id into consumer_uid from profiles where persona = 'consumer' order by created_at limit 1;
  if consumer_uid is null then
    raise exception 'no consumer profile to own the seeded rows — run the Task 1 migration first';
  end if;

  update consumer_profile         set user_id = consumer_uid where user_id is null;
  update consumer_household       set user_id = consumer_uid where user_id is null;
  update consumer_notifications   set user_id = consumer_uid where user_id is null;
  update consumer_payment_methods set user_id = consumer_uid where user_id is null;
  update consumer_bills           set user_id = consumer_uid where user_id is null;
  update consumer_refunds         set user_id = consumer_uid where user_id is null;
  update consumer_tickets         set user_id = consumer_uid where user_id is null;
  update consumer_audit_log       set user_id = consumer_uid where user_id is null;
  update orders                   set user_id = consumer_uid where user_id is null;
  update order_items              set user_id = consumer_uid where user_id is null;

  -- Loyalty is a shared programme: only the consumer's own membership is theirs.
  -- LM-4001 joins to consumer_profile on party = customer_id = 'CUS-449021'. The
  -- other seven members are other parties and stay operator-only.
  update loyalty_members set user_id = consumer_uid
   where user_id is null
     and party in (select customer_id from consumer_profile where user_id = consumer_uid);

  update loyalty_ledger set user_id = consumer_uid
   where user_id is null
     and member in (select id from loyalty_members where user_id = consumer_uid);
end $$;

-- ---------------------------------------------------------------------------
-- Backfill: the partner key on settlement_statements
-- ---------------------------------------------------------------------------
-- Audit decisions 2 and 3. A join on partner_name matches 1 of 6 names, so the
-- mapping is explicit and curated. TechDyne Devices and CloudSync Labs name sellers
-- that were never seeded into `partners`; "Aventa (First-party)" is the operator's
-- own entity and is not a partner at all. All three keep a null partner_id, which
-- leaves them visible to the operator and to nobody else — inventing partner rows
-- to satisfy the foreign key would put fictional sellers into the onboarding console.

alter table settlement_statements add column if not exists partner_id text references partners(id);
create index if not exists settlement_statements_partner_id_idx on settlement_statements (partner_id);

update settlement_statements s set partner_id = m.partner_id
from (values
  ('StreamNova Media',       'PTR-1001'),
  ('Nimbus IoT Solutions',   'PTR-1004'),
  ('Sentinel Cyber Systems', 'PTR-1003')
) as m(partner_name, partner_id)
where s.partner_name = m.partner_name
  and s.partner_id is null;
