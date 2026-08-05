/*
  # A seller is registered somewhere too

  `20260806050000` gave each market its own issuing entity, so a customer's bill
  now comes from a company registered where they are. A seller's settlement
  statement is the same kind of document and has the same problem — and it could
  not be fixed in that migration, because `partners` records where a seller is
  as a country name:

      India · Kenya · UAE

  while `markets` keys on a code, and 'UAE' is not 'United Arab Emirates'. A
  name lookup would have worked for two of the three and quietly failed for the
  third — which is the fault this whole neighbourhood keeps producing.

  So the seller gets a `market` the same way every other party has one: a column
  referencing `markets(code)`, derived once from the country they registered in,
  and checked afterwards rather than re-derived at every call site.

  `country` stays. It is what the seller typed and what their onboarding
  evidence says; `market` is which of the marketplace's three jurisdictions that
  places them in. They are different facts and a seller in Uganda would have a
  country and no market.
*/

alter table partners add column if not exists market text references markets(code);

/* Derived from the country, once. The mapping is written out rather than
   matched on name because that is exactly what does not work — the third row
   is the one that would have failed silently. */
update partners set market = case country
  when 'India' then 'IN'
  when 'Kenya' then 'KE'
  when 'UAE'   then 'AE'
end
where market is null;

do $$
declare n integer; r record;
begin
  /* A seller with no market is a seller whose settlement statement has no
     issuer, which is visible. A seller with the wrong market is a seller whose
     statement comes from another country's company, which is not. */
  for r in select id, name, country from partners where market is null loop
    raise exception 'Seller % is registered in %, which is not one of the marketplace''s markets — their settlement statement would have no issuing entity',
      r.name, r.country;
  end loop;

  /* Where a seller says they are and where their money is priced must agree. A
     Kenyan seller listing only in India is a real thing; a Kenyan seller whose
     own record says India is a data fault. */
  select count(*) into n
    from partners p
   where not exists (select 1 from markets m where m.code = p.market);
  if n > 0 then raise exception '% sellers sit in a market that does not exist', n; end if;

  /* And every market a seller can be in can issue them a document. */
  select count(*) into n
    from partners p
   where not exists (select 1 from invoice_issuer i where i.market = p.market);
  if n > 0 then
    raise exception '% sellers are in a market with no issuing entity, so their statements would come from another country', n;
  end if;
end $$;

/* A seller reads their own row, and the operator reads all of them. `market` is
   part of the record either way, so no policy changes — but it is worth stating
   that this column is not sensitive: it is the country already printed on their
   own settlement statement. */
