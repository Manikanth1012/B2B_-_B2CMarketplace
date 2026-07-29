# Plan: Real authentication and scoped RLS

Replace the client-side credential comparison with Supabase Auth, and replace the
`TO anon, authenticated USING (true)` policies with predicates keyed to the signed-in
user — so that the anon key stops being a full read/write credential for the whole
database.

**Status: Tasks 1–5 done and verified against the live project.** Task 6 is partly done.

> **Updated 2026-07-29, second pass.** All three prerequisites are cleared. A Supabase
> personal access token unlocked the Management API query endpoint
> (`POST /v1/projects/<ref>/database/query`), which runs as `postgres` and therefore does
> execute DDL — the route the audit said was missing. On top of that:
>
> * **Task 1** shipped as `supabase/migrations/20260729130000_auth_profiles.sql`.
> * **The ownership columns** — the blocker this plan did not anticipate — shipped as
>   `20260729130100_row_ownership.sql`, applying the curated backfill the audit recorded.
> * **Tasks 4 and 5** shipped together in one transaction as
>   `20260729130200_scoped_rls_public.sql` and `20260729130300_scoped_rls_personas.sql`.
>
> The 128 permissive policies are gone. 115 scoped policies replace them, and the anon key
> now reaches exactly three tables read-only. Measurements and the per-persona verification
> matrix are in [`2026-07-29-rls-live-audit.md`](./2026-07-29-rls-live-audit.md). The
> figures below were checked against the live project and were correct as written.

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
   `npm run test:integration` runs 16 tests against the live project and passes.
2. ~~**A credential that can alter policy.**~~ **Cleared 2026-07-29 (second pass).** Neither
   the anon key nor service_role reaches DDL — PostgREST does not execute DDL at all. The
   Supabase **Management API** does: `POST https://api.supabase.com/v1/projects/<ref>/database/query`
   with a personal access token (`sbp_…`) runs arbitrary SQL as `postgres`. That is how the
   four migrations below were applied and verified.
3. ~~**A decision on row ownership.**~~ **Cleared.** `20260729130100_row_ownership.sql` adds
   `user_id uuid references auth.users` to the thirteen consumer-owned tables and a real
   `partner_id` FK to `settlement_statements`, then applies the audit's curated backfill. The
   human answer the audit asked for is recorded there: the seeded orders all belong to the
   consumer persona, because `buyer_email` differs from `DEMO_CREDENTIALS` only by domain.

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

## Task 1: The identity table — DONE

**Files:** `supabase/migrations/20260729130000_auth_profiles.sql`

**Verified:** the four persona rows exist, seeded from the `app_metadata` Task 2 wrote, with
`profiles_partner_id_fkey` giving the partner's `PTR-1004` a real foreign key to `partners` —
the thing `app_metadata` could not do. `current_persona()` returns null unauthenticated and
the persona under a JWT; the partner sees 1 of the 4 `profiles` rows, so `own_profile_read`
bites. There is deliberately no INSERT/UPDATE/DELETE policy: a user who could write their own
row could grant themselves the operator persona.

`app_metadata` stays as the client-side source (`src/lib/auth.ts` reads it, and Task 3 is
verified against it); `profiles` is the source the *policies* read. The seed derives one from
the other so they cannot disagree at the point they are created.

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

**Files:** added `src/lib/auth.ts` (pure) and `src/lib/authRepo.ts` (Supabase); modified
`src/components/LoginScreen.tsx`,
`src/lib/supabase.ts`, `src/App.tsx`, `src/components/public/AudiencePage.tsx`,
`src/types/view.ts`

One thing the plan did not foresee: the audience-page CTAs called `handleLogin` with a
hand-built `Session`, which under real auth would have opened a console with no JWT behind it
— every query in it running as anon. They now route to the login screen with the persona
preselected, so there is exactly one way into a console. `Surface`'s `login` variant carries
that `prefill`, and "Apply to sell" keeps its Onboarding destination across the round trip.

**Verified** against the live project by `src/lib/auth.integration.test.ts` (7 tests) —
including a reload, simulated as two clients over one storage, which is what `persistSession`
actually has to survive. **Also verified in a real browser**: all four personas now sign in
through the actual login screen and land in the right console, and every screen in all four
consoles renders with no policy error. Chromium still cannot reach the project directly from
this sandbox, so that walk went through a local bridge — see the audit.

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

## Task 4: Public read, then everything else locked — DONE

**Files:** `supabase/migrations/20260729130200_scoped_rls_public.sql`

Drop the 128 permissive policies. Re-add anon SELECT for exactly the tables the public
front reads — `categories`, `products`, `kb_articles` — and nothing more.

**Verified** against the live project, probed as the `anon` role: `categories` 6 rows,
`products` 39, `kb_articles` 21. **Every one of the other 40 tables returns 0.** `orders`
returns an empty set rather than seven rows. INSERT is refused outright and UPDATE/DELETE
match zero rows, which is what RLS does — it filters rather than throwing.

One tightening: the anon policy on `kb_articles` is `using (status = 'published')`. 12 of
the 33 rows are `held` and were readable by anyone holding the anon key. The operator keeps
sight of all 33.

## Task 5: Per-persona policies — DONE

**Files:** `supabase/migrations/20260729130300_scoped_rls_personas.sql`, on top of
`20260729130100_row_ownership.sql`, which adds the ownership columns prerequisite 3 needed.
Tasks 4 and 5 were applied in a single transaction, as the self-review requires.

No predicate keys on `auth.role() = 'authenticated'`. Every one goes through
`current_persona()`, which reads `profiles` — a table only service_role can write. Verified:
a JWT with no `profiles` row resolves to persona `null`, sees 0 orders and cannot insert one.

Written table by table, not with a loop, because the rules genuinely differ:

| Table group | Rule |
|---|---|
| `consumer_*`, `cart_items`, `orders`, `subscriptions`, `loyalty_members`, `loyalty_ledger` | Owner reads and writes own rows; operator reads all |
| `partners`, `partner_endpoints`, `onboarding_*`, `settlement_statements` | Partner reads and writes where `partner_id = current_partner_id()`; operator reads and writes all |
| `operator_*` except the audit log | `current_persona() = 'operator'` |
| `operator_audit_log`, `consumer_audit_log` | **INSERT and SELECT only, for everyone. No UPDATE, no DELETE, for any role.** A hash-chained log that can be edited is decoration |
| `products`, `categories`, `kb_articles` | Anon and authenticated SELECT; operator writes |

**Two deviations from the table above, both tightening, both recorded in the migration:**

* `settlement_statements` is partner-**read**, operator-write. Nothing in `src/` writes a
  settlement row as a partner, and a partner who could UPDATE their own row could set `net`,
  `commission` or `status = 'paid'` on their own statement.
* `operator_audit_log` SELECT is operator-only rather than "for everyone" — reading it from a
  partner console would leak operator-wide activity. The row's actual requirement is honoured
  exactly: **neither audit table has an UPDATE or DELETE policy for any role.**

**One hole punched deliberately:** the knowledge base raises a content-feedback ticket from
whichever console the reader is in (`src/lib/kbRepo.ts`), so all four personas may INSERT
into `operator_tickets` — and only rows with `category = 'Content feedback'`. They cannot
read the queue back. This is the cross-persona write risk 1 warned about, found by walking
every `.from(...)` in `src/`.

**Verified** live, per persona, by probing row counts across all 43 tables and by exercising
every write path the consoles perform:

| | Sees | Cannot |
|---|---|---|
| anon | 3 tables, read-only | everything else; all writes |
| stranger with a JWT, no profile | nothing | everything |
| consumer | own orders (7), bills, loyalty, cart, profile; catalogue | operator and partner tables; another member's loyalty row |
| partner `PTR-1004` | own partner row, 7 gates, 1 task, **2 of 12 settlement rows** | the other 10 settlement rows; another partner's gates; consumer data |
| operator | all 43 tables | rewriting either audit log |

Cart, checkout and audit-row inserts still omit `user_id` in `src/` and are stamped
server-side by the column default, so **no component query changed.**

## Task 6: Tests — PARTLY DONE

**Files:** modified `src/lib/kbRepo.integration.test.ts`,
`src/lib/onboardingRepo.integration.test.ts`

Both suites seeded fixtures as anon and broke the moment Task 4 landed, exactly as predicted.
They now sign in as the operator in `beforeAll` and sign out in `afterAll` — the operator is
the persona that legitimately reaches every partner's onboarding, whereas the demo partner
persona is `PTR-1004` and could not see `PTR-TEST` at all.

The `operator_audit_log` cleanup in `onboardingRepo.integration.test.ts` is **removed** rather
than moved to a service_role fixture: the rows are append-only by design, every one carries a
unique id, and no assertion depends on the table's size.

**Still outstanding:** the policy regression test — signed in as the partner, assert that
reading another partner's settlement rows returns empty rather than throwing. Silent empty is
what RLS does, and a test that expects an error would pass for the wrong reason. The
behaviour is verified live (2 of 12 rows) but not yet pinned by a test in the repo.

**Verified:** `npm test` 63 passed; `npm run test:integration` 16 passed; `npm run build` clean.

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

### What the risks turned into

1. **Cross-persona reads, now mapped.** Walking every `.from(...)` in `src/` found exactly
   one genuine cross-persona *write*: the knowledge base raising a content-feedback ticket
   into `operator_tickets` from all four consoles. It has its own narrow INSERT policy. The
   enterprise console turned out to read no Supabase table at all — it runs on
   `src/components/enterprise/data.ts` — so it needs only the catalogue and reference reads.
2. **Fails-closed confirmed.** 115 scoped policies replaced 128 permissive ones. Every one of
   the 43 tables has at least one policy and RLS on, so nothing is left silently open, and the
   per-persona probe above is the walk this risk asked for.
3. **The anon key still needs rotating.** Unchanged, and now the right moment: the key in
   `dist/` no longer buys write access to anything, but it is still the key. Rotate it in the
   Supabase dashboard as the follow-up to this change.

**Two things this change does not do**, both flagged rather than guessed at:

* **Public signup is still enabled and auto-confirming.** The audit said disabling it should
  be part of Task 5. The policies no longer care — a self-registered stranger has no
  `profiles` row, so `current_persona()` is null and every predicate refuses them, which is
  verified above. Closing signup is a dashboard setting and remains worth doing.
* **`consumer_profile` is still one row.** It now carries a `user_id` and is scoped to the
  consumer persona, and `AccountView.tsx` still filters `id = 'me'`. A second real consumer
  would need a row of their own; the singleton is a seeding artefact, not a policy one.
