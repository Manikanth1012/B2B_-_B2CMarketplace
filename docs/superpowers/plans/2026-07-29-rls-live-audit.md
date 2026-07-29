# Live audit: what the anon key can actually do

Companion to `2026-07-29-real-authentication-and-rls.md`. That plan was written without
database access, so its figures came from reading `supabase/migrations/`. The host is now
reachable, so this file records what was **measured against the live project**
(`playukebhnkrdrcsorhj`) on 2026-07-29, and what changed as a result.

## Method

`npm run test:integration` passes against the live database — 9 tests when this audit began,
16 now that the auth suite has been added. That clears prerequisite 1.

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

Proving this created one throwaway account, `rls-probe-24734@example.com`. It has since been
deleted with the service_role key; `auth.users` now holds exactly the four persona accounts
from Task 2 and nothing else.

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

## The backfill cannot be done by matching text

Prerequisite 3 asks how the seeded rows get an owner. The obvious answer — match the free-text
columns to the personas — was tested against the live rows and **does not work**. It would
orphan almost everything, and an orphaned row is invisible once policies bite.

**`orders` — 0 of 7 rows would match.** All seven carry the same buyer:

    orders.buyer_email      priya.raman@6dtech.co.in     (7 of 7)
    DEMO_CREDENTIALS        priya.raman@example.com

Same person, different domain. A join on email assigns nothing and the consumer console goes
blank.

**`settlement_statements` — 1 of 6 names would match.** Against `partners.name`:

| `partner_name` (12 rows) | Matches a partner? | Intended |
|---|---|---|
| StreamNova Media | exact | `PTR-1001` |
| Nimbus IoT Solutions | no | `PTR-1004` Nimbus Sensors |
| Sentinel Cyber Systems | no | `PTR-1003` Sentinel Cyber |
| TechDyne Devices | no | no partner row exists |
| CloudSync Labs | no | no partner row exists |
| Aventa (First-party) | no | **not a partner** — the operator's own first-party entity |

Only StreamNova joins. Two more are recognisable variants of real partners. Two name sellers
that were never seeded into `partners`. The last is not a partner at all, and giving it a
`partner_id` would be wrong rather than merely incomplete.

So the backfill has to be an explicit, curated mapping, written down and reviewed — not a
join. Three decisions fall out of the table above, and they are recorded here rather than
guessed at silently:

1. `orders` is assigned to the consumer persona wholesale. The email mismatch is a seeding
   inconsistency, not evidence of a second buyer — every row is the same Priya Raman the
   consumer card signs in as.
2. `Nimbus IoT Solutions` → `PTR-1004` and `Sentinel Cyber Systems` → `PTR-1003`. Note that
   `PTR-1004` is already the partner persona's own id, so the partner console keeps rows.
3. `TechDyne Devices`, `CloudSync Labs` and `Aventa (First-party)` get **no** `partner_id`.
   They stay visible to the operator and to nobody else, which is what a first-party or
   unregistered seller should be. This is deliberate: inventing partner rows to satisfy a
   foreign key would put fictional sellers into the onboarding console.

None of this has been applied — it is the mapping to apply once a DDL credential exists.

## Status against the plan

| Task | State |
|---|---|
| Prereq 1 — network egress | **Cleared.** Integration suite reaches the project |
| Prereq 2 — DDL credential | **Partly.** service_role supplied; enough for the Auth admin API, not for DDL |
| Prereq 3 — row ownership | Mapping decided above; needs DDL to apply |
| 1 — identity table | **Blocked.** DDL |
| 2 — four auth users | **Done and verified.** `scripts/seed-auth-users.mjs` |
| 3 — sign-in through Supabase | **Done and verified.** `src/lib/auth.ts` |
| 4 — drop permissive policies | **Blocked.** DDL |
| 5 — per-persona policies | **Blocked.** DDL, plus the ownership columns |
| 6 — tests | Auth half done (7 integration tests). Policy regression tests wait on Tasks 4–5 |

### Why service_role still does not reach DDL

The key is genuine — it authenticates, and `/rest/v1/` introspection, refused for anon, now
returns the schema. What it cannot do is run DDL, because **PostgREST does not execute DDL at
all** and every other route out of this environment is closed:

- `api.supabase.com` — the Management API, which does have a query endpoint — is **not on the
  network allowlist**: the proxy answers `403` to `CONNECT`. It also wants a personal access
  token (`sbp_…`), which service_role is not.
- **Direct Postgres is unreachable.** The proxy answers `200 Connection Established` to a
  `CONNECT` on port 5432, but nothing flows — the Postgres handshake times out on the direct
  host and on the poolers alike, so the 200 is optimistic rather than a working tunnel.
  `db.<ref>` also resolves IPv6-only, and this sandbox has no IPv6 socket support.
- No SQL-executing RPC exists (`exec_sql`, `exec`, `execute_sql`, `query`, `run_sql`, `sql`
  all 404 with service_role as with anon), and no `pg-meta` route is exposed on the project
  host.

**To finish Tasks 1, 4 and 5, one of these has to change:** allowlist `api.supabase.com` and
supply a personal access token, or paste the migrations into the dashboard SQL editor.

### The browser cannot reach the project either

Task 3 was verified in Node rather than in a browser, because Chromium's egress is reset by
the proxy — `net::ERR_CONNECTION_RESET` for the Supabase host and for `fonts.googleapis.com`
alike, with the CA registered in the NSS store, with `--proxy-server` set explicitly, and
with certificate errors and QUIC both disabled. It is not a trust failure, and `curl` through
the same proxy to the same host works, so it is specific to the browser.

What that costs: sign-in, persona resolution, refusal of a bad password and session restore
across a reload are all covered against the live project by
`src/lib/auth.integration.test.ts` — but **nobody has yet watched the four consoles render
under a real session.** That walk still needs doing somewhere a browser can reach Supabase.

## The risk the plan flagged, now measured

Risk 1 said cross-persona reads could not be mapped without the database in front of it. With
the database in front of it, the answer is worse than "not mapped": the schema has no notion
of who owns a row, so the mapping cannot be expressed until the columns exist. Tasks 4 and 5
still have to ship together, and the schema change now has to ship with them.
