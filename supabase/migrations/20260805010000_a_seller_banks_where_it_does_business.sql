/*
  # A seller banks in a market the marketplace trades in

  The marketplace trades in India, the UAE and Kenya. Every seller on it is
  approved for those three. Nine of the fifteen banked somewhere else entirely:

      StreamNova Media      Singapore        PlayForge Games   Poland
      Nimbus Sensors        Germany          Halo Audio        Sweden
      Volta Routers         Taiwan           ClearVault Cloud  UK
      Lumen Wearables       Vietnam          Orbital Connect   Brazil
      Vertex Endpoint       Israel

  Nimbus Sensors is the seller the whole partner console demonstrates. Its
  people are in Kolkata, its contact is in Bengaluru, it sells into India, the
  UAE and Kenya — and its settlement account was a Deutsche Bank branch in
  München. Nothing in the product disagreed with that, because nothing in the
  product had any idea where the marketplace does business.

  ## Why the banking table could not simply lose two rows

  `BANK_CODES` in `partnerDetails.ts` had an entry per country, so a German
  seller was asked for a Bankleitzahl and a Singaporean one for a UEN. Deleting
  Singapore and Germany from it alone would have dropped those two sellers —
  one of them the demo seller — onto the generic fallback: a card reading
  "Local clearing code" and "Tax identifier" above a Bankleitzahl. That moves
  the confusion rather than removing it.

  So the sellers move instead, each to a market it actually sells in, with that
  market's real banking details: HDFC and an IFSC in India, Emirates NBD and a
  routing code in the UAE, Equity Bank and a branch code in Kenya — the same
  details the six sellers already resident in those markets carry.

  ## The part that is money

  `settlement_statements.payout_currency` tracks the seller's bank account
  exactly — every one of the 58 statements agreed with it before this ran. So
  moving a seller's account moves the currency they are paid in, and the payout
  leg has to be recomputed or the statement says it paid dollars into a rupee
  account at a rate of 1.

  Each affected statement is re-struck at the rate that was in force on its own
  `fx_as_of` — the same rule the statements already follow — rather than at
  today's. A statement is a record of what was paid then, and re-pricing history
  at a current rate would be a different and much worse kind of wrong. `net` in
  the booking currency never moves: what the seller earned did not change, only
  the account it lands in.
*/

/* Where each misplaced seller actually does business. Chosen per seller rather
   than defaulted to India, so the marketplace keeps sellers in all three of its
   markets — a "markets" feature exercised by one market is not exercised. */
create temporary table rehome (partner_id text primary key, market text) on commit drop;
insert into rehome values
  ('PTR-1001', 'India'),   -- StreamNova Media, content
  ('PTR-1004', 'India'),   -- Nimbus Sensors — the demo seller; its team is in Kolkata
  ('PTR-1005', 'India'),   -- PlayForge Games, content
  ('PTR-1008', 'India'),   -- Volta Routers, devices
  ('PTR-1007', 'UAE'),     -- Halo Audio, content
  ('PTR-1010', 'UAE'),     -- ClearVault Cloud, security
  ('PTR-1013', 'UAE'),     -- Lumen Wearables, devices
  ('PTR-1014', 'Kenya'),   -- Orbital Connect
  ('PTR-1015', 'Kenya');   -- Vertex Endpoint, security

/* The three markets' banking details, taken from the sellers already resident
   in each rather than invented. */
create temporary table market_bank (
  market text primary key, bank text, branch text, local_label text, local_code text,
  swift text, currency text, tax_label text, tax_id text, holder_suffix text, uses_iban boolean
) on commit drop;
insert into market_bank values
  ('India', 'HDFC Bank',    'Bengaluru — Residency Road',   'IFSC',             'HDFC0001234', 'HDFCINBB', 'INR', 'PAN',     'AAACH1234K',      'Private Limited', false),
  ('UAE',   'Emirates NBD', 'Dubai — Sheikh Zayed Road',    'Routing code',     '302620122',   'EBILAEAD', 'AED', 'TRN',     '100123456700003', 'Ltd',             true),
  ('Kenya', 'Equity Bank',  'Head office',                  'Bank/branch code', '068-000',     'EQBLKENA', 'KES', 'KRA PIN', 'P051234567X',     'Ltd',             false);

update partner_bank b
   set residency   = mb.market,
       bank        = mb.bank,
       branch      = mb.branch,
       local_label = mb.local_label,
       local_code  = mb.local_code,
       swift       = mb.swift,
       currency    = mb.currency,
       tax_label   = mb.tax_label,
       tax_id      = mb.tax_id,
       holder      = p.name || ' ' || mb.holder_suffix,
       /* An IBAN where the country uses one and null where it does not — the
          form asks for exactly one of the two, and a stale German IBAN sitting
          on an Indian account is the drift this migration is about. */
       iban        = case when mb.uses_iban then 'AE0737041' || right(b.account, 9) else null end
  from rehome r
  join market_bank mb on mb.market = r.market
  join partners p on p.id = r.partner_id
 where b.partner_id = r.partner_id;

update partners p
   set country = r.market
  from rehome r
 where p.id = r.partner_id;

/* ------------------------------------------------------------ the payout --- */

/* `fx_as_of` moves to the first of the statement's month, which is where every
   statement that was already converted takes its rate from — Kestrel's rupee
   payouts are struck at the 1st, and so are Sentinel's dirham ones.

   The statements being converted here carry the last day of the month instead,
   because they were paid in the currency they were booked in and no rate was
   ever looked up: at 1:1 the date was decorative, so nothing made it agree with
   the other convention. It stops being decorative the moment the leg needs a
   real rate, and there is no published rate on the 28th of February.

   The rate is matched to the statement in the WHERE rather than in a join's ON:
   in `update ... from a join b`, the row being updated is not in scope inside
   the join, so `fx.as_of = ...s` there is a reference Postgres refuses. */
update settlement_statements s
   set payout_currency = x.ccy,
       fx_as_of        = x.as_of,
       fx_rate         = x.rate,
       payout_net      = round(s.net * x.rate, 2)
  from (
    select r.partner_id, b.currency ccy, fx.base, fx.as_of, fx.rate
      from rehome r
      join partner_bank b on b.partner_id = r.partner_id
      join fx_rates fx on fx.quote = b.currency
  ) x
 where s.partner_id = x.partner_id
   and s.currency   = x.base
   and date_trunc('month', s.fx_as_of)::date = x.as_of
   and x.ccy <> s.currency;

/* A seller paid in the currency the statement is already booked in needs no
   conversion, and a rate of anything but 1 would be a fiction. */
update settlement_statements s
   set payout_currency = b.currency,
       fx_rate         = 1,
       payout_net      = s.net
  from rehome r
  join partner_bank b on b.partner_id = r.partner_id
 where s.partner_id = r.partner_id
   and b.currency = s.currency;

do $$
declare
  n integer;
  r record;
begin
  /* Nobody banks outside a market the marketplace trades in. This is the whole
     point, and it is checked against `markets` rather than a list written here,
     so opening a fourth market does not silently make this assertion wrong. */
  select count(*) into n from partner_bank b
   where b.residency not in (select case code when 'AE' then 'UAE' else name end from markets);
  if n > 0 then
    raise exception '% sellers bank in a country the marketplace does not trade in', n;
  end if;

  select count(*) into n from partners p
    join partner_bank b on b.partner_id = p.id
   where p.country is distinct from b.residency;
  if n > 0 then
    raise exception '% sellers are registered in one country and bank in another', n;
  end if;

  /* The details match the residency. A row that says India and carries a
     Bankleitzahl passes every other check in here. */
  select count(*) into n
    from partner_bank b
   where (b.residency = 'India' and (b.local_label <> 'IFSC'             or b.swift <> 'HDFCINBB' or b.currency <> 'INR' or b.iban is not null))
      or (b.residency = 'UAE'   and (b.local_label <> 'Routing code'     or b.swift <> 'EBILAEAD' or b.currency <> 'AED' or b.iban is null))
      or (b.residency = 'Kenya' and (b.local_label <> 'Bank/branch code' or b.swift <> 'EQBLKENA' or b.currency <> 'KES' or b.iban is not null));
  if n > 0 then
    raise exception '% bank records carry details from a different country than their residency', n;
  end if;

  /* The invariant that made this migration about money: a statement pays into
     the account the seller holds. It held before and it has to hold after. */
  select count(*) into n
    from settlement_statements s join partner_bank b on b.partner_id = s.partner_id
   where s.payout_currency is distinct from b.currency;
  if n > 0 then
    raise exception '% statements pay a currency the seller''s account cannot take', n;
  end if;

  /* And the arithmetic behind it. Checked to the cent, because a rounding rule
     applied differently here than by whatever wrote the rest would show up as a
     seller being paid a few rupees off and nobody able to say why. */
  for r in
    select s.id, s.net, s.fx_rate, s.payout_net, round(s.net * s.fx_rate, 2) expected
      from settlement_statements s
     where s.payout_net is distinct from round(s.net * s.fx_rate, 2)
  loop
    raise exception 'Statement % pays % but its net % at rate % comes to %',
      r.id, r.payout_net, r.net, r.fx_rate, r.expected;
  end loop;

  /* Every converted leg used the rate in force on its own date, not today's. */
  select count(*) into n
    from settlement_statements s
   where s.currency <> s.payout_currency
     and not exists (
       select 1 from fx_rates fx
        where fx.base = s.currency and fx.quote = s.payout_currency
          and fx.as_of = s.fx_as_of and fx.rate = s.fx_rate
     );
  if n > 0 then
    raise exception '% statements were converted at a rate that was not the one in force on their own date', n;
  end if;

  select count(*) into n from settlement_statements
   where currency = payout_currency and fx_rate <> 1;
  if n > 0 then
    raise exception '% statements convert a currency into itself at a rate other than 1', n;
  end if;
end $$;
