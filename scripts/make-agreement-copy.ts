/* Write the signed copy behind one agreement, and file it.
 *
 * Every agreement in the register carries a signed copy in the private
 * `evidence` bucket at `<account>/contracts/<id>.pdf`. A renewal made in the
 * operator console (`renew_contract`) creates the new term but no document, so
 * the register has a row nobody can open. This writes one for a named
 * agreement, from what the register says about it, uploads it, and points the
 * row at it.
 *
 * Like every document make-evidence.ts writes, it is synthetic and says so on
 * its face: it exists so that the record can be opened, not as a contract.
 *
 * Runs as the operator, whose policies already allow both writes (the row,
 * `operator_all_contract`; the file, `evidence_operator_all`). No service role.
 *
 *   SUPABASE_URL=… SUPABASE_ANON_KEY=… OPERATOR_EMAIL=… OPERATOR_PASSWORD=… \
 *   CONTRACT=CTR-2012-02 npx vite-node scripts/make-agreement-copy.ts
 */
import { createClient } from '@supabase/supabase-js'
import { buildPdf, wrap, Sheet } from '../src/lib/pdf'

const URL = process.env.SUPABASE_URL
const KEY = process.env.SUPABASE_ANON_KEY
const EMAIL = process.env.OPERATOR_EMAIL
const PASSWORD = process.env.OPERATOR_PASSWORD
const CONTRACT = process.env.CONTRACT
if (!URL || !KEY || !EMAIL || !PASSWORD || !CONTRACT) {
  console.error('SUPABASE_URL, SUPABASE_ANON_KEY, OPERATOR_EMAIL, OPERATOR_PASSWORD and CONTRACT are required')
  process.exit(1)
}
const db = createClient(URL, KEY, { auth: { persistSession: false } })

const NAVY: [number, number, number] = [13, 71, 161]
const INK: [number, number, number] = [17, 24, 39]
const MUTED: [number, number, number] = [107, 114, 128]
const WASH: [number, number, number] = [246, 248, 251]
const WARN: [number, number, number] = [180, 83, 9]

const DAY: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }
const day = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', DAY)

async function main() {
  const auth = await db.auth.signInWithPassword({ email: EMAIL!, password: PASSWORD! })
  if (auth.error) throw new Error(`could not sign in as the operator: ${auth.error.message}`)

  const { data: c, error } = await db.from('enterprise_contract').select('*').eq('id', CONTRACT!).maybeSingle()
  if (error) throw new Error(error.message)
  if (!c) throw new Error(`${CONTRACT} is not in the register`)
  const { data: acct } = await db.from('enterprise_accounts').select('*').eq('id', c.account_id).maybeSingle()
  const company: string = acct?.company ?? acct?.name ?? c.account_id
  const market: string | null = acct?.market ?? null
  const { data: iss } = market
    ? await db.from('invoice_issuer').select('legal_name, trading_name, lines').eq('market', market).maybeSingle()
    : { data: null }
  const issuerName: string = iss?.legal_name ?? 'Aventa Communications Private Limited'
  const issuerMark: string = iss?.trading_name ?? 'Aventa Telecom'
  const issuerLines: string = (iss?.lines ?? []).map((l: string) => l.replace(/^Registered office:\s*/, '')).join(', ')

  const path = `${c.account_id}/contracts/${c.id}.pdf`
  const s = new Sheet()
  s.text(issuerMark, { size: 14, font: 'bold', colour: NAVY })
  s.text('AGREEMENT', { x: s.right, align: 'right', size: 8, font: 'bold', colour: MUTED })
  s.y += 18
  s.rule({ colour: NAVY, width: 1.6, gap: 16 })
  s.line(c.title, { size: 15, font: 'bold', colour: INK, gap: 19 })
  s.line(`Between ${issuerName} and ${company}`, { size: 9, colour: MUTED, gap: 14 })

  s.room(28)
  s.band(24, WASH)
  s.text('SPECIMEN — generated for the Aventa marketplace prototype. Not a genuine agreement.',
    { x: s.left + 10, y: s.y + 12, size: 7.5, font: 'bold', colour: WARN })
  s.y += 34

  const VALUE_X = s.left + 130
  const meta: [string, string][] = [
    ['Account', `${company} (${c.account_id})`],
    ['Reference', c.id],
    ['Signed', day(c.signed_on)],
    ['Term', `${day(c.starts_on)} to ${day(c.ends_on)}`],
    ['Payment terms', c.terms],
    ['Currency', c.currency],
    ['Renewal', c.auto_renew ? 'Renews automatically unless either side gives notice' : 'Does not roll over; renewed only by a new agreement'],
    ['Notice', `${c.notice_days} days before the term ends`],
  ]
  if (c.term_value !== null) meta.push(['Stated value', `${c.currency} ${Number(c.term_value).toLocaleString('en-GB')}`])
  for (const [k, v] of meta) {
    const rows = wrap(v, s.right - VALUE_X, 8.5)
    s.room(rows.length * 12 + 4)
    s.text(k, { size: 7, font: 'bold', colour: MUTED })
    for (const [i, row] of rows.entries()) s.text(row, { x: VALUE_X, y: s.y + i * 11, size: 8.5, colour: INK })
    s.y += Math.max(13, rows.length * 11 + 2)
  }
  s.gap(10)
  s.rule({ colour: [226, 232, 240], gap: 12 })

  const clauses: [string, string][] = [
    ['1. What this agreement covers', `${company} may buy on account through the marketplace for the term above. Outside the term it may not, until the agreement is renewed.`],
    ['2. Payment', `Invoices are payable ${c.terms.toLowerCase().startsWith('net') ? `on ${c.terms} terms` : `on the terms stated: ${c.terms}`}, in ${c.currency}.`],
    ['3. Prices', 'Each listing is charged at the price published for the account\'s market, unless the marketplace has agreed a price for the account on that listing. An agreed price is never below the floor the seller set and never above the published price, and the price shown is the price invoiced.'],
    ['4. Ending and renewing', c.auto_renew
      ? `The agreement renews for a like term unless either side gives ${c.notice_days} days' notice before it ends.`
      : `The agreement ends on ${day(c.ends_on)}. Either side may propose a renewal; it takes effect only when a new agreement is signed.`],
  ]
  for (const [heading, prose] of clauses) {
    s.room(30)
    s.line(heading, { size: 9, font: 'bold', colour: INK, gap: 12 })
    s.paragraph(prose, { size: 8, colour: MUTED })
    s.gap(7)
  }
  if (c.note) { s.gap(4); s.paragraph(c.note, { size: 8, colour: MUTED }); s.gap(7) }

  s.gap(10)
  s.rule({ colour: [226, 232, 240], gap: 12 })
  s.row('For the account', `${c.signed_by}, ${c.signed_title}`)
  s.row('For the marketplace', c.countersigned_by)
  s.gap(14)
  s.rule({ colour: [226, 232, 240], gap: 10 })
  s.paragraph(
    `Issued by ${issuerName}${issuerLines ? `, ${issuerLines}` : ''}. This document exists so that a record in the `
    + 'marketplace can be opened and read. It carries no legal effect and represents no real person or company.',
    { size: 7, colour: MUTED })

  const bytes = buildPdf(s.pages, { title: `${c.id} — ${c.title}`, author: issuerMark })
  const up = await db.storage.from('evidence').upload(path, bytes, { contentType: 'application/pdf', upsert: true })
  if (up.error) throw new Error(`could not upload ${path}: ${up.error.message}`)

  if (c.document_path !== path || c.document_name !== `${c.id}.pdf`) {
    const { data: done, error: uErr } = await db.from('enterprise_contract')
      .update({ document_path: path, document_name: `${c.id}.pdf` }).eq('id', c.id).select('id')
    if (uErr) throw new Error(`uploaded, but could not point ${c.id} at it: ${uErr.message}`)
    if (!done?.length) throw new Error(`uploaded, but ${c.id} was not updated`)
  }
  console.log(`${c.id}: signed copy filed at evidence/${path} (${bytes.length} bytes)`)
  await db.auth.signOut()
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
