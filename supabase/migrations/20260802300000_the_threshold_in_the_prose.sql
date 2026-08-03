-- The threshold is written into every requisition, in dollars.
--
-- `enterprise_requisitions.policy_note` is stored prose — the sentence that
-- explained, at the moment the requisition was raised, why it needed a
-- signature. Ten rows carry "At or above the $2,000 threshold", and the
-- threshold beside them now reads ₹2,00,000, so the requisition argues with the
-- screen it is drawn on.
--
-- The same shape as `20260802240000_the_money_in_the_prose_too.sql`, which
-- rewrote the loyalty ledger's notes for the same reason. Stored prose is what
-- somebody read at the time; when the figure it quotes is restated underneath
-- it, the prose has to follow or it stops being a record and becomes a
-- contradiction.
--
-- Rewritten from the account's live threshold rather than by converting the
-- figure in the text: the threshold is a chosen number, and the sentence should
-- quote the one that is actually in force.

do $$
declare r record; n integer := 0;
begin
  for r in
    select q.id, p.threshold, a.currency
      from enterprise_requisitions q
      join enterprise_accounts a on a.id = q.account_id
      join enterprise_approval_policy p on p.account_id = q.account_id
     where q.policy_note ~ '\$[0-9]'
  loop
    update enterprise_requisitions set
      policy_note = regexp_replace(
        policy_note, '\$[0-9,]+(\.[0-9]+)?', money_text(r.threshold, r.currency), 'g')
     where id = r.id;
    n := n + 1;
  end loop;

  raise notice 'restated % policy notes', n;
end $$;

/* -------------------------------------------------------- sanity checks -- */
do $$
declare s text; n integer;
begin
  select string_agg(id || ': ' || policy_note, '; ') into s
    from enterprise_requisitions where policy_note ~ '\$[0-9]';
  if s is not null then raise exception 'these requisitions still quote dollars: %', s; end if;

  /* Where a note quotes a figure, it quotes the one in force. */
  select string_agg(q.id || ': "' || q.policy_note || '" against ' || p.threshold, '; ') into s
    from enterprise_requisitions q
    join enterprise_accounts a on a.id = q.account_id
    join enterprise_approval_policy p on p.account_id = q.account_id
   where q.policy_note ~ 'threshold' and q.policy_note ~ '[0-9]'
     and position(money_text(p.threshold, a.currency) in q.policy_note) = 0;
  if s is not null then raise exception 'these notes name a threshold the account does not have: %', s; end if;

  /* And where it makes a claim without a figure, the claim is still true of the
     restated amount. This is the check worth having: it reads the prose against
     the arithmetic rather than against another string, so it would catch a
     conversion that moved a requisition across its own threshold — which is the
     one thing restating the spend could quietly have done. */
  select string_agg(q.id || ': "' || q.policy_note || '" but the amount is ' || q.amount
                    || ' against a threshold of ' || p.threshold, '; ') into s
    from enterprise_requisitions q
    join enterprise_approval_policy p on p.account_id = q.account_id
   where (q.policy_note ~* 'at or above the threshold' and q.amount < p.threshold)
      or (q.policy_note ~* 'below the threshold'       and q.amount >= p.threshold);
  if s is not null then raise exception 'these notes no longer describe their own requisition: %', s; end if;

  /* Nothing in the business account's stored prose quotes a currency the reader
     is not in. Ranged over every text column that has ever held one rather than
     the ones I remembered — the mistake two migrations back was a hand-written
     list of function names, and this is the same hazard wearing prose. */
  select count(*) into n from (
    select policy_note as t from enterprise_requisitions
    union all select note from enterprise_approval_policy
    union all select at_limit_note from enterprise_billing
    union all select terms from enterprise_billing
    union all select why_suspended from enterprise_subscriptions
    union all select decision_note from enterprise_requisitions
    union all select note from enterprise_invoices
  ) x where x.t ~ '\$[0-9]';
  if n > 0 then raise exception '% stored sentences on the business account still quote dollars', n; end if;

  /* And it found something to check. A sweep over seven columns that matched no
     rows at all would pass for the wrong reason. */
  select count(*) into n from enterprise_requisitions where policy_note ~ 'threshold';
  if n = 0 then raise exception 'no requisition mentions a threshold, so this checked nothing'; end if;
end $$;
