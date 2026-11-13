# Spec 12 — business invoices and recent trade

Date: 2026-11-13 · Status: built while the user was away; the two choices below were the user's, the rest
were taken on their instruction ("take best decisions").
Closes, from `docs/superpowers/backlog.md`: "Refund grouping needs `requisition_id` on the invoice line" and
the "Not refreshed (needs a trade backfill)" note, for orders and business invoices.

## Decisions

| # | Question | Decision | Reason |
|---|---|---|---|
| 1 | What the billing run invoices | **Orders, monthly** (user's choice): one invoice per business account and currency for last month, from delivered orders | `orders.invoice_id` was waiting for it; subscriptions keep their own (seeded) recurring invoices |
| 2 | How much test data | **Orders + invoices** (user's choice) for Aug, Sep, Oct and Nov 2026, shopper and business | Recent months on every order and invoice screen, with bundles to refund |
| 3 | Which orders are billable | Business, delivered (last rung of the ladder), not failed/cancelled/refunded, not invoiced, placed from 1 Aug 2026 | Invoices on file cover the trade up to July; billing them again would double them |
| 4 | Which month an invoice is for | The month before the run; an order delivered late goes on the next month's invoice; an invoice is never changed once raised | Simple, idempotent, and the same every night |
| 5 | Invoice id | `INV-<account digits>-<YYYYMM>-<currency>` | One per account, month and currency; a requisition can be in a secondary currency |
| 6 | Lines and tax | One line per order line, net of the tax the order carried, with requisition, cost centre and vertical; tax at the market rate, or nil with the reason printed for reverse charge / exemption | The `guard_bill_currency` rules; the refund form groups by requisition |
| 7 | Dates | Issued on the run date, due after the account's terms (`Net 30` → 30 days); FX from the USD rate on or before issue | As the invoices on file |
| 8 | When it runs | Nightly job `invoices`, after `baskets`, before `settlements` (nine jobs); the app cannot call it | Raises on the 1st; on other nights only for an account with nothing delivered by then |
| 9 | Seed marking | `REQ-D26mm-nn`, `ORD-D26mm-nn`, `ORD-D26mm-Snn`, `BS-D26mm-nn`; removal SQL in the migration header | The app mints `REQ-####` and `ORD-########`, so nothing collides |
| 10 | SmartBuild's credit | Seeded requisitions are recorded as released by finance | The account is over its limit (the credit tests rely on that), so the trigger would hold each one |
| 11 | Settlement, ledger, stock | Not touched | Seller statements come from their own records; the settled months stay as they are |

## The seed

19 business requisitions over SmartBuild, Brightline, Greencity, Harbourpoint (KES) and Meridian (AED, reverse
charge), one a month each where the account trades; two are the Smart office starter kit as configured bundles
(SmartBuild Sep, Greencity Oct). Aug–Oct orders delivered and invoiced (Aug, Sep paid; Oct open); November's are
delivered, in transit or placed and wait for 1 Dec. 9 shopper orders for Priya Raman, Wanjiru Kamau and Otieno
Odhiambo. Prices are read from today's price book; bundle parts at the template's discount, never below floor.

## Testing

- Structural: `src/lib/invoicing.migration.test.ts`.
- Self-checks: a rolled-back invoice (net line, tax, due date, stamped order, second run bills nothing), a future
  date refused, a nine-job dry run; the seed checks counts, months, sums, reverse charge and the bundle lines.
- Live (after apply): `src/lib/invoicing.integration.test.ts`, read only.
