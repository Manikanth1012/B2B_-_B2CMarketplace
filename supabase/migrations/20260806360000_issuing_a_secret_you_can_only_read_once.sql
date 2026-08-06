/* Issuing a secret you can only read once.
 *
 * Every one of these runs as `security definer` and derives the caller's
 * identity from `current_partner_id()` rather than taking it as an argument.
 * A function that lets a client name whose application it is issuing keys for
 * is a function that issues keys for anybody's application.
 *
 * The secret is returned exactly once — by the call that creates it, and never
 * again. What is stored is `crypt()`ed with a per-row salt, so the table can be
 * dumped without a single working key coming out of it. Everything the portal
 * needs to display afterwards (which key, whose, when, still valid?) comes from
 * the prefix, the last four and the dates.
 */

begin;

/* A key that says what it is. `ak_sandbox_…` cannot be mistaken for
   `ak_live_…` in a config file or in a screenshot, and one found in a public
   repository is identifiable without a lookup. */
create or replace function mint_secret(p_environment text)
returns text language sql volatile as $fn$
  select 'ak_' || case when p_environment = 'production' then 'live' else 'sandbox' end
      || '_' || encode(gen_random_bytes(24), 'hex');
$fn$;

/* ---- Registering an application ------------------------------------------ */

/* Sandbox keys come back from this call, immediately and without anybody
   approving anything. That is deliberate: a developer deciding whether to
   integrate at all should not have to wait on a queue, and sandbox keys reach
   nothing but seeded data. */
create or replace function register_application(
  p_name text, p_description text, p_contact_name text, p_contact_email text
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  ptr    text := current_partner_id();
  app_id text;
  cred_id text;
  secret text;
begin
  if ptr is null then
    raise exception 'Only a seller can register an application.';
  end if;
  if coalesce(trim(p_name), '') = '' then
    raise exception 'Give the application a name — it is how you will tell its keys apart later.';
  end if;
  if coalesce(trim(p_description), '') = '' then
    raise exception 'Say what the application does. A key with no stated purpose is one nobody can safely revoke.';
  end if;
  if p_contact_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'A contact email is needed for expiry and failure notices.';
  end if;
  if exists (select 1 from api_applications where partner_id = ptr and name = trim(p_name)) then
    raise exception 'You already have an application called "%".', trim(p_name);
  end if;

  app_id := 'APP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into api_applications (id, partner_id, name, description, contact_name, contact_email, created_by)
  values (app_id, ptr, trim(p_name), trim(p_description), trim(p_contact_name), lower(trim(p_contact_email)),
          coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'the seller'));

  secret  := mint_secret('sandbox');
  cred_id := 'CRD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into api_credentials (id, application_id, environment, client_id, secret_hash,
                               secret_prefix, secret_last4, issued_to)
  values (cred_id, app_id, 'sandbox',
          'cid_sandbox_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20),
          crypt(secret, gen_salt('bf')),
          left(secret, 15), right(secret, 4), trim(p_contact_name));

  return jsonb_build_object(
    'application_id', app_id,
    'credential_id', cred_id,
    'environment', 'sandbox',
    'client_id', (select client_id from api_credentials where id = cred_id),
    /* The only time this value is ever returned. */
    'client_secret', secret,
    'note', 'Copy the secret now. It is stored hashed and cannot be shown again — if you lose it, rotate.'
  );
end $fn$;

/* ---- Subscribing an application to an API -------------------------------- */

create or replace function subscribe_application(
  p_application_id text, p_version_id text, p_environment text,
  p_scopes text[], p_use_case text default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  ptr    text := current_partner_id();
  api    record;
  ver    record;
  bad    text[];
  sub_id text;
  st     text;
begin
  if not exists (select 1 from api_applications
                  where id = p_application_id and partner_id = ptr and status = 'active') then
    raise exception 'That is not one of your active applications.';
  end if;

  select v.*, a.name as api_name, a.scopes as api_scopes, a.id as api_id
    into ver from api_versions v join operator_apis a on a.id = v.api_id where v.id = p_version_id;
  if ver is null then raise exception 'No such API version.'; end if;
  if ver.lifecycle = 'retired' then
    raise exception '% % has been retired and no longer accepts calls.', ver.api_name, ver.version;
  end if;

  /* A scope the API does not publish is a scope no token could ever carry, so
     granting it would be issuing a promise nothing can keep. */
  select array_agg(s) into bad from unnest(p_scopes) s where not (s = any(ver.api_scopes));
  if bad is not null then
    raise exception '% does not publish %', ver.api_name, array_to_string(bad, ', ');
  end if;
  if coalesce(array_length(p_scopes, 1), 0) = 0 then
    raise exception 'Choose at least one scope, or the token would be able to do nothing.';
  end if;

  /* Sandbox is self-service. Production is somebody else's customers. */
  if p_environment = 'production' then
    if coalesce(trim(p_use_case), '') = '' then
      raise exception 'Say what this will be used for in production. The desk decides on that sentence.';
    end if;
    st := 'pending';
  else
    st := 'active';
  end if;

  sub_id := 'SUB-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into operator_api_subscriptions (
    id, api_id, application_id, version_id, consumer_name, partner_id, version,
    environment, scopes, volume, status, state, started_at, requested_at, use_case, sort_order
  )
  select sub_id, ver.api_id, p_application_id, p_version_id,
         (select name from partners where id = ptr), ptr, ver.version,
         p_environment, p_scopes, 0,
         case when st = 'active' then 'active' else 'pending' end, st,
         case when st = 'active' then now() end, now(), nullif(trim(p_use_case), ''),
         coalesce((select max(sort_order) from operator_api_subscriptions), 0) + 1;

  return jsonb_build_object(
    'subscription_id', sub_id, 'state', st,
    'note', case when st = 'active'
      then 'Active. Your sandbox keys will authenticate against it now.'
      else 'Sent to the marketplace. You keep sandbox access while they decide.' end
  );
end $fn$;

/* ---- Production keys, once somebody has agreed --------------------------- */

create or replace function decide_production_access(
  p_subscription_id text, p_approve boolean, p_note text
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  sub     record;
  secret  text;
  cred_id text;
  who     text := coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'the marketplace');
begin
  if coalesce(current_persona(), '') <> 'operator' then
    raise exception 'Only the marketplace decides production access.';
  end if;
  select * into sub from operator_api_subscriptions where id = p_subscription_id;
  if sub is null then raise exception 'No such subscription.'; end if;
  if sub.state <> 'pending' then
    raise exception 'That request was already decided — it is %.', sub.state;
  end if;
  if not p_approve and coalesce(trim(p_note), '') = '' then
    raise exception 'Say why it was refused. A refusal with no reason is one the seller cannot act on.';
  end if;

  update operator_api_subscriptions
     set state = case when p_approve then 'active' else 'refused' end,
         status = case when p_approve then 'active' else 'refused' end,
         decided_at = now(), decided_by = who, decision_note = nullif(trim(p_note), ''),
         started_at = case when p_approve then now() else started_at end
   where id = p_subscription_id;

  if not p_approve then
    return jsonb_build_object('state', 'refused', 'note', 'The seller has been told, with your reason.');
  end if;

  /* Approval is what mints the live key — and only if the application has not
     already got one, because a second approval must not silently invalidate
     the key somebody is already calling with. */
  if exists (select 1 from api_credentials
              where application_id = sub.application_id and environment = 'production'
                and revoked_at is null) then
    return jsonb_build_object('state', 'active', 'note', 'Approved. This application already holds a live key.');
  end if;

  secret  := mint_secret('production');
  cred_id := 'CRD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into api_credentials (id, application_id, environment, client_id, secret_hash,
                               secret_prefix, secret_last4, issued_to)
  select cred_id, sub.application_id, 'production',
         'cid_live_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20),
         crypt(secret, gen_salt('bf')), left(secret, 12), right(secret, 4), a.contact_name
    from api_applications a where a.id = sub.application_id;

  /* The live secret goes to the *operator's* screen here, which is the one
     thing this prototype does that a real portal must not: a production secret
     belongs to the developer alone. In a real deployment approval would send
     the seller a one-time link and the marketplace would never see the value.
     Left visible on purpose so the demo can show the exchange happening, and
     named here so nobody mistakes it for a design. */
  return jsonb_build_object(
    'state', 'active', 'credential_id', cred_id,
    'client_id', (select client_id from api_credentials where id = cred_id),
    'client_secret', secret,
    'note', 'Approved and a live key issued. Give this to the seller once — it cannot be shown again.'
  );
end $fn$;

/* ---- Rotation and revocation --------------------------------------------- */

create or replace function rotate_credential(p_credential_id text, p_grace_days int default 7)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  old     record;
  secret  text;
  cred_id text;
begin
  select c.*, a.partner_id, a.contact_name into old
    from api_credentials c join api_applications a on a.id = c.application_id
   where c.id = p_credential_id;
  if old is null then raise exception 'No such credential.'; end if;
  if old.partner_id is distinct from current_partner_id() and coalesce(current_persona(),'') <> 'operator' then
    raise exception 'That credential belongs to somebody else.';
  end if;
  if old.revoked_at is not null then
    raise exception 'That credential was revoked on %. Rotating it would revive a key somebody stopped on purpose.', old.revoked_at::date;
  end if;
  if p_grace_days < 0 or p_grace_days > 30 then
    raise exception 'The grace period runs from 0 to 30 days.';
  end if;

  secret  := mint_secret(old.environment);
  cred_id := 'CRD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into api_credentials (id, application_id, environment, client_id, secret_hash,
                               secret_prefix, secret_last4, issued_to, rotated_from)
  values (cred_id, old.application_id, old.environment,
          'cid_' || case when old.environment = 'production' then 'live' else 'sandbox' end
            || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 20),
          crypt(secret, gen_salt('bf')),
          left(secret, case when old.environment = 'production' then 12 else 15 end),
          right(secret, 4), old.contact_name, old.id);

  /* The old key keeps working for the grace window. A rotation that breaks
     production the instant it is clicked is a rotation nobody ever performs,
     which is how keys end up five years old. */
  update api_credentials set grace_until = now() + make_interval(days => p_grace_days)
   where id = old.id;

  return jsonb_build_object(
    'credential_id', cred_id,
    'client_id', (select client_id from api_credentials where id = cred_id),
    'client_secret', secret,
    'old_credential_id', old.id,
    'old_stops_working', (now() + make_interval(days => p_grace_days))::date,
    'note', case when p_grace_days = 0
      then 'The previous key stopped working immediately.'
      else 'The previous key keeps working for ' || p_grace_days || ' more days. Deploy this one before then.' end
  );
end $fn$;

create or replace function revoke_credential(p_credential_id text, p_why text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare owner text;
begin
  if coalesce(trim(p_why), '') = '' then
    raise exception 'Say why. A revoked key with no reason is one nobody can explain later.';
  end if;
  select a.partner_id into owner
    from api_credentials c join api_applications a on a.id = c.application_id
   where c.id = p_credential_id;
  if owner is null then raise exception 'No such credential.'; end if;
  if owner is distinct from current_partner_id() and coalesce(current_persona(),'') <> 'operator' then
    raise exception 'That credential belongs to somebody else.';
  end if;

  update api_credentials
     set revoked_at = now(), revoked_why = trim(p_why), grace_until = null
   where id = p_credential_id and revoked_at is null;

  return jsonb_build_object('credential_id', p_credential_id, 'state', 'revoked',
    'note', 'Calls with that key now fail with 401. Nothing else on the application is affected.');
end $fn$;

grant execute on function register_application(text, text, text, text) to authenticated;
grant execute on function subscribe_application(text, text, text, text[], text) to authenticated;
grant execute on function decide_production_access(text, boolean, text) to authenticated;
grant execute on function rotate_credential(text, int) to authenticated;
grant execute on function revoke_credential(text, text) to authenticated;

do $$
declare s1 text; s2 text;
begin
  /* Two mints must not collide, or one seller's key would authenticate
     another's calls. */
  s1 := mint_secret('sandbox'); s2 := mint_secret('sandbox');
  if s1 = s2 then raise exception 'mint_secret is not random'; end if;
  if s1 !~ '^ak_sandbox_[0-9a-f]{48}$' then raise exception 'a sandbox key is not the shape it claims: %', s1; end if;
  if mint_secret('production') !~ '^ak_live_[0-9a-f]{48}$' then raise exception 'a live key is not the shape it claims'; end if;

  /* And the hash must verify the secret it was made from, and nothing else. */
  if crypt(s1, crypt(s1, gen_salt('bf'))) is distinct from crypt(s1, gen_salt('bf')) then
    null; -- salts differ by design; the real check is below
  end if;
  declare h text := crypt(s1, gen_salt('bf'));
  begin
    if crypt(s1, h) <> h then raise exception 'a secret does not verify against its own hash'; end if;
    if crypt(s2, h) = h then raise exception 'a different secret verifies against the hash'; end if;
  end;
end $$;

commit;
