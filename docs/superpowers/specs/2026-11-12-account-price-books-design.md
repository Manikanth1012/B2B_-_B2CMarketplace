# Spec 9 — account price books and guided buying

Date: 2026-11-12 · Status: decisions taken on the user's instruction to use the
recommended options (the user was away); each decision below carries its reason
so it can be reversed on review.
Follows spec 8 (polish). Builds on spec 6 (quotes), spec 7 (bundle floors) and
two branches that must be applied first: `requisition-lines-order`
(`20261111200000`) and `requisition-price-check` (`20261111300000`).
Research: `docs/superpowers/research/2026-11-05-competitive-features.md` row 6
and top-5 #1.

## Why

A business buyer pays the published price for its market on every ordinary
line. Spec 6 lets a business negotiate one quote at a time; the next quote
starts from zero. Every enterprise evaluator asks for the standing version —
"our prices", the sellers we prefer, and a warning when somebody buys outside
them (Amazon Business guided buying, Coupa contract steering, Mirakl customer
pricing).

It also finishes the work `20261111300000` started. That migration holds an
ordinary requisition line to the price book's price. This one makes "the price
book's price" mean the account's own price where it has one.

## What the code says today (read before deciding)

- **CR-008 says this is not done here.** `channel_rule` CR-008 ("Negotiated and
  contract pricing", decision `not operated here`, `20260809100000`) records that
  every account buys at the published price, and gives the reason: rate cards
  "belong with … a pricing engine that can version them by account and by date;
  a marketplace that shows one price and invoices another is the worst of both."
  The same boundary is repeated in `src/lib/contracts.ts`, the Your Agreement
  callout (`EnterpriseAgreement.tsx`), the operator amendment dialog
  (`OperatorContracts.tsx`), the `en-agreement` and `op-contracts` help articles,
  the comment block of `20261111300000`, and `contracts.integration.test.ts`
  (expects `not operated here`). This spec reverses CR-008 on purpose and meets
  the rule's own condition: prices versioned by account and by date, and the
  same price shown, raised, approved and ordered.
- **Money is per currency, never converted.** `product_prices(product_id,
  currency, price, was_price, floor_price, list_price)` (`20260802110000`); a
  market takes one or more currencies (`market_currencies`, `20260802170000`).
  The shelf (`loadEnterpriseCatalogue`) shows `product_prices.price`, else the
  product's base row when it is in that currency. `floor_price` is the seller's
  agreed floor and is readable by everyone.
- **Who funds a discount.** Quotes (spec 6) and bundles (spec 7) both put the
  discounted unit price on the requisition line, and `place_requisition_order`
  writes `order_items.price` from it — the seller is settled on that price, so
  the seller bears the discount. Spec 7 never prices a part below its floor; spec
  6 lets a *seller* quote under its own floor (warning only), because the floor
  is the seller's number. The operator desk may quote anything.
- **Who sets policy.** `enterprise_roles.can_set_policy` (`20260801400000`) is
  the capability the screens check (`may(me, roles, 'can_set_policy')`). The RLS
  on `enterprise_approval_policy` still checks the literal role id
  `'procurement-lead'`, which only matches SmartBuild — other accounts' role ids
  are suffixed (`procurement-lead-ENT-2011`).
- **`need` is decided by the client.** `raiseRequisition` computes `need`
  (`needFor`) and stores it; no trigger re-derives it. `guard_requisition` uses
  the stored `need` for separation of duties and approver rights.
- **Lines.** `enterprise_requisition_lines` guards, in name order:
  `_bundle_*`, `_guard` (pending, can_raise), `_price_guard` (`20261111300000`),
  `_quoted_guard`. `place_requisition_order` (after `20261111200000`) orders an
  ordinary multi-line requisition line by line at each line's `unit_price`.
- **No Postgres extensions** are created anywhere in the migrations, so
  `btree_gist` (needed for an exclusion constraint on a text key plus a date
  range) is not assumed.

## Decisions

| # | Question | Decision | Reason |
|---|---|---|---|
| 1 | CR-008 | Reverse it in the migration: decision `sold here`, `sold_through` "Account price books, agreed by the marketplace", a new reason. Update the agreement callout, the amendment dialog sentence, both agreement help articles, and `contracts.integration.test.ts` | The rule's reason names the conditions (versioned by account and date; one price shown and invoiced) and this design meets both. Leaving CR-008 saying "not operated here" beside a working price book is the "sentence promising an arrangement that does not exist" defect the codebase keeps removing, in reverse |
| 2 | Where a price lives | `account_prices`: one row per account, listing, currency and date window, with `source` `negotiated` or `quote` | Same key as `product_prices` (per currency, chosen not converted) plus the account and the dates CR-008 asks for |
| 3 | Tie to the agreement? | No foreign key to `enterprise_contract` | An agreement is a signed document amended rarely; a price book changes at every commercial review. `z_guard_requisition_contract` already stops an account with no agreement in force from buying at all, so a price outliving its agreement cannot be used |
| 4 | Who writes prices | The operator only (RLS + trigger), through `set_account_price`, `end_account_price` and `promote_quote_line` | The recommended split. A seller-proposed price is out of scope; the seller is protected by the floor (decision 6) |
| 5 | Who reads | The account reads its own; a seller reads rows on its own listings (with the company name, through `seller_account_prices()`); the operator reads all | The seller funds the discount (decision 6), so it has to be able to see what its listings are sold at, to whom and until when — sellers already see buyer names on orders |
| 6 | Who bears the discount | The seller, exactly as for quotes and bundles: the line, the order item and settlement all carry the account price | One settlement path, already used by specs 6 and 7. A marketplace-funded discount would need a second ledger leg nobody has designed |
| 7 | Floors and the published price | An account price must be ≥ the seller's floor and ≤ the published price, checked when it is set. When a line is written, the price charged is `least(published, greatest(account price, floor))` — today's published price and floor | "Never take a seller below any floor the system has": a floor raised after the price was agreed still holds. "A marketplace that shows one price and invoices another" is avoided because the screen computes the same figure from the same rows. A buyer is never charged more than the published price, even if it falls below the agreed one |
| 8 | Promoting a quote | Only an accepted spec-6 quote line, at its quoted price, for the quote's account, listing and currency. The floor still applies | A seller may quote one deal under its floor; that is not consent to a standing price under it. Refused with a sentence that names the floor |
| 9 | One price at a time | No two non-withdrawn windows for one account + listing + currency may overlap (scheduled ones included). Enforced by the row trigger under a transaction advisory lock on the key | Stronger than "one active today" and what "the price on a date" needs. An exclusion constraint needs `btree_gist`, which nothing here installs |
| 10 | Editing | Prices are never edited. `set_account_price` ends whatever would overlap (the day before the new one starts; a not-yet-started one is withdrawn) and inserts the new row, in one transaction. No back-dating: a new price starts today or later | Every requisition raised at the old price stays explicable. Back-dating is meaningless: lines already raised were checked against the price in force then |
| 11 | Ending | `ends_on` (inclusive) is set to yesterday, or to `starts_on − 1` for a price that has not started (a zero-length window = *withdrawn*). Standing (`scheduled`, `in force`, `ended`, `withdrawn`) is computed from the dates, never stored | The house rule from agreements: "in force is a date, not a flag" |
| 12 | Deleting | The operator may delete a row (RLS); no screen offers it | Integration tests must clean up after themselves; the screen only ends prices so history stays |
| 13 | Guided-buying rules: where | New table `enterprise_buying_rules(account_id, off_contract, note, updated_by, updated_on)`, written by a member whose role has `can_set_policy` (helper `account_may_set_policy()`) | `enterprise_approval_policy`'s RLS checks the literal `'procurement-lead'`, which is wrong for every account but SmartBuild; a new table with the right check avoids widening that policy in this spec |
| 14 | Preferred sellers and products | `account_preferences(kind 'seller' \| 'product')`, same writers as #13; shown first and badged on every enterprise shelf, with a "Preferred" filter chip | Steering, not restriction: Amazon Business and Coupa both steer before they block. Blocking non-preferred sellers is out of scope |
| 15 | What "off contract" means | An ordinary line (no quote, no bundle) whose listing has no account price in force for the account, in the requisition's currency, on the day it is written | A quoted line is negotiated by definition; a bundle is priced by its published rule. Flagging either would be noise |
| 16 | Off-contract rule | `allow` · `reason` (each off-contract line carries a buyer's reason of 5–300 characters, shown to the approver) · `approval` (a requisition holding an off-contract line needs approval whatever its value) | The recommended three. All enforced by triggers and mirrored by pure functions |
| 17 | What `approval` does to `need` | Lifts `none` → `finance` and `it` → `both`; the policy note says why | The account's finance approvers are its spend approvers. A new approver kind would touch `need`'s check, `needFor`, `guard_requisition` and every approvals screen |
| 18 | Stored or recomputed | The line stores `off_contract`, the rule in force when written (`off_contract_rule`) and the `account_price_id` it was priced from; the trigger sets them and refuses any change by the buyer | The same reason `need` is stored: what mattered is what the rules said on the day, and an approver must see what the buyer saw |
| 19 | Header `need` downgrade | A trigger on `enterprise_requisitions` refuses setting `need` to `none` or `it` while the requisition holds a line stored under the `approval` rule | Lines are written after the header, and the buyer can update a pending header; without this, the approval rule could be undone after the fact |
| 20 | When the marker shows | The off-contract marker shows when the account has at least one price in force, or its rule is not `allow` | An account with no price book would see every line flagged. The flag is still stored (truthful data), only hidden |
| 21 | Seed | SmartBuild (`ENT-2007`) gets one price on one live business listing in INR that no integration test uses (preferring `SKU-4006`, chosen in SQL from what is live), about 8% under the published price and never under the floor; the listing and its seller are SmartBuild's preferred product and seller; the rule is `allow` | `allow` keeps every existing integration test that raises ordinary lines without a reason green. The integration test of this spec switches the rule and restores it |
| 22 | Screens | Operator: new **Price books** (`op-pricebooks`) in the Service group after Agreements. Enterprise: new **Price book** (`en-pricebook`) after Your Agreement, with a Buying rules section. Seller: a read-only "Account prices" block on the listing's pricing panel (no new view) | Each new view needs a help article (`helpCoverage.integration.test.ts`); the migration inserts both. Rules sit with the price book because they act on it |
| 23 | Bundles and quotes | Unchanged. Bundles price from the published price (spec 7); quoted lines keep their quote | Their own guards hold them; mixing account prices into `price_bundle` is a separate decision |
| 24 | Migration shape | One file, `20261112100000_an_account_buys_at_its_own_price.sql`, in one transaction, checking first that `20261111200000` and `20261111300000` are applied, and again in the final self-check | The price guard it replaces only exists after `20261111300000`; a half-applied file would leave the line guard pointing at tables that do not exist |

## 1. Data model (one migration)

### `account_prices`

| Column | Notes |
|---|---|
| `id` text pk | `AP-` + number from `account_price_seq` (seed rows `AP-SEED-…`) |
| `account_id` | → `enterprise_accounts`, cascade |
| `product_id` | → `products`, cascade; must be sold to `enterprise` |
| `currency` | → `currencies`; one the account's market takes (`market_currencies`) |
| `unit_price` numeric(10,2) | > 0; ≤ published price; ≥ floor (checked on insert) |
| `starts_on` date | ≥ today on insert (except migration/service role) |
| `ends_on` date null | inclusive; `ends_on ≥ starts_on − 1` (`= starts_on − 1` is withdrawn) |
| `source` | `negotiated` · `quote` |
| `quote_line_id` | → `enquiry_lines`, on delete set null |
| `quote_ref` | the enquiry id, kept when the quote line is deleted; required for `quote` |
| `note` | ≤ 300 |
| `set_by`, `set_at` | stamped by the trigger from the operator's name |
| `ended_by`, `ended_at`, `end_reason` | stamped when the end moves earlier; reason required |

Constraint names avoid Postgres's auto-names (`account_prices_window`, not
`account_prices_ends_on_check`).

**Immutability.** On update only `ends_on` (and its stamps) may change, and
`quote_line_id` may become null (the foreign key's own action). An ended price
(`ends_on < today`) cannot be changed; a new end cannot be before yesterday.

### `enterprise_buying_rules`

`account_id` pk → `enterprise_accounts`; `off_contract` `allow` · `reason` ·
`approval` (default `allow`); `note` ≤ 300; `updated_by`, `updated_on` stamped.
A missing row reads as `allow`. Seeded for every account.

### `account_preferences`

`id`; `account_id`; `kind` `seller` | `product`; exactly one of `partner_id` /
`product_id` to match; `note` ≤ 200; `added_by`, `added_on`. Unique per account
and target. Never updated (remove and add again). A product must be sold to
`enterprise`.

### Requisition lines

`enterprise_requisition_lines` gains `account_price_id` (→ `account_prices`,
set null), `off_contract boolean not null default false`, `off_contract_rule`
(`allow` · `reason` · `approval`, null unless off contract) and
`off_contract_reason` (≤ 300). A check keeps `off_contract` and
`off_contract_rule` consistent. Existing lines are `false`/null.

### Functions

| Function | Who | What |
|---|---|---|
| `set_account_price(p_account, p_product, p_currency, p_unit_price, p_starts_on, p_ends_on, p_note, p_quote_line)` | operator | Ends or withdraws whatever would overlap, inserts the new row; returns its id |
| `end_account_price(p_id, p_reason)` | operator | `ends_on = greatest(yesterday, starts_on − 1)` with the reason |
| `promote_quote_line(p_quote_line, p_starts_on, p_ends_on, p_note)` | operator | `set_account_price` from an accepted quote line |
| `seller_account_prices()` | seller | Rows on the seller's listings with company and product names |
| `account_may_set_policy()` | policies | Whether the caller's role has `can_set_policy` on their own active membership |

All `security definer`, `set search_path = public`, persona checked inside.

## 2. RLS

| Table | Operator | Enterprise | Seller |
|---|---|---|---|
| `account_prices` | all | read own account | read rows on own listings |
| `enterprise_buying_rules` | all | read own; insert/update own if `account_may_set_policy()` | — |
| `account_preferences` | all | read own; insert/delete own if `account_may_set_policy()` | — |

Triggers repeat the write rules (defence in depth) and stamp who and when.

## 3. Guards on requisitions

### `guard_requisition_line_price()` — replaced

Same trigger (`enterprise_requisition_lines_price_guard`, before insert or
update of `unit_price, product_id, requisition_id`), same reach (business buyer
only; quoted and bundle lines skipped; unchanged updates skipped; a line naming
no listing refused; no price in the currency refused). The price it holds the
line to is now:

```
published = round(product_prices.price, 2)   -- else the base row in this currency
floor     = round(product_prices.floor_price, 2), or 0
account   = the account's price in force today for (listing, currency), if any
charged   = account is null ? published : least(published, greatest(account, floor))
```

It also sets `account_price_id`, `off_contract` and `off_contract_rule` (the
account's rule, `allow` when it has none).

### `guard_requisition_line_contract()` — new

Trigger `enterprise_requisition_lines_z_contract_guard` (before insert or
update, so it runs after every other line guard). Business buyer only.

- On an update that changes none of price, listing, requisition, quote or
  bundle, the three stored fields keep their old values (the buyer cannot clear
  a flag).
- Quoted and bundle lines: never off contract; reason cleared.
- On-contract lines: reason cleared.
- Rule `reason`: an off-contract line needs a reason of at least 5 characters.
- Rule `approval`: an off-contract line is refused on a requisition whose `need`
  is `none` or `it`.

### `guard_requisition_off_contract()` — new

Trigger `z_guard_requisition_off_contract` before update of `need` on
`enterprise_requisitions`: a business buyer cannot set `need` to `none` or `it`
while the requisition holds a line stored under the `approval` rule.

`place_requisition_order` is unchanged: it orders each line at its stored unit
price, which is now the account's.

## 4. Money rules

1. One currency per price row; never converted; numeric(10,2), compared at 2 dp.
2. Charged = `least(published, greatest(account, floor))`, today's figures,
   computed identically by `effectivePrice` (TypeScript) and the guard (SQL).
3. The seller funds the difference and is settled on the line's price, as for
   quotes and bundles. No seller is charged below its current floor.
4. Set: floor ≤ account price ≤ published price; promoted quote lines too.
5. A buyer never pays more than the published price.
6. "Your price" shows when charged < published; the published price is struck
   through beside it, in the requisition's currency, with `fmtIn`.

## 5. Screens

### Operator — Price books (`op-pricebooks`)

- Account picker (search by company), then the account's book: listing, seller,
  currency, account price, published price and floor today, charged today (with
  "held at floor" or "published is lower" when the clamp applies), window,
  source (Negotiated / From quote ENQ-…), standing badge. Filters: standing,
  currency. Default: in force and scheduled.
- **Set a price** (dialog): listing (business listings only), currency (the
  account's market's), price with the published price and floor beside it,
  starts on (today default), ends on (optional), note. Shows what it replaces
  ("AP-1004 ends on 11 Nov 2026"). Problems from `priceDraftProblems`.
- **End** (dialog): reason required; says the date it will end on (or that it
  is withdrawn).
- **Promote from a quote**: the account's accepted quote lines not already the
  price in force, each with its quoted price against today's floor; promoting
  opens the Set dialog prefilled and locked to the quote's price.
- Agreements' amendment dialog: "Prices are not amendable here — see CR-008"
  becomes "Prices are not part of an agreement — they are on Price books."

### Enterprise — Price book (`en-pricebook`)

- **Price book** (everyone on the account): listings with your price, the
  published price, saving, currency, from–to, standing; scheduled ones shown
  too. Empty state explains that prices are agreed with Aventa.
- **Buying rules**: the off-contract rule (three radio cards with what each
  means for buyers and approvers), a note, preferred sellers and preferred
  products (add from a picker, remove). Editable by a role with
  `can_set_policy`; read-only otherwise, saying who can change it.
- Your Agreement's callout "What this agreement does not set" says prices are
  the published ones unless the account has its own on Price book.

### Business buyer — shelf and requisition

- Browse, the vertical marketplaces and the listing window: preferred products,
  then listings of preferred sellers, then the rest (stable order within each);
  badges "Preferred" and "Your price"; "Your price ₹21,999" with the published
  price struck through; chips "Preferred" and "On your price book".
- Requisition drawer: each off-contract line (when the marker shows, decision
  20) carries an "Off your price book" marker; rule `reason` adds a reason field
  per line (required, 5–300); rule `approval` adds the sentence "Goes to a
  finance approver because it is off your price book". The verdict and the
  Raise button follow the same rules (`missingFields` gains the reason).
- Approvals: each line shows "Your price" or "Off your price book" with the
  buyer's reason; the requisition card carries a count ("2 lines off your price
  book").

### Seller — listing pricing panel

Read-only "Account prices on this listing": company, currency, price, from–to,
standing, and a sentence that the marketplace agrees these, they are never
below the floor, and orders settle at them.

All new screens: `Dialog`, `StatusBadge` + `statusTone` (`scheduled` info,
`in force` success, `ended` neutral, `withdrawn` neutral), console
`SectionCard`/`Table`/`Btn`/`FormField`, 44px controls, reduced motion,
`contrast.test.ts` green.

## 6. Error sentences (database)

| When | Sentence |
|---|---|
| Not the operator writes a price | Only the marketplace sets an account's prices. |
| Edit a price | An account price is not edited: end it and set a new one, so every requisition raised at the old price can still be explained. |
| Change an ended price | That price ended on 11 Nov 2026. An ended price stays as it was. |
| End before yesterday | A price can end yesterday at the earliest — requisitions already raised were checked against it. |
| Back-dated | A price starts today or later. Requisitions already raised were checked against the price that applied then. |
| Empty window | A new price has to run for at least one day: it ends before it starts. |
| Currency not taken | SmartBuild Ltd buys in IN, which does not trade in USD. |
| Not a business listing | X is not sold to business accounts, so it has no account price. |
| Unpriced | X has no published price in INR, so there is nothing to agree a price against. |
| Above published | That is above the published price of INR 23999.00 for X. An account price is at or below it. |
| Below floor | That is below the floor of INR 19999.00 that the seller of X agreed. An account price never goes under it. |
| Overlap | SmartBuild Ltd already has a price for X in INR from 12 Nov 2026 (AP-1004). One price applies at a time: end that one first. |
| Promote unaccepted | ENQ-1012 has not been accepted, so its prices cannot become the account's. |
| Promote mismatch | A price promoted from ENQ-1012 has to be that quote's account, listing, currency and price. |
| End without reason | Say why the price is ending. |
| Already ended | AP-1004 has already ended. |
| Line at the wrong price (account) | The price of X has changed: your account's price is now INR 21999.00, and this requisition has it at 23999.00. Remove it from the requisition and add it again from the catalogue to take the current price. |
| Line at the wrong price (published) | unchanged from `20261111300000` |
| Reason missing | X is not on your account's price book, and your buying rules ask for a reason when you buy off it. Say why on the line (at least 5 characters). |
| Approval bypassed (line) | X is not on your account's price book, and your buying rules send anything bought off it for approval. Raise the requisition again so it goes to a finance approver. |
| Approval bypassed (header) | REQ-1234 holds lines bought off your account's price book, which your buying rules send for approval, so it cannot be marked as needing none. |
| Rules or preferences by a non-admin | Only somebody who can set this account's policy can change its buying rules. / … choose its preferred sellers and products. |
| Preference edited | A preference is not edited: remove it and add it again. |

The client mirrors each with the same words where it checks first.

## 7. Pure logic — `src/lib/accountPrices.ts` (tested first)

`standingOf`, `inForce`, `effectivePrice`, `shelfPrice`, `priceDraftProblems`,
`replacedBy`, `endOn`, `overlaps`, `lineContract`, `needWithRules`,
`offContractReasonProblem`, `showsOffContract`, `preferenceOf`, `orderShelf`,
`ruleSummary`, `promotable`. Signatures are binding in the plan. The pure module
never imports `supabase`.

`src/lib/priceBookRepo.ts` does the reads and writes (no logic beyond shaping
rows); `enterpriseRepo.ts` overlays account prices and preferences on the
enterprise shelf and applies the rules when raising.

## 8. Testing

- **Unit (Node, test-first):** every function in §7 including the clamp
  (account under a raised floor, published under the account price), rounding,
  windows (withdrawn, ended yesterday, scheduled tomorrow, open-ended), overlap
  edges (touching days), need lifting, reason bounds, ordering stability;
  basket (`setReason`, `verdict` with rules, `missingFields` reason);
  `raiseRequisition` payload mapping; `statusTone` additions; pure-module guard.
- **Component (jsdom, `*.dom.test.tsx`):** the price tag (struck published
  price only when charged is lower; accessible text "Your price … was …"), the
  reason field (label tied to input, error announced), the rule radio cards
  (keyboard), the Set price dialog's problems.
- **Migration structural test** (`accountPrices.migration.test.ts`): tables,
  named constraints not colliding with auto names, functions security definer
  with search path, triggers and their events/columns, RLS on and policies
  named, the replaced guard keeps the earlier phrases, no bare CASE in an
  IF/ELSIF condition, no `drop table`, begin/commit, the prerequisite check
  first and in the self-check, seed by id, CR-008 update, help articles.
- **Integration** (`accountPrices.integration.test.ts`, skips until applied):
  operator sets, replaces, ends and promotes; refused below floor, above
  published, back-dated, overlapping, edited; buyer's line at the account price
  accepted and at the published price refused; rules `reason` and `approval`
  enforced on lines and header; flags cannot be cleared by the buyer; another
  account reads nothing; the seller reads its own listings' rows only;
  non-admin cannot change rules. Every row it creates is deleted; the rule is
  restored.
- **Browser** (after apply): the three consoles at 1280 / 1024 / 390 with
  `scripts/contrast-scan.js`; keyboard through every new dialog; one round trip
  (operator sets a price → buyer sees Your price → raises → approver sees it).
- **Gates per task:** `npx vitest run` (only `gateway.test.ts`
  financingProblem and `partnerApplication.test.ts` '02 Aug 2026' may fail) and
  `npm run build`.

## 9. Build order

1. In parallel: migration + structural + integration test; `accountPrices.ts`.
2. In parallel: repo, basket and enterprise repo; wiring (view ids, nav,
   stubs, shared tags, tones).
3. In parallel: operator screen; enterprise price book and rules; shelf;
   requisition and approvals; seller panel.
4. Stop: syntax check, the user applies `20261111200000`, `20261111300000`,
   then this file.
5. Integration tests (this spec's, `requisitionPrice`, `requisitionOrder`,
   `contracts` updated for CR-008), browser sweep, one fix wave.
6. Docs (README, backlog), final review, merge.

## 10. Out of scope

Quantity price tiers; scheduled or bulk imports (CSV); seller-proposed prices
or seller approval of an account price; consumer pricing; punch-out; blocking
non-preferred sellers or products; account prices inside bundles; renewals
reverting to the published price; notifications when a price is set or ends;
multi-currency price rows created by conversion; re-checking `need` against the
threshold in the database (pre-existing gap, see Risks).

## 11. Risks

- **Apply order.** This file replaces the function that `20261111300000`
  installs. Re-running `20261111300000` afterwards would put the old guard back
  (published price only) and every account-priced line would be refused. The
  self-check names the order; the hand-over says it.
- **The clamp moves a price nobody re-agreed.** A seller who raises its floor
  above an account price lifts that account's charged price to the floor. The
  operator screen shows "held at floor" so the desk sees it; a guard on
  `product_prices` refusing the floor change was rejected because it would let
  an operator's agreement block a seller's own pricing.
- **`need` is still the client's.** The database checks only that an
  off-contract line under `approval` is not on a `none`/`it` requisition; it does
  not re-derive `need` from the threshold (pre-existing).
- **`enterprise_approval_policy` RLS** checks the literal `'procurement-lead'`,
  so policy edits fail on accounts other than SmartBuild (pre-existing; this
  spec does not widen it, and its own tables use `can_set_policy`).
- **Midnight.** The screen decides "in force" by the browser's date, the guard
  by `current_date`; a price that starts or ends at midnight can be refused once
  with the "price has changed" sentence (same as spec 6 expiry).
- **The basket is not saved** across a reload; a price ending overnight under
  an open basket is refused at raise and named.
- **Seller sees company names** on account prices; sellers already see buyers
  on orders, so no new class of data is exposed.
- **CR-008 reversal** touches copy in five places; missing one leaves a screen
  saying prices are never negotiated. The plan lists each.
