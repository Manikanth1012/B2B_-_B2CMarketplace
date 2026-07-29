# Marketplace public front — design

**Date:** 29 Jul 2026
**Branch:** `Claude`
**Status:** awaiting review

Sub-project 3 of the marketplace port. Adds the public front door: a common landing page plus
three audience pages, and the asset pipeline that makes 46 MB of supplied imagery shippable.

---

## 1. Why

The app opens straight onto a four-card persona login. There is no public surface — nothing that
explains what the marketplace is before asking who you are. Real marketplaces put the storefront
first and the sign-in second.

The four-card login stays exactly as it is, for demos.

---

## 2. Structure

Four public pages sharing one shell.

```
LANDING (/)          nav: Partners · Retail · Enterprise        [Demo sign-in]
  hero carousel
  promo banner strip
  ── Retail products ──        phones, streaming, wearables, home devices
  ── Enterprise products ──    IoT gateways, security, POS, network kit
  footer

  ├─ Partners   → PARTNER page    → [Sign in] → partner console
  ├─ Retail     → RETAIL page     → [Sign in] → consumer storefront
  └─ Enterprise → ENTERPRISE page → [Sign in] → enterprise portal
```

The three audience pages are **one component with three configurations** — hero, a short "why
here", the categories relevant to that audience, two or three banners, and a sign-in call to
action. They differ in copy, imagery and destination; not in structure. Three separate components
would drift apart within a week.

**Demo sign-in** sits in the header and opens the existing `LoginScreen` unchanged.

---

## 3. The asset pipeline

`scripts/build-assets.mjs`, using **sharp** as a devDependency. Committed and re-runnable, in the
same spirit as `_src/extract-kb.cjs`: the transformation is reproducible and reviewable rather than
a one-off someone did by hand.

### The four large files are sprite sheets

| Source | Dimensions | Contains |
|---|---|---|
| `Coroussels.png` | 2172×724 | 5 carousel cards in a row |
| `Ad_Banners.png` | 1536×1024 | 12 promo banners, 2 columns × 6 rows |
| `Device_Images_Collage1.png` | 1413×1113 | 42 device thumbnails, 6 columns × 7 rows |
| `Mobile.png` | 1484×1060 | a single hero photograph, not a sheet |

Plus 60 standalone product photographs at 1024×1024.

### Geometry is measured, never assumed

**The sheets have outer margins and inter-cell gaps.** Slicing by `width / count` would clip every
cell and leave slivers of its neighbours. The script therefore declares an explicit rectangle set
per sheet — origin, cell size, gap — as named constants, and the implementation's first job is to
measure those from the actual files rather than deriving them arithmetically.

Each sheet's slices are written to `public/assets/mp/` and **visually checked once** before the
numbers are committed. A slice that is off by ten pixels still looks like an image; only looking at
it catches that.

### Output budget

| Set | Count | Display size | Est. each | Est. total |
|---|---|---|---|---|
| Hero | 1 | 1600×900 | ~120 KB | 120 KB |
| Carousel cards | 5 | 434×724 | ~45 KB | 225 KB |
| Promo banners | 12 | 768×171 | ~35 KB | 420 KB |
| Device thumbnails | 42 | 235×159 | ~12 KB | 500 KB |
| Product photos | **12 of 60** | 320×320 | ~22 KB | 265 KB |

All WebP, quality 80. **~46 MB in, ~1.5 MB out**, of which roughly **250 KB is above the fold** —
the hero, the first carousel card and the chrome. Everything below the fold carries
`loading="lazy"`.

### Which set feeds which rail

The device collage already splits by audience: its first three rows are consumer hardware (phones,
laptops, watches, earbuds, TVs, consoles, cameras), and its last four are business kit (desk
phones, conference units, PTZ cameras, switches, servers, rugged handhelds, label printers,
scanners, POS terminals). The 60 standalone photographs are enterprise IoT — gateways, LoRa, BLE
beacons, EV chargers, PIR sensors.

- **Retail rail** — 12 thumbnails drawn from the collage's consumer rows.
- **Enterprise rail** — 12 of the standalone photographs, which are higher resolution and
  genuinely enterprise.

All 42 thumbnails are still generated and named in the manifest, because slicing a sheet is
all-or-nothing and the spare 30 cost 360 KB on disk and nothing on the wire — nothing references
them, so nothing downloads them. A landing page showing 60 products is a catalogue, not a landing
page.

### The manifest

The script emits `src/lib/assets.ts` — a typed manifest naming every generated file:

```ts
export const HERO = '/assets/mp/hero.webp'
export const CAROUSEL: readonly string[]      // 5
export const BANNERS: readonly string[]       // 12
export const DEVICE_THUMBS: readonly string[] // 42
export const RETAIL_PRODUCTS: readonly { src: string; alt: string }[]      // 12, from DEVICE_THUMBS
export const ENTERPRISE_PRODUCTS: readonly { src: string; alt: string }[]  // 12, from the photographs
```

Generated, not hand-written, so a missing asset is a compile error rather than a broken image
discovered in a demo. Every entry carries alt text — these are product photographs and a screen
reader user gets nothing from `<img alt="">`.

### What is committed

The generated WebP files and the manifest are committed; they are build output that must ship.
`images/` — the 46 MB of sources — is added to `.gitignore` and stays local. Keeping 46 MB of PNGs
in git history permanently, to produce 1.5 MB of assets, is a bad trade that cannot be undone
later.

---

## 4. Routing

`react-router-dom` is declared in `package.json` and **never imported anywhere in `src/`**. The
whole app is a single `useState` machine: `App.tsx` renders `LoginScreen` when `session` is null
and a persona shell otherwise.

Introducing a router now would touch every console. Instead the existing state is extended:

```ts
type Surface =
  | { kind: 'public'; page: 'landing' | 'partner' | 'retail' | 'enterprise' }
  | { kind: 'login' }
  | { kind: 'session'; session: Session }
```

`App.tsx` starts at `{ kind: 'public', page: 'landing' }`. Signing in from an audience page
produces exactly the `Session` the login screen produces today, so **no console changes at all**.

**The cost, stated plainly:** no URLs, so no deep links, no browser back, no shareable page
addresses. That is already true of the entire application — this does not make it worse, and it
does not entrench it either. Adding routing is worthwhile, but as its own piece of work where every
console can be updated together, not smuggled in behind a landing page.

---

## 5. The carousel

The component most likely to be built badly, so it gets stated requirements rather than
"add a carousel".

- Auto-advances every 6 seconds; wraps at the end.
- **Pauses on hover and on keyboard focus.** A carousel that keeps moving while someone is reading
  a slide is worse than no carousel.
- Arrows and dots, both keyboard reachable, dots announcing position.
- **`prefers-reduced-motion: reduce` disables auto-advance entirely** — not just the transition.
  Motion someone cannot stop is the accessibility failure carousels are known for.
- Slide changes are announced politely to assistive technology.

Advance, wrap and pause are pure functions, tested without a DOM.

---

## 6. Page content

Conventions taken from mainstream marketplace UI: a rotating hero, a promo strip, category tiles,
horizontally scrolling product rails, and trust signals.

**Landing:** hero carousel (5 cards) · 4 of the 12 promo banners · **Retail products** section ·
**Enterprise products** section · footer. The two product sections are labelled blocks down the
page, both reachable by scrolling — nobody has to choose an audience before seeing anything.

**Audience pages:** hero, a short statement of what this audience gets, the categories that apply,
two or three banners chosen for that audience, and the sign-in call to action. The Partner page's
secondary action is **Apply to sell**, which routes to the partner console's onboarding screen —
the gate machine built in sub-project 1.

Existing brand tokens and `operator/shared.tsx` components are reused. No parallel component set.

---

## 7. Testing

Vitest, extending the existing suites.

- **Carousel logic** — advance, wrap, pause-on-hover, reduced-motion. Pure, no DOM.
- **Manifest integrity** — every path in `src/lib/assets.ts` exists on disk, and no generated asset
  exceeds a size ceiling. This is what stops a 2 MB PNG creeping back in; without it the budget in
  §3 is an intention rather than a constraint.
- **Surface transitions** — landing → audience → session produces the same `Session` shape the
  login screen produces.

**Acceptance:** the app opens on the landing page; each of Partners, Retail and Enterprise opens
its audience page; each audience page signs into the correct console; Demo sign-in still opens the
four-card login; and the above-the-fold payload measures under 400 KB.

---

## 8. Out of scope

- **URL routing.** Recorded in §4 with its cost; its own sub-project.
- **The remaining 48 product photographs and 30 unused device thumbnails.** Generated or still in
  `images/`, addable without rework.
- **Real authentication.** Sign-in produces the same demo `Session` as today.
- **Responsive work beyond what the existing pages already do.** The shells are not currently
  mobile-optimised and fixing that is not this piece of work.
- **The operator persona on the public front.** Operators do not arrive through a marketplace front
  door; they reach their console through Demo sign-in.
