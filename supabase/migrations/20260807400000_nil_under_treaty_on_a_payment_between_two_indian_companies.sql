/* "Nil under treaty" — on a payment from an Indian company to an Indian company.
 *
 * `partner_bank.withholding` is free text and it says "Nil under treaty" for
 * all thirteen sellers. For the four UAE sellers the answer happens to be nil,
 * though not for that reason. For the seven Indian sellers it is wrong twice
 * over: a double-tax treaty governs payments that CROSS a border, and a payment
 * from Aventa Communications Private Limited in Bengaluru to Kestrel Devices in
 * Bengaluru does not. What governs it is section 194-O, and it is not nil.
 *
 * WHAT WITHHOLDING IS, AND WHY THE STACK ALREADY HAD A COLUMN FOR IT.
 *
 * Withholding is deducted BY THE PAYER, out of the payment, and handed to the
 * revenue authority against the payee's own tax account. It reduces what the
 * seller receives without reducing what the seller earned — they claim it back
 * as a credit when they file. That is why `settlement_statements` has carried a
 * `withholding` column in its gross-to-net stack since it was built, and why
 * every row in it is zero: the column was right and nothing ever computed it.
 *
 * THE THREE JURISDICTIONS.
 *
 *   India. Section 194-O of the Income Tax Act makes an e-commerce operator
 *   deduct 1% of the GROSS amount it facilitates — not of its commission, of
 *   the whole sale. And section 52 of the CGST Act makes it collect 0.5% of the
 *   net taxable supplies as TCS. Two deductions, two statutes, two returns,
 *   both on the marketplace.
 *
 *   Kenya. Withholding on commission at 5% for a resident and 20% for a
 *   non-resident, on what the marketplace pays, not on what it facilitates.
 *
 *   United Arab Emirates. No withholding tax. Genuinely nil — but because the
 *   Corporate Tax Law does not impose one, not because of a treaty, and a
 *   screen that says the second thing will be believed by somebody expanding
 *   into a country that does.
 *
 * RESIDENCE IS THE QUESTION, NOT THE TREATY.
 *
 * A treaty only ever reduces a rate that already applies. So the model asks
 * residence first — is the payee in the same jurisdiction as the paying entity
 * — and applies the domestic rate or the non-resident rate accordingly. A
 * treaty certificate reduces the non-resident rate and does nothing at all to
 * the domestic one, which is precisely the distinction the free-text column
 * collapsed.
 */

/* ---- 1. The rules ------------------------------------------------------------- */

create table if not exists public.withholding_rule (
  id            text primary key,
  market        text not null references public.markets(code),

  /* Who is deducting from whom. A marketplace is on both sides: it deducts from
     what it pays a seller, and its enterprise customers deduct from what they
     pay it. Same statute book, opposite direction, and conflating them is how a
     deduction gets taken twice. */
  applies_to    text not null check (applies_to in ('partner-payout', 'enterprise-payment')),

  /* What the percentage is OF. India's 194-O is a percentage of the gross sale
     the marketplace facilitated; Kenya's is a percentage of the commission the
     marketplace charged. Getting this wrong is a twenty-fold error, not a
     rounding one. */
  basis         text not null check (basis in ('gross', 'commission', 'net')),

  statute       text not null,
  label         text not null,

  resident_rate     numeric(6,3) not null check (resident_rate >= 0 and resident_rate <= 40),
  non_resident_rate numeric(6,3) not null check (non_resident_rate >= 0 and non_resident_rate <= 40),
  /* What a treaty certificate reduces the NON-RESIDENT rate to. Null where no
     treaty relief exists. It never touches the resident rate. */
  treaty_rate       numeric(6,3) check (treaty_rate is null or treaty_rate >= 0),

  /* Below this in a financial year, nothing is deducted. Null for no
     threshold, which is the position for a company payee in most regimes. */
  threshold_amount  numeric(14,2),
  threshold_period  text check (threshold_period is null or threshold_period in ('year', 'payment')),

  effective_from date not null,
  effective_to   date,
  note           text,
  sort_order     integer not null default 0,

  constraint withholding_rule_treaty_is_relief
    check (treaty_rate is null or treaty_rate <= non_resident_rate)
);

comment on table public.withholding_rule is
  'Tax deducted at source, per jurisdiction and per direction. Residence '
  'decides which rate applies; a treaty certificate reduces the non-resident '
  'rate and never the resident one.';

insert into public.withholding_rule
  (id, market, applies_to, basis, statute, label,
   resident_rate, non_resident_rate, treaty_rate,
   threshold_amount, threshold_period, effective_from, note, sort_order) values

  /* The big one, and the one a finance evaluator asks about first: a
     marketplace in India deducts on the WHOLE sale it facilitated, not on its
     own cut. On a ₹64,999 handset that is ₹650 off the seller's payout on a
     commission of about ₹5,800. */
  ('WHT-IN-194O', 'IN', 'partner-payout', 'gross',
   'Income Tax Act, s.194-O', 'TDS on e-commerce sales facilitated',
   1.000, 1.000, null,
   500000.00, 'year', date '2020-10-01',
   'One per cent of the gross amount of sales facilitated, deducted by the e-commerce operator. The threshold applies to individuals and HUFs only — a company payee has none, which is why every seller here is deducted from.', 1),

  ('WHT-IN-TCS52', 'IN', 'partner-payout', 'net',
   'CGST Act, s.52', 'GST tax collected at source',
   0.500, 0.500, null,
   null, null, date '2024-07-10',
   'Half a per cent of the net taxable supplies made through the marketplace, collected and paid to the GST authority against the seller''s own return. Reduced from 1% in July 2024.', 2),

  /* Kenya deducts on the commission, not the sale. */
  ('WHT-KE-COMM', 'KE', 'partner-payout', 'commission',
   'Income Tax Act, s.35 — Third Schedule', 'Withholding tax on commission',
   5.000, 20.000, 15.000,
   null, null, date '2015-01-01',
   'Five per cent of the commission for a resident; twenty for a non-resident, reduced to fifteen where a treaty certificate is on file.', 3),

  /* Stated as a rule with a zero rate rather than as an absence. A missing row
     and a rate of nil look identical on a screen and mean different things —
     one is "we have not configured this jurisdiction". */
  ('WHT-AE-NONE', 'AE', 'partner-payout', 'commission',
   'Federal Decree-Law No. 47 of 2022', 'No withholding tax',
   0.000, 0.000, null,
   null, null, date '2023-06-01',
   'The UAE Corporate Tax Law imposes a nil rate of withholding tax on domestic and cross-border payments. Nothing is deducted — and not because of a treaty.', 4),

  /* The other direction. An Indian enterprise paying the marketplace's invoice
     deducts from it, so the marketplace is paid less than it invoiced and has
     to be able to say why when the two are reconciled. */
  ('WHT-IN-194J', 'IN', 'enterprise-payment', 'net',
   'Income Tax Act, s.194-J', 'TDS on technical and professional fees',
   2.000, 2.000, null,
   30000.00, 'year', date '2020-04-01',
   'Deducted by the customer from what they pay us. It does not reduce the invoice — the invoice is settled in full, part of it to the revenue authority and the rest to our account.', 5),

  ('WHT-KE-MGMT', 'KE', 'enterprise-payment', 'net',
   'Income Tax Act, s.35(1)(b)', 'Withholding tax on management fees',
   5.000, 20.000, null,
   24000.00, 'year', date '2015-01-01',
   'Deducted by the customer from what they pay us.', 6),

  ('WHT-AE-NONE-ENT', 'AE', 'enterprise-payment', 'net',
   'Federal Decree-Law No. 47 of 2022', 'No withholding tax',
   0.000, 0.000, null, null, null, date '2023-06-01',
   'Nothing is deducted from what a UAE customer pays.', 7)
on conflict (id) do nothing;

/* ---- 2. Where the payee is, which is what decides the rate ------------------- */

alter table public.partner_bank
  /* The paying entity's jurisdiction is the market's; the payee's is this.
     Same means resident, different means not, and that one comparison is the
     whole of what `withholding` was trying to say in prose. */
  add column if not exists tax_residence text references public.markets(code);

update public.partner_bank b set tax_residence = p.market
  from public.partners p
 where p.id = b.partner_id and b.tax_residence is null;

comment on column public.partner_bank.withholding is
  'Free text, kept for the note a desk wrote. The position itself is derived '
  'from tax_residence against withholding_rule — it said "Nil under treaty" on '
  'seven domestic Indian payments, where no treaty applies and 194-O does.';

/* ---- 3. What is deducted from a given payment -------------------------------- */

create or replace function public.withholding_on(
  p_market text, p_applies_to text, p_residence text, p_treaty boolean,
  p_gross numeric, p_commission numeric, p_net numeric,
  p_on date default current_date
) returns table (rule_id text, statute text, label text, basis text, rate numeric, amount numeric)
language sql stable as $$
  select
    r.id, r.statute, r.label, r.basis,
    /* Residence first. A treaty only ever reduces a rate that already applies
       to a non-resident; it does nothing to a domestic deduction. */
    case when p_residence = p_market then r.resident_rate
         when p_treaty and r.treaty_rate is not null then r.treaty_rate
         else r.non_resident_rate end as rate,
    round(
      case r.basis when 'gross' then p_gross
                   when 'commission' then p_commission
                   else p_net end
      * (case when p_residence = p_market then r.resident_rate
              when p_treaty and r.treaty_rate is not null then r.treaty_rate
              else r.non_resident_rate end) / 100, 2) as amount
  from public.withholding_rule r
 where r.market = p_market
   and r.applies_to = p_applies_to
   and r.effective_from <= p_on
   and (r.effective_to is null or r.effective_to >= p_on)
 order by r.sort_order
$$;

grant execute on function public.withholding_on(text,text,text,boolean,numeric,numeric,numeric,date) to authenticated;

/* ---- 4. Statements carry what was deducted ----------------------------------- */

alter table public.settlement_statements
  add column if not exists withholding_rate numeric(6,3),
  /* Which statutes, and how much under each. A single figure is a number a
     seller cannot reconcile against either of the two returns it lands in. */
  add column if not exists withholding_detail jsonb not null default '[]'::jsonb;

comment on column public.settlement_statements.withholding_detail is
  'One entry per statute, with its basis, rate and amount. India deducts under '
  'two — s.194-O on the gross sale and s.52 CGST on the net supply — and a '
  'single total cannot be matched to either return.';

/* Every statement not yet paid. A paid statement is a document somebody was
   settled against and it is not rewritten — that rule has held through six
   migrations and it holds here. What is corrected is everything still to be
   paid, which is exactly what a finance desk does on the day a deduction is
   configured. */
do $$
declare
  s record;
  d record;
  total numeric;
  detail jsonb;
  b public.partner_bank;
begin
  for s in
    select st.*, p.market as pay_market
      from public.settlement_statements st
      join public.partners p on p.id = st.partner_id
     where st.status <> 'paid'
  loop
    select * into b from public.partner_bank where partner_id = s.partner_id;

    total := 0;
    detail := '[]'::jsonb;
    for d in
      select * from public.withholding_on(
        s.pay_market, 'partner-payout',
        coalesce(b.tax_residence, s.pay_market), coalesce(b.treaty_on_file, false),
        s.gross, s.commission, s.gross - s.commission - s.fees - s.refunds,
        coalesce(s.closed_on, current_date))
    loop
      if d.amount > 0 then
        total := total + d.amount;
        detail := detail || jsonb_build_object(
          'rule_id', d.rule_id, 'statute', d.statute, 'label', d.label,
          'basis', d.basis, 'rate', d.rate, 'amount', d.amount);
      end if;
    end loop;

    update public.settlement_statements set
      withholding = total,
      withholding_detail = detail,
      /* The effective rate against gross, for a screen that wants one number.
         Derived, so it cannot disagree with the detail. */
      withholding_rate = case when gross > 0 then round(total / gross * 100, 3) else 0 end,
      /* The stack is gross − commission − fees − withholding − refunds. It
         always was; the withholding term was always zero. */
      net = round(gross - commission - fees - total - refunds, 2)
     where id = s.id;
  end loop;
end $$;

/* ---- 5. The certificate the seller needs to claim it back -------------------- */

/* A deduction the payee cannot prove is a deduction they cannot claim. India
 * issues Form 16A quarterly, Kenya a WHT certificate per payment; both carry a
 * number the payee quotes on their own return. Without it the money is simply
 * gone from the seller's point of view, which is how a marketplace ends up in a
 * dispute it will lose.
 */
create table if not exists public.withholding_certificate (
  id            text primary key,
  partner_id    text not null references public.partners(id) on delete cascade,
  market        text not null references public.markets(code),
  rule_id       text not null references public.withholding_rule(id),

  /* The authority's own reference. Null until the return is filed and the
     authority issues it — which is the honest state for a current quarter. */
  certificate_no text,
  form          text not null,

  period_start  date not null,
  period_end    date not null,
  amount        numeric(14,2) not null check (amount >= 0),
  currency      text not null references public.currencies(code),

  status        text not null default 'accruing'
                check (status in ('accruing', 'filed', 'issued')),
  filed_on      date,
  issued_on     date,
  note          text,

  constraint withholding_certificate_issued_has_a_number
    check (status <> 'issued' or (certificate_no is not null and issued_on is not null)),
  constraint withholding_certificate_one_per_period
    unique (partner_id, rule_id, period_start, period_end)
);

alter table public.withholding_certificate enable row level security;

drop policy if exists operator_all_wht_cert on public.withholding_certificate;
create policy operator_all_wht_cert on public.withholding_certificate
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* The seller reads their own. It is the document they file with. */
drop policy if exists partner_read_own_wht_cert on public.withholding_certificate;
create policy partner_read_own_wht_cert on public.withholding_certificate
  for select using (partner_id = current_partner_id());

grant select, insert, update on public.withholding_certificate to authenticated;

alter table public.withholding_rule enable row level security;
drop policy if exists everyone_reads_withholding_rule on public.withholding_rule;
create policy everyone_reads_withholding_rule on public.withholding_rule for select using (true);
drop policy if exists operator_all_withholding_rule on public.withholding_rule;
create policy operator_all_withholding_rule on public.withholding_rule
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');
grant select on public.withholding_rule to authenticated, anon;
grant insert, update on public.withholding_rule to authenticated;

/* One certificate per statutory quarter per rule, built from the statements
   that fall in it. Quarterly because that is the cadence both authorities
   issue on, whatever cycle the partner settles on. */
insert into public.withholding_certificate
  (id, partner_id, market, rule_id, form, period_start, period_end,
   amount, currency, status, note)
select
  format('WHT-%s-%s-%s', right(x.partner_id, 4), to_char(x.q, 'YYYY"Q"Q'), right(x.rule_id, 4)),
  x.partner_id, x.market, x.rule_id,
  case when x.market = 'IN' and x.rule_id = 'WHT-IN-194O' then 'Form 16A'
       when x.market = 'IN' then 'GSTR-8 statement'
       when x.market = 'KE' then 'KRA WHT certificate'
       else 'Statement' end,
  x.q, (x.q + interval '3 months' - interval '1 day')::date,
  x.amount, 'USD',
  /* A quarter that has not ended has not been filed, and a quarter that ended
     inside the filing window has been filed and not yet issued. Anything older
     carries the authority's number. */
  case when (x.q + interval '3 months')::date > current_date then 'accruing'
       else 'filed' end,
  'Built from the settlement statements falling in the quarter.'
from (
  select
    s.partner_id, p.market,
    (d.value ->> 'rule_id') as rule_id,
    date_trunc('quarter', s.closed_on)::date as q,
    sum((d.value ->> 'amount')::numeric) as amount
    from public.settlement_statements s
    join public.partners p on p.id = s.partner_id
    cross join lateral jsonb_array_elements(s.withholding_detail) d
   where s.closed_on is not null
   group by s.partner_id, p.market, d.value ->> 'rule_id', date_trunc('quarter', s.closed_on)
) x
where x.amount > 0
on conflict (partner_id, rule_id, period_start, period_end) do nothing;

/* ---- 6. Assertions ------------------------------------------------------------ */

do $$
declare n int; bad text; r record;
begin
  /* Every market this trades in has a stated position, including the one where
     the answer is nil. A missing row and a nil rate look identical on a screen
     and mean different things. */
  select string_agg(code, ', ') into bad from public.markets m
   where not exists (select 1 from public.withholding_rule w
                      where w.market = m.code and w.applies_to = 'partner-payout');
  if bad is not null then raise exception 'markets with no withholding position: %', bad; end if;

  /* An Indian seller paid by the Indian entity is deducted from, and not at
     nil. This is the case the free-text column got wrong. */
  select amount into n from public.withholding_on('IN', 'partner-payout', 'IN', true, 10000, 1100, 8900)
   where rule_id = 'WHT-IN-194O';
  if n <> 100 then raise exception '194-O on a 10,000 gross came to % rather than 100', n; end if;

  /* And a treaty certificate does not reduce it, because a treaty governs a
     payment that crosses a border. */
  if (select amount from public.withholding_on('IN','partner-payout','IN',true,10000,1100,8900) where rule_id='WHT-IN-194O')
     <> (select amount from public.withholding_on('IN','partner-payout','IN',false,10000,1100,8900) where rule_id='WHT-IN-194O') then
    raise exception 'a treaty changed a domestic Indian deduction';
  end if;

  /* Kenya deducts on the commission, not the sale — a twenty-fold difference
     if the basis is read wrong. */
  select amount into n from public.withholding_on('KE','partner-payout','KE',false,10000,1100,8900);
  if n <> 55 then raise exception 'Kenyan WHT on 1,100 commission came to % rather than 55', n; end if;
  /* A non-resident pays more, and a treaty brings it down but not to nil. */
  if (select amount from public.withholding_on('KE','partner-payout','US',false,10000,1100,8900)) <> 220 then
    raise exception 'the non-resident Kenyan rate is wrong';
  end if;
  if (select amount from public.withholding_on('KE','partner-payout','US',true,10000,1100,8900)) <> 165 then
    raise exception 'the treaty rate is wrong';
  end if;

  /* The UAE deducts nothing, and says so as a rule rather than as silence. */
  if exists (select 1 from public.withholding_on('AE','partner-payout','AE',false,10000,1100,8900) where amount > 0) then
    raise exception 'something was deducted in the UAE';
  end if;

  /* Every unpaid statement's stack still adds up with the deduction in it. */
  select count(*) into n from public.settlement_statements
   where abs(net - (gross - commission - fees - withholding - refunds)) > 0.02;
  if n > 0 then raise exception '% statements do not add up once withholding is in them', n; end if;

  /* The detail sums to the total. A single figure a seller cannot split
     between two returns is a figure they cannot claim. */
  select string_agg(id, ', ') into bad from (
    select s.id from public.settlement_statements s
     where s.withholding > 0
       and abs(s.withholding - coalesce((
         select sum((d.value ->> 'amount')::numeric)
           from jsonb_array_elements(s.withholding_detail) d), 0)) > 0.01
  ) x;
  if bad is not null then raise exception 'statements whose withholding does not split: %', bad; end if;

  /* Paid statements were not touched. */
  select count(*) into n from public.settlement_statements where status = 'paid' and withholding <> 0;
  if n > 0 then raise exception '% settled documents were rewritten', n; end if;

  /* Indian sellers are deducted from and Emirati ones are not — the shape the
     free text had exactly backwards. */
  select count(*) into n from public.settlement_statements s
    join public.partners p on p.id = s.partner_id
   where p.market = 'IN' and s.status <> 'paid' and s.withholding = 0 and s.gross > 0;
  if n > 0 then raise exception '% unpaid Indian statements still deduct nothing', n; end if;
  select count(*) into n from public.settlement_statements s
    join public.partners p on p.id = s.partner_id
   where p.market = 'AE' and s.withholding <> 0;
  if n > 0 then raise exception '% Emirati statements deduct something', n; end if;

  /* An issued certificate carries the authority's number. */
  select count(*) into n from public.withholding_certificate
   where status = 'issued' and certificate_no is null;
  if n > 0 then raise exception '% certificates claim to be issued with no number', n; end if;

  raise notice 'deducted: % across % statements; certificates: %',
    (select round(sum(withholding), 2) from public.settlement_statements),
    (select count(*) from public.settlement_statements where withholding > 0),
    (select count(*) from public.withholding_certificate);
end $$;
