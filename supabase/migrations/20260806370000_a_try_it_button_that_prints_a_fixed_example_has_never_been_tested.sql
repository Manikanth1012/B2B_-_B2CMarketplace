/* A "try it" button that prints a fixed example has never been tested.
 *
 * The point of a sandbox call is that it can fail. A portal that renders the
 * documented response whatever you send proves nothing — not that the key
 * works, not that the scope is right, not that the endpoint exists. The first
 * time a developer learns any of that is in production, which is exactly the
 * moment the sandbox existed to avoid.
 *
 * So `sandbox_call` authenticates for real:
 *
 *   1. the credential exists, is a sandbox key, and is not revoked or expired
 *   2. the credential belongs to an application belonging to the caller
 *   3. that application holds an active subscription to this API version
 *   4. the subscription carries the scope this endpoint requires
 *
 * Any of those failing returns the status code a gateway would return — 401 for
 * a key problem, 403 for a scope problem, 404 for an endpoint that is not
 * there — with the message a gateway would send. A developer can therefore
 * discover, from the portal, that they asked for `catalogue:read` and are
 * calling a `catalogue:write` endpoint.
 *
 * Reads return the caller's own rows. Not a fixture: the seller sees their
 * actual listings, their actual orders, their actual settlement lines, shaped
 * the way the specification says. That is what makes the response worth
 * reading and what makes a shape mismatch visible here rather than later.
 *
 * Writes are accepted, validated and echoed, and the response says plainly
 * that nothing was persisted. A sandbox that writes into the same tables the
 * demo runs on is a sandbox that quietly fills the catalogue with test data —
 * which this marketplace has already had to clean up twice, on Priya's
 * subscriptions and on SmartBuild's loyalty ledger.
 *
 * Every call is logged either way, so the volume on a subscription is a count
 * of things that happened.
 */

begin;

create or replace function sandbox_call(
  p_credential_id text,
  p_endpoint_id   text,
  p_body          jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  started timestamptz := clock_timestamp();
  ptr     text := current_partner_id();
  cred    record;
  ep      record;
  sub     record;
  body    jsonb;
  code    int := 200;
  took    int;
begin
  /* Nothing below returns early. Every branch sets `code` and `body` and falls
     through to the one log write and the one envelope at the end, so a branch
     added later cannot skip either. */

  select c.*, s.state as key_state, a.partner_id, a.id as app_id
    into cred
    from api_credential_state s
    join api_credentials c on c.id = s.id
    join api_applications a on a.id = c.application_id
   where c.id = p_credential_id;

  select e.*, v.id as ver_id, v.lifecycle, v.base_path, v.api_id, v.version
    into ep
    from api_endpoints e join api_versions v on v.id = e.version_id
   where e.id = p_endpoint_id;

  if ep is null then
    code := 404; body := jsonb_build_object('error', 'not_found',
      'message', 'No such endpoint on this API version.');

  elsif cred is null or cred.partner_id is distinct from ptr then
    /* Deliberately the same answer for "no such key" and "somebody else's key".
       Telling a caller which one it was is telling them whether a key exists. */
    code := 401; body := jsonb_build_object('error', 'invalid_client',
      'message', 'That credential is not one we can authenticate.');

  elsif cred.environment <> 'sandbox' then
    code := 401; body := jsonb_build_object('error', 'wrong_environment',
      'message', 'This is a live key. The sandbox will not accept it, and that separation is the point.');

  elsif cred.key_state = 'revoked' then
    code := 401; body := jsonb_build_object('error', 'revoked',
      'message', 'That key was revoked on ' || cred.revoked_at::date || ': ' || cred.revoked_why);

  elsif cred.key_state = 'expired' then
    code := 401; body := jsonb_build_object('error', 'expired',
      'message', 'That key was rotated and its grace period ended on ' || cred.grace_until::date || '. Use the key issued in its place.');

  else
    select * into sub from operator_api_subscriptions
     where application_id = cred.app_id and version_id = ep.ver_id
       and environment = 'sandbox' and state = 'active'
     limit 1;

    if sub is null then
      code := 403; body := jsonb_build_object('error', 'no_subscription',
        'message', 'This application is not subscribed to ' || ep.api_id || ' ' || ep.version || ' in sandbox.');

    elsif not (ep.scope = any(sub.scopes)) then
      code := 403; body := jsonb_build_object('error', 'insufficient_scope',
        'message', 'This endpoint needs ' || ep.scope || '. Your subscription carries '
                   || array_to_string(sub.scopes, ', ') || '.',
        'required_scope', ep.scope);

    elsif ep.method <> 'GET' then
      /* Accepted and echoed. Nothing is written — see the header. */
      code := case when ep.method = 'POST' then 201 else 200 end;
      body := ep.response_example
              || jsonb_build_object('_sandbox', jsonb_build_object(
                   'persisted', false,
                   'note', 'Sandbox accepted and validated this write. Nothing was stored — the response shows the shape your code will receive in production.',
                   'youSent', coalesce(p_body, '{}'::jsonb)));

    else
      /* ---- Reads, against the caller's own rows ---- */
      body := case ep.id

        when 'EP-CAT-1' then (
          select jsonb_build_object('totalCount', count(*), 'items', coalesce(jsonb_agg(jsonb_build_object(
            'id', p.id, 'name', p.name, 'status', p.status, 'model', p.model,
            'category', p.category_id,
            'markets', (select coalesce(jsonb_agg(m.market_code order by m.market_code), '[]'::jsonb)
                          from product_markets m where m.product_id = p.id),
            'prices', (select coalesce(jsonb_agg(jsonb_build_object(
                          'currency', pp.currency, 'amount', pp.price,
                          'includesTax', p.price_includes_tax) order by pp.currency), '[]'::jsonb)
                          from product_prices pp where pp.product_id = p.id)
          ) order by p.sort_order), '[]'::jsonb))
            from products p where p.partner_id = ptr)

        when 'EP-CAT-2' then (
          select coalesce(jsonb_build_object(
            'id', p.id, 'name', p.name, 'description', p.description, 'status', p.status,
            'prices', (select coalesce(jsonb_agg(jsonb_build_object(
                          'currency', pp.currency, 'amount', pp.price,
                          'includesTax', p.price_includes_tax) order by pp.currency), '[]'::jsonb)
                          from product_prices pp where pp.product_id = p.id),
            'specs', p.specs), '{}'::jsonb)
            from products p where p.partner_id = ptr order by p.sort_order limit 1)

        when 'EP-ORD-1' then (
          select jsonb_build_object('totalCount', count(*), 'items', coalesce(jsonb_agg(jsonb_build_object(
            'id', o.order_ref, 'placedAt', o.created_at, 'status', o.status,
            'market', o.market, 'currency', o.currency,
            'subtotal', o.subtotal, 'tax', o.tax, 'total', o.total, 'taxInclusive', true
          ) order by o.created_at desc), '[]'::jsonb))
            from orders o where o.seller = (select name from partners where id = ptr))

        when 'EP-SUB-1' then (
          select jsonb_build_object('totalCount', count(*), 'items', coalesce(jsonb_agg(jsonb_build_object(
            'id', s.ref, 'sku', s.product_id, 'status', s.status, 'cycle', s.cycle,
            'price', s.price, 'currency', s.currency,
            'startedAt', s.started_at::date, 'nextRenewal', s.next_renewal
          ) order by s.started_at desc), '[]'::jsonb))
            from subscriptions s
           where s.product_id in (select id from products where partner_id = ptr))

        when 'EP-INV-1' then (
          select jsonb_build_object('totalCount', count(*), 'items', coalesce(jsonb_agg(jsonb_build_object(
            'sku', p.id, 'stockStatus', p.stock, 'listingVisible', p.status = 'live'
          ) order by p.id), '[]'::jsonb))
            from products p where p.partner_id = ptr)

        when 'EP-SET-1' then (
          select jsonb_build_object('totalCount', count(*), 'items', coalesce(jsonb_agg(jsonb_build_object(
            'id', st.id, 'period', st.period, 'currency', st.currency,
            'gross', st.gross, 'commission', st.commission, 'fees', st.fees,
            'refunds', st.refunds, 'net', st.net,
            'payoutCurrency', st.payout_currency, 'status', st.status
          ) order by st.period desc), '[]'::jsonb))
            from settlement_statements st where st.partner_id = ptr)

        when 'EP-SET-2' then (
          select jsonb_build_object('statementId', min(sl.statement_id), 'totalCount', count(*),
            'items', coalesce(jsonb_agg(jsonb_build_object(
              'orderRef', sl.order_ref, 'sku', sl.product_id, 'gross', sl.gross,
              'commissionRate', sl.commission_rate, 'commission', sl.commission,
              'net', sl.net, 'occurredOn', sl.occurred_on)), '[]'::jsonb))
            from settlement_lines sl where sl.partner_id = ptr)

        when 'EP-PTY-1' then (
          select jsonb_build_object('id', pt.id, 'name', pt.name,
            'registeredIn', pt.market, 'status', pt.status, 'tier', pt.tier, 'plan', pt.plan_id,
            'approvedMarkets', (select coalesce(jsonb_agg(pm.market_code order by pm.market_code), '[]'::jsonb)
                                  from partner_markets pm
                                 where pm.partner_id = pt.id and pm.state = 'approved'))
            from partners pt where pt.id = ptr)

        when 'EP-EVT-1' then (
          select jsonb_build_object('totalCount', count(*), 'items', coalesce(jsonb_agg(jsonb_build_object(
            'id', e.id, 'callback', e.url, 'events', e.events,
            'state', case when e.enabled then 'active' else 'disabled' end
          ) order by e.sort_order), '[]'::jsonb))
            from partner_endpoints e where e.partner_id = ptr)

        else ep.response_example
      end;

      /* A read that finds nothing is a real answer, not an error — and saying
         so beats an empty array a developer reads as a bug in their code. */
      if body is null or body = 'null'::jsonb then
        body := jsonb_build_object('totalCount', 0, 'items', '[]'::jsonb,
          '_sandbox', 'You have no records of this kind yet, so the list is genuinely empty.');
      end if;
    end if;
  end if;

  took := greatest(1, (extract(epoch from (clock_timestamp() - started)) * 1000)::int);

  insert into api_call_log (credential_id, application_id, api_id, version_id,
                            environment, method, path, status_code, ms, called_by)
  values (case when cred is null then null else cred.id end,
          case when cred is null then null else cred.app_id end,
          case when ep is null then null else ep.api_id end,
          case when ep is null then null else ep.ver_id end,
          'sandbox',
          coalesce(ep.method, 'GET'), coalesce(ep.path, p_endpoint_id), code, took,
          coalesce(current_setting('request.jwt.claims', true)::jsonb->>'email', 'the portal'));

  if cred is not null and code < 400 then
    update api_credentials set last_used_at = now() where id = cred.id;
    update operator_api_subscriptions set volume = coalesce(volume, 0) + 1
     where application_id = cred.app_id and version_id = ep.ver_id and environment = 'sandbox';
  end if;

  return jsonb_build_object(
    'request', jsonb_build_object(
      'method', coalesce(ep.method, '—'),
      'url', 'https://sandbox.api.aventa.com' || coalesce(ep.base_path, '') || coalesce(ep.path, ''),
      'headers', jsonb_build_object(
        'Authorization', 'Bearer ' || coalesce(cred.secret_prefix, 'ak_sandbox_') || '…',
        'Content-Type', 'application/json'),
      'body', p_body),
    'response', jsonb_build_object('status', code, 'ms', took, 'body', body)
  );
end $fn$;

grant execute on function sandbox_call(text, text, jsonb) to authenticated;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'sandbox_call') then
    raise exception 'sandbox_call did not create';
  end if;
  /* A call with a credential that does not exist must be refused rather than
     served — the whole reason for executing rather than printing a sample. */
  if (sandbox_call('CRD-nope', 'EP-CAT-1')->'response'->>'status')::int <> 401 then
    raise exception 'the sandbox served a call with no valid credential';
  end if;
  if (sandbox_call('CRD-nope', 'EP-does-not-exist')->'response'->>'status')::int <> 404 then
    raise exception 'the sandbox did not 404 an endpoint that is not there';
  end if;
end $$;

commit;
