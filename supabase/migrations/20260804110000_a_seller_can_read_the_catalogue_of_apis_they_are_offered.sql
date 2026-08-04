/*
  # A seller can read the catalogue of APIs they are offered

  `operator_apis` is the marketplace's published API catalogue — names, versions,
  scopes, which environments each runs in. Its only policy grants the operator
  everything and nobody else anything, so a seller reading their own API access
  gets their subscription rows and no way to turn `AP-CAT` into "Catalogue". The
  console listed the identifiers.

  Nothing in that table is confidential: it is documentation of what the
  marketplace offers, and the seller is who it is offered to. `subscriber_count`
  is the one figure that is anybody else's business, and it is a count with no
  names behind it.

  Also here: Nimbus Sensors held a *production* Catalogue subscription while
  every one of their endpoints is on sandbox and their own dashboard says they
  are stuck at the technical gate. Production API access is what clearing that
  gate grants. One seller cannot be on both sides of it.
*/

create policy auth_read_operator_apis on operator_apis
  for select to authenticated
  using (true);

update operator_api_subscriptions
   set environment = 'sandbox'
 where partner_id = 'PTR-1004' and environment = 'production';

do $$
declare
  n integer;
begin
  select count(*) into n from operator_api_subscriptions
   where partner_id = 'PTR-1004' and environment <> 'sandbox';
  if n > 0 then
    raise exception 'The demo seller has % production API subscriptions and no production endpoint', n;
  end if;

  /* A subscription may only name an environment its API actually runs in. */
  select count(*) into n
    from operator_api_subscriptions s
    join operator_apis a on a.id = s.api_id
   where not (s.environment = any(a.environments));
  if n > 0 then
    raise exception '% subscriptions name an environment their API does not run in', n;
  end if;

  select count(*) into n from pg_policies
   where tablename = 'operator_apis' and policyname = 'auth_read_operator_apis';
  if n <> 1 then
    raise exception 'Sellers still cannot read the API catalogue';
  end if;
end $$;
