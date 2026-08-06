/* What a developer would have had to guess.
 *
 * The endpoints behind the seven published APIs, with the scope each one needs
 * and a worked request and response for every call. These rows are the whole
 * reference: `api_spec()` builds the OpenAPI document out of them, so the page
 * a developer reads and the file they download are the same facts.
 *
 * The examples are real shapes from this marketplace rather than `"string"` and
 * `0`. A price carries its currency and its market because that is the thing
 * this catalogue got wrong twice; an order carries the tax-inclusive total
 * because that is what the shelf price means here. An example that does not
 * show the awkward part of a model is an example that lets somebody build the
 * wrong thing and find out in production.
 */

begin;

insert into api_endpoints (id, version_id, method, path, summary, description, scope, request_example, response_example, sort_order) values

/* ---------------------------------------------------------- Catalogue 2.1 -- */
('EP-CAT-1', 'AP-CAT@2.1', 'GET', '/productOffering',
 'List your listings',
 'Every listing you sell, across every market you are approved for. Filter with ?market=KE or ?status=live.',
 'catalogue:read', null,
 '{"totalCount":2,"items":[{"id":"SKU-3003","name":"PlayForge Cloud Gaming","status":"live","model":"monthly","category":"content","markets":["IN","AE","KE"],"prices":[{"market":"IN","currency":"INR","amount":849.00,"includesTax":true},{"market":"KE","currency":"KES","amount":1299.00,"includesTax":true}]}]}'::jsonb, 1),

('EP-CAT-2', 'AP-CAT@2.1', 'GET', '/productOffering/{id}',
 'Read one listing',
 'The full record including specifications, media and the price book entry for every market.',
 'catalogue:read', null,
 '{"id":"SKU-3003","name":"PlayForge Cloud Gaming","description":"Over 400 titles streamed to phone, tablet or TV.","status":"live","prices":[{"market":"KE","currency":"KES","amount":1299.00,"includesTax":true,"taxRate":16}],"specs":{"titles":"400+","devices":"Phone, tablet, TV"}}'::jsonb, 2),

('EP-CAT-3', 'AP-CAT@2.1', 'POST', '/productOffering',
 'Submit a new listing for review',
 'Creates the listing in `pending`. It does not go live until the marketplace approves it — poll the id or subscribe to the catalogue.approved event.',
 'catalogue:write',
 '{"name":"PlayForge Retro Pack","description":"Ninety arcade titles, streamed.","category":"content","model":"monthly","prices":[{"market":"KE","currency":"KES","amount":499.00,"includesTax":true}]}'::jsonb,
 '{"id":"SKU-3011","status":"pending","submittedAt":"2026-08-06T11:20:00Z","reviewTarget":"2026-08-08T11:20:00Z"}'::jsonb, 3),

('EP-CAT-4', 'AP-CAT@2.1', 'PATCH', '/productOffering/{id}',
 'Change a listing',
 'A price change inside your agreed band applies immediately. Anything outside it, or a change to what the product is, returns the listing to review.',
 'catalogue:write',
 '{"prices":[{"market":"KE","currency":"KES","amount":1399.00,"includesTax":true}]}'::jsonb,
 '{"id":"SKU-3003","status":"live","appliedAt":"2026-08-06T11:22:00Z","review":"not required — inside your band"}'::jsonb, 4),

/* ---------------------------------------------------------- Catalogue 2.0 -- */
('EP-CAT-OLD-1', 'AP-CAT@2.0', 'GET', '/productOffering',
 'List your listings',
 'Deprecated. Returns a single `price` in the seller''s home market currency, which misquotes every other market. Use v2.1 and read `prices[]`.',
 'catalogue:read', null,
 '{"totalCount":2,"items":[{"id":"SKU-3003","name":"PlayForge Cloud Gaming","status":"live","price":849.00,"currency":"INR"}]}'::jsonb, 1),

/* ------------------------------------------------------------- Orders 1.3 -- */
('EP-ORD-1', 'AP-ORD@1.3', 'GET', '/productOrder',
 'List orders placed with you',
 'Newest first. Filter with ?status=processing or ?since=2026-08-01.',
 'orders:read', null,
 '{"totalCount":1,"items":[{"id":"ORD-450111","placedAt":"2026-07-30T10:20:00Z","status":"processing","market":"KE","currency":"KES","subtotal":2757.76,"tax":441.24,"total":3199.00,"taxInclusive":true,"buyer":{"reference":"CUS-450031","market":"KE"},"items":[{"sku":"SKU-3004","name":"PlayForge Season Pass","quantity":1,"price":3199.00}]}]}'::jsonb, 1),

('EP-ORD-2', 'AP-ORD@1.3', 'GET', '/productOrder/{id}',
 'Read one order',
 'Includes the fulfilment state of every line and the payment reference.',
 'orders:read', null,
 '{"id":"ORD-450111","status":"processing","total":3199.00,"currency":"KES","paymentMethod":"mobile_money","paymentReference":"PAY-260730-3F1A","items":[{"sku":"SKU-3004","status":"pending","fulfil":"digital"}]}'::jsonb, 2),

('EP-ORD-3', 'AP-ORD@1.3', 'PATCH', '/productOrder/{id}',
 'Move an order on',
 'Report fulfilment. The marketplace notifies the buyer; you do not send the email.',
 'orders:write',
 '{"status":"delivered","fulfilledAt":"2026-08-06T09:00:00Z","reference":"entitlement-88213"}'::jsonb,
 '{"id":"ORD-450111","status":"delivered","buyerNotified":true}'::jsonb, 3),

/* ------------------------------------------------------ Subscriptions 1.1 -- */
('EP-SUB-1', 'AP-SUB@1.1', 'GET', '/subscription',
 'List subscriptions to your products',
 'Active, paused and cancelled. The renewal date is the one the buyer is billed on.',
 'subscriptions:read', null,
 '{"totalCount":1,"items":[{"id":"SUB-KE-450103","sku":"SKU-3001","status":"active","cycle":"Monthly","price":1699.00,"currency":"KES","startedAt":"2024-07-22","nextRenewal":"2026-08-22"}]}'::jsonb, 1),

('EP-SUB-2', 'AP-SUB@1.1', 'POST', '/subscription/{id}/pause',
 'Pause a subscription',
 'Billing stops at the end of the paid period. A pause with no resume date is an indefinite one and the buyer is told so.',
 'subscriptions:write',
 '{"reason":"Buyer requested a break","resumeOn":"2026-11-01"}'::jsonb,
 '{"id":"SUB-KE-450103","status":"paused","billedUntil":"2026-08-22","resumesOn":"2026-11-01"}'::jsonb, 2),

('EP-SUB-3', 'AP-SUB@1.1', 'DELETE', '/subscription/{id}',
 'Cancel a subscription',
 'Ends at the end of the paid period, never mid-period — the buyer has paid for it.',
 'subscriptions:write', null,
 '{"id":"SUB-KE-450103","status":"cancelled","serviceEndsOn":"2026-08-22","refund":"none — the period was consumed"}'::jsonb, 3),

/* ---------------------------------------------------------- Inventory 1.0 -- */
('EP-INV-1', 'AP-INV@1.0', 'GET', '/stock',
 'Read your stock levels',
 'Physical products only. Digital and eSIM lines report as unlimited.',
 'inventory:read', null,
 '{"totalCount":1,"items":[{"sku":"SKU-4001","onHand":42,"reserved":6,"available":36,"warehouse":"BLR-1","countedAt":"2026-08-05T18:00:00Z"}]}'::jsonb, 1),

('EP-INV-2', 'AP-INV@1.0', 'PATCH', '/stock/{sku}',
 'Set a stock level',
 'Absolute, not a delta — a retry must not double-count. The marketplace hides a listing at zero rather than overselling it.',
 'inventory:write',
 '{"onHand":38,"countedAt":"2026-08-06T08:00:00Z"}'::jsonb,
 '{"sku":"SKU-4001","onHand":38,"available":32,"listingVisible":true}'::jsonb, 2),

/* --------------------------------------------------------- Settlement 1.2 -- */
('EP-SET-1', 'AP-SET@1.2', 'GET', '/settlement',
 'List your statements',
 'One per period. Gross is what buyers paid; net is what reaches your account after commission, fees and refunds.',
 'settlement:read', null,
 '{"totalCount":1,"items":[{"id":"ss-1002-202607","period":"Jul 2026","currency":"KES","gross":184220.00,"commission":20264.20,"fees":1100.00,"refunds":3699.00,"net":159156.80,"payoutCurrency":"KES","status":"paid","paidOn":"2026-08-05"}]}'::jsonb, 1),

('EP-SET-2', 'AP-SET@1.2', 'GET', '/settlement/{id}/lines',
 'Read the orders behind a statement',
 'Every line that made up the total, so you can reconcile against your own ledger rather than trusting ours.',
 'settlement:read', null,
 '{"statementId":"ss-1002-202607","totalCount":1,"items":[{"orderRef":"ORD-450109","sku":"SKU-4006","gross":35999.00,"commissionRate":11.0,"commission":3959.89,"net":32039.11,"occurredOn":"2026-04-11"}]}'::jsonb, 2),

/* -------------------------------------------------------------- Party 1.0 -- */
('EP-PTY-1', 'AP-PTY@1.0', 'GET', '/organization/{id}',
 'Read your own organisation record',
 'What the marketplace holds about you: registration, markets you are approved for, and your settlement bank.',
 'party:read', null,
 '{"id":"PTR-1005","name":"PlayForge Games","registeredIn":"IN","approvedMarkets":["IN","AE","KE"],"status":"live","tier":"Silver","plan":"CP-CONTENT-STD"}'::jsonb, 1),

('EP-PTY-2', 'AP-PTY@1.0', 'PATCH', '/organization/{id}',
 'Update your contact details',
 'Contacts and addresses only. Anything that changes who you legally are goes through onboarding with evidence.',
 'party:write',
 '{"contacts":[{"role":"technical","name":"Ravi Menon","email":"ravi@playforge.example"}]}'::jsonb,
 '{"id":"PTR-1005","updated":["contacts"],"reviewRequired":false}'::jsonb, 2),

/* -------------------------------------------- Event Subscriptions 1.1 ------ */
('EP-EVT-1', 'AP-EVT@1.1', 'GET', '/hub',
 'List your event subscriptions',
 'The endpoints we call when something happens, and whether each is currently receiving.',
 'events:read', null,
 '{"totalCount":1,"items":[{"id":"EP-1005-1","callback":"https://playforge.example/hooks/aventa","events":["order.created","order.cancelled","catalogue.approved"],"state":"active","lastDeliveredAt":"2026-08-06T09:41:00Z"}]}'::jsonb, 1),

('EP-EVT-2', 'AP-EVT@1.1', 'POST', '/hub',
 'Register a callback',
 'We POST the event to your URL and expect a 2xx within the timeout. Failures retry with backoff; a callback failing for 24 hours is suspended and you are told.',
 'events:write',
 '{"callback":"https://playforge.example/hooks/aventa","events":["order.created","order.cancelled"],"secret":"whsec_your_own_signing_secret"}'::jsonb,
 '{"id":"EP-1005-2","state":"active","signingScheme":"HMAC-SHA256 over the raw body, sent as Aventa-Signature"}'::jsonb, 2),

('EP-EVT-3', 'AP-EVT@1.1', 'DELETE', '/hub/{id}',
 'Stop receiving',
 'Deliveries stop at once. Events raised while you are unregistered are not replayed.',
 'events:write', null,
 '{"id":"EP-1005-2","state":"removed"}'::jsonb, 3)

on conflict (id) do nothing;

do $$
declare
  n int;
  bad text;
  spec jsonb;
begin
  /* Every current version has to have something to read. A published API with
     no endpoints is the state this migration exists to end. */
  select count(*), string_agg(v.id, ', ') into n, bad
    from api_versions v
   where v.lifecycle in ('current', 'deprecated')
     and not exists (select 1 from api_endpoints e where e.version_id = v.id);
  if n <> 0 then
    raise exception '% published version(s) still have no endpoints: %', n, bad;
  end if;

  /* Every endpoint's scope has to be one the API actually declares, or the
     reference tells a developer to ask for a scope no token will carry. */
  select count(*), string_agg(e.id || ' wants ' || e.scope, ', ') into n, bad
    from api_endpoints e
    join api_versions v on v.id = e.version_id
    join operator_apis a on a.id = v.api_id
   where not (e.scope = any(a.scopes));
  if n <> 0 then
    raise exception '% endpoint(s) need a scope their API does not publish: %', n, bad;
  end if;

  /* Every write endpoint shows what to send. A POST documented with only a
     response is a POST somebody has to guess at. */
  select count(*), string_agg(id, ', ') into n, bad
    from api_endpoints where method in ('POST', 'PATCH', 'PUT') and request_example is null;
  if n <> 0 then
    raise exception '% write endpoint(s) have no request example: %', n, bad;
  end if;

  /* And the generated document has to be a document. */
  select api_spec('AP-CAT@2.1') into spec;
  if spec is null or spec->>'openapi' is null then
    raise exception 'the catalogue spec did not generate';
  end if;
  if jsonb_typeof(spec->'paths') <> 'object' or spec->'paths' = '{}'::jsonb then
    raise exception 'the catalogue spec generated with no paths';
  end if;
  if spec->'components'->'securitySchemes'->'oauth2' is null then
    raise exception 'the spec does not say how to authenticate, which is the part nobody can guess';
  end if;

  raise notice 'specs: % versions, % endpoints', (select count(*) from api_versions), (select count(*) from api_endpoints);
end $$;

commit;
