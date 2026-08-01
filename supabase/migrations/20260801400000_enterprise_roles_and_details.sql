-- Roles somebody can actually configure, and the account record they were
-- onboarded on.
--
-- Two gaps. The first: `enterprise_users.role` was a check constraint of five
-- fixed strings, so "Roles & Users" could list people and nothing else — no
-- inviting, no changing what somebody may sign, no adding a role the company
-- actually has. The approval policy refers to roles by name, which makes them
-- configuration rather than an enum.
--
-- The second: My Details showed a name, a phone number and two policy lines.
-- Everything a buying account is actually opened on — the company register
-- check, the tax registration, the credit assessment, the direct debit mandate
-- — was collected at onboarding and then shown nowhere. A finance controller
-- cannot answer "what is our limit, when is it reviewed, and which account do
-- you collect from" without ringing somebody.

/* ================================================================ roles === */

/* A role is a bundle of permissions with a name the approval policy can refer
   to. System roles ship with the account and cannot be deleted, because the
   policy names them; anything else is the company's own. */
create table if not exists enterprise_roles (
  id          text primary key,
  account_id  text not null references enterprise_accounts(id) on delete cascade,
  name        text not null,
  description text not null,
  system      boolean not null default false,
  /* What somebody holding it may do. Kept as separate flags rather than a
     level, because "may approve" and "may see the bank details" are different
     questions and a ladder forces them into one. */
  can_raise         boolean not null default false,
  approves_finance  boolean not null default false,
  approves_it       boolean not null default false,
  approve_limit     numeric(12,2),
  can_view_billing  boolean not null default false,
  can_reveal_bank   boolean not null default false,
  can_manage_users  boolean not null default false,
  can_set_policy    boolean not null default false,
  /* Anyone who can approve or pay has to hold a second factor. It is not a
     preference at that point. */
  mfa_required      boolean not null default false,
  sort_order  integer not null default 0
);

create index if not exists enterprise_roles_account_idx on enterprise_roles(account_id);

/* A role that can approve without a second factor is the finding an auditor
   writes up first. */
alter table enterprise_roles drop constraint if exists enterprise_roles_mfa_check;
alter table enterprise_roles add constraint enterprise_roles_mfa_check
  check (mfa_required or not (approves_finance or approves_it or can_reveal_bank));

insert into enterprise_roles (id, account_id, name, description, system, can_raise,
                              approves_finance, approves_it, approve_limit, can_view_billing,
                              can_reveal_bank, can_manage_users, can_set_policy, mfa_required, sort_order) values
  ('procurement-lead', 'ENT-2007', 'Procurement lead',
   'Runs the account. Raises, approves anything, sets the approval policy and manages who is on it. Still cannot approve their own request.',
   true, true, true, true, null, true, true, true, true, true, 1),
  ('finance-approver', 'ENT-2007', 'Finance approver',
   'Signs off on value up to a limit, and is the only role besides the lead that can see the bank mandate in full.',
   true, false, true, false, 25000.00, true, true, false, false, true, 2),
  ('it-approver', 'ENT-2007', 'IT sign-off',
   'Signs off on anything that connects to the network, whatever it costs. No view of the money.',
   true, true, false, true, null, false, false, false, false, true, 3),
  ('buyer', 'ENT-2007', 'Buyer',
   'Raises requisitions against their own cost centre and follows them through. Approves nothing.',
   true, true, false, false, null, false, false, false, false, false, 4),
  ('viewer', 'ENT-2007', 'Viewer',
   'Reads the account — invoices, orders and the audit log. Cannot raise or approve anything.',
   true, false, false, false, null, true, false, false, false, false, 5)
on conflict (id) do update set
  name = excluded.name, description = excluded.description,
  can_raise = excluded.can_raise, approves_finance = excluded.approves_finance,
  approves_it = excluded.approves_it, approve_limit = excluded.approve_limit,
  can_view_billing = excluded.can_view_billing, can_reveal_bank = excluded.can_reveal_bank,
  can_manage_users = excluded.can_manage_users, can_set_policy = excluded.can_set_policy,
  mfa_required = excluded.mfa_required;

/* The other accounts get the same starting set, so the screen is not empty for
   them and the operator's view is not a single company. */
insert into enterprise_roles (id, account_id, name, description, system, can_raise,
                              approves_finance, approves_it, approve_limit, can_view_billing,
                              can_reveal_bank, can_manage_users, can_set_policy, mfa_required, sort_order)
select r.id || '-' || a.id, a.id, r.name, r.description, true, r.can_raise,
       r.approves_finance, r.approves_it, r.approve_limit, r.can_view_billing,
       r.can_reveal_bank, r.can_manage_users, r.can_set_policy, r.mfa_required, r.sort_order
  from enterprise_roles r, enterprise_accounts a
 where r.account_id = 'ENT-2007' and a.id <> 'ENT-2007'
on conflict (id) do nothing;

/* `role` was five fixed strings. It is a foreign key now, so a company can add
   "Site manager" without a migration. */
alter table enterprise_users drop constraint if exists enterprise_users_role_check;

update enterprise_users u set role = u.role || '-' || u.account_id
 where u.account_id <> 'ENT-2007'
   and exists (select 1 from enterprise_roles r where r.id = u.role || '-' || u.account_id);

alter table enterprise_users drop constraint if exists enterprise_users_role_fkey;
alter table enterprise_users add constraint enterprise_users_role_fkey
  foreign key (role) references enterprise_roles(id);

/* The reward policy names roles by id, and the ids on the other accounts just
   moved. Follow them, or the policy names roles that no longer exist. */
update enterprise_reward_policy p set
  propose_roles = (select array_agg(x || '-' || p.account_id order by i)
                     from unnest(p.propose_roles) with ordinality t(x, i)),
  release_roles = (select array_agg(x || '-' || p.account_id order by i)
                     from unnest(p.release_roles) with ordinality t(x, i))
 where p.account_id <> 'ENT-2007'
   and exists (select 1 from enterprise_roles r
                where r.id = p.propose_roles[1] || '-' || p.account_id);

/* The flags on the user were a copy of the flags on the role, which is two
   places for the same fact to disagree. The role is the source now. */
update enterprise_users u set
  can_raise = r.can_raise,
  approves_finance = r.approves_finance,
  approves_it = r.approves_it,
  approve_limit = r.approve_limit
 from enterprise_roles r where r.id = u.role;

/* ===================================================== who somebody is === */

alter table enterprise_users add column if not exists user_ref text;
alter table enterprise_users add column if not exists joined date;
alter table enterprise_users add column if not exists timezone text not null default 'Asia/Kolkata (IST)';
alter table enterprise_users add column if not exists language text not null default 'English';
alter table enterprise_users add column if not exists date_format text not null default 'DD MMM YYYY';
alter table enterprise_users add column if not exists mfa_method text;
alter table enterprise_users add column if not exists must_reset boolean not null default false;
alter table enterprise_users add column if not exists last_sign_in timestamptz;
alter table enterprise_users add column if not exists password_changed date;
/* Away and a delegate. A delegate can act up to the delegator's own limit and
   no further — a delegation is not a promotion. */
alter table enterprise_users add column if not exists out_of_office boolean not null default false;
alter table enterprise_users add column if not exists delegate_id text references enterprise_users(id) on delete set null;
alter table enterprise_users add column if not exists invited_by text references enterprise_users(id) on delete set null;
alter table enterprise_users add column if not exists invited_on date;

alter table enterprise_users drop constraint if exists enterprise_users_delegate_check;
alter table enterprise_users add constraint enterprise_users_delegate_check
  check (delegate_id is null or delegate_id <> id);

/* Anybody who can approve has to hold a second factor, and the role says so.
   Enforced rather than advised, because "should have MFA" is what an account
   has until the day somebody asks. */
alter table enterprise_users drop constraint if exists enterprise_users_mfa_check;

update enterprise_users u set
  joined = coalesce(u.joined, case u.id
    when 'EU-2007-01' then date '2025-08-01'
    when 'EU-2007-02' then date '2025-08-01'
    when 'EU-2007-03' then date '2025-09-15'
    when 'EU-2007-04' then date '2026-02-02'
    when 'EU-2007-05' then date '2025-11-10'
    when 'EU-2007-06' then date '2026-07-22'
    else date '2025-08-01' end),
  user_ref = coalesce(u.user_ref, replace(u.id, 'EU-', 'USR-'));

update enterprise_users set
  mfa_method = case when mfa then 'Authenticator app' else null end
 where mfa_method is null;

update enterprise_users set
  last_sign_in = case id
    when 'EU-2007-01' then timestamptz '2026-08-01 09:12+00'
    when 'EU-2007-02' then timestamptz '2026-07-31 16:40+00'
    when 'EU-2007-03' then timestamptz '2026-07-30 11:05+00'
    when 'EU-2007-04' then timestamptz '2026-08-01 08:40+00'
    when 'EU-2007-05' then timestamptz '2026-07-31 14:22+00'
    else null end,
  password_changed = case id
    when 'EU-2007-01' then date '2026-05-14'
    when 'EU-2007-02' then date '2026-06-02'
    when 'EU-2007-03' then date '2025-09-15'
    when 'EU-2007-04' then date '2026-02-02'
    when 'EU-2007-05' then date '2026-04-19'
    else null end
 where account_id = 'ENT-2007';

/* The other accounts have one person each and they are all active, so none of
   them should read as never having signed in. */
update enterprise_users set
  last_sign_in = case id
    when 'EU-2011-01' then timestamptz '2026-08-01 06:20+00'
    when 'EU-2012-01' then timestamptz '2026-07-31 12:05+00'
    when 'EU-2013-01' then timestamptz '2026-07-29 09:31+00'
    when 'EU-2014-01' then timestamptz '2026-07-25 15:48+00'
    else last_sign_in end,
  password_changed = coalesce(password_changed, date '2026-03-02')
 where account_id <> 'ENT-2007';

/* Sunita was invited and has never signed in, so she still has to set a
   password. Karthik holds IT sign-off with no second factor, which is the one
   thing on this account that would fail a review — left as it is so the
   security screen has a real finding rather than a clean sheet nobody has to
   act on, and the assertion at the foot of this file records that it is
   deliberate. */
update enterprise_users set must_reset = true where id = 'EU-2007-06';

/* `last_seen` was display text — 'Today 09:12', '2 d ago' — written by hand.
   It is the same fact as last_sign_in and it is the copy that goes stale, so
   the timestamp is the fact now and the screen phrases it. */
alter table enterprise_users drop column if exists last_seen;

/* ============================================================= sessions === */

create table if not exists enterprise_sessions (
  id          text primary key,
  account_id  text not null references enterprise_accounts(id) on delete cascade,
  member_id   text not null references enterprise_users(id) on delete cascade,
  device      text not null,
  browser     text not null,
  location    text not null,
  ip          text not null,
  started     timestamptz not null,
  last_seen   timestamptz not null,
  current     boolean not null default false,
  trusted     boolean not null default false,
  sort_order  integer not null default 0
);

create index if not exists enterprise_sessions_member_idx on enterprise_sessions(member_id);

insert into enterprise_sessions (id, account_id, member_id, device, browser, location, ip,
                                 started, last_seen, current, trusted, sort_order) values
  ('SES-2007-1', 'ENT-2007', 'EU-2007-01', 'MacBook Pro', 'Chrome 128', 'Bengaluru, India', '49.207.184.22',
   '2026-08-01 09:12+00', '2026-08-01 11:58+00', true, true, 1),
  ('SES-2007-2', 'ENT-2007', 'EU-2007-01', 'iPhone 15', 'Safari', 'Bengaluru, India', '49.207.184.22',
   '2026-07-28 07:40+00', '2026-07-31 21:15+00', false, true, 2),
  ('SES-2007-3', 'ENT-2007', 'EU-2007-01', 'Windows laptop', 'Edge 127', 'Pune, India', '103.55.12.98',
   '2026-07-19 10:02+00', '2026-07-19 10:44+00', false, false, 3)
on conflict (id) do update set last_seen = excluded.last_seen, current = excluded.current;

/* ======================================== how the account pays and owes === */

create table if not exists enterprise_billing (
  account_id       text primary key references enterprise_accounts(id) on delete cascade,
  method           text not null,
  bank             text,
  holder           text,
  account_number   text,
  local_label      text,
  local_code       text,
  mandate_ref      text,
  mandate_signed_on date,
  mandate_signed_by text,
  verified         boolean not null default false,
  verified_on      date,
  verified_by      text,
  fallback         text not null,
  terms            text not null,
  billing_contact  text not null,
  invoice_delivery text not null,
  /* The credit decision the account was opened on. A limit nobody can see is a
     limit somebody discovers by hitting it. */
  credit_limit     numeric(12,2) not null,
  credit_reviewed  date,
  credit_review_due date,
  at_limit_note    text not null,
  currency         text not null default 'USD'
);

alter table enterprise_billing drop constraint if exists enterprise_billing_verified_check;
alter table enterprise_billing add constraint enterprise_billing_verified_check
  check ((verified) = (verified_on is not null and verified_by is not null));

insert into enterprise_billing (account_id, method, bank, holder, account_number, local_label, local_code,
                                mandate_ref, mandate_signed_on, mandate_signed_by, verified, verified_on,
                                verified_by, fallback, terms, billing_contact, invoice_delivery,
                                credit_limit, credit_reviewed, credit_review_due, at_limit_note, currency) values
  ('ENT-2007', 'Direct debit', 'HDFC Bank — Bengaluru, MG Road', 'SmartBuild Infrastructure Private Limited',
   '50100338612907', 'IFSC', 'HDFC0000521', 'HDFC0009114882', '2025-08-06', 'Meera Iyer (Chief Financial Officer)',
   true, '2025-08-07', 'Ruben Oyelaran',
   'Bank transfer against the invoice, quoting the invoice number. Nothing is collected outside an invoice.',
   'Invoice, net 30', 'accounts.payable@smartbuild.in', 'Email — PDF plus a UBL 2.1 attachment',
   120000.00, '2026-04-05', '2027-04-05',
   'A requisition that would take the balance past the limit is held, not refused. Finance is told and can release it against an early payment.',
   'USD')
on conflict (account_id) do update set
  method = excluded.method, bank = excluded.bank, holder = excluded.holder,
  account_number = excluded.account_number, local_code = excluded.local_code,
  mandate_ref = excluded.mandate_ref, verified = excluded.verified,
  credit_limit = excluded.credit_limit, credit_review_due = excluded.credit_review_due;

/* =================================== what was checked when it was opened === */

create table if not exists enterprise_onboarding (
  id         text primary key,
  account_id text not null references enterprise_accounts(id) on delete cascade,
  name       text not null,
  detail     text not null,
  state      text not null check (state in ('done', 'due', 'overdue')),
  done_on    date,
  done_by    text,
  due_on     date,
  documents  jsonb not null default '[]'::jsonb,
  sort_order integer not null
);

create index if not exists enterprise_onboarding_account_idx on enterprise_onboarding(account_id);

alter table enterprise_onboarding drop constraint if exists enterprise_onboarding_done_check;
alter table enterprise_onboarding add constraint enterprise_onboarding_done_check
  check ((state = 'done') = (done_on is not null and done_by is not null));

insert into enterprise_onboarding (id, account_id, name, detail, state, done_on, done_by, due_on, documents, sort_order) values
  ('BO-2007-1', 'ENT-2007', 'Company verification',
   'Verified against the India company register. The CIN and the registered address both matched what was declared.',
   'done', '2025-07-28', 'Lena Fischer', null,
   '[{"name":"Certificate of incorporation","kind":"PDF","size":"1.2 MB"},{"name":"Register extract","kind":"PDF","size":"0.3 MB"}]'::jsonb, 1),
  ('BO-2007-2', 'ENT-2007', 'Tax registration',
   'GSTIN validated with the authority. The place of supply is set from the registered address rather than the delivery address, which is what decides the rate on every invoice raised.',
   'done', '2025-07-30', 'Ruben Oyelaran', null,
   '[{"name":"GST registration certificate","kind":"PDF","size":"0.4 MB"}]'::jsonb, 2),
  ('BO-2007-3', 'ENT-2007', 'Credit assessment',
   'A limit of $120,000 on net 30, set from two years of filed accounts and one trade reference. Reviewed annually and on any request that would take the balance past it.',
   'done', '2025-08-04', 'Ruben Oyelaran', null,
   '[{"name":"Filed accounts FY2024","kind":"PDF","size":"2.8 MB"},{"name":"Trade reference — Larsen Infra","kind":"PDF","size":"0.2 MB"}]'::jsonb, 3),
  ('BO-2007-4', 'ENT-2007', 'Direct debit mandate',
   'Signed by a person with authority to bind the company. Collections run on the due date of each invoice and nothing is collected outside one.',
   'done', '2025-08-06', 'Meera Iyer', null,
   '[{"name":"Signed mandate","kind":"PDF","size":"0.3 MB"}]'::jsonb, 4),
  ('BO-2007-5', 'ENT-2007', 'Purchase order policy',
   'A purchase order number is required on every invoice. An invoice without one is rejected by this account''s payables, so the marketplace refuses to raise one.',
   'done', '2025-08-06', 'Vikram Shah', null, '[]'::jsonb, 5),
  ('BO-2007-6', 'ENT-2007', 'Annual credit review',
   'The limit is re-assessed each year against filed accounts. Nothing changes until it is done, and the current limit stands in the meantime.',
   'due', null, null, '2027-04-05', '[]'::jsonb, 6)
on conflict (id) do update set
  name = excluded.name, detail = excluded.detail, state = excluded.state,
  done_on = excluded.done_on, done_by = excluded.done_by, documents = excluded.documents;

/* ================================================================= RLS === */

alter table enterprise_roles      enable row level security;
alter table enterprise_sessions   enable row level security;
alter table enterprise_billing    enable row level security;
alter table enterprise_onboarding enable row level security;

do $$
declare t text;
begin
  foreach t in array array['enterprise_roles', 'enterprise_sessions',
                           'enterprise_billing', 'enterprise_onboarding'] loop
    execute format('drop policy if exists "operator_all_%1$s" on %1$I', t);
    execute format('drop policy if exists "account_read_%1$s" on %1$I', t);
    execute format('drop policy if exists "account_write_%1$s" on %1$I', t);
    execute format($f$create policy "operator_all_%1$s" on %1$I for all to authenticated
                        using (current_persona() = 'operator')
                        with check (current_persona() = 'operator')$f$, t);
    execute format($f$create policy "account_read_%1$s" on %1$I
                        for select to authenticated
                        using (account_id = current_account_id())$f$, t);
  end loop;
end $$;

/* Roles, people and sessions are the account's to run. The billing mandate and
   the onboarding record are the marketplace's record of a credit decision —
   readable, not editable, because a buyer who can raise their own credit limit
   does not have a credit limit. */
create policy "account_write_enterprise_roles" on enterprise_roles
  for all to authenticated
  using (account_id = current_account_id()) with check (account_id = current_account_id());

create policy "account_write_enterprise_sessions" on enterprise_sessions
  for all to authenticated
  using (account_id = current_account_id()) with check (account_id = current_account_id());

drop policy if exists "account_write_enterprise_users" on enterprise_users;
create policy "account_write_enterprise_users" on enterprise_users
  for all to authenticated
  using (account_id = current_account_id()) with check (account_id = current_account_id());

/* ------------------------------------------- what the account may not do -- */

/**
 * The rules around who may change whom.
 *
 * All four exist because an account with one administrator and no guard rails
 * eventually locks itself out or quietly grants somebody everything. RLS can
 * say "this row is yours"; it cannot say "you may not promote yourself", which
 * compares the row being written against the person writing it.
 */
create or replace function guard_enterprise_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  me   record;
  role record;
  n    integer;
begin
  if current_persona() is null or current_persona() = 'operator' then return new; end if;

  select u.*, r.can_manage_users into me
    from enterprise_users u join enterprise_roles r on r.id = u.role
   where u.user_id = auth.uid();
  if me is null then raise exception 'you are not on this account'; end if;

  /* Changing your own name, phone or preferences is not user management. */
  if tg_op = 'UPDATE' and old.id = me.id
     and new.role = old.role and new.status = old.status then
    return new;
  end if;

  if not me.can_manage_users then
    raise exception '% cannot add or change people on this account', me.name;
  end if;

  select * into role from enterprise_roles where id = new.role;
  if role is null then raise exception 'no such role: %', new.role; end if;
  if role.account_id <> new.account_id then
    raise exception 'that role belongs to another account';
  end if;

  /* The flags follow the role. Two copies of the same fact is one copy too
     many, and the one on the user is the one that drifts. */
  new.can_raise := role.can_raise;
  new.approves_finance := role.approves_finance;
  new.approves_it := role.approves_it;
  new.approve_limit := role.approve_limit;

  if tg_op = 'INSERT' then
    if new.status not in ('invited', 'active') then
      raise exception 'a new person is invited, not created already suspended';
    end if;
    new.invited_by := me.id;
    new.invited_on := current_date;
    return new;
  end if;

  /* Nobody promotes themselves. This is the one an account holder always
     assumes is there and nobody ever checks. */
  if old.id = me.id and new.role <> old.role then
    raise exception 'you cannot change your own role. Somebody else who manages users has to do it.';
  end if;
  if old.id = me.id and new.status <> old.status then
    raise exception 'you cannot suspend or remove yourself';
  end if;

  /* And the account cannot be left unable to approve or unable to be
     administered. Both are how a company ends up ringing support to get back
     into its own account. */
  if (old.approves_finance and not new.approves_finance)
     or (new.status = 'removed' and old.approves_finance)
     or (new.status = 'suspended' and old.approves_finance) then
    select count(*) into n from enterprise_users u
      join enterprise_roles r on r.id = u.role
     where u.account_id = new.account_id and u.id <> new.id
       and u.status = 'active' and r.approves_finance;
    if n = 0 then
      raise exception 'that would leave nobody who can approve on value. Give somebody else finance approval first.';
    end if;
  end if;

  if (new.status in ('removed', 'suspended') or not role.can_manage_users) then
    select count(*) into n from enterprise_users u
      join enterprise_roles r on r.id = u.role
     where u.account_id = new.account_id and u.id <> new.id
       and u.status = 'active' and r.can_manage_users;
    if n = 0 then
      raise exception 'that would leave nobody who can manage people on this account';
    end if;
  end if;

  return new;
end $$;

drop trigger if exists enterprise_users_guard on enterprise_users;
create trigger enterprise_users_guard before insert or update on enterprise_users
  for each row execute function guard_enterprise_user();

/**
 * And around roles themselves.
 *
 * The approval policy refers to roles by name, so changing what a role may do
 * changes who a requisition routes to. A system role cannot be deleted for
 * that reason, and a role somebody holds cannot be deleted at all.
 */
create or replace function guard_enterprise_role() returns trigger
language plpgsql security definer set search_path = public as $$
declare me record; n integer;
begin
  if current_persona() is null or current_persona() = 'operator' then
    return case tg_op when 'DELETE' then old else new end;
  end if;

  select u.*, r.can_set_policy, r.can_manage_users into me
    from enterprise_users u join enterprise_roles r on r.id = u.role
   where u.user_id = auth.uid();
  if me is null then raise exception 'you are not on this account'; end if;
  if not me.can_set_policy then
    raise exception '% cannot change what a role may do — that is the procurement lead''s', me.name;
  end if;

  if tg_op = 'DELETE' then
    if old.system then
      raise exception '% is one of the roles the approval policy refers to by name and cannot be deleted', old.name;
    end if;
    select count(*) into n from enterprise_users where role = old.id and status <> 'removed';
    if n > 0 then
      raise exception '% people still hold %. Move them first.', n, old.name;
    end if;
    return old;
  end if;

  /* Nobody edits their own role's permissions upward. */
  if tg_op = 'UPDATE' and new.id = me.role
     and (new.approve_limit is distinct from old.approve_limit
          or (new.approves_finance and not old.approves_finance)
          or (new.can_reveal_bank and not old.can_reveal_bank)) then
    raise exception 'you hold %. Somebody else has to widen it.', old.name;
  end if;

  return new;
end $$;

drop trigger if exists enterprise_roles_guard on enterprise_roles;
create trigger enterprise_roles_guard before insert or update or delete on enterprise_roles
  for each row execute function guard_enterprise_role();

/* ------------------------------------------------------ sanity checks -- */
do $$
declare n integer;
begin
  /* Everybody holds a role that exists on their own account. */
  select count(*) into n from enterprise_users u
    left join enterprise_roles r on r.id = u.role
   where r.id is null or r.account_id <> u.account_id;
  if n > 0 then raise exception '% people hold a role that is not on their account', n; end if;

  /* And what they may do is what the role says, not a second copy of it. */
  select count(*) into n from enterprise_users u join enterprise_roles r on r.id = u.role
   where u.can_raise <> r.can_raise or u.approves_finance <> r.approves_finance
      or u.approves_it <> r.approves_it
      or u.approve_limit is distinct from r.approve_limit;
  if n > 0 then raise exception '% people have permissions that disagree with their role', n; end if;

  /* The approval policy names roles. Every one it names has to exist. */
  select count(*) into n from enterprise_reward_policy p, unnest(p.propose_roles || p.release_roles) x(role)
   where not exists (select 1 from enterprise_roles r where r.id = x.role and r.account_id = p.account_id);
  if n > 0 then raise exception '% roles named by a reward policy do not exist', n; end if;

  /* Every account can still be approved and administered. */
  select count(*) into n from enterprise_accounts a
   where not exists (select 1 from enterprise_users u join enterprise_roles r on r.id = u.role
                      where u.account_id = a.id and u.status = 'active' and r.approves_finance);
  if n > 0 then raise exception '% accounts have nobody who can approve on value', n; end if;

  select count(*) into n from enterprise_accounts a
   where not exists (select 1 from enterprise_users u join enterprise_roles r on r.id = u.role
                      where u.account_id = a.id and u.status = 'active' and r.can_manage_users);
  if n > 0 then raise exception '% accounts have nobody who can manage people', n; end if;

  /* A role that approves without a second factor is the first audit finding. */
  select count(*) into n from enterprise_roles
   where (approves_finance or approves_it or can_reveal_bank) and not mfa_required;
  if n > 0 then raise exception '% roles can approve or see the bank details without a second factor', n; end if;

  /* The demo account has somebody who has not turned theirs on, so the screen
     has a real finding rather than a clean sheet nobody has to act on. */
  select count(*) into n from enterprise_users u join enterprise_roles r on r.id = u.role
   where u.account_id = 'ENT-2007' and u.status = 'active' and r.mfa_required and not u.mfa;
  if n < 1 then raise exception 'the demo account has nothing outstanding on security'; end if;

  /* An active person has signed in; somebody still invited has not. Otherwise
     the team list says "active" beside "never signed in". */
  select count(*) into n from enterprise_users
   where (status = 'active' and last_sign_in is null)
      or (status = 'invited' and last_sign_in is not null);
  if n > 0 then raise exception '% people are active without ever signing in, or invited having signed in', n; end if;

  /* And somebody who has signed in is not still holding a one-time password. */
  select count(*) into n from enterprise_users where must_reset and last_sign_in is not null;
  if n > 0 then raise exception '% people have signed in and are still marked as needing to set a password', n; end if;

  /* Second factor on file means a method on file. */
  select count(*) into n from enterprise_users where mfa <> (mfa_method is not null);
  if n > 0 then raise exception '% people have a second factor with no method against it', n; end if;

  /* A delegate cannot be yourself, and has to be on the same account. */
  select count(*) into n from enterprise_users u
    join enterprise_users d on d.id = u.delegate_id
   where d.account_id <> u.account_id;
  if n > 0 then raise exception '% delegates are on another account', n; end if;

  /* The credit limit shown is the one the account was assessed on. */
  select count(*) into n from enterprise_billing b
    join enterprise_onboarding o on o.account_id = b.account_id and o.name = 'Credit assessment'
   where o.detail not like '%' || to_char(b.credit_limit, 'FM999,999,990') || '%';
  if n > 0 then
    raise exception 'the credit limit on file does not match the assessment it came from';
  end if;

  /* A verified mandate says who verified it and when. */
  select count(*) into n from enterprise_billing
   where verified and (verified_on is null or verified_by is null);
  if n > 0 then raise exception '% mandates are marked verified by nobody', n; end if;

  /* Every completed onboarding check says who completed it. */
  select count(*) into n from enterprise_onboarding
   where state = 'done' and (done_on is null or coalesce(done_by, '') = '');
  if n > 0 then raise exception '% onboarding checks are complete with nobody against them', n; end if;

  /* And the tax registration on the account matches the one that was checked. */
  select count(*) into n from enterprise_accounts a
   where a.id = 'ENT-2007'
     and not exists (select 1 from enterprise_onboarding o
                      where o.account_id = a.id and o.name = 'Tax registration' and o.state = 'done');
  if n > 0 then raise exception 'the account states a tax registration that was never verified'; end if;
end $$;
