/* Four kinds of dispute, and nowhere to work three of them.
 *
 * A dispute is money in limbo with somebody waiting for an answer. This
 * marketplace can produce four:
 *
 *   1. A buyer disputes an order against a seller  → `partner_disputes`
 *   2. A business account disputes an invoice      → `enterprise_invoices.status = 'disputed'`
 *   3. A seller disputes a settlement statement    → `settlement_statements.disputed`
 *   4. A seller disputes a credit or debit note    → `settlement_note.state = 'disputed'`
 *
 * Only the first is a record. The other three are a flag and, at best, a
 * sentence. `disputeInvoice` writes `status = 'disputed'` and a note, and
 * nothing anywhere reads it: no owner, no clock, no outcome, no way for the
 * marketplace to answer. `settlement_statements.disputed` is a bare boolean —
 * it does not even carry a reason. Zero invoices are currently disputed, and
 * that is not because buyers are happy; it is because disputing one leads
 * nowhere, so nothing in the demo ever does it.
 *
 * WHAT CHANGES
 *
 * `partner_disputes` is already a well-formed dispute record — reason, detail,
 * claimant, raised, amount, owner, status, due date, outcome, resolution,
 * resolved date. It is not partner-shaped; it is dispute-shaped and happens to
 * have been built for one kind. So it becomes `disputes`, with a `kind` and a
 * `subject_ref`, and the other three raise cases in it.
 *
 * The flags stay where they are. `enterprise_invoices.status = 'disputed'` stops
 * the invoice chasing, `settlement_note.state = 'disputed'` stops the note
 * settling — those are behaviours in their own domain and the dispute case is
 * not the place for them. What the case holds is the part none of them had: who
 * owns the answer, when it is due, what was decided and why.
 *
 * Triggers keep the two in step in one direction each. Raising a dispute at the
 * source opens a case, so nothing raised anywhere is lost. Resolving the case
 * clears the source flag, so an answered dispute does not leave an invoice
 * frozen for ever. One direction each cannot drift; two could.
 *
 * `partner_disputes` survives as a view over `kind = 'order'`, because the
 * seller's own disputes screen reads it and a seller has no business seeing an
 * invoice dispute raised by somebody else's account.
 */

/* ---- 1. The table it always was ------------------------------------------------ */

alter table public.partner_disputes rename to disputes;

alter table public.disputes rename column buyer to claimant;

alter table public.disputes
  add column if not exists kind text not null default 'order',
  add column if not exists subject_ref text,
  add column if not exists account_id text references public.enterprise_accounts(id),
  add column if not exists opened_by text;

alter table public.disputes
  alter column partner_id drop not null,
  alter column order_ref drop not null;

update public.disputes set subject_ref = order_ref where subject_ref is null;

update public.disputes d set account_id = o.account_id
  from public.orders o where o.order_ref = d.order_ref and d.account_id is null;

alter table public.disputes
  alter column subject_ref set not null,
  alter column kind drop default;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'disputes_kind_check') then
    alter table public.disputes add constraint disputes_kind_check
      check (kind in ('order', 'invoice', 'statement', 'note'));
  end if;
  /* An order dispute names an order; the others name whatever they are about.
     Without this the generalisation would let an invoice dispute quietly carry
     an order reference and be read by the seller's screen. */
  if not exists (select 1 from pg_constraint where conname = 'disputes_order_ref_only_on_orders') then
    alter table public.disputes add constraint disputes_order_ref_only_on_orders
      check ((kind = 'order') = (order_ref is not null));
  end if;
end $$;

create index if not exists disputes_kind_status_idx on public.disputes (kind, status);
create unique index if not exists disputes_one_open_per_subject
  on public.disputes (kind, subject_ref)
  where status not in ('resolved', 'rejected');

/* ---- 2. The seller's own screen, unchanged ------------------------------------- */

/* Column-for-column what `partner_disputes` was, so `disputeRepo` and the
   seller's support screen do not know this happened. `claimant` comes back as
   `buyer`, which is what it means for an order dispute. */
create or replace view public.partner_disputes as
  select id, partner_id, order_ref, product_id, category_id, reason, detail,
         claimant as buyer, raised, amount, currency, owner, status, due_on,
         outcome, resolution, resolved_on, sort_order
    from public.disputes
   where kind = 'order';

grant select on public.partner_disputes to authenticated, anon;

/* ---- 3. Raising one from the other three sources ------------------------------- */

/* Shared, because "open a case unless one is already open" is the same sentence
 * four times otherwise, and the fourth copy is where the difference creeps in.
 */
create or replace function public.open_dispute(
  p_kind text, p_ref text, p_claimant text, p_reason text, p_detail text,
  p_amount numeric, p_currency text, p_partner text default null,
  p_account text default null, p_days int default 5
) returns text language plpgsql security definer set search_path to 'public' as $$
declare v_id text;
begin
  select id into v_id from public.disputes
   where kind = p_kind and subject_ref = p_ref and status not in ('resolved', 'rejected');
  if v_id is not null then return v_id; end if;

  v_id := 'DSP-' || lpad(((coalesce(
    (select max(substring(id from 'DSP-(\d+)')::int) from public.disputes where id ~ '^DSP-\d+$'), 2200)
    ) + 1)::text, 4, '0');

  insert into public.disputes (
    id, kind, subject_ref, partner_id, account_id, order_ref, reason, detail,
    claimant, raised, amount, currency, owner, status, due_on, sort_order)
  values (
    v_id, p_kind, p_ref, p_partner, p_account, null, p_reason, p_detail,
    p_claimant, current_date, p_amount, p_currency,
    /* Everything except an order dispute is an argument with the marketplace
       itself, so the marketplace owns the answer. An order dispute is between a
       buyer and a seller and starts with the seller. */
    'marketplace', 'open', current_date + p_days,
    coalesce((select max(sort_order) + 1 from public.disputes), 1));

  return v_id;
end $$;

/* An account disputing what it was billed. */
create or replace function public.dispute_from_invoice()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare acct record;
begin
  if new.status = 'disputed' and old.status is distinct from 'disputed' then
    select * into acct from public.enterprise_accounts where id = new.account_id;
    perform public.open_dispute(
      'invoice', new.id, acct.company,
      'Invoice disputed by the account',
      coalesce(new.note, 'No reason was recorded with the dispute.'),
      new.total, new.currency, null, new.account_id, 7);
  end if;
  return new;
end $$;

drop trigger if exists z_dispute_from_invoice on public.enterprise_invoices;
create trigger z_dispute_from_invoice
  after update on public.enterprise_invoices
  for each row execute function public.dispute_from_invoice();

/* A seller disputing what the marketplace says it owes them. */
create or replace function public.dispute_from_statement()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare nm text;
begin
  if new.disputed and not coalesce(old.disputed, false) then
    select name into nm from public.partners where id = new.partner_id;
    perform public.open_dispute(
      'statement', new.id, coalesce(nm, new.partner_name),
      'Settlement statement disputed by the seller',
      format('%s for %s. Net payable %s %s.', new.id, new.period, new.net, new.currency),
      new.net, new.currency, new.partner_id, null, 5);
  end if;
  return new;
end $$;

drop trigger if exists z_dispute_from_statement on public.settlement_statements;
create trigger z_dispute_from_statement
  after update on public.settlement_statements
  for each row execute function public.dispute_from_statement();

/* A seller disputing an adjustment raised against them. */
create or replace function public.dispute_from_note()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare nm text;
begin
  if new.state = 'disputed' and old.state is distinct from 'disputed' then
    select name into nm from public.partners where id = new.partner_id;
    perform public.open_dispute(
      'note', new.id, coalesce(nm, new.partner_id),
      format('%s note disputed by the seller', initcap(new.kind)),
      coalesce(new.dispute_note, 'No reason was recorded with the dispute.'),
      new.amount, new.currency, new.partner_id, null, 5);
  end if;
  return new;
end $$;

drop trigger if exists z_dispute_from_note on public.settlement_note;
create trigger z_dispute_from_note
  after update on public.settlement_note
  for each row execute function public.dispute_from_note();

/* ---- 4. And answering one ------------------------------------------------------ */

/* Resolving the case clears the flag at the source. An answered dispute that
 * leaves an invoice frozen or a note unsettled has not been answered — it has
 * been filed.
 */
create or replace function public.release_source_on_resolution()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status not in ('resolved', 'rejected') then return new; end if;
  if old.status in ('resolved', 'rejected') then return new; end if;

  if new.kind = 'invoice' then
    /* Back to open, not paid. The argument is over; the money still has to
       move, and deciding that here would be this trigger paying an invoice. */
    update public.enterprise_invoices
       set status = case when due < current_date then 'overdue' else 'open' end
     where id = new.subject_ref and status = 'disputed';

  elsif new.kind = 'statement' then
    update public.settlement_statements set disputed = false
     where id = new.subject_ref and disputed;

  elsif new.kind = 'note' then
    /* Upheld against the seller means the note stands and settles; anything
       else means it does not. The outcome decides, because it is the only
       field that says who won. */
    update public.settlement_note
       set state = case when new.outcome = 'upheld_seller' then 'void' else 'issued' end,
           void_reason = case when new.outcome = 'upheld_seller'
                              then coalesce(new.resolution, 'Withdrawn after the seller disputed it.')
                              else void_reason end,
           void_on = case when new.outcome = 'upheld_seller' then current_date else void_on end
     where id = new.subject_ref and state = 'disputed';
  end if;

  return new;
end $$;

drop trigger if exists z_release_source_on_resolution on public.disputes;
create trigger z_release_source_on_resolution
  after update on public.disputes
  for each row execute function public.release_source_on_resolution();

/* A resolution has to say something. The seller or the account raised it and is
   owed an answer, whichever way it goes. */
create or replace function public.guard_dispute()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if new.status in ('resolved', 'rejected') and coalesce(trim(new.resolution), '') = '' then
    raise exception
      'Say how % was resolved. A closed dispute with no answer on it is a dispute nobody answered.',
      new.id;
  end if;
  if new.status in ('resolved', 'rejected') and new.outcome is null then
    raise exception 'Say which way % went. Without an outcome nobody can tell who paid.', new.id;
  end if;
  if new.resolved_on is not null and new.resolved_on < new.raised then
    raise exception '% cannot be resolved before it was raised.', new.id;
  end if;
  return new;
end $$;

drop trigger if exists z_guard_dispute on public.disputes;
create trigger z_guard_dispute
  before insert or update on public.disputes
  for each row execute function public.guard_dispute();

/* ---- 5. Row policies ----------------------------------------------------------- */

alter table public.disputes enable row level security;

drop policy if exists operator_all_partner_disputes on public.disputes;
drop policy if exists partner_read_own_disputes on public.disputes;

drop policy if exists operator_all_disputes on public.disputes;
create policy operator_all_disputes on public.disputes
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A seller sees disputes against them, of any kind — an order dispute, a
   statement they queried, a note they challenged. Not somebody else's. */
drop policy if exists partner_reads_own_disputes on public.disputes;
create policy partner_reads_own_disputes on public.disputes for select
  using (partner_id = current_partner_id());

/* And an account sees the ones it raised. */
drop policy if exists account_reads_own_disputes on public.disputes;
create policy account_reads_own_disputes on public.disputes for select
  using (account_id = current_account_id());

/* ---- 6. The two that were already raised and had nowhere to go ----------------- */

do $$
declare s record; n record; made text;
begin
  for s in select * from public.settlement_statements where disputed loop
    made := public.open_dispute(
      'statement', s.id, (select name from public.partners where id = s.partner_id),
      'Settlement statement disputed by the seller',
      format('%s for %s. Net payable %s %s. Raised before there was a queue to raise it into, '
             || 'so no reason was captured at the time.', s.id, s.period, s.net, s.currency),
      s.net, s.currency, s.partner_id, null, 5);
    raise notice 'statement % → %', s.id, made;
  end loop;

  for n in select * from public.settlement_note where state = 'disputed' loop
    made := public.open_dispute(
      'note', n.id, (select name from public.partners where id = n.partner_id),
      format('%s note disputed by the seller', initcap(n.kind)),
      coalesce(n.dispute_note, 'No reason was recorded with the dispute.'),
      n.amount, n.currency, n.partner_id, null, 5);
    raise notice 'note % → %', n.id, made;
  end loop;
end $$;

/* ---- 7. What has to be true ---------------------------------------------------- */

do $$
declare bad text; n int;
begin
  /* ASSERT-1: the seller's own screen still sees exactly what it saw. */
  select count(*) into n from public.partner_disputes;
  if n <> 7 then raise exception 'the seller-facing view returns % order disputes, not 7', n; end if;

  /* ASSERT-2: every dispute names something that exists. This is the whole
     point — a case pointing at nothing cannot be worked. */
  select string_agg(d.id || ' → ' || d.kind || ' ' || d.subject_ref, ', ') into bad
    from public.disputes d
   where not case d.kind
       when 'order'     then exists (select 1 from public.orders o where o.order_ref = d.subject_ref)
       when 'invoice'   then exists (select 1 from public.enterprise_invoices i where i.id = d.subject_ref)
       when 'statement' then exists (select 1 from public.settlement_statements s where s.id = d.subject_ref)
       when 'note'      then exists (select 1 from public.settlement_note x where x.id = d.subject_ref)
     end;
  if bad is not null then raise exception 'disputes about things that do not exist: %', bad; end if;

  /* ASSERT-3: every flag that means "disputed" has a case behind it. The three
     that had nowhere to go are the reason this migration exists. */
  select string_agg(x.what, ', ') into bad from (
    select 'invoice ' || i.id as what from public.enterprise_invoices i
     where i.status = 'disputed'
       and not exists (select 1 from public.disputes d where d.kind = 'invoice' and d.subject_ref = i.id)
    union all
    select 'statement ' || s.id from public.settlement_statements s
     where s.disputed
       and not exists (select 1 from public.disputes d where d.kind = 'statement' and d.subject_ref = s.id)
    union all
    select 'note ' || x.id from public.settlement_note x
     where x.state = 'disputed'
       and not exists (select 1 from public.disputes d where d.kind = 'note' and d.subject_ref = x.id)
  ) x;
  if bad is not null then raise exception 'things marked disputed with no case behind them: %', bad; end if;

  /* ASSERT-4: and no two open cases about the same thing. */
  select string_agg(x.kind || ' ' || x.subject_ref, ', ') into bad from (
    select kind, subject_ref from public.disputes
     where status not in ('resolved', 'rejected')
     group by kind, subject_ref having count(*) > 1
  ) x;
  if bad is not null then raise exception 'two open cases about one thing: %', bad; end if;

  /* ASSERT-5: every closed one says what was decided and why. */
  select string_agg(d.id, ', ') into bad from public.disputes d
   where d.status in ('resolved', 'rejected')
     and (coalesce(trim(d.resolution), '') = '' or d.outcome is null);
  if bad is not null then raise exception 'closed disputes with no answer on them: %', bad; end if;

  /* ASSERT-6: and every open one has a clock and a currency. An amount with no
     currency is the defect fixed one migration ago; a claim with no due date is
     one nobody is late on. */
  select string_agg(d.id, ', ') into bad from public.disputes d
   where d.status not in ('resolved', 'rejected') and (d.due_on is null or d.currency is null);
  if bad is not null then raise exception 'open disputes with no clock or no currency: %', bad; end if;

  select count(*) into n from public.disputes;
  raise notice 'disputes: % across % kinds', n, (select count(distinct kind) from public.disputes);
end $$;
