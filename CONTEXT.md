# Project Context — 6D Telecom Marketplace

## Overview
A telecom marketplace web app built with React + Vite + Supabase. It has four personas:
1. **Consumer** — browse products, add to cart, checkout, view orders/subscriptions/rewards/account
2. **Operator** — admin console for managing the marketplace (12 screens)
3. **Partner / Seller** — onboard products, manage orders, view settlement, performance dashboard
4. **Enterprise Buyer** — B2B procurement of IoT, security and device products with approval workflow

## Tech Stack
- **Frontend**: React 18, TypeScript, Vite
- **Backend**: Supabase (Postgres + RLS)
- **Icons**: lucide-react
- **Styling**: CSS variables (brand navy + teal accent), inline styles + global.css
- **Tests**: Vitest — `npm test` (23 unit) and `npm run test:integration` (4, writes to the live DB under `PTR-TEST`)

## Commands

```bash
npm install
npm run dev              # http://localhost:5173
npm run build            # tsc && vite build
npm test                 # 23 unit tests, pure logic, no network
npm run test:integration # 4 tests against the live Supabase project
```

`.env` holds `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. It is gitignored; the app throws at
import time without it (`src/lib/supabase.ts`).

## How to Switch Personas
- Login screen presents four persona cards: Consumer, Operator, Partner, Enterprise
- Consumer: email `consumer@demo.com` / `demo123`
- Operator: email `admin@6dtelecom.com` / `admin123`
- Partner: email `rajesh.kumar@nimbussensors.com` / `partner123`
- Enterprise: email `vikram.shah@smartbuild.in` / `enterprise123`

## Operator Console Screens (all database-backed with CRUD)

| Screen | What You Can Do |
|--------|----------------|
| Dashboard | View KPIs, approve pending settlements (individual or all) |
| Partner Onboarding | Add partners, click gates to review, add notes, clear gates (auto-advances) |
| Catalogue Review | Approve/reject (with reason), edit, delete, add listings; live margin calc |
| Settlement Runs | Approve, reject (disputed), view gross-to-net breakdown, create new |
| Inventory & WMS | Add/edit/delete stock lines + warehouses; auto-calc available stock |
| Tickets & SLA | Reply, assign, escalate, resolve, delete, create new tickets |
| Collections (Dunning) | Advance ladder steps, record promise-to-pay, close, create new |
| Promotions | Create, edit, pause/resume, delete |
| Storefront Banners | Create, edit, pause/activate, delete |
| Channels | Create, edit, enable/disable, delete notification channels |
| Roles & Users | Create/edit roles w/ capability matrix, invite/edit/remove users |
| Developer Portal | Publish/edit/delete APIs, add/remove subscriptions |
| Audit Trail | Filter by category, view hash-chained integrity log |

## Partner Console Screens

| Screen | What You Can Do |
|--------|----------------|
| Dashboard | KPIs, recent orders, settlement summary, performance charts |
| Onboarding | Multi-step seller onboarding with compliance gates |
| Listings | Manage product listings, add new, edit pricing |
| Orders | View and fulfil orders from enterprise/consumer buyers |
| Settlement | View settlement statements, gross-to-net breakdown |
| Performance | Sales analytics, rating breakdown, category performance |
| Integrations | API keys, webhook configuration |
| Support | Customer support tickets |
| Team & Roles | Team members and role management |
| Audit Log | Account-scoped activity log |
| Profile | Seller profile and business details |

## Enterprise Buyer Screens

| Screen | What You Can Do |
|--------|----------------|
| Dashboard | Procurement KPIs (monthly committed, budget used, approvals waiting, orders in flight), spend charts, marketplace tiles, pending approvals + recent orders summary |
| Approvals | Review pending requisitions with requester reason and policy, approve or decline with confirmation modal |
| Browse Catalogue | Filterable product grid with marketplace/category facets, sort, search, add to requisition |
| IoT Marketplace | View held IoT subscriptions (SIMs, sensors), browse listings by category |
| Security Marketplace | View security stack (MDR, ZTNA, endpoint), suspended seller warning, browse listings |
| Device Marketplace | View standard device list, browse phones/routers/tablets/CPE |
| Orders | All purchase orders with fulfilment stage tracking, failed order flags |
| Subscriptions | Active/suspended subscriptions with seat assignment meters, renewal dates, unassigned seat count |
| Team & Roles | Team members with roles and MFA status |
| Audit Log | Account-scoped procurement activity log |
| My Details | Contact info, procurement settings (approval threshold, IT sign-off policy, payment terms) |

## The onboarding spine (added on the `Claude` branch)

The first piece of shared state. Before it, the operator console and the partner console showed
unrelated fictions — `PartnerOnboarding` read a hardcoded array, because there was nothing to join
to: `onboarding_gates.partner_id` used its own id space (`P-013`…) with no foreign key to
`partners` (`PTR-1004`…), and carried a duplicated `partner_name` column that could disagree with
its source.

Now both consoles read and write one record.

| File | Role |
|---|---|
| `src/lib/onboarding.ts` | The gate machine. **Pure — zero imports.** `GATES`, `TECH_CHECKS`, `techStatus`, `canClearGate`, `deriveTaskState` |
| `src/lib/onboardingRepo.ts` | The only module that talks to Supabase for onboarding |
| `src/components/TechChecklist.tsx` | One component both consoles render — partner gets buttons, operator gets read-only rows |

**The rule with teeth.** `canClearGate` takes **no override parameter**, so no caller can route
around it. The Technical readiness gate refuses until four checks pass against the seller's own
records: endpoints registered for every required event, all authenticated, an acknowledged test
call each, one sandbox order completed. `clearGate` re-loads state and re-runs the guard before
writing, so a stale screen cannot force a clear.

**Task state is derived, never stored.** `onboarding_tasks` has no `status` column — a task's
state comes from its gate. A stored status is a second opinion that can contradict the gate.

**What the checks are and are not.** They are recorded and enforced. Nothing makes an HTTP call to
a seller's endpoint — `sendTestCall` writes an acknowledgement, `runSandboxOrder` writes a passed
run. The UI says so rather than implying a live callback.

### Migrations added (all applied)

| File | What |
|---|---|
| `20260728140000_reconcile_onboarding_identity.sql` | Remap `partner_id` to `PTR-*`, add the FK, drop `partner_name` |
| `20260728140100_onboarding_spine_tables.sql` | `partner_endpoints`, `endpoint_test_calls`, `sandbox_runs`, `onboarding_tasks` |
| `20260728150000_partners_write_policies.sql` | INSERT + UPDATE policies on `partners` — deliberately no DELETE |

That third migration fixed a shipped bug worth remembering: `partners` had only a SELECT policy,
and PostgREST reports an RLS-blocked UPDATE as `error: null, data: []`. So clearing the final
Go-live gate reported success, wrote an audit entry, and never published the partner. Silently.
The integration test found it on its first run. Two writes now verify rows-affected via `.select()`
rather than trusting the absence of an error.

### Known gap

The partner console is **half-migrated**. Onboarding reads live records; `PartnerDashboard`'s
open-task count and the whole `PartnerIntegrations` screen still read static arrays from
`partner/data.ts`. A seller can register an endpoint under Onboarding and not see it under
Integrations. Documented at the point of use in `data.ts`; it should be the first item of the next
piece of work.

## Cross-Persona Connections
- Enterprise orders reference the same order IDs visible in the Partner console (e.g. ORD-880519 cold-chain bundle from Nimbus Sensors)
- Enterprise subscriptions reference products from Partner sellers (Nimbus Sensors, Sentinel Cyber, CloudPath, 6D Telecom, Aventa)
- Operator catalogue review approves listings that appear in both Consumer and Enterprise browse grids
- Partner settlement statements reflect orders placed by Enterprise buyers

**Correction, verified:** the first bullet above describes an intention, not the implementation.
`partner/data.ts:25` and `enterprise/data.ts:24` each declare `ORD-880519` with `gross: 14975` as
separate literals. Neither reads the other, so a change on one side is invisible to the other. Only
onboarding is genuinely shared today. Closing that gap for orders is the same shape of work the
onboarding spine did for gates.

## Database (Supabase)
- Migrations in `supabase/migrations/`
- RLS enabled on all tables. Convention throughout: `anon` full access with `USING (true)` —
  acceptable for a prototype, **must be tightened before this is shown outside a controlled
  setting**, since anyone with the URL and anon key can modify data. `partners` is the one
  exception: INSERT and UPDATE are granted, DELETE deliberately is not, because the onboarding
  tables cascade off it.
- Key tables: `products`, `cart_items`, `orders`, `operator_profile`, `operator_tickets`, `settlement_statements`, `onboarding_gates`, `operator_catalogue`, `operator_inventory`, `operator_warehouses`, `operator_dunning`, `operator_promotions`, `operator_banners`, `operator_channels`, `operator_roles`, `operator_users`, `operator_developer_apis`, `operator_developer_subscriptions`, `operator_audit`
- Onboarding spine: `partner_endpoints`, `endpoint_test_calls`, `sandbox_runs`, `onboarding_tasks`

## File Structure
```
src/
  App.tsx              — main app, persona switching, routing
  types/index.ts       — TypeScript types
  types/view.ts        — View, OperatorView, PartnerView, EnterpriseView, Persona types
  lib/supabase.ts      — Supabase client
  lib/images.ts        — Image helpers
  lib/onboarding.ts    — the gate machine, pure (no React, no Supabase, no I/O)
  lib/onboardingRepo.ts — the only module touching Supabase for onboarding
  styles/global.css    — Global styles + CSS variables
  components/          — Consumer-facing components (Header, Hero, ProductGrid, etc.)
  components/TechChecklist.tsx — shared by the operator and partner consoles
  components/operator/ — All 12 operator screens + shared.tsx (Btn, Modal, Table, etc.)
  components/partner/  — All partner screens + data.ts
  components/enterprise/ — EnterpriseShell, EnterpriseDashboard, EnterpriseBrowse, EnterpriseViews, EnterpriseMisc, data.ts
```

## Recent Changes — `Claude` branch

**Onboarding spine** (see the section above): identity reconciled with a real FK, four new tables,
a pure rules module both consoles import, the technical gate made unclearable without proof, and
23 unit + 4 integration tests where there had been none.

**Three bugs found and fixed, each of which the layer above could not see:**
- `partners` had only a SELECT policy, so the go-live publish silently did nothing while reporting
  success. Found by the integration test; fixed by migration plus rows-affected verification.
- `partners.type` is `NOT NULL` with no default and two inserts omitted it, so the operator's
  "Add partner" button was broken. The RLS gap had been masking it. Fixed, with a Partner type
  select added to the modal.
- `handleAddPartner` duplicated the gate machine and three attributes already disagreed with it.
  Now built from `GATES`.

**Presentation fixes:**
- `var(--text-primary)` was used in four places and **is not a defined token** (the token is
  `--text`). An undefined custom property makes `color` inherit, which rendered white-on-white:
  the account-menu name was invisible, and so were the completed stage labels on the consumer's
  order tracker. All four replaced.
- The consumer account menu rendered **two "Sign out" items**; the second was a leftover
  placeholder whose handler only closed the dropdown. Removed.
- Persona cards on the login screen had ragged heights where a description wrapped. Given a
  `minHeight` floor.

## Earlier changes
- Added Enterprise Buyer as fourth persona with full procurement workflow
- Enterprise login card on LoginScreen (teal accent, Building2 icon)
- EnterpriseShell with sidebar nav (Dashboard, Approvals, Browse, IoT, Security, Devices, Orders, Subscriptions, Team, Audit, Profile)
- Enterprise data model: profile, subscriptions, orders, approvals, catalogue — all referencing Partner sellers and Operator order IDs
- Approvals workflow with approve/decline confirmation modal and policy thresholds ($2,000 finance approval, IT sign-off for security)
- Suspended seller warning (Vertex Endpoint) with replacement guidance (Sentinel MDR)
- Budget tracking with spend-by-month and spend-by-marketplace visualisations
- Fixed duplicate export in LoginScreen.tsx
- Fixed type errors in OperatorDunning, OperatorPromotions, OperatorChannels, OperatorInventory (parseFloat fallbacks returning string instead of number)
- Fixed null-safety in OperatorRoles (assigned_count check)
- All operator screens have full CRUD wired to Supabase
