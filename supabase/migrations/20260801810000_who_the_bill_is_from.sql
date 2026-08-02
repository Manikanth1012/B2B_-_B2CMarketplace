-- The half of a bill that is the same on every bill.
--
-- The template says which sections appear. Two of those sections — the parties
-- block and the support block — print things that belong to the marketplace
-- rather than to the customer: our registered name, our address, our tax
-- registration, and the number somebody rings when the document is wrong.
--
-- Those were literals in the prototype, which is fine until the company
-- registers in a second state and the tax number on every document is wrong at
-- once. They are a row here, and the preview reads them, so what the operator
-- sees on screen is what the customer will read on paper.
--
-- One row, id 'default'. A marketplace bills as one legal entity; if that ever
-- stops being true this table grows a key rather than a second copy of itself.

create table if not exists invoice_issuer (
  id           text primary key default 'default',
  legal_name   text not null,
  trading_name text not null,
  /* Registered address, one line per line as it should be printed. An address
     assembled from fields at render time gets the comma wrong in one locale. */
  lines        text[] not null default '{}',
  tax_label    text not null default 'GSTIN',
  tax_id       text not null,
  /* Company registration is a different number from the tax one and a finance
     team that has to chase an invoice will ask for both. */
  company_no   text,
  bank_name    text not null default '',
  bank_detail  text not null default '',

  /* On the bill because a bill is where people look when something is wrong
     with a bill. */
  support_phone   text not null default '',
  support_hours   text not null default '',
  support_email   text not null default '',
  support_portal  text not null default '',
  dispute_window  text not null default '30 days from the issue date',
  dispute_note    text not null default '',
  escalation      text not null default '',

  terms        text[] not null default '{}',
  updated_by   text,
  updated_on   date
);

insert into invoice_issuer (id, legal_name, trading_name, lines, tax_label, tax_id, company_no,
                            bank_name, bank_detail,
                            support_phone, support_hours, support_email, support_portal,
                            dispute_window, dispute_note, escalation, terms,
                            updated_by, updated_on) values
  ('default',
   'Aventa Communications Private Limited', 'Aventa Telecom',
   array['Registered office: Level 9, Prestige Tech Park',
         'Marathahalli, Bengaluru 560103',
         'Karnataka, India'],
   'GSTIN', '29AAACA4471Q1ZV', 'U64200KA2019PTC128840',
   'HDFC Bank, Koramangala',
   'A/c 50200041127903 · IFSC HDFC0000053 · quote the document reference',
   '+91 80 4000 6000', 'Mon to Sat, 09:00–20:00 IST',
   'billing@aventa.com', 'aventa.com/help',
   '30 days from the issue date',
   'Raising a query on one line does not suspend the obligation to pay the rest of the bill.',
   'Unresolved after 10 working days: billing.escalations@aventa.com',
   array['Payment is due by the date shown on the face of this document.',
         'Queries must be raised within 30 days of the issue date.',
         'Late payment attracts interest at the statutory rate.',
         'Amounts are stated in the currency shown and include tax where indicated.'],
   'Anika Sharma', '2026-07-28')
on conflict (id) do update set
  legal_name = excluded.legal_name, lines = excluded.lines,
  tax_id = excluded.tax_id, support_phone = excluded.support_phone,
  support_email = excluded.support_email, terms = excluded.terms;

alter table invoice_issuer enable row level security;

drop policy if exists "operator_all_invoice_issuer" on invoice_issuer;
drop policy if exists "read_invoice_issuer" on invoice_issuer;

create policy "operator_all_invoice_issuer" on invoice_issuer for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* Everybody reads it. It is printed on a document we send them; there is
   nothing here they are not already holding. */
create policy "read_invoice_issuer" on invoice_issuer for select to anon, authenticated
  using (true);

/* ------------------------------------------------------- sanity checks -- */
do $$
declare r record; n integer;
begin
  select * into r from invoice_issuer where id = 'default';
  if r is null then raise exception 'no issuing entity — every bill would print a blank bill-from block'; end if;

  /* A parties block with no address is the thing this table exists to stop. */
  if array_length(r.lines, 1) is null or array_length(r.lines, 1) < 2 then
    raise exception 'the issuing entity has no printable registered address';
  end if;
  if coalesce(r.tax_id, '') = '' then
    raise exception 'a document titled "Tax invoice" would carry no tax registration';
  end if;
  if coalesce(r.support_phone, '') = '' and coalesce(r.support_email, '') = '' then
    raise exception 'the support block has neither a number nor an address on it';
  end if;

  /* The advert section draws from the live storefront banners rather than from
     copy typed into the template. If there is no live consumer banner the
     section renders nothing — which is correct, and worth knowing about. */
  select count(*) into n from operator_banners
   where status = 'live' and audience = 'consumer';
  if n = 0 then
    raise notice 'no live consumer banner: the advert section will render nothing on a consumer bill';
  end if;

  /* And there has to be something to preview against, per audience, or the
     builder shows an empty document and calls it a template. */
  if not exists (select 1 from consumer_bills) then raise exception 'no consumer bill to preview against'; end if;
  if not exists (select 1 from enterprise_invoices) then raise exception 'no enterprise invoice to preview against'; end if;
  if not exists (select 1 from settlement_statements) then raise exception 'no settlement statement to preview against'; end if;
end $$;
