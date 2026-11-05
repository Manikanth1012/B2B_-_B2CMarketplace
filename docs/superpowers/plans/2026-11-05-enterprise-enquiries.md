# Spec 6 — enterprise enquiries — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a signed-in business buyer request a quote, book a demo and contact sales, follow each to an answer, and accept a quote into the requisition at the quoted price — answered by the listing's seller or the operator desk.

**Architecture:** One `enquiries` record with typed child tables, all rules enforced by triggers and RLS in one migration the user applies. A pure module (`src/lib/enquiries.ts`) mirrors those rules for the screens; `src/lib/enquiryRepo.ts` does the reads and writes. Buyer, seller and operator screens are built in parallel on top.

**Tech stack:** Vite 5, React 18, TypeScript, Supabase (Postgres, RLS), Vitest 2 (Node; unit `src/**/*.test.ts`, integration `vitest.integration.config.ts`).

**Spec:** `docs/superpowers/specs/2026-11-05-enterprise-enquiries-design.md`

## Global Constraints

- No change to existing behaviour beyond what this spec adds: routes, view ids, repos, RLS and flows that exist keep working.
- No new runtime dependencies.
- Claude never applies migrations; the user does. Nothing may assume the new tables exist until the controller records the user's go-ahead.
- Every state rule that matters is enforced in the database (triggers, RLS) and mirrored by pure tested functions; the screen never decides what the database would refuse.
- Money: one currency per enquiry (the account's `enterprise_accounts.currency`), shown with `fmtIn`.
- WCAG 2.2 AA; `src/lib/contrast.test.ts` stays green incl. its guard against `color: var(--brand-accent)` in `.tsx`; 44px controls on new screens; reduced motion respected; use the shared `Dialog` (`src/components/ui/Dialog.tsx`), `StatusBadge` + `statusTone`, `KpiCard`, `BentoCard`, console `SectionCard`/`Table`/`Btn`/`FormField` from `src/components/operator/shared.tsx`.
- Pure modules never import `supabase` (the `pureModules` test enforces it).
- Integration tests delete every row they create.
- Gates per task: `npx vitest run` (only `gateway.test.ts` financingProblem and `partnerApplication.test.ts` '02 Aug 2026' may fail) and `npm run build`.
- Commits: plain-English subject saying what changed and why, short body, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only files you changed; never force-add ignored files.
- Parallel worktrees: `npm ci` inside the worktree; copy `.env` in if missing; never commit it.

## Facts about the existing schema (verified)

- `products(id, category_id, partner_id → partners, seller, price, model ('oneoff' | subscription models), stock, status, unit, …)`.
- `enterprise_accounts(id, company, currency, …)`; `enterprise_users(id text, account_id, user_id uuid, name, email, role, can_raise bool, status, …)`.
- `enterprise_requisitions(id, account_id, state 'pending'|…, currency not null, …)`; `enterprise_requisition_lines(id, requisition_id, product_id, name, seller, partner_id, quantity, unit_price, line_total, sort_order)` guarded by `guard_requisition_line()` (enterprise persona, `can_raise`, requisition `pending`).
- Identity helpers: `current_persona()` ('operator' | 'partner' | 'enterprise' | 'consumer'), `current_partner_id()`, `current_account_id()`.
- Notifications: `notification_events(id, label, description, personas text[], category, sort_order)`, `notification_rules(id, persona, event_id, name, audience, kinds text[], throttle, severity, enabled, …)`, `notification_log(id, rule_id, kind_id, channel_id, persona, recipient, user_id, partner_id, subject, body, sent_at, state, detail, cost, ref)` with check `state not in ('failed','suppressed') or detail is not null`. Read the full `20260731220000_notifications.sql` and later notification migrations for every NOT NULL / check before inserting.
- Support tickets (`20260801200000_support_tickets.sql`) are the house pattern for status checks, guard triggers and RLS — follow their style and comment voice.

## Interfaces (produced by Task 1, consumed by all later tasks)

```ts
// src/lib/enquiries.ts — pure
export type EnquiryType = 'quote' | 'demo' | 'sales'
export type QuoteStatus = 'submitted' | 'quoted' | 'accepted' | 'declined' | 'withdrawn'
export type DemoStatus = 'requested' | 'scheduled' | 'done' | 'declined' | 'withdrawn'
export type SalesStatus = 'open' | 'answered' | 'closed'
export type EnquiryStatus = QuoteStatus | DemoStatus | SalesStatus
export type Role = 'buyer' | 'responder' | 'operator'   // operator may also act as responder on desk-routed rows
export type Waiting = 'buyer' | 'responder' | 'nobody'

export interface Enquiry {
  id: string; type: EnquiryType; account_id: string; raised_by: string
  partner_id: string | null; subject: string; status: EnquiryStatus
  currency: string | null; needed_by: string | null; valid_until: string | null
  format: 'video' | 'onsite' | null; attendees: number | null
  contact_pref: 'email' | 'phone' | 'in_app' | null; decline_reason: string | null
  created_at: string; updated_at: string; decided_at: string | null
}
export interface EnquiryLine {
  id: string; enquiry_id: string; product_id: string; name: string; partner_id: string | null
  quantity: number; target_unit_price: number | null; quoted_unit_price: number | null; sort_order: number
}
export interface EnquirySlot { id: string; enquiry_id: string; starts_at: string; proposed_by: 'buyer' | 'responder'; confirmed: boolean; location: string | null }
export interface EnquiryMessage { id: string; enquiry_id: string; author_role: 'buyer' | 'partner' | 'operator'; author_name: string; body: string; created_at: string }
export type Action = 'quote' | 'requote' | 'accept' | 'decline' | 'withdraw' | 'confirm-slot' | 'propose-slot' | 'mark-done' | 'reply' | 'close' | 'reassign'

export function routeTo(lines: readonly { partner_id: string | null }[]): string | null
export function canTransition(type: EnquiryType, from: EnquiryStatus, to: EnquiryStatus, role: Role): boolean
export function isExpired(e: Pick<Enquiry, 'type' | 'status' | 'valid_until'>, today: string): boolean
export function enquiryState(e: Enquiry, today: string): EnquiryStatus | 'expired'
export function waitingOn(e: Enquiry, today: string): Waiting
export function nextActions(e: Enquiry, role: Role, today: string, opts?: { canRaise?: boolean; isDesk?: boolean }): Action[]
export function quoteTotals(lines: readonly EnquiryLine[]): { lines: { id: string; total: number }[]; total: number } | null
export function validUntilProblem(date: string, today: string): string | null      // null = ok; 1–90 days ahead
export function slotProblems(slots: readonly Pick<EnquirySlot, 'starts_at' | 'confirmed'>[], nowIso: string): string | null
export function demoOffered(p: { model: string; category_id: string }): boolean   // model !== 'oneoff' || category in ('iot','security')
export function toRequisitionLines(e: Enquiry, lines: readonly EnquiryLine[]): {
  product_id: string; name: string; partner_id: string | null; quantity: number; unit_price: number; quote_line_id: string
}[]   // throws if e is not an accepted, unexpired quote or a line is unpriced
```

```ts
// src/lib/enquiryRepo.ts — produced by Task 3
export interface EnquiryBook { enquiries: Enquiry[]; lines: EnquiryLine[]; slots: EnquirySlot[]; messages: EnquiryMessage[]; events: EnquiryEvent[]; loadError: string | null }
export interface EnquiryEvent { id: string; enquiry_id: string; actor_role: string; actor_name: string; action: string; from_status: string | null; to_status: string | null; note: string | null; at: string }
export function loadEnquiries(): Promise<EnquiryBook>   // RLS decides scope per persona
export function raiseQuote(input: { subject: string; lines: { product_id: string; quantity: number; target_unit_price?: number | null }[]; needed_by?: string | null; note?: string | null }): Promise<{ ok: true; id: string } | { ok: false; error: string }>
export function raiseDemo(input: { subject: string; product_id: string; format: 'video' | 'onsite'; attendees: number; slots: string[]; note?: string | null }): Promise<Result>
export function raiseSales(input: { subject: string; message: string; contact_pref: 'email' | 'phone' | 'in_app' }): Promise<Result>
export function sendQuote(id: string, prices: Record<string, number>, valid_until: string, note?: string | null): Promise<Result>
export function acceptQuote(id: string): Promise<Result>          // status → accepted only; the screen then adds lines via RequisitionContext
export function decline(id: string, reason: string): Promise<Result>
export function withdraw(id: string): Promise<Result>
export function confirmSlot(slotId: string, location: string): Promise<Result>
export function proposeSlot(enquiryId: string, starts_at: string): Promise<Result>
export function markDone(id: string): Promise<Result>
export function reply(id: string, body: string): Promise<Result>
export function closeEnquiry(id: string): Promise<Result>
export function reassign(id: string, partner_id: string | null, reason: string): Promise<Result>
type Result = { ok: true } | { ok: false; error: string }
```

---

### Task 1 (parallel with Task 2): Pure enquiry logic, test-first

**Files:** create `src/lib/enquiries.ts`, `src/lib/enquiries.test.ts`.

- [ ] Write `enquiries.test.ts` first covering, at minimum:
  - `routeTo`: all lines one partner → that partner; two partners → null; any null partner → null; empty → null.
  - `canTransition` for every row of the spec §1 transition table, both allowed and refused examples per role (e.g. buyer cannot `submitted→quoted`; responder cannot `quoted→accepted`; nobody leaves `accepted`/`declined`/`withdrawn`/`closed`/`done` except `sales closed` stays closed).
  - `isExpired`/`enquiryState`: quoted with `valid_until` yesterday → expired; today → not expired; non-quote never expired.
  - `waitingOn`: submitted→responder; quoted (unexpired)→buyer; quoted expired→responder (to re-quote); requested→responder; scheduled→nobody; open→responder; answered→buyer; terminal→nobody.
  - `nextActions`: buyer on quoted gets accept/decline/withdraw/reply only when `canRaise`; without `canRaise` only reply/withdraw…; responder on submitted gets quote/decline/reply; operator gets reassign only when `isDesk` or a partner is set; expired quote: buyer cannot accept, responder can requote.
  - `quoteTotals`: priced lines sum to 2-dp totals; any unpriced → null.
  - `validUntilProblem`: today → problem; +1 day ok; +90 ok; +91 problem; past → problem.
  - `slotProblems`: 0 slots problem; 4 slots problem; a past slot problem; two confirmed problem; 1–3 future ok.
  - `demoOffered`: oneoff device in 'device' → false; subscription → true; oneoff in 'iot' → true.
  - `toRequisitionLines`: accepted unexpired quote → lines with `quote_line_id` and quoted price; quoted (not accepted) → throws; expired → throws; unpriced line → throws.
- [ ] Run `npx vitest run src/lib/enquiries.test.ts` — FAIL (module missing).
- [ ] Implement exactly the interface above; no `supabase` import; dates as `YYYY-MM-DD` strings compared lexically.
- [ ] Run — PASS; full gates.
- [ ] Commit: "The rules of an enquiry, as pure functions the screens and the database will agree on".

### Task 2 (parallel with Task 1): The migration

**Files:** create `supabase/migrations/20261105100000_a_business_can_ask_before_it_buys.sql`; create `src/lib/enquiries.migration.test.ts` (a Node test that reads the SQL file and asserts structural facts, so the file is checked without a database).

Implement spec §1 exactly, idempotent throughout:
- [ ] Sequence `enquiry_seq` and default `id` = `'ENQ-' || nextval('enquiry_seq')` starting at 1001; seed rows use `ENQ-9xxx` explicitly.
- [ ] Tables `enquiries`, `enquiry_lines`, `enquiry_slots`, `enquiry_messages`, `enquiry_events` with the columns, FKs (`on delete cascade` from children), and checks in spec §1 (type/status sets per type via a check on `(type, status)` pairs; `subject` length; `attendees` 1–500; `body` 1–4000; `decline_reason` required when `status = 'declined'`; `location` required when `confirmed`; partial unique index one confirmed slot per enquiry).
- [ ] `before insert` trigger on `enquiry_lines` → after lines exist the routing must hold: implement routing in an `after insert` statement-level or in a `route_enquiry(p_id)` function called by the repo's insert RPC. **Resolution:** create SECURITY DEFINER RPCs `raise_quote(...)`, `raise_demo(...)`, `raise_sales(...)` that insert the enquiry and its lines/slots/first message in one transaction, compute `partner_id` by the routing rule, set `currency` from the account, `raised_by` from the caller's `enterprise_users` row, and check `can_raise` for quote/demo. Direct `insert` on `enquiries` by the enterprise persona is not granted.
- [ ] Guard trigger `guard_enquiry()` (`before update`) enforcing the transition table with the caller's role derived from `current_persona()` and whether `partner_id = current_partner_id()` / desk; sets `updated_at`, `decided_at`; refuses `accepted` when `valid_until < current_date`; refuses `quoted` unless every line has `quoted_unit_price` and `valid_until` is 1–90 days ahead; only operator may change `partner_id`; writes an `enquiry_events` row for every status or `partner_id` change.
- [ ] Guard trigger on `enquiry_lines` updates: buyer may not set `quoted_unit_price`; responder may set only `quoted_unit_price` while the enquiry is `submitted` or `quoted`.
- [ ] Slot rules (buyer proposes on raise; responder `propose`/`confirm`; confirming sets status `scheduled`), message author role derived from persona (not trusted from the client).
- [ ] RLS per spec §1 on all five tables (operator all; enterprise own account read, message/slot insert on own; partner routed rows read+answer, desk-routed multi-seller quote: own lines read-only; events read-only to whoever can read the enquiry).
- [ ] `alter table enterprise_requisition_lines add column if not exists quote_line_id text references enquiry_lines(id)`; unique partial index; `guard_quoted_line()` before insert/update: when set, quote accepted, `valid_until >= current_date`, same account as the requisition, product and quantity match, `unit_price = quoted_unit_price`, `line_total = unit_price * quantity`.
- [ ] Notifications: three `notification_events` rows; one rule per (event, persona) with `kinds` `['inapp']`; trigger `notify_enquiry()` after insert/update writing `notification_log` rows (inapp `delivered`; other kinds in the rule `suppressed` with detail) with `ref = enquiry id`, recipients per spec §1. Satisfy every NOT NULL/check found in the notification migrations.
- [ ] Seed: SmartBuild account (`ENT-…` — read the enterprise seed for its id and Vikram's `enterprise_users` id) — one quote `quoted` (valid 30 days), one demo `scheduled`, one sales `answered`, one desk-routed two-seller quote `submitted`; with lines/slots/messages. Delete-then-insert by `ENQ-9%`.
- [ ] Header comment in the house voice explaining why the table exists and the routing/acceptance rules; comments on each guard.
- [ ] `enquiries.migration.test.ts` asserts: the file defines the five tables, the three RPCs, `guard_enquiry`, `guard_quoted_line`, `notify_enquiry`, enables RLS on all five tables, adds `quote_line_id`, and contains no `drop table` without `if exists`.
- [ ] Gates; commit: "The tables, rules and notifications behind a business asking before it buys".

### Task 3: Repository and status tones

**Files:** create `src/lib/enquiryRepo.ts`; modify `src/lib/consoleTone.ts` + test.
**Consumes:** Task 1 types; Task 2 RPC names and argument names (read the migration).

- [ ] `statusTone` additions, test-first: submitted→info, quoted→warning (waiting on buyer), accepted→success, requested→info, scheduled→success, done→success, answered→warning, expired→neutral (open/declined/withdrawn/closed already mapped — verify, add if missing).
- [ ] Implement `enquiryRepo.ts` exactly per the interface: reads select from the five tables (RLS scopes them); raises call the RPCs; transitions are `update`s the trigger guards; every function returns `{ ok: false, error }` with the database message on failure (never throws, never swallows).
- [ ] Gates; commit: "Reading and answering enquiries through the database's own rules".

### Task 4 (parallel): Buyer screens

**Files:** create `src/components/enterprise/EnterpriseEnquiries.tsx`, `src/components/enquiries/EnquiryDetail.tsx`, `src/components/enquiries/EnquiryList.tsx`, `src/components/enquiries/RaiseQuoteDialog.tsx`, `RaiseDemoDialog.tsx`, `ContactSalesDialog.tsx`, `src/styles/enquiries.css` (import in `src/main.tsx` after `account-view.css`); modify `EnterpriseShell.tsx` (sidebar item "Enquiries" after Orders, header "Contact Sales"), `App.tsx` (view `en-enquiries`), `EnterpriseListingModal.tsx` (Request a quote / Book a demo via `demoOffered`), `RequisitionPanel.tsx` ("Request a quote for this basket"), `EnterpriseDashboard.tsx` (KPI "Enquiries waiting on you" from `waitingOn`), `src/components/public/*` Enterprise page Contact Sales → sign-in.
**Consumes:** Tasks 1 and 3.

- `EnquiryList` and `EnquiryDetail` are shared by all three consoles (props: `role`, `book`, callbacks) — build them here with the buyer's actions; Tasks 5/6 consume them and add responder actions through the same `nextActions` switch, so write the action bar to render whatever `nextActions` returns.
- Accept: call `acceptQuote`, then add `toRequisitionLines(...)` to the requisition through `RequisitionContext` (extend its `add` to carry `quote_line_id` and a fixed unit price — read the context and `addToBasket` first; a quoted line must not be repriced by `repriceTo`), then open the drawer.
- Chips: All / Waiting on you / Waiting on them / Closed (`role="radiogroup"`, as Business Accounts does).
- Commit: "A business can ask for a quote, a demo or a word with sales, and follow each to an answer".

### Task 5 (parallel): Seller screens

**Files:** create `src/components/partner/PartnerEnquiries.tsx`, `src/components/enquiries/QuoteResponseForm.tsx`, `src/components/enquiries/SlotResponseForm.tsx`; modify `PartnerShell.tsx` (item "Enquiries" near Orders), `App.tsx` (view `pt-enquiries`).
**Consumes:** Tasks 1, 3 and the shared `EnquiryList`/`EnquiryDetail` from Task 4 — **resolution:** Task 5 starts after Task 4 has committed the two shared components (controller dispatches Task 4 first and Task 5/6 once those two files exist on the branch; the rest of Task 4 continues in parallel).
- Quote form: one price input per line, valid-until (validated by `validUntilProblem`), note; floor warning from the seller's agreed price floor (find it in `src/lib/pricing.ts`/catalogue data; warn, do not block).
- Commit: "Sellers answer the quotes and demos asked of their listings".

### Task 6 (parallel): Operator screens

**Files:** create `src/components/operator/OperatorEnquiries.tsx`, `src/components/enquiries/ReassignDialog.tsx`; modify `OperatorShell.tsx` (Service group, after Tickets & SLA, id `op-enquiries`), `App.tsx`, `OperatorDashboard.tsx` (Quick actions link).
**Consumes:** as Task 5.
- Filters: type, status, who answers (desk / each partner), age; answers desk-routed enquiries with the Task 5 forms (import them once they exist; if not yet, coordinate via the controller); reassign with reason.
- Commit: "The operator's enquiry desk: everything asked, answered where no seller can".

### Task 7: STOP — the user applies the migration

Controller tells the user the file path, the two ways to apply it (Supabase SQL editor paste, or `supabase db push` from a linked CLI), and waits. Record the go-ahead in the ledger.

### Task 8: Integration tests and browser sweep

**Files:** create `src/lib/enquiries.integration.test.ts` (follow the sign-in helpers in existing `*.integration.test.ts`).
- Scenarios in spec §4; every test deletes its rows (operator client) in `afterAll`.
- Browser: all three consoles at 1280/1024/390 with `scripts/contrast-scan.js`; keyboard through every new dialog; one quote round trip across personas, then delete it.
- One fix wave for findings.

### Task 9: Docs, final review, merge

README: an "Enquiries" section (routing, statuses, accept → requisition, notifications, the migration). Backlog: spec 6 done; spec 7 next. Final whole-branch review on the most capable model; merge `--no-ff`; push.
