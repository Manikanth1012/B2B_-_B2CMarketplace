/*
 * Two bugs that only surfaced once the calendar moved past the seed.
 *
 * 1. The settlement run could not write a statement.
 *
 *    `run_settlements_core` (20260810160000, 20260810180000) writes a `note` on
 *    every statement it creates: "Carried forward: … is below the minimum
 *    payout", or nothing. `settlement_statements` never had that column. Every
 *    period on file had been settled by a seed, so every partner took the
 *    "already settled" branch and no run reached the insert. October 2026 is the
 *    first period the seed did not settle, so the first real run failed with
 *    42703 and took the whole run with it: no seller has been settled since,
 *    and the rolling reserves set on 2026-08-08 have retained nothing (the
 *    credit register reports seven of them as "not being applied").
 *
 *    The column is added. Nothing else about the run changes.
 *
 * 2. A seller who won a dispute over a note could not have it voided.
 *
 *    `guard_settlement_note` refuses a void more than `void_window_days` (30)
 *    after the note was raised. That is right for the desk pulling back a note
 *    on its own say-so; it is wrong for the outcome of a dispute. A note under
 *    dispute sits in `disputed` while the case is worked, and cases routinely
 *    take longer than a month; when the desk decides `upheld_seller`,
 *    `dispute_from_note` voids the note, the guard refuses, and the decision
 *    fails. The seller wins and the chargeback stands. So the window no longer
 *    applies to a note leaving `disputed`: that void is the dispute's decision,
 *    and the dispute was opened while the note was live.
 *
 *    The function is otherwise exactly 20260808150000's.
 *
 * Idempotent, one transaction, ends with a self-check.
 */

begin;

alter table public.settlement_statements add column if not exists note text;

comment on column public.settlement_statements.note is
  'Why the run treated this statement as it did — e.g. carried forward below the minimum payout. Written by run_settlements_core.';

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

  /* Nobody approves their own note. */
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
     approved or paid it is a document somebody has signed off. */
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
  /* The window is for the desk pulling a note back on its own say-so. A note
     leaving `disputed` is being voided by the decision on a dispute opened while
     it was live, however long the case took. */
  if tg_op = 'UPDATE' and new.state = 'void' and old.state <> 'disputed'
     and new.void_on > old.raised_on + pol.void_window_days then
    raise exception 'The void window is % days and this note was raised on %.',
      pol.void_window_days, old.raised_on;
  end if;

  return new;
end $$;

/* ============================================================ self-check === */

do $$
declare v_body text;
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'settlement_statements' and column_name = 'note') then
    raise exception 'settlement_statements has no note column; the settlement run still cannot write';
  end if;

  /* Every column the run inserts exists. */
  if exists (
    select 1 from unnest(array['id','partner_id','partner_name','plan_id','period','period_start','period_end',
                               'frequency','closed_on','due_on','gross','commission','commission_rate','fees',
                               'refunds','withholding','withholding_rate','withholding_detail','net','held_back',
                               'carried_in','carried_out','reserve_withheld','reserve_released','order_count',
                               'currency','payout_currency','fx_rate','fx_as_of','payout_net','status','run_id',
                               'sort_order','note']) c(name)
     where not exists (select 1 from information_schema.columns
                        where table_schema = 'public' and table_name = 'settlement_statements' and column_name = c.name)) then
    raise exception 'settlement_statements is still missing a column run_settlements_core writes';
  end if;

  select pg_get_functiondef(p.oid) into v_body
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'guard_settlement_note';
  if v_body not like '%old.state <> ''disputed''%' then
    raise exception 'guard_settlement_note still refuses to void a disputed note after the window';
  end if;
  if v_body not like '%A note that has settled cannot be voided%' then
    raise exception 'guard_settlement_note lost its other rules';
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'z_guard_settlement_note' and not tgisinternal) then
    raise exception 'z_guard_settlement_note is not on settlement_note';
  end if;
end $$;

commit;
