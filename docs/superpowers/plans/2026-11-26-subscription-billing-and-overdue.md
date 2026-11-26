# Spec 14 — subscription billing and overdue invoices — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** bill every business subscription monthly (backfilling Aug–Oct 2026), and move past-due open business
invoices to overdue, both inside the nightly `invoices` job.

**Architecture:** three SQL functions (`bill_account_subscriptions`, `mark_overdue_invoices`, `run_invoicing`) in one
migration that also backfills; `run_nightly` calls `run_invoicing` for `invoices`. The client only changes the job
summary.

**Tech Stack:** Supabase Postgres (PL/pgSQL), Vitest, TypeScript.

Spec: `docs/superpowers/specs/2026-11-26-subscription-billing-and-overdue-design.md` (decisions 1–8 bind). Branch `subscription-billing`.

## Global Constraints

- Invoice id `INV-<account digits>-<YYYYMM>-<currency>-S` (account digits = account id without `ENT-`), kind `recurring`, period `Mon YYYY` of the month before `p_as_of`, issued on `p_as_of`, due `p_as_of` + the digits of `enterprise_accounts.terms` (default 30), status `open`, FX from `fx_rates` (base 'USD', latest `as_of <= p_as_of`; 1 for USD).
- Billable: `enterprise_subscriptions.status in ('active','suspended')` and `started <=` the last day of the billed month; billing starts with August 2026 (`p_as_of` before 2026-09-01 bills nothing). One invoice per account and subscription `currency`; skip (with a reason) if it already exists.
- Lines: kind `subscription`, `description` = subscription name, `seller`, `partner_id`, `cost_centre`, `subscription_id`, `quantity`, `unit_price`, `amount` = `monthly`, `vertical`, `sort_order`; id `<invoice id>-L<n>`. Invoice `recurring` = sum of lines, `oneoff` 0; tax = round(recurring × rate / 100, 2); `total` = recurring + tax. Reverse charge (`enterprise_accounts.reverse_charge`) or exemption (`tax_exempt`) → rate 0 and a note matching `(reverse charge|exempt)` (`guard_bill_currency` requires it); otherwise rate = `markets.tax_rate`.
- Overdue: `update enterprise_invoices set status = 'overdue' where status = 'open' and due < p_as_of`; never the reverse.
- `run_invoicing(p_as_of)` returns `{ran_on, orders: <bill_account_orders result>, subscriptions: <bill_account_subscriptions result>, overdue: <mark_overdue_invoices result>}`. `run_nightly` copied from `20261113600000` (its latest; grep all migrations), changed only to call `run_invoicing` for `invoices` — ten jobs.
- All three new functions: operator or `is_scheduler()` only, refuse `p_as_of > current_date`, revoked from `public, anon, authenticated`.
- Backfill in the same migration: `bill_account_subscriptions` as of 2026-09-01, 2026-10-01, 2026-11-01; then the `-S` invoices for Aug and Sep set `paid` with `paid_on = least(due, issued + 12)`; then `mark_overdue_invoices(current_date)`.
- Migration `supabase/migrations/20261126100000_subscriptions_billed_monthly_and_invoices_go_overdue.sql`: one transaction, idempotent, `create or replace`, no bare CASE in IF, block labels where a variable could clash with a column, self-check last with rolled-back cases (`errcode 'ZZ999'`), syntax-checked with libpg-query (`node "C:/Users/MANIKA~1.NAL/AppData/Local/Temp/claude/697e69d6a9b9d76a/992f0b1e-2519-43e6-b27a-d3c1939b5343/scratchpad/pgparse-run/check.cjs" "C:/Users/MANIKA~1.NAL/AppData/Local/Temp/claude/697e69d6a9b9d76a/992f0b1e-2519-43e6-b27a-d3c1939b5343/scratchpad/pgparse-pkg/node_modules/libpg-query" <abs path>` → problems: 0).
- Gates: `npx vitest run` (only `gateway.test.ts` financingProblem and `partnerApplication.test.ts` '02 Aug 2026' may fail locally), `npx tsc --noEmit`, `npm run build`. Commits end `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: The migration and the job summary

**Files:** create the migration and `src/lib/subscriptionBilling.migration.test.ts`; modify `src/lib/jobLog.ts`, `src/lib/jobLog.test.ts`.

- [ ] Structural test first (pattern: `src/lib/invoicing.migration.test.ts`): one transaction; the three functions with the constraints above (id format, billable predicate, lines, tax/nil + note, never twice, future date refused, overdue update and nothing moving back); revokes; `run_nightly` differs from the `20261113600000` copy only in calling `run_invoicing(p_as_of)` for `invoices`; backfill calls in order, then paid, then the sweep; the Scheduled jobs help sentence updated (`op-jobs` article mentions subscriptions and overdue).
- [ ] Migration. Self-check (rolled back): a subscription invoice for a fixture account with its lines and totals; a reverse-charge account billed at nil with the note; a second run raises nothing; `p_as_of` tomorrow refused; an open invoice past due becomes overdue and a paid one does not; dry run of the night: ten jobs, all ok, `invoices` result has `orders`, `subscriptions`, `overdue`. Outside the rolled-back block, check the backfill: every `-S` invoice adds up (`recurring` = sum of lines, `total` = recurring + tax), Aug/Sep paid, Oct open or overdue, no business invoice left `open` past due.
- [ ] `jobLog.ts` `invoices`: new shape → "{n} order invoices, {m} subscription invoices, {k} now overdue" (zero parts left out; all zero → "Nothing to invoice"); the old shape (`invoices`, `orders`) still summarised as before. Tests for both.
- [ ] Syntax check; gates; commit "Bill business subscriptions monthly and mark invoices overdue (migration 20261126100000 not applied)". **STOP: the user applies.**

### Task 2 (after apply): Live test, docs, merge

- [ ] `src/lib/subscriptionBilling.integration.test.ts` (read only; pattern `invoicing.integration.test.ts`): SmartBuild (vikram.shah@smartbuild.in / enterprise123) reads `INV-2007-202608-INR-S`, `…09…`, `…10…` (Aug, Sep paid), each with one line per subscription the account had billable, lines carrying `subscription_id`; no business invoice it can read is `open` with `due < today`; the buyer cannot call `bill_account_subscriptions`, `mark_overdue_invoices`, `run_invoicing`. Skips until applied.
- [ ] Run it, then `credit.integration.test.ts` (Beacon reserve item is a known failure) and, after the next night, `nightly.integration.test.ts`.
- [ ] README (nightly table `invoices` row; spec 14 section), backlog (close both items; spec 14 section), memory; merge `--no-ff`; push; CI.
