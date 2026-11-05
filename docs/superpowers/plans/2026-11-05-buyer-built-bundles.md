# Spec 7 — buyer-built bundles — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Operator-authored bundle templates with option slots that consumers and enterprise buyers configure into one server-priced bundle, bought whole and settled as its parts.

**Architecture:** One migration (tables, `price_bundle`, `configure_bundle`, guards on basket/requisition/order lines, RLS, seed, help) that the user applies; a pure module `src/lib/bundles.ts` mirroring the arithmetic and rules; `src/lib/bundleRepo.ts` for data; three screen tasks in parallel.

**Tech stack:** Vite 5, React 18, TypeScript, Supabase (Postgres, RLS), Vitest 2.

**Spec:** `docs/superpowers/specs/2026-11-05-buyer-built-bundles-design.md`

## Global Constraints

- No change to existing behaviour: ordinary basket, requisition and order lines behave exactly as today; every new guard acts only when `bundle_selection_id` is set.
- No new runtime dependencies.
- Claude never applies migrations; the user does. Nothing may assume the new tables exist until the controller records the user's go-ahead.
- Every pricing/integrity rule is enforced in the database and mirrored by pure tested functions; the screen never decides what the database would refuse.
- No seller priced below its `floor_price` for that currency.
- Money: one currency per selection, from `product_prices`; shown with `fmtIn`.
- WCAG 2.2 AA (`src/lib/contrast.test.ts` incl. its guard against `color: var(--brand-accent)` in `.tsx`); 44px controls; reduced motion; shared `Dialog`, `StatusBadge`/`statusTone`, console components (`src/components/operator/shared.tsx`), shop components (`src/components/ui/`).
- Pure modules never import `supabase`.
- PL/pgSQL: wrap any CASE used inside an IF/ELSIF condition in parentheses (spec 6's first apply failed on this); idempotent DDL (`if not exists`, `create or replace`, `drop … if exists` before `create`); SECURITY DEFINER functions `set search_path = public` and check `current_persona()`.
- Integration tests delete every row they create.
- Gates per task: `npx vitest run` (only `gateway.test.ts` financingProblem and `partnerApplication.test.ts` '02 Aug 2026' may fail) and `npm run build`.
- Commits: plain-English subject, short body, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; stage only your files; never force-add ignored files.
- Parallel worktrees: `npm ci` inside the worktree; copy `.env` in if missing; never commit it.

## Facts about the existing schema (verified)

- `products(id, category_id, partner_id, seller, price, model, stock 'in'|'low'|'out'|'preorder', status 'live'|…, audiences text[], unit, floor_price, …)`.
- `product_prices(product_id, currency, price, was_price, floor_price nullable, list_price nullable)`, pk (product_id, currency); `floor_price <= price`.
- `bundle_rules(id, per_component, max_discount, min_components, max_components, why)` — the published composition rule (one row; read it).
- `product_components(bundle_id, component_id, quantity, note, sort_order)` — today's fixed bundles; untouched.
- `cart_items(id uuid, product_id, quantity, created_at, saved bool, user_id uuid default auth.uid())`.
- `order_items(id uuid, order_id, product_id, product_name, price numeric, quantity, fulfil, status, user_id, part_id)`; consumer checkout inserts orders/order_items from the client (`src/components/Checkout.tsx` ~L190–230).
- `enterprise_requisition_lines(id, requisition_id, product_id, name, seller, partner_id, quantity, unit_price numeric(10,2), line_total, sort_order, quote_line_id)`; guards `guard_requisition_line`, `guard_quoted_line` (spec 6).
- Identity: `current_persona()`, `current_partner_id()`, `current_account_id()`; consumer = `auth.uid()`; consumer home currency via the consumer profile (read `loadHome` in `src/lib/moneyRepo.ts` and the profile table it reads).
- Help: `kb_articles` (see spec 6 migration's help block for columns, ids and voice).
- Existing helpers: `bundleRoom`, `checkBundleAgainstFloors` (`src/lib/pricing.ts`); `fmtIn` (market context); `RequisitionContext`, `addToBasket`, `repriceTo`; spec 6's `raise_quote`.

## Interfaces (produced by Task 1; binding)

```ts
// src/lib/bundles.ts — pure
export interface BundleTemplate { id: string; name: string; description: string | null; image: string | null; status: 'draft' | 'live' | 'paused'; audiences: ('consumer' | 'enterprise')[]; discount_pct: number }
export interface BundleSlot { id: string; template_id: string; label: string; min_pick: number; max_pick: number; qty_min: number; qty_max: number; qty_default: number; sort_order: number }
export interface BundleOption { id: string; slot_id: string; product_id: string; is_default: boolean; sort_order: number }
export type Choices = Record<string, { product_id: string; quantity: number }[]>   // slot id → picks
export interface PricedPart { product_id: string; list: number; floor: number | null; quantity: number }   // quantity per bundle
export interface PricedLine extends PricedPart { unit_price: number; line_total: number; at_floor: boolean }
export interface BundlePrice { lines: PricedLine[]; parts_total: number; total: number; saving: number }

export function defaultChoices(slots: readonly BundleSlot[], options: readonly BundleOption[]): Choices
export function validateChoices(slots: readonly BundleSlot[], options: readonly BundleOption[], choices: Choices): Record<string, string>   // slot id → problem; {} = ok
export function priceBundle(parts: readonly PricedPart[], discountPct: number, bundleQty: number): BundlePrice
//   unit_price = max(round2(list × (1 − d/100)), floor ?? 0); line quantity = part.quantity × bundleQty;
//   line_total = round2(unit_price × qty); total = Σ line_total; parts_total = Σ round2(list × qty); saving = parts_total − total
export type Standing = { kind: 'ok' } | { kind: 'expired' } | { kind: 'part-unavailable'; product_id: string; name: string }
export function bundleStanding(sel: { valid_until: string }, lines: readonly { product_id: string; name: string }[], today: string, available: (productId: string) => boolean): Standing
export function groupBySelection<T extends { bundle_selection_id?: string | null }>(lines: readonly T[]): { selectionId: string | null; lines: T[] }[]   // ordinary lines each in their own group with selectionId null, order kept
```

```ts
// src/lib/bundleRepo.ts — Task 3
export interface BundleBook { templates: BundleTemplate[]; slots: BundleSlot[]; options: BundleOption[]; loadError: string | null }
export interface Selection { id: string; template_id: string; currency: string; quantity: number; total: number; parts_total: number; priced_at: string; valid_until: string; choices: Choices }
export interface SelectionLine { id: string; selection_id: string; product_id: string; name: string; partner_id: string | null; seller: string; quantity: number; list_unit_price: number; unit_price: number; floor_unit_price: number | null; sort_order: number }
type Result<T = void> = { ok: true; value: T } | { ok: false; error: string }
export function loadBundleBook(): Promise<BundleBook>                     // RLS scopes what each persona sees
export function priceOnServer(templateId: string, choices: Choices, currency: string, quantity: number): Promise<Result<{ lines: SelectionLine[]; total: number; parts_total: number; saving: number }>>
export function configureBundle(templateId: string, choices: Choices, currency: string, quantity: number): Promise<Result<{ selection: Selection; lines: SelectionLine[] }>>
export function loadSelections(ids: string[]): Promise<Result<{ selections: Selection[]; lines: SelectionLine[] }>>
// operator
export function saveTemplate(t: Omit<BundleTemplate, 'id'> & { id?: string }, slots: (Omit<BundleSlot, 'id' | 'template_id'> & { id?: string; options: { product_id: string; is_default: boolean }[] })[]): Promise<Result<string>>
export function setTemplateStatus(id: string, status: BundleTemplate['status']): Promise<Result>
```

---

### Task 1 (parallel with Task 2): Pure bundle logic, test-first

**Files:** create `src/lib/bundles.ts`, `src/lib/bundles.test.ts`.
- [ ] Tests first: `defaultChoices` (defaults per required slot at `qty_default`; optional slots empty); `validateChoices` (too few/many picks, quantity out of range, product not an option, unknown slot); `priceBundle` (10% off two parts; a part whose discounted price is below its floor is held at the floor and `at_floor` true; null floor treated as 0; bundle quantity 3 multiplies line quantities; rounding: each line rounded, total equals the sum of lines exactly; saving = parts_total − total; zero discount impossible input guarded); `bundleStanding` (valid_until < today → expired; == today ok; first unavailable part named); `groupBySelection` (keeps order; groups by id; ordinary lines alone); a test that reads `bundles.ts` as text and asserts no `supabase` import.
- [ ] Run — FAIL; implement; run — PASS; gates.
- [ ] Commit: "The arithmetic and rules of a buyer-built bundle, as pure functions".

### Task 2 (parallel with Task 1): The migration

**Files:** create `supabase/migrations/20261105200000_a_buyer_builds_the_bundle.sql` and `src/lib/bundles.migration.test.ts`.
Implement spec §1 exactly:
- [ ] Tables `bundle_templates`, `bundle_slots`, `bundle_options`, `bundle_selections`, `bundle_selection_lines` with the spec's checks (discount ≤ `bundle_rules.max_discount` enforced by trigger since it reads another table; exactly one default for required slots via trigger or partial unique index; owner exactly one of account_id/user_id).
- [ ] `price_bundle(p_template text, p_choices jsonb, p_currency text, p_quantity integer)` returns a table/jsonb of lines + totals; pure read; same arithmetic as Task 1's `priceBundle` (state it in a comment and keep it identical: round per line to 2 dp, floor null → 0, total = Σ lines). Refusals per spec §1 with sentences.
- [ ] `configure_bundle(...)` SECURITY DEFINER: persona enterprise (owner = current_account_id(), currency = account currency, template audience includes enterprise) or consumer (owner = auth.uid(), currency = the consumer's home currency — read how `loadHome` derives it, template audience includes consumer); writes selection + lines with `valid_until = priced_at + 7 days`; returns the selection id. `price_bundle` callable by authenticated (and anon only for consumer templates — or not at all for anon; choose and justify).
- [ ] `bundle_selection_id` on `cart_items`, `enterprise_requisition_lines`, `order_items` (FK, nullable) + one guard function per table, acting only when set, per spec §1 "Lines tied to a selection" (match product/qty/price; same owner and currency; within valid_until at raise/order time; parts live and priced). For cart_items, validity is checked when the line is written; for requisitions when the requisition line is inserted; for order_items when inserted. Removing a cart line of a selection deletes the selection's other cart lines (after delete trigger); same for a pending requisition's lines.
- [ ] RLS per spec §1; `revoke` from anon where not needed; no direct insert on selections (only via `configure_bundle`).
- [ ] Template authoring: operator persona only (RLS); a publish guard: moving to `live` requires ≥ `bundle_rules.min_components` fillable slots, ≤ max, every option product live, and the default configuration priced in every currency the audiences buy in (consumer: currencies of markets with consumer profiles — or simply every currency in `product_prices` that all default parts share; choose the simplest correct rule and document it).
- [ ] Seed two live templates from products live and priced today (query the catalogue/price book in the seed; fail loudly if not available): "Smart office starter kit" (enterprise; sensors / connectivity / gateway or security) and "Home security bundle" (consumer). Ids with a non-numeric prefix (`BT-SEED-…`), delete-then-insert by prefix.
- [ ] Help articles for each new screen view id (Task 4/5 will add view ids — use `op-bundles` for the operator section only if it is its own screen; if the builder lives inside Catalogue Review, no new view id and no article; decide with the controller: **resolution — the builder is a section inside Catalogue Review (no new view id); the configurator is a dialog/route inside existing shop views (no new view id); so no new help articles, but append a "Configurable bundles" section to the existing Catalogue Review operator article if one exists (update its body jsonb idempotently)**.
- [ ] Self-check block at the end (RLS on, triggers attached, seed templates price in their currencies, no bare CASE problem).
- [ ] Structural test asserting the above, incl. "no bare CASE inside an IF/ELSIF condition" and no `drop table` without `if exists`.
- [ ] Gates; commit: "The tables, pricing and guards behind a buyer-built bundle".

### Task 3: Repo and tones

**Files:** `src/lib/bundleRepo.ts`; `src/lib/bundlePayload.ts` (+ test) for pure payload/row mapping; `src/lib/consoleTone.ts` (+ test) for `draft` (neutral), `live` (success), `paused` (warning) if not mapped.
Per the binding interface; never throws, never swallows; RPC names/args exactly as the migration.
- [ ] Commit: "Reading, pricing and saving bundles through the database's own rules".

### Task 4 (parallel): Operator template builder

**Files:** `src/components/operator/BundleTemplates.tsx` (+ builder dialog files under `src/components/bundles/`), mounted as a section in `OperatorCatalogue.tsx` beside "Compose a bundle"; styles in `src/styles/bundles.css` (import in `src/main.tsx` after `enquiries.css`).
Spec §3 operator. Preview uses `priceBundle` + `bundleRoom` per currency in the price book; publishing goes through `setTemplateStatus` (the database decides).
- [ ] Commit: "The operator builds bundles buyers can configure".

### Task 5 (parallel): Configurator and shop cards

**Files:** `src/components/bundles/BundleConfigurator.tsx`, `BundleCard.tsx`; wire into consumer listings (home/category/retail, where fixed bundles appear) and enterprise Browse/verticals; consumer "Add bundle to basket"; enterprise "Add bundle to requisition" and "Request a quote for this bundle" (spec 6 `raiseQuote` with the parts as lines, subject = template name).
Spec §3 buyer. Live estimate via `priceBundle`; save via `configureBundle`; if the server total differs from the estimate, show it before adding.
- [ ] Commit: "Buyers configure a bundle and see one price as they choose".

### Task 6 (parallel): Basket, requisition and order wiring

**Files:** `src/components/CartDrawer.tsx`, `src/components/Checkout.tsx`, the consumer cart repo/context (find it), `src/lib/RequisitionContext.tsx` + basket helpers, `src/components/enterprise/RequisitionPanel.tsx`, order/bill views that list order items (OrdersView, enterprise orders, partner orders — show the group, keep per-seller views), `src/lib/enterpriseRepo.ts` raise path.
- Bundle lines carry `bundle_selection_id` and the selection's unit prices end to end (cart → order_items; basket → requisition lines); never re-priced by `repriceTo` or checkout's price book; grouped via `groupBySelection`; Edit bundle reopens the configurator (event/callback provided by Task 5 — coordinate through a small shared event like spec 6's `enquiries/events.ts`); Remove removes the group; expired → "Re-price" (configureBundle again, replace the group); part unavailable → blocked with the part named.
- Ordinary lines unchanged — prove it by keeping every existing basket/cart test green and adding tests for the new pure helpers.
- [ ] Commit: "A bundle travels through basket, requisition and order as one, settled as its parts".

### Task 7: STOP — syntax check, then the user applies the migration

Ask the user for OK to run `npx -y libpg-query`-based syntax check (or the controller's chosen equivalent) on the migration; fix anything it finds; then hand the file to the user with pre-apply checks and wait.

### Task 8: Integration tests and browser sweep

`src/lib/bundles.integration.test.ts` per spec §5 (cleanup in afterAll; never touch `BT-SEED-*` except to read). Browser: builder, configurator and basket in both shops at 1280/1024/390 with `scripts/contrast-scan.js`; keyboard. One fix wave.

### Task 9: Docs, final review, merge

README "Configurable bundles" section; backlog: spec 7 done. Final whole-branch review (most capable model); merge `--no-ff`; push.
