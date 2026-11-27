# Spec 18 — alignment sweep, dashboards and charts (UI waves 3 and 6, pulled forward)

Date: 2026-11-27 · Status: requested by the user with screenshots (Settlement Statements, Find a unit, dashboard
charts: "tables not properly aligned … dashboards look very rudimentary"); ordering chosen by the user (this, then GDPR
masking, then reports). Visual only: no feature, workflow, data or copy change. Builds on spec 16 (design system v2);
the standing rule applies — reuse shared components, add to them rather than styling a page.

## The rules (enforced in shared components, then applied screen by screen)

| # | Rule | Where |
|---|---|---|
| 1 | Only numbers, money, percentages and counts are right-aligned (`Td right`, tabular). Text — periods, names, statuses, dates as text — is left-aligned. Status cells are left, never `right`. | `Td`, every table |
| 2 | Header alignment always equals its cells' (inferred or explicit); a header is never right while its cells are left. | `Table` |
| 3 | Short identifiers, statuses, money and dates never wrap (`nowrap`); names may wrap at most to two lines, with a sensible min width; long text columns take the remaining width. | `Td` props: `nowrap`, `clamp={2}` |
| 4 | An actions column has a visually hidden header ("Actions") and right-aligned, compact (32px) buttons on one line; overflow goes into a "More" menu when there are more than two. | `Table`, a shared `RowActions` |
| 5 | Filter and search bars are one line, one height (40px), via a shared `FilterBar` (search grows, filters fixed width, actions at the end, wraps only on narrow screens). | new `FilterBar` |
| 6 | A field and its button on one row line up: `FormField` gets a `compact` (no bottom margin) mode and an inline `FieldRow`; buttons next to inputs are the 40px size, not `sm`. | `FormField`, new `FieldRow` |
| 7 | One type size per table row; secondary text by colour (`--slate-600`), never by shrinking below 12px. | every table |
| 8 | Page header pattern: title, one-line description, primary action right; tabs use the shared `Tabs`. | every screen |
| 9 | KPI cards: never several currencies joined into one value. The headline is the largest currency (or a converted total marked "≈ in USD" only where rates are already loaded); other currencies are a compact list below (code left, amount right, tabular); a one-line context at the foot. Cards in a row share one height, the label and value sit at the same place, one value size. Counts carry a short status line instead of a bare number. (User screenshot: the Credit screen's "Owed and committed" card.) | `KpiCard` (`breakdown` prop), every KPI row |

## Filtering on log and list screens

Every log or list screen gets the shared `FilterBar` with the filters its data supports (user screenshot: Scheduled
jobs has none). Scheduled jobs: date range (from/to, quick 7/14/30 nights; the repo reads up to 90 days instead of
15), job (multi-select of the ten), status (all / OK / failed) and a "Failures only" toggle; the health line stays
about the latest night; the list says how many nights and runs match. During the sweep, check the audit trail,
notifications log, dunning, settlements and tickets for the same gap and give each the filters its data supports
(filtering only — no new data, no changed behaviour).

## Dashboards and charts

- **Charts** (`src/components/operator/charts.tsx` grows into `src/components/ui/charts/`): Column/Bar (vertical
  and horizontal ranking), Line/Area (trend), Donut (proportion), Sparkline. Common: a restrained categorical palette
  built from the tokens (indigo, teal, slate-blue, amber, rose, slate — at most 6, the same category always the same
  colour across the app), light gridlines, labelled axes with formatted ticks, hover tooltips (keyboard focusable
  points), a legend only when there is more than one series, an accessible summary (`<figure>` + `figcaption`/`aria`
  table fallback), no animation under reduced motion. Never two units on one axis.
- **Operator dashboard**: a clear header (title, period selector if the data supports it), a top row of the 4 most
  important KPIs (money/ops/risk variants with real deltas only), "needs attention" (exceptions: SLA breaches, held
  orders, overdue invoices, pending approvals) as a prioritised list with links, then the charts (orders and gross
  value by marketplace as two aligned charts; commission mix as a ranked horizontal bar + share, replacing the
  random-colour donut where a bar reads better), then quick actions as secondary links. Same treatment for the partner
  and enterprise home dashboards.

## Order of work

1. Shared: `Td` alignment and wrap props, `Table` header rule and hidden actions header, `RowActions`, `FilterBar`,
   `FormField compact` + `FieldRow`, chart components; DOM tests; `/design-system` shows them.
2. Operator screens in four groups (Overview + Partners & accounts; Commerce; Finance; Service + Platform +
   Governance): apply rules 1–8, replace ad-hoc tab buttons with `Tabs`, remove inline font sizes/colours/radii
   (lower the guardrail baseline each group).
3. Dashboards: operator, then partner and enterprise home.
4. Partner and enterprise console screens (same rules), then the storefront and account screens.
5. Browser check at 1280 and 390 for each group; merge after each group so it lands steadily.
