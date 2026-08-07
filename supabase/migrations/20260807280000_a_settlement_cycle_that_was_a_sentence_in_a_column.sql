/* Settlement ran because somebody pressed a button, on a cycle that was prose.
 *
 * `commission_plans.cycle` held "Monthly, net 30" — a sentence. Nothing parsed
 * it, nothing scheduled from it, and every one of the eight plans said the same
 * thing, so the marketplace has been settling every partner monthly whatever
 * their contract says. `settlement_statements.period` held "Feb 2026", with no
 * period start, no period end, no cut-off and no due date; the FX fix for a
 * statement was recovered by parsing that string back into a month.
 *
 * A settlement cycle is a term of the partner's contract. It is agreed once,
 * with a frequency, a day the period closes, payment terms and a hold, and
 * after that the runs follow the calendar rather than somebody's memory.
 *
 * Four things this models that the prose could not:
 *
 *   FREQUENCY.  Monthly, quarterly, half-yearly or yearly. A content partner
 *   taking a share of small recurring revenues wants monthly; a reseller on a
 *   wholesale discount is often quarterly; an introducer on insurance
 *   commission may be yearly. One cadence for everybody is a default, not a
 *   contract.
 *
 *   ALIGNMENT.  A quarterly cycle agreed in February either runs Feb–Apr, or
 *   it runs Jan–Mar with a short first period. Both are real, both are written
 *   into real contracts, and a system that only does one of them silently pays
 *   the other partner on the wrong days.
 *
 *   HOLD.  A device sale inside the returns window is not settled yet. The
 *   money is earned and not yet payable, and it belongs in the NEXT period
 *   rather than being paid and clawed back.
 *
 *   MINIMUM PAYOUT.  Below it, the balance carries forward. Paying $4.10 to a
 *   Kenyan bank account costs more than $4.10.
 */

/* ---- 1. The agreed terms ------------------------------------------------------ */

create table if not exists public.partner_settlement_terms (
  partner_id      text primary key references public.partners(id) on delete cascade,

  frequency       text not null default 'monthly'
                  check (frequency in ('monthly','quarterly','half-yearly','yearly')),

  /* Calendar alignment settles on the natural boundary — a quarter ends in
     March, June, September, December. Anniversary alignment counts from the
     month the contract started, so a February signing settles Feb–Apr. The
     difference is invisible on a monthly cycle and matters on every other. */
  align           text not null default 'calendar' check (align in ('calendar','anniversary')),

  /* Where the cycle counts from on anniversary alignment, and the first period
     the marketplace will settle either way. */
  starts_on       date not null,

  /* The day of the month the period closes. Most contracts say the last day;
     some say the 25th, so the invoice can be raised before month end. 0 means
     the last day, whatever length the month is. */
  closes_on_day   integer not null default 0 check (closes_on_day between 0 and 28),

  /* Net terms. "Monthly, net 30" was the whole of this in a string. */
  pay_within_days integer not null default 30 check (pay_within_days between 0 and 120),

  /* Earned but not yet payable. A device sale inside its returns window is
     held back to the next period rather than paid and clawed back. */
  hold_days       integer not null default 0 check (hold_days between 0 and 90),
  hold_reason     text,

  /* Below this, carry forward. Paying four dollars costs more than four
     dollars. */
  minimum_payout  numeric(12,2) not null default 0 check (minimum_payout >= 0),
  payout_currency text not null references public.currencies(code),

  /* What was agreed, by whom, and against which piece of paper. A cycle
     somebody changed with no reference is a cycle nobody can defend in a
     dispute. */
  agreed_on       date not null default current_date,
  agreed_by       text,
  contract_ref    text,
  note            text,
  updated_at      timestamptz not null default now()
);

comment on table public.partner_settlement_terms is
  'The settlement cycle agreed with each partner: how often, aligned to what, '
  'closing which day, payable within how long, holding back how much. Runs '
  'follow this rather than a monthly default.';

create or replace function public.z_settlement_terms_touched()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  /* A yearly cycle with a fourteen-day hold is coherent; a yearly cycle with a
     ninety-day hold holds back a quarter of the year's earnings on a technicality. */
  if new.hold_days > 0 and new.hold_reason is null then
    raise exception
      'A hold has to say what it is for. "14 days" on its own is money a partner cannot account for.';
  end if;
  return new;
end $$;

drop trigger if exists z_settlement_terms_touched on public.partner_settlement_terms;
create trigger z_settlement_terms_touched
  before insert or update on public.partner_settlement_terms
  for each row execute function public.z_settlement_terms_touched();

/* ---- 2. The arithmetic -------------------------------------------------------- */

create or replace function public.cycle_months(p_frequency text)
returns integer language sql immutable as $$
  select case p_frequency
    when 'monthly' then 1 when 'quarterly' then 3
    when 'half-yearly' then 6 when 'yearly' then 12 end
$$;

/* The period that CLOSED most recently on or before a date.
 *
 * Returns the window and the day it closed. Null where the contract has not
 * started yet, or where its first period has not closed — a partner who signed
 * last week is not owed a settlement, and inventing a short first period for
 * them would pay against orders that predate the agreement.
 */
create or replace function public.settlement_period(
  p_frequency text, p_align text, p_starts date, p_closes_day integer, p_on date
) returns table (period_start date, period_end date, closed_on date)
language plpgsql immutable as $$
declare
  months integer := public.cycle_months(p_frequency);
  anchor integer;
  cursor_start date;
  cursor_end date;
  closes date;
begin
  if p_on < p_starts then return; end if;

  /* Where the cycle's boundaries fall. Calendar alignment snaps to the natural
     boundary of the frequency — quarters end in March, June, September and
     December whatever month the contract began. Anniversary alignment counts
     from the contract's own start month. */
  anchor := case when p_align = 'calendar'
                 then 0
                 else (extract(month from p_starts)::integer - 1) % months end;

  /* Walk back from the month of p_on to the most recent boundary. */
  cursor_start := date_trunc('month', p_on)::date;
  while ((extract(month from cursor_start)::integer - 1) % months) <> anchor loop
    cursor_start := (cursor_start - interval '1 month')::date;
  end loop;

  cursor_end := (cursor_start + (months || ' months')::interval - interval '1 day')::date;
  closes := case when p_closes_day = 0 then cursor_end
                 else least(cursor_end, (cursor_start + ((p_closes_day - 1) || ' days')::interval)::date) end;

  /* If that period has not closed yet, the one before it is the latest. */
  if closes > p_on then
    cursor_start := (cursor_start - (months || ' months')::interval)::date;
    cursor_end := (cursor_start + (months || ' months')::interval - interval '1 day')::date;
    closes := case when p_closes_day = 0 then cursor_end
                   else least(cursor_end, (cursor_start + ((p_closes_day - 1) || ' days')::interval)::date) end;
  end if;

  /* Never before the contract started. A first period that reaches back past
     the agreement would settle orders nobody agreed terms for. */
  if cursor_end < p_starts then return; end if;
  period_start := greatest(cursor_start, p_starts);
  period_end := cursor_end;
  closed_on := closes;
  return next;
end $$;

/* When the next run would pick this partner up, so the screen can say so
   rather than leaving a desk to work it out from a frequency and a day. */
create or replace function public.next_settlement_close(p_partner text, p_on date default current_date)
returns date language plpgsql stable as $$
declare
  t public.partner_settlement_terms;
  p record;
  months integer;
begin
  select * into t from public.partner_settlement_terms where partner_id = p_partner;
  if t.partner_id is null then return null; end if;
  months := public.cycle_months(t.frequency);

  select * into p from public.settlement_period(t.frequency, t.align, t.starts_on, t.closes_on_day, p_on);
  if p.closed_on is null then
    /* Not yet started. The first close is the end of the first period. */
    select * into p from public.settlement_period(
      t.frequency, t.align, t.starts_on, t.closes_on_day,
      (t.starts_on + (months || ' months')::interval)::date);
    return p.closed_on;
  end if;
  select * into p from public.settlement_period(
    t.frequency, t.align, t.starts_on, t.closes_on_day,
    (p.period_end + (months || ' months')::interval)::date);
  return p.closed_on;
end $$;

/* ---- 3. Statements learn their dates ------------------------------------------ */

alter table public.settlement_statements
  add column if not exists period_start date,
  add column if not exists period_end   date,
  add column if not exists frequency    text,
  add column if not exists closed_on    date,
  add column if not exists due_on       date,
  add column if not exists held_back    numeric(12,2) not null default 0,
  add column if not exists carried_in   numeric(12,2) not null default 0,
  add column if not exists carried_out  numeric(12,2) not null default 0,
  add column if not exists run_id       text;

comment on column public.settlement_statements.held_back is
  'Earned in this period and not yet payable — inside the hold window. It is '
  'carried into the next statement rather than paid and clawed back.';

/* ---- 4. Runs ------------------------------------------------------------------ */

create table if not exists public.settlement_run (
  id           text primary key,
  ran_on       date not null,
  kind         text not null default 'scheduled' check (kind in ('scheduled','manual','catch-up')),
  ran_by       text not null,
  status       text not null default 'complete' check (status in ('complete','partial','failed')),
  considered   integer not null default 0,
  settled      integer not null default 0,
  /* Named rather than counted. "Three partners were skipped" is not something
     anybody can act on. */
  skipped      jsonb not null default '[]'::jsonb,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  note         text
);

alter table public.settlement_statements
  drop constraint if exists settlement_statements_run_fkey;
alter table public.settlement_statements
  add constraint settlement_statements_run_fkey
  foreign key (run_id) references public.settlement_run(id) on delete set null;

/* One statement per partner per period. A run that fires twice must not pay
   twice, and this is what makes that true rather than the code being careful. */
create unique index if not exists settlement_one_per_period
  on public.settlement_statements (partner_id, period_start, period_end)
  where period_start is not null;

/* ---- 5. RLS ------------------------------------------------------------------- */

alter table public.partner_settlement_terms enable row level security;
alter table public.settlement_run enable row level security;

drop policy if exists operator_all_settlement_terms on public.partner_settlement_terms;
create policy operator_all_settlement_terms on public.partner_settlement_terms
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A seller reads their own terms and cannot change them. When they get paid is
   a term of the contract, not a setting — but they are entitled to see it, and
   "when am I paid" is the commonest question a partner desk gets. */
drop policy if exists partner_read_own_settlement_terms on public.partner_settlement_terms;
create policy partner_read_own_settlement_terms on public.partner_settlement_terms
  for select using (partner_id = current_partner_id());

drop policy if exists operator_all_settlement_run on public.settlement_run;
create policy operator_all_settlement_run on public.settlement_run
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

grant select, insert, update on public.partner_settlement_terms to authenticated;
grant select, insert, update on public.settlement_run to authenticated;
grant execute on function public.settlement_period(text,text,date,integer,date) to authenticated;
grant execute on function public.next_settlement_close(text,date) to authenticated;
grant execute on function public.cycle_months(text) to authenticated;
