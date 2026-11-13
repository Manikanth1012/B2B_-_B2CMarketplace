/*
 * Orders and accounts are scored for risk, and the risky orders are held.
 *
 * Spec 13 (docs/superpowers/specs/2026-11-13-fraud-and-risk-scoring-design.md).
 * Applies after 20261113500000.
 *
 * Telecom carries SIM-swap and device fraud: an eSIM bought on a new account
 * and sent to an address nobody has used, paid by carrier billing after two
 * refused cards. Nothing on the marketplace noticed. Now:
 *
 *   1. Rules the operator tunes (`risk_rules`): points, on/off, and a
 *      threshold where the rule has one; two bands per kind
 *      (`risk_settings`, seeded Review 40 / Hold 70 for orders and
 *      Review 40 / High 70 for accounts). Every edit is audited
 *      (`risk_rule_changes`).
 *
 *   2. `score_order(order)` and `score_account(kind, id)`: the sum of the
 *      enabled rules that fired, the band, and the reasons
 *      `[{rule, label, points}]`. Missing data is a rule that did not fire.
 *
 *   3. `settle_payment_attempt` (latest copy): when a payment succeeds, each
 *      shopper order on it is scored into `order_risk`; one in band `hold`
 *      becomes status `held`. A scoring fault never fails a paid checkout:
 *      the order is placed unscored and a warning is logged. Business orders
 *      are not scored here (approvals and the credit hold already gate them).
 *
 *   4. A held order is hidden from its seller (the seller read policies on
 *      orders, order lines and order parts) and frozen: the seller and
 *      operator guards (latest copies), and a new guard for everybody else,
 *      refuse a status, stage or failed change while it is held, except
 *      inside `decide_held_order`, which releases it (`placed`) or cancels
 *      it (`cancelled`: its pushes to the order manager cancelled, its
 *      monthly parts stopped, one approved refund per line sharing out the
 *      order's total). Nothing is sent to the order manager for a held or
 *      cancelled order (`com_send`, `com_retry`, latest copies). Only settle
 *      puts an order on hold, a fraud-cancelled order stays cancelled for
 *      anyone but the operator, and an order is decided once.
 *
 *   5. `refresh_account_risk(as_of)`: every shopper and every business
 *      account scored into `account_risk`. The night's tenth job (`risk`,
 *      after `invoices`, before `settlements`), and the operator's
 *      "Rescore now".
 *
 *   6. Help: the Risk screen's article (`op-risk`), and the Scheduled jobs
 *      article told about ten jobs.
 *
 * Who sees what: every risk table is read by the operator only. The only
 * trace a buyer or seller sees is the order's status `held`.
 *
 * Idempotent, one transaction, self-check last (all of it rolled back).
 */

begin;

/* ============================================================ 1. tables === */

create table if not exists public.risk_rules (
  id          text primary key,
  applies     text not null check (applies in ('order', 'account')),
  label       text not null,
  points      integer not null check (points between -50 and 100),
  enabled     boolean not null default true,
  /* Null on a rule that has no number to tune. */
  threshold   numeric check (threshold is null or threshold > 0),
  unit        text,
  sort_order  integer not null default 0,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

create table if not exists public.risk_settings (
  kind        text primary key check (kind in ('order', 'account')),
  /* For an account, `hold_at` is where High starts. */
  review_at   integer not null check (review_at between 1 and 100),
  hold_at     integer not null check (hold_at between 1 and 100),
  check (review_at < hold_at)
);

create table if not exists public.order_risk (
  order_id    uuid primary key references public.orders(id) on delete cascade,
  score       integer not null,
  band        text not null check (band in ('low', 'review', 'hold')),
  reasons     jsonb not null default '[]'::jsonb,
  scored_at   timestamptz not null default now(),
  decision    text check (decision in ('released', 'cancelled')),
  decided_by  text,
  decided_at  timestamptz,
  note        text
);

create index if not exists order_risk_band_idx on public.order_risk (band, scored_at desc);

create table if not exists public.account_risk (
  kind        text not null check (kind in ('shopper', 'business')),
  /* A shopper's auth user id as text, or a business account id. */
  id          text not null,
  score       integer not null,
  band        text not null check (band in ('low', 'review', 'high')),
  reasons     jsonb not null default '[]'::jsonb,
  scored_at   timestamptz not null default now(),
  primary key (kind, id)
);

create table if not exists public.risk_rule_changes (
  id          bigint generated always as identity primary key,
  /* A rule id, or `order-bands` / `account-bands` for a band edit. */
  rule_id     text not null,
  field       text not null,
  was         text,
  now         text,
  by_name     text not null,
  at          timestamptz not null default now()
);

create index if not exists risk_rule_changes_at_idx on public.risk_rule_changes (at desc);

alter table public.risk_rules enable row level security;
alter table public.risk_settings enable row level security;
alter table public.order_risk enable row level security;
alter table public.account_risk enable row level security;
alter table public.risk_rule_changes enable row level security;

/* Read by the operator only. No write policy: the functions below write. */
drop policy if exists "operator_read_risk_rules" on public.risk_rules;
create policy "operator_read_risk_rules" on public.risk_rules for select to authenticated
  using (public.current_persona() = 'operator');
drop policy if exists "operator_read_risk_settings" on public.risk_settings;
create policy "operator_read_risk_settings" on public.risk_settings for select to authenticated
  using (public.current_persona() = 'operator');
drop policy if exists "operator_read_order_risk" on public.order_risk;
create policy "operator_read_order_risk" on public.order_risk for select to authenticated
  using (public.current_persona() = 'operator');
drop policy if exists "operator_read_account_risk" on public.account_risk;
create policy "operator_read_account_risk" on public.account_risk for select to authenticated
  using (public.current_persona() = 'operator');
drop policy if exists "operator_read_risk_rule_changes" on public.risk_rule_changes;
create policy "operator_read_risk_rule_changes" on public.risk_rule_changes for select to authenticated
  using (public.current_persona() = 'operator');

/* ============================================================ 2. seeds === */

/* Ids are stable: the functions below recognise a rule by its id. A
   threshold is the one number of a rule the operator may tune; where a rule
   counts "each", the threshold is the cap. */
insert into public.risk_rules (id, applies, label, points, enabled, threshold, unit, sort_order) values
  ('o-account-review',  'order',   'Account in review',          15, true, null, null,               1),
  ('o-account-high',    'order',   'Account high risk',          30, true, null, null,               2),
  ('o-new-account',     'order',   'New account',                20, true, 7,    'days',             3),
  ('o-first-order',     'order',   'First order',                10, true, null, null,               4),
  ('o-big-order',       'order',   'Far bigger than usual',      25, true, 3,    '× median order',   5),
  ('o-sim-line',        'order',   'SIM or eSIM line',           15, true, null, null,               6),
  ('o-sim-new-address', 'order',   'SIM to a new address',       30, true, null, null,               7),
  ('o-guest',           'order',   'Guest checkout',             15, true, null, null,               8),
  ('o-failed-payments', 'order',   'Failed payments in 24 h',    25, true, 2,    'failed payments',  9),
  ('o-burst',           'order',   'Orders in an hour',          20, true, 3,    'orders',          10),
  ('o-carrier-emi',     'order',   'Carrier billing or EMI',     10, true, 200,  'USD',             11),
  ('a-refunds',         'account', 'Refunds in 90 days',         10, true, 30,   'points at most',  21),
  ('a-disputes',        'account', 'Disputes in 180 days',       25, true, null, null,              22),
  ('a-failed-payments', 'account', 'Failed payments in 30 days',  5, true, 20,   'points at most',  23),
  ('a-bursts',          'account', 'Order bursts in 30 days',    15, true, 5,    'orders in a day', 24),
  ('a-over-credit',     'account', 'Over credit limit',          20, true, null, null,              25),
  ('a-overdue',         'account', 'Invoice overdue',            15, true, null, null,              26)
on conflict (id) do nothing;

insert into public.risk_settings (kind, review_at, hold_at) values
  ('order', 40, 70),
  ('account', 40, 70)
on conflict (kind) do nothing;

/* ========================================================== 3. scoring === */

/* Who an operator is, for the audit and the refund's `decided_by`. */
create or replace function public.risk_operator_name()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(
    (select ou.name from public.operator_users ou
       join auth.users au on lower(au.email) = lower(ou.email)
      where au.id = auth.uid() limit 1),
    case when auth.uid() is null then 'Marketplace schedule' else 'Marketplace operator' end)
$$;

revoke all on function public.risk_operator_name() from public, anon, authenticated;

/* An order. Its buyer's history is what came before it: their other orders,
   placed earlier, not waiting to be paid, cancelled or failed, and not on the
   same payment (one checkout writes one order per seller). */
create or replace function public.score_order(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
<<so>>
declare
  v_o         public.orders%rowtype;
  v_at        timestamptz;
  v_band_acct text;
  v_joined    timestamptz;
  v_earlier   integer := 0;
  v_median    numeric;
  v_sim       boolean := false;
  v_new_addr  boolean := false;
  v_failed    integer := 0;
  v_burst     integer := 0;
  v_rate      numeric;
  v_usd       numeric;
  rr          record;
  v_pts       integer;
  v_score     integer := 0;
  v_reasons   jsonb := '[]'::jsonb;
  v_review    integer;
  v_hold      integer;
  v_band      text;
begin
  select * into v_o from public.orders o where o.id = p_order;
  if not found then
    raise exception 'There is no order % to score.', p_order;
  end if;
  v_at := coalesce(v_o.created_at, now());

  if v_o.user_id is not null then
    select ar.band into v_band_acct
      from public.account_risk ar
     where ar.kind = 'shopper' and ar.id = v_o.user_id::text;

    select u.created_at into v_joined from auth.users u where u.id = v_o.user_id;

    select count(*) into v_earlier
      from public.orders e
     where e.user_id = v_o.user_id and e.id <> v_o.id and e.account_id is null
       and e.created_at < v_at
       and (v_o.payment_ref is null or e.payment_ref is distinct from v_o.payment_ref)
       and e.status not in ('awaiting_payment', 'cancelled', 'failed');

    select percentile_cont(0.5) within group (order by e.total) into v_median
      from public.orders e
     where e.user_id = v_o.user_id and e.id <> v_o.id and e.account_id is null
       and e.created_at < v_at
       and (v_o.payment_ref is null or e.payment_ref is distinct from v_o.payment_ref)
       and e.status not in ('awaiting_payment', 'cancelled', 'failed')
       and e.currency = v_o.currency;

    select count(distinct coalesce(e.payment_ref, e.order_ref)) into v_burst
      from public.orders e
     where e.user_id = v_o.user_id and e.account_id is null
       and (e.id = v_o.id
            or (e.created_at > v_at - interval '1 hour' and e.created_at <= v_at
                and e.status not in ('awaiting_payment', 'cancelled', 'failed')));
  end if;

  /* A SIM or eSIM line: one fulfilled as an eSIM, or a product filed or named
     as a SIM (the IoT SIMs ship). */
  select exists (
    select 1
      from public.order_items i
      left join public.products p on p.id = i.product_id
      left join public.categories c on c.id = p.category_id
     where i.order_id = v_o.id
       and (i.fulfil = 'esim' or p.fulfil = 'esim'
            or concat_ws(' ', c.id, c.name, p.sub_category, i.product_name) ~* '\m(e-?)?sims?\M'))
    into v_sim;

  /* To an address none of the buyer's earlier orders went to. */
  if v_sim and v_earlier > 0 and v_o.shipping_address is not null then
    v_new_addr := not exists (
      select 1 from public.orders e
       where e.user_id = v_o.user_id and e.id <> v_o.id and e.account_id is null
         and e.created_at < v_at
         and (v_o.payment_ref is null or e.payment_ref is distinct from v_o.payment_ref)
         and e.status not in ('awaiting_payment', 'cancelled', 'failed')
         and e.shipping_address = v_o.shipping_address);
  end if;

  /* Refused attempts in the last day, by the buyer or for this order. */
  select count(*) into v_failed
    from public.payment_attempts pa
   where pa.state = 'failed'
     and ((v_o.user_id is not null and pa.user_id = v_o.user_id) or pa.order_ref = v_o.order_ref)
     and coalesce(pa.decided_at, pa.started_at) > now() - interval '24 hours';

  /* The total in dollars, at the latest rate on or before the order. */
  if v_o.currency = 'USD' then
    v_usd := v_o.total;
  else
    select f.rate into v_rate
      from public.fx_rates f
     where f.base = 'USD' and f.quote = v_o.currency and f.as_of <= v_at::date
     order by f.as_of desc limit 1;
    if v_rate > 0 then v_usd := v_o.total / v_rate; end if;
  end if;

  for rr in
    select r.* from public.risk_rules r where r.applies = 'order' and r.enabled order by r.sort_order, r.id
  loop
    v_pts := 0;
    if rr.id = 'o-account-review' then
      if v_band_acct = 'review' then v_pts := rr.points; end if;
    elsif rr.id = 'o-account-high' then
      if v_band_acct = 'high' then v_pts := rr.points; end if;
    elsif rr.id = 'o-new-account' then
      if v_joined > v_at - rr.threshold * interval '1 day' then v_pts := rr.points; end if;
    elsif rr.id = 'o-first-order' then
      if v_o.user_id is not null and v_earlier = 0 then v_pts := rr.points; end if;
    elsif rr.id = 'o-big-order' then
      if v_median > 0 and v_o.total > rr.threshold * v_median then v_pts := rr.points; end if;
    elsif rr.id = 'o-sim-line' then
      if v_sim then v_pts := rr.points; end if;
    elsif rr.id = 'o-sim-new-address' then
      if v_new_addr then v_pts := rr.points; end if;
    elsif rr.id = 'o-guest' then
      if v_o.user_id is null then v_pts := rr.points; end if;
    elsif rr.id = 'o-failed-payments' then
      if v_failed >= rr.threshold then v_pts := rr.points; end if;
    elsif rr.id = 'o-burst' then
      if v_burst >= rr.threshold then v_pts := rr.points; end if;
    elsif rr.id = 'o-carrier-emi' then
      if v_o.payment_method in ('carrier_billing', 'emi') and v_usd > rr.threshold then v_pts := rr.points; end if;
    end if;

    if v_pts <> 0 then
      v_score := v_score + v_pts;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('rule', rr.id, 'label', rr.label, 'points', v_pts));
    end if;
  end loop;

  select s.review_at, s.hold_at into v_review, v_hold from public.risk_settings s where s.kind = 'order';
  v_review := coalesce(v_review, 40);
  v_hold := coalesce(v_hold, 70);
  if v_score >= v_hold then
    v_band := 'hold';
  elsif v_score >= v_review then
    v_band := 'review';
  else
    v_band := 'low';
  end if;

  return jsonb_build_object('score', v_score, 'band', v_band, 'reasons', v_reasons);
end $$;

comment on function public.score_order(uuid) is
  'The risk score of an order: the enabled order rules that fired, the band, and the reasons. Read-only.';

revoke all on function public.score_order(uuid) from public, anon, authenticated;

/* An account, as of a day. A shopper is their auth user id; a business its
   account id. The credit and invoice rules are a business's only. */
create or replace function public.score_account_on(p_kind text, p_id text, p_as_of date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
<<sa>>
declare
  v_user    uuid;
  rr        record;
  v_n       integer;
  v_pts     integer;
  v_score   integer := 0;
  v_reasons jsonb := '[]'::jsonb;
  v_review  integer;
  v_high    integer;
  v_band    text;
begin
  if p_kind is null or p_kind not in ('shopper', 'business') then
    raise exception 'An account to score is a shopper or a business, not %.', coalesce(p_kind, 'nothing');
  end if;
  if p_as_of is null then
    raise exception 'Say which day to score % as of.', coalesce(p_id, 'the account');
  end if;
  if p_kind = 'shopper' then
    if coalesce(p_id, '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception 'There is no shopper %.', coalesce(p_id, 'without an id');
    end if;
    v_user := p_id::uuid;
  end if;

  for rr in
    select r.* from public.risk_rules r where r.applies = 'account' and r.enabled order by r.sort_order, r.id
  loop
    v_pts := 0;
    if rr.id = 'a-refunds' then
      select count(*) into v_n
        from public.refunds f
       where f.requested > p_as_of - 90 and f.requested <= p_as_of
         and ((p_kind = 'shopper' and f.user_id = v_user)
              or (p_kind = 'business' and f.account_id = p_id));
      v_pts := v_n * rr.points;
      if rr.threshold is not null then v_pts := least(v_pts, rr.threshold::integer); end if;
    elsif rr.id = 'a-disputes' then
      select count(*) into v_n
        from public.disputes d
       where d.raised > p_as_of - 180 and d.raised <= p_as_of
         and ((p_kind = 'business' and d.account_id = p_id)
              or (p_kind = 'shopper' and d.kind = 'order'
                  and exists (select 1 from public.orders o
                               where o.order_ref = d.order_ref and o.user_id = v_user and o.account_id is null)));
      v_pts := v_n * rr.points;
    elsif rr.id = 'a-failed-payments' then
      select count(*) into v_n
        from public.payment_attempts pa
       where pa.state = 'failed'
         and coalesce(pa.decided_at, pa.started_at)::date > p_as_of - 30
         and coalesce(pa.decided_at, pa.started_at)::date <= p_as_of
         and ((p_kind = 'shopper' and pa.user_id = v_user)
              or (p_kind = 'business'
                  and pa.wallet_id in (select w.id from public.wallets w where w.account_id = p_id)));
      v_pts := v_n * rr.points;
      if rr.threshold is not null then v_pts := least(v_pts, rr.threshold::integer); end if;
    elsif rr.id = 'a-bursts' then
      select count(*) into v_n
        from (select o.created_at::date as on_day
                from public.orders o
               where o.created_at::date > p_as_of - 30 and o.created_at::date <= p_as_of
                 and o.status not in ('awaiting_payment', 'cancelled', 'failed')
                 and ((p_kind = 'shopper' and o.user_id = v_user and o.account_id is null)
                      or (p_kind = 'business' and o.account_id = p_id))
               group by o.created_at::date
              having count(distinct coalesce(o.payment_ref, o.requisition_id, o.order_ref)) >= rr.threshold) b;
      if v_n > 0 then v_pts := rr.points; end if;
    elsif rr.id = 'a-over-credit' then
      if p_kind = 'business' and exists (select 1 from public.account_exposure(p_id) x
                                           join public.enterprise_billing b on b.account_id = p_id
                                          where x.total > b.credit_limit) then
        v_pts := rr.points;
      end if;
    elsif rr.id = 'a-overdue' then
      if p_kind = 'business' and exists (select 1 from public.enterprise_invoices i
                                          where i.account_id = p_id
                                            and (i.status = 'overdue' or (i.status = 'open' and i.due < p_as_of))) then
        v_pts := rr.points;
      end if;
    end if;

    if v_pts <> 0 then
      v_score := v_score + v_pts;
      v_reasons := v_reasons || jsonb_build_array(jsonb_build_object('rule', rr.id, 'label', rr.label, 'points', v_pts));
    end if;
  end loop;

  select s.review_at, s.hold_at into v_review, v_high from public.risk_settings s where s.kind = 'account';
  v_review := coalesce(v_review, 40);
  v_high := coalesce(v_high, 70);
  if v_score >= v_high then
    v_band := 'high';
  elsif v_score >= v_review then
    v_band := 'review';
  else
    v_band := 'low';
  end if;

  return jsonb_build_object('score', v_score, 'band', v_band, 'reasons', v_reasons);
end $$;

revoke all on function public.score_account_on(text, text, date) from public, anon, authenticated;

create or replace function public.score_account(p_kind text, p_id text)
returns jsonb language sql stable security definer set search_path = public as $$
  select public.score_account_on(p_kind, p_id, current_date)
$$;

comment on function public.score_account(text, text) is
  'The risk score of a shopper (auth user id) or a business (account id) today: the enabled account rules that fired, the band, and the reasons. Read-only.';

revoke all on function public.score_account(text, text) from public, anon, authenticated;

/* Every shopper with an order or a payment attempt, and every business
   account, scored again. The night's `risk` job, and the operator's
   "Rescore now" (granted to signed-in users; anyone but the operator is
   refused). */
create or replace function public.refresh_account_risk(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
<<ra>>
declare
  v_acct     record;
  v_s        jsonb;
  n_scored   integer := 0;
  n_review   integer := 0;
  n_high     integer := 0;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, scores accounts.';
  end if;
  if p_as_of is null or p_as_of > current_date then
    raise exception 'Accounts cannot be scored as of %. Only a day that has happened has a history to score.',
      coalesce(p_as_of::text, 'no date');
  end if;

  for v_acct in
    select 'shopper'::text as acct_kind, x.uid::text as acct_id
      from (select o.user_id as uid from public.orders o
             where o.user_id is not null and o.account_id is null
            union
            select pa.user_id from public.payment_attempts pa where pa.user_id is not null) x
     where exists (select 1 from auth.users u where u.id = x.uid)
       and not exists (select 1 from public.profiles pr where pr.id = x.uid and pr.persona <> 'consumer')
    union all
    select 'business'::text, ea.id from public.enterprise_accounts ea
     order by 1, 2
  loop
    v_s := public.score_account_on(v_acct.acct_kind, v_acct.acct_id, p_as_of);
    insert into public.account_risk as ar (kind, id, score, band, reasons, scored_at)
    values (v_acct.acct_kind, v_acct.acct_id, (v_s ->> 'score')::integer, v_s ->> 'band',
            coalesce(v_s -> 'reasons', '[]'::jsonb), now())
    on conflict (kind, id) do update
      set score = excluded.score, band = excluded.band, reasons = excluded.reasons, scored_at = excluded.scored_at;
    n_scored := n_scored + 1;
    if v_s ->> 'band' = 'review' then
      n_review := n_review + 1;
    elsif v_s ->> 'band' = 'high' then
      n_high := n_high + 1;
    end if;
  end loop;

  return jsonb_build_object('ran_on', p_as_of, 'scored', n_scored, 'review', n_review, 'high', n_high);
end $$;

comment on function public.refresh_account_risk(date) is
  'Scores every shopper and business account into account_risk. Run by the night (job "risk") or the operator.';

revoke all on function public.refresh_account_risk(date) from public, anon;
grant execute on function public.refresh_account_risk(date) to authenticated;

/* ================================================ 4. settling a payment === */

/* `settle_payment_attempt`, copied from 20261113100000 (its latest
   definition). Changed only: once this payment's orders are `placed`, each
   shopper order on it (no account) is scored into `order_risk`, and one in
   band `hold` becomes `held`. A fault while scoring one order is caught and
   logged as a warning; that order stays placed with no score, because a
   scoring fault must never fail a checkout that has been paid for. The
   success answer gains `held` (the order refs held). Same signature, so the
   grant is unchanged. */
create or replace function public.settle_payment_attempt(
  p_attempt text, p_outcome text,
  p_instrument text default null, p_gateway_ref text default null, p_reason text default null,
  /* What the financier came back with. Null on every method that is not
     financing; required on one that is, and refused below rather than by a
     constraint the client cannot read. */
  p_tenure integer default null, p_instalment numeric default null, p_financier text default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  a          payment_attempts%rowtype;
  w          wallets%rowtype;
  m          payment_methods%rowtype;
  mine       boolean;
  led        text;
  ceiling    numeric;
  n_orders   integer;
  v_broken   text;
  v_why      text := 'A bundle was not bought whole, so nothing was charged.';
  v_refs     text[];
  v_held     text[] := '{}';
begin
  if p_outcome not in ('succeeded', 'failed', 'cancelled', 'expired') then
    raise exception 'A payment is not %.', p_outcome;
  end if;

  select * into a from payment_attempts where id = p_attempt for update;
  if not found then
    raise exception 'There is no payment %.', p_attempt;
  end if;

  select * into m from payment_methods where id = a.method_id;

  /* Who is allowed to answer for this payment. A top-up hangs off the wallet's
     owner; an order payment off whoever started it, because an order has no
     wallet to ask. */
  if a.purpose = 'wallet_topup' then
    select * into w from wallets where id = a.wallet_id for update;
    if not found then
      raise exception 'That payment is against a wallet that no longer exists.';
    end if;
    mine := (w.user_id = auth.uid())
         or (w.account_id is not null and w.account_id = current_account_id());
  else
    mine := (a.user_id = auth.uid());
  end if;

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

  /* A financier that approved somebody has to say on what. Refused here, in
     words, rather than leaving the trigger to raise a constraint message at a
     customer who is looking at a confirmation screen. */
  if p_outcome = 'succeeded' and m.financed and p_tenure is null then
    raise exception
      '% came back approved without saying over how long. A plan with no tenure cannot be put on an order.',
      m.label;
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

  /* ------------------------------------------------------------- an order */
  if a.purpose = 'order' then
    /* Bought whole. A shopper's bundle arrives as one order per seller, so no
       single order can hold it; this payment's orders together must. Each
       selection on them is locked first, so two payments for the same bundle
       settle one after the other and the second sees the first's orders. */
    perform 1 from bundle_selections bs
     where bs.id in (select oi.bundle_selection_id
                       from order_items oi join orders o on o.id = oi.order_id
                      where o.payment_ref = a.reference and o.status = 'awaiting_payment'
                        and oi.bundle_selection_id is not null)
     order by bs.id
       for update;

    select string_agg(distinct t.name, ', ') into v_broken
      from bundle_selections bs
      join bundle_templates t on t.id = bs.template_id
     where bs.id in (select oi.bundle_selection_id
                       from order_items oi join orders o on o.id = oi.order_id
                      where o.payment_ref = a.reference and o.status = 'awaiting_payment'
                        and oi.bundle_selection_id is not null)
       and (
         /* A part that is not on this payment's orders, at its quantity. */
         exists (select 1 from bundle_selection_lines l
                  where l.selection_id = bs.id
                    and not exists (select 1 from order_items oi join orders o on o.id = oi.order_id
                                     where o.payment_ref = a.reference and o.status = 'awaiting_payment'
                                       and oi.bundle_selection_id = bs.id
                                       and oi.product_id = l.product_id
                                       and oi.quantity = l.quantity))
         /* Or a part already ordered on an order that is not waiting to be paid. */
         or exists (select 1 from order_items oi join orders o on o.id = oi.order_id
                     where oi.bundle_selection_id = bs.id
                       and o.status <> 'awaiting_payment'));

    if v_broken is not null then
      update payment_attempts
         set state = 'failed', decided_at = now(),
             gateway_ref = coalesce(p_gateway_ref, gateway_ref),
             instrument = coalesce(p_instrument, instrument),
             failure_reason = v_why
       where id = a.id;

      select array_agg(o.order_ref) into v_refs
        from orders o
       where o.payment_ref = a.reference and o.status = 'awaiting_payment';

      /* Nothing was charged, so there is nothing to keep: as
         `expire_stale_payments` does for a payment nobody answered. */
      delete from order_items oi
       using orders o
       where oi.order_id = o.id
         and o.payment_ref = a.reference
         and o.status = 'awaiting_payment';

      delete from orders
       where payment_ref = a.reference
         and status = 'awaiting_payment';

      /* Checkout writes a monthly part's subscription with its order. One that
         has never been charged goes with the order, or it would renew a
         purchase that did not happen, and block the retry as a duplicate. */
      if v_refs is not null then
        delete from subscriptions sb
         where sb.ref = any(v_refs)
           and sb.user_id is not distinct from a.user_id
           and not exists (select 1 from subscription_charge c where c.subscription_id = sb.id);
      end if;

      return jsonb_build_object('already', false, 'state', 'failed', 'reference', a.reference,
        'note', v_why, 'reason', v_why, 'bundles', v_broken);
    end if;

    update orders
       set status = 'placed',
           payment_method = a.method_id
     where payment_ref = a.reference
       and status = 'awaiting_payment';
    get diagnostics n_orders = row_count;

    if n_orders = 0 then
      update payment_attempts
         set state = 'failed', decided_at = now(),
             gateway_ref = coalesce(p_gateway_ref, gateway_ref),
             instrument = coalesce(p_instrument, instrument),
             failure_reason = 'The basket this paid for is no longer waiting to be paid. Nothing was charged.'
       where id = a.id;
      return jsonb_build_object('already', false, 'state', 'failed', 'reference', a.reference,
        'note', 'There was nothing left to pay for.');
    end if;

    /* Scored, and held where the band is `hold`: each shopper order on this
       payment. One order's scoring fault is caught on its own, so it rolls
       back only that order's score and hold; the order stays placed. */
    <<risk>>
    declare
      v_o  record;
      v_s  jsonb;
    begin
      for v_o in
        select o.id, o.order_ref
          from orders o
         where o.payment_ref = a.reference and o.status = 'placed' and o.account_id is null
         order by o.order_ref
      loop
        begin
          v_s := public.score_order(v_o.id);
          insert into public.order_risk (order_id, score, band, reasons, scored_at)
          values (v_o.id, (v_s ->> 'score')::integer, v_s ->> 'band', coalesce(v_s -> 'reasons', '[]'::jsonb), now())
          on conflict (order_id) do update
            set score = excluded.score, band = excluded.band, reasons = excluded.reasons, scored_at = excluded.scored_at;
          if v_s ->> 'band' = 'hold' then
            /* The one write allowed to put an order on hold. */
            perform set_config('aventa.risk_decision', 'on', true);
            update public.orders set status = 'held' where id = v_o.id and status = 'placed';
            perform set_config('aventa.risk_decision', 'off', true);
            v_held := v_held || v_o.order_ref::text;
          end if;
        exception when others then
          raise warning 'Order % was placed without a risk score: % (%)', v_o.order_ref, sqlerrm, sqlstate;
        end;
      end loop;
    end risk;

    update payment_attempts
       set state = 'succeeded', decided_at = now(),
           gateway_ref = coalesce(p_gateway_ref, gateway_ref),
           instrument = coalesce(p_instrument, instrument),
           tenure_months = p_tenure,
           /* Divided here only where the financier did not say. A plan that
              carries interest states its own instalment, and computing one
              would under-report what the customer agreed to. */
           instalment = case when p_tenure is null then null
                             else coalesce(p_instalment, round(a.amount / p_tenure, 2)) end,
           financier = p_financier
     where id = a.id;

    return jsonb_build_object('already', false, 'state', 'succeeded',
                              'reference', a.reference, 'orders', n_orders,
                              'tenure_months', p_tenure, 'held', to_jsonb(v_held));
  end if;

  /* -------------------------------------------------------------- a wallet */
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
end $function$;

grant execute on function public.settle_payment_attempt(text,text,text,text,text,integer,numeric,text)
  to authenticated;

/* ============================================ 5. hidden from the seller === */

/* Whether an order is held. Security definer so the order-line and order-part
   policies can ask it without asking `orders`' own policies back (42P17). */
create or replace function public.order_is_held(p_order uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.orders o where o.id = p_order and o.status = 'held')
$$;

revoke all on function public.order_is_held(uuid) from public, anon;
grant execute on function public.order_is_held(uuid) to authenticated;

/* The seller read policies, as 20260804150000 left them, plus: not while
   held. And the seller's read of an order's parts (20260810000000), the
   same. */
drop policy if exists partner_read_own_orders on orders;
create policy partner_read_own_orders on orders
  for select to authenticated
  using (partner_supplies_order(id) and status <> 'held');

drop policy if exists partner_read_own_order_items on order_items;
create policy partner_read_own_order_items on order_items
  for select to authenticated
  using (partner_supplies_order(order_id) and not public.order_is_held(order_id));

drop policy if exists partner_read_order_part on order_part;
create policy partner_read_order_part on order_part for select
  using (public.partner_supplies_order(order_id) and not public.order_is_held(order_id));

/* ===================================================== 6. and frozen === */

/* `guard_order_fulfilment`, copied from 20260804160000 (its latest
   definition). Changed only: a held order is not moved, unless the move is
   `decide_held_order`'s. */
create or replace function guard_order_fulfilment() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  /* `is distinct from` rather than `<>`: with no signed-in user this is null,
     and `null <> 'partner'` is null, which is not true, which means the early
     return never happens and a job with no persona is told it does not supply
     anything. */
  if current_persona() is distinct from 'partner' then
    return new;
  end if;

  if old.status = 'held'
     and (new.status is distinct from old.status
          or new.stage is distinct from old.stage
          or new.failed is distinct from old.failed)
     and coalesce(current_setting('aventa.risk_decision', true), '') <> 'on' then
    raise exception '% is not ready to be fulfilled yet. The marketplace will release it to you.', old.order_ref;
  end if;

  if not partner_supplies_order(new.id) then
    raise exception 'You supply nothing on %, so it is not yours to fulfil.', old.order_ref;
  end if;
  if not partner_alone_on_order(new.id) then
    raise exception '% carries another seller''s lines as well as yours. Marking the whole order would speak for them too — the marketplace moves a shared order on when every seller has.',
      old.order_ref;
  end if;

  if new.total is distinct from old.total
     or new.subtotal is distinct from old.subtotal
     or new.tax is distinct from old.tax
     or new.discount is distinct from old.discount
     or new.currency is distinct from old.currency
     or new.market is distinct from old.market
     or new.tax_rate is distinct from old.tax_rate
     or new.buyer_name is distinct from old.buyer_name
     or new.buyer_email is distinct from old.buyer_email
     or new.shipping_address is distinct from old.shipping_address
     or new.account_id is distinct from old.account_id
     or new.user_id is distinct from old.user_id
     or new.order_ref is distinct from old.order_ref
     or new.stages is distinct from old.stages
     or new.payment_method is distinct from old.payment_method
     or new.requisition_id is distinct from old.requisition_id
     or new.invoice_id is distinct from old.invoice_id
  then
    raise exception 'Only how far % has got is yours to change. The money and the buyer are what was agreed at checkout.',
      old.order_ref;
  end if;

  if new.stage < old.stage then
    raise exception '% is already at "%". A stage is not moved backwards — ask the marketplace, which records who did it and why.',
      old.order_ref, old.stages[old.stage + 1];
  end if;
  if new.stage > array_length(new.stages, 1) - 1 then
    raise exception '% has % stages and cannot go past the last of them.',
      old.order_ref, array_length(new.stages, 1);
  end if;

  if new.failed and not old.failed and coalesce(trim(new.failed_reason), '') = '' then
    raise exception 'Say what went wrong with %. "Failed" on its own cannot be acted on by anybody.', old.order_ref;
  end if;

  return new;
end $$;

/* `guard_operator_order_edit`, copied from 20260807500000 (its latest
   definition). Changed only: the same. */
create or replace function public.guard_operator_order_edit()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if current_persona() is distinct from 'operator' then return new; end if;

  if old.status = 'held'
     and (new.status is distinct from old.status
          or new.stage is distinct from old.stage
          or new.failed is distinct from old.failed)
     and coalesce(current_setting('aventa.risk_decision', true), '') <> 'on' then
    raise exception '% is held for a fraud review. Release it or cancel it on the Risk screen; nothing else moves it.', old.order_ref;
  end if;

  if new.total is distinct from old.total
     or new.subtotal is distinct from old.subtotal
     or new.tax is distinct from old.tax
     or new.tax_rate is distinct from old.tax_rate
     or new.discount is distinct from old.discount
     or new.currency is distinct from old.currency
     or new.market is distinct from old.market
     or new.buyer_name is distinct from old.buyer_name
     or new.buyer_email is distinct from old.buyer_email
     or new.user_id is distinct from old.user_id
     or new.account_id is distinct from old.account_id
     or new.order_ref is distinct from old.order_ref
     or new.invoice_id is distinct from old.invoice_id
     or new.requisition_id is distinct from old.requisition_id
     or new.payment_method is distinct from old.payment_method
     or new.payment_ref is distinct from old.payment_ref
  then
    raise exception
      'The marketplace moves % along; it does not rewrite what it cost or who bought it. Those were agreed at checkout and a refund is the way to change them.',
      old.order_ref;
  end if;

  /* Failing an order without saying why leaves a customer with a dead order and
     support with nothing to tell them. */
  if new.failed and not old.failed and coalesce(trim(new.failed_reason), '') = '' then
    raise exception 'Say what went wrong with %. "Failed" on its own cannot be acted on by anybody.', old.order_ref;
  end if;

  return new;
end $$;

/* For everybody, the seller and the operator included:
     - an order becomes `held` only through its payment's score (settle sets
       the session flag around that one update), never by a direct write, or a
       buyer could re-hold a fraud-cancelled order and have it released;
     - an order the marketplace cancelled after a fraud review keeps its
       status for anyone but the operator, or a buyer could move a refunded
       order back to placed and have it shipped.
   And for everybody else (a buyer, the schedule, a data fix), the refusal the
   seller and operator guards above make for a held order, with its total
   frozen too. */
create or replace function public.guard_held_order()
returns trigger language plpgsql security definer set search_path = public as $$
<<gh>>
declare
  v_flag text := coalesce(current_setting('aventa.risk_decision', true), '');
begin
  if new.status = 'held' and old.status is distinct from 'held' and v_flag <> 'on' then
    raise exception '% cannot be put on hold by hand. An order is held only by the check made when it is paid for.',
      old.order_ref;
  end if;

  if new.status is distinct from old.status
     and public.current_persona() is distinct from 'operator'
     and v_flag <> 'on'
     and exists (select 1 from public.order_risk r where r.order_id = old.id and r.decision = 'cancelled') then
    raise exception '% was cancelled by the marketplace and stays cancelled.', old.order_ref;
  end if;

  if public.current_persona() in ('partner', 'operator') then return new; end if;

  if old.status = 'held'
     and (new.status is distinct from old.status
          or new.stage is distinct from old.stage
          or new.failed is distinct from old.failed
          or new.total is distinct from old.total)
     and v_flag <> 'on' then
    raise exception '% is being checked by the marketplace, so it cannot be moved until that check is done.',
      old.order_ref;
  end if;
  return new;
end $$;

revoke all on function public.guard_held_order() from public, anon, authenticated;

drop trigger if exists z_guard_held_order on public.orders;
create trigger z_guard_held_order before update on public.orders
  for each row execute function public.guard_held_order();

/* ========================================== 7. deciding a held order === */

/* Release: back to `placed`, and the seller sees it. Cancel: `cancelled`;
   the order's pushes to the order manager are cancelled and its monthly
   parts stopped (as a failed payment's are: never charged, deleted; charged,
   cancelled with auto-renew off); and one approved refund per line, paid
   from the Refunds screen like any other. The refunds share out what the
   order was paid (its total, frozen while held) by the lines' weight, the
   last line taking the rounding, so they sum to the total exactly whatever
   the lines say now: a buyer can edit their own lines. Both need a note, and
   an order is decided once. The session flag lets the guards pass this
   move, and only this one. */
create or replace function public.decide_held_order(p_order_ref text, p_decision text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
<<dh>>
declare
  o         public.orders%rowtype;
  v_note    text := nullif(trim(coalesce(p_note, '')), '');
  v_by      text;
  v_n       integer := 0;
  v_total   numeric := 0;
  v_status  text;
  v_prior   text;
  l         record;
  v_weight  numeric;
  v_lines   integer;
  v_left    numeric;
  v_k       integer := 0;
  v_amt     numeric;
  v_com     integer := 0;
  v_subs    integer := 0;
begin
  if public.current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace decides a held order.';
  end if;
  if p_decision is null or p_decision not in ('release', 'cancel') then
    raise exception 'A held order is released or cancelled, not %.', coalesce(p_decision, 'left undecided');
  end if;
  if v_note is null then
    raise exception 'Say why. A decision on a held order needs a note.';
  end if;

  select * into o from public.orders x where x.order_ref = p_order_ref for update;
  if not found then
    raise exception 'There is no order %.', coalesce(p_order_ref, '(no reference)');
  end if;
  if o.status is distinct from 'held' then
    raise exception '% is not held (it is %), so there is nothing to decide.', o.order_ref, coalesce(o.status, 'without a status');
  end if;
  select r.decision into v_prior from public.order_risk r where r.order_id = o.id;
  if v_prior is not null then
    raise exception '% was already % by the marketplace. A held order is decided once.', o.order_ref, v_prior;
  end if;

  v_by := public.risk_operator_name();

  perform set_config('aventa.risk_decision', 'on', true);
  if p_decision = 'release' then
    update public.orders x set status = 'placed' where x.id = o.id;
    v_status := 'placed';
  else
    update public.orders x set status = 'cancelled' where x.id = o.id;
    v_status := 'cancelled';

    /* Nothing more goes to the network for it. */
    with stopped as (
      update public.com_order c
         set state = 'cancelled', next_attempt_at = null,
             note = 'Cancelled by the marketplace after a fraud review.'
       where c.order_ref = o.order_ref and c.state not in ('completed', 'cancelled')
      returning c.id
    )
    insert into public.com_event (id, com_order, kind, state, detail)
    select s.id || '-FR', s.id, 'state-change', 'cancelled', 'Cancelled by the marketplace after a fraud review.'
      from stopped s
    on conflict (id) do nothing;
    get diagnostics v_com = row_count;

    /* Nor is anything renewed for it. */
    delete from public.subscriptions sb
     where sb.ref = o.order_ref
       and sb.user_id is not distinct from o.user_id
       and not exists (select 1 from public.subscription_charge sc where sc.subscription_id = sb.id);
    get diagnostics v_subs = row_count;
    update public.subscriptions sb
       set status = 'cancelled', auto_renew = false
     where sb.ref = o.order_ref
       and sb.user_id is not distinct from o.user_id
       and sb.status = 'active';

    /* What was paid, shared out by the lines' weight. */
    select coalesce(sum(i.price * i.quantity), 0), count(*) into v_weight, v_lines
      from public.order_items i
     where i.order_id = o.id and i.price * i.quantity > 0;
    v_left := round(coalesce(o.total, 0), 2);

    for l in
      select i.product_id, i.product_name, p.category_id, p.partner_id,
             coalesce(p.seller, 'Aventa Telecom') as seller,
             i.price * i.quantity as weight
        from public.order_items i
        left join public.products p on p.id = i.product_id
       where i.order_id = o.id and i.price * i.quantity > 0
       order by i.product_id, i.id
    loop
      v_k := v_k + 1;
      if v_k = v_lines then
        v_amt := v_left;
      else
        v_amt := least(round(round(coalesce(o.total, 0), 2) * l.weight / v_weight, 2), v_left);
      end if;
      continue when v_amt <= 0;

      insert into public.refunds
        (id, order_ref, product_id, item, category_id, partner_id, seller, first_party,
         customer, buyer_type, user_id, amount, currency, reason, detail,
         requested, decider, sla_due, state, decided_on, decided_by, decision_note)
      values
        (format('RFN-FR-%s-%s', regexp_replace(o.order_ref, '^ORD-', ''), v_k),
         o.order_ref, l.product_id, l.product_name, l.category_id, l.partner_id, l.seller,
         l.partner_id is null,
         coalesce(nullif(trim(o.buyer_name), ''), 'Customer'), 'consumer', o.user_id, v_amt, o.currency,
         'cancelled', 'Cancelled by the marketplace after a fraud review.',
         current_date, 'marketplace', current_date, 'approved', current_date, v_by, 'Cancelled after a fraud review: ' || v_note);
      v_n := v_n + 1;
      v_left := v_left - v_amt;
    end loop;

    select coalesce(sum(f.amount), 0) into v_total
      from public.refunds f where f.order_ref = o.order_ref and f.id like 'RFN-FR-%';
  end if;
  perform set_config('aventa.risk_decision', 'off', true);

  insert into public.order_risk as r (order_id, score, band, reasons, scored_at, decision, decided_by, decided_at, note)
  values (o.id, 0, 'hold', '[]'::jsonb, now(),
          case when p_decision = 'release' then 'released' else 'cancelled' end, v_by, now(), v_note)
  on conflict (order_id) do update
    set decision = excluded.decision, decided_by = excluded.decided_by,
        decided_at = excluded.decided_at, note = excluded.note;

  return jsonb_build_object('order_ref', o.order_ref, 'status', v_status,
                            'refunds', v_n, 'refunded', v_total, 'currency', o.currency,
                            'pushes_cancelled', v_com, 'subscriptions_removed', v_subs);
end $$;

comment on function public.decide_held_order(text, text, text) is
  'The operator releases a held order (placed) or cancels it (cancelled, one approved refund per line). A note is required.';

revoke all on function public.decide_held_order(text, text, text) from public, anon;
grant execute on function public.decide_held_order(text, text, text) to authenticated;

/* ============================= 7b. not provisioned while held or cancelled === */

/* A line the network fulfils is queued as it is written, before the payment
   settles, so a held order's eSIM is already waiting at the order manager's
   door. `com_send`, copied from 20260807480000 (its latest definition).
   Changed only: nothing is sent for an order that is held or cancelled. Same
   signature, so the grant is unchanged. */
create or replace function public.com_send(p_id text, p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  c    public.com_order;
  sys  public.com_system;
  gaps text[];
  body jsonb;
  wait int;
begin
  select * into c from public.com_order where id = p_id;
  if c.id is null then return jsonb_build_object('ok', false, 'why', 'No such push.'); end if;
  if c.state in ('completed', 'cancelled') then
    return jsonb_build_object('ok', true, 'state', c.state, 'already', true);
  end if;
  if exists (select 1 from public.orders o where o.order_ref = c.order_ref and o.status in ('held', 'cancelled')) then
    return jsonb_build_object('ok', false, 'state', c.state, 'why',
      'The order is held or cancelled by the marketplace, so nothing is sent to the order manager for it.');
  end if;

  select * into sys from public.com_system where id = c.system_id;

  /* A required characteristic that resolved to nothing will resolve to nothing
     on the next attempt too. Retrying it spends the budget and buries the
     reason under four identical timeouts. */
  gaps := public.com_missing(c.order_item_id);
  if array_length(gaps, 1) > 0 then
    update public.com_order set
      state = 'rejected', attempts = attempts + 1, last_attempt_at = p_now,
      next_attempt_at = null,
      failure_code = 'TMF-400',
      failure_reason = format('%s rejected the order: %s could not be supplied. This is not retried — the field will be empty next time too.',
                              sys.name, array_to_string(gaps, '; '))
     where id = p_id;
    insert into public.com_event (id, com_order, kind, state, detail)
    values (format('%s-R%s', p_id, c.attempts + 1), p_id, 'rejected', 'rejected',
            array_to_string(gaps, '; '));
    return jsonb_build_object('ok', false, 'state', 'rejected', 'missing', gaps);
  end if;

  body := public.com_payload(c.order_item_id);

  /* Transport. This is the failure retries exist for. */
  if sys.status = 'down' then
    wait := sys.backoff_seconds * power(2, least(c.attempts, 6))::int;
    if c.attempts + 1 >= sys.max_attempts then
      update public.com_order set
        state = 'failed', attempts = attempts + 1, last_attempt_at = p_now, next_attempt_at = null,
        payload = body, failure_code = 'TRANSPORT',
        failure_reason = format('%s did not answer on any of %s attempts. The order is not provisioned and needs a human.',
                                sys.name, sys.max_attempts)
       where id = p_id;
      insert into public.com_event (id, com_order, kind, state, detail)
      values (format('%s-F%s', p_id, c.attempts + 1), p_id, 'failed', 'failed',
              format('Given up after %s attempts.', sys.max_attempts));
      return jsonb_build_object('ok', false, 'state', 'failed');
    end if;
    update public.com_order set
      attempts = attempts + 1, last_attempt_at = p_now,
      next_attempt_at = p_now + make_interval(secs => wait),
      payload = body, failure_code = 'TRANSPORT',
      failure_reason = format('%s is not answering. Retrying in %s seconds.', sys.name, wait)
     where id = p_id;
    insert into public.com_event (id, com_order, kind, state, detail)
    values (format('%s-T%s', p_id, c.attempts + 1), p_id, 'retry', 'queued',
            format('No answer. Attempt %s of %s; next in %ss.', c.attempts + 1, sys.max_attempts, wait));
    return jsonb_build_object('ok', false, 'state', 'queued', 'retry_in', wait);
  end if;

  /* Accepted. Note what this is not: the service is not on yet. */
  update public.com_order set
    state = 'acknowledged', attempts = attempts + 1, last_attempt_at = p_now,
    next_attempt_at = null, sent_at = coalesce(sent_at, p_now), acknowledged_at = p_now,
    payload = body,
    com_order_id = 'PO-' || upper(substr(md5(p_id), 1, 10)),
    failure_code = null, failure_reason = null
   where id = p_id;

  insert into public.com_event (id, com_order, kind, state, detail, payload)
  values (format('%s-A%s', p_id, c.attempts + 1), p_id, 'acknowledged', 'acknowledged',
          format('%s accepted the order.', sys.name), body)
  on conflict (id) do nothing;

  return jsonb_build_object('ok', true, 'state', 'acknowledged',
                            'com_order_id', 'PO-' || upper(substr(md5(p_id), 1, 10)));
end $$;

/* `com_retry`, copied from 20260807480000 (its latest definition). Changed
   only: a held or cancelled order's pushes are not retried. */
create or replace function public.com_retry(p_now timestamptz default now())
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare c record; tried int := 0; ok int := 0; res jsonb;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace retries a push to the order manager.';
  end if;
  for c in
    select id from public.com_order
     where state = 'queued' and coalesce(next_attempt_at, p_now) <= p_now
       and not exists (select 1 from public.orders o
                        where o.order_ref = com_order.order_ref and o.status in ('held', 'cancelled'))
     order by created_at
  loop
    res := public.com_send(c.id, p_now);
    tried := tried + 1;
    if (res ->> 'ok')::boolean then ok := ok + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'tried', tried, 'accepted', ok);
end $$;

/* =================================================== 8. tuning rules === */

/* The checks `ruleEditProblem` and `bandsProblem` make on the screen
   (src/lib/risk.ts), made again here. */
create or replace function public.update_risk_rule(
  p_id text, p_points integer, p_enabled boolean, p_threshold numeric
) returns jsonb language plpgsql security definer set search_path = public as $$
<<ur>>
declare
  r        public.risk_rules%rowtype;
  v_by     text;
  v_thr    numeric;
  v_n      integer := 0;
begin
  if public.current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace tunes the risk rules.';
  end if;
  select * into r from public.risk_rules x where x.id = p_id for update;
  if not found then
    raise exception 'There is no risk rule %.', coalesce(p_id, '(no id)');
  end if;
  if p_points is null then
    raise exception 'Points must be a whole number.';
  end if;
  if p_points < -50 or p_points > 100 then
    raise exception 'Points must be between −50 and 100.';
  end if;
  if p_enabled is null then
    raise exception 'Say whether the rule is on or off.';
  end if;
  /* A rule without a threshold keeps none. */
  if r.threshold is null then
    v_thr := null;
  else
    if p_threshold is null or p_threshold::text in ('NaN', 'Infinity', '-Infinity') or p_threshold <= 0 then
      raise exception 'This rule needs a threshold above zero.';
    end if;
    v_thr := p_threshold;
  end if;

  v_by := public.risk_operator_name();

  if r.points is distinct from p_points then
    insert into public.risk_rule_changes (rule_id, field, was, now, by_name)
    values (r.id, 'points', r.points::text, p_points::text, v_by);
    v_n := v_n + 1;
  end if;
  if r.enabled is distinct from p_enabled then
    insert into public.risk_rule_changes (rule_id, field, was, now, by_name)
    values (r.id, 'enabled', r.enabled::text, p_enabled::text, v_by);
    v_n := v_n + 1;
  end if;
  if r.threshold is distinct from v_thr then
    insert into public.risk_rule_changes (rule_id, field, was, now, by_name)
    values (r.id, 'threshold', r.threshold::text, v_thr::text, v_by);
    v_n := v_n + 1;
  end if;

  if v_n > 0 then
    update public.risk_rules x
       set points = p_points, enabled = p_enabled, threshold = v_thr,
           updated_at = now(), updated_by = v_by
     where x.id = r.id;
  end if;

  return jsonb_build_object('id', r.id, 'changed', v_n);
end $$;

revoke all on function public.update_risk_rule(text, integer, boolean, numeric) from public, anon;
grant execute on function public.update_risk_rule(text, integer, boolean, numeric) to authenticated;

create or replace function public.set_risk_bands(p_kind text, p_review_at integer, p_hold_at integer)
returns jsonb language plpgsql security definer set search_path = public as $$
<<sb>>
declare
  s        public.risk_settings%rowtype;
  v_by     text;
  v_n      integer := 0;
begin
  if public.current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace sets the risk bands.';
  end if;
  if p_kind is null or p_kind not in ('order', 'account') then
    raise exception 'Bands are set for orders or for accounts, not %.', coalesce(p_kind, 'nothing');
  end if;
  if p_review_at is null or p_hold_at is null
     or p_review_at < 1 or p_review_at > 100 or p_hold_at < 1 or p_hold_at > 100 then
    raise exception 'Both thresholds must be whole numbers from 1 to 100.';
  end if;
  if p_review_at >= p_hold_at then
    raise exception 'The review threshold must be below the hold threshold.';
  end if;

  v_by := public.risk_operator_name();
  select * into s from public.risk_settings x where x.kind = p_kind for update;

  if s.review_at is distinct from p_review_at then
    insert into public.risk_rule_changes (rule_id, field, was, now, by_name)
    values (p_kind || '-bands', 'review_at', s.review_at::text, p_review_at::text, v_by);
    v_n := v_n + 1;
  end if;
  if s.hold_at is distinct from p_hold_at then
    insert into public.risk_rule_changes (rule_id, field, was, now, by_name)
    values (p_kind || '-bands', 'hold_at', s.hold_at::text, p_hold_at::text, v_by);
    v_n := v_n + 1;
  end if;

  insert into public.risk_settings as x (kind, review_at, hold_at)
  values (p_kind, p_review_at, p_hold_at)
  on conflict (kind) do update set review_at = excluded.review_at, hold_at = excluded.hold_at;

  return jsonb_build_object('kind', p_kind, 'review_at', p_review_at, 'hold_at', p_hold_at, 'changed', v_n);
end $$;

revoke all on function public.set_risk_bands(text, integer, integer) from public, anon;
grant execute on function public.set_risk_bands(text, integer, integer) to authenticated;

/* ======================================================== 9. the night === */

/* `run_nightly`, copied from 20261113400000 (its latest definition). Changed
   only: the `risk` job, after `invoices` and before `settlements`, so ten. */
create or replace function public.run_nightly(p_as_of date default current_date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  j    text;
  res  jsonb;
  err  text;
  t0   timestamptz;
  outs jsonb := '[]'::jsonb;
begin
  if public.current_persona() is distinct from 'operator' and not public.is_scheduler() then
    raise exception 'Only the schedule, or the marketplace, runs the night.';
  end if;

  foreach j in array array['agreements', 'enterprise subscriptions', 'subscriptions', 'documents', 'payments', 'bundle selections', 'baskets', 'invoices', 'risk', 'settlements'] loop
    t0 := clock_timestamp(); res := null; err := null;
    begin
      res := case j
        when 'agreements'               then public.auto_renew_contracts(p_as_of, 'Nightly schedule')
        when 'enterprise subscriptions' then public.renew_enterprise_subscriptions(p_as_of, 'Nightly schedule')
        when 'subscriptions'            then public.renew_subscriptions(p_as_of, 'Nightly schedule')
        when 'documents'                then public.lapse_expired_documents(p_as_of)
        when 'payments'                 then jsonb_build_object('expired', public.expire_stale_payments())
        when 'bundle selections'        then public.delete_unused_bundle_selections(p_as_of)
        when 'baskets'                  then public.run_baskets_night(p_as_of)
        when 'invoices'                 then public.bill_account_orders(p_as_of)
        when 'risk'                     then public.refresh_account_risk(p_as_of)
        when 'settlements'              then public.settle_to_date(p_as_of)
      end;
    exception when others then
      err := format('%s (%s)', sqlerrm, sqlstate);
    end;
    insert into public.scheduled_job_log (job, ran_on, started_at, finished_at, ok, result, error)
    values (j, p_as_of, t0, clock_timestamp(), err is null, res, err);
    outs := outs || jsonb_build_object('job', j, 'ok', err is null, 'error', err);
  end loop;

  return jsonb_build_object('ran_on', p_as_of, 'jobs', outs);
end $$;

revoke all on function public.run_nightly(date) from public, anon, authenticated;

/* ================================================================= help === */

/* The operator's Risk screen (`op-risk`), seeded the way 20261113200000
   seeds `op-baskets`: the next KB-O number, once. And the Scheduled jobs
   article told about the tenth job, once. */
do $$
declare
  v_op text;
  n_op int;
begin
  select coalesce(max(substring(id from '^KB-O(\d+)$')::int), 0) + 1 into n_op
    from kb_articles where id ~ '^KB-O\d+$';
  v_op := 'KB-O' || lpad(n_op::text, 2, '0');

  if not exists (select 1 from kb_articles where view = 'op-risk') then
    insert into kb_articles
      (id, persona, kind, title, mins, updated, view, roles, tags, summary,
       body, status, sort_order, personas, audience_note, audience_ids)
    values (
      v_op, 'operator', 'howto', 'Risk', 5, to_char(current_date, 'DD Mon YYYY'), 'op-risk',
      array['OR-ADMIN', 'OR-FIN', 'OR-SUPPORT'], array['risk', 'fraud', 'held orders', 'rules'],
      'Which orders are held for a fraud review, which accounts look risky, and the rules that decide both.',
      jsonb_build_array(
        jsonb_build_object('kind', 'prose', 'heading', 'What this screen shows',
          'text', 'Every shopper order is scored when its payment goes through, and every shopper and business account is scored each night. A score is the sum of the points of the rules that fired, and every score lists those rules. Orders scoring 40 or more are flagged for review; 70 or more are held. Accounts scoring 40 or more are in review; 70 or more are high risk. Business orders are never held: approvals and the credit hold already gate them, but their account''s score is shown.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Held orders',
          'text', 'A held order has been paid for, but its seller cannot see it and nothing can move it. The buyer is told only "We''re checking this order — usually within a few hours." Release puts it back to placed and the seller sees it as a new order. Cancel and refund cancels it, stops anything still to be sent to the network for it and any monthly part from renewing, and raises one approved refund per line, together what the order was paid, which is paid from the Refunds screen like any other. Both need a note, which is kept with the decision, and an order is decided once. The note on a cancel is also written on each refund after "Cancelled after a fraud review:", and the buyer and the seller both read it there, so write it for them: never name a rule or a score.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Flagged orders and accounts',
          'text', 'Flagged lists the orders in the review band from the last 30 days: they went through, and are worth a look. Accounts lists every account by score with the rules that fired; Rescore now scores them all again straight away instead of waiting for the night.'),
        jsonb_build_object('kind', 'prose', 'heading', 'Rules and bands',
          'text', 'Each rule has points (from −50 to 100), an on/off switch, and, where it counts something, a threshold: the age of a new account in days, how many times the usual order, how many failed payments or orders, the dollar amount for carrier billing or EMI, or the most points a rule that counts each refund or failed payment may add. The bands are two whole numbers from 1 to 100, review below hold. A rule that is off never fires, and a rule with nothing to go on does not fire. Every change is listed with who made it and when.'),
        jsonb_build_object('kind', 'prose', 'heading', 'What nobody else sees',
          'text', 'Scores and rules are for the marketplace only. A buyer or a seller never sees a score or a rule, because telling a fraudster which rule fired teaches them how to get round it.')
      ),
      'published', n_op, array['operator'], '', array[]::text[]);
  end if;

  update kb_articles
     set body = jsonb_set(
                  jsonb_set(body, '{0,text}', to_jsonb('Every night at 00:30 UTC (06:00 in India, 03:30 in Kenya) the marketplace runs ten jobs, one after the other. Each one is listed here for each night: whether it finished OK or failed, a short summary of what it did, and the error in full when it failed. A job that fails changes nothing, and the jobs after it still run.'::text)),
                  '{1}', jsonb_build_object('kind', 'prose', 'heading', 'The ten jobs',
                    'text', 'Agreements: an agreement with auto-renew on whose notice deadline has passed is renewed for a like term. Enterprise subscriptions: a business subscription renews for a year on its date, or ends there if auto-renew is off or it is suspended. Subscriptions: a shopper subscription the marketplace sells is charged for the cycle that starts and its date moves on; a bundle part keeps the bundle price for 12 months, then the published price. Documents: a seller document past its expiry stops counting as accepted. Payments: a payment nobody answered for 15 minutes expires, and the unpaid orders behind it are removed. Bundle selections: a priced bundle whose hold ended more than 7 days ago and that is on no basket, requisition or order is deleted. Baskets: every basket line is checked against stock again and flagged where it no longer fits, and baskets nobody has touched for 90 days are cleared. Invoices: on the 1st, each business account is invoiced for last month''s delivered orders, one line per order line with the requisition it came from. Risk: every shopper and business account is scored again from its refunds, disputes, failed payments and bursts of orders (and, for a business, its credit limit and overdue invoices); the scores are on the Risk screen. Settlements: every closed period not yet settled is settled, oldest first.')),
         updated = to_char(current_date, 'DD Mon YYYY')
   where view = 'op-jobs'
     and jsonb_typeof(body) = 'array' and jsonb_array_length(body) >= 3
     and body::text not like '%Risk: every%';
end $$;

/* ============================================================ self-check === */

do $$
<<chk>>
declare
  dry       jsonb;
  j         jsonb;
  v_t       text;
  v_sig     text;
  v_n       integer;
  v_res     jsonb;
  v_rules   text;
  v_user    uuid;
  v_cur     text;
  v_mkt     text;
  v_taxr    numeric;
  v_addr    jsonb;
  v_median  numeric;
  v_op      uuid;
  v_seller  uuid;
  v_sim     record;
  v_dev     record;
  v_low     uuid := gen_random_uuid();
  v_review  uuid := gen_random_uuid();
  v_hold    uuid := gen_random_uuid();
  v_cancel  uuid := gen_random_uuid();
  v_big     numeric;
  v_small   numeric;
  v_sum     numeric;
  v_settle  text := 'public.settle_payment_attempt(text,text,text,text,text,integer,numeric,text)';
  v_sys     text;
  v_com     text;
  v_line    uuid;
  v_subp    record;
begin
  if not public.is_scheduler() then
    raise exception 'This session (%) is not one the schedule runs as, so the dry run below would be refused.', session_user;
  end if;

  /* The tables: there, behind row-level security, read by the operator,
     written by nobody but the functions. */
  foreach v_t in array array['risk_rules', 'risk_settings', 'order_risk', 'account_risk', 'risk_rule_changes'] loop
    if to_regclass('public.' || v_t) is null then raise exception 'public.% is missing', v_t; end if;
    if not (select c.relrowsecurity from pg_class c where c.oid = to_regclass('public.' || v_t)) then
      raise exception 'public.% has row-level security off', v_t;
    end if;
    if not exists (select 1 from pg_policies p
                    where p.schemaname = 'public' and p.tablename = v_t
                      and p.cmd = 'SELECT' and p.qual like '%operator%') then
      raise exception 'public.% has no operator read policy', v_t;
    end if;
    if exists (select 1 from pg_policies p
                where p.schemaname = 'public' and p.tablename = v_t and p.cmd <> 'SELECT') then
      raise exception 'public.% has a write policy', v_t;
    end if;
  end loop;

  select count(*) into v_n from public.risk_rules;
  if v_n < 17 then raise exception 'only % of the 17 risk rules are seeded', v_n; end if;
  select count(*) into v_n from public.risk_settings;
  if v_n <> 2 then raise exception 'risk_settings has % rows, not 2', v_n; end if;

  /* Who may call what: the scoring is the database's own; the Risk screen
     calls four functions, and the seller policies one. */
  foreach v_sig in array array[
      'public.score_order(uuid)', 'public.score_account(text,text)', 'public.score_account_on(text,text,date)',
      'public.risk_operator_name()', 'public.guard_held_order()', 'public.run_nightly(date)'] loop
    if to_regprocedure(v_sig) is null then raise exception '% is missing', v_sig; end if;
    if has_function_privilege('anon', v_sig, 'execute')
       or has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '% is callable through the API', v_sig;
    end if;
  end loop;
  foreach v_sig in array array[
      'public.decide_held_order(text,text,text)', 'public.update_risk_rule(text,integer,boolean,numeric)',
      'public.set_risk_bands(text,integer,integer)', 'public.refresh_account_risk(date)',
      'public.order_is_held(uuid)'] loop
    if to_regprocedure(v_sig) is null then raise exception '% is missing', v_sig; end if;
    if not has_function_privilege('authenticated', v_sig, 'execute') then
      raise exception '% is not callable by a signed-in user', v_sig;
    end if;
    if has_function_privilege('anon', v_sig, 'execute') then
      raise exception '% is callable without signing in', v_sig;
    end if;
  end loop;

  select count(*) into v_n from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'settle_payment_attempt';
  if v_n <> 1 then raise exception 'there are % settle_payment_attempt functions', v_n; end if;
  if not has_function_privilege('authenticated', v_settle, 'execute') then
    raise exception 'settle_payment_attempt is no longer callable by a signed-in customer';
  end if;
  if pg_get_functiondef(v_settle::regprocedure) not like '%public.score_order(v_o.id)%' then
    raise exception 'settle_payment_attempt does not score the orders it places';
  end if;
  if pg_get_functiondef(v_settle::regprocedure) not like '%A bundle was not bought whole, so nothing was charged.%' then
    raise exception 'settle_payment_attempt lost its bundle check';
  end if;
  foreach v_sig in array array['public.guard_order_fulfilment()', 'public.guard_operator_order_edit()',
                               'public.guard_held_order()'] loop
    if pg_get_functiondef(v_sig::regprocedure) not like '%aventa.risk_decision%' then
      raise exception '% does not freeze a held order', v_sig;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger
                  where tgrelid = 'public.orders'::regclass and tgname = 'z_guard_held_order' and not tgisinternal) then
    raise exception 'z_guard_held_order is not on orders';
  end if;
  if coalesce((select p.qual from pg_policies p where p.schemaname = 'public' and p.tablename = 'orders'
                  and p.policyname = 'partner_read_own_orders'), '') not like '%held%' then
    raise exception 'partner_read_own_orders still shows a held order';
  end if;
  if coalesce((select p.qual from pg_policies p where p.schemaname = 'public' and p.tablename = 'order_items'
                  and p.policyname = 'partner_read_own_order_items'), '') not like '%order_is_held%' then
    raise exception 'partner_read_own_order_items still shows a held order''s lines';
  end if;
  if coalesce((select p.qual from pg_policies p where p.schemaname = 'public' and p.tablename = 'order_part'
                  and p.policyname = 'partner_read_order_part'), '') not like '%order_is_held%' then
    raise exception 'partner_read_order_part still shows a held order''s parts';
  end if;

  /* The help for the new screen, and the night's tenth job. */
  select count(*) into v_n from kb_articles
   where view = 'op-risk' and 'operator' = any(personas) and status = 'published';
  if v_n <> 1 then raise exception 'the Risk screen has % help articles, not 1', v_n; end if;
  if exists (select 1 from kb_articles where view = 'op-jobs' and body::text not like '%Risk: every%') then
    raise exception 'the Scheduled jobs article does not mention the risk job';
  end if;

  /* Rolled back, all of it: three hand-made orders scored low, review and
     hold; a payment that places the low one and holds the hold one; the
     seller blind to it; the guards; release and cancel; a rule and the bands
     tuned; the accounts rescored. */
  begin
    /* The seeded order rules and bands, whatever has been tuned since. */
    update public.risk_rules r
       set points = s.points, enabled = true, threshold = s.threshold
      from (values ('o-account-review', 15, null::numeric), ('o-account-high', 30, null),
                   ('o-new-account', 20, 7), ('o-first-order', 10, null), ('o-big-order', 25, 3),
                   ('o-sim-line', 15, null), ('o-sim-new-address', 30, null), ('o-guest', 15, null),
                   ('o-failed-payments', 25, 2), ('o-burst', 20, 3), ('o-carrier-emi', 10, 200))
           as s(id, points, threshold)
     where r.id = s.id;
    update public.risk_settings set review_at = 40, hold_at = 70;

    select p.id, p.name, p.partner_id into v_sim
      from public.products p
     where p.fulfil = 'esim'
     order by (p.partner_id is null), p.id
     limit 1;
    if not found then raise exception 'no eSIM product to check a SIM line with'; end if;

    select p.id, p.name, p.partner_id, pr.id as seller_uid into v_dev
      from public.products p
      join public.profiles pr on pr.persona = 'partner' and pr.partner_id = p.partner_id
      left join public.categories c on c.id = p.category_id
     where p.fulfil = 'shipped'
       and concat_ws(' ', c.id, c.name, p.sub_category, p.name) !~* '\m(e-?)?sims?\M'
     order by p.id, pr.id
     limit 1;
    if not found then raise exception 'no seller''s shipped product to check a held order is hidden with'; end if;
    v_seller := v_dev.seller_uid;

    select pr.id into v_op
      from public.profiles pr join auth.users u on u.id = pr.id
     where pr.persona = 'operator'
     order by (lower(u.email) = 'anika.sharma@aventa.com') desc, pr.id
     limit 1;
    if v_op is null then raise exception 'no operator to decide a held order as'; end if;

    /* A shopper with history, in a market and currency the guards accept,
       and nothing in the last hour or day to make an ordinary order look
       odd. */
    select o.user_id, o.currency, o.market, o.tax_rate, o.shipping_address
      into v_user, v_cur, v_mkt, v_taxr, v_addr
      from public.orders o
      join public.profiles pr on pr.id = o.user_id and pr.persona = 'consumer'
     where o.account_id is null and o.total > 0 and o.shipping_address is not null
       and o.status not in ('awaiting_payment', 'cancelled', 'failed', 'held')
       and o.created_at < now() - interval '1 hour'
       and not exists (select 1 from public.consumer_profile cp
                        where cp.user_id = o.user_id and cp.market is distinct from o.market)
       and public.market_takes(o.market, o.currency)
       and not exists (select 1 from public.payment_attempts pa
                        where pa.user_id = o.user_id and pa.state = 'failed'
                          and coalesce(pa.decided_at, pa.started_at) > now() - interval '24 hours')
       and not exists (select 1 from public.orders o2
                        where o2.user_id = o.user_id and o2.created_at > now() - interval '1 hour')
     order by o.created_at desc
     limit 1;
    if v_user is null then raise exception 'no shopper with an order on file to check order scoring with'; end if;
    delete from public.account_risk ar where ar.kind = 'shopper' and ar.id = v_user::text;

    select percentile_cont(0.5) within group (order by e.total) into v_median
      from public.orders e
     where e.user_id = v_user and e.account_id is null and e.currency = v_cur
       and e.status not in ('awaiting_payment', 'cancelled', 'failed');
    v_big := round(coalesce(v_median, 0) * 3 + 100, 2);
    v_small := greatest(round(coalesce(v_median, 0), 2), 0.01);

    insert into public.orders
      (id, order_ref, status, total, subtotal, tax, discount, payment_method, buyer_name,
       created_at, placed_date, seller, vertical, failed, stage, stages,
       user_id, account_id, currency, market, tax_rate, shipping_address, payment_ref)
    values
      /* Low: the buyer's usual size, to an address they have used, a parcel. */
      (v_low, 'ORD-SELFCHECK-RISK-L', 'awaiting_payment', v_small, v_small, 0, 0, null, 'Self-check',
       now(), to_char(current_date, 'DD Mon YYYY'), null, 'device', false, 0,
       array['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered'],
       v_user, null, v_cur, v_mkt, v_taxr, v_addr, 'PAY-SELFCHECK-RISK'),
      /* Hold: three times the usual and more, an eSIM, to an address nobody
         has used: 25 + 15 + 30 = 70. */
      (v_hold, 'ORD-SELFCHECK-RISK-H', 'awaiting_payment', v_big, v_big, 0, 0, null, 'Self-check',
       now(), to_char(current_date, 'DD Mon YYYY'), null, 'device', false, 0,
       array['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered'],
       v_user, null, v_cur, v_mkt, v_taxr,
       jsonb_build_object('line1', 'Self-check, an address nobody has used', 'city', 'Nowhere'), 'PAY-SELFCHECK-RISK'),
      /* Review: a guest, an eSIM, 250 dollars on carrier billing:
         15 + 15 + 10 = 40. */
      (v_review, 'ORD-SELFCHECK-RISK-R', 'placed', 250, 250, 0, 0, 'carrier_billing', 'Self-check guest',
       now(), to_char(current_date, 'DD Mon YYYY'), null, 'device', false, 0,
       array['Ordered', 'Confirmed', 'Provisioning', 'Activating', 'Active'],
       null, null, 'USD', v_mkt, 0, jsonb_build_object('line1', 'Self-check guest'), null),
      /* Already held, to be cancelled: 30 x 2 and 15 x 1. */
      (v_cancel, 'ORD-SELFCHECK-RISK-C', 'held', 75, 75, 0, 0, 'card', 'Self-check',
       now(), to_char(current_date, 'DD Mon YYYY'), null, 'device', false, 0,
       array['Ordered', 'Confirmed', 'Dispatched', 'In transit', 'Delivered'],
       v_user, null, v_cur, v_mkt, v_taxr, v_addr, null);

    insert into public.order_items (id, order_id, product_id, product_name, price, quantity, fulfil, status) values
      (gen_random_uuid(), v_low,    v_dev.id, v_dev.name, v_small,   1, 'shipped', 'placed'),
      (gen_random_uuid(), v_hold,   v_sim.id, v_sim.name, v_big - 1, 1, 'esim',    'placed'),
      (gen_random_uuid(), v_hold,   v_dev.id, v_dev.name, 1,         1, 'shipped', 'placed'),
      (gen_random_uuid(), v_review, v_sim.id, v_sim.name, 250,       1, 'esim',    'placed'),
      (gen_random_uuid(), v_cancel, v_sim.id, v_sim.name, 30,        2, 'esim',    'placed'),
      (gen_random_uuid(), v_cancel, v_dev.id, v_dev.name, 15,        1, 'shipped', 'placed');

    /* Scored by hand. */
    v_res := public.score_order(v_low);
    if v_res ->> 'band' is distinct from 'low' then
      raise exception 'an ordinary order scored % (%)', v_res ->> 'band', v_res;
    end if;

    v_res := public.score_order(v_review);
    select string_agg(x.value ->> 'rule', ',' order by x.value ->> 'rule') into v_rules
      from jsonb_array_elements(v_res -> 'reasons') as x(value);
    if (v_res ->> 'score')::integer <> 40 or v_res ->> 'band' is distinct from 'review'
       or v_rules is distinct from 'o-carrier-emi,o-guest,o-sim-line' then
      raise exception 'a guest''s eSIM on carrier billing scored %', v_res;
    end if;

    v_res := public.score_order(v_hold);
    select string_agg(x.value ->> 'rule', ',' order by x.value ->> 'rule') into v_rules
      from jsonb_array_elements(v_res -> 'reasons') as x(value);
    if v_res ->> 'band' is distinct from 'hold'
       or v_rules not like '%o-big-order%' or v_rules not like '%o-sim-line%' or v_rules not like '%o-sim-new-address%' then
      raise exception 'a big eSIM order to a new address scored %', v_res;
    end if;

    /* Paid, as the shopper: the low order is placed, the hold order held. */
    insert into public.payment_attempts
      (id, reference, user_id, purpose, amount, currency, method_id, market_code, order_ref, state)
    values ('PA-SELFCHECK-RISK', 'PAY-SELFCHECK-RISK', v_user, 'order', v_small + v_big, v_cur, 'card', v_mkt,
            'ORD-SELFCHECK-RISK-H', 'initiated');

    perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
    v_res := public.settle_payment_attempt('PA-SELFCHECK-RISK', 'succeeded', 'Self-check card', 'SELFCHECK-GW');
    perform set_config('request.jwt.claims', null, true);

    if v_res ->> 'state' is distinct from 'succeeded' then
      raise exception 'the self-check payment did not settle: %', v_res;
    end if;
    if (v_res -> 'held') is distinct from '["ORD-SELFCHECK-RISK-H"]'::jsonb then
      raise exception 'the payment held %, not the hold order', v_res -> 'held';
    end if;
    if (select o.status from public.orders o where o.id = v_hold) is distinct from 'held' then
      raise exception 'the hold order is %, not held', (select o.status from public.orders o where o.id = v_hold);
    end if;
    if (select o.status from public.orders o where o.id = v_low) is distinct from 'placed' then
      raise exception 'the low order is %, not placed', (select o.status from public.orders o where o.id = v_low);
    end if;
    if (select r.band from public.order_risk r where r.order_id = v_low) is distinct from 'low'
       or (select r.band from public.order_risk r where r.order_id = v_hold) is distinct from 'hold' then
      raise exception 'the payment did not score both of its orders';
    end if;

    /* The seller: blind to the held order, not to the placed one. */
    perform set_config('request.jwt.claims', json_build_object('sub', v_seller)::text, true);
    set local role authenticated;
    select count(*) into v_n from public.orders o where o.id = v_hold;
    if v_n <> 0 then raise exception 'the seller can see a held order'; end if;
    select count(*) into v_n from public.order_items i where i.order_id = v_hold;
    if v_n <> 0 then raise exception 'the seller can see a held order''s lines'; end if;
    select count(*) into v_n from public.orders o where o.id = v_low;
    if v_n <> 1 then raise exception 'the seller cannot see their placed order, so the held check proves nothing'; end if;
    reset role;

    /* Frozen: the operator cannot move it a stage, the buyer cannot move it. */
    perform set_config('request.jwt.claims', json_build_object('sub', v_op)::text, true);
    begin
      update public.orders o set stage = coalesce(o.stage, 0) + 1 where o.id = v_hold;
      raise exception 'an operator moved a held order a stage';
    exception when raise_exception then
      if sqlerrm not like '%held for a fraud review%' then raise; end if;
    end;

    perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
    begin
      update public.orders o set status = 'placed' where o.id = v_hold;
      raise exception 'a buyer released their own held order';
    exception when raise_exception then
      if sqlerrm not like '%being checked by the marketplace%' then raise; end if;
    end;
    begin
      perform public.decide_held_order('ORD-SELFCHECK-RISK-H', 'release', 'Mine');
      raise exception 'a buyer decided their own held order';
    exception when raise_exception then
      if sqlerrm not like 'Only the marketplace decides%' then raise; end if;
    end;
    begin
      perform public.update_risk_rule('o-guest', 0, false, null);
      raise exception 'a buyer switched a risk rule off';
    exception when raise_exception then
      if sqlerrm not like 'Only the marketplace tunes%' then raise; end if;
    end;

    /* Released, by the operator, with a note; and then the seller sees it. */
    perform set_config('request.jwt.claims', json_build_object('sub', v_op)::text, true);
    begin
      perform public.decide_held_order('ORD-SELFCHECK-RISK-H', 'release', '   ');
      raise exception 'a held order was released without a note';
    exception when raise_exception then
      if sqlerrm not like 'Say why%' then raise; end if;
    end;
    v_res := public.decide_held_order('ORD-SELFCHECK-RISK-H', 'release', 'Self-check: the buyer confirmed the order.');
    if (select o.status from public.orders o where o.id = v_hold) is distinct from 'placed' then
      raise exception 'a released order is not placed (%)', v_res;
    end if;
    if (select r.decision from public.order_risk r where r.order_id = v_hold) is distinct from 'released'
       or (select r.decided_by from public.order_risk r where r.order_id = v_hold) is null then
      raise exception 'the release was not recorded on the order''s score';
    end if;
    if coalesce(current_setting('aventa.risk_decision', true), '') = 'on' then
      raise exception 'deciding a held order left the guards open';
    end if;
    begin
      perform public.decide_held_order('ORD-SELFCHECK-RISK-H', 'cancel', 'Again');
      raise exception 'an order that is no longer held was decided again';
    exception when raise_exception then
      if sqlerrm not like '%is not held%' then raise; end if;
    end;

    perform set_config('request.jwt.claims', json_build_object('sub', v_seller)::text, true);
    set local role authenticated;
    select count(*) into v_n from public.orders o where o.id = v_hold;
    if v_n <> 1 then raise exception 'the seller cannot see an order the marketplace released'; end if;
    reset role;

    /* Nobody puts an order on hold by hand, not even their own. */
    perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
    begin
      update public.orders o set status = 'held' where o.id = v_low;
      raise exception 'a buyer put their own order on hold';
    exception when raise_exception then
      if sqlerrm not like '%cannot be put on hold by hand%' then raise; end if;
    end;

    /* The order to cancel has an eSIM push waiting at the order manager and a
       monthly part that has never been charged; and one of its lines has been
       rewritten to 3000 since it was paid. */
    perform set_config('request.jwt.claims', null, true);
    select s.id into v_sys from public.com_system s order by s.id limit 1;
    if v_sys is null then raise exception 'no order manager to check a cancelled push against'; end if;
    select i.id into v_line from public.order_items i where i.order_id = v_cancel and i.product_id = v_sim.id;
    insert into public.com_order
      (id, order_ref, order_item_id, system_id, market, product_id, product_name, fulfil, quantity,
       state, correlation_id, next_attempt_at)
    values ('COM-SELFCHECK-RISK-C', 'ORD-SELFCHECK-RISK-C', v_line, v_sys, v_mkt, v_sim.id, v_sim.name, 'esim', 2,
            'queued', 'COM-SELFCHECK-RISK-C-1', now())
    on conflict (order_item_id) do nothing;
    select c.id into v_com from public.com_order c where c.order_item_id = v_line;
    update public.com_order c set state = 'queued', next_attempt_at = now() where c.id = v_com;

    select p.id, p.name into v_subp
      from public.products p
     where not exists (select 1 from public.subscriptions s
                        where s.user_id = v_user and s.product_id = p.id and s.status = 'active')
     order by p.id
     limit 1;
    insert into public.subscriptions
      (product_id, product_name, status, auto_renew, next_renewal, price, currency, ref, cycle, user_id)
    values (v_subp.id, v_subp.name, 'active', true, current_date + 30, 30, v_cur,
            'ORD-SELFCHECK-RISK-C', 'Monthly', v_user);

    update public.order_items i set price = 3000 where i.id = v_line;

    /* While it is held, nothing is sent for it. */
    perform set_config('request.jwt.claims', json_build_object('sub', v_op)::text, true);
    v_res := public.com_send(v_com);
    if (v_res ->> 'ok')::boolean
       or (select c.state from public.com_order c where c.id = v_com) is distinct from 'queued' then
      raise exception 'a held order''s eSIM was sent to the order manager (%)', v_res;
    end if;

    /* Cancelled: the push cancelled, the monthly part gone, and one approved
       refund per line sharing out what was paid, not what the lines say now. */
    v_res := public.decide_held_order('ORD-SELFCHECK-RISK-C', 'cancel', 'Self-check: the card holder did not place it.');
    if (select c.state from public.com_order c where c.id = v_com) is distinct from 'cancelled'
       or not exists (select 1 from public.com_event e where e.com_order = v_com and e.id = v_com || '-FR') then
      raise exception 'cancelling did not stop the eSIM push (%)', v_res;
    end if;
    if exists (select 1 from public.subscriptions s where s.ref = 'ORD-SELFCHECK-RISK-C') then
      raise exception 'cancelling left the order''s monthly part to renew (%)', v_res;
    end if;
    if (select o.status from public.orders o where o.id = v_cancel) is distinct from 'cancelled' then
      raise exception 'a cancelled held order is not cancelled (%)', v_res;
    end if;
    select count(*), coalesce(sum(f.amount), 0) into v_n, v_sum
      from public.refunds f
     where f.order_ref = 'ORD-SELFCHECK-RISK-C'
       and f.reason = 'cancelled' and f.decider = 'marketplace' and f.state = 'approved'
       and f.buyer_type = 'consumer' and f.user_id = v_user and f.currency = v_cur
       and f.requested = current_date and f.decided_on = current_date and f.sla_due = current_date
       and f.decision_note = 'Cancelled after a fraud review: Self-check: the card holder did not place it.';
    if v_n <> 2 or v_sum <> 75 then
      raise exception 'cancelling raised % refunds for %, not 2 for 75', v_n, v_sum;
    end if;
    if (select r.decision from public.order_risk r where r.order_id = v_cancel) is distinct from 'cancelled' then
      raise exception 'the cancellation was not recorded';
    end if;

    /* A cancelled order stays cancelled: the buyer cannot move it back, and
       one put back on hold (only the flag can) is not decided again. */
    perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
    begin
      update public.orders o set status = 'placed' where o.id = v_cancel;
      raise exception 'a buyer moved a fraud-cancelled order back to placed';
    exception when raise_exception then
      if sqlerrm not like '%stays cancelled%' then raise; end if;
    end;
    perform set_config('request.jwt.claims', null, true);
    perform set_config('aventa.risk_decision', 'on', true);
    update public.orders o set status = 'held' where o.id = v_cancel;
    perform set_config('aventa.risk_decision', 'off', true);
    perform set_config('request.jwt.claims', json_build_object('sub', v_op)::text, true);
    begin
      perform public.decide_held_order('ORD-SELFCHECK-RISK-C', 'release', 'Self-check: twice');
      raise exception 'a fraud-cancelled order was decided a second time';
    exception when raise_exception then
      if sqlerrm not like '%A held order is decided once.%' then raise; end if;
    end;

    /* A rule and the bands tuned, checked as the screen checks, and audited. */
    v_res := public.update_risk_rule('o-burst', 20, true, 4);
    select count(*) into v_n from public.risk_rule_changes c
     where c.rule_id = 'o-burst' and c.field = 'threshold' and c.was = '3' and c.now = '4';
    if v_n <> 1 or (select r.threshold from public.risk_rules r where r.id = 'o-burst') is distinct from 4 then
      raise exception 'a threshold edit was not made or not audited (%)', v_res;
    end if;
    begin
      perform public.update_risk_rule('o-burst', 101, true, 4);
      raise exception 'a rule was given 101 points';
    exception when raise_exception then
      if sqlerrm not like 'Points must be between%' then raise; end if;
    end;
    begin
      perform public.update_risk_rule('o-burst', 20, true, 0);
      raise exception 'a rule was given a threshold of 0';
    exception when raise_exception then
      if sqlerrm not like 'This rule needs a threshold above zero.%' then raise; end if;
    end;
    begin
      perform public.set_risk_bands('order', 70, 40);
      raise exception 'the bands were set with review above hold';
    exception when raise_exception then
      if sqlerrm not like 'The review threshold must be below%' then raise; end if;
    end;
    v_res := public.set_risk_bands('order', 45, 75);
    select count(*) into v_n from public.risk_rule_changes c
     where c.rule_id = 'order-bands'
       and ((c.field = 'review_at' and c.was = '40' and c.now = '45')
            or (c.field = 'hold_at' and c.was = '70' and c.now = '75'));
    if v_n <> 2 then raise exception 'a band edit was not audited (%)', v_res; end if;

    /* Every account rescored, as the schedule. */
    perform set_config('request.jwt.claims', null, true);
    v_res := public.refresh_account_risk(current_date);
    select count(*) into v_n from public.enterprise_accounts;
    if (v_res ->> 'scored')::integer < v_n
       or (select count(*) from public.account_risk ar where ar.kind = 'business') < v_n then
      raise exception 'the rescore scored % accounts; there are % businesses alone', v_res ->> 'scored', v_n;
    end if;
    v_res := public.score_account('shopper', v_user::text);
    if v_res ->> 'band' not in ('low', 'review', 'high') or jsonb_typeof(v_res -> 'reasons') <> 'array' then
      raise exception 'a shopper''s account scored %', v_res;
    end if;
    begin
      perform public.refresh_account_risk(current_date + 1);
      raise exception 'a rescore dated tomorrow was not refused';
    exception when raise_exception then
      if sqlerrm not like 'Accounts cannot be scored as of%' then raise; end if;
    end;

    raise exception using errcode = 'ZZ999', message = 'rolling the risk check back';
  exception when sqlstate 'ZZ999' then
    null;
  end;

  /* The night, now with ten jobs, dry-run and rolled back. */
  begin
    dry := public.run_nightly(current_date);
    raise exception using errcode = 'ZZ999', message = 'rolling the dry run back';
  exception when sqlstate 'ZZ999' then
    null;
  end;
  for j in select value from jsonb_array_elements(dry -> 'jobs') loop
    if not (j ->> 'ok')::boolean then
      raise exception 'A dry run of the nightly "%" job fails: %', j ->> 'job', j ->> 'error';
    end if;
  end loop;
  if jsonb_array_length(dry -> 'jobs') <> 10 then
    raise exception 'the dry run ran % jobs, not 10', jsonb_array_length(dry -> 'jobs');
  end if;
  if (dry -> 'jobs' -> 8 ->> 'job') is distinct from 'risk' then
    raise exception 'the ninth job of the night is %, not risk', dry -> 'jobs' -> 8 ->> 'job';
  end if;
end $$;

commit;
