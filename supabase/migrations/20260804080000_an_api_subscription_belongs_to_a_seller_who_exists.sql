/*
  # An API subscription belongs to a seller who exists

  `operator_api_subscriptions` names its consumers in free text: "TechDyne
  Devices", "Nimbus IoT Solutions", "Sentinel Cyber Systems", "CloudSync Labs".
  Not one of those is a row in `partners`. Two are near-misses of a real seller's
  name and two are nobody at all, so the operator's developer portal reports API
  traffic for four companies the marketplace has never onboarded, and a seller
  signing in cannot be shown their own API access because nothing joins it to
  them.

  The seller's Integrations screen needs that join — its "API keys" button has
  been a toast because there was nothing behind it to open.

  1. `partner_id` on the subscription
     A text reference to `partners`, not a name match. Matching on names is what
     produced the drift: "Sentinel Cyber Systems" and "Sentinel Cyber" are the
     same company to a reader and two companies to a query.

  2. Reconciling the four names
     - TechDyne Devices      → Kestrel Devices    (PTR-1002) — the device seller
     - Nimbus IoT Solutions  → Nimbus Sensors     (PTR-1004) — the IoT seller
     - Sentinel Cyber Systems→ Sentinel Cyber     (PTR-1003) — the security seller
     - CloudSync Labs        → ClearVault Cloud   (PTR-1010) — the other security seller
     Each keeps its volume, environment, scopes and start date: those are facts
     about the traffic, and the only thing wrong with them was whose traffic
     they were said to be.

  3. Security
     A seller may read their own subscriptions and nobody else's. They may not
     write them — an API grant is the operator's decision, and a consumer who
     can widen their own scopes has no scopes.
*/

alter table operator_api_subscriptions
  add column if not exists partner_id text references partners(id) on delete cascade;

update operator_api_subscriptions set partner_id = 'PTR-1002', consumer_name = 'Kestrel Devices'  where consumer_name = 'TechDyne Devices';
update operator_api_subscriptions set partner_id = 'PTR-1004', consumer_name = 'Nimbus Sensors'   where consumer_name = 'Nimbus IoT Solutions';
update operator_api_subscriptions set partner_id = 'PTR-1003', consumer_name = 'Sentinel Cyber'   where consumer_name = 'Sentinel Cyber Systems';
update operator_api_subscriptions set partner_id = 'PTR-1010', consumer_name = 'ClearVault Cloud' where consumer_name = 'CloudSync Labs';

/* Nimbus is the demo seller and held two subscriptions, both read-heavy. The
   Integrations screen tells them their scopes include settlement:read — which
   was a hard-coded string on the page and true of nobody. It is true now. */
insert into operator_api_subscriptions (id, api_id, partner_id, consumer_name, version, environment, scopes, volume, started_at, status, sort_order) values
  ('sub-011', 'AP-SET', 'PTR-1004', 'Nimbus Sensors', '1.2', 'sandbox',    array['settlement:read'],                     310,  '2026-07-20', 'active', 11),
  ('sub-012', 'AP-EVT', 'PTR-1004', 'Nimbus Sensors', '1.1', 'sandbox',    array['events:read','events:write'],          180,  '2026-07-20', 'active', 12),
  ('sub-013', 'AP-INV', 'PTR-1004', 'Nimbus Sensors', '1.0', 'sandbox',    array['inventory:read'],                      95,   '2026-07-28', 'active', 13),
  ('sub-014', 'AP-ORD', 'PTR-1008', 'Volta Routers',  '1.3', 'production', array['orders:read','orders:write'],          2100, '2026-06-30', 'active', 14),
  ('sub-015', 'AP-CAT', 'PTR-1001', 'StreamNova Media','2.1','production', array['catalogue:read','catalogue:write'],    4700, '2026-05-18', 'active', 15),
  ('sub-016', 'AP-SUB', 'PTR-1001', 'StreamNova Media','1.1','production', array['subscriptions:read','subscriptions:write'], 6100, '2026-05-18', 'active', 16)
on conflict (id) do nothing;

/* `subscriber_count` on the API is a rollup that nothing has recomputed since
   the rows were seeded. A count kept by hand beside the rows it counts drifts
   the first time anybody inserts. */
update operator_apis a
   set subscriber_count = (select count(*) from operator_api_subscriptions s
                            where s.api_id = a.id and s.status = 'active');

create policy partner_read_own_api_subscriptions on operator_api_subscriptions
  for select to authenticated
  using (partner_id = current_partner_id());

do $$
declare
  n integer;
begin
  select count(*) into n from operator_api_subscriptions where partner_id is null;
  if n > 0 then
    raise exception '% API subscriptions belong to nobody', n;
  end if;

  select count(*) into n
    from operator_api_subscriptions s
    join partners p on p.id = s.partner_id
   where s.consumer_name <> p.name;
  if n > 0 then
    raise exception '% subscriptions name a company other than the seller they belong to', n;
  end if;

  select count(*) into n from operator_api_subscriptions where partner_id = 'PTR-1004';
  if n < 3 then
    raise exception 'The demo seller holds % API subscriptions, and their console lists more than that', n;
  end if;

  select count(*) into n
    from operator_apis a
   where a.subscriber_count <> (select count(*) from operator_api_subscriptions s
                                 where s.api_id = a.id and s.status = 'active');
  if n > 0 then
    raise exception '% APIs report a subscriber count that disagrees with their subscriptions', n;
  end if;
end $$;
