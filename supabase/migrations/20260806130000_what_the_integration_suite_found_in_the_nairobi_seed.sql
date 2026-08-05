/*
  # What the integration suite found in the Nairobi seed

  Seeding a Kenyan seller and buyer broke six checks, and dropping
  `consumer_profile.points` broke a seventh. All seven are worth the space
  because each one is a rule the marketplace already had and the new rows did
  not respect — which is what the checks are for.

  ## Registration wrote a column that no longer exists

  `20260806080000` dropped `consumer_profile.points` and `.tier` as duplicates
  of `loyalty_members.balance` and `.tier`. `register_as_consumer()` names every
  column explicitly — deliberately, and its comment says why: the table's
  defaults are the demo customer's, so an omitted column would hand a stranger
  her balance. That care is exactly what made it break: it names `tier` and
  `points`, and after the drop every registration failed with
  `column "tier" of relation "consumer_profile" does not exist`.

  A caller saw "The sign-in was created — use it to sign in and the profile will
  be finished then", which is the worst kind of failure: an auth row with no
  profile, and a reassuring message.

  ## The seller was priced and categorised where they cannot trade

  Beacon Reseller Co is approved in Kenya and the UAE and **suspended in India**
  — their own record says so: "Beacon is a Kenyan reseller trading in East
  Africa and the Gulf; the Indian market was never part of the agreement." The
  new listings were priced in all four currencies "like every other listing",
  which is not the rule. The rule is that a seller holds prices only in the
  currencies their approved markets take, and INR is not one of them.

  `SKU-7010` was filed under `iot` and Beacon held one category grant,
  `partner`. Two ways out: move the product, or grant the category. The product
  is a managed M2M SIM estate, which is IoT connectivity and nothing else — so
  filing it under reseller packs to satisfy a grant would be describing it
  wrongly to make a check pass. The grant is the thing that was missing, and it
  is recorded as a grant, with an approver and a date, not waved through.

  ## The statements had no lines and no ledger behind them

  A settlement statement is only payable if it equals the order lines behind it
  and if the ledger posted what the register approved. Six statements arrived
  with neither, so both reconciliations failed on every period — correctly, and
  loudly, which is the whole point of having them.

  ## And they were converted at a rate that did not exist yet

  Each statement took the rate in force when it was *issued*, a month after the
  period closed. `settlement.integration.test.ts` refuses that: a period is
  settled at a fix that was in force when it closed, never a later one, or a
  statement's value depends on when somebody got round to cutting it.
*/

/* ------------------------------------------------- registration, first ---- */

/* Only the insert changes. Every other line, including the comment about naming
   every column, is as it was — it is right, and the two columns it named are
   simply not there any more. */
create or replace function register_as_consumer(
  p_name text, p_msisdn text, p_city text, p_market text
) returns text
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid;
  v_email text;
  v_customer text;
  v_currency text;
  v_id text;
begin
  v_uid := auth.uid();
  if v_uid is null then
    raise exception 'Create the sign-in first — there is nothing to attach a profile to.';
  end if;

  /* The one check that makes this safe to expose. Somebody who already has a
     profile has a persona, and this function must never be a way to change it —
     an operator calling it would otherwise end up with a consumer row and a
     basket, and a consumer calling it twice would get two. */
  if exists (select 1 from profiles where id = v_uid) then
    raise exception 'This sign-in is already registered.';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'Give the name the account should be in.';
  end if;
  if coalesce(trim(p_msisdn), '') = '' then
    raise exception 'Give a mobile number — it is what plans and top-ups are attached to.';
  end if;
  if coalesce(trim(p_city), '') = '' then
    raise exception 'Give a city, so deliveries and tax go to the right place.';
  end if;

  /* Where they are registered decides which market they buy in and therefore
     what they pay and what tax they pay — `20260802450000`. Not a preference,
     and not something the storefront picker changes afterwards. */
  if not exists (select 1 from markets m where m.code = p_market) then
    raise exception 'The marketplace does not operate there yet. It trades in %.',
      (select string_agg(name, ', ' order by sort_order) from markets);
  end if;
  select mc.currency into v_currency from market_currencies mc
   where mc.market_code = p_market order by mc.is_default desc, mc.sort_order limit 1;

  select email into v_email from auth.users where id = v_uid;

  /* Persona is a literal. It is not a parameter, it is not read from a table a
     caller can write, and there is no other statement in this schema that puts
     a row in `profiles` from a client request. */
  insert into profiles (id, persona) values (v_uid, 'consumer');

  v_customer := 'CUS-' || nextval('consumer_ref_seq')::text;
  v_id := 'cp-' || replace(v_uid::text, '-', '');

  /* Every column named. The table's defaults are Priya Raman's — her wallet,
     her phone number — and an omitted column here would silently hand a
     stranger her balance.

     `tier` and `points` are gone from this list because they are gone from the
     table: they duplicated `loyalty_members`, nothing maintained the copy, and
     the second customer arrived with 0 against a ledger of 760. The membership
     row below carries both, and is the only place either is written. */
  insert into consumer_profile (
    id, user_id, name, customer_id, msisdn, city, since, wallet,
    payment_method, email, mfa_enabled, active_sessions, pwd_changed,
    preferred_language, time_zone, data_units, currency, market
  ) values (
    v_id, v_uid, trim(p_name), v_customer, trim(p_msisdn), trim(p_city),
    'Customer since ' || to_char(now(), 'Mon YYYY'),
    0,
    'Not set up yet', coalesce(v_email, ''), false, 1, to_char(now(), 'DD Mon YYYY'),
    'English',
    case p_market when 'IN' then 'Asia/Kolkata (IST)'
                  when 'AE' then 'Asia/Dubai (GST)'
                  when 'KE' then 'Africa/Nairobi (EAT)'
                  else 'UTC' end,
    'GB', v_currency, p_market
  );

  /* A membership row, because the rewards screen reads one and a shopper
     without it has a screen that renders nothing rather than zero. Balances at
     nought: points are earned, and seeding any would be inventing a purchase
     history. */
  insert into loyalty_members (id, party, name, kind, tier, balance, joined,
                               qualify_12m, lifetime_earned, lifetime_redeemed,
                               expiring_soon, user_id, currency)
  values ('LM-' || replace(v_customer, 'CUS-', ''), v_customer, trim(p_name),
          'consumer', 'bronze', 0, to_char(now(), 'DD Mon YYYY'),
          0, 0, 0, 0, v_uid, v_currency);

  return v_customer;
end $$;

/* -------------------------------------- what the seller may sell, and where */

/* India was never part of Beacon's agreement, so they hold no rupee price. */
delete from product_prices
 where currency = 'INR'
   and product_id in (select id from products where partner_id = 'PTR-1009');

/* The category the product actually belongs to, granted rather than the product
   being refiled to suit the grant. A connectivity reseller selling managed M2M
   SIMs is selling IoT connectivity; calling it a reseller pack to satisfy a
   check would be describing it wrongly. */
insert into partner_categories (partner_id, category_id, approved_at, approved_by)
values ('PTR-1009', 'iot', '2025-03-01 00:00:00+00', 'Lena Fischer')
on conflict (partner_id, category_id) do update
  set approved_at = excluded.approved_at, approved_by = excluded.approved_by;

/* A photograph of its own. Without one a listing falls through to the generic
   handset, and three unrelated things wearing one stock photo is how this check
   came to exist. */
insert into product_media (id, product_id, url, role, alt, sort_order) values
  ('pm-SKU-7009-1', 'SKU-7009',
   'https://images.pexels.com/photos/3760067/pexels-photo-3760067.jpeg?auto=compress&cs=tinysrgb&w=600',
   'hero', 'Beacon wholesale voice bundle — product photograph', 1),
  ('pm-SKU-7010-1', 'SKU-7010',
   'https://images.pexels.com/photos/4482900/pexels-photo-4482900.jpeg?auto=compress&cs=tinysrgb&w=600',
   'hero', 'Beacon managed SIM estate — product photograph', 1)
on conflict (id) do nothing;

/* ------------------------------- the rate in force when the period closed -- */

update settlement_statements s
   set fx_rate = f.rate,
       fx_as_of = f.as_of,
       payout_net = round(s.net * f.rate, 2)
  from gl_periods p
  join lateral (
    select rate, as_of from fx_rates
     where base = 'USD' and quote = 'KES' and as_of <= p.ends
     order by as_of desc limit 1
  ) f on true
 /* `gl_periods.label` is "February 2026" and `settlement_statements.period` is
    "Feb 2026". Neither is a date, so they are joined through one. */
 where s.partner_id = 'PTR-1009'
   and p.starts = to_date(s.period, 'Mon YYYY');

/* ------------------------------------------- the lines behind each figure -- */

/* Two lines per statement, one per live listing, aggregated the way every other
   seller's are — three lines against four hundred orders, not one line per
   order. The split follows the two products' relative price so the numbers are
   a plausible mix rather than a half each, and the second line takes the
   remainder so the parts equal the whole exactly. */
insert into settlement_lines (
  id, statement_id, partner_id, order_ref, product_id, product_name,
  category_id, quantity, gross, tax, commission_rate, commission, fees,
  refunds, net, occurred_on, sort_order
)
select
  s.id || '-L1', s.id, 'PTR-1009',
  'ORD-KE-' || to_char(p.ends, 'YYMM') || '-A',
  'SKU-7010', 'Beacon managed SIM estate — per SIM', 'iot',
  round(s.order_count * 0.62)::int,
  round(s.gross * 0.62, 2),
  0,
  s.commission_rate,
  round(s.commission * 0.62, 2),
  round(s.fees * 0.62, 2),
  round(s.refunds * 0.62, 2),
  round(s.gross * 0.62, 2) - round(s.commission * 0.62, 2)
    - round(s.fees * 0.62, 2) - round(s.refunds * 0.62, 2),
  p.ends, 1
from settlement_statements s join gl_periods p on p.starts = to_date(s.period, 'Mon YYYY')
where s.partner_id = 'PTR-1009'
union all
select
  s.id || '-L2', s.id, 'PTR-1009',
  'ORD-KE-' || to_char(p.ends, 'YYMM') || '-B',
  'SKU-7009', 'Beacon wholesale voice bundle — 200 lines', 'partner',
  s.order_count - round(s.order_count * 0.62)::int,
  s.gross - round(s.gross * 0.62, 2),
  0,
  s.commission_rate,
  s.commission - round(s.commission * 0.62, 2),
  s.fees - round(s.fees * 0.62, 2),
  s.refunds - round(s.refunds * 0.62, 2),
  (s.gross - round(s.gross * 0.62, 2)) - (s.commission - round(s.commission * 0.62, 2))
    - (s.fees - round(s.fees * 0.62, 2)) - (s.refunds - round(s.refunds * 0.62, 2)),
  p.ends, 2
from settlement_statements s join gl_periods p on p.starts = to_date(s.period, 'Mon YYYY')
where s.partner_id = 'PTR-1009'
on conflict (id) do nothing;

/* -------------------------------------------- and the ledger behind those -- */

/* What the register approved, posted. Two systems, one number — which is what
   `reconcileLedgerToSettlement` checks, and what failed on all six periods
   while the statements existed and the postings did not. */
insert into gl_postings (id, charge_id, amount, dr, cr, ref, when_date, period, source, partner_id)
select s.id || '-AP', 'settle.approved', s.net, '2010', '2020', s.id, p.ends, p.id, 'automatic', 'PTR-1009'
  from settlement_statements s join gl_periods p on p.starts = to_date(s.period, 'Mon YYYY')
 where s.partner_id = 'PTR-1009' and s.status in ('approved', 'paid')
union all
/* And what actually left the bank, only where it has. July is approved and not
   yet paid, so it has one posting rather than two — which is the state a
   month-end is normally in. */
select s.id || '-PD', 'settle.paid', s.net, '2020', '1020', s.id, p.ends, p.id, 'automatic', 'PTR-1009'
  from settlement_statements s join gl_periods p on p.starts = to_date(s.period, 'Mon YYYY')
 where s.partner_id = 'PTR-1009' and s.status = 'paid'
on conflict (id) do nothing;

/* ------------------------------------------------------------ assertions -- */

do $$
declare n integer; r record;
begin
  /* Registration works. Checked by shape rather than by calling it — the
     function is `security definer` on `auth.uid()` and there is no session
     here — but a column it names that does not exist is the entire fault. */
  for r in
    select unnest(array['id','user_id','name','customer_id','msisdn','city','since',
                        'wallet','payment_method','email','mfa_enabled','active_sessions',
                        'pwd_changed','preferred_language','time_zone','data_units',
                        'currency','market']) as col
  loop
    if not exists (select 1 from information_schema.columns
                    where table_name = 'consumer_profile' and column_name = r.col) then
      raise exception 'register_as_consumer writes %, which consumer_profile does not have', r.col;
    end if;
  end loop;

  if exists (select 1 from information_schema.columns
              where table_name = 'consumer_profile' and column_name in ('tier', 'points')) then
    raise exception 'consumer_profile has a tier or points column again — that is the copy that went stale';
  end if;

  /* No seller holds a price in a currency none of their approved markets take. */
  for r in
    select p.id, pr.currency, pp.name
      from product_prices pr
      join products p on p.id = pr.product_id
      join partners pp on pp.id = p.partner_id
     where p.partner_id is not null
       and not exists (
         select 1 from partner_markets pm
           join market_currencies mc on mc.market_code = pm.market_code
          where pm.partner_id = p.partner_id and pm.state = 'approved'
            and mc.currency = pr.currency)
  loop
    raise exception '% is priced in %, which % cannot trade in', r.id, r.currency, r.name;
  end loop;

  /* And sells nothing in a category nobody approved them for.

     Scoped to what is actually on sale. A listing in review, from a seller in
     review, in a category application that has not cleared yet, is the normal
     shape of an application rather than a fault — a seller cannot get a
     category approved without submitting something into it. `SKU-4007` /
     Lumen Wearables is exactly that state and is deliberately not caught here.
     What must never happen is a buyer being sold something in a category the
     seller was never cleared for. */
  for r in
    select p.id, p.category_id, pp.name
      from products p join partners pp on pp.id = p.partner_id
     where p.partner_id is not null and p.status = 'live'
       and not exists (select 1 from partner_categories pc
                        where pc.partner_id = p.partner_id
                          and pc.category_id = p.category_id
                          and pc.approved_at is not null)
  loop
    raise exception '% is on sale in %, which % was never approved for', r.id, r.category_id, r.name;
  end loop;

  /* Every statement equals the lines behind it. */
  for r in
    select s.id, s.gross, s.commission, s.fees, s.refunds, s.net, s.withholding,
           (select coalesce(sum(l.gross), 0) from settlement_lines l where l.statement_id = s.id) lg,
           (select coalesce(sum(l.commission), 0) from settlement_lines l where l.statement_id = s.id) lc,
           (select coalesce(sum(l.fees), 0) from settlement_lines l where l.statement_id = s.id) lf,
           (select coalesce(sum(l.refunds), 0) from settlement_lines l where l.statement_id = s.id) lr,
           (select coalesce(sum(l.net), 0) from settlement_lines l where l.statement_id = s.id) ln,
           (select count(*) from settlement_lines l where l.statement_id = s.id) k
      from settlement_statements s where s.partner_id = 'PTR-1009'
  loop
    if r.k = 0 then raise exception '% has no lines behind it, so it is not payable', r.id; end if;
    if round(r.lg, 2) <> round(r.gross, 2) then
      raise exception '% states gross % and its lines come to %', r.id, r.gross, r.lg; end if;
    if round(r.lc, 2) <> round(r.commission, 2) then
      raise exception '% states commission % and its lines come to %', r.id, r.commission, r.lc; end if;
    if round(r.lf, 2) <> round(r.fees, 2) then
      raise exception '% states fees % and its lines come to %', r.id, r.fees, r.lf; end if;
    if round(r.lr, 2) <> round(r.refunds, 2) then
      raise exception '% states refunds % and its lines come to %', r.id, r.refunds, r.lr; end if;
    if round(r.ln - r.withholding, 2) <> round(r.net, 2) then
      raise exception '% states net % and its lines come to %', r.id, r.net, r.ln - r.withholding; end if;
  end loop;

  /* The ledger posted what the register approved, in every period. */
  for r in
    select p.id, p.label,
           (select coalesce(sum(s.net), 0) from settlement_statements s
             where to_date(s.period, 'Mon YYYY') = p.starts
               and s.status in ('approved', 'paid')) owed,
           (select coalesce(sum(g.amount), 0) from gl_postings g
             where g.period = p.id and g.charge_id = 'settle.approved') posted
      from gl_periods p
  loop
    if round(r.owed, 2) <> round(r.posted, 2) then
      raise exception '% approved % for payment and the ledger posted %', r.label, r.owed, r.posted;
    end if;
  end loop;

  /* No period is settled at a rate that did not exist when it closed. */
  for r in
    select s.id, s.period, s.fx_as_of, p.ends
      from settlement_statements s join gl_periods p on p.starts = to_date(s.period, 'Mon YYYY')
     where s.fx_as_of > p.ends
  loop
    raise exception '% for % used the fix of %, which is after the period closed on %',
      r.id, r.period, r.fx_as_of, r.ends;
  end loop;

  /* And the payout still equals the net at the rate the row now carries. */
  select count(*) into n from settlement_statements
   where partner_id = 'PTR-1009' and round(net * fx_rate, 2) <> payout_net;
  if n > 0 then raise exception '% statements no longer pay out the net at their own rate', n; end if;

  /* The rate is one that is actually on file, not a number typed on the row. */
  select count(*) into n from settlement_statements s
   where s.partner_id = 'PTR-1009'
     and not exists (select 1 from fx_rates f
                      where f.base = s.currency and f.quote = s.payout_currency
                        and f.as_of = s.fx_as_of and f.rate = s.fx_rate);
  if n > 0 then raise exception '% statements quote a rate that is not on file', n; end if;
end $$;
