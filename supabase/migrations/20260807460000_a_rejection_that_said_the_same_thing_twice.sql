/* A rejection that said the same thing twice.
 *
 * The clearance queue reads:
 *
 *   "…rejected this invoice (2172). The buyer GSTIN is not active for the date
 *    of supply. Confirm the registration with the customer and resubmit; the
 *    invoice cannot be issued until it clears. It cannot be issued until it
 *    clears."
 *
 * Two pieces of writing, each correct, neither aware of the other. The seeded
 * `failure_reason` carried the consequence, and `canIssue` appends the
 * consequence, because that sentence is the whole point of a before-issue
 * regime and belongs to the code that knows which regime this is rather than to
 * one row of data.
 *
 * So the column keeps what only the portal can say — its own words and the
 * remedy — and stops carrying what the screen already knows. The alternative,
 * having the screen detect the duplicate and drop it, is a string comparison
 * standing in for a decision about who owns which sentence.
 */

update public.einvoice_clearance set
  failure_reason = 'The buyer GSTIN is not active for the date of supply. Confirm the registration with the customer and resubmit.'
where failure_code = '2172';

do $$
declare n int;
begin
  select count(*) into n from public.einvoice_clearance
   where failure_reason is not null and failure_reason ilike '%cannot be issued%';
  if n > 0 then
    raise exception '% rejections still carry the consequence the screen appends', n;
  end if;

  /* And a rejection still says what went wrong and what to do about it. A
     refusal with no next step leaves somebody holding an invoice they cannot
     send and no idea why. */
  select count(*) into n from public.einvoice_clearance
   where status = 'failed' and (failure_reason is null or length(failure_reason) < 20 or failure_code is null);
  if n > 0 then raise exception '% rejections have no usable reason or code', n; end if;
end $$;
