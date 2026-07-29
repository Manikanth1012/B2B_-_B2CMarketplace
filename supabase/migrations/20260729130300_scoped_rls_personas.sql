-- Task 5 of docs/superpowers/plans/2026-07-29-real-authentication-and-rls.md
--
-- Per-persona policies. Written table by table, not with a loop, because the rules
-- genuinely differ.
--
-- Two rules hold throughout:
--
--   1. Nothing keys on `auth.role() = 'authenticated'`. Public signup is open and
--      auto-confirming (audit finding 1), so `authenticated` includes any stranger
--      who registers. Every predicate goes through `current_persona()`, which reads
--      `profiles` — a table only service_role can write.
--   2. A row with a null owner is not a hole. It is visible to the operator and to
--      nobody else, which is what the audit decided for the settlement rows that
--      name unregistered sellers and for the loyalty members who are not the demo
--      consumer.
--
-- Two deviations from the plan as written, both tightening:
--
--   * `settlement_statements` is partner-READ, operator-write. The plan's table says
--     "partner reads and writes"; nothing in src/ writes a settlement row as a
--     partner, and a partner who could UPDATE their own row could set `net`,
--     `commission` or `status = 'paid'` on their own statement. Read-only is the
--     safe reading of the intent.
--   * `operator_audit_log` SELECT is operator-only rather than "for everyone". The
--     row's actual requirement — no UPDATE and no DELETE for any role — is honoured
--     exactly: neither table below has an UPDATE or DELETE policy, so the hash chain
--     cannot be rewritten by anyone short of service_role.

-- ---------------------------------------------------------------------------
-- Group 1 — public catalogue and content. Anon SELECT lives in the Task 4
-- migration; the operator owns the writes and sees unpublished rows.
-- ---------------------------------------------------------------------------

drop policy if exists "operator_all_categories"   on categories;
drop policy if exists "operator_all_products"     on products;
drop policy if exists "operator_all_kb_articles"  on kb_articles;

create policy "operator_all_categories"  on categories  for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "operator_all_products"    on products    for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "operator_all_kb_articles" on kb_articles for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

-- ---------------------------------------------------------------------------
-- Group 2 — shared reference data every signed-in console reads. RewardsView reads
-- the loyalty programme, tiers and rules as the consumer; the KB reads tours as all
-- four. Read for any persona, written by the operator. No anon.
-- ---------------------------------------------------------------------------

drop policy if exists "persona_read_kb_tours"               on kb_tours;
drop policy if exists "persona_read_loyalty_programme"      on loyalty_programme;
drop policy if exists "persona_read_loyalty_tiers"          on loyalty_tiers;
drop policy if exists "persona_read_loyalty_earn_rules"     on loyalty_earn_rules;
drop policy if exists "persona_read_loyalty_redeem_options" on loyalty_redeem_options;
drop policy if exists "operator_all_kb_tours"               on kb_tours;
drop policy if exists "operator_all_loyalty_programme"      on loyalty_programme;
drop policy if exists "operator_all_loyalty_tiers"          on loyalty_tiers;
drop policy if exists "operator_all_loyalty_earn_rules"     on loyalty_earn_rules;
drop policy if exists "operator_all_loyalty_redeem_options" on loyalty_redeem_options;

create policy "persona_read_kb_tours" on kb_tours for select to authenticated
  using (current_persona() is not null);
create policy "persona_read_loyalty_programme" on loyalty_programme for select to authenticated
  using (current_persona() is not null);
create policy "persona_read_loyalty_tiers" on loyalty_tiers for select to authenticated
  using (current_persona() is not null);
create policy "persona_read_loyalty_earn_rules" on loyalty_earn_rules for select to authenticated
  using (current_persona() is not null);
create policy "persona_read_loyalty_redeem_options" on loyalty_redeem_options for select to authenticated
  using (current_persona() is not null);

create policy "operator_all_kb_tours" on kb_tours for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "operator_all_loyalty_programme" on loyalty_programme for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "operator_all_loyalty_tiers" on loyalty_tiers for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "operator_all_loyalty_earn_rules" on loyalty_earn_rules for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "operator_all_loyalty_redeem_options" on loyalty_redeem_options for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

-- ---------------------------------------------------------------------------
-- Group 3 — consumer-owned rows. Owner reads and writes own rows; operator reads all.
-- The INSERT check pins both the owner *and* the persona, so a self-registered
-- stranger with an `authenticated` JWT and no profile cannot create rows at all.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'cart_items', 'orders', 'order_items', 'subscriptions',
    'consumer_profile', 'consumer_bills', 'consumer_household',
    'consumer_notifications', 'consumer_payment_methods',
    'consumer_refunds', 'consumer_tickets',
    'loyalty_members', 'loyalty_ledger'
  ]
  loop
    execute format('drop policy if exists "owner_read_%1$s"     on public.%1$I', t);
    execute format('drop policy if exists "owner_insert_%1$s"   on public.%1$I', t);
    execute format('drop policy if exists "owner_update_%1$s"   on public.%1$I', t);
    execute format('drop policy if exists "owner_delete_%1$s"   on public.%1$I', t);
    execute format('drop policy if exists "operator_read_%1$s"  on public.%1$I', t);

    execute format($f$
      create policy "owner_read_%1$s" on public.%1$I for select to authenticated
        using (user_id = auth.uid())$f$, t);
    execute format($f$
      create policy "owner_insert_%1$s" on public.%1$I for insert to authenticated
        with check (user_id = auth.uid() and current_persona() = 'consumer')$f$, t);
    execute format($f$
      create policy "owner_update_%1$s" on public.%1$I for update to authenticated
        using (user_id = auth.uid() and current_persona() = 'consumer')
        with check (user_id = auth.uid() and current_persona() = 'consumer')$f$, t);
    execute format($f$
      create policy "owner_delete_%1$s" on public.%1$I for delete to authenticated
        using (user_id = auth.uid() and current_persona() = 'consumer')$f$, t);
    execute format($f$
      create policy "operator_read_%1$s" on public.%1$I for select to authenticated
        using (current_persona() = 'operator')$f$, t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Group 4 — the audit logs. INSERT and SELECT only. No UPDATE policy and no DELETE
-- policy exists on either table for any role, so the hash chain cannot be rewritten.
-- A hash-chained log that can be edited is decoration.
-- ---------------------------------------------------------------------------

drop policy if exists "owner_read_consumer_audit_log"    on consumer_audit_log;
drop policy if exists "operator_read_consumer_audit_log" on consumer_audit_log;
drop policy if exists "owner_insert_consumer_audit_log"  on consumer_audit_log;

create policy "owner_read_consumer_audit_log" on consumer_audit_log for select to authenticated
  using (user_id = auth.uid());
create policy "operator_read_consumer_audit_log" on consumer_audit_log for select to authenticated
  using (current_persona() = 'operator');
create policy "owner_insert_consumer_audit_log" on consumer_audit_log for insert to authenticated
  with check (user_id = auth.uid() and current_persona() = 'consumer');

drop policy if exists "operator_read_operator_audit_log" on operator_audit_log;
drop policy if exists "staff_insert_operator_audit_log"  on operator_audit_log;

create policy "operator_read_operator_audit_log" on operator_audit_log for select to authenticated
  using (current_persona() = 'operator');
-- Both consoles clear onboarding gates (src/lib/onboardingRepo.ts writes the audit
-- row), so the partner persona has to be able to append.
create policy "staff_insert_operator_audit_log" on operator_audit_log for insert to authenticated
  with check (current_persona() in ('operator', 'partner'));

-- ---------------------------------------------------------------------------
-- Group 5 — partner-scoped rows. `current_partner_id()` is null for every non-partner,
-- and `partner_id = null` is NULL rather than true, so these deny by default.
-- ---------------------------------------------------------------------------

-- partners: the partner sees and updates its own row; only the operator creates or
-- deletes one. `onboardingRepo.approveGate` sets status = 'live' from both consoles.
drop policy if exists "partner_read_partners"    on partners;
drop policy if exists "partner_update_partners"  on partners;
drop policy if exists "operator_all_partners"    on partners;

create policy "partner_read_partners" on partners for select to authenticated
  using (id = current_partner_id());
create policy "partner_update_partners" on partners for update to authenticated
  using (id = current_partner_id()) with check (id = current_partner_id());
create policy "operator_all_partners" on partners for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

-- Tables carrying a real partner_id: partner reads and writes its own, operator all.
do $$
declare t text;
begin
  foreach t in array array[
    'partner_endpoints', 'onboarding_gates', 'onboarding_tasks', 'sandbox_runs'
  ]
  loop
    execute format('drop policy if exists "partner_all_%1$s"  on public.%1$I', t);
    execute format('drop policy if exists "operator_all_%1$s" on public.%1$I', t);

    execute format($f$
      create policy "partner_all_%1$s" on public.%1$I for all to authenticated
        using (partner_id = current_partner_id())
        with check (partner_id = current_partner_id())$f$, t);
    execute format($f$
      create policy "operator_all_%1$s" on public.%1$I for all to authenticated
        using (current_persona() = 'operator')
        with check (current_persona() = 'operator')$f$, t);
  end loop;
end $$;

-- settlement_statements: read-only for the partner it belongs to (see the deviation
-- note at the top), operator writes. The six rows with a null partner_id — TechDyne
-- Devices, CloudSync Labs and Aventa (First-party) — are operator-only by design.
drop policy if exists "partner_read_settlement_statements" on settlement_statements;
drop policy if exists "operator_all_settlement_statements" on settlement_statements;

create policy "partner_read_settlement_statements" on settlement_statements for select to authenticated
  using (partner_id = current_partner_id());
create policy "operator_all_settlement_statements" on settlement_statements for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');

-- endpoint_test_calls carries endpoint_id, not partner_id. It inherits its scope from
-- partner_endpoints: RLS on that table is applied inside this subquery, so a partner
-- reaches exactly the test calls belonging to endpoints it can already see, and the
-- operator reaches all of them.
drop policy if exists "endpoint_scope_endpoint_test_calls" on endpoint_test_calls;

create policy "endpoint_scope_endpoint_test_calls" on endpoint_test_calls for all to authenticated
  using (exists (select 1 from partner_endpoints e where e.id = endpoint_test_calls.endpoint_id))
  with check (exists (select 1 from partner_endpoints e where e.id = endpoint_test_calls.endpoint_id));

-- ---------------------------------------------------------------------------
-- Group 6 — the operator's own tables. `current_persona() = 'operator'` and nothing else.
-- operator_audit_log is deliberately absent: it is handled in group 4.
-- ---------------------------------------------------------------------------

do $$
declare t text;
begin
  foreach t in array array[
    'operator_apis', 'operator_api_subscriptions', 'operator_banners',
    'operator_channels', 'operator_dunning_cases', 'operator_inventory',
    'operator_listings', 'operator_profile', 'operator_promotions',
    'operator_roles', 'operator_users', 'operator_warehouses'
  ]
  loop
    execute format('drop policy if exists "operator_all_%1$s" on public.%1$I', t);
    execute format($f$
      create policy "operator_all_%1$s" on public.%1$I for all to authenticated
        using (current_persona() = 'operator')
        with check (current_persona() = 'operator')$f$, t);
  end loop;
end $$;

-- operator_tickets is operator-owned with one hole punched in it: the knowledge base
-- raises a content-feedback ticket from whichever console the reader is in
-- (src/lib/kbRepo.ts), so all four personas need to append one — and only one of that
-- category. They cannot read the queue back.
drop policy if exists "operator_all_operator_tickets"    on operator_tickets;
drop policy if exists "persona_feedback_operator_tickets" on operator_tickets;

create policy "operator_all_operator_tickets" on operator_tickets for all to authenticated
  using (current_persona() = 'operator') with check (current_persona() = 'operator');
create policy "persona_feedback_operator_tickets" on operator_tickets for insert to authenticated
  with check (current_persona() is not null and category = 'Content feedback');
