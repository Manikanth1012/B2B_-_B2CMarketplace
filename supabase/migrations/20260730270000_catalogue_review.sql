-- The catalogue review queue, attached to the catalogue it reviews.
--
-- `operator_listings` was a free-standing table describing listings by name.
-- The same fiction the ledger and the statements carried — "TechDyne Devices",
-- "CloudSync Labs", "Nimbus IoT Solutions" — six of twelve rows had no
-- product_id at all, and where a row did name a SKU the figures contradicted
-- it: ol-001 asked $29.99 for a plan that lists at $18, and ol-005 asked $899
-- for a firewall that lists at $24 a month.
--
-- Worse than the names: `operator_listings.status` and `products.status` were
-- two independent opinions about the same listing, and nothing kept them in
-- step. A submission could be approved while its product sat pending, or
-- rejected while the product was live and selling.
--
-- So this is not a table of listings. A listing *is* a product; this is the
-- record of the review that decided whether it could be sold. One row per
-- submission, pointing at the product it is about, and `products.status` is the
-- lifecycle both sides read.

/* --------------------------------------------- products still in review -- */

-- The queue had four pending rows naming nothing. These are the listings that
-- are genuinely in review, and they are real products in `pending` — which is
-- what a listing awaiting approval is. The set matches the prototype's queue,
-- including the one it exists to demonstrate: a policy breach the reviewer is
-- not allowed to approve.
insert into products (
  id, category_id, sub_category, name, partner_id, seller, price, was_price, cost,
  model, fulfil, rating, reviews, stock, status, listed, description, tags, comm, badge, sort_order
)
values
  ('SKU-3009', 'content', 'Gaming', 'PlayForge Loot Crate', 'PTR-1005', 'PlayForge Games',
   4.99, null, 0, 'oneoff', 'instant', 0, 0, 'in', 'pending', '23 Jul 2026',
   'Randomised in-game reward crate. Contents are drawn at purchase.',
   array['Gaming', 'In-app'], 22, null, 309),
  ('SKU-5009', 'iot', 'Sensors', 'Nimbus Air Quality sensor', 'PTR-1004', 'Nimbus Sensors',
   71.00, null, 0, 'oneoff', 'shipped', 0, 0, 'in', 'pending', '24 Jul 2026',
   'Indoor particulate and CO2 sensor with a five-year battery.',
   array['IP54', '5-year battery', 'LoRaWAN'], 11, null, 509),
  -- Beacon Reseller Co has been live since May 2025 with nothing listed. A
  -- reseller with an empty storefront is a seller nobody can buy from.
  ('SKU-7004', 'partner', 'Reseller packs', 'Beacon wholesale data pack — 500 lines', 'PTR-1009', 'Beacon Reseller Co',
   11.80, null, 13.00, 'monthly', 'provisioned', 0, 0, 'in', 'pending', '24 Jul 2026',
   'Wholesale data allocation resold under the partner''s own brand.',
   array['Wholesale', '500 lines'], 14, null, 709)
on conflict (id) do nothing;

/* ---------------------------------------------------- the review record -- */

alter table operator_listings
  add column if not exists check_note text,
  add column if not exists risk text,
  add column if not exists issue text,
  add column if not exists decision_reason text,
  add column if not exists submitted_by text;

-- Rebuilt: half the rows name a seller that does not exist and the rest carry
-- figures the catalogue contradicts. There is nothing to carry forward.
delete from operator_listings;

alter table operator_listings
  drop column if exists product_name,
  drop column if exists partner_name,
  drop column if exists category,
  drop column if exists price,
  drop column if exists cost,
  drop column if exists rating,
  drop column if exists reviews,
  drop column if exists stock_status;

alter table operator_listings
  alter column product_id set not null;

/* The earlier migration's keys are dropped rather than left beside the new
   ones. Two foreign keys on one column make PostgREST refuse to embed the
   relationship at all — it cannot tell which to follow — and the old product
   key was `on delete set null`, which contradicts the not-null this migration
   just applied. */
alter table operator_listings drop constraint if exists operator_listings_product_id_fkey;
alter table operator_listings drop constraint if exists operator_listings_partner_id_fkey;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'operator_listings_product_fk') then
    alter table operator_listings
      add constraint operator_listings_product_fk
      foreign key (product_id) references products(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'operator_listings_partner_fk') then
    alter table operator_listings
      add constraint operator_listings_partner_fk
      foreign key (partner_id) references partners(id) on delete cascade;
  end if;
end $$;

alter table operator_listings drop constraint if exists operator_listings_risk_ck;
alter table operator_listings
  add constraint operator_listings_risk_ck check (risk in ('low', 'medium', 'high'));

alter table operator_listings drop constraint if exists operator_listings_status_ck;
alter table operator_listings
  add constraint operator_listings_status_ck check (status in ('pending', 'approved', 'rejected'));

/* One open submission per product. A second would be two answers to "may this
   be sold", and the version column is what carries a resubmission. */
create unique index if not exists operator_listings_open_idx
  on operator_listings(product_id) where status = 'pending';

-- Every listing under review, with the finding that decides it. `risk` is not
-- decoration: the screen refuses to approve a high-risk policy breach, so the
-- value is what makes the button work.
insert into operator_listings (
  id, product_id, partner_id, status, risk, check_note, issue,
  submitted_by, submitted_at, reviewed_by, reviewed_at, decision_reason, version, sort_order
)
values
  ('ol-3008', 'SKU-3008', 'PTR-1001', 'pending', 'low',
   'Content rights evidence attached', null,
   'Wei Lin Tan', '2026-07-21', null, null, null, 1, 1),
  ('ol-4007', 'SKU-4007', 'PTR-1013', 'pending', 'medium',
   'Awaiting radio type-approval certificate',
   'Type approval covers India only. UAE and Kenya are on the listing with no certificate behind them.',
   'Tran Minh Duc', '2026-07-19', null, null, null, 1, 2),
  -- The one the banner is about. A reviewer cannot approve this, and the reason
  -- is a rule in the catalogue rather than a note somebody typed.
  ('ol-3009', 'SKU-3009', 'PTR-1005', 'pending', 'high',
   'Policy check — randomised paid rewards',
   'Randomised paid rewards are prohibited where local law treats them as gambling. Two of the three '
   || 'target markets do. Approving as submitted exposes the marketplace, not only the seller.',
   'Marek Zielinski', '2026-07-23', null, null, null, 1, 3),
  ('ol-5009', 'SKU-5009', 'PTR-1004', 'pending', 'low',
   'Standard hardware listing', null,
   'Katrin Boehm', '2026-07-24', null, null, null, 1, 4),
  ('ol-7004', 'SKU-7004', 'PTR-1009', 'pending', 'medium',
   'Margin floor check',
   'The proposed retail price of $11.80 sits $1.20 below the wholesale floor of $13.00. '
   || 'Selling at this price loses money on every line.',
   'Amara Okonkwo', '2026-07-24', null, null, null, 1, 5)
on conflict (id) do nothing;

-- And the history: every live product came through this queue once. Without it
-- the screen implies the marketplace has approved five things ever.
insert into operator_listings (
  id, product_id, partner_id, status, risk, check_note, issue,
  submitted_by, submitted_at, reviewed_by, reviewed_at, decision_reason, version, sort_order
)
select
  'ol-' || substr(p.id, 5),
  p.id,
  p.partner_id,
  'approved',
  'low',
  case
    when p.fulfil = 'shipped'     then 'Standard hardware listing'
    when p.category_id = 'content' then 'Content rights and age rating checked'
    when p.category_id = 'security' then 'Security attestation checked'
    else 'Automated checks passed'
  end,
  null,
  coalesce(pt.contact, 'Aventa catalogue desk'),
  to_date(p.listed, 'DD Mon YYYY'),
  'Tomas Novak',
  to_date(p.listed, 'DD Mon YYYY') + 1,
  'Cleared against the category policy in force at the time.',
  1,
  100 + p.sort_order
from products p
left join partners pt on pt.id = p.partner_id
where p.status = 'live'
on conflict (id) do nothing;

-- The one refusal, so the screen can show what a rejection looks like. Vertex
-- Endpoint's listing came down with its seller.
insert into operator_listings (
  id, product_id, partner_id, status, risk, check_note, issue,
  submitted_by, submitted_at, reviewed_by, reviewed_at, decision_reason, version, sort_order
)
values
  ('ol-6004', 'SKU-6004', 'PTR-1015', 'rejected', 'high',
   'Security attestation expired',
   'The SOC 2 report on file is 14 months old. The category requires one no older than 12.',
   'Noa Barak', '2026-05-16', 'Ana Sousa', '2026-05-18',
   'Refused pending a current attestation. The listing came down with the seller''s suspension two days later.',
   1, 999)
on conflict (id) do nothing;

/* ------------------------------------------------------ seller queries --- */

-- How a reviewer asks for something without refusing the listing. A rejection
-- the seller could have answered in a sentence is a rejection that comes
-- straight back as a support ticket.
create table if not exists listing_queries (
  id          text primary key,
  product_id  text not null references products(id)  on delete cascade,
  partner_id  text references partners(id) on delete cascade,
  subject     text not null,
  body        text not null,
  asked_by    text not null,
  asked_on    date not null,
  due_on      date not null,
  status      text not null check (status in ('open', 'answered', 'overdue', 'closed')),
  answer      text,
  answered_on date
);

create index if not exists listing_queries_product_idx on listing_queries(product_id);

alter table listing_queries enable row level security;

drop policy if exists "operator_all_listing_queries" on listing_queries;
drop policy if exists "partner_read_listing_queries" on listing_queries;

create policy "operator_all_listing_queries" on listing_queries
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
/* A seller reads the questions asked of them. One they cannot see is one they
   cannot answer, and the listing sits in the queue until they do. */
create policy "partner_read_listing_queries" on listing_queries
  for select to authenticated using (partner_id = current_partner_id());

insert into listing_queries (id, product_id, partner_id, subject, body, asked_by, asked_on, due_on, status, answer, answered_on)
values
  ('LQ-Q-401', 'SKU-4007', 'PTR-1013', 'Type approval evidence',
   'Type-approval certificates are attached for India only. Please supply the equivalent for UAE and Kenya, or withdraw those two markets from the listing.',
   'Tomas Novak', '2026-07-20', '2026-07-24', 'overdue', null, null),
  ('LQ-Q-402', 'SKU-7004', 'PTR-1009', 'Cost price looks wrong',
   'The declared cost of $13.00 is above the proposed sale price of $11.80. Either the cost is wrong or the listing loses money on every line — please confirm which.',
   'Lena Fischer', '2026-07-24', '2026-07-28', 'open', null, null),
  ('LQ-Q-403', 'SKU-3009', 'PTR-1005', 'Mechanic description and market list',
   'Confirm exactly how the crate contents are drawn and which markets you intend to sell it in. Two of the three you have listed treat randomised paid rewards as gambling.',
   'Ruben Oyelaran', '2026-07-23', '2026-07-27', 'answered',
   'Contents are drawn from a published probability table. We would withdraw the two markets and sell in India only.',
   '2026-07-25')
on conflict (id) do nothing;

/* --------------------------------------------------------- assertions ---- */

do $$
declare bad text;
begin
  -- Every submission is about a product that exists, from a seller that exists.
  select string_agg(o.id, ', ') into bad
  from operator_listings o
  where not exists (select 1 from products p where p.id = o.product_id)
     or (o.partner_id is not null and not exists (select 1 from partners x where x.id = o.partner_id));
  if bad is not null then
    raise exception 'submission naming a product or seller that does not exist: %', bad;
  end if;

  -- The submission and the product agree about who is selling it.
  select string_agg(o.id, ', ') into bad
  from operator_listings o join products p on p.id = o.product_id
  where o.partner_id is distinct from p.partner_id;
  if bad is not null then
    raise exception 'submission and product disagree about the seller: %', bad;
  end if;

  -- And about where the listing stands. This is the split the whole migration
  -- exists to remove: two status columns, neither of them wrong on its own.
  select string_agg(o.id || ' (' || o.status || ' vs product ' || p.status || ')', ', ') into bad
  from operator_listings o join products p on p.id = o.product_id
  where (o.status = 'pending'  and p.status <> 'pending')
     or (o.status = 'approved' and p.status not in ('live', 'suspended'))
     or (o.status = 'rejected' and p.status not in ('rejected', 'suspended'));
  if bad is not null then
    raise exception 'the review record and the product disagree: %', bad;
  end if;

  -- A finding that says nothing is a review nobody did.
  select string_agg(id, ', ') into bad from operator_listings where coalesce(check_note, '') = '';
  if bad is not null then
    raise exception 'submission with no recorded check: %', bad;
  end if;

  -- Every high or medium risk states what is actually wrong.
  select string_agg(id, ', ') into bad
  from operator_listings where risk in ('high', 'medium') and coalesce(issue, '') = '';
  if bad is not null then
    raise exception 'flagged submission with no stated issue: %', bad;
  end if;

  -- Every product a buyer can see, or is waiting on, has a review record.
  select string_agg(p.id, ', ') into bad
  from products p
  where p.status in ('live', 'pending')
    and not exists (select 1 from operator_listings o where o.product_id = p.id);
  if bad is not null then
    raise exception 'product on sale or in review with no review record: %', bad;
  end if;
end $$;
