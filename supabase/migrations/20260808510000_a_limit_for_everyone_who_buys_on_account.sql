/* A limit for everyone who buys on account, and security from the sellers who
 * warrant it.
 *
 * The schema went in; this is the file. Two rules decided every figure in it, so
 * that a later reviewer argues with the reasoning rather than with the numbers.
 *
 * BUYERS: TWO MONTHS OF THEIR OWN BUDGET, ADJUSTED FOR TERMS AND HISTORY.
 * `enterprise_accounts.budget_year` is what each account expects to spend, so a
 * limit is a share of it rather than a figure picked to look reasonable. Two
 * months is the default; Net 45 gets more headroom than Net 15 because the
 * exposure lasts longer, and an account with no trading history gets less until
 * it has one.
 *
 * SELLERS: WHAT THEIR OWN BOOK SAYS ABOUT THEM. Not a flat bond. Four signals
 * are already in the database and every rate below comes from them:
 *
 *   how long they have traded    `partners.joined`
 *   what has been disputed       `disputes`
 *   what has been charged back   `settlement_note` debits
 *   what they refund             `settlement_statements.refunds` over gross
 *
 * TrackWise Telematics is the case that makes the point: live since January
 * 2026, seven months old, with eight disputes and a debit note against them, and
 * a settlement statement they are currently disputing. Beacon Reseller Co is the
 * quieter one — no disputes at all, and a refund rate of 0.76% against 0.07%
 * everywhere else, which is ten times the book and the kind of thing nobody
 * notices until a chargeback month.
 *
 * RETAIL IS OUT OF SCOPE, and recorded as such rather than left as a hole
 * somebody fills in later. A shopper pays at checkout; there is no credit to
 * check and nothing to secure. Where a consumer does get credit — a device on
 * instalments — the credit decision belongs to whoever underwrites the finance,
 * not to the marketplace.
 */

/* ---- 1. The boundary --------------------------------------------------------- */

insert into public.channel_rule
  (id, what, label, decision, sold_through, reason, effective_from, agreed_by, sort_order)
select 'CR-007', 'retail-credit', 'Credit assessment and deposits for retail customers',
       'not operated here',
       'Nobody — a retail order is paid at checkout',
       'A shopper pays in advance and the service simply is not renewed if they do not, so the '
       || 'marketplace never carries retail receivables and has nothing to secure. Credit is '
       || 'assessed for business accounts, who buy on terms, and security is taken from sellers, '
       || 'whose refunds can exceed their sales. Where a consumer buys a device on instalments '
       || 'the credit decision sits with whoever underwrites the finance.',
       current_date, 'Marketplace product owner',
       (select coalesce(max(sort_order), 0) + 1 from public.channel_rule)
 where not exists (select 1 from public.channel_rule where id = 'CR-007');

/* ---- 2. Buyers ---------------------------------------------------------------- */

do $$
declare
  s jsonb; a record; v_made int := 0; v_id text;
  /* account, band, months of budget, deposit, evidence, rationale. */
  spec constant jsonb := jsonb_build_array(
    jsonb_build_object('acct','ENT-2007','band','low','months',2.0,'deposit',0,
      'evidence','Two years of filed accounts, twelve months of settled invoices on this account, and a bank reference from HDFC.',
      'why','Trades steadily and pays inside terms. The existing limit was already at two months of budget and is left where it is.'),
    jsonb_build_object('acct','ENT-2011','band','low','months',2.0,'deposit',0,
      'evidence','Audited accounts to March 2026, Dun & Bradstreet 4A1, and eleven sites on a single group VAT registration.',
      'why','The largest account on the book by budget and the strongest covenant. Net 45 lengthens the exposure, which the limit reflects rather than the band.'),
    jsonb_build_object('acct','ENT-2012','band','medium','months',2.0,'deposit',0,
      'evidence','Trade licence, two years of filed accounts, and one settled AED invoice against three raised.',
      'why','Sound but thin history with us — three invoices, one of them currently disputed on a seats question. Two months of budget until a fourth settles cleanly.'),
    jsonb_build_object('acct','ENT-2013','band','medium','months',1.5,'deposit',0,
      'evidence','Certificate of incorporation, GSTIN, and management accounts. No trading history on this account.',
      'why','Approved to buy and has bought nothing. A limit sized to let them start rather than to match their budget; reviewed after the first quarter of trade.'),
    jsonb_build_object('acct','ENT-2014','band','medium','months',5.0,'deposit',0,
      'evidence','Registration, twelve months of KES invoices settled on Net 15, and a trade reference.',
      'why','Small by staff and steady by payment. Net 15 keeps the exposure short, so a larger share of budget is affordable; the existing 2.5m KES is about five months and is left alone.'),
    jsonb_build_object('acct','ENT-2015','band','high','months',1.0,'deposit',25000,
      'evidence','Trade licence and TRN verified. No filed accounts available and no trading history — the account was created from a loyalty membership that predates any order.',
      'why','A customer by every measure except the ones a credit review can read. One month of budget and a refundable deposit until there are two settled invoices to look at.')
  );
begin
  for s in select * from jsonb_array_elements(spec) loop
    select * into a from public.enterprise_accounts where id = s ->> 'acct';

    v_id := 'CRA-' || replace(a.id, 'ENT-', '') || '-01';
    if exists (select 1 from public.credit_assessment where id = v_id) then continue; end if;

    insert into public.credit_assessment (
      id, account_id, side, reviewed_on, reviewed_by, evidence, band, rationale,
      currency, limit_granted, next_review)
    values (
      v_id, a.id, 'buyer', date '2026-08-08', 'Ruben Oyelaran',
      s ->> 'evidence', s ->> 'band', s ->> 'why',
      a.currency,
      round(a.budget_year * (s ->> 'months')::numeric / 12, -3),
      date '2026-08-08' + interval '1 year');

    /* The billing row is what enforcement reads, so the assessment writes it
       rather than leaving two numbers to agree by hand. */
    insert into public.enterprise_billing (
      account_id, method, verified, fallback, terms, billing_contact, invoice_delivery,
      credit_limit, credit_reviewed, credit_review_due, at_limit_note, currency,
      deposit_held, deposit_kind, deposit_ref)
    values (
      a.id, 'Invoice', false, false, a.terms,
      'accounts@' || lower(replace(a.company, ' ', '')) || '.example', 'email',
      round(a.budget_year * (s ->> 'months')::numeric / 12, -3),
      date '2026-08-08', date '2026-08-08' + interval '1 year',
      'A requisition that would take the balance past the limit is held, not refused. '
      || 'Finance is told and can release it against an early payment.',
      a.currency,
      (s ->> 'deposit')::numeric,
      case when (s ->> 'deposit')::numeric > 0 then 'cash' else 'none' end,
      case when (s ->> 'deposit')::numeric > 0 then 'DEP-' || replace(a.id, 'ENT-', '') else null end)
    on conflict (account_id) do update set
      credit_limit      = excluded.credit_limit,
      credit_reviewed   = excluded.credit_reviewed,
      credit_review_due = excluded.credit_review_due,
      deposit_held      = excluded.deposit_held,
      deposit_kind      = excluded.deposit_kind,
      deposit_ref       = excluded.deposit_ref;

    v_made := v_made + 1;
  end loop;
  raise notice '% accounts assessed', v_made;
end $$;

/* ---- 3. Sellers --------------------------------------------------------------- */

do $$
declare
  s jsonb; v_made int := 0; v_id text; v_cur text;
  spec constant jsonb := jsonb_build_array(
    jsonb_build_object('p','PTR-1011','band','high','reserve',10.0,'deposit',5000,
      'evidence','Seven months trading. Eight disputes, one debit note, and a settlement statement currently disputed.',
      'why','The newest seller on the book and the most argued-with. Ten per cent held rolling and a deposit until two clean quarters.'),
    jsonb_build_object('p','PTR-1009','band','high','reserve',7.5,'deposit',0,
      'evidence','Refunds at 0.76% of gross against 0.07% across the book. Cross-border payee with a treaty certificate expiring 30 September.',
      'why','No disputes at all, and ten times everyone else''s refund rate — the quiet kind of exposure. A reseller refunding at that rate for a bad month is a shortfall we cannot recover across a border.'),
    jsonb_build_object('p','PTR-1004','band','medium','reserve',5.0,'deposit',0,
      'evidence','Five disputes, four of them upheld or withdrawn. Trading since September 2024 with no refund anomaly.',
      'why','Disputes are about delivery shortfalls rather than money, and they resolve. Five per cent covers the gap between a claim and its resolution.'),
    jsonb_build_object('p','PTR-1005','band','medium','reserve',2.5,'deposit',0,
      'evidence','One debit note for a duplicate charge. Small book, digital fulfilment, no delivery risk.',
      'why','A chargeback on digital content lands with no goods to recover, so a small reserve rather than none.'),
    jsonb_build_object('p','PTR-1008','band','medium','reserve',2.5,'deposit',0,
      'evidence','One debit note. Hardware seller with a fourteen-day holdback already in place.',
      'why','The holdback covers the returns window; the reserve covers what arrives after it.'),
    jsonb_build_object('p','PTR-1001','band','low','reserve',2.0,'deposit',0,
      'evidence','One dispute, withdrawn. Trading since April 2024.',
      'why','Content subscriptions with a low ticket and a long record.'),
    jsonb_build_object('p','PTR-1003','band','low','reserve',2.0,'deposit',0,
      'evidence','One dispute on published throughput, open with the seller. Managed security, annual contracts.',
      'why','A performance claim rather than a payment one, and the contract carries the penalty. Two per cent against that clause.'),
    jsonb_build_object('p','PTR-1002','band','low','reserve',0,'deposit',0,
      'evidence','No disputes, no debit notes, refunds at the book average. Trading since March 2024.',
      'why','Nothing in the record justifies holding their money.'),
    jsonb_build_object('p','PTR-1006','band','low','reserve',0,'deposit',0,
      'evidence','No disputes, no debit notes. Insurance attach with no physical fulfilment.',
      'why','Nothing to reserve against.'),
    jsonb_build_object('p','PTR-1007','band','low','reserve',0,'deposit',0,
      'evidence','No disputes, no debit notes. Small content book.',
      'why','Nothing to reserve against.'),
    jsonb_build_object('p','PTR-1010','band','low','reserve',0,'deposit',0,
      'evidence','No disputes, no debit notes. Cloud storage on annual terms.',
      'why','Nothing to reserve against.')
  );
begin
  for s in select * from jsonb_array_elements(spec) loop
    v_id := 'CRA-' || replace(s ->> 'p', 'PTR-', '') || '-01';
    if exists (select 1 from public.credit_assessment where id = v_id) then continue; end if;

    /* Statements are computed in the reporting currency, so a reserve withheld
       from one is held in that currency too. */
    select coalesce(max(st.currency), 'USD') into v_cur
      from public.settlement_statements st where st.partner_id = s ->> 'p';

    insert into public.credit_assessment (
      id, partner_id, side, reviewed_on, reviewed_by, evidence, band, rationale,
      currency, deposit_required, reserve_pct, next_review)
    values (
      v_id, s ->> 'p', 'seller', date '2026-08-08', 'Ruben Oyelaran',
      s ->> 'evidence', s ->> 'band', s ->> 'why',
      v_cur, nullif((s ->> 'deposit')::numeric, 0), (s ->> 'reserve')::numeric,
      date '2026-08-08' + interval '6 months');

    insert into public.partner_security (
      partner_id, deposit_held, deposit_kind, deposit_ref, deposit_taken_on,
      reserve_pct, reserve_held, currency, why, reviewed_on)
    values (
      s ->> 'p', (s ->> 'deposit')::numeric,
      case when (s ->> 'deposit')::numeric > 0 then 'cash' else 'none' end,
      case when (s ->> 'deposit')::numeric > 0 then 'DEP-' || replace(s ->> 'p', 'PTR-', '') else null end,
      case when (s ->> 'deposit')::numeric > 0 then date '2026-08-08' else null end,
      (s ->> 'reserve')::numeric,
      /* Nothing held yet. A reserve accrues from the runs after it is set, not
         retrospectively out of money already paid. */
      0, v_cur, s ->> 'why', date '2026-08-08')
    on conflict (partner_id) do update set
      deposit_held = excluded.deposit_held,
      deposit_kind = excluded.deposit_kind,
      reserve_pct  = excluded.reserve_pct,
      why          = excluded.why,
      reviewed_on  = excluded.reviewed_on;

    v_made := v_made + 1;
  end loop;
  raise notice '% sellers assessed', v_made;
end $$;

/* ---- 4. What has to be true ---------------------------------------------------- */

do $$
declare bad text; n int;
begin
  /* ASSERT-1: everybody who buys on account has a limit. Four of six had none. */
  select string_agg(a.id || ' (' || a.company || ')', ', ') into bad
    from public.enterprise_accounts a
   where a.status = 'active'
     and not exists (select 1 from public.enterprise_billing b
                      where b.account_id = a.id and b.credit_limit > 0);
  if bad is not null then raise exception 'accounts buying on terms with no limit: %', bad; end if;

  /* ASSERT-2: and every limit traces to a review. A limit with no assessment
     behind it is a number somebody typed. */
  select string_agg(b.account_id, ', ') into bad
    from public.enterprise_billing b
   where b.credit_limit > 0
     and not exists (select 1 from public.credit_assessment c
                      where c.account_id = b.account_id and c.superseded_by is null);
  if bad is not null then raise exception 'limits with no assessment behind them: %', bad; end if;

  /* ASSERT-3: the two figures agree. They are stored twice — once as the
     decision and once where enforcement reads it — so they can disagree, and
     this is the check that says they do not. */
  select string_agg(b.account_id || ' (' || b.credit_limit || ' vs ' || c.limit_granted || ')', ', ')
    into bad
    from public.enterprise_billing b
    join public.credit_assessment c on c.account_id = b.account_id and c.superseded_by is null
   where b.credit_limit is distinct from c.limit_granted;
  if bad is not null then raise exception 'the limit applied is not the limit granted: %', bad; end if;

  /* ASSERT-4: in the account's own money. */
  select string_agg(c.id, ', ') into bad
    from public.credit_assessment c join public.enterprise_accounts a on a.id = c.account_id
   where c.currency is distinct from a.currency;
  if bad is not null then raise exception 'assessments in a currency the account does not trade in: %', bad; end if;

  /* ASSERT-5: every live seller has a security record, even if it holds nothing.
     "Assessed and nothing required" and "never assessed" are different answers
     and only one of them is safe. */
  select string_agg(p.id || ' (' || p.name || ')', ', ') into bad
    from public.partners p
   where p.status = 'live'
     and not exists (select 1 from public.partner_security x where x.partner_id = p.id);
  if bad is not null then raise exception 'live sellers nobody has assessed: %', bad; end if;

  /* ASSERT-6: and every one of those traces to a review too. */
  select string_agg(x.partner_id, ', ') into bad
    from public.partner_security x
   where not exists (select 1 from public.credit_assessment c
                      where c.partner_id = x.partner_id and c.superseded_by is null);
  if bad is not null then raise exception 'security held with no assessment behind it: %', bad; end if;

  /* ASSERT-7: the reserve rates rank the way the evidence does. The newest,
     most-disputed seller cannot be held to less than the cleanest one. */
  select string_agg(x.a || ' at ' || x.ra || '% against ' || x.b || ' at ' || x.rb || '%', '; ')
    into bad from (
    select h.partner_id a, h.reserve_pct ra, l.partner_id b, l.reserve_pct rb
      from public.partner_security h, public.partner_security l
     where h.partner_id = 'PTR-1011' and l.partner_id in ('PTR-1002', 'PTR-1006', 'PTR-1007', 'PTR-1010')
       and h.reserve_pct <= l.reserve_pct
  ) x;
  if bad is not null then raise exception 'the riskiest seller is held to no more than the cleanest: %', bad; end if;

  /* ASSERT-8: nothing is reserved retrospectively. A rate set today does not
     reach back into money already paid. */
  select count(*) into n from public.partner_security where reserve_held > 0;
  if n <> 0 then raise exception '% sellers already have a reserve held against runs that predate the rate', n; end if;

  /* ASSERT-9: and retail is recorded as out of scope rather than missing. */
  select count(*) into n from public.channel_rule
   where id = 'CR-007' and decision = 'not operated here';
  if n <> 1 then raise exception 'the retail credit boundary is not recorded'; end if;

  raise notice 'buyers: % limits, % with a deposit; sellers: % assessed, % holding a reserve',
    (select count(*) from public.enterprise_billing where credit_limit > 0),
    (select count(*) from public.enterprise_billing where deposit_held > 0),
    (select count(*) from public.partner_security),
    (select count(*) from public.partner_security where reserve_pct > 0);
end $$;
