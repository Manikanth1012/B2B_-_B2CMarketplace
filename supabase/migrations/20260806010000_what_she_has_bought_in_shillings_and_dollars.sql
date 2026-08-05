/*
  # What she has bought, in shillings and in dollars

  The second half of the Kenyan shopper. The first gave her an identity; this
  gives her eighteen months of trading — orders, the subscriptions they started,
  the bills that collected them, two refunds, three reviews, two support tickets
  and a loyalty balance that is the sum of its own ledger.

  ## The point of the whole thing: two currencies in one market

  Kenya takes KES and USD. Her home currency is KES and almost everything she
  has bought is in shillings, but three purchases are in dollars — the travel
  eSIM she bought on the way to a conference, the season pass, and a cloud
  gaming subscription that is billed in dollars the way most of them are in
  Nairobi. That is not a contrivance: `market_currencies` says KE accepts USD,
  `guard_order_currency` allows it, and until now nothing in the database had
  ever taken that path.

  It follows through. A bill carries one currency — that was settled when bills
  got their own currency — so a month in which she was charged in both produces
  **two bills**, one per currency, rather than one bill with a mixed total that
  nobody could add up. July 2026 has both. That is the honest consequence of the
  model, and it is the thing worth showing a Kenyan operator.

  ## Every number is computed, not typed

  Prices come from `product_prices` for the currency each order was placed in.
  Tax is worked out of the total at Kenya's 16% the same way `basketMoney` does
  it — `net = round(total / 1.16, 2)`, `tax = total - net` — rather than added
  on top. Points come from `loyalty_point_rates` at her tier's multiplier. Her
  balance, her lifetime figures and her qualifying spend are recomputed from the
  ledger at the end rather than stated.

  A migration that types 1464.66 next to a price of 1699 is a migration that is
  wrong the day somebody reprices the product.
*/

/* Idempotent: everything below is re-derived, so running it twice lands in the
   same place rather than doubling eighteen months of trading. */
delete from loyalty_ledger where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13';
delete from product_reviews where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13';
delete from refunds where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13';
delete from support_tickets where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13';
delete from subscriptions where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13';
delete from consumer_bills where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13';
delete from stock_watch where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13';
delete from consumer_audit_log where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13';
delete from payment_attempts where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13' and purpose = 'order';
delete from order_items where order_id in (select id from orders where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13');
delete from orders where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13';

/* ---------------------------------------------------------- what she bought */

/* One row per order: the SKU, the day, and the currency she was quoted in. The
   money is looked up, never stated. */
create temporary table ke_order (
  order_ref  text primary key,
  on_date    date,
  product_id text,
  qty        integer,
  currency   text,
  status     text,
  stage      integer,
  rail       text,
  carrier    text,
  tracking   text
) on commit drop;

insert into ke_order values
  ('ORD-770112', date '2025-02-18', 'SKU-2001', 1, 'KES', 'delivered',  4, 'mobile_money',   null,               null),
  ('ORD-770268', date '2025-04-06', 'SKU-4003', 1, 'KES', 'delivered',  4, 'mobile_money',   'Sendy',            'SND-KE-40218'),
  ('ORD-770415', date '2025-07-22', 'SKU-3001', 1, 'KES', 'delivered',  4, 'card',           null,               null),
  ('ORD-770603', date '2025-11-09', 'SKU-4008', 1, 'KES', 'refunded',   4, 'mobile_money',   'Sendy',            'SND-KE-51907'),
  ('ORD-770781', date '2026-01-27', 'SKU-3005', 1, 'KES', 'delivered',  4, 'carrier_billing', null,              null),
  ('ORD-770944', date '2026-03-14', 'SKU-4004', 1, 'KES', 'delivered',  4, 'card',           'G4S Courier',      'G4S-KE-88132'),
  ('ORD-771102', date '2026-05-02', 'SKU-2004', 1, 'KES', 'delivered',  4, 'mobile_money',   null,               null),
  ('ORD-771339', date '2026-06-19', 'SKU-4001', 1, 'KES', 'delivered',  4, 'bank_transfer',  'G4S Courier',      'G4S-KE-91744'),
  ('ORD-771508', date '2026-07-11', 'SKU-3007', 1, 'KES', 'delivered',  4, 'mobile_money',   null,               null),
  /* The dollar side. She was quoted in USD because the storefront was set to
     it — a choice Kenya's market row allows and nothing had ever exercised. */
  ('ORD-771644', date '2026-07-28', 'SKU-2003', 1, 'USD', 'refunded',   4, 'card',           null,               null),
  ('ORD-771744', date '2026-07-30', 'SKU-3003', 1, 'USD', 'delivered',  4, 'card',           null,               null),
  ('ORD-771802', date '2026-08-02', 'SKU-3004', 1, 'USD', 'processing', 1, 'mobile_money',   null,               null);

/* The money, worked out of the price rather than added on top — the same
   arithmetic `basketMoney` uses, so an order here and an order placed through
   the checkout agree to the cent. */
create temporary view ke_order_money as
  select o.*,
         p.name as product_name, p.seller, p.model, p.fulfil, p.category_id,
         round(pp.price * o.qty, 2) as total,
         round(round(pp.price * o.qty, 2) / 1.16, 2) as net,
         round(pp.price * o.qty, 2) - round(round(pp.price * o.qty, 2) / 1.16, 2) as tax
    from ke_order o
    join products p on p.id = o.product_id
    join product_prices pp on pp.product_id = o.product_id and pp.currency = o.currency;

insert into orders (
  id, order_ref, seller, status, total, subtotal, tax, discount, currency, market,
  tax_rate, payment_method, payment_ref, buyer_name, buyer_email, shipping_address,
  created_at, placed_date, carrier, tracking_ref, stage, stages, failed, user_id, vertical
)
select
  ('c0000000-0000-4000-8000-' || lpad(replace(m.order_ref, 'ORD-', ''), 12, '0'))::uuid,
  m.order_ref, m.seller, m.status, m.total, m.net, m.tax, 0, m.currency, 'KE',
  16, m.rail, 'PAY-' || to_char(m.on_date, 'YYMMDD') || '-' || upper(substr(md5(m.order_ref), 1, 4)),
  'Wanjiru Kamau', 'wanjiru.kamau@6dtech.co.ke',
  jsonb_build_object('address', 'Riara Road, Kilimani — Apartment 4B', 'city', 'Nairobi', 'country', 'Kenya'),
  m.on_date + time '11:15', to_char(m.on_date, 'DD Mon YYYY'),
  m.carrier, m.tracking, m.stage,
  case when m.fulfil = 'shipped'
       then array['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered']
       else array['Ordered', 'Confirmed', 'Provisioning', 'Activating', 'Active'] end,
  false, '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', m.category_id
  from ke_order_money m;

insert into order_items (order_id, product_id, product_name, price, quantity, fulfil, status, user_id)
select o.id, m.product_id, m.product_name, round(m.total / m.qty, 2), m.qty, m.fulfil,
       case when m.status = 'refunded' then 'refunded' else m.status end,
       '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'
  from ke_order_money m
  join orders o on o.order_ref = m.order_ref;

/* Every order was paid for on a rail Kenya offers, and the payment says what
   it charged. Same shape as the backfill for everyone else. */
insert into payment_attempts
  (id, reference, user_id, wallet_id, order_ref, purpose, amount, currency, method_id,
   market_code, provider, instrument, state, gateway_ref, started_at, decided_at)
select 'PA-KE-' || replace(m.order_ref, 'ORD-', ''),
       'PAY-' || to_char(m.on_date, 'YYMMDD') || '-' || upper(substr(md5(m.order_ref), 1, 4)),
       '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', null, m.order_ref, 'order',
       m.total, m.currency, m.rail, 'KE', pm.provider,
       case m.rail
         when 'mobile_money'    then 'M-Pesa •••••• 1903'
         when 'card'            then '•••• 7042'
         when 'bank_transfer'   then 'bank transfer from •••• 4471'
         when 'carrier_billing' then 'the Aventa bill for •••••• 1903'
       end,
       'succeeded',
       upper(substr(regexp_replace(pm.provider, '\W', '', 'g'), 1, 4)) || '-' || upper(substr(md5(m.order_ref), 1, 6)),
       m.on_date + time '11:12', m.on_date + time '11:13'
  from ke_order_money m
  join payment_method_markets pm on pm.market_code = 'KE' and pm.method_id = m.rail;

/* --------------------------------------------------------- what runs on --- */

/* A monthly product bought is a subscription started. The currency follows the
   order, which is how the dollar-billed cloud gaming subscription sits beside
   the shilling ones without either being converted. */
insert into subscriptions (product_id, product_name, status, auto_renew, started_at,
                           next_renewal, price, user_id, ref, seller, cycle, ends_at,
                           resumes_at, currency)
select m.product_id, m.product_name,
       case when m.order_ref = 'ORD-770415' then 'paused' else 'active' end,
       m.order_ref <> 'ORD-770415',
       m.on_date,
       case when m.order_ref = 'ORD-770415' then null
            else (date_trunc('month', date '2026-08-05') + interval '1 month'
                  + (extract(day from m.on_date)::int - 1) * interval '1 day')::date end,
       m.total, '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13',
       'SUB-KE-' || substr(m.order_ref, 5, 6), m.seller, 'Monthly',
       case when m.order_ref = 'ORD-770415' then date '2026-06-30' else null end,
       null, m.currency
  from ke_order_money m
 where m.model = 'monthly';

/* --------------------------------------------------------------- refunds --- */

insert into refunds (id, order_ref, product_id, item, category_id, partner_id, seller,
                     first_party, bundle_ref, customer, buyer_type, user_id, amount,
                     refunded, currency, reason, detail, evidence, requested, decider,
                     sla_due, state, decided_on, decided_by, decision_note, sort_order, account_id)
select 'RFN-KE-01', m.order_ref, m.product_id, m.product_name, m.category_id, p.partner_id, m.seller,
       p.partner_id is null, null, 'Wanjiru Kamau', 'consumer',
       '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', m.total, m.total, m.currency,
       'faulty',
       'The charger stopped delivering above 10 W after three weeks. It warms up and the handset falls back to slow charging.',
       'Photographs of the charger and a screen recording of the charging rate',
       '2025-11-28', 'seller', '2025-11-30', 'refunded', '2025-11-29',
       'Amara Okonkwo (Kestrel Devices)',
       'Fault accepted. Refunded in full to the M-Pesa number the order was paid from; the unit did not need to come back.',
       1, null
  from ke_order_money m join products p on p.id = m.product_id
 where m.order_ref = 'ORD-770603';

/* The dollar refund. The money goes back in the currency it was taken in —
   refunding a $14.50 purchase in shillings would hand the customer a rate
   nobody agreed to. */
insert into refunds (id, order_ref, product_id, item, category_id, partner_id, seller,
                     first_party, bundle_ref, customer, buyer_type, user_id, amount,
                     refunded, currency, reason, detail, evidence, requested, decider,
                     sla_due, state, decided_on, decided_by, decision_note, sort_order, account_id)
select 'RFN-KE-02', m.order_ref, m.product_id, m.product_name, m.category_id, p.partner_id, m.seller,
       p.partner_id is null, null, 'Wanjiru Kamau', 'consumer',
       '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', m.total, m.total, m.currency,
       'not-activated',
       'The eSIM would not attach to any network in Kigali. Support confirmed the plan does not cover Rwanda despite the listing naming East Africa.',
       'Screenshots of the failed attachment and the support transcript',
       /* The marketplace decides its own listings: `refunds_party_check`
          refuses `seller` on a first-party product, and this one is Aventa's. */
       '2026-07-31', 'marketplace', '2026-08-04', 'refunded', '2026-08-01',
       'Aventa care desk',
       'The listing overstated the footprint. Refunded in full in dollars, the currency it was bought in, and the listing has gone back to the catalogue desk.',
       2, null
  from ke_order_money m join products p on p.id = m.product_id
 where m.order_ref = 'ORD-771644';

/* --------------------------------------------------------------- reviews --- */

insert into product_reviews (id, product_id, rating, title, body, author, submitted, status,
                             reply_by, reply_at, reply_text, user_id)
values
  ('REV-KE-01', 'SKU-4001', 5,
   'Held a charge through a Nairobi–Kisumu round trip',
   'Two days off the charger with maps running most of the way. The in-box charger is slow, so budget for the 45 W one, but the handset itself has been faultless since June.',
   'Wanjiru Kamau', '2026-07-04', 'published',
   'Kestrel Devices', '2026-07-06',
   'Glad it is holding up. The 45 W unit is the one to pair it with — thank you for saying so plainly.',
   '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'),
  ('REV-KE-02', 'SKU-4004', 4,
   'Covers a three-bedroom flat, one dead corner',
   'The mesh reaches the balcony and the kitchen, which the old router never did. The back bedroom still drops on video calls — a fourth node would fix it and there is no way to buy one on its own here.',
   'Wanjiru Kamau', '2026-04-02', 'published',
   null, null, null,
   '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'),
  ('REV-KE-03', 'SKU-2003', 2,
   'Does not work in Rwanda, whatever the listing says',
   'Bought it for a week in Kigali on the strength of "East Africa" in the description. It never attached. Refunded without argument, which is why this is two stars and not one.',
   'Wanjiru Kamau', '2026-08-01', 'published',
   'Aventa Telecom', '2026-08-03',
   'You are right and the listing was wrong. The footprint now names the countries one by one, and the refund should already be with you.',
   '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13');

/* -------------------------------------------------------------- support --- */

insert into support_tickets (id, subject, category, priority, status, opened_by, org, owner,
                             opened_at, sla_mins, response_mins, resolution_mins, breached,
                             escalated, waiting_on_customer, messages, sort_order, persona,
                             account_id, partner_id, user_id, ref, channel, resolved_at,
                             resolution_note)
values
  ('tk-ke-001', 'Mesh node dropped off the network after a power cut', 'technical', 'P3', 'resolved',
   'Wanjiru Kamau', 'Consumer', 'Grace Wanjala',
   timestamptz '2026-04-18 09:12:00+03', 1440, 38, 610, false, false, false,
   '[{"who": "Wanjiru Kamau", "text": "Third node has not come back since Tuesday''s outage. The other two are fine.", "when": "2026-04-18 09:12"},
     {"who": "Grace Wanjala", "text": "That node needs re-pairing after a hard power loss. Sending the three-step reset.", "when": "2026-04-18 09:50"},
     {"who": "Wanjiru Kamau", "text": "Back on, thank you.", "when": "2026-04-18 19:22"}]'::jsonb,
   1, 'consumer', null, null, '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13',
   'ORD-770944', 'Consumer app', timestamptz '2026-04-18 19:22:00+03',
   'Re-paired after a power loss. Sent the reset steps for next time.'),
  ('tk-ke-002', 'Handset delivery three days late with no update', 'delivery', 'P2', 'resolved',
   'Wanjiru Kamau', 'Consumer', 'Peter Mwangi',
   timestamptz '2026-06-22 07:40:00+03', 480, 21, 205, false, false, false,
   '[{"who": "Wanjiru Kamau", "text": "Tracking has said ''in transit'' since Friday. It was due Saturday.", "when": "2026-06-22 07:40"},
     {"who": "Peter Mwangi", "text": "The courier missed the Westlands run twice. Rebooked for today before noon and I have put credit on the account for the trouble.", "when": "2026-06-22 08:01"},
     {"who": "Wanjiru Kamau", "text": "Arrived. Appreciated.", "when": "2026-06-22 11:05"}]'::jsonb,
   2, 'consumer', null, null, '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13',
   'ORD-771339', 'Consumer app', timestamptz '2026-06-22 11:05:00+03',
   'Courier missed the run twice. Rebooked and KES 800 goodwill credited.');

insert into stock_watch (id, product_id, channel, to_address, since, notified_at, user_id)
values
  ('WCH-KE-01', 'SKU-4005', 'SMS', '+254 722 481 903', '2026-06-30', null,
   '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13')
on conflict (id) do nothing;

/* ---------------------------------------------------------------- points --- */

/* Earned at the shilling rate — a point per hundred — times her tier's
   multiplier, on the net rather than the tax. Dollar orders earn at the dollar
   rate, which is why the rate is joined per order rather than assumed. */
insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id, funder,
                            seller_id, value, note, user_id, currency)
select 'LTX-KE-' || substr(m.order_ref, 5, 6), 'LM-4030',
       to_char(m.on_date, 'DD Mon YYYY'), 'earn',
       floor(m.net * r.earn_per_unit * t.multiplier), m.order_ref, 'ERN-01', 'operator',
       null, floor(m.net * r.earn_per_unit * t.multiplier),
       format('%s — %s %s at %sx Silver', m.product_name, m.currency,
              to_char(m.net, 'FM999999990.00'), t.multiplier),
       '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', m.currency
  from ke_order_money m
  join loyalty_point_rates r on r.currency = m.currency
  join loyalty_tiers t on t.id = 'silver' and t.kind = 'consumer'
 where m.status <> 'refunded';

/* Points go back with the money. A refund that left the points behind would
   pay the customer twice for a purchase they no longer have. */
insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id, funder,
                            seller_id, value, note, user_id, currency)
select 'LTX-KE-RV' || substr(m.order_ref, 5, 6), 'LM-4030',
       to_char(f.decided_on::date, 'DD Mon YYYY'), 'reverse',
       -floor(m.net * r.earn_per_unit * t.multiplier), m.order_ref, 'ERN-01', 'operator',
       null, floor(m.net * r.earn_per_unit * t.multiplier),
       format('%s refunded — points went back with the money', m.product_name),
       '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', m.currency
  from ke_order_money m
  join refunds f on f.order_ref = m.order_ref
  join loyalty_point_rates r on r.currency = m.currency
  join loyalty_tiers t on t.id = 'silver' and t.kind = 'consumer'
 where m.status = 'refunded';

/* Earned on the refunded orders too, and then reversed — otherwise the reversal
   above takes back points that were never given. */
insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id, funder,
                            seller_id, value, note, user_id, currency)
select 'LTX-KE-E' || substr(m.order_ref, 5, 6), 'LM-4030',
       to_char(m.on_date, 'DD Mon YYYY'), 'earn',
       floor(m.net * r.earn_per_unit * t.multiplier), m.order_ref, 'ERN-01', 'operator',
       null, floor(m.net * r.earn_per_unit * t.multiplier),
       format('%s — %s %s at %sx Silver', m.product_name, m.currency,
              to_char(m.net, 'FM999999990.00'), t.multiplier),
       '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', m.currency
  from ke_order_money m
  join loyalty_point_rates r on r.currency = m.currency
  join loyalty_tiers t on t.id = 'silver' and t.kind = 'consumer'
 where m.status = 'refunded';

/* The redemption that put the KES 1,200 of credit in her wallet, and the
   goodwill the late delivery earned. Both already appear on the wallet
   statement; this is the other side of the same two events. */
insert into loyalty_ledger (id, member, when_date, type, points, ref, rule_id, funder,
                            seller_id, value, note, user_id, currency)
values
  ('LTX-KE-RDM1', 'LM-4030', '21 Apr 2026', 'redeem', -1200, 'RDM-KE-01', null, 'operator',
   null, 1200, 'Redeemed for wallet credit — KES 1,200',
   '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'KES'),
  ('LTX-KE-BON1', 'LM-4030', '22 Jun 2026', 'bonus', 250, 'tk-ke-002', null, 'operator',
   null, 250, 'Goodwill points alongside the credit for the late handset',
   '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'KES');

/* Her balance is the ledger, not a number somebody typed beside it. */
update loyalty_members m set
  balance = (select coalesce(sum(l.points), 0) from loyalty_ledger l where l.member = m.id),
  lifetime_earned = (select coalesce(sum(l.points), 0) from loyalty_ledger l
                      where l.member = m.id and l.points > 0),
  lifetime_redeemed = (select coalesce(-sum(l.points), 0) from loyalty_ledger l
                        where l.member = m.id and l.type = 'redeem'),
  qualify_12m = (select coalesce(sum(o.subtotal), 0) from orders o
                  where o.user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'
                    and o.currency = 'KES' and o.status <> 'refunded'
                    and o.created_at >= date '2025-08-05'),
  last_activity = '02 Aug 2026'
 where m.id = 'LM-4030';

/* ----------------------------------------------------------------- bills --- */

/* One bill per currency per period, because a bill carries one currency. The
   month she bought in dollars therefore has two — which is the model working,
   not a duplicate. */
create temporary table ke_bill (
  id text primary key, period text, issued text, due text, currency text,
  plan_charge numeric, subs numeric, oneoff numeric, status text, paid_on text, pages integer,
  month date
) on commit drop;

insert into ke_bill values
  ('BILL-449288-2026-03-KES', 'March 2026',  '01 Apr 2026', '15 Apr 2026', 'KES', 1981.90, 3101.73, 25861.21, 'paid', '09 Apr 2026', 5, date '2026-03-01'),
  ('BILL-449288-2026-04-KES', 'April 2026',  '01 May 2026', '15 May 2026', 'KES', 1981.90, 3101.73,     0.00, 'paid', '07 May 2026', 3, date '2026-04-01'),
  ('BILL-449288-2026-05-KES', 'May 2026',    '01 Jun 2026', '15 Jun 2026', 'KES', 1981.90, 3876.73,     0.00, 'paid', '11 Jun 2026', 3, date '2026-05-01'),
  ('BILL-449288-2026-06-KES', 'June 2026',   '01 Jul 2026', '15 Jul 2026', 'KES', 1981.90, 3876.73, 81895.69, 'paid', '10 Jul 2026', 6, date '2026-06-01'),
  ('BILL-449288-2026-07-KES', 'July 2026',   '01 Aug 2026', '15 Aug 2026', 'KES', 1981.90, 4608.63,     0.00, 'open', null,          4, date '2026-07-01'),
  /* The same month in dollars: the travel eSIM and the cloud gaming
     subscription were both bought in USD, so they are collected in USD. */
  ('BILL-449288-2026-07-USD', 'July 2026',   '01 Aug 2026', '15 Aug 2026', 'USD',    0.00,    8.61,    12.50, 'open', null,          2, date '2026-07-01');

insert into consumer_bills (id, period, issued, due, plan_charge, subscriptions, oneoff,
                            tax, total, status, paid_on, pages, user_id, tax_rate,
                            market, currency, fx_rate, fx_as_of)
select b.id, b.period, b.issued, b.due, b.plan_charge, b.subs, b.oneoff,
       round((b.plan_charge + b.subs + b.oneoff) * 0.16, 2),
       round((b.plan_charge + b.subs + b.oneoff) * 1.16, 2),
       b.status, b.paid_on, b.pages, '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 16,
       'KE', b.currency,
       /* What a shilling bill is worth in the marketplace's reporting currency,
          at the rate that was in force when it was struck. A dollar bill needs
          no conversion, and a rate of anything but 1 on one would be a fiction. */
       case when b.currency = 'USD' then 1
            else (select fx.rate from fx_rates fx
                   where fx.base = 'USD' and fx.quote = 'KES' and fx.as_of = b.month) end,
       b.month
  from ke_bill b;

/* ------------------------------------------------------------ her record --- */

insert into consumer_audit_log (id, when_date, action, label, category, severity, detail, user_id)
values
  ('CAL-KE-01', '2025-02-11', 'account.opened',   'Account opened',           'Account',  'info',
   'Line activated on the Freedom 50 GB plan after the identity check cleared.', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'),
  ('CAL-KE-02', '2025-02-11', 'household.added',  'Otieno Kamau added',       'Household','info',
   'Added as an adult member with a KES 6,000 monthly cap.', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'),
  ('CAL-KE-03', '2025-09-02', 'household.added',  'Amina Kamau added',        'Household','info',
   'Added as a young person with a KES 2,500 monthly cap and purchase approval on.', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'),
  ('CAL-KE-04', '2026-04-03', 'security.password','Password changed',         'Security', 'info',
   'Changed from the account settings after a routine prompt. All other sessions were signed out.', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'),
  ('CAL-KE-05', '2026-04-03', 'prefs.updated',    'Notification choices changed','Account','info',
   'Turned off the alert for household purchase requests. Everything mandatory stayed on.', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'),
  ('CAL-KE-06', '2026-07-18', 'payment.failed',   'A top-up did not complete','Billing',  'warning',
   'M-Pesa did not answer the PIN prompt within the window. Nothing was charged and the wallet was not credited.', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'),
  ('CAL-KE-07', '2026-08-01', 'refund.decided',   'Travel eSIM refunded',     'Billing',  'info',
   'Refunded in full in US dollars, the currency the order was placed in.', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13');

do $$
declare
  n integer; r record; kes numeric; usd numeric;
begin
  /* ---- the point of the exercise: she really does trade in two currencies */
  select count(distinct currency) into n from orders
   where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13';
  if n <> 2 then raise exception 'She trades in % currencies, and the whole point was two', n; end if;

  select count(*) into n from orders
   where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13' and currency not in ('KES', 'USD');
  if n > 0 then raise exception '% of her orders are in a currency Kenya does not take', n; end if;

  select count(distinct currency) into n from consumer_bills
   where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13';
  if n <> 2 then raise exception 'Her bills only ever come in % currency', n; end if;

  select count(*) into n from subscriptions
   where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13' and currency = 'USD';
  if n < 1 then raise exception 'Nothing she subscribes to is billed in dollars'; end if;

  /* Every currency she touches is one Kenya actually trades in. Checked against
     `market_currencies` rather than a list here, so opening a fourth currency
     does not silently make this assertion wrong. */
  for r in
    select distinct o.currency from orders o
     where o.user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'
       and not exists (select 1 from market_currencies mc
                        where mc.market_code = 'KE' and mc.currency = o.currency)
  loop
    raise exception 'She was billed in %, which the Kenyan market does not take', r.currency;
  end loop;

  /* ---- the money adds up */
  for r in
    select order_ref, total, subtotal, tax, round(subtotal + tax, 2) as sum
      from orders where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'
       and round(subtotal + tax, 2) is distinct from total
  loop
    raise exception 'Order % totals % but its net and tax come to %', r.order_ref, r.total, r.sum;
  end loop;

  /* Tax was worked out of the price at Kenya's rate, not added on top of it. */
  for r in
    select order_ref, subtotal, total, round(total / 1.16, 2) as expected
      from orders where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'
       and subtotal is distinct from round(total / 1.16, 2)
  loop
    raise exception 'Order % nets % where 16%% VAT out of % is %',
      r.order_ref, r.subtotal, r.total, r.expected;
  end loop;

  /* Each order's total is the catalogue price in the currency it was sold in.
     This is what stops the seed drifting the day somebody reprices something. */
  for r in
    select o.order_ref, o.total, o.currency, pp.price
      from orders o
      join order_items oi on oi.order_id = o.id
      join product_prices pp on pp.product_id = oi.product_id and pp.currency = o.currency
     where o.user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'
       and o.total is distinct from round(pp.price * oi.quantity, 2)
  loop
    raise exception 'Order % is % % against a catalogue price of %',
      r.order_ref, r.total, r.currency, r.price;
  end loop;

  /* Bills add up the same way, and a dollar bill is not converted. */
  for r in
    select id, total, round((plan_charge + subscriptions + oneoff) * 1.16, 2) as expected
      from consumer_bills where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'
       and total is distinct from round((plan_charge + subscriptions + oneoff) * 1.16, 2)
  loop
    raise exception 'Bill % totals % where its lines plus VAT come to %', r.id, r.total, r.expected;
  end loop;

  select count(*) into n from consumer_bills
   where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13' and currency = 'USD' and fx_rate <> 1;
  if n > 0 then raise exception 'A dollar bill was converted into dollars at a rate other than 1'; end if;

  select count(*) into n from consumer_bills b
   where b.user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13' and b.currency = 'KES'
     and not exists (select 1 from fx_rates fx where fx.base = 'USD' and fx.quote = 'KES'
                      and fx.as_of = b.fx_as_of and fx.rate = b.fx_rate);
  if n > 0 then raise exception '% shilling bills carry a rate that was not in force on their own date', n; end if;

  /* ---- everything else agrees with itself */
  select count(*) into n from orders o
   where o.user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'
     and not exists (select 1 from payment_attempts a where a.reference = o.payment_ref
                      and a.state = 'succeeded' and a.currency = o.currency);
  if n > 0 then raise exception '% of her orders were paid for by nothing, or in another currency', n; end if;

  select count(*) into n from payment_attempts a
   where a.user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'
     and not exists (select 1 from payment_method_markets pm
                      where pm.method_id = a.method_id and pm.market_code = 'KE');
  if n > 0 then raise exception '% of her payments used a rail Kenya does not offer', n; end if;

  /* A refund is in the currency the order was taken in. Refunding a dollar
     purchase in shillings hands the customer a rate nobody agreed to. */
  select count(*) into n from refunds f
    join orders o on o.order_ref = f.order_ref
   where f.user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'
     and (f.currency is distinct from o.currency or f.refunded is distinct from o.total);
  if n > 0 then raise exception '% refunds do not match the order they refund', n; end if;

  /* Her points are the sum of her own ledger. */
  select count(*) into n from loyalty_members m
   where m.id = 'LM-4030'
     and m.balance is distinct from (select coalesce(sum(l.points), 0) from loyalty_ledger l where l.member = m.id);
  if n > 0 then raise exception 'Her points balance is not the sum of her points ledger'; end if;

  select count(*) into n from loyalty_ledger
   where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13' and points > 0 and type = 'earn'
     and ref in (select order_ref from orders where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13');
  if n < 10 then raise exception 'Only % of her orders earned anything', n; end if;

  /* A refunded order's points came back with the money. */
  for r in
    select f.order_ref from refunds f
     where f.user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'
       and not exists (select 1 from loyalty_ledger l
                        where l.ref = f.order_ref and l.type = 'reverse')
  loop
    raise exception 'Order % was refunded and kept its points', r.order_ref;
  end loop;

  /* And the tier she is shown is the tier her spend earns. */
  select qualify_12m into kes from loyalty_members where id = 'LM-4030';
  select qualify_spend into usd from loyalty_tier_thresholds where tier_id = 'silver' and currency = 'KES';
  if kes < usd then
    raise exception 'She is Silver on a qualifying spend of % against a threshold of %', kes, usd;
  end if;
  select qualify_spend into usd from loyalty_tier_thresholds where tier_id = 'gold' and currency = 'KES';
  if kes >= usd then
    raise exception 'She has spent enough to be Gold and is shown as Silver'; end if;

  /* Nothing of hers leaked into the Indian shopper's account, or the reverse. */
  select count(*) into n from orders
   where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13' and market <> 'KE';
  if n > 0 then raise exception '% of her orders were placed in another market', n; end if;

  select count(*) into n from orders
   where user_id = 'd5a4012b-56dc-4ade-ab33-a00b55a5f32e' and (market <> 'IN' or currency <> 'INR');
  if n > 0 then raise exception 'The Indian shopper''s orders were disturbed'; end if;
end $$;
