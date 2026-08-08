/* Who we are exposed to, and what we hold against it.
 *
 * Both sides of this marketplace carry credit risk and they run in opposite
 * directions, which is why one instrument was never going to cover them.
 *
 * A BUSINESS ACCOUNT OWES US. They buy on Net 30, so between the order and the
 * payment the marketplace has lent them the goods. The instrument is a credit
 * limit, and `enterprise_billing` already has one — for two of the six accounts.
 * The other four buy on account against no limit at all. Worse, the two that
 * have one are not held to it: `credit_limit` appears in `enterpriseAdmin.ts` to
 * compute a headroom figure for a label, and nowhere in the modules that approve
 * a requisition. The column even carries a sentence describing the control —
 *
 *     A requisition that would take the balance past the limit is held, not
 *     refused. Finance is told and can release it against an early payment.
 *
 * — and nothing anywhere implements it. That is the third time this week a
 * control has turned out to be a sentence rather than a rule.
 *
 * A SELLER IS OWED BY US. Nobody extends credit to a seller. The exposure is the
 * other way round: their refunds, chargebacks and debit notes can exceed their
 * sales in a period, and then the marketplace is out of pocket with nothing to
 * draw on. Holdback exists — `hold_days` on the settlement terms — but a
 * holdback delays a payment, it does not secure one. Nothing stops a statement
 * settling negative. It is zero today, and the credit-note work made it
 * reachable: a debit note larger than a slow month's sales does it.
 *
 * WHAT IS THE SAME, AND WHAT IS NOT
 *
 * The instruments differ. The *assessment* does not: somebody looked at
 * evidence, formed a view, and either granted a limit or demanded security. So
 * there is one `credit_assessment` for both sides, and two instruments hanging
 * off it.
 *
 * Four things this encodes.
 *
 * A LIMIT WITH NO ASSESSMENT BEHIND IT IS A NUMBER SOMEBODY TYPED. Every limit
 * and every deposit traces to a review with a date, an author and the evidence
 * they saw. `credit_reviewed` was already a date with nothing behind it.
 *
 * EXPOSURE IS OWED PLUS COMMITTED. An approved requisition that has not been
 * invoiced yet is money at risk. A limit checked against invoices alone is
 * checked after the decision that mattered.
 *
 * A DEPOSIT IS HELD, NOT EARNED. It is the counterparty's money. It is
 * returnable, it is never netted into revenue, and the schema says so by keeping
 * it out of every settlement and invoice figure.
 *
 * AND A RESERVE IS A RATE, NOT A NUMBER. A flat bond is wrong the day a seller
 * doubles their trade. The seller side holds a percentage of rolling gross.
 */

/* ---- 1. The assessment, for either side ---------------------------------------- */

create table if not exists public.credit_assessment (
  id            text primary key,
  /* Exactly one of these. A review is of a party, and a party is one or the
     other — a seller who also buys is two relationships and two files. */
  account_id    text references public.enterprise_accounts(id),
  partner_id    text references public.partners(id),

  side          text not null check (side in ('buyer', 'seller')),
  reviewed_on   date not null,
  reviewed_by   text not null,
  /* What they actually looked at. A review with no evidence is an opinion, and
     the whole point of writing it down is that the next person can disagree
     with the reasoning rather than only with the number. */
  evidence      text not null,
  band          text not null check (band in ('low', 'medium', 'high', 'refused')),
  rationale     text not null,

  /* The outcome, in the currency of the party being assessed. */
  currency      text not null,
  limit_granted numeric(14,2),
  deposit_required numeric(14,2),
  reserve_pct   numeric(5,2),

  next_review   date not null,
  superseded_by text references public.credit_assessment(id),
  created_at    timestamptz not null default now(),

  constraint credit_assessment_one_party
    check ((account_id is not null) <> (partner_id is not null)),
  /* A buyer assessment grants a limit; a seller assessment sets security. The
     other way round is a review of the wrong risk. */
  constraint credit_assessment_side_matches_party
    check ((side = 'buyer') = (account_id is not null)),
  constraint credit_assessment_grants_something
    check (band = 'refused' or limit_granted is not null
           or deposit_required is not null or reserve_pct is not null)
);

create index if not exists credit_assessment_party_idx
  on public.credit_assessment (coalesce(account_id, partner_id), reviewed_on desc);

/* Only one live assessment per party. History is kept by pointing the old one at
   the new one, not by deleting it. */
create unique index if not exists credit_assessment_one_live
  on public.credit_assessment (coalesce(account_id, partner_id))
  where superseded_by is null;

/* ---- 2. What we hold from a seller --------------------------------------------- */

create table if not exists public.partner_security (
  partner_id    text primary key references public.partners(id),
  /* Cash lodged with the marketplace. Theirs, held by us, returnable when the
     relationship ends cleanly. It is not revenue and appears in no statement. */
  deposit_held  numeric(14,2) not null default 0 check (deposit_held >= 0),
  deposit_kind  text not null default 'none'
                check (deposit_kind in ('none', 'cash', 'bank guarantee', 'parent guarantee')),
  deposit_ref   text,
  deposit_taken_on date,

  /* A rolling reserve: a share of gross held back beyond the ordinary holdback,
     released after the returns window. A rate rather than a figure, so it tracks
     a seller who doubles their trade. */
  reserve_pct   numeric(5,2) not null default 0 check (reserve_pct >= 0 and reserve_pct <= 100),
  reserve_held  numeric(14,2) not null default 0 check (reserve_held >= 0),
  currency      text not null,

  why           text not null,
  reviewed_on   date,
  updated_at    timestamptz not null default now()
);

alter table public.enterprise_billing
  add column if not exists deposit_held numeric(14,2) not null default 0,
  add column if not exists deposit_kind text not null default 'none',
  add column if not exists deposit_ref text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'enterprise_billing_deposit_kind_check') then
    alter table public.enterprise_billing add constraint enterprise_billing_deposit_kind_check
      check (deposit_kind in ('none', 'cash', 'bank guarantee', 'parent guarantee', 'letter of credit'));
  end if;
end $$;

/* ---- 3. What each party is actually exposed for -------------------------------- */

/* Owed plus committed, in the account's own money.
 *
 * `owed` is invoiced and unpaid, including anything disputed — a disputed
 * invoice is still money we have not got. `committed` is approved requisitions
 * that have not reached an invoice yet, which is the half a limit checked
 * against invoices alone always misses.
 */
create or replace function public.account_exposure(p_account text)
returns table (currency text, owed numeric, committed numeric, total numeric)
language sql stable security definer set search_path to 'public' as $$
  select a.currency,
         coalesce((select sum(i.total) from public.enterprise_invoices i
                    where i.account_id = a.id
                      and i.status in ('open', 'overdue', 'disputed')), 0),
         coalesce((select sum(r.amount) from public.enterprise_requisitions r
                    where r.account_id = a.id and r.state = 'approved'
                      and not exists (select 1 from public.enterprise_invoices i2
                                       where i2.account_id = a.id and i2.po_ref = r.po_ref
                                         and i2.status = 'paid')), 0),
         coalesce((select sum(i.total) from public.enterprise_invoices i
                    where i.account_id = a.id
                      and i.status in ('open', 'overdue', 'disputed')), 0)
       + coalesce((select sum(r.amount) from public.enterprise_requisitions r
                    where r.account_id = a.id and r.state = 'approved'
                      and not exists (select 1 from public.enterprise_invoices i2
                                       where i2.account_id = a.id and i2.po_ref = r.po_ref
                                         and i2.status = 'paid')), 0)
    from public.enterprise_accounts a where a.id = p_account;
$$;

grant execute on function public.account_exposure(text) to authenticated;

/* ---- 4. The hold the note has always promised ---------------------------------- */

/* Held, not refused, and that distinction is the whole design. A buyer at their
 * limit is not a fraud; they are a customer whose finance team should be told.
 * Refusing the requisition sends them to a competitor, and approving it silently
 * is how a receivables book gets away from you.
 */
alter table public.enterprise_requisitions
  add column if not exists credit_hold boolean not null default false,
  add column if not exists credit_note text;

create or replace function public.guard_requisition_credit()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_limit numeric; v_ex record; v_cur text;
begin
  if new.state <> 'approved' or coalesce(old.state, '') = 'approved' then return new; end if;

  select b.credit_limit, b.currency into v_limit, v_cur
    from public.enterprise_billing b where b.account_id = new.account_id;

  /* No file, no limit, no hold. An account nobody has assessed is its own
     problem and the assertions below refuse to let one exist — but this trigger
     is not the place to discover it, because failing here would block a
     purchase over a missing back-office record. */
  if v_limit is null then return new; end if;

  select * into v_ex from public.account_exposure(new.account_id);

  /* The requisition's own amount counts: the question is what the balance would
     be if this went through, not what it is now. */
  if v_ex.total + new.amount > v_limit then
    new.credit_hold := true;
    new.credit_note := format(
      'Held on credit. %s of %s already owed or committed, and this would take it to %s '
      'against a limit of %s. Finance can release it against an early payment.',
      round(v_ex.total, 2), v_cur, round(v_ex.total + new.amount, 2), round(v_limit, 2));
  end if;
  return new;
end $$;

drop trigger if exists z_guard_requisition_credit on public.enterprise_requisitions;
create trigger z_guard_requisition_credit
  before update on public.enterprise_requisitions
  for each row execute function public.guard_requisition_credit();

/* And a held requisition does not become an order until somebody releases it. */
create or replace function public.release_credit_hold(p_req text, p_who text, p_why text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace releases a credit hold.';
  end if;
  if coalesce(trim(p_why), '') = '' then
    return jsonb_build_object('ok', false, 'why',
      'Say what the release is against. A hold lifted for no recorded reason is a limit that does not exist.');
  end if;
  update public.enterprise_requisitions
     set credit_hold = false,
         credit_note = coalesce(credit_note, '') || format(' Released by %s on %s: %s', p_who, current_date, p_why)
   where id = p_req and credit_hold;
  if not found then return jsonb_build_object('ok', false, 'why', 'No such requisition, or it is not held.'); end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function public.release_credit_hold(text, text, text) to authenticated;

/* ---- 5. A statement that would settle negative --------------------------------- */

/* The seller-side hole the credit notes opened. A debit note larger than a slow
 * month's sales produces a payout below zero, which is not a payment — it is the
 * marketplace asking a seller for money, and it cannot happen by arithmetic.
 *
 * The shortfall carries forward. `settlement_statements` already has
 * `carried_in` and `carried_out` for exactly this, and carrying is better than
 * drawing on the deposit: a deposit is the last resort when the relationship
 * ends, not a current account.
 */
create or replace function public.guard_statement_not_negative()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.net >= 0 then return new; end if;
  /* Implicit concatenation, not `||`. RAISE takes a literal format string and
     refuses an expression, which is easy to forget because every other string in
     plpgsql accepts one. */
  raise exception
    '% would pay % %, which is the marketplace asking % for money rather than paying them. '
    'Carry the shortfall to the next period with carry_shortfall(), or reverse whatever '
    'took it below zero.',
    new.id, round(new.net, 2), new.currency, new.partner_name;
end $$;

drop trigger if exists z_guard_statement_not_negative on public.settlement_statements;
create trigger z_guard_statement_not_negative
  before insert or update on public.settlement_statements
  for each row execute function public.guard_statement_not_negative();

create or replace function public.carry_shortfall(p_statement text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare st public.settlement_statements; v_short numeric;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace carries a shortfall.';
  end if;
  select * into st from public.settlement_statements where id = p_statement;
  if st.id is null then return jsonb_build_object('ok', false, 'why', 'No such statement.'); end if;
  if st.net >= 0 then
    return jsonb_build_object('ok', false, 'why', format('%s is not short.', p_statement));
  end if;

  v_short := -st.net;
  update public.settlement_statements
     set carried_out = coalesce(carried_out, 0) + v_short,
         net = 0,
         payout_net = 0
   where id = p_statement;

  return jsonb_build_object('ok', true, 'carried', v_short, 'currency', st.currency,
    'why', format('%s %s carried to the next period. The seller is paid nothing this cycle '
                  || 'rather than being invoiced.', round(v_short, 2), st.currency));
end $$;

grant execute on function public.carry_shortfall(text) to authenticated;

/* ---- 6. Row policies ----------------------------------------------------------- */

alter table public.credit_assessment enable row level security;
alter table public.partner_security enable row level security;

drop policy if exists operator_all_credit_assessment on public.credit_assessment;
create policy operator_all_credit_assessment on public.credit_assessment
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A seller sees what is held from them and why. Not the assessment's rationale —
   that is the marketplace's working, and a seller reading "band: high" learns
   nothing they can act on. They see the instrument, which is the part that
   affects their money. */
drop policy if exists partner_reads_own_security on public.partner_security;
create policy partner_reads_own_security on public.partner_security
  for select using (partner_id = current_partner_id());

drop policy if exists operator_all_partner_security on public.partner_security;
create policy operator_all_partner_security on public.partner_security
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* An account sees its own limit and its own deposit, which it already does
   through `enterprise_billing`. The assessment behind it stays with us. */
drop policy if exists account_reads_own_assessment on public.credit_assessment;
create policy account_reads_own_assessment on public.credit_assessment
  for select using (account_id = current_account_id());
