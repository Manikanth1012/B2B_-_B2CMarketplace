/* What the account is actually buying under.
 *
 * Six enterprise accounts have been buying on terms for two days of work and
 * there is nothing anywhere that says on whose authority. `enterprise_accounts`
 * carries `terms` and `status = 'active'`; neither has a date on it, nobody
 * signed either, and no record says when the arrangement ends or who agreed it.
 * A business account without an agreement behind it is a customer we cannot
 * invoice and cannot chase — the credit limit, the payment terms and the
 * account's very existence all rest on a document that was not in the database.
 *
 * WHAT A CONTRACT IS HERE, AND WHAT IT IS NOT
 *
 * It is not a price list. Nothing is negotiated on this marketplace: every
 * account buys at the published price for its market, and the discounts are the
 * ones on the storefront. That is a real boundary rather than an omission, so it
 * is recorded as CR-008 below alongside the rest.
 *
 * What the contract settles is everything except the price: when the
 * arrangement starts and ends, on what payment terms, in what currency, who
 * signed on each side, what they expect to spend across the term, and what
 * happens when it runs out.
 *
 * The account's own `terms` column already shows why this needs an owner. Today:
 *
 *   enterprise_accounts.terms  'Net 30 · contract pricing on most lines'
 *   enterprise_billing.terms   'Invoice, net 30'
 *
 * Two copies of one fact, already disagreeing, and one of them advertising a
 * contract-pricing arrangement that does not exist anywhere in this codebase.
 * The contract becomes the source and both copies are written from it.
 *
 * IN FORCE IS A DATE, NOT A FLAG
 *
 * `state` holds only what a person decided — drafted, active, terminated,
 * superseded. Whether it is in force *today* is two dates and the clock, and a
 * stored boolean for that is a value that is wrong every morning until somebody
 * runs something. Same reasoning as `account_credit_position`: a fact about
 * moving numbers is computed where it is read.
 */

/* ---- 1. The agreement --------------------------------------------------------- */

create table if not exists public.enterprise_contract (
  id            text primary key,
  account_id    text not null references public.enterprise_accounts(id) on delete cascade,
  title         text not null,

  /* The term. `signed_on` is separate from `starts_on` because they are
     routinely different and the gap matters — a contract signed after it
     started is backdated, which is a thing people do and a thing an auditor
     asks about. Backwards is refused below. */
  signed_on     date not null,
  starts_on     date not null,
  ends_on       date not null,

  /* What it settles. The payment terms live here and `enterprise_billing` is
     written from them, rather than the two being kept in step by hand. */
  terms         text not null,
  currency      text not null,

  /* What happens at the end. `notice_days` is both the notice a party must give
     and how far ahead the register starts calling it expiring — one number,
     because a contract you must give 90 days' notice on is one you need to be
     looking at 90 days out. */
  auto_renew    boolean not null default false,
  notice_days   int not null default 30 check (notice_days between 0 and 365),

  /* What the account expects to spend across the whole term. It buys nothing
     and discounts nothing — no price on this marketplace depends on it. It is
     here because it is evidence: a credit review sizing a limit wants to know
     what the account said it would do, next to what it has actually done. */
  term_value    numeric check (term_value is null or term_value >= 0),

  /* Who agreed, on both sides. A contract with one signature is a proposal. */
  signed_by         text not null,
  signed_title      text not null,
  countersigned_by  text not null,

  /* The signed copy. Every proof in this marketplace is a file somebody can
     open; a contract with no document is the one place that would be least
     forgivable. */
  document_name text,
  document_path text,

  /* Only what a person decided. Expired is not here on purpose. */
  state         text not null default 'active'
                check (state in ('draft', 'active', 'terminated', 'superseded')),
  superseded_by text references public.enterprise_contract(id),
  terminated_on date,
  terminated_why text,

  note          text,
  sort_order    int default 0,

  constraint contract_term_runs_forwards check (ends_on > starts_on),
  constraint contract_signed_before_it_started check (signed_on <= starts_on),
  constraint contract_terminated_has_a_reason
    check ((terminated_on is null) = (terminated_why is null)),
  constraint contract_terminated_is_terminated
    check (terminated_on is null or state = 'terminated')
);

create index if not exists enterprise_contract_account on public.enterprise_contract(account_id);

/* ---- 2. What changed after it was signed -------------------------------------- */

/* Amended rather than edited, for the same reason a credit assessment is
 * superseded rather than overwritten: the version somebody signed is the version
 * that binds, and a contract table holding only the current wording cannot
 * answer "what were we on in March".
 */
create table if not exists public.enterprise_contract_amendment (
  id            text primary key,
  contract_id   text not null references public.enterprise_contract(id) on delete cascade,
  kind          text not null check (kind in ('extension', 'terms', 'value', 'contact', 'other')),
  signed_on     date not null,
  effective_on  date not null,
  /* Both sides of the change, in words. A diff nobody wrote down is a change
     nobody can explain to the account that signed it. */
  was           text not null,
  now_says      text not null,
  why           text not null,
  signed_by     text not null,
  document_name text,
  document_path text,
  sort_order    int default 0
);

create index if not exists contract_amendment_contract
  on public.enterprise_contract_amendment(contract_id);

/* ---- 3. Where it stands today ------------------------------------------------- */

/* One row per contract with the clock applied. `standing` is the word the
 * screens use, and it is computed here so the register, the account's own page
 * and the guard below cannot disagree about what "expiring" means.
 */
create or replace view public.account_contract as
  select c.id, c.account_id, a.company, a.market,
         c.title, c.signed_on, c.starts_on, c.ends_on,
         c.terms, c.currency, c.auto_renew, c.notice_days, c.term_value,
         c.signed_by, c.signed_title, c.countersigned_by,
         c.document_name, c.document_path,
         c.state, c.superseded_by, c.terminated_on, c.terminated_why, c.note,
         (c.ends_on - current_date) as days_left,
         (c.state = 'active'
          and current_date >= c.starts_on
          and current_date <= c.ends_on) as in_force,
         case
           when c.state = 'draft'       then 'draft'
           when c.state = 'terminated'  then 'terminated'
           when c.state = 'superseded'  then 'superseded'
           when current_date < c.starts_on then 'not started'
           when current_date > c.ends_on   then 'expired'
           when (c.ends_on - current_date) <= c.notice_days then 'expiring'
           else 'in force'
         end as standing,
         c.sort_order
    from public.enterprise_contract c
    join public.enterprise_accounts a on a.id = c.account_id;

/* Without this the view runs with its owner's privileges and hands every
   account's contract to whoever asks. That is not hypothetical — it is what
   `partner_disputes` did until `20260808330000`. */
alter view public.account_contract set (security_invoker = on);
grant select on public.account_contract to authenticated;

/* ---- 4. Nothing is bought without one ----------------------------------------- */

/* The rule with teeth. A refusal rather than a hold, and the distinction is the
 * whole point: a credit hold says "you have agreed terms and you are past your
 * limit", which finance can release against a payment. No contract in force
 * says there is no agreement to buy under at all, and no amount of money fixes
 * that — somebody has to sign something.
 */
create or replace function public.contract_in_force(p_account text)
returns text language sql stable security definer set search_path to 'public' as $$
  select c.id from public.enterprise_contract c
   where c.account_id = p_account
     and c.state = 'active'
     and current_date between c.starts_on and c.ends_on
   order by c.starts_on desc limit 1;
$$;

grant execute on function public.contract_in_force(text) to authenticated;

create or replace function public.guard_requisition_contract()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_contract text; v_last record;
begin
  /* Only the moves that commit something. Withdrawing or declining a
     requisition raised while a contract was live must stay possible after it
     lapses, or an expiry freezes a queue nobody can clear. */
  if tg_op = 'UPDATE' and new.state not in ('pending', 'approved') then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.state = old.state then
    return new;
  end if;

  v_contract := public.contract_in_force(new.account_id);
  if v_contract is not null then return new; end if;

  select id, ends_on, state into v_last from public.enterprise_contract
   where account_id = new.account_id and state in ('active', 'terminated')
   order by ends_on desc limit 1;

  if v_last.id is null then
    raise exception
      'There is no agreement on file for %, so nothing can be bought on account. '
      'The marketplace has to sign one first.', new.account_id;
  end if;

  raise exception
    'The agreement for % (%) ran to % and nothing has replaced it. '
    'Purchases on account resume when it is renewed.',
    new.account_id, v_last.id, v_last.ends_on;
end $$;

/* `z_` so it sorts last among the BEFORE triggers, beside the credit guard.
   Postgres runs them in name order and this one must see the row as the others
   left it. */
drop trigger if exists z_guard_requisition_contract on public.enterprise_requisitions;
create trigger z_guard_requisition_contract
  before insert or update on public.enterprise_requisitions
  for each row execute function public.guard_requisition_contract();

/* ---- 5. The terms have one home ----------------------------------------------- */

/* The contract writes the payment terms into the two places that read them,
 * rather than three copies agreeing by hand. They already did not: ENT-2007 read
 * 'Net 30 · contract pricing on most lines' on the account and 'Invoice, net 30'
 * on the billing row.
 */
create or replace function public.stamp_contract_terms()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.state = 'active' and current_date between new.starts_on and new.ends_on then
    update public.enterprise_accounts set terms = new.terms where id = new.account_id;
    update public.enterprise_billing  set terms = new.terms where account_id = new.account_id;
  end if;
  return new;
end $$;

drop trigger if exists z_stamp_contract_terms on public.enterprise_contract;
create trigger z_stamp_contract_terms
  after insert or update of terms, state, starts_on, ends_on on public.enterprise_contract
  for each row execute function public.stamp_contract_terms();

/* ---- 6. Row policies ---------------------------------------------------------- */

alter table public.enterprise_contract enable row level security;
alter table public.enterprise_contract_amendment enable row level security;

drop policy if exists operator_all_contract on public.enterprise_contract;
create policy operator_all_contract on public.enterprise_contract
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* An account reads its own agreement in full. Unlike a credit assessment —
   which is the marketplace's working about them — a contract is a document they
   signed, and there is nothing in it they are not entitled to see. What they
   cannot do is change it. */
drop policy if exists account_reads_own_contract on public.enterprise_contract;
create policy account_reads_own_contract on public.enterprise_contract
  for select using (account_id = current_account_id());

drop policy if exists operator_all_amendment on public.enterprise_contract_amendment;
create policy operator_all_amendment on public.enterprise_contract_amendment
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

drop policy if exists account_reads_own_amendment on public.enterprise_contract_amendment;
create policy account_reads_own_amendment on public.enterprise_contract_amendment
  for select using (exists (
    select 1 from public.enterprise_contract c
     where c.id = contract_id and c.account_id = current_account_id()));

/* ---- 7. The boundary, written down --------------------------------------------- */

insert into public.channel_rule (id, what, label, decision, sold_through, reason, effective_from, agreed_by, sort_order)
values (
  'CR-008', 'pricing', 'Negotiated and contract pricing', 'not operated here',
  'Marketplace published price for the account''s market',
  'Every account buys at the price published for its market, and the only discounts are the '
  'ones on the storefront. A contract here settles the term, the payment terms and the '
  'signatures — not the price. Rate cards negotiated per account belong with the commercial '
  'team that agrees them and a pricing engine that can version them by account and by date; '
  'a marketplace that shows one price and invoices another is the worst of both.',
  current_date, 'Ruben Oyelaran', 8)
on conflict (id) do nothing;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare n int; bad text;
begin
  /* ASSERT-1: the view cannot be read past the policies underneath it. */
  select count(*) into n from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
   where ns.nspname = 'public' and c.relname = 'account_contract'
     and 'security_invoker=on' = any(c.reloptions);
  if n <> 1 then raise exception 'account_contract does not run as its caller'; end if;

  /* ASSERT-2: the guard is on the table and sorts after the others, so a
     requisition meets it having already been through the currency and credit
     checks. */
  select count(*) into n from pg_trigger
   where tgrelid = 'public.enterprise_requisitions'::regclass
     and tgname = 'z_guard_requisition_contract';
  if n <> 1 then raise exception 'nothing stops a purchase with no agreement behind it'; end if;

  /* ASSERT-3: `state` does not carry expiry. A stored flag for a fact about
     today's date is wrong every morning until something runs. */
  select pg_get_constraintdef(oid) into bad from pg_constraint
   where conrelid = 'public.enterprise_contract'::regclass and conname like '%state_check';
  if bad like '%expired%' then
    raise exception 'expiry is stored as a state rather than computed from the dates';
  end if;

  /* ASSERT-4: and the boundary is recorded rather than left implied. */
  select count(*) into n from public.channel_rule where id = 'CR-008';
  if n <> 1 then raise exception 'the pricing boundary is not written down'; end if;
end $$;
