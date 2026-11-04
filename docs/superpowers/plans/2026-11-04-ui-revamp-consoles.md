# UI revamp, spec 3 — workspace consoles — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Move the operator, partner and enterprise consoles onto the Aventa look by restyling their shared components and sidebars, then redesign the operator dashboard, the operator navigation and Business Accounts.

**Architecture:** Task 1 restyles `src/components/operator/shared.tsx` in place (props unchanged) — every console screen follows. Tasks 2–4 run in parallel worktrees, each with its own stylesheet, and are merged by the controller.

**Spec:** `docs/superpowers/specs/2026-11-04-ui-revamp-consoles-design.md`

## Global Constraints

- No functional change: every route, view id, handler, data read, permission check and badge kept. No invented data, metrics or capabilities.
- No new dependencies. No database change.
- WCAG 2.2 AA (4.5:1 small text, 3:1 large text/UI); `src/lib/contrast.test.ts` stays green, including its guard against `color: var(--brand-accent)` in `.tsx`.
- Operational screens: light workspace, white panels, navy sidebar — no gradients, globe or glow.
- Reduced motion respected.
- Keep the explanatory comments in files you restructure.
- Gates per task: `npx vitest run` (only `gateway.test.ts` financingProblem and `partnerApplication.test.ts` '02 Aug 2026' may fail) and `npm run build`.
- Commits: plain-English subject saying what changed and why, short body, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Stage only files you changed; never force-add ignored files.

---

### Task 1: Restyle the shared console components

**Files:** `src/components/operator/shared.tsx`; new `src/styles/console.css` imported in `src/main.tsx` after `ui.css`.

Implement spec §1 exactly. Rules:
- Every export keeps its name, props and behaviour; callers must compile unchanged. `Btn` gains only an optional `variant: 'accent'`.
- Move presentation into classes in `console.css` (`.c-stat`, `.c-section`, `.c-table`, `.c-btn`, `.c-modal`, `.c-field`, `.c-empty` …) rather than inline styles where hover/focus/breakpoints are involved; inline styles that read props (e.g. `--cell-pad`) may stay.
- `StatCard`'s `color` prop: render as an 8px dot before the label (`aria-hidden`), number stays `--text`. Check every `color=` passed today (`git grep -n "StatCard" -- src`) still conveys meaning through its sublabel text.
- `StatusPill`/`PriorityPill`: map statuses to `StatusBadge` tones; read the existing maps and keep every listed status; add a test in a new `src/lib/consoleTone.ts` + `.test.ts` for the mapping function (`statusTone(status: string): 'success'|'warning'|'danger'|'info'|'neutral'`) — test first.
- Tokens available: `--radius-card`, `--shadow-card`, `--shadow-xl`, `--border-strong`, `--border-light`, `--bg-alt`, `--text`, `--text-secondary`, `--electric`, `--cyan`, `--brand-navy`, `--success/-bg`, `--warning/-bg`, `--danger/-bg`, `--info/-bg`.
- Commit: "The consoles' shared parts in the new look: cards, tables, pills, buttons and forms".

### Task 2 (parallel): Operator sidebar and dashboard

**Files:** `src/components/operator/OperatorShell.tsx`, `src/components/operator/OperatorDashboard.tsx`; CSS in new `src/styles/console-operator.css` imported after `console.css`.

- Sidebar per spec §2: the Operations split into Partners & accounts / Commerce / Finance / Service (items, order and ids exactly as listed in the spec; Dashboard stays alone in Overview), collapsible group headers (`<button aria-expanded>`), group with the active view forced open, cyan active indicator, Aventa wordmark beside the 6D mark (`AventaWordmark` from `src/components/ui`).
- Dashboard per spec §3. Quick actions link only to existing view ids (`op-catalogue`, `op-settlement`, `op-tickets`, `op-onboarding`) through the existing navigation prop.
- Commit: "The operator console's sidebar in groups you can find things in, and a dashboard laid out as a grid".

### Task 3 (parallel): Business Accounts

**Files:** `src/components/operator/OperatorAccounts.tsx`; pure filter logic in `src/lib/accounts.ts` (exists — read it) with tests in its test file; CSS in new `src/styles/console-accounts.css`.

- Status chips per spec §4 as a `role="radiogroup"` of buttons with `aria-pressed`/`aria-checked`; predicates reuse whatever the summary totals use (read the `totals` computation; extract a tested `accountBand(account, steps, today)` or reuse an existing one). Test first.
- Commit: "Business accounts you can narrow by where they stand".

### Task 4 (parallel): Partner and enterprise consoles

**Files:** `src/components/partner/PartnerShell.tsx`, `PartnerDashboard.tsx`, `src/components/enterprise/EnterpriseShell.tsx`, `EnterpriseDashboard.tsx`, `EnterpriseListingModal.tsx`; CSS in new `src/styles/console-partner-enterprise.css`.

- Sidebars per spec §2 (no regrouping). Dashboards per spec §5. `EnterpriseListingModal` per spec §5 — reuse classes from `src/styles/product-detail.css` (`.pd`, `.pd__media`, `.pd__buy`, `.pd-acc`) where they fit; same fields and `onAdd` behaviour.
- Commit: "The partner and enterprise consoles in the same look, and the business listing as a product page".

### Task 5: Browser pass (controller)

All three consoles at 1280 and 390: dashboard, two dense tables, one modal, one form; programmatic contrast scan; keyboard on sidebar groups and chips; integration suite vs main.

### Task 6: Docs

README Design system: the console components and `Btn variant="accent"`, the operator nav groups. Backlog: spec 3 → done at merge; spec 5 (validation sweep) remains; remove the EnterpriseListingModal item.
