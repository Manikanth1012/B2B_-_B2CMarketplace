/* Twelve subscriptions citing contracts that never existed.
 *
 * `enterprise_subscriptions.contract_ref` has been on the screen since the
 * account console was built. It shows on the subscription detail as "Contract"
 * and under every line on the billing screen. What it holds:
 *
 *   CTR-SB-0361, CTR-SB-0388, CTR-SB-0402, CTR-SB-0412, CTR-SB-0455, CTR-SB-0498
 *   MF-SEC-2025-01, MF-SEC-2025-02, MF-IOT-2025-01
 *   CT-KE-2014-0031, CT-KE-2014-0032, CT-KE-2014-0033
 *
 * Three naming schemes, twelve references, and not one of them resolves to
 * anything — there was no contract table until an hour ago. A buyer reading
 * "Contract: CTR-SB-0412" on their own subscription would reasonably go looking
 * for it, and there has never been anything to find. That is worse than the
 * field being blank, which is the same argument as the download button that
 * produces a placeholder.
 *
 * WHY THEY BECOME THE MASTER AGREEMENT RATHER THAN KEEPING THEIR OWN NUMBER
 *
 * A per-subscription contract number implies a per-subscription negotiation:
 * something was agreed for this service that was not agreed for the others.
 * CR-008 records that this marketplace does not do that — every account buys at
 * the published price for its market. So there is exactly one agreement
 * governing a subscription, which is the master agreement in force on the day it
 * started, and the reference points at it.
 *
 * The old strings are not preserved. They are not data that came from anywhere;
 * they were three invented formats standing in for a table that did not exist,
 * and keeping them in a second column would be keeping a decoy.
 *
 * AND MERIDIAN'S AGREEMENT MOVES FIVE DAYS EARLIER
 *
 * Two of their subscriptions start on 2025-09-01 and the agreement I wrote
 * yesterday starts on the 6th, so the service began before the paper covering
 * it. That happens in life and is a thing worth being able to represent, but
 * here it is not a story about Meridian — it is a date I picked without checking
 * what it had to cover. The term moves to 1 September, which is also when their
 * first invoice period starts.
 */

/* ---- 1. Cover what was already running ----------------------------------------- */

update public.enterprise_contract
   set starts_on = date '2025-09-01',
       ends_on   = date '2026-08-31',
       note      = note || ' The term starts with the first subscriptions on the account rather '
                        || 'than with the countersignature a fortnight earlier.'
 where id = 'CTR-2012-01'
   and starts_on is distinct from date '2025-09-01';

/* ---- 2. Point every subscription at the agreement that governs it -------------- */

/* The one in force on the day the subscription started, not the one in force
 * today. A subscription that began under a superseded agreement began under that
 * agreement, and repointing it at the current one would quietly rewrite what it
 * was bought under.
 */
update public.enterprise_subscriptions s
   set contract_ref = c.id
  from public.enterprise_contract c
 where c.account_id = s.account_id
   and s.started between c.starts_on and c.ends_on
   and s.contract_ref is distinct from c.id;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare bad text; n int;
begin
  /* ASSERT-1: every subscription cites an agreement that exists. This is the
     defect: twelve of twelve did not. */
  select string_agg(format('%s (%s)', s.id, s.contract_ref), ', ') into bad
    from public.enterprise_subscriptions s
   where s.contract_ref is not null
     and not exists (select 1 from public.enterprise_contract c where c.id = s.contract_ref);
  if bad is not null then
    raise exception 'subscriptions citing an agreement that does not exist: %', bad;
  end if;

  /* ASSERT-2: and every one of them cites one. A blank here means a service
     running under nothing, which is the same hole the requisition guard closes
     at the other end. */
  select string_agg(id, ', ') into bad from public.enterprise_subscriptions
   where contract_ref is null;
  if bad is not null then raise exception 'subscriptions running under no agreement: %', bad; end if;

  /* ASSERT-3: the agreement cited actually covered the day the subscription
     started. Pointing every row at the account's current contract would pass
     ASSERT-1 and be a lie about four of them. */
  select string_agg(format('%s started %s, cites %s which ran %s to %s',
                           s.id, s.started, c.id, c.starts_on, c.ends_on), '; ') into bad
    from public.enterprise_subscriptions s
    join public.enterprise_contract c on c.id = s.contract_ref
   where s.started not between c.starts_on and c.ends_on;
  if bad is not null then raise exception 'subscriptions citing an agreement that did not cover them: %', bad; end if;

  /* ASSERT-4: and the account matches. A subscription pointing at somebody
     else's agreement would satisfy all three above. */
  select string_agg(s.id, ', ') into bad
    from public.enterprise_subscriptions s
    join public.enterprise_contract c on c.id = s.contract_ref
   where c.account_id <> s.account_id;
  if bad is not null then raise exception 'subscriptions citing another account''s agreement: %', bad; end if;

  /* ASSERT-5: no invented scheme survives. */
  select count(*) into n from public.enterprise_subscriptions
   where contract_ref ~ '^(CTR-SB-|MF-|CT-KE-)';
  if n <> 0 then raise exception '% subscriptions still carry an invented contract number', n; end if;

  /* ASSERT-6: Meridian's term still ends inside its notice period, because
     moving the start moved the end and the register needs something expiring. */
  select standing into bad from public.account_contract where id = 'CTR-2012-01';
  if bad <> 'expiring' then
    raise exception 'CTR-2012-01 is % after the term moved', bad;
  end if;
end $$;
