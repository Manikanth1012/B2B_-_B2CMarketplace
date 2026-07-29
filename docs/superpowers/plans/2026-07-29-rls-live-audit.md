# Live audit: what the anon key can actually do

Companion to `2026-07-29-real-authentication-and-rls.md`. That plan was written without
database access, so its figures came from reading `supabase/migrations/`. The host is now
reachable, so this file records what was **measured against the live project**
(`playukebhnkrdrcsorhj`) on 2026-07-29, and what changed as a result.

> **Resolved, same day.** Everything below describes the state *before* the scoped-RLS
> migrations. All of it has since been fixed and re-measured — jump to
> [After the fix](#after-the-fix) for the current numbers. The DDL blocker was cleared by the
> Supabase **Management API** (`POST /v1/projects/<ref>/database/query` with a personal access
> token), which runs as `postgres`; the section below that calls DDL unreachable was correct
> about PostgREST, service_role and direct Postgres, and wrong only in assuming
> `api.supabase.com` would stay off the allowlist.

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

**Applied** as `supabase/migrations/20260729130100_row_ownership.sql`, exactly as decided
above. Measured after: `orders` 7/7 owned, `order_items` 7/7, every `consumer_*` table fully
owned, `loyalty_members` 1 of 8 and `loyalty_ledger` 10 of 36 — LM-4001 only, joined on
`party = consumer_profile.customer_id = 'CUS-449021'`. `settlement_statements` carries a
`partner_id` on 6 of 12 rows: the two Nimbus, two Sentinel and two StreamNova statements. The
other six — TechDyne, CloudSync and Aventa (First-party) — are null and therefore
operator-only, which is the outcome decision 3 asked for.

## Status against the plan

| Task | State |
|---|---|
| Prereq 1 — network egress | **Cleared.** Integration suite reaches the project |
| Prereq 2 — DDL credential | **Cleared.** Management API query endpoint + a `sbp_…` token, running as `postgres` |
| Prereq 3 — row ownership | **Cleared.** `20260729130100_row_ownership.sql` |
| 1 — identity table | **Done and verified.** `20260729130000_auth_profiles.sql` |
| 2 — four auth users | **Done and verified.** `scripts/seed-auth-users.mjs` |
| 3 — sign-in through Supabase | **Done and verified.** `src/lib/auth.ts` |
| 4 — drop permissive policies | **Done and verified.** `20260729130200_scoped_rls_public.sql` |
| 5 — per-persona policies | **Done and verified.** `20260729130300_scoped_rls_personas.sql` |
| 6 — tests | **Partly.** Both suites repaired and green (16 tests); the partner settlement regression test is still outstanding |

### Why service_role did not reach DDL, and what did

The key is genuine — it authenticates, and `/rest/v1/` introspection, refused for anon,
returns the schema. What it cannot do is run DDL, because **PostgREST does not execute DDL at
all**, and the other routes out of this environment are closed:

- **Direct Postgres is unreachable.** The proxy answers `200 Connection Established` to a
  `CONNECT` on port 5432, but nothing flows — the Postgres handshake times out on the direct
  host and on the poolers alike, so the 200 is optimistic rather than a working tunnel.
  `db.<ref>` also resolves IPv6-only, and this sandbox has no IPv6 socket support.
- No SQL-executing RPC exists (`exec_sql`, `exec`, `execute_sql`, `query`, `run_sql`, `sql`
  all 404 with service_role as with anon), and no `pg-meta` route is exposed on the project
  host.

**The route that worked** is the one this section had listed as blocked:

    POST https://api.supabase.com/v1/projects/<ref>/database/query
    Authorization: Bearer sbp_…            # a personal access token, not service_role

`api.supabase.com` is reachable after all, and the endpoint runs arbitrary SQL as `postgres`
— `select current_user` returns `postgres` on PostgreSQL 17.6. That is full DDL. The four
migrations were applied and verified through it; Tasks 4 and 5 went in one `begin; … commit;`
so the consoles were never left locked out between them.

The token is a credential and is not stored in this repository.

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
the database in front of it, the answer was worse than "not mapped": the schema had no notion
of who owned a row, so the mapping could not be expressed until the columns existed. Tasks 4
and 5 had to ship together, and the schema change had to ship with them. All three did.

---

## After the fix

Re-measured against the live project once the four migrations were in. Same method as above,
plus a per-persona probe: for each role, count the rows visible in all 43 tables under a JWT
for that persona, then attempt every write path the consoles actually perform.

**128 permissive policies → 115 scoped ones.** Every table has at least one policy and RLS
enabled, so nothing is left silently open. Only two policies anywhere still read `true`:
public SELECT on `categories` and `products`.

### What the anon key can do now

| | Before | After |
|---|---|---|
| Tables returning rows to anon | **all 43** | **3** — `categories` (6), `products` (39), `kb_articles` (21 of 33, published only) |
| Anon INSERT | 37 of 43 tables | **none** |
| Anon UPDATE / DELETE | **all 43** | **none** |
| `operator_audit_log` rewritable | yes | **no — by anyone.** Neither audit table has an UPDATE or DELETE policy for any role |

The 123 open write paths are 0. `settlement_statements`, `operator_users`, `partners` and
`orders` all return empty to an unauthenticated caller.

### What each persona sees

| Persona | Reads | Refused |
|---|---|---|
| anon | 3 catalogue/content tables | everything else; every write |
| JWT with no `profiles` row | nothing beyond anon | every write — `current_persona()` is null |
| consumer | own 7 orders, 7 order items, 7 bills, 5 household, 11 audit rows, 1 loyalty membership + its 10 ledger rows, own profile, catalogue, reference data | all `operator_*`, all partner tables, another member's loyalty row, another user's rows |
| partner `PTR-1004` | own partner row, 7 gates, 1 task, **2 of 12 settlement statements** | the other 10 settlement rows, another partner's gates and endpoints, all consumer data, the operator's tables |
| enterprise | catalogue and reference data only — the console runs on local `data.ts` | everything else |
| operator | all 43 tables | rewriting either audit log |

The partner row is the answer to the plan's own verification question: a partner session
cannot read another partner's settlement rows, and gets silent empty rather than an error.

### The consoles still work unchanged

Every write path was exercised under a real persona JWT and rolled back. Cart add/update/
remove, checkout writing `orders` + `order_items` + `subscriptions`, profile edits, security
audit rows, loyalty redemption, partner endpoint registration, gate clearing, and the
knowledge base's content-feedback ticket all succeed. None of them mention `user_id`; the
column default stamps the owner server-side, which is why **no component query changed**.

`npm test` 63 passed, `npm run test:integration` 16 passed against the live project,
`npm run build` clean.

### Still open

1. **The anon key in circulation is unchanged.** It no longer buys write access to anything,
   but rotating it in the dashboard is the right follow-up.
2. **Public signup is still enabled and auto-confirming.** Harmless to the policies now — a
   self-registered stranger has no `profiles` row and is refused everywhere, which was
   measured — but worth closing.
3. **Nobody has watched the four consoles render under a real session.** Unchanged: Chromium
   still cannot reach the project from this environment (see *The browser cannot reach the
   project either*, above). The policies are verified at the database, not through the UI.
4. **The partner settlement regression test** named in Task 6 is not yet written.
