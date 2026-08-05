/*
  # A shopper in Nairobi

  Every registered customer on this marketplace was Indian. Priya Raman is the
  demo the whole consumer console is built around — her wallet holds rupees, her
  bills are struck under Indian GST, her market is fixed to IN — and she is the
  only shopper anybody can sign in as. So the two things the marketplace claims
  hardest have never been shown working:

  1. that it trades in three countries, and
  2. that a market may take more than one currency.

  Kenya takes KES and USD. Until now nothing exercised that: task #62 records it
  as untested, and untested here means the code path that lets a Kenyan buyer be
  quoted in dollars has never once been walked by anybody.

  This is the first half — who she is. The second is what she has bought.

  ## Why the auth user is made in SQL

  `scripts/seed-auth-users.mjs` creates the four demo logins with the service
  role key over the admin API. That key is not in this environment and must not
  be (it bypasses every policy in the database), so the row is written here
  instead, with `crypt(..., gen_salt('bf'))` — the same bcrypt GoTrue writes and
  the same it verifies against. The identity row goes with it, because GoTrue
  creates one per email user and a user without one is a user half-made.

  Priya's four logins are untouched. This is a fifth, and the persona picker
  keeps her as the default consumer so nothing anybody already demonstrates
  changes.

  ## Kenya, in Kenyan terms

  Nothing is converted from her Indian counterpart. The bank rails are M-Pesa
  and Kenyan cards, VAT is 16% rather than GST at 18%, the numbers are +254, the
  addresses are Kilimani and Westlands with Nairobi postal codes, and the
  timezone is EAT. A demo shown to a Kenyan operator that quietly carries Indian
  furniture is a demo that says nobody thought about them.

  She is Silver rather than Gold and joined in February 2025 rather than June
  2024, because a second customer with the same tier and the same joining date
  reads as a copy of the first rather than as another customer.
*/

/* ------------------------------------------------------------ the login --- */

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  is_sso_user, is_anonymous
)
values (
  '00000000-0000-0000-0000-000000000000',
  '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13',
  'authenticated', 'authenticated',
  'wanjiru.kamau@example.com',
  crypt('demo1234', gen_salt('bf')),
  timestamptz '2025-02-11 07:40:00+03',
  '{"persona": "consumer", "provider": "email", "providers": ["email"]}'::jsonb,
  '{"email_verified": true}'::jsonb,
  timestamptz '2025-02-11 07:40:00+03', now(),
  false, false
)
on conflict (id) do update set
  encrypted_password = excluded.encrypted_password,
  raw_app_meta_data = excluded.raw_app_meta_data,
  email_confirmed_at = excluded.email_confirmed_at;

insert into auth.identities (id, user_id, provider, provider_id, identity_data, created_at, updated_at)
values (
  '3f1b7d20-8c44-4a92-b6e7-15d093ac6e88',
  '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13',
  'email', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13',
  '{"sub": "7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13", "email": "wanjiru.kamau@example.com", "email_verified": true, "phone_verified": false}'::jsonb,
  timestamptz '2025-02-11 07:40:00+03', now()
)
on conflict (id) do nothing;

/* ------------------------------------------------------------ who she is --- */

insert into consumer_profile (
  id, name, customer_id, msisdn, city, since, tier, wallet, points,
  payment_method, email, mfa_enabled, active_sessions, pwd_changed, user_id,
  preferred_language, time_zone, data_units, currency, market
)
values (
  'me-449288', 'Wanjiru Kamau', 'CUS-449288', '+254 722 481 903', 'Nairobi',
  'Customer since Feb 2025', 'Silver', 0, 0,
  'M-Pesa · card ending 7042', 'wanjiru.kamau@6dtech.co.ke',
  true, 1, '03 Apr 2026', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13',
  'English', 'Africa/Nairobi (EAT)', 'GB', 'KES', 'KE'
)
on conflict (id) do update set
  name = excluded.name, msisdn = excluded.msisdn, city = excluded.city,
  tier = excluded.tier, currency = excluded.currency, market = excluded.market;

insert into consumer_addresses (id, label, line1, city, pin, phone, notes, is_default, user_id)
values
  ('AD-KE-1', 'Home', 'Riara Road, Kilimani — Apartment 4B', 'Nairobi', '00100',
   '+254 722 481 903', 'Gate C. The watchman signs for parcels.', true,
   '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'),
  ('AD-KE-2', 'Work', 'Delta Corner, Chiromo Road, Westlands', 'Nairobi', '00800',
   '+254 722 481 903', 'Tower B reception, 08:30 to 17:30 weekdays.', false,
   '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13')
on conflict (id) do update set line1 = excluded.line1, city = excluded.city, pin = excluded.pin;

/* M-Pesa first, because in Kenya it is the instrument most people reach for
   before a card. The expired card is deliberate: it is what makes the
   security screen's "1 expired" count and the gateway's refusal to offer a
   dead card real rather than theoretical. */
insert into consumer_payment_methods (id, kind, detail, holder, expires, is_primary, status, added, user_id)
values
  ('PM-KE-1', 'M-Pesa',     '+254 722 481 903', 'Wanjiru Kamau', null,      true,  'active',  '11 Feb 2025', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'),
  ('PM-KE-2', 'Visa',       '•••• 7042',        'W Kamau',       '11/2028', false, 'active',  '06 Apr 2025', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'),
  ('PM-KE-3', 'Mastercard', '•••• 3318',        'W Kamau',       '02/2026', false, 'expired', '19 Aug 2024', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13')
on conflict (id) do update set detail = excluded.detail, status = excluded.status;

/* ---------------------------------------------------------- her household --- */

insert into consumer_household (id, name, email, role_id, role_name, status, last_active, mfa, joined, cap, spent, is_you, user_id)
values
  ('CU-KE-01', 'Wanjiru Kamau', 'wanjiru.kamau@6dtech.co.ke', 'CO-OWNER', 'Account owner', 'active', 'Now',      true,  '11 Feb 2025', null,   0,       true,  '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'),
  ('CU-KE-02', 'Otieno Kamau',  'otieno.kamau@gmail.com',     'CO-ADULT', 'Adult member',  'active', '3 h ago',  true,  '11 Feb 2025', 6000,  2598.00, false, '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'),
  ('CU-KE-03', 'Amina Kamau',   'amina.k@gmail.com',          'CO-YOUNG', 'Young person',  'active', 'Yesterday', false, '02 Sep 2025', 2500,  1699.00, false, '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13')
on conflict (id) do update set cap = excluded.cap, spent = excluded.spent;

/* --------------------------------------------------------- her paperwork --- */

/* The same seven records Priya holds, under her own customer folder. The files
   behind them are generated separately — a row pointing at a path with nothing
   at it is what `openEvidence` reports as "missing from the document store",
   which is honest and is not a demo. */
insert into consumer_documents (id, user_id, name, kind, category, issued, detail, path, size, sort_order)
values
  ('CD-KE-001', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'Customer agreement', 'PDF', 'Account', '11 Feb 2025',
   'The terms this account was opened under, countersigned. Names the plan, the notice period and what happens to the number if the account closes.',
   'CUS-449288/cd-001.pdf', '0.4 MB', 1),
  ('CD-KE-002', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'Proof of identity — verified', 'PDF', 'Account', '11 Feb 2025',
   'The identity check the regulator requires before a line is activated. The document itself is held by the verification agent; this is the certificate they issued.',
   'CUS-449288/cd-002.pdf', '0.2 MB', 2),
  ('CD-KE-003', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'Proof of address', 'PDF', 'Account', '11 Feb 2025',
   'A utility bill in the account holder''s name at the service address, dated within three months of the application.',
   'CUS-449288/cd-003.pdf', '0.3 MB', 3),
  ('CD-KE-004', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'Number porting authority', 'PDF', 'Account', '14 Feb 2025',
   'The instruction to move the number from the previous operator. Signed by the account holder; the losing operator has ten working days to object.',
   'CUS-449288/cd-004.pdf', '0.2 MB', 4),
  ('CD-KE-005', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'Device Protect policy schedule', 'PDF', 'Insurance', '02 May 2026',
   'What the cover pays for, what it excludes and the excess on each claim. Issued by Aegis Assurance, not by the marketplace.',
   'CUS-449288/cd-005.pdf', '0.3 MB', 5),
  ('CD-KE-006', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'Kestrel K9 Pro — warranty', 'PDF', 'Devices', '19 Jun 2026',
   'The manufacturer''s warranty as supplied with the handset. Twenty-four months, and it names what voids it.',
   'CUS-449288/cd-006.pdf', '0.2 MB', 6),
  ('CD-KE-007', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'VAT statement 2025/26', 'PDF', 'Billing', '01 Jul 2026',
   'Every shilling of VAT charged across the tax year, per bill. What an accountant asks for and what the account holder never keeps.',
   'CUS-449288/cd-007.pdf', '0.3 MB', 7)
on conflict (id) do update set path = excluded.path, detail = excluded.detail;

/* -------------------------------------------------------------- her money --- */

insert into wallets (id, party, name, kind, user_id, account_id, cash, promo, opened, last_move, state, note, sort_order, currency)
values (
  'WAL-4130', 'CUS-449288', 'Wanjiru Kamau', 'consumer',
  '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', null,
  0, 0, date '2025-02-11', date '2025-02-11', 'active',
  'Opened with the account. Topped up from M-Pesa.', 130, 'KES'
)
on conflict (id) do update set currency = excluded.currency, user_id = excluded.user_id;

/* Top-ups, each with the payment that fetched the money — a ledger row with no
   payment behind it is money the marketplace cannot say where it came from.
   M-Pesa and cards, because those are the rails Kenya offers. */
create temporary table ke_topup (
  ref text, on_date date, amount numeric, method text, provider text, instrument text
) on commit drop;
insert into ke_topup values
  ('PAY-250310-KE01', date '2025-03-10', 5000,  'mobile_money', 'Safaricom M-Pesa', 'M-Pesa •••••• 1903'),
  ('PAY-250922-KE02', date '2025-09-22', 8000,  'mobile_money', 'Safaricom M-Pesa', 'M-Pesa •••••• 1903'),
  ('PAY-260215-KE03', date '2026-02-15', 12000, 'card',         'Flutterwave',      '•••• 7042'),
  ('PAY-260604-KE04', date '2026-06-04', 15000, 'mobile_money', 'Safaricom M-Pesa', 'M-Pesa •••••• 1903');

insert into wallet_ledger (id, wallet_id, when_date, source, what, amount, pot, ref, sort_order)
select 'W-' || t.ref, 'WAL-4130', t.on_date, 'topup',
       format('Top-up by %s', t.instrument), t.amount, 'cash', t.ref, 700
  from ke_topup t;

insert into payment_attempts
  (id, reference, user_id, wallet_id, order_ref, purpose, amount, currency, method_id,
   market_code, provider, instrument, state, gateway_ref, started_at, decided_at, ledger_id)
select 'PA-' || replace(t.ref, 'PAY-', ''), t.ref,
       '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', 'WAL-4130', null, 'wallet_topup',
       t.amount, 'KES', t.method, 'KE', t.provider, t.instrument, 'succeeded',
       upper(substr(regexp_replace(t.provider, '\W', '', 'g'), 1, 4)) || '-' || upper(substr(md5(t.ref), 1, 6)),
       t.on_date + time '10:20', t.on_date + time '10:21',
       'W-' || t.ref
  from ke_topup t;

/* One payment she abandoned, because a wallet whose every payment worked is a
   wallet nobody has ever seen refuse. */
insert into payment_attempts
  (id, reference, user_id, wallet_id, order_ref, purpose, amount, currency, method_id,
   market_code, provider, instrument, state, failure_reason, gateway_ref, started_at, decided_at)
values (
  'PA-260718-KE05', 'PAY-260718-KE05', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13',
  'WAL-4130', null, 'wallet_topup', 10000, 'KES', 'mobile_money', 'KE',
  'Safaricom M-Pesa', 'M-Pesa •••••• 1903', 'failed',
  'M-Pesa refused the payment. The PIN prompt timed out before it was answered.',
  'SAFA-7B21C4', timestamptz '2026-07-18 21:04:00+03', timestamptz '2026-07-18 21:06:10+03'
)
on conflict (id) do nothing;

/* Spend out of the wallet, so the balance is a story rather than a number. */
insert into wallet_ledger (id, wallet_id, when_date, source, what, amount, pot, ref, sort_order)
values
  ('W-KE-S01', 'WAL-4130', date '2025-11-09', 'spend',  'Spent on Kestrel 45 W GaN charger', -3699,  'cash', 'ORD-770603', 710),
  ('W-KE-S02', 'WAL-4130', date '2026-03-14', 'spend',  'Spent on Volta Mesh Wi-Fi 6 (3-pack)', -8000, 'cash', 'ORD-770944', 720),
  ('W-KE-R01', 'WAL-4130', date '2026-04-21', 'reward', 'Reward points redeemed for credit',  1200,  'promo', 'RDM-KE-01', 730),
  ('W-KE-G01', 'WAL-4130', date '2026-07-19', 'goodwill', 'Goodwill credit — late delivery',   800,  'promo', 'TK-KE-002', 740)
on conflict (id) do nothing;

update wallets w set
  cash  = (select coalesce(sum(l.amount), 0) from wallet_ledger l where l.wallet_id = w.id and l.pot = 'cash'),
  promo = (select coalesce(sum(l.amount), 0) from wallet_ledger l where l.wallet_id = w.id and l.pot = 'promo'),
  last_move = (select max(l.when_date) from wallet_ledger l where l.wallet_id = w.id)
 where w.id = 'WAL-4130';

/* --------------------------------------------------------- her loyalty --- */

insert into loyalty_members (id, party, name, kind, tier, balance, joined, qualify_12m,
                             lifetime_earned, lifetime_redeemed, expiring_soon, expiring_on,
                             last_activity, user_id, account_id, currency)
values (
  'LM-4030', 'CUS-449288', 'Wanjiru Kamau', 'consumer', 'silver',
  0, '11 Feb 2025', 0, 0, 0, 0, '31 Mar 2027', '02 Aug 2026',
  '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', null, 'KES'
)
on conflict (id) do update set currency = excluded.currency, tier = excluded.tier;

/* ------------------------------------------------ what reaches her, and how */

/* Channels are taken from each rule's own allowed set rather than typed here:
   `guard_preference` refuses a channel a rule has no template for, and it
   refuses switching off anything mandatory. She has one thing turned off — the
   household-purchase alert — which is the sort of choice a real account holder
   makes and a seeded one never does. */
insert into notification_preferences (id, rule_id, scope, user_id, partner_id, enabled, kinds, updated_on)
select 'NP-KE-' || r.id, r.id, 'user', '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13', null,
       r.id <> 'NR-C5',
       case when r.id in ('NR-C1', 'NR-C2') then r.kinds else array[r.kinds[1]] end,
       '2026-04-03'
  from notification_rules r
 where r.persona = 'consumer'
on conflict (id) do nothing;

do $$
declare
  n integer;
begin
  select count(*) into n from auth.users where email = 'wanjiru.kamau@example.com'
     and email_confirmed_at is not null
     and raw_app_meta_data ->> 'persona' = 'consumer';
  if n <> 1 then raise exception 'The Kenyan shopper cannot sign in'; end if;

  /* The password is the one the picker will offer. Checked rather than assumed,
     because a bcrypt hash that does not verify looks exactly like one that
     does until somebody tries to sign in. */
  select count(*) into n from auth.users
   where email = 'wanjiru.kamau@example.com'
     and encrypted_password = crypt('demo1234', encrypted_password);
  if n <> 1 then raise exception 'The seeded password does not verify'; end if;

  select count(*) into n from auth.identities where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13';
  if n <> 1 then raise exception 'The Kenyan shopper has no email identity'; end if;

  /* Nothing about her is Indian. This is the whole point of the migration, and
     it is checked as data rather than trusted to have been typed correctly. */
  select count(*) into n from consumer_profile
   where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'
     and (market <> 'KE' or currency <> 'KES' or msisdn not like '+254%' or city <> 'Nairobi');
  if n > 0 then raise exception 'Her profile is not Kenyan'; end if;

  select count(*) into n from consumer_addresses
   where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'
     and (city <> 'Nairobi' or phone not like '+254%');
  if n > 0 then raise exception '% of her addresses are not in Nairobi', n; end if;

  /* Her wallet holds one currency, and it is her market's. */
  select count(*) into n from wallets
   where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13' and currency <> 'KES';
  if n > 0 then raise exception 'Her wallet is not in shillings'; end if;

  /* And the balance is the sum of its own movements. */
  select count(*) into n from wallets w
   where w.id = 'WAL-4130'
     and (w.cash  is distinct from (select coalesce(sum(l.amount), 0) from wallet_ledger l where l.wallet_id = w.id and l.pot = 'cash')
       or w.promo is distinct from (select coalesce(sum(l.amount), 0) from wallet_ledger l where l.wallet_id = w.id and l.pot = 'promo'));
  if n > 0 then raise exception 'Her wallet does not add up to its own statement'; end if;

  select count(*) into n from wallets w join wallet_limits x on x.currency = w.currency
   where w.id = 'WAL-4130' and w.balance > x.max_balance;
  if n > 0 then raise exception 'Her wallet is over the shilling ceiling'; end if;

  /* Every top-up was fetched by a payment on a rail Kenya offers. */
  select count(*) into n from payment_attempts a
   where a.user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13'
     and not exists (select 1 from payment_method_markets pm
                      where pm.method_id = a.method_id and pm.market_code = 'KE');
  if n > 0 then raise exception '% of her payments used a rail Kenya does not have', n; end if;

  select count(*) into n from wallet_ledger l
   where l.wallet_id = 'WAL-4130' and l.source = 'topup'
     and not exists (select 1 from payment_attempts a where a.ledger_id = l.id);
  if n > 0 then raise exception '% top-ups arrived from nowhere', n; end if;

  select count(*) into n from consumer_documents
   where user_id = '7c9e1f42-3b8a-4d61-9e05-2a7f6b4c8d13' and path not like 'CUS-449288/%';
  if n > 0 then raise exception '% of her documents sit in another customer''s folder', n; end if;

  /* She is not a copy of the Indian shopper. */
  select count(*) into n from consumer_profile p1, consumer_profile p2
   where p1.customer_id = 'CUS-449288' and p2.customer_id = 'CUS-449021'
     and (p1.tier = p2.tier or p1.since = p2.since or p1.msisdn = p2.msisdn);
  if n > 0 then raise exception 'The Kenyan shopper reads as a copy of the Indian one'; end if;
end $$;
