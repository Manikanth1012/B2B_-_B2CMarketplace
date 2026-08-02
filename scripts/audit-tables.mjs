/* Walks every screen of every persona and reports table defects mechanically.
 *
 * Run against the dev proxy, which serves dist/ and forwards /sb to Supabase:
 *
 *   VITE_SUPABASE_URL="http://127.0.0.1:4180/sb" npm run build
 *   SUPABASE_UPSTREAM="https://<ref>.supabase.co" node scripts/dev-proxy.mjs &
 *   node scripts/audit-tables.mjs            # every persona at 1500px
 *   node scripts/audit-tables.mjs operator 1280
 *
 * Three things it can prove rather than eyeball:
 *   - a word broken across two lines. A Range over a single word returns one
 *     client rect when it sits on one line and two when the browser has split
 *     it, so "Device / s" is detectable exactly rather than by reading.
 *   - a table wider than the box it sits in, which is the horizontal scroll.
 *   - a cell whose content overflows it, which is text running under the next
 *     column.
 */
import { chromium } from 'playwright'

const AUDIT = () => {
  const out = { broken: [], scroll: [], overflow: [] }

  const label = (el) => {
    const t = (el.closest('table')?.previousElementSibling?.textContent ?? '').trim().slice(0, 40)
    return t || (el.tagName.toLowerCase())
  }

  /* --- words split across lines ------------------------------------------ */
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  const seen = new Set()
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const text = n.nodeValue
    if (!text || !text.trim()) continue
    const el = n.parentElement
    if (!el || !el.offsetParent) continue
    /* Only inside tables — prose is allowed to hyphenate, a data cell is not. */
    if (!el.closest('table')) continue

    const re = /[^\s]+/g
    let m
    while ((m = re.exec(text)) !== null) {
      const word = m[0]
      /* A single character cannot be split, and punctuation runs are noise. */
      if (word.length < 4) continue
      /* A hyphen or a slash is a break opportunity the browser is entitled to
         take — "built-in" over two lines is ordinary typesetting, not a
         crushed column. Only a break inside an unbroken run of letters is a
         defect. */
      if (/[-\/–—­]/.test(word)) continue
      const r = document.createRange()
      r.setStart(n, m.index)
      r.setEnd(n, m.index + word.length)
      const rects = r.getClientRects()
      if (rects.length > 1) {
        /* Two rects on the *same* line happen around inline children; only a
           genuine line break moves the top edge. */
        const tops = new Set([...rects].map(x => Math.round(x.top)))
        if (tops.size > 1) {
          const key = word + '|' + label(el)
          if (!seen.has(key)) { seen.add(key); out.broken.push({ word, where: label(el) }) }
        }
      }
    }
  }

  /* --- tables wider than their box --------------------------------------- */
  for (const t of document.querySelectorAll('table')) {
    const box = t.parentElement
    if (!box) continue
    const over = t.scrollWidth - box.clientWidth
    if (over > 2 && box.scrollWidth > box.clientWidth) {
      /* Which columns are eating the width, so a fix is aimed rather than
         guessed at. */
      const cols = [...t.querySelectorAll('thead th')]
        .map(th => `${(th.textContent || '').trim()}:${Math.round(th.getBoundingClientRect().width)}`)
        .join('  ')
      out.scroll.push({ where: label(t), by: over, cols })
    }
  }

  /* --- cells whose content escapes them ----------------------------------- */
  for (const td of document.querySelectorAll('td, th')) {
    if (td.scrollWidth - td.clientWidth > 2) {
      out.overflow.push({ where: label(td), text: (td.textContent ?? '').trim().slice(0, 40) })
    }
  }
  return out
}

/* Screenshots of anything that fails, for looking at afterwards. */
const OUT = process.env.AUDIT_OUT || '/tmp'

const PERSONAS = {
  operator: {
    card: 'Operator Admin',
    screens: ['Dashboard', 'Partner Onboarding', 'Sellers', 'Catalogue Review', 'Settlement Runs',
      'Inventory & WMS', 'Tickets & SLA', 'Collections', 'Wallets', 'Refunds', 'Rewards',
      'Revenue Share', 'General Ledger', 'Bill Templates', 'Markets & Currencies',
      'Developer Portal', 'Promotions', 'Storefront Banners', 'Notifications', 'Channels',
      'Reviews', 'Content Feedback', 'Roles & Users', 'Audit Trail', 'Knowledge base'],
  },
  partner: {
    card: 'Partner / Seller',
    screens: ['Dashboard', 'Onboarding', 'My Listings', 'New Listing', 'Orders', 'Refunds', 'Rewards', 'Settlement', 'Settlement Plan', 'Performance',
      'Integrations', 'Reviews', 'Disputes & Support', 'Notifications', 'Your Team',
      'Audit Log', 'My Details', 'Knowledge base'],
  },
  enterprise: {
    card: 'Enterprise Buyer',
    screens: ['Dashboard', 'Approvals', 'Browse Catalogue', 'IoT',
      'Security', 'Devices', 'Orders', 'Refunds', 'Subscriptions', 'Billing', 'Rewards',
      'Support', 'Notifications', 'Team & Roles', 'Audit Log', 'My Details', 'Knowledge base'],
  },
  consumer: {
    card: 'Consumer',
    screens: ['My Orders', 'Subscriptions', 'Rewards'],
    /* The account screens are behind the avatar menu rather than in the top
       nav, so they need opening first. Left out of the sweep entirely until
       now, which is exactly the sort of gap that makes an audit look clean. */
    menu: { open: 'AS', items: ['My details', 'Wallet', 'My documents',
      'Sign-in & security', 'Notification preferences', 'My permissions', 'How things work'] },
  },
}

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-proxy-server'],
})

const only = process.argv[2]
const width = Number(process.argv[3] || 1500)
let total = 0

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
      /* Reopened each time: choosing an item closes it. */
      const opener = page.getByText(cfg.menu.open, { exact: true }).first()
      if (await opener.count() === 0) { console.log(`  ?  ${screen} — no account menu`); continue }
      try { await opener.click({ timeout: 5000 }) } catch { console.log(`  ?  ${screen} — menu did not open`); continue }
      await page.waitForTimeout(700)
    }
    const nav = page.getByRole('button', { name: new RegExp(`^${screen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }).first()
    if (await nav.count() === 0) { console.log(`  ?  ${screen} — no such nav item`); continue }
    try { await nav.click({ timeout: 5000 }) } catch { console.log(`  ?  ${screen} — not clickable`); continue }
    await page.waitForTimeout(2600)

    const r = await page.evaluate(AUDIT)
    const n = r.broken.length + r.scroll.length + r.overflow.length
    total += n
    if (n === 0) { console.log(`  ok ${screen}`); continue }
    console.log(`  !! ${screen}`)
    for (const x of r.broken)   console.log(`       split word: "${x.word}"  in ${x.where}`)
    for (const x of r.scroll) {
      console.log(`       scrolls by ${x.by}px  in ${x.where}`)
      console.log(`          ${x.cols}`)
    }
    for (const x of r.overflow) console.log(`       cell overflows: "${x.text}"  in ${x.where}`)
    await page.screenshot({ path: `${OUT}/audit-${name}-${screen.replace(/[^a-z0-9]+/gi, '-')}.png`, fullPage: true })
  }
  await page.close()
}

console.log(`\nTOTAL DEFECTS: ${total}`)
await b.close()
