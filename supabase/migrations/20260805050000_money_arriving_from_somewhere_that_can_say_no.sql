/*
  # Money arriving from somewhere that can say no

  Topping up offered one question — "Pay with" — and the only answers were the
  instruments already saved on the account. A customer with no saved card had
  nothing to choose; a customer who wanted to pay by net banking, or UPI, or
  M-Pesa, had no way to say so. And whatever they picked, the top-up was written
  the instant the button was pressed: the wallet went up, a ledger row appeared,
  and nothing anywhere had asked a bank whether the money was actually coming.

  A real payment leaves the marketplace. The customer goes to the provider,
  authenticates there, and comes back with an answer that may be no — or does
  not come back at all, which is the case that matters and the one an
  optimistic write gets wrong. So this models the handoff rather than skipping
  it.

  ## The catalogue: which ways to pay exist, and where

  `payment_methods` is what a way of paying *is*; `payment_method_markets` is
  where it is offered and who handles it. They are separate because "UPI" is one
  thing whether or not India is the market you are standing in, and because the
  marketplace trades in three countries where the answer differs completely:
  net banking and UPI in India, bank transfer in the UAE, M-Pesa in Kenya. A
  single list with a country column would have made "UPI in Kenya" expressible.

  ## The attempt: a payment that has been asked for and not yet answered

  `payment_attempts` is the row that exists between the customer pressing the
  button and the provider saying anything. It carries the amount and currency it
  was struck at, the method, the provider, and a reference the customer can
  quote to support — because "my top-up did not arrive" is unanswerable without
  one.

  The important column is `ledger_id`, and it is unique. An attempt produces at
  most one ledger row, and the ledger row's id is derived from the attempt's, so
  a provider that calls back twice — which providers do — credits once. Without
  it the second callback is free money.

  ## Settling: one function, because it is one thing

  `settle_payment_attempt` moves the attempt, writes the ledger row and raises
  the balance together or does none of it. The old top-up wrote the ledger, then
  updated the wallet, and had to apologise in prose when the second write failed
  ("the movement was recorded but the balance did not update... tell support
  before trying again"). That apology was the honest description of a bug.

  It is `security definer` and does its own authorisation, which also closes a
  hole nobody had noticed: `wallets` had `owner_update_wallet` for a person and
  no update policy at all for a company. The enterprise wallet screen has been
  offering a Top up button that row-level security would have refused.
*/

create table if not exists payment_methods (
  id          text primary key,
  label       text not null,
  /* What the customer is actually doing, as opposed to what it is called. Two
     methods with different names and the same kind behave the same on return. */
  kind        text not null check (kind in ('card', 'netbanking', 'upi', 'mobile_money', 'bank_transfer')),
  blurb       text not null,
  /* Whether paying with it leaves the marketplace. Everything here does — the
     column exists so a method that does not can be added without the screens
     assuming. */
  redirects   boolean not null default true,
  /* What the provider's page will ask for, so the marketplace can say what is
     about to happen instead of throwing the customer at a strange screen. */
  asks_for    text not null,
  /* Roughly how long the customer is away. Shown, because a page that says
     "you will be back in a moment" and then takes two minutes is worse than
     one that said two minutes. */
  typical     text not null,
  sort_order  integer not null default 0
);

create table if not exists payment_method_markets (
  method_id   text not null references payment_methods(id) on delete cascade,
  market_code text not null references markets(code) on delete cascade,
  /* Who the handoff actually goes to. The customer sees this name on the
     provider's page, and seeing a name they were not told to expect is what
     an abandoned payment looks like from the inside. */
  provider    text not null,
  sort_order  integer not null default 0,
  primary key (method_id, market_code)
);

create table if not exists payment_attempts (
  id            text primary key,
  /* What the customer quotes to support. Short enough to read down a phone. */
  reference     text not null unique,
  user_id       uuid references auth.users(id) on delete set null,
  wallet_id     text references wallets(id) on delete cascade,
  purpose       text not null default 'wallet_topup',
  amount        numeric(12,2) not null check (amount > 0),
  currency      text not null references currencies(code),
  method_id     text not null references payment_methods(id),
  market_code   text references markets(code),
  provider      text,
  /* What the provider ended up charging — "HDFC Bank net banking", "•••• 4419".
     Null until they say, because before they say nobody knows. */
  instrument    text,
  state         text not null default 'initiated'
                  check (state in ('initiated', 'succeeded', 'failed', 'cancelled', 'expired')),
  failure_reason text,
  gateway_ref   text,
  started_at    timestamptz not null default now(),
  decided_at    timestamptz,
  /* The one ledger row this attempt may ever produce. */
  ledger_id     text unique references wallet_ledger(id) on delete set null,

  /* A decided attempt has a decision time; an undecided one does not. */
  constraint payment_attempts_decided_check check (
    (state = 'initiated' and decided_at is null)
    or (state <> 'initiated' and decided_at is not null)
  ),
  /* Only a successful attempt moves money, and a successful one must have. */
  constraint payment_attempts_credit_check check (
    (state = 'succeeded' and ledger_id is not null)
    or (state <> 'succeeded' and ledger_id is null)
  ),
  /* A refusal says why. "Failed" on its own sends the customer to support with
     nothing, and support has nothing either. */
  constraint payment_attempts_reason_check check (
    state <> 'failed' or coalesce(length(trim(failure_reason)), 0) >= 4
  )
);

create index if not exists payment_attempts_wallet_idx on payment_attempts (wallet_id, started_at desc);

alter table payment_methods enable row level security;
alter table payment_method_markets enable row level security;
alter table payment_attempts enable row level security;

/* The catalogue is public in the same sense the price list is: you have to be
   able to see how you could pay before you have signed in to pay. */
create policy anyone_read_payment_methods on payment_methods
  for select to anon, authenticated using (true);
create policy anyone_read_payment_method_markets on payment_method_markets
  for select to anon, authenticated using (true);

create policy operator_write_payment_methods on payment_methods
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy operator_write_payment_method_markets on payment_method_markets
  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

create policy operator_read_payment_attempts on payment_attempts
  for select to authenticated using (current_persona() = 'operator');

/* A customer sees their own attempts — including the ones that failed, which is
   the half of the record a screen is tempted to hide and the half somebody
   ringing support is ringing about. */
create policy owner_read_payment_attempts on payment_attempts
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from wallets w
       where w.id = payment_attempts.wallet_id
         and (w.user_id = auth.uid()
              or (w.account_id is not null and w.account_id = current_account_id()))
    )
  );

/* Starting one is the customer's; deciding one is not. There is no update
   policy at all, so the only way an attempt is ever settled is the function
   below — which is the point of having a function. */
create policy owner_start_payment_attempts on payment_attempts
  for insert to authenticated
  with check (
    state = 'initiated'
    and decided_at is null
    and ledger_id is null
    and exists (
      select 1 from wallets w
       where w.id = payment_attempts.wallet_id
         and (w.user_id = auth.uid()
              or (w.account_id is not null and w.account_id = current_account_id()))
    )
  );

/* ------------------------------------------------------------- settling --- */

/**
 * What the provider said, applied.
 *
 * `security definer` because it writes the wallet and the ledger, which the
 * caller may not write directly — deliberately, so that this is the only door.
 * It therefore does its own authorisation rather than leaning on the policies
 * it is bypassing.
 *
 * Idempotent by construction: it only acts on an attempt that is still
 * `initiated`, and it derives the ledger row's id from the attempt's, so a
 * second call finds the attempt already settled and says so instead of
 * crediting again.
 */
create or replace function settle_payment_attempt(
  p_attempt   text,
  p_outcome   text,
  p_instrument text default null,
  p_gateway_ref text default null,
  p_reason    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  a          payment_attempts%rowtype;
  w          wallets%rowtype;
  mine       boolean;
  led        text;
  ceiling    numeric;
begin
  if p_outcome not in ('succeeded', 'failed', 'cancelled', 'expired') then
    raise exception 'A payment is not %.', p_outcome;
  end if;

  select * into a from payment_attempts where id = p_attempt for update;
  if not found then
    raise exception 'There is no payment %.', p_attempt;
  end if;

  select * into w from wallets where id = a.wallet_id for update;
  if not found then
    raise exception 'That payment is against a wallet that no longer exists.';
  end if;

  /* The caller has to be the person or the company whose wallet this is. The
     operator settles nothing here — a marketplace crediting its own customers'
     wallets by hand is a different action with a different record. */
  mine := (w.user_id = auth.uid())
       or (w.account_id is not null and w.account_id = current_account_id());
  if not mine then
    raise exception 'That payment is not yours.';
  end if;

  if a.state <> 'initiated' then
    /* Not an error. A provider calling back twice is ordinary, and the second
       call must find the first call's answer rather than a failure. */
    return jsonb_build_object(
      'already', true, 'state', a.state, 'reference', a.reference,
      'note', format('Payment %s was already %s.', a.reference, a.state));
  end if;

  if p_outcome <> 'succeeded' then
    update payment_attempts
       set state = p_outcome,
           decided_at = now(),
           gateway_ref = coalesce(p_gateway_ref, gateway_ref),
           instrument = coalesce(p_instrument, instrument),
           failure_reason = case when p_outcome = 'failed'
                                 then coalesce(nullif(trim(p_reason), ''), 'The provider refused the payment and gave no reason.')
                                 else p_reason end
     where id = a.id;
    return jsonb_build_object('already', false, 'state', p_outcome, 'reference', a.reference);
  end if;

  /* The ceiling is checked here and not only when the form opened. A customer
     can be away at the provider for two minutes, and a refund landing in that
     window is exactly how a wallet ends up over its limit. */
  select max_balance into ceiling from wallet_limits where currency = w.currency;
  if ceiling is not null and w.balance + a.amount > ceiling then
    update payment_attempts
       set state = 'failed', decided_at = now(),
           gateway_ref = coalesce(p_gateway_ref, gateway_ref),
           instrument = coalesce(p_instrument, instrument),
           failure_reason = format(
             'The wallet reached %s while this payment was with the provider, and crediting it would pass the %s ceiling. Nothing was charged.',
             w.balance, ceiling)
     where id = a.id;
    return jsonb_build_object('already', false, 'state', 'failed', 'reference', a.reference,
      'note', 'The payment was not applied — the wallet would have passed its ceiling.');
  end if;

  led := 'W' || a.id;

  insert into wallet_ledger (id, wallet_id, when_date, source, what, amount, pot, ref, sort_order)
  values (led, w.id, current_date, 'topup',
          format('Top-up by %s', coalesce(p_instrument, a.instrument, 'card')),
          a.amount, 'cash', a.reference, 999);

  update wallets
     set cash = cash + a.amount,
         last_move = current_date
   where id = w.id;

  update payment_attempts
     set state = 'succeeded', decided_at = now(), ledger_id = led,
         gateway_ref = coalesce(p_gateway_ref, gateway_ref),
         instrument = coalesce(p_instrument, instrument)
   where id = a.id;

  return jsonb_build_object('already', false, 'state', 'succeeded',
                            'reference', a.reference, 'ledger_id', led);
end $$;

grant execute on function settle_payment_attempt(text, text, text, text, text) to authenticated;

/* ------------------------------------------------------------ the ways ---- */

insert into payment_methods (id, label, kind, blurb, redirects, asks_for, typical, sort_order) values
  ('card',        'Credit or debit card', 'card',
   'Visa, Mastercard, RuPay or Amex. Cards issued in India are authenticated by your bank as well, so there is a second step.',
   true, 'Card number, expiry, CVV, then your bank''s one-time code', 'about a minute', 1),
  ('netbanking',  'Net banking', 'netbanking',
   'Pay straight from your bank account. You sign in to your own bank, not to us.',
   true, 'Your bank''s own sign-in, then whatever it asks to confirm a payment', 'a minute or two', 2),
  ('upi',         'UPI', 'upi',
   'Approve the payment in your UPI app. Nothing to type but your UPI ID.',
   true, 'Your UPI ID, then approval in your app', 'under a minute', 3),
  ('mobile_money','M-Pesa', 'mobile_money',
   'A prompt is pushed to your phone. Enter your M-Pesa PIN there to confirm.',
   true, 'Your M-Pesa number, then your PIN on the phone itself', 'a minute or two', 4),
  ('bank_transfer','Bank transfer', 'bank_transfer',
   'A direct transfer from your account. Slower than a card and cheaper for larger amounts.',
   true, 'Your account details and confirmation in your banking app', 'a few minutes', 5)
on conflict (id) do update set
  label = excluded.label, kind = excluded.kind, blurb = excluded.blurb,
  redirects = excluded.redirects, asks_for = excluded.asks_for,
  typical = excluded.typical, sort_order = excluded.sort_order;

/* Where each is actually offered. Net banking and UPI are Indian rails and are
   listed for India alone; M-Pesa is Kenyan. A customer in Dubai being offered
   UPI is the kind of detail that tells them nobody has thought about them. */
insert into payment_method_markets (method_id, market_code, provider, sort_order) values
  ('upi',          'IN', 'Razorpay',               1),
  ('card',         'IN', 'Razorpay',               2),
  ('netbanking',   'IN', 'Razorpay',               3),
  ('card',         'AE', 'Network International',   1),
  ('bank_transfer','AE', 'Network International',   2),
  ('mobile_money', 'KE', 'Safaricom M-Pesa',        1),
  ('card',         'KE', 'Flutterwave',             2),
  ('bank_transfer','KE', 'Flutterwave',             3)
on conflict (method_id, market_code) do update set
  provider = excluded.provider, sort_order = excluded.sort_order;

do $$
declare
  n integer;
  r record;
begin
  /* Every market the marketplace trades in can be paid in. A market with no way
     to pay is a market with a storefront and no till. */
  select count(*) into n from markets m
   where not exists (select 1 from payment_method_markets pm where pm.market_code = m.code);
  if n > 0 then
    raise exception '% markets offer no way to pay at all', n;
  end if;

  /* Every market can take a card. It is the only method that works for somebody
     who does not hold a local account, and every market has visitors. */
  select count(*) into n from markets m
   where not exists (
     select 1 from payment_method_markets pm where pm.market_code = m.code and pm.method_id = 'card');
  if n > 0 then
    raise exception '% markets cannot take a card', n;
  end if;

  /* And nothing is offered where it does not exist. */
  for r in
    select method_id, market_code from payment_method_markets
     where (method_id in ('upi', 'netbanking') and market_code <> 'IN')
        or (method_id = 'mobile_money' and market_code <> 'KE')
  loop
    raise exception '% is offered in %, where it is not a payment rail', r.method_id, r.market_code;
  end loop;

  if to_regclass('public.payment_attempts') is null then
    raise exception 'payment_attempts did not take';
  end if;

  /* Nobody may update an attempt directly. The settle function is the only way
     one is ever decided, and an update policy would be a second way. */
  select count(*) into n from pg_policies
   where tablename = 'payment_attempts' and cmd in ('UPDATE', 'ALL');
  if n > 0 then
    raise exception '% policies let an attempt be decided outside settle_payment_attempt', n;
  end if;

  if to_regprocedure('public.settle_payment_attempt(text, text, text, text, text)') is null then
    raise exception 'settle_payment_attempt did not take';
  end if;
end $$;
