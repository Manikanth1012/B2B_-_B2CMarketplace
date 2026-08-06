/* A refund that approves itself still has to take the photograph.
 *
 * The evidence policies added a moment ago gate writes on
 * `state in ('requested','escalated')` — the states where the decision has not
 * been taken. That is right for a refund a person decides, and wrong for the
 * ones the marketplace decides on the spot.
 *
 * A refund under the small-claim threshold, or for a reason that is provable
 * from the payment record, is approved *by `requestRefund` itself*, in the same
 * insert. It is never in state 'requested' — not for a second. So the customer
 * picked a photograph, the request was raised and approved, and every file was
 * then refused by RLS and reported back as "1 file did not upload". The screen
 * asked for evidence, took it, and threw it away.
 *
 * Found by submitting one: RFN-8WQ3Y, ₹1,599 against the ₹2,000 threshold,
 * approved on the spot, zero rows in support_attachments.
 *
 * So the buyer's window widens by exactly one case: `approved` where the
 * decider was `auto`. That is the automatic decision taken at raise time, and
 * the files chosen in that submit belong to it. It deliberately does not widen
 * to an approval a seller or the marketplace made later — that decision was
 * taken by somebody reading what was there at the time, and a file arriving
 * afterwards would change the record behind them.
 *
 * `refunded`, `declined` and `partial` stay closed to everyone, and the
 * seller's own window is unchanged: a seller has no reason to file evidence
 * against a refund that already went the buyer's way.
 */

begin;

drop policy if exists customer_add_refund_evidence on support_attachments;
create policy customer_add_refund_evidence on support_attachments
  for insert to authenticated with check (
    refund_id is not null
    and user_id = auth.uid()
    and exists (
      select 1 from refunds r
      where r.id = refund_id
        and r.user_id = auth.uid()
        and (
          r.state in ('requested', 'escalated')
          /* Decided by the system in the same breath as it was raised. */
          or (r.state = 'approved' and r.decider = 'auto')
        )
    )
  );

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
        and (
          r.state in ('requested', 'escalated')
          or (r.state = 'approved' and r.decider = 'auto')
        )
    )
  );

/* Withdrawal follows the same window, so a file you were allowed to send is a
   file you are allowed to take back before anybody has acted on it. */
drop policy if exists own_remove_refund_evidence on support_attachments;
create policy own_remove_refund_evidence on support_attachments
  for delete to authenticated using (
    refund_id is not null
    and user_id = auth.uid()
    and exists (
      select 1 from refunds r
      where r.id = refund_id
        and (
          r.state in ('requested', 'escalated')
          or (r.state = 'approved' and r.decider = 'auto')
        )
    )
  );

do $$
declare
  def text;
  n int;
begin
  /* 'auto' has to be a decider the table actually records, or the widened
     branch is unreachable and this migration changes nothing. */
  select pg_get_constraintdef(oid) into def from pg_constraint
   where conrelid = 'public.refunds'::regclass and conname like '%decider%';
  if def is null or position('''auto''' in def) = 0 then
    raise exception 'refunds.decider does not allow ''auto'' — the widened branch would never match';
  end if;

  /* And there has to be at least one such refund, or the case this migration
     exists for is not a case the seed can demonstrate. */
  select count(*) into n from refunds where state = 'approved' and decider = 'auto';
  if n = 0 then
    raise exception 'no auto-approved refund exists, so this window cannot be exercised';
  end if;
end $$;

commit;
