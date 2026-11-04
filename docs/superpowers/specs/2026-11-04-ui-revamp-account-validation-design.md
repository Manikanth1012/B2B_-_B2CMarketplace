# UI revamp, spec 5 — account screens and validation sweep

Date: 2026-11-04 · Status: approved in conversation
Builds on specs 1 (foundation), 2 (commerce) and 3+4 (consoles), all merged.

## Why

Spec 2 left the consumer account screens — Orders, Subscriptions, Rewards and
My account — in their old inline layout, and each carries its own copies of a
card, a stat card and a modal (none of which traps focus). The earlier specs
also parked 24 non-blocking review findings in `docs/superpowers/backlog.md`.
This spec restyles the account screens on the shared layer, clears the
backlog's carried-over items, then checks every experience end to end.

## Decisions taken in brainstorming

| Question | Decision |
|---|---|
| Scope | Both: restyle the account screens (A) and run the validation sweep with the backlog leftovers (B) |
| Approach for A | A shared account layer replacing the local `Card`/`Modal`/`StatCard`/`SectionCard` copies — not a CSS-only re-skin, not a new "account home" |

## Constraints

Unchanged from specs 1–4: no functional change (routes, `App.tsx` view ids,
repos, RLS, every handler, field, validation and permission check); no
invented data, metrics or capabilities; no new dependencies; no database
change; WCAG 2.2 AA held by `src/lib/contrast.test.ts`; animation off under
`prefers-reduced-motion`. Account screens are light and plain: `--bg-alt`
page, white cards, no gradients, globe or glow. Content max width 1200px.
Keep the explanatory comments in files that are restructured.

## A. Account screens

### A1. Shared account layer — `src/components/account/`

| Unit | What it is |
|---|---|
| `AccountPage` | Page shell for `orders`, `subscriptions`, `rewards`, `account`: light title strip (one h1, a one-line subtitle, optional right-aligned actions) over a content area at container width. The four view ids in `App.tsx` stay as they are; no new routes and no new cross-links |
| `AccountTabs` | My account's nine tabs (profile, security, notifications, activity, household, wallet, refunds, bills, support). ≥ 1024px: sticky left list with icons; below: horizontally scrolling chips. A `tablist` with arrow keys, Home and End. `initialTab` and `isTab` kept |
| `Dialog` (in `src/components/ui/`) | `role="dialog"`, `aria-modal`, labelled by its title, focus trapped, Escape closes, focus returns to the opener, optional `wide`. Replaces AccountView's local `Modal`, the order and ticket detail windows, and becomes the internals of the console `Modal` in `operator/shared.tsx` (its props unchanged) |
| Cards | `BentoCard variant="light"` and `KpiCard` replace AccountView's `Card` and RewardsView's `StatCard`/`SectionCard`. Titles keep their wording and icons. `BentoCard` gains a heading-level prop; each account page has one h1 and h2 card titles |
| Status | Order, subscription, refund, bill and ticket states render through `StatusBadge` and `statusTone` (`src/lib/consoleTone.ts`); any state names not yet mapped are added with tests |

Every data read, handler, form field, validation rule, currency formatting
(`fmtIn` with the row's own currency) and `Pager` is kept; cards and windows
are moved, not rewritten.

### A2. Screens

- **My Orders** — each order a white card: header row with reference, date,
  `StatusBadge`, total in the order's currency and "View details"; item lines
  as a compact list with thumbnails; existing pager. Detail in `Dialog`,
  two-column body on desktop (items and network fulfilment left; totals and
  payment right). Empty state through the shared empty state.
- **My Subscriptions** — one card per subscription: name, existing status
  line, `StatusBadge`; the existing actions (pause/resume auto-renew and the
  others present today) on the right at 44px, stacked below on phone.
- **Rewards** — the four existing figures as a `KpiCard` bento (4 / 2 / 1
  columns); the existing sections as `BentoCard`s in a two-column grid on
  wide screens; the tier progress bar in the navy-to-cyan accent with a text
  label so it does not rely on colour.
- **My account** — tabs left, the active tab's cards right. Profile: its
  existing cards (Personal details, Preferences, My number, Address book,
  Stock watch, Reviews, Account summary, Documents) in two columns at
  ≥ 1200px, one below. Activity, Bills, Refunds, Support: tables on desktop,
  stacked label/value cards on phone. Security: a settings list, one row per
  setting with its action (Password, two-factor sign-in, Payment methods,
  Sessions).

## B. Leftovers and validation sweep

### B-fix. Backlog items, grouped by file area

**B1 — shared UI and contrast**
- Remaining decorative glyphs in the light teal (`ProductDetail.tsx:29` and
  any others the guard finds) → `--brand-accent-dark`.
- Stale `rgba(0,166,166,…)` tints (Checkout, LoginScreen, OperatorRoles and
  any others) → the current accent tints.
- Contrast guard extended to colours passed through props/variables
  (`accentColor`, `catColors`) and to white glyphs on accent fills.
- Forced-colours fallback for the gradient headline text.
- `.ui-link` hit area ≥ 24px (WCAG 2.5.8).
- Delete the unused `Carousel.tsx` and `lib/carousel.ts`.

**B2 — public and commerce**
- One Escape closes the innermost layer only (Discover panel before the
  mobile menu).
- `CategoryTile` regains an optional description, shown for consumer tiles.
- `loadPriceBook`/`loadCopyBook` in `src/lib/moneyRepo.ts` surface errors; a
  failed read shows a "couldn't load prices — retry" state instead of the
  "nothing priced for your market" message. Tested.
- The enterprise Marketplace filter takes its verticals from the data.
- The product page "Notify me when available" line opens the existing
  `NotifyMeModal` (no new capability).
- Cart stepper buttons at 44px.
- Requisition drawer focus trap, via the shared `Dialog`'s trap.

**B3 — consoles**
- Operator nav: the forced-open active group's header shows it is pinned
  open (`aria-disabled` plus a hint) instead of a silent no-op;
  `aria-controls` only when the panel is mounted.
- Quick actions fills the row when there are no alerts.
- Accounts tests gain no-steps and due-today boundary cases; the Waiting chip
  respects search.
- Listing modal heading styles made consistent.
- Hairline `--border-light` border on stat and section cards.
- Table row hover no longer overrides an inline row highlight.
- Disabled danger and success buttons keep their tone.
- PartnerDashboard "Settlement Due" gets a text label so its colour is not
  the only signal.
- Accounts chip counts follow the search, as the list does.
- Enterprise listing modal: buy panel sticky on desktop; "Add to requisition"
  disabled when the listing is out of stock, by the same `cardAction` rule
  the browse cards use.
- Operator sidebar: brand alt text and the mobile close button's label match
  the partner and enterprise shells; the nav-order comment corrected.

### B-check. Validation sweep

Run after A and B-fix are merged:

- **Contrast** — the browser scanner used in specs 1–4 is committed as
  `scripts/contrast-scan.js` (pasteable into DevTools or run through the
  browser tool) and run on every screen of all five experiences (public,
  consumer, enterprise, partner, operator) at 1280, 1024 and 390. Bar: zero
  failures.
- **Keyboard** — tab order, visible focus, Escape and focus return on every
  dialog, drawer, menu, tab list and chip group.
- **Phone** — no horizontal page scroll at 390px; touch targets ≥ 44px on the
  account screens and cart, ≥ 24px elsewhere.
- **Reduced motion** — no movement anywhere with it on.
- **Market switch** — a basket carried India → Kenya keeps its lines and
  their currency (the spec 2 promise); account figures use each row's own
  currency.
- **Integration** — `npm run test:integration` with no failure outside
  `main`'s baseline.
- **Data** — SKU-7011's missing INR price and the drifted integration seed
  data are reported to the user, not changed in code.

Findings get one fix wave, then a re-check of the screens it touched.

## Build order

1. The account layer and the shared `Dialog` (everything else uses it).
2. In parallel worktrees: account screens; B1; B2; B3.
3. The validation sweep, then one fix wave.
4. Docs.

## Testing

Unit (Node, test-first) in `src/lib`: any new `statusTone` mappings; the
`moneyRepo` error path (as a pure result type the UI reads); the Accounts
boundary cases; the extended contrast guard. Gates per task: `npx vitest run`
(only the two known env-dependent failures) and `npm run build`. Browser
checks never place orders, submit refunds or tickets, or change account
details — the database is shared and seeded.

## Documentation

`README.md` Design system: `AccountPage`, `AccountTabs`, `Dialog`, the
`BentoCard` heading prop, `scripts/contrast-scan.js`.
`docs/superpowers/backlog.md`: spec 5 done; the carried-over sections
emptied; only the five new enterprise features and the data checks remain.
