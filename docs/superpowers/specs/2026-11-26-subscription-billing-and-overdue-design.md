# Spec 14 — business subscriptions billed monthly, invoices go overdue

Date: 2026-11-26 · Status: design approved by the user (2026-11-26).
Closes, from spec 12's "Still open": "Business subscriptions are not billed by the run; their recurring invoices on
file stop at July 2026" and "Nothing moves an invoice from open to overdue after its due date". The third item
(settlement lines and ledger postings for the new orders) is spec 15, designed separately (user's choice).

## Decisions

| # | Question | Decision | Reason |
|---|---|---|---|
| 1 | Split | Two specs: this one (billing), spec 15 (orders → settlement lines → ledger) | User's choice |
| 2 | Backfill | **Aug–Oct 2026 recurring invoices raised by the run** in the migration, as of 1 Sep, 1 Oct, 1 Nov; Aug and Sep marked paid, Oct open; Nov billed by the night on 1 Dec | User's choice: no gap in any account's history |
| 3 | What bills | Every `enterprise_subscriptions` row `active` or `suspended` (a suspended one bills to contract end), started on or before the month's last day; cancelled ones never | As the table's own comment says |
| 4 | Amount | One line per subscription: kind `subscription`, its name, seller, partner, cost centre, quantity, unit price, `monthly` (net), vertical, `subscription_id`; tax at the market rate, or nil with the reason printed for reverse charge / exemption | As the July invoices on file (net lines, tax on top) |
| 5 | Invoice | One per account and currency per month, id `INV-<account digits>-<YYYYMM>-<currency>-S`, kind `recurring`, period `Mon YYYY`, issued on the run date (the 1st), due after the account's terms, FX recorded; never raised twice, never changed once raised | Cannot collide with spec 12's order invoice (`…-<currency>`) |
| 6 | Overdue | `mark_overdue_invoices(p_as_of)`: every business invoice `open` with `due < p_as_of` becomes `overdue`; never moved back; paid, disputed, credited untouched | |
| 7 | The old open invoices | Swept too (the July invoices and anything else open and past due) — confirmed by the user | They are overdue today |
| 8 | The night | The existing `invoices` job runs orders, then subscriptions, then overdue (`run_invoicing(p_as_of)`); still ten jobs | One job for one ledger of receivables |

## 1. Functions

- `bill_account_subscriptions(p_as_of date)` — operator or scheduler; refuses a future date; returns
  `{ran_on, period, invoices, subscriptions, skipped}`. Billing starts with August 2026 (earlier months are on file).
- `mark_overdue_invoices(p_as_of date)` — operator or scheduler; returns `{ran_on, overdue}`.
- `run_invoicing(p_as_of date)` — calls `bill_account_orders`, `bill_account_subscriptions`,
  `mark_overdue_invoices`; returns `{orders: …, subscriptions: …, overdue: …}`. `run_nightly` (latest copy, from
  20261113600000) calls it for `invoices`. All revoked from the API.
- Scheduled jobs help article: the invoices sentence updated.

## 2. Screens

`src/lib/jobLog.ts` summarises the new `invoices` result: "{n} order invoices, {m} subscription invoices, {k} now
overdue" / "Nothing to invoice"; the old shape still reads. No other screen changes: the account and operator invoice
screens already show recurring invoices and the `overdue` status.

## 3. Effects to expect

Credit exposure counts open and overdue the same, so it does not move. The Dunning screen and the account's own
invoice list will show the swept invoices as overdue.

## 4. Testing

Structural test; self-check with rolled-back cases (one subscription invoice with its lines, reverse charge nil with
note, nothing raised twice, a future date refused, an overdue move and no move back, the night's dry run with ten
jobs). Live (after apply, read only): SmartBuild's Aug–Oct `-S` invoices with one line per billable subscription, Aug
and Sep paid; no business invoice `open` past its due date; a buyer cannot call any of the three functions. Re-run
`credit.integration` and `nightly.integration` after apply.
