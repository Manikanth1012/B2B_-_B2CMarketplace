# Spec 6 — enterprise enquiries: quotes, demos, Contact Sales and tracking

Date: 2026-11-05 · Status: approved in conversation
Follows the UI revamp (specs 1–5, merged). Spec 7 (buyer-built bundles) is
separate and comes after this one.

## Why

The revamp brief asks the enterprise storefront to let a business ask before
it buys: request a quote, book a demo, contact sales, and follow those
requests to an answer. None of this exists. Today a buyer can only add a
listing to a requisition at its list price.

## Decisions taken in brainstorming

| Question | Decision |
|---|---|
| Split | Two specs: this one (enquiries), then buyer-built bundles |
| Database changes | Claude writes the migration; the user applies it to the live project (SQL editor or `supabase db push`). Browser checks and integration tests wait for the user's go-ahead |
| Who answers | A quote or demo whose lines all belong to one seller goes to that seller; a multi-seller quote and every Contact Sales enquiry go to the operator desk. The operator sees everything and can reassign |
| Accepted quote | Accepting puts the quoted lines into the buyer's requisition at the quoted price; the existing approval and order flow is unchanged |
| Who can ask | Signed-in enterprise buyers only. The public Enterprise page's Contact Sales leads to sign-in or the business-account application |
| Data shape | One `enquiries` record with typed parts (approach 1), not a table per feature and not support tickets |

## Constraints

- No change to existing behaviour beyond what this spec adds: routes, view ids,
  repos, RLS and flows that exist keep working as they do.
- No new runtime dependencies.
- WCAG 2.2 AA, held by `src/lib/contrast.test.ts`; 44px controls on the new
  screens; reduced motion respected; the shared `Dialog`, `StatusBadge`
  (`statusTone`), list and card components from the revamp.
- Every state rule that matters is enforced in the database (triggers and RLS),
  and mirrored by pure, tested functions the screens use. The screen never
  decides what the database would refuse.
- Money is held per enquiry in one currency (the account's requisition
  currency) and shown with `fmtIn`.
- Integration tests delete every row they create (shared seeded database).

## 1. Data model (one migration)

File: `supabase/migrations/<timestamp>_a_business_can_ask_before_it_buys.sql`,
idempotent (`if not exists`, `create or replace`, `drop … if exists`).

### `enquiries`

| Column | Notes |
|---|---|
| `id` text pk | `ENQ-` + number, from a sequence |
| `type` | `quote` · `demo` · `sales` |
| `account_id` | → `enterprise_accounts`, not null |
| `raised_by` | → `enterprise_users`, not null |
| `partner_id` | → `partners`, null = operator desk. Set by trigger on insert (routing rule below), changed only by the operator |
| `subject` | not null, ≤ 120 chars |
| `status` | per-type set below |
| `currency` | not null for `quote`; the account's requisition currency |
| `needed_by` | date, optional (quote) |
| `valid_until` | date, set by the responder when quoting; 1–90 days ahead |
| `format` | `video` · `onsite` (demo only) |
| `attendees` | integer 1–500 (demo only) |
| `contact_pref` | `email` · `phone` · `in_app` (sales only) |
| `decline_reason` | required when declined by either side |
| `created_at`, `updated_at`, `decided_at` | timestamptz |

**Routing (insert trigger).** `quote`/`demo`: if every line's product belongs
to the same partner, `partner_id` is that partner; otherwise null. `sales`:
always null.

**Statuses and who may move them.**

| Type | Transitions |
|---|---|
| quote | `submitted` → `quoted` (responder) · `submitted`/`quoted` → `declined` (responder, with reason) · `quoted` → `accepted` / `declined` (buyer, `can_raise`) · `submitted`/`quoted` → `withdrawn` (buyer) · `quoted` → `quoted` (responder re-quotes with a new `valid_until`) |
| demo | `requested` → `scheduled` (responder confirms a slot) · `requested`/`scheduled` → `declined` (responder, reason) · `requested`/`scheduled` → `withdrawn` (buyer) · `scheduled` → `done` (responder) |
| sales | `open` → `answered` (responder replies) · `answered` → `open` (buyer replies) · any → `closed` (either side) |

**Expiry.** No scheduler exists. A `quoted` quote whose `valid_until` is before
today is *expired* when read (`enquiryState()` and a column in the
`enquiry_book` view). The trigger refuses `accepted` after `valid_until`. The
responder may re-quote it.

### `enquiry_lines` (quote and demo)

`id`, `enquiry_id`, `product_id` → `products`, `name`, `partner_id`,
`quantity` (> 0; demo lines quantity 1), `target_unit_price` (optional,
buyer), `quoted_unit_price` (responder only; null until quoted),
`sort_order`. A trigger refuses a buyer write to `quoted_unit_price` and a
responder write to anything else. Quoting requires every line priced.

### `enquiry_slots` (demo)

`id`, `enquiry_id`, `starts_at` timestamptz, `proposed_by`
(`buyer` · `responder`), `confirmed` boolean, `location` (joining link or
address; required when confirmed). The buyer proposes 1–3 future slots; the
responder confirms one or proposes another. At most one confirmed slot.

### `enquiry_messages`

`id`, `enquiry_id`, `author_role` (`buyer` · `partner` · `operator`),
`author_name`, `body` (1–4000 chars), `created_at`. Insert-only.

### `enquiry_events` (audit)

`id`, `enquiry_id`, `actor_role`, `actor_name`, `action`, `from_status`,
`to_status`, `note`, `at`. Written by trigger on every status change and
reassignment; read-only to all.

### RLS

- Operator (`current_persona() = 'operator'`): all rows, all tables.
- Enterprise: rows whose `account_id = current_account_id()`; insert as
  `raised_by` = the caller's `enterprise_users` row; `quote`/`demo` insert and
  quote accept require `can_raise`.
- Partner: enquiries with `partner_id = current_partner_id()`; on a
  multi-seller quote (desk-routed) a partner reads its own lines only, and
  cannot write.
- Child tables follow the parent's visibility.

### Requisition link

`enterprise_requisition_lines` gains `quote_line_id` → `enquiry_lines`
(unique where not null). A trigger requires, when set: the quote is
`accepted`, not past `valid_until`, belongs to the same account, the line's
`product_id` and `quantity` match, and `unit_price` equals
`quoted_unit_price`. Existing lines (null) are unaffected.

### Notifications

New `notification_events`: `enquiry.raised` (operator, partner),
`enquiry.answered` (enterprise), `enquiry.decided` (operator, partner), with
one default enabled rule per persona (in-app). A trigger writes
`notification_log` rows at the moment of change: `inapp` as `delivered`, and
any other kind the rule names as `suppressed` with
`detail = 'No gateway is connected for <kind>'`. `ref` = the enquiry id.
Recipients: the routed partner (or the operator persona for the desk); the
raising buyer's user.

### Seed

One enquiry of each type for the demo enterprise account (SmartBuild), in
different states (a quote awaiting the buyer, a scheduled demo, an answered
sales enquiry), plus one desk-routed multi-seller quote, so every screen has
something on first run. Seed ids use a distinct prefix (`ENQ-9`) so tests and
cleanup can tell them apart.

## 2. Pure logic — `src/lib/enquiries.ts` (tested first)

- `routeTo(lines): string | null` — the routing rule.
- `canTransition(type, from, to, role): boolean` and `nextActions(enquiry, role, today): Action[]`.
- `enquiryState(enquiry, today)` — status with expiry applied.
- `waitingOn(enquiry, today): 'buyer' | 'responder' | 'nobody'` — drives the
  chips "Waiting on you" / "Waiting on them" / "Closed".
- `quoteTotals(lines)` — per-line and total in the enquiry currency; null
  while any line is unpriced.
- `validUntilProblem(date, today)` — 1–90 days.
- `slotProblems(slots, now)` — 1–3 future slots, one confirmed at most.
- `toRequisitionLines(enquiry, lines)` — the accepted quote as requisition
  lines carrying `quote_line_id` and the quoted price.

`src/lib/enquiryRepo.ts` holds the Supabase reads/writes (no logic beyond
shaping rows), following the other `…Repo.ts` files; the pure module never
imports `supabase` (the `pureModules` test enforces this).

## 3. Screens

### Business buyer (enterprise console)

- **Listing window** (`EnterpriseListingModal`): "Request a quote" beside
  "Add to requisition"; "Book a demo" for services and IoT/security listings
  (the listing's existing category/kind decides).
- **Requisition drawer**: "Request a quote for this basket" turns the current
  lines into one quote request; the basket is not emptied.
- **Header**: "Contact Sales" opens the sales form.
- **Forms** in the shared `Dialog`: quote (lines, quantity, optional target
  price, needed-by, note); demo (format, up to three preferred times,
  attendees, note); sales (topic, message, contact preference).
- **Enquiries** screen (sidebar, after Orders): list with chips All / Waiting
  on you / Waiting on them / Closed, a type filter and search; each row shows
  type, subject, status badge, who answers, last update. Detail: summary,
  lines with quoted prices and totals or the slots, the conversation, the
  audit trail, and the actions `nextActions` allows (Accept → lines into the
  requisition and the drawer opens; Decline with reason; Confirm a proposed
  slot; Suggest another time; Withdraw; Reply).
- **Dashboard**: an "Enquiries waiting on you" KPI.

### Seller (partner console)

- **Enquiries** screen near Orders: same list/detail, routed to this seller.
- Quote: unit price per line, valid-until, note → Send quote; Decline with
  reason. A price below the seller's agreed floor shows a warning (allowed).
- Demo: Confirm a slot with joining link or address; Propose another time;
  Mark done.
- Reply on any enquiry.

### Operator

- **Enquiries** in the Service group beside Tickets & SLA: everything, with
  filters by type, status, who answers and age; answers desk-routed enquiries
  like a seller; can reassign desk ↔ seller with a recorded reason.
- Dashboard Quick actions gains an Enquiries link.

### Public site

The Enterprise page's "Contact Sales" opens sign-in, with a link to apply for
a business account.

All screens use the revamp's components and rules; new status names are added
to `statusTone` with tests.

## 4. Testing

- Unit (Node, test-first): every function in §2, plus `statusTone` additions.
- Integration (`src/lib/enquiries.integration.test.ts`, live database, after
  the user applies the migration): quote raised → seller quotes → buyer
  accepts → requisition line at the quoted price; tampered price refused;
  another account cannot read; another seller cannot answer; expired quote
  cannot be accepted; demo and sales flows; notification rows written. Every
  test deletes what it created.
- Browser (after the migration is applied): all three consoles at 1280 / 1024
  / 390 with `scripts/contrast-scan.js`; keyboard through every new dialog;
  one full quote round trip across personas, cleaned up afterwards.
- Gates per task: `npx vitest run` (only the two known env-dependent failures)
  and `npm run build`.

## 5. Build order

1. Migration + `enquiries.ts` with tests (no UI).
2. `enquiryRepo.ts`, `statusTone` additions.
3. In parallel: buyer screens; seller screens; operator screens.
4. Stop: the user applies the migration.
5. Integration tests, browser sweep, one fix wave.
6. Docs (README, backlog), review, merge, push.

## 6. Out of scope

Email/SMS delivery (no gateway), calendar invites, file attachments on
enquiries, public (signed-out) enquiries, buyer-built bundles (spec 7),
server-side repricing of ordinary requisition lines (an existing gap noted in
the backlog).
