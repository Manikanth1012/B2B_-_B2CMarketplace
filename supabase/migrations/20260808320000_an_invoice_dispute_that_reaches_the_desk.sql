/* An invoice dispute that reaches the desk.
 *
 * `disputeInvoice` has existed on the enterprise billing screen for a while and
 * no account has ever used it, which reads as "buyers are happy" and is really
 * "the button leads nowhere". Now that it opens a case, the path is worth one
 * real example — not to decorate the queue but because a route with no traffic
 * on it is a route nobody has walked.
 *
 * Raised the way an account raises it: by setting the invoice to `disputed`
 * with a reason. The trigger does the rest, so this seeds the demonstration
 * through the same door a buyer uses rather than writing the case directly. If
 * the trigger were wrong, this migration would fail rather than paper over it —
 * which is the point of seeding it this way.
 *
 * The dispute itself is the commonest kind an account raises: a recurring
 * invoice that bills for seats the account says it gave back.
 */

do $$
declare v_case text; v_before int; v_after int;
begin
  if exists (select 1 from public.disputes where kind = 'invoice') then
    raise notice 'an invoice dispute already exists';
    return;
  end if;

  select count(*) into v_before from public.disputes;

  update public.enterprise_invoices set
    status = 'disputed',
    note = 'Billed for 280 ZTNA seats. Forty were released on 3 July when the Mombasa depot '
           || 'closed and the reduction was acknowledged by the account desk at the time. We '
           || 'accept the balance less those forty seats and will pay that on the due date.'
   where id = 'INV-KE-2026-07';

  select count(*) into v_after from public.disputes;
  if v_after <> v_before + 1 then
    raise exception 'disputing an invoice did not open a case — the trigger is not doing its job';
  end if;

  select id into v_case from public.disputes where kind = 'invoice' and subject_ref = 'INV-KE-2026-07';
  raise notice 'INV-KE-2026-07 disputed → %', v_case;
end $$;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare d record; bad text; n int;
begin
  /* ASSERT-1: the case carries what the desk needs — the account, the money in
     the invoice's own currency, a clock, and the buyer's own words. */
  select * into d from public.disputes where kind = 'invoice' and subject_ref = 'INV-KE-2026-07';
  if d.id is null then raise exception 'no case was opened for INV-KE-2026-07'; end if;
  if d.account_id <> 'ENT-2014' then raise exception 'the case names the wrong account: %', d.account_id; end if;
  if d.currency <> 'KES' then raise exception 'the case is in % against a KES invoice', d.currency; end if;
  if d.due_on is null then raise exception 'the case has no clock on it'; end if;
  if d.detail not like '%Mombasa%' then raise exception 'the buyer''s reason did not reach the case'; end if;
  if d.owner <> 'marketplace' then
    raise exception 'an invoice dispute is an argument with the marketplace and it owns the answer';
  end if;

  /* ASSERT-2: all four kinds are now represented, so no case on the screen is
     drawn against nothing. */
  select string_agg(k, ', ') into bad from unnest(array['order', 'invoice', 'statement', 'note']) k
   where not exists (select 1 from public.disputes d2 where d2.kind = k);
  if bad is not null then raise exception 'kinds with no dispute behind them: %', bad; end if;

  /* ASSERT-3: and the flag and the case agree — an invoice marked disputed with
     an open case, not one without the other. */
  select count(*) into n from public.enterprise_invoices i
    join public.disputes x on x.kind = 'invoice' and x.subject_ref = i.id
   where i.status = 'disputed' and x.status not in ('resolved', 'rejected');
  if n = 0 then raise exception 'no invoice is disputed with a live case against it'; end if;

  raise notice 'disputes: % across all four kinds', (select count(*) from public.disputes);
end $$;
