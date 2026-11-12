# Spec 10 — loose ends from specs 6, 9 and 7's dialog — spec and plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development.

Date: 2026-11-12 · Status: requested by the user ("Do this for now"), decisions taken on recommended options.
Items come from `docs/superpowers/backlog.md` ("Still open after spec 6", spec 9 deferred minors, spec 7 dialog).

## Decisions

| Item | Decision |
|---|---|
| Email / calendar invites | No email provider exists (no gateway, no keys), so no email is sent. Every scheduled demo and every sent quote offers **Add to calendar**: an RFC 5545 `.ics` file built in a pure, tested module and downloaded in the browser (buyer, desk and seller sides). Demo → an event at the agreed slot (duration from the slot, else 30 min); quote → an all-day reminder on its expiry date. UID stable per enquiry so re-downloading updates rather than duplicates. Real email is a later item once the user picks a provider. |
| Seller's price on a multi-seller desk quote | The seller of a line on a desk-routed quote (`enquiries.partner_id` null, `enquiry_lines.partner_id` = the seller) can **propose a unit price for its own lines** with an optional note; the desk sees each seller's proposal beside the line in its quote form and can use it or not. The desk still sends the quote (one voice to the buyer). New migration `20261112200000_a_seller_prices_its_part_of_a_desk_quote.sql`: its own table `enquiry_line_proposals` (one row per line: `unit_price numeric(12,2)`, `note`, `proposed_at`, `proposed_by`), readable by that seller and the desk only — never the buyer, since the gap to the quoted price is the desk's margin — and written only through an rpc `propose_line_price(p_line_id, p_price, p_note)` (seller of that line, enquiry desk-routed and still `submitted`; price > 0 and not below the line's floor if one exists); the seller can read its own lines' rows (existing policy) and nothing else of other sellers. Notification to the desk through the existing notification path. |
| Quote expiry date | Judge "today" the way the database does: the UTC calendar date (the DB runs in UTC and `accept_quote` compares with `current_date`). One shared helper `dbToday()` (pure, tested) replaces the browser-local date in every expiry check and label; the label says "Valid until 12 Nov 2026 (UTC)" only where the two could differ (within a day). |
| Price changes while the requisition drawer is open | On Raise, the panel re-reads the account's prices (and rules) and recomputes each line's contract standing first. If any line's standing changed, nothing is raised: the drawer shows the changed lines (new price / now off the price book, with a reason field when the rule asks for one) and a sentence asking the buyer to check and raise again. |
| Approvals tests | DOM tests for the spec 9 Approvals changes: "Your price" vs "Off your price book" + reason per line, the card's count sentence, and decision-20 visibility; plus the unit test for the policy-note lift (`policyNoteFor(..., liftedByRules)`). |
| Dialog Close button | The shared `Dialog` Close button becomes 44×44 (visual icon unchanged), checked by a DOM test. |

## Constraints

No change to behaviour beyond each item; no new runtime dependencies; WCAG 2.2 AA (`contrast.test.ts`); 44px
controls; reduced motion; pure modules never import `supabase`; components read and write only through repos.
Migration: idempotent, one transaction, `create or replace`, `drop … if exists`, no bare CASE in IF/ELSIF,
no named constraint colliding with an auto-named `<table>_<col>_check`, final self-check DO block, syntax-checked
with libpg-query before hand-over; integration test that skips until applied and cleans up. Gates per task:
`npx vitest run` (only `gateway.test.ts` financingProblem and `partnerApplication.test.ts` '02 Aug 2026' may fail),
`npx tsc --noEmit`, `npm run build`. Commits: plain-English subject, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Tasks (parallel worktrees, branch `loose-ends`)

### Task A: Seller prices its part of a desk quote (migration + screens)
Files: the new migration; `src/lib/enquiryRepo.ts` (+ payload/mappers) for `proposeLinePrice`; `src/components/partner/PartnerEnquiries.tsx`
(seller form on its own lines of a desk quote); `src/components/enquiries/QuoteResponseForm.tsx` (desk sees each line's
proposal and can "Use the seller's price"); structural + integration tests. Before the migration the seller form must
not appear (or say pricing isn't set up yet) and the desk form must work exactly as today.

### Task B: Add to calendar, and expiry in the database's day
Files: new pure `src/lib/calendarInvite.ts` (+ test), new pure `src/lib/dbDay.ts` (+ test), `src/components/enquiries/EnquiryDetail.tsx`,
`EnquiryList.tsx`, and wherever an expiry is judged on screen (grep `valid_until`, `expires`, `expired`). Not
`QuoteResponseForm.tsx` or `PartnerEnquiries.tsx` beyond a one-line button placement if needed (Task A owns them).

### Task C: Requisition drawer re-check, Approvals tests, Dialog Close 44px
Files: `src/components/enterprise/RequisitionPanel.tsx` (+ DOM test), `src/components/enterprise/EnterpriseApprovals.tsx` (tests only
unless a bug is found), `src/lib/enterprise.ts` test for `policyNoteFor`, `src/components/ui/Dialog.tsx` (+ its CSS and DOM test).
