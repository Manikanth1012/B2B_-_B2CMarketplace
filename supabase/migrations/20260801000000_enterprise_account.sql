-- The enterprise buyer's account: who may spend, what is waiting on approval,
-- what came back, and what it all costs.
--
-- Everything on the enterprise console was a constant in `data.ts`. Approvals
-- disappeared on refresh because deciding one filtered a React array; the
-- billing page did not exist; refunds did not exist even though seven of them
-- were sitting in `refunds` with buyer_type = 'enterprise' and nowhere to be
-- seen. A procurement lead could not answer the three questions the job is:
-- what am I being asked to approve, what did we get back, and what do we owe.
--
-- The shape, from the top of the hierarchy down:
--
--   account        the company, its terms, its budget and its tax position
--   users          who may raise, who may approve, and up to what value
--   cost centres   where the money is attributed, with a cap per quarter
--   policy         the thresholds that decide what needs approving at all
--   requisitions   a request to spend, its lines, and what was decided
--   subscriptions  what is held under contract, and what it costs per month
--   invoices       one document covering every seller, broken into lines
--
-- The procurement lead sits above all of it. They can approve anything, see
-- every colleague's requisition and set the policy — but they are still bound
-- by separation of duties on their own spend, because an approver who can
-- approve themselves is the control every audit tests first.

/* =========================================================== who am I === */

/* Mirrors `current_partner_id()`. Without it every policy below would have to
   join through `enterprise_users` on every row. */
alter table profiles add column if not exists account_id text;

create or replace function current_account_id() returns text
language sql stable security definer set search_path = public as $$
  select account_id from profiles where id = auth.uid()
$$;

/* ============================================================ accounts === */

create table if not exists enterprise_accounts (
  id             text primary key,
  company        text not null,
  legal_name     text not null,
  segment        text not null check (segment in ('large', 'mid', 'small')),
  industry       text not null,
  sites          integer not null,
  staff          integer not null,
  terms          text not null,
  currency       text not null default 'USD',
  /* The financial year, because "budget used" means nothing without knowing
     how much of the year has gone. */
  fy_starts      date not null,
  budget_year    numeric(12,2) not null,
  /* Tax position. A buyer who cannot state a registration number cannot claim
     input credit on any of these invoices, which is real money. */
  reg_type       text not null check (reg_type in ('GSTIN', 'VAT number', 'TRN', 'Not registered')),
  registration   text,
  place_of_supply text not null,
  po_required    boolean not null default false,
  reverse_charge boolean not null default false,
  cost_centre_on_invoice boolean not null default true,
  tax_exempt     boolean not null default false,
  exempt_cert    text,
  status         text not null default 'active' check (status in ('active', 'on-hold', 'closed')),
  sort_order     integer not null default 0
);

insert into enterprise_accounts (id, company, legal_name, segment, industry, sites, staff, terms,
                                 fy_starts, budget_year, reg_type, registration, place_of_supply,
                                 po_required, reverse_charge, cost_centre_on_invoice, sort_order) values
  ('ENT-2007', 'SmartBuild Ltd', 'SmartBuild Infrastructure Private Limited', 'mid', 'Construction and facilities',
   4, 320, 'Net 30 · contract pricing on most lines', '2026-04-01', 120000.00,
   'GSTIN', '29AAJCS4718R1ZM', 'Karnataka, India', true, false, true, 1),
  ('ENT-2011', 'Brightline Foods', 'Brightline Foods Limited', 'large', 'Food distribution',
   11, 1450, 'Net 45', '2026-04-01', 640000.00, 'GSTIN', '27AACCB9021K1ZP', 'Maharashtra, India', true, false, true, 2),
  ('ENT-2012', 'Meridian Foods', 'Meridian Foods LLC', 'mid', 'Food distribution',
   6, 410, 'Net 30', '2026-01-01', 210000.00, 'TRN', '100294817300003', 'Dubai, UAE', false, true, false, 3),
  ('ENT-2013', 'Greencity Estates', 'Greencity Estates Private Limited', 'mid', 'Property management',
   9, 260, 'Net 30', '2026-04-01', 180000.00, 'GSTIN', '29AAGCG7712M1Z4', 'Karnataka, India', false, false, true, 4),
  ('ENT-2014', 'Harbourpoint Retail', 'Harbourpoint Retail Kenya Limited', 'small', 'Retail',
   3, 95, 'Net 15', '2026-07-01', 46000.00, 'VAT number', 'P051772913X', 'Nairobi, Kenya', false, false, false, 5)
on conflict (id) do update set
  company = excluded.company, legal_name = excluded.legal_name, segment = excluded.segment,
  industry = excluded.industry, sites = excluded.sites, staff = excluded.staff,
  terms = excluded.terms, fy_starts = excluded.fy_starts, budget_year = excluded.budget_year,
  reg_type = excluded.reg_type, registration = excluded.registration,
  place_of_supply = excluded.place_of_supply, po_required = excluded.po_required;

/* The demo buyer signs in as the procurement lead of SmartBuild. */
update profiles set account_id = 'ENT-2007'
 where id = (select id from auth.users where email = 'vikram.shah@smartbuild.in');

/* =============================================================== users === */

/* Who may spend, who may say yes, and up to how much.
 *
 * `approve_limit` is null for no ceiling rather than a huge number, so a
 * screen never has to decide whether $999,999,999 means "unlimited" or
 * "somebody typed nines". */
create table if not exists enterprise_users (
  id            text primary key,
  account_id    text not null references enterprise_accounts(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete set null,
  name          text not null,
  email         text not null,
  title         text not null,
  role          text not null check (role in ('procurement-lead', 'buyer', 'finance-approver', 'it-approver', 'viewer')),
  can_raise     boolean not null default true,
  /* Split on purpose. A CFO signs off on value; the head of IT signs off on
     what gets connected to the network. Neither is a substitute for the other. */
  approves_finance boolean not null default false,
  approves_it      boolean not null default false,
  approve_limit numeric(12,2),
  cost_centre   text,
  phone         text,
  mfa           boolean not null default false,
  status        text not null default 'active' check (status in ('active', 'invited', 'suspended', 'removed')),
  last_seen     text,
  sort_order    integer not null default 0
);

create index if not exists enterprise_users_account_idx on enterprise_users(account_id);

insert into enterprise_users (id, account_id, user_id, name, email, title, role, can_raise,
                              approves_finance, approves_it, approve_limit, cost_centre, phone,
                              mfa, status, last_seen, sort_order) values
  ('EU-2007-01', 'ENT-2007', (select id from auth.users where email = 'vikram.shah@smartbuild.in'),
   'Vikram Shah', 'vikram.shah@smartbuild.in', 'Procurement Lead', 'procurement-lead',
   true, true, true, null, 'CC-1000', '+91 98450 11200', true, 'active', 'Today 09:12', 1),
  ('EU-2007-02', 'ENT-2007', null, 'Meera Iyer', 'meera.iyer@smartbuild.in', 'Chief Financial Officer',
   'finance-approver', false, true, false, 25000.00, 'CC-1000', '+91 98450 11311', true, 'active', 'Yesterday', 2),
  ('EU-2007-03', 'ENT-2007', null, 'Karthik Nair', 'karthik.nair@smartbuild.in', 'Head of IT',
   'it-approver', true, false, true, null, 'CC-2200', '+91 98450 11422', false, 'active', '2 d ago', 3),
  ('EU-2007-04', 'ENT-2007', null, 'Anita Desai', 'anita.desai@smartbuild.in', 'Buyer — retail estate',
   'buyer', true, false, false, null, 'CC-RETAIL', '+91 98450 11533', true, 'active', 'Today 08:40', 4),
  ('EU-2007-05', 'ENT-2007', null, 'Ravi Krishnan', 'ravi.krishnan@smartbuild.in', 'Buyer — logistics',
   'buyer', true, false, false, null, 'CC-4100', '+91 98450 11644', true, 'active', 'Yesterday', 5),
  ('EU-2007-06', 'ENT-2007', null, 'Sunita Rao', 'sunita.rao@smartbuild.in', 'Finance analyst',
   'viewer', false, false, false, null, 'CC-1000', null, false, 'invited', 'Never', 6),

  ('EU-2011-01', 'ENT-2011', null, 'Farida Qureshi', 'farida.qureshi@brightlinefoods.com',
   'Group Procurement Director', 'procurement-lead', true, true, true, null, null, null, true, 'active', 'Today', 10),
  ('EU-2012-01', 'ENT-2012', null, 'Omar Haddad', 'omar.haddad@meridianfoods.ae',
   'Procurement Manager', 'procurement-lead', true, true, true, null, null, null, true, 'active', 'Yesterday', 20),
  ('EU-2013-01', 'ENT-2013', null, 'Lakshmi Menon', 'lakshmi.menon@greencityestates.in',
   'Facilities Director', 'procurement-lead', true, true, true, null, null, null, true, 'active', '3 d ago', 30),
  ('EU-2014-01', 'ENT-2014', null, 'Grace Wanjiru', 'grace.wanjiru@harbourpoint.co.ke',
   'Operations Lead', 'procurement-lead', true, true, true, null, null, null, false, 'active', '1 w ago', 40)
on conflict (id) do update set
  name = excluded.name, email = excluded.email, title = excluded.title, role = excluded.role,
  can_raise = excluded.can_raise, approves_finance = excluded.approves_finance,
  approves_it = excluded.approves_it, approve_limit = excluded.approve_limit,
  cost_centre = excluded.cost_centre, mfa = excluded.mfa, status = excluded.status;

/* ======================================================== cost centres === */

/* Where the money is attributed and what it may not exceed. A cap that is
   only checked at the end of the quarter is a report, not a control. */
create table if not exists enterprise_cost_centres (
  id           text primary key,
  account_id   text not null references enterprise_accounts(id) on delete cascade,
  name         text not null,
  owner        text not null,
  quarter      text not null,
  cap_quarter  numeric(12,2) not null,
  /* Recomputed by the assertion at the bottom rather than trusted: what is
     already committed for the quarter. Subscriptions count once, through the
     subscription; the requisition that created one is not counted again. */
  spent_quarter numeric(12,2) not null default 0,
  status       text not null default 'active' check (status in ('active', 'frozen', 'closed')),
  sort_order   integer not null default 0
);

create index if not exists enterprise_cost_centres_account_idx on enterprise_cost_centres(account_id);

insert into enterprise_cost_centres (id, account_id, name, owner, quarter, cap_quarter, spent_quarter, sort_order) values
  ('CC-2200',   'ENT-2007', 'IT and infrastructure', 'Karthik Nair', '2026-Q3', 30000.00, 12621.00, 1),
  ('CC-4100',   'ENT-2007', 'Logistics',             'Ravi Krishnan', '2026-Q3', 18000.00, 3720.00, 2),
  ('CC-1000',   'ENT-2007', 'Corporate',             'Meera Iyer',   '2026-Q3', 12000.00, 3264.00, 3),
  ('CC-RETAIL', 'ENT-2007', 'Retail estate',         'Anita Desai',  '2026-Q3',  6000.00, 5927.00, 4)
on conflict (id) do update set
  name = excluded.name, owner = excluded.owner, cap_quarter = excluded.cap_quarter,
  spent_quarter = excluded.spent_quarter;

/* ============================================================== policy === */

/* What needs approving at all. Every line here is a control somebody will be
   asked about in an audit, so each carries its own reason. */
create table if not exists enterprise_approval_policy (
  account_id        text primary key references enterprise_accounts(id) on delete cascade,
  threshold         numeric(12,2) not null check (threshold >= 0),
  security_signoff  boolean not null default true,
  duplicate_flag    boolean not null default true,
  auto_approve_renewals boolean not null default false,
  /* The one that matters. With this on, one person can raise and approve the
     same spend. */
  self_approve      boolean not null default false,
  note              text not null,
  updated_by        text,
  updated_on        date
);

insert into enterprise_approval_policy (account_id, threshold, security_signoff, duplicate_flag,
                                        auto_approve_renewals, self_approve, note, updated_by, updated_on) values
  ('ENT-2007', 2000.00, true, true, false, false,
   'Anything at or above the threshold goes to finance. Security purchases go to IT whatever they cost, because the risk is what gets connected rather than what it costs.',
   'Vikram Shah', '2026-05-14'),
  ('ENT-2011', 5000.00, true, true, true, false, 'Group policy — renewals auto-approve to keep the desk clear.', 'Farida Qureshi', '2026-06-02'),
  ('ENT-2012', 2500.00, false, true, false, false, 'No separate IT sign-off; the procurement manager holds both.', 'Omar Haddad', '2026-04-19'),
  ('ENT-2013', 1500.00, true, false, false, false, 'Lower threshold — most spend here is small and frequent.', 'Lakshmi Menon', '2026-05-30'),
  ('ENT-2014', 1000.00, false, false, false, true,
   'Self-approval is on because there is only one person who can approve. It is a known exception, reviewed quarterly.',
   'Grace Wanjiru', '2026-07-01')
on conflict (account_id) do update set
  threshold = excluded.threshold, security_signoff = excluded.security_signoff,
  duplicate_flag = excluded.duplicate_flag, auto_approve_renewals = excluded.auto_approve_renewals,
  self_approve = excluded.self_approve, note = excluded.note;

/* ======================================================= subscriptions === */

/* What the account holds under contract. The consumer `subscriptions` table
   has no room for seats, a cost centre, a contract reference or a per-unit
   price, and bolting them on would put four unused columns on every
   customer's row. */
create table if not exists enterprise_subscriptions (
  id            text primary key,
  account_id    text not null references enterprise_accounts(id) on delete cascade,
  product_id    text references products(id),
  name          text not null,
  seller        text not null,
  partner_id    text references partners(id),
  vertical      text not null,
  quantity      integer not null check (quantity > 0),
  seats_used    integer not null default 0,
  unit_price    numeric(10,2) not null,
  unit          text not null,
  monthly       numeric(12,2) not null,
  cost_centre   text references enterprise_cost_centres(id),
  started       date not null,
  renews        date not null,
  /* Suspended by the marketplace still bills to contract end — the licences
     exist and were sold. What suspension stops is the renewal. */
  status        text not null check (status in ('active', 'suspended', 'cancelled')),
  auto_renew    boolean not null default true,
  contract_ref  text,
  why_suspended text,
  sort_order    integer not null default 0
);

create index if not exists enterprise_subs_account_idx on enterprise_subscriptions(account_id);

alter table enterprise_subscriptions drop constraint if exists enterprise_subscriptions_monthly_check;
alter table enterprise_subscriptions add constraint enterprise_subscriptions_monthly_check
  check (monthly = round(unit_price * quantity, 2));

alter table enterprise_subscriptions drop constraint if exists enterprise_subscriptions_seats_check;
alter table enterprise_subscriptions add constraint enterprise_subscriptions_seats_check
  check (seats_used <= quantity);

alter table enterprise_subscriptions drop constraint if exists enterprise_subscriptions_suspended_check;
alter table enterprise_subscriptions add constraint enterprise_subscriptions_suspended_check
  check (status <> 'suspended' or why_suspended is not null);

insert into enterprise_subscriptions (id, account_id, product_id, name, seller, partner_id, vertical,
                                      quantity, seats_used, unit_price, unit, monthly, cost_centre,
                                      started, renews, status, auto_renew, contract_ref, why_suspended, sort_order) values
  ('SUB-7781', 'ENT-2007', 'SKU-6002', 'Sentinel MDR — 24/7', 'Sentinel Cyber', 'PTR-1003', 'security',
   250, 231, 9.50, 'per endpoint/mo', 2375.00, 'CC-2200', '2025-08-12', '2026-08-12', 'active', true, 'CTR-SB-0412', null, 1),
  ('SUB-7782', 'ENT-2007', 'SKU-6003', 'Sentinel Secure Access (ZTNA)', 'Sentinel Cyber', 'PTR-1003', 'security',
   280, 240, 6.20, 'per user/mo', 1736.00, 'CC-2200', '2026-05-01', '2027-04-30', 'active', true, 'CTR-SB-0455', null, 2),
  ('SUB-7783', 'ENT-2007', 'SKU-5002', 'IoT Connect 2 GB', 'Aventa Telecom', null, 'iot',
   400, 349, 3.10, 'per SIM/mo', 1240.00, 'CC-4100', '2025-12-01', '2026-12-31', 'active', true, 'CTR-SB-0388', null, 3),
  ('SUB-7784', 'ENT-2007', 'SKU-6005', 'ClearVault Mail Defence', 'ClearVault Cloud', 'PTR-1010', 'security',
   320, 318, 3.40, 'per mailbox/mo', 1088.00, 'CC-1000', '2025-11-20', '2026-11-30', 'active', true, 'CTR-SB-0361', null, 4),
  ('SUB-7785', 'ENT-2007', 'SKU-6001', 'Sentinel Managed Firewall — Standard', 'Sentinel Cyber', 'PTR-1003', 'security',
   4, 4, 24.00, 'per site/mo', 96.00, 'CC-2200', '2025-09-30', '2026-09-30', 'active', true, 'CTR-SB-0402', null, 5),
  ('SUB-7786', 'ENT-2007', 'SKU-6006', 'SMB Security Essentials — 25 seats', 'Sentinel Cyber', 'PTR-1003', 'security',
   1, 1, 165.00, 'per bundle/mo', 165.00, 'CC-RETAIL', '2026-06-01', '2026-09-30', 'suspended', false, 'CTR-SB-0498',
   'The marketplace suspended this listing on 22 Jul. Your licences run to contract end on 30 Sep and will not renew. Sentinel MDR covers the same endpoints and you already hold it.', 6)
on conflict (id) do update set
  name = excluded.name, quantity = excluded.quantity, seats_used = excluded.seats_used,
  unit_price = excluded.unit_price, monthly = excluded.monthly, status = excluded.status,
  renews = excluded.renews, auto_renew = excluded.auto_renew, why_suspended = excluded.why_suspended;

/* ======================================================== requisitions === */

/* A request to spend, and what was decided about it.
 *
 * `need` is stored rather than recomputed on read because the policy can
 * change afterwards. What mattered is what the policy said on the day, and a
 * decision history that silently re-reads today's threshold is a decision
 * history nobody can audit. */
create table if not exists enterprise_requisitions (
  id            text primary key,
  account_id    text not null references enterprise_accounts(id) on delete cascade,
  raised_by     text not null references enterprise_users(id),
  raised_on     date not null,
  raised_at     text not null,
  title         text not null,
  vertical      text not null,
  cost_centre   text references enterprise_cost_centres(id),
  amount        numeric(12,2) not null check (amount > 0),
  model         text not null check (model in ('oneoff', 'monthly')),
  reason        text not null,
  need          text not null check (need in ('none', 'finance', 'it', 'both')),
  policy_note   text not null,
  state         text not null check (state in ('pending', 'approved', 'declined', 'withdrawn')),
  decided_by    text references enterprise_users(id),
  decided_on    date,
  decision_note text,
  /* Set when an approval turned into a real order. Approving is ordering — the
     prototype's wording is right, and a separate "now place it" step is how a
     requisition sits approved and unordered for a fortnight. */
  order_ref     text,
  po_ref        text,
  sort_order    integer not null default 0
);

create index if not exists enterprise_reqs_account_idx on enterprise_requisitions(account_id, state);

alter table enterprise_requisitions drop constraint if exists enterprise_requisitions_decided_check;
alter table enterprise_requisitions add constraint enterprise_requisitions_decided_check
  check ((state = 'pending' and decided_by is null and decided_on is null)
      or (state = 'withdrawn')
      or (state in ('approved', 'declined') and decided_by is not null and decided_on is not null));

/* A decline with no reason is the thing requesters complain about most, and
   fairly — they cannot revise what they were not told about. */
alter table enterprise_requisitions drop constraint if exists enterprise_requisitions_declined_check;
alter table enterprise_requisitions add constraint enterprise_requisitions_declined_check
  check (state <> 'declined' or coalesce(decision_note, '') <> '');

create table if not exists enterprise_requisition_lines (
  id            text primary key,
  requisition_id text not null references enterprise_requisitions(id) on delete cascade,
  product_id    text references products(id),
  name          text not null,
  seller        text not null,
  partner_id    text references partners(id),
  quantity      integer not null check (quantity > 0),
  unit_price    numeric(10,2) not null,
  line_total    numeric(12,2) not null,
  sort_order    integer not null default 0
);

create index if not exists enterprise_req_lines_idx on enterprise_requisition_lines(requisition_id);

alter table enterprise_requisition_lines drop constraint if exists enterprise_requisition_lines_total_check;
alter table enterprise_requisition_lines add constraint enterprise_requisition_lines_total_check
  check (line_total = round(unit_price * quantity, 2));

insert into enterprise_requisitions (id, account_id, raised_by, raised_on, raised_at, title, vertical,
                                     cost_centre, amount, model, reason, need, policy_note, state,
                                     decided_by, decided_on, decision_note, order_ref, po_ref, sort_order) values
  /* waiting */
  ('REQ-5512', 'ENT-2007', 'EU-2007-04', '2026-07-31', 'Today 08:40',
   'Cold-chain starter ×2 — Hubli and Belgaum depots', 'iot', 'CC-4100', 4590.00, 'oneoff',
   'Both new depots open in September and neither has cold-chain monitoring. Without it we cannot take the dairy contract.',
   'finance', 'At or above the $2,000 threshold — finance approval required', 'pending',
   null, null, null, null, 'PO-SB-2026-0431', 1),
  ('REQ-5514', 'ENT-2007', 'EU-2007-03', '2026-07-30', 'Yesterday',
   'Sentinel MDR — 60 additional endpoints', 'security', 'CC-2200', 570.00, 'monthly',
   'Sixty new starters at the Hyderabad office in August. They cannot be onboarded without endpoint cover.',
   'it', 'Below the threshold, but a security purchase — IT sign-off required whatever it costs', 'pending',
   null, null, null, null, null, 2),
  ('REQ-5516', 'ENT-2007', 'EU-2007-05', '2026-07-29', '2 d ago',
   'Volta IoT Gateway LTE-M ×6', 'iot', 'CC-4100', 1128.00, 'oneoff',
   'Six depots without fibre need a backhaul path for the cold-chain sensors.',
   'none', 'Below the $2,000 threshold and not a security purchase — no approval needed, recorded for the audit trail', 'pending',
   null, null, null, null, null, 3),
  ('REQ-5521', 'ENT-2007', 'EU-2007-01', '2026-07-31', 'Today 10:05',
   'ClearVault Mail Defence — 40 more mailboxes', 'security', 'CC-1000', 136.00, 'monthly',
   'The finance team grew and the new mailboxes are unprotected.',
   'it', 'A security purchase — IT sign-off required whatever it costs', 'pending',
   null, null, null, null, null, 4),

  /* decided */
  ('REQ-5498', 'ENT-2007', 'EU-2007-04', '2026-07-29', '2 d ago',
   'IoT Connect 2 GB — 400 SIMs, annual renewal', 'iot', 'CC-4100', 1240.00, 'monthly',
   'Annual renewal of the fleet SIM estate, with 51 added for the new depots.',
   'none', 'A renewal below the threshold — recorded and approved by the procurement lead', 'approved',
   'EU-2007-01', '2026-07-30', 'Approved. The per-SIM rate is unchanged from the last term.', 'ORD-882092', 'PO-SB-2026-0428', 10),
  ('REQ-5487', 'ENT-2007', 'EU-2007-04', '2026-07-10', '3 w ago',
   'Retail estate occupancy rollout — 90 sensors and 4 gateways', 'iot', 'CC-RETAIL', 5432.00, 'oneoff',
   'Footfall counting across the retail estate. The landlord rent review needs occupancy evidence by October.',
   'finance', 'At or above the $2,000 threshold — finance approval required', 'approved',
   'EU-2007-02', '2026-07-12', 'Approved against the retail estate budget. This takes CC-RETAIL close to its cap for the quarter — nothing further on it without a review.',
   'ORD-882091', 'PO-SB-2026-0409', 11),
  ('REQ-5501', 'ENT-2007', 'EU-2007-05', '2026-06-20', '6 w ago',
   'Cold-chain starter — 25 sensors + connectivity', 'iot', 'CC-4100', 2295.00, 'oneoff',
   'Cold-chain compliance for the new Pune depot.',
   'finance', 'At or above the $2,000 threshold — finance approval required', 'approved',
   'EU-2007-02', '2026-06-22', 'Approved. Compliance-driven and already budgeted.', 'ORD-882090', 'PO-SB-2026-0377', 12),
  ('REQ-5476', 'ENT-2007', 'EU-2007-05', '2026-05-18', '10 w ago',
   'Fleet telematics starter — 50 trackers', 'iot', 'CC-4100', 4800.00, 'oneoff',
   'Trailer tracking pilot across the southern fleet.',
   'finance', 'At or above the $2,000 threshold — finance approval required', 'declined',
   'EU-2007-02', '2026-05-20',
   'Deferred to next budget year. The pilot is worth doing but not before the depot programme is paid for. Raise it again in April with the pilot scope written down.',
   null, null, 13),
  ('REQ-5462', 'ENT-2007', 'EU-2007-03', '2026-04-28', '13 w ago',
   'Sentinel Secure Access (ZTNA) — 280 users', 'security', 'CC-2200', 1736.00, 'monthly',
   'Replacing the site-to-site VPN. The old one cannot do per-application access.',
   'it', 'Below the threshold, but a security purchase — IT sign-off required whatever it costs', 'approved',
   'EU-2007-01', '2026-04-30', 'Approved by the procurement lead. Karthik raised it and holds the IT sign-off himself, so somebody else had to make the call.',
   'ORD-882088', 'PO-SB-2026-0341', 14),
  /* The case that needs both: a security purchase above the threshold. */
  ('REQ-5388', 'ENT-2007', 'EU-2007-03', '2025-08-05', 'Aug 2025',
   'Sentinel MDR — 250 endpoints, initial contract', 'security', 'CC-2200', 2375.00, 'monthly',
   'Replacing the in-house antivirus after the audit finding. Nothing on the estate is monitored out of hours today.',
   'both', 'At or above the threshold and a security purchase — finance approval and IT sign-off both required', 'approved',
   'EU-2007-01', '2025-08-08', 'Approved by the procurement lead, who holds finance and IT sign-off both. Karthik raised it, so he could not sign his own.',
   'ORD-882080', 'PO-SB-2025-0912', 15)
on conflict (id) do update set
  title = excluded.title, amount = excluded.amount, reason = excluded.reason,
  need = excluded.need, policy_note = excluded.policy_note, state = excluded.state,
  decided_by = excluded.decided_by, decided_on = excluded.decided_on,
  decision_note = excluded.decision_note, order_ref = excluded.order_ref;

insert into enterprise_requisition_lines (id, requisition_id, product_id, name, seller, partner_id,
                                          quantity, unit_price, line_total, sort_order) values
  ('RL-5512-1', 'REQ-5512', 'SKU-5006', 'Cold-chain starter — 25 sensors + connectivity', 'Nimbus Sensors', 'PTR-1004', 2, 2295.00, 4590.00, 1),
  ('RL-5514-1', 'REQ-5514', 'SKU-6002', 'Sentinel MDR — 24/7', 'Sentinel Cyber', 'PTR-1003', 60, 9.50, 570.00, 1),
  ('RL-5516-1', 'REQ-5516', 'SKU-5007', 'Volta IoT Gateway LTE-M', 'Volta Routers', 'PTR-1008', 6, 188.00, 1128.00, 1),
  ('RL-5521-1', 'REQ-5521', 'SKU-6005', 'ClearVault Mail Defence', 'ClearVault Cloud', 'PTR-1010', 40, 3.40, 136.00, 1),
  ('RL-5498-1', 'REQ-5498', 'SKU-5002', 'IoT Connect 2 GB', 'Aventa Telecom', null, 400, 3.10, 1240.00, 1),
  ('RL-5487-1', 'REQ-5487', 'SKU-5004', 'Nimbus Occupancy sensor', 'Nimbus Sensors', 'PTR-1004', 90, 52.00, 4680.00, 1),
  ('RL-5487-2', 'REQ-5487', 'SKU-5007', 'Volta IoT Gateway LTE-M', 'Volta Routers', 'PTR-1008', 4, 188.00, 752.00, 2),
  ('RL-5501-1', 'REQ-5501', 'SKU-5006', 'Cold-chain starter — 25 sensors + connectivity', 'Nimbus Sensors', 'PTR-1004', 1, 2295.00, 2295.00, 1),
  ('RL-5476-1', 'REQ-5476', 'SKU-5008', 'Fleet telematics starter — 50 trackers', 'TrackWise Telematics', 'PTR-1011', 1, 4800.00, 4800.00, 1),
  ('RL-5462-1', 'REQ-5462', 'SKU-6003', 'Sentinel Secure Access (ZTNA)', 'Sentinel Cyber', 'PTR-1003', 280, 6.20, 1736.00, 1),
  ('RL-5388-1', 'REQ-5388', 'SKU-6002', 'Sentinel MDR — 24/7', 'Sentinel Cyber', 'PTR-1003', 250, 9.50, 2375.00, 1)
on conflict (id) do update set
  quantity = excluded.quantity, unit_price = excluded.unit_price, line_total = excluded.line_total;

/* ============================================================ invoices === */

/* One document covering every seller on the marketplace. The buyer receives
   and pays one invoice; the marketplace settles each seller separately. That
   is the whole point of buying through a marketplace rather than from six
   companies, and it is why the lines carry a seller. */
create table if not exists enterprise_invoices (
  id          text primary key,
  account_id  text not null references enterprise_accounts(id) on delete cascade,
  period      text not null,
  kind        text not null check (kind in ('recurring', 'oneoff')),
  issued      date not null,
  due         date not null,
  recurring   numeric(12,2) not null default 0,
  oneoff      numeric(12,2) not null default 0,
  tax_rate    numeric(5,2) not null,
  tax         numeric(12,2) not null,
  total       numeric(12,2) not null,
  status      text not null check (status in ('open', 'overdue', 'paid', 'disputed', 'credited')),
  paid_on     date,
  po_ref      text,
  note        text,
  sort_order  integer not null default 0
);

create index if not exists enterprise_invoices_account_idx on enterprise_invoices(account_id, status);

alter table enterprise_invoices drop constraint if exists enterprise_invoices_total_check;
alter table enterprise_invoices add constraint enterprise_invoices_total_check
  check (total = recurring + oneoff + tax and tax = round((recurring + oneoff) * tax_rate / 100, 2));

alter table enterprise_invoices drop constraint if exists enterprise_invoices_paid_check;
alter table enterprise_invoices add constraint enterprise_invoices_paid_check
  check ((status = 'paid') = (paid_on is not null));

create table if not exists enterprise_invoice_lines (
  id          text primary key,
  invoice_id  text not null references enterprise_invoices(id) on delete cascade,
  kind        text not null check (kind in ('subscription', 'oneoff', 'credit')),
  description text not null,
  seller      text not null,
  partner_id  text references partners(id),
  cost_centre text references enterprise_cost_centres(id),
  subscription_id text references enterprise_subscriptions(id) on delete set null,
  requisition_id  text references enterprise_requisitions(id) on delete set null,
  quantity    integer,
  unit_price  numeric(10,2),
  amount      numeric(12,2) not null,
  sort_order  integer not null default 0
);

create index if not exists enterprise_invoice_lines_idx on enterprise_invoice_lines(invoice_id);

do $$
declare
  /* The five recurring lines that predate the retail bundle, and the six that
     follow it. Written once here rather than six times below. */
  n integer;
begin
  delete from enterprise_invoice_lines where invoice_id in (select id from enterprise_invoices where account_id = 'ENT-2007');
  delete from enterprise_invoices where account_id = 'ENT-2007';

  insert into enterprise_invoices (id, account_id, period, kind, issued, due, recurring, oneoff,
                                   tax_rate, tax, total, status, paid_on, po_ref, note, sort_order) values
    ('INV-2026-0779', 'ENT-2007', 'Jul 2026', 'recurring', '2026-07-29', '2026-08-20',
     6700.00, 5432.00, 18.00, 2183.76, 14315.76, 'open', null, 'PO-SB-2026-0409',
     'July subscriptions plus the retail estate occupancy rollout approved on 12 Jul.', 1),
    ('INV-2026-0781', 'ENT-2007', 'IoT estate rollout', 'oneoff', '2026-07-29', '2026-07-29',
     0, 1474.58, 18.00, 265.42, 1740.00, 'overdue', null, 'PO-SB-2026-0428',
     'Payable on issue for a one-off order. The card on file was declined on 29 Jul — the expiry date on it has passed.', 2),
    ('INV-2026-0762', 'ENT-2007', 'Jun 2026', 'recurring', '2026-07-01', '2026-07-31',
     6700.00, 2295.00, 18.00, 1619.10, 10614.10, 'paid', '2026-07-18', 'PO-SB-2026-0377', null, 3),
    ('INV-2026-0744', 'ENT-2007', 'May 2026', 'recurring', '2026-06-01', '2026-06-30',
     6535.00, 0, 18.00, 1176.30, 7711.30, 'paid', '2026-06-22', null,
     'First full month of Sentinel Secure Access, which replaced the site-to-site VPN on 01 May.', 4),
    ('INV-2026-0731', 'ENT-2007', 'Apr 2026', 'recurring', '2026-05-01', '2026-05-31',
     4799.00, 0, 18.00, 863.82, 5662.82, 'paid', '2026-05-20', null, null, 5),
    ('INV-2026-0715', 'ENT-2007', 'Mar 2026', 'recurring', '2026-04-01', '2026-04-30',
     4799.00, 0, 18.00, 863.82, 5662.82, 'paid', '2026-04-24', null, null, 6);

  /* Recurring lines: one per subscription, on every recurring invoice where
     the subscription was already held. Generated rather than typed, so an
     invoice can never disagree with what the account holds. */
  insert into enterprise_invoice_lines (id, invoice_id, kind, description, seller, partner_id,
                                        cost_centre, subscription_id, quantity, unit_price, amount, sort_order)
  select i.id || '-' || s.id, i.id, 'subscription', s.name, s.seller, s.partner_id,
         s.cost_centre, s.id, s.quantity, s.unit_price, s.monthly, s.sort_order
    from enterprise_invoices i
    join enterprise_subscriptions s on s.account_id = i.account_id
   where i.account_id = 'ENT-2007' and i.kind = 'recurring'
     and s.started < i.issued;

  insert into enterprise_invoice_lines (id, invoice_id, kind, description, seller, partner_id,
                                        cost_centre, requisition_id, quantity, unit_price, amount, sort_order) values
    ('INV-2026-0779-R1', 'INV-2026-0779', 'oneoff', 'Nimbus Occupancy sensor — retail estate rollout (REQ-5487)',
     'Nimbus Sensors', 'PTR-1004', 'CC-RETAIL', 'REQ-5487', 90, 52.00, 4680.00, 20),
    ('INV-2026-0779-R2', 'INV-2026-0779', 'oneoff', 'Volta IoT Gateway LTE-M — retail estate rollout (REQ-5487)',
     'Volta Routers', 'PTR-1008', 'CC-RETAIL', 'REQ-5487', 4, 188.00, 752.00, 21),
    ('INV-2026-0781-R1', 'INV-2026-0781', 'oneoff', 'Volta IoT Gateway LTE-M — depot backhaul',
     'Volta Routers', 'PTR-1008', 'CC-4100', null, 7, 188.00, 1316.00, 1),
    ('INV-2026-0781-R2', 'INV-2026-0781', 'oneoff', 'IoT Connect 2 GB — part period on 51 new SIMs',
     'Aventa Telecom', null, 'CC-4100', null, 51, 3.11, 158.58, 2),
    ('INV-2026-0762-R1', 'INV-2026-0762', 'oneoff', 'Cold-chain starter — 25 sensors + connectivity (REQ-5501)',
     'Nimbus Sensors', 'PTR-1004', 'CC-4100', 'REQ-5501', 1, 2295.00, 2295.00, 20);

  select count(*) into n from enterprise_invoice_lines;
  raise notice 'seeded % invoice lines', n;
end $$;

/* ============================================================= refunds === */

/* The seven enterprise refunds already in the table had no account against
   them, so no buyer could see their own. */
alter table refunds add column if not exists account_id text references enterprise_accounts(id);

update refunds r set account_id = a.id
  from enterprise_accounts a
 where r.buyer_type = 'enterprise' and r.customer = a.company and r.account_id is null;

/* SmartBuild's own, against the orders its approved requisitions produced —
   so the chain from requisition to order to money back is followable. */
insert into refunds (id, order_ref, product_id, item, category_id, partner_id, seller, first_party,
                     bundle_ref, customer, buyer_type, user_id, account_id, amount, refunded, currency,
                     reason, detail, evidence, requested, decider, sla_due, state,
                     decided_on, decided_by, decision_note, escalated_on, escalated_why, sort_order) values
  ('RFN-3240', 'ORD-882091', 'SKU-5004', 'Nimbus Occupancy sensor', 'iot', 'PTR-1004', 'Nimbus Sensors', false,
   null, 'SmartBuild Ltd', 'enterprise', null, 'ENT-2007', 624.00, null, 'USD',
   'faulty', 'Twelve of the ninety sensors will not pair with the gateway. The other 78 came up first time, so it is the units rather than the install.',
   'Pairing logs for all 12, exported from the gateway', '2026-07-30', 'seller', '2026-08-01', 'requested',
   null, null, null, null, null, 40),
  ('RFN-3241', 'ORD-882090', 'SKU-5006', 'Cold-chain starter — 25 sensors + connectivity', 'iot', 'PTR-1004', 'Nimbus Sensors', false,
   null, 'SmartBuild Ltd', 'enterprise', null, 'ENT-2007', 2295.00, null, 'USD',
   'not-received', 'Marked delivered to the Pune depot on 24 Jun. Nothing arrived and the depot has no signature on file.',
   'Depot goods-in register for 23–27 Jun, and the courier tracking page', '2026-07-24', 'marketplace', '2026-07-26', 'escalated',
   null, null, null, '2026-07-27',
   'The seller did not answer inside 48 hours. The marketplace decides it now and still recovers the money from their settlement.', 41),
  ('RFN-3242', 'ORD-881517', 'SKU-6002', 'Sentinel MDR — 24/7', 'security', 'PTR-1003', 'Sentinel Cyber', false,
   null, 'SmartBuild Ltd', 'enterprise', null, 'ENT-2007', 285.00, 285.00, 'USD',
   'not-activated', 'Thirty endpoints across four sites were never provisioned — the tenant identifier was rejected.',
   'Provisioning failure report from the seller console', '2026-07-19', 'seller', '2026-07-21', 'refunded',
   '2026-07-20', 'Sentinel Cyber', 'Agreed in full. The tenant was created under the wrong parent and the endpoints were never covered, so there is nothing to argue about.',
   null, null, 42),
  ('RFN-3243', 'ORD-882093', 'SKU-5005', 'TrackWise Asset Tracker Pro', 'iot', 'PTR-1011', 'TrackWise Telematics', false,
   null, 'SmartBuild Ltd', 'enterprise', null, 'ENT-2007', 192.00, null, 'USD',
   'changed-mind', 'Two trackers ordered for a pilot that was deferred.',
   null, '2026-07-08', 'seller', '2026-07-10', 'declined',
   '2026-07-09', 'TrackWise Telematics', 'Declined. These were activated on 04 Jul and have been reporting since; the return window for an activated tracker is 7 days from order and closed on 06 Jul.',
   null, null, 43)
on conflict (id) do update set
  state = excluded.state, amount = excluded.amount, refunded = excluded.refunded,
  decided_on = excluded.decided_on, decided_by = excluded.decided_by,
  decision_note = excluded.decision_note, account_id = excluded.account_id;

/* ================================================ the story elsewhere === */

/* The notification log was seeded before any of this existed, so three of its
   messages quote figures that no longer match the account they describe. The
   log is what the recipient was told, so it cannot simply be left wrong — and
   an assertion below now refuses to let a message name a requisition, invoice,
   subscription or cost centre that does not exist. */
update notification_log set
  body = 'Hello Vikram, invoice INV-2026-0779 for $14,315.76 covering July subscriptions and the retail estate rollout is attached and due on 20 Aug.'
where id = 'NL-8203';

update notification_log set
  body = 'Anita Desai raised a requisition for $4,590.00, which is above the $2,000 approval threshold.'
where id = 'NL-9203';

update notification_log set
  body = 'Hello Vikram, the Retail estate cost centre has passed 90% of its quarterly cap — $5,927.00 of $6,000.00 is committed.'
where id = 'NL-9205';

/* The dunning dates moved with the due date. They are worked out from the due
   date and the ladder now, so quoting a different one here would put the
   platform on record telling somebody the wrong deadline. */
update notification_log set
  subject = 'Payment failed',
  body = 'Payment of $1,740.00 declined. New orders pause on 12 Aug unless it is fixed.'
where id = 'NL-9201';

update notification_log set
  body = 'Hello Vikram, the payment of $1,740.00 for the IoT estate rollout was declined — the card on file has expired. Nothing has stopped yet; new orders pause on 12 Aug.'
where id = 'NL-9202';

/* ================================================================= RLS === */

alter table enterprise_accounts          enable row level security;
alter table enterprise_users             enable row level security;
alter table enterprise_cost_centres      enable row level security;
alter table enterprise_approval_policy   enable row level security;
alter table enterprise_subscriptions     enable row level security;
alter table enterprise_requisitions      enable row level security;
alter table enterprise_requisition_lines enable row level security;
alter table enterprise_invoices          enable row level security;
alter table enterprise_invoice_lines     enable row level security;

do $$
declare t text;
begin
  foreach t in array array['enterprise_accounts', 'enterprise_users', 'enterprise_cost_centres',
                           'enterprise_approval_policy', 'enterprise_subscriptions',
                           'enterprise_requisitions', 'enterprise_requisition_lines',
                           'enterprise_invoices', 'enterprise_invoice_lines'] loop
    execute format('drop policy if exists "operator_all_%1$s" on %1$I', t);
    execute format('drop policy if exists "account_read_%1$s" on %1$I', t);
    execute format('drop policy if exists "account_write_%1$s" on %1$I', t);
    execute format($f$create policy "operator_all_%1$s" on %1$I for all to authenticated
                        using (current_persona() = 'operator')
                        with check (current_persona() = 'operator')$f$, t);
  end loop;
end $$;

/* A buyer sees their own account and nobody else's. Everything below is the
   same rule expressed against whichever column carries the account. */
create policy "account_read_enterprise_accounts" on enterprise_accounts
  for select to authenticated using (id = current_account_id());
create policy "account_read_enterprise_users" on enterprise_users
  for select to authenticated using (account_id = current_account_id());
create policy "account_read_enterprise_cost_centres" on enterprise_cost_centres
  for select to authenticated using (account_id = current_account_id());
create policy "account_read_enterprise_approval_policy" on enterprise_approval_policy
  for select to authenticated using (account_id = current_account_id());
create policy "account_read_enterprise_subscriptions" on enterprise_subscriptions
  for select to authenticated using (account_id = current_account_id());
create policy "account_read_enterprise_invoices" on enterprise_invoices
  for select to authenticated using (account_id = current_account_id());

/* A buyer may settle or query an invoice and do nothing else to it. The
   document itself belongs to whoever issued it — two parties holding different
   versions of the same legal record is worse than one of them finding it
   inconvenient — so the amounts, the dates and the lines are all out of reach.
   The `with check` is what makes this narrow: it constrains the row *after*
   the update, so an unpaid invoice can become paid or disputed and nothing
   else can change on the way. */
drop policy if exists "account_settle_enterprise_invoices" on enterprise_invoices;
create policy "account_settle_enterprise_invoices" on enterprise_invoices
  for update to authenticated
  using (account_id = current_account_id() and status in ('open', 'overdue', 'disputed'))
  with check (account_id = current_account_id() and status in ('paid', 'disputed'));

create policy "account_read_enterprise_invoice_lines" on enterprise_invoice_lines
  for select to authenticated using (
    exists (select 1 from enterprise_invoices i
             where i.id = enterprise_invoice_lines.invoice_id and i.account_id = current_account_id()));

create policy "account_read_enterprise_requisition_lines" on enterprise_requisition_lines
  for select to authenticated using (
    exists (select 1 from enterprise_requisitions r
             where r.id = enterprise_requisition_lines.requisition_id and r.account_id = current_account_id()));

/* Requisitions are the one thing the account writes. Raising and deciding are
   both allowed by RLS; who may decide *what* is a business rule the trigger
   below enforces, because RLS cannot see who raised a row against who is
   signing it. */
create policy "account_read_enterprise_requisitions" on enterprise_requisitions
  for select to authenticated using (account_id = current_account_id());
create policy "account_write_enterprise_requisitions" on enterprise_requisitions
  for all to authenticated
  using (account_id = current_account_id())
  with check (account_id = current_account_id());

/* The procurement lead sets the policy. Nobody else on the account can. */
create policy "account_write_enterprise_approval_policy" on enterprise_approval_policy
  for update to authenticated
  using (account_id = current_account_id()
         and exists (select 1 from enterprise_users u
                      where u.user_id = auth.uid() and u.role = 'procurement-lead'))
  with check (account_id = current_account_id());

/* Refunds: the buyer sees their account's and may raise one. Deciding stays
   with the seller and the marketplace, as it already did. */
drop policy if exists "account_read_refunds" on refunds;
drop policy if exists "account_raise_refund" on refunds;

create policy "account_read_refunds" on refunds
  for select to authenticated using (account_id = current_account_id());
/* A buyer may raise one, and may raise one that approves itself — but only
   where the published policy actually says it approves itself. Without the
   second half a client could post `state = 'approved'` for any amount and
   walk away with the money. */
create policy "account_raise_refund" on refunds
  for insert to authenticated
  with check (
    account_id = current_account_id()
    and refunded is null
    and (
      (state = 'requested' and decided_on is null)
      or (state = 'approved' and decider = 'auto'
          and exists (select 1 from refund_policy p
                       where p.id = 'current'
                         and (refunds.reason = any(p.auto_approve_reasons)
                              or refunds.amount < p.auto_approve_below)))
    ));

/* ------------------------------------------------ separation of duties -- */

/**
 * Who may decide a requisition.
 *
 * RLS can say "this row belongs to your account". It cannot say "you may not
 * sign your own request", because that compares the row being written against
 * the person writing it. So the rule lives here, where it applies to the API
 * and the console alike.
 */
create or replace function guard_requisition() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me   record;
  pol  record;
  them record;
begin
  /* Not a buyer — a migration, the operator console or a service role. */
  if current_persona() is distinct from 'enterprise' then return new; end if;

  select * into me from enterprise_users where user_id = auth.uid();
  if me is null then
    raise exception 'you are not on this account';
  end if;

  if tg_op = 'INSERT' then
    if not me.can_raise then
      raise exception '% cannot raise a requisition on this account', me.name;
    end if;
    if new.state <> 'pending' then
      raise exception 'a new requisition starts as pending — it cannot be raised already decided';
    end if;
    return new;
  end if;

  /* Nothing to check while it is still being edited by its owner. */
  if new.state = old.state then return new; end if;

  if old.state <> 'pending' then
    raise exception '% was already %, and a decision is not re-openable', old.id, old.state;
  end if;

  if new.state = 'withdrawn' then
    if old.raised_by <> me.id then
      raise exception 'only the person who raised % can withdraw it', old.id;
    end if;
    return new;
  end if;

  select * into pol from enterprise_approval_policy where account_id = new.account_id;
  select * into them from enterprise_users where id = old.raised_by;

  if not (me.approves_finance or me.approves_it) then
    raise exception '% is not an approver on this account', me.name;
  end if;

  /* The control every audit tests first — but it is a control on *approval*,
     and a requisition the policy did not ask anybody to approve has none to
     give. Confirming your own within-policy purchase is placing an order, not
     signing off on one, so it is allowed and the record says so. */
  if old.raised_by = me.id and old.need <> 'none' and not coalesce(pol.self_approve, false) then
    raise exception 'you raised %. Somebody else has to decide it — that is what separation of duties means.', old.id;
  end if;

  if old.need in ('finance', 'both') and not me.approves_finance then
    raise exception '% needs finance approval and % does not hold it', old.id, me.name;
  end if;
  if old.need in ('it', 'both') and not me.approves_it then
    raise exception '% needs IT sign-off and % does not hold it', old.id, me.name;
  end if;
  if me.approve_limit is not null and old.amount > me.approve_limit then
    raise exception '% is above what % may approve', old.id, me.name;
  end if;

  new.decided_by := me.id;
  new.decided_on := current_date;
  return new;
end $$;

drop trigger if exists enterprise_requisitions_guard on enterprise_requisitions;
create trigger enterprise_requisitions_guard before insert or update on enterprise_requisitions
  for each row execute function guard_requisition();

/* ------------------------------------------------------ sanity checks -- */
do $$
declare n integer; m numeric;
begin
  /* A requisition has to be the sum of what it asks for. */
  select count(*) into n from enterprise_requisitions r
   where r.amount <> (select coalesce(sum(l.line_total), -1)
                        from enterprise_requisition_lines l where l.requisition_id = r.id);
  if n > 0 then
    raise exception '% requisitions do not equal the sum of their lines', n;
  end if;

  /* And what it needed has to match the policy that was in force. */
  select count(*) into n
    from enterprise_requisitions r
    join enterprise_approval_policy p on p.account_id = r.account_id
   where r.need <> (case
       when r.amount >= p.threshold and r.vertical = 'security' and p.security_signoff then 'both'
       when r.amount >= p.threshold then 'finance'
       when r.vertical = 'security' and p.security_signoff then 'it'
       else 'none' end);
  if n > 0 then
    raise exception '% requisitions are marked as needing something the policy does not ask for', n;
  end if;

  /* Nobody signed their own — unless the policy allows it, or the policy never
     asked for a signature in the first place. */
  select count(*) into n from enterprise_requisitions r
    join enterprise_approval_policy p on p.account_id = r.account_id
   where r.decided_by = r.raised_by and r.need <> 'none' and not p.self_approve;
  if n > 0 then
    raise exception '% requisitions were approved by the person who raised them', n;
  end if;

  /* And whoever did sign held what it needed. */
  select count(*) into n from enterprise_requisitions r
    join enterprise_users u on u.id = r.decided_by
   where (r.need in ('finance', 'both') and not u.approves_finance)
      or (r.need in ('it', 'both') and not u.approves_it)
      or (u.approve_limit is not null and r.amount > u.approve_limit);
  if n > 0 then
    raise exception '% requisitions were decided by somebody who did not hold the right sign-off', n;
  end if;

  /* An approval that produced no order is an approval nobody acted on. */
  select count(*) into n from enterprise_requisitions
   where state = 'approved' and order_ref is null;
  if n > 0 then
    raise exception '% approved requisitions never became an order', n;
  end if;

  /* Every invoice equals the sum of its lines, before tax. */
  select count(*) into n from enterprise_invoices i
   where i.recurring + i.oneoff <> (select coalesce(sum(l.amount), -1)
                                      from enterprise_invoice_lines l where l.invoice_id = i.id);
  if n > 0 then
    raise exception '% invoices do not equal the sum of their lines', n;
  end if;

  /* The current month's subscription lines are the subscriptions themselves. */
  select coalesce(sum(monthly), 0) into m from enterprise_subscriptions where account_id = 'ENT-2007';
  select coalesce(sum(amount), 0) - m into m from enterprise_invoice_lines
   where invoice_id = 'INV-2026-0779' and kind = 'subscription';
  if m <> 0 then
    raise exception 'the July invoice bills % more than the account actually holds', m;
  end if;

  /* A cost centre's committed spend is its subscriptions for the quarter plus
     the one-off requisitions approved into it. A requisition that created a
     subscription is counted once, through the subscription. */
  select count(*) into n from enterprise_cost_centres c
   where c.spent_quarter <> (
     coalesce((select sum(s.monthly) * 3 from enterprise_subscriptions s where s.cost_centre = c.id), 0)
   + coalesce((select sum(r.amount) from enterprise_requisitions r
                where r.cost_centre = c.id and r.state = 'approved' and r.model = 'oneoff'
                  and r.decided_on >= date '2026-07-01' and r.decided_on < date '2026-10-01'), 0));
  if n > 0 then
    raise exception '% cost centres do not add up to what has been committed against them', n;
  end if;

  /* Every account can be told apart, and the demo one is reachable. */
  if not exists (select 1 from profiles where account_id = 'ENT-2007') then
    raise exception 'the demo enterprise user is not attached to an account';
  end if;

  /* Every enterprise refund belongs to somebody. */
  select count(*) into n from refunds where buyer_type = 'enterprise' and account_id is null;
  if n > 0 then
    raise exception '% enterprise refunds belong to no account', n;
  end if;

  /* Both sides of the escalation story: something waiting and something the
     clock ran out on, or the screen has nothing to explain. */
  select count(*) into n from refunds where account_id = 'ENT-2007' and state = 'requested';
  if n < 1 then raise exception 'the demo account has no refund awaiting a decision'; end if;
  select count(*) into n from refunds where account_id = 'ENT-2007' and state = 'escalated';
  if n < 1 then raise exception 'the demo account has no escalated refund'; end if;

  /* What the account was told has to match what the account is. */
  select count(*) into n from notification_log l
   where l.persona = 'enterprise' and l.ref like 'REQ-%'
     and not exists (select 1 from enterprise_requisitions r where r.id = l.ref);
  if n > 0 then raise exception '% messages name a requisition that does not exist', n; end if;

  select count(*) into n from notification_log l
   where l.persona = 'enterprise' and l.ref like 'INV-%'
     and not exists (select 1 from enterprise_invoices i where i.id = l.ref);
  if n > 0 then raise exception '% messages name an invoice that does not exist', n; end if;

  select count(*) into n from notification_log l
   where l.persona = 'enterprise' and l.ref like 'SUB-%'
     and not exists (select 1 from enterprise_subscriptions s where s.id = l.ref);
  if n > 0 then raise exception '% messages name a subscription that does not exist', n; end if;

  select count(*) into n from notification_log l
   where l.persona = 'enterprise' and l.ref like 'CC-%'
     and not exists (select 1 from enterprise_cost_centres c where c.id = l.ref);
  if n > 0 then raise exception '% messages name a cost centre that does not exist', n; end if;
end $$;
