/* Thirteen sellers, one tax number each — and not the same one.
 *
 * The withholding screen surfaced two things about `partner_bank` the moment it
 * had rules to hold the data up against.
 *
 * ONE. Every seller carries a treaty certificate, including the ten paid by an
 * entity in their own country. A double-tax treaty governs a payment that
 * crosses a border. On a domestic payment it does nothing, and a certificate
 * recorded against one is either a filing error or a claim for relief that does
 * not exist. The screen says so on all thirteen rows, which is the screen
 * working and the data being wrong.
 *
 * TWO. All seven Indian sellers share the PAN `AAACH1234K`, all four Emirati
 * sellers share one TRN, and both Kenyan sellers share one KRA PIN. A tax
 * identifier identifies a taxpayer; seven companies filing under one is not a
 * placeholder that nobody notices, it is the first thing an authority queries
 * and the reason a deduction gets disallowed.
 *
 * Both are seed data that was never checked because nothing read it. Something
 * reads it now.
 */

/* ---- 1. A treaty certificate belongs to a cross-border payment --------------- */

update public.partner_bank b set
  treaty_on_file = false,
  treaty_expires = null,
  withholding = format(
    'Domestic payment — %s tax resident, paid by the %s entity. The domestic rate applies and no treaty is engaged.',
    b.tax_residence, b.tax_residence)
 from public.partners p
where p.id = b.partner_id
  and b.tax_residence = p.market
  and b.treaty_on_file;

/* Nothing here is cross-border today, and that is worth stating rather than
   leaving as an empty case. The moment a seller banks somewhere other than the
   market that pays them, the non-resident rate applies until a certificate
   arrives — and the screen already says so. */

/* ---- 2. One taxpayer, one number --------------------------------------------- */

/* Real formats, distinct per company. An Indian PAN is five letters, four
   digits and a check letter; a UAE TRN is fifteen digits; a Kenyan PIN is a
   letter, nine digits and a letter. Wrong-looking identifiers get rejected by
   the authority's own validation before a human ever sees them. */
update public.partner_bank set tax_id = v.tax_id
  from (values
    ('PTR-1001', 'AAJCS4718R'),
    ('PTR-1002', 'AAECK2291M'),
    ('PTR-1003', '100294817300003'),
    ('PTR-1004', 'AABCN7734P'),
    ('PTR-1005', 'AADCP5162L'),
    ('PTR-1006', 'AAFCA9008J'),
    ('PTR-1007', '100558140200003'),
    ('PTR-1008', 'AAGCV3376H'),
    ('PTR-1009', 'P051772913X'),
    ('PTR-1010', '100731662900003'),
    ('PTR-1011', 'AAHCT6620D'),
    ('PTR-1012', '100904275500003'),
    ('PTR-1015', 'P051884027Y')
  ) as v(partner_id, tax_id)
 where public.partner_bank.partner_id = v.partner_id;

/* ---- 3. Assertions ------------------------------------------------------------ */

do $$
declare n int; bad text;
begin
  /* No treaty certificate against a domestic payment. */
  select string_agg(b.partner_id, ', ') into bad
    from public.partner_bank b join public.partners p on p.id = b.partner_id
   where b.tax_residence = p.market and b.treaty_on_file;
  if bad is not null then
    raise exception 'treaty certificates still recorded on domestic payments: %', bad;
  end if;

  /* One taxpayer, one number. */
  select string_agg(x.tax_id || ' × ' || x.shared, ', ') into bad from (
    select tax_id, count(*) as shared from public.partner_bank
     where tax_id is not null group by tax_id having count(*) > 1
  ) x;
  if bad is not null then raise exception 'tax numbers shared between sellers: %', bad; end if;

  /* And each one looks like what it claims to be, because an identifier the
     authority's own validation rejects never reaches a human. */
  select string_agg(b.partner_id || ' (' || b.tax_label || ' ' || b.tax_id || ')', ', ') into bad
    from public.partner_bank b join public.partners p on p.id = b.partner_id
   where (p.market = 'IN' and b.tax_id !~ '^[A-Z]{5}[0-9]{4}[A-Z]$')
      or (p.market = 'AE' and b.tax_id !~ '^[0-9]{15}$')
      or (p.market = 'KE' and b.tax_id !~ '^[A-Z][0-9]{9}[A-Z]$');
  if bad is not null then raise exception 'tax identifiers in the wrong format: %', bad; end if;

  /* Every seller has one at all — the case that doubles the rate in most
     regimes. */
  select count(*) into n from public.partner_bank where tax_id is null or tax_id = '';
  if n > 0 then raise exception '% sellers have no tax identifier', n; end if;

  raise notice 'distinct tax ids: %; treaty certificates on file: %',
    (select count(distinct tax_id) from public.partner_bank),
    (select count(*) from public.partner_bank where treaty_on_file);
end $$;
