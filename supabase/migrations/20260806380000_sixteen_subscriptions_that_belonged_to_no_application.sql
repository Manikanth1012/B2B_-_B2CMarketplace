/* Sixteen subscriptions that belonged to no application.
 *
 * The previous migration gave the marketplace applications, credentials and a
 * call log. The sixteen subscriptions already in the table predate all three:
 * `application_id` and `version_id` are null on every one of them, which means
 * the new model describes nothing that exists. A seller opening the portal
 * would find their subscriptions listed and no key behind any of them —
 * exactly the fault the model was built to remove, preserved in the data.
 *
 * So this backfills what was always implied:
 *
 *   - an application per seller, named for what it is actually doing, with the
 *     technical contact already on the partner record
 *   - a sandbox credential for every application, and a live one for those
 *     with production subscriptions
 *   - every subscription pointed at the version it was calling
 *
 * Three things are deliberately not tidy, because a portal that only ever
 * renders the happy path has never been looked at:
 *
 *   - Kestrel's catalogue subscription points at v2.0, which is deprecated with
 *     a sunset date. The deprecation note already said Kestrel integrated
 *     against 2.0; until now nothing in the data agreed with it. Their seller
 *     view should be telling them to move.
 *   - Nimbus has a production request pending and ClearVault has one refused,
 *     so the operator's queue has something to decide and the seller's screen
 *     has a refusal with a reason on it.
 *   - Sentinel holds one rotating credential inside its grace window and one
 *     revoked, so all four key states are reachable on a screen rather than
 *     three of them being theoretical.
 *
 * `volume` stops being a number somebody typed. Every subscription's figure is
 * recomputed as the count of rows in `api_call_log` beneath it, and the log is
 * seeded with calls spread over the last thirty days — including the failures,
 * because a success rate computed only from successes is not a success rate.
 * The figures come out smaller than the ones they replace. They are also the
 * only ones anything can check.
 */

begin;

/* ---- Applications --------------------------------------------------------- */

insert into api_applications (id, partner_id, name, description, contact_name, contact_email, created_at, created_by)
values
  ('APP-KESTREL-CAT', 'PTR-1002', 'Storefront sync',
   'Pushes the Kestrel product master into the marketplace catalogue nightly and reads back approval state.',
   'Anil Mehra', 'a.mehra@kestrel.in', now() - interval '19 months', 'a.mehra@kestrel.in'),
  ('APP-KESTREL-OPS', 'PTR-1002', 'Fulfilment and stock',
   'Receives orders into the Kestrel WMS, acknowledges them, and keeps stock levels in step both ways.',
   'Anil Mehra', 'a.mehra@kestrel.in', now() - interval '15 months', 'a.mehra@kestrel.in'),
  ('APP-NIMBUS-BUILD', 'PTR-1004', 'Integration build',
   'The Nimbus team''s working integration — catalogue, orders, stock, settlement and callbacks — being built against sandbox before it goes live.',
   'Katrin Boehm', 'katrin.boehm@nimbussensors.com', now() - interval '4 months', 'katrin.boehm@nimbussensors.com'),
  ('APP-SENTINEL', 'PTR-1003', 'Revenue reconciliation',
   'Pulls settlement statements into Sentinel''s finance ledger and listens for payout events.',
   'Farah Al Hashimi', 'f.hashimi@sentinel.ae', now() - interval '11 months', 'f.hashimi@sentinel.ae'),
  ('APP-CLEARVAULT', 'PTR-1010', 'Catalogue and licences',
   'Reads the marketplace catalogue for pricing parity checks and tracks subscription seat counts.',
   'Idris Haddad', 'i.haddad@clearvault.uk', now() - interval '9 months', 'i.haddad@clearvault.uk'),
  ('APP-VOLTA', 'PTR-1008', 'Order intake',
   'Takes marketplace orders into Volta''s dispatch system. Orders only — nothing else is wired up yet.',
   'Chen Yu Hsu', 'c.hsu@volta.tw', now() - interval '7 months', 'c.hsu@volta.tw')
on conflict (id) do nothing;

/* ---- Subscriptions get an application and a version ----------------------- */

update operator_api_subscriptions s
   set application_id = m.app,
       version_id     = m.ver,
       version        = split_part(m.ver, '@', 2),
       state          = coalesce(nullif(s.state, ''), 'active')
  from (values
    /* Kestrel's catalogue integration is the one the v2.0 deprecation note
       names. Pointing it at 2.1 was the data disagreeing with the story. */
    ('sub-001', 'APP-KESTREL-CAT', 'AP-CAT@2.0'),
    ('sub-002', 'APP-KESTREL-OPS', 'AP-ORD@1.3'),
    ('sub-007', 'APP-KESTREL-OPS', 'AP-INV@1.0'),
    ('sub-010', 'APP-KESTREL-OPS', 'AP-PTY@1.0'),
    ('sub-003', 'APP-NIMBUS-BUILD', 'AP-CAT@2.1'),
    ('sub-004', 'APP-NIMBUS-BUILD', 'AP-ORD@1.3'),
    ('sub-011', 'APP-NIMBUS-BUILD', 'AP-SET@1.2'),
    ('sub-012', 'APP-NIMBUS-BUILD', 'AP-EVT@1.1'),
    ('sub-013', 'APP-NIMBUS-BUILD', 'AP-INV@1.0'),
    ('sub-005', 'APP-SENTINEL', 'AP-SET@1.2'),
    ('sub-008', 'APP-SENTINEL', 'AP-EVT@1.1'),
    ('sub-006', 'APP-CLEARVAULT', 'AP-CAT@2.1'),
    ('sub-009', 'APP-CLEARVAULT', 'AP-SUB@1.1'),
    ('sub-014', 'APP-VOLTA', 'AP-ORD@1.3'),
    ('sub-015', 'APP-KESTREL-CAT', 'AP-CAT@2.1'),
    ('sub-016', 'APP-CLEARVAULT', 'AP-SUB@1.1')
  ) as m(sub, app, ver)
 where s.id = m.sub;

/* sub-015 and sub-016 belonged to StreamNova and Kestrel/ClearVault do not own
   them. Put them back where they came from with an application of their own. */
insert into api_applications (id, partner_id, name, description, contact_name, contact_email, created_at, created_by)
values ('APP-STREAMNOVA', 'PTR-1001', 'Content catalogue',
        'Publishes StreamNova''s tiers and packages into the marketplace and reports subscriber counts back.',
        'Wei Lin Tan', 'w.tan@streamnova.sg', now() - interval '22 months', 'w.tan@streamnova.sg')
on conflict (id) do nothing;

update operator_api_subscriptions set application_id = 'APP-STREAMNOVA'
 where id in ('sub-015', 'sub-016');

/* ---- Credentials ---------------------------------------------------------- */

/* Issued as they would have been at the time: the secret is minted, hashed and
   discarded here, because the only copy a real portal keeps is the one it
   showed the developer once. These sellers have theirs; this table does not. */
insert into api_credentials (id, application_id, environment, client_id, secret_hash,
                             secret_prefix, secret_last4, issued_at, issued_to)
select 'CRD-' || upper(substr(md5(a.id || e.env), 1, 10)),
       a.id, e.env,
       'cid_' || case when e.env = 'production' then 'live' else 'sandbox' end
         || '_' || substr(md5(a.id || e.env || 'cid'), 1, 20),
       crypt(mint_secret(e.env), gen_salt('bf')),
       case when e.env = 'production' then 'ak_live_' || substr(md5(a.id), 1, 4)
            else 'ak_sandbox_' || substr(md5(a.id), 1, 4) end,
       substr(md5(a.id || e.env || 'last'), 1, 4),
       a.created_at + interval '1 day',
       a.contact_name
  from api_applications a
  cross join (values ('sandbox'), ('production')) as e(env)
 where e.env = 'sandbox'
    or exists (select 1 from operator_api_subscriptions s
                where s.application_id = a.id and s.environment = 'production')
on conflict (id) do nothing;

/* ---- The states a screen has to render ------------------------------------ */

/* Sentinel rotated their live key four days ago and gave themselves a week to
   deploy it. The old one still authenticates and stops on a stated date. */
insert into api_credentials (id, application_id, environment, client_id, secret_hash,
                             secret_prefix, secret_last4, issued_at, issued_to, rotated_from)
values ('CRD-SENTINEL-NEW', 'APP-SENTINEL', 'production',
        'cid_live_' || substr(md5('sentinel-rotated'), 1, 20),
        crypt(mint_secret('production'), gen_salt('bf')),
        'ak_live_' || substr(md5('sentinel-new'), 1, 4), 'c41f',
        now() - interval '4 days', 'Farah Al Hashimi',
        'CRD-' || upper(substr(md5('APP-SENTINELproduction'), 1, 10)))
on conflict (id) do nothing;

update api_credentials set grace_until = now() + interval '3 days'
 where id = 'CRD-' || upper(substr(md5('APP-SENTINELproduction'), 1, 10))
   and revoked_at is null;

/* A key that went into a public repository. Revoked, with the reason, because a
   revoked key nobody can explain later is the same as one nobody revoked. */
insert into api_credentials (id, application_id, environment, client_id, secret_hash,
                             secret_prefix, secret_last4, issued_at, issued_to,
                             revoked_at, revoked_why)
values ('CRD-CLEARVAULT-OLD', 'APP-CLEARVAULT', 'sandbox',
        'cid_sandbox_' || substr(md5('clearvault-leaked'), 1, 20),
        crypt(mint_secret('sandbox'), gen_salt('bf')),
        'ak_sandbox_' || substr(md5('cv-old'), 1, 4), '9b02',
        now() - interval '8 months', 'Idris Haddad',
        now() - interval '5 weeks',
        'Committed to a public repository by a contractor. Replaced the same afternoon.')
on conflict (id) do nothing;

/* ---- Two production requests, one waiting and one refused ----------------- */

/* Nimbus have built the whole integration on sandbox and are asking to go live.
   This is what the operator's queue is for; without it the queue is a screen
   that has never had a row in it. */
/* The refusal carries its reason in the same statement that writes it — the
   constraint refuses a refused row with no note, which is the point of it. */
insert into operator_api_subscriptions (
  id, api_id, application_id, version_id, consumer_name, partner_id, version,
  environment, scopes, volume, status, state, requested_at, use_case,
  decided_at, decided_by, decision_note, sort_order)
values
  ('SUB-NIMBUS-PROD', 'AP-CAT', 'APP-NIMBUS-BUILD', 'AP-CAT@2.1', 'Nimbus Sensors', 'PTR-1004', '2.1',
   'production', array['catalogue:read', 'catalogue:write'], 0, 'pending', 'pending',
   now() - interval '6 days',
   'Our sandbox build has been publishing the full sensor range for three months and the shapes match. '
   || 'We want to move the nightly catalogue push to production ahead of the Q4 range refresh, so pricing '
   || 'changes reach the marketplace the same day they reach our own storefront rather than a week later.',
   null, null, null, 101),
  ('SUB-CLEARVAULT-PROD', 'AP-SUB', 'APP-CLEARVAULT', 'AP-SUB@1.1', 'ClearVault Cloud', 'PTR-1010', '1.1',
   'production', array['subscriptions:read', 'subscriptions:write'], 0, 'refused', 'refused',
   now() - interval '7 weeks',
   'We want to cancel and re-provision seats directly from our own admin console.',
   now() - interval '6 weeks', 'api-desk@aventa.com',
   'subscriptions:write on production would let ClearVault cancel a customer''s seat '
   || 'without the customer or the marketplace seeing a record of it. Read access is approved and live. '
   || 'Come back with a cancellation flow that raises a marketplace event and we will look again.',
   102)
on conflict (id) do nothing;

/* ---- Calls that actually happened ----------------------------------------- */

/* The volume column held numbers somebody typed — 12,500 on one row, 95 on
   another, and nothing beneath either. Same fault `ledger_consistency` exists
   to catch on the money side: a total nothing can reproduce.

   Seeded proportionally to what was claimed, scaled to a size a table can
   actually hold, over the last thirty days, with the failures included. */
insert into api_call_log (credential_id, application_id, api_id, version_id, environment,
                          method, path, status_code, ms, called_at, called_by)
select c.id, s.application_id, s.api_id, s.version_id, s.environment,
       e.method, e.path,
       /* Roughly one call in twenty-five fails, and the failures are the ones a
          developer needs to see: an expired token, a scope they do not hold, a
          burst over the limit, and the marketplace's own fault. */
       case (g % 97)
         when 0 then 401 when 31 then 403 when 62 then 429 when 88 then 500
         else case when e.method = 'POST' then 201 else 200 end
       end,
       40 + (abs(hashtext(s.id || g::text)) % 380),
       now() - (interval '30 days' * ((g % 300) / 300.0)),
       a.contact_email
  from operator_api_subscriptions s
  join api_applications a on a.id = s.application_id
  join api_credentials c on c.application_id = s.application_id
                        and c.environment = s.environment
                        and c.revoked_at is null
                        and c.rotated_from is null
  join lateral (
    select method, path from api_endpoints
     where version_id = s.version_id order by sort_order limit 3
  ) e on true
  cross join lateral generate_series(1, greatest(6, least(120, (s.volume / 90)))) g
 where s.state = 'active' and s.version_id is not null;

/* And now the column is a count rather than a claim. */
update operator_api_subscriptions s
   set volume = coalesce((select count(*) from api_call_log l
                           where l.application_id = s.application_id
                             and l.version_id = s.version_id
                             and l.environment = s.environment), 0);

/* ---- Checks --------------------------------------------------------------- */

do $$
declare n int; bad int;
begin
  select count(*) into bad from operator_api_subscriptions
   where application_id is null or version_id is null;
  if bad > 0 then
    raise exception '% subscriptions still belong to no application', bad;
  end if;

  /* Only an *active* subscription must have a key behind it. A pending request
     having none is the design: approval is what mints the live credential, and
     Nimbus's request is sitting in the queue waiting for exactly that. */
  select count(*) into bad from operator_api_subscriptions s
   where s.state = 'active'
     and not exists (select 1 from api_credentials c
                      where c.application_id = s.application_id
                        and c.environment = s.environment);
  if bad > 0 then
    raise exception '% active subscriptions have no credential in their own environment', bad;
  end if;

  /* And the converse, which is the fault this migration exists to remove: a
     request nobody has decided must not already hold the key it is asking for. */
  select count(*) into bad from operator_api_subscriptions s
   where s.state = 'pending'
     and exists (select 1 from api_credentials c
                  where c.application_id = s.application_id
                    and c.environment = s.environment and c.revoked_at is null);
  if bad > 0 then
    raise exception '% pending requests already hold the credential they are asking for', bad;
  end if;

  /* The whole point of the exercise: no stored total without rows beneath it. */
  select count(*) into bad from operator_api_subscriptions s
   where s.state = 'active'
     and s.volume <> (select count(*) from api_call_log l
                       where l.application_id = s.application_id
                         and l.version_id = s.version_id
                         and l.environment = s.environment);
  if bad > 0 then
    raise exception '% subscriptions report a volume the call log cannot produce', bad;
  end if;

  select count(*) into n from api_credential_state where state = 'retiring';
  if n = 0 then raise exception 'no credential is inside a grace window, so the screen cannot show one'; end if;
  select count(*) into n from api_credential_state where state = 'revoked';
  if n = 0 then raise exception 'no credential is revoked, so the screen cannot show one'; end if;
  select count(*) into n from operator_api_subscriptions where state = 'pending';
  if n = 0 then raise exception 'the operator queue has nothing to decide'; end if;
  select count(*) into n from operator_api_subscriptions where state = 'refused';
  if n = 0 then raise exception 'no refusal exists, so the seller never sees a reason'; end if;
end $$;

commit;
