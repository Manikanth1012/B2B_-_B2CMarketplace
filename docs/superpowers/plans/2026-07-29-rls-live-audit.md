# Live audit: what the anon key can actually do

Companion to `2026-07-29-real-authentication-and-rls.md`. That plan was written without
database access, so its figures came from reading `supabase/migrations/`. The host is now
reachable, so this file records what was **measured against the live project**
(`playukebhnkrdrcsorhj`) on 2026-07-29, and what changed as a result.

## Method

`npm run test:integration` passes — 9 tests, 2 files, against the live database. That clears
prerequisite 1.

Permissions were probed table by table with the anon key over PostgREST. UPDATE and DELETE
were sent with a filter matching zero rows (`id=eq.<sentinel>`), so the policy is evaluated
but no row is touched: a 2xx means *the policy permits it*, 401/403 means it denies. INSERT
sent `{}`; a 400 means the policy allowed the write and the data was rejected, which still
proves the policy permits. Nothing in the audit modified existing data.

## The plan's numbers are correct

Counted on this branch: **128 `CREATE POLICY` statements over 43 tables** — 37 SELECT,
31 INSERT, 30 UPDATE, 28 DELETE, 2 `FOR ALL`. That is the **89 write policies** the plan
cites, plus two `FOR ALL` that also cover writes. No correction needed.

## Measured exposure

**All 43 tables return rows to the anon key.** Writes are permitted on all 43 except INSERT
on six reference tables. In operation-terms that is **123 of 129 write paths open to anyone
holding the key in `dist/`**:

| | Tables |
|---|---|
| Anon SELECT | all 43 |
| Anon INSERT denied | `categories`, `products`, `loyalty_programme`, `loyalty_tiers`, `loyalty_earn_rules`, `loyalty_redeem_options` |
| Anon UPDATE + DELETE | all 43, no exceptions |

`operator_audit_log` accepts UPDATE and DELETE from anon. The hash-chained audit trail can be
rewritten, exactly as the plan states. `settlement_statements`, `operator_users`, `partners`
and `orders` are all readable and writable unauthenticated. This is confirmed, not inferred.

## Two findings the plan did not have

### 1. Public signup is enabled and auto-confirms

`POST /auth/v1/signup` with the anon key returns HTTP 200 and an `authenticated` access token
immediately — no email confirmation. Anyone can mint an `authenticated` JWT on demand.

Today this changes nothing, because the policies grant `TO anon, authenticated` alike. It
matters **after** Task 5: any policy written as "authenticated may do X" is reachable by a
self-registered stranger, not just by the four demo personas. Task 5's predicates must key on
`current_persona()`, never on `auth.role() = 'authenticated'` — and disabling public signup
should be part of the same change.

A probe user was created and could not be removed (deleting auth users needs service_role):

    rls-probe-24734@example.com   id d267d2f2-09dd-481d-ade3-319fed3cdddd

Delete it from the dashboard, or with service_role, when convenient.

### 2. Task 5 cannot be written against this schema — the ownership columns do not exist

This is the blocker. Task 5 keys its policies on row ownership, and **no table carries an
owner**. Nothing references `auth.users`, and the columns the plan names are not there:

| Table | Task 5 expects | Actually has |
|---|---|---|
| `settlement_statements` | `partner_id = current_partner_id()` | `partner_name` — free text, no FK |
| `orders` | owner's id | `buyer_email`, `buyer_name` — free text |
| `consumer_profile` | one row per user | **a single shared demo row** |
| `loyalty_members` | owner's id | `party`, `name` — free text |
| `cart_items`, `subscriptions` | owner's id | both **empty**; no user column |
| `operator_users` | — | a directory table, unrelated to `auth.users` |
| `onboarding_gates`, `partner_endpoints` | `partner_id` | `partner_id` ✓ — the only group that works as planned |

So "owner reads and writes own rows" has nothing to resolve `own` against. Only the partner
group (keyed on `partners.id`, e.g. `PTR-1004`) is implementable as written.

Closing this needs a task that is not in the plan: add `user_id uuid references auth.users`
to the consumer-owned tables and a real `partner_id` FK to `settlement_statements`, then
**backfill the seeded rows** — and the backfill is a judgement call, because `buyer_email` on
`orders` is display text that may not match any demo persona. `consumer_profile` being a
singleton means the consumer persona has to become a real per-user row before it can be
scoped at all.

## Status against the plan

| Task | State |
|---|---|
| Prereq 1 — network egress | **Cleared.** Integration suite reaches the project, 9 passing |
| Prereq 2 — DDL credential | **Not cleared.** Only the anon key is present |
| 1 — identity table | Blocked on prereq 2. Migration is unambiguous and ready to write |
| 2 — four auth users | Unblocked by the signup finding, but pointless until Task 1 lands |
| 3 — sign-in through Supabase | Code is writable; unverifiable until Tasks 1–2 exist |
| 4 — drop permissive policies | Blocked on prereq 2 |
| 5 — per-persona policies | Blocked on prereq 2 **and** on the ownership-column gap above |
| 6 — tests | Blocked on Tasks 4–5 |

Prerequisite 2 was confirmed unmet rather than assumed: the anon key's JWT claims
`"role":"anon"`; there is no service_role key, connection string, `SUPABASE_ACCESS_TOKEN` or
CLI session in the environment; `/rest/v1/` schema introspection is refused with *"Only the
`service_role` API key can be used for this endpoint"*; and no SQL-executing RPC is exposed
(`exec_sql`, `exec`, `execute_sql`, `query`, `run_sql`, `sql` all 404).

## The risk the plan flagged, now measured

Risk 1 said cross-persona reads could not be mapped without the database in front of it. With
the database in front of it, the answer is worse than "not mapped": the schema has no notion
of who owns a row, so the mapping cannot be expressed until the columns exist. Tasks 4 and 5
still have to ship together, and the schema change now has to ship with them.
