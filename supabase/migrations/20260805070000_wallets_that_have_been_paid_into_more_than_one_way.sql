/*
  # Wallets that have been paid into more than one way

  Every top-up in the ledger arrived from "a card or bank" — the wording of the
  one instrument the old screen could offer. Now that a customer picks a rail
  and goes to a provider, the history should look like something that happened
  rather than like something that could not have. Priya's rupee wallet has UPI
  and net banking behind it as well as a card; the Kenyan wallet has M-Pesa;
  SmartBuild's has net banking.

  Every seeded top-up is a `payment_attempts` row that succeeded and the ledger
  row it produced, joined by `ledger_id`, because that is the shape a real one
  has. A ledger row with no attempt behind it would be money the marketplace
  cannot say where it came from.

  Two that did not become money are seeded too — one refused by the bank, one
  the customer walked away from. They are the half of the record a screen is
  tempted to leave out, and the half somebody rings support about.

  Undoes the verification run as it goes: the payments made while walking the
  handoff end to end in a browser were real writes against real wallets, and
  wallets are the one table where leaving test data behind is not a cosmetic
  problem.
*/

/* --------------------------------------------- what verification left behind */

update wallets w
   set cash = w.cash - x.total
  from (select l.wallet_id, sum(l.amount) total
          from wallet_ledger l
         where l.id like 'WPA-%'
         group by l.wallet_id) x
 where w.id = x.wallet_id;

/* The attempts go first. `payment_attempts_credit_check` refuses a succeeded
   row with no ledger row behind it, so clearing `ledger_id` to make way for the
   delete is a state the table will not hold — which is the constraint doing
   exactly what it is there for. */
delete from payment_attempts;
delete from wallet_ledger where id like 'WPA-%';

/* The source label was written when a card or a bank were the only two answers.
   Each row's own text now names the rail — "Top-up by UPI priya@okhdfcbank" —
   so the label under it saying "from a card or bank" contradicts the line above
   it. The source is the kind of movement; the instrument belongs on the row. */
update wallet_sources set label = 'Money you added' where id = 'topup';

/* ------------------------------------------------- top-ups that succeeded --- */

/* Each row: the ledger entry first, then the attempt that produced it — the
   attempt's `ledger_id` is what ties the money to the trip that fetched it. */
create temporary table seeded_topup (
  attempt   text, reference text, wallet text, user_id uuid, amount numeric,
  currency  text, method text, market text, provider text, instrument text,
  gw        text, on_date date, mins integer
) on commit drop;

insert into seeded_topup values
  ('PA-260602-A1', 'PAY-260602-4KQ1', 'WAL-4100', null, 2000, 'INR', 'card',        'IN', 'Razorpay',        '•••• 4419',            'RZP-4KQ1', date '2026-06-02', 3),
  ('PA-260714-A2', 'PAY-260714-7TB9', 'WAL-4100', null, 1500, 'INR', 'upi',         'IN', 'Razorpay',        'UPI priya@okhdfcbank', 'RZP-7TB9', date '2026-07-14', 1),
  ('PA-260519-A3', 'PAY-260519-2MD4', 'WAL-4103', null, 3000, 'INR', 'netbanking',  'IN', 'Razorpay',        'ICICI Bank net banking', 'RZP-2MD4', date '2026-05-19', 4),
  ('PA-260628-A4', 'PAY-260628-9XN2', 'WAL-4109', null, 5000, 'KES', 'mobile_money','KE', 'Safaricom M-Pesa','M-Pesa 0722 431 908',  'MPX-9XN2', date '2026-06-28', 2),
  ('PA-260705-A5', 'PAY-260705-6PL7', 'WAL-4127', null, 25000,'INR', 'netbanking',  'IN', 'Razorpay',        'HDFC Bank net banking', 'RZP-6PL7', date '2026-07-05', 6),
  ('PA-260612-A6', 'PAY-260612-1QJ5', 'WAL-4124', null, 8000, 'KES', 'mobile_money','KE', 'Safaricom M-Pesa','M-Pesa 0733 118 204',  'MPX-1QJ5', date '2026-06-12', 3);

/* The wallet owner, so an attempt is attributable to whoever made it where the
   wallet belongs to a person rather than a company. */
update seeded_topup s set user_id = w.user_id from wallets w where w.id = s.wallet;

insert into wallet_ledger (id, wallet_id, when_date, source, what, amount, pot, ref, sort_order)
select 'W' || s.attempt, s.wallet, s.on_date, 'topup',
       format('Top-up by %s', s.instrument), s.amount, 'cash', s.reference, 800
  from seeded_topup s;

insert into payment_attempts
  (id, reference, user_id, wallet_id, purpose, amount, currency, method_id,
   market_code, provider, instrument, state, gateway_ref, started_at, decided_at, ledger_id)
select s.attempt, s.reference, s.user_id, s.wallet, 'wallet_topup', s.amount, s.currency,
       s.method, s.market, s.provider, s.instrument, 'succeeded', s.gw,
       s.on_date + time '10:00' , s.on_date + time '10:00' + (s.mins || ' minutes')::interval,
       'W' || s.attempt
  from seeded_topup s;

update wallets w
   set cash = w.cash + x.total
  from (select wallet, sum(amount) total from seeded_topup group by wallet) x
 where w.id = x.wallet;

/* `last_move` is the date of the last movement, so it is taken from the
   movements rather than nudged forward by whatever wrote last. The
   verification run left two wallets dated today with nothing today to show for
   it; deriving it puts them back and stops the column drifting again. */
update wallets w
   set last_move = coalesce(x.latest, w.opened)
  from (select l.wallet_id, max(l.when_date) latest from wallet_ledger l group by l.wallet_id) x
 where w.id = x.wallet_id;

/* ------------------------------------------- and two that became nothing --- */

/* No ledger row and no `ledger_id`: that is what "did not become money" means
   here, and the table's own check constraint is what enforces it. */
insert into payment_attempts
  (id, reference, user_id, wallet_id, purpose, amount, currency, method_id,
   market_code, provider, instrument, state, failure_reason, gateway_ref,
   started_at, decided_at)
select 'PA-260728-F1', 'PAY-260728-5HG3', w.user_id, 'WAL-4100', 'wallet_topup',
       3000, 'INR', 'card', 'IN', 'Razorpay', '•••• 8871', 'failed',
       'Your bank declined the payment. The card on file expired in March 2026 — add a current one and try again.',
       'RZP-5HG3', timestamptz '2026-07-28 19:42:00+05:30', timestamptz '2026-07-28 19:42:40+05:30'
  from wallets w where w.id = 'WAL-4100';

insert into payment_attempts
  (id, reference, user_id, wallet_id, purpose, amount, currency, method_id,
   market_code, provider, instrument, state, gateway_ref, started_at, decided_at)
select 'PA-260731-C1', 'PAY-260731-8WR6', w.user_id, 'WAL-4100', 'wallet_topup',
       10000, 'INR', 'netbanking', 'IN', 'Razorpay', null, 'cancelled',
       'RZP-8WR6', timestamptz '2026-07-31 08:15:00+05:30', timestamptz '2026-07-31 08:16:10+05:30'
  from wallets w where w.id = 'WAL-4100';

do $$
declare
  n integer;
  r record;
begin
  /* Nothing left over from walking it in a browser. */
  select count(*) into n from payment_attempts where reference like 'PAY-260805-%';
  if n > 0 then raise exception '% payments from the verification run are still here', n; end if;

  /* The invariant the whole design rests on: a successful payment produced
     exactly one ledger row, and nothing else produced any. */
  select count(*) into n from payment_attempts where state = 'succeeded' and ledger_id is null;
  if n > 0 then raise exception '% successful payments credited nothing', n; end if;

  select count(*) into n from payment_attempts where state <> 'succeeded' and ledger_id is not null;
  if n > 0 then raise exception '% payments that did not succeed credited a wallet', n; end if;

  /* And the amounts agree, to the cent. */
  for r in
    select a.reference, a.amount, l.amount ledger
      from payment_attempts a join wallet_ledger l on l.id = a.ledger_id
     where a.amount is distinct from l.amount
  loop
    raise exception 'Payment % is for % and credited %', r.reference, r.amount, r.ledger;
  end loop;

  /* Every balance is still the sum of its own two pots — the seeding above
     moved `cash` and the generated column has to have followed. */
  select count(*) into n from wallets where balance is distinct from cash + promo;
  if n > 0 then raise exception '% wallets do not add up', n; end if;

  /* And no wallet has been pushed past its ceiling by the seeding. */
  for r in
    select w.id, w.balance, x.max_balance
      from wallets w join wallet_limits x on x.currency = w.currency
     where w.balance > x.max_balance
  loop
    raise exception 'Wallet % holds % against a ceiling of %', r.id, r.balance, r.max_balance;
  end loop;

  /* Nothing is paid over a rail its market does not have. A rupee wallet
     topped up by M-Pesa is the drift this table exists to make visible. */
  select count(*) into n from payment_attempts a
   where not exists (
     select 1 from payment_method_markets pm
      where pm.method_id = a.method_id and pm.market_code = a.market_code);
  if n > 0 then raise exception '% payments used a rail that market does not offer', n; end if;

  /* The wallet's currency and the payment's are the same. Converting on the way
     into a wallet would be a rate nobody agreed to. */
  select count(*) into n from payment_attempts a
    join wallets w on w.id = a.wallet_id
   where a.currency is distinct from w.currency;
  if n > 0 then raise exception '% payments are in a currency the wallet does not hold', n; end if;

  /* There is something of each kind to look at. */
  select count(distinct method_id) into n from payment_attempts where state = 'succeeded';
  if n < 3 then raise exception 'Only % ways of paying appear in the history', n; end if;

  select count(*) into n from payment_attempts where state in ('failed', 'cancelled');
  if n < 2 then raise exception 'No payment in the history ever went wrong'; end if;

  /* Every wallet's stated last movement is its last movement. */
  for r in
    select w.id, w.last_move, max(l.when_date) actual
      from wallets w join wallet_ledger l on l.wallet_id = w.id
     group by w.id, w.last_move
    having w.last_move is distinct from max(l.when_date)
  loop
    raise exception 'Wallet % says it last moved on % and last moved on %',
      r.id, r.last_move, r.actual;
  end loop;
end $$;
