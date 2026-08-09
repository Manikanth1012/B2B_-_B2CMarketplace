/* Six products carry the `partner` audience. Nobody has ever bought one.
 *
 * `SKU-7001` White-label storefront, `SKU-7002` Wholesale connectivity pack,
 * `SKU-7003` Partner API and sandbox access, `SKU-FP9505` Reseller Starter, and
 * two Beacon wholesale bundles. They are listed, priced in four currencies, and
 * shown on the reseller shelf. There is no table in this schema in which a
 * partner has bought anything, and no screen in the partner console from which
 * they could. The audience was a label on a product rather than a thing a
 * partner could do — the same shape of defect as a sort order nothing wrote.
 *
 * A partner buying is not a shopper checking out. Nothing is delivered to an
 * address, no gateway is called, and no money moves at the moment of purchase:
 * the marketplace already owes this partner a settlement every cycle, and a
 * wholesale charge nets off against it. That is why this does not go through
 * `orders`. An order that is paid by not-paying, against a balance that is
 * computed a month later, would be an order in name and a settlement line in
 * every respect that matters.
 *
 * So there are two records:
 *
 *   `partner_purchase` — the standing order. What they took, how many, at what
 *   price, from when. Priced in USD because that is the currency statements are
 *   denominated in; the payout currency is applied when the run pays the net,
 *   exactly as it is for a note.
 *
 *   `partner_charge` — what one period of that standing order costs. Raised
 *   when the statement for that period is built, pro-rated across the days the
 *   purchase was actually live, and carrying the arithmetic (days charged, days
 *   in the period) so the partner can check it rather than take it.
 *
 * The netting is bounded. A debit note can push a statement negative because an
 * operator raised it deliberately and exceptionally; a wholesale charge recurs
 * every cycle, so the same licence would make an unpayable statement the normal
 * case. A charge nets against what the period actually owes and no further —
 * the remainder stays outstanding and takes the next cycle. You cannot net off
 * against money that is not there.
 *
 * There is no credit check and no deposit here, and that is not an omission:
 * the charge is secured by the settlement it comes out of. The marketplace is
 * never exposed for more than it already owes.
 */

/* ------------------------------------------------------------ the purchase -- */

create table if not exists public.partner_purchase (
  id            text primary key,
  partner_id    text not null references public.partners(id),
  product_id    text not null references public.products(id),
  /* Frozen. A product renamed next year does not rename what was bought. */
  product_name  text not null,
  quantity      integer not null check (quantity > 0),
  unit_price    numeric not null check (unit_price >= 0),
  currency      text not null default 'USD',
  billing_period text not null default 'monthly',
  state         text not null default 'active'
                check (state in ('active', 'cancelled')),
  started_on    date not null default current_date,
  /* The last day service runs. Null while it is open-ended. */
  ends_on       date,
  ordered_by    text not null,
  ordered_at    timestamptz not null default now(),
  cancelled_on  date,
  cancel_reason text,
  note          text,
  created_at    timestamptz not null default now(),
  constraint purchase_ends_after_it_starts check (ends_on is null or ends_on >= started_on),
  constraint cancelled_says_why check (
    state <> 'cancelled' or (cancelled_on is not null and coalesce(trim(cancel_reason), '') <> ''))
);

comment on table public.partner_purchase is
  'A standing order a partner has taken from the marketplace. It is charged per settlement period and nets off against the settlement, rather than being invoiced.';

create index if not exists partner_purchase_partner_idx on public.partner_purchase (partner_id, state);

/* ------------------------------------------------------------- the charge -- */

create table if not exists public.partner_charge (
  id             text primary key,
  purchase_id    text not null references public.partner_purchase(id),
  partner_id     text not null references public.partners(id),
  product_id     text not null,
  product_name   text not null,
  period_start   date not null,
  period_end     date not null,
  quantity       integer not null check (quantity > 0),
  unit_price     numeric not null check (unit_price >= 0),
  /* The arithmetic, kept rather than recomputed. A partner reconciling a
     part-month against a full-month price needs to see the fraction. */
  days_charged   integer not null check (days_charged > 0),
  days_in_period integer not null check (days_in_period > 0),
  gross          numeric not null check (gross > 0),
  currency       text not null default 'USD',
  /* What has actually been taken out of a settlement so far. Less than `gross`
     where the period could not cover the whole charge. Summed by trigger from
     the recoveries below rather than written by hand — a stored figure nothing
     recomputes is the one that drifts. */
  recovered      numeric not null default 0 check (recovered >= 0),
  raised_on      date not null default current_date,
  created_at     timestamptz not null default now(),
  constraint charge_period_is_a_period check (period_end >= period_start),
  constraint charge_days_fit_the_period check (days_charged <= days_in_period),
  constraint charge_recovers_no_more_than_it_charges check (recovered <= gross),
  constraint one_charge_per_purchase_per_period unique (purchase_id, period_start)
);

comment on table public.partner_charge is
  'One calendar month of one standing order. Nets off against the settlement covering that month, up to what the period owes; the remainder carries.';

create index if not exists partner_charge_open_idx
  on public.partner_charge (partner_id, period_start) where recovered < gross;

/**
 * Which statement took how much off which charge.
 *
 * A charge bigger than one period's earnings is recovered across several, so
 * "the statement this charge went to" is not a single value and a column
 * holding one would be wrong for exactly the case this design exists for.
 *
 * It also makes the netting repeatable. `apply_notes` recomputed `adjustments`
 * from the notes still waiting to be applied, so calling it twice on the same
 * statement found none the second time and reset the figure to zero — a bug
 * that was survivable while notes were exceptional and would not be once every
 * partner has a monthly charge. A statement's own recoveries are deleted and
 * redone on each pass, so the second pass produces what the first one did.
 */
create table if not exists public.partner_charge_recovery (
  charge_id    text not null references public.partner_charge(id) on delete cascade,
  statement_id text not null references public.settlement_statements(id) on delete cascade,
  amount       numeric not null check (amount > 0),
  applied_on   date not null default current_date,
  primary key (charge_id, statement_id)
);

create or replace function public.z_charge_recovered()
returns trigger language plpgsql as $$
declare cid text := coalesce(new.charge_id, old.charge_id);
begin
  update public.partner_charge c set recovered = coalesce((
    select sum(r.amount) from public.partner_charge_recovery r where r.charge_id = cid), 0)
   where c.id = cid;
  return null;
end $$;

drop trigger if exists z_charge_recovered on public.partner_charge_recovery;
create trigger z_charge_recovered
after insert or update or delete on public.partner_charge_recovery
for each row execute function public.z_charge_recovered();

/* --------------------------------------------------------------- the rules -- */

create or replace function public.guard_partner_purchase()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  p public.products;
  pt public.partners;
  pol public.note_policy;
begin
  select * into p from public.products where id = new.product_id;
  select * into pt from public.partners where id = new.partner_id;
  select * into pol from public.note_policy where id = 'standard';

  if not ('partner' = any(coalesce(p.audiences, array[]::text[]))) then
    raise exception '% is not sold to partners. Only a product on the partner shelf can be taken on a partner account.', p.name;
  end if;

  /* A pending listing is one the marketplace has not finished reviewing. It is
     visible to its own seller and it is not on sale to anybody. */
  if tg_op = 'INSERT' and p.status <> 'live' then
    raise exception '% is %, not live. It cannot be taken until it is published.', p.name, p.status;
  end if;

  /* Beacon lists two wholesale bundles. Beacon buying Beacon's bundle would put
     a commission line and a charge line on the same statement for the same
     supply, and net them against each other to something meaningless. */
  if p.partner_id is not null and p.partner_id = new.partner_id then
    raise exception 'This is your own listing. A seller does not buy from themselves.';
  end if;

  if tg_op = 'INSERT' and pt.status <> 'live' then
    raise exception
      '% is %, not live. A commitment that settles monthly is not taken on by an account that is not trading.',
      pt.name, pt.status;
  end if;

  /* One currency, and it is the one statements are denominated in — the same
     rule a note is held to, for the same reason. The partner's payout currency
     is applied when the run pays the net. */
  if new.currency <> pol.currency then
    raise exception 'A partner purchase is priced in %, the currency every statement is denominated in.', pol.currency;
  end if;

  /* Charges are raised a calendar month at a time. A yearly or one-off price
     put through that arithmetic would be billed twelve times or pro-rated
     against a month it does not describe, so it is refused rather than
     approximated. */
  if new.billing_period <> 'monthly' then
    raise exception
      '% is priced %. Partner purchases are charged by the calendar month; nothing else has a shape this can bill.',
      p.name, new.billing_period;
  end if;

  if new.state = 'cancelled' and new.ends_on is null then
    new.ends_on := new.cancelled_on;
  end if;

  new.product_name := coalesce(nullif(trim(new.product_name), ''), p.name);
  return new;
end $$;

drop trigger if exists guard_partner_purchase on public.partner_purchase;
create trigger guard_partner_purchase before insert or update on public.partner_purchase
for each row execute function public.guard_partner_purchase();

/* A recovery that came out of a statement somebody has signed off is part of
   that document. Removing it would leave the statement short by an amount
   nothing explains — the same rule `guard_settled_line` holds a settlement line
   to. Undoing a pass against a statement still open is how the netting stays
   repeatable, so that case is allowed and only that case. */
create or replace function public.guard_charge_recovery()
returns trigger language plpgsql security definer set search_path = public as $$
declare st public.settlement_statements;
begin
  select * into st from public.settlement_statements
   where id = coalesce(old.statement_id, new.statement_id);
  if st.status in ('approved', 'paid') then
    raise exception
      '% is %. A charge recovered on it cannot be changed — raise a credit note against it instead.',
      st.id, st.status;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists guard_charge_recovery on public.partner_charge_recovery;
create trigger guard_charge_recovery before update or delete on public.partner_charge_recovery
for each row execute function public.guard_charge_recovery();

/* ------------------------------------------------------------ the pro-rata -- */

/**
 * How much of a period a purchase was live for.
 *
 * A storefront taken on the 20th of a 31-day month is charged for 12 days, not
 * for a month. Both this and `daysCharged` in `src/lib/wholesale.ts` compute it,
 * and the integration suite checks they agree on every purchase on file — the
 * same arrangement `settlement_window` and `windowFor` are held to.
 */
create or replace function public.charge_days(
  p_period_start date, p_period_end date, p_started date, p_ends date)
returns table (days_charged integer, days_in_period integer)
language sql immutable as $$
  select
    greatest(0, (least(p_period_end, coalesce(p_ends, p_period_end))
                 - greatest(p_period_start, p_started) + 1))::integer,
    (p_period_end - p_period_start + 1)::integer
$$;

/**
 * What a partner's standing orders come to over a span, month by month.
 *
 * A month at a time, not a settlement period at a time. The six partner
 * products are all priced monthly and Beacon settles quarterly: charging one
 * monthly price against a quarter would bill a reseller for one month of a
 * wholesale pack they used for three. So the span is cut into calendar months
 * and each month is charged on its own, which also makes the pro-rata
 * unambiguous — a fraction of a month is a fraction of a known number of days.
 *
 * One function, three callers: `raise_partner_charges` inserts these rows, the
 * accruing view sums them for a period nobody has settled yet, and
 * `chargesOver` in `src/lib/wholesale.ts` computes the same thing for a screen.
 * That last pair is checked against each other in the integration suite.
 */
create or replace function public.wholesale_charges(
  p_partner text, p_from date, p_to date)
returns table (
  purchase_id text, product_id text, product_name text,
  month_start date, month_end date,
  quantity integer, unit_price numeric,
  days_charged integer, days_in_period integer, gross numeric)
language sql stable as $$
  select
    pu.id, pu.product_id, pu.product_name,
    greatest(m.m::date, p_from),
    least((m.m + interval '1 month' - interval '1 day')::date, p_to),
    pu.quantity, pu.unit_price,
    d.days_charged, d.days_in_period,
    round(pu.unit_price * pu.quantity * d.days_charged::numeric / d.days_in_period::numeric, 2)
  from public.partner_purchase pu
  cross join lateral generate_series(
    date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month') m(m)
  cross join lateral public.charge_days(
    greatest(m.m::date, p_from),
    least((m.m + interval '1 month' - interval '1 day')::date, p_to),
    pu.started_on, pu.ends_on) d
  where pu.partner_id = p_partner
    and pu.started_on <= p_to
    and (pu.ends_on is null or pu.ends_on >= p_from)
    and d.days_charged > 0
    /* Sandbox access is free. A zero line on a statement is noise a partner has
       to read past to find the ones that cost something. */
    and round(pu.unit_price * pu.quantity * d.days_charged::numeric / d.days_in_period::numeric, 2) > 0
$$;

/**
 * The charges a partner's period owes, materialised.
 *
 * Called when the statement for that period is built, so the period comes from
 * the statement rather than from a second calendar that could drift from it.
 * Idempotent: one charge per purchase per month, enforced by the table.
 */
create or replace function public.raise_partner_charges(
  p_partner text, p_period_start date, p_period_end date)
returns integer language plpgsql security definer set search_path = public as $$
declare c record; n integer := 0;
begin
  for c in select * from public.wholesale_charges(p_partner, p_period_start, p_period_end) loop
    insert into public.partner_charge
      (id, purchase_id, partner_id, product_id, product_name, period_start, period_end,
       quantity, unit_price, days_charged, days_in_period, gross, currency)
    values
      (format('PC-%s-%s-%s', right(p_partner, 4), to_char(c.month_start, 'YYYYMM'), right(c.purchase_id, 2)),
       c.purchase_id, p_partner, c.product_id, c.product_name, c.month_start, c.month_end,
       c.quantity, c.unit_price, c.days_charged, c.days_in_period, c.gross, 'USD')
    on conflict (purchase_id, period_start) do nothing;
    n := n + 1;
  end loop;
  return n;
end $$;

/* ------------------------------------------------------------ the netting -- */

/**
 * Everything that moves a statement's net after the run computed it: the notes
 * an operator raised, and the wholesale a partner bought.
 *
 * `apply_notes` was the only thing that wrote `adjustments`, so it is the only
 * place a second kind of adjustment can land without one of them silently
 * overwriting the other. It stays as the name callers know, wrapping this.
 *
 * Notes go on first. A note is a correction to what the period earned, so it
 * belongs in the figure a charge is then measured against — netting a charge
 * against a balance that a credit was about to restore would carry a shortfall
 * that never existed.
 *
 * A second pass over the same statement produces what the first one did. It
 * begins by undoing its own previous pass, because the alternative — reading
 * only what is still outstanding — is what made the original `apply_notes`
 * reset `adjustments` to zero when it was called twice.
 */
create or replace function public.apply_settlement_adjustments(p_statement text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  st        public.settlement_statements;
  n         public.settlement_note;
  c         public.partner_charge;
  adj       numeric := 0;
  det       jsonb := '[]'::jsonb;
  notes     int := 0;
  charged   int := 0;
  raised    int := 0;
  base      numeric;
  room      numeric;
  take      numeric;
  taken     numeric := 0;
begin
  select * into st from public.settlement_statements where id = p_statement;
  if st.id is null then return jsonb_build_object('ok', false, 'why', 'No such statement.'); end if;
  if st.status in ('approved', 'paid') then
    return jsonb_build_object('ok', false, 'why',
      format('%s is %s. A note cannot be added to a statement that has been signed off.', p_statement, st.status));
  end if;

  /* Undo this statement's own previous pass, so a second one starts where the
     first one did rather than on top of it. */
  update public.settlement_note
     set state = 'issued', statement_id = null, applied_on = null
   where statement_id = p_statement and state = 'applied';
  delete from public.partner_charge_recovery where statement_id = p_statement;

  for n in
    select * from public.settlement_note
     where partner_id = st.partner_id and state = 'issued'
     order by raised_on, id
  loop
    adj := adj + case n.kind when 'credit' then n.amount else -n.amount end;
    det := det || jsonb_build_object(
      'note_id', n.id, 'kind', n.kind, 'reason', n.reason_id,
      'amount', n.amount, 'detail', n.detail, 'ref', n.ref);
    update public.settlement_note set
      state = 'applied', statement_id = p_statement, applied_on = current_date
     where id = n.id;
    notes := notes + 1;
  end loop;

  /* This period's wholesale, and anything an earlier period could not cover. */
  if st.period_start is not null and st.period_end is not null then
    raised := public.raise_partner_charges(st.partner_id, st.period_start, st.period_end);
  end if;

  /* What the period actually has to give. `held_back` is inside a returns
     window and is not the marketplace's to spend; `carried_in` is money the
     last period owed and did not pay, and it is. */
  base := round(st.gross - st.commission - st.fees - st.refunds - st.withholding + adj, 2);
  room := round(base - st.held_back + st.carried_in, 2);

  for c in
    select * from public.partner_charge
     where partner_id = st.partner_id
       and recovered < gross
       and period_start <= coalesce(st.period_end, period_start)
     order by period_start, id
  loop
    exit when room <= 0;
    take := least(round(c.gross - c.recovered, 2), room);
    if take <= 0 then continue; end if;

    adj   := adj - take;
    room  := round(room - take, 2);
    taken := round(taken + take, 2);
    det := det || jsonb_build_object(
      'charge_id', c.id, 'kind', 'debit', 'reason', 'wholesale',
      'amount', take, 'gross', c.gross, 'outstanding', round(c.gross - c.recovered - take, 2),
      'product', c.product_name, 'quantity', c.quantity,
      'period', to_char(c.period_start, 'Mon YYYY'),
      'detail', format('%s × %s%s', c.product_name, c.quantity,
        case when c.days_charged < c.days_in_period
             then format(', %s of %s days', c.days_charged, c.days_in_period) else '' end));

    insert into public.partner_charge_recovery (charge_id, statement_id, amount)
    values (c.id, p_statement, take);
    charged := charged + 1;
  end loop;

  /* Written even when nothing applied. The pass above may have undone an
     earlier one, and leaving the old figure in place would state an adjustment
     that no note or charge on file supports. */
  update public.settlement_statements set
    adjustments = adj,
    adjustment_detail = det,
    net = round(gross - commission - fees - refunds - withholding + adj, 2),
    payout_net = round((gross - commission - fees - refunds - withholding + adj) * fx_rate, 2)
   where id = p_statement;

  if notes = 0 and charged = 0 then
    return jsonb_build_object('ok', true, 'applied', 0, 'charges', 0, 'raised', raised,
      'why', 'No issued notes for that seller.');
  end if;

  return jsonb_build_object('ok', true, 'applied', notes, 'adjustment', adj,
    'charges', charged, 'raised', raised, 'recovered', taken);
end $$;

create or replace function public.apply_notes(p_statement text)
returns jsonb language sql security definer set search_path = public as $$
  select public.apply_settlement_adjustments(p_statement)
$$;

/* --------------------------------------------------------- what a partner does */

/**
 * Take a product from the partner shelf.
 *
 * The price is read from `product_prices` in the settlement currency and frozen
 * on the purchase, for the same reason an order freezes its price: a repricing
 * next quarter is not a repricing of what was already agreed.
 */
create or replace function public.buy_partner_product(
  p_product text, p_quantity integer default 1, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me    text := public.current_partner_id();
  who   text;
  p     public.products;
  price numeric;
  pol   public.note_policy;
  seq   integer;
  /* Not `id`. `partner_purchase` has a column of that name and the sequence
     query below reads it, so a variable called `id` makes the reference
     ambiguous and Postgres refuses the whole function at run time. */
  new_id text;
begin
  if public.current_persona() is distinct from 'partner' or me is null then
    raise exception 'Only a seller signed in to their own console takes a partner product.';
  end if;
  if coalesce(p_quantity, 0) < 1 then
    raise exception 'How many? A purchase of nothing is not a purchase.';
  end if;

  select * into p from public.products where id = p_product;
  if p.id is null then raise exception 'There is no product %.', p_product; end if;
  select * into pol from public.note_policy where id = 'standard';

  select pp.price into price from public.product_prices pp
   where pp.product_id = p_product and pp.currency = pol.currency;
  if price is null then
    raise exception '% has no % price, and % is the currency it would settle in.', p.name, pol.currency, pol.currency;
  end if;

  /* From the session, not from the caller. Elsewhere in this schema the actor
     is a parameter the client fills in — which is fine for an operator action
     that a second person then has to approve, and is not fine here, where
     nobody checks it afterwards. `profiles` holds no name, so the identity
     comes off the auth record this function can already see. */
  select coalesce(u.raw_user_meta_data ->> 'name', u.email) into who
    from auth.users u where u.id = auth.uid();

  select coalesce(max(right(pp.id, 2)::integer), 0) + 1 into seq
    from public.partner_purchase pp where pp.partner_id = me;
  new_id := format('PP-%s-%s', right(me, 4), lpad(seq::text, 2, '0'));

  insert into public.partner_purchase
    (id, partner_id, product_id, product_name, quantity, unit_price, currency,
     billing_period, started_on, ordered_by, note)
  values
    (new_id, me, p_product, p.name, p_quantity, price, pol.currency,
     coalesce(p.billing_period, 'monthly'), current_date, coalesce(who, me), p_note);

  return jsonb_build_object('ok', true, 'id', new_id, 'unit_price', price, 'currency', pol.currency,
    'why', format('%s × %s. It is charged from %s and comes off your settlement.',
                  p.name, p_quantity, to_char(current_date, 'DD Mon YYYY')));
end $$;

/**
 * Stop one.
 *
 * Service runs to the end of the day it is cancelled and the period is charged
 * pro-rata to there. Charges already raised stand — a period that has been
 * consumed is a period that is owed for.
 */
create or replace function public.cancel_partner_purchase(p_id text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare pu public.partner_purchase;
begin
  select * into pu from public.partner_purchase where id = p_id;
  if pu.id is null then raise exception 'There is no purchase %.', p_id; end if;
  if public.current_persona() = 'partner' and pu.partner_id is distinct from public.current_partner_id() then
    raise exception 'That purchase is not yours.';
  end if;
  if public.current_persona() not in ('partner', 'operator') then
    raise exception 'Only the seller or the marketplace stops a partner purchase.';
  end if;
  if pu.state = 'cancelled' then
    return jsonb_build_object('ok', false, 'why', format('%s was already stopped on %s.', p_id, pu.cancelled_on));
  end if;
  if coalesce(trim(p_reason), '') = '' then
    raise exception 'Say why it is being stopped. A cancellation with no reason cannot be answered when it is queried.';
  end if;

  update public.partner_purchase set
    state = 'cancelled', cancelled_on = current_date, ends_on = current_date, cancel_reason = p_reason
   where id = p_id;

  return jsonb_build_object('ok', true, 'id', p_id,
    'why', format('Stopped on %s. This period is charged to that date and nothing after it.',
                  to_char(current_date, 'DD Mon YYYY')));
end $$;

/* ------------------------------------------------------------------- who sees */

alter table public.partner_purchase enable row level security;
alter table public.partner_charge enable row level security;

drop policy if exists operator_all_partner_purchase on public.partner_purchase;
create policy operator_all_partner_purchase on public.partner_purchase
  for all using (public.current_persona() = 'operator')
  with check (public.current_persona() = 'operator');

/* Read only. Taking one and stopping one both go through a function, because
   both have to freeze a price or write a reason, and a policy cannot. */
drop policy if exists partner_read_own_purchases on public.partner_purchase;
create policy partner_read_own_purchases on public.partner_purchase
  for select using (partner_id = public.current_partner_id());

drop policy if exists operator_all_partner_charge on public.partner_charge;
create policy operator_all_partner_charge on public.partner_charge
  for all using (public.current_persona() = 'operator')
  with check (public.current_persona() = 'operator');

drop policy if exists partner_read_own_charges on public.partner_charge;
create policy partner_read_own_charges on public.partner_charge
  for select using (partner_id = public.current_partner_id());

alter table public.partner_charge_recovery enable row level security;

drop policy if exists operator_all_charge_recovery on public.partner_charge_recovery;
create policy operator_all_charge_recovery on public.partner_charge_recovery
  for all using (public.current_persona() = 'operator')
  with check (public.current_persona() = 'operator');

/* A partner reading which of their statements took what off which charge. It
   is the reconciliation the whole design exists to let them do. */
drop policy if exists partner_read_own_recovery on public.partner_charge_recovery;
create policy partner_read_own_recovery on public.partner_charge_recovery
  for select using (exists (
    select 1 from public.partner_charge c
     where c.id = charge_id and c.partner_id = public.current_partner_id()));

grant select on public.partner_purchase to authenticated;
grant select on public.partner_charge to authenticated;
grant select on public.partner_charge_recovery to authenticated;
grant execute on function public.buy_partner_product(text, integer, text) to authenticated;
grant execute on function public.cancel_partner_purchase(text, text) to authenticated;
grant execute on function public.charge_days(date, date, date, date) to authenticated;
grant execute on function public.wholesale_charges(text, date, date) to authenticated;

/* ------------------------------------------------------------- what is owed -- */

/**
 * What a partner is running up this cycle, beside what they are earning.
 *
 * `settlement_accruing` answers "what will I be paid"; without this it answers
 * it with the earnings only, and a partner on a $3,900 wholesale pack would
 * read a number four thousand dollars adrift of what lands.
 */
drop view if exists public.partner_wholesale_accruing;
create view public.partner_wholesale_accruing
with (security_invoker = on) as
select
  a.partner_id,
  a.period_start,
  a.period_end,
  a.closed_on,
  /* What this cycle has still to take, not what it costs. A month that has
     already been charged and recovered against an open statement is money the
     seller has paid; adding its list price back in would tell them they owe it
     twice. Where a charge exists, what is left on it is the answer; where none
     has been raised yet, the projection is. */
  coalesce((select sum(coalesce(c.gross - c.recovered, w.gross))
              from public.wholesale_charges(a.partner_id, a.period_start, a.period_end) w
              left join public.partner_charge c
                on c.purchase_id = w.purchase_id and c.period_start = w.month_start), 0)
    as this_period,
  coalesce((select sum(c.gross - c.recovered) from public.partner_charge c
             where c.partner_id = a.partner_id and c.recovered < c.gross
               and c.period_end < a.period_start), 0) as brought_forward,
  (select count(*) from public.partner_purchase pu
    where pu.partner_id = a.partner_id and pu.state = 'active') as active_purchases
from public.settlement_accruing a;

grant select on public.partner_wholesale_accruing to authenticated;
