/* Thirty-four customers who were all the same test.
 *
 * The marketplace has thirty-seven registered shoppers. Three of them are people:
 * Priya Raman in Bengaluru, Wanjiru Kamau in Nairobi, Otieno Odhiambo in Kisumu.
 * The other thirty-four are all called "Integration Shopper", all live in Kochi,
 * all joined in August 2026, and all have addresses like
 * `shopper-msg9z1v3-o3n1@register.integration.test`.
 *
 * They are one registration test, run thirty-four times.
 *
 * `register.integration.test.ts` says what should have happened, in its own
 * header:
 *
 *     Registered addresses cannot be deleted from a client, so the sweep at the
 *     end goes through the management connection the migrations use. Every
 *     address this file creates carries the marker so that sweep can find them.
 *
 * The marker is there. The sweep is not — `afterAll` calls `signOut()` and
 * nothing else. A cleanup was designed, half built, and documented as though it
 * had been finished, and thirty-four accounts accumulated behind it.
 *
 * This is the third one of these. The twenty duplicate orders were a cleanup
 * that reset a pointer and left the order; the order cleanup could not delete
 * because the operator had no policy to; this one was never written at all. The
 * shape is always the same — a test that creates real rows and a tidy-up nobody
 * watches fail, because a cleanup that does nothing looks exactly like a cleanup
 * that worked.
 *
 * WHAT THIS DOES
 *
 * Sweeps them, and gives the test the tool its own comment says it needs so they
 * stop coming back. A migration that only deletes would leave the next run to
 * start the pile again.
 *
 * The function is deliberately narrow: it matches the marker domain and nothing
 * else. A sweep that took a pattern from its caller would eventually be handed
 * `%@%`.
 */

create or replace function public.sweep_test_shoppers()
returns int language plpgsql security definer set search_path to 'public', 'auth' as $$
declare v_ids uuid[]; v_gone int;
begin
  /* The domain is fixed here rather than passed in. This function runs as its
     definer and deletes auth users; the one thing it must never do is accept a
     pattern from whoever calls it.

     An array rather than a temp table: `pg-safeupdate` is on for API roles and
     refuses `delete from _sweep` with no WHERE, which is how the first version
     of this failed — inside a SECURITY DEFINER function, on a table nobody else
     can see, and still correctly refused. */
  select coalesce(array_agg(u.id), '{}') into v_ids
    from auth.users u where u.email like '%@register.integration.test';

  if array_length(v_ids, 1) is null then return 0; end if;

  /* Anything that produced an order is not swept. An order is a record of
     something that happened, and a test that leaves one behind has left
     something worth looking at rather than something worth deleting. */
  if exists (select 1 from public.orders where user_id = any (v_ids)) then
    raise exception 'a test shopper has orders against them — sweeping would orphan an order';
  end if;

  delete from public.loyalty_members           where user_id = any (v_ids);
  delete from public.consumer_addresses        where user_id = any (v_ids);
  delete from public.consumer_payment_methods  where user_id = any (v_ids);
  delete from public.notification_preferences  where user_id = any (v_ids);
  delete from public.cart_items                where user_id = any (v_ids);
  delete from public.wallets                   where user_id = any (v_ids);
  delete from public.consumer_profile          where user_id = any (v_ids);
  delete from public.profiles                  where id      = any (v_ids);

  delete from auth.users where id = any (v_ids);
  get diagnostics v_gone = row_count;

  /* Loyalty rows earlier runs left behind, keyed on a customer id whose account
     is long gone. Recognised by having no sign-in, no account, nothing earned
     and nothing spent — a member who has never done anything is not a member,
     and a real one keyed on `party` alone always has a balance or a ledger. */
  delete from public.loyalty_members m
   where m.user_id is null and m.account_id is null
     and m.balance = 0
     and m.name in ('Integration Shopper', 'Test Shopper', 'Rohan Mehta')
     and not exists (select 1 from public.loyalty_ledger l where l.member = m.id);

  return v_gone;
end $$;

revoke all on function public.sweep_test_shoppers() from public;
grant execute on function public.sweep_test_shoppers() to authenticated;

do $$
declare v_gone int;
begin
  v_gone := public.sweep_test_shoppers();
  raise notice 'swept % test accounts', v_gone;
end $$;

/* ---- What has to be true ------------------------------------------------------- */

do $$
declare n int; bad text;
begin
  /* ASSERT-1: none left, anywhere it could be. */
  select count(*) into n from auth.users where email like '%@register.integration.test';
  if n <> 0 then raise exception '% test accounts survived the sweep', n; end if;

  select count(*) into n from public.consumer_profile where name = 'Integration Shopper';
  if n <> 0 then raise exception '% test shoppers are still on the customer list', n; end if;

  /* ASSERT-2: and the real customers are untouched. A sweep that took the three
     people with it would pass the check above. */
  select string_agg(x.who, ', ') into bad from (
    select w as who from unnest(array['Priya Raman', 'Wanjiru Kamau', 'Otieno Odhiambo']) w
     where not exists (select 1 from public.consumer_profile c where c.name = w)
  ) x;
  if bad is not null then raise exception 'the sweep took real customers with it: %', bad; end if;

  select count(*) into n from public.consumer_profile;
  raise notice 'customers: %', n;

  /* ASSERT-3: nothing was orphaned on the way out. */
  select count(*) into n from public.consumer_profile c
   where c.user_id is not null
     and not exists (select 1 from auth.users u where u.id = c.user_id);
  if n <> 0 then raise exception '% customer records point at a sign-in that no longer exists', n; end if;

  /* Only the ones that claim a sign-in. A loyalty member with no `user_id` is
     an enterprise member keyed on `account_id`, and `not exists (... where u.id
     = m.user_id)` is true for a null — the first draft of this check reported
     fourteen perfectly good business memberships as orphans. */
  select count(*) into n from public.loyalty_members m
   where m.user_id is not null
     and not exists (select 1 from auth.users u where u.id = m.user_id);
  if n <> 0 then raise exception '% loyalty members point at a sign-in that is gone', n; end if;

  /* A member with neither a sign-in nor an account is keyed on `party` — a
     customer id — and that is legitimate: four people and one organisation are
     in the loyalty programme with balances and ledger history and no sign-in.
     What is not legitimate is one with nothing on it at all, which is what
     every abandoned test run left. */
  select string_agg(m.id, ', ') into bad from public.loyalty_members m
   where m.user_id is null and m.account_id is null
     and coalesce(m.party, '') = ''
     and m.balance = 0
     and not exists (select 1 from public.loyalty_ledger l where l.member = m.id);
  if bad is not null then raise exception 'loyalty members belonging to nobody at all: %', bad; end if;

  /* And the ones keyed on `party` really have done something. */
  select count(*) into n from public.loyalty_members m
   where m.user_id is null and m.account_id is null;
  raise notice '% members are keyed on a customer id with no sign-in behind it', n;
end $$;
