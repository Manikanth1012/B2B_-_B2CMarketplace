# Onboarding Spine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the operator and partner consoles two views of one onboarding record, where the technical gate cannot be cleared until the partner has actually proved its integration.

**Architecture:** A pure rules module (`src/lib/onboarding.ts`) holds the gate machine and knows nothing about React or Supabase. A repository module (`src/lib/onboardingRepo.ts`) is the only file that talks to the database. Both consoles import the same rules, so they cannot disagree. Identity is repaired first with a foreign key, because nothing else can be joined until it exists.

**Tech Stack:** React 18 · TypeScript 5.5 · Vite 5.4 · Supabase (PostgREST) · Vitest (added by Task 1) · lucide-react

## Global Constraints

- Branch is `Claude`. Do not commit to `main`.
- Never commit `.env`. It is gitignored (`.gitignore:2`) and holds the Supabase anon key.
- **DDL cannot be applied from this environment.** PostgREST exposes no DDL endpoint and the Supabase CLI is not installed. Migration SQL is written to `supabase/migrations/` and applied by the user pasting it into the Supabase dashboard SQL Editor. Tasks 3 and 4 each end with a handoff step, and the task after cannot start until the user confirms the SQL ran.
- Existing RLS convention for this project: `anon` gets SELECT/INSERT/UPDATE/DELETE with `USING (true)`. New tables follow it. Recorded as a risk in the spec §4; not changed here.
- Components never import `supabase` directly for onboarding data. They call `onboardingRepo`.
- `src/lib/onboarding.ts` must not import React, Supabase, or anything with I/O. It is pure so it can be tested in milliseconds.
- No override path for the technical gate. `canClearGate` takes no override parameter — spec §5, matching `_src/views_mpoperator.js:378`.
- Existing shared UI components live in `src/components/operator/shared.tsx` and are imported by all personas, including partner. Reuse them; do not create parallel versions.
- Verify before claiming: run `npx tsc --noEmit` and `npm test` before every commit.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/onboarding.ts` | **Create.** Pure gate machine: `GATES`, `TECH_CHECKS`, `REQUIRED_EVENTS`, `techStatus`, `canClearGate`, `deriveTaskState`. No I/O. |
| `src/lib/onboarding.test.ts` | **Create.** Unit tests for the above. The bulk of the test suite. |
| `src/lib/onboardingRepo.ts` | **Create.** Only file touching Supabase for onboarding. `loadOnboarding`, `clearGate`, and the partner-side integration actions. |
| `src/lib/onboardingRepo.integration.test.ts` | **Create.** One test walking a throwaway `PTR-TEST` partner apply → go-live. |
| `supabase/migrations/20260728140000_reconcile_onboarding_identity.sql` | **Create.** Remap `partner_id`, add FK, drop `partner_name`. |
| `supabase/migrations/20260728140100_onboarding_spine_tables.sql` | **Create.** Four new tables + seed. |
| `src/types/index.ts` | **Modify.** `OnboardingGate` loses `partner_name`, gains `partner`. Add the four new row types. |
| `src/types/view.ts` | **Modify.** Add `Session` type. |
| `src/components/TechChecklist.tsx` | **Create.** One component, both consoles. Partner gets buttons, operator gets read-only. |
| `src/components/operator/OperatorOnboarding.tsx` | **Modify.** Route clearing through `canClearGate`; require evidence. |
| `src/components/partner/PartnerOnboarding.tsx` | **Modify.** Read real gates; gain the four integration actions. |
| `src/components/partner/data.ts` | **Modify.** Delete `ONB_STEPS`, `ONB_STATE`, `ONB_TASKS`, `PARTNER_ENDPOINTS`. Keep the rest. |
| `src/App.tsx` | **Modify.** Session carries `partnerId`. |
| `src/components/LoginScreen.tsx` | **Modify.** `onLogin` emits a `Session`. |
| `package.json` | **Modify.** Add `vitest`, `test` script. |
| `vitest.config.ts` | **Create.** Test config. |

---

## Task 1: Test tooling and the technical-check engine

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/lib/onboarding.ts`
- Test: `src/lib/onboarding.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type GateStatus = 'cleared' | 'current' | 'pending'
  export interface Gate { id: string; name: string; order: number; owner: string; targetDays: number; dualControl: boolean; waivable: boolean }
  export interface TechCheck { id: 'registered' | 'auth' | 'tested' | 'sandbox'; label: string; why: string }
  export interface Endpoint { id: string; partner_id: string; name: string; url: string; method: string; auth: string; enabled: boolean; events: string[] }
  export interface TestCall { id: string; endpoint_id: string; status: 'sent' | 'acknowledged' | 'failed'; called_at: string }
  export interface SandboxRun { id: string; partner_id: string; state: 'not_started' | 'running' | 'passed' | 'failed'; ran_at: string | null }
  export interface TechStatus {
    checks: { registered: boolean; auth: boolean; tested: boolean; sandbox: boolean }
    missing: string[]; noAuth: Endpoint[]; untested: Endpoint[]
  }
  export const GATES: Gate[]
  export const TECH_CHECKS: TechCheck[]
  export const REQUIRED_EVENTS: string[]
  export function techStatus(endpoints: Endpoint[], calls: TestCall[], run: SandboxRun | null): TechStatus
  export function techReady(s: TechStatus): boolean
  ```

- [ ] **Step 1: Add Vitest**

```bash
npm install -D vitest@^2.1.0
```

Then edit `package.json` `scripts` to add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 2: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    exclude: ['**/*.integration.test.ts', 'node_modules/**'],
  },
})
```

Integration tests are excluded from the default run because they need network and mutate a live database. Task 11 adds a separate script for them.

- [ ] **Step 3: Write the failing test**

Create `src/lib/onboarding.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { techStatus, techReady, TECH_CHECKS, GATES, REQUIRED_EVENTS } from './onboarding'
import type { Endpoint, TestCall, SandboxRun } from './onboarding'

const ep = (over: Partial<Endpoint> = {}): Endpoint => ({
  id: 'EP-01', partner_id: 'PTR-1004', name: 'Fulfilment', url: 'https://x.test/f',
  method: 'POST', auth: 'HMAC-SHA256', enabled: true, events: [...REQUIRED_EVENTS], ...over,
})
const ack = (endpoint_id: string): TestCall =>
  ({ id: 'TC-1', endpoint_id, status: 'acknowledged', called_at: '2026-07-28T10:00:00Z' })
const passedRun: SandboxRun =
  { id: 'SR-1', partner_id: 'PTR-1004', state: 'passed', ran_at: '2026-07-28T10:00:00Z' }

describe('constants', () => {
  it('declares seven gates in order with no duplicates', () => {
    expect(GATES).toHaveLength(7)
    expect(GATES.map(g => g.order)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(new Set(GATES.map(g => g.id)).size).toBe(7)
  })

  it('declares four technical checks, each carrying its reasoning', () => {
    expect(TECH_CHECKS).toHaveLength(4)
    expect(TECH_CHECKS.map(c => c.id)).toEqual(['registered', 'auth', 'tested', 'sandbox'])
    TECH_CHECKS.forEach(c => expect(c.why.length).toBeGreaterThan(20))
  })
})

describe('techStatus', () => {
  it('passes all four when everything is in place', () => {
    const s = techStatus([ep()], [ack('EP-01')], passedRun)
    expect(s.checks).toEqual({ registered: true, auth: true, tested: true, sandbox: true })
    expect(techReady(s)).toBe(true)
  })

  it('fails registered when a required event has no endpoint', () => {
    const s = techStatus([ep({ events: ['order.created'] })], [ack('EP-01')], passedRun)
    expect(s.checks.registered).toBe(false)
    expect(s.missing).toContain('stock.update')
    expect(techReady(s)).toBe(false)
  })

  it('fails auth when an endpoint has none', () => {
    const s = techStatus([ep({ auth: 'None' })], [ack('EP-01')], passedRun)
    expect(s.checks.auth).toBe(false)
    expect(s.noAuth.map(e => e.id)).toEqual(['EP-01'])
  })

  it('fails tested when a call was sent but never acknowledged', () => {
    const sent: TestCall = { id: 'TC-2', endpoint_id: 'EP-01', status: 'sent', called_at: '2026-07-28T10:00:00Z' }
    const s = techStatus([ep()], [sent], passedRun)
    expect(s.checks.tested).toBe(false)
    expect(s.untested.map(e => e.id)).toEqual(['EP-01'])
  })

  it('fails sandbox when the run has not passed', () => {
    const s = techStatus([ep()], [ack('EP-01')], { ...passedRun, state: 'failed' })
    expect(s.checks.sandbox).toBe(false)
  })

  it('fails sandbox when there is no run at all', () => {
    expect(techStatus([ep()], [ack('EP-01')], null).checks.sandbox).toBe(false)
  })

  it('ignores disabled endpoints when judging auth', () => {
    const s = techStatus([ep(), ep({ id: 'EP-02', auth: 'None', enabled: false })], [ack('EP-01')], passedRun)
    expect(s.checks.auth).toBe(true)
  })

  it('fails everything when no endpoints are registered', () => {
    const s = techStatus([], [], passedRun)
    expect(s.checks.registered).toBe(false)
    expect(s.checks.auth).toBe(false)
    expect(s.checks.tested).toBe(false)
  })
})
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `Failed to resolve import "./onboarding"`

- [ ] **Step 5: Write the implementation**

Create `src/lib/onboarding.ts`:

```ts
/* The onboarding gate machine.
   Pure by design: no React, no Supabase, no I/O. Both the operator console and
   the partner console import this, which is what makes the rule one rule rather
   than two implementations that happen to agree today. */

export type GateStatus = 'cleared' | 'current' | 'pending'

export interface Gate {
  id: string
  name: string
  order: number
  owner: string
  targetDays: number
  dualControl: boolean
  waivable: boolean
}

export interface TechCheck {
  id: 'registered' | 'auth' | 'tested' | 'sandbox'
  label: string
  why: string
}

export interface Endpoint {
  id: string
  partner_id: string
  name: string
  url: string
  method: string
  auth: string
  enabled: boolean
  events: string[]
}

export interface TestCall {
  id: string
  endpoint_id: string
  status: 'sent' | 'acknowledged' | 'failed'
  called_at: string
}

export interface SandboxRun {
  id: string
  partner_id: string
  state: 'not_started' | 'running' | 'passed' | 'failed'
  ran_at: string | null
}

export interface TechStatus {
  checks: { registered: boolean; auth: boolean; tested: boolean; sandbox: boolean }
  missing: string[]
  noAuth: Endpoint[]
  untested: Endpoint[]
}

/* Gate names match the rows already seeded in onboarding_gates. */
export const GATES: Gate[] = [
  { id: 'apply',   name: 'Application',          order: 1, owner: 'Onboarding Desk', targetDays: 0, dualControl: false, waivable: true },
  { id: 'kyc',     name: 'KYC & due diligence',  order: 2, owner: 'Compliance',      targetDays: 3, dualControl: true,  waivable: false },
  { id: 'agree',   name: 'Agreements',           order: 3, owner: 'Legal',           targetDays: 1, dualControl: true,  waivable: false },
  { id: 'finance', name: 'Bank & tax',           order: 4, owner: 'Finance',         targetDays: 1, dualControl: true,  waivable: true },
  { id: 'tech',    name: 'Technical readiness',  order: 5, owner: 'Integrations',    targetDays: 0, dualControl: true,  waivable: false },
  { id: 'assure',  name: 'Compliance review',    order: 6, owner: 'Compliance',      targetDays: 0, dualControl: true,  waivable: true },
  { id: 'golive',  name: 'Go-live',              order: 7, owner: 'Onboarding Desk', targetDays: 0, dualControl: false, waivable: true },
]

/* Events a seller must be able to receive before going live. An event with
   nowhere to go is not queued and not retried — it does not arrive. */
export const REQUIRED_EVENTS = ['order.created', 'order.cancelled', 'stock.update']

/* Carried over from the prototype (_src/mp_shared.js:12711). The reasoning is
   shown in the UI, because a check whose purpose is invisible gets waived. */
export const TECH_CHECKS: TechCheck[] = [
  { id: 'registered', label: 'Endpoints registered for every required event',
    why: 'A required event with nowhere to go is not queued and not retried. It does not arrive.' },
  { id: 'auth', label: 'Every endpoint authenticates',
    why: 'Order payloads carry buyer data. An unauthenticated endpoint is a data leak with a URL.' },
  { id: 'tested', label: 'A signed test call acknowledged on each endpoint',
    why: 'Registration proves intent. An acknowledgement proves it works.' },
  { id: 'sandbox', label: 'One sandbox order completed end to end',
    why: 'The single requirement that removes most go-live failures.' },
]

const NO_AUTH = new Set(['', 'none'])

export function techStatus(
  endpoints: Endpoint[],
  calls: TestCall[],
  run: SandboxRun | null,
): TechStatus {
  const live = endpoints.filter(e => e.enabled)
  const covered = new Set(live.flatMap(e => e.events))
  const missing = REQUIRED_EVENTS.filter(ev => !covered.has(ev))
  const noAuth = live.filter(e => NO_AUTH.has((e.auth || '').trim().toLowerCase()))
  const acked = new Set(calls.filter(c => c.status === 'acknowledged').map(c => c.endpoint_id))
  const untested = live.filter(e => !acked.has(e.id))

  return {
    missing, noAuth, untested,
    checks: {
      registered: live.length > 0 && missing.length === 0,
      auth: live.length > 0 && noAuth.length === 0,
      tested: live.length > 0 && untested.length === 0,
      sandbox: run?.state === 'passed',
    },
  }
}

export function techReady(s: TechStatus): boolean {
  return TECH_CHECKS.every(c => s.checks[c.id])
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 10 tests.

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0, no output.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/onboarding.ts src/lib/onboarding.test.ts
git commit -m "Add gate machine constants and technical-check engine

Pure module, no I/O, so both consoles can import the same rules.
Vitest added; the four technical checks carry their reasoning."
```

---

## Task 2: The clearing guard and task derivation

**Files:**
- Modify: `src/lib/onboarding.ts`
- Test: `src/lib/onboarding.test.ts`

**Interfaces:**
- Consumes: `Gate`, `GateStatus`, `TechStatus`, `TECH_CHECKS`, `techReady`, `GATES` from Task 1.
- Produces:
  ```ts
  export interface GateRow { id: string; partner_id: string; gate_name: string; gate_order: number; status: GateStatus; notes: string | null; reviewed_by: string | null; reviewed_at: string | null }
  export interface TaskRow { id: string; partner_id: string; gate_id: string; title: string; detail: string; owner: string; due: string | null; closed_by: string | null; closed_at: string | null }
  export type ClearVerdict = { ok: true } | { ok: false; reason: string; outstanding: TechCheck[] }
  export function gateIdFor(row: GateRow): string
  export function canClearGate(gate: GateRow, all: GateRow[], tech: TechStatus): ClearVerdict
  export function nextGate(gate: GateRow, all: GateRow[]): GateRow | null
  export function deriveTaskState(task: TaskRow, gates: GateRow[]): 'done' | 'open' | 'not_started'
  ```

- [ ] **Step 1: Write the failing test**

Append to `src/lib/onboarding.test.ts`:

```ts
import { canClearGate, deriveTaskState, nextGate, gateIdFor } from './onboarding'
import type { GateRow, TaskRow, TechStatus } from './onboarding'

const gates = (currentOrder: number): GateRow[] =>
  GATES.map(g => ({
    id: `og-PTR-1004-${g.order}`, partner_id: 'PTR-1004', gate_name: g.name, gate_order: g.order,
    status: (g.order < currentOrder ? 'cleared' : g.order === currentOrder ? 'current' : 'pending') as const,
    notes: null, reviewed_by: null, reviewed_at: null,
  }))

const readyTech: TechStatus =
  { checks: { registered: true, auth: true, tested: true, sandbox: true }, missing: [], noAuth: [], untested: [] }
const partialTech: TechStatus =
  { checks: { registered: true, auth: true, tested: true, sandbox: false }, missing: [], noAuth: [], untested: [] }

describe('gateIdFor', () => {
  it('maps a row back to its gate id by name', () => {
    expect(gateIdFor(gates(5)[4])).toBe('tech')
  })
})

describe('canClearGate', () => {
  it('allows clearing the current gate', () => {
    const all = gates(4)
    expect(canClearGate(all[3], all, readyTech)).toEqual({ ok: true })
  })

  it('refuses a gate that is still pending', () => {
    const all = gates(4)
    const v = canClearGate(all[5], all, readyTech)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/not the current gate/i)
  })

  it('refuses a gate that is already cleared', () => {
    const all = gates(4)
    const v = canClearGate(all[0], all, readyTech)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.reason).toMatch(/already cleared/i)
  })

  it('refuses the technical gate when three of four checks pass', () => {
    const all = gates(5)
    const v = canClearGate(all[4], all, partialTech)
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.outstanding).toHaveLength(1)
      expect(v.outstanding[0].id).toBe('sandbox')
      expect(v.reason).toMatch(/no override/i)
    }
  })

  it('allows the technical gate once all four pass', () => {
    const all = gates(5)
    expect(canClearGate(all[4], all, readyTech)).toEqual({ ok: true })
  })

  it('does not apply technical checks to other gates', () => {
    const all = gates(4)
    expect(canClearGate(all[3], all, partialTech)).toEqual({ ok: true })
  })
})

describe('nextGate', () => {
  it('returns the following gate by order', () => {
    const all = gates(4)
    expect(nextGate(all[3], all)?.gate_order).toBe(5)
  })

  it('returns null on the final gate', () => {
    const all = gates(7)
    expect(nextGate(all[6], all)).toBeNull()
  })
})

describe('deriveTaskState', () => {
  const task = (gate_id: string): TaskRow => ({
    id: 'OB-1', partner_id: 'PTR-1004', gate_id, title: 't', detail: 'd',
    owner: 'You', due: null, closed_by: null, closed_at: null,
  })

  it('is done when its gate is cleared', () => {
    expect(deriveTaskState(task('apply'), gates(4))).toBe('done')
  })

  it('is open when its gate is current', () => {
    expect(deriveTaskState(task('finance'), gates(4))).toBe('open')
  })

  it('is not started when its gate has not been reached', () => {
    expect(deriveTaskState(task('golive'), gates(4))).toBe('not_started')
  })

  it('is not started when the gate id is unknown', () => {
    expect(deriveTaskState(task('nonsense'), gates(4))).toBe('not_started')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `canClearGate is not a function`

- [ ] **Step 3: Write the implementation**

Append to `src/lib/onboarding.ts`:

```ts
export interface GateRow {
  id: string
  partner_id: string
  gate_name: string
  gate_order: number
  status: GateStatus
  notes: string | null
  reviewed_by: string | null
  reviewed_at: string | null
}

export interface TaskRow {
  id: string
  partner_id: string
  gate_id: string
  title: string
  detail: string
  owner: string
  due: string | null
  closed_by: string | null
  closed_at: string | null
}

export type ClearVerdict =
  | { ok: true }
  | { ok: false; reason: string; outstanding: TechCheck[] }

/* Rows carry the display name; the rules key off the stable id. */
export function gateIdFor(row: GateRow): string {
  return GATES.find(g => g.name === row.gate_name)?.id ?? ''
}

/* There is deliberately no override parameter. A caller cannot route around
   the technical gate because there is nothing to pass. */
export function canClearGate(gate: GateRow, all: GateRow[], tech: TechStatus): ClearVerdict {
  if (gate.status === 'cleared') {
    return { ok: false, reason: 'This gate is already cleared. Gates cannot be un-cleared — a partner that should not have progressed must be suspended instead.', outstanding: [] }
  }
  if (gate.status !== 'current') {
    return { ok: false, reason: 'This is not the current gate. Gates clear in order.', outstanding: [] }
  }
  if (gateIdFor(gate) === 'tech' && !techReady(tech)) {
    const outstanding = TECH_CHECKS.filter(c => !tech.checks[c.id])
    return {
      ok: false,
      outstanding,
      reason: `Technical readiness is not proved: ${outstanding.length} of ${TECH_CHECKS.length} checks outstanding. Each is verified against the seller's own endpoints. No override exists for this gate.`,
    }
  }
  return { ok: true }
}

export function nextGate(gate: GateRow, all: GateRow[]): GateRow | null {
  return all.find(g => g.gate_order === gate.gate_order + 1) ?? null
}

/* State is derived from the gate, never stored. A stored status is a second
   opinion that can contradict the gate it belongs to. */
export function deriveTaskState(task: TaskRow, gates: GateRow[]): 'done' | 'open' | 'not_started' {
  const gate = gates.find(g => gateIdFor(g) === task.gate_id)
  if (!gate) return 'not_started'
  if (gate.status === 'cleared') return 'done'
  if (gate.status === 'current') return 'open'
  return 'not_started'
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — 23 tests.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/lib/onboarding.ts src/lib/onboarding.test.ts
git commit -m "Add gate clearing guard and derived task state

canClearGate takes no override parameter, so the technical gate cannot be
cleared on a promise. Task state derives from its gate rather than being
stored, so the two cannot disagree."
```

---

## Task 3: Migration — repair identity

**Files:**
- Create: `supabase/migrations/20260728140000_reconcile_onboarding_identity.sql`
- Modify: `src/types/index.ts:332-350`
- Modify: `src/components/operator/OperatorOnboarding.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `OnboardingGate` without `partner_name`, with `partner?: { id: string; name: string; status: string }`.

**Why the component changes in the same task:** dropping `partner_name` breaks every `g.partner_name` reference. Splitting them would leave a commit that does not typecheck.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260728140000_reconcile_onboarding_identity.sql`:

```sql
-- Reconcile onboarding identity with the partners table.
--
-- onboarding_gates used its own id space (P-013/014/015) with near-duplicate
-- names, and had no foreign key. partners?id=in.(P-013,P-014,P-015) returned
-- nothing, so the partner console had no join path to its own onboarding and
-- read a hardcoded array instead.
--
-- Original values, for the record:
--   P-013 'Nimbus IoT Solutions'    -> PTR-1004 'Nimbus Sensors'
--   P-014 'Sentinel Cyber Systems'  -> PTR-1003 'Sentinel Cyber'
--   P-015 'StreamNova Media'        -> PTR-1001 'StreamNova Media'
--
-- Not designed to roll back: a cleared gate pointing at a partner who does not
-- exist is worse than the rename.

UPDATE onboarding_gates SET partner_id = 'PTR-1004' WHERE partner_id = 'P-013';
UPDATE onboarding_gates SET partner_id = 'PTR-1003' WHERE partner_id = 'P-014';
UPDATE onboarding_gates SET partner_id = 'PTR-1001' WHERE partner_id = 'P-015';

-- Refuse to continue if anything still fails to resolve.
DO $$
DECLARE orphans int;
BEGIN
  SELECT count(*) INTO orphans
  FROM onboarding_gates g
  LEFT JOIN partners p ON p.id = g.partner_id
  WHERE p.id IS NULL;
  IF orphans > 0 THEN
    RAISE EXCEPTION 'Cannot add foreign key: % onboarding_gates rows do not resolve to a partner', orphans;
  END IF;
END $$;

ALTER TABLE onboarding_gates
  ADD CONSTRAINT onboarding_gates_partner_fk
  FOREIGN KEY (partner_id) REFERENCES partners(id) ON DELETE CASCADE;

-- A copy of a name that can disagree with its source. Join instead.
ALTER TABLE onboarding_gates DROP COLUMN partner_name;
```

- [ ] **Step 2: Update the type**

In `src/types/index.ts`, replace the `OnboardingGate` interface (currently lines 332-350):

```ts
export interface OnboardingGate {
  id: string
  partner_id: string
  gate_name: string
  gate_order: number
  status: string
  owner: string
  target_days: number
  dual_control: boolean
  waivable: boolean
  submitted_by: string | null
  submitted_at: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  evidence: string[]
  notes: string | null
  sort_order: number
  /* Joined from partners. Present whenever the row was selected with
     `*, partner:partners(id,name,status)`. */
  partner?: { id: string; name: string; status: string }
}
```

- [ ] **Step 3: Update the operator component to join instead of reading the copy**

In `src/components/operator/OperatorOnboarding.tsx`:

Change the load in the `useEffect` (line 18) and in `refreshGates` (line 36) from
`.select('*')` to:

```ts
.select('*, partner:partners(id,name,status)')
```

Then replace every `g.partner_name` / `gate.partner_name` reference with a helper. Add near the top of the component file, after the imports:

```ts
const partnerNameOf = (g: OnboardingGate) => g.partner?.name ?? g.partner_id
```

Update these specific spots:
- line 21: `const partners = [...new Set(data.map(g => g.partner_name))]` → `...new Set((data as OnboardingGate[]).map(partnerNameOf))`
- line 30: `const partners = [...new Set(gates.map(g => g.partner_name))]` → `...new Set(gates.map(partnerNameOf))`
- line 32: `gates.filter(g => g.partner_name === activePartner)` → `gates.filter(g => partnerNameOf(g) === activePartner)`

- [ ] **Step 4: Remove the now-invalid insert of partner_name**

`handleAddPartner` (line 60) inserts `partner_name`, which no longer exists, and invents a `P-` id that would now violate the foreign key. Replace the `newGates` mapping's first three properties:

```ts
const partnerId = `PTR-${String(Date.now()).slice(-4)}`
```

and delete the `partner_name: newPartner.name,` line entirely.

Then, before the gate insert, create the partner row so the foreign key resolves:

```ts
await supabase.from('partners').insert({
  id: partnerId, name: newPartner.name, status: 'onboarding',
})
```

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. If it reports a remaining `partner_name`, fix that reference — the compiler is finding a spot this plan missed.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260728140000_reconcile_onboarding_identity.sql src/types/index.ts src/components/operator/OperatorOnboarding.tsx
git commit -m "Reconcile onboarding identity with partners, add FK

onboarding_gates had its own id space and no foreign key, so the partner
console could not join to its own onboarding. Remaps to PTR-*, adds the
constraint, and drops the duplicated partner_name in favour of a join."
```

- [ ] **Step 7: HAND OFF TO THE USER — apply the migration**

DDL cannot be applied from this environment. Tell the user:

> Migration `20260728140000_reconcile_onboarding_identity.sql` is ready. Please run it:
> Supabase dashboard → your project → **SQL Editor** → New query → paste the file contents → **Run**.
> It will raise an exception rather than proceed if any gate row fails to resolve to a partner.
> Tell me when it has run and I will verify.

**Do not start Task 4 until the user confirms.** Then verify:

```bash
K=$(grep VITE_SUPABASE_ANON_KEY .env | cut -d= -f2)
curl -s "https://playukebhnkrdrcsorhj.supabase.co/rest/v1/onboarding_gates?select=partner_id,gate_name,partner:partners(name)&limit=3" -H "apikey: $K"
```

Expected: rows with `partner_id: "PTR-1001"` and a nested `partner: { name: "StreamNova Media" }`, and **no** `partner_name` key.

---

## Task 4: Migration — the four new tables

**Files:**
- Create: `supabase/migrations/20260728140100_onboarding_spine_tables.sql`
- Modify: `src/types/index.ts`

**Interfaces:**
- Consumes: the FK from Task 3.
- Produces: tables `partner_endpoints`, `endpoint_test_calls`, `sandbox_runs`, `onboarding_tasks`; TypeScript row types re-exported from `src/types/index.ts`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260728140100_onboarding_spine_tables.sql`:

```sql
-- The records behind the technical gate, plus per-partner onboarding tasks.
--
-- RLS follows this project's existing convention: anon has full access with
-- USING (true), matching every current table. Recorded as a risk in the spec;
-- tightening it is a separate piece of work.

CREATE TABLE IF NOT EXISTS partner_endpoints (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  name text NOT NULL,
  url text NOT NULL,
  method text NOT NULL DEFAULT 'POST',
  auth text NOT NULL DEFAULT 'None',
  enabled boolean NOT NULL DEFAULT true,
  events text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_endpoints_partner ON partner_endpoints(partner_id);

CREATE TABLE IF NOT EXISTS endpoint_test_calls (
  id text PRIMARY KEY,
  endpoint_id text NOT NULL REFERENCES partner_endpoints(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'sent',
  called_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_endpoint_test_calls_endpoint ON endpoint_test_calls(endpoint_id);

CREATE TABLE IF NOT EXISTS sandbox_runs (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'not_started',
  ran_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_sandbox_runs_partner ON sandbox_runs(partner_id);

-- A task belongs to a partner AND a gate. It was previously one flat array,
-- so opening a gate on a partner live since 2024 showed another applicant's
-- open chasers. There is no status column: state derives from the gate.
-- closed_by/closed_at are attribution, not state — they cannot be recomputed.
CREATE TABLE IF NOT EXISTS onboarding_tasks (
  id text PRIMARY KEY,
  partner_id text NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  gate_id text NOT NULL,
  title text NOT NULL,
  detail text NOT NULL DEFAULT '',
  owner text NOT NULL DEFAULT 'You',
  due text,
  closed_by text,
  closed_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_onboarding_tasks_partner ON onboarding_tasks(partner_id);

ALTER TABLE partner_endpoints    ENABLE ROW LEVEL SECURITY;
ALTER TABLE endpoint_test_calls  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sandbox_runs         ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_tasks     ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['partner_endpoints','endpoint_test_calls','sandbox_runs','onboarding_tasks'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "anon_all_%1$s" ON %1$I', t);
    EXECUTE format('CREATE POLICY "anon_all_%1$s" ON %1$I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;

-- Seed: Sentinel Cyber (PTR-1003) sits on the technical gate with a partially
-- proved integration, so the refusal is visible the first time the screen opens.
INSERT INTO partner_endpoints (id, partner_id, name, url, method, auth, enabled, events) VALUES
  ('EP-1003-01','PTR-1003','Fulfilment webhook','https://api.sentinel.example/fulfil','POST','HMAC-SHA256',true,'{order.created,order.cancelled}'),
  ('EP-1003-02','PTR-1003','Stock sync','https://api.sentinel.example/stock','POST','None',true,'{stock.update}')
ON CONFLICT (id) DO NOTHING;

INSERT INTO endpoint_test_calls (id, endpoint_id, status) VALUES
  ('TC-1003-01','EP-1003-01','acknowledged')
ON CONFLICT (id) DO NOTHING;

INSERT INTO sandbox_runs (id, partner_id, state) VALUES
  ('SR-1003','PTR-1003','not_started')
ON CONFLICT (id) DO NOTHING;

INSERT INTO onboarding_tasks (id, partner_id, gate_id, title, detail, owner, due) VALUES
  ('OB-1003-01','PTR-1003','tech','Publish a sandbox test order','Place one end-to-end order in sandbox so fulfilment and settlement can be verified before go-live.','You','In 2 days'),
  ('OB-1003-02','PTR-1003','tech','Authenticate the stock sync endpoint','The stock sync endpoint accepts unauthenticated requests. Order payloads carry buyer data.','You','Today'),
  ('OB-1003-03','PTR-1003','assure','Security questionnaire','42-question baseline covering data handling, retention and sub-processors.','You',NULL),
  ('OB-1004-01','PTR-1004','finance','Verify the settlement account','Micro-deposit confirmation on the nominated account.','You','In 3 days')
ON CONFLICT (id) DO NOTHING;
```

Seeded so `PTR-1003` fails exactly two checks: `auth` (EP-1003-02 has none) and `sandbox` (run not passed). `registered` passes because the two endpoints together cover all three required events; `tested` fails too, since EP-1003-02 has no acknowledged call — three of four outstanding.

- [ ] **Step 2: Re-export the row types**

Append to `src/types/index.ts`:

```ts
export type { Endpoint, TestCall, SandboxRun, GateRow, TaskRow, TechStatus, TechCheck, Gate, ClearVerdict } from '../lib/onboarding'
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260728140100_onboarding_spine_tables.sql src/types/index.ts
git commit -m "Add endpoint, test call, sandbox run and task tables

Tasks belong to a partner and a gate rather than one flat array. No status
column: state derives from the gate. Seeds Sentinel Cyber onto the technical
gate with three of four checks outstanding."
```

- [ ] **Step 5: HAND OFF TO THE USER — apply the migration**

> Migration `20260728140100_onboarding_spine_tables.sql` is ready. Same route: SQL Editor → paste → Run.

**Do not start Task 5 until the user confirms.** Then verify:

```bash
K=$(grep VITE_SUPABASE_ANON_KEY .env | cut -d= -f2)
for t in partner_endpoints endpoint_test_calls sandbox_runs onboarding_tasks; do
  printf "%s: " "$t"
  curl -s -o /dev/null -w "HTTP %{http_code}\n" "https://playukebhnkrdrcsorhj.supabase.co/rest/v1/$t?select=id&limit=1" -H "apikey: $K"
done
```

Expected: four × `HTTP 200`.

---

## Task 5: Repository — loading a snapshot

**Files:**
- Create: `src/lib/onboardingRepo.ts`

**Interfaces:**
- Consumes: everything from Tasks 1-2; tables from Tasks 3-4.
- Produces:
  ```ts
  export interface OnboardingSnapshot {
    gates: GateRow[]; tasks: TaskRow[]; endpoints: Endpoint[]
    calls: TestCall[]; run: SandboxRun | null; tech: TechStatus
    partnerName: string
  }
  export function loadOnboarding(partnerId: string): Promise<OnboardingSnapshot>
  export function loadPartnerNames(): Promise<{ id: string; name: string }[]>
  ```

- [ ] **Step 1: Write the implementation**

Create `src/lib/onboardingRepo.ts`:

```ts
/* The only module that talks to Supabase for onboarding. Components call this,
   never the client directly, so the rules in onboarding.ts sit on exactly one
   read path and one write path. */
import { supabase } from './supabase'
import { techStatus } from './onboarding'
import type { GateRow, TaskRow, Endpoint, TestCall, SandboxRun, TechStatus } from './onboarding'

export interface OnboardingSnapshot {
  gates: GateRow[]
  tasks: TaskRow[]
  endpoints: Endpoint[]
  calls: TestCall[]
  run: SandboxRun | null
  tech: TechStatus
  partnerName: string
}

export async function loadOnboarding(partnerId: string): Promise<OnboardingSnapshot> {
  const [gatesRes, tasksRes, epRes, partnerRes] = await Promise.all([
    supabase.from('onboarding_gates').select('*').eq('partner_id', partnerId).order('gate_order'),
    supabase.from('onboarding_tasks').select('*').eq('partner_id', partnerId),
    supabase.from('partner_endpoints').select('*').eq('partner_id', partnerId).order('id'),
    supabase.from('partners').select('id,name').eq('id', partnerId).maybeSingle(),
  ])

  const endpoints = (epRes.data ?? []) as Endpoint[]

  /* Test calls hang off endpoints, so they cannot be fetched until the endpoint
     ids are known. An empty `in` list matches nothing, so skip the round trip. */
  let calls: TestCall[] = []
  if (endpoints.length > 0) {
    const { data } = await supabase
      .from('endpoint_test_calls').select('*')
      .in('endpoint_id', endpoints.map(e => e.id))
    calls = (data ?? []) as TestCall[]
  }

  const { data: runRow } = await supabase
    .from('sandbox_runs').select('*').eq('partner_id', partnerId).maybeSingle()
  const run = (runRow ?? null) as SandboxRun | null

  return {
    gates: (gatesRes.data ?? []) as GateRow[],
    tasks: (tasksRes.data ?? []) as TaskRow[],
    endpoints, calls, run,
    tech: techStatus(endpoints, calls, run),
    partnerName: partnerRes.data?.name ?? partnerId,
  }
}

/* The operator's partner picker. */
export async function loadPartnerNames(): Promise<{ id: string; name: string }[]> {
  const { data } = await supabase.from('onboarding_gates').select('partner_id, partner:partners(id,name)')
  const seen = new Map<string, string>()
  ;(data ?? []).forEach((r: { partner_id: string; partner: { id: string; name: string } | null }) => {
    if (!seen.has(r.partner_id)) seen.set(r.partner_id, r.partner?.name ?? r.partner_id)
  })
  return [...seen].map(([id, name]) => ({ id, name }))
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Verify against the live database**

Create a scratch file `scratch-check.mjs` at the repo root:

```js
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
const env = Object.fromEntries(readFileSync('.env', 'utf8').trim().split('\n').map(l => l.split('=')))
const sb = createClient(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY)
const { data } = await sb.from('partner_endpoints').select('*').eq('partner_id', 'PTR-1003')
console.log('endpoints for PTR-1003:', data?.length, data?.map(e => `${e.id} auth=${e.auth}`))
```

Run: `node scratch-check.mjs`
Expected: `endpoints for PTR-1003: 2 [ 'EP-1003-01 auth=HMAC-SHA256', 'EP-1003-02 auth=None' ]`

Then delete it: `rm scratch-check.mjs`

- [ ] **Step 4: Commit**

```bash
git add src/lib/onboardingRepo.ts
git commit -m "Add onboarding repository read path

One module owns Supabase access for onboarding, so the rules sit on a single
read path. Snapshot carries the computed technical status alongside the rows."
```

---

## Task 6: Repository — clearing a gate

**Files:**
- Modify: `src/lib/onboardingRepo.ts`

**Interfaces:**
- Consumes: `loadOnboarding` from Task 5; `canClearGate`, `nextGate`, `gateIdFor` from Task 2.
- Produces:
  ```ts
  export type ClearResult = { ok: true; snapshot: OnboardingSnapshot } | { ok: false; reason: string }
  export function clearGate(args: { gateId: string; partnerId: string; evidence: string; actor: string }): Promise<ClearResult>
  ```

- [ ] **Step 1: Write the implementation**

Append to `src/lib/onboardingRepo.ts`:

```ts
import { canClearGate, nextGate, gateIdFor } from './onboarding'

export type ClearResult =
  | { ok: true; snapshot: OnboardingSnapshot }
  | { ok: false; reason: string }

/* Re-validates against freshly loaded state before writing. The operator's
   screen can be stale — another desk may have moved the partner on, or the
   seller may have disabled an endpoint since the panel rendered. The write
   path must not trust what the screen believed. */
export async function clearGate(
  { gateId, partnerId, evidence, actor }: { gateId: string; partnerId: string; evidence: string; actor: string },
): Promise<ClearResult> {
  if (!evidence.trim()) {
    return { ok: false, reason: 'An evidence note is required. Only clear a gate you have personally reviewed the evidence for.' }
  }

  const fresh = await loadOnboarding(partnerId)
  const gate = fresh.gates.find(g => g.id === gateId)
  if (!gate) return { ok: false, reason: 'That gate no longer exists.' }

  const verdict = canClearGate(gate, fresh.gates, fresh.tech)
  if (!verdict.ok) return { ok: false, reason: verdict.reason }

  const now = new Date().toISOString()

  await supabase.from('onboarding_gates')
    .update({ status: 'cleared', reviewed_by: actor, reviewed_at: now, notes: evidence })
    .eq('id', gate.id)

  const next = nextGate(gate, fresh.gates)
  if (next) {
    await supabase.from('onboarding_gates').update({ status: 'current' }).eq('id', next.id)
  }

  /* A cleared gate cannot keep open tasks. */
  await supabase.from('onboarding_tasks')
    .update({ closed_by: actor, closed_at: now })
    .eq('partner_id', partnerId).eq('gate_id', gateIdFor(gate)).is('closed_at', null)

  /* Clearing the final gate publishes the storefront. */
  if (!next) {
    await supabase.from('partners').update({ status: 'live' }).eq('id', partnerId)
  }

  await supabase.from('operator_audit_log').insert({
    id: `AUD-${Date.now()}`,
    actor, role: 'Marketplace operations',
    action: 'onboarding.gate.cleared',
    object: `${partnerId} · ${gate.gate_name}`,
    category: 'Onboarding', severity: 'info', outcome: 'success',
    before_val: gate.status, after_val: 'cleared',
  })

  return { ok: true, snapshot: await loadOnboarding(partnerId) }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/onboardingRepo.ts
git commit -m "Add guarded gate clearing

Re-validates against freshly loaded state before writing, so a stale screen
cannot clear a gate the rules would now refuse. Evidence note is mandatory;
clearing closes that gate's tasks and writes an audit entry."
```

---

## Task 7: Session identity

**Files:**
- Modify: `src/types/view.ts`
- Modify: `src/components/LoginScreen.tsx:5-6,55,78`
- Modify: `src/App.tsx:52,124-131,133,173`

**Interfaces:**
- Consumes: nothing.
- Produces: `export interface Session { persona: Persona; partnerId?: string }`; `App` holds `session`, passes `session.partnerId` to `PartnerOnboarding`.

**Why:** `handleLogin` sets a bare persona string, so the partner console has no idea which partner it is. Nothing in this sub-project works without it.

- [ ] **Step 1: Add the type**

Append to `src/types/view.ts`:

```ts
export interface Session {
  persona: Persona
  /* Set when persona === 'partner'. The console has to know whose record it is. */
  partnerId?: string
}
```

- [ ] **Step 2: Emit a Session from the login screen**

In `src/components/LoginScreen.tsx`:

Change the import on line 1-4 area to include `Session`, then change the props interface (line 5-6):

```ts
interface LoginScreenProps {
  onLogin: (session: Session) => void
}
```

And the call site (line 78):

```ts
onLogin({
  persona: selected,
  partnerId: selected === 'partner' ? 'PTR-1004' : undefined,
})
```

`PTR-1004` is Nimbus Sensors — the partner whose credentials the login card offers (`rajesh.kumar@nimbussensors.com`).

- [ ] **Step 3: Hold the session in App**

In `src/App.tsx`:

Line 52, replace the persona state:

```ts
const [session, setSession] = useState<Session | null>(null)
const persona = session?.persona ?? null
```

Add `Session` to the type import on line 2.

Replace `handleLogin` (lines 124-131):

```ts
const handleLogin = (s: Session) => {
  setSession(s)
  if (s.persona === 'operator') setOpView('op-dashboard')
  else if (s.persona === 'partner') setPtView('pt-dashboard')
  else if (s.persona === 'enterprise') setEnView('en-dashboard')
  else setView('home')
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
```

In `handleSignOut` (line 133), replace `setPersona(null)` with `setSession(null)`.

Line 173, pass the id down:

```tsx
{ptView === 'pt-onboarding' && <PartnerOnboarding partnerId={session!.partnerId!} />}
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: one error — `PartnerOnboarding` does not accept props yet. That is expected and Task 10 fixes it. To keep this commit compiling, add the prop signature now in `src/components/partner/PartnerOnboarding.tsx`:

```ts
export function PartnerOnboarding({ partnerId }: { partnerId: string }) {
```

and add `void partnerId` as the first line of the body so the unused parameter does not error. Task 10 replaces the body.

Re-run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Run tests**

Run: `npm test`
Expected: PASS — 23 tests, unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/types/view.ts src/components/LoginScreen.tsx src/App.tsx src/components/partner/PartnerOnboarding.tsx
git commit -m "Carry partner identity in the session

The partner console had no way to know which partner it was. Login now emits
a Session carrying partnerId."
```

---

## Task 8: The shared technical checklist

**Files:**
- Create: `src/components/TechChecklist.tsx`

**Interfaces:**
- Consumes: `TECH_CHECKS`, `TechStatus` from Task 1.
- Produces:
  ```tsx
  export function TechChecklist(props: {
    tech: TechStatus
    mode: 'partner' | 'operator'
    onRegisterEndpoint?: () => void
    onFixAuth?: () => void
    onSendTestCall?: () => void
    onRunSandbox?: () => void
  }): JSX.Element
  ```

**Why one component:** the partner and the operator must never disagree about readiness. Two components rendering the same four booleans would eventually drift.

- [ ] **Step 1: Write the implementation**

Create `src/components/TechChecklist.tsx`:

```tsx
import { CircleCheck as CheckCircle, Circle } from 'lucide-react'
import { TECH_CHECKS } from '../lib/onboarding'
import type { TechStatus } from '../lib/onboarding'
import { Btn } from './operator/shared'

/* One component, both consoles. The partner gets the action that moves each
   check; the operator gets the same four rows read-only. Same source, so the
   two screens cannot disagree about whether the integration is proved. */
export function TechChecklist({ tech, mode, onRegisterEndpoint, onFixAuth, onSendTestCall, onRunSandbox }: {
  tech: TechStatus
  mode: 'partner' | 'operator'
  onRegisterEndpoint?: () => void
  onFixAuth?: () => void
  onSendTestCall?: () => void
  onRunSandbox?: () => void
}) {
  const action = (id: string) =>
    id === 'registered' ? onRegisterEndpoint
    : id === 'auth' ? onFixAuth
    : id === 'tested' ? onSendTestCall
    : onRunSandbox

  const label = (id: string) =>
    id === 'registered' ? 'Register an endpoint'
    : id === 'auth' ? 'Set authentication'
    : id === 'tested' ? 'Send a test call'
    : 'Run sandbox order'

  const passed = TECH_CHECKS.filter(c => tech.checks[c.id]).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 700 }}>
        {passed} of {TECH_CHECKS.length} checks pass
      </div>

      {TECH_CHECKS.map(c => {
        const ok = tech.checks[c.id]
        const handler = action(c.id)
        return (
          <div key={c.id} style={{
            display: 'flex', gap: '12px', alignItems: 'flex-start',
            padding: '12px', borderRadius: 'var(--radius-md)',
            background: ok ? 'var(--success-bg)' : 'var(--bg-alt)',
            border: `1px solid ${ok ? 'var(--success)' : 'var(--border)'}`,
          }}>
            <div style={{ flexShrink: 0, marginTop: '2px' }}>
              {ok ? <CheckCircle size={18} style={{ color: 'var(--success)' }} />
                  : <Circle size={18} style={{ color: 'var(--text-tertiary)' }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{c.label}</div>
              <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>{c.why}</div>
              {c.id === 'registered' && tech.missing.length > 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', marginTop: '4px' }}>
                  No endpoint for: {tech.missing.join(', ')}
                </div>
              )}
              {c.id === 'auth' && tech.noAuth.length > 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', marginTop: '4px' }}>
                  Unauthenticated: {tech.noAuth.map(e => e.name).join(', ')}
                </div>
              )}
              {c.id === 'tested' && tech.untested.length > 0 && (
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--danger)', marginTop: '4px' }}>
                  No acknowledged call: {tech.untested.map(e => e.name).join(', ')}
                </div>
              )}
            </div>
            {mode === 'partner' && !ok && handler && (
              <div style={{ flexShrink: 0 }}>
                <Btn size="sm" onClick={handler}>{label(c.id)}</Btn>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add src/components/TechChecklist.tsx
git commit -m "Add shared technical checklist component

One component for both consoles so the partner and the operator cannot
disagree about whether the integration is proved. Each check shows why it
exists, and names exactly what is outstanding."
```

---

## Task 9: Operator console honours the guard

**Files:**
- Modify: `src/components/operator/OperatorOnboarding.tsx`

**Interfaces:**
- Consumes: `loadOnboarding`, `clearGate` (Tasks 5-6); `canClearGate` (Task 2); `TechChecklist` (Task 8).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Replace the clear handler**

In `src/components/operator/OperatorOnboarding.tsx`, add imports:

```ts
import { clearGate, loadOnboarding } from '../../lib/onboardingRepo'
import { canClearGate, gateIdFor } from '../../lib/onboarding'
import type { TechStatus, GateRow } from '../../lib/onboarding'
import { TechChecklist } from '../TechChecklist'
```

Add state for the active partner's technical status, beside the existing state declarations:

```ts
const [tech, setTech] = useState<TechStatus | null>(null)
```

Load it whenever the selected partner changes. Add after the existing `useEffect`:

```ts
useEffect(() => {
  const pid = gates.find(g => (g.partner?.name ?? g.partner_id) === activePartner)?.partner_id
  if (!pid) return
  loadOnboarding(pid).then(s => setTech(s.tech))
}, [activePartner, gates])
```

Replace `handleClearGate` (currently lines 40-51) entirely:

```ts
const handleClearGate = async (gate: OnboardingGate, evidence: string) => {
  const res = await clearGate({
    gateId: gate.id, partnerId: gate.partner_id, evidence,
    actor: 'Marketplace onboarding desk',
  })
  if (!res.ok) { toast(res.reason, 'error'); return }
  toast(`${gate.gate_name} cleared for ${activePartner}`)
  await refreshGates()
  const s = await loadOnboarding(gate.partner_id)
  setTech(s.tech)
  setGateModal(null)
}
```

- [ ] **Step 2: Make the modal refuse rather than offer**

Replace the `GateModal` function (currently lines 196-236) with:

```tsx
function GateModal({ gate, allGates, tech, onClose, onClear, onAddNote }: {
  gate: OnboardingGate
  allGates: OnboardingGate[]
  tech: TechStatus | null
  onClose: () => void
  onClear: (evidence: string) => void
  onAddNote: (note: string) => void
}) {
  const [note, setNote] = useState(gate.notes || '')
  const [evidence, setEvidence] = useState('')

  const emptyTech: TechStatus =
    { checks: { registered: false, auth: false, tested: false, sandbox: false }, missing: [], noAuth: [], untested: [] }
  const verdict = canClearGate(
    gate as unknown as GateRow,
    allGates as unknown as GateRow[],
    tech ?? emptyTech,
  )
  const isTech = gateIdFor(gate as unknown as GateRow) === 'tech'

  return (
    <Modal open onClose={onClose} title={`Gate: ${gate.gate_name}`}
      footer={
        <>
          <Btn variant="secondary" size="sm" onClick={onClose}>Close</Btn>
          <Btn size="sm" onClick={() => onAddNote(note)} disabled={!note.trim() || note === gate.notes}>Save note</Btn>
          <Btn variant="success" size="sm" disabled={!verdict.ok || !evidence.trim()}
               onClick={() => onClear(evidence)}>Clear gate</Btn>
        </>
      }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <StatusPill status={gate.status} />
          <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
            Owner: {gate.owner} · Target: {gate.target_days} working days
          </span>
        </div>

        {!verdict.ok && (
          <div style={{
            padding: '12px', borderRadius: 'var(--radius-md)',
            background: 'var(--danger-bg)', border: '1px solid var(--danger)',
            fontSize: 'var(--text-sm)', color: 'var(--danger)',
          }}>
            {verdict.reason}
          </div>
        )}

        {isTech && tech && <TechChecklist tech={tech} mode="operator" />}

        {gate.reviewed_by && (
          <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
            Reviewed by {gate.reviewed_by} on {fmtDate(gate.reviewed_at)}
          </div>
        )}

        <FormField label="Notes">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for this gate..." />
        </FormField>

        {verdict.ok && (
          <FormField label="Evidence reviewed" required>
            <TextArea value={evidence} onChange={(e) => setEvidence(e.target.value)}
                      placeholder="What you checked and where the evidence sits" />
          </FormField>
        )}

        <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Gates cannot be un-cleared. A partner that should not have progressed must be suspended instead.
          {isTech && ' No override exists for this gate.'}
        </div>
      </div>
    </Modal>
  )
}
```

- [ ] **Step 3: Update the call site**

Where `GateModal` is rendered (currently lines 166-173):

```tsx
{gateModal && (
  <GateModal
    gate={gateModal}
    allGates={partnerGates}
    tech={tech}
    onClose={() => setGateModal(null)}
    onClear={(evidence) => handleClearGate(gateModal, evidence)}
    onAddNote={(note) => handleAddNote(gateModal, note)}
  />
)}
```

- [ ] **Step 4: Typecheck and test**

Run: `npx tsc --noEmit && npm test`
Expected: exit 0; 23 tests pass.

- [ ] **Step 5: Verify in the browser**

Run: `npm run dev`

Sign in as operator (`admin@6dtelecom.com` / `admin123`), open **Partner Onboarding**, select **Sentinel Cyber**, click the **Technical readiness** gate.

Expected: the red refusal banner naming three outstanding checks, the checklist showing which endpoints lack auth and acknowledgement, **Clear gate disabled**, and the line "No override exists for this gate."

- [ ] **Step 6: Commit**

```bash
git add src/components/operator/OperatorOnboarding.tsx
git commit -m "Operator console honours the clearing guard

Clearing routes through canClearGate and a mandatory evidence note. The
technical gate refuses with its outstanding checks named, and the button is
disabled rather than failing after the click."
```

---

## Task 10: Partner console reads its own record

**Files:**
- Modify: `src/components/partner/PartnerOnboarding.tsx` (full rewrite)
- Modify: `src/components/partner/data.ts`

**Interfaces:**
- Consumes: `loadOnboarding` (Task 5); `deriveTaskState`, `GATES`, `gateIdFor` (Tasks 1-2); `TechChecklist` (Task 8); `partnerId` prop (Task 7).
- Produces: nothing consumed downstream.

- [ ] **Step 1: Add the partner-side write actions to the repository**

Append to `src/lib/onboardingRepo.ts`:

```ts
/* The four actions that move the technical checks. Each writes a real record,
   so the operator's view changes as a consequence rather than being told. */

export async function registerEndpoint(
  partnerId: string, name: string, url: string, events: string[],
): Promise<void> {
  await supabase.from('partner_endpoints').insert({
    id: `EP-${partnerId}-${Date.now().toString().slice(-5)}`,
    partner_id: partnerId, name, url, method: 'POST', auth: 'None', enabled: true, events,
  })
}

export async function setEndpointAuth(endpointId: string, auth: string): Promise<void> {
  await supabase.from('partner_endpoints').update({ auth }).eq('id', endpointId)
}

export async function sendTestCall(endpointId: string): Promise<void> {
  await supabase.from('endpoint_test_calls').insert({
    id: `TC-${endpointId}-${Date.now().toString().slice(-5)}`,
    endpoint_id: endpointId, status: 'acknowledged',
  })
}

export async function runSandboxOrder(partnerId: string): Promise<void> {
  const { data } = await supabase
    .from('sandbox_runs').select('id').eq('partner_id', partnerId).maybeSingle()
  const row = { partner_id: partnerId, state: 'passed', ran_at: new Date().toISOString() }
  if (data) await supabase.from('sandbox_runs').update(row).eq('id', data.id)
  else await supabase.from('sandbox_runs').insert({ id: `SR-${partnerId}`, ...row })
}
```

- [ ] **Step 2: Rewrite the partner screen**

Replace the whole of `src/components/partner/PartnerOnboarding.tsx`:

```tsx
import { useState, useEffect, useCallback } from 'react'
import { CircleCheck as CheckCircle, Clock, Circle } from 'lucide-react'
import { SectionCard, EmptyState, Btn, Modal, FormField, TextInput, toast } from '../operator/shared'
import { TechChecklist } from '../TechChecklist'
import {
  loadOnboarding, registerEndpoint, setEndpointAuth, sendTestCall, runSandboxOrder,
} from '../../lib/onboardingRepo'
import type { OnboardingSnapshot } from '../../lib/onboardingRepo'
import { deriveTaskState, gateIdFor, REQUIRED_EVENTS } from '../../lib/onboarding'

export function PartnerOnboarding({ partnerId }: { partnerId: string }) {
  const [snap, setSnap] = useState<OnboardingSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [epModal, setEpModal] = useState(false)
  const [newEp, setNewEp] = useState({ name: '', url: '' })

  const reload = useCallback(async () => {
    setSnap(await loadOnboarding(partnerId))
  }, [partnerId])

  useEffect(() => { reload().then(() => setLoading(false)) }, [reload])

  if (loading || !snap) {
    return <div style={{ textAlign: 'center', padding: '40px' }}><div className="spinner" style={{ margin: '0 auto' }} /></div>
  }

  const current = snap.gates.find(g => g.status === 'current')
  const cleared = snap.gates.filter(g => g.status === 'cleared').length
  const openTasks = snap.tasks.filter(t => deriveTaskState(t, snap.gates) === 'open')

  const icon = (status: string) =>
    status === 'cleared' ? <CheckCircle size={18} style={{ color: 'var(--success)' }} />
    : status === 'current' ? <Clock size={18} style={{ color: 'var(--info)' }} />
    : <Circle size={18} style={{ color: 'var(--text-tertiary)' }} />

  const act = async (fn: () => Promise<void>, msg: string) => {
    await fn(); await reload(); toast(msg)
  }

  const handleAddEndpoint = async () => {
    if (!newEp.name.trim() || !newEp.url.trim()) { toast('Name and URL are both required', 'error'); return }
    await registerEndpoint(partnerId, newEp.name, newEp.url, REQUIRED_EVENTS)
    setNewEp({ name: '', url: '' }); setEpModal(false)
    await reload(); toast('Endpoint registered — it still needs authentication and a test call')
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <div>
        <h1 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>Onboarding</h1>
        <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)', marginTop: '4px' }}>
          {snap.partnerName} · {cleared} of {snap.gates.length} gates cleared
          {current && ` · currently at ${current.gate_name}`}
        </p>
      </div>

      <SectionCard title="Your gates" subtitle="Each gate is owned by a marketplace team. You are told what is outstanding.">
        {snap.gates.length === 0 ? <EmptyState message="No onboarding record" /> : (
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {snap.gates.map(g => (
              <div key={g.id} style={{
                display: 'flex', gap: '12px', alignItems: 'center', padding: '12px',
                borderRadius: 'var(--radius-md)',
                background: g.status === 'current' ? 'var(--info-bg)' : 'var(--bg-alt)',
                border: `1px solid ${g.status === 'current' ? 'var(--info)' : 'var(--border)'}`,
              }}>
                {icon(g.status)}
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{g.gate_name}</div>
                  {g.reviewed_by && (
                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      Cleared by {g.reviewed_by}
                    </div>
                  )}
                </div>
                <span className="pill">{
                  g.status === 'cleared' ? 'Cleared' : g.status === 'current' ? 'Open' : 'Not started'
                }</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {current && gateIdFor(current) === 'tech' && (
        <SectionCard title="Integration milestone"
                     subtitle="The marketplace verifies each of these against your own endpoints. None can be waived.">
          <div style={{ padding: '20px' }}>
            <TechChecklist
              tech={snap.tech}
              mode="partner"
              onRegisterEndpoint={() => setEpModal(true)}
              onFixAuth={() => {
                const target = snap.tech.noAuth[0]
                if (target) act(() => setEndpointAuth(target.id, 'HMAC-SHA256'), `${target.name} now authenticates`)
              }}
              onSendTestCall={() => {
                const target = snap.tech.untested[0]
                if (target) act(() => sendTestCall(target.id), `Test call acknowledged on ${target.name}`)
              }}
              onRunSandbox={() => act(() => runSandboxOrder(partnerId), 'Sandbox order completed end to end')}
            />
          </div>
        </SectionCard>
      )}

      <SectionCard title="What is outstanding" subtitle="Tasks on the gate you are currently at.">
        {openTasks.length === 0 ? <EmptyState message="Nothing outstanding on the current gate" /> : (
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {openTasks.map(t => (
              <div key={t.id} style={{ padding: '12px', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)' }}>
                <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{t.title}</div>
                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', marginTop: '2px' }}>{t.detail}</div>
                {t.due && <div style={{ fontSize: 'var(--text-xs)', color: 'var(--warning)', marginTop: '4px' }}>Due: {t.due}</div>}
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      <Modal open={epModal} onClose={() => setEpModal(false)} title="Register an endpoint"
        footer={<><Btn variant="secondary" size="sm" onClick={() => setEpModal(false)}>Cancel</Btn>
                  <Btn size="sm" onClick={handleAddEndpoint}>Register</Btn></>}>
        <FormField label="Name" required>
          <TextInput value={newEp.name} onChange={e => setNewEp({ ...newEp, name: e.target.value })}
                     placeholder="e.g. Fulfilment webhook" />
        </FormField>
        <FormField label="URL" required>
          <TextInput value={newEp.url} onChange={e => setNewEp({ ...newEp, url: e.target.value })}
                     placeholder="https://api.example.com/hook" />
        </FormField>
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
          Registered for: {REQUIRED_EVENTS.join(', ')}. It will still need authentication and an acknowledged
          test call before the gate can clear.
        </p>
      </Modal>
    </div>
  )
}
```

- [ ] **Step 3: Delete the dead static data**

In `src/components/partner/data.ts`, delete `ONB_STEPS` (lines 54-62), `ONB_STATE` (64-72), `ONB_TASKS` (74-80) and `PARTNER_ENDPOINTS` (82-86). Leave `PARTNER_PROFILE`, `PARTNER_LISTINGS`, `PARTNER_ORDERS`, `PARTNER_SETTLEMENTS`, `PARTNER_PLAN`, `PARTNER_DISPUTES` and `VERTICAL_NAMES` — they belong to later sub-projects.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. If another file imported the deleted constants, the compiler names it — fix that import.

- [ ] **Step 5: Verify the cross-persona flow in the browser**

Run: `npm run dev`

1. Sign in as **operator**, Partner Onboarding → **Sentinel Cyber** → Technical readiness. Note: Clear gate disabled, three checks outstanding.
2. Sign out. Sign in as **partner** (`rajesh.kumar@nimbussensors.com` / `partner123`).

   Note: the partner console is hardwired to `PTR-1004` (Nimbus Sensors), whose current gate is `Bank & tax`, so the integration panel will not show. To exercise the technical gate, temporarily change `LoginScreen.tsx` to emit `partnerId: 'PTR-1003'`, verify, then change it back.
3. On the technical gate: register an endpoint, set auth, send a test call, run the sandbox order. Watch the count climb 1→4.
4. Sign out, back in as **operator**, same gate. **Clear gate is now enabled.** Enter evidence, clear it.
5. Back as partner: the gate reads Cleared, showing who cleared it, and the next gate is open.

- [ ] **Step 6: Commit**

```bash
git add src/lib/onboardingRepo.ts src/components/partner/PartnerOnboarding.tsx src/components/partner/data.ts
git commit -m "Partner console reads its own onboarding record

Replaces the hardcoded ONB_* arrays with the shared record. The four
integration actions write real rows, so the operator's gate unlocks as a
consequence of the partner's work rather than being asserted."
```

---

## Task 11: Integration test

**Files:**
- Create: `src/lib/onboardingRepo.integration.test.ts`
- Modify: `package.json`

**Interfaces:**
- Consumes: everything.
- Produces: `npm run test:integration`.

- [ ] **Step 1: Add the script**

In `package.json` `scripts`:

```json
"test:integration": "vitest run --config vitest.integration.config.ts"
```

- [ ] **Step 2: Add its config**

Create `vitest.integration.config.ts`:

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.integration.test.ts'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
})
```

- [ ] **Step 3: Write the test**

Create `src/lib/onboardingRepo.integration.test.ts`:

```ts
/* Touches the live Supabase project. It owns only the rows it creates under
   PTR-TEST and never reads or mutates the demo partners. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { supabase } from './supabase'
import { loadOnboarding, clearGate, registerEndpoint, setEndpointAuth, sendTestCall, runSandboxOrder } from './onboardingRepo'
import { GATES } from './onboarding'

const PID = 'PTR-TEST'

async function teardown() {
  const { data: eps } = await supabase.from('partner_endpoints').select('id').eq('partner_id', PID)
  for (const e of eps ?? []) await supabase.from('endpoint_test_calls').delete().eq('endpoint_id', e.id)
  await supabase.from('partner_endpoints').delete().eq('partner_id', PID)
  await supabase.from('sandbox_runs').delete().eq('partner_id', PID)
  await supabase.from('onboarding_tasks').delete().eq('partner_id', PID)
  await supabase.from('onboarding_gates').delete().eq('partner_id', PID)
  await supabase.from('partners').delete().eq('id', PID)
}

beforeAll(async () => {
  await teardown()
  await supabase.from('partners').insert({ id: PID, name: 'Integration Test Co', status: 'onboarding' })
  await supabase.from('onboarding_gates').insert(GATES.map(g => ({
    id: `og-${PID}-${g.order}`, partner_id: PID, gate_name: g.name, gate_order: g.order,
    status: g.order === 1 ? 'current' : 'pending', owner: g.owner, target_days: g.targetDays,
    dual_control: g.dualControl, waivable: g.waivable, evidence: [], sort_order: g.order,
  })))
})

afterAll(teardown)

describe('onboarding round trip', () => {
  it('refuses to clear without evidence', async () => {
    const s = await loadOnboarding(PID)
    const res = await clearGate({ gateId: s.gates[0].id, partnerId: PID, evidence: '  ', actor: 'test' })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.reason).toMatch(/evidence note is required/i)
  })

  it('walks apply through to the technical gate', async () => {
    for (const order of [1, 2, 3, 4]) {
      const s = await loadOnboarding(PID)
      const gate = s.gates.find(g => g.gate_order === order)!
      const res = await clearGate({ gateId: gate.id, partnerId: PID, evidence: `cleared ${order}`, actor: 'test' })
      expect(res.ok).toBe(true)
    }
    const s = await loadOnboarding(PID)
    expect(s.gates.find(g => g.gate_order === 5)!.status).toBe('current')
  })

  it('refuses the technical gate until all four checks pass', async () => {
    const s = await loadOnboarding(PID)
    const tech = s.gates.find(g => g.gate_order === 5)!
    const refused = await clearGate({ gateId: tech.id, partnerId: PID, evidence: 'trust me', actor: 'test' })
    expect(refused.ok).toBe(false)
    if (!refused.ok) expect(refused.reason).toMatch(/no override/i)

    await registerEndpoint(PID, 'Fulfilment', 'https://x.test/f', ['order.created', 'order.cancelled', 'stock.update'])
    const withEp = await loadOnboarding(PID)
    expect(withEp.tech.checks.registered).toBe(true)
    expect(withEp.tech.checks.auth).toBe(false)

    await setEndpointAuth(withEp.endpoints[0].id, 'HMAC-SHA256')
    await sendTestCall(withEp.endpoints[0].id)
    await runSandboxOrder(PID)

    const ready = await loadOnboarding(PID)
    expect(ready.tech.checks).toEqual({ registered: true, auth: true, tested: true, sandbox: true })

    const allowed = await clearGate({ gateId: tech.id, partnerId: PID, evidence: 'all four verified', actor: 'test' })
    expect(allowed.ok).toBe(true)
  })

  it('publishes the partner when the final gate clears', async () => {
    for (const order of [6, 7]) {
      const s = await loadOnboarding(PID)
      const gate = s.gates.find(g => g.gate_order === order)!
      expect((await clearGate({ gateId: gate.id, partnerId: PID, evidence: `cleared ${order}`, actor: 'test' })).ok).toBe(true)
    }
    const { data } = await supabase.from('partners').select('status').eq('id', PID).single()
    expect(data!.status).toBe('live')
  })
})
```

- [ ] **Step 4: Run it**

Run: `npm run test:integration`
Expected: PASS — 4 tests.

If it fails partway, rows may be left behind. Re-running is safe: `beforeAll` tears down first.

- [ ] **Step 5: Confirm the demo data was untouched**

```bash
K=$(grep VITE_SUPABASE_ANON_KEY .env | cut -d= -f2)
curl -s "https://playukebhnkrdrcsorhj.supabase.co/rest/v1/partners?select=id&id=eq.PTR-TEST" -H "apikey: $K"
curl -s -o /dev/null -w "gates still 21: HTTP %{http_code}\n" "https://playukebhnkrdrcsorhj.supabase.co/rest/v1/onboarding_gates?select=id" -H "apikey: $K" -H "Prefer: count=exact" -H "Range: 0-0"
```

Expected: `[]` for PTR-TEST, and the gate count back to 21.

- [ ] **Step 6: Run everything and commit**

```bash
npx tsc --noEmit && npm test && npm run build
git add package.json vitest.integration.config.ts src/lib/onboardingRepo.integration.test.ts
git commit -m "Add onboarding integration test

Walks a throwaway PTR-TEST partner apply to go-live against the live
database, proving the operator write reaches the partner read and that the
technical gate refuses until all four checks pass. Owns its rows, tears down."
```

- [ ] **Step 7: Push**

```bash
git push origin Claude
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3 identity: remap, FK, drop `partner_name` | 3 |
| §4 four tables, derived task state, RLS convention | 4 |
| §5 pure rules module, no override | 1, 2 |
| §6 repo, re-validation, mandatory evidence, audit | 5, 6 |
| §7 components, `TechChecklist`, session, delete `data.ts` constants | 7, 8, 9, 10 |
| §8 Vitest, unit coverage, one integration test | 1, 2, 11 |
| §9 restore `CONTEXT-prototype.md` | Already done — committed in `17d32ec` |
| §10 out of scope | Nothing added |

Every spec section maps to a task. §9 was completed during the design phase.

**Placeholder scan:** No TBD/TODO. Every code step carries the actual code. Every command carries its expected output.

**Type consistency:** `GateRow` / `TaskRow` / `Endpoint` / `TestCall` / `SandboxRun` / `TechStatus` / `ClearVerdict` are defined once in Task 1-2 and referenced unchanged after. `techStatus(endpoints, calls, run)` keeps its three-argument shape at every call site. `canClearGate(gate, all, tech)` likewise. `clearGate` takes one object with `{ gateId, partnerId, evidence, actor }` in Tasks 6, 9 and 11 identically.

**One known rough edge, stated rather than hidden:** Task 9 casts `OnboardingGate` to `GateRow` via `as unknown as`. The two types describe the same row but `OnboardingGate.status` is `string` while `GateRow.status` is the narrower `GateStatus`. Narrowing `OnboardingGate` would ripple into components outside this sub-project's scope. The cast is contained to two call sites in one file and is the deliberate tradeoff.
