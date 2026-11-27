# Spec 16 — design system v2 — plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a premium, consistent enterprise look (Direction A, balanced density) delivered through tokens and the
shared components, so every screen improves without any feature change.

**Architecture:** new tokens in `src/styles/global.css` with the old names aliased onto them; shared components
(`src/components/operator/shared.tsx`, `src/components/ui/*`, `src/styles/console.css`, `src/styles/ui.css`)
upgraded in place with unchanged props; a few new components (Dropdown inside `Select`, Toggle, Tabs, Drawer,
Skeleton, Spinner); a `/design-system` reference page; a guardrail test.

**Tech Stack:** React 18, TypeScript, plain CSS custom properties, Vitest + Testing Library. No new dependencies.

Spec: `docs/superpowers/specs/2026-11-26-design-system-v2-design.md` (decisions 1–6 and §1–§4 bind). Branch `design-system-v2`.

## Global Constraints

- **Visual only.** No feature, workflow, route, API, data or copy change. Props of existing shared components stay compatible; every existing caller keeps working unedited.
- Palette (exact): `--ink-900 #0B1220`, `--ink-800 #0F172A`, `--slate-600 #475569`, `--slate-500 #64748B`, `--slate-300 #CBD5E1`, `--slate-200 #E2E8F0`, `--slate-100 #F1F5F9`, `--canvas #F5F7FA`, `--surface #FFFFFF`, `--indigo-600 #4F46E5`, `--indigo-700 #4338CA`, `--indigo-50 #EEF2FF`, `--teal-700 #0F766E`. Where a value fails the contrast test for its role (small text ≥ 4.5:1; control borders and focus ≥ 3:1), darken that value and say so in a comment — never weaken the test.
- Type: title 24px/650/-0.02em; section 16/600; card 14/600; body 14/400; table 13; meta 12; KPI 24/650 tabular. Inter only. Numbers and money `font-variant-numeric: tabular-nums`.
- Density: controls 40px (`sm` buttons 32px), table header 40px, rows 48px, row actions 32px. Radius: controls 6px, cards 8px, pills only for avatars/counters. Spacing on the 4px scale.
- Motion 150–200ms; zero under `prefers-reduced-motion: reduce`. Focus ring: 3px `rgba(79,70,229,.18)` plus indigo border; visible on keyboard focus everywhere.
- Status never by colour alone: dot + text.
- No new runtime dependency. Pure modules never import `supabase`; unit/DOM tests reaching `src/lib/supabase.ts` must `vi.mock` it.
- Gates per task: `npx vitest run` (only `gateway.test.ts` financingProblem and `partnerApplication.test.ts` '02 Aug 2026' may fail locally; run from the worktree root), `npx tsc --noEmit`, `npm run build`. Tests that asserted old visuals (e.g. a 44px height, a class name) may be updated to the new values; tests of behaviour must not be weakened.
- Commits: plain-English subject, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Tokens v2
**Files:** `src/styles/global.css`, `src/lib/contrast.test.ts` (and `src/lib/contrast.ts` only if it needs new token reading).
- [ ] Add the palette, type, shape, density, shadow (`--shadow-card`, `--shadow-popover`, `--shadow-modal`) and motion tokens from the spec. Map the old names onto the new values (e.g. `--brand-navy`→ink, `--electric`/focus→indigo, `--bg-alt`→canvas, `--border`→slate-200, `--border-strong`→the control-border value, `--text`→ink-800, `--text-secondary`→slate-600, `--text-tertiary`→a meta value that passes AA on canvas and on status tints, `--radius`→6px, `--radius-md`/`--radius-card`→8px, `--cyan` primary fill → indigo, semantic colours refined with `-bg`/`-border`), keeping every old name defined.
- [ ] `prefers-reduced-motion` sets the duration tokens to 0ms and disables transitions/animations globally.
- [ ] Contrast test covers the new pairs (text on surface/canvas/tints, indigo on white, white on indigo, control border on surface/canvas, focus ring).
- [ ] Gates; commit "Design tokens v2: midnight and indigo, balanced density, with the old names kept".

### Task 2: Buttons, inputs, checkbox, toggle, spinner
**Files:** `src/styles/console.css`, `src/styles/ui.css`, `src/styles/global.css` (form-control base), `src/components/operator/shared.tsx` (`Btn`, `TextInput`, `TextArea`), new `src/components/ui/Toggle.tsx`, `src/components/ui/Spinner.tsx` (+ DOM test for Toggle).
- [ ] Buttons per spec §2 (primary, secondary, tertiary, danger, icon, loading via an optional `loading` prop, disabled); 40px / `sm` 32px; storefront button classes brought onto the same tokens.
- [ ] Inputs 40px, error (`aria-invalid="true"`) and hint styles, search-with-icon pattern class.
- [ ] Native checkbox and radio restyled (custom appearance, indigo checked state, visible focus, forced-colors fallback); `Toggle` (`role="switch"`, `aria-checked`, Space/Enter).
- [ ] Gates; commit.

### Task 3: The dropdown
**Files:** new `src/components/ui/Dropdown.tsx`, `src/components/ui/Dropdown.dom.test.tsx`; `src/components/operator/shared.tsx` (`Select` renders Dropdown); `src/styles/ui.css`.
- [ ] `Select` keeps its props (`React.SelectHTMLAttributes<HTMLSelectElement>`: `value`, `defaultValue`, `onChange`, `disabled`, `id`, `name`, `aria-*`, `style`, `className`, children `<option>`/`<optgroup>`), parses option children (value, label, disabled, optgroup label), and calls `onChange` with an object whose `target.value` (and `currentTarget.value`) is the chosen value. A `<label htmlFor>` still focuses it; `FormField` wiring keeps working.
- [ ] ARIA: button with `role="combobox"`, `aria-expanded`, `aria-controls`, `aria-activedescendant`; popup `role="listbox"`, options `role="option"` with `aria-selected`. Keyboard: Enter/Space/ArrowDown/ArrowUp open; arrows move; Home/End; type-ahead; Enter selects; Escape closes and returns focus; Tab closes. A search box (filters options, keeps keyboard nav) when there are more than 8 options. Closes on outside click. The popup is positioned below (or above when no room), within the viewport, `--shadow-popover`, 8px radius.
- [ ] DOM tests: mouse select fires onChange with `target.value`; keyboard open/move/select; type-ahead; Escape restores focus; search filters; disabled option skipped; disabled control does not open; optgroup labels render; label click focuses.
- [ ] Run the full suite: any existing test that drove a native select (`fireEvent.change(select, …)`) is updated to drive the new control (or `Select` exposes a hidden native mirror if that keeps many tests simpler — implementer's call, documented). Gates; commit.

### Task 4: Table, status, KPI, alerts, empty state, skeleton
**Files:** `src/components/operator/shared.tsx` (`Table`, `Td`, `StatusPill`, `EmptyState`, toast), `src/components/ui/StatusBadge.tsx`, `src/components/ui/KpiCard.tsx`, `src/components/OnboardingJourney.tsx` (`Callout`, if that is where it lives), new `src/components/ui/Skeleton.tsx`, CSS in `console.css`/`ui.css`; DOM test for sortable table.
- [ ] Table per spec §2 (header 40px uppercase 11px, rows 48px, separators only, hover, optional selected rows via a prop, sticky header inside `.c-table-wrap`, tabular numbers right-aligned; header entries may carry `sort: { active: boolean; dir: 'asc'|'desc'; onSort: () => void }` rendered as a button with `aria-sort`).
- [ ] StatusBadge/StatusPill: dot + text, no filled pill; existing tones map onto it.
- [ ] KpiCard: label row, value (KPI type), context line; optional `variant: 'money'|'ops'|'risk'` and optional `series: number[]` sparkline (inline SVG); unchanged callers render as today's information.
- [ ] Callout/alerts and toasts: info subtle, warning amber, critical red with a 3px left rule; icon + bold lead.
- [ ] EmptyState refreshed; Skeleton (lines/blocks, shimmer off under reduced motion).
- [ ] Gates; commit.

### Task 5: Dialog, Drawer, Tabs
**Files:** `src/components/ui/Dialog.tsx`, new `src/components/ui/Drawer.tsx`, new `src/components/ui/Tabs.tsx` (+ DOM tests), CSS.
- [ ] Dialog: padding, title + optional description, actions right, overlay `rgba(11,18,32,.45)`, close control consistent; `Modal` unchanged API.
- [ ] Drawer: right panel, width `min(480px, 100vw)`, same focus trap/Escape/backdrop as Dialog.
- [ ] Tabs: `role="tablist"`, arrow-key movement, `aria-selected`, underline indicator in indigo; controlled API `{ tabs: {id,label,count?}[]; value; onChange }`. Not yet adopted by screens (wave 3).
- [ ] Gates; commit.

### Task 6: Reference page and guardrail
**Files:** new `src/components/DesignSystemPage.tsx`, route `/design-system` in the app router (outside every console's navigation, no auth needed, no data), new `src/lib/designGuardrail.test.ts` with `src/lib/designGuardrail.baseline.json`; README section.
- [ ] Page: tokens (swatches with names and contrast), type scale, every component in every state (buttons, inputs incl. error, Dropdown incl. search, checkbox, Toggle, Tabs, Table incl. sort/selected, Status, KPI variants, Callouts, toast trigger, Dialog and Drawer triggers, Skeleton, EmptyState). Uses only the real components.
- [ ] Guardrail: scan `src/components/**/*.tsx` (excluding tests and `DesignSystemPage.tsx`) for `fontSize: '<n>px'`, hex colour literals, and `borderRadius:` values not using `var(--radius`; compare counts to the baseline JSON; fail if any count rises; print how to lower the baseline.
- [ ] Gates; commit.

### Task 7 (controller): Browser check, docs, merge
- [ ] Dev server; check at 1280 and 390: operator dashboard, operator Orders (table), Shelves & Rules (form), shopper `/retail`, checkout; keyboard through a dropdown; reduced motion. Fix only regressions (back to the implementer).
- [ ] README (design system section, `/design-system`), backlog (wave 1 done; waves 2–6 listed), memory; final review; merge `--no-ff`; push; CI.
