/*
  # A bill is issued by an entity registered where the customer is

  `invoice_issuer` held one row, `id = 'default'`:

      Aventa Communications Private Limited
      Level 9, Prestige Tech Park, Marathahalli, Bengaluru 560103
      GSTIN 29AAACA4471Q1ZV
      HDFC Bank, Koramangala · A/c 50200041127903 · IFSC HDFC0000053
      +91 80 4000 6000 · Mon to Sat, 09:00–20:00 IST

  Every bill in every market was issued by it. So the Kenyan customer's VAT
  bill said it came from an Indian private limited company, quoted an Indian
  GST number against 16% Kenyan VAT, told her to pay into a rupee account in
  Bengaluru, and gave her an Indian support line open in Indian hours.

  The support number is the part somebody notices. The tax identifier is the
  part that matters: an entity registered only in India cannot charge Kenyan
  VAT, and a document saying it did is not a document a Kenyan finance team or
  a Kenyan tax authority would accept. The bank details are the part that costs
  money — a customer who follows them pays the wrong account.

  This was invisible for the same reason everything else in this file's
  neighbourhood was invisible: every customer was Indian, so the one issuer was
  always the right one.

  ## One issuer per market

  `market` is added and made unique, so the question "who issues a bill in
  Kenya" has exactly one answer. The Indian row keeps its id and its contents
  and gains `market = 'IN'` — nothing about the Indian customer's bill changes.
  Kenya and the UAE get their own entities, with their own registration, their
  own bank and their own support desk in their own hours.

  Everything is per market rather than converted. A Kenyan entity does not have
  a GSTIN with a different number on it; it has a KRA PIN, which is a different
  kind of thing. The same is true of the UAE's TRN.
*/

alter table invoice_issuer add column if not exists market text references markets(code);

update invoice_issuer set market = 'IN' where id = 'default';

/* The Kenyan entity. Registration, bank and support desk are Kenyan because
   each of them is what the customer is being told to rely on: the number to
   quote to the revenue authority, the account to pay into, the desk to ring. */
insert into invoice_issuer (
  id, market, legal_name, trading_name, lines, tax_label, tax_id, company_no,
  bank_name, bank_detail, support_phone, support_hours, support_email,
  support_portal, dispute_window, dispute_note, escalation, terms,
  updated_by, updated_on
) values (
  'KE', 'KE',
  'Aventa Telecom Kenya Limited', 'Aventa Telecom',
  array[
    'Registered office: Delta Corner, Tower B, 7th Floor',
    'Chiromo Road, Westlands, Nairobi 00800',
    'Kenya'
  ],
  'KRA PIN', 'P051447903J', 'PVT-ZQR7X4M',
  'Equity Bank Kenya, Westlands',
  'A/c 0170263481903 · Bank code 068 · Branch 00170 · quote the document reference',
  '+254 20 400 6000', 'Mon to Sat, 08:00–20:00 EAT',
  'billing.ke@aventa.com', 'aventa.co.ke/help',
  '30 days from the issue date',
  'Raising a query on one line does not suspend the obligation to pay the rest of the bill.',
  'Unresolved after 10 working days: billing.escalations@aventa.com',
  array[
    'Payment is due by the date shown on the face of this document.',
    'Queries must be raised within 30 days of the issue date.',
    'Late payment attracts interest at the statutory rate.',
    'Amounts are stated in the currency shown and include VAT where indicated.'
  ],
  'Kenya market opening', '2026-08-06'
)
on conflict (id) do update set
  market = excluded.market, legal_name = excluded.legal_name,
  lines = excluded.lines, tax_label = excluded.tax_label, tax_id = excluded.tax_id,
  bank_name = excluded.bank_name, bank_detail = excluded.bank_detail,
  support_phone = excluded.support_phone, support_hours = excluded.support_hours,
  support_email = excluded.support_email, support_portal = excluded.support_portal;

/* The UAE, seeded now rather than when somebody notices. A market that trades
   and has no issuing entity falls back to another country's bill, which is the
   bug this migration is about — leaving one of the three open would leave the
   bug in place for a third of the marketplace. */
insert into invoice_issuer (
  id, market, legal_name, trading_name, lines, tax_label, tax_id, company_no,
  bank_name, bank_detail, support_phone, support_hours, support_email,
  support_portal, dispute_window, dispute_note, escalation, terms,
  updated_by, updated_on
) values (
  'AE', 'AE',
  'Aventa Telecom FZ-LLC', 'Aventa Telecom',
  array[
    'Registered office: Office 1204, Building 12',
    'Dubai Internet City, Dubai',
    'United Arab Emirates'
  ],
  'TRN', '100447903600003', 'DIC-84412',
  'Emirates NBD, Sheikh Zayed Road',
  'A/c 1014470390301 · IBAN AE070331234567890123456 · quote the document reference',
  '+971 4 400 6000', 'Sun to Thu, 09:00–18:00 GST',
  'billing.ae@aventa.com', 'aventa.ae/help',
  '30 days from the issue date',
  'Raising a query on one line does not suspend the obligation to pay the rest of the bill.',
  'Unresolved after 10 working days: billing.escalations@aventa.com',
  array[
    'Payment is due by the date shown on the face of this document.',
    'Queries must be raised within 30 days of the issue date.',
    'Late payment attracts interest at the statutory rate.',
    'Amounts are stated in the currency shown and include VAT where indicated.'
  ],
  'Kenya market opening', '2026-08-06'
)
on conflict (id) do update set
  market = excluded.market, legal_name = excluded.legal_name;

/* One issuer per market, and the question has one answer. Without this a second
   Kenyan entity could be added and which of the two printed on a bill would
   depend on row order. */
create unique index if not exists invoice_issuer_market_idx on invoice_issuer (market);

alter table invoice_issuer drop constraint if exists invoice_issuer_market_check;
alter table invoice_issuer add constraint invoice_issuer_market_check
  check (market is not null);

do $$
declare
  n integer;
  r record;
begin
  /* Every market the marketplace trades in can issue its own bill. */
  for r in
    select m.code, m.name from markets m
     where not exists (select 1 from invoice_issuer i where i.market = m.code)
  loop
    raise exception '% has no issuing entity, so its bills would come from another country', r.name;
  end loop;

  select count(*) into n from invoice_issuer where market is null;
  if n > 0 then raise exception '% issuers belong to no market', n; end if;

  /* The tax identifier is the market's, not a copy of somebody else's. A
     Kenyan entity has a KRA PIN and an Emirati one a TRN — these are different
     kinds of number, not the same number formatted differently, and a bill
     carrying the wrong one is a bill that cannot be filed. */
  select count(*) into n from invoice_issuer
   where (market = 'IN' and tax_label <> 'GSTIN')
      or (market = 'KE' and tax_label <> 'KRA PIN')
      or (market = 'AE' and tax_label <> 'TRN');
  if n > 0 then raise exception '% issuers carry another country''s kind of tax identifier', n; end if;

  /* And the support desk is reachable from where the customer is. A dialling
     code is the cheapest possible check that somebody thought about it. */
  select count(*) into n from invoice_issuer
   where (market = 'IN' and support_phone not like '+91%')
      or (market = 'KE' and support_phone not like '+254%')
      or (market = 'AE' and support_phone not like '+971%');
  if n > 0 then raise exception '% issuers give a support number in the wrong country', n; end if;

  select count(*) into n from invoice_issuer
   where (market = 'IN' and support_hours not like '%IST%')
      or (market = 'KE' and support_hours not like '%EAT%')
      or (market = 'AE' and support_hours not like '%GST%');
  if n > 0 then raise exception '% issuers quote opening hours in the wrong time zone', n; end if;

  /* Two entities must not share a bank account. */
  select count(*) into n from (
    select bank_detail from invoice_issuer group by bank_detail having count(*) > 1) x;
  if n > 0 then raise exception 'Two issuing entities share a bank account'; end if;

  /* The Indian bill is untouched. It is the one every existing demo shows, and
     this migration is about the other two. */
  select count(*) into n from invoice_issuer
   where id = 'default' and (legal_name <> 'Aventa Communications Private Limited'
      or support_phone <> '+91 80 4000 6000' or tax_id <> '29AAACA4471Q1ZV');
  if n > 0 then raise exception 'The Indian issuer was changed'; end if;
end $$;
