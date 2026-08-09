/* An agreement behind every account.
 *
 * The guard went in with the schema and nothing satisfies it yet, so at this
 * moment no enterprise can raise or approve anything — which is correct and is
 * also why this file follows immediately. A control that refuses everything is
 * not a stricter control, it is an outage.
 *
 * Six accounts, six agreements, each dated from what the account has actually
 * been doing. Harbourpoint has been invoicing on Net 15 with a credit review
 * that says "Net 15 keeps the exposure short" — so their contract carries an
 * amendment moving them from Net 30, which is what a real account does after a
 * year of paying quickly. SmartBuild has been trading since 2021, so their
 * current agreement is the second one and the first is superseded rather than
 * absent. Meridian's runs out in under a month, because a register where
 * nothing is ever close to expiring never shows anybody the column that matters.
 *
 * WHAT IS DELIBERATELY NOT HERE
 *
 * No account is left without a contract in force. The temptation was to leave
 * one expired so the refusal could be seen — and that is exactly the mistake
 * the credit work made two files ago, where making the demo account the
 * over-limit example meant the buyer's main journey always dead-ended. The
 * refusal is exercised by the integration test, which moves a date, watches the
 * database refuse, and puts it back.
 *
 * TERM VALUES ARE NOT PRICES
 *
 * `term_value` is what each account said it expected to spend. It buys nothing.
 * SmartBuild's says 12,000,000 over three years and they have invoiced about
 * 4,000,000 in the last twelve — which is precisely the gap their credit review
 * describes, and the reason it sizes their limit off trade rather than off what
 * anybody stated.
 */

/* ---- 1. The agreements --------------------------------------------------------- */

insert into public.enterprise_contract (
  id, account_id, title, signed_on, starts_on, ends_on, terms, currency,
  auto_renew, notice_days, term_value, signed_by, signed_title, countersigned_by,
  document_name, state, superseded_by, note, sort_order)
values
  /* SmartBuild's first agreement. Superseded, not deleted: the question "what
     were we on in 2022" has an answer only if the old one is still here. */
  ('CTR-2007-00', 'ENT-2007', 'Master services agreement 2021–2024',
   date '2021-03-15', date '2021-04-01', date '2024-03-31', 'Net 30', 'INR',
   false, 30, 6000000, 'Rohit Malhotra', 'Chief Financial Officer', 'Ruben Oyelaran',
   'ENT-2007 master services agreement 2021.pdf', 'superseded', 'CTR-2007-01',
   'The original three-year agreement. Replaced on renewal rather than extended, because the '
   'sites and the payment terms both changed.', 1),

  ('CTR-2007-01', 'ENT-2007', 'Master services agreement 2024–2027',
   date '2024-03-18', date '2024-04-01', date '2027-03-31', 'Net 30', 'INR',
   false, 60, 12000000, 'Rohit Malhotra', 'Chief Financial Officer', 'Ruben Oyelaran',
   'ENT-2007 master services agreement 2024.pdf', 'active', null,
   'Three-year term with sixty days'' notice. Not auto-renewing: the account asked for a '
   'commercial review at each renewal rather than a rollover.', 2),

  ('CTR-2011-01', 'ENT-2011', 'Master services agreement 2025–2027',
   date '2025-06-10', date '2025-07-01', date '2027-06-30', 'Net 45', 'INR',
   true, 90, 110000000, 'Ananya Venkatesh', 'Group Procurement Director', 'Ruben Oyelaran',
   'ENT-2011 master services agreement.pdf', 'active', null,
   'The largest account on the book and the longest notice period. Auto-renews annually '
   'unless either side gives ninety days.', 3),

  ('CTR-2012-01', 'ENT-2012', 'Master services agreement 2025–2026',
   date '2025-08-22', date '2025-09-06', date '2026-09-05', 'Net 30', 'AED',
   false, 30, 750000, 'Faisal Al Mansoori', 'Finance Director', 'Ruben Oyelaran',
   'ENT-2012 master services agreement.pdf', 'active', null,
   'A one-year term to start with, which is how a new account in a new market is usually '
   'written. Renewal is a conversation rather than a rollover.', 4),

  ('CTR-2013-01', 'ENT-2013', 'Master services agreement 2026–2027',
   date '2026-05-20', date '2026-06-01', date '2027-05-31', 'Net 30', 'INR',
   false, 30, 15000000, 'Nilesh Bhatt', 'Head of Estates', 'Ruben Oyelaran',
   'ENT-2013 master services agreement.pdf', 'active', null,
   'Signed and not yet drawn on. The credit review says the same thing from the other side: '
   'approved to buy and has bought nothing.', 5),

  ('CTR-2014-01', 'ENT-2014', 'Master services agreement 2025–2027',
   date '2025-01-20', date '2025-02-01', date '2027-01-31', 'Net 15', 'KES',
   true, 60, 12000000, 'Grace Wambui', 'Managing Director', 'Ruben Oyelaran',
   'ENT-2014 master services agreement.pdf', 'active', null,
   'Two-year term, auto-renewing. Moved to Net 15 after the first year — see the amendment.', 6),

  ('CTR-2015-01', 'ENT-2015', 'Master services agreement 2026–2027',
   date '2026-07-14', date '2026-07-20', date '2027-07-19', 'Net 30', 'AED',
   false, 30, 420000, 'Layla Haddad', 'Chief Operating Officer', 'Ruben Oyelaran',
   'ENT-2015 master services agreement.pdf', 'active', null,
   'The newest account. A one-year term against a refundable deposit, because there are no '
   'filed accounts to read yet.', 7)
on conflict (id) do nothing;

/* ---- 2. What changed after signature ------------------------------------------- */

insert into public.enterprise_contract_amendment (
  id, contract_id, kind, signed_on, effective_on, was, now_says, why, signed_by,
  document_name, sort_order)
values
  ('CTR-2014-01-A1', 'CTR-2014-01', 'terms',
   date '2025-10-24', date '2025-11-01',
   'Payment terms: Net 30 from date of invoice.',
   'Payment terms: Net 15 from date of invoice.',
   'Harbourpoint asked to shorten the terms in exchange for a larger credit line. Twelve '
   'months of invoices had settled inside fifteen days without being asked, so the change '
   'wrote down what was already happening.',
   'Grace Wambui', 'ENT-2014 amendment 1 — payment terms.pdf', 1),

  ('CTR-2007-01-A1', 'CTR-2007-01', 'value',
   date '2025-09-18', date '2025-10-01',
   'Expected spend across the term: INR 9,000,000.',
   'Expected spend across the term: INR 12,000,000.',
   'Two further sites at Hubli and Belgaum were brought into the agreement. The stated figure '
   'moved; nothing about what anything costs did, because prices here are the published ones.',
   'Rohit Malhotra', 'ENT-2007 amendment 1 — sites and expected spend.pdf', 2),

  ('CTR-2011-01-A1', 'CTR-2011-01', 'contact',
   date '2026-02-11', date '2026-02-11',
   'Billing contact: accounts@brightlinefoods.in.',
   'Billing contact: ap.shared@brightlinefoods.in.',
   'Brightline moved to a shared accounts-payable inbox. Recorded as an amendment rather than '
   'edited in place, because invoices had already been delivered to the old address and the '
   'date the change took effect is the thing anybody chasing a payment needs.',
   'Ananya Venkatesh', 'ENT-2011 amendment 1 — billing contact.pdf', 3)
on conflict (id) do nothing;

/* ---- 3. The terms, from one place ---------------------------------------------- */

/* The trigger writes these on insert, but only for rows it saw. Restating here
 * makes the file idempotent and, more to the point, corrects ENT-2007 — whose
 * account row has been advertising 'contract pricing on most lines' since long
 * before there was a contract table, for an arrangement CR-008 records as not
 * operated here at all.
 */
update public.enterprise_accounts a
   set terms = c.terms
  from public.enterprise_contract c
 where c.account_id = a.id and c.state = 'active'
   and current_date between c.starts_on and c.ends_on
   and a.terms is distinct from c.terms;

update public.enterprise_billing b
   set terms = c.terms
  from public.enterprise_contract c
 where c.account_id = b.account_id and c.state = 'active'
   and current_date between c.starts_on and c.ends_on
   and b.terms is distinct from c.terms;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text; n int; v_standing text; v_days int;
begin
  /* ASSERT-1: every account that is trading has an agreement in force. Without
     this the guard turns an empty table into a marketplace nobody can buy on. */
  select string_agg(a.id || ' (' || a.company || ')', ', ') into bad
    from public.enterprise_accounts a
   where a.status = 'active' and public.contract_in_force(a.id) is null;
  if bad is not null then
    raise exception 'accounts trading with no agreement behind them: %', bad;
  end if;

  /* ASSERT-2: and never two at once. Two live agreements for one account is two
     sets of payment terms and no way to say which was breached. */
  select string_agg(account_id || ' x' || c, ', ') into bad from (
    select account_id, count(*) c from public.enterprise_contract
     where state = 'active' and current_date between starts_on and ends_on
     group by account_id having count(*) > 1) t;
  if bad is not null then raise exception 'accounts with more than one agreement in force: %', bad; end if;

  /* ASSERT-3: the payment terms agree in all three places they are written. They
     did not before this file: ENT-2007 read 'Net 30 · contract pricing on most
     lines' on the account and 'Invoice, net 30' on the billing row. */
  select string_agg(format('%s (contract %s, account %s, billing %s)',
                           c.account_id, c.terms, a.terms, b.terms), '; ') into bad
    from public.enterprise_contract c
    join public.enterprise_accounts a on a.id = c.account_id
    join public.enterprise_billing  b on b.account_id = c.account_id
   where c.state = 'active' and current_date between c.starts_on and c.ends_on
     and (a.terms is distinct from c.terms or b.terms is distinct from c.terms);
  if bad is not null then raise exception 'payment terms disagree with the agreement: %', bad; end if;

  /* ASSERT-4: nothing claims contract pricing, which CR-008 says is not
     operated here. A sentence promising an arrangement that does not exist is
     the defect this codebase keeps finding. */
  select string_agg(id, ', ') into bad from public.enterprise_accounts
   where terms ilike '%contract pricing%' or terms ilike '%negotiated%';
  if bad is not null then raise exception 'accounts still advertising negotiated pricing: %', bad; end if;

  /* ASSERT-5: an expiry is visible before it happens. A register where nothing
     is ever near its end never exercises the column that matters, and the
     notice period is the whole reason the column exists. */
  select count(*) into n from public.account_contract where standing = 'expiring';
  if n = 0 then raise exception 'no agreement is inside its notice period, so the renewal queue is untested'; end if;

  /* ASSERT-6: and the one that is expiring is the one this file meant. Checked
     by name because "some row is expiring" would pass on any accident. */
  select standing, days_left into v_standing, v_days
    from public.account_contract where id = 'CTR-2012-01';
  if v_standing <> 'expiring' then
    raise exception 'CTR-2012-01 is % with % days left, not expiring', v_standing, v_days;
  end if;

  /* ASSERT-7: the superseded one is still readable and points at its successor,
     so the history is a chain rather than a gap. */
  select count(*) into n from public.enterprise_contract c
    join public.enterprise_contract s on s.id = c.superseded_by
   where c.state = 'superseded';
  if n <> 1 then raise exception 'the superseded agreement does not point at what replaced it'; end if;

  /* ASSERT-8: every amendment says both what it changed from and what to. A
     change with only one side is a note, not an amendment. */
  select string_agg(id, ', ') into bad from public.enterprise_contract_amendment
   where length(trim(was)) < 10 or length(trim(now_says)) < 10 or length(trim(why)) < 40;
  if bad is not null then raise exception 'amendments that do not say what changed or why: %', bad; end if;

  /* ASSERT-9: Harbourpoint's amendment and their contract agree. An amendment
     that moved them to Net 15 beside a contract still reading Net 30 is two
     records of one change, which is how they drift. */
  select c.terms into bad from public.enterprise_contract c where c.id = 'CTR-2014-01';
  if bad <> 'Net 15' then
    raise exception 'CTR-2014-01 reads % and its amendment moved it to Net 15', bad;
  end if;
end $$;
