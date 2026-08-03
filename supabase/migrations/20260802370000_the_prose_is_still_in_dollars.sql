-- Every sentence on the marketplace that still quotes a dollar figure.
--
-- `20260802310000_every_text_column_not_the_ones_i_remembered.sql` swept the
-- stored prose and reported clean. It walked `information_schema.columns` — the
-- right technique — but only for tables named `enterprise\_%`, so it proved
-- something true about a tenth of the schema and nothing at all about the rest.
-- A sweep whose range is a `like` pattern is a hand-written list with extra
-- steps.
--
-- Run over every text column in `public`, it finds twenty-one places: a product
-- tag reading "Save $7" on a shelf priced in rupees, six loyalty tier notes
-- quoting a threshold the per-currency table contradicts, five lines of Priya
-- Raman's own account history, eighteen notifications, three product
-- descriptions, four banners, and the two refund notes this series wrote itself
-- two migrations ago.
--
-- Not all of them are wrong. A seller settlement genuinely is in dollars — the
-- marketplace pays out in its reporting currency and that is task #43, not this
-- one — so `commission_plans.fees`, the partner statement messages and the
-- wholesale rate cards keep their dollar signs and are named below as
-- deliberate rather than missed. The distinction the sweep cannot make is the
-- one worth writing down: a figure quoted TO a customer is in the customer's
-- money, and a figure quoted to a seller about their own payout is in the
-- payout's.
--
-- Figures are looked up wherever a row holds them. "Kestrel K7 handset —
-- $389.00 returned" becomes ₹14,999 because that is what RFN-3201 now says, not
-- because 389 × 87.42 is close to it. Where nothing holds the figure — a
-- banner, a promotion — it is chosen: a round number in the default market's
-- money.

/* =============================================== the shelf a customer sees === */

/* A tag that names a saving is a price in a field with no currency on it, and
   it is the only one of these visible before signing in. The saving is already
   computed and rendered from `was_price` on the card and on the detail page, so
   the figure here was a second copy that could only ever go stale. */
update products
   set tags = array_replace(tags, 'Save $7', 'Save on the pair')
 where 'Save $7' = any(tags);

/* Sums insured, excesses and overage rates. These are per-market figures living
   in a single shared string, which is a shape that cannot be right in three
   markets at once. Restated into the default market's money — every retail
   customer on this marketplace is in it — and recorded as the compromise it is:
   the honest fix is a description per market, which is its own task. */
update products set description =
  'Single-trip medical and baggage cover up to ₹2 crore, bought alongside a travel eSIM.'
 where id = 'SKU-2005';

update products set description =
  'Accidental damage, screen repair and theft cover for one handset. Two claims per year, ₹4,000 excess.'
 where id = 'SKU-2004';

update products set description =
  '50 GB of pooled data shared across the whole estate, with 200 GB of in-country storage for what it reports. Overage runs at ₹95 a GB.'
 where id = 'SKU-FP9504';

update telco_catalogue set spec = '50 GB shared across the estate, overage ₹95/GB'
 where id = 'TP-IOT-POOL';

/* Banners, on the storefront and in the operator's copy of them. Both tables
   hold the same text and both are updated — the operator screen edits one and
   the shop reads the other, so fixing one leaves the marketplace disagreeing
   with itself about what it is advertising. */
do $$
declare t text;
begin
  foreach t in array array['public_banners', 'operator_banners'] loop
    execute format($f$
      update %I set title = 'Add a second line for ₹299 a month' where id = 'bn-008';
      update %I set title = 'Cover your handset from ₹599 a month' where id = 'bn-009';
      update %I set subtitle = 'Managed detection and response from ₹1,29,000/mo' where id = 'bn-005';
    $f$, t, t, t);
  end loop;
end $$;

update operator_promotions set description = '₹20,000 off IoT orders over ₹1,00,000'
 where id = 'promo-002';

/* ============================================ the tiers, which have a table === */

/* Six notes each quoting one threshold, next to a `loyalty_tier_thresholds`
   table that holds four figures per tier. The note cannot be right in more than
   one currency, and the screen already renders the right one from the table —
   so the note stops naming a figure and says what the tier means instead. */
update loyalty_tiers set note = 'Reached at the qualifying spend shown for your market, over a rolling twelve months.'
 where id in ('org-silver', 'silver');
update loyalty_tiers set note = 'Reached at the qualifying spend shown for your market. Most multi-site accounts sit here.'
 where id = 'org-gold';
update loyalty_tiers set note = 'Reached at the qualifying spend shown for your market. Held for a full year after it is earned, so one quiet quarter does not cost the benefits.'
 where id = 'org-platinum';
update loyalty_tiers set note = 'Reached on the qualifying spend shown for your market.'
 where id = 'gold';
update loyalty_tiers set note = 'Reached on the qualifying spend shown for your market. The top tier for a personal account.'
 where id = 'platinum';

/* ================================= one customer's own history of herself === */

/* Each of these is restated from the row that holds the figure rather than from
   the rate. An audit line that disagrees with the refund it describes is worse
   than one in the wrong currency: the wrong currency is a labelling mistake, a
   disagreement is two records of one event. */
update consumer_audit_log a set detail = x.said
  from (
    select 'AUD-CU-9001' as id,
           i.product_name || ' — ' || money_text(i.price * i.quantity, o.currency) as said
      from orders o join order_items i on i.order_id = o.id where o.order_ref = 'ORD-881433'
    union all
    select 'AUD-CU-9005',
           'Kestrel K7 handset — ' || money_text(r.amount, r.currency) || ' returned'
      from refunds r where r.id = 'RFN-3201'
    union all
    /* 1,500 points at the rate for her currency, which is the same arithmetic
       `redeem_points` does. A point is a rupee back, so this is ₹1,500. */
    select 'AUD-CU-9002',
           money_text(1500 / p.per_unit, p.currency) || ' added to wallet'
      from loyalty_point_rates p
      join consumer_profile c on c.currency = p.currency where c.id = 'me'
    union all
    select 'AUD-CU-9009',
           'StreamNova Media — ' || money_text(2400 / p.per_unit, p.currency)
      from loyalty_point_rates p
      join consumer_profile c on c.currency = p.currency where c.id = 'me'
    union all
    select 'AUD-CU-9010',
           'Role: Young person, cap ' || money_text(h.cap, c.currency) || '/month'
      from consumer_household h join consumer_profile c on c.user_id = h.user_id
     where h.name = 'Aditi Raman'
  ) x
 where a.id = x.id;

/* ==================================================== the notifications === */

/* Consumer and enterprise notifications are quotes to a customer, so they are
   in the customer's money. Partner and operator ones are about settlements,
   which are dollars, and are left — except the two that quote a customer's
   refund or a customer's order back at the seller, which are the customer's
   figures appearing in the seller's inbox and have to match the row. */
update notification_log n set body = x.said from (
  select 'NL-8201' as id,
         'Hello Anita, your requisition for ' || money_text(r.amount, a.currency)
         || ' was approved by Vikram Shah. It has gone to the seller.' as said
    from enterprise_requisitions r join enterprise_accounts a on a.id = r.account_id
   where r.id = 'REQ-5498'
  union all
  select 'NL-8203',
         'Hello Vikram, invoice ' || i.id || ' for ' || money_text(i.total, i.currency)
         || ' covering July subscriptions and the retail estate rollout is attached. It is due on the terms on the account.'
    from enterprise_invoices i where i.id = 'INV-2026-0779'
  union all
  select 'NL-8301',
         'Arjun asked to buy a Nimbus Occupancy sensor for '
         || money_text(pp.price, pp.currency) || '. Approve or decline in the app.'
    from product_prices pp
    join consumer_profile c on c.currency = pp.currency
   where pp.product_id = 'SKU-5004' and c.id = 'me'
  union all
  select 'NL-8302',
         'The household spend cap of ' || money_text(sum(h.cap), c.currency)
         || ' for July has been reached. Nothing further can be bought until you raise it.'
    from consumer_household h join consumer_profile c on c.user_id = h.user_id
   where c.id = 'me' group by c.currency
  union all
  select 'NL-9002',
         'Hello Priya, your bill for July is ' || money_text(b.total, b.currency)
         || ' and will be taken on 05 Aug.'
    from consumer_bills b where b.id = 'BILL-2026-07'
  union all
  select 'NL-9003',
         s.product_name || ' renews 03 Aug — ' || money_text(s.price, s.currency)
         || '. Cancel before then to stop it.'
    from subscriptions s where s.ref = 'SUB-9101'
  union all
  select 'NL-9005',
         'Hello Priya, your refund of ' || money_text(r.amount, r.currency)
         || ' was agreed in full and is on its way back to the card that paid.'
    from refunds r where r.id = 'RFN-3203'
  union all
  select 'NL-9103',
         'Hello Katrin, Sanya Kapoor has asked for ' || money_text(r.amount, r.currency)
         || ' back on ' || r.order_ref || '. You have until 01 Aug to answer.'
    from refunds r where r.id = 'RFN-3220'
  union all
  select 'NL-9106',
         'Brightline Foods ordered Cold-chain starter — 25 sensors + connectivity for '
         || money_text(r.amount, r.currency) || '.'
    from refunds r where r.id = 'RFN-3241'
  union all
  select 'NL-9203',
         'Anita Desai raised a requisition for ' || money_text(r.amount, a.currency)
         || ', which is above the ' || money_text(p.threshold, a.currency) || ' approval threshold.'
    from enterprise_requisitions r
    join enterprise_accounts a on a.id = r.account_id
    join enterprise_approval_policy p on p.account_id = a.id
   where r.id = 'REQ-5487'
  union all
  select 'NL-9205',
         'Hello Vikram, the ' || cc.name || ' cost centre has passed 90% of its quarterly cap — '
         || money_text(cc.spent_quarter, a.currency) || ' of ' || money_text(cc.cap_quarter, a.currency)
         || ' is committed.'
    from enterprise_cost_centres cc join enterprise_accounts a on a.id = cc.account_id
   where cc.id = 'CC-RETAIL'
) x where n.id = x.id;

/* The two declined-payment lines and the renewal name a figure no row holds, so
   they are chosen rather than looked up — a round number in the account's
   money, which is what a person writing the notice would have picked. */
update notification_log set body =
  'Payment of ₹1,50,000 declined. New orders pause on 12 Aug unless it is fixed.'
 where id = 'NL-9201';
update notification_log set body =
  'Hello Vikram, the payment of ₹1,50,000 for the IoT estate rollout was declined — the card on file has expired. Nothing has been cancelled and nothing is overdue yet.'
 where id = 'NL-9202';
update notification_log set body =
  'Hello Vikram, this renews on 12 Aug and ₹2,00,000 will be taken from the account on file.'
 where id = 'NL-9204';

/* ================================ the notes this series wrote itself === */

update refunds set decision_note =
  'Under the ' || (select money_text(t.auto_approve_below, t.currency)
                     from refund_thresholds t where t.currency = refunds.currency)
  || ' threshold, where arguing about it costs both sides more than the refund. Approved on the spot.'
 where id = 'RFN-3233';

update refunds r set escalated_why =
  'The seller offered ' || money_text(round(r.amount / 4), r.currency) || ' against a '
  || money_text(r.amount, r.currency)
  || ' order and the buyer refused it. Unresolved 96 hours after it was raised, past the 72-hour clock.'
 where r.id = 'RFN-3204';

/* -------------------------------------------------------- sanity checks -- */
do $$
declare
  r record;
  n bigint;
  s text;
  found text;
  searched integer := 0;
  /* Where a dollar figure is the right answer, with the reason. Anything not on
     this list that still holds one fails the migration — which is the point:
     the list is what has been thought about, not what was remembered. */
  allowed text[] := array[
    'commission_plans.fees',              -- the marketplace's own rate card, in its reporting currency
    'partner_messages.body',              -- a seller arguing about a dollar statement
    'partner_messages.answer',            -- the reply to it
    'product_telco_components.note',      -- wholesale rate cards, bought in dollars
    'operator_listings.check_note',       -- a margin re-check against a dollar rate card
    'operator_listings.decision_reason',  -- the same, at publication
    'listing_queries.body',               -- a seller being asked about a dollar cost
    'content_feedback.action_taken',      -- a worked example of a dollar settlement
    'support_tickets.resolution_note',    -- a per-endpoint rate quoted from a dollar contract
    'notification_log.body'               -- partner and operator payout notices; the customer-facing ones are checked separately below
  ];
begin
  for r in select table_name, column_name from information_schema.columns
            where table_schema = 'public' and data_type in ('text', 'character varying')
            order by table_name, column_name
  loop
    searched := searched + 1;
    begin
      execute format('select count(*), min(%I) from %I where %I ~ ''\$ ?[0-9]''',
                     r.column_name, r.table_name, r.column_name) into n, found;
    exception when others then continue;  -- a view or a column the role cannot read
    end;
    if n > 0 and not (r.table_name || '.' || r.column_name = any(allowed)) then
      s := coalesce(s || '; ', '') || r.table_name || '.' || r.column_name
           || ' (' || n || ' rows, e.g. "' || left(found, 60) || '")';
    end if;
  end loop;
  if s is not null then raise exception 'these still quote dollars: %', s; end if;

  /* And it looked at the whole schema, not a corner of it. The migration this
     one exists to correct passed while searching seven columns. */
  if searched < 300 then
    raise exception 'only % text columns were searched, so this proved very little', searched;
  end if;

  /* Every notification still holding a dollar figure is one addressed to a
     seller or to the marketplace. A customer-facing one is a failure. */
  select string_agg(id || ' (' || persona || ')', ', ') into s
    from notification_log
   where body ~ '\$ ?[0-9]' and persona in ('consumer', 'enterprise');
  if s is not null then raise exception 'these customer notices still quote dollars: %', s; end if;

  /* The figures agree with the rows they describe. A restatement that leaves
     the prose disagreeing with the record is worse than the dollar sign was. */
  select string_agg(n.id || ': ' || n.body, '; ') into s
    from notification_log n join consumer_bills b on b.id = 'BILL-2026-07'
   where n.id = 'NL-9002' and n.body not like '%' || money_text(b.total, b.currency) || '%';
  if s is not null then raise exception 'the July bill notice disagrees with the bill: %', s; end if;

  /* `rfn`, not `r` — `r` is the loop record above, and a plpgsql alias that
     shadows one silently resolves to the record instead of the table. */
  select string_agg(a.id || ': ' || a.detail, '; ') into s
    from consumer_audit_log a join refunds rfn on rfn.id = 'RFN-3201'
   where a.id = 'AUD-CU-9005' and a.detail not like '%' || money_text(rfn.amount, rfn.currency) || '%';
  if s is not null then raise exception 'the refund audit line disagrees with the refund: %', s; end if;

  /* A plausibility check on the restated prose, because every check above
     compares a string to a row and both could be wrong together. */
  select count(*) into n from notification_log
   where persona in ('consumer', 'enterprise') and body ~ '₹ ?[0-9]{1,2}([^0-9,]|$)';
  if n > 0 then
    raise exception '% notices quote a rupee figure under a hundred — these read like dollar figures wearing a rupee label', n;
  end if;
end $$;
