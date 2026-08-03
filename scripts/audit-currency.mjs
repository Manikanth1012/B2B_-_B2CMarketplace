/* Which screens still print a currency mark that does not belong to them.
 *
 * The complement to `audit-tables.mjs`: that one measures layout, this one
 * measures money. It walks every screen of every persona and reports the set of
 * currency marks on it, so "this screen says ₹ and $ at once" is a finding
 * rather than something you have to notice.
 *
 * A dollar sign is not automatically wrong — the marketplace's own settlements
 * are in dollars, and the seller and operator consoles quote them. So the
 * report names the marks and the caller reads it; only the consumer and
 * enterprise personas, which are billed in their own money, are asserted on.
 *
 * Run against the dev proxy, the same way `audit-tables.mjs` is:
 *
 *   VITE_SUPABASE_URL="http://127.0.0.1:4180/sb" npm run build
 *   SUPABASE_UPSTREAM="https://<ref>.supabase.co" node scripts/dev-proxy.mjs &
 *   node scripts/audit-currency.mjs             # every persona
 *   node scripts/audit-currency.mjs consumer    # one of them
 */
import { chromium } from 'playwright'

const PERSONAS = {
  operator: {
    card: 'Operator Admin', assert: false,
    screens: ['Dashboard', 'Sellers', 'Settlement Runs', 'Collections', 'Wallets', 'Refunds',
      'Rewards', 'Revenue Share', 'General Ledger', 'Markets & Currencies', 'Promotions',
      'Storefront Banners', 'Notifications'],
  },
  partner: {
    card: 'Partner / Seller', assert: false,
    screens: ['Dashboard', 'My Listings', 'Orders', 'Refunds', 'Rewards', 'Settlement',
      'Settlement Plan', 'Performance', 'Notifications'],
  },
  enterprise: {
    card: 'Enterprise Buyer', assert: true,
    screens: ['Dashboard', 'Approvals', 'Browse Catalogue', 'IoT', 'Security', 'Devices',
      'Orders', 'Refunds', 'Subscriptions', 'Billing', 'Wallet', 'Rewards', 'Notifications'],
  },
  consumer: {
    card: 'Consumer', assert: true,
    screens: ['My Orders', 'Subscriptions', 'Rewards'],
    menu: { open: 'PR', items: ['My details', 'Wallet', 'Notification preferences'] },
  },
}

const READ = () => {
  const marks = { '₹': 0, 'KSh': 0, 'AED': 0, '$': 0, 'INR': 0, 'KES': 0, 'USD': 0 }
  const text = document.body.innerText
  for (const m of text.matchAll(/(₹|KSh|AED|\$)\s?[\d,]+(\.\d+)?/g)) marks[m[1]] += 1
  for (const m of text.matchAll(/\b(INR|KES|USD)\s[\d,]/g)) marks[m[1]] += 1
  const samples = [...text.matchAll(/[^\n]{0,40}\$\s?[\d,]+(\.\d+)?[^\n]{0,20}/g)]
    .map(m => m[0].trim()).slice(0, 3)
  return { marks, samples }
}

const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--no-proxy-server'],
})
const only = process.argv[2]
let bad = 0

for (const [name, cfg] of Object.entries(PERSONAS)) {
  if (only && only !== name) continue
  const page = await b.newPage({ viewport: { width: 1500, height: 1000 } })
  await page.goto('http://127.0.0.1:4180/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2500)
  await page.getByRole('button', { name: 'Demo sign-in' }).first().click()
  await page.waitForTimeout(1200)
  await page.getByText(cfg.card, { exact: true }).first().click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /Sign In/i }).last().click()
  await page.waitForTimeout(6000)

  console.log(`\n######## ${name.toUpperCase()} ${cfg.assert ? '(must be one currency)' : '(dollars allowed — settlements)'} ########`)
  const all = [
    ...cfg.screens.map(s => ({ label: s, viaMenu: false })),
    ...(cfg.menu?.items ?? []).map(s => ({ label: s, viaMenu: true })),
  ]
  for (const { label: screen, viaMenu } of all) {
    if (viaMenu) {
      const opener = page.getByText(cfg.menu.open, { exact: true }).first()
      if (await opener.count() === 0) { console.log(`  ?  ${screen} — no account menu`); continue }
      try { await opener.click({ timeout: 5000 }) } catch { continue }
      await page.waitForTimeout(700)
    }
    const pattern = new RegExp(`^${screen.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')
    const nav = page.getByRole('button', { name: pattern })
      .or(page.getByRole('menuitem', { name: pattern })).first()
    if (await nav.count() === 0) { console.log(`  ?  ${screen} — no such nav item`); continue }
    try { await nav.click({ timeout: 5000 }) } catch { continue }
    await page.waitForFunction(
      () => !document.querySelector('.spinner') && document.body.innerText.trim().length > 400,
      null, { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(800)

    const { marks, samples } = await page.evaluate(READ)
    const seen = Object.entries(marks).filter(([, n]) => n > 0)
    const shown = seen.map(([m, n]) => `${m}×${n}`).join(' ') || '(no money)'
    const dollars = (marks['$'] ?? 0) + (marks['USD'] ?? 0)
    if (cfg.assert && dollars > 0) {
      bad += 1
      console.log(`  !! ${screen}: ${shown}`)
      for (const s of samples) console.log(`       "${s}"`)
    } else {
      console.log(`  ok ${screen}: ${shown}`)
    }
  }
  await page.close()
}

console.log(`\nSCREENS QUOTING THE WRONG MONEY: ${bad}`)
await b.close()
process.exit(bad === 0 ? 0 : 1)
