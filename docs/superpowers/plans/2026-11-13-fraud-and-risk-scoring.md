# Spec 13 — fraud and risk scoring — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** score every shopper order when its payment succeeds and every account nightly, hold high-risk shopper
orders for an operator decision, and give the operator a Risk screen to decide, review and tune the rules.

**Architecture:** rules, bands, scores and decisions live in operator-only tables; two pure SQL scorers
(`score_order`, `score_account`) return `{score, band, reasons}`; `settle_payment_attempt` scores and holds;
a tenth nightly job refreshes account scores. The client reads through one repo; a pure module turns scores
into words. Before the migration is applied every screen behaves as today.

**Tech Stack:** Vite, React 18, TypeScript, Supabase (Postgres, RLS, pg_cron), Vitest.

Spec: `docs/superpowers/specs/2026-11-13-fraud-and-risk-scoring-design.md` (decisions 1–11 bind). Branch `fraud-risk-scoring`.

## Global Constraints

- Bands: orders Review ≥ 40, Hold ≥ 70; accounts Review ≥ 40, High ≥ 70 (editable, seeded with these).
- Order band names `low` | `review` | `hold`; account band names `low` | `review` | `high`.
- Buyer wording for a held order, exactly: "We're checking this order — usually within a few hours." Never show a score or a rule to a buyer or seller.
- Refund on cancel: `reason 'cancelled'`, `decider 'marketplace'`, `state 'approved'`, `decision_note` = "Cancelled after a fraud review: " + the operator's note.
- Migration `supabase/migrations/20261113600000_orders_and_accounts_are_scored_for_risk.sql`, applied after `20261113500000` (copy `run_nightly` from `20261113400000`, `settle_payment_attempt` from `20261113100000` — grep every migration to confirm they are the latest).
- Migration rules: idempotent, one transaction, `create or replace`, `drop … if exists`, no bare CASE in IF, block labels where a variable could clash with a column, new functions revoked from `public, anon, authenticated` unless the app calls them, final self-check DO block with rolled-back cases (`errcode = 'ZZ999'`), syntax-checked with libpg-query before hand-over.
- No new runtime dependencies; WCAG 2.2 AA; 44px controls; pure modules never import `supabase`; components read and write only through repos; unit/DOM tests that reach `src/lib/supabase.ts` must `vi.mock` it.
- Gates per task: `npx vitest run` (only `gateway.test.ts` financingProblem and `partnerApplication.test.ts` '02 Aug 2026' may fail locally), `npx tsc --noEmit`, `npm run build`. Run vitest from `D:/Claude/Projects/B2B_Marketplace` (upper-case D).
- Commits: plain-English subject, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Integration tests skip until applied, clean up after themselves, place no real payment, run one file at a time.

---

### Task A: Pure risk module

**Files:** Create `src/lib/risk.ts`, `src/lib/risk.test.ts` (test first).

**Produces:**
```ts
export type OrderBand = 'low' | 'review' | 'hold'
export type AccountBand = 'low' | 'review' | 'high'
export interface RiskReason { rule: string; label: string; points: number }
export interface Bands { review_at: number; hold_at: number }
export const DEFAULT_ORDER_BANDS: Bands   // { review_at: 40, hold_at: 70 }
export const DEFAULT_ACCOUNT_BANDS: Bands // { review_at: 40, hold_at: 70 }
export const HELD_FOR_BUYER: string       // "We're checking this order — usually within a few hours."
export function orderBand(score: number, b: Bands): OrderBand
export function accountBand(score: number, b: Bands): AccountBand
export function reasonsLine(reasons: readonly RiskReason[]): string   // "New account +20 · First order +10", highest first, "No rules fired" when empty
export function bandTone(band: OrderBand | AccountBand): 'success' | 'warning' | 'danger'
export function ruleEditProblem(edit: { points: number; threshold: number | null; needsThreshold: boolean }): string | null
export function bandsProblem(b: Bands): string | null  // whole numbers, 1–100, review_at < hold_at
```
- [ ] Tests: band boundaries (39/40/69/70), reasons ordering and empty case, tones, rule edit (points integer −50..100; threshold required when the rule has one, > 0), bands (review below hold, 1–100).
- [ ] Implement; gates; commit "Risk bands, reasons and rule checks, as plain functions".

### Task B: The migration (user applies)

**Files:** Create the migration and `src/lib/risk.migration.test.ts`.

1. Tables (RLS on; operator read; no write policies — functions write): `risk_rules(id text pk, applies text check in ('order','account'), label, points int, enabled bool, threshold numeric null, unit text null, sort_order, updated_at, updated_by)`, `risk_settings(kind pk check in ('order','account'), review_at int, hold_at int, check review_at < hold_at)`, `order_risk(order_id uuid pk → orders on delete cascade, score, band, reasons jsonb, scored_at, decision text null check in ('released','cancelled'), decided_by text, decided_at, note)`, `account_risk(kind check in ('shopper','business'), id text, score, band, reasons, scored_at, pk(kind,id))`, `risk_rule_changes(id, rule_id, field, was, now, by_name, at)`.
2. Seeds (on conflict do nothing), ids stable:
   order — `o-account-review` +15, `o-account-high` +30, `o-new-account` +20 (threshold 7 days), `o-first-order` +10, `o-big-order` +25 (threshold 3 ×median), `o-sim-line` +15 (an order item with `fulfil = 'esim'` or a product whose category is a SIM/eSIM one — check `categories`), `o-sim-new-address` +30, `o-guest` +15, `o-failed-payments` +25 (threshold 2 in 24 h, `payment_attempts.state = 'failed'`), `o-burst` +20 (threshold 3 per hour), `o-carrier-emi` +10 (threshold 200 USD, converted with `fx_rates`; methods `carrier_billing`, `emi`);
   account — `a-refunds` +10 each cap 30 (90 days), `a-disputes` +25 each (180 days; find the disputes table written by `open_dispute`), `a-failed-payments` +5 each cap 20 (30 days), `a-bursts` +15 (5 orders in a day, 30 days), `a-over-credit` +20 (business; `account_exposure` vs `enterprise_billing.credit_limit`), `a-overdue` +15 (business; an invoice `overdue`, or `open` past `due`).
   settings — order 40/70, account 40/70.
3. `score_account(p_kind text, p_id text) returns jsonb` (stable, security definer) and `score_order(p_order uuid) returns jsonb` (uses the buyer's `account_risk` band; a guest has none). Disabled rules never fire. Each returns `{score, band, reasons:[{rule,label,points}]}`.
4. `refresh_account_risk(p_as_of date)` (operator or scheduler): upserts `account_risk` for every shopper with an order or a payment attempt and every business account; returns `{ran_on, scored, review, high}`. Granted to `authenticated` (it refuses anyone but the operator) so the Risk screen can rescore on demand (decision 6).
5. `settle_payment_attempt` (latest copy; changed only): after shopper orders move to `placed`, each is scored into `order_risk`; one in band `hold` becomes status `held`. Business orders (account set) are not touched. The success answer gains `held: [order_ref…]`.
6. `decide_held_order(p_order_ref text, p_decision text, p_note text)` (operator only; note required): release → `placed`; cancel → `cancelled`, one `refunds` row per order line (Global Constraints wording; `buyer_type 'consumer'`, `customer` buyer name, `user_id`, `currency`, `amount` line total, `requested`/`decided_on` today, `sla_due` today, `decided_by` operator name), records the decision. Refuses an order that is not held.
7. `update_risk_rule(p_id, p_points, p_enabled, p_threshold)` and `set_risk_bands(p_kind, p_review_at, p_hold_at)` (operator only; validate as Task A; write `risk_rule_changes`).
8. Held means hidden and frozen: recreate `partner_read_own_orders` / `partner_read_own_order_items` (latest copies) with `status <> 'held'`; `guard_order_fulfilment` and `guard_operator_order_edit` (latest copies) refuse a stage or status change on a held order except through `decide_held_order` (session flag `aventa.risk_decision`).
9. `run_nightly` (copy from `20261113400000`): job `risk` after `invoices`, before `settlements` — ten jobs.
10. Help: `op-risk` article (next KB-O number, as `op-baskets` was seeded); `op-jobs` article told about ten jobs.
11. Self-check (all rolled back): tables/RLS/no write policies; revokes (app calls only `decide_held_order`, `update_risk_rule`, `set_risk_bands`, `refresh_account_risk`); a low, a review and a hold order scored by hand-made orders; settle of a test attempt holds the hold one; seller policy hides it; a stage move refused; release and cancel (cancel writes refunds summing the order); a rule edit audited; the night dry-runs ten jobs.
- [ ] Structural test asserting the above, written first; migration; syntax check; commit "Score orders and accounts for risk and hold the risky ones (migration 20261113600000 not applied)". **STOP: hand to the user to apply.**

### Task C: Screens

**Files:** Create `src/lib/riskRepo.ts` (with `isMissing` fallback like `basketRepo.ts`), `src/components/operator/OperatorRisk.tsx`, `src/components/operator/OperatorRisk.dom.test.tsx`; modify `src/types/view.ts` (`'op-risk'`), `OperatorShell.tsx` (Governance group, after Audit Trail, label "Risk", icon `ShieldAlert`), `OperatorScreens.tsx`, `src/lib/jobLog.ts` (+test: `risk` → "{n} accounts scored, {r} to review, {h} high" / "No accounts to score"), `src/lib/consoleTone.ts` (`held: 'warning'`), operator `OperatorOrders.tsx` (score badge from `order_risk`), `OperatorAccounts.tsx` and `OperatorCredit.tsx` (account band), `Checkout.tsx` confirm step (reads its refs' status; held ones show `HELD_FOR_BUYER`), the shopper's orders list (status `held` reads "Being checked").
- Repo: `loadRiskBook()` → `{ held, flagged, accounts, rules, bands, changes }`; `decideHeldOrder(ref, decision, note)`; `updateRiskRule(...)`; `setRiskBands(...)`; `rescoreAccounts()`; `heldRefs(refs)` for checkout. Every read fails soft before the migration (the Risk screen says it is not set up yet).
- Risk screen tabs: Held (Release / Cancel and refund, note required, confirm dialog), Flagged (30 days), Accounts (by score, band filter, "Rescore now"), Rules (inline edit with Task A checks, bands form, audit list).
- [ ] DOM tests: held row decides through the repo and leaves the list; a rule edit refused by `ruleEditProblem`; not-set-up state. Gates; commit.

### Task D (after apply): Live tests, docs, merge

- New `src/lib/risk.integration.test.ts`: the operator reads rules and bands; a buyer reads none of `order_risk`, `account_risk`, `risk_rules`; a buyer cannot call `decide_held_order` / `update_risk_rule`; a seller does not see a held order (read the seeded state only — no payment is placed); nightly test accepts `risk` as a tenth job.
- README (Risk section, ten jobs table row), backlog (close the item), memory; final review; merge `--no-ff`; push; CI.
