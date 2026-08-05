/*
  # The biller and the customer's employer are not the same building

  The Kenyan customer's work address:

      Delta Corner, Chiromo Road, Westlands · Nairobi 00800

  The Kenyan issuing entity's registered office, added a few migrations later:

      Delta Corner, Tower B, 7th Floor · Chiromo Road, Westlands, Nairobi 00800

  She works in her telecom provider's registered office. Nobody would write
  that; it happened because both were reached for the same plausible Nairobi
  business address, a few hours apart, with nothing comparing them.

  It matters on one screen in particular. The bill prints BILLED TO and BILL
  FROM side by side, and on hers they were about to name the same building —
  which reads as a rendering fault rather than as two facts that happen to
  coincide.

  The issuing entity moves. It is the newer record, and the customer's employer
  was there first.
*/

update invoice_issuer set lines = array[
  'Registered office: The Piano, 8th Floor',
  'Brookside Drive, Westlands, Nairobi 00800',
  'Kenya'
] where market = 'KE';

do $$
declare r record;
begin
  /* No customer is billed from their own address. A bill whose two parties are
     the same place is a bill somebody will read twice and then report. */
  for r in
    select p.name, a.line1
      from consumer_addresses a
      join consumer_profile p on p.user_id = a.user_id
      join invoice_issuer i on i.market = p.market
      join lateral unnest(i.lines) as l(line) on true
     where lower(regexp_replace(a.line1, '[^a-z0-9]', '', 'gi'))
             <> '' and
           position(lower(split_part(regexp_replace(a.line1, '[^a-zA-Z0-9 ]', '', 'g'), ' ', 1)
                    || split_part(regexp_replace(a.line1, '[^a-zA-Z0-9 ]', '', 'g'), ' ', 2))
                in lower(replace(l.line, ',', ''))) > 0
  loop
    raise exception '% has an address at %, which is also where the entity billing them is registered',
      r.name, r.line1;
  end loop;
end $$;
