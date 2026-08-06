/* Evidence you can only describe is not evidence.
 *
 * "Ask for a refund" has a field labelled Evidence whose placeholder reads
 * "A photograph or a fault report". It is a single-line text input. So the
 * customer read the words, typed "photo of the cracked casing", and the seller
 * deciding the refund was sent a sentence about a photograph rather than the
 * photograph. Both refund forms — the consumer's and the enterprise's — did
 * this, and so did two of the three ticket forms.
 *
 * `support_attachments` already existed and already worked, for tickets and for
 * partner disputes. What was missing was a third anchor. So this adds one
 * rather than inventing a second attachment table:
 *
 *   ticket_id   -> support_tickets     (raise a ticket, four personas)
 *   dispute_id  -> partner_disputes    (a seller contesting a chargeback)
 *   refund_id   -> refunds             (new — what backs a refund request)
 *
 * Exactly one is set on any row, which is what makes "the files on this case"
 * a single unambiguous query no matter which kind of case it is.
 *
 * The write policies gate on `r.state in ('requested','escalated')` — the two
 * states where the decision has not been taken yet. Once a refund is approved,
 * refunded, declined or partial, the file that would have changed the answer is
 * late, and letting it land afterwards would quietly rewrite the record the
 * decision was made against. Reading stays open for the whole life of the case,
 * because everyone involved needs to see what the decision was made on.
 */

begin;

/* ---- The third anchor ---------------------------------------------------- */

alter table support_attachments
  add column if not exists refund_id text references refunds(id) on delete cascade;

/* ticket_id was NOT NULL when a ticket was the only thing an attachment could
   belong to. The dispute anchor was added later and the column was already
   nullable by then; a refund attachment needs the same. */
alter table support_attachments alter column ticket_id drop not null;

/* The old check named only two of the three anchors, so a refund attachment —
   ticket_id null, dispute_id null, refund_id set — counted zero non-nulls and
   was refused. Dropping it is not tidying: leaving it in place would have made
   every upload on the new screens fail a CHECK constraint at the last step,
   after the file had already gone into storage. */
alter table support_attachments drop constraint if exists support_attachments_belongs_to_one;

alter table support_attachments drop constraint if exists support_attachments_one_anchor;
alter table support_attachments add constraint support_attachments_one_anchor check (
  (ticket_id is not null)::int + (dispute_id is not null)::int + (refund_id is not null)::int = 1
);

create index if not exists support_attachments_refund_idx
  on support_attachments (refund_id) where refund_id is not null;

/* ---- Who may attach, and while the answer is still open ------------------ */

/* A shopper's own refund. `refunds.user_id` is the person who asked. */
drop policy if exists customer_add_refund_evidence on support_attachments;
create policy customer_add_refund_evidence on support_attachments
  for insert to authenticated with check (
    refund_id is not null
    and user_id = auth.uid()
    and exists (
      select 1 from refunds r
      where r.id = refund_id
        and r.user_id = auth.uid()
        and r.state in ('requested', 'escalated')
    )
  );

drop policy if exists customer_read_refund_evidence on support_attachments;
create policy customer_read_refund_evidence on support_attachments
  for select to authenticated using (
    refund_id is not null
    and exists (select 1 from refunds r where r.id = refund_id and r.user_id = auth.uid())
  );

/* A business refund belongs to the account, not to whoever clicked — the
   colleague chasing it next week has to be able to send the delivery note. */
drop policy if exists account_add_refund_evidence on support_attachments;
create policy account_add_refund_evidence on support_attachments
  for insert to authenticated with check (
    refund_id is not null
    and user_id = auth.uid()
    and exists (
      select 1 from refunds r
      where r.id = refund_id
        and r.account_id is not null
        and r.account_id = current_account_id()
        and r.state in ('requested', 'escalated')
    )
  );

drop policy if exists account_read_refund_evidence on support_attachments;
create policy account_read_refund_evidence on support_attachments
  for select to authenticated using (
    refund_id is not null
    and exists (
      select 1 from refunds r
      where r.id = refund_id and r.account_id is not null and r.account_id = current_account_id()
    )
  );

/* The seller deciding it. They can read what was sent — that is the whole point
   — and they can answer with their own, which is how a contested refund stops
   being one person's word. */
drop policy if exists partner_read_refund_evidence on support_attachments;
create policy partner_read_refund_evidence on support_attachments
  for select to authenticated using (
    refund_id is not null
    and exists (
      select 1 from refunds r
      where r.id = refund_id and r.partner_id is not null and r.partner_id = current_partner_id()
    )
  );

drop policy if exists partner_add_refund_evidence on support_attachments;
create policy partner_add_refund_evidence on support_attachments
  for insert to authenticated with check (
    refund_id is not null
    and user_id = auth.uid()
    and exists (
      select 1 from refunds r
      where r.id = refund_id
        and r.partner_id is not null
        and r.partner_id = current_partner_id()
        and r.state in ('requested', 'escalated')
    )
  );

/* Withdrawing your own, while the case is still open. Nobody may remove
   somebody else's, and nobody may remove anything once the decision is made —
   the evidence and the decision have to stay readable together. */
drop policy if exists own_remove_refund_evidence on support_attachments;
create policy own_remove_refund_evidence on support_attachments
  for delete to authenticated using (
    refund_id is not null
    and user_id = auth.uid()
    and exists (select 1 from refunds r where r.id = refund_id and r.state in ('requested', 'escalated'))
  );

/* ---- What this asserts --------------------------------------------------- */

do $$
declare
  n int;
  states text[] := array['requested', 'escalated'];
  s text;
  def text;
begin
  /* Every state the policies name has to be a state a refund can actually be
     in. An earlier draft of this gated on 'rejected' and 'withdrawn', neither
     of which exists — so the policy read as if it protected something and
     protected nothing. */
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'public.refunds'::regclass and conname = 'refunds_state_check';
  foreach s in array states loop
    if position('''' || s || '''' in def) = 0 then
      raise exception 'refund evidence policy names state % which refunds_state_check does not allow', s;
    end if;
  end loop;

  /* The stale two-anchor check is gone. If it is still here, a refund
     attachment cannot be written at all. */
  select count(*) into n from pg_constraint
   where conrelid = 'public.support_attachments'::regclass
     and conname = 'support_attachments_belongs_to_one';
  if n <> 0 then
    raise exception 'the two-anchor check is still in place — refund attachments would fail it';
  end if;

  /* The three-anchor rule accepts a refund row and refuses a row anchored to
     nothing, which is the pair of cases that matters. */
  begin
    insert into support_attachments (id, filename, mime, bytes, kind, uploaded_by, scan, sort_order)
    values ('ATT-assert-none', 'x.png', 'image/png', 1, 'evidence', 'assertion', 'pending', 0);
    raise exception 'an attachment anchored to nothing was accepted';
  exception when check_violation then
    null;
  end;

  select count(*) into n from pg_policies
   where tablename = 'support_attachments' and policyname like '%refund_evidence%';
  if n <> 7 then
    raise exception 'expected 7 refund evidence policies, found %', n;
  end if;
end $$;

commit;
