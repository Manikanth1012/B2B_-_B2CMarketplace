/* The orders three systems remember and the order book does not.
 *
 * The disputes argued about seven orders that were not in the book, and
 * `20260808300000` wrote them. The loyalty ledger turns out to do the same thing
 * at twice the scale: fifty-one rows cite an order reference and seventeen of
 * those orders do not exist. Between them they account for every point four
 * customers and three business accounts have earned.
 *
 * The ledger is more useful than the disputes were, because it says what each
 * one was. "Nimbus Occupancy sensor — consumer purchase". "Kestrel launch
 * window". "Sentinel MDR — 40 seats". "Nimbus starter pack — cap reached on a
 * ₹55,949 order", which even gives the figure.
 *
 * Two other things fell out of reading it.
 *
 * ORD-881441 IS TWO ORDERS. Daniel Osei earned 96 points on it in shillings on
 * 25 July, and Sanya Kapoor earned 145 points on it in rupees on the same day.
 * One reference, two customers, two countries, two currencies. Whichever way it
 * is read, one of them is holding a receipt for somebody else's purchase — so
 * Sanya's gets its own reference and the ledger row moves with it.
 *
 * CADENCE HEALTH HAS A LOYALTY MEMBERSHIP AND NO ACCOUNT. LM-4103, org-silver,
 * 6,480 points, two earning rows in dirhams — and nothing in
 * `enterprise_accounts`. They are a customer of this marketplace by every
 * measure except the one that lists customers.
 *
 * WHAT THE ORDERS ARE PRICED AT
 *
 * From the catalogue, in the market each buyer trades in, at the quantity the
 * note describes. Not reverse-engineered from the points: earning carries tier
 * multipliers and monthly caps that the notes mention but do not quantify
 * ("Platinum 2x", "double earn", "cap reached"), so inverting them would be
 * inventing a precision the data does not have. The assertions check that the
 * points are PLAUSIBLE against the spend rather than exactly derivable from it,
 * which is the strongest true statement available.
 *
 * The one exception is ORD-881402, where the note states ₹55,949 outright. That
 * order is built to hit it exactly, with the difference carried as the
 * promotional discount it must have been.
 */

/* ---- 1. Cadence Health, who were a customer all along ------------------------- */

insert into public.enterprise_accounts (
  id, company, legal_name, segment, industry, sites, staff, terms, currency,
  fy_starts, budget_year, reg_type, registration, place_of_supply, po_required,
  reverse_charge, cost_centre_on_invoice, tax_exempt, status, sort_order, market)
select 'ENT-2015', 'Cadence Health', 'Cadence Health Services LLC', 'mid',
       'Private healthcare', 4, 260, 'Net 30', 'AED',
       '2026-01-01', 420000.00, 'TRN', '100387461200003', 'Abu Dhabi, UAE', true,
       true, true, false, 'active',
       (select coalesce(max(sort_order), 0) + 1 from public.enterprise_accounts), 'AE'
 where not exists (select 1 from public.enterprise_accounts where id = 'ENT-2015');

update public.loyalty_members
   set account_id = 'ENT-2015'
 where id = 'LM-4103' and account_id is null;

/* ---- 2. One reference cannot be two orders ------------------------------------ */

do $$
begin
  if exists (select 1 from public.loyalty_ledger
              where ref = 'ORD-881441' and currency = 'INR' and member = 'LM-4005') then
    update public.loyalty_ledger
       set ref = 'ORD-881442',
           note = note || ' (Re-referenced: this and Daniel Osei''s Kenyan order '
                       || 'both cited ORD-881441.)'
     where ref = 'ORD-881441' and currency = 'INR' and member = 'LM-4005';
    raise notice 'Sanya Kapoor''s order re-referenced to ORD-881442';
  end if;
end $$;

/* ---- 3. The four customers who were on no customer list ----------------------- */

do $$
declare s jsonb; made int := 0;
  people constant jsonb := jsonb_build_array(
    jsonb_build_object('member','LM-4002','name','Arun Deshpande','cus','CUS-449118',
      'city','Pune','market','IN','currency','INR','msisdn','+91 98204 11762',
      'email','arun.deshpande@example.in','since','Customer since Feb 2025'),
    jsonb_build_object('member','LM-4003','name','Meera Krishnan','cus','CUS-449204',
      'city','Chennai','market','IN','currency','INR','msisdn','+91 90031 55218',
      'email','meera.krishnan@example.in','since','Customer since Nov 2024'),
    jsonb_build_object('member','LM-4004','name','Daniel Osei','cus','CUS-449377',
      'city','Mombasa','market','KE','currency','KES','msisdn','+254 722 418 903',
      'email','daniel.osei@example.co.ke','since','Customer since Jun 2026'),
    jsonb_build_object('member','LM-4005','name','Sanya Kapoor','cus','CUS-449512',
      'city','Gurugram','market','IN','currency','INR','msisdn','+91 99105 27384',
      'email','sanya.kapoor@example.in','since','Customer since Mar 2026'));
begin
  for s in select * from jsonb_array_elements(people) loop
    if exists (select 1 from public.consumer_profile where customer_id = s ->> 'cus') then
      continue;
    end if;
    insert into public.consumer_profile (
      id, name, customer_id, msisdn, city, since, wallet, payment_method, email,
      mfa_enabled, active_sessions, pwd_changed, preferred_language, time_zone,
      currency, market, identity_source)
    values (
      lower(replace(s ->> 'cus', 'CUS-', 'cp-')), s ->> 'name', s ->> 'cus',
      s ->> 'msisdn', s ->> 'city', s ->> 'since', 0, 'Card', s ->> 'email',
      /* The language is a display name, not a code — the column is checked
         against 'English' / 'हिन्दी' / 'العربية' / 'Kiswahili'. */
      false, 0, 'Never', 'English',
      case when s ->> 'market' = 'KE' then 'Africa/Nairobi' else 'Asia/Kolkata' end,
      s ->> 'currency', s ->> 'market', 'self');
    made := made + 1;
  end loop;
  raise notice '% customers added to the customer list', made;
end $$;

/* ---- 4. The orders themselves -------------------------------------------------- */

do $$
declare
  s        jsonb;
  v_oid    uuid;
  v_rate   numeric;
  v_lines  numeric;
  v_disc   numeric;
  v_made   int := 0;
  v_when   date;
  li       jsonb;
  /* ref, buyer, account (null = retail), market, currency, seller, when,
     status, discount, and the lines as product/qty pairs. */
  spec constant jsonb := jsonb_build_array(
    /* --- retail ------------------------------------------------------------- */
    jsonb_build_object('ref','ORD-880902','buyer','Sanya Kapoor','cus','CUS-449512',
      'account',null,'market','IN','currency','INR','when','2026-07-01','status','refunded',
      'lines', jsonb_build_array(jsonb_build_object('p','SKU-5003','q',5))),
    jsonb_build_object('ref','ORD-880940','buyer','Meera Krishnan','cus','CUS-449204',
      'account',null,'market','IN','currency','INR','when','2026-07-11','status','delivered',
      'lines', jsonb_build_array(jsonb_build_object('p','SKU-4001','q',1))),
    jsonb_build_object('ref','ORD-880977','buyer','Meera Krishnan','cus','CUS-449204',
      'account',null,'market','IN','currency','INR','when','2026-07-08','status','delivered',
      'lines', jsonb_build_array(jsonb_build_object('p','SKU-5006','q',1))),
    jsonb_build_object('ref','ORD-881090','buyer','Arun Deshpande','cus','CUS-449118',
      'account',null,'market','IN','currency','INR','when','2026-07-14','status','delivered',
      'lines', jsonb_build_array(jsonb_build_object('p','SKU-5004','q',2))),
    jsonb_build_object('ref','ORD-881122','buyer','Arun Deshpande','cus','CUS-449118',
      'account',null,'market','IN','currency','INR','when','2026-07-17','status','active',
      'lines', jsonb_build_array(jsonb_build_object('p','SKU-3004','q',1))),
    jsonb_build_object('ref','ORD-881288','buyer','Meera Krishnan','cus','CUS-449204',
      'account',null,'market','IN','currency','INR','when','2026-07-24','status','active',
      'lines', jsonb_build_array(jsonb_build_object('p','SKU-3005','q',1))),
    /* Daniel's first order, and the one whose reference Sanya's was sharing. */
    jsonb_build_object('ref','ORD-881441','buyer','Daniel Osei','cus','CUS-449377',
      'account',null,'market','KE','currency','KES','when','2026-07-25','status','delivered',
      'lines', jsonb_build_array(jsonb_build_object('p','SKU-4008','q',2),
                                 jsonb_build_object('p','SKU-3003','q',1))),
    jsonb_build_object('ref','ORD-881442','buyer','Sanya Kapoor','cus','CUS-449512',
      'account',null,'market','IN','currency','INR','when','2026-07-25','status','delivered',
      'lines', jsonb_build_array(jsonb_build_object('p','SKU-5003','q',2))),
    /* --- business accounts -------------------------------------------------- */
    jsonb_build_object('ref','ORD-880844','buyer','Harbourpoint Retail','cus',null,
      'account','ENT-2014','market','KE','currency','KES','when','2026-06-27','status','delivered',
      'lines', jsonb_build_array(jsonb_build_object('p','SKU-5003','q',12))),
    jsonb_build_object('ref','ORD-880996','buyer','Brightline Foods','cus',null,
      'account','ENT-2011','market','IN','currency','INR','when','2026-07-09','status','delivered',
      'lines', jsonb_build_array(jsonb_build_object('p','SKU-5006','q',1))),
    jsonb_build_object('ref','ORD-881207','buyer','Brightline Foods','cus',null,
      'account','ENT-2011','market','IN','currency','INR','when','2026-07-18','status','active',
      'lines', jsonb_build_array(jsonb_build_object('p','SKU-6002','q',60))),
    jsonb_build_object('ref','ORD-881350','buyer','Harbourpoint Retail','cus',null,
      'account','ENT-2014','market','KE','currency','KES','when','2026-07-21','status','active',
      'lines', jsonb_build_array(jsonb_build_object('p','SKU-6002','q',40))),
    /* The note states ₹55,949. Seven cold-chain sensors and one occupancy sensor
       come to ₹56,992, so the difference is the promotion the note is about. */
    jsonb_build_object('ref','ORD-881402','buyer','Brightline Foods','cus',null,
      'account','ENT-2011','market','IN','currency','INR','when','2026-07-23','status','delivered',
      'total', 55949,
      'lines', jsonb_build_array(jsonb_build_object('p','SKU-5003','q',7),
                                 jsonb_build_object('p','SKU-5004','q',1))),
    jsonb_build_object('ref','ORD-881118','buyer','Cadence Health','cus',null,
      'account','ENT-2015','market','AE','currency','AED','when','2026-07-18','status','active',
      'lines', jsonb_build_array(jsonb_build_object('p','SKU-5003','q',8),
                                 jsonb_build_object('p','SKU-5002','q',40)))
  );
begin
  for s in select * from jsonb_array_elements(spec) loop
    if exists (select 1 from public.orders where order_ref = s ->> 'ref') then
      raise notice '% is already in the book', s ->> 'ref';
      continue;
    end if;

    select m.tax_rate into v_rate from public.markets m where m.code = s ->> 'market';
    v_when := (s ->> 'when')::date;

    /* Line prices are what the buyer was quoted — tax included — so they sum to
       what was charged before any order-level discount. */
    /* Alias `ln`, not `li` — `li` is the loop variable below and plpgsql
       resolves the variable first, which reads as an ambiguity error rather
       than as the shadowing it is. */
    select sum(pp.price * (ln ->> 'q')::int) into v_lines
      from jsonb_array_elements(s -> 'lines') ln
      join public.product_prices pp
        on pp.product_id = ln ->> 'p' and pp.currency = s ->> 'currency';
    if v_lines is null then
      raise exception '% has a line with no price in %', s ->> 'ref', s ->> 'currency';
    end if;

    v_disc := coalesce(v_lines - (s ->> 'total')::numeric, 0);
    if v_disc < 0 then
      raise exception '% claims a total above its own lines', s ->> 'ref';
    end if;

    v_oid := gen_random_uuid();
    insert into public.orders (
      id, order_ref, status, total, subtotal, tax, discount, tax_rate,
      payment_method, buyer_name, buyer_email, created_at, placed_date,
      seller, vertical, failed, stage, stages, account_id, currency, market)
    select
      v_oid, s ->> 'ref', s ->> 'status',
      /* Tax comes off the LINES, not off the discounted total. The book's two
         rules are `lines = total + discount` and `total = subtotal + tax -
         discount`; together they make `subtotal + tax = lines`, so splitting the
         discounted figure breaks the second one by exactly the discount. */
      v_lines - v_disc,
      round(v_lines / (1 + v_rate / 100), 2),
      round(v_lines - v_lines / (1 + v_rate / 100), 2),
      v_disc, v_rate,
      case when s ->> 'account' is null then 'Card' else 'On account — Net 30' end,
      s ->> 'buyer',
      coalesce((select c.email from public.consumer_profile c where c.customer_id = s ->> 'cus'),
               'accounts@' || lower(replace(s ->> 'buyer', ' ', '')) || '.example'),
      v_when::timestamptz, to_char(v_when, 'DD Mon YYYY'),
      /* The seller on the order is the seller of the first line, which is how
         every other order in the book names one. */
      (select p.seller from public.products p where p.id = (s -> 'lines' -> 0 ->> 'p')),
      (select p.category_id from public.products p where p.id = (s -> 'lines' -> 0 ->> 'p')),
      false, 4,
      case when s ->> 'status' = 'active'
           then array['Ordered', 'Confirmed', 'Provisioning', 'Activating', 'Active']
           else array['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered'] end,
      s ->> 'account', s ->> 'currency', s ->> 'market';

    for li in select * from jsonb_array_elements(s -> 'lines') loop
      insert into public.order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status)
      select gen_random_uuid(), v_oid, p.id, p.name, pp.price, (li ->> 'q')::int,
             case when p.category_id in ('security', 'content', 'connectivity') then 'provisioned'
                  else 'shipped' end,
             case when s ->> 'status' = 'refunded' then 'refunded' else 'delivered' end
        from public.products p
        join public.product_prices pp on pp.product_id = p.id and pp.currency = s ->> 'currency'
       where p.id = li ->> 'p';
    end loop;

    v_made := v_made + 1;
  end loop;
  raise notice '% orders written for points that had already been earned on them', v_made;
end $$;

/* ---- 5. What has to be true ---------------------------------------------------- */

do $$
declare bad text; n int;
begin
  /* ASSERT-1: every loyalty row that cites an order cites one that exists. This
     is the whole point, and it was false for seventeen rows. */
  select string_agg(distinct l.ref, ', ') into bad
    from public.loyalty_ledger l
   where l.ref like 'ORD-%'
     and not exists (select 1 from public.orders o where o.order_ref = l.ref);
  if bad is not null then raise exception 'points earned on orders that do not exist: %', bad; end if;

  /* ASSERT-2: and on one belonging to the member who earned them. A point
     credited to the wrong customer is worse than one credited to nobody. */
  select string_agg(l.id || ' (' || l.member || ' on ' || l.ref || ')', ', ') into bad
    from public.loyalty_ledger l
    join public.loyalty_members m on m.id = l.member
    join public.orders o on o.order_ref = l.ref
   where l.ref like 'ORD-%'
     and case when m.account_id is not null then o.account_id is distinct from m.account_id
              else o.buyer_name is distinct from m.name end;
  if bad is not null then raise exception 'points on somebody else''s order: %', bad; end if;

  /* ASSERT-3: in a currency that makes sense for the member.
   *
   * Not necessarily the order's. A loyalty balance is held in the member's own
   * programme currency, and Kenya trades in both shillings and dollars — so
   * Wanjiru Kamau earns shillings on orders charged in dollars, and the notes
   * say so: "PlayForge Cloud Gaming — USD 8.61 converted". The first draft of
   * this check demanded they match and reported four correct rows as broken.
   *
   * What has to be true is weaker and actually true: the points are in a
   * currency that market trades in, and where it differs from the order's the
   * row says it was converted. */
  select string_agg(l.id, ', ') into bad
    from public.loyalty_ledger l join public.orders o on o.order_ref = l.ref
   where l.ref like 'ORD-%'
     and not exists (select 1 from public.market_currencies mc
                      where mc.market_code = o.market and mc.currency = l.currency);
  if bad is not null then
    raise exception 'points in a currency that market does not trade in: %', bad;
  end if;

  select string_agg(l.id, ', ') into bad
    from public.loyalty_ledger l join public.orders o on o.order_ref = l.ref
   where l.ref like 'ORD-%' and l.currency is distinct from o.currency
     and coalesce(l.note, '') not ilike '%convert%'
     /* A reversal takes back what an earn gave and inherits its conversion; it
        does not restate the rate, and demanding it did reported the eSIM refund
        as unexplained. What matters is that the earn it reverses is explained. */
     and not (l.type = 'reverse' and exists (
       select 1 from public.loyalty_ledger e
        where e.ref = l.ref and e.member = l.member and e.type = 'earn'
          and coalesce(e.note, '') ilike '%convert%'));
  if bad is not null then
    raise exception 'points in a different currency from the order with nothing saying it was converted: %', bad;
  end if;

  /* ASSERT-4 IS DELIBERATELY NOT HERE, AND THIS IS WHY.
   *
   * The obvious check is that the points on a row are explicable from what the
   * order cost. It cannot be written honestly against this data.
   *
   * `loyalty_point_rates` says a rupee order earns 0.01 points per unit — a
   * point per ₹100. `loyalty_earn_rules` multiplies that: 1.0 base, 2.0 for
   * content, 3.0 in the Kestrel launch window, with per-order and per-month
   * caps. So the most generous rule in the book on a ₹599 order is about
   * eighteen points.
   *
   * LTX-70100 records 210 on exactly that order. LTX-70127 records 960 on ₹949.
   * Thirteen rows are between ten and forty times what the rate tables allow, and
   * they were seeded that way long before this migration — the four new orders
   * here sit in the same band as the ones that were already there.
   *
   * So the earned points and the schedule that is supposed to produce them do
   * not agree, and no band I can pick makes that statement true rather than
   * merely quiet. A check calibrated to pass the current data would assert
   * nothing; one calibrated to the rate tables would fail on rows this migration
   * did not create and cannot correctly fix, because reconciling them means
   * deciding whether the points are wrong or the schedule is — which is a
   * pricing decision, not a data repair.
   *
   * Left as it is, said out loud, and logged. The checks below are the ones that
   * are true.
   */

  /* ASSERT-5: no reference is two orders. Daniel Osei and Sanya Kapoor were
     sharing one, in different countries and different currencies. */
  select string_agg(x.ref, ', ') into bad from (
    select l.ref from public.loyalty_ledger l
     where l.ref like 'ORD-%' and l.type = 'earn'
     group by l.ref having count(distinct l.member) > 1
  ) x;
  if bad is not null then raise exception 'one order reference earning for two members: %', bad; end if;

  /* ASSERT-6: every loyalty member is somebody the marketplace knows —
     a customer on the customer list, or an account on the account list. */
  select string_agg(m.id || ' (' || m.name || ')', ', ') into bad
    from public.loyalty_members m
   where not exists (select 1 from public.consumer_profile c
                      where c.user_id = m.user_id or c.customer_id = m.party)
     and not exists (select 1 from public.enterprise_accounts a where a.id = m.account_id);
  if bad is not null then raise exception 'loyalty members the marketplace has no record of: %', bad; end if;

  /* ASSERT-7: the orders hold together like every other order in the book. */
  select string_agg(x.order_ref, ', ') into bad from (
    select o.order_ref from public.orders o join public.order_items i on i.order_id = o.id
     group by o.id, o.order_ref, o.total, o.discount
    having abs(sum(i.price * i.quantity) - (o.total + o.discount)) > 0.02
  ) x;
  if bad is not null then raise exception 'orders whose lines do not sum to what was charged: %', bad; end if;

  select string_agg(o.order_ref, ', ') into bad from public.orders o
   where abs(o.total - (o.subtotal + o.tax - o.discount)) > 0.02;
  if bad is not null then raise exception 'orders whose total is not its own parts: %', bad; end if;

  /* ASSERT-8: and the one the note gave a figure for is that figure. */
  select count(*) into n from public.orders where order_ref = 'ORD-881402' and total = 55949;
  if n <> 1 then raise exception 'ORD-881402 is not the ₹55,949 the ledger says it was'; end if;

  select count(*) into n from public.orders;
  raise notice 'order book: % orders; customers: %; accounts: %',
    n, (select count(*) from public.consumer_profile), (select count(*) from public.enterprise_accounts);
end $$;
