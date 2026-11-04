# UI revamp, spec 3 of 4 — workspace consoles

Date: 2026-11-04 · Status: approved in conversation
Merges the original specs 3 (operator console) and 4 (partner portal), at the
user's choice: one shared component file, `src/components/operator/shared.tsx`,
builds 43 of 46 operator screens, 20 of 22 partner screens and 17 of 19
enterprise back-office screens, so one pass over it moves all three consoles.

## Constraints

Unchanged from specs 1–2: no functional change; no invented data, metrics or
capabilities; no new dependencies; WCAG 2.2 AA held by `src/lib/contrast.test.ts`;
reduced motion respected. Operational screens follow the brief's enterprise-SaaS
language: light grey workspace, white panels, dark navy sidebar, blue/teal
highlights — no gradients, globe or glow inside them.

## 1. Shared components (`operator/shared.tsx`)

Props and behaviour unchanged for every export; only presentation changes.

| Export | Change |
|---|---|
| `StatCard` | KPI-card look: `--radius-card`, `--shadow-card`, no border; label in `--text-secondary` sentence case (drop the uppercase); value navy, or the given `color` as a 8px status dot beside the label rather than colouring the number (a coloured number on white can fail AA) |
| `SectionCard` | `--radius-card`, `--shadow-card`, header with `--border-light` divider; h3 title kept |
| `Table` | Header row on `--bg-alt` with `--text-secondary` 12px 600 labels; row hover `--bg-alt`; borders `--border-light`; existing alignment and padding logic kept |
| `StatusPill`, `PriorityPill` | Rendered through `ui/StatusBadge` (tone + icon), mapping each existing status to a tone; unknown statuses → neutral |
| `Btn` | Pill radius; `primary` stays navy; new optional variant `accent` = cyan with navy text for a screen's single main call to action (no existing caller changes); `secondary` white with `--border-strong`; disabled keeps readable text |
| `Modal`, `ConfirmDialog` | `--radius-card`, `--shadow-xl`; existing focus behaviour kept |
| `FormField`, `TextInput`, `TextArea`, `Select` | 44px controls (TextArea min-height), `--border-strong` borders, electric focus ring |
| `EmptyState` | Centred, `--text-secondary`, optional icon in a tinted disc |

## 2. Sidebars

`OperatorShell`, `PartnerShell`, `EnterpriseShell`: navy rail, group headings in
`rgba(255,255,255,0.62)` (≥4.5:1, fixed in spec 1), active item with a cyan
left indicator and `rgba(255,255,255,0.12)` fill, 6D mark plus the Aventa
wordmark. Every existing item, route and badge kept.

Operator only — the 18-item "Operations" group splits into collapsible groups
(all modules kept, order within each kept):

- **Partners & accounts** — Onboarding, Accounts, Sellers, Catalogue Review
- **Commerce** — Orders, Renewals, Inventory & WMS, Numbers & SIMs, Refunds, Rewards
- **Finance** — Settlement Runs, Revenue Share, Credit & Exposure, Collections, Wallets, Credit & Debit Notes, General Ledger, Bill Templates, Markets & Currencies
- **Service** — Tickets & SLA, Disputes, Agreements

Overview keeps Dashboard; Platform and Governance unchanged. A group containing
the active view is always expanded; collapse state is per session (component
state), not persisted.

## 3. Operator dashboard

- 8 existing KPIs in a 4-column bento of `StatCard`s (2 on tablet, 1 on phone).
- The existing "waiting on you" callout becomes an **Operational alerts** card.
- **Quick actions** card: links to existing views only — Catalogue Review,
  Settlement Runs, Tickets & SLA, Onboarding.
- Existing charts and tables in bento `SectionCard` panels; data and
  reconciliation notes unchanged.

## 4. Business Accounts (`OperatorAccounts.tsx`)

Existing summary `StatCard`s and search kept. Add status filter chips over the
list already loaded — All, Onboarded, Part-way through, Overdue, Waiting —
using the same bands/predicates the summary counts use (no new data).
Status badges via `StatusPill`. Detail view unchanged.

## 5. Partner and enterprise dashboards, enterprise listing modal

`PartnerDashboard`, `EnterpriseDashboard`: existing figures in the KPI bento,
existing panels as `SectionCard`s. `EnterpriseListingModal`: restyled to the
spec 2 product-page language (photo, overview, specs, sticky price + action)
with the same fields and handlers.

## 6. Verification

Unit suite and build per task; browser pass on all three consoles (dashboard,
two dense table screens each, a modal, a form) at 1280 and 390 with the
programmatic contrast scan; integration suite against main's baseline.
