/*
  # A bill template does not decide what currency the money is in

  `invoice_templates.currency` was a free-text field on the operator's template
  editor, and it decided nothing. Every document takes its currency from the row
  it is raised from — `consumer_bills.currency`, `enterprise_invoices.currency`,
  `settlement_statements.currency`, all three `not null` — so an operator could
  set a template to EUR and every bill under it still printed rupees.

  It is a leftover from when every document was in dollars, and the same
  leftover the money formatter already had removed: `money()` used to prefix a
  dollar sign, which was invisible until the first non-dollar document produced
  "AED$757.28". The mark belongs to the bill; so does the currency.

  Conceptually it could not have worked. A template is a layout, and the same
  layout raises a rupee bill for an Indian buyer and a dirham one for a buyer in
  the UAE. A currency on the layout is a currency on the wrong noun.

  The `?? 'USD'` fallbacks that guarded the reads go with it. They could never
  fire — the columns are not nullable — and had they ever fired they would have
  labelled somebody's rupees as dollars, which is worse than failing.
*/

alter table invoice_templates drop column if exists currency;

do $$
declare
  n integer;
begin
  /* The reason the column is unnecessary: every row a document is raised from
     says what money it is in, and says it not-null. */
  select count(*) into n
    from information_schema.columns
   where table_schema = 'public'
     and ((table_name = 'consumer_bills' and column_name = 'currency')
       or (table_name = 'enterprise_invoices' and column_name = 'currency')
       or (table_name = 'settlement_statements' and column_name = 'currency'))
     and is_nullable = 'YES';
  if n > 0 then
    raise exception '% billable tables allow a row with no currency, so removing the template default would leave a document with none', n;
  end if;

  select count(*) into n from information_schema.columns
   where table_schema='public' and table_name='invoice_templates' and column_name='currency';
  if n > 0 then
    raise exception 'The template still carries a currency';
  end if;

  /* And every existing document is in a currency one of our markets takes. */
  select count(*) into n from (
    select currency from consumer_bills
    union all select currency from enterprise_invoices
    union all select currency from settlement_statements
  ) x where x.currency not in (select currency from market_currencies) and x.currency <> 'USD';
  if n > 0 then
    raise exception '% documents are denominated in a currency no market takes', n;
  end if;
end $$;
