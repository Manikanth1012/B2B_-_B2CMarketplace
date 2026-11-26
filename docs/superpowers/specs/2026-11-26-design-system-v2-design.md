# Spec 16 — design system v2 (wave 1 of the enterprise UI modernization)

Date: 2026-11-26 · Status: design approved by the user (2026-11-26), chosen in the visual companion
(`.superpowers/brainstorm/887-1795700545/content/visual-direction.html`, `components-a.html`).

The user asked for an enterprise-grade modernization of the whole UI (references: Stripe, Linear, Ramp, Vercel),
visual only — **every feature, workflow, route, API and data contract stays as it is**. Sequenced as waves
(user's choice): **1 design system v2 (this spec)** → 2 console shell and navigation → 3 operator screens →
4 partner and enterprise consoles → 5 shopper storefront → 6 charts. Built by **extending the existing CSS-token
system** (user's choice): no Tailwind, shadcn, Radix, Recharts or TanStack; no new runtime dependency.

Standing rule (user, 2026-11-26): every screen uses the shared design system; no one-off visual styles.

## Decisions

| # | Question | Decision |
|---|---|---|
| 1 | Visual direction | **A · Midnight & Indigo** (user's choice): midnight navy chrome, indigo for interaction, teal for positive signals, slate neutrals on a cool grey canvas |
| 2 | Density | **Balanced** (user's choice): 40px buttons/inputs/dropdowns, 48px table rows, 40px table header, 32px row actions. Clears WCAG 2.2 AA target size (24px); replaces the app's former 44px-everywhere rule |
| 3 | Libraries | None added (user's choice). Custom dropdown, tabs, drawer and skeleton are built in-house with full keyboard support |
| 4 | How the change lands | Shared components keep their props and are upgraded in place, so every screen improves at once; existing token names stay as aliases of the new values |
| 5 | Inline styles in screens | Not touched in wave 1 (≈5,600 blocks). Each later wave migrates its screens; a guardrail test stops the count from rising |
| 6 | Reference | A standalone `/design-system` page, outside every console's navigation, showing each component in each state |

## 1. Tokens (`src/styles/global.css`)

Colour (new names; old names mapped onto them):

| Token | Value | Use |
|---|---|---|
| `--ink-900` | `#0B1220` | Console chrome, sidebar |
| `--ink-800` | `#0F172A` | Primary text |
| `--slate-600` | `#475569` | Secondary text |
| `--slate-500` | `#64748B` | Metadata, table headers (check AA on every surface; darken if the contrast test fails) |
| `--slate-300` | `#CBD5E1` | Control borders (≥3:1 for 1.4.11 must hold — use a darker value if the test needs it) |
| `--slate-200` | `#E2E8F0` | Card and table borders |
| `--slate-100` | `#F1F5F9` | Row separators, hover |
| `--canvas` | `#F5F7FA` | Page background |
| `--surface` | `#FFFFFF` | Cards, tables, inputs |
| `--indigo-600` | `#4F46E5` | Primary button, focus ring, selected tab |
| `--indigo-700` | `#4338CA` | Links, tertiary buttons, selected option text, primary hover |
| `--indigo-50` | `#EEF2FF` | Selected row, selected option background |
| `--teal-700` | `#0F766E` | Positive deltas and signals |
| `--success` / `--warning` / `--danger` / `--info` | refined green / amber / muted red / blue, each with a `-bg` and `-border`, AA on white and on their tint |

Type: `--fs-title 24px/650/-0.02em`, `--fs-section 16px/600`, `--fs-card 14px/600`, `--fs-body 14px/400`,
`--fs-table 13px`, `--fs-meta 12px`, `--fs-kpi 24px/650 tabular`. One family: Inter.

Shape and space: `--radius-control 6px`, `--radius-card 8px`, `--radius-pill` only for avatars and counters;
spacing stays on the existing 4px scale; `--control-h 40px`, `--row-h 48px`, `--head-h 40px`, `--row-action 32px`.
Shadows: `--shadow-card` (1px, very soft), `--shadow-popover` (dropdowns, menus), `--shadow-modal`. Motion:
`--ease`, `--dur-fast 150ms`, `--dur 200ms`, all set to 0 under `prefers-reduced-motion: reduce`.

## 2. Shared components (same props, upgraded in place)

- **Buttons** (`Btn`, `.c-btn`, storefront buttons): primary (indigo, white text), secondary (white, slate border),
  tertiary (no fill, indigo text), danger (white, red text and border; solid red only inside a confirm dialog), icon
  (square), loading (spinner + label, disabled), disabled. 40px; `sm` 32px for table actions. 6px radius; no pills.
- **Inputs** (`TextInput`, `TextArea`, `.c-input`): 40px, slate border, indigo focus ring, error state with message,
  hint text; search inputs with a leading icon.
- **Dropdown** (`Select`): a custom listbox with the same API (children `<option>`/`<optgroup>`, `value`,
  `onChange` receiving `{ target: { value } }`, `disabled`, `aria-*`, `id`). Keyboard: Enter/Space/Arrow to open,
  arrows to move, Home/End, type-ahead, Enter to choose, Escape to close, Tab leaves. A search box appears when there
  are more than 8 options. ARIA combobox/listbox pattern. Native `<select>`s elsewhere keep the global restyle.
- **Checkbox and toggle**: styled native inputs (keeps forms and labels working); a `Toggle` component for on/off
  settings.
- **Table** (`Table`, `Td`): 40px uppercase 11px header on `--slate-50`, 48px rows, 1px separators (no cell
  borders), hover and optional selected rows, numbers right-aligned and tabular, sticky header inside its scroll
  area, optional sortable columns (`headers` entries may carry `sort`), compact 32px row actions.
- **Status** (`StatusBadge`, `StatusPill`): coloured dot + text, no filled pill; the text always says the state.
- **KPI** (`KpiCard`): label row, value, context line; variants money / operational / risk; sparkline only when the
  caller passes a series.
- **Alerts** (`Callout`, toasts): info subtle (grey), warning amber, critical red with a left rule; icon + bold lead.
- **Dialog** (`Dialog`/`Modal`): consistent padding, title + description, actions right, subtle overlay; new
  **Drawer** (right side panel, same focus trap).
- **New**: `Tabs` (underline, keyboard arrows), `Skeleton`, refreshed `EmptyState`, `Spinner`.

## 3. Reference page and guardrail

- `/design-system`: every component above in every state, built from the real components; linked from nowhere in
  the consoles; noted in the README.
- A Vitest "design guardrail": counts hard-coded `fontSize: 'NNpx'`, hex colours and non-token `borderRadius` in
  `src/components/**/*.tsx`; fails if any count exceeds a committed baseline. Later waves lower the baseline.

## 4. Testing

Contrast test extended to the new tokens; DOM tests for Dropdown (mouse, keyboard, type-ahead, search, onChange
shape, disabled), Tabs, Drawer, Toggle, sortable Table; existing tests unchanged in intent (selectors may change from
native select to the new control — adjust tests, never features). Browser check at 1280 and 390 of: operator
dashboard, an operator table screen, a form-heavy screen, the shopper retail page, checkout.
