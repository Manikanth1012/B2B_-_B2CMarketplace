-- Refunds, as something more than a list the customer reads.
--
-- `consumer_refunds` held five rows, visible only to the customer who raised
-- them, with the seller recorded as a piece of free text. The seller whose
-- revenue was being given back could not see a single one, and the marketplace
-- could not see them either. So a refund request had no owner, no clock and no
-- route: it was a note in a customer's account page.
--
-- Who decides is the substance of this. A refund is between a CUSTOMER and the
-- party that sold to them, and it is the seller's revenue going back, so the
-- seller decides on their own products. The marketplace decides only what it
-- sold itself — first-party products and bundles it assembled — and steps in on
-- a third-party refund where a rule it published says it must: the seller did
-- not answer inside the response SLA, or the escalation clock ran out.
--
-- Escalation is a clock, not a button. A customer who has to know to press
-- something to get a fair hearing is a customer we have quietly failed.

create table if not exists refunds (
  id          text primary key,
  order_ref   text not null,
  product_id  text not null references products(id),
  /* What the customer thinks they bought, captured at the time. Kept beside
     product_id rather than joined for it: a listing can be renamed and the
     refund record should still read the way the receipt did. */
  item        text not null,
  category_id text references categories(id),
  /* Null means the marketplace sold it. Everything else names the seller whose
     revenue is being given back. */
  partner_id  text references partners(id) on delete cascade,
  seller      text not null,
  first_party boolean not null default false,
  /* Sold inside a bundle the marketplace assembled. The seller supplied a part;
     the marketplace sold the whole, so the marketplace answers for it. */
  bundle_ref  text,

  customer    text not null,
  buyer_type  text not null check (buyer_type in ('consumer', 'enterprise')),
  /* Where the customer has an account here. Null for the synthetic buyers who
     do not — the seller and the marketplace still have to answer them. */
  user_id     uuid references auth.users(id) on delete set null,

  amount      numeric(10,2) not null check (amount > 0),
  /* What actually went back. Null while undecided; less than `amount` on a part
     refund, and the difference has to be explained. */
  refunded    numeric(10,2) check (refunded >= 0),
  currency    text not null default 'USD',

  reason      text not null check (reason in (
    'not-received',   -- never arrived
    'faulty',         -- faulty or not as described
    'not-activated',  -- service never came up
    'duplicate',      -- charged twice
    'cancelled',      -- cancelled inside the window
    'unauthorised',   -- I did not authorise this
    'changed-mind')),
  detail      text,
  evidence    text,

  requested   date not null,
  /* Who owns the decision, decided when the request is raised rather than
     argued about afterwards. */
  decider     text not null check (decider in ('seller', 'marketplace', 'auto')),
  /* When the response SLA runs out. A date the seller can see is the only
     version of an SLA that changes anybody's behaviour. */
  sla_due     date not null,

  state       text not null check (state in (
    'requested', 'approved', 'refunded', 'declined', 'escalated', 'partial')),
  decided_on  date,
  decided_by  text,
  decision_note text,
  escalated_on  date,
  escalated_why text,
  sort_order  integer not null default 0
);

create index if not exists refunds_partner_idx  on refunds(partner_id, state);
create index if not exists refunds_user_idx     on refunds(user_id);
create index if not exists refunds_state_idx    on refunds(state, sla_due);

/* A decision is a decision: it says who made it and why. An undecided request
   must not claim one. */
alter table refunds drop constraint if exists refunds_decision_check;
alter table refunds add constraint refunds_decision_check
  check (
    (state in ('approved', 'refunded', 'declined', 'partial')
      and decided_on is not null and decided_by is not null and decision_note is not null)
    or (state in ('requested', 'escalated')
      and decided_on is null and decided_by is null)
  );

/* Escalation records why it escalated. "It escalated" on its own tells the
   seller nothing about what they failed to do. */
alter table refunds drop constraint if exists refunds_escalation_check;
alter table refunds add constraint refunds_escalation_check
  check ((state = 'escalated') = (escalated_on is not null and escalated_why is not null));

/* A full refund returns the whole amount; a part refund returns less than it
   and more than nothing. Anything else is a number that contradicts its label. */
alter table refunds drop constraint if exists refunds_amount_check;
alter table refunds add constraint refunds_amount_check
  check (
    (state = 'refunded' and refunded = amount)
    or (state = 'partial' and refunded > 0 and refunded < amount)
    or (state not in ('refunded', 'partial') and refunded is null)
  );

/* First-party means the marketplace sold it, so there is no seller to charge it
   back to and no seller to ask. */
alter table refunds drop constraint if exists refunds_party_check;
alter table refunds add constraint refunds_party_check
  check (
    (first_party and partner_id is null and decider <> 'seller')
    or (not first_party and partner_id is not null)
  );

/* ================================================================= policy === */

create table if not exists refund_policy (
  id                       text primary key default 'current',
  seller_sla_hours         integer not null,
  escalate_after_hours     integer not null,
  auto_approve_below       numeric(10,2) not null,
  auto_approve_reasons     text[] not null,
  escalation_rule          text not null,
  marketplace_decides_when text not null,
  funded_by                text not null,
  store_credit             text not null
);

insert into refund_policy (id, seller_sla_hours, escalate_after_hours, auto_approve_below,
                           auto_approve_reasons, escalation_rule, marketplace_decides_when,
                           funded_by, store_credit)
values ('current', 48, 72, 25.00,
  /* Only one reason auto-approves on its own merits. A duplicate charge is
     provable from the payment records and is never a judgement call; "it never
     arrived" is a judgement call, however sympathetic. Everything else
     auto-approves only under the small-claim threshold, where arguing about it
     costs both sides more than the refund. */
  array['duplicate'],
  'A request still unresolved 72 hours after it was raised is escalated to the marketplace automatically, and so is a decline the seller cannot evidence. The customer does not ask for this and cannot be penalised for not knowing to.',
  'The product is first-party, the sale was inside a bundle the marketplace assembled, the seller has not answered within the SLA, or the escalation clock has run out.',
  'The seller whose product it was. A refund the marketplace grants against a seller''s product is still recovered from that seller''s settlement, and the reason is recorded so it can be argued about.',
  'Money returns to the instrument that paid. We do not offer store credit in place of a refund a customer is entitled to, because that converts a legal obligation into a marketing one.')
on conflict (id) do update set
  seller_sla_hours = excluded.seller_sla_hours,
  escalate_after_hours = excluded.escalate_after_hours,
  auto_approve_below = excluded.auto_approve_below,
  auto_approve_reasons = excluded.auto_approve_reasons,
  escalation_rule = excluded.escalation_rule,
  marketplace_decides_when = excluded.marketplace_decides_when,
  funded_by = excluded.funded_by,
  store_credit = excluded.store_credit;

/* The window is not the same everywhere, because a digital entitlement already
   consumed cannot be un-consumed. */
create table if not exists refund_windows (
  category_id text primary key references categories(id) on delete cascade,
  days        integer not null check (days > 0),
  note        text not null
);

insert into refund_windows (category_id, days, note) values
  ('device',   14, 'Distance-selling return period. Unopened, or faulty at any point in warranty.'),
  ('iot',      14, 'Hardware follows the device window. Connectivity is pro-rated from the cancellation date.'),
  ('content',  14, 'Full refund while unused. Once streamed or downloaded, the entitlement is consumed.'),
  ('security', 30, 'Managed services are refundable pro-rata for the unused term.'),
  ('consumer', 14, 'Statutory cooling-off. Usage-based charges already incurred are not refundable.'),
  ('partner',  14, 'Whatever the reseller published, floored at the statutory minimum.')
on conflict (category_id) do update set days = excluded.days, note = excluded.note;

/* =================================================================== seed === */

/* The five that existed, carried over with the parts that were missing: which
   seller in the partner record rather than a name in a string, who decided it,
   and when the answer was owed. */
insert into refunds (id, order_ref, product_id, item, category_id, partner_id, seller, first_party,
                     customer, buyer_type, user_id, amount, refunded, reason, detail, evidence,
                     requested, decider, sla_due, state, decided_on, decided_by, decision_note,
                     escalated_on, escalated_why, sort_order)
values
  ('RFN-3201', 'ORD-881204', 'SKU-4003', 'Kestrel K7 64 GB', 'device', 'PTR-1002', 'Kestrel Devices', false,
   'Priya Raman', 'consumer', (select id from auth.users where email = 'priya.raman@example.com'),
   389.00, 389.00, 'faulty',
   'The screen was cracked under the film when I opened the box.',
   'Photographs of the cracked display and the courier condition report',
   '2026-07-19', 'seller', '2026-07-21', 'refunded',
   '2026-07-19', 'Anil Mehra (Kestrel Devices)',
   'Fault accepted without argument. Refunded in full and the handset returned to the Bengaluru warehouse.',
   null, null, 1),

  ('RFN-3202', 'ORD-880912', 'SKU-2004', 'Device Protect — screen and theft', 'consumer', 'PTR-1006', 'Aegis Assurance', false,
   'Priya Raman', 'consumer', (select id from auth.users where email = 'priya.raman@example.com'),
   18.00, 18.00, 'not-received',
   'The policy documents never arrived and the cover never showed on my account.',
   'No delivery event on the fulfilment record',
   '2026-07-10', 'seller', '2026-07-12', 'refunded',
   '2026-07-12', 'Divya Rao (Aegis Assurance)',
   'Fulfilment never completed. Refunded in full, with 500 goodwill points added by the marketplace at its own cost.',
   null, null, 2),

  ('RFN-3203', 'ORD-881044', 'SKU-5004', 'Nimbus Occupancy sensor', 'iot', 'PTR-1004', 'Nimbus Sensors', false,
   'Priya Raman', 'consumer', (select id from auth.users where email = 'priya.raman@example.com'),
   42.00, 42.00, 'cancelled',
   'Returned inside the 14-day window — I could not get it to sit flush on the ceiling.',
   'Return tracking, delivered back on 01 Jul',
   '2026-06-30', 'seller', '2026-07-02', 'refunded',
   '2026-07-02', 'Rajesh Kumar (Nimbus Sensors)',
   'Inside the window and returned undamaged. Refunded in full; the loyalty points earned on the order were reversed with it.',
   null, null, 3),

  -- The row that was stored as "partial · Pending review", which is two states
  -- at once. It is neither: the seller offered part, the customer refused, and
  -- nobody moved. That is what the escalation clock exists for.
  ('RFN-3204', 'ORD-880788', 'SKU-4003', 'Kestrel K7 64 GB (2nd)', 'device', 'PTR-1002', 'Kestrel Devices', false,
   'Priya Raman', 'consumer', (select id from auth.users where email = 'priya.raman@example.com'),
   389.00, null, 'faulty',
   'The wrong colour arrived. I ordered midnight blue and received graphite.',
   'Photograph of the handset beside the order confirmation',
   '2026-07-24', 'marketplace', '2026-07-26', 'escalated',
   null, null, null,
   '2026-07-28',
   'The seller offered $50 against a $389 order and the buyer refused it. Unresolved 96 hours after it was raised, past the 72-hour clock.',
   4),

  ('RFN-3205', 'ORD-880451', 'SKU-2005', 'Travel Cover Lite', 'consumer', 'PTR-1006', 'Aegis Assurance', false,
   'Priya Raman', 'consumer', (select id from auth.users where email = 'priya.raman@example.com'),
   12.99, null, 'cancelled',
   'Cancelled the same evening I bought it, well inside the cooling-off period.',
   'Cancellation timestamped 4 hours after purchase',
   '2026-07-29', 'seller', '2026-07-31', 'requested',
   null, null, null, null, null, 5)
on conflict (id) do nothing;

/* Nimbus Sensors is the demo seller, so their queue has to hold every shape a
   seller actually meets: one with time on it, one overdue, one taken off them
   by the clock, one they part-refunded, one they declined and one that decided
   itself. */
insert into refunds (id, order_ref, product_id, item, category_id, partner_id, seller, first_party,
                     bundle_ref, customer, buyer_type, amount, refunded, reason, detail, evidence,
                     requested, decider, sla_due, state, decided_on, decided_by, decision_note,
                     escalated_on, escalated_why, sort_order)
values
  ('RFN-3220', 'ORD-881502', 'SKU-5009', 'Nimbus Air Quality sensor', 'iot', 'PTR-1004', 'Nimbus Sensors', false,
   null, 'Sanya Kapoor', 'consumer', 142.00, null, 'faulty',
   'Two of the four sensors will not pair with the hub. The other two are fine.',
   'Pairing log and photographs of the LED fault codes',
   '2026-07-30', 'seller', '2026-08-01', 'requested', null, null, null, null, null, 10),

  -- Overdue, and the escalation clock runs out today. This is the row the
  -- seller's queue exists to put in front of them.
  ('RFN-3221', 'ORD-881489', 'SKU-5003', 'Nimbus Cold-chain sensor', 'iot', 'PTR-1004', 'Nimbus Sensors', false,
   null, 'Brightline Foods', 'enterprise', 168.00, null, 'not-received',
   'Two units short on a delivery of eight. The pallet was signed for as complete.',
   'Goods-in count sheet, countersigned by the driver',
   '2026-07-28', 'seller', '2026-07-30', 'requested', null, null, null, null, null, 11),

  ('RFN-3222', 'ORD-881455', 'SKU-5004', 'Nimbus Occupancy sensor', 'iot', 'PTR-1004', 'Nimbus Sensors', false,
   null, 'Greencity Estates', 'enterprise', 1040.00, null, 'faulty',
   'Nineteen of the twenty units report occupancy continuously in an empty room.',
   'Two weeks of telemetry from an unoccupied floor',
   '2026-07-22', 'marketplace', '2026-07-24', 'escalated', null, null, null,
   '2026-07-27',
   'The seller declined it as an installation error without producing a site report. A decline the seller cannot evidence escalates on its own.',
   12),

  ('RFN-3223', 'ORD-881301', 'SKU-5003', 'Nimbus Cold-chain sensor', 'iot', 'PTR-1004', 'Nimbus Sensors', false,
   null, 'Brightline Foods', 'enterprise', 336.00, 168.00, 'faulty',
   'Four units reading high against our reference probe.',
   'Calibration comparison against a certified probe',
   '2026-07-08', 'seller', '2026-07-10', 'partial',
   '2026-07-10', 'Rajesh Kumar (Nimbus Sensors)',
   'Two of the four were confirmed out of calibration on return and refunded. The other two tested inside tolerance and went back to the customer, so half the claim stands and half does not.',
   null, null, 13),

  ('RFN-3224', 'ORD-881120', 'SKU-5009', 'Nimbus Air Quality sensor', 'iot', 'PTR-1004', 'Nimbus Sensors', false,
   null, 'Meera Krishnan', 'consumer', 71.00, null, 'changed-mind',
   'I have decided I do not need it.',
   'None supplied',
   '2026-06-22', 'seller', '2026-06-24', 'declined',
   '2026-06-23', 'Rajesh Kumar (Nimbus Sensors)',
   'Raised 31 days after delivery, outside the 14-day window that applies to IoT hardware, and the unit had been installed. Declined with the window quoted.',
   null, null, 14),

  ('RFN-3225', 'ORD-881077', 'SKU-5004', 'Nimbus Occupancy sensor', 'iot', 'PTR-1004', 'Nimbus Sensors', false,
   null, 'Daniel Osei', 'consumer', 52.00, 52.00, 'duplicate',
   'I was charged twice for the same sensor.',
   'Authorisations AUTH-77120 and AUTH-77121, four seconds apart',
   '2026-07-15', 'auto', '2026-07-17', 'refunded',
   '2026-07-15', 'Auto',
   'A duplicate charge is provable from the payment records and is never a judgement call, so it approved itself the moment it was raised.',
   null, null, 15)
on conflict (id) do nothing;

/* The marketplace's own. First-party products and assembled bundles: nobody
   else to ask and nobody else to charge it to. */
insert into refunds (id, order_ref, product_id, item, category_id, partner_id, seller, first_party,
                     bundle_ref, customer, buyer_type, amount, refunded, reason, detail, evidence,
                     requested, decider, sla_due, state, decided_on, decided_by, decision_note, sort_order)
values
  ('RFN-3230', 'ORD-881419', 'SKU-2002', 'Aventa Freedom Unlimited', 'consumer', null, 'Aventa Telecom', true,
   null, 'Ravi Menon', 'consumer', 27.00, null, 'not-received',
   'The SIM never attached to the network and I was billed for the month anyway.',
   'No successful attach on the network in the whole billing month',
   '2026-07-24', 'marketplace', '2026-07-26', 'approved',
   '2026-07-25', 'Amelia Nkosi (Marketplace)',
   'First-party product, so the marketplace both decides and funds it. Agreed in full and queued to the card that paid; it clears on the next payment run.',
   20),

  -- Overdue on the marketplace's own desk. A queue that only ever shows other
  -- people being late is a queue nobody believes.
  ('RFN-3231', 'ORD-881368', 'SKU-FP9504', 'IoT Estate Pool — 50 GB', 'iot', null, 'Aventa Telecom', true,
   'BND-FLEET-PRO', 'Brightline Foods', 'enterprise', 50.40, null, 'cancelled',
   'Cancelled two days into the month after the estate rollout was pulled.',
   'Cancellation email timestamped inside the window',
   '2026-07-26', 'marketplace', '2026-07-28', 'requested',
   null, null, null, 21)
on conflict (id) do nothing;

/* Other sellers, so the operator's view is not one seller's story. */
insert into refunds (id, order_ref, product_id, item, category_id, partner_id, seller, first_party,
                     customer, buyer_type, amount, refunded, reason, detail, evidence,
                     requested, decider, sla_due, state, decided_on, decided_by, decision_note,
                     escalated_on, escalated_why, sort_order)
values
  ('RFN-3226', 'ORD-881311', 'SKU-3004', 'PlayForge Season Pass', 'content', 'PTR-1005', 'PlayForge Games', false,
   'Arun Deshpande', 'consumer', 24.99, null, 'changed-mind',
   'I bought it by mistake and would like the money back.',
   'Entitlement shows 14 hours of play',
   '2026-07-22', 'seller', '2026-07-24', 'declined',
   '2026-07-23', 'Marek Zielinski (PlayForge Games)',
   'The entitlement has been consumed — 14 hours of play against a season that had just started. A consumed digital entitlement cannot be un-consumed. The customer has been told how to escalate.',
   null, null, 30),

  ('RFN-3227', 'ORD-881350', 'SKU-6006', 'SMB Security Essentials — 25 seats', 'security', 'PTR-1003', 'Sentinel Cyber', false,
   'Harbourpoint Retail', 'enterprise', 165.00, null, 'cancelled',
   'Cancelled inside the 30-day window after the pilot was called off.',
   'Cancellation email timestamped inside the 30-day window',
   '2026-07-21', 'marketplace', '2026-07-23', 'escalated',
   null, null, null,
   '2026-07-25',
   'The seller argued the term had started and then let it sit. Ninety-six hours unresolved, past the 72-hour clock, so it came to the marketplace on its own.',
   31),

  ('RFN-3228', 'ORD-881207', 'SKU-4004', 'Volta Mesh Wi-Fi 6 (3-pack)', 'device', 'PTR-1008', 'Volta Routers', false,
   'Meridian Foods', 'enterprise', 687.00, 229.00, 'not-received',
   'One of the three packs never reached us.',
   'Courier delivered two of three; the third was signed for at the wrong dock',
   '2026-07-20', 'seller', '2026-07-22', 'partial',
   '2026-07-22', 'Chen Yu Hsu (Volta Routers)',
   'Two of the three arrived and are being kept. The third was signed for at a neighbouring dock and never recovered, so one pack is refunded and the difference is set out on the credit line.',
   null, null, 32),

  ('RFN-3229', 'ORD-881441', 'SKU-3001', 'StreamNova Premium 4K', 'content', 'PTR-1001', 'StreamNova Media', false,
   'Daniel Osei', 'consumer', 12.99, null, 'unauthorised',
   'I did not sign up for this and do not recognise the charge.',
   'Sign-in from an unrecognised device the day before the charge',
   '2026-07-25', 'seller', '2026-07-27', 'requested',
   null, null, null, null, null, 33),

  ('RFN-3232', 'ORD-881470', 'SKU-5005', 'TrackWise Asset Tracker Pro', 'iot', 'PTR-1011', 'TrackWise Telematics', false,
   'Meridian Foods', 'enterprise', 96.00, null, 'faulty',
   'The tracker stopped reporting after four days and will not re-register.',
   'Last-seen timestamp from the fleet console',
   '2026-07-29', 'seller', '2026-07-31', 'requested',
   null, null, null, null, null, 34),

  ('RFN-3233', 'ORD-881466', 'SKU-3007', 'ClearVault Personal 2 TB', 'content', 'PTR-1010', 'ClearVault Cloud', false,
   'Sanya Kapoor', 'consumer', 6.49, 6.49, 'changed-mind',
   'Signed up and immediately thought better of it.',
   'None required under the threshold',
   '2026-07-27', 'auto', '2026-07-29', 'refunded',
   '2026-07-27', 'Auto',
   'Under the $25 threshold, where arguing about it costs both sides more than the refund. Approved on the spot.',
   null, null, 35)
on conflict (id) do nothing;

/* The old table is superseded. Its five rows are above, with an owner, a clock
   and a decision on each of them. Leaving it in place would leave two answers
   to "what refunds does this customer have". */
drop table if exists consumer_refunds;

/* ====================================================================== RLS === */

alter table refunds        enable row level security;
alter table refund_policy  enable row level security;
alter table refund_windows enable row level security;

drop policy if exists "operator_all_refunds"       on refunds;
drop policy if exists "partner_read_own_refunds"   on refunds;
drop policy if exists "partner_decide_own_refunds" on refunds;
drop policy if exists "customer_read_own_refunds"  on refunds;
drop policy if exists "customer_raise_refund"      on refunds;
drop policy if exists "read_refund_policy"         on refund_policy;
drop policy if exists "operator_write_refund_policy" on refund_policy;
drop policy if exists "read_refund_windows"        on refund_windows;
drop policy if exists "operator_write_refund_windows" on refund_windows;

create policy "operator_all_refunds" on refunds
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A seller sees every refund raised against their own products, decided or not.
   Hiding the decided ones would hide what the marketplace decided for them. */
create policy "partner_read_own_refunds" on refunds
  for select to authenticated using (partner_id = current_partner_id());

create policy "partner_decide_own_refunds" on refunds
  for update to authenticated
  using (partner_id = current_partner_id())
  with check (partner_id = current_partner_id());

create policy "customer_read_own_refunds" on refunds
  for select to authenticated using (user_id = auth.uid());

create policy "customer_raise_refund" on refunds
  for insert to authenticated with check (user_id = auth.uid());

/* The policy and the windows are the rules of the game. Everybody plays by
   them, so everybody can read them; only the operator writes them. */
create policy "read_refund_policy" on refund_policy for select to anon, authenticated using (true);
create policy "operator_write_refund_policy" on refund_policy
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "read_refund_windows" on refund_windows for select to anon, authenticated using (true);
create policy "operator_write_refund_windows" on refund_windows
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A seller decides their own refunds. They must not be able to take one back
   off the marketplace once the clock has moved it, hand it to somebody else, or
   quietly change what was asked for. */
create or replace function guard_refund() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  /* The seller specifically. A null persona is a migration or a service role,
     not an application user, and silently reverting its writes makes the schema
     lie to whoever is maintaining it — which is exactly what happened when a
     later migration tried to correct an order reference here and the row came
     back unchanged with no error. */
  if current_persona() is distinct from 'partner' then
    return new;
  end if;
  /* What the customer asked for, and against what. Not the seller's to edit. */
  new.order_ref  := old.order_ref;
  new.product_id := old.product_id;
  new.item       := old.item;
  new.partner_id := old.partner_id;
  new.customer   := old.customer;
  new.user_id    := old.user_id;
  new.amount     := old.amount;
  new.reason     := old.reason;
  new.detail     := old.detail;
  new.requested  := old.requested;
  new.sla_due    := old.sla_due;
  /* Ownership and escalation belong to the clock and to the marketplace. */
  new.decider       := old.decider;
  new.escalated_on  := old.escalated_on;
  new.escalated_why := old.escalated_why;
  /* Once it has escalated it is not the seller's to decide any more. */
  if old.state = 'escalated' then
    return old;
  end if;
  return new;
end $$;

drop trigger if exists refunds_guard on refunds;
create trigger refunds_guard before update on refunds
  for each row execute function guard_refund();

/* ------------------------------------------------------ sanity assertions --- */
do $$
declare n integer;
begin
  /* A refund names a product, and calls it what the catalogue calls it. Seven
     order_items rows once failed the same check against a different table. */
  select count(*) into n from refunds r join products p on p.id = r.product_id
   where r.item <> p.name and r.item not like p.name || ' %';
  if n > 0 then
    raise exception '% refunds name a product differently from the catalogue', n;
  end if;

  /* The seller on the refund is the seller of the product. A refund charged to
     the wrong seller is money taken from the wrong company. */
  select count(*) into n from refunds r join products p on p.id = r.product_id
   where r.partner_id is distinct from p.partner_id;
  if n > 0 then
    raise exception '% refunds are charged to a different seller from the one that sold the product', n;
  end if;

  select count(*) into n from refunds r join products p on p.id = r.product_id
   where r.seller <> p.seller;
  if n > 0 then
    raise exception '% refunds name a seller the product record contradicts', n;
  end if;

  select count(*) into n from refunds r join products p on p.id = r.product_id
   where r.category_id is distinct from p.category_id;
  if n > 0 then
    raise exception '% refunds sit in a different marketplace from their product', n;
  end if;

  /* Where the order exists here, the refund has to be for something that order
     actually contained. */
  select count(*) into n
    from refunds r join orders o on o.order_ref = r.order_ref
   where not exists (
     select 1 from order_items i where i.order_id = o.id and r.item like i.product_name || '%');
  if n > 0 then
    raise exception '% refunds are for an item their order does not contain', n;
  end if;

  /* The response SLA is 48 hours from the request, everywhere. An SLA that is
     computed differently per row is not a commitment. */
  select count(*) into n from refunds r, refund_policy p
   where p.id = 'current' and r.sla_due <> r.requested + (p.seller_sla_hours / 24);
  if n > 0 then
    raise exception '% refunds have a response deadline that does not match the published SLA', n;
  end if;

  /* Anything the clock has taken off a seller is decided by the marketplace. */
  select count(*) into n from refunds where state = 'escalated' and decider <> 'marketplace';
  if n > 0 then
    raise exception '% escalated refunds are still recorded as the seller''s to decide', n;
  end if;

  /* The demo seller must have one that is late. It is the state the queue
     exists to surface, and demonstrating it against nothing proves nothing. */
  select count(*) into n from refunds
   where partner_id = 'PTR-1004' and state = 'requested' and sla_due < current_date;
  if n < 1 then
    raise exception 'the demo seller has no overdue refund — the queue has nothing to show';
  end if;

  /* And the marketplace must be late on one of its own, or the operator's view
     only ever shows other people missing deadlines. */
  select count(*) into n from refunds
   where first_party and state = 'requested' and sla_due < current_date;
  if n < 1 then
    raise exception 'the marketplace is not late on any of its own refunds';
  end if;
end $$;
