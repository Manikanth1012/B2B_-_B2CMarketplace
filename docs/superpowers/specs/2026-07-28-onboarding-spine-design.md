# Onboarding spine — design

**Date:** 28 Jul 2026
**Branch:** `Claude`
**Status:** approved, ready for planning

Sub-project 1 of the marketplace port. The React app built in Bolt becomes the base; the
vanilla-JS HTML prototypes become the reference for behaviour.

---

## 1. Why this sub-project exists

The request was "add the HTML features to each persona and make them work end to end."
Measured, that is ~100 missing screens plus an 18,284-line rules engine plus a test suite —
several independent subsystems, not one spec.

It was decomposed. This is the first piece, chosen because everything else depends on it:
**a shared data spine, proved by one journey that crosses personas.**

### The defect at the centre

`onboarding_gates` and `partners` are two disconnected identity spaces:

| `onboarding_gates.partner_id` | `partners.id` |
|---|---|
| `P-013` "Nimbus IoT Solutions" | `PTR-1004` "Nimbus Sensors" |
| `P-014` "Sentinel Cyber Systems" | `PTR-1003` "Sentinel Cyber" |
| `P-015` "StreamNova Media" | `PTR-1001` "StreamNova Media" |

`GET /partners?id=in.(P-013,P-014,P-015)` returns `[]`. There is no foreign key on
`onboarding_gates.partner_id` — a plain `text` column and an index
(`20260728133129_create_operator_schema.sql:69`, `:457`).

So when the partner persona signs in as Nimbus Sensors (`PTR-1004`), there is no join path to
any onboarding record. `PartnerOnboarding.tsx` reads a hardcoded array because there was
nothing to join to.

The same shape appears elsewhere and is **out of scope here but worth recording**: `partner/data.ts:25`
and `enterprise/data.ts:24` both declare an order `ORD-880519` with `gross: 14975`. Two
literals that happen to agree. Nothing reads the other, so a change on one side is invisible
to the other. Bolt's `CONTEXT.md` describes these as "referencing the same order IDs"; they
duplicate them.

---

## 2. Goal and acceptance

One gate machine, one set of records, obeyed by both consoles.

**Acceptance:** advance one partner from `Bank & tax` to `Go-live` through both consoles, with
the technical gate refusing to clear until the partner has actually done the four things it
requires.

Success is not "the partner screen loads from Supabase." It is that the operator **cannot**
clear a technical gate on a promise, and that the partner sees the operator's decision without
either screen holding its own copy of the answer.

---

## 3. Identity: make the join real

A migration that:

- remaps `onboarding_gates.partner_id` to `PTR-1004` / `PTR-1003` / `PTR-1001`
- adds `FOREIGN KEY (partner_id) REFERENCES partners(id)`, so it cannot drift again
- **drops `partner_name`**

Dropping the name column is the substantive part. A copy of a name that can disagree with its
source is the same class of defect as the duplicated order id. Queries join instead:

```ts
.select('*, partner:partners(id,name,status)')
```

Three names change in the operator console — "Nimbus IoT Solutions" becomes "Nimbus Sensors",
"Sentinel Cyber Systems" becomes "Sentinel Cyber". That is the intended outcome: there was only
ever one company.

**Reversibility:** the migration is written with the old values in a comment block so the
remap can be read back, but it is not designed to be rolled back — a cleared gate that points
at a partner who no longer exists is worse than the rename.

---

## 4. Schema additions

Four tables, all with `partner_id` FK to `partners(id)`.

| Table | Columns (essential) | Why it exists |
|---|---|---|
| `partner_endpoints` | `id`, `partner_id`, `name`, `url`, `method`, `auth`, `enabled`, `events text[]` | what the partner registered |
| `endpoint_test_calls` | `id`, `endpoint_id`, `status`, `called_at` | `sent` → `acknowledged`. Registration proves intent; acknowledgement proves it works |
| `sandbox_runs` | `id`, `partner_id`, `state`, `ran_at` | one per partner: `not_started` / `running` / `passed` / `failed` |
| `onboarding_tasks` | `id`, `partner_id`, `gate_id`, `title`, `detail`, `owner`, `due`, `closed_by`, `closed_at` | a task belongs to a partner **and** a gate |

### Task state is derived, never stored

From the prototype's M48 correction: `ONB_TASKS` was one flat array, so opening a gate on a
partner live since 2024 showed another applicant's open chasers. A task's state is computed
from its gate's progress:

- gate `cleared` → task **done**, carrying who closed it and when
- gate `current` → task **open**, with a due date
- gate `pending` → task **not started**

There is no `status` column. A stored status is a second opinion that can contradict the gate.

`closed_by` and `closed_at` are **attribution, not state**: they record who cleared the gate
that closed this task, and when. The task's *state* is still derived from the gate every time
it is read. Attribution has to be stored because it cannot be recomputed; state must not be,
because it can.

### RLS

New tables follow the existing convention in this project — `anon` SELECT/INSERT/UPDATE/DELETE
with `USING (true)`. This matches every current table and keeps the prototype demoable.

**Recorded risk:** anyone holding the URL and anon key can modify all data. Acceptable for a
demo, and must be tightened before this is shown outside a controlled setting. Not addressed in
this sub-project.

---

## 5. The rules live in one pure module

`src/lib/onboarding.ts` — no Supabase import, no React import. Data in, verdict out.

```ts
export const GATES: Gate[]              // 7, ordered, each with owner / target days / waivable
export const TECH_CHECKS: TechCheck[]   // 4, each carrying its reasoning

techStatus(endpoints, testCalls, sandboxRun): {
  checks: { registered: boolean, auth: boolean, tested: boolean, sandbox: boolean }
  missing: RequiredEvent[]     // the *why*, for the UI
  noAuth: Endpoint[]
  untested: Endpoint[]
}

canClearGate(gate, allGates, tech):
  | { ok: true }
  | { ok: false, reason: string, outstanding: TechCheck[] }

deriveTaskState(task, gates): 'done' | 'open' | 'not_started'
```

Both consoles import this. That is what makes the rule *one rule* rather than two
implementations that happen to agree today.

`canClearGate` returns `ok: false` when:

- the gate is not `current` — no skipping ahead, no re-clearing a cleared gate
- it is the technical gate and any of the four checks fail

**There is no override parameter in the signature.** A caller cannot route around it, because
there is nothing to pass. This is deliberate and matches `advanceGate` in the prototype
(`_src/views_mpoperator.js:378`), whose modal states "No override exists for this gate."

### The four technical checks

Carried over verbatim from `_src/mp_shared.js:12711`, each with the reasoning shown in the UI:

| Check | Reasoning |
|---|---|
| Endpoints registered for every required event | A required event with nowhere to go is not queued and not retried. It does not arrive. |
| Every endpoint authenticates | Order payloads carry buyer data. An unauthenticated endpoint is a data leak with a URL. |
| A signed test call acknowledged on each endpoint | Registration proves intent. An acknowledgement proves it works. |
| One sandbox order completed end to end | The single requirement that removes most go-live failures. |

---

## 6. Data access, kept separate

`src/lib/onboardingRepo.ts` is the only file that talks to Supabase for this feature. Components
never import the client directly.

```ts
loadOnboarding(partnerId): Promise<OnboardingSnapshot>   // gates + tasks + endpoints + calls + sandbox
clearGate({ gateId, evidence, actor }): Promise<Result>
```

`clearGate` re-loads current state and **re-runs `canClearGate` before writing**, refusing if
the verdict has changed since the screen rendered. The operator's view can be stale; the write
path must not trust it.

On success, one pass: clear the gate, open the next, close this gate's tasks, open the next
gate's, write an audit row to `operator_audit_log`.

The evidence note is **mandatory**. The prototype requires it; the current React
implementation (`OperatorOnboarding.tsx:40`) takes no evidence at all and clears on a single
click.

---

## 7. Components

| File | Change |
|---|---|
| `OperatorOnboarding.tsx` | `handleClearGate` routes through `canClearGate`. When tech is not ready: button disabled, outstanding checks listed with their reasoning, and the line "No override exists for this gate." Evidence field required. |
| `PartnerOnboarding.tsx` | `data.ts` imports deleted. Reads its own gates. Gains the actions that move the checks: register endpoint, set auth, fire test call, run sandbox order. |
| `TechChecklist.tsx` *(new)* | One component, both consoles. Partner gets action buttons; operator gets the same four rows read-only. Same source, so the two screens cannot disagree about readiness. |

### Session identity

`App.tsx:124` — `handleLogin` sets a bare persona string, so the partner console has no idea
which partner it is. It becomes:

```ts
{ persona: Persona, partnerId?: string }   // partner → 'PTR-1004'
```

Small change, but nothing in this sub-project works without it.

### What is deleted

`src/components/partner/data.ts` loses `ONB_STEPS`, `ONB_STATE`, `ONB_TASKS` and
`PARTNER_ENDPOINTS`. The rest of the file (listings, orders, settlements) stays — those belong
to later sub-projects and are untouched here.

---

## 8. Testing

Vitest. No test tooling exists in the project today (`package.json` declares none).

**Unit — the bulk of it.** Every branch of `techStatus`, `canClearGate` and `deriveTaskState`.
Pure functions, no database, milliseconds. Required cases include:

- technical gate with 3 of 4 checks passing → `ok: false`, `outstanding.length === 1`
- a gate that is not `current` → `ok: false` regardless of tech state
- an endpoint with `auth: 'None'` → `checks.auth === false`
- a test call `sent` but not `acknowledged` → `checks.tested === false`
- task state derives from gate status, all three branches

**Integration — one test.** Creates a throwaway `PTR-TEST` partner, walks it apply → go-live,
asserts each operator write is visible to the partner-side read, tears down in `afterAll`.

It touches the live Supabase project, so it owns only rows it created and never reads or
mutates the demo partners. Approved by the user on that basis.

---

## 9. Repair carried out alongside

Bolt's `CONTEXT.md` replaced the prototype's 844-line original with 110 lines. The original
documents ~50 milestones, the reasoning behind each rule, and the defects already found and
fixed — it is the reference for every later port.

Restored from commit `ba1dc02` as `CONTEXT-prototype.md`, leaving Bolt's `CONTEXT.md` in place.
Two files, two purposes: one describes the React app as built, the other explains why the rules
are what they are.

---

## 10. Out of scope

Stated explicitly so the boundary is not argued later:

- the other ~100 screens across the four personas
- the pricing, tax, GL, rewards, dunning, collections and forecasting engines
- PDF generation and the document template system
- bulk update
- the `ORD-880519` duplication between partner and enterprise (§1) — a later sub-project,
  following the same pattern this one establishes
- tightening RLS beyond the existing project convention (§4)

Each is a later sub-project that plugs into this spine. None is blocked by leaving it out now.
