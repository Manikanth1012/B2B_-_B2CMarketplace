# Spec 17 — order integrity and the risk follow-ups

Date: 2026-11-27 · Status: decided by Claude on the user's instruction ("take your best/recommended decisions",
2026-11-26, while the user slept). Closes the follow-ups of spec 13's final review (backlog, "Spec 13 — Follow-up
migration recommended").

## Decisions

| # | Gap | Decision | Reason |
|---|---|---|---|
| 1 | A buyer can delete their own held or scored order (`owner_delete_orders`; `order_risk` cascades) | A non-operator may delete only **their own order in `awaiting_payment` with no `order_risk` row** — exactly what checkout's undo does (`Checkout.tsx` deletes its unpaid orders). Anything else is refused with a plain message | The app never needs more; a paid, held or scored order is a record |
| 2 | A consumer can update their own `orders` rows (status, address, total…) | A consumer may **not update `orders` at all**; every legitimate status move already goes through security-definer functions (`settle_payment_attempt`, `decide_held_order`, fulfilment as seller/operator). Line-status moves on `order_items` stay with sellers and the operator (`orderOpsRepo.setLineStatus` is an operator path); a consumer may not update `order_items` either | The app never updates orders as a shopper; the open policy is what made spec 13's hold bypassable |
| 3 | A shopper who changed market leaves a held order stuck (`guard_order_currency` refuses release/cancel) | `guard_order_currency` lets a status-only change through when the session flag `aventa.risk_decision` is on (set by `decide_held_order`) and neither market nor currency changes | A decision about an order already paid in its own currency is not a new sale |
| 4 | One bad account fails the whole nightly rescore | `refresh_account_risk` catches a fault per account, counts it in `failed` with the account id and reason, and carries on | One bad row should not leave every score stale |
| 5 | An undecided earlier hold counts as an earlier order for "First order" | `score_order` counts as earlier orders only those not `held`, `awaiting_payment`, `cancelled` or `failed` | A held order is not yet a purchase |
| 6 | Screen polish | Checkout confirmation: when an order is held, the "digital services activate immediately" line is not shown; Accounts and Credit show the account band through `BAND_LABEL` ("Low"/"Review"/"High"); OperatorOrders hides Advance/Fail on a held order (the database already refuses them) | Words that contradict the hold, raw enum values |
| 7 | Not changed | Sellers still see refunds (and the cancel note) for a fraud-cancelled order — documented in spec 13; the cancel dialog already warns | A seller needs to know why money left its statement |

## Build

- Migration `20261127100000_orders_are_records_once_paid.sql` (copy the latest definition of every function or policy
  it replaces; idempotent; self-check with rolled-back cases: a consumer delete of an `awaiting_payment` unscored order
  allowed, of a held/scored/placed order refused; a consumer update of an order refused; a seller and the operator
  still able to move a stage; `decide_held_order` releasing a held order whose shopper's market changed; a fault on
  one account not failing `refresh_account_risk`; `score_order` ignoring an earlier held order; the night still ten
  jobs).
- Client: the three screen fixes in decision 6, with DOM tests.
- Live test (after apply, read only and refusals only): a shopper's update of their own order refused; a delete of
  their own delivered order refused.
