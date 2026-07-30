-- What was actually submitted at each onboarding gate.
--
-- Three problems, one migration.
--
-- 1. Only three partners had gate rows at all, and every one of them
--    contradicted its own status. Nimbus Sensors has been live since September
--    2024 and shipped three SKUs, and the console showed it stuck at "Bank &
--    tax, awaiting bank verification". Meanwhile the three sellers who really
--    are mid-application — Northwind, Lumen, Orbital — had no gate rows, so the
--    onboarding queue could not show the only applications in flight.
--
--    The rule the prototype states and this migration adopts: a partner with no
--    live application came through long ago, so every gate is history. Only a
--    seller still applying has a current gate.
--
-- 2. A gate was a coloured dot. `evidence` held two or three loose strings and
--    there was nowhere to record what the seller typed or attached, so an
--    operator "reviewing" a gate was deciding on a status word. A submission
--    and its documents make it a decision on evidence.
--
-- 3. `evidence` on the gate row was being used for both questions at once —
--    what the gate demands, and what arrived. Those are different: the gap
--    between them is the review. `evidence` now holds only the demand, which is
--    the same for every partner, and the submission holds what arrived.
--
-- Gate owners, targets and dual-control flags are also corrected here to the
-- prototype's policy ladder. The targets sum to exactly the five working days
-- the marketplace publishes — a ladder that sums to more than the SLA is a
-- promise the process cannot keep.

/* -------------------------------------------------------------- schema ---- */

create table if not exists onboarding_submissions (
  /* One submission per gate, so the gate id is the key. A second submission on
     the same gate would be a resubmission, which in this process is a new
     application — the gate is not reopened. */
  gate_id    text primary key references onboarding_gates(id) on delete cascade,
  partner_id text not null references partners(id) on delete cascade,
  gate_key   text not null,
  decision   text not null,
  note       text,
  /* [[label, value], …] in the order the form asked. Held as JSON because it is
     only ever read whole, and because the labels differ per gate — a column per
     field would be seven tables and a hundred mostly-null columns. */
  fields     jsonb not null default '[]'::jsonb
);

create table if not exists onboarding_documents (
  id          text primary key,
  gate_id     text not null references onboarding_gates(id) on delete cascade,
  partner_id  text not null references partners(id) on delete cascade,
  name        text not null,
  kind        text not null,
  size        text not null,
  uploaded_by text,
  uploaded_at timestamptz,
  sort_order  integer not null default 0
);

create index if not exists onboarding_documents_gate_idx on onboarding_documents(gate_id);

alter table onboarding_submissions enable row level security;
alter table onboarding_documents   enable row level security;

drop policy if exists "operator_all_onboarding_submissions" on onboarding_submissions;
drop policy if exists "partner_read_onboarding_submissions" on onboarding_submissions;
drop policy if exists "operator_all_onboarding_documents"   on onboarding_documents;
drop policy if exists "partner_read_onboarding_documents"   on onboarding_documents;

create policy "operator_all_onboarding_submissions" on onboarding_submissions
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "operator_all_onboarding_documents" on onboarding_documents
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A seller reads their own submissions and nobody else's. Held here rather than
   only in the operator console because a seller who cannot see what we hold
   about them cannot correct it and cannot answer their own auditor. Read only:
   the record of what was submitted is not editable by the party that submitted
   it, or it stops being evidence. */
create policy "partner_read_onboarding_submissions" on onboarding_submissions
  for select to authenticated using (partner_id = current_partner_id());
create policy "partner_read_onboarding_documents" on onboarding_documents
  for select to authenticated using (partner_id = current_partner_id());

/* ---------------------------------------------------------- regenerate ---- */

-- Regenerated rather than patched: the three existing partners' rows disagree
-- with their own status, and the ids are deterministic (og-<partner>-<gate>),
-- so a partial update would leave the old ids orphaned beside the new ones.
delete from onboarding_gates;

insert into onboarding_gates (
  id, partner_id, gate_name, gate_order, status, owner, target_days,
  dual_control, waivable, submitted_by, submitted_at, reviewed_by, reviewed_at,
  evidence, notes, sort_order
)
with gate(key, name, ord, owner, target_days, dual, waivable, day_offset, reviewer, evidence) as (values
  -- The gates that are a decision on evidence already supplied clear the same
  -- day; only the ones that need somebody to do work carry a day of their own.
  -- `took` is how long the gate actually ran, which is not automatically its
  -- target. Every gate here decides inside its target except Bank & tax, which
  -- runs a day over on purpose: micro-deposit verification plus chasing a tax
  -- certificate is the longest step in this process, and a funnel where nothing
  -- ever overruns cannot show anybody where it stalls.
  ('apply',  'Application',         1, 'Marketplace onboarding desk', 0, false, true,   0, 'Lena Fischer',
   array['Registered company name','Trading address','Marketplaces applied for','Expected monthly volume']),
  ('kyc',    'KYC & due diligence', 2, 'Risk and compliance',         2, true,  false,  2, 'Ruben Oyelaran',
   array['Certificate of incorporation','Beneficial ownership over 25%','Sanctions and PEP screening','Adverse media check']),
  ('agree',  'Agreements',          3, 'Legal',                       1, true,  false,  5, 'Ruben Oyelaran',
   array['Marketplace terms, e-signed','Data processing agreement','Commission schedule acknowledged']),
  ('finance','Bank & tax',          4, 'Finance',                     1, true,  true,   7, 'Ruben Oyelaran',
   array['Settlement bank account','Bank verification (penny test)','Tax residency certificate','Withholding declaration']),
  -- Dual control buys nothing on a gate whose checks are machine-recorded, and
  -- it is not waivable for the same reason: there is nobody to waive it to.
  ('tech',   'Technical readiness', 5, 'Platform engineering',        1, false, false, 10, 'Tomas Novak',
   array['Catalogue feed or portal upload','Fulfilment webhook reachable','One successful sandbox order']),
  ('assure', 'Compliance review',   6, 'Risk and compliance',         0, true,  true,  13, 'Ana Sousa',
   array['Security questionnaire','Content policy acknowledgement','Sample listing audit']),
  ('golive', 'Go-live',             7, 'Marketplace onboarding desk', 0, false, true,  16, 'Lena Fischer',
   array['Storefront enabled','At least one listing published'])
),
-- The only three sellers with an application still running. Everybody else came
-- through long ago and every gate below is history.
inflight(partner_id, started, key, status) as (values
  ('PTR-1012', date '2026-07-08', 'apply',  'cleared'),
  ('PTR-1012', date '2026-07-08', 'kyc',    'cleared'),
  ('PTR-1012', date '2026-07-08', 'agree',  'cleared'),
  ('PTR-1012', date '2026-07-08', 'finance','current'),
  ('PTR-1012', date '2026-07-08', 'tech',   'pending'),
  ('PTR-1012', date '2026-07-08', 'assure', 'pending'),
  ('PTR-1012', date '2026-07-08', 'golive', 'pending'),
  ('PTR-1013', date '2026-07-16', 'apply',  'cleared'),
  ('PTR-1013', date '2026-07-16', 'kyc',    'cleared'),
  ('PTR-1013', date '2026-07-16', 'agree',  'current'),
  ('PTR-1013', date '2026-07-16', 'finance','pending'),
  ('PTR-1013', date '2026-07-16', 'tech',   'pending'),
  ('PTR-1013', date '2026-07-16', 'assure', 'pending'),
  ('PTR-1013', date '2026-07-16', 'golive', 'pending'),
  ('PTR-1014', date '2026-06-21', 'apply',  'cleared'),
  -- A failed gate stops the application. It is not a rejection of the company:
  -- they may reapply with corrected documents, which starts a new application.
  ('PTR-1014', date '2026-06-21', 'kyc',    'failed'),
  ('PTR-1014', date '2026-06-21', 'agree',  'pending'),
  ('PTR-1014', date '2026-06-21', 'finance','pending'),
  ('PTR-1014', date '2026-06-21', 'tech',   'pending'),
  ('PTR-1014', date '2026-06-21', 'assure', 'pending'),
  ('PTR-1014', date '2026-06-21', 'golive', 'pending')
),
row_state as (
  select
    p.id                                                as partner_id,
    p.contact,
    g.*,
    coalesce(f.status, 'cleared')                       as status,
    /* A historical journey is dated backwards from the day the seller went
       live, so the go-live gate *clears* exactly on `joined` rather than a day
       after the date the partner record shows. A CASE rather than coalesce: an
       in-flight seller has `joined` = '—', and coalesce would still evaluate
       to_date on it and fail the whole migration. */
    case when f.started is not null then f.started
         else to_date(p.joined, 'DD Mon YYYY') - 16 end as base
  from partners p
  cross join gate g
  left join inflight f on f.partner_id = p.id and f.key = g.key
  where p.joined <> '—' or f.partner_id is not null
)
select
  'og-' || partner_id || '-' || key,
  partner_id,
  name,
  ord,
  status,
  owner,
  target_days,
  dual,
  waivable,
  case when status = 'pending' then null else contact end,
  case when status = 'pending' then null else (base + day_offset)::timestamptz end,
  case when status in ('cleared','failed') then reviewer end,
  case when status in ('cleared','failed')
       then (base + day_offset + target_days + case when key = 'finance' then 1 else 0 end)::timestamptz end,
  evidence,
  case status
    when 'cleared' then 'Cleared on the evidence submitted.'
    when 'current' then 'Submitted and under review by ' || owner || '.'
    when 'failed'  then 'Beneficial ownership could not be verified against the ' ||
                        'register. The application is stopped.'
    else 'Not reached. This gate opens when the one before it clears.'
  end,
  -- Globally ordered rather than 1..7 per partner, so a caller that reads the
  -- whole table without grouping gets each seller's gates together and in
  -- order, rather than fifteen journeys interleaved gate by gate.
  row_number() over (order by partner_id, ord)
from row_state;

/* ------------------------------------------------- what arrived at each --- */

-- Reference data the submissions read: the bank a seller in each country
-- settles through, and the city its registered office sits in. Both are needed
-- because "Settlement bank: a bank" and "Trading address: somewhere" are not
-- evidence of anything.
insert into onboarding_submissions (gate_id, partner_id, gate_key, decision, note, fields)
with country_ref(country, bank, city) as (values
  ('India','HDFC Bank','Bengaluru'),          ('UAE','Emirates NBD','Dubai'),
  ('Kenya','Equity Bank','Nairobi'),          ('Singapore','DBS Bank','Singapore'),
  ('Germany','Deutsche Bank','Munich'),       ('Poland','PKO Bank Polski','Kraków'),
  ('Brazil','Itaú Unibanco','São Paulo'),     ('Vietnam','Techcombank','Ho Chi Minh City'),
  ('Sweden','SEB','Stockholm'),               ('Taiwan','CTBC Bank','Taipei'),
  ('UK','Barclays','London'),                 ('Israel','Bank Leumi','Tel Aviv')
)
select
  og.id,
  og.partner_id,
  gk.key,
  case og.status when 'cleared' then 'Cleared' when 'failed' then 'Failed' else 'Under review' end,
  case when og.status = 'failed'
       then 'Two of the declared beneficial owners could not be matched against the ' ||
            p.country || ' register, and one holding traces to a jurisdiction on the ' ||
            'enhanced-diligence list. Screening was stopped rather than cleared.' end,
  case gk.key
    when 'apply' then jsonb_build_array(
      jsonb_build_array('Registered company name', p.name || case when p.country = 'India' then ' Private Limited' else ' Ltd' end),
      jsonb_build_array('Trading name', p.name),
      jsonb_build_array('Trading address', 'Registered office, ' || coalesce(r.city, p.country) || ', ' || p.country),
      jsonb_build_array('Country of registration', p.country),
      jsonb_build_array('Company registration number', 'REG-' || substr(p.id, 5) || '-' || case when p.country = 'India' then 'KA' else 'XX' end),
      jsonb_build_array('Business type', p.type),
      jsonb_build_array('Marketplaces applied for', cats.names),
      jsonb_build_array('Expected monthly volume', '$' || (40 + (ascii(substr(p.id, 8, 1)) % 6) * 10) || ',000'),
      jsonb_build_array('Primary contact', p.contact),
      jsonb_build_array('Contact email', p.email))
    when 'kyc' then jsonb_build_array(
      jsonb_build_array('Legal entity verified against', p.country || ' company register'),
      jsonb_build_array('Beneficial owners over 25%', p.contact || ' (54%), institutional holding (31%)'),
      jsonb_build_array('Sanctions screening', case og.status
        when 'failed' then 'One possible match — under manual review'
        when 'current' then 'Running — OFAC, EU, UN, HMT'
        else 'No match — OFAC, EU, UN, HMT' end),
      jsonb_build_array('PEP screening', case when og.status = 'current' then 'Running' else 'No match' end),
      jsonb_build_array('Adverse media', case og.status
        when 'failed' then 'Two articles found — under review'
        when 'current' then 'Not started — runs after the sanctions screen returns'
        else 'Nothing material found' end),
      jsonb_build_array('Screening provider', 'ComplyAdvantage'),
      jsonb_build_array('Refreshed every', '90 days'))
    when 'agree' then jsonb_build_array(
      jsonb_build_array('Marketplace terms', case when og.status = 'current' then 'Version 4.2 — sent for signature' else 'Version 4.2, e-signed' end),
      jsonb_build_array('Signed by', case when og.status = 'current' then 'Not yet signed' else p.contact end),
      jsonb_build_array('Data processing agreement', case when og.status = 'current' then 'Sent — awaiting signature' else 'Signed — standard contractual clauses' end),
      jsonb_build_array('Sub-processors declared', case when p.type = 'Content provider' then 'Two — CDN and payment tokenisation' else 'One — cloud hosting' end),
      jsonb_build_array('Commission schedule', coalesce(cp.name, 'Not yet assigned') ||
        case when og.status = 'current' then ' — proposed, not counter-signed' else '' end),
      jsonb_build_array('Governing law', 'Singapore'),
      jsonb_build_array('Notice period', '30 days either side'))
    when 'finance' then jsonb_build_array(
      jsonb_build_array('Settlement bank', coalesce(r.bank, 'Not supplied')),
      jsonb_build_array('Account holder', p.name),
      /* The full number exists on the settlement record because the platform
         has to pay somebody. Nothing on a screen prints it. */
      jsonb_build_array('Account (masked)', '•••• ' || (1000 + (substr(p.id, 5)::int * 37) % 8999)),
      jsonb_build_array('Verification', case when og.status = 'current'
        then 'Two micro-deposits sent — the seller has not confirmed the amounts'
        else 'Micro-deposit matched' end),
      jsonb_build_array('Settlement currency', 'USD'),
      jsonb_build_array('Tax residency', p.country),
      jsonb_build_array('Treaty certificate', case
        when og.status = 'current' then 'Not yet supplied'
        when p.country in ('Brazil','Vietnam') then 'Not supplied — statutory withholding applies'
        else 'On file, valid to 31 Mar 2027' end),
      jsonb_build_array('Withholding', case
        when og.status = 'current' then 'Statutory rate until a certificate arrives'
        when p.country in ('Brazil','Vietnam') then '10%'
        else 'Nil under treaty' end))
    when 'tech' then jsonb_build_array(
      jsonb_build_array('Catalogue method', case when p.type = 'Content provider' then 'API feed, hourly' else 'Portal upload' end),
      jsonb_build_array('Fulfilment webhook', 'https://api.' || lower(split_part(p.name, ' ', 1)) || '.example/marketplace/fulfil'),
      jsonb_build_array('Webhook reachability', case when og.status = 'current' then 'Not tested yet' else 'Responds in 240 ms, TLS 1.3' end),
      jsonb_build_array('Events subscribed', 'order.created, order.cancelled, stock.update'),
      jsonb_build_array('Sandbox order', case when og.status = 'current' then 'Not run yet'
        else 'ORD-SBX-' || substr(p.id, 5) || ' — completed end to end' end),
      jsonb_build_array('Retry policy accepted', 'Yes — 3 attempts, exponential backoff'),
      jsonb_build_array('Integration contact', p.contact))
    when 'assure' then jsonb_build_array(
      jsonb_build_array('Security questionnaire', case when og.status = 'current' then 'Returned — under review' else 'Completed — 48 of 52 controls in place' end),
      jsonb_build_array('Gaps declared', 'No formal penetration test in the last 12 months'),
      jsonb_build_array('Content policy acknowledgement', 'Accepted'),
      jsonb_build_array('Sample listing audit', case when og.status = 'current' then 'Not started' else '3 listings reviewed, no issues' end),
      jsonb_build_array('Data residency', case when p.country = 'Germany' then 'EU only' else 'No restriction declared' end))
    else jsonb_build_array(
      jsonb_build_array('Storefront enabled', case when og.status = 'current' then 'Not yet' else 'Yes' end),
      jsonb_build_array('Categories opened', cats.names),
      jsonb_build_array('First listings published', coalesce(prod.n, 0)::text),
      jsonb_build_array('Go-live date', p.joined),
      jsonb_build_array('Assigned commission plan', coalesce(cp.name, 'Not assigned')))
  end
from onboarding_gates og
join partners p on p.id = og.partner_id
join (values ('Application','apply'), ('KYC & due diligence','kyc'), ('Agreements','agree'),
             ('Bank & tax','finance'), ('Technical readiness','tech'),
             ('Compliance review','assure'), ('Go-live','golive'))
  as gk(name, key) on gk.name = og.gate_name
left join commission_plans cp on cp.id = p.plan_id
left join country_ref r on r.country = p.country
left join lateral (
  select string_agg(c.name, ', ' order by c.sort_order) names
  from partner_categories pc join categories c on c.id = pc.category_id
  where pc.partner_id = p.id
) cats on true
left join lateral (
  select count(*) n from products where partner_id = p.id
) prod on true
-- Nothing is submitted at a gate the seller has not reached. An empty record
-- and no record must not look the same: the first says "they sent nothing",
-- the second says "it was not their turn yet".
where og.status <> 'pending'
on conflict (gate_id) do nothing;

/* --------------------------------------------------------- documents ----- */

insert into onboarding_documents (id, gate_id, partner_id, name, kind, size, uploaded_by, uploaded_at, sort_order)
select
  'doc-' || og.partner_id || '-' || gk.key || '-' || d.ord,
  og.id, og.partner_id, d.name, d.kind, d.size,
  case when d.owner = 'Marketplace' then og.reviewed_by else p.contact end,
  og.submitted_at,
  d.ord
from onboarding_gates og
join partners p on p.id = og.partner_id
join (values ('Application','apply'), ('KYC & due diligence','kyc'), ('Agreements','agree'),
             ('Bank & tax','finance'), ('Technical readiness','tech'),
             ('Compliance review','assure'), ('Go-live','golive'))
  as gk(name, key) on gk.name = og.gate_name
join (values
  ('apply',   1, 'Completed application form',            'PDF',  '0.2 MB', 'Partner'),
  ('kyc',     1, 'Certificate of incorporation',          'PDF',  '1.4 MB', 'Partner'),
  ('kyc',     2, 'Beneficial ownership declaration',      'PDF',  '0.3 MB', 'Partner'),
  ('kyc',     3, 'Director passport (redacted)',          'PDF',  '0.9 MB', 'Partner'),
  ('kyc',     4, 'Sanctions and PEP screening report',    'PDF',  '0.2 MB', 'Marketplace'),
  ('agree',   1, 'Marketplace terms — countersigned',     'PDF',  '2.1 MB', 'Partner'),
  ('agree',   2, 'Data processing agreement',             'PDF',  '0.7 MB', 'Partner'),
  ('agree',   3, 'Commission schedule — countersigned',   'PDF',  '0.4 MB', 'Marketplace'),
  ('finance', 1, 'Bank verification letter',              'PDF',  '0.5 MB', 'Partner'),
  ('finance', 2, 'Tax residency certificate',             'PDF',  '0.6 MB', 'Partner'),
  ('tech',    1, 'Sandbox order log',                     'TXT',  '0.1 MB', 'Marketplace'),
  ('tech',    2, 'Integration test report',               'PDF',  '0.3 MB', 'Marketplace'),
  ('assure',  1, 'Security questionnaire',                'XLSX', '0.8 MB', 'Partner'),
  ('assure',  2, 'ISO 27001 certificate',                 'PDF',  '1.1 MB', 'Partner'),
  ('assure',  3, 'Sample listing audit',                  'PDF',  '0.4 MB', 'Marketplace'),
  ('golive',  1, 'Go-live checklist — signed off',        'PDF',  '0.2 MB', 'Marketplace')
) as d(gate, ord, name, kind, size, owner) on d.gate = gk.key
where og.status <> 'pending'
  -- A seller with no treaty certificate has not attached one. Listing the
  -- document anyway would contradict the field two rows above it.
  and not (d.gate = 'finance' and d.ord = 2 and p.country in ('Brazil','Vietnam'))
  and not (d.gate = 'finance' and d.ord = 2 and og.status = 'current')
  -- A marketplace-produced document is the output of the review. On a gate
  -- still under review it does not exist yet, and showing it would tell the
  -- operator the work they are about to do is already done.
  and not (d.owner = 'Marketplace' and og.status <> 'cleared')
on conflict (id) do nothing;

/* ------------------------------------------------------------- tasks ----- */

-- Four task rows existed, and both partners holding them went live in 2024. An
-- onboarding desk shown "verify the settlement account — due in 3 days" against
-- a seller who has been trading for two years learns to ignore its own queue.
--
-- The ladder is the same for everybody, because the gate is the same for
-- everybody; only the state differs, and the state is not stored — it is
-- derived from the gate the task belongs to. A stored status would be a second
-- opinion that can contradict the gate it sits on.
delete from onboarding_tasks;

insert into onboarding_tasks (id, partner_id, gate_id, title, detail, owner, due, closed_by, closed_at)
select
  'OB-' || substr(g.partner_id, 5) || '-' || t.gate || '-' || t.key,
  g.partner_id,
  t.gate,
  t.title,
  t.detail,
  t.owner,
  case g.status
    when 'current' then case when t.days <= 1 then 'Today' else 'In ' || t.days || ' days' end
    /* The gate failed. One of these is the reason it failed and the rest never
       got their turn — none of them is a date anybody owes. */
    when 'failed'  then case when t.key in ('ubo','screen') then 'Overdue' end
  end,
  case when g.status = 'cleared'
       then case when t.owner = 'Marketplace' then g.reviewed_by else p.contact end end,
  case when g.status = 'cleared' then g.reviewed_at end
from onboarding_gates g
join partners p on p.id = g.partner_id
join (values ('Application','apply'), ('KYC & due diligence','kyc'), ('Agreements','agree'),
             ('Bank & tax','finance'), ('Technical readiness','tech'),
             ('Compliance review','assure'), ('Go-live','golive'))
  as gk(name, key) on gk.name = g.gate_name
join (values
  ('apply','form',    'Application form submitted', 'Company details, target marketplace categories and expected monthly volume.', 'Partner', 14),
  ('apply','contact', 'Primary contact confirmed', 'A named person who can sign, with a working address on the company domain.', 'Partner', 14),
  ('kyc','inc',       'Certificate of incorporation', 'Verified against the register in the country of registration.', 'Partner', 5),
  ('kyc','ubo',       'Beneficial ownership declaration', 'Everyone holding over 25%, with identification for each.', 'Partner', 5),
  ('kyc','screen',    'Sanctions and PEP screening', 'OFAC, EU, UN and HMT lists, plus adverse media.', 'Marketplace', 2),
  ('agree','terms',   'Marketplace terms e-signed', 'Version 4.2, signed by someone with authority to bind the company.', 'Partner', 5),
  ('agree','dpa',     'Data processing agreement', 'Standard contractual clauses, with sub-processors declared.', 'Partner', 5),
  ('agree','sched',   'Commission schedule counter-signed', 'The plan the seller will actually settle on, signed by both sides.', 'Marketplace', 3),
  ('finance','bank',  'Settlement bank account verified', 'Two micro-deposits are sent to the nominated account. The amounts have to be confirmed before any money moves in the other direction.', 'Partner', 3),
  ('finance','tax',   'Tax residency certificate', 'A valid certificate applies the treaty withholding rate. Without one, the statutory rate is withheld at source.', 'Partner', 3),
  ('tech','feed',     'Catalogue method agreed', 'API feed or portal upload, with the update frequency stated.', 'Partner', 5),
  ('tech','hook',     'Fulfilment webhook reachable', 'Responds to a signed test call over TLS inside the timeout.', 'Partner', 5),
  ('tech','sbx',      'Sandbox order completed end to end', 'One order placed, fulfilled and settled in sandbox before anything is sold for real.', 'Partner', 5),
  ('assure','sec',    'Security questionnaire', '52-question baseline covering data handling, retention and sub-processors.', 'Partner', 8),
  ('assure','policy', 'Content and listing policy acknowledged', 'Including the category rules that apply to what they intend to sell.', 'Partner', 8),
  ('assure','audit',  'Sample listing audit', 'Three listings reviewed against the policy before the storefront opens.', 'Marketplace', 4),
  ('golive','store',  'Storefront enabled', 'The seller becomes visible to buyers in the categories they were approved for.', 'Marketplace', 1),
  ('golive','first',  'First listings published', 'At least one live listing, so the storefront is not an empty shop.', 'Partner', 2)
) as t(gate, key, title, detail, owner, days) on t.gate = gk.key;

/* --------------------------------------------------------- assertions ---- */

do $$
declare bad integer;
begin
  -- Exactly one current gate per seller still applying, and none for anybody else.
  select count(*) into bad from (
    select p.id, p.status,
           count(*) filter (where g.status = 'current') cur,
           count(*) filter (where g.status = 'failed')  fail
    from partners p join onboarding_gates g on g.partner_id = p.id
    group by p.id, p.status
  ) t
  where (t.status in ('live','suspended') and (t.cur > 0 or t.fail > 0))
     or (t.status = 'onboarding' and t.cur <> 1)
     or (t.status = 'review'     and t.cur <> 1)
     or (t.status = 'rejected'   and t.fail <> 1);
  if bad > 0 then
    raise exception 'gate state contradicts partner status for % partner(s)', bad;
  end if;

  -- Every gate that has been reached has a submission, and no gate that has not.
  select count(*) into bad
  from onboarding_gates g full outer join onboarding_submissions s on s.gate_id = g.id
  where (g.status <> 'pending') <> (s.gate_id is not null);
  if bad > 0 then
    raise exception '% gate(s) disagree with their submission record', bad;
  end if;

  -- The published SLA is five working days. If the ladder no longer sums to it,
  -- one of the two is wrong and the screen would print the wrong promise.
  select sum(target_days) into bad from onboarding_gates where partner_id = 'PTR-1004';
  if bad <> 5 then
    raise exception 'the gate targets sum to % working days, not the published 5', bad;
  end if;

  -- A gate must never be recorded as taking a day it was not allowed to take
  -- unless that overrun is deliberate. Without this the rail painted three
  -- same-day gates red on every seller — a stall the data had invented.
  select count(*) into bad
  from onboarding_gates
  where reviewed_at is not null and submitted_at is not null
    and (reviewed_at::date - submitted_at::date) > target_days
    and gate_name <> 'Bank & tax';
  if bad > 0 then
    raise exception '% gate(s) are seeded as overrunning a target they were not meant to overrun', bad;
  end if;

  -- …and the one deliberate overrun is actually there, or the funnel's claim
  -- that Bank & tax is the longest gate is not supported by anything.
  select count(*) into bad
  from onboarding_gates
  where gate_name = 'Bank & tax' and reviewed_at is not null
    and (reviewed_at::date - submitted_at::date) <= target_days;
  if bad > 0 then
    raise exception 'Bank & tax decided inside target on % seller(s), so nothing shows where onboarding stalls', bad;
  end if;

  -- No task may be open against a seller who has no application in flight.
  select count(*) into bad
  from onboarding_tasks t
  join onboarding_gates g on g.partner_id = t.partner_id
  join (values ('Application','apply'), ('KYC & due diligence','kyc'), ('Agreements','agree'),
               ('Bank & tax','finance'), ('Technical readiness','tech'),
               ('Compliance review','assure'), ('Go-live','golive')) as gk(name, key)
    on gk.name = g.gate_name and gk.key = t.gate_id
  where g.status = 'cleared' and t.closed_at is null;
  if bad > 0 then
    raise exception '% task(s) are still open on a gate that has cleared', bad;
  end if;
end $$;
