# Spec 13 — fraud and risk scoring on orders and accounts

Date: 2026-11-13 · Status: design approved by the user (2026-11-13).
Backlog: "Fraud and risk scoring on orders and accounts (M)" (competitive research, candidate 17: telecom carries
SIM-swap and device fraud exposure).

## Decisions

| # | Question | Decision | Reason |
|---|---|---|---|
| 1 | What a high score does | **Hold for review** (user's choice): flagged at Review, held at Hold; the payment is taken, the seller does not see the order until the operator releases it | A human in the loop; the pattern of the business credit hold |
| 2 | What is scored | **Shopper orders + every account** (user's choice). Business orders are never held — approvals and the credit hold already gate them — but their account's score is shown | No third gate on business buying |
| 3 | How the score is worked out | **Rules the operator tunes** (user's choice): points per rule, on/off, a threshold per rule, two bands per kind, edited on a Risk screen, every change audited | Explainable: every score lists the rules that fired |
| 4 | Bands | Orders: Review ≥ 40, Hold ≥ 70. Accounts: Review ≥ 40, High ≥ 70. Editable | Approved starting point |
| 5 | When an order is scored | When its payment succeeds, in `settle_payment_attempt` (the only step that sees the whole checkout), for every shopper order on that payment | One score per order, with the complete basket and payment history |
| 6 | When accounts are scored | Nightly job `risk` (tenth job, after `invoices`, before `settlements`); also on demand by the operator | Account signals move slowly; a nightly read is enough |
| 7 | Held order | Status `held` (between `awaiting_payment` and `placed`); hidden from seller fulfilment; the database refuses any stage move while held | Nothing ships before a decision |
| 8 | Operator decisions | **Release** → `placed`, seller sees it. **Cancel and refund** → `cancelled`, a refund raised in the existing refunds table (approved, reason "Cancelled after a fraud review"), paid from the Refunds screen as any other. Both need a note | Reuses the money path that already exists |
| 9 | What the buyer sees | A held order reads "We're checking this order — usually within a few hours"; never the score or the rules | Telling a fraudster which rule fired teaches them |
| 10 | Who sees scores | Operator only. Sellers and buyers never see a score | |
| 11 | Out of scope | Device fingerprinting, IP/geolocation, machine-learned models, blocking at checkout, external vendors (Stripe Radar, Sift) | Need data or vendors the platform does not have |

## 1. Rules

`risk_rules(id, applies 'order'|'account', label, points, enabled, threshold numeric null, unit text null,
sort_order, updated_at, updated_by)` and `risk_settings(kind 'order'|'account', review_at, hold_at)`. Seeded:

Order rules — account band review (+15) / high (+30); account younger than 7 days (+20); first order (+10);
total over 3× the buyer's median order (+25); a SIM or eSIM line (+15); a SIM/eSIM line shipped to an address not
used before (+30); guest checkout (+15); 2+ failed payment attempts in 24 h (+25); 3+ orders in an hour (+20);
carrier billing or EMI over a per-currency amount (+10).

Account rules — refunds in 90 days (+10 each, capped at +30); disputes or chargebacks in 180 days (+25 each);
failed payments in 30 days (+5 each, capped at +20); 5+ orders in a day in the last 30 days (+15); business:
over its credit limit (+20); business: an invoice overdue (+15).

Scoring functions are pure SQL, one function per kind (`score_order(order_id)`, `score_account(kind, id)`),
returning `{score, band, reasons:[{rule, label, points}]}`. Missing data counts as "rule did not fire".

## 2. Storage

`orders` gains `risk_score`, `risk_band` ('low'|'review'|'hold'), `risk_reasons jsonb`, `risk_scored_at`,
`risk_decided_by`, `risk_decided_at`, `risk_note`. `account_risk(kind 'shopper'|'business', id, score, band,
reasons, scored_at)`. `risk_rule_changes` audit (rule, field, was, now, by, at). Operator reads all; buyers and
sellers read none of these columns' meaning (`risk_*` are not shown and the policies on `account_risk`,
`risk_rules` are operator-only).

## 3. Flow

`settle_payment_attempt` (latest copy): after the bundle-whole check, each shopper order on the reference is
scored; status becomes `held` where the band is `hold`, `placed` otherwise. Release and cancel are
`decide_held_order(p_order, p_decision, p_note)`, operator only. Guards: seller fulfilment and operator stage
edits refuse an order while `held`; checkout's success screen reads the status and says "We're checking this
order" for a held one.

## 4. Screens

Operator **Risk** (`op-risk`, Governance group): Held (queue with Release / Cancel and refund), Flagged
(review band, last 30 days), Accounts (by score), Rules (edit points, on/off, threshold, bands; audit list).
Order screens show a score badge for the operator. Accounts and Credit show the account band. Help article
for `op-risk`. `jobLog` summarises `risk`. Buyer: held order wording in checkout and My Orders.

## 5. Testing

Pure: band from score, reasons formatting, rule editor validation. Migration self-check (rolled back): a
low, a review and a held order; release; cancel raises one refund; a fulfilment move on a held order refused;
the night with ten jobs. Live (after apply): rules readable by the operator only; a buyer cannot read
`account_risk`; a shopper order placed through checkout is scored (cleaned up); operator decisions refused to a
buyer.
