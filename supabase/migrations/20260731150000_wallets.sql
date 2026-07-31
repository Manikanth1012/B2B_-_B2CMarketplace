-- Stored value: money the marketplace is holding on behalf of somebody else.
--
-- `consumer_profile.wallet` was a single number with nothing behind it. No
-- ledger, so nobody could say where the $42.60 came from. No way to add to it.
-- No operator view at all — the marketplace could not see its own liability.
-- And two screens already promised things nothing implemented: the account
-- closure copy says "your wallet balance is refunded to your default payment
-- method", and the rewards screen calls points "worth $31.80 as wallet credit".
--
-- The distinction the whole design turns on (prototype, _src/mp_data.js §4.63):
-- a wallet holds two pots that are legally different things.
--
--   cash   top-ups and refunds paid into the wallet. This is the customer's own
--          money. They can ask for it back, and on closure it is returned to
--          the instrument that funded it.
--   promo  reward redemptions and goodwill credit. This is the marketplace's
--          own money, already spent on marketing. It is spendable here and
--          nowhere else, and it is never returned as cash.
--
-- Mixing them is how a platform ends up refunding its own promotional credit
-- to a card. They are separate columns, separate ledger entries, and the
-- closure path returns one and writes off the other.

/* -------------------------------------------------------------- policy --- */

create table if not exists wallet_policy (
  id               text primary key,
  name             text not null,
  max_balance      numeric(10,2) not null check (max_balance > 0),
  min_topup        numeric(10,2) not null check (min_topup > 0),
  dormancy_months  integer not null check (dormancy_months > 0),
  /* Where it sits in the ledger. A wallet balance is a liability from the
     moment it is credited; it is never income, however long it sits there. */
  liability_account text not null,
  breakage_account  text not null,
  cash_refundable   text not null,
  non_refundable    text not null,
  dormancy_note     text not null,
  status            text not null default 'live'
);

insert into wallet_policy (id, name, max_balance, min_topup, dormancy_months,
                           liability_account, breakage_account,
                           cash_refundable, non_refundable, dormancy_note)
values ('marketplace', 'Marketplace wallet', 2000, 5, 24, '2050', '4050',
  'Top-ups and refunds paid to the wallet are the customer''s money and are returned on request, to the instrument that funded them.',
  'Reward redemptions and goodwill credit are not the customer''s money and are not returned as cash. They are spendable in the marketplace and that is all.',
  'A wallet with no movement for 24 months is flagged. The holder is written to, and the balance is returned or escheated according to the rules where they live. It is never absorbed as income.')
on conflict (id) do update set
  max_balance = excluded.max_balance, min_topup = excluded.min_topup,
  dormancy_months = excluded.dormancy_months,
  cash_refundable = excluded.cash_refundable, non_refundable = excluded.non_refundable,
  dormancy_note = excluded.dormancy_note;

/* ------------------------------------------------------------- sources --- */

create table if not exists wallet_sources (
  id        text primary key,
  label     text not null,
  /* Which pot it lands in, and therefore whether it can ever be returned as
     cash. This is the column that keeps the two kinds of money apart. */
  pot       text not null check (pot in ('cash', 'promo')),
  direction text not null check (direction in ('in', 'out')),
  note      text not null,
  sort_order integer not null default 0
);

insert into wallet_sources (id, label, pot, direction, note, sort_order) values
  ('topup',    'Top-up from a card or bank', 'cash',  'in',
   'The customer''s own money. Refundable on request.', 1),
  ('refund',   'Refund paid to the wallet',  'cash',  'in',
   'Only where the customer chose it over the original instrument. Still their money.', 2),
  ('reward',   'Reward redemption',          'promo', 'in',
   'Points converted to credit. Spendable here, not refundable as cash.', 3),
  ('goodwill', 'Goodwill credit',            'promo', 'in',
   'Issued by support. Marketing spend, not the customer''s money.', 4),
  ('spend',    'Spent in the marketplace',   'cash',  'out',
   'Paid for something. Promotional credit is drawn down first, so the customer''s own money stays theirs longest.', 5),
  ('return',   'Returned to the customer',   'cash',  'out',
   'Paid back to the instrument that funded it, on request or when the account closes.', 6),
  ('writeoff', 'Promotional credit written off', 'promo', 'out',
   'Credit the marketplace issued, cancelled when the account closed. It was never the customer''s to take.', 7)
on conflict (id) do update set
  label = excluded.label, pot = excluded.pot, direction = excluded.direction,
  note = excluded.note, sort_order = excluded.sort_order;

/* ------------------------------------------------------------- wallets --- */

create table if not exists wallets (
  id      text primary key,
  /* The account it belongs to — CUS- for a person, ORG- for a business. */
  party   text not null unique,
  name    text not null,
  kind    text not null check (kind in ('consumer', 'enterprise')),
  /* Set for the wallet whose owner can sign in. The rest are other customers,
     visible to the operator only — which is what a real book looks like. */
  user_id uuid,
  cash    numeric(10,2) not null default 0 check (cash  >= 0),
  promo   numeric(10,2) not null default 0 check (promo >= 0),
  /* Generated, so the two pots and the total can never disagree. */
  balance numeric(10,2) generated always as (cash + promo) stored,
  opened    date not null,
  last_move date not null,
  state   text not null default 'active' check (state in ('active', 'dormant', 'closing', 'closed')),
  note    text,
  sort_order integer not null default 0
);

comment on table wallets is
  'Stored value held on behalf of a customer. `cash` is theirs and is returned on '
  'request or closure; `promo` is credit the marketplace issued and is never returned '
  'as cash. Keeping them apart is the point of the table.';

create table if not exists wallet_ledger (
  id        text primary key,
  wallet_id text not null references wallets(id) on delete cascade,
  when_date date not null,
  source    text not null references wallet_sources(id),
  what      text not null,
  /* Signed: positive puts money in, negative takes it out. */
  amount    numeric(10,2) not null check (amount <> 0),
  pot       text not null check (pot in ('cash', 'promo')),
  /* What it was for, where there is something to point at. */
  ref       text,
  sort_order integer not null default 0
);

create index if not exists wallet_ledger_wallet_idx on wallet_ledger(wallet_id, when_date desc);

/* Closing an account is not one action. The customer asks, the cash is returned
   to an instrument, the promotional credit is written off, and each of those
   can fail separately — so the state is recorded rather than assumed. */
create table if not exists wallet_closures (
  id            text primary key,
  wallet_id     text not null references wallets(id) on delete cascade,
  requested_at  timestamptz not null default now(),
  /* Where the customer's money goes back to. */
  instrument    text not null,
  cash_returned numeric(10,2) not null check (cash_returned >= 0),
  promo_written_off numeric(10,2) not null check (promo_written_off >= 0),
  state         text not null check (state in ('requested', 'returned', 'failed')),
  completed_at  timestamptz,
  note          text
);

/* ---------------------------------------------------------------- seed --- */

insert into wallets (id, party, name, kind, cash, promo, opened, last_move, state, note, sort_order)
values
  ('WAL-4100', 'CUS-449021', 'Priya Raman',        'consumer',   30.60, 12.00, '2024-06-14', '2026-07-24', 'active', null, 1),
  ('WAL-4103', 'CUS-449118', 'Arun Deshpande',     'consumer',   47.20, 10.00, '2024-09-02', '2026-07-22', 'active', null, 2),
  ('WAL-4106', 'CUS-449204', 'Meera Krishnan',     'consumer',   18.35,  8.50, '2024-03-21', '2026-07-20', 'active', null, 3),
  ('WAL-4109', 'CUS-449377', 'Daniel Osei',        'consumer',   62.40,  0.00, '2026-05-11', '2026-07-25', 'active', null, 4),
  ('WAL-4112', 'CUS-449512', 'Sanya Kapoor',       'consumer',   11.05, 15.00, '2025-01-08', '2026-07-25', 'active', null, 5),
  ('WAL-4115', 'CUS-449640', 'Ravi Menon',         'consumer',   25.80,  0.00, '2025-02-19', '2026-07-24', 'active', null, 6),
  /* Dormancy is a real state, so one account is actually in it. */
  ('WAL-4118', 'CUS-449771', 'Lotte Bakker',       'consumer',   73.15,  0.00, '2023-08-03', '2023-09-02', 'dormant',
   'No movement for 22 months. Written to on 04 Jul 2026; no reply yet.', 7),
  ('WAL-4121', 'ORG-77120',  'Brightline Foods',    'enterprise', 412.90, 0.00, '2024-04-05', '2026-07-22', 'active', null, 8),
  ('WAL-4124', 'ORG-77208',  'Harbourpoint Retail', 'enterprise', 188.45, 25.00, '2024-08-19', '2026-07-14', 'active', null, 9)
on conflict (id) do update set
  cash = excluded.cash, promo = excluded.promo, state = excluded.state,
  last_move = excluded.last_move, note = excluded.note;

/* The signed-in shopper's wallet is the same obligation the operator sees, so
   it is one row read by two personas rather than two rows that drift. */
update wallets w set user_id = p.user_id
from consumer_profile p
where w.party = p.customer_id and p.user_id is not null;

/* ------------------------------------------------------------- history --- */

-- Every balance above has to be the sum of its own movements, or the ledger is
-- decoration. These are written to add up exactly.
insert into wallet_ledger (id, wallet_id, when_date, source, what, amount, pot, ref, sort_order)
values
  -- Priya Raman: 30.60 cash, 12.00 promo. The demo shopper.
  ('WTX-5101', 'WAL-4100', '2024-06-14', 'topup',    'Opened with a card top-up',                    20.00, 'cash',  null, 1),
  ('WTX-5102', 'WAL-4100', '2026-06-11', 'refund',   'Refund paid to the wallet — PlayForge Season Pass', 24.99, 'cash', 'SKU-3004', 2),
  ('WTX-5103', 'WAL-4100', '2026-06-21', 'reward',   'Reward points redeemed for credit',            12.00, 'promo', 'RDM-01', 3),
  ('WTX-5104', 'WAL-4100', '2026-07-02', 'topup',    'Top-up from a saved card',                     25.00, 'cash',  null, 4),
  ('WTX-5105', 'WAL-4100', '2026-06-11', 'spend',    'Spent on StreamNova Premium 4K',              -12.99, 'cash',  'SKU-3001', 5),
  ('WTX-5106', 'WAL-4100', '2026-07-24', 'spend',    'Spent on Travel eSIM — 10 GB',                -26.40, 'cash',  'SKU-2003', 6),

  -- Arun Deshpande: 47.20 cash, 10.00 promo
  ('WTX-5107', 'WAL-4103', '2024-09-02', 'topup',    'Opened with a card top-up',                    20.00, 'cash',  null, 1),
  ('WTX-5108', 'WAL-4103', '2026-07-05', 'goodwill', 'Goodwill after a delivery failure',            10.00, 'promo', null, 2),
  ('WTX-5109', 'WAL-4103', '2026-07-02', 'topup',    'Top-up from a saved card',                     40.19, 'cash',  null, 3),
  ('WTX-5110', 'WAL-4103', '2026-07-22', 'spend',    'Spent on Halo Music Family',                  -12.99, 'cash',  'SKU-3002', 4),

  -- Meera Krishnan: 18.35 cash, 8.50 promo
  ('WTX-5111', 'WAL-4106', '2024-03-21', 'topup',    'Opened with a card top-up',                    20.00, 'cash',  null, 1),
  ('WTX-5112', 'WAL-4106', '2026-06-21', 'reward',   'Reward points redeemed for credit',             8.50, 'promo', 'RDM-01', 2),
  ('WTX-5113', 'WAL-4106', '2026-07-02', 'topup',    'Top-up from a saved card',                     25.00, 'cash',  null, 3),
  ('WTX-5114', 'WAL-4106', '2026-07-20', 'spend',    'Spent on Halo Music Family',                  -26.65, 'cash',  'SKU-3002', 4),

  -- Daniel Osei: 62.40 cash, opened recently
  ('WTX-5115', 'WAL-4109', '2026-05-11', 'topup',    'Opened with a card top-up',                    50.00, 'cash',  null, 1),
  ('WTX-5116', 'WAL-4109', '2026-07-25', 'topup',    'Top-up from a saved card',                     25.39, 'cash',  null, 2),
  ('WTX-5117', 'WAL-4109', '2026-06-30', 'spend',    'Spent on a Kestrel 45 W charger',             -12.99, 'cash',  'SKU-4007', 3),

  -- Sanya Kapoor: 11.05 cash, 15.00 promo
  ('WTX-5118', 'WAL-4112', '2025-01-08', 'topup',    'Opened with a card top-up',                    20.00, 'cash',  null, 1),
  ('WTX-5119', 'WAL-4112', '2026-06-21', 'reward',   'Reward points redeemed for credit',            15.00, 'promo', 'RDM-01', 2),
  ('WTX-5120', 'WAL-4112', '2026-07-25', 'spend',    'Spent on StreamNova Premium 4K',               -8.95, 'cash',  'SKU-3001', 3),

  -- Ravi Menon: 25.80 cash
  ('WTX-5121', 'WAL-4115', '2025-02-19', 'topup',    'Opened with a card top-up',                    20.00, 'cash',  null, 1),
  ('WTX-5122', 'WAL-4115', '2026-07-24', 'topup',    'Top-up from a saved card',                     18.79, 'cash',  null, 2),
  ('WTX-5123', 'WAL-4115', '2026-06-14', 'spend',    'Spent on Aegis Screen Cover',                 -12.99, 'cash',  'SKU-2004', 3),

  -- Lotte Bakker: 73.15 cash, untouched since 2023. The dormant one.
  ('WTX-5124', 'WAL-4118', '2023-08-03', 'topup',    'Opened with a card top-up',                    60.00, 'cash',  null, 1),
  ('WTX-5125', 'WAL-4118', '2023-09-02', 'topup',    'Top-up from a saved card',                     26.14, 'cash',  null, 2),
  ('WTX-5126', 'WAL-4118', '2023-08-28', 'spend',    'Spent on a Travel eSIM',                      -12.99, 'cash',  'SKU-2003', 3),

  -- Brightline Foods: an enterprise float, all their own money
  ('WTX-5127', 'WAL-4121', '2024-04-05', 'topup',    'Opened by bank transfer',                     300.00, 'cash',  null, 1),
  ('WTX-5128', 'WAL-4121', '2026-07-22', 'topup',    'Top-up by bank transfer',                     250.00, 'cash',  null, 2),
  ('WTX-5129', 'WAL-4121', '2026-06-30', 'spend',    'Spent on IoT Connect 500 MB — fleet renewal', -137.10, 'cash', 'SKU-5001', 3),

  -- Harbourpoint Retail: enterprise with goodwill credit against an outage
  ('WTX-5130', 'WAL-4124', '2024-08-19', 'topup',    'Opened by bank transfer',                     200.00, 'cash',  null, 1),
  ('WTX-5131', 'WAL-4124', '2026-05-20', 'goodwill', 'Goodwill after a provisioning outage',         25.00, 'promo', null, 2),
  ('WTX-5132', 'WAL-4124', '2026-07-14', 'spend',    'Spent on Sentinel Managed Firewall',          -11.55, 'cash',  'SKU-6001', 3)
on conflict (id) do update set
  amount = excluded.amount, pot = excluded.pot, what = excluded.what,
  source = excluded.source, when_date = excluded.when_date;

/* ------------------------------------------- reconcile what was there ---- */

-- The shopper's profile carried $42.60 with nothing behind it. It is now the
-- balance of a real wallet, and it stays $42.60 because the ledger above was
-- written to arrive at exactly that.
update consumer_profile p set wallet = w.balance
from wallets w where w.party = p.customer_id;

-- One number, one owner.
--
-- `consumer_profile.wallet` and `wallets.balance` are the same obligation, and
-- the top-up path proved they drift: the wallet went to $52.60 and the profile
-- stayed at $42.60. Keeping two writers in step by remembering to is how they
-- got out of step in the first place, so the database does it.
create or replace function sync_profile_wallet() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update consumer_profile
     set wallet = new.balance
   where customer_id = new.party;
  return new;
end $$;

drop trigger if exists wallets_sync_profile on wallets;
create trigger wallets_sync_profile
  after insert or update of cash, promo on wallets
  for each row execute function sync_profile_wallet();

/* ------------------------------------------------------------------ RLS -- */

alter table wallet_policy   enable row level security;
alter table wallet_sources  enable row level security;
alter table wallets         enable row level security;
alter table wallet_ledger   enable row level security;
alter table wallet_closures enable row level security;

drop policy if exists "auth_read_wallet_policy"    on wallet_policy;
drop policy if exists "auth_read_wallet_sources"   on wallet_sources;
drop policy if exists "operator_read_wallets"      on wallets;
drop policy if exists "owner_read_wallet"          on wallets;
drop policy if exists "operator_write_wallets"     on wallets;
drop policy if exists "owner_update_wallet"        on wallets;
drop policy if exists "operator_read_wallet_ledger" on wallet_ledger;
drop policy if exists "owner_read_wallet_ledger"   on wallet_ledger;
drop policy if exists "owner_insert_wallet_ledger" on wallet_ledger;
drop policy if exists "operator_write_wallet_ledger" on wallet_ledger;
drop policy if exists "operator_read_wallet_closures" on wallet_closures;
drop policy if exists "owner_wallet_closures"      on wallet_closures;

/* The policy and the sources are the rules of the thing — everybody signed in
   may read them, because both consoles explain the two pots from them. */
create policy "auth_read_wallet_policy"  on wallet_policy  for select to authenticated using (true);
create policy "auth_read_wallet_sources" on wallet_sources for select to authenticated using (true);

/* The operator sees the whole book: it is their liability. */
create policy "operator_read_wallets" on wallets
  for select to authenticated using (current_persona() = 'operator');
create policy "operator_write_wallets" on wallets
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A customer sees their own, and may move their own balance — topping up and
   redeeming both write here. They cannot reach anybody else's. */
create policy "owner_read_wallet" on wallets
  for select to authenticated using (user_id = auth.uid());
create policy "owner_update_wallet" on wallets
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "operator_read_wallet_ledger" on wallet_ledger
  for select to authenticated using (current_persona() = 'operator');
create policy "operator_write_wallet_ledger" on wallet_ledger
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "owner_read_wallet_ledger" on wallet_ledger
  for select to authenticated
  using (exists (select 1 from wallets w where w.id = wallet_id and w.user_id = auth.uid()));
create policy "owner_insert_wallet_ledger" on wallet_ledger
  for insert to authenticated
  with check (exists (select 1 from wallets w where w.id = wallet_id and w.user_id = auth.uid()));

create policy "operator_read_wallet_closures" on wallet_closures
  for select to authenticated using (current_persona() = 'operator');
create policy "owner_wallet_closures" on wallet_closures
  for all to authenticated
  using (exists (select 1 from wallets w where w.id = wallet_id and w.user_id = auth.uid()))
  with check (exists (select 1 from wallets w where w.id = wallet_id and w.user_id = auth.uid()));

/* ------------------------------------------------------------ assertions - */

do $$
declare bad text; n integer; v numeric;
begin
  select count(*) into n from wallets;
  if n <> 9 then raise exception 'expected 9 wallets, found %', n; end if;

  -- Every balance is the sum of its own movements. Without this the ledger is
  -- a story told next to a number rather than the reason for it.
  select string_agg(x.id || ': cash $' || x.cash || ' but ledger says $' || x.ledger_cash, ', ')
    into bad
  from (
    select w.id, w.cash,
           coalesce((select sum(l.amount) from wallet_ledger l
                     where l.wallet_id = w.id and l.pot = 'cash'), 0) as ledger_cash
    from wallets w
  ) x
  where x.cash <> x.ledger_cash;
  if bad is not null then
    raise exception 'wallet cash does not match its ledger: %', bad;
  end if;

  select string_agg(x.id || ': promo $' || x.promo || ' but ledger says $' || x.ledger_promo, ', ')
    into bad
  from (
    select w.id, w.promo,
           coalesce((select sum(l.amount) from wallet_ledger l
                     where l.wallet_id = w.id and l.pot = 'promo'), 0) as ledger_promo
    from wallets w
  ) x
  where x.promo <> x.ledger_promo;
  if bad is not null then
    raise exception 'wallet promotional credit does not match its ledger: %', bad;
  end if;

  -- Each movement lands in the pot its source says it does. A reward that
  -- landed in the cash pot would be refundable, which is the exact mistake the
  -- two-pot model exists to prevent.
  select string_agg(l.id || ' (' || l.source || ' -> ' || l.pot || ')', ', ') into bad
  from wallet_ledger l join wallet_sources s on s.id = l.source
  where l.pot <> s.pot;
  if bad is not null then
    raise exception 'ledger entry in the wrong pot for its source: %', bad;
  end if;

  -- Direction agrees with sign, or the arithmetic is accidental.
  select string_agg(l.id, ', ') into bad
  from wallet_ledger l join wallet_sources s on s.id = l.source
  where (s.direction = 'in' and l.amount < 0) or (s.direction = 'out' and l.amount > 0);
  if bad is not null then
    raise exception 'ledger entry whose sign contradicts its source direction: %', bad;
  end if;

  -- Nothing sits above the published ceiling.
  select string_agg(w.id || ' at $' || w.balance, ', ') into bad
  from wallets w cross join wallet_policy p
  where p.id = 'marketplace' and w.balance > p.max_balance;
  if bad is not null then
    raise exception 'wallet above the published maximum: %', bad;
  end if;

  -- The dormant one is genuinely dormant, and the active ones genuinely are not.
  select string_agg(w.id, ', ') into bad
  from wallets w cross join wallet_policy p
  where p.id = 'marketplace'
    and ((w.state = 'dormant' and w.last_move > current_date - (p.dormancy_months || ' months')::interval)
      or (w.state = 'active'  and w.last_move <= current_date - (p.dormancy_months || ' months')::interval));
  if bad is not null then
    raise exception 'wallet state contradicts its last movement: %', bad;
  end if;

  -- The last movement is the date of the last movement.
  select string_agg(x.id, ', ') into bad
  from (select w.id, w.last_move,
               (select max(l.when_date) from wallet_ledger l where l.wallet_id = w.id) as latest
        from wallets w) x
  where x.latest is not null and x.last_move <> x.latest;
  if bad is not null then
    raise exception 'wallet last_move disagrees with its ledger: %', bad;
  end if;

  -- The shopper reads one number and the operator reads another only if this
  -- fails. They are the same obligation.
  select string_agg(p.id, ', ') into bad
  from consumer_profile p join wallets w on w.party = p.customer_id
  where p.wallet <> w.balance;
  if bad is not null then
    raise exception 'the shopper profile and the wallet disagree: %', bad;
  end if;

  -- The trigger above is what keeps that true from here on, so check it fires.
  update wallets set cash = cash where id = 'WAL-4100';
  select string_agg(p.id, ', ') into bad
  from consumer_profile p join wallets w on w.party = p.customer_id
  where p.wallet <> w.balance;
  if bad is not null then
    raise exception 'the profile/wallet sync trigger is not working: %', bad;
  end if;

  -- And the signed-in shopper actually has one they can reach.
  select count(*) into n from wallets where user_id is not null;
  if n < 1 then
    raise exception 'no wallet is reachable by a signed-in customer';
  end if;

  select sum(balance) into v from wallets;
  raise notice 'wallet liability seeded: $%', v;
end $$;
