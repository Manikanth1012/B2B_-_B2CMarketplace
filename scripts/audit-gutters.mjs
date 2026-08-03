/* Cards sitting flush against the edge of the page.
 *
 * The third mechanical sweep, after `audit-tables.mjs` (layout inside a table)
 * and `audit-forms.mjs` (spacing inside a form). This one measures the outside:
 * whether a card keeps a gutter between itself and the edge of the page.
 *
 * The bug it exists to catch is invisible at a wide window and obvious at a
 * narrow one. `.container` carries the gutter as horizontal padding, and a
 * `style={{ padding: '32px 0' }}` on the same element replaces the shorthand
 * entirely — top and bottom get 32px and 0, and left and right get 0. At 1500px
 * the max-width leaves slack on both sides so nothing looks wrong; below it the
 * cards go hard against the window while the header above them, which did not
 * override anything, stays inset.
 *
 * So it runs narrow by default. A sweep at a width where the defect cannot
 * appear is a sweep that reports clean and means nothing.
 *
 *   VITE_SUPABASE_URL="http://127.0.0.1:4180/sb" npm run build
 *   SUPABASE_UPSTREAM="https://<ref>.supabase.co" node scripts/dev-proxy.mjs &
 *   node scripts/audit-gutters.mjs                 # every persona at 900px
 *   node scripts/audit-gutters.mjs consumer 1280
 */
import { chromium } from 'playwright'

/* Below this, a card is touching the edge. The narrowest gutter the stylesheet
   ever asks for is --space-4 (16px), so 12 catches flush without catching a
   deliberately tight one. */
const GUTTER = 12

const AUDIT = (gutter) => {
  const out = { flush: [], wide: [] }
  const seen = new Set()
  const W = document.documentElement.clientWidth

  const describe = (el) => {
    const head = el.querySelector('h1, h2, h3, strong, [style*="font-weight: 7"], [style*="font-weight: 8"]')
    const t = (head?.textContent ?? el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 44)
    return t || el.tagName.toLowerCase()
  }

  /* A card is something drawn as a surface: it has a border or a shadow and a
     background of its own. Looked for by computed style rather than by class
     name — half these screens style inline, so a class-name search would report
     clean while walking past most of the page. */
  const isCard = (el) => {
    const s = getComputedStyle(el)
    if (s.display === 'none' || s.visibility === 'hidden') return false
    const bordered = parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderLeftWidth) > 0
    const raised = s.boxShadow !== 'none'
    const filled = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent'
    return (bordered || raised) && filled
  }

  for (const el of document.querySelectorAll('div, section, article, form, table')) {
    if (!isCard(el)) continue
    const r = el.getBoundingClientRect()
    /* Too small to be a card. */
    if (r.width < 200 || r.height < 40) continue
    /* Parked outside the window rather than drawn against its edge. The closed
       cart drawer sits at left 900 on a 900px window, which is not a card
       touching the edge — it is a card nobody can see. Reporting it on every
       screen would be a warning that means nothing, and those are the ones that
       teach you to skim past the real ones. */
    if (r.right <= 0 || r.left >= W) continue
    /* A card inside another card is spaced by its parent's padding, which is a
       different question — this sweep is about the page edge. */
    if (el.parentElement && el.parentElement.closest('*') && isCardish(el.parentElement)) continue

    const key = Math.round(r.left) + ':' + Math.round(r.top) + ':' + Math.round(r.width)
    if (seen.has(key)) continue
    seen.add(key)

    const leftGap = r.left
    const rightGap = W - r.right

    if (leftGap < gutter || rightGap < gutter) {
      out.flush.push({ what: describe(el), left: Math.round(leftGap), right: Math.round(rightGap) })
    }
    /* Wider than the window is a different defect with the same cause, and it
       is the one that produces a horizontal scrollbar on the whole page. */
    if (r.width > W + 2) {
      out.wide.push({ what: describe(el), by: Math.round(r.width - W) })
    }
  }

  /* Does the page scroll sideways? The symptom a person actually notices. */
  out.pageScrolls = document.documentElement.scrollWidth > W + 2

  function isCardish(el) {
    const s = getComputedStyle(el)
    const bordered = parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderLeftWidth) > 0
    const filled = s.backgroundColor !== 'rgba(0, 0, 0, 0)' && s.backgroundColor !== 'transparent'
    return (bordered || s.boxShadow !== 'none') && filled
  }
  return out
}

const PERSONAS = {
  operator: {
    card: 'Operator Admin',
    screens: ['Dashboard', 'Partner Onboarding', 'Sellers', 'Catalogue Review', 'Settlement Runs',
      'Tickets & SLA', 'Wallets', 'Refunds', 'Rewards', 'Markets & Currencies', 'Promotions',
      'Roles & Users', 'Audit Trail', 'Knowledge base'],
    menu: { open: 'AS', items: ['My details'] },
  },
  partner: {
    card: 'Partner / Seller',
    screens: ['Dashboard', 'Onboarding', 'My Listings', 'Orders', 'Refunds', 'Rewards',
      'Settlement', 'Performance', 'Reviews', 'Your Team', 'My Details', 'Knowledge base'],
  },
  enterprise: {
    card: 'Enterprise Buyer',
    screens: ['Dashboard', 'Approvals', 'Browse Catalogue', 'IoT', 'Security', 'Devices',
      'Orders', 'Refunds', 'Subscriptions', 'Billing', 'Wallet', 'Rewards', 'Team & Roles',
      'My Details', 'Knowledge base'],
  },
  consumer: {
    card: 'Consumer',
    screens: ['My Orders', 'Subscriptions', 'Rewards'],
    menu: { open: 'PR', items: ['My details', 'Wallet', 'Sign-in & security',
      'Notification preferences', 'My permissions', 'How things work'] },
  },
}

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-proxy-server'],
})

/* `node scripts/audit-gutters.mjs 900` reads 900 as the persona name, matches
   nothing, sweeps nothing and exits 0. That is the failure this whole file
   exists to avoid, so the argument is checked rather than trusted. */
const only = process.argv[2]
const NAMES = ['public', ...Object.keys(PERSONAS)]
if (only && !NAMES.includes(only)) {
  console.error(`"${only}" is not a persona. One of: ${NAMES.join(', ')}  (width is the second argument)`)
  process.exit(2)
}
const width = Number(process.argv[3] || 900)
let total = 0
let swept = 0

/* The signed-out storefront too. Most visitors see it before anything else, and
   it is the only part of the marketplace nobody has to log in to get wrong. */
if (!only || only === 'public') {
  const page = await b.newPage({ viewport: { width, height: 1000 } })
  console.log(`\n######## PUBLIC @ ${width}px ########`)
  for (const [label, path] of [['Landing', '/'], ['Consumer', '/?a=consumer'], ['Business', '/?a=business']]) {
    await page.goto('http://127.0.0.1:4180' + path, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(3000)
    const r = await page.evaluate(AUDIT, GUTTER)
    total += report(label, r); swept += 1
  }
  await page.close()
}

for (const [name, cfg] of Object.entries(PERSONAS)) {
  if (only && only !== name) continue
  const page = await b.newPage({ viewport: { width, height: 1000 } })
  await page.goto('http://127.0.0.1:4180/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Demo sign-in' }).first().click()
  await page.waitForTimeout(1200)
  await page.getByText(cfg.card, { exact: true }).first().click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /Sign In/i }).last().click()
  await page.waitForTimeout(6000)

  console.log(`\n######## ${name.toUpperCase()} @ ${width}px ########`)
  const all = [
    ...cfg.screens.map(s => ({ label: s, viaMenu: false })),
    ...(cfg.menu?.items ?? []).map(s => ({ label: s, viaMenu: true })),
  ]
  for (const { label: screen, viaMenu } of all) {
    if (viaMenu) {
      const opener = page.getByText(cfg.menu.open, { exact: true }).first()
      if (await opener.count() === 0) { console.log(`  ?  ${screen} — no account menu`); continue }
      try { await opener.click({ timeout: 5000 }) } catch { console.log(`  ?  ${screen} — menu did not open`); continue }
      await page.waitForTimeout(700)
    }
    const pattern = new RegExp(`^${screen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
    const nav = page.getByRole('button', { name: pattern })
      .or(page.getByRole('menuitem', { name: pattern })).first()
    if (await nav.count() === 0) { console.log(`  ?  ${screen} — no such nav item`); continue }
    try { await nav.click({ timeout: 5000 }) } catch { console.log(`  ?  ${screen} — not clickable`); continue }
    await page.waitForFunction(
      () => !document.querySelector('.spinner') && document.body.innerText.trim().length > 400,
      null, { timeout: 15000 },
    ).catch(() => console.log(`  ?  ${screen} — still loading after 15s`))
    await page.waitForTimeout(600)

    total += report(screen, await page.evaluate(AUDIT, GUTTER)); swept += 1
  }
  await page.close()
}

function report(screen, r) {
  const n = r.flush.length + r.wide.length
  if (n === 0 && !r.pageScrolls) { console.log(`  ok ${screen}`); return 0 }
  console.log(`  !! ${screen}${r.pageScrolls ? '  (page scrolls sideways)' : ''}`)
  for (const x of r.flush) console.log(`       flush: "${x.what}"  left ${x.left}px, right ${x.right}px`)
  for (const x of r.wide) console.log(`       wider than the window by ${x.by}px: "${x.what}"`)
  return n
}

console.log(`\nTOTAL GUTTER DEFECTS: ${total} — across ${swept} screens`)
await b.close()
/* Nothing swept is not nothing wrong. */
if (swept === 0) { console.error('no screens were swept, so this proved nothing'); process.exit(2) }
process.exit(total === 0 ? 0 : 1)
