-- Rewards are denominated in dollars everywhere, on a marketplace that trades
-- in rupees, dirhams and shillings.
--
-- `loyalty_programme.per_unit` is a single number — 100 points buy one unit of
-- money — and there is one programme row, so a point is worth $0.01 to
-- everybody. The tier thresholds are single numbers too: $600 to reach Silver
-- whether you shop in Bengaluru or Nairobi. A customer billed in rupees is told
-- their points are worth dollars and that they need dollars to move up.
--
-- A point is not a currency. It is a unit the marketplace issues, and what it
-- is worth is a local decision — the same decision as a price, and made the
-- same way: chosen, not converted. ₹52,452 is what $600 comes to; ₹50,000 is
-- what somebody would actually set. So both halves become per-currency tables
-- of chosen figures.
--
-- The economics are held constant on purpose. Every currency returns 1% —
-- spend a hundred of something, get one back — expressed in numbers a local
-- customer recognises:
--
--     USD   1 point per $1        100 points = $1        a point is $0.01
--     INR   1 point per ₹100        1 point  = ₹1        a point is ₹1
--     AED   1 point per AED 4      25 points = AED 1     a point is AED 0.04
--     KES   1 point per KSh 100     1 point  = KSh 1     a point is KSh 1
--
-- A point stays a point across all of them: balances are not restated, because
-- nobody's points were taken away. What changes is the money they are quoted
-- in, and the money they must spend to climb.

/* =================================== what a point is worth, where you are === */

create table if not exists loyalty_point_rates (
  currency       text primary key references currencies(code),
  /* Points earned per one unit of this currency spent, before tier multiplier. */
  earn_per_unit  numeric not null check (earn_per_unit > 0),
  /* Points that buy one unit of this currency back, before the option's own
     rate. The reciprocal of what a point is worth. */
  per_unit       numeric not null check (per_unit > 0),
  note           text not null default ''
);

alter table loyalty_point_rates enable row level security;

drop policy if exists "loyalty_point_rates_read" on loyalty_point_rates;
drop policy if exists "loyalty_point_rates_operator" on loyalty_point_rates;

/* Readable by anyone: the storefront quotes what points are worth before a
   visitor signs in. */
create policy "loyalty_point_rates_read" on loyalty_point_rates for select to anon, authenticated
  using (true);
create policy "loyalty_point_rates_operator" on loyalty_point_rates for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

insert into loyalty_point_rates (currency, earn_per_unit, per_unit, note) values
  ('USD', 1,      100, 'A point per dollar spent; a hundred points buy a dollar back.'),
  ('INR', 0.01,     1, 'A point per hundred rupees spent; a point is a rupee back.'),
  ('AED', 0.25,    25, 'A point per four dirhams spent; twenty-five points buy a dirham back.'),
  ('KES', 0.01,     1, 'A point per hundred shillings spent; a point is a shilling back.')
on conflict (currency) do update set
  earn_per_unit = excluded.earn_per_unit, per_unit = excluded.per_unit, note = excluded.note;

/* ======================================= what it takes to climb, where you are === */

create table if not exists loyalty_tier_thresholds (
  tier_id       text not null references loyalty_tiers(id) on delete cascade,
  currency      text not null references currencies(code),
  /* Qualifying spend over a rolling twelve months, in this currency. Chosen,
     not converted — see the header. */
  qualify_spend numeric not null check (qualify_spend >= 0),
  primary key (tier_id, currency)
);

alter table loyalty_tier_thresholds enable row level security;

drop policy if exists "loyalty_tier_thresholds_read" on loyalty_tier_thresholds;
drop policy if exists "loyalty_tier_thresholds_operator" on loyalty_tier_thresholds;

create policy "loyalty_tier_thresholds_read" on loyalty_tier_thresholds for select to anon, authenticated
  using (true);
create policy "loyalty_tier_thresholds_operator" on loyalty_tier_thresholds for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

insert into loyalty_tier_thresholds (tier_id, currency, qualify_spend) values
  /* Retail. The dollar column is what was there; the rest are the round
     numbers somebody would set at roughly the same level. */
  ('bronze',   'USD', 0),       ('bronze',   'INR', 0),         ('bronze',   'AED', 0),      ('bronze',   'KES', 0),
  ('silver',   'USD', 600),     ('silver',   'INR', 50000),     ('silver',   'AED', 2500),   ('silver',   'KES', 75000),
  ('gold',     'USD', 1800),    ('gold',     'INR', 150000),    ('gold',     'AED', 7500),   ('gold',     'KES', 225000),
  ('platinum', 'USD', 4500),    ('platinum', 'INR', 400000),    ('platinum', 'AED', 18000),  ('platinum', 'KES', 550000),
  /* Business. */
  ('org-bronze',   'USD', 0),      ('org-bronze',   'INR', 0),        ('org-bronze',   'AED', 0),      ('org-bronze',   'KES', 0),
  ('org-silver',   'USD', 12000),  ('org-silver',   'INR', 1000000),  ('org-silver',   'AED', 45000),  ('org-silver',   'KES', 1500000),
  ('org-gold',     'USD', 35000),  ('org-gold',     'INR', 3000000),  ('org-gold',     'AED', 130000), ('org-gold',     'KES', 4500000),
  ('org-platinum', 'USD', 100000), ('org-platinum', 'INR', 8500000),  ('org-platinum', 'AED', 370000), ('org-platinum', 'KES', 13000000)
on conflict (tier_id, currency) do update set qualify_spend = excluded.qualify_spend;

/* ============================================ whose money is whose ======= */

alter table loyalty_members add column if not exists currency text references currencies(code);
alter table loyalty_ledger  add column if not exists currency text references currencies(code);
alter table enterprise_redemptions add column if not exists currency text references currencies(code);

comment on column loyalty_members.currency is
  'What this member''s money figures are in — qualifying spend, and the worth of their points. Follows the currency they are billed in.';

/* Billed where they are billed; otherwise placed by where the record says they
   are. Two of these are stated rather than derived, and both are marked below,
   because a placement invented quietly is worse than one written down. */
update loyalty_members m set currency = coalesce(
  /* Derived: an actual bill or invoice already in a currency. */
  (select b.currency from consumer_bills b where b.user_id = m.user_id limit 1),
  (select i.currency from enterprise_invoices i where i.account_id = m.account_id limit 1),
  case
    /* Derived: the account's own place of supply. */
    when (select a.place_of_supply from enterprise_accounts a where a.id = m.account_id) ilike '%kenya%' then 'KES'
    when (select a.place_of_supply from enterprise_accounts a where a.id = m.account_id) ilike '%uae%'   then 'AED'
    when (select a.place_of_supply from enterprise_accounts a where a.id = m.account_id) ilike '%india%' then 'INR'

    /* Stated. `Cadence Health` is a rewards member for an organisation with no
       row in `enterprise_accounts` at all — party ORG-77341 matches nothing —
       so there is no place of supply to read and nothing to derive from. It is
       the UAE member of this demo. The orphan is a real gap and is asserted
       below so it cannot grow quietly.

       Daniel Osei is the marketplace's Kenyan retail customer; the consumer
       records carry a city for Priya alone. */
    when m.name = 'Cadence Health' then 'AED'
    when m.name = 'Daniel Osei'    then 'KES'

    /* Everyone else on this demo is Indian by name and by record. */
    else 'INR'
  end);

alter table loyalty_members alter column currency set not null;

/* ================================ restating the money, not the points ==== */

/* Qualifying spend is money a member actually spent, so it is *converted* —
   unlike a threshold, which is chosen. The distinction is the same one the
   price book rests on. */
do $$
declare m record; rate numeric;
begin
  for m in select * from loyalty_members loop
    if m.currency = 'USD' then continue; end if;
    select f.rate into rate from fx_rates f
     where f.base = 'USD' and f.quote = m.currency and f.as_of <= '2026-08-01'
     order by f.as_of desc limit 1;
    if rate is null then raise exception 'no USD->% rate on file', m.currency; end if;
    update loyalty_members set qualify_12m = round(m.qualify_12m * rate, 2) where id = m.id;
  end loop;
end $$;

/* A ledger line's worth is derived from its points at the member's own rate,
   not converted from the dollar figure that was there. Deriving it keeps
   "20,000 points" and its worth agreeing under the new denomination; converting
   would preserve a dollar answer wearing a rupee label, which is the mistake
   this project has already had to undo once. */
update loyalty_ledger l set
  currency = m.currency,
  value = round(abs(l.points) / r.per_unit, 2)
  from loyalty_members m, loyalty_point_rates r
 where m.id = l.member and r.currency = m.currency;

alter table loyalty_ledger alter column currency set not null;

update enterprise_redemptions e set
  currency = m.currency,
  value = round(e.points / r.per_unit, 2)
  from loyalty_members m, loyalty_point_rates r
 where m.id = e.member_id and r.currency = m.currency;

update enterprise_redemptions set currency = 'INR' where currency is null;

/* ---------------------------------------- benefits stop naming a currency -- */

/* "Earn 1.5 points per $1" is stored prose on every tier, and it is wrong in
   three of the four currencies. The earn rate belongs to the tier, the
   currency belongs to the reader, and the sentence is assembled where both are
   known — so the stored line drops the money and the screens put it back. */
update loyalty_tiers set benefits = (
  select array_agg(
    case when b ~ 'points? per \$1' then 'Earn ' || multiplier || '× points on qualifying spend'
         else b end
    order by ord)
    from unnest(benefits) with ordinality as t(b, ord)
);

/* ============================================================= the guard === */

/* A member's money figures must be in a currency the marketplace has rates for,
   and their ledger must agree with them. A ledger line in another currency is a
   worth that cannot be added to their balance's. */
create or replace function guard_ledger_currency()
returns trigger language plpgsql security definer set search_path = public as $$
declare theirs text;
begin
  if current_persona() is null then return new; end if;
  select currency into theirs from loyalty_members where id = new.member;
  if theirs is null then return new; end if;
  if new.currency is distinct from theirs then
    raise exception 'This member''s rewards are held in %, so a movement cannot be worth %.',
      theirs, new.currency;
  end if;
  return new;
end $$;

drop trigger if exists guard_ledger_currency_trg on loyalty_ledger;
create trigger guard_ledger_currency_trg before insert or update on loyalty_ledger
  for each row execute function guard_ledger_currency();

/* -------------------------------------------------------- sanity checks -- */
do $$
declare n integer; s text; rate record;
begin
  /* Every currency the marketplace trades in can denominate a point. */
  select string_agg(distinct mc.currency, ', ') into s from market_currencies mc
   where not exists (select 1 from loyalty_point_rates r where r.currency = mc.currency);
  if s is not null then raise exception 'these traded currencies have no point rate: %', s; end if;

  /* Every rung has a threshold in every currency, or a member in that currency
     meets a ladder with a hole in it. */
  select string_agg(t.id || '/' || r.currency, ', ') into s
    from loyalty_tiers t cross join loyalty_point_rates r
   where not exists (
     select 1 from loyalty_tier_thresholds th
      where th.tier_id = t.id and th.currency = r.currency);
  if s is not null then raise exception 'these rungs have no threshold: %', s; end if;

  /* Every ladder climbs in every currency. A threshold list that is not
     ascending is a rung nobody can be standing on. */
  select string_agg(x.tier_id || '/' || x.currency, ', ') into s from (
    select th.tier_id, th.currency, t.kind, t.sort_order, th.qualify_spend,
           lag(th.qualify_spend) over (partition by t.kind, th.currency order by t.sort_order) as below
      from loyalty_tier_thresholds th join loyalty_tiers t on t.id = th.tier_id
  ) x where x.below is not null and x.qualify_spend <= x.below;
  if s is not null then raise exception 'these thresholds do not climb: %', s; end if;

  /* The economics are the same everywhere. Each currency returns 1% — this is
     the check that a "local" rate has not quietly become five times as generous
     in one country. */
  for rate in select * from loyalty_point_rates loop
    if round(rate.earn_per_unit / rate.per_unit, 6) <> 0.01 then
      raise exception '% returns %%% rather than 1%%',
        rate.currency, round(rate.earn_per_unit / rate.per_unit * 100, 4);
    end if;
  end loop;

  /* The strongest check available: every member must still hold the tier they
     already held. The thresholds and the converted spends were chosen
     independently, so agreeing is evidence rather than tautology — if a rounded
     threshold had been set too high, somebody would have been demoted by a
     migration that only meant to relabel. */
  select string_agg(x.id || ' holds ' || x.tier || ' but qualifies for ' || coalesce(x.earned, 'nothing'), '; ')
    into s from (
      select m.id, m.tier,
             (select th.tier_id from loyalty_tier_thresholds th
                join loyalty_tiers t on t.id = th.tier_id
               where th.currency = m.currency and t.kind = m.kind
                 and th.qualify_spend <= m.qualify_12m
               order by t.sort_order desc limit 1) as earned
        from loyalty_members m
    ) x where x.earned is distinct from x.tier;
  if s is not null then raise exception 'the new thresholds move somebody off their tier: %', s; end if;

  /* A plausibility check, not a self-consistent one. A rupee balance restated
     from dollars by relabelling would leave worths in the tens; at a rupee a
     point they are in the thousands. Every assertion above would pass either
     way, because each compares a row to itself. */
  select count(*) into n from loyalty_ledger l
    join loyalty_members m on m.id = l.member
   where m.currency = 'INR' and abs(l.points) >= 1000 and l.value < 100;
  if n > 0 then
    raise exception '% rupee movements of 1000+ points are worth under ₹100 — that looks like a dollar figure relabelled', n;
  end if;

  /* And no tier still tells a rupee customer what a dollar buys. */
  select string_agg(t.id, ', ') into s from loyalty_tiers t
   where exists (select 1 from unnest(t.benefits) b where b like '%$%');
  if s is not null then raise exception 'these tiers still quote dollars in their benefits: %', s; end if;

  /* Multi-currency is actually demonstrated rather than merely possible. */
  select count(distinct currency) into n from loyalty_members;
  if n < 3 then raise exception 'members sit in only % currencies, so this shows nothing', n; end if;

  /* The orphan named above: a rewards member whose organisation is not an
     account. Counted rather than left as a comment, so a second one cannot
     appear without this failing and somebody deciding what it means. */
  select count(*) into n from loyalty_members m
   where m.kind = 'enterprise' and m.account_id is null;
  if n <> 1 then
    raise exception '% business rewards members have no account behind them; one — Cadence Health — is known and placed by hand', n;
  end if;
end $$;
