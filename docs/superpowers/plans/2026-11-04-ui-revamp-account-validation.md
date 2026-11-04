# UI revamp, spec 5 — account screens and validation sweep — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Put the consumer account screens on the shared layer, clear the backlog's carried-over review items, and check every experience for contrast, keyboard, phone width, reduced motion and market switching.

**Architecture:** Task 1 builds the shared pieces (`Dialog`, focus trap, `AccountPage`, `AccountTabs`, `BentoCard` heading level, new status tones). Tasks 2–6 then run in parallel worktrees, each owning its own files and its own stylesheet, and are merged by the controller. Task 7 is the controller's sweep; Task 8 one fix wave; Task 9 docs.

**Tech stack:** Vite 5, React 18, TypeScript, Supabase, Vitest 2 (Node environment — only `src/**/*.test.ts`, no DOM), lucide-react.

**Spec:** `docs/superpowers/specs/2026-11-04-ui-revamp-account-validation-design.md`

## Global Constraints

- No functional change: routes, `App.tsx` view ids, repos, RLS, every handler, form field, validation rule and permission check kept. No invented data, metrics or capabilities.
- No new dependencies. No database change.
- WCAG 2.2 AA (4.5:1 small text, 3:1 large text/UI); `src/lib/contrast.test.ts` stays green, including its guard against `color: var(--brand-accent)` in `.tsx`.
- Account screens: `--bg-alt` page, white cards, no gradients, globe or glow; content max width 1200px; 44px touch targets on account screens and cart.
- Reduced motion respected.
- Currency: every figure keeps using `fmtIn` / `money` with the row's own currency, as today.
- Keep the explanatory comments in files you restructure.
- Browser checks never place orders, submit refunds or tickets, or change account details (shared seeded database).
- Gates per task: `npx vitest run` (only `gateway.test.ts` financingProblem and `partnerApplication.test.ts` '02 Aug 2026' may fail) and `npm run build`.
- Commits: plain-English subject saying what changed and why, short body, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only files you changed; never force-add ignored files.
- Parallel worktrees: run `npm ci` inside the worktree (no node_modules junctions).

## File map

| File | Owner task | Responsibility |
|---|---|---|
| `src/lib/focusTrap.ts` (+ test) | 1 | Pure next-focus index rule |
| `src/lib/tabKeys.ts` (+ test) | 1 | Pure tablist key → index rule |
| `src/lib/consoleTone.ts` (+ test) | 1 | New status names mapped to tones |
| `src/components/ui/Dialog.tsx`, `src/components/ui/useFocusTrap.ts` | 1 | Shared dialog and trap hook |
| `src/components/ui/BentoCard.tsx` | 1 | `headingLevel` prop |
| `src/components/operator/shared.tsx` (`Modal` only) | 1 | Internals via `Dialog`, props unchanged |
| `src/components/account/AccountPage.tsx`, `AccountTabs.tsx`, `src/styles/account.css` | 1 | Account shell and tabs |
| `OrdersView.tsx`, `SubscriptionsView.tsx`, `RewardsView.tsx`, `src/styles/account-screens.css` | 2 | Three account screens |
| `AccountView.tsx` and the cards it imports, `src/styles/account-view.css` | 3 | My account |
| B1 files, `scripts/contrast-scan.js` | 4 | Shared UI and contrast |
| B2 files | 5 | Public and commerce |
| B3 files | 6 | Consoles |

---

### Task 1: Shared account layer and Dialog

**Files:** create `src/lib/focusTrap.ts`, `src/lib/focusTrap.test.ts`, `src/lib/tabKeys.ts`, `src/lib/tabKeys.test.ts`, `src/components/ui/useFocusTrap.ts`, `src/components/ui/Dialog.tsx`, `src/components/account/AccountPage.tsx`, `src/components/account/AccountTabs.tsx`, `src/styles/account.css`; modify `src/components/ui/BentoCard.tsx`, `src/components/ui/index.ts`, `src/lib/consoleTone.ts`, `src/lib/consoleTone.test.ts`, `src/components/operator/shared.tsx` (`Modal` only), `src/main.tsx` (import `account.css` after `checkout.css`).

**Produces (exact names later tasks use):**

```ts
// src/lib/focusTrap.ts
/** Index to focus after Tab (shift=false) or Shift+Tab (shift=true) from
 *  `current` among `count` focusable elements; wraps at both ends.
 *  current = -1 means focus is outside the list. count = 0 → -1. */
export function nextFocusIndex(current: number, count: number, shift: boolean): number

// src/lib/tabKeys.ts
/** New tab index for a key in a horizontal-or-vertical tablist, or null if
 *  the key is not a tablist key. ArrowRight/ArrowDown next (wrap),
 *  ArrowLeft/ArrowUp previous (wrap), Home 0, End count-1. */
export function tabKeyTarget(key: string, current: number, count: number): number | null

// src/components/ui/useFocusTrap.ts
export function useFocusTrap(ref: React.RefObject<HTMLElement>, active: boolean): void
// on activate: remembers document.activeElement, focuses the first focusable
// inside ref (or ref itself, tabIndex -1); traps Tab/Shift+Tab with
// nextFocusIndex; on deactivate/unmount: restores focus to the remembered element.

// src/components/ui/Dialog.tsx
export function Dialog(props: {
  open: boolean
  onClose: () => void
  title: React.ReactNode
  children: React.ReactNode
  footer?: React.ReactNode
  wide?: boolean          // 920px instead of 560px
  labelId?: string        // optional; otherwise generated with useId
}): JSX.Element | null
// role="dialog" aria-modal="true" aria-labelledby → the h2 title; Escape closes;
// backdrop click closes; uses useFocusTrap; classes .ui-dialog*, reduced-motion safe.

// BentoCard: new optional prop
headingLevel?: 2 | 3 | 4   // default 3 (unchanged output for existing callers)

// src/components/account/AccountPage.tsx
export function AccountPage(props: {
  title: string; subtitle?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode
}): JSX.Element   // h1 + subtitle strip, container ≤1200px, --bg-alt page

// src/components/account/AccountTabs.tsx
export interface AccountTab { id: string; label: string; icon: React.ReactNode }
export function AccountTabs(props: {
  tabs: readonly AccountTab[]; active: string; onChange(id: string): void
  idPrefix: string; children: React.ReactNode   // children = the active panel
}): JSX.Element
// role="tablist" (aria-orientation vertical ≥1024px via CSS only; keys accept both),
// each tab role="tab" aria-selected aria-controls=`${idPrefix}-panel`, roving tabIndex,
// keys via tabKeyTarget; panel role="tabpanel" id=`${idPrefix}-panel` aria-labelledby the active tab.
// ≥1024px: sticky left list; below: horizontally scrolling chips.
```

- [ ] **Step 1: Failing tests.** `focusTrap.test.ts`: `nextFocusIndex(0,3,false)===1`, `(2,3,false)===0`, `(0,3,true)===2`, `(-1,3,false)===0`, `(-1,3,true)===2`, `(0,0,false)===-1`, `(0,1,true)===0`. `tabKeys.test.ts`: ArrowRight and ArrowDown from 0 of 9 → 1; ArrowRight from 8 → 0; ArrowLeft from 0 → 8; ArrowUp from 3 → 2; Home → 0; End → 8; `'a'` → null; `'Enter'` → null.
- [ ] **Step 2:** `npx vitest run src/lib/focusTrap.test.ts src/lib/tabKeys.test.ts` — FAIL (module not found).
- [ ] **Step 3:** Implement both pure functions; run — PASS.
- [ ] **Step 4: Status tones.** `git grep -n "status" -- src/components/OrdersView.tsx src/components/SubscriptionsView.tsx src/components/AccountView.tsx src/lib/refunds.ts src/types.ts` to list every order, subscription, refund, bill and ticket status value. For each not already mapped by `statusTone`, add a test case to `consoleTone.test.ts` first (positive outcomes → success, in-progress/waiting → warning or info as their meaning dictates, failed/cancelled/rejected/overdue → danger, unknown → neutral), run it failing, then add the mapping. Existing cases must still pass.
- [ ] **Step 5:** Build `useFocusTrap`, `Dialog`, `AccountPage`, `AccountTabs`, `account.css`; add `headingLevel` to `BentoCard` (render `h${headingLevel}` with the same class); export `Dialog`, `useFocusTrap` from `ui/index.ts`.
- [ ] **Step 6:** Console `Modal` in `operator/shared.tsx`: keep `ModalProps` and its export exactly; render through `Dialog` so every console modal gains the trap and focus return. Keep its existing `.c-modal` classes on the panel so `.c-modal:has(.pd--compact)` still applies (Dialog accepts a `className` passthrough if needed — add `className?: string` to Dialog's props).
- [ ] **Step 7:** Gates; commit "A shared dialog that keeps focus inside it, and the account page shell and tabs".

### Task 2 (parallel): Orders, Subscriptions, Rewards

**Files:** `src/components/OrdersView.tsx`, `src/components/SubscriptionsView.tsx`, `src/components/RewardsView.tsx`; new `src/styles/account-screens.css` (imported in `main.tsx` after `account.css`).
**Consumes:** `AccountPage`, `Dialog`, `BentoCard` (`headingLevel={2}`), `KpiCard`, `StatusBadge`, `statusTone`.

- Implement spec §A2 for these three screens: each page wrapped in `AccountPage` (title keeps today's wording: "My Orders", "My Subscriptions", the programme name). Orders: card per order (reference, date, `StatusBadge`, total, "View details"), compact item list with thumbnails, existing `Pager`; `OrderDetailModal` rendered in `Dialog wide` with the two-column body; `NetworkFulfilment` kept. Subscriptions: card per subscription, existing actions at 44px, stacked on phone. Rewards: replace the local `StatCard`/`SectionCard` with `KpiCard` and `BentoCard headingLevel={2}` (delete the local copies), 4/2/1 bento for figures, two-column sections ≥1200px, tier progress bar with a text label (e.g. "1,240 of 2,000 points to Gold" from the existing figures).
- Empty states keep their copy.
- Commit: "Orders, subscriptions and rewards as clean account pages".

### Task 3 (parallel): My account

**Files:** `src/components/AccountView.tsx`; the cards it renders only where their markup must change to sit in a `BentoCard` (`WalletCard`, `PrivacyCard`, `AddressBookCard`, `MyNumberCard`, `StockWatchCard`, `MyReviewsCard`, `NotificationPreferencesView`); new `src/styles/account-view.css` (imported after `account-screens.css`).
**Consumes:** `AccountPage`, `AccountTabs`, `Dialog`, `BentoCard`, `StatusBadge`, `statusTone`.

- Implement spec §A2 "My account": `AccountPage title="My account"`, `AccountTabs` with the nine tabs (ids from the existing `Tab` type, labels and icons as today); `initialTab` and `isTab` kept. Replace the local `Card` with `BentoCard headingLevel={2}` (icon kept beside the title) and the local `Modal` with `Dialog` (`PasswordModal`, `MfaModal`, `PaymentsModal`, `SessionsModal`, `AskForRefund`, `TicketDetailModal` keep their contents and handlers). Profile: two-column grid ≥1200px. Activity, Bills, Refunds, Support: tables on desktop, stacked label/value rows below 768px. Security: one settings row per setting with its existing action.
- Delete the local `Card` and `Modal` once unused.
- Commit: "My account with tabs down the side and every window keeping focus".

### Task 4 (parallel): B1 — shared UI and contrast

**Files:** `src/lib/contrast.test.ts`; `src/components/ProductDetail.tsx` (glyph colours only); files with `rgba(0,166,166` or `rgba(0, 166, 166` (`git grep -n "0, \?166, \?166"`) — colours only, never layout; `src/styles/ui.css` (forced-colours headline fallback, `.ui-link` hit area); delete `src/components/Carousel.tsx` and `src/lib/carousel.ts` (+ its test) after `git grep` confirms no importer; new `scripts/contrast-scan.js`.

- Contrast guard (test first): extend `contrast.test.ts` so it also fails on (a) `accentColor`/`catColors` values or other colour constants in `src/lib` and `src/components` that resolve to `--brand-accent` or `#00C6B5` and are used as text colour, and (b) white (`#fff`/`white`/`var(--text-inverse)`) glyph or text colour on a `--brand-accent` / `#00C6B5` background in the same style object. Write the failing assertions against a known current offender first, then fix the offenders.
- Old teal tints → `rgba(0, 198, 181, a)` (the current `--brand-accent`) with the same alpha.
- `@media (forced-colors: active)`: the gradient headline class gets `background: none; color: CanvasText; -webkit-text-fill-color: CanvasText`.
- `.ui-link`: `min-height: 24px; display: inline-flex; align-items: center` (or padding giving ≥24px), no visual shift.
- `scripts/contrast-scan.js`: the in-browser scanner (walks visible text nodes, resolves effective foreground/background including ancestor backgrounds and opacity, computes WCAG ratio, thresholds 4.5 / 3 for ≥24px or ≥18.66px bold, returns `{ checked, failures: [{ text, ratio, fg, bg, selector }] }`). Header comment: how to paste it into DevTools or pass it to the browser tool.
- Commit: "Teal glyphs and old tints brought to contrast, a guard that sees colour props, and the contrast scanner kept as a script".

### Task 5 (parallel): B2 — public and commerce

**Files:** the public header / Discover panel and mobile menu component (find with `git grep -n "Discover" -- src/components/public`), `src/components/ui/CategoryTile.tsx` and its consumer caller, `src/lib/moneyRepo.ts` (+ new `src/lib/moneyRepo.test.ts` for a pure helper), the consumers of `loadPriceBook`/`loadCopyBook` that show the market message, the enterprise Marketplace filter (`src/components/enterprise/EnterpriseBrowse.tsx`), `src/components/ProductDetail.tsx` ("Notify me" line only — Task 4 touches only its glyph colours; keep edits to separate lines), `src/components/CartDrawer.tsx` (stepper), `src/components/enterprise/RequisitionPanel.tsx` (trap).
**Consumes:** `useFocusTrap`.

- Escape: the inner layer handles Escape and calls `stopPropagation`; the mobile menu only closes when no inner layer is open.
- `CategoryTile` gets optional `description?: string`; consumer tiles pass the category blurb they had before spec 2.
- moneyRepo (test first): add `export type Loaded<T> = { ok: true; value: T } | { ok: false; error: string }` and `export function settle<T>(data: T | null, error: { message: string } | null, empty: T): Loaded<T>` (pure; tested: error → `ok:false` with message; null data no error → `ok:true` with `empty`; data → `ok:true` with data). `loadPriceBook`/`loadCopyBook` keep their signatures and also gain `loadPriceBookResult`/`loadCopyBookResult` returning `Loaded<…>`; the shop surfaces that show "nothing priced for your market" switch to the result versions and render "We couldn't load prices just now." with a Retry button on `ok:false`.
- Enterprise filter verticals derived from the loaded listings (distinct, in first-seen order), not the hardcoded iot/security/device list.
- "Notify me when available" opens the existing `NotifyMeModal` with the same props its other caller uses.
- Cart stepper buttons 44×44.
- Requisition drawer: `useFocusTrap(panelRef, open)`; Escape already closes — keep.
- Commit: "Escape closes one layer at a time, a failed price read says so, and the shop's last touch-target and focus gaps closed".

### Task 6 (parallel): B3 — consoles

**Files:** `src/components/operator/OperatorShell.tsx`, `OperatorDashboard.tsx`, `OperatorAccounts.tsx`, `src/lib/accounts.ts` (+ test), `src/components/enterprise/EnterpriseListingModal.tsx`, `src/components/partner/PartnerDashboard.tsx`, `src/styles/console.css`, `console-operator.css`, `console-accounts.css`, `console-partner-enterprise.css`.

- Operator nav: in `toggleGroup`, a group holding the active view does not toggle; its header gets `aria-disabled="true"` and a visually hidden "(open — contains the current page)"; `aria-controls` only rendered while the panel is mounted. Brand `alt` = "6D Technologies" as in the other shells; mobile close button `aria-label="Close menu"`; correct the nav-order comment at lines 24–27.
- Quick actions spans the full row when there are no alerts.
- Accounts (test first): add no-steps and due-today cases to `accounts.test.ts`; make the Waiting chip and every chip count respect the search text (counts computed on the searched list).
- Listing modal: headings consistent (one h2 title, h3 sections); buy panel `position: sticky; top: 0` on ≥1024px; "Add to requisition" disabled when out of stock via `cardAction` from `src/lib/storefront.ts`.
- Console CSS: hairline `1px solid var(--border-light)` on `.c-stat` and `.c-section`; row hover rule does not override rows with an inline background (scope hover to rows without the highlight class/attribute — read how the highlight is applied); disabled `danger`/`success` buttons keep a tinted version of their tone with readable text (≥4.5:1).
- PartnerDashboard "Settlement Due": add the text that states what the colour meant.
- Commit: "The consoles' leftover review points: nav, quick actions, account chips, listing window and button states".

### Task 7: Validation sweep (controller)

Merge Tasks 2–6 (resolve only `main.tsx` import lines by keeping all). Then, on `127.0.0.1` dev server:

- Contrast: run `scripts/contrast-scan.js` on every screen of all five experiences at 1280, 1024 and 390 (iframes for the narrower widths). Bar: 0 failures.
- Keyboard: Tab order, visible focus, Escape and focus return on every dialog, drawer, menu, tab list and chip group.
- Phone: `document.documentElement.scrollWidth <= innerWidth` at 390 on every screen; touch targets ≥44px on account and cart, ≥24px elsewhere.
- Reduced motion: emulate and confirm no animation.
- Market switch India → Kenya with a basket line: line and its currency kept (remove the basket line afterwards).
- `npm run test:integration` vs main's baseline (13).
- Record each finding in the ledger.

### Task 8: Fix wave

One fix dispatch for Task 7's findings, one scoped re-review, re-check the touched screens.

### Task 9: Docs

README Design system: `AccountPage`, `AccountTabs`, `Dialog`/`useFocusTrap`, `BentoCard headingLevel`, `scripts/contrast-scan.js`, the price-read error state. Backlog: spec 5 done; carried-over sections emptied; only the five enterprise features and the data checks remain; report SKU-7011 and the seed drift to the user.
