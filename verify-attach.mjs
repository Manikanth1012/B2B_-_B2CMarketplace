import { chromium } from 'playwright'
import fs from 'node:fs'
const OUT = '/tmp/claude-0/-home-user-B2B---B2CMarketplace/ea28c90f-73b7-56ee-aeeb-ba7165183659/scratchpad'
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args:['--no-proxy-server'] })
const page = await b.newPage({ viewport:{ width:1280, height:1000 } })
const shot = async n => { await page.screenshot({ path:`${OUT}/atc-${n}.png` }); console.log('  shot', n) }
fs.writeFileSync('/tmp/delivery-note.pdf', Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'))

async function demoIn(steps) {
  await page.goto('http://127.0.0.1:4180/', { waitUntil:'networkidle' })
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name:/demo sign-?in/i }).first().click()
  await page.waitForTimeout(1400)
  for (const s of steps) { await page.getByRole('button', { name:s }).first().click(); await page.waitForTimeout(1400) }
  await page.getByRole('button', { name:/^Sign In$/i }).last().click()
  await page.waitForTimeout(7000)
  console.log('  signed in')
}
async function stage(label) {
  const n = await page.getByRole('button', { name:/choose a file/i }).count()
  console.log(`  ${label}: picker x${n}`)
  if (!n) return false
  await page.locator('input[type="file"]').last().setInputFiles('/tmp/delivery-note.pdf')
  await page.waitForTimeout(800)
  console.log(`  ${label}: staged x${await page.getByText('delivery-note.pdf').count()}`)
  return true
}

// ============ PARTNER ============
console.log('PARTNER')
await demoIn([/Partner \/ Seller/i])
console.log('  nav:', JSON.stringify((await page.locator('nav button, aside button').allInnerTexts()).filter(t=>t.trim()&&t.length<28).slice(0,18)))
const plan = page.getByRole('button', { name: /^Settlement Plan$/i }).first()
if (await plan.count()) {
  await plan.click(); await page.waitForTimeout(4000)
  const tier = page.getByRole('button', { name: /request a tier review/i }).first()
  if (await tier.count()) {
    await tier.click(); await page.waitForTimeout(2500)
    await stage('partner tier review')
    await shot('partner-tier')
  } else console.log('  no tier-review button;', JSON.stringify((await page.locator('main button').allInnerTexts()).filter(t=>t.trim()&&t.length<30).slice(0,10)))
} else console.log('  no settlement nav entry')
await b.close()
