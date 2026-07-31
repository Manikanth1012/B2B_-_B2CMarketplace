-- Partner lifecycle: the history behind `partners.status`.
--
-- The column already held five states — onboarding, review, live, suspended,
-- rejected — and nothing recorded how a seller got into one. A status with no
-- history cannot answer the only questions anybody asks about it: who suspended
-- this partner, when, and on what grounds. It also cannot be audited, which for
-- a decision that stops a company trading is the whole point.
--
-- The legal transitions themselves live in `src/lib/partnerLifecycle.ts` so the
-- rule is stated once and tested, rather than duplicated between a check
-- constraint and the screen that has to explain it to a person. What lives here
-- is the record: every move, with the reason typed at the time.

create table if not exists partner_lifecycle_events (
  id          text primary key,
  partner_id  text not null references partners(id) on delete cascade,
  /* Null for the row that opens the history — a seller becoming an applicant
     came from nowhere, and writing 'none' would invent a sixth state. */
  from_status text,
  to_status   text not null,
  /* Never null and never blank. A suspension with no stated ground is one the
     seller cannot answer and the operator cannot defend. */
  reason      text not null check (length(btrim(reason)) > 0),
  actor       text not null,
  at          timestamptz not null default now()
);

create index if not exists partner_lifecycle_partner_idx
  on partner_lifecycle_events(partner_id, at desc);

alter table partner_lifecycle_events enable row level security;

drop policy if exists "operator_all_partner_lifecycle" on partner_lifecycle_events;
drop policy if exists "partner_read_partner_lifecycle" on partner_lifecycle_events;

create policy "operator_all_partner_lifecycle" on partner_lifecycle_events
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A seller reads their own history and cannot write it. Being told you were
   suspended, when, and why is not a courtesy — it is the only way to contest
   it. */
create policy "partner_read_partner_lifecycle" on partner_lifecycle_events
  for select to authenticated using (partner_id = current_partner_id());

-- The history each partner already implies. Dated from the onboarding record
-- rather than invented, so the timeline and the gates tell the same story: an
-- application opens when its first gate is submitted, and a seller goes live on
-- the day its go-live gate cleared.
insert into partner_lifecycle_events (id, partner_id, from_status, to_status, reason, actor, at)
select 'PLE-' || substr(p.id, 5) || '-01', p.id, null, 'onboarding',
       'Application received for ' || cats.names || '.',
       'Marketplace onboarding desk',
       (select min(submitted_at) from onboarding_gates where partner_id = p.id)
from partners p
left join lateral (
  select coalesce(string_agg(c.name, ', ' order by c.sort_order), 'no category') names
  from partner_categories pc join categories c on c.id = pc.category_id
  where pc.partner_id = p.id
) cats on true
on conflict (id) do nothing;

insert into partner_lifecycle_events (id, partner_id, from_status, to_status, reason, actor, at)
select 'PLE-' || substr(p.id, 5) || '-02', p.id, 'onboarding', 'live',
       'All seven gates cleared. Storefront opened in ' || cats.names || '.',
       'Lena Fischer',
       g.reviewed_at
from partners p
join onboarding_gates g on g.partner_id = p.id and g.gate_name = 'Go-live' and g.status = 'cleared'
left join lateral (
  select coalesce(string_agg(c.name, ', ' order by c.sort_order), 'no category') names
  from partner_categories pc join categories c on c.id = pc.category_id
  where pc.partner_id = p.id
) cats on true
on conflict (id) do nothing;

-- The four sellers whose current status is not simply "live". Each carries the
-- ground it was decided on, because that is what the record is for.
insert into partner_lifecycle_events (id, partner_id, from_status, to_status, reason, actor, at)
values
  ('PLE-1013-03', 'PTR-1013', 'onboarding', 'review',
   'Type-approval certificates cover India only. Held in review pending the equivalent for UAE and Kenya, or withdrawal of those two markets.',
   'Tomas Novak', '2026-07-20'),
  ('PLE-1014-03', 'PTR-1014', 'onboarding', 'rejected',
   'KYC could not be cleared: two declared beneficial owners could not be matched against the Brazil register. Not a finding against the company — they may reapply with corrected documentation, which opens a new application.',
   'Ruben Oyelaran', '2026-06-26'),
  ('PLE-1015-03', 'PTR-1015', 'live', 'suspended',
   'Fourteen fulfilment SLA breaches in a rolling 30 days against a contractual ceiling of three. Listings taken down; settlement of completed orders continues.',
   'Lena Fischer', '2026-05-18')
on conflict (id) do nothing;

do $$
declare bad integer;
begin
  -- Every partner has a history, and it ends on the status the record shows.
  select count(*) into bad
  from partners p
  left join lateral (
    select to_status from partner_lifecycle_events e
    where e.partner_id = p.id order by e.at desc, e.id desc limit 1
  ) last on true
  where last.to_status is distinct from p.status;
  if bad > 0 then
    raise exception '% partner(s) have a lifecycle history ending on a different status than partners.status', bad;
  end if;
end $$;
