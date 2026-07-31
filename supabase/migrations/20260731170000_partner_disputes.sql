-- Disputes a seller is actually in, and a way to talk to the marketplace.
--
-- The seller console carried one hard-coded dispute in a TypeScript file, the
-- same row for every seller who signed in, and a "Contact the marketplace"
-- button wired to nothing at all. A seller whose settlement is being held has
-- no way to say anything about it, which is the one moment they most need one.
--
-- Two tables:
--
--   partner_disputes   money held back against a seller pending an outcome.
--                      It is the seller's money being withheld, so who owns the
--                      next move and by when is the whole substance of the row.
--   partner_messages   a thread with the marketplace desk. Not a dispute — a
--                      question, a correction, a request. Keeping them apart
--                      matters because a dispute holds money and a question
--                      does not, and merging them would make every question
--                      look like a claim.

create table if not exists partner_disputes (
  id          text primary key,
  partner_id  text not null references partners(id) on delete cascade,
  order_ref   text not null,
  product_id  text references products(id),
  category_id text references categories(id),
  reason      text not null,
  detail      text,
  buyer       text not null,
  raised      date not null,
  /* What is being held out of settlement until this closes. */
  amount      numeric(10,2) not null check (amount >= 0),
  /* Who the next move belongs to. A dispute where nobody knows whose turn it is
     is a dispute that ages quietly for a month. */
  owner       text not null check (owner in ('seller', 'marketplace', 'buyer')),
  status      text not null check (status in ('open', 'awaiting_seller', 'awaiting_marketplace', 'resolved', 'rejected')),
  due_on      date,
  /* How it ended, and who ate the cost. Null while it is live. */
  outcome     text check (outcome in ('refunded', 'redelivered', 'partial', 'upheld_seller', 'withdrawn')),
  resolution  text,
  resolved_on date,
  sort_order  integer not null default 0
);

create index if not exists partner_disputes_partner_idx on partner_disputes(partner_id, status);

/* A closed dispute says how it closed and holds nothing back. An open one has
   not decided yet, so it must not claim to have. */
alter table partner_disputes drop constraint if exists partner_disputes_closure_check;
alter table partner_disputes add constraint partner_disputes_closure_check
  check (
    (status in ('resolved', 'rejected')
      and outcome is not null and resolution is not null and resolved_on is not null)
    or (status not in ('resolved', 'rejected')
      and outcome is null and resolved_on is null)
  );

create table if not exists partner_messages (
  id         text primary key,
  partner_id text not null references partners(id) on delete cascade,
  subject    text not null,
  /* What it is about, so it reaches the right desk rather than a general inbox
     somebody triages by reading. */
  topic      text not null check (topic in (
    'settlement', 'listing', 'onboarding', 'dispute', 'technical', 'other')),
  body       text not null,
  raised_by  text not null,
  raised_at  date not null,
  status     text not null default 'open' check (status in ('open', 'answered', 'closed')),
  priority   text not null default 'normal' check (priority in ('normal', 'urgent')),
  /* Where a message is about something specific — a dispute, a listing. */
  ref        text,
  answered_by text,
  answered_at date,
  answer     text,
  sort_order integer not null default 0
);

create index if not exists partner_messages_partner_idx on partner_messages(partner_id, status);

/* Answered means somebody answered. */
alter table partner_messages drop constraint if exists partner_messages_answer_check;
alter table partner_messages add constraint partner_messages_answer_check
  check (status <> 'answered' or (answered_by is not null and answer is not null));

/* ---------------------------------------------------------------- seed --- */

-- Nimbus Sensors (PTR-1004) is the demo seller, so they get a real history:
-- disputes that closed different ways, one live, and a thread with the desk.
insert into partner_disputes (id, partner_id, order_ref, product_id, category_id, reason, detail,
                              buyer, raised, amount, owner, status, due_on,
                              outcome, resolution, resolved_on, sort_order)
values
  ('DSP-2201', 'PTR-1004', 'ORD-880519', 'SKU-5003', 'iot',
   '3 of 25 sensors reported missing on delivery',
   'Buyer signed for 25 cartons. Two days later they reported three units short. Our despatch note and the carrier weight both say 25 went out.',
   'Brightline Foods', '2026-07-25', 1797.00, 'seller', 'awaiting_seller', '2026-08-01',
   null, null, null, 1),

  ('DSP-2188', 'PTR-1004', 'ORD-878402', 'SKU-5003', 'iot',
   'Cold-chain sensor reporting 4 °C high',
   'Six units in one batch read consistently high against the buyer''s reference probe. Traced to a calibration batch.',
   'Harbourpoint Retail', '2026-06-14', 504.00, 'marketplace', 'resolved', null,
   'redelivered',
   'Calibration fault confirmed on batch NS-2406. Six units replaced at our cost and the batch withdrawn. Nothing deducted from settlement — the marketplace accepted this was a manufacturing defect handled properly.',
   '2026-06-27', 2),

  -- Against the seller's own bundle, not the operator's SIM plan: the buyer
  -- bought Cold-chain starter, which carries operator connectivity inside it,
  -- so the claim lands on the seller even though the failing part was not.
  ('DSP-2170', 'PTR-1004', 'ORD-876115', 'SKU-5006', 'iot',
   'Connectivity not activated on 12 of the 25 bundled SIMs',
   'Buyer could not provision twelve of the SIMs inside the cold-chain starter pack. Our API had returned success on all of them.',
   'Brightline Foods', '2026-05-30', 168.00, 'marketplace', 'resolved', null,
   'upheld_seller',
   'Provisioning failure was in the operator''s own BSS, not the seller''s feed. Nothing held; the marketplace credited the buyer directly.',
   '2026-06-05', 3),

  ('DSP-2154', 'PTR-1004', 'ORD-874008', 'SKU-5009', 'iot',
   'Air quality sensor dead on arrival',
   'Single unit, no power on unboxing.',
   'Meera Krishnan', '2026-05-11', 71.00, 'seller', 'resolved', null,
   'refunded',
   'Accepted without argument — unit was returned and confirmed faulty. Refunded in full and deducted from the May settlement.',
   '2026-05-15', 4),

  ('DSP-2139', 'PTR-1004', 'ORD-871244', 'SKU-5003', 'iot',
   'Buyer claims the pack was never delivered',
   'Carrier tracking showed delivered and signed. Buyer disputed the signature.',
   'Harbourpoint Retail', '2026-04-19', 2295.00, 'marketplace', 'rejected', null,
   'withdrawn',
   'Carrier produced a photograph of the delivery at the loading bay with a legible signature. Buyer withdrew. The hold was released in full at the April run.',
   '2026-04-30', 5),

  -- Other sellers, so the operator's view is not one seller's story.
  ('DSP-2205', 'PTR-1001', 'ORD-880744', 'SKU-3001', 'content',
   'Duplicate charge on a household plan',
   'Buyer billed twice in one cycle after switching tiers mid-month.',
   'Arun Deshpande', '2026-07-26', 12.99, 'seller', 'open', '2026-08-02',
   null, null, null, 6),

  ('DSP-2199', 'PTR-1003', 'ORD-879810', 'SKU-6001', 'security',
   'Firewall throughput below the published figure',
   'Buyer measured 640 Mbps inspected against a published 1 Gbps.',
   'Harbourpoint Retail', '2026-07-21', 155.00, 'seller', 'awaiting_seller', '2026-07-30',
   null, null, null, 7)
on conflict (id) do update set
  status = excluded.status, owner = excluded.owner, outcome = excluded.outcome,
  resolution = excluded.resolution, resolved_on = excluded.resolved_on,
  detail = excluded.detail, due_on = excluded.due_on;

insert into partner_messages (id, partner_id, subject, topic, body, raised_by, raised_at,
                              status, priority, ref, answered_by, answered_at, answer, sort_order)
values
  ('PMS-4401', 'PTR-1004', 'Evidence format for the missing-sensor dispute', 'dispute',
   'For DSP-2201 — will a carrier weight ticket and our despatch note be enough, or do you need the warehouse CCTV as well? The CCTV is a fortnight from being overwritten so I would rather pull it now if you will want it.',
   'Katrin Boehm', '2026-07-27', 'answered', 'urgent', 'DSP-2201',
   'Marketplace disputes desk', '2026-07-28',
   'Pull the CCTV now. The weight ticket on its own has not carried a short-delivery claim before — a carrier can weigh 25 and deliver 22. Upload all three and we will put the hold decision on it this week.', 1),

  ('PMS-4388', 'PTR-1004', 'Settlement held without a reason on the statement', 'settlement',
   'The June statement shows $504 held with no line explaining it. I worked out afterwards it was DSP-2188 but the statement itself never said so.',
   'Rajesh Kumar', '2026-06-20', 'answered', 'normal', null,
   'Marketplace settlement desk', '2026-06-23',
   'Fair point and it was a defect our end — holds now carry the dispute reference on the statement line. The $504 was released on 27 June when the dispute closed.', 2),

  ('PMS-4372', 'PTR-1004', 'Can we list refurbished units?', 'listing',
   'We have a stock of returned sensors that test clean. Is there a route to list them as refurbished, or does the Devices policy rule that out?',
   'Katrin Boehm', '2026-05-22', 'closed', 'normal', null,
   'Marketplace catalogue desk', '2026-05-26',
   'Not currently — the type-approval rule reads per unit and a refurbished unit needs its own. We are looking at a refurbished condition flag for the next quarter and will come back to you.', 3),

  ('PMS-4410', 'PTR-1004', 'API returning 429 on bulk provisioning', 'technical',
   'We hit the rate limit at about 300 SIMs in a batch. Is 600 a minute a hard ceiling or can it be raised for a scheduled bulk run?',
   'Rajesh Kumar', '2026-07-29', 'open', 'normal', null,
   null, null, null, 4)
on conflict (id) do update set
  status = excluded.status, answer = excluded.answer,
  answered_by = excluded.answered_by, answered_at = excluded.answered_at;

/* ------------------------------------------------------------------ RLS -- */

alter table partner_disputes enable row level security;
alter table partner_messages enable row level security;

drop policy if exists "operator_all_partner_disputes" on partner_disputes;
drop policy if exists "partner_read_own_disputes"     on partner_disputes;
drop policy if exists "partner_update_own_disputes"   on partner_disputes;
drop policy if exists "operator_all_partner_messages" on partner_messages;
drop policy if exists "partner_own_messages"          on partner_messages;

create policy "operator_all_partner_disputes" on partner_disputes
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A seller sees their own and can respond to them. They cannot decide them —
   the outcome and the resolution are the marketplace's to write, which is why
   only the operator policy carries a general update. */
create policy "partner_read_own_disputes" on partner_disputes
  for select to authenticated using (partner_id = current_partner_id());

create policy "operator_all_partner_messages" on partner_messages
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A seller raises and reads their own threads. */
create policy "partner_own_messages" on partner_messages
  for all to authenticated
  using (partner_id = current_partner_id())
  with check (partner_id = current_partner_id());

/* ------------------------------------------------------------ assertions - */

do $$
declare bad text; n integer;
begin
  select count(*) into n from partner_disputes;
  if n <> 7 then raise exception 'expected 7 disputes, found %', n; end if;

  -- The demo seller has a history rather than a single row, or the screen shows
  -- nothing worth looking at.
  select count(*) into n from partner_disputes where partner_id = 'PTR-1004';
  if n < 4 then
    raise exception 'the demo seller has only % disputes — not a history', n;
  end if;

  -- And it is a history: things that closed, in more than one way.
  select count(distinct outcome) into n from partner_disputes
  where partner_id = 'PTR-1004' and outcome is not null;
  if n < 3 then
    raise exception 'the demo seller''s disputes all closed the same way — found % outcomes', n;
  end if;

  -- Something is still live, or there is nothing to act on.
  select count(*) into n from partner_disputes
  where partner_id = 'PTR-1004' and status not in ('resolved', 'rejected');
  if n = 0 then
    raise exception 'the demo seller has no live dispute to work';
  end if;

  -- Every dispute points at an order line that could plausibly exist, and at a
  -- product the seller actually sells.
  select string_agg(d.id || ' -> ' || d.product_id, ', ') into bad
  from partner_disputes d join products p on p.id = d.product_id
  where p.partner_id is distinct from d.partner_id;
  if bad is not null then
    raise exception 'dispute against a product the seller does not sell: %', bad;
  end if;

  -- A live dispute has somebody's name on the next move and a date.
  select string_agg(id, ', ') into bad from partner_disputes
  where status in ('open', 'awaiting_seller', 'awaiting_marketplace') and due_on is null;
  if bad is not null then
    raise exception 'live dispute with no date on it: %', bad;
  end if;

  -- Messages: the demo seller has a real thread, including one still open.
  select count(*) into n from partner_messages where partner_id = 'PTR-1004';
  if n < 3 then raise exception 'the demo seller has only % messages', n; end if;

  select count(*) into n from partner_messages where partner_id = 'PTR-1004' and status = 'open';
  if n = 0 then raise exception 'no open message — the thread shows nothing awaiting a reply'; end if;
end $$;
