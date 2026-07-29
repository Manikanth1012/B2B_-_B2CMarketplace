# Plan: Real authentication and scoped RLS

Replace the client-side credential comparison with Supabase Auth, and replace the
`TO anon, authenticated USING (true)` policies with predicates keyed to the signed-in
user — so that the anon key stops being a full read/write credential for the whole
database.

**Status: blocked.** See *Prerequisites*. Nothing in this plan can be executed, let alone
verified, until they are cleared.

> **Updated 2026-07-29 after live database access.** Prerequisite 1 is cleared, and a
> service_role key has been supplied — enough for the Auth admin API, so **Tasks 2 and 3 are
> done and verified against the live project**. It is *not* enough for DDL, so Tasks 1, 4 and
> 5 remain blocked. A third blocker was found that this plan did not anticipate:
> **Task 5 is not implementable against the current schema**, because no table carries a row
> owner — `settlement_statements` has `partner_name` (free text) and not `partner_id`,
> `orders` has `buyer_email`, and `consumer_profile` is a single shared row. Measurements,
> the full per-table permission matrix, and the evidence are in
> [`2026-07-29-rls-live-audit.md`](./2026-07-29-rls-live-audit.md). The figures below were
> checked against the live project and are correct as written.

---

## Why

Today every one of the **128 policies** across **43 tables** grants `TO anon, authenticated`
with `USING (true)`; **89 of them cover INSERT, UPDATE or DELETE**. Sign-in is a string
comparison in `LoginScreen.tsx` against credentials compiled into the bundle, and there is
not a single `supabase.auth` call anywhere in `src/`.

The consequence is not subtle: the anon key shipped in `dist/` is equivalent to full read
and write access to settlement statements, the audit log, the user directory and every
order. The hash-chained audit trail can be rewritten by anyone who opens DevTools. RLS is
enabled everywhere and constrains nothing.

## Prerequisites

1. ~~**Network egress.**~~ **Cleared 2026-07-29.** The host is allowlisted;
   `npm run test:integration` runs 9 tests against the live project and passes.
2. **A credential that can alter policy.** *Still outstanding.* The anon key cannot run DDL.
   `CREATE POLICY`, `DROP POLICY` and `ALTER TABLE` need either the **service_role** key or
   the Postgres connection string. Supply one, or apply the migrations from the Supabase
   dashboard. Confirmed unmet: the key's JWT claims `"role":"anon"`, schema introspection is
   refused for anything but service_role, and no SQL-executing RPC is exposed.
3. **A decision on row ownership.** New — see the audit. The consumer-owned tables have no
   `user_id` and `settlement_statements` has no `partner_id`, so Task 5's predicates have
   nothing to resolve against. Adding those columns and backfilling the seeded rows is a
   task this plan does not yet contain, and the backfill needs a human answer: which demo
   persona owns the existing seeded orders, given `buyer_email` is display text.

The question of **who creates the auth users** is now answered: public signup is enabled and
auto-confirming, so Task 2 can seed them with the anon key alone. That does not unblock
anything by itself, since the `profiles` table it must write to is Task 1 DDL.

## Global constraints

- **The public front must keep working without a session.** `CategoryStrip` and
  `ProductGrid` query `categories` and `products` on the landing surface, before anyone
  signs in. Those two tables keep an anon SELECT policy. Everything else loses anon.
- **No console rewrite.** Policies change; component queries do not, except where a query
  genuinely reaches data the signed-in persona should not see.
- **Every step is reversible.** Each migration ships with its `DROP POLICY` counterpart, so
  a bad policy can be rolled back without restoring a backup.
- **The demo stays demonstrable.** Four known personas, four known passwords, still
  pre-filled on the login cards. The change is that the password now buys a real JWT.

---

## Task 1: The identity table

**Files:** create `supabase/migrations/<ts>_auth_profiles.sql`

A table mapping `auth.uid()` to a persona, because a policy cannot read a persona out of
thin air and the JWT should not be trusted to carry one it can set itself.

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  persona text not null check (persona in ('consumer','operator','partner','enterprise')),
  partner_id text references partners(id),
  created_at timestamptz not null default now()
);
alter table profiles enable row level security;
create policy "own_profile_read" on profiles for select to authenticated using (id = auth.uid());
```

Plus a `security definer` helper both readable and cheap to call from a policy:

```sql
create or replace function current_persona() returns text
  language sql stable security definer set search_path = public as
$$ select persona from profiles where id = auth.uid() $$;

create or replace function current_partner_id() returns text
  language sql stable security definer set search_path = public as
$$ select partner_id from profiles where id = auth.uid() $$;
```

**Verify:** `select current_persona()` returns null when unauthenticated, the persona when
signed in.

## Task 2: The four auth users — DONE

Implemented as `scripts/seed-auth-users.mjs`, run once against the project. Four users exist
with the passwords `DEMO_CREDENTIALS` documents, the partner carrying `partner_id = 'PTR-1004'`.

**Changed from the plan:** the persona lives in `app_metadata`, not in a `profiles` row,
because creating that table is DDL and there is no route to DDL from here. This keeps the
plan's actual security requirement — `app_metadata` is writable only with service_role, never
by the signed-in user, so it is not "a claim the JWT can set itself". `user_metadata` would
have been, and is deliberately unused. When Task 1 becomes possible, `profiles` should still
be added: it gives `partner_id` a real foreign key to `partners`, which `app_metadata` cannot.

**Verified:** all four sign in and carry the right persona; a wrong password is refused.

## Task 3: Sign-in through Supabase — DONE

**Files:** added `src/lib/auth.ts`; modified `src/components/LoginScreen.tsx`,
`src/lib/supabase.ts`, `src/App.tsx`, `src/components/public/AudiencePage.tsx`,
`src/types/view.ts`

One thing the plan did not foresee: the audience-page CTAs called `handleLogin` with a
hand-built `Session`, which under real auth would have opened a console with no JWT behind it
— every query in it running as anon. They now route to the login screen with the persona
preselected, so there is exactly one way into a console. `Surface`'s `login` variant carries
that `prefill`, and "Apply to sell" keeps its Onboarding destination across the round trip.

**Verified** against the live project by `src/lib/auth.integration.test.ts` (7 tests) —
including a reload, simulated as two clients over one storage, which is what `persistSession`
actually has to survive. Not yet verified in a browser: Chromium cannot reach the project from
this environment (see the audit).

- `supabase.ts`: `persistSession: true` — it is `false` today, so a refresh would drop the
  session and strand the user mid-console.
- `LoginScreen`: replace the `setTimeout` string comparison with
  `supabase.auth.signInWithPassword`, and build the `Session` from `profiles` rather than
  from the card that was clicked. Keep the pre-filled credentials and the persona cards; the
  card now selects which credentials to prefill, not which console to open.
- `App.tsx`: restore a session on mount via `getSession`, and sign out through
  `supabase.auth.signOut()` in `handleSignOut`.

**The failure this prevents:** deriving the persona from the clicked card means a user who
signs in with operator credentials from the consumer card gets a consumer session. The
persona must come from the database.

**Verify:** all four personas sign in; a page refresh keeps the console open; sign-out
returns to the landing page and `getSession()` is null.

## Task 4: Public read, then everything else locked

**Files:** create `supabase/migrations/<ts>_scoped_rls_public.sql`

Drop the 128 permissive policies. Re-add anon SELECT for exactly the tables the public
front reads — `categories`, `products`, `kb_articles` — and nothing more.

**Verify:** signed out, the landing page and both rails still render; `orders` returns an
empty set rather than rows.

## Task 5: Per-persona policies

**Files:** create `supabase/migrations/<ts>_scoped_rls_personas.sql`

> **Not implementable as written** — see prerequisite 3. The `partner_*` and `onboarding_*`
> row is the only group whose key (`partner_id`) exists today. Every row below that mentions
> an owner needs the ownership columns added and backfilled first. Note also that policies
> here must key on `current_persona()` and **never** on `auth.role() = 'authenticated'`:
> public signup is open, so `authenticated` includes anyone who registers.

Written table by table, not with a loop, because the rules genuinely differ:

| Table group | Rule |
|---|---|
| `consumer_*`, `cart_items`, `orders`, `subscriptions`, `loyalty_members`, `loyalty_ledger` | Owner reads and writes own rows; operator reads all |
| `partners`, `partner_endpoints`, `onboarding_*`, `settlement_statements` | Partner reads and writes where `partner_id = current_partner_id()`; operator reads and writes all |
| `operator_*` except the audit log | `current_persona() = 'operator'` |
| `operator_audit_log`, `consumer_audit_log` | **INSERT and SELECT only, for everyone. No UPDATE, no DELETE, for any role.** A hash-chained log that can be edited is decoration |
| `products`, `categories`, `kb_articles` | Anon and authenticated SELECT; operator writes |

**Verify:** each console loads every screen with no empty tables and no policy errors; a
partner session cannot read another partner's settlement rows.

## Task 6: Tests

**Files:** modify `src/lib/*.integration.test.ts`, `vitest.integration.config.ts`

The integration tests run as anon today and will stop working the moment Task 4 lands. They
need to sign in first. **`onboardingRepo.integration.test.ts:20` deletes from
`operator_audit_log` for cleanup — that DELETE is exactly what Task 5 forbids**, so cleanup
moves to a service_role fixture or the assertion changes to tolerate accumulated rows.

Add a policy regression test: signed in as the partner, assert that reading another
partner's settlement rows returns empty rather than throwing — silent empty is what RLS
does, and a test that expects an error would pass for the wrong reason.

**Verify:** `npm test` still 57; `npm run test:integration` green.

---

## Self-Review

**The riskiest step is Task 4**, because it breaks everything at once and the consoles only
come back as Task 5 lands. Both should go out together, or behind a maintenance window on
the demo.

**Three risks worth naming:**

1. **Cross-persona reads are not fully mapped.** The operator console reads partner and
   consumer tables freely today. Every such read has to be re-checked once policies bite,
   and the plan cannot enumerate them without the database in front of it.
2. **89 write policies is a lot of surface.** A missed table fails closed — a screen goes
   blank rather than leaking — which is the right direction, but it means Task 5's
   verification is a walk of all four consoles, not a spot check.
3. **The anon key already in circulation stays valid.** Rotating it is a separate action in
   the Supabase dashboard and should follow Task 5, not precede it.

**Out of scope:** MFA, SSO, password reset, email confirmation, and rate limiting on
sign-in. The prototype documents these as modelled behaviours (PRD §4.28); making them real
is its own piece of work.
