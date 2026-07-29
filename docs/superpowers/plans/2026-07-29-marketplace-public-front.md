# Marketplace Public Front Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a public marketplace front door in front of the app — a common landing page plus Partner, Retail and Enterprise pages — each routing into the persona console already built.

**Architecture:** A build-time script slices four sprite sheets and emits WebP assets plus a typed manifest, so a missing asset is a compile error. The app's existing `useState` machine gains a `Surface` state rather than a router; every console stays untouched. Three audience pages are one component with three configurations.

**Tech Stack:** React 18 · TypeScript 5.5 · Vite 5.4 · sharp (devDependency, build-time only) · Vitest

## Global Constraints

- Branch is `Claude`. Do not commit to `main`.
- **`images/` is gitignored.** The 46 MB of sources stay local; only generated WebP ships.
- Generated assets go to `public/assets/mp/`. The manifest is `src/lib/assets.ts`, **generated, never hand-edited**.
- Every manifest product entry carries real alt text. These are product photographs; `alt=""` gives a screen-reader user nothing.
- **No router.** `react-router-dom` is a declared but never-imported dependency; leave it that way. Extend the `Surface` state instead.
- **No console changes.** Signing in from a public page produces exactly the `Session` shape `LoginScreen` already produces.
- The existing four-card `LoginScreen` is unchanged and remains reachable as "Demo sign-in".
- Reuse `src/components/operator/shared.tsx` and existing brand tokens. No parallel component set.
- `var(--text-primary)` does not exist; the token is `var(--text)`. `var(--text-tertiary)` is below the contrast floor on tinted backgrounds.
- Verify before claiming: `npx tsc --noEmit`, `npm test`, `npm run build` — run them and read the real output.

---

## File Structure

| File | Responsibility |
|---|---|
| `scripts/build-assets.mjs` | **Create.** Detects sprite-sheet geometry, slices, converts to WebP, emits the manifest. |
| `src/lib/assets.ts` | **Create (generated).** Typed manifest of every shipped asset. |
| `public/assets/mp/*.webp` | **Create (generated).** The assets themselves. |
| `src/lib/carousel.ts` | **Create.** Pure carousel state: advance, wrap, pause. No React. |
| `src/lib/carousel.test.ts` | **Create.** Unit tests for the above. |
| `src/lib/assets.test.ts` | **Create.** Manifest integrity and the size ceiling. |
| `src/components/public/Carousel.tsx` | **Create.** The carousel component. |
| `src/components/public/PublicShell.tsx` | **Create.** Header, nav, footer shared by all four public pages. |
| `src/components/public/LandingPage.tsx` | **Create.** Hero, banners, two product rails. |
| `src/components/public/AudiencePage.tsx` | **Create.** One component, three configurations. |
| `src/components/public/ProductRail.tsx` | **Create.** Horizontally scrolling tile rail, used by both. |
| `src/types/view.ts` | **Modify.** Add the `Surface` type. |
| `src/App.tsx` | **Modify.** Start on the landing page; route the public surfaces. |
| `.gitignore` | **Modify.** Add `images/`. |
| `package.json` | **Modify.** Add `sharp` devDependency and an `assets` script. |

---

## Task 1: The asset pipeline

**Files:**
- Modify: `package.json`, `.gitignore`
- Create: `scripts/build-assets.mjs`
- Create (generated): `src/lib/assets.ts`, `public/assets/mp/*.webp`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export const HERO: string
  export const CAROUSEL: readonly string[]       // 5
  export const BANNERS: readonly string[]        // 12
  export const DEVICE_THUMBS: readonly string[]  // 42
  export interface ProductTile { src: string; alt: string }
  export const RETAIL_PRODUCTS: readonly ProductTile[]      // 12
  export const ENTERPRISE_PRODUCTS: readonly ProductTile[]  // 12
  ```

**Why geometry is detected, not divided.** The sheets have outer margins and gaps between cells. `width / count` clips every cell and leaves slivers of its neighbours. The script finds cell boundaries by scanning for runs that differ from the sheet's corner background colour.

- [ ] **Step 1: Add sharp and the script entry**

```bash
npm install -D sharp@^0.33.5
```

Add to `package.json` `scripts`:

```json
"assets": "node scripts/build-assets.mjs"
```

Add to `.gitignore`:

```
images/
```

- [ ] **Step 2: Write the pipeline**

Create `scripts/build-assets.mjs`:

```js
/* Slices the supplied sprite sheets and emits WebP plus a typed manifest.
   Re-runnable: `npm run assets`. Sources live in images/ (gitignored);
   only the output ships. */
import sharp from 'sharp'
import { mkdirSync, writeFileSync, readdirSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'

const SRC = 'images'
const OUT = join('public', 'assets', 'mp')
mkdirSync(OUT, { recursive: true })

/* ---------- geometry detection ---------- */

/* The sheets have margins and gaps, so width/count clips every cell.
   Find runs along one axis where pixels differ from the corner background. */
async function findRuns(file, axis, threshold = 28, minRun = 40) {
  const img = sharp(file)
  const { width, height } = await img.metadata()
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true })
  const ch = info.channels
  const at = (x, y) => {
    const i = (y * info.width + x) * ch
    return [data[i], data[i + 1], data[i + 2]]
  }
  const bg = at(1, 1)                       // corner is always background
  const diff = (p) => Math.max(Math.abs(p[0] - bg[0]), Math.abs(p[1] - bg[1]), Math.abs(p[2] - bg[2]))

  const along = axis === 'x' ? width : height
  const across = axis === 'x' ? height : width
  const mid = Math.floor(across / 2)

  const runs = []
  let start = null
  for (let i = 0; i < along; i++) {
    const p = axis === 'x' ? at(i, mid) : at(mid, i)
    const on = diff(p) > threshold
    if (on && start === null) start = i
    if (!on && start !== null) {
      if (i - start >= minRun) runs.push([start, i - start])
      start = null
    }
  }
  if (start !== null && along - start >= minRun) runs.push([start, along - start])
  return runs
}

async function sliceGrid(file, cols, rows, out, prefix, size) {
  /* Detect BOTH axes on every sheet, including single-row ones. Taking the
     full height for a one-row sheet would keep its top and bottom margin,
     leaving a navy band above and below every card. */
  const xs = await findRuns(file, 'x')
  const ys = await findRuns(file, 'y')
  if (xs.length !== cols) throw new Error(`${file}: found ${xs.length} columns, expected ${cols}`)
  if (ys.length !== rows) throw new Error(`${file}: found ${ys.length} rows, expected ${rows}`)

  const names = []
  let n = 0
  for (const [top, h] of ys) {
    for (const [left, w] of xs) {
      const name = `${prefix}-${String(n + 1).padStart(2, '0')}.webp`
      await sharp(file)
        .extract({ left, top, width: w, height: h })
        .resize(size.w, size.h, { fit: 'cover' })
        .webp({ quality: 80 })
        .toFile(join(out, name))
      names.push(`/assets/mp/${name}`)
      n++
    }
  }
  return names
}

/* ---------- run ---------- */

const carousel = await sliceGrid(join(SRC, 'Coroussels.png'), 5, 1, OUT, 'carousel', { w: 434, h: 724 })
const banners  = await sliceGrid(join(SRC, 'Ad_Banners.png'), 2, 6, OUT, 'banner',   { w: 768, h: 171 })
const thumbs   = await sliceGrid(join(SRC, 'Device_Images_Collage1.png'), 6, 7, OUT, 'device', { w: 235, h: 159 })

await sharp(join(SRC, 'Mobile.png'))
  .resize(1600, 900, { fit: 'cover' })
  .webp({ quality: 80 })
  .toFile(join(OUT, 'hero.webp'))

/* Fix a pre-existing production bug while we are here. Header, Footer and
   EnterpriseShell all reference /assets/brand/6d-logo-white.png as a plain
   <img src>, which Vite does not process. The file lives at the repo root in
   assets/brand/, not in public/, so it resolves in dev (Vite serves the root)
   and 404s in a built bundle. Copy the two brand marks into public/ so the
   path is real in both. */
const BRAND_OUT = join('public', 'assets', 'brand')
mkdirSync(BRAND_OUT, { recursive: true })
for (const mark of ['6d-logo-white.png', '6d-logo.png']) {
  copyFileSync(join('assets', 'brand', mark), join(BRAND_OUT, mark))
}

/* Twelve enterprise photographs, chosen by an identifying fragment of the
   filename and paired with hand-written alt text.
   The source filenames are truncated mid-word — "..._a_compact_GPS_t-1785312585611.png"
   — so deriving alt from them yields "compact GPS t". A screen reader user
   deserves better, and a length check would not catch it. */
const ENTERPRISE_PICKS = [
  ['IoT_ga',  'IoT gateway for connecting field devices'],
  ['LoRa_g',  'LoRa gateway for long-range sensor networks'],
  ['BLE_be',  'Bluetooth low-energy beacon'],
  ['GPS_t',   'Compact GPS asset tracker'],
  ['PIR_mo',  'PIR motion sensor'],
  ['therm',   'Compact thermal sensor'],
  ['PTZ_se',  'Pan-tilt-zoom security camera'],
  ['Networ',  'Managed network switch'],
  ['rac',     'Full-size server rack'],
  ['EV_cha',  'EV charging point'],
  ['POS_te',  'Point-of-sale terminal'],
  ['NFC_pa',  'NFC contactless payment reader'],
]

const files = readdirSync(SRC).filter((f) => f.startsWith('Professional_'))
const enterprise = []
for (const [i, [fragment, alt]] of ENTERPRISE_PICKS.entries()) {
  const f = files.find((x) => x.includes(fragment))
  if (!f) throw new Error(`no source image matching "${fragment}"`)
  const name = `product-${String(i + 1).padStart(2, '0')}.webp`
  await sharp(join(SRC, f)).resize(320, 320, { fit: 'cover' }).webp({ quality: 80 }).toFile(join(OUT, name))
  enterprise.push({ src: `/assets/mp/${name}`, alt })
}

/* The collage splits by audience: its first three rows (18 cells) are consumer
   hardware, the rest is business kit. Retail takes 12 from the consumer rows. */
const RETAIL_ALT = [
  'Smartphone', 'Laptop', 'Smart watch', 'Wireless earbuds', 'Over-ear headphones',
  'Games controller', 'Smart television', 'Smart speaker', 'Voice assistant',
  'Portable speaker', 'Mirrorless camera', 'Camera drone',
]
const retail = thumbs.slice(0, 12).map((src, i) => ({ src, alt: RETAIL_ALT[i] }))

const ts = (name, arr) => `export const ${name}: readonly string[] = ${JSON.stringify(arr, null, 2)}\n`
const tiles = (name, arr) => `export const ${name}: readonly ProductTile[] = ${JSON.stringify(arr, null, 2)}\n`

writeFileSync('src/lib/assets.ts', `/* GENERATED by scripts/build-assets.mjs — do not edit.
   Re-run with \`npm run assets\`. Sources are in images/, which is gitignored. */

export interface ProductTile { src: string; alt: string }

export const HERO = '/assets/mp/hero.webp'
${ts('CAROUSEL', carousel)}${ts('BANNERS', banners)}${ts('DEVICE_THUMBS', thumbs)}${tiles('RETAIL_PRODUCTS', retail)}${tiles('ENTERPRISE_PRODUCTS', enterprise)}`)

console.log(`carousel ${carousel.length} · banners ${banners.length} · thumbs ${thumbs.length} · products ${enterprise.length}`)
```

- [ ] **Step 3: Run it**

Run: `npm run assets`

Expected: `carousel 5 · banners 12 · thumbs 42 · products 12`.

Then confirm the brand fix landed:

```bash
ls public/assets/brand/
```

Expected: `6d-logo-white.png`, `6d-logo.png` and the pre-existing `image.png`.

If it throws `found N columns, expected M`, the detector's `threshold` or `minRun` needs adjusting for that sheet — **do not** fall back to dividing by count, which is the bug this exists to avoid. Tune `threshold` (lower catches fainter edges) and re-run.

- [ ] **Step 4: Look at the slices**

An off-by-ten-pixels slice still looks like a perfectly good image, so this cannot be skipped. Open at least one from each set and confirm it is a single clean cell with no sliver of its neighbour and no cropped edge:

```
public/assets/mp/carousel-01.webp
public/assets/mp/banner-01.webp
public/assets/mp/device-01.webp
public/assets/mp/hero.webp
```

If any shows part of an adjacent cell, adjust the detector and re-run before continuing.

- [ ] **Step 5: Check the budget**

```bash
du -sh public/assets/mp
ls -S public/assets/mp | head -3
du -b public/assets/mp/hero.webp public/assets/mp/carousel-01.webp
```

Expected: total under 2 MB; no single file over 250 KB. If the hero exceeds 250 KB, drop its quality to 75 and re-run.

- [ ] **Step 6: Typecheck and commit**

```bash
npx tsc --noEmit
git add package.json package-lock.json .gitignore scripts/build-assets.mjs src/lib/assets.ts public/assets/mp public/assets/brand
git commit -m "Add the marketplace asset pipeline

Slices four sprite sheets into WebP and emits a typed manifest. Geometry is
detected by scanning for runs against the sheet background, because the
sheets have margins and gaps and dividing by cell count clips every cell.
images/ is gitignored; only the generated output ships.

Also copies the two brand marks into public/. Header, Footer and
EnterpriseShell reference /assets/brand/6d-logo-white.png as a plain img src,
but the file only existed at the repo root — so it resolved in dev, where
Vite serves the root, and 404d in a built bundle."
```

---

## Task 2: Carousel logic

**Files:**
- Create: `src/lib/carousel.ts`
- Test: `src/lib/carousel.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export interface CarouselState { index: number; count: number; paused: boolean }
  export function nextIndex(s: CarouselState): number
  export function prevIndex(s: CarouselState): number
  export function shouldAdvance(s: CarouselState, reducedMotion: boolean): boolean
  export const SLIDE_MS: number
  ```

- [ ] **Step 1: Write the failing test**

Create `src/lib/carousel.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { nextIndex, prevIndex, shouldAdvance, SLIDE_MS } from './carousel'

const s = (index: number, count = 5, paused = false) => ({ index, count, paused })

describe('nextIndex', () => {
  it('advances', () => expect(nextIndex(s(0))).toBe(1))
  it('wraps at the end', () => expect(nextIndex(s(4))).toBe(0))
  it('handles a single slide', () => expect(nextIndex(s(0, 1))).toBe(0))
  it('returns 0 for an empty set rather than NaN', () => expect(nextIndex(s(0, 0))).toBe(0))
})

describe('prevIndex', () => {
  it('goes back', () => expect(prevIndex(s(2))).toBe(1))
  it('wraps at the start', () => expect(prevIndex(s(0))).toBe(4))
  it('returns 0 for an empty set', () => expect(prevIndex(s(0, 0))).toBe(0))
})

describe('shouldAdvance', () => {
  it('advances when running and motion is allowed', () => {
    expect(shouldAdvance(s(0), false)).toBe(true)
  })

  it('does not advance while paused — someone is reading the slide', () => {
    expect(shouldAdvance(s(0, 5, true), false)).toBe(false)
  })

  it('does not advance under reduced motion, even when unpaused', () => {
    expect(shouldAdvance(s(0), true)).toBe(false)
  })

  it('does not advance with fewer than two slides', () => {
    expect(shouldAdvance(s(0, 1), false)).toBe(false)
  })
})

describe('SLIDE_MS', () => {
  it('is a sane dwell time — long enough to read a slide', () => {
    expect(SLIDE_MS).toBeGreaterThanOrEqual(5000)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL — cannot resolve `./carousel`.

- [ ] **Step 3: Implement**

Create `src/lib/carousel.ts`:

```ts
/* Carousel state, pure. No React, no timers — the component owns those, so
   the rules can be tested without a DOM. */

export interface CarouselState {
  index: number
  count: number
  paused: boolean
}

/* Six seconds. Long enough to read a slide; short enough that a visitor sees
   more than one. */
export const SLIDE_MS = 6000

export function nextIndex(s: CarouselState): number {
  if (s.count <= 0) return 0
  return (s.index + 1) % s.count
}

export function prevIndex(s: CarouselState): number {
  if (s.count <= 0) return 0
  return (s.index - 1 + s.count) % s.count
}

/* Auto-advance is refused outright under reduced motion, not merely made
   faster. Motion a person cannot stop is the accessibility failure carousels
   are known for; they can still use the arrows and dots. */
export function shouldAdvance(s: CarouselState, reducedMotion: boolean): boolean {
  if (reducedMotion) return false
  if (s.paused) return false
  return s.count > 1
}
```

- [ ] **Step 4: Run tests**

Run: `npm test`
Expected: PASS — 39 existing plus 12 new = 51.

- [ ] **Step 5: Commit**

```bash
npx tsc --noEmit
git add src/lib/carousel.ts src/lib/carousel.test.ts
git commit -m "Add pure carousel state

Advance, wrap and pause as functions with no React or timers, so the rules
are testable without a DOM. Reduced motion refuses auto-advance outright."
```

---

## Task 3: Manifest integrity test

**Files:**
- Create: `src/lib/assets.test.ts`

**Interfaces:**
- Consumes: the manifest from Task 1.
- Produces: nothing downstream.

**Why this exists:** without it, the size budget in the spec is an intention rather than a constraint. This is what stops a 2 MB PNG creeping back in six months from now.

- [ ] **Step 1: Write the test**

Create `src/lib/assets.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { HERO, CAROUSEL, BANNERS, DEVICE_THUMBS, RETAIL_PRODUCTS, ENTERPRISE_PRODUCTS } from './assets'

const onDisk = (p: string) => join('public', p.replace(/^\//, ''))
const all = [HERO, ...CAROUSEL, ...BANNERS, ...DEVICE_THUMBS,
             ...RETAIL_PRODUCTS.map(p => p.src), ...ENTERPRISE_PRODUCTS.map(p => p.src)]

describe('asset manifest', () => {
  it('has the expected counts', () => {
    expect(CAROUSEL).toHaveLength(5)
    expect(BANNERS).toHaveLength(12)
    expect(DEVICE_THUMBS).toHaveLength(42)
    expect(RETAIL_PRODUCTS).toHaveLength(12)
    expect(ENTERPRISE_PRODUCTS).toHaveLength(12)
  })

  it('names only files that exist on disk', () => {
    const missing = all.filter(p => !existsSync(onDisk(p)))
    expect(missing).toEqual([])
  })

  it('ships nothing over 250 KB', () => {
    const heavy = all
      .map(p => ({ p, kb: Math.round(statSync(onDisk(p)).size / 1024) }))
      .filter(x => x.kb > 250)
    expect(heavy).toEqual([])
  })

  it('keeps the whole set under 2 MB', () => {
    const totalKb = all.reduce((n, p) => n + statSync(onDisk(p)).size, 0) / 1024
    expect(Math.round(totalKb)).toBeLessThan(2048)
  })

  it('gives every product tile real alt text, not a truncated filename', () => {
    /* The source filenames are cut mid-word, so a length check alone would
       accept "compact GPS t". Require a whole final word. */
    const bad = [...RETAIL_PRODUCTS, ...ENTERPRISE_PRODUCTS].filter(t => {
      const a = (t.alt || '').trim()
      const lastWord = a.split(' ').pop() ?? ''
      return a.length < 6 || lastWord.length < 3
    })
    expect(bad).toEqual([])
  })

  it('serves everything as WebP', () => {
    expect(all.filter(p => !p.endsWith('.webp'))).toEqual([])
  })
})
```

- [ ] **Step 2: Run it**

Run: `npm test`
Expected: PASS — 51 plus 6 = 57.

If "ships nothing over 250 KB" fails, lower that asset's quality in `scripts/build-assets.mjs` and re-run `npm run assets`. Do not raise the ceiling.

- [ ] **Step 3: Commit**

```bash
git add src/lib/assets.test.ts
git commit -m "Assert the asset budget

Every manifest path exists, nothing exceeds 250 KB, the set stays under
2 MB, and every product tile carries alt text. Without this the budget is
an intention rather than a constraint."
```

---

## Task 4: Surface state and the public shell

**Files:**
- Modify: `src/types/view.ts`
- Modify: `src/App.tsx`
- Create: `src/components/public/PublicShell.tsx`

**Interfaces:**
- Consumes: `Session` from `src/types/view.ts`; `LoginScreen`.
- Produces:
  ```ts
  export type PublicPage = 'landing' | 'partner' | 'retail' | 'enterprise'
  export type Surface =
    | { kind: 'public'; page: PublicPage }
    | { kind: 'login' }
    | { kind: 'session'; session: Session }
  ```
  ```tsx
  export function PublicShell(props: {
    page: PublicPage
    onNavigate: (p: PublicPage) => void
    onDemoSignIn: () => void
    children: React.ReactNode
  }): JSX.Element
  ```

- [ ] **Step 1: Add the Surface type**

Append to `src/types/view.ts`:

```ts
export type PublicPage = 'landing' | 'partner' | 'retail' | 'enterprise'

/* The app has no router — react-router-dom is declared but never imported.
   Rather than introduce one here (which would touch every console), the
   existing state machine gains a third surface. */
export type Surface =
  | { kind: 'public'; page: PublicPage }
  | { kind: 'login' }
  | { kind: 'session'; session: Session }
```

- [ ] **Step 2: Write the shell**

Create `src/components/public/PublicShell.tsx`:

```tsx
import type { PublicPage } from '../../types/view'

const NAV: { id: PublicPage; label: string }[] = [
  { id: 'partner', label: 'Partners' },
  { id: 'retail', label: 'Retail' },
  { id: 'enterprise', label: 'Enterprise' },
]

export function PublicShell({ page, onNavigate, onDemoSignIn, children }: {
  page: PublicPage
  onNavigate: (p: PublicPage) => void
  onDemoSignIn: () => void
  children: React.ReactNode
}) {
  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-alt)' }}>
      <header style={{ background: 'var(--brand-navy)', position: 'sticky', top: 0, zIndex: 100 }}>
        <div className="container" style={{ display: 'flex', alignItems: 'center', gap: '24px', height: '64px' }}>
          <button onClick={() => onNavigate('landing')} style={{ display: 'flex', alignItems: 'center', flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer' }}>
            <img src="/assets/brand/6d-logo-white.png" alt="6D Marketplace — home" style={{ height: '32px' }} />
          </button>

          <nav style={{ display: 'flex', gap: '4px', flex: 1 }} aria-label="Audiences">
            {NAV.map(n => (
              <button
                key={n.id}
                onClick={() => onNavigate(n.id)}
                aria-current={page === n.id ? 'page' : undefined}
                style={{
                  padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius)',
                  border: 'none', cursor: 'pointer', fontSize: 'var(--text-sm)', fontWeight: 600,
                  background: page === n.id ? 'rgba(255,255,255,0.14)' : 'transparent',
                  color: page === n.id ? 'white' : 'rgba(255,255,255,0.85)',
                  transition: 'background 150ms ease',
                }}
                onMouseEnter={e => { if (page !== n.id) e.currentTarget.style.background = 'rgba(255,255,255,0.08)' }}
                onMouseLeave={e => { if (page !== n.id) e.currentTarget.style.background = 'transparent' }}
              >
                {n.label}
              </button>
            ))}
          </nav>

          <button
            onClick={onDemoSignIn}
            style={{
              padding: 'var(--space-2) var(--space-5)', borderRadius: 'var(--radius)',
              border: '1px solid rgba(255,255,255,0.25)', background: 'transparent',
              color: 'white', fontSize: 'var(--text-sm)', fontWeight: 600, cursor: 'pointer', flexShrink: 0,
            }}
          >
            Demo sign-in
          </button>
        </div>
      </header>

      <main style={{ flex: 1 }}>{children}</main>

      <footer style={{ background: 'var(--brand-navy-dark)', color: 'rgba(255,255,255,0.7)' }}>
        <div className="container" style={{ padding: '32px 24px', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '16px' }}>
          <span style={{ fontSize: 'var(--text-sm)' }}>© 2026 6D Marketplace · India · UAE · Kenya</span>
          <button onClick={onDemoSignIn} style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.7)', fontSize: 'var(--text-sm)', cursor: 'pointer', padding: 0 }}>
            Demo sign-in
          </button>
        </div>
      </footer>
    </div>
  )
}
```

- [ ] **Step 3: Rewire `App.tsx`**

Replace the session state (currently `const [session, setSession] = useState<Session | null>(null)`) with:

```tsx
const [surface, setSurface] = useState<Surface>({ kind: 'public', page: 'landing' })
const session = surface.kind === 'session' ? surface.session : null
const persona = session?.persona ?? null
```

Add `Surface`, `PublicPage` to the type import from `./types/view`.

Change `handleLogin` to set the surface:

```tsx
const handleLogin = (s: Session) => {
  setSurface({ kind: 'session', session: s })
  if (s.persona === 'operator') setOpView('op-dashboard')
  else if (s.persona === 'partner') setPtView('pt-dashboard')
  else if (s.persona === 'enterprise') setEnView('en-dashboard')
  else setView('home')
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
```

Change `handleSignOut` to return to the landing page rather than the login screen:

```tsx
const handleSignOut = () => {
  setSurface({ kind: 'public', page: 'landing' })
  setView('home')
  setOpView('op-dashboard'); setPtView('pt-dashboard'); setEnView('en-dashboard')
  window.scrollTo({ top: 0, behavior: 'smooth' })
}
```

Replace the `if (!persona) return <LoginScreen … />` block with:

```tsx
if (surface.kind === 'login') {
  return <LoginScreen onLogin={handleLogin} />
}

if (surface.kind === 'public') {
  return (
    <PublicShell
      page={surface.page}
      onNavigate={(page) => { setSurface({ kind: 'public', page }); window.scrollTo({ top: 0 }) }}
      onDemoSignIn={() => setSurface({ kind: 'login' })}
    >
      <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>
        {surface.page} page
      </div>
    </PublicShell>
  )
}
```

The placeholder body is replaced in Tasks 5 and 6. Add the import: `import { PublicShell } from './components/public/PublicShell'`.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npm test && npm run build
```
Expected: 0 errors; 57 tests; build succeeds.

- [ ] **Step 5: Check it in the browser**

Run `npm run dev`. Expected: the app opens on a navy-headed public shell reading "landing page", the three nav buttons switch the placeholder text and mark themselves current, and **Demo sign-in opens the existing four-card login unchanged**. Sign in as any persona and confirm the console still works; sign out and confirm you land back on the public page, not the login screen.

- [ ] **Step 6: Commit**

```bash
git add src/types/view.ts src/App.tsx src/components/public/PublicShell.tsx
git commit -m "Add the public surface and its shell

The app now opens on a public page rather than the persona login. No router
— the existing state machine gains a Surface, so no console changes. The
four-card login is unchanged and reachable as Demo sign-in."
```

---

## Task 5: The carousel component and product rail

**Files:**
- Create: `src/components/public/Carousel.tsx`
- Create: `src/components/public/ProductRail.tsx`

**Interfaces:**
- Consumes: `nextIndex`, `prevIndex`, `shouldAdvance`, `SLIDE_MS` (Task 2); `ProductTile` (Task 1).
- Produces:
  ```tsx
  export function Carousel(props: { slides: readonly string[]; alt?: string }): JSX.Element
  export function ProductRail(props: { title: string; subtitle?: string; tiles: readonly ProductTile[] }): JSX.Element
  ```

- [ ] **Step 1: Write the carousel**

Create `src/components/public/Carousel.tsx`:

```tsx
import { useState, useEffect, useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { nextIndex, prevIndex, shouldAdvance, SLIDE_MS } from '../../lib/carousel'

export function Carousel({ slides, alt = 'Marketplace highlight' }: {
  slides: readonly string[]
  alt?: string
}) {
  const [index, setIndex] = useState(0)
  const [paused, setPaused] = useState(false)
  const reduced = useRef(false)

  useEffect(() => {
    reduced.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  useEffect(() => {
    const state = { index, count: slides.length, paused }
    if (!shouldAdvance(state, reduced.current)) return
    const t = setTimeout(() => setIndex(nextIndex(state)), SLIDE_MS)
    return () => clearTimeout(t)
  }, [index, paused, slides.length])

  if (slides.length === 0) return <></>

  const state = { index, count: slides.length, paused }

  return (
    <div
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label={alt}
      style={{ position: 'relative', overflow: 'hidden', borderRadius: 'var(--radius-lg)' }}
    >
      <div style={{ display: 'flex', gap: '16px', padding: '4px', transition: reduced.current ? 'none' : 'transform 400ms ease', transform: `translateX(calc(${-index} * (240px + 16px)))` }}>
        {slides.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            loading={i === 0 ? 'eager' : 'lazy'}
            aria-hidden={i !== index}
            style={{ width: '240px', height: '400px', objectFit: 'cover', borderRadius: 'var(--radius-md)', flexShrink: 0 }}
          />
        ))}
      </div>

      {/* Announced politely so a screen reader is told the slide changed
          without interrupting whatever it is currently reading. */}
      <div aria-live="polite" className="sr-only">Slide {index + 1} of {slides.length}</div>

      <button onClick={() => setIndex(prevIndex(state))} aria-label="Previous slide" style={arrow('left')}>
        <ChevronLeft size={20} />
      </button>
      <button onClick={() => setIndex(nextIndex(state))} aria-label="Next slide" style={arrow('right')}>
        <ChevronRight size={20} />
      </button>

      <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', padding: '12px' }}>
        {slides.map((_, i) => (
          <button
            key={i}
            onClick={() => setIndex(i)}
            aria-label={`Go to slide ${i + 1}`}
            aria-current={i === index ? 'true' : undefined}
            style={{
              width: i === index ? '24px' : '8px', height: '8px', borderRadius: '4px', border: 'none',
              background: i === index ? 'var(--brand-accent-dark)' : 'var(--border)',
              cursor: 'pointer', transition: 'width 200ms ease',
            }}
          />
        ))}
      </div>
    </div>
  )
}

const arrow = (side: 'left' | 'right'): React.CSSProperties => ({
  position: 'absolute', top: '40%', [side]: '8px',
  width: '36px', height: '36px', borderRadius: '50%', border: 'none',
  background: 'rgba(255,255,255,0.92)', color: 'var(--text)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  cursor: 'pointer', boxShadow: 'var(--shadow-md)',
})
```

- [ ] **Step 2: Write the product rail**

Create `src/components/public/ProductRail.tsx`:

```tsx
import type { ProductTile } from '../../lib/assets'

export function ProductRail({ title, subtitle, tiles }: {
  title: string
  subtitle?: string
  tiles: readonly ProductTile[]
}) {
  return (
    <section className="container" style={{ padding: '40px 24px' }}>
      <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 800, color: 'var(--text)' }}>{title}</h2>
      {subtitle && <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)', marginTop: '4px' }}>{subtitle}</p>}

      <div style={{ display: 'flex', gap: '16px', overflowX: 'auto', paddingBottom: '12px', marginTop: '20px', scrollSnapType: 'x mandatory' }}>
        {tiles.map(t => (
          <div key={t.src} className="card card-hover" style={{ flexShrink: 0, width: '200px', scrollSnapAlign: 'start' }}>
            <img src={t.src} alt={t.alt} loading="lazy" style={{ width: '100%', height: '150px', objectFit: 'cover' }} />
            <div style={{ padding: '12px' }}>
              <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600, color: 'var(--text)' }}>{t.alt}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit && npm test && npm run build
```
Expected: 0 errors; 57 tests; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/components/public/Carousel.tsx src/components/public/ProductRail.tsx
git commit -m "Add the carousel and product rail

Carousel pauses on hover and focus, refuses auto-advance under reduced
motion, and announces slide changes politely. Rail tiles carry the alt text
the manifest generated."
```

---

## Task 6: The landing page

**Files:**
- Create: `src/components/public/LandingPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `Carousel`, `ProductRail` (Task 5); the manifest (Task 1).
- Produces: `export function LandingPage(props: { onNavigate: (p: PublicPage) => void }): JSX.Element`

- [ ] **Step 1: Write the page**

Create `src/components/public/LandingPage.tsx`:

```tsx
import { Carousel } from './Carousel'
import { ProductRail } from './ProductRail'
import { HERO, CAROUSEL, BANNERS, RETAIL_PRODUCTS, ENTERPRISE_PRODUCTS } from '../../lib/assets'
import type { PublicPage } from '../../types/view'

export function LandingPage({ onNavigate }: { onNavigate: (p: PublicPage) => void }) {
  return (
    <>
      {/* Hero */}
      <section style={{ position: 'relative', background: 'var(--brand-navy)', color: 'white', overflow: 'hidden' }}>
        <img src={HERO} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.25 }} />
        <div className="container" style={{ position: 'relative', padding: '64px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '48px', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 'var(--text-5xl)', fontWeight: 800, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
              One marketplace.<br />Every kind of buyer.
            </h1>
            <p style={{ fontSize: 'var(--text-lg)', color: 'rgba(255,255,255,0.75)', marginTop: '20px', maxWidth: '460px' }}>
              Plans, devices, security and IoT — sold by verified partners, settled by the marketplace,
              across India, UAE and Kenya.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '32px', flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-lg" onClick={() => onNavigate('retail')}>Shop retail</button>
              <button className="btn btn-secondary btn-lg" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', borderColor: 'rgba(255,255,255,0.2)' }} onClick={() => onNavigate('enterprise')}>
                For business
              </button>
              <button className="btn btn-secondary btn-lg" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', borderColor: 'rgba(255,255,255,0.2)' }} onClick={() => onNavigate('partner')}>
                Sell with us
              </button>
            </div>
          </div>
          <Carousel slides={CAROUSEL} alt="What you can buy here" />
        </div>
      </section>

      {/* Promo strip — 4 of the 12 banners */}
      <section className="container" style={{ padding: '32px 24px', display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px' }}>
        {BANNERS.slice(0, 4).map(src => (
          <img key={src} src={src} alt="" loading="lazy" style={{ width: '100%', borderRadius: 'var(--radius-md)' }} />
        ))}
      </section>

      <ProductRail title="Retail products" subtitle="Phones, wearables, entertainment and connected home" tiles={RETAIL_PRODUCTS} />
      <ProductRail title="Enterprise products" subtitle="IoT gateways, sensors, security and point of sale" tiles={ENTERPRISE_PRODUCTS} />
    </>
  )
}
```

- [ ] **Step 2: Render it from `App.tsx`**

Replace the placeholder body in the `surface.kind === 'public'` block:

```tsx
{surface.page === 'landing' && <LandingPage onNavigate={(page) => { setSurface({ kind: 'public', page }); window.scrollTo({ top: 0 }) }} />}
{surface.page !== 'landing' && (
  <div style={{ padding: '48px 0', textAlign: 'center', color: 'var(--text-secondary)' }}>{surface.page} page</div>
)}
```

Add: `import { LandingPage } from './components/public/LandingPage'`.

- [ ] **Step 3: Verify and look at it**

```bash
npx tsc --noEmit && npm test && npm run build
```
Expected: 0 errors; 57 tests; build succeeds.

Then `npm run dev` and confirm on the landing page: the hero renders with the carousel beside it, the carousel advances and stops when you hover it, four banners appear, and both product rails scroll horizontally with images and labels.

- [ ] **Step 4: Commit**

```bash
git add src/components/public/LandingPage.tsx src/App.tsx
git commit -m "Add the landing page

Hero with carousel, a four-banner promo strip, and Retail then Enterprise
product rails as two labelled sections."
```

---

## Task 7: The three audience pages

**Files:**
- Create: `src/components/public/AudiencePage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `ProductRail` (Task 5); the manifest (Task 1); `Session` from `src/types/view.ts`.
- Produces: `export function AudiencePage(props: { page: Exclude<PublicPage,'landing'>; onSignIn: (s: Session) => void; onApply: () => void }): JSX.Element`

**One component, three configurations.** They differ in copy, imagery and destination — not structure. Three components would drift.

- [ ] **Step 1: Write it**

Create `src/components/public/AudiencePage.tsx`:

```tsx
import { ProductRail } from './ProductRail'
import { BANNERS, RETAIL_PRODUCTS, ENTERPRISE_PRODUCTS, DEVICE_THUMBS } from '../../lib/assets'
import type { PublicPage, Session } from '../../types/view'

type Aud = Exclude<PublicPage, 'landing'>

const CONFIG: Record<Aud, {
  title: string; blurb: string; points: string[]
  cta: string; banner: string
  rail: { title: string; subtitle: string; tiles: readonly { src: string; alt: string }[] }
  session: Session
}> = {
  retail: {
    title: 'Everything for your everyday connection',
    blurb: 'Plans, phones, entertainment and home devices — bought in one place, billed in one place.',
    points: ['Plans and devices side by side', 'Reward points on every order', 'One bill, one support queue'],
    cta: 'Start shopping',
    banner: BANNERS[1],
    rail: { title: 'Popular with shoppers', subtitle: 'Phones, wearables and entertainment', tiles: RETAIL_PRODUCTS },
    session: { persona: 'consumer' },
  },
  enterprise: {
    title: 'Procure connected hardware with approvals built in',
    blurb: 'IoT, security and devices for your estate — with spend limits, approval thresholds and one point of settlement.',
    points: ['Approval workflow before spend', 'Contract pricing on committed volume', 'Consolidated invoicing across sellers'],
    cta: 'Sign in to procure',
    banner: BANNERS[5],
    rail: { title: 'Built for business', subtitle: 'Gateways, sensors, security and point of sale', tiles: ENTERPRISE_PRODUCTS },
    session: { persona: 'enterprise' },
  },
  partner: {
    title: 'Sell to consumers and enterprises on one marketplace',
    blurb: 'List once, reach retail shoppers and business buyers, and get settled on a published cycle.',
    points: ['Seven onboarding gates, five working days', 'Commission published before you list', 'Settlement you can reconcile line by line'],
    cta: 'Sign in to your seller console',
    banner: BANNERS[3],
    rail: { title: 'What sells here', subtitle: 'Categories open to new sellers', tiles: ENTERPRISE_PRODUCTS },
    session: { persona: 'partner', partnerId: 'PTR-1004' },
  },
}

export function AudiencePage({ page, onSignIn, onApply }: {
  page: Aud
  onSignIn: (s: Session) => void
  onApply: () => void
}) {
  const c = CONFIG[page]
  return (
    <>
      <section style={{ background: 'var(--brand-navy)', color: 'white' }}>
        <div className="container" style={{ padding: '56px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '40px', alignItems: 'center' }}>
          <div>
            <h1 style={{ fontSize: 'var(--text-4xl)', fontWeight: 800, lineHeight: 1.15 }}>{c.title}</h1>
            <p style={{ fontSize: 'var(--text-lg)', color: 'rgba(255,255,255,0.75)', marginTop: '16px' }}>{c.blurb}</p>
            <ul style={{ listStyle: 'none', margin: '24px 0 0', padding: 0, display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {c.points.map(p => (
                <li key={p} style={{ fontSize: 'var(--text-sm)', color: 'rgba(255,255,255,0.85)' }}>— {p}</li>
              ))}
            </ul>
            <div style={{ display: 'flex', gap: '12px', marginTop: '32px', flexWrap: 'wrap' }}>
              <button className="btn btn-primary btn-lg" onClick={() => onSignIn(c.session)}>{c.cta}</button>
              {page === 'partner' && (
                <button className="btn btn-secondary btn-lg" style={{ background: 'rgba(255,255,255,0.1)', color: 'white', borderColor: 'rgba(255,255,255,0.2)' }} onClick={onApply}>
                  Apply to sell
                </button>
              )}
            </div>
          </div>
          <img src={c.banner} alt="" style={{ width: '100%', borderRadius: 'var(--radius-lg)' }} />
        </div>
      </section>

      <ProductRail title={c.rail.title} subtitle={c.rail.subtitle} tiles={c.rail.tiles} />

      <section className="container" style={{ padding: '8px 24px 48px', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
        {DEVICE_THUMBS.slice(page === 'retail' ? 0 : 18, page === 'retail' ? 3 : 21).map(src => (
          <img key={src} src={src} alt="" loading="lazy" style={{ width: '100%', borderRadius: 'var(--radius-md)' }} />
        ))}
      </section>
    </>
  )
}
```

- [ ] **Step 2: Render it from `App.tsx`**

Replace the non-landing placeholder:

```tsx
{surface.page !== 'landing' && (
  <AudiencePage
    page={surface.page}
    onSignIn={handleLogin}
    onApply={() => { handleLogin({ persona: 'partner', partnerId: 'PTR-1004' }); setPtView('pt-onboarding') }}
  />
)}
```

Add: `import { AudiencePage } from './components/public/AudiencePage'`.

`handleLogin` already takes a `Session` and sets the console's opening view, so signing in from an audience page follows exactly the path the login screen follows.

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit && npm test && npm run build
```
Expected: 0 errors; 57 tests; build succeeds.

- [ ] **Step 4: Walk the whole thing in the browser**

`npm run dev`, then confirm each of these:

| Action | Expected |
|---|---|
| App loads | Landing page, not the login screen |
| Click **Retail** | Retail page; **Start shopping** opens the consumer storefront |
| Click **Enterprise** | Enterprise page; its CTA opens the enterprise portal |
| Click **Partners** | Partner page; its CTA opens the seller console |
| Partner page → **Apply to sell** | Seller console open on its **Onboarding** screen |
| **Demo sign-in** | The four-card login, unchanged |
| Sign out of any console | Back to the landing page |

- [ ] **Step 5: Measure the above-the-fold payload**

With the dev server running, open the landing page, open DevTools → Network, filter to Img, and hard-reload. Sum the transferred bytes for images loaded before you scroll.

Expected: **under 400 KB**. If it exceeds that, the likely cause is the carousel loading all five slides eagerly — confirm only the first has `loading="eager"`.

- [ ] **Step 6: Commit and push**

```bash
git add src/components/public/AudiencePage.tsx src/App.tsx
git commit -m "Add the three audience pages

One component, three configurations — they differ in copy, imagery and
destination, not structure. Each signs into its console with the same
Session shape the login screen produces; the partner page also routes
straight to onboarding."
git push origin Claude
```

---

## Self-Review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §2 four pages, shared shell, Demo sign-in | 4, 6, 7 |
| §3 pipeline, detected geometry, budget, manifest, gitignore | 1 |
| §3 which set feeds which rail | 1 (retail from thumbs, enterprise from photographs) |
| §4 Surface state, no router, no console changes | 4 |
| §5 carousel: pause, reduced motion, keyboard, announce | 2, 5 |
| §6 landing content and audience content | 6, 7 |
| §7 carousel tests, manifest integrity, surface transitions | 2, 3, 7 (step 4) |
| §8 out of scope | nothing added |

**Placeholder scan:** no TBD/TODO. Every code step carries real code; every command carries its expected output.

**Type consistency:** `ProductTile` is defined once in the generated manifest and imported by `ProductRail` and `AudiencePage`. `PublicPage` and `Surface` are defined in `types/view.ts` and used unchanged. `CarouselState` is used only inside `carousel.ts` and its component. `handleLogin(s: Session)` keeps its signature at every call site — login screen, audience page, and the apply route.

**One pre-existing bug fixed in passing.** `/assets/brand/6d-logo-white.png` is referenced by
`Header.tsx:78`, `Footer.tsx:18` and `EnterpriseShell.tsx:70` as a plain `<img src>`, which Vite
does not rewrite. The file lives at the repo root under `assets/brand/`, not under `public/`, so
`dist/assets/brand/` contains only `image.png` and the logo 404s in a production build. It renders
in dev because Vite's dev server also serves the project root, which is why nobody has noticed.
Task 1 copies both marks into `public/`, since making assets shippable is exactly that task's job.

**Two plan bugs found in the pre-flight scan and fixed before execution:**

1. `sliceGrid` short-circuited row detection for single-row sheets, taking the sheet's full height.
   That keeps the top and bottom margin, so every carousel card would have carried a navy band.
   Both axes are now detected on every sheet.
2. Alt text was derived from the source filename, but those filenames are truncated mid-word —
   `..._a_compact_GPS_t-1785312585611.png` yields "compact GPS t". The twelve enterprise products
   are now chosen by an identifying fragment and paired with written alt text, and the manifest
   test requires a whole final word rather than merely a non-empty string.

**Three risks worth naming:**

1. **The geometry detector may not find the right cell count first time.** Task 1 Step 3 makes it throw rather than silently produce wrong slices, and Step 4 requires looking at the output. That is the mitigation; there is no way to be certain without running it against the real files.
2. **Test counts assume 39 passing today.** If that has drifted, the expected numbers in Tasks 2 and 3 shift by the same amount — the ratios (12 new carousel tests, 6 new manifest tests) are what matter.
3. **`AudiencePage`'s partner config hardcodes `PTR-1004`.** That is the same demo identity `LoginScreen` already uses, so it is consistent rather than invented — but it is a constant that will need replacing when real authentication arrives.
