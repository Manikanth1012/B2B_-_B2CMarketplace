/* A reserve seven sellers were told about and none of them ever paid.
 *
 * `partner_security.reserve_pct` carries 2% to 10% against seven sellers, each
 * with a rationale somebody wrote — "ten times everyone else's refund rate",
 * "the holdback covers the returns window; the reserve covers what arrives
 * after it". The operator's Credit & Exposure screen prints "10% rolling"
 * beside the seller's name. And `reserve_held` is 0.00 on every one of them,
 * because `run_settlements_core` has never contained the word "reserve" and
 * neither has `settlementCycle.ts`. A control that is a sentence and not a rule.
 *
 * Only the deposit half was ever real: TrackWise's $5,000, in cash, on a date.
 *
 * There is a tell in `credit.ts`. Its warnings function checks for a reserve
 * held against a rate of zero — money retained with no policy behind it — and
 * does not check the opposite, which is the one that has been true of seven
 * sellers all along. It checks the direction that never happened.
 *
 * ---------------------------------------------------------------- the base --
 *
 * A percentage of gross, not of the payout. The exposure a reserve exists to
 * cover is a refund or a chargeback, and both of those are against the sale
 * price — the buyer gets back what they paid, not what the seller kept. Taking
 * the percentage off the seller's margin would size the cover against the wrong
 * number and under-hold exactly the sellers whose commission is highest.
 *
 * ------------------------------------------------------------- the ceiling --
 *
 * Bounded by what the period can actually give, for the same reason a wholesale
 * charge is: you cannot hold money that is not there. A thin month does not go
 * negative and does not borrow from the next one — it holds what it has.
 *
 * ------------------------------------------------------------- the release --
 *
 * On the same terms as the holdback: retained on the statement that earned it,
 * returned on a later one, and visible on both. What differs is the horizon.
 * The holdback covers a returns window measured in days; the reserve covers
 * what arrives after that window closes, so it matures over `reserve_days` —
 * ninety by default, and two clean quarters for the seller whose file says two
 * clean quarters.
 *
 * Each retention is its own tranche with its own maturity, because a rolling
 * reserve is a queue and not a balance: a single figure could tell a seller how
 * much is held but never when any of it comes back, which is the only question
 * they actually ask. `reserve_held` becomes the sum of what has not matured,
 * maintained by trigger — a stored figure nothing recomputes is the one that
 * drifts.
 */

alter table public.partner_security
  add column if not exists reserve_days integer not null default 90;

alter table public.partner_security
  drop constraint if exists reserve_days_is_a_horizon;
alter table public.partner_security
  add constraint reserve_days_is_a_horizon check (reserve_days > 0);

comment on column public.partner_security.reserve_days is
  'How long each retention is held before it matures and is returned. The holdback covers the returns window; this covers what arrives after it.';

/* Two clean quarters, for the seller whose file says two clean quarters. */
update public.partner_security set reserve_days = 180 where partner_id = 'PTR-1011';

alter table public.settlement_statements
  add column if not exists reserve_withheld numeric not null default 0,
  add column if not exists reserve_released numeric not null default 0;

comment on column public.settlement_statements.reserve_withheld is
  'Held back against refunds and chargebacks that land after the returns window. Returned on a later statement when the tranche matures.';

/* ------------------------------------------------------------ the tranches -- */

create table if not exists public.partner_reserve_tranche (
  id            text primary key,
  partner_id    text not null references public.partners(id),
  /* The statement that retained it. */
  statement_id  text not null references public.settlement_statements(id),
  amount        numeric not null check (amount > 0),
  currency      text not null default 'USD',
  /* What it was a percentage of, and which percentage. Kept so a seller can
     check the retention rather than take it — the same reason a wholesale
     charge carries its own days and price. */
  basis         numeric not null check (basis >= 0),
  rate          numeric not null check (rate > 0),
  held_on       date not null,
  matures_on    date not null,
  released_on   date,
  released_by   text references public.settlement_statements(id),
  created_at    timestamptz not null default now(),
  constraint tranche_matures_after_it_is_held check (matures_on >= held_on),
  constraint released_says_when_and_where check (
    (released_on is null) = (released_by is null)),
  constraint one_tranche_per_statement unique (partner_id, statement_id)
);

comment on table public.partner_reserve_tranche is
  'One retention of a seller''s rolling reserve, with the date it matures and the statement that returned it. A reserve is a queue, not a balance.';

create index if not exists reserve_tranche_open_idx
  on public.partner_reserve_tranche (partner_id, matures_on) where released_on is null;

/* `reserve_held` is what has not matured, and it is summed rather than
   written — the column it replaces was written by nothing at all. */
create or replace function public.z_reserve_held()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid text := coalesce(new.partner_id, old.partner_id);
begin
  update public.partner_security s set reserve_held = coalesce((
    select sum(t.amount) from public.partner_reserve_tranche t
     where t.partner_id = pid and t.released_on is null), 0)
   where s.partner_id = pid;
  return null;
end $$;

drop trigger if exists z_reserve_held on public.partner_reserve_tranche;
create trigger z_reserve_held
after insert or update or delete on public.partner_reserve_tranche
for each row execute function public.z_reserve_held();

/* A tranche released on a statement somebody has signed off is part of that
   document, exactly as a settled line or a recovered charge is. */
create or replace function public.guard_reserve_tranche()
returns trigger language plpgsql security definer set search_path = public as $$
declare st public.settlement_statements;
begin
  if tg_op = 'UPDATE' and old.released_on is not null and new.released_on is null then
    select * into st from public.settlement_statements where id = old.released_by;
    if st.status in ('approved', 'paid') then
      raise exception
        '% was returned on %, which is %. A reserve cannot be un-returned — retain it again rather than detaching it.',
        old.id, old.released_by, st.status;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists guard_reserve_tranche on public.partner_reserve_tranche;
create trigger guard_reserve_tranche before update on public.partner_reserve_tranche
for each row execute function public.guard_reserve_tranche();

alter table public.partner_reserve_tranche enable row level security;

drop policy if exists operator_all_reserve_tranche on public.partner_reserve_tranche;
create policy operator_all_reserve_tranche on public.partner_reserve_tranche
  for all using (public.current_persona() = 'operator')
  with check (public.current_persona() = 'operator');

/* A seller reading what is held from them and when it comes back. The whole
   point of the tranche model is that they can be told the second thing. */
drop policy if exists partner_reads_own_reserve on public.partner_reserve_tranche;
create policy partner_reads_own_reserve on public.partner_reserve_tranche
  for select using (partner_id = public.current_partner_id());

grant select on public.partner_reserve_tranche to authenticated;

/* ------------------------------------------------------- what a run retains -- */

/**
 * What a seller's reserve does on one settlement.
 *
 * Returned as a pair rather than applied here, so the run can put it in the
 * right place in its own arithmetic and `reserveOn` in `settlementCycle.ts` can
 * compute the same pair for a period nobody has settled yet. The integration
 * suite checks the two agree.
 */
create or replace function public.reserve_on(
  p_partner text, p_gross numeric, p_room numeric, p_closed_on date)
returns table (rate numeric, due numeric, withheld numeric, released numeric)
language sql stable as $$
  select
    coalesce(s.reserve_pct, 0),
    round(coalesce(s.reserve_pct, 0) / 100.0 * greatest(p_gross, 0), 2),
    /* Bounded by what the period has. Holding more than is payable would carry
       a figure the marketplace is not holding. */
    least(
      round(coalesce(s.reserve_pct, 0) / 100.0 * greatest(p_gross, 0), 2),
      greatest(round(p_room, 2), 0)),
    coalesce((select sum(t.amount) from public.partner_reserve_tranche t
               where t.partner_id = p_partner and t.released_on is null
                 and t.matures_on <= p_closed_on), 0)
  from public.partner_security s where s.partner_id = p_partner
  union all
  /* A seller with no security record has no reserve, rather than no answer. */
  select 0, 0, 0, 0
   where not exists (select 1 from public.partner_security s2 where s2.partner_id = p_partner)
  limit 1
$$;

grant execute on function public.reserve_on(text, numeric, numeric, date) to authenticated;

do $$
declare r record;
begin
  select * into r from public.reserve_on('PTR-1011', 10000, 100000, current_date);
  if r.rate <> 10 or r.due <> 1000 then
    raise exception 'The reserve rate did not come back as 10%% of gross: rate %, due %.', r.rate, r.due;
  end if;
  select * into r from public.reserve_on('PTR-1011', 10000, 250, current_date);
  if r.withheld <> 250 then
    raise exception 'The reserve was not bounded by what the period had: %.', r.withheld;
  end if;
  select * into r from public.reserve_on('PTR-1002', 10000, 100000, current_date);
  if r.due <> 0 then
    raise exception 'A seller on a zero rate had % retained.', r.due;
  end if;
end $$;
