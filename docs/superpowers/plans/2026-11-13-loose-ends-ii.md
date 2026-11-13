# Spec 11 — loose ends II — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

Spec: `docs/superpowers/specs/2026-11-13-loose-ends-ii-design.md` (decisions 1–12 bind). Branch `loose-ends-ii`.

**Goal:** an operator screen for the nightly log, a requisition basket that survives a reload, and the spec 7
bundle edge cases closed.

## Constraints

No new runtime dependencies; WCAG 2.2 AA (`contrast.test.ts`); 44px controls; reduced motion; pure modules never
import `supabase`; components read and write only through repos; any unit/DOM test that reaches
`src/lib/supabase.ts` must `vi.mock` it (CI has no keys). Browser storage: every read and write in `try`.
Migration: idempotent, one transaction, `create or replace`, `drop … if exists`, copy the **latest** definition of
any function it replaces (grep every migration), no bare CASE in IF/ELSIF, PL/pgSQL variables never share a column
name (or use a block label), no named constraint colliding with `<table>_<col>_check`, new functions revoked from
`public, anon, authenticated` unless the app calls them, final self-check DO block with a rolled-back dry run
(`errcode = 'ZZ999'`), syntax-checked with libpg-query before hand-over. Integration tests skip until applied,
read or clean up after themselves, place no orders or payments, and are run one file at a time with pauses.
Gates per task: `npx vitest run` (only `gateway.test.ts` financingProblem and `partnerApplication.test.ts`
'02 Aug 2026' may fail locally), `npx tsc --noEmit`, `npm run build`. Commits: plain-English subject,
`Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Tasks

### Task A: Scheduled jobs screen
Files: new pure `src/lib/jobLog.ts` (+ `jobLog.test.ts`, test-first); `src/lib/jobLogRepo.ts` (read
`scheduled_job_log`, last 15 days, newest first, through `settle`/`loaded` like other repos);
new `src/components/operator/OperatorJobs.tsx` (+ `OperatorJobs.dom.test.tsx`); `src/types/view.ts` (`'op-jobs'`);
`OperatorShell.tsx` (Platform group, after Channels, label "Scheduled jobs", icon `Clock`);
`OperatorScreens.tsx` (route). Styles in an existing operator stylesheet.
- `nights(rows)` → `{ ranOn, startedAt, jobs: { job, ok, ms, summary, error }[] }[]`, newest first, latest row per job per night.
- `health(rows, now)` → `{ tone: 'success' | 'warning' | 'danger', says }`: danger "The night has not run since {date}" when
  the newest row is older than 26 h (or there are none: "The night has never run"); warning "{n} of {m} jobs failed on {date}";
  success "Last night ran at {HH:MM} UTC on {d Mon} — {m} jobs, all succeeded".
- `summarise(job, result)` → one line per known job (agreements, enterprise subscriptions, subscriptions, documents,
  settlements, payments, bundle selections), read defensively from `result`; anything else "Done".
- Screen: health line (StatusBadge tone), up to 14 night cards (BentoCard), one row per job with OK/Failed badge,
  duration, summary, full error when failed; footnote with `select public.run_nightly();`. Loading, empty and
  failed-read states.

### Task B (revised 2026-11-13): Baskets kept in the database, watched by the operator, flagged when stock goes
Spec section 2 and decisions 1, 2, 2a–2c bind. Two parts, one branch.

**B1 — migration** `supabase/migrations/20261113200000_a_basket_is_kept_and_watched.sql` + `src/lib/baskets.migration.test.ts`,
written to apply after `20261113100000` (which is on this branch, not yet applied; copy `run_nightly` from it, eight jobs:
agreements, enterprise subscriptions, subscriptions, documents, payments, bundle selections, baskets, settlements).
Tables, `save_requisition_basket`, `cart_items` columns + `updated_at` trigger + operator read, `flag_basket_stock`
and the `products` trigger, the database refusals while a line is flagged (cart: extend the order-line path that
checkout's `order_items` insert hits; requisition: raising — find how `raiseRequisition` writes), `remind_basket_owner`,
`run_baskets_night(p_as_of)` (sweep + 90-day clear), `op-baskets` help article (same shape as the op-jobs one in
`20261113100000`). Self-check with a rolled-back dry run of the night (8 jobs ok) and a rolled-back stock-flag case.
STOP after syntax check: the user applies both migrations.

**B2 — client**: `src/lib/basketRepo.ts` (load/save/accept/remove for both kinds, operator lists, remind);
pure `src/lib/baskets.ts` (+ test, first): idle state Pending/Abandoned at 7 days, flag → note/actions, value,
"blocked" for a basket/bundle with any flagged line. `RequisitionContext.tsx`: load on sign-in, debounced save,
re-read on focus and before Raise, delete on raise; header comment rewritten. `RequisitionPanel.tsx` and
`CartDrawer.tsx`/`Checkout.tsx`: flagged lines with Accept/Remove, Raise/checkout blocked. Accepted quote
"Add to requisition" recognises a basket line by `quote_line_id`. `useBundleShelf.ts`: cache key
`${userId}:${currency}`, cleared on auth change. New operator screen `OperatorBaskets.tsx` (`op-baskets`) with
Business / Shoppers tabs, Pending/Abandoned filter, line detail, Send reminder; nav + route + view union.
`jobLog.ts` summarises `baskets`. Before the migration is applied every read must fail soft (the screens behave as
today; the basket stays in memory). DOM tests for the drawer's flagged line and the operator screen.

### Task C: The migration (user applies)
File: `supabase/migrations/20261113100000_a_bundle_is_bought_whole.sql` + `src/lib/bundleWhole.migration.test.ts`.
1. `subscriptions` add `bundle_selection_id text references bundle_selections(id) on delete set null`, `bundle_price_until date`.
2. `subscription_renewal_price(p_sub subscriptions, p_on date) returns numeric`: price until `bundle_price_until`, after it
   the published `product_prices` price in the sub's currency, `greatest(published, floor)`; null published → keep price.
   `renew_subscriptions` (copy from `20261112600000`) uses it per cycle and sets `subscriptions.price` when it switches.
3. `guard_bundle_order_line` (latest copy): "already ordered" ignores `order_items` on `awaiting_payment` orders whose
   `payment_ref` differs from this order's; drop the cart-completeness block and its residual-risk comment.
4. `settle_payment_attempt` (latest copy, `20260807330000` or later): on `succeeded` with purpose `order`, before moving
   orders to `placed`, find any selection on this reference's orders whose lines are not all on this reference's
   orders, or that has a line on another non-`awaiting_payment` order; if so record the attempt `failed` with
   "A bundle was not bought whole, so nothing was charged.", delete this reference's `awaiting_payment` orders and
   items, return as a failed outcome.
5. Trigger `z_one_requisition_per_selection` on `enterprise_requisition_lines` insert/update: refuse a selection already
   on a line of another requisition whose status is not `rejected`/`cancelled` (check real status values first).
6. `configure_bundle` (latest copy): business caller may pass a currency in `market_currencies` for the account's
   market; default unchanged. Check its signature in the client (`bundleRepo.ts`) and keep it compatible.
7. `delete_unused_bundle_selections(p_as_of date)`: delete selections with `valid_until < p_as_of - 7` and no
   `cart_items`, `enterprise_requisition_lines` or `order_items` row; returns `{deleted}`.
8. `run_nightly` (copy from `20261112700000`): jobs `agreements, enterprise subscriptions, subscriptions, documents,
   payments, bundle selections, settlements`; `payments` calls `expire_stale_payments()` and returns `{expired}`.
9. Self-check: columns, functions, trigger, revokes, and in a rolled-back block a bundle subscription whose price
   switches at `bundle_price_until`; dry run of the night has 7 jobs.
Then: syntax check; update `nightly.migration.test.ts`/`demoCatchUp.migration.test.ts` only if they assert the
latest run_nightly (they read their own files — leave them). **STOP: hand to the user to apply.**

### Task D (after apply): Screens and live tests
Files: `src/components/Checkout.tsx` (write `bundle_selection_id`, `bundle_price_until` = today + 12 months on a
bundle part's subscription; surface the settle failure reason); `BundleConfigurator.tsx` and `BundleGroup.tsx`
("Bundle price for 12 months, then {list}/month" on monthly parts); business configurator passes the requisition's
currency; `EnterpriseRefunds.tsx` refund picker and `OperatorOrders.tsx` group bundle lines (`groupBySelection`,
`useBundleNames`, `BundleGroup` heading); `nightly.integration.test.ts` expects 8 jobs (incl. `payments`,
`bundle selections`, `baskets`).
**Must land before the migrations are merged to main** (from Task C's report): `PaymentGateway.tsx` passes its own
`outcome` to `onSettled` and ignores `res.state` — read `res.state`/`note` from `settle_payment_attempt` so a
"bundle not bought whole" failure shows as a failed payment, not success; and on any failed/cancelled payment,
checkout's `undo` also removes the never-charged subscriptions it wrote for those orders (today it deletes only
orders). `bundle_price_until` = purchase date + 12 months (a renewal starting on that date is at the published price).
New `src/lib/bundleWhole.integration.test.ts`: second requisition refused for the same selection (create, then
delete); a throwaway template with `SKU-5004` (paused) as an option is blocked (operator creates, deletes);
`delete_unused_bundle_selections` not callable through the API.

### Task E: Docs and merge
README (job screen, basket, bundle rules, seven jobs), backlog (close items), memory; final review; merge `--no-ff`.
