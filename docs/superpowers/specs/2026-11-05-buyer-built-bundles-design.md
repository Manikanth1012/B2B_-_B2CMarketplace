# Spec 7 — buyer-built bundles

Date: 2026-11-05 · Status: approved in conversation
Follows spec 6 (enterprise enquiries, merged `8fd5759`).

## Why

Today a bundle is fixed: the operator composes it in Catalogue Review
("Compose a bundle", `product_components`) and buyers take it or leave it.
The revamp brief asks for a buyer to assemble a bundle from options and get one
price. The pieces to do it honestly already exist: per-market price books
(`product_prices`, with each seller's `floor_price`), the published composition
rule (`bundle_rules`), and `bundleRoom` / `checkBundleAgainstFloors` in
`src/lib/pricing.ts`.

## Decisions taken in brainstorming

| Question | Decision |
|---|---|
| Model | Templates with options: the author defines slots and the listings each slot offers; the buyer picks |
| Who buys | Consumers (basket → checkout) and enterprise buyers (requisition → approval) |
| Who authors | The operator only, in Catalogue Review; seller-authored templates may follow later |
| Storage | "Settles as parts": a configured bundle is a priced *selection* whose component lines go into the basket/requisition/order with their share of the price, so settlement per seller is unchanged |
| Database | Claude writes the migration; the user applies it by hand. Before handing it over, Claude asks to syntax-check it with `libpg-query` (download needs the user's OK) |

## Constraints

- No change to existing behaviour: ordinary basket, requisition and order lines
  behave exactly as today; every new guard acts only when
  `bundle_selection_id` is set.
- No new runtime dependencies.
- Every pricing and integrity rule is enforced in the database and mirrored by
  pure tested functions; the screen never decides what the database would refuse.
- No seller is priced below its `floor_price`.
- Money per selection in one currency, from the market's price book, shown with
  `fmtIn`.
- WCAG 2.2 AA (`contrast.test.ts`), 44px controls, reduced motion, the shared
  `Dialog`, `StatusBadge`, console and shop components.
- Live-database tests delete everything they create.

## 1. Data and pricing (one migration)

File: `supabase/migrations/<timestamp>_a_buyer_builds_the_bundle.sql`,
idempotent, ending with self-checks (as spec 6's).

### Tables

| Table | Columns (essentials) |
|---|---|
| `bundle_templates` | `id`, `name` (≤ 80), `description`, `image`, `status` (`draft` · `live` · `paused`), `audiences text[]` (⊆ `consumer`, `enterprise`, non-empty), `discount_pct numeric(5,2)` (> 0 and ≤ `bundle_rules.max_discount`), `created_at`, `updated_at` |
| `bundle_slots` | `id`, `template_id`, `label` (≤ 60), `min_pick` (≥ 0), `max_pick` (≥ max(1, min_pick)), `qty_min` (≥ 1), `qty_max` (≥ qty_min), `qty_default` (between), `sort_order` |
| `bundle_options` | `id`, `slot_id`, `product_id` → `products`, `is_default` boolean (exactly one default per slot with `min_pick ≥ 1`), `sort_order`; unique (`slot_id`, `product_id`) |
| `bundle_selections` | `id`, `template_id`, `account_id` (enterprise) or `user_id` (consumer) — exactly one, `currency`, `choices jsonb`, `quantity` (bundles, ≥ 1), `total numeric(12,2)`, `parts_total`, `priced_at`, `valid_until` (= priced_at + 7 days) |
| `bundle_selection_lines` | `id`, `selection_id`, `product_id`, `name`, `partner_id`, `seller`, `quantity`, `list_unit_price`, `unit_price`, `floor_unit_price`, `sort_order` |

A template must carry at least `bundle_rules.min_components` and at most
`max_components` slots that can be filled.

### Pricing — `price_bundle(p_template, p_choices jsonb, p_currency, p_quantity)`

- `p_choices` = `{ "<slot id>": [{ "product_id": "…", "quantity": n }] }`.
- Refuses: template not live (or not in the caller's audience); a slot's pick
  count outside `min_pick..max_pick`; a quantity outside `qty_min..qty_max`; a
  product not an option of that slot; a product not `live`, out of stock, or
  with no price in `p_currency`.
- Per line: `unit_price = max(round(list × (1 − discount_pct/100), 2), floor)`,
  `list` and `floor` from `product_prices` for that currency (the same row the
  shop shows). Line quantity = chosen quantity × bundle quantity.
- Returns the lines, `parts_total` (at list), `total` (Σ lines) and `saving`.
  Pure: no writes.

### Saving — `configure_bundle(p_template, p_choices, p_currency, p_quantity)`

SECURITY DEFINER; prices with `price_bundle`, then writes a `bundle_selections`
row owned by the caller (enterprise: `current_account_id()`; consumer:
`auth.uid()`) and its lines; returns the id. Currency must be the caller's
(consumer home market currency / account currency).

### Lines tied to a selection

`cart_items`, `enterprise_requisition_lines` and `order_items` gain
`bundle_selection_id` → `bundle_selections`. Guard (acts only when set): the
line's product and quantity match a line of the selection; its unit price
equals the selection line's `unit_price`; the selection belongs to the same
buyer and currency; the selection is within `valid_until` at the moment the
requisition is raised or the order placed; every product in it is still live
and priced. Removing any line of a selection from a basket or pending
requisition removes all of them (trigger).

### RLS

Operator: all on templates/slots/options; read all selections. Everyone signed
in (and anon for consumer templates): read `live` templates, their slots and
options for their audience. Buyers: read and create their own selections
(through `configure_bundle` only; no direct insert), never edit them.

### Seed

Two templates built from listings live today (checked in the migration's
self-checks): "Smart office starter kit" (enterprise) and "Home security
bundle" (consumer), each with 3 slots.

## 2. Pure logic — `src/lib/bundles.ts` (tested first)

- `validateChoices(template, slots, options, choices)` → problems by slot.
- `priceBundle(lines, discountPct, quantity)` → per-line unit price
  (`max(list×(1−d), floor)`), totals, saving — identical arithmetic to
  `price_bundle` (rounding per line, total = Σ lines).
- `defaultChoices(slots, options)`.
- `bundleStanding(selection, lines, today, shelf)` → `ok` · `expired` ·
  `part-unavailable` (with the part).
- `groupBySelection(lines)` → bundle groups for the basket, requisition and
  order views.
- `bundleRoom` reused for the builder preview.

`src/lib/bundleRepo.ts` does the reads/writes (no logic); pure modules never
import `supabase`.

## 3. Screens

### Operator — template builder (Catalogue Review → "Configurable bundles")

List with status; create, edit, publish (draft → live), pause, duplicate.
Builder: name, description, image, audiences, discount % (capped by the rule),
slots with options picked from live listings, pick limits, quantity range and
default. Price preview per market: default, cheapest and dearest
configurations, naming any part that hits its floor. Publishing requires the
default configuration to price in every market the audiences can buy in.

### Buyer — configurator (both shops)

Live templates appear as bundle cards (marked configurable) beside fixed
bundles: consumer home/category/retail listing; enterprise Browse and the
matching verticals. Opening one shows the configurator in the product-page
layout: slots on the left (radio/checkbox within limits, quantity stepper in
range); a sticky panel on the right with the per-part breakdown, total, "you
save ₹X", and the action. The panel shows the `priceBundle` estimate while
choosing; the saved price is the server's, shown before adding when it differs.

- Consumer: **Add bundle to basket**.
- Enterprise: **Add bundle to requisition**, and **Request a quote for this
  bundle** (spec 6 `raise_quote` with the parts as lines; subject = template
  name).

### Basket, requisition and order

A bundle is one grouped line: template name, chosen parts underneath, one
total, one quantity (changing it re-prices on the server). Parts are not
edited individually; **Edit bundle** reopens the configurator with the current
choices; **Remove** removes all its lines. An expired selection shows
"Re-price" (one click). Checkout and approval are otherwise unchanged. Orders,
bills, refunds and settlement show the group; each seller sees and settles its
own parts.

## 4. Rules for edge cases

| Case | Rule |
|---|---|
| Price book changes | Selection holds its price 7 days; then re-price |
| Part paused, delisted, unpriced, out of stock | Whole bundle blocked at checkout/raise with the part named; edit to continue |
| Template paused | No new selections; valid existing selections can still be bought |
| Currency | One per selection, always the buyer's own currency (consumer home currency, or the business account's currency) — never the header currency. A requisition raised in a secondary currency cannot hold a bundle; the screen says so before Add (decided 2026-11-11) |
| Bundle quantity | Re-priced on the server; slot quantity limits apply per bundle |
| Refund / dispute | Per part at its allocated price (existing per-line flow) |
| Quote | Spec 6 quote with the configured parts as lines, routed by the usual rule |

## 5. Testing

- Unit (test-first): every function in §2; `statusTone` for template statuses.
- Migration structural test (tables, functions, guards, RLS, no bare CASE in an
  IF condition, no `drop table` without `if exists`).
- `libpg-query` syntax check of the migration before hand-over (with the
  user's OK to download it).
- Integration (after the user applies it): configure → price → consumer basket
  → order guard accepts; enterprise requisition with a bundle accepted; wrong
  price refused; partial removal removes the whole bundle; paused part blocks;
  expired selection refused; floor respected; another buyer's selection
  refused. Every row deleted afterwards.
- Browser: builder, configurator and basket in both shops at 1280/1024/390,
  contrast scan, keyboard.

## 6. Build order

1. In parallel: `bundles.ts` (tests first); the migration (+ structural test).
2. `bundleRepo.ts`.
3. In parallel: operator builder; configurator + shop cards; basket/requisition/order wiring.
4. Stop: syntax check, then the user applies the migration.
5. Integration tests, browser sweep, one fix wave.
6. Docs, final review, merge, push.

## 7. Out of scope

Seller-authored templates; free-form build-your-own; bundles across
currencies; server-side repricing of ordinary (non-bundle) lines (existing gap
in the backlog).
