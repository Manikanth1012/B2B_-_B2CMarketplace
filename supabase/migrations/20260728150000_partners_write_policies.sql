-- Fixes a silent-write bug on `partners`.
--
-- The original migration (20260728112803_create_marketplace_schema.sql)
-- gave `partners` exactly one RLS policy: SELECT. Every other table in this
-- project has the full anon/authenticated CRUD set. Nothing granted INSERT
-- or UPDATE here.
--
-- The symptom was found by comparing two live-database calls under the
-- anon key:
--   INSERT into partners  ->  42501, HTTP 401  (RLS violation, loud)
--   UPDATE on partners    ->  [],    HTTP 200   (no error, zero rows, silent)
-- PostgREST does not treat an UPDATE that matches zero rows (because RLS
-- hid every row from it) as an error — it reports success with an empty
-- result. The going-live write in src/lib/onboardingRepo.ts
-- (`update({ status: 'live' }).eq('id', partnerId)`) hit exactly this: the
-- final onboarding gate would clear, the audit log would say the partner
-- went live, and `partners.status` would never actually change, all
-- without an error anywhere in the call chain.
--
-- This migration grants INSERT and UPDATE, following the project's
-- established convention exactly: `TO anon, authenticated`,
-- `USING (true)` / `WITH CHECK (true)`, `DROP POLICY IF EXISTS` first so
-- it is safe to re-run.
--
-- No DELETE policy is added on purpose. Nothing in this codebase deletes a
-- partner, and `onboarding_gates.partner_id` (and other onboarding-spine
-- tables) reference `partners(id)` with `ON DELETE CASCADE`. A DELETE
-- policy here would let one stray call take an entire partner's onboarding
-- history — gates, tasks, endpoints, sandbox runs — down with it. Leaving
-- DELETE ungranted keeps that class of mistake impossible at the database
-- level, not just avoided by convention in application code.

DROP POLICY IF EXISTS "anon_insert_partners" ON partners;
CREATE POLICY "anon_insert_partners" ON partners FOR INSERT TO anon, authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "anon_update_partners" ON partners;
CREATE POLICY "anon_update_partners" ON partners FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
