---
name: run-app
description: Launch and drive the Aventa marketplace app (Vite + React + Supabase) to see a change working in a browser. Use when asked to run, start, serve, screenshot, or click through the app, or to confirm a change works in the real UI rather than only in tests. Covers the normal dev-server path and the same-origin proxy needed in sandboxes whose browser cannot reach Supabase.
---

# Running the marketplace app

Vite + React 18 + TypeScript, talking to a hosted Supabase project. There is no
local database and no backend of our own — `npm run dev` is the whole app.

## Environment

Two variables, read at **build/dev-server start time** (they are `import.meta.env`,
baked into the bundle — changing them needs a restart, not a page refresh):

```
VITE_SUPABASE_URL       https://<ref>.supabase.co
VITE_SUPABASE_ANON_KEY  <the project anon key>
```

`src/lib/supabase.ts` throws on startup if either is missing, so a blank white page
with `Missing Supabase environment variables` in the console means the env, not the code.

## Path 1 — the normal one

```bash
npm install          # first time only
npm run dev          # http://localhost:5173
```

This is correct on any machine whose browser can reach the Supabase host. Use it
unless you have proved otherwise.

## Path 2 — when the browser cannot reach Supabase

Some sandboxes and CI containers (Claude Code's remote environment among them) allow
Node's egress but reset the browser's. The symptom is specific and easy to
misdiagnose:

- the page renders — header, hero, carousel, footer, all the local artwork
- **every data-driven band is empty**: no promo strip, no category rails, no products
- the console shows `net::ERR_CONNECTION_RESET` for the Supabase host
- `curl` to the same host from the same container **works**, and so do the
  integration tests

That is not a bug in the app. Do not go looking for one. Use the bundled proxy:

```bash
VITE_SUPABASE_URL="http://127.0.0.1:4180/sb" npm run build
SUPABASE_UPSTREAM="https://<ref>.supabase.co" node scripts/dev-proxy.mjs
# -> http://127.0.0.1:4180
```

`scripts/dev-proxy.mjs` serves `dist/` and forwards `/sb/*` to the real project from
Node. Everything the browser touches is then `127.0.0.1`, so there is no CORS to
satisfy and no certificate to trust. It is a harness, not part of the app — never
build the deployable bundle with `VITE_SUPABASE_URL` pointed at it.

## Driving it

Chromium is preinstalled; **do not run `playwright install`**.

```js
import { chromium } from 'playwright'
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-sandbox'],
})
```

Sign in through the login screen rather than faking a session — the app derives the
persona from the JWT, and every table is behind RLS keyed to it. Click **Demo
sign-in** in the header (not the footer, which has no sign-in), then the persona
card, then **Sign In**. Credentials are pre-filled; they are in
`src/components/LoginScreen.tsx`.

Selectors that hold up:

| Target | Selector |
|---|---|
| Enter the login flow | `getByRole('button', { name: 'Demo sign-in' })` |
| Persona card | `locator('button').filter({ hasText: 'Operator Admin' })` — or `Consumer`, `Partner / Seller`, `Enterprise Buyer` |
| Submit | `getByRole('button', { name: /^Sign In/i })` |
| Promo strip | `section[aria-label="Marketplace offers"] button` |
| Console nav | `nav button`, `aside button` |
| Product cards | `article` |

Allow ~3.5s after submitting; sign-in is a real network round trip.

## What a healthy run looks like

Signed out, on the landing page: **4 promo tiles, 7 category tiles**. On
`/retail`: **12 product cards**. Zero 4xx/5xx from `/rest/v1/`.

Empty rails plus a clean console almost always means path 2, not a regression.

## Noise to ignore

These fail in restricted environments and are **not** your change breaking:

- `fonts.googleapis.com` — `ERR_CONNECTION_RESET`
- `images.pexels.com` — `ERR_TUNNEL_CONNECTION_FAILED`. Product and category
  photography comes from `src/lib/images.ts`, which points at Pexels, so cards
  render with blank image areas here. The `src` attributes are still correct and
  worth asserting on when the pixels are unavailable.

## Don't

- Don't add a cart row, clear a gate, or sign up a user against the live project
  without deleting it afterwards — `npm run test:integration` runs against the same
  data, and the demo personas are seeded, not disposable.
- Don't work around a blocked host by disabling TLS verification or unsetting
  `HTTPS_PROXY`.
