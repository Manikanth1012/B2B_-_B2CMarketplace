/* What a customer who never filled in a form has to show for himself.
 *
 * Otieno Odhiambo came in through the second door: Aventa vouched for him and
 * the marketplace opened an account from the assertion. He was seeded as proof
 * that the door works and then left empty — one address, a zero wallet, a
 * bronze loyalty row with nothing in it. An account you cannot open a single
 * screen on is not a demo of anything.
 *
 * This gives him the two and a half years the profile already claims: eleven
 * orders, four running subscriptions and one cancelled, six bills, a wallet,
 * two ways to pay, a loyalty ledger that adds up to the balance rather than
 * asserting one, two tickets, a refund, two reviews, a household and an audit
 * trail.
 *
 * The part worth reading is the documents.
 *
 * A customer who registers here hands over proof of identity and proof of
 * address, and both are held as documents — Wanjiru Kamau has exactly those
 * two, CD-KE-002 and CD-KE-003. Otieno has neither, and that is not an
 * omission. The operator ran the identity check before it would activate a
 * line: National ID, verified 3 February 2024, and it said so in the
 * assertion. Collecting the same two documents again would mean storing a
 * second copy of somebody's national ID for no reason anybody could defend —
 * the whole argument for federating identity is that the check happens once,
 * where the regulator already requires it.
 *
 * So what he holds instead is a record of *what was asserted and by whom*, and
 * it says plainly that the underlying document is Aventa's and not ours. The
 * marketplace still collects what only the marketplace can have: its own terms,
 * countersigned, because an operator cannot agree to a marketplace's contract
 * on a customer's behalf. And everything his purchases generate — a warranty,
 * a policy schedule, a VAT statement — is his the same as anybody's.
 *
 * Every figure below is derived rather than typed. Order tax comes off the
 * catalogue price, which is VAT-inclusive in this market; points come off the
 * pre-tax subtotal; the loyalty balance and the twelve-month qualifying spend
 * are summed back out of the ledger. A seed with hand-typed totals is a seed
 * that disagrees with itself the first time somebody checks.
 */

begin;

do $$
declare
  uid   uuid := 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81';
  cus   text := 'CUS-450031';
  nm    text := 'Otieno Odhiambo';
  em    text := 'otieno.odhiambo@example.com';
  phone_no text := '+254 711 306 442';
  vat   numeric := 16;
  o     record;
  oid   uuid;
  sub   numeric;
  tx    numeric;
  pts   int;
  mult  numeric;
  bal   int;
  earned int;
  redeemed int;
  q12   numeric;
  usd   numeric;
  newtier text;
  n     int;
begin
  if not exists (select 1 from consumer_profile where user_id = uid) then
    raise exception 'Otieno has no profile — 20260806210000 has not run';
  end if;

  /* Clear anything an earlier run of this migration left, so it can be replayed
     without doubling his history. Scoped to him by user_id throughout. */
  delete from loyalty_ledger where user_id = uid;
  delete from order_items where user_id = uid;
  delete from orders where user_id = uid;
  delete from subscriptions where user_id = uid;
  delete from consumer_bills where user_id = uid;
  delete from consumer_documents where user_id = uid;
  delete from consumer_payment_methods where user_id = uid;
  delete from wallets where user_id = uid;
  delete from support_attachments where ticket_id in (select id from support_tickets where user_id = uid);
  delete from support_tickets where user_id = uid;
  delete from refunds where user_id = uid;
  delete from notification_preferences where user_id = uid;
  delete from consumer_household where user_id = uid;
  delete from product_reviews where user_id = uid;
  delete from consumer_audit_log where user_id = uid;
  delete from consumer_addresses where user_id = uid and id <> 'AD-450031';

  /* ---------------------------------------------------------------- orders --
     What he bought, when, and for how much. `total` is the catalogue price
     because a KES price in this catalogue is VAT-inclusive; the subtotal and
     the tax are worked back out of it rather than typed alongside it. */
  for o in
    select * from (values
      ('ORD-450101', date '2024-02-05', 'SKU-2002', 3499.00,  'delivered', 'mobile_money'),
      ('ORD-450102', date '2024-03-18', 'SKU-4003', 21999.00, 'delivered', 'mobile_money'),
      ('ORD-450103', date '2024-07-22', 'SKU-3001', 1699.00,  'delivered', 'mobile_money'),
      ('ORD-450104', date '2025-01-14', 'SKU-4004', 29999.00, 'delivered', 'card'),
      ('ORD-450105', date '2025-05-09', 'SKU-3007', 849.00,   'delivered', 'mobile_money'),
      ('ORD-450106', date '2025-09-02', 'SKU-4001', 94999.00, 'delivered', 'card'),
      ('ORD-450107', date '2025-09-02', 'SKU-2004', 899.00,   'delivered', 'mobile_money'),
      ('ORD-450108', date '2026-01-27', 'SKU-4008', 3699.00,  'refunded',  'mobile_money'),
      ('ORD-450109', date '2026-04-11', 'SKU-4006', 35999.00, 'delivered', 'card'),
      ('ORD-450110', date '2026-06-19', 'SKU-2003', 1899.00,  'delivered', 'mobile_money'),
      ('ORD-450111', date '2026-07-30', 'SKU-3004', 3199.00,  'processing','mobile_money')
    ) as v(ref, on_date, sku, total, status, pay)
  loop
    sub := round(o.total / (1 + vat / 100), 2);
    tx  := o.total - sub;
    oid := gen_random_uuid();

    insert into orders (
      id, order_ref, user_id, buyer_name, buyer_email, market, currency,
      subtotal, tax, tax_rate, discount, total, status, stage, stages,
      vertical, seller, payment_method, payment_ref, placed_date, created_at,
      failed, shipping_address
    )
    select
      oid, o.ref, uid, nm, em, 'KE', 'KES',
      sub, tx, vat, 0, o.total, o.status,
      case when o.status = 'processing' then 1 else 4 end,
      array['Ordered', 'Confirmed', 'Provisioning', 'Activating', 'Active'],
      p.category_id, p.seller, o.pay,
      'PAY-' || to_char(o.on_date, 'YYMMDD') || '-' || upper(substr(md5(o.ref), 1, 4)),
      to_char(o.on_date, 'DD Mon YYYY'),
      o.on_date + time '10:20', false,
      jsonb_build_object('address', 'Milimani Estate, Oginga Odinga Street',
                         'city', 'Kisumu', 'country', 'Kenya')
    from products p where p.id = o.sku;

    insert into order_items (id, order_id, user_id, product_id, product_name, quantity, price, status, fulfil)
    select gen_random_uuid(), oid, uid, p.id, p.name, 1, o.total,
           case when o.status = 'processing' then 'pending' else 'delivered' end,
           case when p.category_id = 'device' then 'ship'
                when p.category_id = 'content' then 'digital'
                else 'esim' end
    from products p where p.id = o.sku;

    /* ------------------------------------------------------------ loyalty --
       Earned on the pre-tax subtotal, floored, at the multiplier of the tier
       he held at the time. He was Bronze until the flagship handset in
       September 2025 took him past the Silver threshold. */
    mult := case when o.on_date >= date '2025-09-02' then 1.25 else 1.00 end;
    pts  := floor(sub * 0.01 * mult);

    if o.status <> 'processing' and pts > 0 then
      insert into loyalty_ledger (id, member, user_id, ref, type, points, value, currency, funder, rule_id, when_date, note, seller_id)
      select 'LTX-KE-' || right(o.ref, 6), 'LM-450031', uid, o.ref, 'earn', pts, pts, 'KES',
             case when p.partner_id is null then 'operator' else 'seller' end,
             'ERN-01', to_char(o.on_date, 'DD Mon YYYY'),
             p.name || ' — KES ' || to_char(sub, 'FM999999990.00') || ' at ' || mult || 'x',
             p.partner_id
      from products p where p.id = o.sku;
    end if;

    /* The charger came back. The reversal mirrors the earn rather than being
       a round number, because a point carries no currency and the only honest
       reversal is the one that was granted. */
    if o.status = 'refunded' and pts > 0 then
      insert into loyalty_ledger (id, member, user_id, ref, type, points, value, currency, funder, rule_id, when_date, note, seller_id)
      /* `value` is the money the points are worth, which is a positive amount
         whichever way the points themselves move. */
      values ('LTX-KE-' || right(o.ref, 6) || 'R', 'LM-450031', uid, o.ref, 'reverse', -pts, pts, 'KES',
              'seller', 'ERN-01', '02 Feb 2026',
              'Reversed with the refund on ' || o.ref, 'PTR-1002');
    end if;
  end loop;

  /* He spent some. A programme where nobody ever redeems is a liability nobody
     has tested paying out. */
  insert into loyalty_ledger (id, member, user_id, ref, type, points, value, currency, funder, rule_id, when_date, note)
  values ('LTX-KE-450031X', 'LM-450031', uid, 'ORD-450109', 'redeem', -900, 900, 'KES',
          'operator', 'RDM-01', '11 Apr 2026',
          'KES 900 off the Kestrel Tab 11 LTE');

  /* --------------------------------------------------------- subscriptions --
     Four running and one he stopped. The plan is the one Aventa told us he was
     on, which is why it starts the day the account was opened rather than the
     day he first went shopping. */
  insert into subscriptions (id, ref, user_id, product_id, product_name, seller, price, currency, cycle, status, auto_renew, started_at, next_renewal, ends_at)
  select gen_random_uuid(), v.ref, uid, p.id, p.name, p.seller, v.price, 'KES', 'Monthly',
         v.status, v.status = 'active', v.started, v.next, v.ends
  from (values
    ('SUB-KE-450101', 'SKU-2002', 3499.00, 'active',    timestamptz '2024-02-05', date '2026-09-05', null::date),
    ('SUB-KE-450103', 'SKU-3001', 1699.00, 'active',    timestamptz '2024-07-22', date '2026-08-22', null::date),
    ('SUB-KE-450105', 'SKU-3007', 849.00,  'active',    timestamptz '2025-05-09', date '2026-09-09', null::date),
    ('SUB-KE-450107', 'SKU-2004', 899.00,  'active',    timestamptz '2025-09-02', date '2026-09-02', null::date),
    ('SUB-KE-450112', 'SKU-3006', 1199.00, 'cancelled', timestamptz '2024-09-01', date '2026-03-01', date '2026-03-01')
  ) as v(ref, sku, price, status, started, next, ends)
  join products p on p.id = v.sku;

  /* ----------------------------------------------------------------- bills --
     Six months. The recurring charges are the running subscriptions; anything
     one-off is whatever he bought that month. Tax is worked off the total the
     same way the orders do it, so a bill and the orders behind it agree. */
  insert into consumer_bills (id, user_id, period, issued, due, status, paid_on, market, currency, fx_rate, fx_as_of, tax_rate, plan_charge, subscriptions, oneoff, tax, total, pages)
  select
    'BILL-450031-' || to_char(b.starts, 'YYYY-MM') || '-KES', uid,
    to_char(b.starts, 'FMMonth YYYY'),
    to_char(b.starts + interval '1 month', 'DD Mon YYYY'),
    to_char(b.starts + interval '1 month 14 days', 'DD Mon YYYY'),
    b.status,
    case when b.status = 'paid' then to_char(b.starts + interval '1 month 6 days', 'DD Mon YYYY') end,
    'KE', 'KES', f.rate, f.as_of, vat,
    round(3499.00 / (1 + vat / 100), 2),
    round((1699.00 + 849.00 + 899.00) / (1 + vat / 100), 2),
    round(b.oneoff / (1 + vat / 100), 2),
    round((3499.00 + 1699.00 + 849.00 + 899.00 + b.oneoff) * vat / (100 + vat), 2),
    3499.00 + 1699.00 + 849.00 + 899.00 + b.oneoff,
    b.pages
  from (values
    (date '2026-03-01', 0.00,     'paid', 3),
    (date '2026-04-01', 35999.00, 'paid', 5),
    (date '2026-05-01', 0.00,     'paid', 3),
    (date '2026-06-01', 0.00,     'paid', 3),
    (date '2026-07-01', 1899.00,  'paid', 4),
    (date '2026-08-01', 3199.00,  'open', 4)
  ) as b(starts, oneoff, status, pages)
  join lateral (
    select rate, as_of from fx_rates
     where base = 'USD' and quote = 'KES' and as_of <= b.starts
     order by as_of desc limit 1
  ) f on true;

  /* ------------------------------------------------------- how he pays -- */
  insert into consumer_payment_methods (id, user_id, kind, detail, holder, added, status, is_primary, expires) values
    ('PM-450031-1', uid, 'M-Pesa', phone_no, nm, '03 Feb 2024', 'active', true, null),
    ('PM-450031-2', uid, 'Visa',   '•••• 4417', nm, '14 Jan 2025', 'active', false, '09/28');

  /* `balance` is generated from cash + promo — the two are the record and the
     total is derived, so it cannot be written here. */
  insert into wallets (id, user_id, party, kind, name, currency, cash, promo, state, opened, last_move, note, sort_order)
  values ('WAL-4131', uid, cus, 'consumer', nm, 'KES', 6420, 900, 'active',
          '2024-02-03', '2026-07-30',
          'Opened with the account. Topped up from M-Pesa; the promo came from the Gold-for-a-month trial.', 131);

  /* A second address he typed himself. The first one came across from Aventa
     and says so — the difference is worth being able to see on the screen. */
  insert into consumer_addresses (id, user_id, label, line1, city, pin, phone, notes, is_default)
  values ('AD-450031-2', uid, 'Work', 'Kisumu Chamber of Commerce, Jomo Kenyatta Highway',
          'Kisumu', '40100', phone_no, 'Reception takes parcels until 5pm on weekdays.', false);

  /* ------------------------------------------------------------ documents --
     The point of this whole seed. See the header: no proof of identity and no
     proof of address, because Aventa did that check and said so. What is here
     instead is the assertion itself, and it says whose document it is. */
  insert into consumer_documents (id, user_id, name, kind, category, issued, detail, path, size, sort_order) values
    ('CD-KE-450031-01', uid, 'Marketplace terms — accepted', 'PDF', 'Account', '03 Feb 2024',
     'The marketplace''s own terms, accepted when the account was opened from your Aventa ID. An operator cannot agree to these on your behalf, so this is the one thing you did have to do here.',
     cus || '/cd-001.pdf', '0.4 MB', 1),
    ('CD-KE-450031-02', uid, 'Identity verified by Aventa ID', 'PDF', 'Account', '03 Feb 2024',
     'What Aventa asserted about you when the account was opened: a National ID ending 8842, checked on 3 February 2024. The document itself is held by Aventa and was never sent here — no proof of identity or proof of address was collected, because the operator had already verified both before it would activate a line.',
     cus || '/cd-002.pdf', '0.2 MB', 2),
    ('CD-KE-450031-03', uid, 'Kestrel K9 Pro 256 GB — warranty', 'PDF', 'Devices', '02 Sep 2025',
     'The manufacturer''s warranty as supplied with the handset. Twenty-four months, and it names what voids it.',
     cus || '/cd-003.pdf', '0.2 MB', 3),
    ('CD-KE-450031-04', uid, 'Device Protect policy schedule', 'PDF', 'Insurance', '02 Sep 2025',
     'What the cover pays for, what it excludes and the excess on each claim. Issued by Aegis Assurance, not by the marketplace.',
     cus || '/cd-004.pdf', '0.3 MB', 4),
    ('CD-KE-450031-05', uid, 'VAT statement 2025/26', 'PDF', 'Billing', '01 Jul 2026',
     'Every shilling of VAT charged across the tax year, per bill. What an accountant asks for and what the account holder never keeps.',
     cus || '/cd-005.pdf', '0.3 MB', 5);

  /* -------------------------------------------------------------- support --
     One closed the way the loop now closes — he was asked and he agreed — and
     one sitting on the second rung waiting for him, so the demo has something
     to press. */
  insert into support_tickets (
    id, subject, category, priority, status, persona, org, opened_by, owner, channel,
    user_id, ref, opened_at, sla_mins, response_mins, resolution_mins, breached, escalated,
    waiting_on_customer, waiting_minutes, resolved_at, resolution_note,
    confirm_due, confirmed_by, confirmed_at, closed_how, reopened, messages, sort_order
  ) values
    ('tk-ke-450031-1', 'Handset would not register on the network after the eSIM swap', 'service', 'P2',
     'closed', 'consumer', 'Consumer', nm, 'Grace Wanjala', 'Consumer app',
     uid, 'ORD-450106', timestamptz '2025-09-04 07:40', 480, 24, 196, false, false,
     false, 0, timestamptz '2025-09-04 11:16',
     'The profile had been provisioned against the old IMEI. Re-issued it against the new handset and it attached first time.',
     timestamptz '2025-09-07 11:16', nm, timestamptz '2025-09-05 06:02', 'confirmed', 0,
     jsonb_build_array(
       jsonb_build_object('who', nm, 'text', 'Moved the eSIM to the K9 Pro and it will not register. The old handset still works on the same profile.', 'when', '04 Sep 07:40'),
       jsonb_build_object('who', 'Grace Wanjala', 'text', 'The profile is bound to the previous IMEI. Re-issuing it now — you will get a new QR in about ten minutes.', 'when', '04 Sep 08:04'),
       jsonb_build_object('who', 'Grace Wanjala', 'text', 'The profile had been provisioned against the old IMEI. Re-issued it against the new handset and it attached first time.', 'when', '04 Sep 11:16'),
       jsonb_build_object('who', nm, 'text', 'Registered straight away. Thank you.', 'when', '05 Sep 06:02')
     ), 1),
    ('tk-ke-450031-2', 'Season Pass paid for but not showing in the PlayForge app', 'billing', 'P3',
     'resolved', 'consumer', 'Consumer', nm, 'Marketplace — Tier 1', 'Consumer app',
     uid, 'ORD-450111', timestamptz '2026-07-31 06:15', 1440, 51, 372, false, false,
     false, 0, timestamptz '2026-07-31 12:27',
     'PlayForge had the entitlement queued behind a payment check that had already cleared. Released it by hand and asked them to shorten the hold.',
     timestamptz '2026-08-03 12:27', null, null, null, 0,
     jsonb_build_array(
       jsonb_build_object('who', nm, 'text', 'Paid for the Season Pass yesterday. The order says processing and nothing has appeared in the game.', 'when', '31 Jul 06:15'),
       jsonb_build_object('who', 'Marketplace — Tier 1', 'text', 'Payment cleared on our side. Checking with PlayForge what is holding the entitlement.', 'when', '31 Jul 07:06'),
       jsonb_build_object('who', 'Marketplace — Tier 1', 'text', 'PlayForge had the entitlement queued behind a payment check that had already cleared. Released it by hand and asked them to shorten the hold.', 'when', '31 Jul 12:27')
     ), 2);

  /* --------------------------------------------------------------- refund -- */
  insert into refunds (
    id, order_ref, product_id, item, category_id, partner_id, seller, first_party,
    customer, buyer_type, user_id, amount, refunded, currency, reason, detail, evidence,
    requested, decider, sla_due, state, decided_on, decided_by, decision_note, sort_order
  ) values (
    'RFN-KE-450031', 'ORD-450108', 'SKU-4008', 'Kestrel 45 W GaN charger', 'device', 'PTR-1002',
    'Kestrel Devices', false, nm, 'consumer', uid, 3699, 3699, 'KES', 'faulty',
    'It charges at full rate for about a minute and then drops to trickle. Two different cables, same result, and the brick gets hot enough to be uncomfortable.',
    'A photograph of the charger and a screen recording of the charging rate falling away',
    '2026-01-31', 'seller', '2026-02-02', 'refunded', '2026-02-02',
    'Amara Okonkwo (Kestrel Devices)',
    'Known fault in that production run. Refunded in full to the M-Pesa number the order was paid from; the unit did not need to come back.',
    2);

  /* ------------------------------------------------------------- the rest -- */
  insert into notification_preferences (id, user_id, rule_id, scope, kinds, enabled, updated_on)
  select 'NP-450031-' || r.rule_id, uid, r.rule_id, 'user', r.kinds, r.on_off, '2026-02-11'
  /* Four of these are mandatory — `guard_preference` refuses to switch off a
     refund decision or a security alert, and only lets you choose where it
     reaches you. So the two he has turned off are the two he is allowed to,
     which is the honest shape of this screen rather than eight free toggles. */
  from (values
    ('NR-C1', array['push','sms'],         true),
    ('NR-C2', array['push','sms','email'], true),
    ('NR-C3', array['push','email'],       true),
    ('NR-C4', array['email'],              true),
    ('NR-C5', array['push'],               false),
    ('NR-C6', array['email'],              false),
    ('NR-C7', array['push','email'],       true),
    ('NR-C8', array['push','email'],       true)
  ) as r(rule_id, kinds, on_off);

  insert into consumer_household (id, user_id, name, email, role_id, role_name, status, joined, is_you, mfa, spent, cap, last_active) values
    ('CU-KE-450031-1', uid, nm, em, 'CO-OWNER', 'Account owner', 'active', '03 Feb 2024', true, false, 0, null, 'Now'),
    ('CU-KE-450031-2', uid, 'Achieng Odhiambo', 'achieng.odhiambo@example.com', 'CO-ADULT', 'Adult', 'active', '01 Sep 2024', false, false, 4398, 6000, '2 days ago');

  insert into product_reviews (id, user_id, product_id, author, rating, title, body, status, submitted, reply_by, reply_at, reply_text) values
    ('REV-KE-450031-1', uid, 'SKU-4001', nm, 5,
     'Two days of real use on one charge',
     'Came from the K7 and expected the usual half-day. It holds a full working day and most of the next on the coverage out here, which is patchy enough to punish a bad radio. The camera in low light is the other surprise.',
     'published', '2025-09-20', null, null, null),
    ('REV-KE-450031-2', uid, 'SKU-4008', nm, 2,
     'Full rate for a minute, then trickle',
     'Charges properly for about sixty seconds and then falls back to trickle, and the brick runs hot. Two cables, same result. Refunded without argument, which is the only reason this is two stars.',
     'published', '2026-02-03', 'Kestrel Devices', '2026-02-05',
     'You caught a bad production run and we have pulled that batch. The refund went back the same day and we are sorry for the trouble.');

  insert into consumer_audit_log (id, user_id, when_date, action, label, detail, category, severity) values
    ('CAL-KE-450031-01', uid, '2024-02-03', 'account.opened_via_sso', 'Account opened from your Aventa ID',
     'Aventa vouched for your name, number, address and verified identity, and the marketplace opened an account from it. Nothing was filled in here, and no proof of identity or address was collected — Aventa had already checked both.', 'Account', 'info'),
    ('CAL-KE-450031-02', uid, '2024-02-05', 'order.placed', 'Freedom Unlimited carried across',
     'The plan Aventa said you were on became a marketplace subscription on the same terms.', 'Orders', 'info'),
    ('CAL-KE-450031-03', uid, '2025-09-02', 'rewards.tier_changed', 'Moved to Silver',
     'Trailing twelve-month spend passed the Silver threshold for Kenya. Points now earn at 1.25x.', 'Rewards', 'info'),
    ('CAL-KE-450031-04', uid, '2026-01-14', 'payment.method_added', 'Card added',
     'A Visa ending 4417 was added alongside M-Pesa. M-Pesa stays the primary.', 'Billing', 'info'),
    ('CAL-KE-450031-05', uid, '2026-02-02', 'refund.settled', 'Charger refunded in full',
     'Kestrel Devices accepted the fault on RFN-KE-450031 and returned KES 3,699 to the M-Pesa number that paid.', 'Billing', 'info'),
    ('CAL-KE-450031-06', uid, '2026-04-11', 'rewards.redeemed', '900 points spent',
     'KES 900 off the Kestrel Tab 11 LTE.', 'Rewards', 'info'),
    ('CAL-KE-450031-07', uid, '2026-07-31', 'support.raised', 'Ticket raised about the Season Pass',
     'tk-ke-450031-2. The marketplace has answered and is waiting for you to say whether it is fixed.', 'Account', 'info');

  /* --------------------------------------------------- what it all adds to --
     Summed back out of the ledger rather than asserted, so the balance on the
     rewards screen is the balance the transactions produce. */
  select coalesce(sum(points), 0),
         coalesce(sum(points) filter (where type = 'earn'), 0),
         abs(coalesce(sum(points) filter (where type = 'redeem'), 0))
    into bal, earned, redeemed
    from loyalty_ledger where user_id = uid;

  /* Qualifying spend is the money behind the earns of the last twelve months,
     which is the spend, not the points. */
  /* Aliased `ord`, not `o`: the loop variable above is a record called `o` and
     it shadows a table alias of the same name, so `o.subtotal` resolves
     against the record and the query fails on a field it does not have. */
  select coalesce(sum(round(ord.subtotal, 2)), 0) into q12
    from orders ord
   where ord.user_id = uid
     and ord.status not in ('processing', 'refunded')
     and ord.created_at >= date '2025-08-06';

  select rate into usd from fx_rates
   where base = 'USD' and quote = 'KES' order by as_of desc limit 1;

  select t.id into newtier from loyalty_tiers t
   where t.kind = 'consumer' and t.qualify_spend <= q12 / usd
   order by t.qualify_spend desc limit 1;

  update loyalty_members set
    tier = newtier, balance = bal, lifetime_earned = earned, lifetime_redeemed = redeemed,
    qualify_12m = q12, last_activity = '30 Jul 2026', expiring_on = '31 Mar 2028', expiring_soon = 0
  where user_id = uid;

  update consumer_profile set
    wallet = '7320', payment_method = 'M-Pesa ' || phone_no, active_sessions = 2
  where user_id = uid;

  /* ------------------------------------------------------------ assertions -- */

  /* The documents are the reason this migration exists. If a proof-of-identity
     or proof-of-address document ever appears against him, the federation
     story has quietly been undone and somebody is storing a second copy of a
     national ID for no reason. */
  select count(*) into n from consumer_documents
   where user_id = uid and (name ilike '%proof of identity%' or name ilike '%proof of address%');
  if n <> 0 then
    raise exception 'a federated customer is holding % KYC document(s) the operator had already verified', n;
  end if;

  if not exists (select 1 from consumer_documents where user_id = uid and name = 'Identity verified by Aventa ID') then
    raise exception 'the assertion that stands in for those documents is missing';
  end if;

  /* And the customer this is all about must still be the federated one. */
  if (select identity_source from consumer_profile where user_id = uid) <> 'telco-sso' then
    raise exception 'Otieno is no longer marked as having come in through SSO';
  end if;

  /* Every order's tax comes off its own total. */
  select count(*) into n from orders
   where user_id = uid and round(subtotal + tax, 2) <> round(total, 2);
  if n <> 0 then raise exception '% order(s) do not add up', n; end if;

  /* The balance is the ledger, and the ledger never went negative. */
  if bal <> earned - redeemed - (select abs(coalesce(sum(points), 0)) from loyalty_ledger where user_id = uid and type = 'reverse') then
    raise exception 'the loyalty balance is not what the ledger says';
  end if;
  if bal < 0 then raise exception 'he has spent points he never earned'; end if;

  /* The tier was derived, not chosen. */
  if newtier is null then raise exception 'no tier matched the qualifying spend'; end if;

  /* Something on every screen the account menu offers. */
  if (select count(*) from orders where user_id = uid) <> 11 then raise exception 'wrong number of orders'; end if;
  if (select count(*) from subscriptions where user_id = uid) <> 5 then raise exception 'wrong number of subscriptions'; end if;
  if (select count(*) from consumer_bills where user_id = uid) <> 6 then raise exception 'wrong number of bills'; end if;

  /* One ticket parked on the second rung, so the consent loop has something to
     demonstrate rather than only something to describe. */
  if not exists (select 1 from support_tickets where user_id = uid and status = 'resolved') then
    raise exception 'no ticket is waiting for him to confirm';
  end if;

  raise notice 'Otieno: % points, tier %, KES % qualifying, % orders',
    bal, newtier, round(q12), (select count(*) from orders where user_id = uid);
end $$;

commit;
