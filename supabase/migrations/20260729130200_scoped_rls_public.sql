-- Task 4 of docs/superpowers/plans/2026-07-29-real-authentication-and-rls.md
--
-- Drop the 128 permissive `TO anon, authenticated USING (true)` policies, then re-add
-- anon SELECT for exactly the tables the public front reads and nothing more.
--
-- This migration on its own leaves every console blank — the personas get their access
-- back in 20260729130300_scoped_rls_personas.sql. The plan says the two ship together;
-- apply them in one transaction.
--
-- Reversal: this drops policies rather than creating them, so the counterpart is the
-- previous migrations in this directory. Task 5's policies each carry an explicit
-- `drop policy if exists` so re-running is safe.

-- ---------------------------------------------------------------------------
-- Drop every existing policy in `public`, except `profiles`, which Task 1 created
-- correctly and which must keep `own_profile_read` or nobody can resolve a persona.
-- ---------------------------------------------------------------------------
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname = 'public' and tablename <> 'profiles'
  loop
    execute format('drop policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
  end loop;
end $$;

-- Belt and braces: RLS enabled everywhere means a table with no policy denies all,
-- which is the direction a mistake should fail in.
do $$
declare r record;
begin
  for r in
    select c.relname
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', r.relname);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- The public front. CategoryStrip and ProductGrid read `categories` and `products`
-- with no session; the knowledge base reads `kb_articles`. These three keep anon
-- SELECT. Everything else now requires a persona.
-- ---------------------------------------------------------------------------

create policy "public_read_categories" on categories
  for select to anon, authenticated using (true);

create policy "public_read_products" on products
  for select to anon, authenticated using (true);

-- Published only: 12 of the 33 kb_articles rows are `held` and were readable by
-- anyone holding the anon key. The operator keeps full sight of them via Task 5.
create policy "public_read_kb_articles" on kb_articles
  for select to anon, authenticated using (status = 'published');
