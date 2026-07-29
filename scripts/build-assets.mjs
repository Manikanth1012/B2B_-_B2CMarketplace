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
   Find runs along one axis where pixels differ from the corner background.

   Tuning note: a single scanline through the sheet's midpoint is not enough.
   On Coroussels.png a dark region inside a card (a photo/UI panel) happens
   to match the sheet's navy background closely enough at y=height/2 to read
   as "off", splitting one card into two false runs — no threshold/minRun
   pair fixes that while sampling only one line, because the false gap and
   the real gaps are both within a few units of each other in diff magnitude.
   Instead, project across the *entire* perpendicular axis: a position only
   counts as background if EVERY pixel along that line is close to bg. This
   keeps the same "differs from corner background" detector, just sampling
   every row/column instead of one, and it resolves all four sheets cleanly
   at the original default threshold=28, minRun=40. */
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

  const on = new Array(along).fill(false)
  for (let c = 0; c < across; c++) {
    for (let i = 0; i < along; i++) {
      const p = axis === 'x' ? at(i, c) : at(c, i)
      if (diff(p) > threshold) on[i] = true
    }
  }

  const runs = []
  let start = null
  for (let i = 0; i < along; i++) {
    if (on[i] && start === null) start = i
    if (!on[i] && start !== null) {
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
  ['full-size_rac', 'Full-size server rack'],
  ['EV_cha',  'EV charging point'],
  ['POS_te',  'Point-of-sale terminal'],
  ['NFC_pa',  'NFC contactless payment reader'],
]

const files = readdirSync(SRC).filter((f) => f.startsWith('Professional_')).sort()
const enterprise = []
for (const [i, [fragment, alt]] of ENTERPRISE_PICKS.entries()) {
  const matches = files.filter((x) => x.includes(fragment))
  if (matches.length !== 1) {
    throw new Error(`fragment "${fragment}" matched ${matches.length} files, expected exactly 1: ${matches.join(', ')}`)
  }
  const f = matches[0]
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
