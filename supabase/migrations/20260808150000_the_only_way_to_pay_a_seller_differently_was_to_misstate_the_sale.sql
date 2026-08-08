/* The only way to pay a seller differently was to misstate the sale.
 *
 * A settlement statement has gross, commission, fees, refunds and withholding.
 * Every one of those is derived from trade that happened. So when the
 * marketplace owes a seller something that is not about a sale — commission
 * charged at the wrong rate for a month, a promotion the marketplace agreed to
 * fund, a fee billed twice, an SLA penalty in the contract, a chargeback whose
 * loss follows the sale — there is nowhere to put it.
 *
 * There are two ways that goes wrong in practice and the marketplace has no
 * defence against either. Somebody adjusts the commission rate on the statement,
 * so the seller's own reconciliation against their contracted rate fails and
 * they open a dispute about a rate nobody changed. Or somebody nets it into
 * `fees`, where it is indistinguishable from a platform fee and cannot be
 * explained, appealed or reversed.
 *
 * A credit or debit note is the alternative: a separate, reasoned, evidenced,
 * approved instrument that changes what the next run pays without changing what
 * the sale was.
 *
 * Three things this carries that the shape usually loses:
 *
 * A NOTE NEVER MOVES MONEY ON ITS OWN. It changes the balance the next
 * settlement run pays or collects, which is why it has to be raised before the
 * run closes and why an applied note is frozen with the statement it landed on.
 *
 * THE SECOND APPROVER HAS TO BE A DIFFERENT PERSON. Every marketplace has an
 * approval threshold and most of them can be satisfied by the person who raised
 * the note clicking approve twice. That is the control failing silently, and it
 * is enforced here rather than described.
 *
 * THE THRESHOLDS ARE IN ONE CURRENCY, AND IT IS THE STATEMENT'S. Every
 * statement is denominated in USD with the payout currency held separately, so
 * a threshold of 5,000 means the same thing to every seller. A threshold in
 * "the seller's money" would mean an Emirati seller and a Kenyan one face
 * different scrutiny for the same commercial event.
 */

/* ---- 1. What a note can be about ---------------------------------------------- */

create table if not exists public.note_reason (
  id          text primary key,
  kind        text not null check (kind in ('credit', 'debit')),
  label       text not null,
  /* Guidance for whoever raises it, in the terms the argument will be had in.
     A reason code with no guidance gets used for everything. */
  guidance    text not null,
  /* Some reasons are meaningless without pointing at something. A chargeback
     without an order is not a chargeback, it is an assertion. */
  needs_ref   boolean not null default false,
  ref_label   text,
  active      boolean not null default true,
  sort_order  integer not null default 0
);

insert into public.note_reason (id, kind, label, guidance, needs_ref, ref_label, sort_order) values
  ('comm-rate',   'credit', 'Commission charged at the wrong rate',
   'Our error. Correct it in full and do not net it against anything else — a seller reconciling against their contracted rate has to be able to see the whole correction.',
   true, 'The statement that was charged wrongly', 1),
  ('overcharge',  'credit', 'Fee billed twice',
   'A duplicate charge. Reverse the whole amount rather than the net, so the duplicate and its reversal both appear.',
   true, 'The statement carrying the duplicate', 2),
  ('promo-share', 'credit', 'Agreed promotion funding',
   'A discount the marketplace committed to fund. It belongs on a note rather than hidden in the commission line, because the seller agreed to a promotion and not to a rate change.',
   true, 'The campaign', 3),
  ('goodwill',    'credit', 'Goodwill contribution',
   'The marketplace absorbing a cost the seller would otherwise carry, usually to keep a buyer. Say what was kept.',
   false, null, 4),
  ('sla-penalty', 'debit',  'SLA penalty',
   'A fulfilment or response commitment was missed. The penalty has to be in the contract to be raised, and the clause goes in the reference.',
   true, 'The contract clause', 5),
  ('chargeback',  'debit',  'Chargeback recovered',
   'A buyer''s bank reversed a payment on the seller''s product. The loss follows the sale.',
   true, 'The order', 6),
  ('undercharge', 'debit',  'Fee not billed',
   'A charge that should have been raised in an earlier period. Name the period — a seller cannot check a charge with no date on it.',
   true, 'The period it belongs to', 7)
on conflict (id) do nothing;

/* ---- 2. Who may approve what -------------------------------------------------- */

create table if not exists public.note_policy (
  id            text primary key default 'standard',
  /* All in USD, the currency every statement is denominated in. */
  currency      text not null default 'USD',
  auto_approve_below      numeric(12,2) not null,
  second_approval_above   numeric(12,2) not null,
  require_evidence_above  numeric(12,2) not null,
  void_window_days        integer not null check (void_window_days > 0),
  tax_treatment text not null,
  settle_on     text not null,
  note          text not null,
  check (auto_approve_below <= second_approval_above)
);

insert into public.note_policy
  (id, currency, auto_approve_below, second_approval_above, require_evidence_above,
   void_window_days, tax_treatment, settle_on, note)
values ('standard', 'USD', 250.00, 5000.00, 1000.00, 30,
  'Tax is restated on the note at the rate that applied to the original charge, not today''s rate. A correction to March is a March document.',
  'The next settlement run for that seller',
  'A note never moves money on its own. It changes the balance the next settlement run pays or collects, which is why it has to be raised before that run closes.')
on conflict (id) do nothing;

/* ---- 3. The notes ------------------------------------------------------------- */

create table if not exists public.settlement_note (
  id           text primary key,
  partner_id   text not null references public.partners(id),
  kind         text not null check (kind in ('credit', 'debit')),
  reason_id    text not null references public.note_reason(id),

  /* Always positive. Which way it moves is `kind`, because a signed amount
     beside a kind is two places to get the direction wrong. */
  amount       numeric(12,2) not null check (amount > 0),
  currency     text not null default 'USD',
  /* Restated at the rate that applied to the original charge. */
  tax          numeric(12,2) not null default 0 check (tax >= 0),
  tax_rate     numeric(5,2),

  period       text,
  ref          text,
  evidence     text,
  detail       text not null,

  state        text not null default 'draft'
               check (state in ('draft', 'pending', 'issued', 'applied', 'void', 'disputed')),

  raised_by    text not null,
  raised_on    date not null default current_date,
  approved_by  text,
  approved_on  date,
  /* Only above the threshold, and never the same person as either of the
     other two. */
  second_approved_by text,
  second_approved_on date,

  statement_id text references public.settlement_statements(id),
  applied_on   date,
  void_reason  text,
  void_on      date,
  disputed_on  date,
  dispute_note text,

  created_at   timestamptz not null default now()
);

create index if not exists settlement_note_partner_idx on public.settlement_note (partner_id, state);

/* Where a note lands. `fees` would hide it among platform charges and the
   commission line would misstate the rate, so it gets its own pair — a figure
   and the notes behind it, exactly as withholding does. */
alter table public.settlement_statements
  add column if not exists adjustments numeric(12,2) not null default 0,
  add column if not exists adjustment_detail jsonb not null default '[]'::jsonb;

/* ---- 4. The rules, enforced --------------------------------------------------- */

create or replace function public.guard_settlement_note()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare
  pol public.note_policy;
  r   public.note_reason;
  st  public.settlement_statements;
begin
  select * into pol from public.note_policy where id = 'standard';
  select * into r from public.note_reason where id = new.reason_id;

  /* A credit reason on a debit note is somebody picking from the wrong list,
     and the resulting note argues for the opposite of what it does. */
  if r.kind is distinct from new.kind then
    raise exception '"%" is a % reason and this is a % note.', r.label, r.kind, new.kind;
  end if;
  if not r.active then
    raise exception '"%" is no longer a reason a note may be raised under.', r.label;
  end if;
  if r.needs_ref and coalesce(trim(new.ref), '') = '' then
    raise exception 'A note for "%" has to name %. Without it the seller cannot check the claim.',
      r.label, coalesce(r.ref_label, 'what it is against');
  end if;
  if coalesce(trim(new.detail), '') = '' then
    raise exception 'Say what this note is for. A note the seller cannot understand comes back as a dispute.';
  end if;

  /* One currency, and it is the one statements are denominated in. */
  if new.currency <> pol.currency then
    raise exception 'A note is raised in %, the currency every statement is denominated in. The seller''s payout currency is applied when the run pays it.', pol.currency;
  end if;

  if new.amount >= pol.require_evidence_above and coalesce(trim(new.evidence), '') = '' then
    raise exception
      'A note of % % or more needs evidence on it. This one is % and cites nothing.',
      pol.require_evidence_above, pol.currency, new.amount;
  end if;

  /* Nobody approves their own note. This is the control that everything else
     here rests on, and the one that is usually a sentence in a policy document
     rather than a check. */
  if new.approved_by is not null and new.approved_by = new.raised_by then
    raise exception '% raised this note and cannot also approve it.', new.raised_by;
  end if;
  if new.second_approved_by is not null then
    if new.second_approved_by in (new.raised_by, coalesce(new.approved_by, '')) then
      raise exception
        'A second approval has to come from a third person. % has already raised or approved this note.',
        new.second_approved_by;
    end if;
    if new.approved_by is null then
      raise exception 'A note cannot have a second approval and no first one.';
    end if;
  end if;

  /* And above the ceiling it is not issued until both have signed. */
  if new.state in ('issued', 'applied') then
    if new.amount >= pol.second_approval_above and new.second_approved_by is null then
      raise exception
        'A note of % % or more needs a second approver. This one is % and has %.',
        pol.second_approval_above, pol.currency, new.amount,
        coalesce(new.approved_by, 'none');
    end if;
    if new.amount >= pol.auto_approve_below and new.approved_by is null then
      raise exception 'A note of % % or more is not issued without an approver.',
        pol.auto_approve_below, pol.currency;
    end if;
  end if;

  /* A note that has settled is part of a statement. Once that statement is
     approved or paid it is a document somebody has signed off, and the note
     inside it stops being editable with it. */
  if tg_op = 'UPDATE' and old.state = 'applied' then
    select * into st from public.settlement_statements where id = old.statement_id;
    if st.status in ('approved', 'paid') then
      if new.amount is distinct from old.amount or new.kind is distinct from old.kind
         or new.state is distinct from old.state or new.reason_id is distinct from old.reason_id then
        raise exception
          '% has settled on %, which is %. Raise a new note the other way rather than editing this one.',
          old.id, old.statement_id, st.status;
      end if;
    end if;
  end if;

  if tg_op = 'UPDATE' and new.state = 'void' and old.state = 'applied' then
    raise exception 'A note that has settled cannot be voided. Reverse it with a note the other way.';
  end if;
  if new.state = 'void' and coalesce(trim(new.void_reason), '') = '' then
    raise exception 'Say why the note is being voided. It is retained either way.';
  end if;
  if tg_op = 'UPDATE' and new.state = 'void'
     and new.void_on > old.raised_on + pol.void_window_days then
    raise exception 'The void window is % days and this note was raised on %.',
      pol.void_window_days, old.raised_on;
  end if;

  return new;
end $$;

drop trigger if exists z_guard_settlement_note on public.settlement_note;
create trigger z_guard_settlement_note
  before insert or update on public.settlement_note
  for each row execute function public.guard_settlement_note();

/* ---- 5. Raising, approving, voiding -------------------------------------------- */

/* Approval, with the threshold doing the deciding rather than the caller. The
 * caller says who they are; what that signature is worth is the policy's answer.
 */
create or replace function public.approve_note(p_id text, p_actor text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare n public.settlement_note; pol public.note_policy;
begin
  if current_persona() is distinct from 'operator' then
    raise exception 'Only the marketplace approves a note against a seller.';
  end if;
  select * into n from public.settlement_note where id = p_id;
  if n.id is null then return jsonb_build_object('ok', false, 'why', 'No such note.'); end if;
  select * into pol from public.note_policy where id = 'standard';

  if n.state in ('applied', 'void') then
    return jsonb_build_object('ok', false, 'why', format('%s is already %s.', p_id, n.state));
  end if;
  if n.state = 'disputed' then
    return jsonb_build_object('ok', false, 'why',
      'The seller has challenged this note. It does not settle while the dispute is open.');
  end if;

  if n.approved_by is null then
    update public.settlement_note set
      approved_by = p_actor, approved_on = current_date,
      state = case when amount >= pol.second_approval_above then 'pending' else 'issued' end
     where id = p_id;
  elsif n.second_approved_by is null and n.amount >= pol.second_approval_above then
    update public.settlement_note set
      second_approved_by = p_actor, second_approved_on = current_date, state = 'issued'
     where id = p_id;
  else
    return jsonb_build_object('ok', false, 'why', format('%s is already approved.', p_id));
  end if;

  select * into n from public.settlement_note where id = p_id;
  return jsonb_build_object('ok', true, 'state', n.state,
    'why', case when n.state = 'pending'
                then format('Approved by %s. Above %s %s, so it waits for a second approver.',
                            p_actor, pol.second_approval_above, pol.currency)
                else format('Issued. It applies at %s.', lower(pol.settle_on)) end);
end $$;

grant execute on function public.approve_note(text, text) to authenticated;

/* ---- 6. Applying them at the run ---------------------------------------------- */

/* The half that makes any of it real. An issued note sits there for ever unless
 * the run picks it up, and a screen full of approved notes that never reach a
 * statement is the same as no notes at all.
 */
create or replace function public.apply_notes(p_statement text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  st  public.settlement_statements;
  n   public.settlement_note;
  adj numeric := 0;
  det jsonb := '[]'::jsonb;
  cnt int := 0;
begin
  select * into st from public.settlement_statements where id = p_statement;
  if st.id is null then return jsonb_build_object('ok', false, 'why', 'No such statement.'); end if;
  if st.status in ('approved', 'paid') then
    return jsonb_build_object('ok', false, 'why',
      format('%s is %s. A note cannot be added to a statement that has been signed off.', p_statement, st.status));
  end if;

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
    cnt := cnt + 1;
  end loop;

  if cnt = 0 then
    return jsonb_build_object('ok', true, 'applied', 0, 'why', 'No issued notes for that seller.');
  end if;

  update public.settlement_statements set
    adjustments = adj,
    adjustment_detail = det,
    net = round(gross - commission - fees - refunds - withholding + adj, 2),
    payout_net = round((gross - commission - fees - refunds - withholding + adj) * fx_rate, 2)
   where id = p_statement;

  return jsonb_build_object('ok', true, 'applied', cnt, 'adjustment', adj);
end $$;

grant execute on function public.apply_notes(text) to authenticated;

/* And the run does it without being asked, straight after it writes the
 * statement, so a note raised before the close always lands.
 *
 * The existing run is renamed rather than rewritten. It is two hundred lines of
 * period arithmetic, withholding and carry-forward that this change has nothing
 * to say about, and retyping it to add one loop is how a working function
 * acquires a typo.
 */
do $$ begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'run_settlements_core'
  ) then
    alter function public.run_settlements(date, text, text, text)
      rename to run_settlements_core;
  end if;
end $$;

create or replace function public.run_settlements(
  p_as_of date default current_date,
  p_actor text default 'Settlement scheduler',
  p_kind  text default 'scheduled',
  p_only  text default null
) returns jsonb
language plpgsql security definer set search_path to 'public' as $$
declare res jsonb; s record;
begin
  res := public.run_settlements_core(p_as_of, p_actor, p_kind, p_only);
  for s in
    select id from public.settlement_statements
     where run_id = res ->> 'run_id' and (res ->> 'run_id') is not null
  loop
    perform public.apply_notes(s.id);
  end loop;
  return res;
end $$;

grant execute on function public.run_settlements(date,text,text,text) to authenticated;

/* ---- 7. Who may see and do what ----------------------------------------------- */

alter table public.settlement_note enable row level security;
alter table public.note_reason enable row level security;
alter table public.note_policy enable row level security;

drop policy if exists operator_all_notes on public.settlement_note;
create policy operator_all_notes on public.settlement_note
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

/* A seller reads a note raised against them once it is issued — not while it is
   a draft, because a draft is somebody thinking. And they may dispute it, which
   is the only column they can move. */
drop policy if exists partner_reads_own_notes on public.settlement_note;
create policy partner_reads_own_notes on public.settlement_note for select using (
  partner_id = current_partner_id() and state <> 'draft'
);
drop policy if exists partner_disputes_own_notes on public.settlement_note;
create policy partner_disputes_own_notes on public.settlement_note for update using (
  partner_id = current_partner_id() and state in ('issued', 'applied')
) with check (partner_id = current_partner_id());

create or replace function public.guard_partner_note_edit()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if current_persona() is distinct from 'partner' then return new; end if;
  if new.state <> 'disputed' then
    raise exception 'A seller may dispute a note. Everything else about it is the marketplace''s.';
  end if;
  if coalesce(trim(new.dispute_note), '') = '' then
    raise exception 'Say what is wrong with %. A dispute with no reason cannot be investigated.', old.id;
  end if;
  if new.amount is distinct from old.amount or new.kind is distinct from old.kind
     or new.reason_id is distinct from old.reason_id or new.detail is distinct from old.detail then
    raise exception 'Disputing a note does not change what it says.';
  end if;
  return new;
end $$;

drop trigger if exists z_guard_partner_note_edit on public.settlement_note;
create trigger z_guard_partner_note_edit
  before update on public.settlement_note
  for each row execute function public.guard_partner_note_edit();

drop policy if exists everyone_reads_note_reason on public.note_reason;
create policy everyone_reads_note_reason on public.note_reason for select using (true);
drop policy if exists everyone_reads_note_policy on public.note_policy;
create policy everyone_reads_note_policy on public.note_policy for select using (true);
drop policy if exists operator_writes_note_reason on public.note_reason;
create policy operator_writes_note_reason on public.note_reason
  for all using (current_persona() = 'operator') with check (current_persona() = 'operator');

grant select on public.note_reason, public.note_policy to authenticated;
grant insert, update on public.note_reason to authenticated;
grant select, insert, update on public.settlement_note to authenticated;
