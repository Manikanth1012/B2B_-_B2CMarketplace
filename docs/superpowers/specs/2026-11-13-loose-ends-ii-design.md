# Spec 11 — loose ends II: the night on screen, a basket that survives, bundle edges

Date: 2026-11-13 · Status: decisions taken with the user (2026-11-13).
Follows spec 10 and the nightly schedule (`20261112600000`, `20261112700000`).
Closes, from `docs/superpowers/backlog.md`: "No operator screen shows `scheduled_job_log`",
"The requisition basket is not saved across a reload", and the "Still open after spec 7" bundle list.

## Decisions

| # | Question | Decision | Reason |
|---|---|---|---|
| 1 | Where the requisition basket is kept | **In the database** (revised by the user 2026-11-13, replacing "this browser"): one basket per buyer, any device | The operator has to see pending and abandoned baskets, which browser storage cannot give |
| 2 | What a restored basket shows | Re-priced against today's shelf when loaded; lines that moved or fell off are listed in the drawer before anything is raised | The reason the basket was never persisted was stale prices in front of an approver. Spec 10's re-check on Raise already guards the write; this makes the screen honest too |
| 2a | Which baskets the operator sees | Both: business requisition baskets and shopper baskets (`cart_items`), one screen, a tab each | User's choice |
| 2b | Stock runs out, or a listing is paused or withdrawn | **Flag and cap**: the line stays, marked "Only 3 left" or "No longer available"; its quantity is cut to what is left; the buyer is told what changed; checkout / Raise is blocked until they accept or remove it. Nothing disappears silently. A bundle with a flagged part is blocked as a whole | User's choice |
| 2c | Abandoned | Untouched for 7 days. The operator sees owner, lines, value, last change and stock flags, and may send the owner an in-app reminder (at most one a day per basket). The operator never deletes a basket; the night clears baskets untouched for 90 days | User's choice |
| 3 | What a monthly bundle part renews at | The bundle price for 12 months from purchase, then the published price on the renewal date (never below the seller's floor) | User's choice. Told to the buyer when they buy |
| 4 | A bundle bought in part | Refused when the payment settles: a payment succeeds only if every bundle on it is whole across that payment's orders (and was not already bought). Otherwise the attempt fails and its orders go, nothing charged | Closes the accepted risk and the half-ordered checkout together. The settle step is the one place that sees all of a checkout's orders |
| 5 | Abandoned checkouts | `expire_stale_payments` joins the night (job `payments`), and a part held by an unpaid order of another payment no longer counts as "already ordered" | Today it runs only when somebody next opens checkout |
| 6 | Unused selections | The night deletes a selection whose price hold ended more than 7 days ago and that is on no basket, requisition or order (job `bundle selections`) | Nothing else ever removes them |
| 7 | One selection, two requisitions | Refused when the second is raised: a selection may be on one requisition that is not rejected or cancelled | Today the second approval is the one nobody can act on |
| 8 | A bundle in a secondary currency | `configure_bundle` takes any currency the business account's market takes, priced from that currency's price book | The requisition can be in a secondary currency; the bundle should follow it |
| 9 | Stale shelf after switching accounts | The bundle shelf cache is keyed by signed-in user and currency, and cleared on sign-out | Same 60 s freshness for one person; nobody sees another's |
| 10 | "A paused part blocks the bundle" | A live test using a throwaway template whose option is a product already paused (`SKU-5004`), deleted afterwards | Covers the rule without pausing a live product |
| 11 | Refund picker and operator order views | Bundle lines grouped under the bundle's name, as in the basket; refunds stay per part at its price | Display only; settlement is already per part |
| 12 | Out of scope | Seller-authored templates and free-form build-your-own (a feature); a monthly business template (demo content — and, when added, its renewals follow decision 3) | Not loose ends |

## 1. The night on screen

New operator screen **Scheduled jobs** (`op-jobs`), in the Platform group after Channels.

- **Health line** at the top: "Last night ran at 00:30 UTC on 13 Nov — 7 jobs, all succeeded", or "2 of 7 failed", or
  "The night has not run since 11 Nov" (danger tone) when no row is newer than 26 hours.
- **Nights**: the last 14 nights, newest first, one card per night; each job one row: name, OK/Failed badge,
  how long it took, a one-line summary from `result` (e.g. "6 renewed, 2 ended", "3 partners settled"), and the
  error in full when it failed. A summariser per job turns `result` into words; unknown shapes show "Done".
- Read-only. The screen says how to run the night by hand (`select public.run_nightly();` in the SQL editor),
  because the app cannot call it.
- Pure logic in `src/lib/jobLog.ts` (tested first): group rows into nights, health, summaries.

## 2. Baskets kept, watched and kept honest (second migration)

`supabase/migrations/20261113200000_a_basket_is_kept_and_watched.sql`, applied after `20261113100000`.

**Business basket in the database.**
- `requisition_baskets(id, account_id, user_id unique, currency, updated_at, reminded_at)` and
  `requisition_basket_lines(basket_id, product_id, quantity, unit_price, model, unit, bundle_selection_id,
  quote_line_id, reason, stock_note, was_quantity, flagged_at, sort_order)` — the client `BasketLine` fields, plus
  the stock flag. RLS: the owner reads and writes their own (through functions); the operator reads all.
- `save_requisition_basket(p_currency text, p_lines jsonb)`: the signed-in business buyer's basket replaced in one
  transaction (empty lines → basket deleted). Checks membership of an account, enterprise listings, quantities > 0.
  Keeps a line's stock flag if its product and quantity are unchanged; a changed quantity on a flagged line is the
  buyer accepting it (flag cleared, if the new quantity fits the stock). Stamps `updated_at`.
- `RequisitionProvider` loads the basket on sign-in, saves after every change (debounced ~400 ms, and immediately
  before Raise), and re-reads it when the window regains focus and before Raise, so a stock flag written by the
  database appears without a reload. After load it re-prices as decision 2 says. Raising a requisition deletes the
  basket. The file's header comment is rewritten to say why it is kept now.
- An accepted quote already in the basket no longer offers "Add to requisition" again.

**Shopper basket.** `cart_items` already lives in the database; it gains `stock_note`, `was_quantity`,
`flagged_at` and `updated_at` (stamped by trigger). Confirm its current RLS (later migrations tightened the
original open policies) and add operator read.

**Flag and cap.** A trigger on `products` after update of stock / status (check the real column names) calls
`flag_basket_stock(product_id)`, which, for every cart and business basket line of that product:
- stock is enough and the listing live → nothing (and an existing stock flag on it is cleared only by the buyer);
- stock below the line's quantity but above 0 → `was_quantity` = old quantity, quantity = stock,
  `stock_note` "Only N left — we reduced this from M";
- stock 0, or the listing not live → `stock_note` "No longer available"; quantity left as it was (it can never be
  bought), `was_quantity` null;
- stamps `flagged_at`; marks the basket changed (`updated_at` unchanged — the buyer did not touch it).
Checkout and Raise are refused in the database while any line in them is flagged (cart: in the order-line guard;
requisition: in `save`/raise path), and the screens block them first: each flagged line shows its note with
**Accept** (clears the flag, keeps the capped quantity) and **Remove**; "No longer available" offers only Remove.
A bundle with a flagged part shows the bundle blocked until the part is fixed or the bundle is removed.

**Operator screen "Baskets"** (`op-baskets`, Sales or Service group — wherever orders sit), two tabs:
Business (requisition baskets) and Shoppers (carts). Rows: owner (name, email; account for business), lines,
value in its currency, last change, state **Pending** (changed in the last 7 days) or **Abandoned** (7+ days),
stock flags count, last reminder. Filter by state. Row opens the lines. **Send reminder**
(`remind_basket_owner(p_kind text, p_id text)`, operator only): an in-app `notification_log` entry to the owner
("You left N items in your basket"), `reminded_at` stamped, refused if one was sent in the last 24 h.
A help article for `op-baskets` is seeded (helpCoverage requires one per operator view).

**The night.** `run_nightly` gains `baskets` (after `bundle selections`, before `settlements`): re-runs the stock
flag over every basket line (a safety net for writes that bypassed the trigger) and deletes baskets and carts
untouched for 90 days. Eight jobs in all. `src/lib/jobLog.ts` summarises it.

## 3. Bundle edges (one migration)

`supabase/migrations/20261113100000_a_bundle_is_bought_whole.sql`, one transaction, self-check last.

- **`settle_payment_attempt`** (latest copy, only this added): on `succeeded`, for each bundle selection on
  the attempt's orders, every line must be on an order with this payment reference, and none ordered on any
  other paid order. If not, the attempt is recorded `failed` with the reason, its orders deleted, and the
  function returns that reason.
- **`guard_bundle_order_line`**: "already ordered" ignores items on `awaiting_payment` orders of another
  payment reference. The basket-completeness check and its "accepted residual risk" comment are replaced by
  the settle check.
- **Subscriptions**: `subscriptions` gains `bundle_selection_id` and `bundle_price_until` (purchase + 12 months).
  `renew_subscriptions` charges the subscription's price until then, and afterwards the published price in
  the subscription's currency (floored), updating `subscriptions.price` once when it switches. Checkout writes
  both columns for a bundle part. Checkout and the configurator say "Bundle price for 12 months, then
  {list price}/month".
- **Requisitions**: a trigger refuses a requisition line whose selection is already on another requisition
  that is not rejected or cancelled.
- **`configure_bundle`**: a business caller may pass a currency its market takes; default stays the account's.
- **The night**: `run_nightly` gains `payments` (`expire_stale_payments`) and `bundle selections`
  (`delete_unused_bundle_selections(p_as_of)`), so seven jobs. The nightly tests move from 5 to 7.

## 4. Screens beyond the job log

- Enterprise refund picker and the operator's order views (`OperatorOrders`) group bundle lines under the
  bundle name (`useBundleNames`, the `BundleGroup` heading). Per-part refund amounts unchanged.
- `useBundleShelf` cache keyed `${userId}:${currency}`, cleared on auth change.

## 5. Testing

- Unit (test-first): `jobLog.ts`; basket save/restore (age, user key, broken JSON ignored); renewal price
  choice as a pure mirror; refund grouping.
- Component: Scheduled jobs screen (health states, failed job shows its error).
- Migration structural test: settle check present, guard change, renewal switch, requisition trigger,
  seven jobs, functions revoked from the API.
- Integration (after apply): a selection refused on a second requisition; a paused part blocks the bundle
  (throwaway template, cleaned up); the night's log has seven jobs. No orders or payments are placed.
- The renewal switch is checked by the migration's own self-check, in a rolled-back block: a bundle
  subscription renewed before and after its 12-month date charges the bundle price, then the published one.
  (A signed-in test cannot run renewals; only the scheduler and the operator can.)
- Browser: Scheduled jobs at 1280 / 390; reload with a requisition basket open.

## 6. Order of work

1. Pure logic and the job log screen (no database change).
2. Basket persistence and the cache key.
3. The migration and its structural test → the user applies it.
4. Screens that need it (renewal wording, refund grouping) and integration tests.
5. README, backlog, memory; merge.
