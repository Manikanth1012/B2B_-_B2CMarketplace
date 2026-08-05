/*
  # The console knows its own categories and capabilities

  Creating a role asked the operator to type, from memory, into a box:

      Audit categories (comma-separated)   [                              ]
      Capabilities        Add capability...  [                    ] [Add]

  Nothing offered the values, nothing checked them, and nothing told you when
  you were wrong. "Setlement" makes a role scoped to a category that does not
  exist; `catalog` makes a capability nothing ever reads. Both save cleanly and
  both are permissions that quietly do nothing — which on an access-control
  screen is the worst possible failure, because the role *looks* granted.

  The values were always knowable. Thirteen categories and twenty-eight
  capabilities are already in use across the thirteen seeded roles. They were
  simply never written down anywhere the form could reach.

  ## The categories did not agree with themselves

  Worse than un-offered: there are two lists.

      on roles          Access Audit Billing Catalogue Compliance Configuration
                        Developer Portal Inventory Onboarding Promotions
                        Security Settlement Support

      on the audit log  Access Catalogue Developer Portal Merchandising
                        Onboarding Partners Settlement Support

  Six overlap. `Merchandising` and `Partners` are written by the audit log and
  no role can be scoped to them, so those entries are invisible to every
  reviewer whose access is category-scoped. Seven categories exist only on roles
  and match no entry at all.

  So a role scoped to "Promotions" sees nothing, and everything logged under
  "Merchandising" is seen by nobody but a full-access reviewer. Neither is
  visible from either screen, because each looks correct on its own.

  ## Two catalogues, and both lists read them

  `operator_audit_categories` and `operator_capabilities` hold what the console
  actually has, each with a label and a sentence saying what it covers — because
  a picker that lists `mor` without saying it means merchant of record is a
  picker you still have to go and look things up for.

  The union is taken rather than either list being cut. A category in use by the
  audit log is a category that exists, and one a role is scoped to is a promise
  already made to somebody; dropping either would silently change who can see
  what. `Merchandising` and `Partners` join the fifteen, and the seven
  role-only categories stay and are now selectable against future entries.
*/

create table if not exists operator_audit_categories (
  id text primary key,
  label text not null,
  covers text not null,
  sort_order integer not null default 0
);

create table if not exists operator_capabilities (
  id text primary key,
  label text not null,
  /* Which part of the console it governs, so twenty-eight rows read as eight
     short lists rather than one long one. */
  area text not null,
  /* What the holder can actually do. `mor` and `dunning` are the reason this
     column exists — nobody should have to guess. */
  covers text not null,
  /* Whether "scoped" means anything here. Some capabilities are all or
     nothing: there is no partial holding of the audit log. */
  scopable boolean not null default true,
  sort_order integer not null default 0
);

alter table operator_audit_categories enable row level security;
alter table operator_capabilities enable row level security;

/* Readable by anybody signed in: these are the labels on a form, not the
   permissions themselves. Written by nobody through the client — a new
   capability arrives with the code that reads it, in a migration. */
drop policy if exists read_audit_categories on operator_audit_categories;
create policy read_audit_categories on operator_audit_categories for select using (true);

drop policy if exists read_capabilities on operator_capabilities;
create policy read_capabilities on operator_capabilities for select using (true);

insert into operator_audit_categories (id, label, covers, sort_order) values
  ('Access',           'Access',           'Sign-ins, role assignments and session revocations.', 1),
  ('Audit',            'Audit',            'Reads and exports of the audit log itself.', 2),
  ('Billing',          'Billing',          'Invoices, credit notes and anything raised against a customer.', 3),
  ('Catalogue',        'Catalogue',        'Products, listings, prices and category changes.', 4),
  ('Compliance',       'Compliance',       'Evidence, attestations and regulatory holds.', 5),
  ('Configuration',    'Configuration',    'Markets, currencies, tax rates and platform settings.', 6),
  ('Developer Portal', 'Developer Portal', 'API keys, webhooks and sandbox activity.', 7),
  ('Inventory',        'Inventory',        'Stock levels, warehouses and fulfilment routing.', 8),
  ('Merchandising',    'Merchandising',    'Banners, collections and what the storefront promotes.', 9),
  ('Onboarding',       'Onboarding',       'Applications, gates and the decisions taken at each.', 10),
  ('Partners',         'Partners',         'Seller records, tiers, suspensions and reinstatements.', 11),
  ('Promotions',       'Promotions',       'Offers, vouchers and campaign scheduling.', 12),
  ('Security',         'Security',         'MFA, password policy and anything that looks like an incident.', 13),
  ('Settlement',       'Settlement',       'Statements, payouts, adjustments and the ledger behind them.', 14),
  ('Support',          'Support',          'Tickets, SLA breaches and knowledge base changes.', 15)
on conflict (id) do update set label = excluded.label, covers = excluded.covers,
  sort_order = excluded.sort_order;

insert into operator_capabilities (id, label, area, covers, scopable, sort_order) values
  ('dashboard',        'Dashboard',            'Marketplace',      'The operator home page and its rollups.', false, 1),
  ('reports',          'Reports',              'Marketplace',      'Exports and scheduled reporting.', true, 2),

  ('catalogue',        'Catalogue',            'Catalogue',        'Approving, editing and retiring products.', true, 10),
  ('listings',         'Seller listings',      'Catalogue',        'The review queue for what sellers submit.', true, 11),
  ('collections',      'Collections',          'Catalogue',        'Curated groupings shown on the storefront.', true, 12),
  ('inventory',        'Inventory',            'Catalogue',        'Stock levels and availability.', true, 13),
  ('warehouses',       'Warehouses',           'Catalogue',        'Fulfilment locations and routing rules.', true, 14),

  ('onboarding',       'Onboarding',           'Partners',         'Applications and the decision at each gate.', true, 20),
  ('compliance',       'Compliance',           'Partners',         'Evidence, document rules and regulatory holds.', true, 21),

  ('settlement',       'Settlement',           'Money',            'Statements, approvals and payout runs.', true, 30),
  ('billing',          'Billing',              'Money',            'Customer invoices, credits and disputes.', true, 31),
  ('ledger',           'Ledger',               'Money',            'The general ledger and period close.', false, 32),
  ('tax',              'Tax',                  'Money',            'Rates, registrations and the issuing entity per market.', true, 33),
  ('dunning',          'Dunning',              'Money',            'What happens, and when, to an unpaid bill.', true, 34),
  ('mor',              'Merchant of record',   'Money',            'Which entity contracts with the buyer in each market.', false, 35),

  ('promotions',       'Promotions',           'Merchandising',    'Offers, vouchers and campaign scheduling.', true, 40),
  ('banners',          'Banners',              'Merchandising',    'What the storefront and bills advertise.', true, 41),
  ('channels',         'Channels',             'Merchandising',    'Where the marketplace sells, and under whose brand.', true, 42),

  ('support',          'Support',              'Support',          'The ticket queue and SLA position.', true, 50),
  ('tickets',          'Ticket actions',       'Support',          'Replying, reassigning and closing a ticket.', true, 51),
  ('routing',          'Routing rules',        'Support',          'Which queue a ticket lands in, and who is paged.', true, 52),

  ('integrations',     'Integrations',         'Platform',         'Connected systems and their credentials.', true, 60),
  ('developer_portal', 'Developer portal',     'Platform',         'API keys, webhooks and sandbox access.', true, 61),

  ('access',           'Access',               'Access & security','Who holds which role.', true, 70),
  ('roles',            'Roles',                'Access & security','Creating and changing roles themselves.', false, 71),
  ('security',         'Security',             'Access & security','MFA policy, password rules and incidents.', false, 72),
  ('sessions',         'Sessions',             'Access & security','Viewing and revoking active sessions.', true, 73),
  ('audit',            'Audit log',            'Access & security','Reading and exporting the audit trail.', false, 74)
on conflict (id) do update set label = excluded.label, area = excluded.area,
  covers = excluded.covers, scopable = excluded.scopable, sort_order = excluded.sort_order;

/* --------------------------------------------------------- what binds ----- */

/* A role cannot be scoped to a category that does not exist, or hold a
   capability nothing reads. Both were typeable before, and both save as a
   permission that looks granted and does nothing. */
create or replace function guard_role_definition() returns trigger
language plpgsql security definer set search_path = public as $$
declare bad text;
begin
  select c into bad
    from unnest(coalesce(new.audit_categories, '{}')) c
   where not exists (select 1 from operator_audit_categories a where a.id = c)
   limit 1;
  if bad is not null then
    raise exception '% is not an audit category. A role scoped to one that does not exist can see nothing, and says nothing about it.', bad;
  end if;

  select k into bad
    from jsonb_object_keys(coalesce(new.capabilities, '{}'::jsonb)) k
   where not exists (select 1 from operator_capabilities c where c.id = k)
   limit 1;
  if bad is not null then
    raise exception '% is not a capability this console has. Nothing reads it, so granting it grants nothing.', bad;
  end if;

  select k into bad
    from jsonb_each_text(coalesce(new.capabilities, '{}'::jsonb)) as e(k, v)
   where v not in ('none', 'scoped', 'full')
   limit 1;
  if bad is not null then
    raise exception 'Capability % is set to something other than none, scoped or full.', bad;
  end if;

  /* A capability that is all-or-nothing cannot be held partially. "Scoped"
     access to the audit log is a setting with no behaviour behind it. */
  select e.k into bad
    from jsonb_each_text(coalesce(new.capabilities, '{}'::jsonb)) as e(k, v)
    join operator_capabilities c on c.id = e.k
   where e.v = 'scoped' and not c.scopable
   limit 1;
  if bad is not null then
    raise exception '% cannot be scoped — it is held in full or not at all.', bad;
  end if;

  return new;
end $$;

drop trigger if exists guard_role_definition_trg on operator_roles;
create trigger guard_role_definition_trg before insert or update on operator_roles
  for each row execute function guard_role_definition();

/* ------------------------------------------------------------ assertions -- */

do $$
declare n integer; r record;
begin
  /* Everything already in use is in the catalogue. If it were not, the trigger
     above would refuse the next edit of a role that has worked for months. */
  for r in
    select distinct c from operator_roles, unnest(audit_categories) c
     where not exists (select 1 from operator_audit_categories a where a.id = c)
  loop
    raise exception 'Category % is on a role and not in the catalogue', r.c;
  end loop;

  for r in
    select distinct k from operator_roles, jsonb_object_keys(capabilities) k
     where not exists (select 1 from operator_capabilities c where c.id = k)
  loop
    raise exception 'Capability % is on a role and not in the catalogue', r.k;
  end loop;

  /* And everything the audit log writes can be scoped to. This is the half that
     was missing: `Merchandising` and `Partners` were logged and unassignable. */
  for r in
    select distinct category c from operator_audit_log
     where not exists (select 1 from operator_audit_categories a where a.id = category)
  loop
    raise exception 'The audit log writes %, which no role can be scoped to', r.c;
  end loop;

  /* No existing role is holding a scoped level on something that cannot be
     scoped — the trigger would refuse their next save otherwise. */
  select count(*) into n
    from operator_roles ro, jsonb_each_text(ro.capabilities) as e(k, v)
    join operator_capabilities c on c.id = e.k
   where e.v = 'scoped' and not c.scopable;
  if n > 0 then
    raise exception '% existing grants scope a capability that is all-or-nothing', n;
  end if;

  /* Every capability says what it is for. A picker listing `mor` with no
     explanation is a picker you still have to go and look things up for. */
  select count(*) into n from operator_capabilities where coalesce(covers, '') = '' or coalesce(label, '') = '';
  if n > 0 then raise exception '% capabilities do not say what they cover', n; end if;

  select count(*) into n from operator_audit_categories where coalesce(covers, '') = '';
  if n > 0 then raise exception '% audit categories do not say what they cover', n; end if;

  /* The trigger actually refuses. A guard nobody has seen fire is a guard
     nobody knows is wired. */
  begin
    update operator_roles set audit_categories = array['Setlement'] where id = (select id from operator_roles limit 1);
    raise exception 'A role was scoped to a category that does not exist';
  exception when others then
    if sqlerrm like 'A role was scoped%' then raise; end if;
  end;
end $$;
