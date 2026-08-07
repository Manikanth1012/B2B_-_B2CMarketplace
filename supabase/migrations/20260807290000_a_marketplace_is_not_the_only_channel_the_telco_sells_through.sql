/* Fibre comes off the shelf, and so does every new line.
 *
 * Two decisions, one shape.
 *
 * Fixed broadband is sold, surveyed and installed by a field crew against a
 * street address. It is a real product and it is not a marketplace product:
 * nothing on this site can tell a buyer whether their building is passed, and a
 * basket that takes the money and then finds out is worse than one that never
 * offered it.
 *
 * A new prepaid or postpaid line is the same problem wearing telco clothes. It
 * is an identity check against a government document, a number allocated out of
 * a regulated block, a SIM handed over or an eSIM bound to a device, and — where
 * the customer is bringing a number with them — a port request that runs on the
 * regulator's clock and can fail days later. Self-care, retail POS and CRM do
 * that, with the KYC desk behind them. This marketplace does not.
 *
 * WHAT THIS IS NOT.
 *
 * It is not a delete. The BSS still sells Freedom Unlimited and Fibre 1 Gbps
 * every day, and `telco_catalogue` is a federated copy of that BSS catalogue —
 * deleting rows out of it would be this marketplace editing somebody else's
 * product book to record a decision about itself. Five customers are on
 * SKU-2001 right now; retiring the listing must not cancel their subscription,
 * and pretending the plan never existed would make their bills unreadable.
 *
 * So the rate card gains a channel flag. An item that is not sold here says why
 * and says where it IS sold, because "unavailable" with no destination is how a
 * customer ends up phoning the marketplace to buy something the marketplace
 * cannot sell them.
 *
 * AND THE RULE IS A ROW, NOT AN `IF`.
 *
 * `channel_rule` holds the four decisions. `assign_number` reads it rather than
 * hard-coding them, so the refusal a customer sees and the policy an operator
 * reads on screen are the same fact. A rule nobody can see is one that gets
 * quietly reintroduced by the next person to touch the composer.
 *
 * Number portability needed no new refusal, as it turns out. `claim_number`
 * already refuses a number outside the blocks this marketplace holds, which is
 * exactly what an incoming port is. Its message now says so.
 */

/* ---- 1. What this channel sells, and what it does not ------------------------- */

create table if not exists public.channel_rule (
  id           text primary key,
  what         text not null unique,
  label        text not null,
  decision     text not null check (decision in ('sold here','not sold here')),

  /* Mandatory when the answer is no. A refusal that does not name the counter
     is a customer with nowhere to go and a desk with nothing to tell them. */
  sold_through text,
  reason       text not null,
  kb_ref       text references public.kb_articles(id),

  effective_from date not null,
  agreed_by    text,
  sort_order   integer not null default 0,

  constraint channel_rule_destination
    check (decision = 'sold here' or sold_through is not null)
);

comment on table public.channel_rule is
  'What this marketplace sells and what is left to another channel. Read by '
  'assign_number and shown on the operator Numbers screen, so the enforcement '
  'and the published policy cannot drift apart.';

insert into public.channel_rule
  (id, what, label, decision, sold_through, reason, effective_from, agreed_by, sort_order) values
  ('CR-001', 'retail-line-onboarding', 'New prepaid or postpaid line', 'not sold here',
   'Aventa self-care, retail POS and CRM',
   'Activating a new line is an identity check against a government document, a number allocated from a regulated block, and a SIM or eSIM issued against that identity. The KYC desk and the regulated allocation sit in self-care, POS and CRM. Buying a plan here would take the money and then discover the customer cannot be onboarded.',
   date '2026-08-07', 'Anika Sharma', 1),

  ('CR-002', 'number-portability', 'Bringing your number from another operator', 'not sold here',
   'Aventa self-care, retail POS and CRM',
   'A port request runs on the regulator''s clock against the losing operator, and it can be rejected days after it is raised. An order that is settled at checkout cannot carry a fulfilment that fails next week.',
   date '2026-08-07', 'Anika Sharma', 2),

  ('CR-003', 'fixed-line-access', 'Fibre and fixed-line broadband', 'not sold here',
   'Aventa field sales and CRM',
   'Fixed access is sold against a surveyed street address. Nothing on this site can tell a buyer whether their building is passed, so the sale can only be made where the serviceability check is.',
   date '2026-08-07', 'Anika Sharma', 3),

  /* Stated as a positive so the table reads as a policy rather than a list of
     refusals — and so the IoT case, which does allocate numbers, is not read as
     an oversight. */
  ('CR-004', 'iot-connectivity', 'IoT and M2M connectivity on devices sold here', 'sold here',
   null,
   'An M2M SIM is fitted to a unit the marketplace shipped, on an enterprise account that has already been onboarded. There is no new subscriber to identify and no number a person will ever dial.',
   date '2026-08-07', 'Anika Sharma', 4)
on conflict (id) do nothing;

alter table public.channel_rule enable row level security;

drop policy if exists operator_all_channel_rule on public.channel_rule;
create policy operator_all_channel_rule on public.channel_rule
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* Everybody reads it. A seller asking "can I list a broadband plan" and a
   customer asking "why can I not buy a SIM here" want the same answer. */
drop policy if exists everyone_reads_channel_rule on public.channel_rule;
create policy everyone_reads_channel_rule on public.channel_rule for select using (true);

grant select on public.channel_rule to authenticated, anon;
grant insert, update on public.channel_rule to authenticated;

/* ---- 2. The rate card learns which channel each item belongs to --------------- */

alter table public.telco_catalogue
  add column if not exists marketplace   boolean not null default true,
  add column if not exists withheld_reason text,
  add column if not exists sold_through  text,
  add column if not exists rule_id       text references public.channel_rule(id);

do $$ begin
  alter table public.telco_catalogue
    add constraint telco_catalogue_withheld
    check (marketplace or (withheld_reason is not null and sold_through is not null));
exception when duplicate_object then null; end $$;

comment on column public.telco_catalogue.marketplace is
  'Whether this channel may sell the item. False does not mean withdrawn — the '
  'BSS still sells it; sold_through says where.';

update public.telco_catalogue set
  marketplace = false,
  rule_id = 'CR-003',
  sold_through = 'Aventa field sales and CRM',
  withheld_reason = 'Fixed access needs a serviceability check against a street address before it can be sold.'
 where id in ('TP-FBB-300', 'TP-FBB-1G');

update public.telco_catalogue set
  marketplace = false,
  rule_id = 'CR-001',
  sold_through = 'Aventa self-care, retail POS and CRM',
  withheld_reason = 'Selling this activates a new line — KYC, a number from a regulated block, and a SIM issued against an identity this channel does not verify.'
 where id in ('TP-MOB-050', 'TP-MOB-100', 'TP-MOB-UNL', 'TP-MOB-PRE');

/* ---- 3. What replaces them --------------------------------------------------- */

/* Everything here attaches to a subscription the customer already has, or is
   sold to a licensed reseller who does its own onboarding. That is the whole
   test for whether an item belongs in this channel.
 *
 * The two wholesale items exist because two live reseller packs were composed
 * out of TP-MOB-PRE — the retail prepaid onboarding SKU, five hundred of them.
 * A reseller is not buying five hundred retail activations; it is buying
 * capacity to apply to lines it onboards itself. The pack was right and its
 * component was wrong. */
insert into public.telco_catalogue
  (id, name, family, kind, rc, nrc, unit, spec, cost_rc, cost_nrc, source_system, synced_at, sort_order) values
  ('TP-ADD-DAT50', 'Data top-up 50 GB', 'Add-on', 'Add-on',
   0.00, 22.00, 'one-off', '50 GB added to the current cycle, on a line you already have',
   0.00, 9.90, 'Aventa BSS — Product Catalogue', now(), 18),

  ('TP-ADD-ROMWK', 'Roaming week pass', 'Add-on', 'Add-on',
   0.00, 24.00, 'per 7 days', 'Home allowance abroad for seven days across 62 destinations',
   0.00, 10.80, 'Aventa BSS — Product Catalogue', now(), 19),

  ('TP-VAS-FAM', 'Family safety and screen time', 'Value added', 'Service',
   3.00, 0.00, 'per line/mo', 'Content filtering, screen-time limits and location sharing across the lines on one account',
   1.20, 0.00, 'Aventa BSS — Product Catalogue', now(), 20),

  /* Data-only, and no local MSISDN — which is the reason it is not caught by
     CR-001. Nobody is onboarded and nothing is allocated out of a national
     block; it is a data profile that expires. */
  ('TP-ESM-REG', 'Regional data eSIM — 20 GB', 'eSIM', 'Plan',
   0.00, 29.00, 'per 30 days', '20 GB data-only across one region, no local number, GSMA SGP.22 profile',
   0.00, 16.82, 'Aventa BSS — Product Catalogue', now(), 21),

  ('TP-WHL-DATA', 'Wholesale data capacity — per line', 'Wholesale', 'Plan',
   7.80, 0.00, 'per line/mo', 'Data capacity for a licensed reseller to apply to lines it onboards in its own channel',
   4.52, 0.00, 'Aventa BSS — Wholesale Rate Card', now(), 22),

  ('TP-WHL-VOICE', 'Wholesale voice capacity — per line', 'Wholesale', 'Plan',
   4.20, 0.00, 'per line/mo', 'Voice and SMS capacity for a licensed reseller, billed per active line',
   2.44, 0.00, 'Aventa BSS — Wholesale Rate Card', now(), 23)
on conflict (id) do nothing;

/* ---- 4. The composer cannot reach a withheld item ---------------------------- */

create or replace function public.guard_pack_component()
returns trigger language plpgsql as $$
declare
  t public.telco_catalogue;
begin
  select * into t from public.telco_catalogue where id = new.telco_id;
  if not t.marketplace then
    raise exception
      '% is not sold through this marketplace. % Buyers are served through %.',
      t.name, t.withheld_reason, t.sold_through;
  end if;
  return new;
end $$;

/* BEFORE INSERT OR UPDATE only, deliberately. The composition of a retired pack
   is a historical fact — SKU-FP9501 really was three Freedom 50 GB lines — and a
   trigger that fired on read or on nothing would either rewrite that or break
   any future touch of the row. */
drop trigger if exists guard_pack_component on public.product_telco_components;
create trigger guard_pack_component
  before insert or update on public.product_telco_components
  for each row execute function public.guard_pack_component();

/* ---- 5. Retiring the listings that sold a new line ---------------------------- */

/* Retired, not deleted, and their subscriptions are untouched. Six people are
   on these plans; "closed to new business" is a different thing from "cancelled",
   and the second one is not a decision a catalogue change gets to make. */
update public.products set
  status = 'retired',
  retired_on = date '2026-08-07',
  retired_reason = 'Closed to new business. A new prepaid or postpaid line is onboarded in self-care, retail POS or CRM, where the identity check and the number allocation are. Customers already on this plan keep it.'
 where id in ('SKU-2001', 'SKU-2002', 'SKU-2006', 'SKU-FP9501', 'SKU-FP9502');

/* "Mobile plans" now holds one thing, and that thing is not a mobile plan.
   A facet whose only member is a data-only travel profile teaches a shopper
   that this is where they come to buy a line, which is the belief this whole
   migration exists to correct. */
update public.products set sub_category = 'Travel'
 where id = 'SKU-2003' and sub_category = 'Mobile plans';

/* ---- 6. The reseller packs get a component that is actually wholesale --------- */

/* The frozen snapshot columns move with them. `rc_at` is what the component
   cost on the rate card the day the pack was composed, and leaving $9.00 of
   prepaid against a $7.80 wholesale line would make the pack's own margin
   arithmetic disagree with the rate card it claims to be derived from. */
delete from public.product_telco_components
 where product_id in ('SKU-7002', 'SKU-FP9505') and telco_id = 'TP-MOB-PRE';

insert into public.product_telco_components
  (product_id, telco_id, quantity, discount, rc_at, nrc_at, name_at, note, sort_order) values
  ('SKU-7002', 'TP-WHL-DATA', 500, 0.00, 7.80, 0.00, 'Wholesale data capacity — per line',
   'Five hundred lines of wholesale data capacity — $3,900 against a $3,900 rate card at volume. The reseller onboards the subscribers in its own channel.', 1),
  ('SKU-FP9505', 'TP-WHL-DATA', 100, 0.00, 7.80, 0.00, 'Wholesale data capacity — per line',
   'A hundred lines of wholesale data capacity.', 1)
on conflict do nothing;

update public.products set
  description = 'Five hundred lines of wholesale data capacity for resale under your own brand and tariff. Aventa supplies the capacity; you onboard and identify your own subscribers in your own channel.'
 where id = 'SKU-7002';

update public.products set
  description = 'A hundred lines of wholesale data capacity with mobile security available on each, provisioned through the partner API. The entry pack for a reseller who has cleared onboarding and onboards its own subscribers.'
 where id = 'SKU-FP9505';

/* ---- 7. What is on the shelf instead ----------------------------------------- */

insert into public.products
  (id, category_id, sub_category, name, partner_id, seller, price, was_price, cost, model,
   fulfil, rating, reviews, stock, status, listed, description, tags, comm, badge, unit,
   specs, sort_order, price_includes_tax, tax_rate, floor_price, list_price, audiences,
   currency, billing_period, serialised) values

  ('SKU-2007', 'consumer', 'Add-ons', 'Data Booster 50 GB', null, 'Aventa Telecom',
   26.00, null, 9.90, 'oneoff', 'instant', null, 0, 'in', 'live', '07 Aug 2026',
   'Fifty gigabytes added to the line you already have. Lands on the current cycle straight away and appears on next month''s bill.',
   array['Add-on','First party','Instant'], 0, null, null,
   '{"Term": "One-off", "Applies to": "An Aventa line already on your account", "Allowance": "50 GB", "Delivery": "Applied to the current cycle within a minute", "Billing": "Added to your next invoice", "Sold by": "Aventa Telecom (first party)"}'::jsonb,
   4, true, 18.00, 19.80, 26.00, array['consumer'], 'USD', null, false),

  ('SKU-2008', 'consumer', 'Add-ons', 'Roaming Week Pass', null, 'Aventa Telecom',
   28.00, null, 10.80, 'oneoff', 'instant', null, 0, 'in', 'live', '07 Aug 2026',
   'Seven days of your home allowance abroad, across 62 destinations. Bought before you fly, on the line you already have.',
   array['Add-on','Travel','First party'], 0, null, null,
   '{"Term": "Seven days", "Applies to": "An Aventa line already on your account", "Destinations": "62", "Allowance": "Your home allowance, abroad", "Delivery": "Active as soon as it is bought", "Sold by": "Aventa Telecom (first party)"}'::jsonb,
   5, true, 18.00, 21.60, 28.00, array['consumer'], 'USD', null, false),

  ('SKU-2009', 'consumer', 'Value added', 'Family Safety and Screen Time', null, 'Aventa Telecom',
   3.50, null, 1.20, 'monthly', 'instant', null, 0, 'in', 'live', '07 Aug 2026',
   'Content filtering, screen-time limits and location sharing across every line on your account. Per line, cancel any month.',
   array['Family','Value added','First party'], 0, null, 'per line',
   '{"Term": "Monthly, cancel any time", "Applies to": "Each Aventa line on your account", "Covers": "Content filtering, screen-time limits, location sharing", "Delivery": "Active within a minute", "Sold by": "Aventa Telecom (first party)"}'::jsonb,
   6, true, 18.00, 1.44, 3.50, array['consumer'], 'USD', 'monthly', false),

  /* Kept on the shelf where the retail plans left because it is genuinely not a
     line: no local number, no subscriber onboarding, and it expires by itself. */
  ('SKU-2010', 'consumer', 'Travel', 'Regional Data eSIM — 20 GB', null, 'Aventa Telecom',
   32.00, null, 16.82, 'oneoff', 'esim', null, 0, 'in', 'live', '07 Aug 2026',
   'Twenty gigabytes of data across one region, on an eSIM profile delivered as a QR code. Data only — there is no local number and nothing to cancel.',
   array['Travel','Data only','eSIM'], 0, null, null,
   '{"Term": "30 days from activation", "Allowance": "20 GB, data only", "Local number": "None — this is a data profile", "Delivery": "QR code, issued instantly", "Contract": "None — it expires", "Sold by": "Aventa Telecom (first party)"}'::jsonb,
   7, true, 18.00, 28.80, 34.00, array['consumer'], 'USD', null, false),

  ('SKU-FP9506', 'consumer', 'Operator packs', 'Family Safety Pack — 3 lines', null, 'Aventa Telecom',
   14.85, 16.50, 7.20, 'monthly', 'instant', null, 0, 'in', 'live', '07 Aug 2026',
   'Family safety and mobile security on three lines you already have, billed as one line on one invoice.',
   array['Bundle','First party','Family'], 0, 'Bundle', null,
   '{"Term": "Monthly", "Billing": "One line on your invoice", "Applies to": "Three Aventa lines already on your account", "Sold by": "Aventa Telecom (first party)", "Support": "Operator, single point of contact", "Composition": "Federated from the operator catalogue — components listed below"}'::jsonb,
   913, true, 18.00, 8.64, 16.50, array['consumer'], 'USD', 'monthly', false),

  ('SKU-FP9507', 'consumer', 'Operator packs', 'Digital Life Pack', null, 'Aventa Telecom',
   11.70, 13.00, 5.28, 'monthly', 'instant', null, 0, 'in', 'live', '07 Aug 2026',
   'Mobile security, device protection and 200 GB of in-country cloud backup on the line you already have. One line on one invoice.',
   array['Bundle','First party','Protection'], 0, 'Bundle', null,
   '{"Term": "Monthly", "Billing": "One line on your invoice", "Applies to": "An Aventa line already on your account", "Sold by": "Aventa Telecom (first party)", "Support": "Operator, single point of contact", "Composition": "Federated from the operator catalogue — components listed below"}'::jsonb,
   914, true, 18.00, 6.34, 13.00, array['consumer'], 'USD', 'monthly', false)
on conflict (id) do nothing;

insert into public.product_telco_components
  (product_id, telco_id, quantity, discount, rc_at, nrc_at, name_at, note, sort_order) values
  ('SKU-2007', 'TP-ADD-DAT50', 1, 0.00, 0.00, 22.00, 'Data top-up 50 GB',
   'The 50 GB top-up as the BSS sells it, at a marketplace uplift for self-service.', 1),
  ('SKU-2008', 'TP-ADD-ROMWK', 1, 0.00, 0.00, 24.00, 'Roaming week pass',
   'The week pass at the rate card plus self-service fulfilment.', 1),
  ('SKU-2009', 'TP-VAS-FAM', 1, 0.00, 3.00, 0.00, 'Family safety and screen time',
   'Per line, at a small uplift on the rate card.', 1),
  ('SKU-2010', 'TP-ESM-REG', 1, 0.00, 0.00, 29.00, 'Regional data eSIM — 20 GB',
   'The regional data profile plus digital fulfilment.', 1),
  ('SKU-FP9506', 'TP-VAS-FAM', 3, 0.00, 3.00, 0.00, 'Family safety and screen time',
   'Family safety across the three lines.', 1),
  ('SKU-FP9506', 'TP-VAS-SEC', 3, 0.00, 2.50, 0.00, 'Mobile security',
   'Malware and phishing protection on each of the three.', 2),
  ('SKU-FP9507', 'TP-VAS-SEC', 1, 0.00, 2.50, 0.00, 'Mobile security',
   'Malware and phishing protection on the line.', 1),
  ('SKU-FP9507', 'TP-VAS-INS', 1, 0.00, 6.00, 0.00, 'Device protection',
   'Device protection — one claim a year.', 2),
  ('SKU-FP9507', 'TP-VAS-CLD', 1, 0.00, 4.50, 0.00, 'Cloud backup 200 GB',
   '200 GB of versioned in-country backup.', 3)
on conflict do nothing;

/* Every market this trades in, and a price struck in each market's own money
   rather than converted at render. The rule this build has applied since
   markets were added. */
insert into public.product_markets (product_id, market_code)
select p, m from unnest(array['SKU-2007','SKU-2008','SKU-2009','SKU-2010','SKU-FP9506','SKU-FP9507']) p,
              unnest(array['IN','AE','KE']) m
on conflict do nothing;

insert into public.product_prices (product_id, currency, price, was_price, floor_price, list_price) values
  ('SKU-2007', 'USD',   26.00,   null,   19.80,   26.00),
  ('SKU-2007', 'INR', 2199.00,   null, 1699.00, 2199.00),
  ('SKU-2007', 'AED',   94.99,   null,   72.99,   94.99),
  ('SKU-2007', 'KES', 3399.00,   null, 2599.00, 3399.00),

  ('SKU-2008', 'USD',   28.00,   null,   21.60,   28.00),
  ('SKU-2008', 'INR', 2399.00,   null, 1849.00, 2399.00),
  ('SKU-2008', 'AED',  102.99,   null,   79.99,  102.99),
  ('SKU-2008', 'KES', 3649.00,   null, 2799.00, 3649.00),

  ('SKU-2009', 'USD',    3.50,   null,    1.44,    3.50),
  ('SKU-2009', 'INR',  299.00,   null,  129.00,  299.00),
  ('SKU-2009', 'AED',   12.99,   null,    5.49,   12.99),
  ('SKU-2009', 'KES',  449.00,   null,  189.00,  449.00),

  ('SKU-2010', 'USD',   32.00,   null,   28.80,   34.00),
  ('SKU-2010', 'INR', 2699.00,   null, 2449.00, 2899.00),
  ('SKU-2010', 'AED',  117.99,   null,  105.99,  124.99),
  ('SKU-2010', 'KES', 4199.00,   null, 3749.00, 4449.00),

  ('SKU-FP9506', 'USD',   14.85,   16.50,    8.64,   16.50),
  ('SKU-FP9506', 'INR', 1249.00, 1399.00,  749.00, 1399.00),
  ('SKU-FP9506', 'AED',   54.49,   60.99,   31.99,   60.99),
  ('SKU-FP9506', 'KES', 1919.00, 2149.00, 1119.00, 2149.00),

  ('SKU-FP9507', 'USD',   11.70,   13.00,    6.34,   13.00),
  ('SKU-FP9507', 'INR',  989.00, 1099.00,  549.00, 1099.00),
  ('SKU-FP9507', 'AED',   42.99,   47.99,   23.49,   47.99),
  ('SKU-FP9507', 'KES', 1519.00, 1679.00,  829.00, 1679.00)
on conflict do nothing;

insert into public.product_media (id, product_id, url, role, alt, sort_order) values
  ('pm-2007-h', 'SKU-2007', 'https://images.pexels.com/photos/1334597/pexels-photo-1334597.jpeg?auto=compress&cs=tinysrgb&w=600', 'hero', 'A data top-up confirmed on a handset', 1),
  ('pm-2008-h', 'SKU-2008', 'https://images.pexels.com/photos/5763034/pexels-photo-5763034.jpeg?auto=compress&cs=tinysrgb&w=600', 'hero', 'A traveller checking their phone at an airport gate', 1),
  ('pm-2009-h', 'SKU-2009', 'https://images.pexels.com/photos/4145153/pexels-photo-4145153.jpeg?auto=compress&cs=tinysrgb&w=600', 'hero', 'A parent and child looking at a phone together', 1),
  ('pm-2010-h', 'SKU-2010', 'https://images.pexels.com/photos/3184465/pexels-photo-3184465.jpeg?auto=compress&cs=tinysrgb&w=600', 'hero', 'An eSIM QR code shown on a laptop beside a passport', 1),
  ('pm-9506-h', 'SKU-FP9506', 'https://images.pexels.com/photos/4260325/pexels-photo-4260325.jpeg?auto=compress&cs=tinysrgb&w=600', 'hero', 'A family with phones around a kitchen table', 1),
  ('pm-9507-h', 'SKU-FP9507', 'https://images.pexels.com/photos/60504/security-protection-anti-virus-software-60504.jpeg?auto=compress&cs=tinysrgb&w=600', 'hero', 'A padlock icon over a phone screen', 1)
on conflict (id) do nothing;

/* A first-party listing is still a listing the catalogue desk approved. Without
   these the new products appear on the shelf with no reviewed record behind
   them, which is the state this build has spent several migrations removing. */
insert into public.operator_listings
  (id, status, submitted_at, reviewed_by, reviewed_at, version, sort_order, product_id,
   partner_id, check_note, risk, issue, decision_reason, submitted_by) values
  ('ol-2007-fp', 'approved', timestamptz '2026-08-07 09:00:00+00', 'Anika Sharma', timestamptz '2026-08-07 09:00:00+00', 1, 530, 'SKU-2007', null, 'First party — composed from the federated operator catalogue', 'low', null, 'One rate-card add-on at $22.00, published at $26.00. Applies to an existing line, so no onboarding.', 'Anika Sharma'),
  ('ol-2008-fp', 'approved', timestamptz '2026-08-07 09:00:00+00', 'Anika Sharma', timestamptz '2026-08-07 09:00:00+00', 1, 531, 'SKU-2008', null, 'First party — composed from the federated operator catalogue', 'low', null, 'One rate-card add-on at $24.00, published at $28.00. Applies to an existing line.', 'Anika Sharma'),
  ('ol-2009-fp', 'approved', timestamptz '2026-08-07 09:00:00+00', 'Anika Sharma', timestamptz '2026-08-07 09:00:00+00', 1, 532, 'SKU-2009', null, 'First party — composed from the federated operator catalogue', 'low', null, 'One rate-card service at $3.00 a line, published at $3.50.', 'Anika Sharma'),
  ('ol-2010-fp', 'approved', timestamptz '2026-08-07 09:00:00+00', 'Anika Sharma', timestamptz '2026-08-07 09:00:00+00', 1, 533, 'SKU-2010', null, 'First party — data-only profile, no local number allocated', 'low', null, 'One rate-card eSIM at $29.00, published at $32.00. Data only, so CR-001 does not bite.', 'Anika Sharma'),
  ('ol-9506-fp', 'approved', timestamptz '2026-08-07 09:00:00+00', 'Anika Sharma', timestamptz '2026-08-07 09:00:00+00', 1, 534, 'SKU-FP9506', null, 'First party — composed from the federated operator catalogue', 'low', null, 'Composed from 2 rate-card components across 3 lines at $16.50, published at $14.85.', 'Anika Sharma'),
  ('ol-9507-fp', 'approved', timestamptz '2026-08-07 09:00:00+00', 'Anika Sharma', timestamptz '2026-08-07 09:00:00+00', 1, 535, 'SKU-FP9507', null, 'First party — composed from the federated operator catalogue', 'low', null, 'Composed from 3 rate-card components at $13.00, published at $11.70.', 'Anika Sharma')
on conflict (id) do nothing;

/* ---- 8. The refusal reads the rule ------------------------------------------- */

create or replace function public.assign_number(
  p_kind text, p_market text, p_purpose text,
  p_user uuid default null, p_account text default null, p_serial text default null,
  p_holder text default null, p_order text default null, p_plan text default null
) returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  rng public.number_range;
  val text;
  id  text;
  dob date;
  yrs integer;
  who text;
  rule public.channel_rule;
begin
  /* Before anything else: is allocating this kind of number something this
     channel does at all? Read from `channel_rule` rather than written here, so
     the operator screen showing the policy and the function enforcing it cannot
     say different things. */
  if p_purpose = 'retail' then
    select * into rule from public.channel_rule where what = 'retail-line-onboarding';
    if rule.decision = 'not sold here' then
      return jsonb_build_object('ok', false, 'rule', rule.id,
        'why', format('%s is not done in the marketplace. %s Customers are onboarded through %s.',
                      rule.label, rule.reason, rule.sold_through));
    end if;
  end if;

  if p_user is not null and p_purpose = 'retail' then
    /* On the network at all? A marketplace account is not a subscription, and
       a number in the BSS against somebody it has never KYC'd is a regulatory
       problem in every market this sells in. */
    if not exists (select 1 from public.identity_links il where il.user_id = p_user) then
      select cp.name into who from public.consumer_profile cp where cp.user_id = p_user;
      return jsonb_build_object('ok', false,
        'why', format('%s is a marketplace customer and is not on the network — there is no telco identity linked to the account. A number and a SIM come with a network subscription, and that starts with an identity check the marketplace does not do.',
                      coalesce(who, 'That customer')));
    end if;

    select cp.dob into dob from public.consumer_profile cp where cp.user_id = p_user;
    yrs := public.age_years(dob);
    if yrs is not null and yrs < 18 then
      return jsonb_build_object('ok', false,
        'why', format('That customer is %s. A mobile number cannot be issued to somebody under 18 in their own name — it goes to a parent or guardian, on their account.', yrs));
    end if;
  end if;

  select * into rng from public.number_range
   where kind = p_kind and market = p_market and purpose = p_purpose
     and status in ('active', 'expiring')
     and (expires_on is null or expires_on > current_date)
   order by (status = 'active') desc, sort_order
   limit 1;

  if rng.id is null then
    return jsonb_build_object('ok', false,
      'why', format('No usable %s block reserved for %s in %s. Reserve one from the owning system first.',
                    p_kind, p_purpose, p_market));
  end if;

  val := public.next_in_range(rng.id);
  if val is null then
    return jsonb_build_object('ok', false,
      'why', format('%s is exhausted — all %s reserved numbers are allocated.', rng.id, rng.reserved));
  end if;

  id := upper(p_kind) || '-' || val;
  insert into public.number_resource
    (id, kind, value, range_id, market, purpose, state,
     user_id, account_id, stock_serial, holder_name, order_ref, plan,
     bss_ref, assigned_on, activated_on)
  values (id, p_kind, val, rng.id, p_market, p_purpose, 'assigned',
     p_user, p_account, p_serial, p_holder, p_order, p_plan,
     'TMF652-' || upper(substr(md5(id || now()::text), 1, 10)),
     current_date, current_date);

  return jsonb_build_object('ok', true, 'id', id, 'value', val, 'range', rng.id,
    'expires_on', rng.expires_on);
end $$;

/* Porting needed no new refusal. A number the customer is bringing from another
   operator is by definition outside every block this marketplace holds, and
   `claim_number` already turns that away — it just did not say what it was
   turning away. Naming it is the difference between a desk understanding the
   policy and filing a bug against the range check. */
create or replace function public.claim_number(
  p_kind text, p_market text, p_purpose text, p_value text,
  p_user uuid default null, p_account text default null,
  p_holder text default null, p_plan text default null, p_since date default null
) returns jsonb language plpgsql security definer set search_path to 'public', 'extensions' as $$
declare
  rng public.number_range;
  id  text;
  who text;
  port public.channel_rule;
begin
  if p_user is not null and p_purpose = 'retail'
     and not exists (select 1 from public.identity_links il where il.user_id = p_user) then
    select cp.name into who from public.consumer_profile cp where cp.user_id = p_user;
    return jsonb_build_object('ok', false,
      'why', format('%s is not on the network, so there is no number to claim.', coalesce(who,'That customer')));
  end if;

  /* Which block is it in? Compared numerically — a string comparison puts
     9886041127 outside 9876500000–9876599999 for the wrong reason and inside
     other ranges for a worse one. */
  select * into rng from public.number_range r
   where r.kind = p_kind and r.market = p_market and r.purpose = p_purpose
     and r.status <> 'released'
     and length(p_value) = length(r.range_from)
     and p_value::numeric between r.range_from::numeric and r.range_to::numeric
   order by r.sort_order limit 1;

  if rng.id is null then
    select * into port from public.channel_rule where what = 'number-portability';
    return jsonb_build_object('ok', false, 'rule', port.id,
      'why', format('%s is not inside any %s block the marketplace holds for %s in %s — it belongs to another operator. Bringing a number across is %s: %s It is done through %s.',
                    p_value, p_kind, p_purpose, p_market,
                    lower(port.decision), port.reason, port.sold_through));
  end if;

  if exists (select 1 from public.number_resource n
              where n.kind = p_kind and n.value = p_value and n.state <> 'released') then
    return jsonb_build_object('ok', false, 'why', format('%s is already allocated.', p_value));
  end if;

  id := upper(p_kind) || '-' || p_value;
  insert into public.number_resource
    (id, kind, value, range_id, market, purpose, state,
     user_id, account_id, holder_name, plan, bss_ref, assigned_on, activated_on)
  values (id, p_kind, p_value, rng.id, p_market, p_purpose, 'assigned',
     p_user, p_account, p_holder, p_plan,
     'TMF652-' || upper(substr(md5(id || now()::text), 1, 10)),
     coalesce(p_since, current_date), coalesce(p_since, current_date));

  return jsonb_build_object('ok', true, 'id', id, 'value', p_value, 'range', rng.id);
end $$;

/* ---- 9. Assertions ------------------------------------------------------------ */

do $$
declare n int; r jsonb;
begin
  /* Nothing withheld is still on sale. This is the assertion that matters — a
     flag nobody reads is decoration. */
  select count(*) into n
    from public.products p
    join public.product_telco_components c on c.product_id = p.id
    join public.telco_catalogue t on t.id = c.telco_id
   where p.status in ('live','scheduled','paused') and not t.marketplace;
  if n > 0 then
    raise exception '% live products are still composed from an item this channel may not sell', n;
  end if;

  /* And the composer refuses one. Tested rather than assumed, because the
     trigger is the only thing standing between a withheld item and the next
     person who builds a pack. */
  begin
    insert into public.product_telco_components
      (product_id, telco_id, quantity, discount, rc_at, nrc_at, name_at, sort_order)
    values ('SKU-2007', 'TP-FBB-1G', 1, 0, 41, 35, 'Fibre 1 Gbps', 99);
    raise exception 'the composer accepted a withheld item';
  exception when others then
    if sqlerrm like '%the composer accepted%' then raise; end if;
  end;

  /* Three people are still on the plans that were retired — two on Freedom
     50 GB and one on Unlimited. Closing to new business must not have cancelled
     anybody, and the number is asserted rather than "some remain", because a
     change that cancelled two of the three would also leave some. */
  select count(*) into n from public.subscriptions
   where product_id in ('SKU-2001','SKU-2002') and status = 'active';
  if n <> 3 then raise exception 'three active subscriptions on the retired plans became %', n; end if;

  /* The shelf did not get thinner. */
  select count(*) into n from public.products
   where category_id = 'consumer' and status = 'live';
  if n < 9 then raise exception 'the consumer shelf is down to % live products', n; end if;

  /* Every new product prices in every market it trades in. */
  select count(*) into n
    from public.product_markets m
    join public.markets mk on mk.code = m.market_code
   where m.product_id like 'SKU-20%' or m.product_id like 'SKU-FP950%';
  if not exists (
    select 1 from public.products p
     where p.id in ('SKU-2007','SKU-2008','SKU-2009','SKU-2010','SKU-FP9506','SKU-FP9507')
       and (select count(*) from public.product_prices q where q.product_id = p.id) = 4
  ) then raise exception 'a new product is missing a price'; end if;

  select count(*) into n from public.products p
   where p.id in ('SKU-2007','SKU-2008','SKU-2009','SKU-2010','SKU-FP9506','SKU-FP9507')
     and (select count(*) from public.product_prices q where q.product_id = p.id) <> 4;
  if n > 0 then raise exception '% new products do not price in all four currencies', n; end if;

  /* A new retail number cannot be allocated through this channel. */
  r := public.assign_number('msisdn', 'IN', 'retail', null, null, null, 'Test Person');
  if (r->>'ok')::boolean then
    raise exception 'a new retail line was onboarded through the marketplace after all';
  end if;
  if r->>'rule' <> 'CR-001' then
    raise exception 'the refusal did not come from the published rule (got %)', coalesce(r->>'rule','none');
  end if;

  /* An M2M number still can — the IoT case is the one that stays. CR-004 says
     so as a positive, and this is what proves the positive still holds rather
     than having been caught by the same guard as the retail case. */
  r := public.assign_number('msisdn', 'IN', 'iot', null, 'ENT-2007', null, 'Assertion probe');
  if not (r->>'ok')::boolean then
    raise exception 'IoT connectivity was withdrawn by accident: %', r->>'why';
  end if;
  delete from public.number_resource where id = r->>'id';

  /* And a port-in is refused by name rather than by accident. */
  r := public.claim_number('msisdn', 'IN', 'retail', '9000000001');
  if (r->>'ok')::boolean then raise exception 'a foreign number was claimed'; end if;
  if r->>'rule' <> 'CR-002' then
    raise exception 'porting was refused without naming the rule (got %)', coalesce(r->>'rule','none');
  end if;

  raise notice 'withheld: %; live consumer products: %',
    (select string_agg(id, ', ' order by id) from public.telco_catalogue where not marketplace),
    (select count(*) from public.products where category_id='consumer' and status='live');
end $$;
