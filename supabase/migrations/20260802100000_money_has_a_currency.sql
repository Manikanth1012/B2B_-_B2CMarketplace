-- Every amount in this marketplace was a bare number.
--
-- Forty-five tables carry money and not one of them said what currency it was
-- in. Six separate formatters in the client each hardcoded a dollar sign and
-- en-US grouping, and 257 more places wrote `$` straight into the markup. The
-- handful of `currency` columns that do exist — on enterprise_accounts,
-- invoice_templates, partner_bank, refunds and settlement_statements — all say
-- USD, on every row. They were stubs.
--
-- Meanwhile the storefront names three markets in its header and its footer
-- and its hero copy, sellers are onboarded from twelve countries, and the
-- invoice issuer is Aventa Communications Private Limited of Bengaluru,
-- GSTIN 29AAACA4471Q1ZV, levying 18% GST — and billing in US dollars. An
-- Indian entity charging Indian GST invoices in rupees. A USD invoice with a
-- GSTIN on it is not a document that exists.
--
-- This migration adds the three things every later one depends on: what
-- currencies there are, what a unit of one is worth in another *on a given
-- day*, and which market a customer is buying in — because the market decides
-- both the currency and the tax.
--
-- The dating of rates is the part that matters most. A bill issued in March
-- must still read the same in August. That is only true if the rate it used is
-- recorded against the bill rather than looked up at render time, and it is
-- only recordable if rates have dates. Everything downstream pins a rate; this
-- is where there is one to pin.

/* ============================================================ currencies === */

create table if not exists currencies (
  code          text primary key,
  name          text not null,
  symbol        text not null,
  /* How many decimal places the currency actually has. All four here have two,
     but the rule is not "two" — JPY has none and KWD has three, and code that
     assumes two is code that will one day round a Kuwaiti invoice wrong. The
     column exists so the rounding rule is read rather than assumed. */
  minor_units   integer not null default 2 check (minor_units between 0 and 4),
  symbol_first  boolean not null default true,
  /* Grouping is not universal. en-IN groups by lakh — 1,00,000, not 100,000 —
     and a rupee figure grouped the American way is a figure an Indian customer
     reads twice. */
  locale        text not null default 'en-US',
  /* The one currency the operator's own rollups are expressed in. */
  is_reporting  boolean not null default false,
  sort_order    integer not null default 0
);

insert into currencies (code, name, symbol, minor_units, symbol_first, locale, is_reporting, sort_order) values
  ('USD', 'US Dollar',          '$',   2, true, 'en-US', true,  1),
  ('INR', 'Indian Rupee',       '₹',   2, true, 'en-IN', false, 2),
  ('AED', 'UAE Dirham',         'AED', 2, true, 'en-AE', false, 3),
  ('KES', 'Kenyan Shilling',    'KSh', 2, true, 'en-KE', false, 4)
on conflict (code) do update set
  name = excluded.name, symbol = excluded.symbol, minor_units = excluded.minor_units,
  symbol_first = excluded.symbol_first, locale = excluded.locale,
  is_reporting = excluded.is_reporting, sort_order = excluded.sort_order;

/* ============================================================= fx rates === */

create table if not exists fx_rates (
  id      text primary key,
  base    text not null references currencies(code),
  quote   text not null references currencies(code),
  rate    numeric not null check (rate > 0),
  as_of   date not null,
  source  text not null default 'Marketplace treasury',
  /* A pegged rate does not move and is not a market observation. The dirham
     has been fixed to the dollar at 3.6725 since 1997; showing it with a date
     and a source as though it were yesterday's fix misrepresents what it is. */
  pegged  boolean not null default false,
  unique (base, quote, as_of),
  /* A currency against itself is 1 by definition and is never stored — a row
     saying otherwise would be a rate that could be edited to something absurd
     and would silently rewrite every conversion that passes through it. */
  check (base <> quote)
);

/* One base — the reporting currency — and a rate out to each market currency.
   Storing only one direction and inverting on read means the pair can never
   disagree with itself, which a stored inverse rounded to six places always
   eventually does. */
insert into fx_rates (id, base, quote, rate, as_of, source, pegged) values
  ('FX-USD-INR-20260801', 'USD', 'INR',  87.4200, '2026-08-01', 'Marketplace treasury', false),
  ('FX-USD-AED-20260801', 'USD', 'AED',   3.6725, '2026-08-01', 'Central bank peg',     true),
  ('FX-USD-KES-20260801', 'USD', 'KES', 129.2000, '2026-08-01', 'Marketplace treasury', false),
  /* A month earlier, so that a document issued in July and pinned to July's
     rate demonstrably differs from one issued in August. A rate table with a
     single date cannot show that it is doing anything. */
  ('FX-USD-INR-20260701', 'USD', 'INR',  86.9000, '2026-07-01', 'Marketplace treasury', false),
  ('FX-USD-AED-20260701', 'USD', 'AED',   3.6725, '2026-07-01', 'Central bank peg',     true),
  ('FX-USD-KES-20260701', 'USD', 'KES', 128.4500, '2026-07-01', 'Marketplace treasury', false)
on conflict (id) do update set rate = excluded.rate, pegged = excluded.pegged;

/* =============================================================== markets === */

create table if not exists markets (
  code       text primary key,
  name       text not null,
  currency   text not null references currencies(code),
  /* Tax is a property of where the sale happens, not of what is sold. One rate
     per market is a simplification — real jurisdictions rate goods and
     services differently — but it is the right shape, and it is the shape the
     bills already assume when they print a single rate at the foot. */
  tax_label  text not null,
  tax_rate   numeric not null check (tax_rate >= 0 and tax_rate < 100),
  tax_note   text not null default '',
  is_default boolean not null default false,
  sort_order integer not null default 0
);

insert into markets (code, name, currency, tax_label, tax_rate, tax_note, is_default, sort_order) values
  ('IN', 'India',              'INR', 'GST', 18, 'Goods and Services Tax, charged on the full invoice value.', true,  1),
  ('AE', 'United Arab Emirates','AED', 'VAT',  5, 'Value Added Tax at the standard rate.',                     false, 2),
  ('KE', 'Kenya',              'KES', 'VAT', 16, 'Value Added Tax at the standard rate.',                      false, 3)
on conflict (code) do update set
  currency = excluded.currency, tax_label = excluded.tax_label,
  tax_rate = excluded.tax_rate, tax_note = excluded.tax_note;

/* ============================================================ visibility === */

alter table currencies enable row level security;
alter table fx_rates   enable row level security;
alter table markets    enable row level security;

/* Reference data. A shopper who cannot read the currency list cannot be shown
   a price, so these are readable by everyone including anon — the storefront
   is public. Only the operator sets them. */
do $$
declare t text;
begin
  foreach t in array array['currencies', 'fx_rates', 'markets'] loop
    execute format('drop policy if exists "%s_read" on %I', t, t);
    execute format('drop policy if exists "%s_operator" on %I', t, t);
    execute format('create policy "%s_read" on %I for select to anon, authenticated using (true)', t, t);
    execute format($p$create policy "%s_operator" on %I for all to authenticated
      using (current_persona() = 'operator') with check (current_persona() = 'operator')$p$, t, t);
  end loop;
end $$;

/* --------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text;
begin
  /* Exactly one reporting currency. Two would mean every rollup in the
     operator console silently picks one of them. */
  select count(*) into n from currencies where is_reporting;
  if n <> 1 then raise exception 'expected exactly 1 reporting currency, found %', n; end if;

  /* Exactly one default market, for the same reason. */
  select count(*) into n from markets where is_default;
  if n <> 1 then raise exception 'expected exactly 1 default market, found %', n; end if;

  /* Every market can be priced. A market whose currency has no rate to the
     reporting currency is a market the operator cannot report on. */
  select string_agg(m.code, ', ') into s from markets m
   where not exists (
     select 1 from fx_rates f
      where f.base = (select code from currencies where is_reporting)
        and f.quote = m.currency)
     and m.currency <> (select code from currencies where is_reporting);
  if s is not null then raise exception 'these markets have no exchange rate: %', s; end if;

  /* The dirham peg is the actual peg. A "pegged" row carrying a made-up number
     is worse than an unpegged one, because nobody will think to check it. */
  select count(*) into n from fx_rates
   where base = 'USD' and quote = 'AED' and pegged and rate <> 3.6725;
  if n > 0 then raise exception 'the AED peg is 3.6725, and % row(s) disagree', n; end if;

  /* A pegged pair does not move between dates. */
  select count(*) into n from (
    select base, quote from fx_rates where pegged group by base, quote having count(distinct rate) > 1
  ) x;
  if n > 0 then raise exception '% pegged pair(s) change value between dates, which is what pegged means they cannot do', n; end if;

  /* The default market's tax rate must be the rate the existing bills and
     invoices were raised at. Every consumer bill and business invoice on
     record says 18, set by 20260801870000. If this table said something else,
     this migration would quietly make every historical document disagree with
     the jurisdiction it claims to have been issued under. */
  select tax_rate into n from markets where is_default;
  if exists (select 1 from consumer_bills where tax_rate <> n) then
    raise exception 'consumer bills were raised at a rate the default market does not charge';
  end if;
  if exists (select 1 from enterprise_invoices where tax_rate <> n) then
    raise exception 'business invoices were raised at a rate the default market does not charge';
  end if;

  /* Rates are held one way only, so nothing can contradict its own inverse. */
  select count(*) into n from fx_rates a join fx_rates b
    on a.base = b.quote and a.quote = b.base and a.as_of = b.as_of;
  if n > 0 then raise exception '% rate pair(s) are stored in both directions and will drift apart', n; end if;
end $$;
