# Plan: an operator-driven public storefront

Make the public front show what the operator's console actually holds — banner copy from
their Banners section, the marketplace's own six categories, and real catalogue rows —
and put a login in front of the first add to basket.

**Status: done and verified against the live project.**

---

## Why

The public front was built from generated artwork with the words baked in beside it.
Four banner images carried no message at all; the two landing rails were stock photos with
invented captions (`RETAIL_PRODUCTS`, `ENTERPRISE_PRODUCTS` in the generated `assets.ts`);
and the audience pages showed the same tiles again rather than anything anyone could buy.

Meanwhile the operator console has a Banners section with `title`, `subtitle`, `cta`, a
weight, a status and a date window — copy written to be shown, that nothing showed.

## The constraint that shaped this

`operator_banners` is operator-only since the scoped-RLS work, and it has to stay that way:
alongside the promo copy it carries `impressions`, `clicks` and `revenue`. The landing page
is anonymous. So the storefront could not simply read the table.

A second policy on the table was the wrong tool — a policy grants rows, not columns, so anon
would have got the revenue figures too. `public_banners` is a view that drops the commercial
columns and hard-codes the "live right now" rule, granted `select` to `anon` and
`authenticated` and nothing else. `security_invoker = false` is what makes it work: the view
runs as its owner, so it is not itself blocked by the RLS it exists to bypass. **The view is
the security boundary.**

## Task 1: The public banner projection — DONE

**Files:** `supabase/migrations/20260729140000_public_banners.sql`

The view above, plus two extra `storefront_strip` banners. The seed had one banner in that
slot and one in `storefront_hero`, so only two of the four tiles would have carried a
message. The two additions use partners and categories already in the catalogue rather than
inventing sellers.

**Verified:** anon reads 7 live banners through the view and still reads **0 rows** from
`operator_banners`. No `impressions`, `clicks` or `revenue` key is present on anything the
view returns.

## Task 2: Promo copy on the banners — DONE

**Files:** `src/lib/storefront.ts`, `src/lib/storefrontRepo.ts`,
`src/components/public/PromoStrip.tsx`, `src/components/public/LandingPage.tsx`

The strip renders the operator's live storefront banners, heaviest weight first, each over
one of the twelve banner images. Only `storefront_hero` and `storefront_strip` qualify — a
`login` banner belongs on the sign-in screen, and showing it here would put a banner where
its author did not ask for it.

Two details worth keeping:

- **The artwork is chosen by hashing the banner id, not its position.** Pausing a banner in
  the console then does not reshuffle the pictures on the ones either side of it.
- **The scrim is opaque enough to be a floor, not a tint.** The operator writes the copy but
  not the picture, so white text needs to clear 4.5:1 over the palest banner in the set, not
  merely over today's.

An empty strip is a legitimate state — every banner paused, or all outside their window —
and renders as nothing rather than as an empty box.

**Verified** in a browser against the live project: four tiles, reading
*"K9 Pro 5G now in stock"*, *"Halo Audio wireless range — save 25%"*, *"IoT Sensor Packs —
bulk pricing available"*, *"Become a marketplace seller"*, each with its subtitle and CTA.

## Task 3: The six categories on the landing rails — DONE

**Files:** `src/components/public/CategoryRail.tsx`, `LandingPage.tsx`

"Retail products" and "Enterprise products" now show categories from the `categories` table
rather than a hand-kept list of pictures, with each tile carrying the category's audience,
blurb and live product count.

The split reads the `audience` column instead of hard-coding ids, so a category added in the
console lands in the right rail without anyone editing this repo. Two consequences, stated
rather than discovered:

- **Devices appears on both rails.** Its audience is literally `Consumer & Enterprise`, and
  devices genuinely sell to both.
- **Partner (`B2B2X`) rides the enterprise rail**, being a business audience.

All six categories therefore appear somewhere, which a test asserts directly.

**Verified:** retail = Consumer, Devices, Digital Content. Enterprise = Partner, IoT,
Security, Devices.

## Task 4: Real catalogue rows on the audience pages — DONE

**Files:** `src/components/public/PublicProductGrid.tsx`, `AudiencePage.tsx`

The retail and enterprise pages list actual `products` rows — name, seller, price, was-price,
rating, review count, badge — narrowed to the categories that page covers.

**Only `live` rows are shown.** The catalogue also holds `pending` and `suspended` listings,
and a public page advertising either is offering something the operator has not approved.
Out-of-stock rows render with the add button disabled rather than being hidden, so the
product is still discoverable.

The partner page keeps its illustrative rail: it is a pitch to sellers, not a shop.

**Verified:** 12 rows on the retail page, e.g. *Aventa Freedom 50 GB · Aventa Telecom ·
4.3 (2140) · $18.00*, and *Kestrel K9 Pro 256 GB* showing $749.00 struck through from
$829.00.

## Task 5: A login in front of the first add to basket — DONE

**Files:** `src/App.tsx`, `src/components/LoginScreen.tsx`

Anyone may browse; the basket needs an owner. `cart_items` is owner-scoped and its INSERT
policy requires `current_persona() = 'consumer'`, so a signed-out add has nowhere to go —
**the UI gate and the database agree**, and the database is the one that is load-bearing.

Clicking "Add to basket" while signed out holds the product, routes to the login screen with
the consumer credentials prefilled and a notice saying why, and completes the add on the
other side of the sign-in. Signing in as any other persona drops the pending product — an
operator's basket is not a thing.

One bug fixed on the way: `addToCart` decided insert-vs-increment from `cartItems` in React
state. Signing in mid-flow adds a row before that state has been reloaded for the new
session, so it would have inserted a duplicate. It now asks the database.

**Verified** in a browser, end to end: add while signed out → login screen shows *Sign in to
add "Aventa Freedom 50 GB" to your basket* with `priya.raman@example.com` prefilled → sign in
→ consumer console with the cart badge at 1.

## Task 6: The footer is the site menu — DONE

**Files:** `src/components/public/PublicShell.tsx`

The footer carries Home, Partners, Retail and Enterprise plus the regions, so someone who has
read to the bottom of a long page can move on without scrolling back up. **"Demo sign-in" is
gone from the footer** and stays in the header — one way in is enough.

## Task 7: Tests — DONE

**Files:** `src/lib/storefront.test.ts` (25 unit),
`src/lib/storefrontRepo.integration.test.ts` (8 integration)

The integration suite runs **signed out on purpose**: most of what matters is what a visitor
cannot reach. It asserts the view hides the commercial columns, that `operator_banners`
returns empty rather than throwing, and that a signed-out `cart_items` insert is refused.

**Verified:** `npm test` 88 passed; `npm run test:integration` 24 passed; build clean.

---

## Self-Review

**The riskiest thing here is the view**, because `security_invoker = false` is exactly the
shape of an accidental RLS bypass. It is deliberate, it is the only way to serve public copy
out of an operator-only table without exposing the revenue columns, and the integration test
asserts both halves — that the projection works and that the table stays shut.

**Two things left open, both flagged rather than guessed at:**

1. **`products` and `operator_listings` disagree.** The storefront catalogue (39 rows) and
   the operator's Catalogue Review queue (12 rows) describe overlapping products with
   different names, prices and sellers — *Aventa Freedom 50 GB* at $18 sold by "Aventa
   Telecom" against *Aventa Freedom 50GB Plan* at $29.99 from "Aventa (First-party)". This
   work reads `products`, because it is the only table carrying descriptions, specs and
   stock, and so the only one that can drive a storefront. Reconciling the two — most likely
   by making `operator_listings` reference `products` rather than restate it — is a data-model
   decision that needs a human answer.
2. **Console parity with the HTML prototypes** is a separate, much larger piece of work. The
   prototypes run to ~118k lines across four files plus a 3 MB `_src`; the React consoles are
   a thinner reproduction. Scoping that needs its own spec.
