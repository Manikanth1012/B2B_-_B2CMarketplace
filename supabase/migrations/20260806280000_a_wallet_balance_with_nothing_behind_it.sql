/* A wallet balance with nothing behind it.
 *
 * Otieno's wallet was seeded as two numbers — 6,420 of his own money and 900
 * of credit — and the statement under them said "Top-ups, refunds and spend
 * appear here" to a customer who had apparently been holding money for two and
 * a half years. The balance was asserted rather than arrived at.
 *
 * `wallet_ledger` is the record and `wallets.cash` and `.promo` are its totals:
 * Wanjiru's movements sum to exactly her two numbers. So this writes the
 * movements and then sets the wallet from them, rather than the other way
 * round. If the two ever disagree the assertion at the end fails.
 *
 * The story the movements tell is an ordinary one: he topped up from M-Pesa
 * when there was something to buy, the charger refund came back to the wallet
 * rather than to the card, he turned 900 points into credit, the marketplace
 * gave him a little goodwill when a delivery went wrong, and he spent some of
 * it against bills. Credit is spent before cash, which is what the screen above
 * the statement promises.
 */

begin;

do $$
declare
  uid  uuid := 'e5b3c7a1-9d42-4f68-b015-7c3e9a2b4d81';
  wid  text := 'WAL-4131';
  c    numeric;
  p    numeric;
  running numeric;
  m    record;
begin
  if not exists (select 1 from wallets where id = wid and user_id = uid) then
    raise exception 'Otieno has no wallet — 20260806270000 has not run';
  end if;

  delete from wallet_ledger where wallet_id = wid;

  insert into wallet_ledger (id, wallet_id, when_date, source, what, amount, pot, ref, sort_order) values
    /* Opened with the account, from the M-Pesa number Aventa asserted. */
    ('W-450031-01', wid, '2024-02-05', 'topup',    'Opened by M-Pesa •••••• 6442',                       3000,  'cash',  'PAY-240205-KE01', 700),
    ('W-450031-02', wid, '2024-11-18', 'topup',    'Top-up by M-Pesa •••••• 6442',                       5000,  'cash',  'PAY-241118-KE02', 700),
    ('W-450031-03', wid, '2025-01-14', 'spend',    'Part-paid against the Volta Mesh order ORD-450104',  -4000, 'cash',  'ORD-450104',      700),
    ('W-450031-04', wid, '2025-06-27', 'goodwill', 'Goodwill after a delivery arrived three days late',   500,  'promo', 'ORD-450105',      700),
    ('W-450031-05', wid, '2025-08-30', 'topup',    'Top-up by •••• 4417 before the handset order',      12000,  'cash',  'PAY-250830-KE03', 700),
    ('W-450031-06', wid, '2025-09-02', 'spend',    'Part-paid against the Kestrel K9 Pro ORD-450106',  -12000, 'cash',  'ORD-450106',      700),
    /* The charger came back to the wallet rather than to M-Pesa, which is why
       the refund screen and this statement both name ORD-450108. */
    ('W-450031-07', wid, '2026-02-02', 'refund',   'Refund paid to the wallet — Kestrel 45 W GaN charger', 3699, 'cash', 'RFN-KE-450031',   700),
    ('W-450031-08', wid, '2026-04-11', 'reward',   'Reward points redeemed for credit',                    900, 'promo', 'LTX-KE-450031X',  700),
    ('W-450031-09', wid, '2026-04-11', 'spend',    'Credit spent on the Kestrel Tab 11 LTE ORD-450109',   -500, 'promo', 'ORD-450109',      700),
    ('W-450031-10', wid, '2026-06-19', 'spend',    'Paid the Travel eSIM in full from the wallet',       -1899, 'cash',  'ORD-450110',      700),
    ('W-450031-11', wid, '2026-07-05', 'topup',    'Top-up by M-Pesa •••••• 6442',                        3620, 'cash',  'PAY-260705-KE04', 700),
    ('W-450031-12', wid, '2026-07-30', 'spend',    'Part-paid against the PlayForge Season Pass',        -3000, 'cash',  'ORD-450111',      700);

  select coalesce(sum(amount) filter (where pot = 'cash'), 0),
         coalesce(sum(amount) filter (where pot = 'promo'), 0)
    into c, p
    from wallet_ledger where wallet_id = wid;

  update wallets set cash = c, promo = p, last_move = '2026-07-30' where id = wid;

  /* The profile carries the same figure and it has to be the same figure. */
  update consumer_profile set wallet = c + p where user_id = uid;

  /* ------------------------------------------------------------ assertions -- */

  /* Neither pot may ever have gone below zero, in date order. A statement that
     ends on a positive balance can still describe a wallet that was overdrawn
     in March, and nobody would see it. */
  running := 0;
  for m in select amount, when_date from wallet_ledger
            where wallet_id = wid and pot = 'cash' order by when_date, id loop
    running := running + m.amount;
    if running < 0 then
      raise exception 'the cash pot went negative on %', m.when_date;
    end if;
  end loop;

  running := 0;
  for m in select amount, when_date from wallet_ledger
            where wallet_id = wid and pot = 'promo' order by when_date, id loop
    running := running + m.amount;
    if running < 0 then
      raise exception 'the credit pot went negative on %', m.when_date;
    end if;
  end loop;

  /* Credit cannot be paid out, so it can only ever be spent — never refunded
     or topped up. */
  if exists (select 1 from wallet_ledger where wallet_id = wid and pot = 'promo' and source in ('topup', 'refund')) then
    raise exception 'credit was topped up or refunded, and credit is neither';
  end if;

  /* Every movement that names an order or a refund has to name one that
     exists, or the statement links to nothing. */
  if exists (
    select 1 from wallet_ledger l
     where l.wallet_id = wid and l.ref like 'ORD-%'
       and not exists (select 1 from orders o where o.order_ref = l.ref)
  ) then
    raise exception 'a wallet movement names an order that does not exist';
  end if;
  if exists (
    select 1 from wallet_ledger l
     where l.wallet_id = wid and l.ref like 'RFN-%'
       and not exists (select 1 from refunds r where r.id = l.ref)
  ) then
    raise exception 'a wallet movement names a refund that does not exist';
  end if;

  /* The refund into the wallet has to be the amount that was actually
     refunded, or the statement and the refund screen disagree about the same
     event. */
  if (select amount from wallet_ledger where id = 'W-450031-07')
     <> (select refunded from refunds where id = 'RFN-KE-450031') then
    raise exception 'the refund paid into the wallet is not the refund that was decided';
  end if;

  /* And the credit he redeemed has to be the points he actually spent. */
  if (select amount from wallet_ledger where id = 'W-450031-08')
     <> (select abs(points) from loyalty_ledger where id = 'LTX-KE-450031X') then
    raise exception 'the credit redeemed is not the points that left the loyalty balance';
  end if;

  raise notice 'Otieno wallet: cash %, credit %, % movements', c, p,
    (select count(*) from wallet_ledger where wallet_id = wid);
end $$;

commit;
