-- What a seller is allowed to know and change about themselves.
--
-- The seller console's "My details" was a read-only card of six facts, three of
-- which were wrong: it printed India for a company registered in Munich and
-- Gold for a Silver-tier seller, because the numbers came from a TypeScript
-- constant rather than the record the operator reads. Nothing on the page could
-- be changed — not the password, not who gets the remittance advice, not the
-- account the money is paid into.
--
-- That last one is the serious gap. A seller who cannot see the settlement
-- instruction cannot notice it is wrong, and a seller who cannot change it has
-- to ask the marketplace to change where their money goes over email, which is
-- exactly the request an attacker makes.
--
-- Four tables:
--
--   partner_users     the people at the seller. "My details" needs a *you*, and
--                     a delegate needs colleagues to choose between.
--   partner_contacts  the addresses and numbers the marketplace actually uses,
--                     each tagged with what it is used for. One address for
--                     everything means the settlement advice, the incident call
--                     and the policy notice all land on whoever happens to be on
--                     leave.
--   partner_bank      the settlement instruction and the tax position, with a
--                     pending-change slot so a new account never takes effect on
--                     save.
--   partner_golive    per marketplace: open or not, since when, and whether
--                     anything is actually on sale there.

/* ====================================================================== users
   Roles here are the seller's own, not the marketplace's. A seller admin can
   publish and act on onboarding; a fulfilment operator can move an order and
   nothing else. The marketplace never sees this list — it sees which of them
   acted on an order. */
create table if not exists partner_users (
  id            text primary key,
  partner_id    text not null references partners(id) on delete cascade,
  name          text not null,
  email         text not null unique,
  job_title     text not null,
  role          text not null check (role in ('admin', 'fulfilment', 'finance', 'read_only')),
  status        text not null default 'active' check (status in ('active', 'invited', 'suspended')),
  joined        date not null,
  last_active   text,
  /* Security state. Held per person because "does this company use MFA" is not
     a question with one answer — it is one answer per account. */
  mfa           boolean not null default false,
  sessions      integer not null default 1 check (sessions >= 0),
  pwd_changed   date,
  pwd_strength  text check (pwd_strength in ('weak', 'fair', 'strong')),
  must_reset    boolean not null default false,
  /* How things are shown to this person, and what happens while they are out.
     Language is stored but only English is offered — see the note on the
     selector in the UI. */
  timezone      text not null default 'Asia/Kolkata (IST)',
  date_format   text not null default 'DD MMM YYYY',
  language      text not null default 'English',
  out_of_office boolean not null default false,
  delegate_id   text references partner_users(id),
  digest        text not null default 'Weekly, Monday 08:00',
  sort_order    integer not null default 0
);

create index if not exists partner_users_partner_idx on partner_users(partner_id, status);

/* A delegate has to be somebody else, at the same company. Delegating to
   yourself is a no-op that reads on screen as cover you do not have. */
alter table partner_users drop constraint if exists partner_users_delegate_check;
alter table partner_users add constraint partner_users_delegate_check
  check (delegate_id is null or delegate_id <> id);

/* Cover is only cover while you are away. Clearing the away flag has to clear
   the delegate with it, or the record keeps claiming work routes elsewhere. */
alter table partner_users drop constraint if exists partner_users_away_check;
alter table partner_users add constraint partner_users_away_check
  check (out_of_office or delegate_id is null);

/* A password that has been changed has a strength; one that has never been set
   has neither. */
alter table partner_users drop constraint if exists partner_users_pwd_check;
alter table partner_users add constraint partner_users_pwd_check
  check ((pwd_changed is null) = (pwd_strength is null));

/* =================================================================== contacts
   Purpose is the whole point of the row. A marketplace that holds one address
   per seller sends the remittance advice, the incident page and the policy
   notice to the same inbox, and the seller discovers the incident on Monday. */
create table if not exists partner_contacts (
  id          text primary key,
  partner_id  text not null references partners(id) on delete cascade,
  kind        text not null check (kind in ('email', 'phone')),
  value       text not null,
  purpose     text not null check (purpose in (
    'signin',      -- the address the account authenticates as
    'settlement',  -- remittance advice, statements, holds
    'escalation',  -- an order failed, out of hours
    'technical',   -- webhook and API failures
    'disputes',    -- buyer claims against this seller
    'notices'      -- policy and category changes
  )),
  label       text,
  /* An unverified address is an address we have not proved anybody reads. It is
     recorded but not used — sending an incident page to an unverified number is
     the same as not sending it. */
  verified    boolean not null default false,
  verified_on date,
  sort_order  integer not null default 0
);

create index if not exists partner_contacts_partner_idx on partner_contacts(partner_id, purpose);

alter table partner_contacts drop constraint if exists partner_contacts_verified_check;
alter table partner_contacts add constraint partner_contacts_verified_check
  check (verified = (verified_on is not null));

/* You sign in with an address, not a telephone, and with exactly one of them. */
alter table partner_contacts drop constraint if exists partner_contacts_signin_kind_check;
alter table partner_contacts add constraint partner_contacts_signin_kind_check
  check (purpose <> 'signin' or kind = 'email');

create unique index if not exists partner_contacts_one_signin
  on partner_contacts(partner_id) where purpose = 'signin';

/* The same address twice for the same purpose is a duplicate, not a second
   contact. Twice for different purposes is fine and common. */
create unique index if not exists partner_contacts_no_dupes
  on partner_contacts(partner_id, purpose, lower(value));

/* ======================================================================= bank
   The full account number lives here because the platform has to pay somebody.
   Nothing in the interface prints it: screens mask to the last four, and seeing
   the whole thing is a deliberate act that writes an audit row. A seller may
   see their own in full — it is their account.

   `pending_*` is the change a seller has asked for and the marketplace has not
   yet confirmed. It is a separate slot rather than an edit in place, because
   the moment the live columns change is the moment money starts going
   somewhere new. */
create table if not exists partner_bank (
  partner_id     text primary key references partners(id) on delete cascade,
  holder         text not null,
  bank           text not null,
  branch         text,
  account        text not null,
  local_label    text not null,
  local_code     text not null,
  swift          text not null,
  iban           text,
  currency       text not null default 'USD',
  /* Tax position. Withholding is not a penalty and cannot be waived — it is
     deducted at source and paid to the authority. A valid treaty certificate is
     the only thing that changes the rate. */
  tax_label      text not null,
  tax_id         text not null,
  residency      text not null,
  treaty_on_file boolean not null default false,
  treaty_expires date,
  withholding    text not null,
  verified       boolean not null default false,
  verified_on    date,
  verified_by    text,
  method         text,
  pending_status text not null default 'none'
                 check (pending_status in ('none', 'submitted', 'rejected')),
  pending_holder text,
  pending_bank   text,
  pending_branch text,
  pending_account text,
  pending_local  text,
  pending_swift  text,
  pending_why    text,
  pending_requested_on date,
  pending_requested_by text,
  pending_decided_on   date,
  pending_decided_by   text,
  pending_note   text
);

/* A certificate on file has an expiry. One that is not on file does not. */
alter table partner_bank drop constraint if exists partner_bank_treaty_check;
alter table partner_bank add constraint partner_bank_treaty_check
  check (treaty_on_file = (treaty_expires is not null));

alter table partner_bank drop constraint if exists partner_bank_verified_check;
alter table partner_bank add constraint partner_bank_verified_check
  check (verified = (verified_on is not null and verified_by is not null));

/* A submitted change has to say what it is changing to and why. An unexplained
   payout change is the shape every account takeover takes, so the reason is a
   constraint rather than a nicety. */
alter table partner_bank drop constraint if exists partner_bank_pending_check;
alter table partner_bank add constraint partner_bank_pending_check
  check (
    (pending_status = 'submitted'
      and pending_account is not null and pending_holder is not null
      and pending_bank is not null and pending_why is not null
      and pending_requested_on is not null and pending_requested_by is not null)
    or (pending_status = 'rejected' and pending_note is not null)
    or pending_status = 'none'
  );

/* ==================================================================== go-live
   Being approved for a marketplace and trading in it are different states, and
   the gap between them is where sellers sit for months without noticing. This
   table holds the seller-controlled half — the storefront switch — and the rest
   is read off the listings. */
create table if not exists partner_golive (
  partner_id         text not null references partners(id) on delete cascade,
  category_id        text not null references categories(id) on delete cascade,
  storefront_enabled boolean not null default true,
  went_live_on       date,
  first_listing_on   date,
  opened_by          text,
  /* Why the storefront is off, when it is off. "Paused" with no reason is a
     support ticket waiting to be raised. */
  paused_reason      text,
  paused_on          date,
  primary key (partner_id, category_id)
);

alter table partner_golive drop constraint if exists partner_golive_pause_check;
alter table partner_golive add constraint partner_golive_pause_check
  check (storefront_enabled or (paused_reason is not null and paused_on is not null));

/* ------------------------------------------------------------------ seed --- */

/* Nimbus Sensors is the demo seller and the only one with a real sign-in, so it
   gets a real team. Katrin Boehm is the managing director who signed the
   application and appears on the KYC record as the 54% beneficial owner; Rajesh
   Kumar is the operations lead the demo signs in as. Both already appear in the
   support thread, so this is the roster that thread implies. */
insert into partner_users (id, partner_id, name, email, job_title, role, status, joined,
                           last_active, mfa, sessions, pwd_changed, pwd_strength, must_reset,
                           timezone, date_format, language, out_of_office, delegate_id, digest, sort_order)
values
  ('PU-1004-1', 'PTR-1004', 'Rajesh Kumar', 'rajesh.kumar@nimbussensors.com',
   'Seller operations lead', 'admin', 'active', '2024-09-27',
   'Today, 07:58', true, 2, '2026-05-12', 'strong', false,
   'Asia/Kolkata (IST)', 'DD MMM YYYY', 'English', false, null, 'Weekly, Monday 08:00', 1),

  ('PU-1004-2', 'PTR-1004', 'Katrin Boehm', 'katrin.boehm@nimbussensors.com',
   'Managing director', 'admin', 'active', '2024-09-11',
   'Yesterday, 16:40', true, 1, '2026-02-03', 'strong', false,
   'Europe/Berlin (CET)', 'DD MMM YYYY', 'English', false, null, 'Weekly, Monday 08:00', 2),

  -- No MFA on an account that can move an order along. Left as it is on purpose:
  -- it is the gap the security panel should be pointing at.
  ('PU-1004-3', 'PTR-1004', 'Priya Nair', 'priya.nair@nimbussensors.com',
   'Fulfilment operator', 'fulfilment', 'active', '2024-10-14',
   '3 days ago', false, 1, '2025-11-20', 'fair', false,
   'Asia/Kolkata (IST)', 'DD MMM YYYY', 'English', false, null, 'Daily, 07:00', 3),

  ('PU-1004-4', 'PTR-1004', 'Arjun Mehta', 'arjun.mehta@nimbussensors.com',
   'Finance', 'finance', 'active', '2024-11-02',
   '6 days ago', true, 1, '2026-04-08', 'strong', false,
   'Asia/Kolkata (IST)', 'DD MMM YYYY', 'English', false, null, 'Monthly, on the run date', 4)
on conflict (id) do update set
  name = excluded.name, email = excluded.email, job_title = excluded.job_title,
  role = excluded.role, mfa = excluded.mfa, last_active = excluded.last_active;

/* Every other seller gets the one person the marketplace deals with, taken from
   the partner record so the two cannot disagree. They have no sign-in — this is
   the operator's view of who to call. */
/* Three sellers are still mid-onboarding and have no join date at all — the
   partner record carries an em dash. Parsing that as a date is what broke the
   first run of this migration; falling back to when the record was created is
   both truthful and orderable. */
create or replace view partner_dates as
select p.*,
       case when p.joined = '—' then coalesce(p.created_at::date, current_date)
            else to_date(p.joined, 'DD Mon YYYY') end as joined_date,
       p.joined <> '—' as has_gone_live
from partners p;

insert into partner_users (id, partner_id, name, email, job_title, role, status, joined,
                           last_active, mfa, sessions, pwd_changed, pwd_strength, timezone, sort_order)
select
  'PU-' || substr(p.id, 5) || '-1', p.id, p.contact,
  lower(regexp_replace(split_part(p.contact, ' ', 1), '[^a-zA-Z]', '', 'g')) || '.' ||
    lower(regexp_replace(split_part(p.contact, ' ', 2), '[^a-zA-Z]', '', 'g')) || '@' ||
    lower(regexp_replace(p.name, '[^a-zA-Z]', '', 'g')) || '.example',
  'Primary contact', 'admin', 'active',
  p.joined_date, 'Not signed in', true, 0, null, null,
  'Europe/London (GMT)', 1
from partner_dates p
where p.id <> 'PTR-1004'
on conflict (id) do nothing;

/* ---- contacts ---- */

insert into partner_contacts (id, partner_id, kind, value, purpose, label, verified, verified_on, sort_order)
values
  ('PC-1004-1', 'PTR-1004', 'email', 'rajesh.kumar@nimbussensors.com', 'signin',
   'Rajesh Kumar — this account', true, '2024-09-27', 1),

  ('PC-1004-2', 'PTR-1004', 'email', 'settlements@nimbussensors.com', 'settlement',
   'Finance inbox — Arjun Mehta', true, '2024-11-02', 2),

  ('PC-1004-3', 'PTR-1004', 'phone', '+49 89 4114 2280', 'settlement',
   'Finance desk, office hours', true, '2024-11-02', 3),

  -- Recorded but never proved. An incident page to an unverified number is the
  -- same as no page at all, so the page has to say so rather than imply cover.
  ('PC-1004-4', 'PTR-1004', 'phone', '+49 172 664 1180', 'escalation',
   'Rajesh Kumar — mobile, out of hours', false, null, 4),

  ('PC-1004-5', 'PTR-1004', 'email', 'api-alerts@nimbussensors.com', 'technical',
   'Integration team — webhook failures', true, '2025-01-19', 5),

  ('PC-1004-6', 'PTR-1004', 'email', 'katrin.boehm@nimbussensors.com', 'disputes',
   'Katrin Boehm — buyer claims', true, '2024-09-11', 6)
  -- Deliberately nothing on 'notices'. Policy and category changes therefore
  -- reach the sign-in address only, which is one person's inbox.
on conflict (id) do update set
  value = excluded.value, label = excluded.label,
  verified = excluded.verified, verified_on = excluded.verified_on;

insert into partner_contacts (id, partner_id, kind, value, purpose, label, verified, verified_on, sort_order)
select 'PC-' || substr(p.id, 5) || '-1', p.id, 'email', p.email, 'settlement',
       p.contact, true, p.joined_date, 1
from partner_dates p
where p.id <> 'PTR-1004'
on conflict (id) do nothing;

/* ---- settlement instructions ---- */

/* Derived from the country so the form asks for the thing the person is holding
   — an IFSC in India, a Bankleitzahl in Germany — rather than a generic "bank
   code" nobody can find on a statement. */
insert into partner_bank (partner_id, holder, bank, branch, account, local_label, local_code,
                          swift, iban, currency, tax_label, tax_id, residency,
                          treaty_on_file, treaty_expires, withholding,
                          verified, verified_on, verified_by, method)
select
  p.id,
  p.name || case when p.country = 'India' then ' Private Limited' else ' Ltd' end,
  case p.country
    when 'India'     then 'HDFC Bank'      when 'UAE'      then 'Emirates NBD'
    when 'Kenya'     then 'Equity Bank'    when 'Singapore' then 'DBS Bank'
    when 'Germany'   then 'Deutsche Bank'  when 'Poland'   then 'PKO Bank Polski'
    when 'Sweden'    then 'SEB'            when 'Taiwan'   then 'CTBC Bank'
    when 'UK'        then 'Lloyds Bank'    when 'Israel'   then 'Bank Leumi'
    when 'Vietnam'   then 'Techcombank'    when 'Brazil'   then 'Itaú Unibanco'
    else 'Standard Chartered' end,
  case p.country
    when 'India'   then 'Bengaluru — Residency Road'
    when 'UAE'     then 'Dubai — Sheikh Zayed Road'
    when 'Germany' then 'München — Promenadeplatz'
    else 'Head office' end,
  -- Twelve digits, stable per partner so it does not move between runs.
  lpad(((abs(hashtext(p.id)) % 900000000000) + 100000000000)::text, 12, '0'),
  case p.country
    when 'India' then 'IFSC'            when 'UAE'       then 'Routing code'
    when 'Kenya' then 'Bank/branch code' when 'Singapore' then 'Bank/branch code'
    when 'Germany' then 'Bankleitzahl'  when 'Poland'    then 'Sort code'
    when 'UK'    then 'Sort code'       when 'Brazil'    then 'Agência/conta'
    when 'Vietnam' then 'Branch code'   else 'Local clearing code' end,
  case p.country
    when 'India' then 'HDFC0001234'     when 'UAE'       then '302620122'
    when 'Kenya' then '068-000'         when 'Singapore' then '7171-001'
    when 'Germany' then '50010517'      when 'Poland'    then '10201026'
    when 'UK'    then '04-00-04'        when 'Brazil'    then '0001 / 12345-6'
    when 'Vietnam' then '79204001'      else '000-000' end,
  case p.country
    when 'India' then 'HDFCINBB'        when 'UAE'       then 'EBILAEAD'
    when 'Kenya' then 'EQBLKENA'        when 'Singapore' then 'DBSSSGSG'
    when 'Germany' then 'DEUTDEFF'      when 'Poland'    then 'BPKOPLPW'
    when 'Sweden' then 'ESSESESS'       when 'Taiwan'    then 'CTCBTWTP'
    when 'UK'    then 'LOYDGB21'        when 'Israel'    then 'LUMIILIT'
    when 'Vietnam' then 'VTCBVNVX'      when 'Brazil'    then 'ITAUBRSP'
    else 'SCBLGB2L' end,
  case when p.country in ('UAE', 'Germany', 'Poland', 'UK', 'Sweden', 'Israel')
    then case p.country when 'Germany' then 'DE89' when 'UK' then 'GB29'
                        when 'Poland' then 'PL61' when 'Sweden' then 'SE45'
                        when 'Israel' then 'IL62' else 'AE07' end
         || '3704' || substr(lpad(((abs(hashtext(p.id)) % 900000000000) + 100000000000)::text, 12, '0'), 1, 10)
    else null end,
  'USD',
  case p.country
    when 'India' then 'PAN'   when 'UAE'      then 'TRN'   when 'Kenya' then 'KRA PIN'
    when 'Singapore' then 'UEN' when 'Germany' then 'USt-IdNr' when 'Poland' then 'NIP'
    when 'UK' then 'VAT'      when 'Brazil'   then 'CNPJ'  when 'Vietnam' then 'MST'
    else 'Tax identifier' end,
  case p.country
    when 'India' then 'AAACH1234K'  when 'UAE'      then '100123456700003'
    when 'Kenya' then 'P051234567X' when 'Singapore' then '201812345K'
    when 'Germany' then 'DE123456789' when 'Poland' then 'PL5252445767'
    when 'UK' then 'GB123456789'    when 'Brazil'   then '12.345.678/0001-95'
    when 'Vietnam' then '0312345678' else 'TAX-0000000' end,
  p.country,
  -- Brazil and Vietnam have no certificate on file, so the statutory rate comes
  -- off at source. It is the case worth having in the data: it is money the
  -- seller loses to paperwork rather than to commission.
  p.country not in ('Brazil', 'Vietnam'),
  case when p.country in ('Brazil', 'Vietnam') then null else date '2027-03-31' end,
  case when p.country in ('Brazil', 'Vietnam')
    then '10% statutory — no certificate on file' else 'Nil under treaty' end,
  -- A seller still going through onboarding has an account recorded but not yet
  -- proved. That is the point of the finance gate, and it is the state three of
  -- these fifteen are actually in.
  p.has_gone_live,
  case when p.has_gone_live then p.joined_date end,
  case when p.has_gone_live then 'Ruben Oyelaran' end,
  case when p.has_gone_live then 'Two micro-deposits matched'
       else 'Recorded at the finance gate — micro-deposits not yet matched' end
from partner_dates p
on conflict (partner_id) do nothing;

/* The demo seller's certificate is inside the renewal window on purpose. A
   certificate that expires in eight months tells nobody anything; one that
   expires in seven weeks is the reason the tax panel exists. The finance gate
   submission is corrected in the same statement so the two agree. */
update partner_bank
set treaty_expires = date '2026-09-15',
    withholding    = 'Nil under treaty — certificate expires 15 Sep 2026'
where partner_id = 'PTR-1004';

update onboarding_submissions
set fields = (
  select jsonb_agg(
    case when f->>0 = 'Treaty certificate'
      then jsonb_build_array('Treaty certificate', 'On file, valid to 15 Sep 2026')
      else f end order by ord)
  from jsonb_array_elements(fields) with ordinality as t(f, ord))
where partner_id = 'PTR-1004' and gate_key = 'finance';

/* The company's people are all on nimbussensors.com — the address the demo
   signs in with. The partner record still carried k.boehm@nimbus.de, so the
   contacts list would have shown one company using two domains and read as a
   defect rather than as data. */
update partners set email = 'katrin.boehm@nimbussensors.com' where id = 'PTR-1004';

update onboarding_submissions
set fields = (
  select jsonb_agg(
    case when f->>0 = 'Contact email'
      then jsonb_build_array('Contact email', 'katrin.boehm@nimbussensors.com')
      else f end order by ord)
  from jsonb_array_elements(fields) with ordinality as t(f, ord))
where partner_id = 'PTR-1004' and gate_key = 'apply';

/* ---- go-live ---- */

insert into partner_golive (partner_id, category_id, storefront_enabled, went_live_on,
                            first_listing_on, opened_by)
select
  pc.partner_id, pc.category_id, true, pc.approved_at::date,
  (select min(to_date(pr.listed, 'DD Mon YYYY'))
     from products pr
    where pr.partner_id = pc.partner_id and pr.category_id = pc.category_id
      and pr.status = 'live'),
  'Lena Fischer'
from partner_categories pc
where pc.approved_at is not null
on conflict (partner_id, category_id) do nothing;

/* A seeding helper, not part of the schema. A view over `partners` is owned by
   the migration role and so reads with its privileges — leaving it behind would
   be a way round that table's own policies. */
drop view if exists partner_dates;

/* ------------------------------------------------------------------- RLS --- */

alter table partner_users    enable row level security;
alter table partner_contacts enable row level security;
alter table partner_bank     enable row level security;
alter table partner_golive   enable row level security;

drop policy if exists "operator_all_partner_users"    on partner_users;
drop policy if exists "partner_read_own_users"        on partner_users;
drop policy if exists "partner_update_own_users"      on partner_users;
drop policy if exists "operator_all_partner_contacts" on partner_contacts;
drop policy if exists "partner_own_contacts"          on partner_contacts;
drop policy if exists "operator_all_partner_bank"     on partner_bank;
drop policy if exists "partner_read_own_bank"         on partner_bank;
drop policy if exists "partner_request_bank_change"   on partner_bank;
drop policy if exists "operator_all_partner_golive"   on partner_golive;
drop policy if exists "partner_read_own_golive"       on partner_golive;
drop policy if exists "partner_update_own_golive"     on partner_golive;

create policy "operator_all_partner_users" on partner_users
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

create policy "partner_read_own_users" on partner_users
  for select to authenticated using (partner_id = current_partner_id());

/* A seller edits their own team's records — their name, their preferences,
   their MFA. They cannot create or delete accounts here; an invitation is a
   different act with a different check on it. */
create policy "partner_update_own_users" on partner_users
  for update to authenticated
  using (partner_id = current_partner_id())
  with check (partner_id = current_partner_id());

create policy "operator_all_partner_contacts" on partner_contacts
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

create policy "partner_own_contacts" on partner_contacts
  for all to authenticated
  using (partner_id = current_partner_id())
  with check (partner_id = current_partner_id());

create policy "operator_all_partner_bank" on partner_bank
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* Their own account number, in full. Masking a seller's own bank details from
   the seller protects nobody — they have the statement in front of them. */
create policy "partner_read_own_bank" on partner_bank
  for select to authenticated using (partner_id = current_partner_id());

/* A seller may ask for a change and may withdraw the ask. Row-level security
   cannot express "these columns but not those", so the policy grants the update
   and the trigger below takes the live columns back. Without it a seller could
   simply set `account` — and `verified` — with one API call, which would make
   this whole two-step theatre. */
create policy "partner_request_bank_change" on partner_bank
  for update to authenticated
  using (partner_id = current_partner_id())
  with check (partner_id = current_partner_id());

create or replace function guard_partner_bank() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if current_persona() = 'operator' then
    return new;                       -- the marketplace owns the live columns
  end if;
  /* Anybody else — which in practice means the seller — may only move the
     pending slot. Everything that decides where money actually goes comes back
     from the row as it was. */
  new.holder      := old.holder;
  new.bank        := old.bank;
  new.branch      := old.branch;
  new.account     := old.account;
  new.local_label := old.local_label;
  new.local_code  := old.local_code;
  new.swift       := old.swift;
  new.iban        := old.iban;
  new.currency    := old.currency;
  new.residency   := old.residency;
  new.verified    := old.verified;
  new.verified_on := old.verified_on;
  new.verified_by := old.verified_by;
  new.method      := old.method;
  /* The decision on a pending change is the marketplace's too. A seller may
     submit one or clear it; they may not mark their own request accepted or
     write the marketplace's reason for refusing it. */
  if new.pending_status not in ('none', 'submitted') then
    new.pending_status := old.pending_status;
  end if;
  new.pending_decided_on := old.pending_decided_on;
  new.pending_decided_by := old.pending_decided_by;
  new.pending_note       := old.pending_note;
  return new;
end $$;

drop trigger if exists partner_bank_guard on partner_bank;
create trigger partner_bank_guard before update on partner_bank
  for each row execute function guard_partner_bank();

create policy "operator_all_partner_golive" on partner_golive
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

create policy "partner_read_own_golive" on partner_golive
  for select to authenticated using (partner_id = current_partner_id());

create policy "partner_update_own_golive" on partner_golive
  for update to authenticated
  using (partner_id = current_partner_id())
  with check (partner_id = current_partner_id());

/* ------------------------------------------------------- sanity assertions --
   These fail the migration rather than record a contradiction. Every one of
   them has caught something on an earlier pass. */
do $$
declare
  n integer;
  txt text;
begin
  /* The demo sign-in has to resolve to a person, or "My details" has no you. */
  select count(*) into n from partner_users
   where email = 'rajesh.kumar@nimbussensors.com' and partner_id = 'PTR-1004';
  if n <> 1 then
    raise exception 'The demo seller sign-in does not match exactly one partner_users row (found %)', n;
  end if;

  /* The sign-in contact must be the address the account actually authenticates
     as. A "sign-in address" that is not the sign-in address is worse than none. */
  select value into txt from partner_contacts
   where partner_id = 'PTR-1004' and purpose = 'signin';
  if txt is distinct from 'rajesh.kumar@nimbussensors.com' then
    raise exception 'The sign-in contact for PTR-1004 is % — it must be the address the demo signs in with', txt;
  end if;

  /* Everybody on the roster shares the company domain, including the partner
     record's own contact address. */
  select count(*) into n from partner_users
   where partner_id = 'PTR-1004' and email not like '%@nimbussensors.com';
  if n > 0 then
    raise exception '% Nimbus people are on a different domain from the sign-in address', n;
  end if;
  select email into txt from partners where id = 'PTR-1004';
  if txt not like '%@nimbussensors.com' then
    raise exception 'The partner record contact address (%) is on a different domain from its own staff', txt;
  end if;

  /* Every partner must have somewhere to be paid, or a settlement run has an
     amount and no destination. */
  select count(*) into n from partners p
   where not exists (select 1 from partner_bank b where b.partner_id = p.id);
  if n > 0 then
    raise exception '% partners have no settlement instruction', n;
  end if;

  /* Withholding text and the certificate have to tell the same story. */
  select count(*) into n from partner_bank
   where (treaty_on_file and withholding like '%statutory%')
      or (not treaty_on_file and withholding like 'Nil%');
  if n > 0 then
    raise exception '% settlement records describe a withholding rate their certificate contradicts', n;
  end if;

  /* The finance gate submission and the live tax record must agree on the
     expiry date, because the seller reads both on the same screen. */
  select count(*) into n
    from onboarding_submissions s, jsonb_array_elements(s.fields) f
   where s.partner_id = 'PTR-1004' and s.gate_key = 'finance'
     and f->>0 = 'Treaty certificate'
     and f->>1 = 'On file, valid to '
       || to_char((select treaty_expires from partner_bank where partner_id = 'PTR-1004'), 'DD Mon YYYY');
  if n <> 1 then
    raise exception 'The finance gate submission does not quote the certificate expiry now on file';
  end if;

  /* A storefront can only be open in a marketplace the seller was approved for.
     Anything else is a shop nobody authorised. */
  select count(*) into n from partner_golive g
   where not exists (
     select 1 from partner_categories pc
      where pc.partner_id = g.partner_id and pc.category_id = g.category_id
        and pc.approved_at is not null);
  if n > 0 then
    raise exception '% storefronts are open in marketplaces the seller was never approved for', n;
  end if;

  /* The seller must have at least one marketplace they are open in but not
     trading in — it is the state this screen exists to make visible, and if the
     data no longer contains it the screen is being demonstrated against
     nothing. */
  select count(*) into n from partner_golive g
   where g.partner_id = 'PTR-1004' and g.first_listing_on is null;
  if n < 1 then
    raise exception 'PTR-1004 has a listing in every marketplace it is open in — the empty-storefront case is no longer in the data';
  end if;
end $$;
