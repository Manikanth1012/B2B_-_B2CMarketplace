-- Category-level onboarding: what each marketplace demands before a seller may
-- list in it.
--
-- Onboarding was one funnel, run once per company. That is right for the things
-- that are true of a company — who owns it, who it banks with, whether it is
-- sanctioned — and wrong for everything that depends on *what they intend to
-- sell*. Selling security software needs an independent security attestation;
-- selling radio equipment needs type approval in every market; selling content
-- needs distribution rights and an age rating. None of that is a property of the
-- company, and none of it was asked for anywhere.
--
-- So `partner_categories` recorded an approval that nothing stood behind: an
-- operator ticked a category and the seller could list in it.
--
-- The model here is the prototype's, and its shape is the point: a rule is
-- authored once with what it requires, how it is checked, who owns it and what
-- evidence it needs; a matrix then decides which categories it applies to and
-- how hard. Adding a market to a rule is one row, not eleven edits.

/* -------------------------------------------------------- rule catalogue -- */

create table if not exists policy_rules (
  id       text primary key,
  name     text not null,
  descr    text not null,
  /* How it is checked, which is the commercial difference between them: an
     automated rule costs nothing per listing, a manual one consumes reviewer
     time, and a document rule stalls until the seller uploads something. */
  check_by text not null check (check_by in ('auto', 'doc', 'manual', 'extern')),
  basis    text not null check (basis in ('Regulatory', 'Commercial', 'Trust and safety', 'Operational')),
  owner    text not null,
  /* What satisfies it. Null where the platform reads the answer off the listing
     and there is nothing for a seller to supply. */
  evidence text,
  blocks   boolean not null default true,
  appeal   boolean not null default true,
  /* A rule is retired, never deleted: historical review decisions reference it
     and would otherwise become unreadable. */
  status   text not null default 'active' check (status in ('active', 'draft', 'retired')),
  /* Set where the rule cannot be turned off or downgraded in any category —
     it is not a marketplace policy choice. */
  locked   text,
  note     text,
  added    date not null,
  sort_order integer not null
);

insert into policy_rules (id, name, descr, check_by, basis, owner, evidence, blocks, appeal, status, locked, note, added, sort_order)
values
  ('PR-01', 'Content and age rating',
   'A listing must declare an age rating recognised in every market it is sold in.',
   'doc', 'Regulatory', 'Trust and safety', 'Age rating certificate per market', true, true, 'active', null, null, '2024-03-02', 1),
  ('PR-02', 'Randomised paid rewards',
   'Paid loot boxes and randomised rewards are prohibited where local law treats them as gambling.',
   'manual', 'Regulatory', 'Legal', 'Mechanic description and market list', true, false, 'active', null, null, '2024-03-02', 2),
  ('PR-03', 'Price floor',
   'A retail price may not sit below the wholesale floor for the same item.',
   'auto', 'Commercial', 'Commercial', null, true, true, 'active', null, null, '2024-03-02', 3),
  ('PR-04', 'Type approval',
   'Radio equipment needs a valid type-approval certificate for each target market.',
   'doc', 'Regulatory', 'Compliance', 'Type-approval certificate per market', true, false, 'active', null, null, '2024-03-02', 4),
  ('PR-05', 'Data processing terms',
   'Anything processing customer data needs a signed DPA before it may list.',
   'doc', 'Regulatory', 'Legal', 'Countersigned data processing agreement', true, false, 'active', null, null, '2024-03-02', 5),
  ('PR-06', 'Security attestation',
   'Security products need an independent attestation no older than 12 months.',
   'doc', 'Trust and safety', 'Security', 'SOC 2 Type II or ISO 27001 certificate', true, true, 'active', null, null, '2024-04-19', 6),
  ('PR-07', 'Fulfilment SLA',
   'The seller commits to a stated dispatch or provisioning window.',
   'auto', 'Operational', 'Operations', null, true, true, 'active', null, null, '2024-03-02', 7),
  ('PR-08', 'Returns window',
   'A physical item carries a returns window of at least the statutory minimum.',
   'auto', 'Regulatory', 'Legal', null, true, false, 'active', null, null, '2024-03-02', 8),
  ('PR-09', 'Rights evidence',
   'Content listings must evidence distribution rights for each market.',
   'doc', 'Regulatory', 'Legal', 'Distribution agreement or rights letter', true, false, 'active', null, null, '2024-03-02', 9),
  ('PR-10', 'Sanctions screening',
   'The seller and its beneficial owners are screened before any listing goes live.',
   'extern', 'Regulatory', 'Compliance', 'Screening result, refreshed every 90 days', true, false, 'active',
   'Sanctions screening cannot be turned off or downgraded to a warning in any category. It is not a marketplace policy choice.',
   null, '2024-03-02', 10),
  ('PR-11', 'Accessibility statement',
   'Software listings sold to enterprise buyers must carry an accessibility conformance statement.',
   'doc', 'Commercial', 'Product', 'VPAT or EN 301 549 statement', false, true, 'draft', null,
   'Drafted after three enterprise tenders asked for it. Not yet applied to any category.', '2026-07-11', 11)
on conflict (id) do nothing;

/* --------------------------------------------------- per-category policy -- */

create table if not exists category_policy (
  category_id     text primary key references categories(id) on delete cascade,
  review          text not null,
  auto_publish    boolean not null,
  returns_window  text not null,
  sla_hours       integer not null,
  price_floor     boolean not null,
  rating_required boolean not null,
  min_rating      numeric not null,
  max_listings_per_seller integer not null
);

insert into category_policy (category_id, review, auto_publish, returns_window, sla_hours, price_floor, rating_required, min_rating, max_listings_per_seller)
values
  ('consumer', 'Automated with spot check', true,  '14 days',        48,  true,  false, 3.0, 250),
  ('partner',  'Manual — every listing',    false, 'Contractual',    72,  true,  false, 3.5,  60),
  ('iot',      'Manual — every listing',    false, '30 days',        120, false, false, 3.0, 120),
  ('security', 'Manual — every listing',    false, 'Not applicable', 96,  false, true,  4.0,  40),
  ('device',   'Automated with spot check', true,  '14 days',        48,  true,  false, 3.0, 400),
  ('content',  'Manual — every listing',    false, 'Not applicable', 24,  false, true,  3.0, 180)
on conflict (category_id) do nothing;

/* The matrix. One rule, applied to many categories, at a level each category
   chooses — which is why the rule is authored once and this table is small. */
create table if not exists category_policy_rules (
  category_id text not null references categories(id)   on delete cascade,
  rule_id     text not null references policy_rules(id) on delete restrict,
  level       text not null check (level in ('off', 'warn', 'enforce')),
  primary key (category_id, rule_id)
);

insert into category_policy_rules (category_id, rule_id, level) values
  ('consumer', 'PR-01', 'warn'),    ('consumer', 'PR-03', 'enforce'), ('consumer', 'PR-05', 'enforce'),
  ('consumer', 'PR-07', 'enforce'), ('consumer', 'PR-08', 'enforce'), ('consumer', 'PR-10', 'enforce'),
  ('partner',  'PR-03', 'enforce'), ('partner',  'PR-05', 'enforce'), ('partner',  'PR-07', 'enforce'),
  ('partner',  'PR-10', 'enforce'),
  ('iot',      'PR-04', 'enforce'), ('iot',      'PR-05', 'enforce'), ('iot',      'PR-07', 'enforce'),
  ('iot',      'PR-08', 'warn'),    ('iot',      'PR-10', 'enforce'),
  ('security', 'PR-05', 'enforce'), ('security', 'PR-06', 'enforce'), ('security', 'PR-07', 'enforce'),
  ('security', 'PR-10', 'enforce'),
  ('device',   'PR-03', 'enforce'), ('device',   'PR-04', 'enforce'), ('device',   'PR-07', 'enforce'),
  ('device',   'PR-08', 'enforce'), ('device',   'PR-10', 'enforce'),
  ('content',  'PR-01', 'enforce'), ('content',  'PR-02', 'enforce'), ('content',  'PR-05', 'enforce'),
  ('content',  'PR-09', 'enforce'), ('content',  'PR-10', 'enforce')
on conflict (category_id, rule_id) do nothing;

/* --------------------------------------- what the seller actually supplied */

-- One row per rule a seller has to answer in a category they applied for.
-- This is the category-level onboarding record: the seven company gates say
-- who the seller is, and these say what they may sell.
create table if not exists partner_category_evidence (
  id          text primary key,
  partner_id  text not null references partners(id)   on delete cascade,
  category_id text not null references categories(id) on delete cascade,
  rule_id     text not null references policy_rules(id) on delete restrict,
  /* `standing` is a rule the platform enforces itself — a price floor or a
     sanctions screen — where there is no document and nothing for the seller to
     send. Calling that "submitted" would claim the seller supplied something. */
  state       text not null check (state in ('accepted', 'standing', 'submitted', 'outstanding', 'rejected', 'waived')),
  /* The document itself, where the rule is satisfied by one. Null for a rule
     the platform checks without anybody uploading anything. */
  document    text,
  kind        text,
  size        text,
  /* Certificates expire, and an expired attestation is not an attestation.
     Null where what satisfies the rule does not go out of date. */
  expires_on  date,
  submitted_by text,
  submitted_at date,
  reviewed_by text,
  reviewed_at date,
  note        text
);

/* Stated separately as well as inline, because `create table if not exists` on a
   table that already exists leaves the old constraint in place — so a migration
   that widens the vocabulary has to say so explicitly to be re-runnable. */
alter table partner_category_evidence drop constraint if exists partner_category_evidence_state_check;
alter table partner_category_evidence
  add constraint partner_category_evidence_state_check
  check (state in ('accepted', 'standing', 'submitted', 'outstanding', 'rejected', 'waived'));

create unique index if not exists partner_category_evidence_key
  on partner_category_evidence(partner_id, category_id, rule_id);
create index if not exists partner_category_evidence_partner_idx
  on partner_category_evidence(partner_id, category_id);

alter table policy_rules              enable row level security;
alter table category_policy           enable row level security;
alter table category_policy_rules     enable row level security;
alter table partner_category_evidence enable row level security;

drop policy if exists "auth_read_policy_rules"           on policy_rules;
drop policy if exists "operator_write_policy_rules"      on policy_rules;
drop policy if exists "auth_read_category_policy"        on category_policy;
drop policy if exists "operator_write_category_policy"   on category_policy;
drop policy if exists "auth_read_category_policy_rules"  on category_policy_rules;
drop policy if exists "operator_write_category_policy_rules" on category_policy_rules;
drop policy if exists "operator_all_partner_category_evidence" on partner_category_evidence;
drop policy if exists "partner_read_partner_category_evidence" on partner_category_evidence;

/* The rules and the matrix are readable by every signed-in persona — a seller
   who cannot read what a category demands cannot decide whether to apply for
   it. Only the operator authors them. */
create policy "auth_read_policy_rules" on policy_rules for select to authenticated using (true);
create policy "operator_write_policy_rules" on policy_rules for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

create policy "auth_read_category_policy" on category_policy for select to authenticated using (true);
create policy "operator_write_category_policy" on category_policy for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

create policy "auth_read_category_policy_rules" on category_policy_rules for select to authenticated using (true);
create policy "operator_write_category_policy_rules" on category_policy_rules for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

create policy "operator_all_partner_category_evidence" on partner_category_evidence
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
/* A seller reads their own and cannot write it — the same rule the onboarding
   submissions follow, for the same reason. */
create policy "partner_read_partner_category_evidence" on partner_category_evidence
  for select to authenticated using (partner_id = current_partner_id());

-- Build the evidence pack for every category every seller applied for. The
-- rule set comes from the matrix, so a seller in two categories answers each
-- category's rules — which is the whole point of doing this per category.
delete from partner_category_evidence;

insert into partner_category_evidence (
  id, partner_id, category_id, rule_id, state, document, kind, size, expires_on,
  submitted_by, submitted_at, reviewed_by, reviewed_at, note
)
select
  'pce-' || substr(pc.partner_id, 5) || '-' || pc.category_id || '-' || cpr.rule_id,
  pc.partner_id,
  pc.category_id,
  cpr.rule_id,
  case
    /* A rule the platform checks itself is neither owed nor supplied — it is
       simply in force, in an approved category and an applied-for one alike. */
    when r.check_by <> 'doc' then 'standing'
    /* A category nobody has approved yet: the document rules are what the
       seller still owes, and they are why it has not opened. */
    when pc.approved_at is null then 'outstanding'
    else 'accepted'
  end,
  case when r.check_by = 'doc' then r.evidence end,
  case when r.check_by = 'doc' then
    case when r.id = 'PR-01' then 'PDF' when r.id = 'PR-04' then 'PDF'
         when r.id = 'PR-05' then 'PDF' when r.id = 'PR-06' then 'PDF'
         else 'PDF' end
  end,
  case when r.check_by = 'doc' then
    case r.id when 'PR-01' then '0.4 MB' when 'PR-04' then '1.8 MB'
              when 'PR-05' then '0.7 MB' when 'PR-06' then '1.1 MB'
              when 'PR-09' then '0.9 MB' else '0.5 MB' end
  end,
  /* An attestation, a type approval and an age rating go out of date; a signed
     DPA does not. Dated from the current renewal rather than from the original
     approval — a seller live since 2024 is on their second or third
     certificate, and dating from the day they joined would show every long-
     standing partner as lapsed. Spread deterministically so they do not all
     fall due in the same week. */
  case when pc.approved_at is not null and r.id in ('PR-04', 'PR-06', 'PR-01')
       then (date '2026-07-30' + ((substr(pc.partner_id, 5)::int % 11) + 3) * interval '1 month')::date end,
  case when pc.approved_at is not null or r.check_by <> 'doc' then p.contact end,
  case when pc.approved_at is not null then pc.approved_at::date end,
  case when pc.approved_at is not null then r.owner end,
  case when pc.approved_at is not null then pc.approved_at::date end,
  case when pc.approved_at is null and r.check_by = 'doc'
       then 'Outstanding. This category does not open until it is supplied.' end
from partner_categories pc
join category_policy_rules cpr on cpr.category_id = pc.category_id
join policy_rules r on r.id = cpr.rule_id
join partners p on p.id = pc.partner_id
where cpr.level <> 'off'
on conflict (id) do nothing;

-- One expired certificate, deliberately. A marketplace where nothing ever
-- lapses cannot show what happens when something does, and an expiring type
-- approval is the most common real reason a live seller stops being able to
-- list in a market.
update partner_category_evidence
set state = 'submitted',
    expires_on = date '2026-07-11',
    note = 'Type approval expired on 11 Jul 2026. Renewal requested from the seller; '
        || 'existing listings continue while it is outstanding, new ones are held.'
where partner_id = 'PTR-1008' and category_id = 'device' and rule_id = 'PR-04';

/* --------------------------------------------------------- assertions ---- */

do $$
declare bad text; n integer;
begin
  -- Sanctions screening applies everywhere and is never downgraded.
  select string_agg(c.id, ', ') into bad
  from categories c
  where not exists (
    select 1 from category_policy_rules r
    where r.category_id = c.id and r.rule_id = 'PR-10' and r.level = 'enforce'
  );
  if bad is not null then
    raise exception 'sanctions screening is not enforced in: %', bad;
  end if;

  -- Every category a seller may sell in has its policy defined.
  select string_agg(id, ', ') into bad from categories c
  where not exists (select 1 from category_policy p where p.category_id = c.id);
  if bad is not null then
    raise exception 'category with no policy: %', bad;
  end if;

  -- Every approved category has every one of its enforcing rules accepted, and
  -- no unapproved one does. This is what the approval now means.
  select string_agg(pc.partner_id || '/' || pc.category_id, ', ') into bad
  from partner_categories pc
  where pc.approved_at is not null
    and exists (
      select 1 from partner_category_evidence e
      join category_policy_rules cpr
        on cpr.category_id = e.category_id and cpr.rule_id = e.rule_id
      where e.partner_id = pc.partner_id and e.category_id = pc.category_id
        and cpr.level = 'enforce' and e.state not in ('accepted', 'standing', 'waived', 'submitted')
    );
  if bad is not null then
    raise exception 'category approved with an enforcing rule outstanding: %', bad;
  end if;

  -- A rule the matrix never uses is a rule nobody authored for a reason. Draft
  -- rules are exempt: they exist precisely before they are applied.
  select string_agg(id, ', ') into bad from policy_rules r
  where r.status = 'active'
    and not exists (select 1 from category_policy_rules m where m.rule_id = r.id);
  if bad is not null then
    raise exception 'active rule applied to no category: %', bad;
  end if;

  select count(*) into n from partner_category_evidence;
  if n = 0 then raise exception 'no category evidence was built'; end if;

  -- Accepted evidence that expired before today is not accepted. Exactly one
  -- lapse is seeded, and it is recorded as such rather than as in force.
  select string_agg(partner_id || '/' || category_id || '/' || rule_id, ', ') into bad
  from partner_category_evidence
  where state = 'accepted' and expires_on is not null and expires_on < date '2026-07-30';
  if bad is not null then
    raise exception 'evidence accepted but already expired: %', bad;
  end if;
end $$;
