# Enterprise Self-Care — persona prototypes

Working HTML for every persona in the Enterprise Self-Care PRD, built to the **nim-ui-design-system-v2** visual contract and populated with one consistent synthetic account.

Open `index.html` and pick a persona. Every file is self-contained — no server, no build step, no network dependency except the Poppins webfont, which falls back to system sans-serif offline.

| File | Persona | Scope | Screens |
|---|---|---|---|
| `admin.html` | Anneke Visser — Enterprise admin | Whole account | 19 |
| `user.html` | Joost Bakker — Enterprise user | Own line only | 9 |
| `team-lead.html` | Ruben Oyelaran — Team leader | Own team + own line | 9 |
| `operator.html` | Lena Fischer — Operator admin | Self-care surface only | 9 |

---

## Source of truth

Screens were derived from two documents, not invented:

- **Enterprise Self-Care PRD** (Shivangi Mohite) — product definition, the four personas, registration/login flow logic, business rules, and the operator scope boundary.
- **`[CANVAS - Selfcare] UI/UX Delivery Tracker`** — the agreed feature list. All 36 rows are built: 19 Enterprise Admin, 10 Enterprise User, 7 Team Leader. The Operator Admin surface comes from PRD §2 and §5, which define it as self-care monitoring only.

The PRD's configurable parameters appear where they belong rather than as filler: the 1-minute OTP window, 30-second resend cooldown, 3 resends, 5 verification attempts and 30-minute idle timeout are all on the admin **Roles and access** screen.

---

## The demo account

One dataset, generated deterministically and shared by all four files, so every number reconciles across personas.

- **Meridian Logistics Group** (`ENT-100482`), a Rotterdam logistics enterprise on **Kestrel Telecom** — a fictional white-label operator
- 148 identities · 145 billable lines · 6 teams mapped to cost centres
- 26 connectivity sites — 18 SD-WAN, 8 MPLS — of which 1 is down and 5 degraded
- 3 shared data pools; the field operations pool sits at 93.9%
- 12 cycles of usage and billing history; 1 invoice overdue, balance €23,540
- 34 tickets, 81% resolved within SLA, MTTR 11h 6m

All synthetic. No real customer, user, usage or billing records.

---

## Where the design contract shows up

**Missing data is declared, never invented.** This is the contract rule most prototypes quietly break, so it is deliberately visible:

- Two sites (Porto, Ghent) stopped reporting on 18 Jul — utilisation, latency and loss render as *Not measured* with a hatched meter, and the resulting €1,840 of roaming charges sits in an **unattributed** bucket in cost allocation rather than being spread by estimate.
- Six telematics lines in the fleet team have no record since the same date. Team totals exclude them and label them, rather than counting them as zero.
- One usage record fell outside the 12-month retention window, so August 2025 is a gap in the trend line with a legend entry explaining why.
- The operator's adoption view leaves one account blank instead of reporting 0% — no sessions recorded and no engagement are different claims.

**Scope is enforced, not decorated.** Each file only holds what that role may see. The operator view refuses payment, plan changes and user administration with a hand-off card naming where the capability actually lives — the Enterprise CRM, the enterprise admin, or the team leader — rather than a permissions error.

**Lifecycle actions carry impact context.** Deactivating a user, swapping a SIM on a stolen device, paying an invoice, allocating a pool top-up and approving a team request each state what changes, what it costs, who gets notified and what cannot be undone. The two highest-risk actions require typing a confirmation word before the button becomes live.

**State never depends on colour alone.** Status pills carry a glyph, capacity meters carry a diagonal pattern above 75% and 90%, chart gaps are hatched, and topology links differ by dash style. The screens survive a monochrome projector.

**AI is confined and sourced.** Orange appears only on AI surfaces and never as a filled CTA. Every insight carries a confidence label — including *Low confidence — partial evidence* where the data genuinely does not support a conclusion. Every assistant answer cites which record sets it read, and says plainly when the evidence is not there instead of guessing.

**Accessibility.** Skip link, semantic landmarks, keyboard-operable sortable headers, focus trapping in dialogs, focus restoration on close, `prefers-reduced-motion` honoured, ARIA live regions on toasts, accessible names on every icon-only control. Layout validated at 1920, 1440, 1280 and 1024 with no overlap, clipping or horizontal overflow.

---

## Two deliberate deviations, for UI-1 sign-off

The contract requires WCAG 2.2 AA. Two canonical values do not reach it as text backgrounds, so the implementation adjusts *usage* while leaving the tokens intact:

1. **Primary buttons fill with `--nim-primary-600` (#0578BE), not `--nim-primary-500`.** White on `primary-500` measures 3.00:1 against a 4.5:1 requirement; on `primary-600` it measures 4.73:1. `primary-500` keeps its contract role as the link, selection and focus-ring colour, where it is used on tints and borders rather than behind text.
2. **The AI assistant control is an outlined orange button, not a filled one.** White on `--nim-ai-orange-500` measures 2.92:1. The control now uses a white surface, an orange border and orange-derived text at 7.62:1 — which also keeps orange from acting as a filled CTA, something the contract explicitly forbids.

Every semantic state token (danger, warning, success, informational, stale, partial, unavailable) clears AA on its own surface at 5.6:1 or better as specified.

---

## The 6D mark

The official logo renders only from the approved asset at `assets/brand/6d-logo-white.png`. It is never reconstructed in text, CSS or SVG. The asset is not bundled here, so the slot is empty and the product wordmark carries identification. Drop the approved PNG into `assets/brand/` next to the HTML files and it appears in the rail, the cover and the closing surfaces without any code change.

---

## Rebuilding

`_src/` holds the editable source. Each persona HTML is assembled by inlining the shared layers:

```
_src/core.css          6D ONE UI design system — tokens, shell, tables, states
_src/icons.js          Lucide icon set, inlined (ISC)
_src/core.js           App shell, router, DataTable, charts, dialogs, AI assistant
_src/data.js           Seeded synthetic dataset shared by all personas
_src/shared_views.js   Cross-persona helpers, ticket and invoice inspectors
_src/views_*.js        Per-persona screens
```

```bash
python3 _src/build.py          # rebuild all four HTML files
node _src/smoke.js admin.html  # walk every screen, exercise every control, fail on any JS error
```

The smoke test loads a persona under jsdom, visits every nav item, drives every table's sort, search, filter and pagination, clicks every dialog trigger, sends every AI suggestion, and exercises the global search including its empty state. It requires `npm install jsdom`.

---

## Suggested companions

If this goes in front of a customer or an analyst, the natural next artefacts are a **screen-by-screen click-through script** tying each screen to its tracker row, a **UI-1 visual baseline pack** capturing each screen at the four approved viewports for sign-off, and a **TMF Open API mapping** binding these screens to TMF629/632/637/666/676/678 so the prototype doubles as an integration brief.
