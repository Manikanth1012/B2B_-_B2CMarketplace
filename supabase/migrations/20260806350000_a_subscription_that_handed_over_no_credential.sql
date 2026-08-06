/* A subscription that handed over no credential.
 *
 * `operator_api_subscriptions` recorded that a seller had subscribed to an API,
 * in an environment, with a set of scopes, and a call volume. There was no
 * credential anywhere in the schema. No client id, no secret, no token, no
 * record of anything being issued or revoked. A seller who "subscribed" got a
 * row and nothing they could authenticate with, and the volume figures were
 * decoration over an exchange that never happened.
 *
 * The model here is the one every public portal uses — Apigee, Azure API
 * Management, IBM API Connect — and it has a middle object we did not:
 *
 *     seller  →  application  →  subscription  →  credentials
 *
 * The subscribable thing is an *application*, not a company. One seller may run
 * several: a production integration, a partner's agency doing their catalogue,
 * a throwaway for a spike. Each gets its own keys, so one can be revoked
 * without taking the others down — which is the entire reason the object
 * exists.
 *
 * Credentials are per environment, following Stripe's separation: sandbox and
 * production hold different keys and neither can see the other's data. That is
 * what makes it safe to issue sandbox keys the instant somebody registers,
 * with no approval and no waiting, which is what a developer wants at the
 * moment they are trying to decide whether to integrate at all. Production
 * requires the marketplace to agree, because production is other people's
 * customers and other people's money.
 *
 * The secret is shown exactly once, at issue. After that only its prefix and
 * last four characters are readable, and what is stored is a salted hash — so
 * a leak of this table is not a leak of anybody's key. Rotation issues a new
 * secret and leaves the old one working for a stated grace period, because a
 * rotation that breaks production the moment it is clicked is a rotation
 * nobody performs.
 *
 * Keys carry their environment in the string — `ak_sandbox_…`, `ak_live_…` —
 * so a key pasted into the wrong config is recognisable on sight, and one found
 * in a public repository can be traced without a lookup.
 */

begin;

/* ---- The application ------------------------------------------------------ */

create table if not exists api_applications (
  id            text primary key,
  partner_id    text not null references partners(id) on delete cascade,
  name          text not null,
  description   text not null,
  /* Who to reach when a key is about to expire or a callback starts failing.
     Not the account's billing address — the person who wrote the integration. */
  contact_name  text not null,
  contact_email text not null,
  status        text not null default 'active',
  created_at    timestamptz not null default now(),
  created_by    text,
  suspended_at  timestamptz,
  suspended_why text,
  constraint api_applications_status_check check (status in ('active', 'suspended')),
  constraint api_applications_suspension_has_a_reason check (
    status <> 'suspended' or coalesce(suspended_why, '') <> ''
  ),
  unique (partner_id, name)
);

/* ---- The credential ------------------------------------------------------- */

create table if not exists api_credentials (
  id             text primary key,
  application_id text not null references api_applications(id) on delete cascade,
  environment    text not null,
  client_id      text not null unique,
  /* Salted, via pgcrypto. Never readable back — the only copy of the secret is
     the one shown to the developer at issue. */
  secret_hash    text not null,
  secret_prefix  text not null,
  secret_last4   text not null,
  issued_at      timestamptz not null default now(),
  issued_to      text not null,
  /* Set when this credential replaced another. The old one keeps working until
     its grace window closes, so a rotation is something a team can schedule
     rather than something that breaks production on click. */
  rotated_from   text references api_credentials(id),
  grace_until    timestamptz,
  revoked_at     timestamptz,
  revoked_why    text,
  last_used_at   timestamptz,
  constraint api_credentials_environment_check check (environment in ('sandbox', 'production')),
  constraint api_credentials_revocation_has_a_reason check (
    revoked_at is null or coalesce(revoked_why, '') <> ''
  )
);

create index if not exists api_credentials_app_idx on api_credentials (application_id, environment);

/* Whether a credential would authenticate a call right now. A view rather than
   a column, because "live" is a fact about the clock as much as about the row —
   a grace window closes without anybody updating anything. */
create or replace view api_credential_state
with (security_invoker = on) as
select c.*,
       case
         when c.revoked_at is not null then 'revoked'
         when c.grace_until is not null and c.grace_until <= now() then 'expired'
         when c.grace_until is not null then 'retiring'
         else 'active'
       end as state,
       case when c.grace_until is not null and c.grace_until > now()
            then ceil(extract(epoch from (c.grace_until - now())) / 86400)::int end as grace_days_left
  from api_credentials c;

grant select on api_credential_state to authenticated;

/* ---- Subscriptions grow up ------------------------------------------------ */

alter table operator_api_subscriptions
  add column if not exists application_id text references api_applications(id) on delete cascade,
  add column if not exists version_id     text references api_versions(id),
  add column if not exists state          text not null default 'active',
  add column if not exists requested_at   timestamptz,
  add column if not exists use_case       text,
  add column if not exists decided_at     timestamptz,
  add column if not exists decided_by     text,
  add column if not exists decision_note  text,
  add column if not exists rate_limit_per_min int not null default 60,
  add column if not exists quota_per_day      int not null default 10000;

alter table operator_api_subscriptions drop constraint if exists api_subscriptions_state_check;
alter table operator_api_subscriptions add constraint api_subscriptions_state_check
  check (state in ('pending', 'active', 'refused', 'suspended'));

/* A production request that nobody has decided has to say what it is for, and a
   refusal has to say why. Both are the parts a queue is useless without. */
alter table operator_api_subscriptions drop constraint if exists api_subscriptions_production_asks_why;
alter table operator_api_subscriptions add constraint api_subscriptions_production_asks_why check (
  environment <> 'production' or state = 'active' or coalesce(use_case, '') <> ''
);
alter table operator_api_subscriptions drop constraint if exists api_subscriptions_refusal_says_why;
alter table operator_api_subscriptions add constraint api_subscriptions_refusal_says_why check (
  state <> 'refused' or coalesce(decision_note, '') <> ''
);

/* ---- Calls actually made -------------------------------------------------- */

/* So the volume on a subscription is counted rather than asserted — the same
   fault `ledger_consistency` exists to catch elsewhere. */
create table if not exists api_call_log (
  id             bigserial primary key,
  credential_id  text references api_credentials(id) on delete set null,
  application_id text references api_applications(id) on delete cascade,
  api_id         text,
  version_id     text,
  environment    text not null,
  method         text not null,
  path           text not null,
  status_code    int not null,
  ms             int not null default 0,
  called_at      timestamptz not null default now(),
  called_by      text
);

create index if not exists api_call_log_app_idx on api_call_log (application_id, called_at desc);

/* ---- Who sees what -------------------------------------------------------- */

alter table api_applications enable row level security;
alter table api_credentials  enable row level security;
alter table api_call_log     enable row level security;

drop policy if exists partner_own_applications on api_applications;
create policy partner_own_applications on api_applications for all to authenticated
  using (partner_id = current_partner_id()) with check (partner_id = current_partner_id());

drop policy if exists operator_all_applications on api_applications;
create policy operator_all_applications on api_applications for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A seller reads their own credentials — the id, the prefix, the state. The
   secret is not in the table in a readable form, so this exposes no key. */
drop policy if exists partner_own_credentials on api_credentials;
create policy partner_own_credentials on api_credentials for select to authenticated
  using (exists (select 1 from api_applications a
                  where a.id = application_id and a.partner_id = current_partner_id()));

drop policy if exists operator_all_credentials on api_credentials;
create policy operator_all_credentials on api_credentials for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

drop policy if exists partner_own_calls on api_call_log;
create policy partner_own_calls on api_call_log for select to authenticated
  using (exists (select 1 from api_applications a
                  where a.id = application_id and a.partner_id = current_partner_id()));

drop policy if exists operator_all_calls on api_call_log;
create policy operator_all_calls on api_call_log for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

commit;
