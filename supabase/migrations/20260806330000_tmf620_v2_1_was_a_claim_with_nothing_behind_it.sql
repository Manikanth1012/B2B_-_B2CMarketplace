/* "TMF620 v2.1" was a claim with nothing behind it.
 *
 * `operator_apis` held a name, a TM Forum number, a version *string* and a list
 * of scopes. No specification, no endpoints, no schemas, no examples. The
 * portal listed seven APIs and a developer could not have written a line of
 * code against any of them: there was nothing to read, nothing to download, and
 * no way to find out what a request even looked like.
 *
 * This gives each one what a published API actually is:
 *
 *   api_versions   — a version is a thing with a lifecycle and dates, not a
 *                    string in a column. Current, deprecated with a sunset date
 *                    and a migration note, or retired. A published API keeps
 *                    every version it ever had, because somebody is still
 *                    calling the old one.
 *   api_endpoints  — method, path, what it does, which scope it needs, and a
 *                    worked request and response for each.
 *
 * The OpenAPI document is *generated* from those rows by `api_spec()` rather
 * than stored beside them. A hand-maintained spec drifts from the reference
 * page the moment somebody edits one and not the other, and the drift is
 * invisible until a developer builds against the wrong one. Here they cannot
 * disagree: the page and the download are the same rows.
 *
 * Paths follow TM Forum's own convention — `/tmf-api/{name}/v{major}` — so a
 * developer who has integrated with any other operator recognises the shape.
 */

begin;

/* ---- A version is a thing with dates ------------------------------------- */

create table if not exists api_versions (
  id             text primary key,
  api_id         text not null references operator_apis(id) on delete cascade,
  version        text not null,
  lifecycle      text not null default 'current',
  base_path      text not null,
  released_on    date not null,
  /* Set together or not at all: a deprecation without a date to work to is a
     warning nobody can plan around. */
  deprecated_on  date,
  sunset_on      date,
  migration_note text,
  notes          text,
  sort_order     int not null default 0,
  constraint api_versions_lifecycle_check
    check (lifecycle in ('draft', 'current', 'deprecated', 'retired')),
  constraint api_versions_deprecation_has_a_date check (
    lifecycle <> 'deprecated'
    or (deprecated_on is not null and sunset_on is not null and coalesce(migration_note, '') <> '')
  ),
  constraint api_versions_sunset_after_deprecation check (
    sunset_on is null or deprecated_on is null or sunset_on > deprecated_on
  ),
  unique (api_id, version)
);

create table if not exists api_endpoints (
  id               text primary key,
  version_id       text not null references api_versions(id) on delete cascade,
  method           text not null,
  path             text not null,
  summary          text not null,
  description      text,
  /* The scope this call needs. A reference page that does not say which scope
     an endpoint wants is a page that sends developers to support. */
  scope            text not null,
  request_example  jsonb,
  response_example jsonb not null,
  sort_order       int not null default 0,
  constraint api_endpoints_method_check
    check (method in ('GET', 'POST', 'PATCH', 'PUT', 'DELETE')),
  unique (version_id, method, path)
);

create index if not exists api_versions_api_idx on api_versions (api_id, sort_order);
create index if not exists api_endpoints_version_idx on api_endpoints (version_id, sort_order);

alter table api_versions  enable row level security;
alter table api_endpoints enable row level security;

/* A published API's documentation is public by design — that is what a
   developer portal is for. Writing is the marketplace's. */
drop policy if exists anyone_reads_api_versions on api_versions;
create policy anyone_reads_api_versions on api_versions for select using (true);
drop policy if exists operator_writes_api_versions on api_versions;
create policy operator_writes_api_versions on api_versions for all
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

drop policy if exists anyone_reads_api_endpoints on api_endpoints;
create policy anyone_reads_api_endpoints on api_endpoints for select using (true);
drop policy if exists operator_writes_api_endpoints on api_endpoints;
create policy operator_writes_api_endpoints on api_endpoints for all
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* ---- The specification, generated ---------------------------------------- */

/* OpenAPI 3.1, assembled from the endpoint rows.
 *
 * Generated rather than stored so the reference page a developer reads and the
 * file they download are the same rows. Every response carries the worked
 * example from its row, so the spec is not just shapes — it is the shapes with
 * a real body beside them, which is what makes a spec usable without a call.
 */
create or replace function api_spec(p_version_id text)
returns jsonb language sql stable set search_path = public as $fn$
  select jsonb_build_object(
    'openapi', '3.1.0',
    'info', jsonb_build_object(
      'title', a.name || ' API',
      'version', v.version,
      'summary', a.description,
      'description', a.description || E'\n\n' || a.why
        || case when v.lifecycle = 'deprecated'
             then E'\n\n**Deprecated on ' || v.deprecated_on
                  || '. Sunset ' || v.sunset_on || '.** ' || coalesce(v.migration_note, '')
             else '' end,
      'x-tmf-standard', a.standard,
      'x-lifecycle', v.lifecycle,
      'contact', jsonb_build_object('name', 'Aventa developer support', 'email', 'developers@aventa.com')
    ),
    'servers', jsonb_build_array(
      jsonb_build_object('url', 'https://sandbox.api.aventa.com' || v.base_path, 'description', 'Sandbox'),
      jsonb_build_object('url', 'https://api.aventa.com' || v.base_path, 'description', 'Production')
    ),
    'components', jsonb_build_object(
      'securitySchemes', jsonb_build_object(
        'oauth2', jsonb_build_object(
          'type', 'oauth2',
          'description', 'Client credentials. Exchange the client_id and client_secret issued to your application for a bearer token, then send it as Authorization: Bearer.',
          'flows', jsonb_build_object(
            'clientCredentials', jsonb_build_object(
              'tokenUrl', 'https://api.aventa.com/oauth2/token',
              'scopes', (
                select coalesce(jsonb_object_agg(s, 'Grants ' || s), '{}'::jsonb)
                  from unnest(a.scopes) s
              )
            )
          )
        )
      )
    ),
    'security', jsonb_build_array(jsonb_build_object('oauth2', to_jsonb(a.scopes))),
    'paths', coalesce((
      select jsonb_object_agg(e.path, e.ops)
        from (
          select path, jsonb_object_agg(lower(method), jsonb_build_object(
            'summary', summary,
            'description', coalesce(description, summary),
            'operationId', lower(method) || replace(initcap(replace(replace(path, '/', ' '), '-', ' ')), ' ', ''),
            'security', jsonb_build_array(jsonb_build_object('oauth2', jsonb_build_array(scope))),
            'x-scope', scope,
            'requestBody', case when request_example is null then null else jsonb_build_object(
              'required', true,
              'content', jsonb_build_object('application/json', jsonb_build_object('example', request_example))
            ) end,
            'responses', jsonb_build_object(
              case when method = 'POST' then '201' else '200' end,
              jsonb_build_object(
                'description', 'Success',
                'content', jsonb_build_object('application/json', jsonb_build_object('example', response_example))
              ),
              '401', jsonb_build_object('description', 'The token is missing, expired or was issued to a revoked credential'),
              '403', jsonb_build_object('description', 'The token is valid but does not carry ' || scope)
            )
          )) as ops
            from api_endpoints where version_id = v.id
           group by path
        ) e
    ), '{}'::jsonb)
  )
  from api_versions v join operator_apis a on a.id = v.api_id
 where v.id = p_version_id;
$fn$;

grant execute on function api_spec(text) to anon, authenticated;

/* ---- What is published today --------------------------------------------- */

/* Each API's current version, from the string it already carried. TM Forum path
   convention: /tmf-api/{resource}/v{major}. */
insert into api_versions (id, api_id, version, lifecycle, base_path, released_on, sort_order)
select a.id || '@' || a.version, a.id, a.version, 'current',
       '/tmf-api/' || lower(replace(a.name, ' ', '')) || '/v' || split_part(a.version, '.', 1),
       date '2024-06-01' + (a.sort_order * interval '45 days'),
       a.sort_order
  from operator_apis a
on conflict (api_id, version) do nothing;

/* One superseded version, so "deprecated" is a state the screen has to render
   rather than one it merely allows. Catalogue 2.0 is what Kestrel Devices
   integrated against before the price-book change. */
insert into api_versions (id, api_id, version, lifecycle, base_path, released_on,
                          deprecated_on, sunset_on, migration_note, sort_order)
values ('AP-CAT@2.0', 'AP-CAT', '2.0', 'deprecated', '/tmf-api/catalogue/v2', '2024-02-12',
        '2026-03-01', '2026-12-31',
        'v2.1 replaces the single `price` field with `prices[]`, one entry per market and currency. '
        || 'A v2.0 caller reading `price` gets the seller''s home-market price and will misquote every other market. '
        || 'Move to v2.1 and read the entry whose `market` matches the order.', 0)
on conflict (api_id, version) do nothing;

commit;
