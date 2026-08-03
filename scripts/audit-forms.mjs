/* Finds form controls drawn flush against the box that contains them.
 *
 * Run against the dev proxy, which serves dist/ and forwards /sb to Supabase:
 *
 *   VITE_SUPABASE_URL="http://127.0.0.1:4180/sb" npm run build
 *   SUPABASE_UPSTREAM="https://<ref>.supabase.co" node scripts/dev-proxy.mjs &
 *   node scripts/audit-forms.mjs
 *
 * The defect it exists for: a card's body has no padding — right for a table,
 * whose cells carry their own inset, and wrong for a form. The input's border
 * lands on the card's border and the two read as one merged edge. That is not
 * something you spot by scrolling; it is something you spot by measuring, which
 * is what this does.
 *
 * It also catches the neighbouring failure: a label whose box overlaps the
 * control above it. Both are "boxes merging", and both are geometry rather than
 * taste.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://127.0.0.1:4180'

/* Under this many pixels between a control's edge and its card's edge and the
   two borders are visually one line. Ten is the smallest inset that still reads
   as deliberate at these radii. */
const FLUSH = 10

const WHO = {
  operator: {
    card: 'Operator Admin',
    screens: ['Bill Templates', 'Collections', 'Knowledge base', 'Notifications',
              'Storefront Banners', 'Roles & Users', 'Markets & Currencies', 'Promotions'],
  },
  partner: {
    card: 'Partner / Seller',
    screens: ['New Listing', 'Disputes & Support', 'Notifications', 'My Details'],
  },
  enterprise: {
    card: 'Enterprise Buyer',
    screens: ['Approvals', 'Refunds', 'Support', 'Notifications', 'Team & Roles', 'My Details', 'Wallet'],
  },
  consumer: {
    card: 'Consumer',
    screens: ['My Orders', 'Rewards'],
    menu: { open: 'PR', items: ['My details', 'Wallet', 'Sign-in & security', 'Notification preferences'] },
  },
}

/* Anything that opens a form the screen does not show at rest. Clicked if
   present, because half these forms live in a dialog and a sweep that only
   looks at what is already on screen finds none of them. */
const OPENERS = /^(new|add|create|propose|invite|raise|write|compose|edit|change|top up|request)/i

/* The sidebar is 256px wide and several of its items read like openers — "New
   Listing" is a screen, not a dialog — so clicking one navigates away
   mid-sweep. Excluded by where they sit rather than by name, which does not
   need a list keeping up to date. */
const SIDEBAR = 260

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-proxy-server'],
})

const measure = (page, flush) => page.evaluate(({ FLUSH }) => {
  const out = []
  const boxOf = (el) => {
    /* The nearest ancestor that draws a border or a background — the thing the
       control can collide with. */
    let p = el.parentElement
    while (p && p !== document.body) {
      const s = getComputedStyle(p)
      const bordered = s.borderTopWidth !== '0px' || s.borderLeftWidth !== '0px'
      if (bordered && p.getBoundingClientRect().width > el.getBoundingClientRect().width) return p
      p = p.parentElement
    }
    return null
  }

  for (const el of document.querySelectorAll('input, select, textarea')) {
    const r = el.getBoundingClientRect()
    if (r.width < 40 || r.height < 12) continue
    if (el.type === 'checkbox' || el.type === 'radio') continue

    const card = boxOf(el)
    if (!card) continue
    const c = card.getBoundingClientRect()
    const left = Math.round(r.left - c.left)
    const right = Math.round(c.right - r.right)
    if (left < FLUSH || right < FLUSH) {
      out.push({
        kind: 'flush',
        what: (el.getAttribute('aria-label') || el.previousElementSibling?.textContent || el.name || el.tagName).trim().slice(0, 44),
        left, right,
      })
    }
  }

  /* A label whose box overlaps a control it shares a layer with.
   *
   * The layer matters. A dialog sits on top of the page it was opened from, so
   * every label behind it overlaps something inside it — that is what a modal
   * is, not a defect. The first run reported three of those on the seller's My
   * Details and they were all the page showing through. Comparing only within
   * the same dialog (or only outside all of them) leaves the real case: two
   * things laid out side by side that were meant to be one above the other. */
  const layerOf = (el) => el.closest('[role="dialog"]') ?? document.body
  const controls = [...document.querySelectorAll('input, select, textarea')]
  for (const l of document.querySelectorAll('label')) {
    const lr = l.getBoundingClientRect()
    if (lr.height === 0) continue
    for (const el of controls) {
      if (layerOf(el) !== layerOf(l)) continue
      const r = el.getBoundingClientRect()
      if (r.height === 0) continue
      const overlapsY = lr.top < r.bottom - 1 && lr.bottom > r.top + 1
      const overlapsX = lr.left < r.right - 1 && lr.right > r.left + 1
      if (overlapsY && overlapsX && !el.contains(l) && !l.contains(el)) {
        out.push({ kind: 'overlap', what: l.textContent.trim().slice(0, 44), left: 0, right: 0 })
        break
      }
    }
  }
  return out
}, { FLUSH: flush })

let total = 0
/* Counted so "ok" can mean "I opened N forms and every control was inset",
   rather than "I found nothing". */
let opened = 0

for (const [persona, who] of Object.entries(WHO)) {
  const page = await b.newPage({ viewport: { width: 1440, height: 1100 } })
  await page.goto(BASE, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Demo sign-in/i }).first().click()
  await page.getByText(who.card, { exact: true }).first().click()
  await page.getByRole('button', { name: /Sign In/i }).last().click()
  await page.waitForTimeout(2600)

  console.log(`\n######## ${persona.toUpperCase()} ########`)

  const visit = async (label, open) => {
    try {
      if (open) {
        await page.getByText(who.menu.open, { exact: true }).first().click()
        await page.waitForTimeout(400)
      }
      const nav = page.getByText(new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)).first()
      if (!(await nav.count())) { console.log(`  ?  ${label} — no such nav item`); return }
      await nav.click()
      await page.waitForFunction(
        () => !document.querySelector('.spinner') && document.body.innerText.trim().length > 300,
        null, { timeout: 12000 },
      ).catch(() => {})
      await page.waitForTimeout(700)

      let found = await measure(page, FLUSH)

      /* And the forms that only exist once something is clicked.
       *
       * Filtered *before* the cap, not after. The first run capped at the first
       * twenty-four buttons on the page — every one of which is a nav item, so
       * it never reached "New article" at index twenty-nine and reported every
       * screen clean while opening no form at all. A sweep that finds nothing
       * to check is not a sweep that passed. */
      const all = await page.getByRole('button').all()
      const openers = []
      for (const btn of all) {
        const text = ((await btn.textContent()) ?? '').trim()
        if (!OPENERS.test(text)) continue
        const box = await btn.boundingBox()
        if (!box || box.x < SIDEBAR) continue
        openers.push([btn, text])
      }
      opened += openers.length
      for (const [btn, text] of openers.slice(0, 8)) {
        try {
          await btn.click({ timeout: 1500 })
          await page.waitForTimeout(600)
          found = found.concat((await measure(page, FLUSH)).map(f => ({ ...f, via: text })))
          await page.keyboard.press('Escape')
          await page.waitForTimeout(300)
        } catch { /* not clickable from here */ }
      }

      if (!found.length) { console.log(`  ok ${label} — ${openers.length} form${openers.length === 1 ? '' : 's'} opened`); return }
      const seen = new Set()
      const rows = found.filter(f => {
        const k = `${f.kind}|${f.what}|${f.left}|${f.right}`
        if (seen.has(k)) return false
        seen.add(k); return true
      })
      total += rows.length
      console.log(`  ✗  ${label} — ${rows.length}`)
      for (const r of rows) {
        console.log(r.kind === 'flush'
          ? `       flush: "${r.what}" left ${r.left}px right ${r.right}px${r.via ? ` (via ${r.via})` : ''}`
          : `       overlap: "${r.what}"${r.via ? ` (via ${r.via})` : ''}`)
      }
    } catch (e) {
      console.log(`  !  ${label} — ${String(e).split('\n')[0].slice(0, 90)}`)
    }
  }

  for (const s of who.screens) await visit(s, false)
  for (const s of who.menu?.items ?? []) await visit(s, true)

  await page.close()
}

console.log(`\nTOTAL FORM DEFECTS: ${total} — after opening ${opened} forms`)
if (opened === 0) {
  console.log('NOTHING WAS OPENED. A sweep that checks nothing passes for the wrong reason.')
  process.exitCode = 1
}
await b.close()
